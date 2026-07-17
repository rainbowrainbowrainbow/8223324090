'use strict';

const crypto = require('crypto');
const { pool: defaultPool, generateBookingNumber } = require('../db');
const {
    checkRoomConflict,
    checkServerConflicts,
    checkServerDuplicate,
    mapBookingRow,
    normalizeBookingStatus,
    BANQUET_SERVICE_LINE_ID,
    isLineConflictBlockingLine,
    isRoomConflictBlockingRoom,
    timeToMinutes,
    validateDate,
    validateTime,
    validateBanquetCreationContext
} = require('./booking');
const { DEFAULT_TIMELINE_CONTEXT } = require('./timelineContext');
const { canEditBooking } = require('./bookingVisibility');
const { insertHistory } = require('./historyLog');
const { applyBookingPackage, applyBookingPackageEntryCharge } = require('./bookingPackage');
const { normalizePinataFields } = require('./pinataMode');
const { applyEffectiveBookingPrice } = require('./productPricing');
const { upsertManagerBookingDeposit } = require('./banquetDeposits');
const { broadcastBanquetEvent = () => 0 } = require('./websocket');
const { normalizeCustomerSource } = require('./customerSource');

const BANQUET_LINK_RELATION_TYPE = 'banquet_activity';
const WRITABLE_MEMBER_ROLES = new Set(['kitchen', 'activity', 'service', 'manual']);
const ATOMIC_MEMBER_BOOKING_ROLES = new Set(['kitchen', 'service', 'manual']);
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

