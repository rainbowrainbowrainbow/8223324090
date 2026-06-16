'use strict';

const crypto = require('crypto');
const { pool: defaultPool, generateBookingNumber } = require('../db');
const {
    checkRoomConflict,
    checkServerConflicts,
    checkServerDuplicate,
    mapBookingRow,
    normalizeBookingStatus,
    validateDate,
    validateTime
} = require('./booking');
const { DEFAULT_TIMELINE_CONTEXT } = require('./timelineContext');
const { canEditBooking } = require('./bookingVisibility');
const { insertHistory } = require('./historyLog');

const BANQUET_LINK_RELATION_TYPE = 'banquet_activity';
const WRITABLE_MEMBER_ROLES = new Set(['kitchen', 'activity', 'service', 'manual']);
const BANQUET_GROUP_SOURCE = Object.freeze({
    GROUP: 'banquet_group',
    LEGACY: 'legacy_booking_banquet_links',
    SINGLE: 'single_booking'
});

class BanquetGroupError extends Error {
    constructor(message, { status = 400, code = 'BANQUET_GROUP_ERROR', details = null } = {}) {
        super(message);
        this.name = 'BanquetGroupError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function bookingContextColumnSql(column) {
    return `CASE
        WHEN LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), '${DEFAULT_TIMELINE_CONTEXT}')) IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_TIMELINE_CONTEXT}'
        ELSE LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), '${DEFAULT_TIMELINE_CONTEXT}'))
    END`;
}

function bookingContextSql(alias = '', placeholder = '$1') {
    const column = alias ? `${alias}.business_context` : 'business_context';
    return `${bookingContextColumnSql(column)} = ${placeholder}`;
}

function isMissingBanquetSchemaError(err) {
    return ['42P01', '42703'].includes(String(err?.code || ''))
        || /banquet_groups|banquet_group_bookings/i.test(String(err?.message || ''));
}

function cleanId(value) {
    const id = String(value || '').trim();
    return id || null;
}

function actorUserId(user) {
    const id = Number(user?.id || 0);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function actorName(user) {
    return user?.username || user?.name || 'system';
}

function generateBanquetGroupId() {
    const stamp = Date.now().toString(36).toUpperCase();
    const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `BQ-${stamp}-${suffix}`.slice(0, 50);
}

function normalizeWritableRole(value) {
    const role = String(value || 'manual').trim().toLowerCase();
    return WRITABLE_MEMBER_ROLES.has(role) ? role : null;
}

function normalizeShortText(value, maxLength = 200) {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : null;
}

function normalizeMeta(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBanquetLinkPair(sourceId, targetId) {
    const a = cleanId(sourceId);
    const b = cleanId(targetId);
    if (!a || !b || a === b) return null;
    return a < b ? [a, b] : [b, a];
}

function rowContext(row = {}) {
    return row.business_context || row.businessContext || DEFAULT_TIMELINE_CONTEXT;
}

function parseExtraData(row = {}) {
    const raw = row.extra_data ?? row.extraData;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw) || {};
    } catch {
        return {};
    }
}

function menuPositionCount(row = {}) {
    const extra = parseExtraData(row);
    const bookingPackage = row.bookingPackage
        || row.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
    const positions = bookingPackage.menuPositions || bookingPackage.menu_positions || [];
    return Array.isArray(positions) ? positions.length : 0;
}

function isKitchenCandidate(row = {}) {
    return menuPositionCount(row) > 0
        || Boolean(String(row.banquet_menu || row.banquetMenu || '').trim())
        || row.banquet_guests != null
        || row.banquetGuests != null
        || row.banquet_adults != null
        || row.banquetAdults != null
        || row.banquet_tables != null
        || row.banquetTables != null;
}

function isRootBooking(row = {}) {
    return !String(row.linked_to || row.linkedTo || '').trim();
}

function timeKey(row = {}) {
    return `${row.date || ''} ${row.time || ''} ${row.id || ''}`;
}

function mapGroupRow(row = null) {
    if (!row) return null;
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_TIMELINE_CONTEXT,
        primaryBookingId: row.primary_booking_id || null,
        customerId: row.customer_id || null,
        date: row.date || null,
        room: row.room || null,
        groupName: row.group_name || null,
        status: row.status || 'active',
        source: row.source || 'manual',
        meta: row.meta || {},
        createdByUserId: row.created_by_user_id || null,
        createdBy: row.created_by || null,
        updatedBy: row.updated_by || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function mapMembershipRow(row = {}) {
    return {
        id: row.id || null,
        groupId: row.group_id || null,
        businessContext: row.business_context || DEFAULT_TIMELINE_CONTEXT,
        bookingId: row.booking_id || null,
        role: row.role || 'manual',
        sortOrder: row.sort_order ?? 100,
        createdByUserId: row.created_by_user_id || null,
        createdBy: row.created_by || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function mapLegacyLinkRow(row = {}) {
    return {
        id: row.id || null,
        businessContext: row.business_context || DEFAULT_TIMELINE_CONTEXT,
        bookingAId: row.booking_a_id || null,
        bookingBId: row.booking_b_id || null,
        relationType: row.relation_type || BANQUET_LINK_RELATION_TYPE,
        label: row.label || null,
        createdBy: row.created_by || null,
        createdAt: row.created_at || null
    };
}

async function getScopedBooking(db, bookingId, businessContext) {
    const result = await db.query(
        `SELECT b.*
           FROM bookings b
          WHERE b.id = $1
            AND ${bookingContextSql('b', '$2')}
          LIMIT 1`,
        [bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows[0] || null;
}

async function getScopedBookingForUpdate(db, bookingId, businessContext) {
    const result = await db.query(
        `SELECT b.*
           FROM bookings b
          WHERE b.id = $1
            AND ${bookingContextSql('b', '$2')}
          FOR UPDATE`,
        [bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows[0] || null;
}

async function findGroupForBooking(db, bookingId, businessContext) {
    try {
        const result = await db.query(
            `SELECT bg.*
               FROM banquet_group_bookings bgb
               JOIN banquet_groups bg ON bg.id = bgb.group_id
              WHERE bgb.booking_id = $1
                AND ${bookingContextSql('bgb', '$2')}
                AND ${bookingContextSql('bg', '$2')}
              LIMIT 1`,
            [bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
        );
        return { group: result.rows[0] || null, schemaAvailable: true };
    } catch (err) {
        if (isMissingBanquetSchemaError(err)) return { group: null, schemaAvailable: false };
        throw err;
    }
}

async function getGroupById(db, groupId, businessContext) {
    try {
        const result = await db.query(
            `SELECT bg.*
               FROM banquet_groups bg
              WHERE bg.id = $1
                AND ${bookingContextSql('bg', '$2')}
              LIMIT 1`,
            [groupId, businessContext || DEFAULT_TIMELINE_CONTEXT]
        );
        return { group: result.rows[0] || null, schemaAvailable: true };
    } catch (err) {
        if (isMissingBanquetSchemaError(err)) return { group: null, schemaAvailable: false };
        throw err;
    }
}

async function getGroupByIdForUpdate(db, groupId, businessContext) {
    const result = await db.query(
        `SELECT bg.*
           FROM banquet_groups bg
          WHERE bg.id = $1
            AND ${bookingContextSql('bg', '$2')}
          FOR UPDATE`,
        [groupId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows[0] || null;
}

async function getMembershipForBooking(db, bookingId, businessContext) {
    const result = await db.query(
        `SELECT bgb.*, bg.primary_booking_id, bg.status AS group_status
           FROM banquet_group_bookings bgb
           JOIN banquet_groups bg ON bg.id = bgb.group_id
          WHERE bgb.booking_id = $1
            AND ${bookingContextSql('bgb', '$2')}
            AND ${bookingContextSql('bg', '$2')}
          FOR UPDATE OF bgb`,
        [bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows[0] || null;
}

async function getMembershipInGroup(db, groupId, bookingId, businessContext) {
    const result = await db.query(
        `SELECT bgb.*
           FROM banquet_group_bookings bgb
          WHERE bgb.group_id = $1
            AND bgb.booking_id = $2
            AND ${bookingContextSql('bgb', '$3')}
          FOR UPDATE`,
        [groupId, bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows[0] || null;
}

async function getMembershipRows(db, groupId, businessContext) {
    const result = await db.query(
        `SELECT bgb.*
           FROM banquet_group_bookings bgb
          WHERE bgb.group_id = $1
            AND ${bookingContextSql('bgb', '$2')}
          ORDER BY bgb.sort_order ASC, bgb.id ASC`,
        [groupId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows || [];
}

async function getBookingsByIds(db, ids, businessContext) {
    const uniqueIds = [...new Set((ids || []).map(cleanId).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const result = await db.query(
        `SELECT b.*
           FROM bookings b
          WHERE b.id = ANY($1::text[])
            AND ${bookingContextSql('b', '$2')}
          ORDER BY b.date ASC, b.time ASC, b.id ASC`,
        [uniqueIds, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows || [];
}

async function getTechnicalChildren(db, rootIds, businessContext) {
    const uniqueIds = [...new Set((rootIds || []).map(cleanId).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const result = await db.query(
        `SELECT b.*
           FROM bookings b
          WHERE NULLIF(COALESCE(b.linked_to, ''), '') = ANY($1::text[])
            AND ${bookingContextSql('b', '$2')}
          ORDER BY b.date ASC, b.time ASC, b.id ASC`,
        [uniqueIds, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows || [];
}

async function getLegacyBanquetLinks(db, businessContext) {
    const result = await db.query(
        `SELECT id, business_context, booking_a_id, booking_b_id, relation_type, label, created_at, created_by
           FROM booking_banquet_links
          WHERE business_context = $1
            AND relation_type = $2
          ORDER BY created_at ASC, id ASC`,
        [businessContext || DEFAULT_TIMELINE_CONTEXT, BANQUET_LINK_RELATION_TYPE]
    );
    return result.rows || [];
}

async function upsertCompatibilityLink(db, businessContext, primaryBookingId, targetBookingId, label, user) {
    const pair = normalizeBanquetLinkPair(primaryBookingId, targetBookingId);
    if (!pair) return null;
    const result = await db.query(
        `INSERT INTO booking_banquet_links
            (business_context, booking_a_id, booking_b_id, relation_type, label, created_by_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (business_context, booking_a_id, booking_b_id, relation_type)
         DO UPDATE SET label = COALESCE(EXCLUDED.label, booking_banquet_links.label),
                       updated_at = NOW()
         RETURNING id, booking_a_id, booking_b_id, relation_type, label, created_at, created_by`,
        [
            businessContext || DEFAULT_TIMELINE_CONTEXT,
            pair[0],
            pair[1],
            BANQUET_LINK_RELATION_TYPE,
            normalizeShortText(label, 200),
            actorUserId(user),
            user?.username || null
        ]
    );
    return result.rows[0] || null;
}

async function deleteCompatibilityLink(db, businessContext, primaryBookingId, targetBookingId) {
    const pair = normalizeBanquetLinkPair(primaryBookingId, targetBookingId);
    if (!pair) return null;
    const result = await db.query(
        `DELETE FROM booking_banquet_links
          WHERE business_context = $1
            AND relation_type = $4
            AND (
                (booking_a_id = $2 AND booking_b_id = $3)
                OR (booking_a_id = $3 AND booking_b_id = $2)
            )
          RETURNING id, booking_a_id, booking_b_id, relation_type, label, created_at, created_by`,
        [businessContext || DEFAULT_TIMELINE_CONTEXT, pair[0], pair[1], BANQUET_LINK_RELATION_TYPE]
    );
    return result.rows[0] || null;
}

async function logBanquetHistory(db, businessContext, action, user, data) {
    await insertHistory(db, {
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
        action,
        username: actorName(user),
        data: {
            ...(data || {}),
            business_context: businessContext || DEFAULT_TIMELINE_CONTEXT
        }
    });
}

function assertEditableBooking(user, booking) {
    if (!booking || !canEditBooking(user, mapBookingRow(booking))) {
        throw new BanquetGroupError('Booking not found', { status: 404, code: 'BOOKING_NOT_FOUND' });
    }
}

function assertRootBooking(booking, code = 'BOOKING_MUST_BE_ROOT') {
    if (!isRootBooking(booking)) {
        throw new BanquetGroupError('Only root bookings can be attached to a banquet group', { status: 400, code });
    }
}

function assertActiveBooking(booking) {
    if (String(booking?.status || '').toLowerCase() === 'cancelled') {
        throw new BanquetGroupError('Cancelled bookings cannot be attached to a banquet group', { status: 400, code: 'BOOKING_CANCELLED' });
    }
}

function duplicateMembershipError(existing, groupId = null) {
    const sameGroup = groupId && String(existing.group_id) === String(groupId);
    return new BanquetGroupError(
        sameGroup ? 'Booking is already attached to this banquet group' : 'Booking is already attached to another banquet group',
        {
            status: 409,
            code: sameGroup ? 'BOOKING_ALREADY_IN_GROUP' : 'BOOKING_IN_OTHER_GROUP',
            details: { groupId: existing.group_id || null, bookingId: existing.booking_id || null }
        }
    );
}

function normalizeActivityNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeActivityInteger(value, fallback = null) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
}

function normalizeActivityText(value, maxLength = 2000) {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : null;
}

function normalizeActivityExtraData(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return JSON.stringify(value);
}

function normalizeRootActivityBooking(input = {}, { sourceBooking, group, businessContext, user } = {}) {
    const booking = {
        ...input,
        date: String(input.date || sourceBooking?.date || '').slice(0, 10),
        time: String(input.time || sourceBooking?.time || '').slice(0, 5),
        lineId: cleanId(input.lineId || input.line_id),
        programId: input.programId || input.program_id || null,
        programCode: input.programCode || input.program_code || null,
        label: normalizeActivityText(input.label || input.programName || input.program_name || 'Активна програма', 200),
        programName: normalizeActivityText(input.programName || input.program_name || input.label || 'Активна програма', 200),
        category: normalizeActivityText(input.category || 'animation', 80),
        duration: normalizeActivityInteger(input.duration, 0),
        price: normalizeActivityNumber(input.price, 0),
        hosts: normalizeActivityInteger(input.hosts, null),
        secondAnimator: normalizeActivityText(input.secondAnimator || input.second_animator, 100),
        pinataFiller: input.pinataFiller ?? input.pinata_filler ?? null,
        pinataMode: input.pinataMode ?? input.pinata_mode ?? null,
        pinataNumber: input.pinataNumber ?? input.pinata_number ?? null,
        pinataFillerNumber: input.pinataFillerNumber ?? input.pinata_filler_number ?? null,
        clientPinataServicePrice: input.clientPinataServicePrice ?? input.client_pinata_service_price ?? null,
        clientPinataServiceNote: input.clientPinataServiceNote ?? input.client_pinata_service_note ?? null,
        costume: normalizeActivityText(input.costume, 100),
        room: normalizeActivityText(input.room || sourceBooking?.room, 100),
        notes: normalizeActivityText(input.notes, 2000),
        createdBy: normalizeActivityText(input.createdBy || input.created_by || actorName(user), 100),
        status: normalizeBookingStatus(input.status, sourceBooking?.status || 'confirmed'),
        kidsCount: normalizeActivityInteger(input.kidsCount ?? input.kids_count, null),
        groupName: normalizeActivityText(input.groupName || input.group_name || group?.group_name || sourceBooking?.group_name, 200),
        extraData: input.extraData || input.extra_data || {},
        skipNotification: Boolean(input.skipNotification || input.skip_notification),
        customerId: normalizeActivityInteger(input.customerId ?? input.customer_id ?? sourceBooking?.customer_id ?? group?.customer_id, null),
        paymentMethod: input.paymentMethod || input.payment_method || sourceBooking?.payment_method || null,
        banquetGuests: null,
        banquetAdults: null,
        banquetTables: null,
        banquetMenu: null,
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT
    };
    if (!booking.extraData || typeof booking.extraData !== 'object' || Array.isArray(booking.extraData)) booking.extraData = {};
    booking.extraData.banquetGroup = {
        ...(booking.extraData.banquetGroup || {}),
        groupId: group?.id || null,
        sourceBookingId: sourceBooking?.id || null,
        role: 'activity',
        source: 'room_booking_animation_bridge'
    };
    return booking;
}

function normalizeLinkedActivityBooking(input = {}, rootBooking = {}, { businessContext, user } = {}) {
    const booking = {
        ...input,
        date: String(input.date || rootBooking.date || '').slice(0, 10),
        time: String(input.time || rootBooking.time || '').slice(0, 5),
        lineId: cleanId(input.lineId || input.line_id),
        programId: input.programId || input.program_id || rootBooking.programId || null,
        programCode: input.programCode || input.program_code || rootBooking.programCode || null,
        label: normalizeActivityText(input.label || rootBooking.label || 'Активна програма', 200),
        programName: normalizeActivityText(input.programName || input.program_name || rootBooking.programName || rootBooking.label || 'Активна програма', 200),
        category: normalizeActivityText(input.category || rootBooking.category || 'animation', 80),
        duration: normalizeActivityInteger(input.duration, rootBooking.duration || 0),
        price: 0,
        hosts: normalizeActivityInteger(input.hosts, rootBooking.hosts || null),
        secondAnimator: normalizeActivityText(input.secondAnimator || input.second_animator, 100),
        pinataFiller: input.pinataFiller ?? input.pinata_filler ?? rootBooking.pinataFiller ?? null,
        pinataMode: input.pinataMode ?? input.pinata_mode ?? rootBooking.pinataMode ?? null,
        pinataNumber: input.pinataNumber ?? input.pinata_number ?? rootBooking.pinataNumber ?? null,
        pinataFillerNumber: input.pinataFillerNumber ?? input.pinata_filler_number ?? rootBooking.pinataFillerNumber ?? null,
        clientPinataServicePrice: input.clientPinataServicePrice ?? input.client_pinata_service_price ?? null,
        clientPinataServiceNote: input.clientPinataServiceNote ?? input.client_pinata_service_note ?? null,
        costume: normalizeActivityText(input.costume || rootBooking.costume, 100),
        room: normalizeActivityText(input.room || rootBooking.room, 100),
        notes: normalizeActivityText(input.notes || rootBooking.notes, 2000),
        createdBy: normalizeActivityText(input.createdBy || input.created_by || rootBooking.createdBy || actorName(user), 100),
        status: normalizeBookingStatus(input.status, rootBooking.status || 'confirmed'),
        kidsCount: normalizeActivityInteger(input.kidsCount ?? input.kids_count ?? rootBooking.kidsCount, null),
        groupName: normalizeActivityText(input.groupName || input.group_name || rootBooking.groupName, 200),
        extraData: input.extraData || input.extra_data || {},
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT
    };
    if (!booking.extraData || typeof booking.extraData !== 'object' || Array.isArray(booking.extraData)) booking.extraData = {};
    booking.extraData.banquetGroup = {
        ...(booking.extraData.banquetGroup || {}),
        parentActivityBookingId: rootBooking.id || null,
        role: 'technical_linked_child',
        source: 'room_booking_animation_bridge'
    };
    return booking;
}

function assertCreateActivityPayload(booking) {
    if (!validateDate(booking.date)) {
        throw new BanquetGroupError('Invalid activity date format', { status: 400, code: 'INVALID_ACTIVITY_DATE' });
    }
    if (!validateTime(booking.time)) {
        throw new BanquetGroupError('Invalid activity time format', { status: 400, code: 'INVALID_ACTIVITY_TIME' });
    }
    if (!booking.lineId) {
        throw new BanquetGroupError('Activity lineId is required', { status: 400, code: 'ACTIVITY_LINE_REQUIRED' });
    }
    if (!booking.room) {
        throw new BanquetGroupError('Activity room is required', { status: 400, code: 'ACTIVITY_ROOM_REQUIRED' });
    }
    if (!booking.status) {
        throw new BanquetGroupError('Invalid activity booking status', { status: 400, code: 'INVALID_ACTIVITY_STATUS' });
    }
    if (!Number.isFinite(Number(booking.duration)) || Number(booking.duration) <= 0 || Number(booking.duration) > 1440) {
        throw new BanquetGroupError('Activity duration must be between 1 and 1440 minutes', { status: 400, code: 'INVALID_ACTIVITY_DURATION' });
    }
}

async function assertActivitySlotAvailable(db, booking, businessContext, { sourceBookingId = null } = {}) {
    const lineConflict = await checkServerConflicts(db, booking.date, booking.lineId, booking.time, booking.duration || 0, null, businessContext);
    if (lineConflict.overlap) {
        throw new BanquetGroupError('Activity line slot is busy', {
            status: 409,
            code: 'ACTIVITY_LINE_CONFLICT',
            details: {
                conflictBookingId: lineConflict.conflictWith?.id || null,
                time: lineConflict.conflictWith?.time || null
            }
        });
    }
    const duplicate = await checkServerDuplicate(db, booking.date, booking.programId, booking.time, booking.duration || 0, null, businessContext);
    if (duplicate) {
        throw new BanquetGroupError('Activity already exists at this time', {
            status: 409,
            code: 'ACTIVITY_DUPLICATE',
            details: { conflictBookingId: duplicate.id || null }
        });
    }
    const roomConflict = await checkRoomConflict(db, booking.date, booking.room, booking.time, booking.duration || 0, sourceBookingId, businessContext);
    if (roomConflict) {
        throw new BanquetGroupError('Activity room slot is busy', {
            status: 409,
            code: 'ACTIVITY_ROOM_CONFLICT',
            details: {
                conflictBookingId: roomConflict.id || null,
                time: roomConflict.time || null
            }
        });
    }
}

async function insertRootActivityBooking(db, booking, businessContext) {
    booking.id = await generateBookingNumber(db);
    const result = await db.query(
        `INSERT INTO bookings
            (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category,
             duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number,
             client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to,
             status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method,
             banquet_guests, banquet_adults, banquet_tables, banquet_menu)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, $22, $23, $24, NULL,
                 $25, $26, $27, $28, $29, $30, $31,
                 NULL, NULL, NULL, NULL)
         RETURNING *`,
        [
            booking.id,
            businessContext || DEFAULT_TIMELINE_CONTEXT,
            booking.date,
            booking.time,
            booking.lineId,
            booking.programId,
            booking.programCode,
            booking.label,
            booking.programName,
            booking.category,
            booking.duration,
            booking.price || 0,
            booking.hosts,
            booking.secondAnimator,
            booking.pinataFiller,
            booking.pinataMode,
            booking.pinataNumber,
            booking.pinataFillerNumber,
            booking.clientPinataServicePrice,
            booking.clientPinataServiceNote,
            booking.costume,
            booking.room,
            booking.notes,
            booking.createdBy,
            booking.status,
            booking.kidsCount,
            booking.groupName,
            normalizeActivityExtraData(booking.extraData),
            booking.skipNotification,
            booking.customerId,
            booking.paymentMethod
        ]
    );
    return result.rows[0] || null;
}

async function insertLinkedActivityChildBooking(db, booking, rootBookingId, businessContext) {
    booking.id = await generateBookingNumber(db);
    const result = await db.query(
        `INSERT INTO bookings
            (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category,
             duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number,
             client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to,
             status, kids_count, group_name, extra_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, 0, $12, $13, $14, $15, $16, $17,
                 $18, $19, $20, $21, $22, $23, $24,
                 $25, $26, $27, $28)
         RETURNING *`,
        [
            booking.id,
            businessContext || DEFAULT_TIMELINE_CONTEXT,
            booking.date,
            booking.time,
            booking.lineId,
            booking.programId,
            booking.programCode,
            booking.label,
            booking.programName,
            booking.category,
            booking.duration,
            booking.hosts,
            booking.secondAnimator,
            booking.pinataFiller,
            booking.pinataMode,
            booking.pinataNumber,
            booking.pinataFillerNumber,
            booking.clientPinataServicePrice,
            booking.clientPinataServiceNote,
            booking.costume,
            booking.room,
            booking.notes,
            booking.createdBy,
            rootBookingId,
            booking.status,
            booking.kidsCount,
            booking.groupName,
            normalizeActivityExtraData(booking.extraData)
        ]
    );
    return result.rows[0] || null;
}

function connectedLegacyLinks(allLinks, bookingId) {
    const startId = cleanId(bookingId);
    if (!startId) return [];
    const selected = [];
    const seenBookings = new Set([startId]);
    const seenLinks = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        for (const link of allLinks || []) {
            const a = cleanId(link.booking_a_id);
            const b = cleanId(link.booking_b_id);
            if (!a || !b) continue;
            if (!seenBookings.has(a) && !seenBookings.has(b)) continue;
            const linkKey = String(link.id || `${a}:${b}`);
            if (!seenLinks.has(linkKey)) {
                seenLinks.add(linkKey);
                selected.push(link);
            }
            if (!seenBookings.has(a)) {
                seenBookings.add(a);
                changed = true;
            }
            if (!seenBookings.has(b)) {
                seenBookings.add(b);
                changed = true;
            }
        }
    }
    return selected;
}

function legacyBookingIds(anchorBookingId, links = []) {
    const ids = new Set([cleanId(anchorBookingId)].filter(Boolean));
    for (const link of links) {
        ids.add(cleanId(link.booking_a_id));
        ids.add(cleanId(link.booking_b_id));
    }
    return [...ids].filter(Boolean);
}

function inferPrimaryBooking(rootRows, memberships, group, anchorBookingId) {
    const byId = new Map(rootRows.map(row => [String(row.id), row]));
    const explicitMembership = memberships.find(item => item.role === 'primary' && byId.has(String(item.bookingId)));
    if (explicitMembership) return byId.get(String(explicitMembership.bookingId));
    if (group?.primaryBookingId && byId.has(String(group.primaryBookingId))) return byId.get(String(group.primaryBookingId));
    const extraPrimary = rootRows.find(row => {
        const extra = parseExtraData(row);
        return extra.multiActivity?.role === 'primary' || extra.multi_activity?.role === 'primary';
    });
    if (extraPrimary) return extraPrimary;
    const kitchen = rootRows.find(isKitchenCandidate);
    if (kitchen) return kitchen;
    if (anchorBookingId && byId.has(String(anchorBookingId))) return byId.get(String(anchorBookingId));
    return [...rootRows].sort((a, b) => timeKey(a).localeCompare(timeKey(b)))[0] || null;
}

function computedRoleFor(row, membership, primaryId) {
    const bookingId = String(row.id || '');
    if (primaryId && bookingId === String(primaryId)) return 'primary';
    const explicit = membership?.role || null;
    if (['kitchen', 'activity', 'service', 'manual'].includes(explicit)) return explicit;
    if (isKitchenCandidate(row)) return 'kitchen';
    if (row.program_id || row.programId || Number(row.price || 0) > 0) return 'activity';
    return 'manual';
}

function buildSnapshot({
    source,
    businessContext,
    groupRow = null,
    membershipRows = [],
    bookingRows = [],
    technicalRows = [],
    legacyLinks = [],
    anchorBookingId = null,
    schemaAvailable = true
}) {
    const group = mapGroupRow(groupRow);
    const memberships = membershipRows.map(mapMembershipRow);
    const membershipByBookingId = new Map(memberships.map(item => [String(item.bookingId), item]));
    const rootRows = bookingRows.filter(isRootBooking);
    const primaryRow = inferPrimaryBooking(rootRows, memberships, group, anchorBookingId);
    const primaryId = primaryRow?.id || group?.primaryBookingId || null;
    const childrenByParent = new Map();
    for (const row of technicalRows || []) {
        const parentId = cleanId(row.linked_to || row.linkedTo);
        if (!parentId) continue;
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(mapBookingRow(row));
    }

    const members = rootRows.map(row => {
        const booking = mapBookingRow(row);
        const membership = membershipByBookingId.get(String(row.id)) || null;
        const computedRole = computedRoleFor(row, membership, primaryId);
        return {
            bookingId: booking.id,
            role: computedRole,
            membershipRole: membership?.role || (source === BANQUET_GROUP_SOURCE.LEGACY ? 'legacy' : 'manual'),
            isPrimary: String(booking.id) === String(primaryId),
            isKitchenCandidate: isKitchenCandidate(row),
            booking,
            membership,
            technicalChildren: childrenByParent.get(String(booking.id)) || []
        };
    });

    const roleBuckets = {
        primary: members.find(item => item.isPrimary) || null,
        kitchen: members.filter(item => item.role === 'kitchen' || item.isKitchenCandidate),
        activities: members.filter(item => item.role === 'activity'),
        services: members.filter(item => item.role === 'service'),
        manual: members.filter(item => item.role === 'manual')
    };

    const warnings = [];
    if (!schemaAvailable) warnings.push({ code: 'banquet_group_schema_unavailable', message: 'Banquet group schema is not available; legacy links were used if possible.' });
    if (source === BANQUET_GROUP_SOURCE.LEGACY) warnings.push({ code: 'legacy_banquet_links_fallback', message: 'Loaded from legacy booking_banquet_links because no banquet group exists yet.' });
    if (source === BANQUET_GROUP_SOURCE.SINGLE) warnings.push({ code: 'banquet_group_not_found', message: 'Booking is not attached to a banquet group.' });
    if (!roleBuckets.primary) warnings.push({ code: 'primary_booking_missing', message: 'Primary banquet booking could not be determined.' });
    if (!roleBuckets.kitchen.length) warnings.push({ code: 'kitchen_booking_missing', message: 'No kitchen/menu booking was detected for this banquet.' });

    return {
        success: true,
        source,
        legacyFallback: source === BANQUET_GROUP_SOURCE.LEGACY,
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
        group,
        groupId: group?.id || null,
        anchorBookingId: anchorBookingId || null,
        memberships,
        legacyLinks: legacyLinks.map(mapLegacyLinkRow),
        members,
        bookings: {
            primary: roleBuckets.primary?.booking || null,
            kitchen: roleBuckets.kitchen.map(item => item.booking),
            activities: roleBuckets.activities.map(item => item.booking),
            services: roleBuckets.services.map(item => item.booking),
            manual: roleBuckets.manual.map(item => item.booking),
            technicalChildrenByParentId: Object.fromEntries(
                [...childrenByParent.entries()].map(([parentId, children]) => [parentId, children])
            )
        },
        warnings
    };
}

async function loadBanquetGroupById({ db = defaultPool, groupId, businessContext = DEFAULT_TIMELINE_CONTEXT } = {}) {
    const cleanGroupId = cleanId(groupId);
    if (!cleanGroupId) return null;
    const groupResult = await getGroupById(db, cleanGroupId, businessContext);
    if (!groupResult.schemaAvailable || !groupResult.group) {
        return groupResult.schemaAvailable ? null : buildSnapshot({
            source: BANQUET_GROUP_SOURCE.SINGLE,
            businessContext,
            schemaAvailable: false
        });
    }
    const membershipRows = await getMembershipRows(db, groupResult.group.id, businessContext);
    const bookingRows = await getBookingsByIds(db, membershipRows.map(row => row.booking_id), businessContext);
    const rootIds = bookingRows.filter(isRootBooking).map(row => row.id);
    const technicalRows = await getTechnicalChildren(db, rootIds, businessContext);
    return buildSnapshot({
        source: BANQUET_GROUP_SOURCE.GROUP,
        businessContext,
        groupRow: groupResult.group,
        membershipRows,
        bookingRows,
        technicalRows
    });
}

async function loadBanquetGroupByBookingId({ db = defaultPool, bookingId, businessContext = DEFAULT_TIMELINE_CONTEXT } = {}) {
    const cleanBookingId = cleanId(bookingId);
    if (!cleanBookingId) return null;
    const anchorBooking = await getScopedBooking(db, cleanBookingId, businessContext);
    if (!anchorBooking) return null;
    const lookupBookingId = cleanId(anchorBooking.linked_to) || cleanBookingId;
    const lookupBooking = lookupBookingId === cleanBookingId
        ? anchorBooking
        : (await getScopedBooking(db, lookupBookingId, businessContext)) || anchorBooking;

    const groupResult = await findGroupForBooking(db, lookupBookingId, businessContext);
    if (groupResult.group) {
        const snapshot = await loadBanquetGroupById({ db, groupId: groupResult.group.id, businessContext });
        if (snapshot) return { ...snapshot, anchorBookingId: cleanBookingId, anchorRootBookingId: lookupBookingId };
    }

    let connectedLinks = [];
    let schemaAvailable = groupResult.schemaAvailable;
    try {
        connectedLinks = connectedLegacyLinks(await getLegacyBanquetLinks(db, businessContext), lookupBookingId);
    } catch (err) {
        if (!isMissingBanquetSchemaError(err)) throw err;
        schemaAvailable = false;
    }

    if (connectedLinks.length) {
        const ids = legacyBookingIds(lookupBookingId, connectedLinks);
        const bookingRows = await getBookingsByIds(db, ids, businessContext);
        const rootIds = bookingRows.filter(isRootBooking).map(row => row.id);
        const technicalRows = await getTechnicalChildren(db, rootIds, businessContext);
        return buildSnapshot({
            source: BANQUET_GROUP_SOURCE.LEGACY,
            businessContext,
            bookingRows,
            technicalRows,
            legacyLinks: connectedLinks,
            anchorBookingId: cleanBookingId,
            anchorRootBookingId: lookupBookingId,
            schemaAvailable
        });
    }

    const technicalRows = await getTechnicalChildren(db, [lookupBooking.id], businessContext);
    return buildSnapshot({
        source: BANQUET_GROUP_SOURCE.SINGLE,
        businessContext,
        bookingRows: [lookupBooking],
        technicalRows,
        anchorBookingId: cleanBookingId,
        anchorRootBookingId: lookupBookingId,
        schemaAvailable
    });
}

async function createBanquetGroup({
    db = defaultPool,
    primaryBookingId,
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null,
    groupName = null,
    source = 'manual',
    meta = {}
} = {}) {
    const cleanPrimaryId = cleanId(primaryBookingId);
    if (!cleanPrimaryId) {
        throw new BanquetGroupError('primaryBookingId is required', { status: 400, code: 'PRIMARY_BOOKING_REQUIRED' });
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const primary = await getScopedBookingForUpdate(client, cleanPrimaryId, businessContext);
        if (!primary) {
            throw new BanquetGroupError('Primary booking not found', { status: 404, code: 'PRIMARY_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, primary);
        assertRootBooking(primary, 'PRIMARY_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(primary);

        const existing = await getMembershipForBooking(client, cleanPrimaryId, businessContext);
        if (existing) throw duplicateMembershipError(existing);

        const id = generateBanquetGroupId();
        const groupResult = await client.query(
            `INSERT INTO banquet_groups
                (id, business_context, primary_booking_id, customer_id, date, room, group_name, status, source, meta,
                 created_by_user_id, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9::jsonb, $10, $11, $11)
             RETURNING *`,
            [
                id,
                businessContext || DEFAULT_TIMELINE_CONTEXT,
                cleanPrimaryId,
                primary.customer_id || null,
                primary.date,
                primary.room || null,
                normalizeShortText(groupName, 200) || normalizeShortText(primary.group_name, 200) || normalizeShortText(primary.label || primary.program_name, 200),
                normalizeShortText(source, 64) || 'manual',
                JSON.stringify(normalizeMeta(meta)),
                actorUserId(user),
                actorName(user)
            ]
        );
        const membershipResult = await client.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
             VALUES ($1, $2, $3, 'primary', 10, $4, $5)
             RETURNING *`,
            [id, businessContext || DEFAULT_TIMELINE_CONTEXT, cleanPrimaryId, actorUserId(user), actorName(user)]
        );
        await logBanquetHistory(client, businessContext, 'banquet_group_created', user, {
            group_id: id,
            primary_booking_id: cleanPrimaryId,
            booking_id: cleanPrimaryId,
            source: normalizeShortText(source, 64) || 'manual'
        });
        await client.query('COMMIT');
        return {
            success: true,
            group: mapGroupRow(groupResult.rows[0]),
            membership: mapMembershipRow(membershipResult.rows[0])
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err?.code === '23505') {
            throw new BanquetGroupError('Booking is already attached to a banquet group', { status: 409, code: 'BOOKING_ALREADY_IN_GROUP' });
        }
        throw err;
    } finally {
        client.release();
    }
}

async function attachBookingToBanquetGroup({
    db = defaultPool,
    groupId,
    bookingId,
    role = 'manual',
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null,
    label = null,
    sortOrder = null
} = {}) {
    const cleanGroupId = cleanId(groupId);
    const cleanBookingId = cleanId(bookingId);
    const normalizedRole = normalizeWritableRole(role);
    if (!cleanGroupId || !cleanBookingId) {
        throw new BanquetGroupError('groupId and bookingId are required', { status: 400, code: 'GROUP_AND_BOOKING_REQUIRED' });
    }
    if (!normalizedRole) {
        throw new BanquetGroupError('Invalid banquet booking role', { status: 400, code: 'INVALID_BANQUET_ROLE' });
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const group = await getGroupByIdForUpdate(client, cleanGroupId, businessContext);
        if (!group) {
            throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
        }
        const primaryBookingId = cleanId(group.primary_booking_id);
        if (!primaryBookingId) {
            throw new BanquetGroupError('Banquet group has no primary booking', { status: 409, code: 'PRIMARY_BOOKING_MISSING' });
        }

        const primary = await getScopedBookingForUpdate(client, primaryBookingId, businessContext);
        const target = await getScopedBookingForUpdate(client, cleanBookingId, businessContext);
        if (!target) {
            throw new BanquetGroupError('Booking not found', { status: 404, code: 'BOOKING_NOT_FOUND' });
        }
        if (!primary) {
            throw new BanquetGroupError('Primary booking not found', { status: 409, code: 'PRIMARY_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, primary);
        assertEditableBooking(user, target);
        assertRootBooking(target);
        assertActiveBooking(target);
        if (cleanBookingId === primaryBookingId) {
            throw new BanquetGroupError('Primary booking is already in this banquet group', { status: 409, code: 'BOOKING_ALREADY_IN_GROUP' });
        }

        const existing = await getMembershipForBooking(client, cleanBookingId, businessContext);
        if (existing) throw duplicateMembershipError(existing, cleanGroupId);

        const order = Number.isInteger(Number(sortOrder)) ? Number(sortOrder) : 100;
        const membershipResult = await client.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                cleanGroupId,
                businessContext || DEFAULT_TIMELINE_CONTEXT,
                cleanBookingId,
                normalizedRole,
                order,
                actorUserId(user),
                actorName(user)
            ]
        );
        const link = await upsertCompatibilityLink(
            client,
            businessContext,
            primaryBookingId,
            cleanBookingId,
            label || group.group_name || target.group_name || target.label || target.program_name,
            user
        );
        await logBanquetHistory(client, businessContext, 'banquet_group_booking_attached', user, {
            group_id: cleanGroupId,
            primary_booking_id: primaryBookingId,
            booking_id: cleanBookingId,
            role: normalizedRole,
            compatibility_link_id: link?.id || null
        });
        await client.query('COMMIT');
        return {
            success: true,
            group: mapGroupRow(group),
            membership: mapMembershipRow(membershipResult.rows[0]),
            compatibilityLink: mapLegacyLinkRow({
                ...link,
                business_context: businessContext || DEFAULT_TIMELINE_CONTEXT
            })
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err?.code === '23505') {
            throw new BanquetGroupError('Booking is already attached to a banquet group', { status: 409, code: 'BOOKING_ALREADY_IN_GROUP' });
        }
        throw err;
    } finally {
        client.release();
    }
}

async function detachBookingFromBanquetGroup({
    db = defaultPool,
    groupId,
    bookingId,
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null
} = {}) {
    const cleanGroupId = cleanId(groupId);
    const cleanBookingId = cleanId(bookingId);
    if (!cleanGroupId || !cleanBookingId) {
        throw new BanquetGroupError('groupId and bookingId are required', { status: 400, code: 'GROUP_AND_BOOKING_REQUIRED' });
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const group = await getGroupByIdForUpdate(client, cleanGroupId, businessContext);
        if (!group) {
            throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
        }
        const membership = await getMembershipInGroup(client, cleanGroupId, cleanBookingId, businessContext);
        if (!membership) {
            throw new BanquetGroupError('Booking membership not found', { status: 404, code: 'BANQUET_MEMBERSHIP_NOT_FOUND' });
        }
        const primaryBookingId = cleanId(group.primary_booking_id);
        if (membership.role === 'primary' || cleanBookingId === primaryBookingId) {
            throw new BanquetGroupError('Primary booking cannot be detached without selecting a new primary booking', { status: 400, code: 'CANNOT_DETACH_PRIMARY' });
        }
        const primary = primaryBookingId ? await getScopedBookingForUpdate(client, primaryBookingId, businessContext) : null;
        const target = await getScopedBookingForUpdate(client, cleanBookingId, businessContext);
        if (primary) assertEditableBooking(user, primary);
        if (target) assertEditableBooking(user, target);

        await client.query(
            `DELETE FROM banquet_group_bookings
              WHERE group_id = $1
                AND booking_id = $2
                AND ${bookingContextSql('', '$3')}`,
            [cleanGroupId, cleanBookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
        );
        const deletedLink = primaryBookingId
            ? await deleteCompatibilityLink(client, businessContext, primaryBookingId, cleanBookingId)
            : null;
        await logBanquetHistory(client, businessContext, 'banquet_group_booking_detached', user, {
            group_id: cleanGroupId,
            primary_booking_id: primaryBookingId,
            booking_id: cleanBookingId,
            role: membership.role || null,
            compatibility_link_deleted: Boolean(deletedLink)
        });
        await client.query('COMMIT');
        return {
            success: true,
            removed: true,
            group: mapGroupRow(group),
            membership: mapMembershipRow(membership),
            compatibilityLinkRemoved: Boolean(deletedLink)
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function createActivityBookingInBanquetGroup({
    db = defaultPool,
    groupId,
    sourceBookingId,
    activityBooking,
    linkedBookings = [],
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null
} = {}) {
    const cleanGroupId = cleanId(groupId);
    const cleanSourceId = cleanId(sourceBookingId);
    if (!cleanGroupId) {
        throw new BanquetGroupError('groupId is required', { status: 400, code: 'GROUP_ID_REQUIRED' });
    }
    if (!cleanSourceId) {
        throw new BanquetGroupError('sourceBookingId is required', { status: 400, code: 'SOURCE_BOOKING_REQUIRED' });
    }
    if (!activityBooking || typeof activityBooking !== 'object') {
        throw new BanquetGroupError('activity booking payload is required', { status: 400, code: 'ACTIVITY_BOOKING_REQUIRED' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const group = await getGroupByIdForUpdate(client, cleanGroupId, businessContext);
        if (!group) {
            throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
        }
        if (String(group.status || 'active').toLowerCase() !== 'active') {
            throw new BanquetGroupError('Banquet group is not active', { status: 409, code: 'BANQUET_GROUP_INACTIVE' });
        }
        const primaryBookingId = cleanId(group.primary_booking_id);
        if (!primaryBookingId) {
            throw new BanquetGroupError('Banquet group has no primary booking', { status: 409, code: 'PRIMARY_BOOKING_MISSING' });
        }

        const source = await getScopedBookingForUpdate(client, cleanSourceId, businessContext);
        if (!source) {
            throw new BanquetGroupError('Source booking not found', { status: 404, code: 'SOURCE_BOOKING_NOT_FOUND' });
        }
        const primary = cleanSourceId === primaryBookingId
            ? source
            : await getScopedBookingForUpdate(client, primaryBookingId, businessContext);
        if (!primary) {
            throw new BanquetGroupError('Primary booking not found', { status: 409, code: 'PRIMARY_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, source);
        assertEditableBooking(user, primary);
        assertRootBooking(source, 'SOURCE_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(source);
        assertActiveBooking(primary);

        const sourceMembership = await getMembershipInGroup(client, cleanGroupId, cleanSourceId, businessContext);
        if (!sourceMembership && cleanSourceId !== primaryBookingId) {
            throw new BanquetGroupError('Source booking is not attached to this banquet group', {
                status: 409,
                code: 'SOURCE_BOOKING_NOT_IN_GROUP',
                details: { groupId: cleanGroupId, sourceBookingId: cleanSourceId }
            });
        }

        const rootActivity = normalizeRootActivityBooking(activityBooking, {
            sourceBooking: source,
            group,
            businessContext,
            user
        });
        assertCreateActivityPayload(rootActivity);
        await assertActivitySlotAvailable(client, rootActivity, businessContext, { sourceBookingId: cleanSourceId });

        const activityRow = await insertRootActivityBooking(client, rootActivity, businessContext);
        const linkedRows = [];
        for (const item of Array.isArray(linkedBookings) ? linkedBookings : []) {
            const child = normalizeLinkedActivityBooking(item, { ...rootActivity, id: activityRow.id }, { businessContext, user });
            assertCreateActivityPayload(child);
            const childConflict = await checkServerConflicts(client, child.date, child.lineId, child.time, child.duration || 0, null, businessContext);
            if (childConflict.overlap) {
                throw new BanquetGroupError('Linked activity line slot is busy', {
                    status: 409,
                    code: 'LINKED_ACTIVITY_LINE_CONFLICT',
                    details: {
                        conflictBookingId: childConflict.conflictWith?.id || null,
                        time: childConflict.conflictWith?.time || null
                    }
                });
            }
            const childRow = await insertLinkedActivityChildBooking(client, child, activityRow.id, businessContext);
            if (childRow) linkedRows.push(childRow);
        }

        const membershipResult = await client.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
             VALUES ($1, $2, $3, 'activity', 100, $4, $5)
             RETURNING *`,
            [
                cleanGroupId,
                businessContext || DEFAULT_TIMELINE_CONTEXT,
                activityRow.id,
                actorUserId(user),
                actorName(user)
            ]
        );
        const link = await upsertCompatibilityLink(
            client,
            businessContext,
            primaryBookingId,
            activityRow.id,
            group.group_name || rootActivity.groupName || rootActivity.programName,
            user
        );
        await client.query(
            `UPDATE banquet_groups
                SET updated_at = NOW(), updated_by = $3
              WHERE id = $1
                AND ${bookingContextSql('', '$2')}`,
            [cleanGroupId, businessContext || DEFAULT_TIMELINE_CONTEXT, actorName(user)]
        );

        await logBanquetHistory(client, businessContext, 'create', user, mapBookingRow(activityRow));
        await logBanquetHistory(client, businessContext, 'banquet_group_activity_booking_created', user, {
            group_id: cleanGroupId,
            source_booking_id: cleanSourceId,
            primary_booking_id: primaryBookingId,
            booking_id: activityRow.id,
            linked_booking_ids: linkedRows.map(row => row.id),
            compatibility_link_id: link?.id || null
        });

        const snapshot = await loadBanquetGroupById({ db: client, groupId: cleanGroupId, businessContext });
        await client.query('COMMIT');

        const booking = mapBookingRow(activityRow);
        booking.serverVerified = true;
        const mappedLinked = linkedRows.map(row => {
            const mapped = mapBookingRow(row);
            mapped.serverVerified = true;
            return mapped;
        });
        return {
            success: true,
            booking,
            linkedBookings: mappedLinked,
            group: mapGroupRow(group),
            membership: mapMembershipRow(membershipResult.rows[0]),
            compatibilityLink: mapLegacyLinkRow({
                ...link,
                business_context: businessContext || DEFAULT_TIMELINE_CONTEXT
            }),
            banquetGroup: snapshot,
            serverVerified: true
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err?.code === '23505') {
            throw new BanquetGroupError('Booking is already attached to a banquet group', { status: 409, code: 'BOOKING_ALREADY_IN_GROUP' });
        }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    BanquetGroupError,
    BANQUET_GROUP_SOURCE,
    attachBookingToBanquetGroup,
    createActivityBookingInBanquetGroup,
    createBanquetGroup,
    detachBookingFromBanquetGroup,
    loadBanquetGroupByBookingId,
    loadBanquetGroupById,
    isKitchenCandidate
};