function bookingActiveStatusSql(alias = '') {
    const column = alias ? `${alias}.status` : 'status';
    return `LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), 'confirmed')) != 'cancelled'`;
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

function timestampIso(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function normalizeAtomicMemberBookingRole(value) {
    const role = String(value || 'kitchen').trim().toLowerCase();
    return ATOMIC_MEMBER_BOOKING_ROLES.has(role) ? role : null;
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

function bookingPackageFromRow(row = {}) {
    const extra = parseExtraData(row);
    return row.bookingPackage
        || row.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
}

function hasNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

function packageArray(bookingPackage, camelKey, snakeKey) {
    return bookingPackage?.[camelKey] || bookingPackage?.[snakeKey] || [];
}

function menuPositionCount(row = {}) {
    const bookingPackage = bookingPackageFromRow(row);
    const positions = bookingPackage.menuPositions || bookingPackage.menu_positions || [];
    return Array.isArray(positions) ? positions.length : 0;
}

function bookingPackageHasBanquetData(row = {}) {
    const bookingPackage = bookingPackageFromRow(row);
    if (!bookingPackage || typeof bookingPackage !== 'object') return false;
    const positions = packageArray(bookingPackage, 'menuPositions', 'menu_positions');
    const serviceEvents = packageArray(bookingPackage, 'serviceEvents', 'service_events');
    return hasNonEmptyArray(positions) || hasNonEmptyArray(serviceEvents);
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

function isActiveBookingRow(row = {}) {
    return String(row.status || 'confirmed').trim().toLowerCase() !== 'cancelled';
}

function isBanquetServiceLine(row = {}) {
    return cleanId(row.line_id || row.lineId) === BANQUET_SERVICE_LINE_ID;
}

function normalizedBookingCategory(row = {}) {
    return String(row.category || row.bookingCategory || '').trim().toLowerCase();
}

function hasActivityCategory(row = {}) {
    return ['activity', 'animation', 'show', 'quest', 'masterclass', 'pinata', 'photo', 'graduation']
        .includes(normalizedBookingCategory(row));
}

function hasActivityProgramSignal(row = {}) {
    return Boolean(
        row.program_id
        || row.programId
        || String(row.program_name || row.programName || '').trim()
        || String(row.program_code || row.programCode || '').trim()
        || Number(row.price || 0) > 0
    );
}

function textMatchesBanquetIdentity(row = {}) {
    const text = [
        row.category,
        row.label,
        row.program_name,
        row.programName,
        row.program_code,
        row.programCode,
        row.group_name,
        row.groupName
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean).join(' ');
    return /\b(banquet|kitchen)\b|банкет|кух/i.test(text);
}

function isBanquetAnchor(row = {}) {
    return isRootBooking(row)
        && isActiveBookingRow(row)
        && (
            isBanquetServiceLine(row)
            || isKitchenCandidate(row)
            || bookingPackageHasBanquetData(row)
            || normalizedBookingCategory(row) === 'banquet'
            || textMatchesBanquetIdentity(row)
        );
}

function isBanquetActivityCandidate(row = {}) {
    if (isBanquetServiceLine(row)) return false;
    if (hasActivityCategory(row)) return true;
    if (isKitchenCandidate(row)) return false;
    return hasActivityProgramSignal(row);
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
        guestArrivalTime: row.guest_arrival_time || null,
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

function normalizeRoleList(value) {
    const roles = Array.isArray(value)
        ? value
        : String(value || '')
            .replace(/^\{|\}$/g, '')
            .split(',');
    return [...new Set(roles.map(role => String(role || '').trim()).filter(Boolean))].sort();
}

function mapBanquetGroupCandidateRow(row = {}) {
    const group = mapGroupRow(row);
    if (!group) return null;
    const primaryBooking = row.primary_booking_row_id
        ? {
            id: row.primary_booking_row_id,
            businessContext: row.primary_booking_business_context || group.businessContext,
            date: row.primary_booking_date || group.date,
            time: row.primary_booking_time || null,
            room: row.primary_booking_room || group.room,
            label: row.primary_booking_label || null,
            programName: row.primary_booking_program_name || null,
            lineId: row.primary_booking_line_id || null,
            secondAnimator: row.primary_booking_second_animator || null,
            createdBy: row.primary_booking_created_by || null,
            customerId: row.primary_booking_customer_id || group.customerId,
            status: row.primary_booking_status || 'confirmed'
        }
        : null;
    return {
        groupId: group.id,
        groupName: group.groupName,
        primaryBookingId: group.primaryBookingId,
        room: group.room,
        date: group.date,
        businessContext: group.businessContext,
        customerId: group.customerId,
        status: group.status,
        source: group.source,
        roles: normalizeRoleList(row.roles),
        memberCount: Number(row.member_count || 0),
        candidateKind: row.candidate_kind || 'customer',
        primaryBooking
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

async function loadBanquetGroupCandidates({
    db = defaultPool,
    date,
    customerId,
    businessContext = DEFAULT_TIMELINE_CONTEXT
} = {}) {
    const cleanDate = String(date || '').slice(0, 10);
    const normalizedCustomerId = Number(customerId);
    if (!cleanDate || !Number.isInteger(normalizedCustomerId) || normalizedCustomerId <= 0) {
        return {
            success: true,
            businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
            date: cleanDate || null,
            customerId: Number.isInteger(normalizedCustomerId) && normalizedCustomerId > 0 ? normalizedCustomerId : null,
            candidates: [],
            fallbackCandidates: [],
            schemaAvailable: true,
            warnings: []
        };
    }

    try {
        const result = await db.query(
            `SELECT bg.*,
                    CASE WHEN bg.customer_id = $3 THEN 'customer' ELSE 'unassigned' END AS candidate_kind,
                    COALESCE(member_state.roles, ARRAY[]::text[]) AS roles,
                    COALESCE(member_state.member_count, 0)::int AS member_count,
                    pb.id AS primary_booking_row_id,
                    pb.business_context AS primary_booking_business_context,
                    pb.date AS primary_booking_date,
                    pb.time AS primary_booking_time,
                    pb.room AS primary_booking_room,
                    pb.label AS primary_booking_label,
                    pb.program_name AS primary_booking_program_name,
                    pb.line_id AS primary_booking_line_id,
                    pb.second_animator AS primary_booking_second_animator,
                    pb.created_by AS primary_booking_created_by,
                    pb.customer_id AS primary_booking_customer_id,
                    pb.status AS primary_booking_status
               FROM banquet_groups bg
               LEFT JOIN LATERAL (
                    SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT bgb.role ORDER BY bgb.role), NULL) AS roles,
                           COUNT(DISTINCT bgb.booking_id)::int AS member_count
                      FROM banquet_group_bookings bgb
                     WHERE bgb.group_id = bg.id
                       AND ${bookingContextSql('bgb', '$1')}
               ) member_state ON true
               LEFT JOIN bookings pb ON pb.id = bg.primary_booking_id
                    AND ${bookingContextSql('pb', '$1')}
                    AND ${bookingActiveStatusSql('pb')}
              WHERE ${bookingContextSql('bg', '$1')}
                AND bg.date = $2
                AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) = 'active'
                AND (bg.customer_id = $3 OR bg.customer_id IS NULL)
              ORDER BY
                    CASE WHEN bg.customer_id = $3 THEN 0 ELSE 1 END ASC,
                    COALESCE(pb.time, '99:99') ASC,
                    COALESCE(bg.room, '') ASC,
                    bg.created_at ASC,
                    bg.id ASC`,
            [businessContext || DEFAULT_TIMELINE_CONTEXT, cleanDate, normalizedCustomerId]
        );
        const mapped = (result.rows || []).map(mapBanquetGroupCandidateRow).filter(Boolean);
        return {
            success: true,
            businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
            date: cleanDate,
            customerId: normalizedCustomerId,
            candidates: mapped.filter(candidate => candidate.candidateKind === 'customer'),
            fallbackCandidates: mapped.filter(candidate => candidate.candidateKind !== 'customer'),
            schemaAvailable: true,
            warnings: []
        };
    } catch (err) {
        if (!isMissingBanquetSchemaError(err)) throw err;
        return {
            success: true,
            businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
            date: cleanDate,
            customerId: normalizedCustomerId,
            candidates: [],
            fallbackCandidates: [],
            schemaAvailable: false,
            warnings: [{
                code: 'banquet_group_schema_unavailable',
                message: 'Banquet group schema is not available.'
            }]
        };
    }
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

async function getGroupByPrimaryBookingForUpdate(db, primaryBookingId, businessContext) {
    const result = await db.query(
        `SELECT bg.*
           FROM banquet_groups bg
          WHERE bg.primary_booking_id = $1
            AND ${bookingContextSql('bg', '$2')}
          ORDER BY bg.created_at ASC, bg.id ASC
          LIMIT 1
          FOR UPDATE`,
        [primaryBookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
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

async function getMembershipRowsForUpdate(db, groupId, businessContext) {
    const result = await db.query(
        `SELECT bgb.*
           FROM banquet_group_bookings bgb
          WHERE bgb.group_id = $1
            AND ${bookingContextSql('bgb', '$2')}
          ORDER BY bgb.sort_order ASC, bgb.id ASC
          FOR UPDATE`,
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
             AND ${bookingActiveStatusSql('b')}
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

async function getTechnicalChildrenForUpdate(db, rootIds, businessContext) {
    const uniqueIds = [...new Set((rootIds || []).map(cleanId).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const result = await db.query(
        `SELECT b.*
           FROM bookings b
          WHERE NULLIF(COALESCE(b.linked_to, ''), '') = ANY($1::text[])
            AND ${bookingContextSql('b', '$2')}
          ORDER BY b.date ASC, b.time ASC, b.id ASC
          FOR UPDATE`,
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
    await db.query(
        `DELETE FROM booking_banquet_links
          WHERE business_context = $1
            AND booking_a_id = $3
            AND booking_b_id = $2
            AND relation_type = $4`,
        [
            businessContext || DEFAULT_TIMELINE_CONTEXT,
            pair[0],
            pair[1],
            BANQUET_LINK_RELATION_TYPE
        ]
    );
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

function banquetAutoGroupSkip(bookingId, businessContext, reason, details = {}) {
    return {
        success: true,
        reconciled: false,
        skipped: true,
        reason,
        bookingId: cleanId(bookingId),
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
        group: null,
        groupId: null,
        primaryBookingId: null,
        candidateBookingIds: [],
        attachedBookingIds: [],
        createdGroup: false,
        ...details
    };
}

function autoGroupCustomerId(row = {}) {
    const value = row.customer_id ?? row.customerId;
    if (value === undefined || value === null || value === '') return null;
    return value;
}

function autoGroupRoom(row = {}) {
    return normalizeShortText(row.room || row.resourceName || row.displayName, 100);
}

function autoGroupDate(row = {}) {
    return String(row.date || '').slice(0, 10);
}

function hasAutoGroupMatchKey(row = {}) {
    return Boolean(autoGroupDate(row) && autoGroupRoom(row) && autoGroupCustomerId(row) !== null);
}

function selectBanquetAutoGroupPrimary(candidates = [], anchorBookingId = null) {
    const roots = candidates.filter(row => isRootBooking(row) && isActiveBookingRow(row));
    const byTime = [...roots].sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
    return byTime.find(isBanquetServiceLine)
        || byTime.find(isKitchenCandidate)
        || byTime.find(bookingPackageHasBanquetData)
        || byTime.find(row => normalizedBookingCategory(row) === 'banquet')
        || byTime.find(row => cleanId(row.id) === cleanId(anchorBookingId) && isBanquetAnchor(row))
        || byTime.find(isBanquetAnchor)
        || byTime[0]
        || null;
}

function banquetAutoGroupRoleFor(row = {}, primaryBookingId = null) {
    if (cleanId(row.id) === cleanId(primaryBookingId)) return 'primary';
    if (isBanquetActivityCandidate(row)) return 'activity';
    if (isKitchenCandidate(row) || bookingPackageHasBanquetData(row)) return 'kitchen';
    if (isBanquetServiceLine(row)) return 'service';
    return 'manual';
}

function banquetAutoGroupSortOrderFor(row = {}, role = 'manual') {
    const base = role === 'primary'
        ? 10
        : role === 'kitchen'
            ? 30
            : role === 'activity'
                ? 100
                : role === 'service'
                    ? 120
                    : 140;
    const [hours, minutes] = String(row.time || '').slice(0, 5).split(':').map(value => Number(value));
    const timeOffset = Number.isFinite(hours) && Number.isFinite(minutes) ? Math.min(89, Math.floor(((hours * 60) + minutes) / 20)) : 0;
    return base + timeOffset;
}

function memberBookingSortOrderFor(role = 'manual') {
    if (role === 'kitchen') return 30;
    if (role === 'service') return 120;
    return 140;
}

function autoGroupLabel(row = {}) {
    return normalizeShortText(row.group_name || row.groupName || row.label || row.program_name || row.programName, 200);
}

async function getBanquetAutoGroupCandidates(db, anchor, businessContext) {
    if (!hasAutoGroupMatchKey(anchor)) return [];
    const result = await db.query(
        `SELECT b.*
           FROM bookings b
          WHERE ${bookingContextSql('b', '$1')}
            AND b.date = $2
            AND NULLIF(BTRIM(COALESCE(b.room, '')), '') = $3
            AND b.customer_id = $4
            AND ${bookingActiveStatusSql('b')}
            AND NULLIF(COALESCE(b.linked_to, ''), '') IS NULL
          ORDER BY
            CASE
              WHEN b.line_id = $5 THEN 0
              ELSE 2
            END ASC,
            b.time ASC,
            b.id ASC
          FOR UPDATE`,
        [
            businessContext || DEFAULT_TIMELINE_CONTEXT,
            autoGroupDate(anchor),
            autoGroupRoom(anchor),
            autoGroupCustomerId(anchor),
            BANQUET_SERVICE_LINE_ID
        ]
    );
    return result.rows || [];
}

async function getMembershipRowsForBookings(db, bookingIds, businessContext) {
    const uniqueIds = [...new Set((bookingIds || []).map(cleanId).filter(Boolean))];
    if (!uniqueIds.length) return [];
    const result = await db.query(
        `SELECT bgb.id, bgb.group_id, bgb.business_context, bgb.booking_id, bgb.role, bgb.sort_order,
                bgb.created_by_user_id, bgb.created_by, bgb.created_at, bgb.updated_at,
                bg.primary_booking_id, bg.status AS group_status
           FROM banquet_group_bookings bgb
           JOIN banquet_groups bg ON bg.id = bgb.group_id
          WHERE bgb.booking_id = ANY($1::text[])
            AND ${bookingContextSql('bgb', '$2')}
            AND ${bookingContextSql('bg', '$2')}
          FOR UPDATE OF bgb, bg`,
        [uniqueIds, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows || [];
}

async function insertBanquetAutoGroupMembership(db, {
    groupId,
    businessContext,
    bookingId,
    role,
    sortOrder,
    user
}) {
    const result = await db.query(
        `INSERT INTO banquet_group_bookings
            (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
            groupId,
            businessContext || DEFAULT_TIMELINE_CONTEXT,
            bookingId,
            role,
            sortOrder,
            actorUserId(user),
            actorName(user)
        ]
    );
    return result.rows[0] || null;
}

async function reconcileBanquetGroupForBooking({
    db = defaultPool,
    bookingId,
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null,
    source = 'auto_same_customer_room'
} = {}) {
    const cleanBookingId = cleanId(bookingId);
    const context = businessContext || DEFAULT_TIMELINE_CONTEXT;
    if (!cleanBookingId) return banquetAutoGroupSkip(null, context, 'missing_booking_id');

    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const anchor = await getScopedBookingForUpdate(client, cleanBookingId, context);
        if (!anchor) {
            await client.query('ROLLBACK');
            return banquetAutoGroupSkip(cleanBookingId, context, 'booking_not_found');
        }
        if (!isRootBooking(anchor)) {
            await client.query('ROLLBACK');
            return banquetAutoGroupSkip(cleanBookingId, context, 'linked_child_booking');
        }
        if (!isActiveBookingRow(anchor)) {
            await client.query('ROLLBACK');
            return banquetAutoGroupSkip(cleanBookingId, context, 'cancelled_booking');
        }
        if (!hasAutoGroupMatchKey(anchor)) {
            await client.query('ROLLBACK');
            return banquetAutoGroupSkip(cleanBookingId, context, 'missing_date_room_or_customer');
        }

        const candidates = await getBanquetAutoGroupCandidates(client, anchor, context);
        const candidateBookingIds = candidates.map(row => cleanId(row.id)).filter(Boolean);
        if (candidates.length < 2) {
            await client.query('ROLLBACK');
            return banquetAutoGroupSkip(cleanBookingId, context, 'not_enough_candidates', { candidateBookingIds });
        }

        const memberships = await getMembershipRowsForBookings(client, candidateBookingIds, context);
        const groupIds = [...new Set(memberships.map(row => cleanId(row.group_id)).filter(Boolean))];
        if (groupIds.length > 1) {
            await client.query('ROLLBACK');
            return banquetAutoGroupSkip(cleanBookingId, context, 'multiple_existing_groups', {
                candidateBookingIds,
                existingGroupIds: groupIds
            });
        }
        if (!candidates.some(isBanquetAnchor) && groupIds.length !== 1) {
            await client.query('ROLLBACK');
            return banquetAutoGroupSkip(cleanBookingId, context, 'missing_banquet_anchor', { candidateBookingIds });
        }

        let group = null;
        let primary = null;
        let createdGroup = false;
        const membershipByBookingId = new Map(memberships.map(row => [cleanId(row.booking_id), row]));

        if (groupIds.length === 1) {
            group = await getGroupByIdForUpdate(client, groupIds[0], context);
            if (!group || String(group.status || 'active').toLowerCase() !== 'active') {
                await client.query('ROLLBACK');
                return banquetAutoGroupSkip(cleanBookingId, context, 'existing_group_not_active', {
                    candidateBookingIds,
                    existingGroupIds: groupIds
                });
            }
            primary = candidates.find(row => cleanId(row.id) === cleanId(group.primary_booking_id)) || null;
            if (!primary) {
                await client.query('ROLLBACK');
                return banquetAutoGroupSkip(cleanBookingId, context, 'existing_primary_outside_candidate_set', {
                    candidateBookingIds,
                    groupId: cleanId(group.id),
                    primaryBookingId: cleanId(group.primary_booking_id)
                });
            }
        } else {
            primary = selectBanquetAutoGroupPrimary(candidates, cleanBookingId);
            if (!primary || !isBanquetAnchor(primary)) {
                await client.query('ROLLBACK');
                return banquetAutoGroupSkip(cleanBookingId, context, 'primary_anchor_not_found', { candidateBookingIds });
            }
            const groupId = generateBanquetGroupId();
            const guestArrivalTime = normalizeGuestArrivalTime(primary.time);
            if (!guestArrivalTime) {
                await client.query('ROLLBACK');
                return banquetAutoGroupSkip(cleanBookingId, context, 'primary_arrival_time_invalid', {
                    candidateBookingIds,
                    primaryBookingId: cleanId(primary.id)
                });
            }
            const groupResult = await client.query(
                `INSERT INTO banquet_groups
                    (id, business_context, primary_booking_id, customer_id, date, room, guest_arrival_time, group_name, status, source, meta,
                     created_by_user_id, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10::jsonb, $11, $12, $12)
                 RETURNING *`,
                [
                    groupId,
                    context,
                    primary.id,
                    autoGroupCustomerId(primary),
                    autoGroupDate(primary),
                    autoGroupRoom(primary),
                    guestArrivalTime,
                    autoGroupLabel(primary) || autoGroupLabel(anchor),
                    normalizeShortText(source, 64) || 'auto_same_customer_room',
                    JSON.stringify({
                        autoGrouped: true,
                        rule: 'business_context_date_room_customer_anchor',
                        anchorBookingId: cleanBookingId,
                        candidateBookingIds
                    }),
                    actorUserId(user),
                    actorName(user)
                ]
            );
            group = groupResult.rows[0];
            createdGroup = true;
        }

        const groupId = cleanId(group.id);
        const primaryBookingId = cleanId(primary.id || group.primary_booking_id);
        const attachedBookingIds = [];

        for (const candidate of candidates) {
            const candidateId = cleanId(candidate.id);
            if (!candidateId) continue;
            const existing = membershipByBookingId.get(candidateId);
            const role = banquetAutoGroupRoleFor(candidate, primaryBookingId);
            if (!existing) {
                const membership = await insertBanquetAutoGroupMembership(client, {
                    groupId,
                    businessContext: context,
                    bookingId: candidateId,
                    role,
                    sortOrder: banquetAutoGroupSortOrderFor(candidate, role),
                    user
                });
                if (membership) {
                    membershipByBookingId.set(candidateId, membership);
                    attachedBookingIds.push(candidateId);
                }
            }
            if (candidateId !== primaryBookingId) {
                await upsertCompatibilityLink(
                    client,
                    context,
                    primaryBookingId,
                    candidateId,
                    autoGroupLabel(group) || autoGroupLabel(candidate) || autoGroupLabel(primary),
                    user
                );
            }
        }

        if (createdGroup || attachedBookingIds.length) {
            await client.query(
                `UPDATE banquet_groups
                    SET updated_at = NOW(), updated_by = $3
                  WHERE id = $1
                    AND ${bookingContextSql('', '$2')}`,
                [groupId, context, actorName(user)]
            );
            await logBanquetHistory(client, context, 'banquet_group_auto_reconciled', user, {
                group_id: groupId,
                primary_booking_id: primaryBookingId,
                anchor_booking_id: cleanBookingId,
                candidate_booking_ids: candidateBookingIds,
                attached_booking_ids: attachedBookingIds,
                created_group: createdGroup,
                source: normalizeShortText(source, 64) || 'auto_same_customer_room'
            });
        }

        await client.query('COMMIT');
        return {
            success: true,
            reconciled: true,
            skipped: false,
            reason: null,
            bookingId: cleanBookingId,
            businessContext: context,
            group: mapGroupRow(group),
            groupId,
            primaryBookingId,
            candidateBookingIds,
            attachedBookingIds,
            createdGroup
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isMissingBanquetSchemaError(err)) {
            return banquetAutoGroupSkip(cleanBookingId, context, 'banquet_group_schema_missing');
        }
        throw err;
    } finally {
        client.release();
    }
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

function resolveAtomicBanquetCustomerId(input = {}, { sourceBooking, group } = {}) {
    const requestedCustomerId = normalizeActivityInteger(input.customerId ?? input.customer_id, null);
    const authorityCustomerId = normalizeActivityInteger(group?.customer_id ?? group?.customerId ?? sourceBooking?.customer_id ?? sourceBooking?.customerId, null);
    if (requestedCustomerId && authorityCustomerId && requestedCustomerId !== authorityCustomerId) {
        throw new BanquetGroupError('Клієнт бронювання не збігається з клієнтом банкету.', {
            status: 409,
            code: 'CUSTOMER_BANQUET_MISMATCH',
            details: {
                customerId: requestedCustomerId,
                banquetCustomerId: authorityCustomerId,
                groupId: group?.id || null,
                sourceBookingId: sourceBooking?.id || null
            }
        });
    }
    return authorityCustomerId ?? requestedCustomerId ?? null;
}

async function resolveBookingSetPrimaryCustomerId(db, primaryPatch = {}, {
    primaryBooking,
    group,
    businessContext
} = {}) {
    const requestedCustomerId = normalizeActivityInteger(primaryPatch.customerId ?? primaryPatch.customer_id, null);
    const authorityCustomerId = normalizeActivityInteger(
        group?.customer_id ?? group?.customerId ?? primaryBooking?.customer_id ?? primaryBooking?.customerId,
        null
    );
    const resolvedExistingId = resolveAtomicBanquetCustomerId(primaryPatch, {
        sourceBooking: primaryBooking,
        group
    });
    if (requestedCustomerId) {
        const scopedCustomer = await db.query(
            `SELECT id FROM customers
              WHERE id = $1
                AND ${bookingContextSql('', '$2')}
              LIMIT 1`,
            [requestedCustomerId, businessContext || DEFAULT_TIMELINE_CONTEXT]
        );
        if (!scopedCustomer.rows.length) {
            throw new BanquetGroupError('Customer does not belong to this business context', {
                status: 400,
                code: 'BANQUET_CUSTOMER_NOT_FOUND'
            });
        }
        return resolvedExistingId;
    }

    const customer = primaryPatch.customer;
    if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
        return resolvedExistingId;
    }
    if (authorityCustomerId) {
        throw new BanquetGroupError('Banquet already has a customer; use its customerId when editing', {
            status: 409,
            code: 'CUSTOMER_BANQUET_MISMATCH',
            details: { banquetCustomerId: authorityCustomerId, groupId: group?.id || null }
        });
    }

    const name = normalizeActivityText(customer.name, 200);
    if (!name) {
        throw new BanquetGroupError('Customer name is required', {
            status: 400,
            code: 'BANQUET_CUSTOMER_NAME_REQUIRED'
        });
    }
    const context = businessContext || DEFAULT_TIMELINE_CONTEXT;
    const phone = normalizeActivityText(customer.phone, 100);
    if (phone) {
        const existing = await db.query(
            `SELECT id FROM customers
              WHERE phone = $1
                AND ${bookingContextSql('', '$2')}
              LIMIT 1
              FOR UPDATE`,
            [phone, context]
        );
        if (existing.rows.length) return normalizeActivityInteger(existing.rows[0].id, null);
    }

    const inserted = await db.query(
        `INSERT INTO customers
            (business_context, name, phone, instagram, child_name, child_birthday, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
            context,
            name,
            phone,
            normalizeActivityText(customer.instagram, 200),
            normalizeActivityText(customer.childName ?? customer.child_name, 200),
            normalizeActivityText(customer.childBirthday ?? customer.child_birthday, 20),
            normalizeCustomerSource(customer.source)
        ]
    );
    return normalizeActivityInteger(inserted.rows[0]?.id, null);
}

function normalizeActivityText(value, maxLength = 2000) {
    const text = String(value || '').trim();
    return text ? text.slice(0, maxLength) : null;
}

function normalizeActivityExtraData(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return JSON.stringify(value);
}

function managerDepositPayloadFromBookingInput(input = {}) {
    const extra = input.extraData || input.extra_data || {};
    const payload = input.deposit
        || input.banquetDeposit
        || input.bookingDeposit
        || input.depositData
        || extra.deposit
        || extra.banquetDeposit
        || extra.bookingDeposit
        || extra.depositData
        || null;
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

async function syncManagerDepositForMemberBooking(db, inputBooking = {}, memberRow = {}, businessContext, user) {
    const payload = managerDepositPayloadFromBookingInput(inputBooking);
    if (!payload || !memberRow?.id) return null;
    return upsertManagerBookingDeposit({
        bookingId: memberRow.id,
        businessContext,
        deposit: payload,
        source: 'services/banquetGroups.syncManagerDepositForMemberBooking',
        actor: user,
        managerReportedBy: actorUserId(user)
    }, { db });
}

function resolveSourceBanquetAnchorFields(source = {}) {
    const customerId = normalizeActivityInteger(source.customer_id ?? source.customerId, null);
    if (!Number.isInteger(customerId) || customerId <= 0) {
        throw new BanquetGroupError('Source booking customer is required', { status: 400, code: 'SOURCE_CUSTOMER_REQUIRED' });
    }
    const date = String(source.date || '').slice(0, 10);
    if (!validateDate(date)) {
        throw new BanquetGroupError('Source booking date is required', { status: 400, code: 'SOURCE_DATE_REQUIRED' });
    }
    const room = normalizeActivityText(source.room, 100);
    if (!room) {
        throw new BanquetGroupError('Source booking room is required', { status: 400, code: 'SOURCE_ROOM_REQUIRED' });
    }
    return {
        customerId,
        date,
        room,
        groupName: normalizeShortText(source.group_name || source.groupName, 200)
            || normalizeShortText(source.label, 200)
            || normalizeShortText(source.program_name || source.programName, 200)
            || 'Банкет'
    };
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
        groupName: null,
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
    booking.customerId = resolveAtomicBanquetCustomerId(input, { sourceBooking, group });
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

function memberBookingDefaultLabel(role) {
    if (role === 'kitchen') return 'Kitchen booking';
    if (role === 'service') return 'Banquet service booking';
    return 'Banquet member booking';
}

function normalizeRootMemberBooking(input = {}, { sourceBooking, group, businessContext, user, role } = {}) {
    const label = memberBookingDefaultLabel(role);
    const inputBanquetGuests = normalizeActivityInteger(input.banquetGuests ?? input.banquet_guests, null);
    const sourceKidsCount = role === 'kitchen'
        ? normalizeActivityInteger(sourceBooking?.kids_count ?? sourceBooking?.kidsCount, null)
        : null;
    const booking = {
        ...input,
        date: String(input.date || sourceBooking?.date || group?.date || '').slice(0, 10),
        time: String(input.time || sourceBooking?.time || '').slice(0, 5),
        lineId: cleanId(input.lineId || input.line_id || (role === 'kitchen' ? BANQUET_SERVICE_LINE_ID : null)),
        programId: input.programId || input.program_id || null,
        programCode: input.programCode || input.program_code || (role === 'kitchen' ? 'KITCHEN' : null),
        label: normalizeActivityText(input.label || input.programName || input.program_name || label, 200),
        programName: normalizeActivityText(input.programName || input.program_name || input.label || label, 200),
        category: normalizeActivityText(input.category || role, 80),
        duration: normalizeActivityInteger(input.duration, 0),
        price: normalizeActivityNumber(input.price, 0),
        hosts: normalizeActivityInteger(input.hosts, role === 'kitchen' ? 0 : null),
        secondAnimator: normalizeActivityText(input.secondAnimator || input.second_animator, 100),
        pinataFiller: input.pinataFiller ?? input.pinata_filler ?? null,
        pinataMode: input.pinataMode ?? input.pinata_mode ?? null,
        pinataNumber: input.pinataNumber ?? input.pinata_number ?? null,
        pinataFillerNumber: input.pinataFillerNumber ?? input.pinata_filler_number ?? null,
        clientPinataServicePrice: input.clientPinataServicePrice ?? input.client_pinata_service_price ?? null,
        clientPinataServiceNote: input.clientPinataServiceNote ?? input.client_pinata_service_note ?? null,
        costume: normalizeActivityText(input.costume, 100),
        room: normalizeActivityText(input.room || sourceBooking?.room || group?.room, 100),
        notes: normalizeActivityText(input.notes, 2000),
        createdBy: normalizeActivityText(input.createdBy || input.created_by || actorName(user), 100),
        status: normalizeBookingStatus(input.status, sourceBooking?.status || 'confirmed'),
        kidsCount: normalizeActivityInteger(input.kidsCount ?? input.kids_count, null),
        groupName: null,
        extraData: input.extraData || input.extra_data || {},
        skipNotification: Boolean(input.skipNotification || input.skip_notification),
        customerId: normalizeActivityInteger(input.customerId ?? input.customer_id ?? sourceBooking?.customer_id ?? group?.customer_id, null),
        paymentMethod: input.paymentMethod || input.payment_method || sourceBooking?.payment_method || null,
        banquetGuests: inputBanquetGuests ?? sourceKidsCount,
        banquetAdults: normalizeActivityInteger(input.banquetAdults ?? input.banquet_adults, null),
        banquetTables: normalizeActivityInteger(input.banquetTables ?? input.banquet_tables, null),
        banquetMenu: normalizeActivityText(input.banquetMenu || input.banquet_menu, 4000),
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT
    };
    booking.customerId = resolveAtomicBanquetCustomerId(input, { sourceBooking, group });
    if (!booking.extraData || typeof booking.extraData !== 'object' || Array.isArray(booking.extraData)) booking.extraData = {};
    booking.extraData.banquetGroup = {
        ...(booking.extraData.banquetGroup || {}),
        groupId: group?.id || null,
        sourceBookingId: sourceBooking?.id || group?.primary_booking_id || null,
        role,
        source: 'banquet_group_member_booking'
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
        notes: normalizeActivityText(input.notes, 2000),
        createdBy: normalizeActivityText(input.createdBy || input.created_by || rootBooking.createdBy || actorName(user), 100),
        status: normalizeBookingStatus(input.status, rootBooking.status || 'confirmed'),
        kidsCount: normalizeActivityInteger(input.kidsCount ?? input.kids_count ?? rootBooking.kidsCount, null),
        groupName: null,
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

function assertCreateMemberBookingPayload(booking, role) {
    if (!validateDate(booking.date)) {
        throw new BanquetGroupError('Invalid member booking date format', { status: 400, code: 'INVALID_MEMBER_BOOKING_DATE' });
    }
    if (!validateTime(booking.time)) {
        throw new BanquetGroupError('Invalid member booking time format', { status: 400, code: 'INVALID_MEMBER_BOOKING_TIME' });
    }
    if (!booking.lineId) {
        throw new BanquetGroupError('Member booking lineId is required', { status: 400, code: 'MEMBER_BOOKING_LINE_REQUIRED' });
    }
    if (!booking.room) {
        throw new BanquetGroupError('Member booking room is required', { status: 400, code: 'MEMBER_BOOKING_ROOM_REQUIRED' });
    }
    if (!booking.status) {
        throw new BanquetGroupError('Invalid member booking status', { status: 400, code: 'INVALID_MEMBER_BOOKING_STATUS' });
    }
    if (!Number.isFinite(Number(booking.duration)) || Number(booking.duration) <= 0 || Number(booking.duration) > 1440) {
        throw new BanquetGroupError('Member booking duration must be between 1 and 1440 minutes', { status: 400, code: 'INVALID_MEMBER_BOOKING_DURATION' });
    }
    if (!ATOMIC_MEMBER_BOOKING_ROLES.has(role)) {
        throw new BanquetGroupError('Invalid member booking role', { status: 400, code: 'INVALID_MEMBER_BOOKING_ROLE' });
    }
}

async function assertActivitySlotAvailable(db, booking, businessContext, { groupId = null, sourceBookingId = null } = {}) {
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
    const roomConflict = await checkRoomConflict(db, booking.date, booking.room, booking.time, booking.duration || 0, {
        banquetGroupId: groupId,
        sourceBookingId,
        candidateBooking: booking,
        allowSameBanquetOperationalOverlap: true
    }, businessContext);
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

async function assertMemberRoomSlotAvailable(db, booking, businessContext, { groupId = null, sourceBookingId = null } = {}) {
    const roomConflict = await checkRoomConflict(db, booking.date, booking.room, booking.time, booking.duration || 0, {
        banquetGroupId: groupId,
        sourceBookingId,
        candidateBooking: booking,
        allowSameBanquetOperationalOverlap: true
    }, businessContext);
    if (roomConflict) {
        throw new BanquetGroupError('Member booking room slot is busy', {
            status: 409,
            code: 'MEMBER_BOOKING_ROOM_CONFLICT',
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

async function insertRootMemberBooking(db, booking, businessContext) {
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
                 $25, $26, NULL, $27, $28, $29, $30,
                 $31, $32, $33, $34)
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
            normalizeActivityExtraData(booking.extraData),
            booking.skipNotification,
            booking.customerId,
            booking.paymentMethod,
            booking.banquetGuests,
            booking.banquetAdults,
            booking.banquetTables,
            booking.banquetMenu
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

function bookingSetExtraData(existingRow = {}, patch = {}) {
    const existing = parseExtraData(existingRow);
    const input = patch.extraData ?? patch.extra_data;
    const incoming = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const merged = { ...existing, ...incoming };
    delete merged.multiActivity;
    delete merged.multi_activity;
    return merged;
}

function normalizeBookingSetRoot(existingRow, patch, {
    primaryBooking,
    group,
    businessContext,
    user,
    role
} = {}) {
    const existing = existingRow ? mapBookingRow(existingRow) : {};
    const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const merged = {
        ...existing,
        ...input,
        extraData: bookingSetExtraData(existingRow || {}, input)
    };
    const booking = normalizeRootActivityBooking(merged, {
        sourceBooking: primaryBooking || existingRow,
        group,
        businessContext,
        user
    });
    booking.id = cleanId(existingRow?.id || input.bookingId || input.booking_id);
    booking.createdBy = normalizeActivityText(existingRow?.created_by || merged.createdBy || actorName(user), 100);
    booking.status = normalizeBookingStatus(merged.status, existingRow?.status || primaryBooking?.status || 'confirmed');
    if (String(booking.status || '').toLowerCase() === 'cancelled') {
        throw new BanquetGroupError('Cancelled bookings must be omitted from the desired activity set', {
            status: 400,
            code: 'BANQUET_BOOKING_SET_CANCELLED_MEMBER'
        });
    }
    booking.groupName = role === 'primary'
        ? normalizeActivityText(merged.groupName || merged.group_name || group?.group_name, 200)
        : null;
    booking.banquetGuests = role === 'primary'
        ? normalizeActivityInteger(merged.banquetGuests ?? merged.banquet_guests, null)
        : null;
    booking.banquetAdults = role === 'primary'
        ? normalizeActivityInteger(merged.banquetAdults ?? merged.banquet_adults, null)
        : null;
    booking.banquetTables = role === 'primary'
        ? normalizeActivityInteger(merged.banquetTables ?? merged.banquet_tables, null)
        : null;
    booking.banquetMenu = role === 'primary'
        ? normalizeActivityText(merged.banquetMenu || merged.banquet_menu, 4000)
        : null;
    booking.extraData.banquetGroup = {
        ...(booking.extraData.banquetGroup || booking.extraData.banquet_group || {}),
        groupId: group?.id || null,
        sourceBookingId: group?.primary_booking_id || primaryBooking?.id || booking.id || null,
        role,
        source: 'banquet_booking_set'
    };
    delete booking.extraData.banquet_group;
    return booking;
}

function applyBookingSetPinataNormalization(booking) {
    const normalized = normalizePinataFields(booking);
    if (normalized.error) {
        throw new BanquetGroupError(normalized.error, { status: 400, code: 'INVALID_PINATA_FIELDS' });
    }
    booking.pinataMode = normalized.pinataMode;
    booking.pinataNumber = normalized.pinataNumber;
    booking.pinataFillerNumber = normalized.pinataFillerNumber;
    booking.pinataFiller = normalized.pinataFiller;
    booking.clientPinataServicePrice = normalized.clientPinataServicePrice;
    booking.clientPinataServiceNote = normalized.clientPinataServiceNote;
    if (normalized.pinataMode === 'client') {
        booking.price = normalized.clientPinataServicePrice ?? 0;
    } else if (
        normalized.pinataMode === 'none'
        && (booking.category === 'pinata' || String(booking.programId || '').startsWith('pinata'))
    ) {
        booking.price = 0;
    }
}

function assertBookingSetTechnicalChildrenStable(existingRow, booking, technicalRows = []) {
    const desiredSecondAnimator = normalizeActivityText(booking.secondAnimator, 100);
    if (!existingRow) {
        if (desiredSecondAnimator) {
            throw new BanquetGroupError(
                'New banquet activities with a second animator require the linked-booking endpoint',
                {
                    status: 409,
                    code: 'BANQUET_BOOKING_SET_LINKED_ACTIVITY_REQUIRES_NESTED_CONTRACT'
                }
            );
        }
        return;
    }

    const existingSecondAnimator = normalizeActivityText(existingRow.second_animator, 100);
    const children = technicalRows.filter(row => String(row.linked_to || '') === String(existingRow.id || ''));
    if (desiredSecondAnimator !== existingSecondAnimator) {
        throw new BanquetGroupError(
            'Changing the second animator requires the linked-booking endpoint',
            {
                status: 409,
                code: 'BANQUET_BOOKING_SET_LINKED_ACTIVITY_REQUIRES_NESTED_CONTRACT',
                details: { bookingId: existingRow.id }
            }
        );
    }
    if ((desiredSecondAnimator && children.length === 0) || (!desiredSecondAnimator && children.length > 0)) {
        throw new BanquetGroupError(
            'Banquet activity linked-booking state is inconsistent',
            {
                status: 409,
                code: 'BANQUET_BOOKING_SET_LINKED_ACTIVITY_INCONSISTENT',
                details: { bookingId: existingRow.id }
            }
        );
    }
}

function bookingSetRangesOverlap(a, b) {
    if (String(a.date || '') !== String(b.date || '')) return false;
    const aStart = timeToMinutes(a.time);
    const bStart = timeToMinutes(b.time);
    const aEnd = aStart + Number(a.duration || 0);
    const bEnd = bStart + Number(b.duration || 0);
    return aStart < bEnd && aEnd > bStart;
}

function assertBookingSetPairwiseConflicts(bookings = []) {
    for (let leftIndex = 0; leftIndex < bookings.length; leftIndex += 1) {
        const left = bookings[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < bookings.length; rightIndex += 1) {
            const right = bookings[rightIndex];
            if (!bookingSetRangesOverlap(left, right)) continue;
            if (
                String(left.lineId || '') === String(right.lineId || '')
                && isLineConflictBlockingLine(left.lineId)
            ) {
                throw new BanquetGroupError('Activity line slot is busy inside the desired banquet set', {
                    status: 409,
                    code: 'BANQUET_BOOKING_SET_LINE_CONFLICT',
                    details: { leftBookingId: left.id || null, rightBookingId: right.id || null }
                });
            }
            const sameRoom = String(left.room || '').trim() === String(right.room || '').trim();
            const kitchenActivityOverlap = isKitchenCandidate(left) !== isKitchenCandidate(right);
            if (sameRoom && isRoomConflictBlockingRoom(left.room) && !kitchenActivityOverlap) {
                throw new BanquetGroupError('Activity room slot is busy inside the desired banquet set', {
                    status: 409,
                    code: 'BANQUET_BOOKING_SET_ROOM_CONFLICT',
                    details: { leftBookingId: left.id || null, rightBookingId: right.id || null }
                });
            }
        }
    }
}

async function assertBookingSetExternalConflicts(
    db,
    booking,
    businessContext,
    groupId,
    sourceBookingId,
    excludeIds
) {
    const lineConflict = await checkServerConflicts(
        db,
        booking.date,
        booking.lineId,
        booking.time,
        booking.duration || 0,
        excludeIds,
        businessContext
    );
    if (lineConflict.overlap) {
        throw new BanquetGroupError('Activity line slot is busy', {
            status: 409,
            code: 'ACTIVITY_LINE_CONFLICT',
            details: { conflictBookingId: lineConflict.conflictWith?.id || null }
        });
    }
    const duplicate = await checkServerDuplicate(
        db,
        booking.date,
        booking.programId,
        booking.time,
        booking.duration || 0,
        excludeIds,
        businessContext
    );
    if (duplicate) {
        throw new BanquetGroupError('Activity already exists at this time', {
            status: 409,
            code: 'ACTIVITY_DUPLICATE',
            details: { conflictBookingId: duplicate.id || null }
        });
    }
    const roomConflict = await checkRoomConflict(
        db,
        booking.date,
        booking.room,
        booking.time,
        booking.duration || 0,
        {
            excludeIds,
            banquetGroupId: groupId,
            sourceBookingId: sourceBookingId || booking.id || null,
            candidateBooking: booking,
            allowSameBanquetOperationalOverlap: true
        },
        businessContext
    );
    if (roomConflict) {
        throw new BanquetGroupError('Activity room slot is busy', {
            status: 409,
            code: 'ACTIVITY_ROOM_CONFLICT',
            details: { conflictBookingId: roomConflict.id || null }
        });
    }
}

async function updateBookingSetRoot(db, bookingId, booking, businessContext) {
    const result = await db.query(
        `UPDATE bookings SET
            date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
            label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
            second_animator=$12, pinata_filler=$13, pinata_mode=$14, pinata_number=$15,
            pinata_filler_number=$16, client_pinata_service_price=$17,
            client_pinata_service_note=$18, costume=$19, room=$20, notes=$21,
            created_by=$22, status=$23, kids_count=$24, group_name=$25, extra_data=$26,
            skip_notification=$27, customer_id=$28, payment_method=$29,
            banquet_guests=$30, banquet_adults=$31, banquet_tables=$32, banquet_menu=$33,
            updated_at=NOW()
          WHERE id=$34
            AND ${bookingContextSql('', '$35')}
          RETURNING *`,
        [
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
            booking.paymentMethod,
            booking.banquetGuests,
            booking.banquetAdults,
            booking.banquetTables,
            booking.banquetMenu,
            bookingId,
            businessContext || DEFAULT_TIMELINE_CONTEXT
        ]
    );
    return result.rows[0] || null;
}

async function cascadeBookingSetTechnicalChildren(db, rootBookingId, booking, businessContext) {
    await db.query(
        `UPDATE bookings SET
            date=$1, time=$2, duration=$3, status=$4, room=$5,
            pinata_filler=$6, pinata_mode=$7, client_pinata_service_price=$8,
            client_pinata_service_note=$9, pinata_number=$10, pinata_filler_number=$11,
            updated_at=NOW()
          WHERE linked_to=$12
            AND ${bookingContextSql('', '$13')}
            AND ${bookingActiveStatusSql()}`,
        [
            booking.date,
            booking.time,
            booking.duration,
            booking.status,
            booking.room,
            booking.pinataFiller,
            booking.pinataMode,
            booking.clientPinataServicePrice,
            booking.clientPinataServiceNote,
            booking.pinataNumber,
            booking.pinataFillerNumber,
            rootBookingId,
            businessContext || DEFAULT_TIMELINE_CONTEXT
        ]
    );
}

async function cancelBookingSetActivity(db, groupId, primaryBookingId, bookingId, businessContext, user) {
    await db.query(
        `UPDATE bookings
            SET status='cancelled', updated_at=NOW()
          WHERE (id=$1 OR linked_to=$1)
            AND ${bookingContextSql('', '$2')}`,
        [bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    await db.query(
        `DELETE FROM banquet_group_bookings
          WHERE group_id=$1
            AND booking_id=$2
            AND ${bookingContextSql('', '$3')}`,
        [groupId, bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    await deleteCompatibilityLink(db, businessContext, primaryBookingId, bookingId);
    await logBanquetHistory(db, businessContext, 'banquet_group_activity_booking_cancelled', user, {
        group_id: groupId,
        primary_booking_id: primaryBookingId,
        booking_id: bookingId
    });
}

async function persistDerivedBookingSetMetadata(
    db,
    group,
    businessContext,
    { source = 'banquet_booking_set' } = {}
) {
    const memberships = await getMembershipRows(db, group.id, businessContext);
    const memberRows = await getBookingsByIds(db, memberships.map(row => row.booking_id), businessContext);
    const rowById = new Map(memberRows.map(row => [String(row.id), row]));
    const primaryRow = rowById.get(String(group.primary_booking_id)) || null;
    const activityRows = memberships
        .filter(row => row.role === 'activity')
        .map(row => rowById.get(String(row.booking_id)))
        .filter(Boolean);
    const primaryIsActivity = primaryRow && isBanquetActivityCandidate(primaryRow);
    const orderedActivities = [
        ...(primaryIsActivity ? [primaryRow] : []),
        ...activityRows
    ];
    const activityIds = orderedActivities.map(row => String(row.program_id || '')).filter(Boolean);
    const totalDuration = orderedActivities.reduce((sum, row) => sum + Number(row.duration || 0), 0);
    const totalPrice = orderedActivities.reduce((sum, row) => sum + Number(row.price || 0), 0);
    const schedule = orderedActivities.map((row, index) => ({
        activityIndex: index + 1,
        bookingId: row.id,
        programId: row.program_id || null,
        time: row.time || null,
        duration: Number(row.duration || 0)
    }));
    const metadataTargets = [...new Set([primaryRow, ...activityRows].filter(Boolean).map(row => row.id))];
    for (const bookingId of metadataTargets) {
        const row = rowById.get(String(bookingId));
        if (!row) continue;
        const extraData = parseExtraData(row);
        const activityIndex = orderedActivities.findIndex(item => String(item.id) === String(bookingId));
        if (orderedActivities.length > 1 && activityIndex >= 0) {
            extraData.multiActivity = {
                schemaVersion: 1,
                role: String(bookingId) === String(group.primary_booking_id) ? 'primary' : 'activity',
                activityIndex: activityIndex + 1,
                activityCount: orderedActivities.length,
                activityIds,
                totalDuration,
                totalPrice,
                schedule,
                source
            };
        } else {
            delete extraData.multiActivity;
            delete extraData.multi_activity;
        }
        extraData.banquetGroup = {
            ...(extraData.banquetGroup || extraData.banquet_group || {}),
            groupId: group.id,
            sourceBookingId: group.primary_booking_id,
            role: String(bookingId) === String(group.primary_booking_id) ? 'primary' : 'activity',
            source
        };
        delete extraData.banquet_group;
        await db.query(
            `UPDATE bookings
                SET extra_data=$1, updated_at=NOW()
              WHERE id=$2
                AND ${bookingContextSql('', '$3')}`,
            [normalizeActivityExtraData(extraData), bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
        );
    }
    return { primaryRow, activityRows, activityIds, totalDuration, totalPrice, schedule };
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
    if (explicit === 'kitchen' && isBanquetActivityCandidate(row)) return 'activity';
    if (['kitchen', 'activity', 'service', 'manual'].includes(explicit)) return explicit;
    if (isBanquetActivityCandidate(row)) return 'activity';
    if (isKitchenCandidate(row) || bookingPackageHasBanquetData(row)) return 'kitchen';
    return 'manual';
}

function bookingStatusForContract(row = {}) {
    return normalizeBookingStatus(row.status, 'confirmed') || 'confirmed';
}

function bookingStatusWarningLabel(status) {
    if (status === 'preliminary') return 'попередні';
    if (status === 'cancelled') return 'скасовані';
    return 'підтверджені';
}

function normalizeGuestArrivalTime(value) {
    const time = String(value || '').trim();
    return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time) ? time : null;
}

function resolveBanquetArrivalBackfillCandidate(group = {}, memberships = [], bookingRows = []) {
    const bookingsById = new Map((bookingRows || []).map(row => [cleanId(row.id), row]).filter(([id]) => id));
    const explicitPrimaryIds = [...new Set((memberships || [])
        .filter(row => String(row.role || '').trim().toLowerCase() === 'primary')
        .map(row => cleanId(row.booking_id || row.bookingId))
        .filter(Boolean))];

    if (explicitPrimaryIds.length > 1) {
        return {
            resolved: false,
            source: 'explicit_primary_membership',
            bookingId: null,
            guestArrivalTime: null,
            reason: 'ambiguous_explicit_primary'
        };
    }

    if (explicitPrimaryIds.length === 1) {
        const bookingId = explicitPrimaryIds[0];
        const booking = bookingsById.get(bookingId) || null;
        const guestArrivalTime = normalizeGuestArrivalTime(booking?.time);
        return guestArrivalTime
            ? { resolved: true, source: 'explicit_primary_membership', bookingId, guestArrivalTime, reason: null }
            : { resolved: false, source: 'explicit_primary_membership', bookingId, guestArrivalTime: null, reason: booking ? 'invalid_primary_time' : 'primary_booking_missing' };
    }

    const bookingId = cleanId(group.primary_booking_id || group.primaryBookingId);
    if (!bookingId) {
        return {
            resolved: false,
            source: 'group_primary_booking',
            bookingId: null,
            guestArrivalTime: null,
            reason: 'primary_booking_missing'
        };
    }
    const booking = bookingsById.get(bookingId) || null;
    const guestArrivalTime = normalizeGuestArrivalTime(booking?.time);
    return guestArrivalTime
        ? { resolved: true, source: 'group_primary_booking', bookingId, guestArrivalTime, reason: null }
        : { resolved: false, source: 'group_primary_booking', bookingId, guestArrivalTime: null, reason: booking ? 'invalid_primary_time' : 'primary_booking_missing' };
}

function normalizeAuditContext(value) {
    const context = String(value || DEFAULT_TIMELINE_CONTEXT).trim().toLowerCase();
    return ['park_zakrevsky', 'park', 'pzp'].includes(context) ? DEFAULT_TIMELINE_CONTEXT : context;
}

function legacyAuditComponents(legacyLinks = []) {
    const adjacency = new Map();
    const addNode = (context, bookingId) => {
        const key = `${context}\u0000${bookingId}`;
        if (!adjacency.has(key)) adjacency.set(key, new Set());
        return key;
    };
    for (const link of legacyLinks || []) {
        if (String(link.relation_type || link.relationType || BANQUET_LINK_RELATION_TYPE) !== BANQUET_LINK_RELATION_TYPE) continue;
        const context = normalizeAuditContext(link.business_context || link.businessContext);
        const a = cleanId(link.booking_a_id || link.bookingAId);
        const b = cleanId(link.booking_b_id || link.bookingBId);
        if (!a || !b || a === b) continue;
        const aKey = addNode(context, a);
        const bKey = addNode(context, b);
        adjacency.get(aKey).add(bKey);
        adjacency.get(bKey).add(aKey);
    }

    const components = [];
    const visited = new Set();
    for (const start of [...adjacency.keys()].sort()) {
        if (visited.has(start)) continue;
        const queue = [start];
        const bookingIds = [];
        const context = start.split('\u0000')[0];
        visited.add(start);
        while (queue.length) {
            const current = queue.shift();
            bookingIds.push(current.slice(current.indexOf('\u0000') + 1));
            for (const next of adjacency.get(current) || []) {
                if (visited.has(next)) continue;
                visited.add(next);
                queue.push(next);
            }
        }
        components.push({ businessContext: context, bookingIds: [...new Set(bookingIds)].sort() });
    }
    return components;
}

function buildBanquetGuestArrivalAudit({
    groupRows = [],
    membershipRows = [],
    bookingRows = [],
    legacyLinks = []
} = {}) {
    const bookingsByContextAndId = new Map((bookingRows || []).map(row => [
        `${normalizeAuditContext(row.business_context || row.businessContext)}\u0000${cleanId(row.id)}`,
        row
    ]));
    const membershipsByGroup = new Map();
    const membershipsByContextAndBooking = new Map();
    for (const membership of membershipRows || []) {
        const groupId = cleanId(membership.group_id || membership.groupId);
        if (groupId) {
            if (!membershipsByGroup.has(groupId)) membershipsByGroup.set(groupId, []);
            membershipsByGroup.get(groupId).push(membership);
        }
        const bookingId = cleanId(membership.booking_id || membership.bookingId);
        if (bookingId) {
            membershipsByContextAndBooking.set(
                `${normalizeAuditContext(membership.business_context || membership.businessContext)}\u0000${bookingId}`,
                membership
            );
        }
    }

    const activeGroupsWithNull = [];
    const explicitPrimaryCandidates = [];
    const groupPrimaryCandidates = [];
    const ambiguousOrMissingPrimary = [];
    for (const group of groupRows || []) {
        const groupId = cleanId(group.id);
        const context = normalizeAuditContext(group.business_context || group.businessContext);
        const memberships = membershipsByGroup.get(groupId) || [];
        const bookingIds = new Set(memberships.map(row => cleanId(row.booking_id || row.bookingId)).filter(Boolean));
        const groupPrimaryId = cleanId(group.primary_booking_id || group.primaryBookingId);
        if (groupPrimaryId) bookingIds.add(groupPrimaryId);
        const bookings = [...bookingIds].map(id => bookingsByContextAndId.get(`${context}\u0000${id}`)).filter(Boolean);
        const resolution = resolveBanquetArrivalBackfillCandidate(group, memberships, bookings);
        const record = {
            groupId,
            businessContext: context,
            date: group.date || null,
            resolution
        };
        activeGroupsWithNull.push(record);
        if (!resolution.resolved) ambiguousOrMissingPrimary.push({ ...record, kind: 'group' });
        else if (resolution.source === 'explicit_primary_membership') explicitPrimaryCandidates.push(record);
        else groupPrimaryCandidates.push(record);
    }

    const legacyLinkOnlyGroups = [];
    const singleBanquetAnchors = [];
    const inactiveOrUnsupportedLegacyFlows = [];
    for (const component of legacyAuditComponents(legacyLinks)) {
        const hasMembership = component.bookingIds.some(bookingId => membershipsByContextAndBooking.has(`${component.businessContext}\u0000${bookingId}`));
        if (hasMembership) continue;
        const bookings = component.bookingIds
            .map(bookingId => bookingsByContextAndId.get(`${component.businessContext}\u0000${bookingId}`))
            .filter(Boolean);
        const record = {
            businessContext: component.businessContext,
            bookingIds: component.bookingIds,
            date: bookings.map(row => row.date).filter(Boolean).sort()[0] || null
        };
        legacyLinkOnlyGroups.push(record);
        const knownBookingIds = new Set(bookings.map(row => cleanId(row.id)).filter(Boolean));
        const missingBookingIds = component.bookingIds.filter(bookingId => !knownBookingIds.has(bookingId));
        const inactiveBookingIds = bookings.filter(row => !isActiveBookingRow(row)).map(row => cleanId(row.id)).filter(Boolean);
        const technicalBookingIds = bookings.filter(row => !isRootBooking(row)).map(row => cleanId(row.id)).filter(Boolean);
        if (missingBookingIds.length || inactiveBookingIds.length || technicalBookingIds.length) {
            inactiveOrUnsupportedLegacyFlows.push({
                ...record,
                reason: missingBookingIds.length
                    ? 'booking_missing'
                    : (inactiveBookingIds.length ? 'inactive_component' : 'technical_child_component'),
                missingBookingIds,
                inactiveBookingIds,
                technicalBookingIds
            });
            continue;
        }
        const anchors = bookings.filter(isBanquetAnchor);
        if (anchors.length === 1) {
            const anchor = anchors[0];
            const guestArrivalTime = normalizeGuestArrivalTime(anchor.time);
            if (guestArrivalTime) {
                singleBanquetAnchors.push({
                    ...record,
                    anchorBookingId: cleanId(anchor.id),
                    guestArrivalTime
                });
                continue;
            }
        }
        ambiguousOrMissingPrimary.push({
            ...record,
            kind: 'legacy',
            reason: anchors.length > 1 ? 'ambiguous_banquet_anchor' : (anchors.length === 1 ? 'invalid_primary_time' : 'banquet_anchor_missing'),
            anchorBookingIds: anchors.map(row => cleanId(row.id)).filter(Boolean)
        });
    }

    const unresolvedSupportedLegacyFlows = ambiguousOrMissingPrimary.filter(record => record.kind === 'legacy');
    return {
        summary: {
            activeGroupsWithNull: activeGroupsWithNull.length,
            explicitPrimaryCandidates: explicitPrimaryCandidates.length,
            groupPrimaryCandidates: groupPrimaryCandidates.length,
            legacyLinkOnlyGroups: legacyLinkOnlyGroups.length,
            singleBanquetAnchors: singleBanquetAnchors.length,
            inactiveOrUnsupportedLegacyFlows: inactiveOrUnsupportedLegacyFlows.length,
            ambiguousOrMissingPrimary: ambiguousOrMissingPrimary.length,
            unresolvedSupportedLegacyFlows: unresolvedSupportedLegacyFlows.length,
            readyForRequiredConstraint: activeGroupsWithNull.length === 0 && unresolvedSupportedLegacyFlows.length === 0
        },
        activeGroupsWithNull,
        explicitPrimaryCandidates,
        groupPrimaryCandidates,
        legacyLinkOnlyGroups,
        singleBanquetAnchors,
        inactiveOrUnsupportedLegacyFlows,
        ambiguousOrMissingPrimary,
        unresolvedSupportedLegacyFlows
    };
}

async function auditBanquetGuestArrival({ db = defaultPool, businessContext = null } = {}) {
    const context = businessContext ? normalizeAuditContext(businessContext) : null;
    const groupResult = await db.query(
        `SELECT bg.*
           FROM banquet_groups bg
          WHERE LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) = 'active'
            AND bg.guest_arrival_time IS NULL
            AND ($1::text IS NULL OR ${bookingContextColumnSql('bg.business_context')} = $1)
          ORDER BY bg.business_context, bg.date, bg.id`,
        [context]
    );
    const legacyResult = await db.query(
        `SELECT id, business_context, booking_a_id, booking_b_id, relation_type, created_at
           FROM booking_banquet_links
          WHERE relation_type = $2
            AND ($1::text IS NULL OR ${bookingContextColumnSql('business_context')} = $1)
          ORDER BY business_context, id`,
        [context, BANQUET_LINK_RELATION_TYPE]
    );
    const groupIds = (groupResult.rows || []).map(row => cleanId(row.id)).filter(Boolean);
    const legacyBookingIds = (legacyResult.rows || []).flatMap(row => [cleanId(row.booking_a_id), cleanId(row.booking_b_id)]).filter(Boolean);
    const membershipResult = await db.query(
        `SELECT bgb.*
           FROM banquet_group_bookings bgb
          WHERE bgb.group_id = ANY($1::text[])
             OR bgb.booking_id = ANY($2::text[])
          ORDER BY bgb.group_id, bgb.sort_order, bgb.id`,
        [groupIds, legacyBookingIds]
    );
    const bookingIds = [...new Set([
        ...(groupResult.rows || []).map(row => cleanId(row.primary_booking_id)),
        ...(membershipResult.rows || []).map(row => cleanId(row.booking_id)),
        ...legacyBookingIds
    ].filter(Boolean))];
    const bookingResult = await db.query(
        `SELECT b.*
           FROM bookings b
          WHERE b.id = ANY($1::text[])
          ORDER BY b.business_context, b.date, b.time, b.id`,
        [bookingIds]
    );
    return buildBanquetGuestArrivalAudit({
        groupRows: groupResult.rows || [],
        membershipRows: membershipResult.rows || [],
        bookingRows: bookingResult.rows || [],
        legacyLinks: legacyResult.rows || []
    });
}

function buildBanquetArrivalProjection(primaryBooking = null, group = null, snapshotSource = null) {
    const bookingId = cleanId(primaryBooking?.id || primaryBooking?.bookingId || group?.primaryBookingId);
    const groupArrivalTime = normalizeGuestArrivalTime(group?.guestArrivalTime || group?.guest_arrival_time);
    if (!groupArrivalTime) return null;
    return {
        bookingId,
        date: group?.date || primaryBooking?.date || null,
        time: groupArrivalTime,
        room: group?.room || primaryBooking?.room || null,
        source: BANQUET_GROUP_SOURCE.GROUP,
        groupSource: group?.source || snapshotSource || null,
        updatedAt: group?.updatedAt
            || group?.updated_at
            || null
    };
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
    const arrival = buildBanquetArrivalProjection(roleBuckets.primary?.booking || null, group, source);

    const warnings = [];
    if (!schemaAvailable) warnings.push({ code: 'banquet_group_schema_unavailable', message: 'Banquet group schema is not available; legacy links were used if possible.' });
    if (source === BANQUET_GROUP_SOURCE.LEGACY) warnings.push({ code: 'legacy_banquet_links_fallback', message: 'Loaded from legacy booking_banquet_links because no banquet group exists yet.' });
    if (source === BANQUET_GROUP_SOURCE.SINGLE) warnings.push({ code: 'banquet_group_not_found', message: 'Booking is not attached to a banquet group.' });
    if (group && !arrival) warnings.push({
        code: 'guest_arrival_missing',
        message: 'Banquet group has no valid persisted guest arrival time.'
    });
    if (!roleBuckets.primary) warnings.push({ code: 'primary_booking_missing', message: 'Primary banquet booking could not be determined.' });
    if (!roleBuckets.kitchen.length) warnings.push({ code: 'kitchen_booking_missing', message: 'No kitchen/menu booking was detected for this banquet.' });
    const memberStatuses = [...new Set(members.map(member => bookingStatusForContract(member.booking)).filter(Boolean))].sort();
    if (memberStatuses.length > 1) {
        warnings.push({
            code: 'banquet_member_status_mismatch',
            message: `У банкеті різні статуси бронювань: ${memberStatuses.map(bookingStatusWarningLabel).join(', ')}. Це дозволено для окремих кухні або активностей, але перевірте перед друком вижимки.`
        });
    }

    return {
        success: true,
        source,
        legacyFallback: source === BANQUET_GROUP_SOURCE.LEGACY,
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
        group,
        groupId: group?.id || null,
        anchorBookingId: anchorBookingId || null,
        arrival,
        banquetArrival: arrival,
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

function requireBanquetCreationContext(value, options = {}) {
    const validation = validateBanquetCreationContext(value, options);
    if (validation.valid) return validation.context;
    throw new BanquetGroupError(validation.error, {
        status: 400,
        code: validation.code || 'BANQUET_CONTEXT_INVALID'
    });
}

async function createBanquetGroupInTransaction({
    db,
    primaryBooking,
    primaryBookingId,
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null,
    groupName = null,
    source = 'booking_create',
    meta = {},
    banquetContext,
    members = []
} = {}) {
    if (!db || typeof db.query !== 'function') {
        throw new BanquetGroupError('Transactional database client is required', { status: 500, code: 'BANQUET_TRANSACTION_REQUIRED' });
    }
    const context = requireBanquetCreationContext(banquetContext, { required: true, expectedMode: 'new' });
    const cleanPrimaryId = cleanId(primaryBookingId || primaryBooking?.id);
    if (!cleanPrimaryId || !primaryBooking) {
        throw new BanquetGroupError('Primary booking is required', { status: 400, code: 'PRIMARY_BOOKING_REQUIRED' });
    }
    assertRootBooking(primaryBooking, 'PRIMARY_BOOKING_MUST_BE_ROOT');
    assertActiveBooking(primaryBooking);

    const scope = businessContext || DEFAULT_TIMELINE_CONTEXT;
    const id = generateBanquetGroupId();
    const normalizedSource = normalizeShortText(source, 64) || 'booking_create';
    const groupResult = await db.query(
        `INSERT INTO banquet_groups
            (id, business_context, primary_booking_id, customer_id, date, room, guest_arrival_time, group_name, status, source, meta,
             created_by_user_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10::jsonb, $11, $12, $12)
         RETURNING *`,
        [
            id,
            scope,
            cleanPrimaryId,
            primaryBooking.customer_id ?? primaryBooking.customerId ?? null,
            primaryBooking.date,
            primaryBooking.room || null,
            context.guestArrivalTime,
            normalizeShortText(groupName, 200) || normalizeShortText(primaryBooking.label || primaryBooking.program_name || primaryBooking.programName, 200),
            normalizedSource,
            JSON.stringify(normalizeMeta(meta)),
            actorUserId(user),
            actorName(user)
        ]
    );
    const membershipResult = await db.query(
        `INSERT INTO banquet_group_bookings
            (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
         VALUES ($1, $2, $3, 'primary', 10, $4, $5)
         RETURNING *`,
        [id, scope, cleanPrimaryId, actorUserId(user), actorName(user)]
    );
    const memberResults = [];
    for (const member of Array.isArray(members) ? members : []) {
        const bookingId = cleanId(member?.bookingId || member?.booking_id || member?.id);
        if (!bookingId || bookingId === cleanPrimaryId) continue;
        const role = normalizeWritableRole(member?.role);
        if (!role || role === 'primary') {
            throw new BanquetGroupError('Invalid banquet member role', { status: 400, code: 'INVALID_MEMBER_ROLE' });
        }
        const inserted = await db.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [id, scope, bookingId, role, memberBookingSortOrderFor(role), actorUserId(user), actorName(user)]
        );
        if (inserted.rows[0]) memberResults.push(inserted.rows[0]);
    }
    await logBanquetHistory(db, scope, 'banquet_group_created', user, {
        group_id: id,
        primary_booking_id: cleanPrimaryId,
        booking_id: cleanPrimaryId,
        guest_arrival_time: context.guestArrivalTime,
        source: normalizedSource
    });
    return {
        groupRow: groupResult.rows[0],
        membershipRow: membershipResult.rows[0],
        memberRows: memberResults,
        group: mapGroupRow(groupResult.rows[0]),
        membership: mapMembershipRow(membershipResult.rows[0]),
        members: memberResults.map(mapMembershipRow)
    };
}

async function createBanquetGroup({
    db = defaultPool,
    primaryBookingId,
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null,
    groupName = null,
    source = 'manual',
    meta = {},
    banquetContext = null
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

        const created = await createBanquetGroupInTransaction({
            db: client,
            primaryBooking: primary,
            primaryBookingId: cleanPrimaryId,
            businessContext,
            user,
            groupName,
            source,
            meta,
            banquetContext
        });
        await client.query('COMMIT');
        return {
            success: true,
            group: created.group,
            membership: created.membership
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

async function updateBanquetGuestArrival({
    db = defaultPool,
    groupId,
    guestArrivalTime,
    updatedAt,
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null
} = {}) {
    const cleanGroupId = cleanId(groupId);
    if (!cleanGroupId) {
        throw new BanquetGroupError('Invalid banquet group ID', { status: 400, code: 'BANQUET_GROUP_ID_REQUIRED' });
    }
    const cleanArrivalTime = String(guestArrivalTime || '').trim();
    if (!validateTime(cleanArrivalTime)) {
        throw new BanquetGroupError('guestArrivalTime must use HH:mm format', { status: 400, code: 'BANQUET_ARRIVAL_TIME_INVALID' });
    }
    const expectedUpdatedAt = timestampIso(updatedAt);
    if (!expectedUpdatedAt) {
        throw new BanquetGroupError('updatedAt is required', { status: 400, code: 'BANQUET_ARRIVAL_UPDATED_AT_REQUIRED' });
    }

    const context = businessContext || DEFAULT_TIMELINE_CONTEXT;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const group = await getGroupByIdForUpdate(client, cleanGroupId, context);
        if (!group) {
            throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
        }
        if (String(group.status || 'active').trim().toLowerCase() !== 'active') {
            throw new BanquetGroupError('Inactive banquet group cannot be edited', { status: 409, code: 'BANQUET_GROUP_INACTIVE' });
        }

        const primaryBooking = await getScopedBooking(client, group.primary_booking_id, context);
        assertEditableBooking(user, primaryBooking);

        const currentUpdatedAt = timestampIso(group.updated_at);
        if (!currentUpdatedAt || currentUpdatedAt !== expectedUpdatedAt) {
            throw new BanquetGroupError('Banquet arrival was changed by another user', {
                status: 409,
                code: 'BANQUET_ARRIVAL_VERSION_CONFLICT',
                details: {
                    currentArrival: group.guest_arrival_time || null,
                    currentUpdatedAt
                }
            });
        }

        const updateResult = await client.query(
            `UPDATE banquet_groups
                SET guest_arrival_time = $3,
                    updated_at = NOW(),
                    updated_by = $4
              WHERE id = $1
                AND ${bookingContextSql('', '$2')}
              RETURNING *`,
            [cleanGroupId, context, cleanArrivalTime, actorName(user)]
        );
        const updatedGroup = updateResult.rows[0];
        if (!updatedGroup) {
            throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
        }
        await logBanquetHistory(client, context, 'banquet_guest_arrival_updated', user, {
            group_id: cleanGroupId,
            primary_booking_id: group.primary_booking_id,
            previous_guest_arrival_time: group.guest_arrival_time || null,
            guest_arrival_time: cleanArrivalTime,
            previous_updated_at: currentUpdatedAt,
            updated_at: timestampIso(updatedGroup.updated_at)
        });
        await client.query('COMMIT');

        const mappedGroup = mapGroupRow(updatedGroup);
        broadcastBanquetEvent('banquet:arrival-updated', {
            groupId: mappedGroup.id,
            date: mappedGroup.date,
            businessContext: mappedGroup.businessContext || context,
            updatedAt: mappedGroup.updatedAt,
            primaryBooking
        });
        return {
            success: true,
            group: mappedGroup,
            guestArrivalTime: mappedGroup.guestArrivalTime,
            updatedAt: mappedGroup.updatedAt,
            arrival: buildBanquetArrivalProjection(primaryBooking, mappedGroup, mappedGroup.source)
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function updateBanquetBookingSet({
    db = defaultPool,
    groupId,
    primaryBookingId,
    primaryPatch = {},
    activities = [],
    expectedGroupUpdatedAt,
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null
} = {}) {
    const cleanGroupId = cleanId(groupId);
    const cleanPrimaryBookingId = cleanId(primaryBookingId);
    const expectedUpdatedAt = timestampIso(expectedGroupUpdatedAt);
    if (!cleanGroupId) {
        throw new BanquetGroupError('Invalid banquet group ID', { status: 400, code: 'BANQUET_GROUP_ID_REQUIRED' });
    }
    if (!cleanPrimaryBookingId) {
        throw new BanquetGroupError('primaryBookingId is required', { status: 400, code: 'PRIMARY_BOOKING_REQUIRED' });
    }
    if (!primaryPatch || typeof primaryPatch !== 'object' || Array.isArray(primaryPatch)) {
        throw new BanquetGroupError('primaryPatch must be an object', { status: 400, code: 'PRIMARY_PATCH_INVALID' });
    }
    if (!Array.isArray(activities) || activities.length > 50) {
        throw new BanquetGroupError('activities must be an array with at most 50 items', {
            status: 400,
            code: 'BANQUET_ACTIVITY_SET_INVALID'
        });
    }
    if (!expectedUpdatedAt) {
        throw new BanquetGroupError('expectedGroupUpdatedAt is required', {
            status: 400,
            code: 'BANQUET_BOOKING_SET_UPDATED_AT_REQUIRED'
        });
    }

    const context = businessContext || DEFAULT_TIMELINE_CONTEXT;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const group = await getGroupByIdForUpdate(client, cleanGroupId, context);
        if (!group) {
            throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
        }
        if (String(group.status || 'active').trim().toLowerCase() !== 'active') {
            throw new BanquetGroupError('Inactive banquet group cannot be edited', { status: 409, code: 'BANQUET_GROUP_INACTIVE' });
        }
        if (String(group.primary_booking_id || '') !== cleanPrimaryBookingId) {
            throw new BanquetGroupError('primaryBookingId does not match the banquet group', {
                status: 409,
                code: 'BANQUET_PRIMARY_BOOKING_MISMATCH',
                details: { currentPrimaryBookingId: group.primary_booking_id || null }
            });
        }
        const currentUpdatedAt = timestampIso(group.updated_at);
        if (!currentUpdatedAt || currentUpdatedAt !== expectedUpdatedAt) {
            throw new BanquetGroupError('Banquet activity set was changed by another user', {
                status: 409,
                code: 'BANQUET_BOOKING_SET_VERSION_CONFLICT',
                details: { currentUpdatedAt }
            });
        }

        const primaryRow = await getScopedBookingForUpdate(client, cleanPrimaryBookingId, context);
        if (!primaryRow) {
            throw new BanquetGroupError('Primary booking not found', { status: 409, code: 'PRIMARY_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, primaryRow);
        assertRootBooking(primaryRow, 'PRIMARY_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(primaryRow);

        const membershipRows = await getMembershipRowsForUpdate(client, cleanGroupId, context);
        const activityMembershipRows = membershipRows.filter(row => row.role === 'activity');
        const existingActivityIds = activityMembershipRows.map(row => cleanId(row.booking_id)).filter(Boolean);
        const existingActivityRows = new Map();
        for (const bookingId of [...existingActivityIds].sort()) {
            const row = await getScopedBookingForUpdate(client, bookingId, context);
            if (!row) {
                throw new BanquetGroupError('Activity booking member not found', {
                    status: 409,
                    code: 'BANQUET_ACTIVITY_MEMBER_MISSING',
                    details: { bookingId }
                });
            }
            assertEditableBooking(user, row);
            assertRootBooking(row, 'ACTIVITY_BOOKING_MUST_BE_ROOT');
            assertActiveBooking(row);
            existingActivityRows.set(String(bookingId), row);
        }
        const technicalRows = await getTechnicalChildrenForUpdate(
            client,
            membershipRows.map(row => row.booking_id),
            context
        );

        const resolvedCustomerId = await resolveBookingSetPrimaryCustomerId(client, primaryPatch, {
            primaryBooking: primaryRow,
            group,
            businessContext: context
        });
        const resolvedPrimaryPatch = resolvedCustomerId
            ? { ...primaryPatch, customerId: resolvedCustomerId }
            : primaryPatch;
        const customerGroup = resolvedCustomerId
            ? { ...group, customer_id: resolvedCustomerId }
            : group;
        const customerPrimaryRow = resolvedCustomerId
            ? { ...primaryRow, customer_id: resolvedCustomerId }
            : primaryRow;

        const seenDesiredIds = new Set();
        const desiredInputs = activities.map((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new BanquetGroupError('Each activity must be an object', {
                    status: 400,
                    code: 'BANQUET_ACTIVITY_ITEM_INVALID',
                    details: { activityIndex: index }
                });
            }
            const bookingId = cleanId(item.bookingId || item.booking_id);
            if (bookingId) {
                if (seenDesiredIds.has(bookingId)) {
                    throw new BanquetGroupError('Duplicate activity bookingId in desired set', {
                        status: 400,
                        code: 'BANQUET_ACTIVITY_ID_DUPLICATE',
                        details: { bookingId }
                    });
                }
                if (!existingActivityRows.has(bookingId)) {
                    throw new BanquetGroupError('Activity booking does not belong to this banquet group', {
                        status: 409,
                        code: 'BANQUET_ACTIVITY_NOT_IN_GROUP',
                        details: { bookingId }
                    });
                }
                seenDesiredIds.add(bookingId);
            }
            return { bookingId, patch: item };
        });

        const primaryBooking = normalizeBookingSetRoot(primaryRow, resolvedPrimaryPatch, {
            primaryBooking: customerPrimaryRow,
            group: customerGroup,
            businessContext: context,
            user,
            role: 'primary'
        });
        const desiredActivities = desiredInputs.map(({ bookingId, patch }) => ({
            bookingId,
            booking: normalizeBookingSetRoot(existingActivityRows.get(String(bookingId)) || null, patch, {
                primaryBooking: customerPrimaryRow,
                group: customerGroup,
                businessContext: context,
                user,
                role: 'activity'
            })
        }));

        assertBookingSetTechnicalChildrenStable(primaryRow, primaryBooking, technicalRows);
        for (const desired of desiredActivities) {
            assertBookingSetTechnicalChildrenStable(
                existingActivityRows.get(String(desired.bookingId)) || null,
                desired.booking,
                technicalRows
            );
        }

        const normalizedBookings = [primaryBooking, ...desiredActivities.map(item => item.booking)];
        for (const booking of normalizedBookings) {
            assertCreateActivityPayload(booking);
            applyBookingSetPinataNormalization(booking);
            applyBookingPackage(booking);
            await applyEffectiveBookingPrice(client, booking, { businessContext: context });
            await applyBookingPackageEntryCharge(client, booking, {
                businessContext: context,
                sourceBooking: primaryRow,
                primaryBooking: primaryRow
            });
        }

        assertBookingSetPairwiseConflicts(normalizedBookings);
        const conflictExcludeIds = [
            ...membershipRows.map(row => row.booking_id),
            ...technicalRows.map(row => row.id)
        ];
        for (const booking of normalizedBookings) {
            await assertBookingSetExternalConflicts(
                client,
                booking,
                context,
                cleanGroupId,
                cleanPrimaryBookingId,
                conflictExcludeIds
            );
        }

        const updatedPrimaryRow = await updateBookingSetRoot(
            client,
            cleanPrimaryBookingId,
            primaryBooking,
            context
        );
        if (!updatedPrimaryRow) {
            throw new BanquetGroupError('Primary booking not found', { status: 409, code: 'PRIMARY_BOOKING_NOT_FOUND' });
        }
        await cascadeBookingSetTechnicalChildren(client, cleanPrimaryBookingId, primaryBooking, context);
        await logBanquetHistory(client, context, 'banquet_booking_set_primary_updated', user, {
            group_id: cleanGroupId,
            booking_id: cleanPrimaryBookingId,
            previous: mapBookingRow(primaryRow),
            updated: mapBookingRow(updatedPrimaryRow)
        });

        const removedActivityIds = existingActivityIds.filter(bookingId => !seenDesiredIds.has(bookingId));
        for (const bookingId of removedActivityIds) {
            await cancelBookingSetActivity(
                client,
                cleanGroupId,
                cleanPrimaryBookingId,
                bookingId,
                context,
                user
            );
        }

        const savedActivityRows = [];
        for (const desired of desiredActivities) {
            if (desired.bookingId) {
                const updated = await updateBookingSetRoot(
                    client,
                    desired.bookingId,
                    desired.booking,
                    context
                );
                if (!updated) {
                    throw new BanquetGroupError('Activity booking not found', {
                        status: 409,
                        code: 'BANQUET_ACTIVITY_MEMBER_MISSING',
                        details: { bookingId: desired.bookingId }
                    });
                }
                await cascadeBookingSetTechnicalChildren(client, desired.bookingId, desired.booking, context);
                await upsertCompatibilityLink(
                    client,
                    context,
                    cleanPrimaryBookingId,
                    desired.bookingId,
                    group.group_name || desired.booking.programName,
                    user
                );
                await logBanquetHistory(client, context, 'banquet_group_activity_booking_updated', user, {
                    group_id: cleanGroupId,
                    primary_booking_id: cleanPrimaryBookingId,
                    booking_id: desired.bookingId,
                    updated: mapBookingRow(updated)
                });
                savedActivityRows.push(updated);
                continue;
            }

            const created = await insertRootActivityBooking(client, desired.booking, context);
            const membershipResult = await client.query(
                `INSERT INTO banquet_group_bookings
                    (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
                 VALUES ($1, $2, $3, 'activity', $4, $5, $6)
                 RETURNING *`,
                [
                    cleanGroupId,
                    context,
                    created.id,
                    100 + savedActivityRows.length,
                    actorUserId(user),
                    actorName(user)
                ]
            );
            await upsertCompatibilityLink(
                client,
                context,
                cleanPrimaryBookingId,
                created.id,
                group.group_name || desired.booking.programName,
                user
            );
            await logBanquetHistory(client, context, 'create', user, mapBookingRow(created));
            await logBanquetHistory(client, context, 'banquet_group_activity_booking_created', user, {
                group_id: cleanGroupId,
                primary_booking_id: cleanPrimaryBookingId,
                booking_id: created.id,
                membership_id: membershipResult.rows[0]?.id || null
            });
            savedActivityRows.push(created);
        }

        const updatedGroupResult = await client.query(
            `UPDATE banquet_groups SET
                customer_id=$3,
                date=$4,
                room=$5,
                group_name=$6,
                updated_at=NOW(),
                updated_by=$7
              WHERE id=$1
                AND ${bookingContextSql('', '$2')}
              RETURNING *`,
            [
                cleanGroupId,
                context,
                primaryBooking.customerId,
                primaryBooking.date,
                primaryBooking.room,
                primaryBooking.groupName || group.group_name || null,
                actorName(user)
            ]
        );
        const updatedGroup = updatedGroupResult.rows[0];
        if (!updatedGroup) {
            throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
        }

        await syncManagerDepositForMemberBooking(
            client,
            resolvedPrimaryPatch,
            updatedPrimaryRow,
            context,
            user
        );

        const derived = await persistDerivedBookingSetMetadata(client, updatedGroup, context);
        await logBanquetHistory(client, context, 'banquet_booking_set_updated', user, {
            group_id: cleanGroupId,
            primary_booking_id: cleanPrimaryBookingId,
            activity_booking_ids: savedActivityRows.map(row => row.id),
            cancelled_activity_booking_ids: removedActivityIds,
            activity_ids: derived.activityIds,
            expected_group_updated_at: expectedUpdatedAt,
            updated_group_at: timestampIso(updatedGroup.updated_at)
        });

        const snapshot = await loadBanquetGroupById({
            db: client,
            groupId: cleanGroupId,
            businessContext: context
        });
        await client.query('COMMIT');

        broadcastBanquetEvent('banquet:booking-set-updated', {
            groupId: cleanGroupId,
            primaryBookingId: cleanPrimaryBookingId,
            businessContext: context,
            updatedAt: mapGroupRow(updatedGroup)?.updatedAt || null,
            cancelledActivityBookingIds: removedActivityIds
        });
        return {
            success: true,
            group: mapGroupRow(updatedGroup),
            primaryBooking: snapshot?.bookings?.primary || mapBookingRow(updatedPrimaryRow),
            activityBookings: snapshot?.bookings?.activities || savedActivityRows.map(mapBookingRow),
            cancelledActivityBookingIds: removedActivityIds,
            banquetGroup: snapshot,
            serverVerified: true
        };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err?.code === '23505') {
            throw new BanquetGroupError('Booking is already attached to a banquet group', {
                status: 409,
                code: 'BOOKING_ALREADY_IN_GROUP'
            });
        }
        throw err;
    } finally {
        client.release();
    }
}

async function validateSingleBookingActivitySetUpdate({
    db = defaultPool,
    bookingId,
    extraData,
    businessContext = DEFAULT_TIMELINE_CONTEXT
} = {}) {
    const requestedExtra = extraData && typeof extraData === 'object' && !Array.isArray(extraData)
        ? extraData
        : {};
    const requestedMultiActivity = requestedExtra.multiActivity || requestedExtra.multi_activity;
    if (!Array.isArray(requestedMultiActivity?.activityIds)) {
        return { allowed: true, groupId: null, requestedActivityIds: null, actualActivityIds: null };
    }
    const snapshot = await loadBanquetGroupByBookingId({ db, bookingId, businessContext });
    if (!snapshot?.groupId || snapshot.source !== BANQUET_GROUP_SOURCE.GROUP) {
        return {
            allowed: true,
            groupId: null,
            requestedActivityIds: requestedMultiActivity.activityIds.map(String),
            actualActivityIds: null
        };
    }
    const primary = snapshot.bookings?.primary || null;
    const actualBookings = [
        ...(primary && isBanquetActivityCandidate(primary) ? [primary] : []),
        ...(snapshot.bookings?.activities || [])
    ];
    const requestedActivityIds = requestedMultiActivity.activityIds
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .sort();
    const actualActivityIds = actualBookings
        .map(item => String(item.programId || item.program_id || '').trim())
        .filter(Boolean)
        .sort();
    const allowed = requestedActivityIds.length === actualActivityIds.length
        && requestedActivityIds.every((value, index) => value === actualActivityIds[index]);
    return {
        allowed,
        groupId: snapshot.groupId,
        requestedActivityIds,
        actualActivityIds
    };
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

async function createMemberBookingFromSourceBooking({
    db = defaultPool,
    sourceBookingId,
    memberBooking,
    booking,
    role = 'kitchen',
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null,
    banquetContext = null
} = {}) {
    const cleanSourceId = cleanId(sourceBookingId);
    const normalizedRole = normalizeAtomicMemberBookingRole(role);
    const inputBooking = memberBooking || booking;
    const context = businessContext || DEFAULT_TIMELINE_CONTEXT;
    if (!cleanSourceId) {
        throw new BanquetGroupError('sourceBookingId is required', { status: 400, code: 'SOURCE_BOOKING_REQUIRED' });
    }
    if (!normalizedRole) {
        throw new BanquetGroupError('Invalid member booking role', { status: 400, code: 'INVALID_MEMBER_BOOKING_ROLE' });
    }
    if (!inputBooking || typeof inputBooking !== 'object') {
        throw new BanquetGroupError('member booking payload is required', { status: 400, code: 'MEMBER_BOOKING_REQUIRED' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const source = await getScopedBookingForUpdate(client, cleanSourceId, context);
        if (!source) {
            throw new BanquetGroupError('Source booking not found', { status: 404, code: 'SOURCE_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, source);
        assertRootBooking(source, 'SOURCE_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(source);

        const sourceFields = resolveSourceBanquetAnchorFields(source);
        resolveAtomicBanquetCustomerId(inputBooking, {
            sourceBooking: source,
            group: { customer_id: sourceFields.customerId, id: null }
        });

        let group = null;
        let createdGroup = false;
        const existingMembership = await getMembershipForBooking(client, cleanSourceId, context);
        if (existingMembership) {
            group = await getGroupByIdForUpdate(client, existingMembership.group_id, context);
            if (!group) {
                throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
            }
            if (String(group.status || 'active').toLowerCase() !== 'active') {
                throw new BanquetGroupError('Banquet group is not active', { status: 409, code: 'BANQUET_GROUP_INACTIVE' });
            }
        } else {
            group = await getGroupByPrimaryBookingForUpdate(client, cleanSourceId, context);
            if (group && String(group.status || 'active').toLowerCase() !== 'active') {
                throw new BanquetGroupError('Banquet group is not active', { status: 409, code: 'BANQUET_GROUP_INACTIVE' });
            }
            if (!group) {
                const created = await createBanquetGroupInTransaction({
                    db: client,
                    primaryBooking: source,
                    primaryBookingId: cleanSourceId,
                    businessContext: context,
                    user,
                    groupName: sourceFields.groupName,
                    source: 'activity_first_kitchen_bridge',
                    meta: {
                        sourceBookingId: cleanSourceId,
                        rule: 'activity_first_kitchen_bridge'
                    },
                    banquetContext
                });
                group = created.groupRow;
                createdGroup = true;
            } else {
                await client.query(
                    `INSERT INTO banquet_group_bookings
                        (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
                     VALUES ($1, $2, $3, 'primary', 10, $4, $5)
                     RETURNING *`,
                    [group.id, context, cleanSourceId, actorUserId(user), actorName(user)]
                );
            }
        }

        const cleanGroupId = cleanId(group.id);
        const primaryBookingId = cleanId(group.primary_booking_id) || cleanSourceId;
        const primary = primaryBookingId === cleanSourceId
            ? source
            : await getScopedBookingForUpdate(client, primaryBookingId, context);
        if (!primary) {
            throw new BanquetGroupError('Primary booking not found', { status: 409, code: 'PRIMARY_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, primary);
        assertRootBooking(primary, 'PRIMARY_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(primary);

        const rootMember = normalizeRootMemberBooking(inputBooking, {
            sourceBooking: source,
            group,
            businessContext: context,
            user,
            role: normalizedRole
        });
        assertCreateMemberBookingPayload(rootMember, normalizedRole);
        applyBookingPackage(rootMember);
        await applyBookingPackageEntryCharge(client, rootMember, {
            businessContext: context,
            sourceBooking: source,
            primaryBooking: primary
        });
        await assertMemberRoomSlotAvailable(client, rootMember, context, {
            groupId: cleanGroupId,
            sourceBookingId: cleanSourceId
        });

        const memberRow = await insertRootMemberBooking(client, rootMember, context);
        const membershipResult = await client.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                cleanGroupId,
                context,
                memberRow.id,
                normalizedRole,
                memberBookingSortOrderFor(normalizedRole),
                actorUserId(user),
                actorName(user)
            ]
        );
        const link = await upsertCompatibilityLink(
            client,
            context,
            primaryBookingId,
            memberRow.id,
            group.group_name || rootMember.label || rootMember.programName,
            user
        );
        const managerDepositResult = await syncManagerDepositForMemberBooking(client, inputBooking, memberRow, context, user);
        await client.query(
            `UPDATE banquet_groups
                SET updated_at = NOW(), updated_by = $3
              WHERE id = $1
                AND ${bookingContextSql('', '$2')}`,
            [cleanGroupId, context, actorName(user)]
        );

        await logBanquetHistory(client, context, 'create', user, mapBookingRow(memberRow));
        await logBanquetHistory(client, context, 'banquet_group_member_booking_created', user, {
            group_id: cleanGroupId,
            source_booking_id: cleanSourceId,
            primary_booking_id: primaryBookingId,
            booking_id: memberRow.id,
            role: normalizedRole,
            compatibility_link_id: link?.id || null,
            created_group: createdGroup
        });

        const snapshot = await loadBanquetGroupById({ db: client, groupId: cleanGroupId, businessContext: context });
        await client.query('COMMIT');

        const mappedBooking = mapBookingRow(memberRow);
        mappedBooking.serverVerified = true;
        if (managerDepositResult?.projection) mappedBooking.banquetDeposit = managerDepositResult.projection;
        return {
            success: true,
            createdGroup,
            booking: mappedBooking,
            group: mapGroupRow(group),
            membership: mapMembershipRow(membershipResult.rows[0]),
            compatibilityLink: mapLegacyLinkRow({
                ...link,
                business_context: context
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

async function createActivityBookingFromSourceBooking({
    db = defaultPool,
    sourceBookingId,
    activityBooking,
    booking,
    linkedBookings = [],
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null,
    banquetContext = null
} = {}) {
    const cleanSourceId = cleanId(sourceBookingId);
    const inputBooking = activityBooking || booking;
    const context = businessContext || DEFAULT_TIMELINE_CONTEXT;
    if (!cleanSourceId) {
        throw new BanquetGroupError('sourceBookingId is required', { status: 400, code: 'SOURCE_BOOKING_REQUIRED' });
    }
    if (!inputBooking || typeof inputBooking !== 'object') {
        throw new BanquetGroupError('activity booking payload is required', { status: 400, code: 'ACTIVITY_BOOKING_REQUIRED' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const source = await getScopedBookingForUpdate(client, cleanSourceId, context);
        if (!source) {
            throw new BanquetGroupError('Source booking not found', { status: 404, code: 'SOURCE_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, source);
        assertRootBooking(source, 'SOURCE_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(source);

        const sourceFields = resolveSourceBanquetAnchorFields(source);
        resolveAtomicBanquetCustomerId(inputBooking, {
            sourceBooking: source,
            group: { customer_id: sourceFields.customerId, id: null }
        });

        let group = null;
        let createdGroup = false;
        const existingMembership = await getMembershipForBooking(client, cleanSourceId, context);
        if (existingMembership) {
            group = await getGroupByIdForUpdate(client, existingMembership.group_id, context);
            if (!group) {
                throw new BanquetGroupError('Banquet group not found', { status: 404, code: 'BANQUET_GROUP_NOT_FOUND' });
            }
            if (String(group.status || 'active').toLowerCase() !== 'active') {
                throw new BanquetGroupError('Banquet group is not active', { status: 409, code: 'BANQUET_GROUP_INACTIVE' });
            }
        } else {
            group = await getGroupByPrimaryBookingForUpdate(client, cleanSourceId, context);
            if (group && String(group.status || 'active').toLowerCase() !== 'active') {
                throw new BanquetGroupError('Banquet group is not active', { status: 409, code: 'BANQUET_GROUP_INACTIVE' });
            }
            if (!group) {
                const created = await createBanquetGroupInTransaction({
                    db: client,
                    primaryBooking: source,
                    primaryBookingId: cleanSourceId,
                    businessContext: context,
                    user,
                    groupName: sourceFields.groupName,
                    source: 'kitchen_first_activity_bridge',
                    meta: {
                        sourceBookingId: cleanSourceId,
                        rule: 'kitchen_first_activity_bridge'
                    },
                    banquetContext
                });
                group = created.groupRow;
                createdGroup = true;
            } else {
                await client.query(
                    `INSERT INTO banquet_group_bookings
                        (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
                     VALUES ($1, $2, $3, 'primary', 10, $4, $5)
                     RETURNING *`,
                    [group.id, context, cleanSourceId, actorUserId(user), actorName(user)]
                );
            }
        }

        const cleanGroupId = cleanId(group.id);
        const primaryBookingId = cleanId(group.primary_booking_id) || cleanSourceId;
        const primary = primaryBookingId === cleanSourceId
            ? source
            : await getScopedBookingForUpdate(client, primaryBookingId, context);
        if (!primary) {
            throw new BanquetGroupError('Primary booking not found', { status: 409, code: 'PRIMARY_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, primary);
        assertRootBooking(primary, 'PRIMARY_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(primary);

        const rootActivity = normalizeRootActivityBooking(inputBooking, {
            sourceBooking: source,
            group,
            businessContext: context,
            user
        });
        rootActivity.extraData.banquetGroup.source = 'kitchen_first_activity_bridge';
        assertCreateActivityPayload(rootActivity);
        await assertActivitySlotAvailable(client, rootActivity, context, {
            groupId: cleanGroupId,
            sourceBookingId: cleanSourceId
        });

        const activityRow = await insertRootActivityBooking(client, rootActivity, context);
        const linkedRows = [];
        for (const item of Array.isArray(linkedBookings) ? linkedBookings : []) {
            const child = normalizeLinkedActivityBooking(item, { ...rootActivity, id: activityRow.id }, { businessContext: context, user });
            if (!child.extraData) child.extraData = {};
            child.extraData.banquetGroup = {
                ...(child.extraData.banquetGroup || {}),
                source: 'kitchen_first_activity_bridge'
            };
            assertCreateActivityPayload(child);
            const childConflict = await checkServerConflicts(client, child.date, child.lineId, child.time, child.duration || 0, null, context);
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
            const childRow = await insertLinkedActivityChildBooking(client, child, activityRow.id, context);
            if (childRow) linkedRows.push(childRow);
        }

        const membershipResult = await client.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
             VALUES ($1, $2, $3, 'activity', 100, $4, $5)
             RETURNING *`,
            [
                cleanGroupId,
                context,
                activityRow.id,
                actorUserId(user),
                actorName(user)
            ]
        );
        const link = await upsertCompatibilityLink(
            client,
            context,
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
            [cleanGroupId, context, actorName(user)]
        );

        await logBanquetHistory(client, context, 'create', user, mapBookingRow(activityRow));
        await logBanquetHistory(client, context, 'banquet_group_activity_booking_created', user, {
            group_id: cleanGroupId,
            source_booking_id: cleanSourceId,
            primary_booking_id: primaryBookingId,
            booking_id: activityRow.id,
            linked_booking_ids: linkedRows.map(row => row.id),
            compatibility_link_id: link?.id || null,
            created_group: createdGroup
        });

        const snapshot = await loadBanquetGroupById({ db: client, groupId: cleanGroupId, businessContext: context });
        await client.query('COMMIT');

        const mappedBooking = mapBookingRow(activityRow);
        mappedBooking.serverVerified = true;
        const mappedLinked = linkedRows.map(row => {
            const mapped = mapBookingRow(row);
            mapped.serverVerified = true;
            return mapped;
        });
        return {
            success: true,
            createdGroup,
            booking: mappedBooking,
            linkedBookings: mappedLinked,
            group: mapGroupRow(group),
            membership: mapMembershipRow(membershipResult.rows[0]),
            compatibilityLink: mapLegacyLinkRow({
                ...link,
                business_context: context
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

async function createMemberBookingInBanquetGroup({
    db = defaultPool,
    groupId,
    sourceBookingId = null,
    memberBooking,
    booking,
    role = 'kitchen',
    businessContext = DEFAULT_TIMELINE_CONTEXT,
    user = null
} = {}) {
    const cleanGroupId = cleanId(groupId);
    const normalizedRole = normalizeAtomicMemberBookingRole(role);
    const inputBooking = memberBooking || booking;
    if (!cleanGroupId) {
        throw new BanquetGroupError('groupId is required', { status: 400, code: 'GROUP_ID_REQUIRED' });
    }
    if (!normalizedRole) {
        throw new BanquetGroupError('Invalid member booking role', { status: 400, code: 'INVALID_MEMBER_BOOKING_ROLE' });
    }
    if (!inputBooking || typeof inputBooking !== 'object') {
        throw new BanquetGroupError('member booking payload is required', { status: 400, code: 'MEMBER_BOOKING_REQUIRED' });
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

        const primary = await getScopedBookingForUpdate(client, primaryBookingId, businessContext);
        if (!primary) {
            throw new BanquetGroupError('Primary booking not found', { status: 409, code: 'PRIMARY_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, primary);
        assertRootBooking(primary, 'PRIMARY_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(primary);

        const cleanSourceId = cleanId(sourceBookingId) || primaryBookingId;
        const source = cleanSourceId === primaryBookingId
            ? primary
            : await getScopedBookingForUpdate(client, cleanSourceId, businessContext);
        if (!source) {
            throw new BanquetGroupError('Source booking not found', { status: 404, code: 'SOURCE_BOOKING_NOT_FOUND' });
        }
        assertEditableBooking(user, source);
        assertRootBooking(source, 'SOURCE_BOOKING_MUST_BE_ROOT');
        assertActiveBooking(source);

        if (cleanSourceId !== primaryBookingId) {
            const sourceMembership = await getMembershipInGroup(client, cleanGroupId, cleanSourceId, businessContext);
            if (!sourceMembership) {
                throw new BanquetGroupError('Source booking is not attached to this banquet group', {
                    status: 409,
                    code: 'SOURCE_BOOKING_NOT_IN_GROUP',
                    details: { groupId: cleanGroupId, sourceBookingId: cleanSourceId }
                });
            }
        }

        const rootMember = normalizeRootMemberBooking(inputBooking, {
            sourceBooking: source,
            group,
            businessContext,
            user,
            role: normalizedRole
        });
        assertCreateMemberBookingPayload(rootMember, normalizedRole);
        applyBookingPackage(rootMember);
        await applyBookingPackageEntryCharge(client, rootMember, {
            businessContext,
            sourceBooking: source,
            primaryBooking: primary
        });
        await assertMemberRoomSlotAvailable(client, rootMember, businessContext, {
            groupId: cleanGroupId,
            sourceBookingId: cleanSourceId
        });

        const memberRow = await insertRootMemberBooking(client, rootMember, businessContext);
        const membershipResult = await client.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by_user_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                cleanGroupId,
                businessContext || DEFAULT_TIMELINE_CONTEXT,
                memberRow.id,
                normalizedRole,
                memberBookingSortOrderFor(normalizedRole),
                actorUserId(user),
                actorName(user)
            ]
        );
        const link = await upsertCompatibilityLink(
            client,
            businessContext,
            primaryBookingId,
            memberRow.id,
            group.group_name || rootMember.label || rootMember.programName,
            user
        );
        const managerDepositResult = await syncManagerDepositForMemberBooking(client, inputBooking, memberRow, businessContext, user);
        await client.query(
            `UPDATE banquet_groups
                SET updated_at = NOW(), updated_by = $3
              WHERE id = $1
                AND ${bookingContextSql('', '$2')}`,
            [cleanGroupId, businessContext || DEFAULT_TIMELINE_CONTEXT, actorName(user)]
        );

        await logBanquetHistory(client, businessContext, 'create', user, mapBookingRow(memberRow));
        await logBanquetHistory(client, businessContext, 'banquet_group_member_booking_created', user, {
            group_id: cleanGroupId,
            source_booking_id: cleanSourceId,
            primary_booking_id: primaryBookingId,
            booking_id: memberRow.id,
            role: normalizedRole,
            compatibility_link_id: link?.id || null
        });

        const snapshot = await loadBanquetGroupById({ db: client, groupId: cleanGroupId, businessContext });
        await client.query('COMMIT');

        const mappedBooking = mapBookingRow(memberRow);
        mappedBooking.serverVerified = true;
        if (managerDepositResult?.projection) mappedBooking.banquetDeposit = managerDepositResult.projection;
        return {
            success: true,
            booking: mappedBooking,
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
        await assertActivitySlotAvailable(client, rootActivity, businessContext, {
            groupId: cleanGroupId,
            sourceBookingId: cleanSourceId
        });

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
    auditBanquetGuestArrival,
    buildBanquetGuestArrivalAudit,
    createActivityBookingFromSourceBooking,
    createActivityBookingInBanquetGroup,
    createBanquetGroup,
    createBanquetGroupInTransaction,
    createMemberBookingFromSourceBooking,
    createMemberBookingInBanquetGroup,
    detachBookingFromBanquetGroup,
    loadBanquetGroupCandidates,
    loadBanquetGroupByBookingId,
    loadBanquetGroupById,
    persistDerivedBookingSetMetadata,
    reconcileBanquetGroupForBooking,
    resolveBanquetArrivalBackfillCandidate,
    updateBanquetBookingSet,
    updateBanquetGuestArrival,
    validateSingleBookingActivitySetUpdate,
    isKitchenCandidate
};
