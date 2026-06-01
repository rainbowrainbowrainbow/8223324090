/**
 * routes/bookings.js — Booking CRUD endpoints
 */
const router = require('express').Router();
const { pool, generateBookingNumber } = require('../db');
const { validateDate, validateTime, validateId, mapBookingRow, checkServerConflicts, checkServerDuplicate, checkRoomConflict, timeToMinutes } = require('../services/booking');
const { normalizePinataFields } = require('../services/pinataMode');
const { notifyTelegram } = require('../services/telegram');
const { processBookingAutomation } = require('../services/bookingAutomation');
const { attachLeadBookingLink, ensureLeadForBooking } = require('../services/leadBookingLink');
const { applyBookingPackage, bookingPackageAudit } = require('../services/bookingPackage');
const { broadcast } = require('../services/websocket');
const { publish: publishEvent } = require('../services/eventBus');
const {
    DEFAULT_TIMELINE_CONTEXT,
    timelineContextFromRequest,
    requireTimelineContext,
    requireTimelineAction
} = require('../services/timelineContext');
const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('../services/businessContext');
const { normalizeCustomerSource } = require('../services/customerSource');
const {
    findTimelineResource,
    findTimelineResourceByName,
    getTimelineDisplaySettings,
    resourceTypeForDisplayMode
} = require('../services/timelineResources');
const {
    bookingAccessDeniedPayload,
    buildBookingVisibilityScope,
    canEditBooking,
    canViewBooking
} = require('../services/bookingVisibility');
let _triggerAlertBroadcast;
try { _triggerAlertBroadcast = require('./dashboard').triggerAlertBroadcast; } catch {}
function _alertPush() { if (_triggerAlertBroadcast) _triggerAlertBroadcast(); }
const { createLogger } = require('../utils/logger');

const { requireAction, authenticateToken } = require('../middleware/auth');
const log = createLogger('Bookings');

// v39.8: Security — require authentication for all booking endpoints
router.use(authenticateToken);

function bookingContextSql(alias = '', placeholder = '$1') {
    const column = alias ? `${alias}.business_context` : 'business_context';
    return `COALESCE(${column}, '${DEFAULT_TIMELINE_CONTEXT}') = ${placeholder}`;
}

async function getScopedBookingById(queryable, id, businessContext, { forUpdate = false } = {}) {
    const result = await queryable.query(
        `SELECT * FROM bookings WHERE id = $1 AND ${bookingContextSql('', '$2')}${forUpdate ? ' FOR UPDATE' : ''}`,
        [id, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows[0] || null;
}

function sendBookingDenied(req, res, booking) {
    if (!canViewBooking(req.user, booking)) {
        return res.status(404).json(bookingAccessDeniedPayload());
    }
    return res.status(403).json({ success: false, error: 'Insufficient booking permissions' });
}

async function bookingDayProjectionStatus(queryable, { id, date, businessContext, user }) {
    const projectedDate = String(date || '').slice(0, 10);
    const projectedContext = businessContext || DEFAULT_TIMELINE_CONTEXT;
    const params = [projectedDate, projectedContext, id];
    const visibility = buildBookingVisibilityScope(user, params, 'b');
    try {
        const result = await queryable.query(
            `SELECT b.id
               FROM bookings b
              WHERE b.date = $1
                AND ${bookingContextSql('b', '$2')}
                AND b.id = $3
                AND b.status != 'cancelled'
                ${visibility}
              LIMIT 1`,
            params
        );
        return {
            date: projectedDate,
            businessContext: projectedContext,
            visible: result.rowCount > 0
        };
    } catch (err) {
        log.warn(`Timeline day projection check failed for booking ${id}: ${err.message}`);
        return {
            date: projectedDate,
            businessContext: projectedContext,
            visible: null,
            error: 'projection_check_failed'
        };
    }
}

async function runOptionalBookingTransactionStep(client, label, step) {
    await client.query('SAVEPOINT booking_optional_step');
    try {
        const result = await step();
        await client.query('RELEASE SAVEPOINT booking_optional_step');
        return result;
    } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT booking_optional_step')
            .catch(rbErr => log.error(`Rollback to optional booking savepoint failed (${label})`, rbErr));
        await client.query('RELEASE SAVEPOINT booking_optional_step')
            .catch(relErr => log.error(`Release optional booking savepoint failed (${label})`, relErr));
        log.warn(`${label} failed (non-critical): ${err.message}`);
        return null;
    }
}

async function commitBookingTransaction(client, label) {
    const result = await client.query('COMMIT');
    const command = String(result?.command || 'COMMIT').toUpperCase();
    if (command !== 'COMMIT') {
        const err = new Error(`${label} transaction was not committed; PostgreSQL returned ${command}`);
        err.statusCode = 500;
        err.code = 'booking_commit_not_verified';
        err.publicMessage = 'Сервер не підтвердив збереження бронювання. Спробуйте ще раз або зверніться до адміністратора.';
        throw err;
    }
    return result;
}

async function assertDurableCreatedBookings(queryable, ids, businessContext, label) {
    const orderedIds = Array.from(new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean)));
    if (!orderedIds.length) {
        const err = new Error(`${label} did not produce booking ids`);
        err.statusCode = 500;
        err.code = 'booking_missing_created_ids';
        err.publicMessage = 'Сервер не повернув номер створеного бронювання. Таймлайн не оновлено.';
        throw err;
    }
    const result = await queryable.query(
        `SELECT *
           FROM bookings b
          WHERE b.id = ANY($1::text[])
            AND ${bookingContextSql('b', '$2')}
            AND b.status != 'cancelled'`,
        [orderedIds, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    const rowsById = new Map(result.rows.map(row => [String(row.id), row]));
    const missingIds = orderedIds.filter(id => !rowsById.has(id));
    if (missingIds.length) {
        const err = new Error(`${label} was not durably visible after commit: ${missingIds.join(', ')}`);
        err.statusCode = 500;
        err.code = 'booking_durable_read_missing';
        err.publicMessage = 'Бронювання не підтвердилось у базі після збереження. Таймлайн не оновлено, щоб не показати фальшивий запис.';
        err.missingBookingIds = missingIds;
        throw err;
    }
    return orderedIds.map(id => rowsById.get(id));
}

function crmSideEffectsAllowedForContext(context) {
    return Boolean(normalizeBusinessContext(context || DEFAULT_BUSINESS_CONTEXT));
}

function parkSideEffectsAllowedForContext(context) {
    return (context || DEFAULT_TIMELINE_CONTEXT) === DEFAULT_TIMELINE_CONTEXT;
}

function sideEffectsAllowedForContext(context) {
    return crmSideEffectsAllowedForContext(context);
}

function bookingLeadAutoCreateAllowedForContext(context) {
    return sideEffectsAllowedForContext(context) && (context || DEFAULT_TIMELINE_CONTEXT) !== DEFAULT_TIMELINE_CONTEXT;
}

function hasBookingLeadIdentity(booking, customerId) {
    const customer = booking?.customer || {};
    return Boolean(
        customerId
        || String(customer.name || '').trim()
        || String(customer.phone || '').trim()
        || String(customer.instagram || '').trim()
    );
}

async function syncBookingLeadHandoff(client, booking, customerId, businessContext, label = 'Lead booking handoff') {
    if (!booking || booking.linkedTo || !sideEffectsAllowedForContext(businessContext)) return null;
    if (!booking.leadId && (!bookingLeadAutoCreateAllowedForContext(businessContext) || !hasBookingLeadIdentity(booking, customerId))) {
        return null;
    }
    return runOptionalBookingTransactionStep(client, label, async () => {
        if (booking.leadId) {
            return attachLeadBookingLink(client, {
                leadId: booking.leadId,
                bookingId: booking.id,
                customerId,
                businessContext
            });
        }
        const leadLink = await ensureLeadForBooking(client, {
            booking,
            customerId,
            businessContext
        });
        if (leadLink?.attached) {
            booking.leadId = leadLink.leadId;
        }
        return leadLink;
    });
}

// Resolve animator line name for notifications
async function getLineName(lineId, date, businessContext = DEFAULT_TIMELINE_CONTEXT) {
    try {
        const result = await pool.query(
            `SELECT name FROM lines_by_date WHERE line_id = $1 AND date = $2 AND ${bookingContextSql('', '$3')}`,
            [lineId, date, businessContext || DEFAULT_TIMELINE_CONTEXT]
        );
        return result.rows[0]?.name || null;
    } catch (err) {
        log.error(`Failed to get line name: ${err.message}`);
        return null;
    }
}

const PARK_FALLBACK_LINE_COLORS = ['#10B981', '#3B82F6', '#F97316', '#06B6D4', '#84CC16', '#EC4899', '#64748B', '#8B5CF6'];

function staffAnimatorWhere(alias = 's') {
    return `(
        ${alias}.role_type = 'animator'
        OR ${alias}.department = 'animators'
        OR LOWER(COALESCE(${alias}.position, '')) LIKE '%animator%'
        OR LOWER(COALESCE(${alias}.position, '')) LIKE '%аніматор%'
    )`;
}

function fallbackLineColor(value) {
    const numeric = Math.abs(parseInt(value, 10) || 0);
    return PARK_FALLBACK_LINE_COLORS[numeric % PARK_FALLBACK_LINE_COLORS.length];
}

async function ensureParkAnimatorLine(client, { businessContext, date, lineId, name }) {
    const context = businessContext || DEFAULT_TIMELINE_CONTEXT;
    if (context !== DEFAULT_TIMELINE_CONTEXT) return null;

    const safeDate = String(date || '').trim();
    const requestedLineId = String(lineId || '').trim();
    const requestedName = String(name || '').trim();
    if (!safeDate || (!requestedLineId && !requestedName)) return null;

    const existing = await client.query(
        `SELECT line_id, name, color
           FROM lines_by_date
          WHERE date = $1
            AND ${bookingContextSql('', '$2')}
            AND (
                ($3 <> '' AND line_id = $3)
                OR ($4 <> '' AND LOWER(BTRIM(name)) = LOWER(BTRIM($4)))
            )
          ORDER BY CASE WHEN line_id = $3 THEN 0 ELSE 1 END
          LIMIT 1`,
        [safeDate, context, requestedLineId, requestedName]
    );
    if (existing.rows[0]) {
        return {
            lineId: existing.rows[0].line_id,
            name: existing.rows[0].name,
            color: existing.rows[0].color
        };
    }

    const staff = await client.query(
        `SELECT id, name, display_name, color
           FROM staff s
          WHERE s.is_active = true
            AND ${staffAnimatorWhere('s')}
            AND (
                ($1 <> '' AND s.id::text = $1)
                OR ($2 <> '' AND LOWER(BTRIM(s.name)) = LOWER(BTRIM($2)))
                OR ($2 <> '' AND LOWER(BTRIM(COALESCE(s.display_name, ''))) = LOWER(BTRIM($2)))
            )
          ORDER BY CASE WHEN s.id::text = $1 THEN 0 ELSE 1 END, s.name
          LIMIT 1`,
        [requestedLineId, requestedName]
    );
    const row = staff.rows[0];
    if (!row) return null;

    const resolvedLineId = String(row.id);
    const resolvedName = row.display_name || row.name;
    const color = row.color || fallbackLineColor(row.id);
    await client.query(
        `INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (business_context, date, line_id)
         DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color`,
        [context, safeDate, resolvedLineId, resolvedName, color]
    );

    return { lineId: resolvedLineId, name: resolvedName, color };
}

async function visibleLineByDate(queryable, { businessContext, date, lineId }) {
    const safeDate = String(date || '').trim();
    const safeLineId = String(lineId || '').trim();
    if (!safeDate || !safeLineId) return null;

    const result = await queryable.query(
        `SELECT line_id, name, color
           FROM lines_by_date
          WHERE date = $1
            AND ${bookingContextSql('', '$2')}
            AND line_id = $3
          LIMIT 1`,
        [safeDate, businessContext || DEFAULT_TIMELINE_CONTEXT, safeLineId]
    );
    const row = result.rows[0];
    return row ? { lineId: row.line_id, name: row.name, color: row.color, source: 'lines_by_date' } : null;
}

function ensureBookingExtraDataObject(booking) {
    if (!booking) return {};
    if (booking.extraData && typeof booking.extraData === 'object' && !Array.isArray(booking.extraData)) return booking.extraData;
    if (typeof booking.extraData === 'string' && booking.extraData.trim()) {
        try {
            const parsed = JSON.parse(booking.extraData);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                booking.extraData = parsed;
                return booking.extraData;
            }
        } catch {}
    }
    booking.extraData = {};
    return booking.extraData;
}

function attachTimelineIdentityToBooking(booking, identity = {}) {
    const extra = ensureBookingExtraDataObject(booking);
    extra.timelineIdentity = {
        businessContext: identity.businessContext || booking.businessContext || DEFAULT_TIMELINE_CONTEXT,
        resourceId: identity.resourceId || identity.lineId || booking.lineId || null,
        resourceType: identity.resourceType || identity.type || null,
        resourceName: identity.resourceName || identity.name || booking.lineName || booking.room || null,
        source: identity.source || null
    };
    return extra.timelineIdentity;
}

async function ensureBookingTimelineLine(client, booking, businessContext, { name = null } = {}) {
    if (!booking || !booking.date || !booking.lineId) return null;

    const display = await getTimelineDisplaySettings(client, businessContext);
    const resourceType = resourceTypeForDisplayMode(display.mode, display);

    if (resourceType) {
        const resource = await resolveBookingTimelineResource(client, {
            ...booking,
            lineName: name || booking.lineName || booking.resourceName || booking.room
        }, businessContext, { type: resourceType });
        if (!resource || resource.type !== resourceType) return null;
        booking.lineId = resource.resourceId;
        booking.resourceId = resource.resourceId;
        booking.resourceType = resource.type;
        if (!String(booking.room || '').trim()) booking.room = resource.name;
        attachTimelineIdentityToBooking(booking, {
            businessContext,
            resourceId: resource.resourceId,
            resourceType: resource.type,
            resourceName: resource.name,
            source: 'timeline_resource'
        });
        return {
            lineId: String(booking.lineId),
            name: resource.name,
            color: resource.color,
            source: 'timeline_resource'
        };
    }

    const existingLine = await visibleLineByDate(client, {
        businessContext,
        date: booking.date,
        lineId: booking.lineId
    });
    if (existingLine) {
        attachTimelineIdentityToBooking(booking, {
            businessContext,
            lineId: existingLine.lineId,
            resourceType: businessContext === DEFAULT_TIMELINE_CONTEXT ? 'animator' : 'specialist',
            resourceName: existingLine.name,
            source: existingLine.source
        });
        return existingLine;
    }

    const ensuredLine = await ensureParkAnimatorLine(client, {
        businessContext,
        date: booking.date,
        lineId: booking.lineId,
        name
    });
    if (!ensuredLine) return null;

    booking.lineId = ensuredLine.lineId;
    attachTimelineIdentityToBooking(booking, {
        businessContext,
        lineId: ensuredLine.lineId,
        resourceType: businessContext === DEFAULT_TIMELINE_CONTEXT ? 'animator' : 'specialist',
        resourceName: ensuredLine.name,
        source: 'staff_animator'
    });
    return { ...ensuredLine, source: 'staff_animator' };
}

function bookingLineUnavailablePayload() {
    return {
        success: false,
        error: 'Лінію для бронювання не знайдено в поточному таймлайні. Оновіть сторінку і оберіть лінію ще раз.',
        code: 'booking_line_not_visible'
    };
}

const CONFIRMATION_SOURCES = new Set([
    'booking_panel',
    'dashboard',
    'lead_workspace',
    'queue',
    'alerts',
    'api'
]);

function actorUserId(user) {
    const id = Number(user?.id || 0);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeConfirmationSource(source) {
    const value = String(source || 'api').trim().toLowerCase();
    return CONFIRMATION_SOURCES.has(value) ? value : 'api';
}

function normalizeConfirmationNote(note) {
    if (note === undefined || note === null) return null;
    const value = String(note).trim();
    return value ? value.slice(0, 1000) : null;
}

function applyPinataNormalization(booking) {
    const normalized = normalizePinataFields(booking);
    if (normalized.error) return normalized;

    booking.pinataMode = normalized.pinataMode;
    booking.pinataNumber = normalized.pinataNumber;
    booking.pinataFillerNumber = normalized.pinataFillerNumber;
    booking.pinataFiller = normalized.pinataFiller;
    booking.clientPinataServicePrice = normalized.clientPinataServicePrice;
    booking.clientPinataServiceNote = normalized.clientPinataServiceNote;

    if (normalized.pinataMode === 'client') {
        booking.price = normalized.clientPinataServicePrice ?? 0;
    } else if (normalized.pinataMode === 'none'
        && (booking.category === 'pinata' || String(booking.programId || booking.program_id || '').startsWith('pinata'))) {
        booking.price = 0;
    }

    return normalized;
}

async function insertBookingConfirmationHistory(client, { booking, actor, source, note, confirmedAt }) {
    await client.query(
        'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
        ['booking_confirmed', actor?.username, JSON.stringify({
            entity_type: 'booking',
            entity_id: booking.id,
            business_context: booking.business_context || DEFAULT_TIMELINE_CONTEXT,
            action_type: 'booking_confirmed',
            actor_user_id: actorUserId(actor),
            meta: {
                from_status: 'preliminary',
                to_status: 'confirmed',
                source,
                note,
                confirmed_at: confirmedAt || booking.confirmed_at || null
            }
        })]
    );
}

function bookingNotificationPayload(row) {
    const mapped = mapBookingRow(row);
    return {
        ...mapped,
        program_code: mapped.programCode,
        program_name: mapped.programName,
        kids_count: mapped.kidsCount,
        created_by: mapped.createdBy
    };
}

function runBookingConfirmationSideEffects(row, actor, source, updatedRows = []) {
    const booking = mapBookingRow(row);
    const username = actor?.username;
    const notifyPayload = bookingNotificationPayload(row);
    const notifyCatch = err => log.error(`Telegram notify failed (confirm): ${err.message}`);

    getLineName(booking.lineId, booking.date, booking.businessContext || DEFAULT_TIMELINE_CONTEXT)
        .then(lineName => notifyTelegram('create', notifyPayload, {
            username,
            bookingId: booking.id,
            lineName,
            businessContext: booking.businessContext || DEFAULT_TIMELINE_CONTEXT
        }).catch(notifyCatch))
        .catch(notifyCatch);

    processBookingAutomation({ ...booking, _event: 'confirm' })
        .catch(err => log.error(`Automation failed (confirm): ${err.message}`));

    const broadcastRows = updatedRows.length ? updatedRows : [row];
    for (const updatedRow of broadcastRows) {
        const updatedBooking = mapBookingRow(updatedRow);
        broadcast('booking:updated', updatedBooking, actor?.id?.toString(), updatedBooking.date);
    }
    _alertPush();

    publishEvent('booking.confirmed', {
        booking_id: booking.id,
        business_context: booking.businessContext || DEFAULT_TIMELINE_CONTEXT,
        date: booking.date,
        time: booking.time,
        room: booking.room,
        program_code: booking.programCode,
        old_status: 'preliminary',
        new_status: 'confirmed',
        updated_by: username,
        confirmation_source: source
    }, `booking_confirmed_${booking.id}_${Date.now()}`);
}

const ATOMIC_LINKED_FIELDS = new Map([
    ['date', 'date'],
    ['time', 'time'],
    ['lineId', 'line_id'],
    ['duration', 'duration']
]);

const ATOMIC_LINKED_HISTORY_ACTIONS = new Set([
    'drag', 'undo_drag',
    'resize', 'undo_resize',
    'shift', 'undo_shift'
]);

const BANQUET_LINK_RELATION_TYPE = 'banquet_activity';

function normalizeBanquetLinkPair(sourceId, targetId) {
    const a = String(sourceId || '').trim();
    const b = String(targetId || '').trim();
    if (!a || !b || a === b) return null;
    return a < b ? [a, b] : [b, a];
}

function mapBanquetLinkRow(row, relativeBookingId = null) {
    const bookingA = row.booking_a_id;
    const bookingB = row.booking_b_id;
    const targetId = relativeBookingId && String(relativeBookingId) === String(bookingA)
        ? bookingB
        : bookingA;
    return {
        id: row.id,
        bookingId: relativeBookingId || bookingA,
        targetId,
        bookingAId: bookingA,
        bookingBId: bookingB,
        relationType: row.relation_type || BANQUET_LINK_RELATION_TYPE,
        label: row.label || null,
        createdAt: row.created_at || null,
        createdBy: row.created_by || null
    };
}

async function attachBanquetLinksToBookings(bookings, businessContext) {
    if (!Array.isArray(bookings) || bookings.length === 0) return bookings;
    const ids = bookings.map(booking => booking.id).filter(Boolean);
    if (ids.length === 0) return bookings;

    const linksResult = await pool.query(
        `SELECT id, booking_a_id, booking_b_id, relation_type, label, created_at, created_by
           FROM booking_banquet_links
          WHERE business_context = $1
            AND relation_type = $2
            AND booking_a_id = ANY($3::text[])
            AND booking_b_id = ANY($3::text[])
          ORDER BY created_at ASC, id ASC`,
        [businessContext || DEFAULT_TIMELINE_CONTEXT, BANQUET_LINK_RELATION_TYPE, ids]
    );
    const byBooking = new Map(ids.map(id => [String(id), []]));
    linksResult.rows.forEach(row => {
        const a = String(row.booking_a_id);
        const b = String(row.booking_b_id);
        if (byBooking.has(a)) byBooking.get(a).push(mapBanquetLinkRow(row, a));
        if (byBooking.has(b)) byBooking.get(b).push(mapBanquetLinkRow(row, b));
    });
    return bookings.map(booking => ({
        ...booking,
        banquetLinks: byBooking.get(String(booking.id)) || []
    }));
}

function pickAtomicLinkedPatch(input) {
    const patch = {};
    if (!input || typeof input !== 'object') return patch;
    for (const [apiField, dbField] of ATOMIC_LINKED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(input, apiField) && input[apiField] !== undefined) {
            patch[dbField] = apiField === 'duration' ? parseInt(input[apiField], 10) : input[apiField];
        }
    }
    return patch;
}

function buildAtomicLinkedCandidate(row, patch = {}) {
    return {
        id: row.id,
        business_context: row.business_context || DEFAULT_TIMELINE_CONTEXT,
        date: Object.prototype.hasOwnProperty.call(patch, 'date') ? patch.date : row.date,
        time: Object.prototype.hasOwnProperty.call(patch, 'time') ? patch.time : row.time,
        line_id: Object.prototype.hasOwnProperty.call(patch, 'line_id') ? patch.line_id : row.line_id,
        duration: Object.prototype.hasOwnProperty.call(patch, 'duration') ? patch.duration : row.duration,
        room: row.room,
        hosts: row.hosts,
        label: row.label,
        program_code: row.program_code,
        linked_to: row.linked_to,
        status: row.status
    };
}

function validateAtomicLinkedCandidate(candidate) {
    if (!validateDate(candidate.date)) return 'Invalid date format';
    if (!validateTime(candidate.time)) return 'Invalid time format';
    const duration = Number(candidate.duration);
    if (!Number.isFinite(duration) || duration < 0 || duration > 1440) return 'Duration must be between 0 and 1440 minutes';
    const start = timeToMinutes(candidate.time);
    if (start + duration > 1440) return 'Booking cannot exceed midnight';
    return null;
}

const NON_OPERATIONAL_ROOM_LABELS = new Set([
    'Інше',
    'Other',
    '\u0420\u2020\u0420\u0405\u0421\u20ac\u0420\u00b5' // Legacy mojibake for "Інше".
]);

function isRealRoom(room) {
    const normalizedRoom = String(room || '').trim();
    return Boolean(normalizedRoom && !NON_OPERATIONAL_ROOM_LABELS.has(normalizedRoom));
}

function requireBookingRoom(payload) {
    const room = String(payload?.room || '').trim();
    if (payload) payload.room = room;
    return room ? null : 'Оберіть кімнату';
}

async function hydrateBookingRoomFromTimelineResource(queryable, payload, businessContext) {
    if (!payload || String(payload.room || '').trim() || !payload.lineId) return payload;
    const resource = await resolveBookingTimelineResource(queryable, payload, businessContext, { includeInactive: true });
    if (resource && ['cabinet', 'specialist', 'online'].includes(resource.type)) {
        payload.room = resource.name;
        payload.resourceId = resource.resourceId;
        payload.resourceType = resource.type;
        payload.lineId = resource.resourceId;
    }
    return payload;
}

async function validateBookingTimelineResourceCapacity(queryable, payload, businessContext) {
    if (!payload || !payload.lineId) return null;
    const kidsCount = parseInt(payload.kidsCount ?? payload.kids_count, 10);
    if (!Number.isFinite(kidsCount) || kidsCount <= 0) return null;
    const resource = await resolveBookingTimelineResource(queryable, payload, businessContext, { includeInactive: true });
    if (!resource || !['cabinet', 'specialist', 'online'].includes(resource.type)) return null;
    const capacity = parseInt(resource.capacity, 10);
    if (!Number.isFinite(capacity) || capacity <= 0 || kidsCount <= capacity) return null;
    return {
        resource,
        error: `${resource.name} має місткість ${capacity}, а в записі ${kidsCount}`
    };
}

async function resolveBookingTimelineResource(queryable, payload, businessContext, options = {}) {
    if (!payload) return null;
    const type = options.type || payload.resourceType || payload.resource_type || null;
    const queryOptions = { includeInactive: options.includeInactive, ...(type ? { type } : {}) };
    let resource = null;
    if (payload.lineId) {
        resource = await findTimelineResource(queryable, businessContext, payload.lineId, queryOptions);
    }
    if (!resource) {
        const name = payload.lineName || payload.resourceName || payload.resource_name || payload.room || null;
        resource = await findTimelineResourceByName(queryable, businessContext, name, queryOptions);
    }
    return resource;
}

function educationLessonFromPayload(payload = {}) {
    const extra = payload.extraData || payload.extra_data || {};
    const lesson = extra.educationLesson
        || extra.education_lesson
        || extra.bookingWorkspace?.lesson
        || null;
    if (!lesson || typeof lesson !== 'object') return null;
    const teacherId = String(lesson.teacherId || '').trim();
    const teacherName = String(lesson.teacherName || '').trim();
    const title = String(lesson.title || payload.programName || payload.label || '').trim();
    const groupName = String(lesson.groupName || payload.groupName || '').trim();
    const courseCode = String(lesson.courseCode || '').trim();
    if (!teacherId && !teacherName && !title && !groupName && !courseCode && lesson.mode !== 'education_lesson') return null;
    return {
        ...lesson,
        teacherId,
        teacherName,
        title: String(title || 'Заняття').trim()
    };
}

function overlapsBookingTime(candidate, other) {
    const start = timeToMinutes(candidate.time);
    const end = start + (parseInt(candidate.duration, 10) || 0);
    const otherStart = timeToMinutes(other.time);
    const otherEnd = otherStart + (parseInt(other.duration, 10) || 0);
    return start < otherEnd && end > otherStart;
}

async function validateEducationLessonTeacherConflict(queryable, payload, businessContext, excludeIds = []) {
    const lesson = educationLessonFromPayload(payload);
    if (!lesson || !payload?.date || !payload?.time || !(parseInt(payload.duration, 10) > 0)) return null;
    const filters = [];
    const params = [
        payload.date,
        businessContext || DEFAULT_TIMELINE_CONTEXT,
        excludeIds.map(String)
    ];
    if (lesson.teacherId) {
        params.push(lesson.teacherId);
        filters.push(`COALESCE(extra_data->'educationLesson'->>'teacherId', extra_data->'education_lesson'->>'teacherId', extra_data->'bookingWorkspace'->'lesson'->>'teacherId') = $${params.length}`);
    }
    if (lesson.teacherName) {
        params.push(lesson.teacherName.toLowerCase());
        filters.push(`LOWER(COALESCE(extra_data->'educationLesson'->>'teacherName', extra_data->'education_lesson'->>'teacherName', extra_data->'bookingWorkspace'->'lesson'->>'teacherName', '')) = $${params.length}`);
    }
    if (!filters.length) return null;
    const result = await queryable.query(
        `SELECT id, time, duration, label, program_code, program_name, room, extra_data
         FROM bookings
         WHERE date = $1
           AND ${bookingContextSql('', '$2')}
           AND status != 'cancelled'
           AND id != ALL($3::text[])
           AND (${filters.join(' OR ')})`,
        params
    );
    const conflict = result.rows.find(row => overlapsBookingTime(payload, row));
    if (!conflict) return null;
    return {
        conflict,
        error: `Викладач "${lesson.teacherName || lesson.teacherId}" зайнятий: ${conflict.label || conflict.program_name || conflict.program_code} о ${conflict.time}`
    };
}

function normalizeEducationLessonRepeatEvery(value) {
    return ['daily', 'weekly', 'biweekly'].includes(value) ? value : 'weekly';
}

function educationLessonRepeatDays(value) {
    const normalized = normalizeEducationLessonRepeatEvery(value);
    if (normalized === 'daily') return 1;
    if (normalized === 'biweekly') return 14;
    return 7;
}

function addDaysToIsoDate(date, days) {
    const source = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(source.getTime())) return date;
    source.setUTCDate(source.getUTCDate() + days);
    return source.toISOString().slice(0, 10);
}

function educationSeriesId() {
    return `ELS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEducationSeriesId(value) {
    const id = String(value || '').trim();
    return /^[a-zA-Z0-9_.:-]{3,120}$/.test(id) ? id : null;
}

function educationSeriesSql(alias = 'b', placeholder = '$1') {
    const extra = alias ? `${alias}.extra_data` : 'extra_data';
    return `(
        ${extra}->'educationLesson'->>'seriesId' = ${placeholder}
        OR ${extra}->'bookingWorkspace'->'lesson'->>'seriesId' = ${placeholder}
        OR ${extra}->>'education_series_id' = ${placeholder}
    )`;
}

function cloneJson(value) {
    if (!value || typeof value !== 'object') return {};
    return JSON.parse(JSON.stringify(value));
}

function setEducationLessonExtra(payload, lesson) {
    const extraData = cloneJson(payload.extraData || payload.extra_data || {});
    extraData.educationLesson = lesson;
    if (!extraData.bookingWorkspace || typeof extraData.bookingWorkspace !== 'object') {
        extraData.bookingWorkspace = { source: 'booking_workspace_v2' };
    }
    extraData.bookingWorkspace.lesson = lesson;
    payload.extraData = extraData;
}

function buildEducationLessonSeriesCandidates(main, lesson) {
    const seriesSize = Math.max(2, Math.min(parseInt(lesson.seriesSize, 10) || 1, 120));
    const repeatEvery = normalizeEducationLessonRepeatEvery(lesson.repeatEvery);
    const stepDays = educationLessonRepeatDays(repeatEvery);
    const seriesId = educationSeriesId();
    const rootDate = main.date;
    const candidates = [];

    for (let index = 0; index < seriesSize; index += 1) {
        const candidate = {
            ...cloneJson(main),
            id: null,
            date: addDaysToIsoDate(rootDate, stepDays * index),
            linkedTo: null
        };
        const occurrenceLesson = {
            ...cloneJson(lesson),
            seriesId,
            seriesSize,
            seriesIndex: index + 1,
            repeatEvery,
            seriesRootDate: rootDate,
            seriesRootTime: main.time,
            source: 'education_lesson_series'
        };
        setEducationLessonExtra(candidate, occurrenceLesson);
        candidate.programName = occurrenceLesson.title || candidate.programName || candidate.label || 'Заняття';
        candidate.label = occurrenceLesson.lessonType === 'exam' ? 'Контроль' : 'Заняття';
        candidate.groupName = occurrenceLesson.groupName || candidate.groupName || null;
        candidate.category = candidate.category || 'education';
        candidate.hosts = 1;
        candidate.secondAnimator = null;
        candidate.costume = null;
        candidate.pinataMode = 'none';
        candidate.skipNotification = index > 0 ? true : Boolean(candidate.skipNotification);
        candidates.push(candidate);
    }

    return { seriesId, seriesSize, repeatEvery, candidates };
}

function findEducationSeriesLocalConflict(candidates, currentIndex) {
    const current = candidates[currentIndex];
    const currentLesson = educationLessonFromPayload(current) || {};
    for (let index = 0; index < currentIndex; index += 1) {
        const other = candidates[index];
        if (other.date !== current.date || !overlapsBookingTime(current, other)) continue;
        const otherLesson = educationLessonFromPayload(other) || {};
        if (other.lineId && current.lineId && String(other.lineId) === String(current.lineId)) {
            return { type: 'line', conflict: other };
        }
        if (isRealRoom(other.room) && isRealRoom(current.room) && String(other.room) === String(current.room)) {
            return { type: 'room', conflict: other };
        }
        const sameTeacher = (currentLesson.teacherId && otherLesson.teacherId && currentLesson.teacherId === otherLesson.teacherId)
            || (currentLesson.teacherName && otherLesson.teacherName && currentLesson.teacherName.toLowerCase() === otherLesson.teacherName.toLowerCase());
        if (sameTeacher) return { type: 'teacher', conflict: other };
    }
    return null;
}

async function resolveBookingCustomerId(client, booking, businessContext) {
    let customerId = booking.customerId ? parseInt(booking.customerId, 10) : null;
    if (sideEffectsAllowedForContext(businessContext) && booking.customer && booking.customer.name && !customerId) {
        const c = booking.customer;
        if (c.phone && c.phone.trim()) {
            const existing = await client.query(
                "SELECT id FROM customers WHERE phone = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
                [c.phone.trim(), businessContext]
            );
            if (existing.rows.length > 0) customerId = existing.rows[0].id;
        }
        if (!customerId) {
            const custResult = await client.query(
                `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [businessContext, c.name.trim(), c.phone || null, c.instagram || null, c.childName || null, c.childBirthday || null, normalizeCustomerSource(c.source)]
            );
            customerId = custResult.rows[0].id;
        }
    }
    if (sideEffectsAllowedForContext(businessContext) && customerId) {
        const scopedCustomer = await client.query(
            "SELECT id FROM customers WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
            [customerId, businessContext]
        );
        if (!scopedCustomer.rows.length) {
            const err = new Error('Customer does not belong to this business context');
            err.statusCode = 400;
            throw err;
        }
    }
    return customerId;
}

async function findAtomicLineConflict(client, candidate, excludeIds) {
    const result = await client.query(
        `SELECT id, time, duration, label, program_code
         FROM bookings
         WHERE date = $1 AND line_id = $2 AND ${bookingContextSql('', '$3')} AND status != 'cancelled'
           AND id != ALL($4::text[])`,
        [candidate.date, candidate.line_id, candidate.business_context || DEFAULT_TIMELINE_CONTEXT, excludeIds]
    );
    const start = timeToMinutes(candidate.time);
    const end = start + (parseInt(candidate.duration, 10) || 0);
    return result.rows.find(other => {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + (parseInt(other.duration, 10) || 0);
        return start < otherEnd && end > otherStart;
    }) || null;
}

async function findAtomicRoomConflict(client, candidate, excludeIds) {
    if (!isRealRoom(candidate.room)) return null;
    const result = await client.query(
        `SELECT id, time, duration, label, program_code
         FROM bookings
         WHERE date = $1 AND room = $2 AND ${bookingContextSql('', '$3')} AND status != 'cancelled'
           AND id != ALL($4::text[])`,
        [candidate.date, candidate.room, candidate.business_context || DEFAULT_TIMELINE_CONTEXT, excludeIds]
    );
    const start = timeToMinutes(candidate.time);
    const end = start + (parseInt(candidate.duration, 10) || 0);
    return result.rows.find(other => {
        const otherStart = timeToMinutes(other.time);
        const otherEnd = otherStart + (parseInt(other.duration, 10) || 0);
        return start < otherEnd && end > otherStart;
    }) || null;
}

async function updateAtomicLinkedBookingFields(client, id, patch, businessContext) {
    const entries = Object.entries(patch);
    if (!entries.length) {
        return getScopedBookingById(client, id, businessContext);
    }

    const assignments = [];
    const params = [];
    for (const [field, value] of entries) {
        params.push(value);
        assignments.push(`${field} = $${params.length}`);
    }
    assignments.push('updated_at = NOW()');
    params.push(id);
    params.push(businessContext || DEFAULT_TIMELINE_CONTEXT);

    const result = await client.query(
        `UPDATE bookings SET ${assignments.join(', ')}
         WHERE id = $${params.length - 1} AND ${bookingContextSql('', `$${params.length}`)}
         RETURNING *`,
        params
    );
    return result.rows[0] || null;
}

// v33.3: GET /api/bookings/occupancy — Line occupancy stats
router.get('/occupancy', async (req, res) => {
    try {
        const from = req.query.from || new Date().toISOString().slice(0, 10);
        const to = req.query.to || from;
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const workdayHours = 10;
        const params = [from, to, businessContext];
        const visibility = buildBookingVisibilityScope(req.user, params, 'b');

        const result = await pool.query(`
            SELECT b.line_id, COUNT(*)::int AS bookings_count,
                   COALESCE(SUM(b.duration), 0)::int AS total_minutes
            FROM bookings b
            WHERE b.date::date >= $1::date AND b.date::date <= $2::date
              AND ${bookingContextSql('b', '$3')}
              AND b.status != 'cancelled' AND b.linked_to IS NULL
              ${visibility}
            GROUP BY b.line_id
        `, params);

        const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
        const maxMinutes = workdayHours * 60 * days;

        const lines = result.rows.map(r => ({
            lineId: r.line_id,
            bookingsCount: r.bookings_count,
            totalMinutes: r.total_minutes,
            occupancyPercent: Math.min(100, Math.round((r.total_minutes / maxMinutes) * 100))
        }));

        res.json({ from, to, days, lines });
    } catch (err) {
        log.error('GET /bookings/occupancy error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/education-series/:seriesId', async (req, res) => {
    try {
        const seriesId = normalizeEducationSeriesId(req.params.seriesId);
        if (!seriesId) return res.status(400).json({ success: false, error: 'Invalid education series id' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const params = [seriesId, businessContext];
        const visibility = buildBookingVisibilityScope(req.user, params, 'b');
        const result = await pool.query(
            `SELECT b.*
               FROM bookings b
              WHERE ${educationSeriesSql('b', '$1')}
                AND ${bookingContextSql('b', '$2')}
                ${req.query.includeCancelled === 'true' ? '' : "AND b.status != 'cancelled'"}
                ${visibility}
              ORDER BY b.date, b.time, b.id`,
            params
        );
        const bookings = result.rows.map(mapBookingRow);
        res.json({ success: true, seriesId, businessContext, count: bookings.length, bookings });
    } catch (err) {
        log.error('GET /bookings/education-series/:seriesId error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/education-series/:seriesId/cancel', requireAction('delete_booking'), async (req, res) => {
    const client = await pool.connect();
    try {
        const seriesId = normalizeEducationSeriesId(req.params.seriesId);
        if (!seriesId) return res.status(400).json({ success: false, error: 'Invalid education series id' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'delete')) return;
        const scope = ['all', 'future'].includes(req.body?.scope) ? req.body.scope : 'future';
        const referenceBookingId = req.body?.referenceBookingId ? String(req.body.referenceBookingId).trim() : null;
        let fromDate = validateDate(req.body?.fromDate) ? req.body.fromDate : new Date().toISOString().slice(0, 10);

        await client.query('BEGIN');
        if (referenceBookingId) {
            const ref = await getScopedBookingById(client, referenceBookingId, businessContext);
            if (ref && !canEditBooking(req.user, ref)) {
                await client.query('ROLLBACK');
                return sendBookingDenied(req, res, ref);
            }
            if (ref?.date) fromDate = ref.date;
        }
        const params = [seriesId, businessContext];
        const dateFilter = scope === 'future'
            ? `AND b.date::date >= $${params.push(fromDate)}::date`
            : '';
        const result = await client.query(
            `UPDATE bookings b
                SET status = 'cancelled', updated_at = NOW()
              WHERE ${educationSeriesSql('b', '$1')}
                AND ${bookingContextSql('b', '$2')}
                AND b.status != 'cancelled'
                ${dateFilter}
              RETURNING b.*`,
            params
        );
        const cancelled = result.rows.map(mapBookingRow);
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['education_series_cancel', req.user?.username, JSON.stringify({
                seriesId,
                businessContext,
                scope,
                fromDate,
                count: cancelled.length
            })]
        );
        await client.query('COMMIT');

        cancelled.forEach(booking => {
            broadcast('booking:deleted', { id: booking.id, date: booking.date, educationSeriesId: seriesId, seriesCancel: true }, req.user?.id?.toString(), booking.date);
        });
        _alertPush();
        res.json({ success: true, seriesId, scope, fromDate, cancelledCount: cancelled.length, bookings: cancelled });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (education-series cancel)', rbErr));
        log.error('POST /bookings/education-series/:seriesId/cancel error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Get bookings for a date
router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const params = [date, businessContext];
        const visibility = buildBookingVisibilityScope(req.user, params, 'b');
        // v19.13: Explicit column list instead of SELECT *
        const result = await pool.query(
            `SELECT id, business_context, date, time, line_id, program_id, program_code, label, program_name,
                    category, duration, price, hosts, second_animator, pinata_filler,
                    pinata_mode, pinata_number, pinata_filler_number,
                    client_pinata_service_price, client_pinata_service_note, costume,
                    room, notes, created_by, created_at, linked_to, status, kids_count,
                    updated_at, group_name, extra_data, skip_notification, customer_id, payment_method, certificate_id,
                    confirmed_at, confirmed_by, confirmation_note, confirmation_source
             FROM bookings b
             WHERE b.date = $1 AND ${bookingContextSql('b', '$2')} AND b.status != 'cancelled'
               ${visibility}
             ORDER BY time`,
            params
        );
        const mapped = result.rows.map(mapBookingRow);
        res.json(await attachBanquetLinksToBookings(mapped, businessContext));
    } catch (err) {
        log.error('Error fetching bookings', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:id/banquet-links', requireAction('edit_booking'), async (req, res) => {
    const { id } = req.params;
    const targetId = req.body?.targetId || req.body?.target_id || req.body?.toBookingId;
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'edit')) return;
    if (!validateId(id) || !validateId(targetId)) {
        return res.status(400).json({ success: false, error: 'Invalid booking ID' });
    }
    const pair = normalizeBanquetLinkPair(id, targetId);
    if (!pair) {
        return res.status(400).json({ success: false, error: 'Не можна звʼязати бронювання саме із собою' });
    }
    const label = String(req.body?.label || '').trim().slice(0, 200) || null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const bookingResult = await client.query(
            `SELECT * FROM bookings
              WHERE id = ANY($1::text[])
                AND ${bookingContextSql('', '$2')}
              FOR UPDATE`,
            [[id, targetId], businessContext]
        );
        const bookings = bookingResult.rows;
        if (bookings.length !== 2) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Бронювання для звʼязку не знайдено' });
        }
        const source = bookings.find(row => String(row.id) === String(id));
        const target = bookings.find(row => String(row.id) === String(targetId));
        if ((target.business_context || DEFAULT_TIMELINE_CONTEXT) !== businessContext) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Бронювання з різних контекстів не можна звʼязати' });
        }
        if (source.status === 'cancelled' || target.status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Скасовані бронювання не можна звʼязати як банкет' });
        }
        if (source.date !== target.date) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Банкетний звʼязок у таймлайні підтримує бронювання одного дня' });
        }
        if (!canEditBooking(req.user, source) || !canEditBooking(req.user, target)) {
            await client.query('ROLLBACK');
            return sendBookingDenied(req, res, source);
        }
        const insert = await client.query(
            `INSERT INTO booking_banquet_links
                (business_context, booking_a_id, booking_b_id, relation_type, label, created_by_user_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (business_context, booking_a_id, booking_b_id, relation_type)
             DO UPDATE SET label = COALESCE(EXCLUDED.label, booking_banquet_links.label),
                           updated_at = NOW()
             RETURNING id, booking_a_id, booking_b_id, relation_type, label, created_at, created_by`,
            [businessContext, pair[0], pair[1], BANQUET_LINK_RELATION_TYPE, label, actorUserId(req.user), req.user?.username || null]
        );
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['booking_banquet_link_created', req.user?.username, JSON.stringify({
                booking_id: id,
                target_booking_id: targetId,
                business_context: businessContext,
                relation_type: BANQUET_LINK_RELATION_TYPE
            })]
        );
        await client.query('COMMIT');
        const link = mapBanquetLinkRow(insert.rows[0], id);
        broadcast('booking:banquet-link-updated', { link, date: source.date }, req.user?.id?.toString(), source.date);
        res.json({ success: true, link });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (banquet-link create)', rbErr));
        log.error('Error creating banquet booking link', err);
        res.status(500).json({ success: false, error: 'Failed to create banquet link' });
    } finally {
        client.release();
    }
});

router.delete('/:id/banquet-links/:targetId', requireAction('edit_booking'), async (req, res) => {
    const { id, targetId } = req.params;
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'edit')) return;
    if (!validateId(id) || !validateId(targetId)) {
        return res.status(400).json({ success: false, error: 'Invalid booking ID' });
    }
    const pair = normalizeBanquetLinkPair(id, targetId);
    if (!pair) {
        return res.status(400).json({ success: false, error: 'Invalid banquet link pair' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const bookingResult = await client.query(
            `SELECT * FROM bookings
              WHERE id = ANY($1::text[])
                AND ${bookingContextSql('', '$2')}
              FOR UPDATE`,
            [[id, targetId], businessContext]
        );
        if (bookingResult.rows.length !== 2) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Бронювання для звʼязку не знайдено' });
        }
        const source = bookingResult.rows.find(row => String(row.id) === String(id));
        const target = bookingResult.rows.find(row => String(row.id) === String(targetId));
        if ((target.business_context || DEFAULT_TIMELINE_CONTEXT) !== businessContext) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Бронювання з різних контекстів не можна змінити разом' });
        }
        if (!canEditBooking(req.user, source) || !canEditBooking(req.user, target)) {
            await client.query('ROLLBACK');
            return sendBookingDenied(req, res, source);
        }
        const deleted = await client.query(
            `DELETE FROM booking_banquet_links
              WHERE business_context = $1
                AND relation_type = $4
                AND (
                    (booking_a_id = $2 AND booking_b_id = $3)
                    OR (booking_a_id = $3 AND booking_b_id = $2)
                )
              RETURNING id, booking_a_id, booking_b_id, relation_type, label, created_at, created_by`,
            [businessContext, pair[0], pair[1], BANQUET_LINK_RELATION_TYPE]
        );
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['booking_banquet_link_deleted', req.user?.username, JSON.stringify({
                booking_id: id,
                target_booking_id: targetId,
                business_context: businessContext,
                relation_type: BANQUET_LINK_RELATION_TYPE,
                deleted: deleted.rowCount > 0
            })]
        );
        await client.query('COMMIT');
        const link = deleted.rows[0] ? mapBanquetLinkRow(deleted.rows[0], id) : null;
        broadcast('booking:banquet-link-updated', { link, removed: true, date: source.date }, req.user?.id?.toString(), source.date);
        res.json({ success: true, removed: deleted.rowCount > 0, link });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (banquet-link delete)', rbErr));
        log.error('Error deleting banquet booking link', err);
        res.status(500).json({ success: false, error: 'Failed to delete banquet link' });
    } finally {
        client.release();
    }
});

// Create booking — requires create_booking action permission
router.post('/', requireAction('create_booking'), async (req, res) => {
    // v39.9: Validate BEFORE pool.connect() to prevent connection leaks on early returns
    const b = req.body;
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'create')) return;
    b.businessContext = businessContext;
    if (!b.date || !b.time || !b.lineId) {
        return res.status(400).json({ error: 'Missing required fields: date, time, lineId' });
    }
    if (!validateDate(b.date)) { return res.status(400).json({ error: 'Invalid date format' }); }
    if (!validateTime(b.time)) { return res.status(400).json({ error: 'Invalid time format' }); }
    await hydrateBookingRoomFromTimelineResource(pool, b, businessContext);
    const roomError = requireBookingRoom(b);
    if (roomError) { return res.status(400).json({ error: roomError }); }
    const capacityError = await validateBookingTimelineResourceCapacity(pool, b, businessContext);
    if (capacityError) { return res.status(409).json({ success: false, error: capacityError.error, resource: capacityError.resource }); }
    if (b.notes && b.notes.length > 2000) { return res.status(400).json({ error: 'Нотатки: макс. 2000 символів' }); }
    if (b.label && b.label.length > 200) { return res.status(400).json({ error: 'Назва: макс. 200 символів' }); }
    if (b.room && b.room.length > 100) { return res.status(400).json({ error: 'Кімната: макс. 100 символів' }); }
    if (b.groupName && b.groupName.length > 200) { return res.status(400).json({ error: 'Група: макс. 200 символів' }); }
    const dur = parseInt(b.duration) || 0;
    if (dur < 0 || dur > 1440) { return res.status(400).json({ error: 'Тривалість: 0-1440 хвилин' }); }
    if (b.time && dur > 0) {
        const [_hh, _mm] = b.time.split(':').map(Number);
        if (_hh * 60 + _mm + dur > 1440) {
            return res.status(400).json({ error: `Бронювання не може перевищувати опівніч. Макс: ${1440 - _hh * 60 - _mm} хв` });
        }
    }
    if (!b.linkedTo) {
        const bookingDateTime = new Date(`${b.date}T${b.time}:00`);
        if (bookingDateTime < new Date()) {
            return res.status(400).json({ success: false, error: 'Неможливо створити бронювання в минулому.' });
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pinataFields = applyPinataNormalization(b);
        if (pinataFields.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: pinataFields.error });
        }
        applyBookingPackage(b);

        const ensuredPrimaryLine = await ensureBookingTimelineLine(client, b, businessContext, {
            name: b.lineName || b.animatorName || null
        });
        if (!ensuredPrimaryLine) {
            await client.query('ROLLBACK');
            return res.status(400).json(bookingLineUnavailablePayload());
        }

        let ensuredSecondAnimatorLine = null;
        if (!b.linkedTo && Number(b.hosts || 0) > 1 && b.secondAnimator) {
            ensuredSecondAnimatorLine = await ensureParkAnimatorLine(client, {
                businessContext,
                date: b.date,
                lineId: null,
                name: b.secondAnimator
            });
            if (!ensuredSecondAnimatorLine) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Другого ведучого не знайдено серед активних аніматорів' });
            }
            b.secondAnimator = ensuredSecondAnimatorLine.name;
        }

        if (!b.linkedTo) {
            const conflict = await checkServerConflicts(client, b.date, b.lineId, b.time, b.duration || 0, null, businessContext);
            if (conflict.overlap) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
                });
            }

            if (ensuredSecondAnimatorLine && String(ensuredSecondAnimatorLine.lineId) !== String(b.lineId)) {
                const secondConflict = await checkServerConflicts(client, b.date, ensuredSecondAnimatorLine.lineId, b.time, b.duration || 0, null, businessContext);
                if (secondConflict.overlap) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: `Час зайнятий у другого ведучого: ${secondConflict.conflictWith.label || secondConflict.conflictWith.program_code}`
                    });
                }
            }

            const duplicate = await checkServerDuplicate(client, b.date, b.programId, b.time, b.duration || 0, null, businessContext);
            if (duplicate) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: 'Ця програма вже є в цей час' });
            }

            const roomConflict = await checkRoomConflict(client, b.date, b.room, b.time, b.duration || 0, null, businessContext);
            if (roomConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Кімната "${b.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
                });
            }

            const teacherConflict = await validateEducationLessonTeacherConflict(client, b, businessContext);
            if (teacherConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: teacherConflict.error, conflictBookingId: teacherConflict.conflict.id });
            }
        }

        // Validate price (prevent negative/NaN amounts)
        if (b.price != null) {
            b.price = parseFloat(b.price);
            if (!Number.isFinite(b.price) || b.price < 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Ціна не може бути від\'ємною або некоректною' });
            }
        }

        // CRM: resolve or create customer (v30.4: auto-link by phone)
        let customerId = b.customerId ? parseInt(b.customerId) : null;
        if (sideEffectsAllowedForContext(businessContext) && b.customer && b.customer.name && !customerId) {
            const c = b.customer;
            // v30.4: Try to find existing customer by phone first
            if (c.phone && c.phone.trim()) {
                const existing = await client.query(
                    "SELECT id FROM customers WHERE phone = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
                    [c.phone.trim(), businessContext]
                );
                if (existing.rows.length > 0) {
                    customerId = existing.rows[0].id;
                }
            }
            // Create new customer only if not found
            if (!customerId) {
                const custResult = await client.query(
                    `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                    [businessContext, c.name.trim(), c.phone || null, c.instagram || null, c.childName || null, c.childBirthday || null, normalizeCustomerSource(c.source)]
                );
                customerId = custResult.rows[0].id;
            }
        }
        if (sideEffectsAllowedForContext(businessContext) && customerId) {
            const scopedCustomer = await client.query(
                "SELECT id FROM customers WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
                [customerId, businessContext]
            );
            if (!scopedCustomer.rows.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Customer does not belong to this business context' });
            }
        }

        if (!b.id || !/^BK-\d{4}-\d{4,}$/.test(b.id)) {
            b.id = await generateBookingNumber(client);
        }

        // v33.8.0 Integration 6: Certificate validation (INSIDE transaction)
        let certificateId = null;
        if (parkSideEffectsAllowedForContext(businessContext) && b.certificateCode) {
            const certRow = await client.query(
                `SELECT id, status, display_value FROM certificates WHERE cert_code = $1 FOR UPDATE`,
                [String(b.certificateCode).toUpperCase()]
            );
            if (!certRow.rowCount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Сертифікат не знайдено' });
            }
            const cert = certRow.rows[0];
            if (cert.status !== 'active') {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Сертифікат недійсний (статус: ${cert.status})` });
            }
            certificateId = cert.id;
            await client.query(`UPDATE certificates SET status = 'used', used_at = NOW() WHERE id = $1`, [certificateId]);
        }

        const insertResult = await client.query(
            `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method, certificate_id, banquet_guests, banquet_tables, banquet_menu)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
             RETURNING *`,
            [b.id, businessContext, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.pinataMode, b.pinataNumber, b.pinataFillerNumber, b.clientPinataServicePrice, b.clientPinataServiceNote, b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, b.status || 'confirmed', b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null, sideEffectsAllowedForContext(businessContext) ? (b.skipNotification || false) : true, customerId, b.paymentMethod || null, certificateId, b.banquetGuests || null, b.banquetTables || null, b.banquetMenu || null]
        );

        const linkedInsertedRows = [];
        if (ensuredSecondAnimatorLine && String(ensuredSecondAnimatorLine.lineId) !== String(b.lineId)) {
            const linkedId = await generateBookingNumber(client);
            const linkedInsert = await client.query(
                `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
                 RETURNING *`,
                [linkedId, businessContext, b.date, b.time, ensuredSecondAnimatorLine.lineId, b.programId, b.programCode,
                 b.label, b.programName, b.category, b.duration, 0, b.hosts,
                 b.secondAnimator, b.pinataFiller, b.pinataMode, b.pinataNumber,
                 b.pinataFillerNumber, b.clientPinataServicePrice,
                 b.clientPinataServiceNote, b.costume || null, b.room, b.notes,
                 b.createdBy, b.id, b.status || 'confirmed', b.kidsCount || null, b.groupName || null,
                 null]
            );
            if (linkedInsert.rows[0]) linkedInsertedRows.push(linkedInsert.rows[0]);
        }

        // v19.10: CRM aggregates now handled by DB trigger (trg_booking_customer_aggregates)
        // Update first_visit which is not covered by the trigger
        if (sideEffectsAllowedForContext(businessContext) && customerId) {
            await client.query(
                `UPDATE customers SET
                    first_visit = LEAST(COALESCE(first_visit, $1::date), $1::date),
                    updated_at = NOW()
                 WHERE id = $2 AND COALESCE(business_context, 'event_genix') = $3`,
                [b.date, customerId, businessContext]
            );
        }

        await syncBookingLeadHandoff(client, b, customerId, businessContext, 'Lead booking handoff');

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', b.createdBy || req.user?.username, JSON.stringify(b)]
        );

        // v19.10: Finance auto-record stays optional without poisoning the booking transaction.
        if (parkSideEffectsAllowedForContext(businessContext) && !b.linkedTo && b.price > 0 && b.status !== 'preliminary') {
            await runOptionalBookingTransactionStep(client, 'Finance auto-record', async () => {
                await client.query(
                    `INSERT INTO finance_transactions (business_context, type, category_id, amount, description, date, payment_method, booking_id, created_by)
                     VALUES ($1, 'income', (SELECT id FROM finance_categories WHERE name = 'Бронювання' AND type = 'income' AND COALESCE(business_context, 'event_genix') = $1 LIMIT 1),
                             $2, $3, $4, $5, $6, $7)`,
                    [businessContext, b.price, `${b.programName || b.label || b.programCode} (${b.id})`, b.date, b.paymentMethod || null, b.id, b.createdBy || req.user?.username]
                );
            });
        }

        // v33.8.0 Integration 6: Certificate payment finance record
        if (parkSideEffectsAllowedForContext(businessContext) && certificateId && b.price > 0) {
            await runOptionalBookingTransactionStep(client, 'Certificate finance record', async () => {
                await client.query(
                    `INSERT INTO finance_transactions (business_context, type, category_id, amount, description, date, payment_method, booking_id, certificate_id, created_by)
                     VALUES ($1, 'income', (SELECT id FROM finance_categories WHERE name ILIKE '%сертифікат%' AND COALESCE(business_context, 'event_genix') = $1 LIMIT 1),
                             $2, $3, $4, 'certificate', $5, $6, 'system')`,
                    [businessContext, b.price, `Оплата сертифікатом для бронювання ${b.id}`, b.date, b.id, certificateId]
                );
            });
        }

        await commitBookingTransaction(client, 'booking create');

        const durableRows = await assertDurableCreatedBookings(
            client,
            [b.id, ...linkedInsertedRows.map(row => row.id)],
            businessContext,
            'booking create'
        );
        const durableById = new Map(durableRows.map(row => [String(row.id), row]));

        // v12.6: skip_notification flag — suppress all notifications
        if (sideEffectsAllowedForContext(businessContext) && !b.linkedTo && b.status !== 'preliminary' && !b.skipNotification) {
            getLineName(b.lineId, b.date, businessContext).then(lineName => notifyTelegram('create', {
                ...b, label: b.label, program_code: b.programCode,
                program_name: b.programName, kids_count: b.kidsCount,
                created_by: b.createdBy
            }, { username: b.createdBy || req.user?.username, lineName, businessContext }))
                .catch(err => log.error(`Telegram notify failed (create): ${err.message}`));
        }

        // v8.3: Run automation rules (fire-and-forget after commit)
        if (sideEffectsAllowedForContext(businessContext) && !b.linkedTo) {
            processBookingAutomation(b)
                .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));
        }

        const booking = durableById.has(String(b.id))
            ? mapBookingRow(durableById.get(String(b.id)))
            : (insertResult.rows[0] ? mapBookingRow(insertResult.rows[0]) : { id: b.id });
        booking.serverVerified = true;
        if (ensuredPrimaryLine) {
            booking.lineName = ensuredPrimaryLine.name || null;
            booking.resourceId = booking.lineId || ensuredPrimaryLine.lineId || null;
            booking.resourceType = b.resourceType || b.extraData?.timelineIdentity?.resourceType || (businessContext === DEFAULT_TIMELINE_CONTEXT ? 'animator' : 'specialist');
            booking.timelineIdentity = b.extraData?.timelineIdentity || null;
        }
        const linkedBookings = linkedInsertedRows.map(row => {
            const mapped = mapBookingRow(durableById.get(String(row.id)) || row);
            mapped.serverVerified = true;
            return mapped;
        });
        booking.timelineProjection = await bookingDayProjectionStatus(client, {
            id: booking.id || b.id,
            date: b.date || booking.date,
            businessContext,
            user: req.user
        });
        if (booking.timelineProjection.visible === false) {
            log.warn(`Created booking ${booking.id || b.id} is not visible in same day timeline projection`, {
                date: booking.timelineProjection.date,
                businessContext: booking.timelineProjection.businessContext,
                userId: req.user?.id || null
            });
        }

        // WebSocket: notify other clients
        broadcast('booking:created', booking, req.user?.id?.toString(), b.date);
        _alertPush();

        // v19.1: Publish to event queue
        if (sideEffectsAllowedForContext(businessContext) && !b.linkedTo) {
            publishEvent('booking.created', {
                booking_id: b.id, business_context: businessContext, date: b.date, time: b.time, room: b.room,
                program_code: b.programCode, program_name: b.programName,
                status: b.status || 'confirmed', price: b.price || 0,
                kids_count: b.kidsCount, created_by: b.createdBy
            }, `booking_created_${b.id}`);
        }

        // ==========================================
        // v33.8.0: Post-commit integrations (all fire-and-forget)
        // ==========================================

        // Integration 1: Warehouse stock deduction
        if (parkSideEffectsAllowedForContext(businessContext) && b.programId) {
            setImmediate(async () => {
                try {
                    const reqs = await pool.query(
                        `SELECT psr.stock_id, psr.quantity, ws.name, ws.quantity AS current_qty
                         FROM product_stock_requirements psr
                         JOIN warehouse_stock ws ON ws.id = psr.stock_id
                         WHERE psr.product_id = $1 AND ws.is_active = true`,
                        [b.programId]
                    );
                    // Batch stock deductions in fewer queries
                    if (reqs.rows.length > 0) {
                        const stockIds = reqs.rows.map(r => r.stock_id);
                        const quantities = reqs.rows.map(r => r.quantity);
                        const bookingId = insertResult.rows[0].id;

                        // Log warnings for low stock
                        for (const req of reqs.rows) {
                            if (req.current_qty < req.quantity) {
                                log.warn(`[StockDeduct] Low stock: ${req.name} (${req.current_qty} < ${req.quantity}) for booking ${bookingId}`);
                            }
                        }

                        // Batch UPDATE using unnest
                        await pool.query(
                            `UPDATE warehouse_stock SET quantity = GREATEST(0, quantity - batch.qty), updated_at = NOW(), updated_by = 'booking'
                             FROM (SELECT unnest($1::int[]) AS sid, unnest($2::int[]) AS qty) batch
                             WHERE warehouse_stock.id = batch.sid`,
                            [stockIds, quantities]
                        );

                        // Batch INSERT history
                        const histValues = reqs.rows.map((r, i) => `($${i*3+1}, $${i*3+2}, $${i*3+3}, 'booking', NOW())`).join(',');
                        const histParams = reqs.rows.flatMap(r => [r.stock_id, -r.quantity, `Бронювання ${bookingId}`]);
                        await pool.query(
                            `INSERT INTO warehouse_history (stock_id, change, reason, created_by, created_at) VALUES ${histValues}`,
                            histParams
                        );
                    }
                } catch (e) { log.warn('[StockDeduct] Error:', e.message); }
            });
        }

        // Integration 2: HR shift warning (no block)
        // Note: bookings.hosts is INTEGER (animator count). Use second_animator for name matching.
        if (b.secondAnimator && b.date) {
            setImmediate(async () => {
                try {
                    const animName = String(b.secondAnimator).split(',')[0].trim();
                    const staffRow = await pool.query(
                        `SELECT id, name FROM staff WHERE (display_name ILIKE $1 OR name ILIKE $1) AND is_active = true LIMIT 1`,
                        [animName]
                    );
                    if (!staffRow.rowCount) return;
                    const shift = await pool.query(
                        `SELECT id FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2`,
                        [staffRow.rows[0].id, b.date]
                    );
                    if (!shift.rowCount) {
                        const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
                        const chatId = await getConfiguredChatId();
                        if (chatId) {
                            await sendTelegramMessage(chatId,
                                `⚠️ Бронювання ${insertResult.rows[0].id} (${b.date} ${b.time}): ` +
                                `для аніматора "${b.secondAnimator}" не знайдено зміни в HR. Перевірте графік!`
                            );
                        }
                    }
                } catch (e) { /* silent */ }
            });
        }

        // Integration 7: Loyalty tier auto-upgrade
        if (sideEffectsAllowedForContext(businessContext) && customerId) {
            setImmediate(async () => {
                try {
                    const cust = await pool.query(
                        `SELECT c.id, c.name, c.total_bookings, c.total_spent,
                                c.loyalty_tier_id, lt.name AS current_tier_name
                         FROM customers c
                         LEFT JOIN loyalty_tiers lt ON lt.id = c.loyalty_tier_id
                         WHERE c.id = $1 AND COALESCE(c.business_context, 'event_genix') = $2`,
                        [customerId, businessContext]
                    );
                    if (!cust.rowCount) return;
                    const c = cust.rows[0];
                    const tiers = await pool.query(
                        `SELECT * FROM loyalty_tiers
                         WHERE min_bookings <= $1 AND min_spent <= $2
                         ORDER BY min_bookings DESC, min_spent DESC LIMIT 1`,
                        [c.total_bookings, c.total_spent]
                    );
                    if (!tiers.rowCount) return;
                    const newTier = tiers.rows[0];
                    if (newTier.id !== c.loyalty_tier_id) {
                        await pool.query(
                            "UPDATE customers SET loyalty_tier_id = $1 WHERE id = $2 AND COALESCE(business_context, 'event_genix') = $3",
                            [newTier.id, customerId, businessContext]
                        );
                        const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
                        const chatId = await getConfiguredChatId();
                        if (chatId) {
                            await sendTelegramMessage(chatId,
                                `🏆 Клієнт <b>${c.name}</b> підвищено до tier <b>${newTier.name}</b>!\n` +
                                `Бронювань: ${c.total_bookings} | Сума: ${c.total_spent} грн`
                            );
                        }
                        log.info(`[Loyalty] Customer ${customerId} upgraded: ${c.current_tier_name || 'none'} → ${newTier.name}`);
                    }
                } catch (e) { log.warn('[Loyalty] Tier update error:', e.message); }
            });
        }

        // Integration 10: Gamification achievements check
        setImmediate(async () => {
            try {
                const { checkAchievements } = require('../services/gamification');
                const hostUsername = b.hosts ? String(b.hosts).split(',')[0].trim() : null;
                if (hostUsername) {
                    const unlocked = await checkAchievements(hostUsername, { context: 'booking' });
                    if (unlocked.length > 0) {
                        log.info(`[Gamification] ${hostUsername} unlocked: ${unlocked.map(a => a.key).join(', ')}`);
                    }
                }
                if (b.createdBy && b.createdBy !== 'system') {
                    await checkAchievements(b.createdBy, { context: 'booking' }).catch(() => {});
                }
            } catch (e) { log.warn('[Gamification] Achievement check error:', e.message); }
        });

        // v33.9.0: Post message to room channel
        if (parkSideEffectsAllowedForContext(businessContext) && b.lineId) {
            setImmediate(async () => {
                try {
                    const roomChan = await pool.query(
                        "SELECT id FROM chat_channels WHERE line_id = $1 AND type = 'room' LIMIT 1", [b.lineId]
                    );
                    if (!roomChan.rowCount) return;
                    const sysUser = await pool.query("SELECT id FROM users WHERE username = 'system' LIMIT 1");
                    if (!sysUser.rowCount) return;
                    const seqRes = await pool.query('SELECT next_chat_seq($1) AS seq', [roomChan.rows[0].id]);
                    await pool.query(
                        `INSERT INTO chat_messages (channel_id, user_id, seq, content, is_bot, created_at)
                         VALUES ($1, $2, $3, $4, true, NOW())`,
                        [roomChan.rows[0].id, sysUser.rows[0].id, seqRes.rows[0].seq,
                         `📅 ${b.date} ${b.time} — ${b.programName || b.label}${b.kidsCount ? ' | 👶' + b.kidsCount : ''}`]
                    );
                } catch (e) { /* silent */ }
            });
        }

        // v33.15.0: Auto birthday announcement
        if ((b.programName || '').toLowerCase().match(/день народж|birthday|дн\b/i) && b.date && b.time) {
            setImmediate(async () => {
                try {
                    const eventTime = new Date(`${b.date}T${b.time}`);
                    const annTime = new Date(eventTime.getTime() - 5 * 60000);
                    if (annTime <= new Date()) return;
                    const childName = (b.label || '').replace(/[^а-яА-ЯіІїЇєЄa-zA-Z\s]/g, '').trim().split(/\s+/)[0] || '';
                    const text = `Шановні відвідувачі! Сьогодні у нас особливий гість${childName ? ' — ' + childName : ''}! Святкування починається о ${b.time.slice(0, 5)}. Бажаємо прекрасного свята! 🎉`;
                    await pool.query(
                        `INSERT INTO announcements (title, text_content, announcement_type, schedule_type, scheduled_at, status, priority, created_by)
                         VALUES ($1, $2, 'birthday', 'once', $3, 'scheduled', 5, 'booking_auto')`,
                        [`🎂 ДН: ${childName || b.label}`, text, annTime.toISOString()]
                    );
                } catch (e) { /* silent */ }
            });
        }

        res.json({ success: true, booking, linkedBookings, serverVerified: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (create)', rbErr));
        log.error('Error creating booking', err);
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.publicMessage || 'Internal server error',
            code: err.code || 'internal_error',
            missingBookingIds: err.missingBookingIds || undefined
        });
    } finally {
        client.release();
    }
});

// Create an education lesson series atomically. The first occurrence behaves like
// a normal lesson booking; future occurrences stay quiet to avoid notification spam.
router.post('/education-series', requireAction('create_booking'), async (req, res) => {
    const main = req.body?.booking || req.body?.main || req.body || {};
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'create')) return;
    main.businessContext = businessContext;

    if (!main.date || !main.time || !main.lineId) {
        return res.status(400).json({ success: false, error: 'Missing required fields: date, time, lineId' });
    }
    if (!validateDate(main.date)) return res.status(400).json({ success: false, error: 'Invalid date format' });
    if (!validateTime(main.time)) return res.status(400).json({ success: false, error: 'Invalid time format' });

    const lesson = educationLessonFromPayload(main);
    const requestedSize = parseInt(lesson?.seriesSize, 10) || 1;
    if (!lesson || requestedSize < 2) {
        return res.status(400).json({ success: false, error: 'Серія навчальних занять потребує щонайменше 2 заняття' });
    }
    if (main.notes && main.notes.length > 2000) return res.status(400).json({ success: false, error: 'Нотатки: макс. 2000 символів' });
    if (main.label && main.label.length > 200) return res.status(400).json({ success: false, error: 'Назва: макс. 200 символів' });
    if (main.groupName && main.groupName.length > 200) return res.status(400).json({ success: false, error: 'Група: макс. 200 символів' });

    const { seriesId, candidates } = buildEducationLessonSeriesCandidates(main, lesson);
    for (const candidate of candidates) {
        candidate.businessContext = businessContext;
        if (!validateDate(candidate.date)) return res.status(400).json({ success: false, error: 'Invalid date format' });
        if (!validateTime(candidate.time)) return res.status(400).json({ success: false, error: 'Invalid time format' });
        const duration = parseInt(candidate.duration, 10) || 0;
        if (duration <= 0 || duration > 1440) {
            return res.status(400).json({ success: false, error: 'Тривалість заняття має бути від 1 до 1440 хвилин' });
        }
        const [hh, mm] = candidate.time.split(':').map(Number);
        if (hh * 60 + mm + duration > 1440) {
            return res.status(400).json({ success: false, error: 'Заняття не може переходити через опівніч' });
        }
        const bookingDateTime = new Date(`${candidate.date}T${candidate.time}:00`);
        if (bookingDateTime < new Date()) {
            return res.status(400).json({ success: false, error: 'Неможливо створити заняття в минулому.' });
        }
        await hydrateBookingRoomFromTimelineResource(pool, candidate, businessContext);
        const roomError = requireBookingRoom(candidate);
        if (roomError) return res.status(400).json({ success: false, error: roomError });
        const capacityError = await validateBookingTimelineResourceCapacity(pool, candidate, businessContext);
        if (capacityError) return res.status(409).json({ success: false, error: capacityError.error, resource: capacityError.resource });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const customerId = await resolveBookingCustomerId(client, main, businessContext);
        const insertedRows = [];
        const generatedIds = [];
        for (const candidate of candidates) {
            candidate.id = await generateBookingNumber(client);
            generatedIds.push(candidate.id);
        }
        const rootBookingId = generatedIds[0];

        for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            const occurrenceLesson = educationLessonFromPayload(candidate);
            occurrenceLesson.seriesRootBookingId = rootBookingId;
            setEducationLessonExtra(candidate, occurrenceLesson);

            const pinataFields = applyPinataNormalization(candidate);
            if (pinataFields.error) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: pinataFields.error });
            }
            applyBookingPackage(candidate);
            if (candidate.price != null) {
                candidate.price = parseFloat(candidate.price);
                if (!Number.isFinite(candidate.price) || candidate.price < 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Ціна не може бути відʼємною або некоректною' });
                }
            }

            const localConflict = findEducationSeriesLocalConflict(candidates, index);
            if (localConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Конфлікт у серії ${candidate.date} ${candidate.time}: ${localConflict.type}`
                });
            }

            const lineConflict = await checkServerConflicts(client, candidate.date, candidate.lineId, candidate.time, candidate.duration || 0, null, businessContext);
            if (lineConflict.overlap) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    conflictBookingId: lineConflict.conflictWith.id,
                    error: `Кабінет зайнятий ${candidate.date} о ${candidate.time}: ${lineConflict.conflictWith.label || lineConflict.conflictWith.program_code}`
                });
            }

            const duplicate = await checkServerDuplicate(client, candidate.date, candidate.programId, candidate.time, candidate.duration || 0, null, businessContext);
            if (duplicate) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, conflictBookingId: duplicate.id, error: `Ця програма вже є ${candidate.date} о ${candidate.time}` });
            }

            const roomConflict = await checkRoomConflict(client, candidate.date, candidate.room, candidate.time, candidate.duration || 0, null, businessContext);
            if (roomConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    conflictBookingId: roomConflict.id,
                    error: `Кабінет "${candidate.room}" зайнятий ${candidate.date} о ${candidate.time}: ${roomConflict.label || roomConflict.program_code}`
                });
            }

            const teacherConflict = await validateEducationLessonTeacherConflict(client, candidate, businessContext, generatedIds);
            if (teacherConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: teacherConflict.error, conflictBookingId: teacherConflict.conflict.id });
            }

            const insertResult = await client.query(
                `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method, banquet_guests, banquet_tables, banquet_menu)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
                 RETURNING *`,
                [candidate.id, businessContext, candidate.date, candidate.time, candidate.lineId, candidate.programId, candidate.programCode, candidate.label, candidate.programName, candidate.category, candidate.duration, candidate.price, candidate.hosts, candidate.secondAnimator, candidate.pinataFiller, candidate.pinataMode, candidate.pinataNumber, candidate.pinataFillerNumber, candidate.clientPinataServicePrice, candidate.clientPinataServiceNote, candidate.costume || null, candidate.room, candidate.notes, candidate.createdBy || req.user?.username, null, candidate.status || 'confirmed', candidate.kidsCount || null, candidate.groupName || null, candidate.extraData ? JSON.stringify(candidate.extraData) : null, sideEffectsAllowedForContext(businessContext) ? Boolean(candidate.skipNotification) : true, customerId, candidate.paymentMethod || null, candidate.banquetGuests || null, candidate.banquetTables || null, candidate.banquetMenu || null]
            );
            if (insertResult.rows[0]) insertedRows.push(insertResult.rows[0]);
        }

        if (sideEffectsAllowedForContext(businessContext) && customerId) {
            await client.query(
                `UPDATE customers SET
                    first_visit = LEAST(COALESCE(first_visit, $1::date), $1::date),
                    updated_at = NOW()
                 WHERE id = $2 AND COALESCE(business_context, 'event_genix') = $3`,
                [main.date, customerId, businessContext]
            );
        }

        const atomicLeadLink = await syncBookingLeadHandoff(
            client,
            { ...main, id: rootBookingId },
            customerId,
            businessContext,
            'Lead booking handoff (atomic)'
        );
        if (atomicLeadLink?.attached) main.leadId = atomicLeadLink.leadId;

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['education_series_create', main.createdBy || req.user?.username, JSON.stringify({
                seriesId,
                rootBookingId,
                count: insertedRows.length,
                businessContext,
                date: main.date,
                time: main.time,
                title: lesson.title,
                teacherId: lesson.teacherId || null,
                teacherName: lesson.teacherName || null
            })]
        );

        await client.query('COMMIT');

        const bookings = insertedRows.map(mapBookingRow);
        bookings.forEach(booking => {
            broadcast('booking:created', booking, req.user?.id?.toString(), booking.date);
        });
        _alertPush();

        if (sideEffectsAllowedForContext(businessContext) && bookings[0] && main.status !== 'preliminary' && !main.skipNotification) {
            getLineName(main.lineId, main.date, businessContext).then(lineName => notifyTelegram('create', {
                ...main,
                id: rootBookingId,
                program_code: main.programCode,
                program_name: main.programName,
                kids_count: main.kidsCount,
                created_by: main.createdBy || req.user?.username
            }, { username: main.createdBy || req.user?.username, lineName, businessContext }))
                .catch(err => log.error(`Telegram notify failed (education-series): ${err.message}`));
        }

        if (sideEffectsAllowedForContext(businessContext) && bookings[0]) {
            processBookingAutomation(bookings[0])
                .catch(err => log.error(`Automation failed (education-series): ${err.message}`));
        }

        if (sideEffectsAllowedForContext(businessContext) && bookings[0]) {
            publishEvent('booking.created', {
                booking_id: rootBookingId,
                business_context: businessContext,
                date: main.date,
                time: main.time,
                room: main.room,
                program_code: main.programCode,
                program_name: main.programName,
                status: main.status || 'confirmed',
                price: main.price || 0,
                kids_count: main.kidsCount,
                created_by: main.createdBy || req.user?.username,
                education_series_id: seriesId,
                education_series_count: bookings.length
            }, `education_series_created_${seriesId}`);
        }

        res.json({
            success: true,
            seriesId,
            createdCount: bookings.length,
            mainBooking: bookings[0] || null,
            bookings
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (education-series)', rbErr));
        log.error('Error creating education lesson series', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
});

// Create booking with linked bookings in one transaction
router.post('/full', requireAction('create_booking'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { main } = req.body;
        const linked = Array.isArray(req.body?.linked) ? req.body.linked : [];
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'create')) return;
        if (!main || !main.date || !main.time || !main.lineId) {
            return res.status(400).json({ error: 'Missing required fields: date, time, lineId' });
        }
        main.businessContext = businessContext;
        if (!validateDate(main.date)) { return res.status(400).json({ error: 'Invalid date format' }); }
        if (!validateTime(main.time)) { return res.status(400).json({ error: 'Invalid time format' }); }
        await hydrateBookingRoomFromTimelineResource(pool, main, businessContext);
        const mainRoomError = requireBookingRoom(main);
        if (mainRoomError) { return res.status(400).json({ error: mainRoomError }); }
        const mainCapacityError = await validateBookingTimelineResourceCapacity(pool, main, businessContext);
        if (mainCapacityError) { return res.status(409).json({ success: false, error: mainCapacityError.error, resource: mainCapacityError.resource }); }
        const mainPinataFields = applyPinataNormalization(main);
        if (mainPinataFields.error) return res.status(400).json({ success: false, error: mainPinataFields.error });
        applyBookingPackage(main);
        if (Array.isArray(linked)) {
            for (const lb of linked) {
                if (!String(lb.room || '').trim()) lb.room = main.room;
                if (!String(lb.room || '').trim()) await hydrateBookingRoomFromTimelineResource(pool, lb, businessContext);
                const linkedRoomError = requireBookingRoom(lb);
                if (linkedRoomError) return res.status(400).json({ error: linkedRoomError });
                const linkedCapacityError = await validateBookingTimelineResourceCapacity(pool, lb, businessContext);
                if (linkedCapacityError) return res.status(409).json({ success: false, error: linkedCapacityError.error, resource: linkedCapacityError.resource });
                const linkedPinataFields = applyPinataNormalization(lb);
                if (linkedPinataFields.error) return res.status(400).json({ success: false, error: linkedPinataFields.error });
            }
        }

        await client.query('BEGIN');

        const ensuredMainLine = await ensureBookingTimelineLine(client, main, businessContext, {
            name: main.lineName || main.animatorName || null
        });
        if (!ensuredMainLine) {
            await client.query('ROLLBACK');
            return res.status(400).json(bookingLineUnavailablePayload());
        }

        for (const lb of linked) {
            if (!lb.date) lb.date = main.date;
            if (!lb.time) lb.time = main.time;
            const ensuredLinkedLine = await ensureBookingTimelineLine(client, lb, businessContext, {
                name: lb.lineName || lb.secondAnimator || null
            });
            if (!ensuredLinkedLine) {
                await client.query('ROLLBACK');
                return res.status(400).json(bookingLineUnavailablePayload());
            }
            if (lb.secondAnimator) lb.secondAnimator = ensuredLinkedLine.name || lb.secondAnimator;
        }

        for (const lb of linked) {
            const ensuredLinkedLine = await ensureParkAnimatorLine(client, {
                businessContext,
                date: lb.date || main.date,
                lineId: lb.lineId,
                name: lb.secondAnimator || null
            });
            if (ensuredLinkedLine) {
                lb.lineId = ensuredLinkedLine.lineId;
                if (lb.secondAnimator) lb.secondAnimator = ensuredLinkedLine.name;
            }
        }

        if (Number(main.hosts || 0) > 1 && main.secondAnimator) {
            const hasSecondLinked = linked.some(lb => lb.secondAnimator === main.secondAnimator
                || (
                    lb.programId === main.programId
                    && String(lb.date || main.date) === String(main.date)
                    && String(lb.time || main.time) === String(main.time)
                    && Number(lb.price || 0) === 0
                ));
            if (!hasSecondLinked) {
                const ensuredSecondLine = await ensureParkAnimatorLine(client, {
                    businessContext,
                    date: main.date,
                    lineId: null,
                    name: main.secondAnimator
                });
                if (!ensuredSecondLine) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Другого ведучого не знайдено серед активних аніматорів' });
                }
                linked.push({
                    date: main.date,
                    time: main.time,
                    lineId: ensuredSecondLine.lineId,
                    programId: main.programId,
                    programCode: main.programCode,
                    label: main.label,
                    programName: main.programName,
                    category: main.category,
                    duration: main.duration,
                    price: 0,
                    hosts: main.hosts,
                    secondAnimator: ensuredSecondLine.name,
                    pinataFiller: main.pinataFiller,
                    pinataMode: main.pinataMode,
                    pinataNumber: main.pinataNumber,
                    pinataFillerNumber: main.pinataFillerNumber,
                    clientPinataServicePrice: main.clientPinataServicePrice,
                    clientPinataServiceNote: main.clientPinataServiceNote,
                    costume: main.costume || null,
                    room: main.room,
                    notes: main.notes,
                    createdBy: main.createdBy,
                    status: main.status || 'confirmed',
                    kidsCount: main.kidsCount || null,
                    groupName: main.groupName || null,
                    extraData: null
                });
            }
        }

        const conflict = await checkServerConflicts(client, main.date, main.lineId, main.time, main.duration || 0, null, businessContext);
        if (conflict.overlap) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
            });
        }

        const duplicate = await checkServerDuplicate(client, main.date, main.programId, main.time, main.duration || 0, null, businessContext);
        if (duplicate) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Ця програма вже є в цей час' });
        }

        const roomConflict = await checkRoomConflict(client, main.date, main.room, main.time, main.duration || 0, null, businessContext);
        if (roomConflict) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `Кімната "${main.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
            });
        }

        const teacherConflict = await validateEducationLessonTeacherConflict(client, main, businessContext);
        if (teacherConflict) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: teacherConflict.error, conflictBookingId: teacherConflict.conflict.id });
        }

        // CRM: resolve or create customer
        let customerId = main.customerId ? parseInt(main.customerId) : null;
        if (sideEffectsAllowedForContext(businessContext) && main.customer && main.customer.name && !customerId) {
            const c = main.customer;
            if (c.phone && c.phone.trim()) {
                const existing = await client.query(
                    "SELECT id FROM customers WHERE phone = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
                    [c.phone.trim(), businessContext]
                );
                if (existing.rows.length > 0) customerId = existing.rows[0].id;
            }
            if (!customerId) {
                const custResult = await client.query(
                    `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                    [businessContext, c.name.trim(), c.phone || null, c.instagram || null, c.childName || null, c.childBirthday || null, normalizeCustomerSource(c.source)]
                );
                customerId = custResult.rows[0].id;
            }
        }
        if (sideEffectsAllowedForContext(businessContext) && customerId) {
            const scopedCustomer = await client.query(
                "SELECT id FROM customers WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
                [customerId, businessContext]
            );
            if (!scopedCustomer.rows.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Customer does not belong to this business context' });
            }
        }

        if (!main.id || !/^BK-\d{4}-\d{4,}$/.test(main.id)) {
            main.id = await generateBookingNumber(client);
        }

        const mainInsert = await client.query(
            `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method, banquet_guests, banquet_tables, banquet_menu)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
             RETURNING *`,
            [main.id, businessContext, main.date, main.time, main.lineId, main.programId, main.programCode, main.label, main.programName, main.category, main.duration, main.price, main.hosts, main.secondAnimator, main.pinataFiller, main.pinataMode, main.pinataNumber, main.pinataFillerNumber, main.clientPinataServicePrice, main.clientPinataServiceNote, main.costume || null, main.room, main.notes, main.createdBy, null, main.status || 'confirmed', main.kidsCount || null, main.groupName || null, main.extraData ? JSON.stringify(main.extraData) : null, main.skipNotification || false, customerId, main.paymentMethod || null, main.banquetGuests || null, main.banquetTables || null, main.banquetMenu || null]
        );

        // v19.10: CRM aggregates now handled by DB trigger
        if (sideEffectsAllowedForContext(businessContext) && customerId) {
            await client.query(
                `UPDATE customers SET
                    first_visit = LEAST(COALESCE(first_visit, $1::date), $1::date),
                    updated_at = NOW()
                 WHERE id = $2 AND COALESCE(business_context, 'event_genix') = $3`,
                [main.date, customerId, businessContext]
            );
        }

        await syncBookingLeadHandoff(client, main, customerId, businessContext, 'Lead booking handoff (create/full)');

        const linkedRows = [];
        if (Array.isArray(linked)) {
            for (const lb of linked) {
                lb.price = 0;
                lb.extraData = null;
                const lConflict = await checkServerConflicts(client, lb.date, lb.lineId, lb.time, lb.duration || 0, null, businessContext);
                if (lConflict.overlap) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: `Час зайнятий у пов'язаного аніматора: ${lConflict.conflictWith.label || lConflict.conflictWith.program_code}`
                    });
                }

                const lbId = await generateBookingNumber(client);
                const lbInsert = await client.query(
                    `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
                     RETURNING *`,
                    [lbId, businessContext, lb.date, lb.time, lb.lineId, lb.programId, lb.programCode, lb.label, lb.programName, lb.category, lb.duration, lb.price, lb.hosts, lb.secondAnimator, lb.pinataFiller, lb.pinataMode, lb.pinataNumber, lb.pinataFillerNumber, lb.clientPinataServicePrice, lb.clientPinataServiceNote, lb.costume || null, lb.room, lb.notes, lb.createdBy, main.id, lb.status || main.status || 'confirmed', lb.kidsCount || null, lb.groupName || main.groupName || null, lb.extraData ? JSON.stringify(lb.extraData) : (main.extraData ? JSON.stringify(main.extraData) : null)]
                );
                if (lbInsert.rows[0]) linkedRows.push(lbInsert.rows[0]);
            }
        }

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['create', main.createdBy || req.user?.username, JSON.stringify(main)]
        );

        if (parkSideEffectsAllowedForContext(businessContext) && main.price > 0 && main.status !== 'preliminary') {
            await runOptionalBookingTransactionStep(client, 'Finance auto-record (create/full)', async () => {
                await client.query(
                    `INSERT INTO finance_transactions (business_context, type, category_id, amount, description, date, payment_method, booking_id, created_by)
                     VALUES ($1, 'income', (SELECT id FROM finance_categories WHERE name = 'Бронювання' AND type = 'income' AND COALESCE(business_context, 'event_genix') = $1 LIMIT 1),
                             $2, $3, $4, $5, $6, $7)`,
                    [businessContext, main.price, `${main.programName || main.label || main.programCode} (${main.id})`, main.date, main.paymentMethod || null, main.id, main.createdBy || req.user?.username]
                );
            });
        }

        await commitBookingTransaction(client, 'booking create/full');

        const durableRows = await assertDurableCreatedBookings(
            client,
            [main.id, ...linkedRows.map(row => row.id)],
            businessContext,
            'booking create/full'
        );
        const durableById = new Map(durableRows.map(row => [String(row.id), row]));

        // v12.6: skip_notification flag — suppress all notifications
        if (sideEffectsAllowedForContext(businessContext) && main.status !== 'preliminary' && !main.skipNotification) {
            getLineName(main.lineId, main.date, businessContext).then(lineName => notifyTelegram('create', {
                ...main, program_code: main.programCode, program_name: main.programName,
                kids_count: main.kidsCount, created_by: main.createdBy
            }, { username: main.createdBy || req.user?.username, lineName, businessContext }))
                .catch(err => log.error(`Telegram notify failed (create/full): ${err.message}`));
        }

        // v8.3: Run automation rules (fire-and-forget after commit)
        if (sideEffectsAllowedForContext(businessContext)) {
            processBookingAutomation(main)
                .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));
        }

        const mainBooking = durableById.has(String(main.id))
            ? mapBookingRow(durableById.get(String(main.id)))
            : (mainInsert.rows[0] ? mapBookingRow(mainInsert.rows[0]) : { id: main.id });
        mainBooking.serverVerified = true;
        const linkedBookings = linkedRows.map(row => {
            const mapped = mapBookingRow(durableById.get(String(row.id)) || row);
            mapped.serverVerified = true;
            return mapped;
        });
        await Promise.all([mainBooking, ...linkedBookings].map(async booking => {
            booking.timelineProjection = await bookingDayProjectionStatus(client, {
                id: booking.id,
                date: booking.linkedTo ? (booking.date || main.date) : (main.date || booking.date),
                businessContext,
                user: req.user
            });
            if (booking.timelineProjection.visible === false) {
                log.warn(`Created linked booking ${booking.id} is not visible in same day timeline projection`, {
                    date: booking.timelineProjection.date,
                    businessContext: booking.timelineProjection.businessContext,
                    userId: req.user?.id || null
                });
            }
        }));

        // WebSocket: notify other clients
        broadcast('booking:created', mainBooking, req.user?.id?.toString(), main.date);

        // v19.1: Publish to event queue
        if (sideEffectsAllowedForContext(businessContext)) {
            publishEvent('booking.created', {
                booking_id: main.id, business_context: businessContext, date: main.date, time: main.time, room: main.room,
                program_code: main.programCode, program_name: main.programName,
                status: main.status || 'confirmed', price: main.price || 0,
                kids_count: main.kidsCount, created_by: main.createdBy,
                linked_count: linkedRows.length
            }, `booking_created_${main.id}`);
        }

        res.json({ success: true, mainBooking, linkedBookings, serverVerified: true });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (create/full)', rbErr));
        log.error('Error creating full booking', err);
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.publicMessage || 'Internal server error',
            code: err.code || 'internal_error',
            missingBookingIds: err.missingBookingIds || undefined
        });
    } finally {
        client.release();
    }
});

// Soft delete or permanent delete — requires delete_booking permission
router.delete('/:id', requireAction('delete_booking'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const permanent = req.query.permanent === 'true';
        if (!validateId(id)) { return res.status(400).json({ error: 'Invalid booking ID' }); }
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'delete')) return;

        await client.query('BEGIN');

        const booking = await getScopedBookingById(client, id, businessContext);
        if (!booking) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Бронювання не знайдено' });
        }
        if (!canEditBooking(req.user, booking)) {
            await client.query('ROLLBACK');
            return sendBookingDenied(req, res, booking);
        }

        const action = permanent ? 'permanent_delete' : 'delete';
        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            [action, req.user?.username, JSON.stringify(mapBookingRow(booking))]
        );

        if (permanent) {
            await client.query(
                `DELETE FROM bookings WHERE (id = $1 OR linked_to = $1) AND ${bookingContextSql('', '$2')}`,
                [id, businessContext]
            );
        } else {
            await client.query(
                `UPDATE bookings SET status = 'cancelled', updated_at = NOW()
                 WHERE (id = $1 OR linked_to = $1) AND ${bookingContextSql('', '$2')}`,
                [id, businessContext]
            );
        }

        // v19.10: CRM aggregates now handled by DB trigger (trg_booking_customer_aggregates)

        // v19.10: Remove auto-recorded finance transaction inside transaction
        if (parkSideEffectsAllowedForContext(businessContext) && booking.price > 0 && !booking.linked_to) {
            try {
                await client.query(
                    "DELETE FROM finance_transactions WHERE booking_id = $1 AND COALESCE(business_context, 'event_genix') = $2",
                    [id, businessContext]
                );
            } catch (finErr) {
                log.warn(`Finance auto-delete failed (non-critical): ${finErr.message}`);
            }
        }

        // v39.9: Restore certificate INSIDE transaction (was fire-and-forget, could lose certs)
        if (booking.certificate_id) {
            try {
                await client.query("UPDATE certificates SET status = 'active', used_at = NULL WHERE id = $1 AND status = 'used'", [booking.certificate_id]);
                log.info(`[CertRestore] Certificate ${booking.certificate_id} restored in transaction`);
            } catch (e) { log.warn('[CertRestore] Error:', e.message); }
        }

        await client.query('COMMIT');

        // v33.8.0: Restore stock on cancel (fire-and-forget — non-critical)
        if (parkSideEffectsAllowedForContext(businessContext) && booking.program_id) {
            setImmediate(async () => {
                try {
                    const reqs = await pool.query(
                        `SELECT psr.stock_id, psr.quantity, ws.name FROM product_stock_requirements psr
                         JOIN warehouse_stock ws ON ws.id = psr.stock_id WHERE psr.product_id = $1`,
                        [booking.program_id]
                    );
                    for (const r of reqs.rows) {
                        await pool.query('UPDATE warehouse_stock SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2', [r.quantity, r.stock_id]);
                        await pool.query(
                            'INSERT INTO warehouse_history (stock_id, change, reason, created_by, created_at) VALUES ($1, $2, $3, $4, NOW())',
                            [r.stock_id, r.quantity, `Скасування ${id}`, req.user?.username || 'system']
                        );
                    }
                } catch (e) { log.warn('[StockRestore] Error:', e.message); }
            });
        }
        // v39.9: Certificate restore moved inside transaction (above)

        if (sideEffectsAllowedForContext(businessContext)) {
            getLineName(booking.line_id, booking.date, businessContext).then(lineName =>
                notifyTelegram('delete', booking, { username: req.user?.username, lineName, businessContext }))
                .catch(err => log.error(`Telegram notify failed (delete): ${err.message}`));
        }

        // WebSocket: notify other clients
        broadcast('booking:deleted', { id, date: booking.date, permanent }, req.user?.id?.toString(), booking.date);
        _alertPush();

        // v19.1: Publish to event queue
        if (sideEffectsAllowedForContext(businessContext)) {
            publishEvent('booking.cancelled', {
                booking_id: id,
                booking_number: booking.booking_number || booking.id,
                business_context: businessContext,
                date: booking.date,
                time: booking.time || '',
                room: booking.room,
                label: booking.label || booking.program_code || '',
                program_code: booking.program_code,
                permanent,
                cancelled_by: req.user?.username
            }, `booking_cancelled_${id}`);
        }

        res.json({ success: true, permanent });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (delete)', rbErr));
        log.error('Error deleting booking', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Update booking — requires edit_booking action permission
router.post('/:id/linked-atomic', requireAction('edit_booking'), async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    if (!validateId(id)) return res.status(400).json({ error: 'Invalid booking ID' });
    if (body.main && typeof body.main !== 'object') return res.status(400).json({ error: 'Invalid main payload' });
    if (body.linked !== undefined && !Array.isArray(body.linked)) {
        return res.status(400).json({ error: 'Invalid linked payload' });
    }
    if (body.historyAction && !ATOMIC_LINKED_HISTORY_ACTIONS.has(body.historyAction)) {
        return res.status(400).json({ error: 'Invalid history action' });
    }
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'edit')) return;

    const mainPatch = pickAtomicLinkedPatch(body.main || {});
    const linkedInput = Array.isArray(body.linked) ? body.linked : [];
    const linkedPatches = linkedInput.map(item => ({
        id: item && item.id,
        patch: pickAtomicLinkedPatch(item)
    }));

    const hasMainPatch = Object.keys(mainPatch).length > 0;
    const hasLinkedPatch = linkedPatches.some(item => Object.keys(item.patch).length > 0);
    if (!hasMainPatch && !hasLinkedPatch) {
        return res.status(400).json({ error: 'No atomic booking fields to update' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const oldMain = await getScopedBookingById(client, id, businessContext, { forUpdate: true });
        if (!oldMain) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Booking not found' });
        }
        if (!canEditBooking(req.user, oldMain)) {
            await client.query('ROLLBACK');
            return sendBookingDenied(req, res, oldMain);
        }
        if (oldMain.linked_to) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Atomic linked update must target the main booking' });
        }

        const linkedResult = await client.query(
            `SELECT * FROM bookings
              WHERE linked_to = $1
                AND ${bookingContextSql('', '$2')}
                AND status != 'cancelled'
              FOR UPDATE`,
            [id, businessContext]
        );
        const linkedRows = linkedResult.rows;
        const linkedById = new Map(linkedRows.map(row => [row.id, row]));
        const linkedPatchById = new Map();
        for (const item of linkedPatches) {
            if (!validateId(item.id) || !linkedById.has(item.id)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Linked booking does not belong to the main booking' });
            }
            linkedPatchById.set(item.id, item.patch);
        }

        const mainTimeShapeChanged = ['date', 'time', 'duration'].some(field =>
            Object.prototype.hasOwnProperty.call(mainPatch, field)
        );
        if (mainTimeShapeChanged && linkedRows.length > 0 && linkedPatchById.size !== linkedRows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'All linked bookings must be included for time or duration changes' });
        }
        if (mainTimeShapeChanged && linkedRows.length > 0) {
            const requiredLinkedFields = ['date', 'time', 'duration'].filter(field =>
                Object.prototype.hasOwnProperty.call(mainPatch, field)
            );
            for (const row of linkedRows) {
                const patch = linkedPatchById.get(row.id) || {};
                const missingField = requiredLinkedFields.find(field =>
                    !Object.prototype.hasOwnProperty.call(patch, field)
                );
                if (missingField) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: `Linked booking ${row.id} is missing ${missingField}` });
                }
            }
        }

        const groupIds = [oldMain.id, ...linkedRows.map(row => row.id)];
        const mainCandidate = buildAtomicLinkedCandidate(oldMain, mainPatch);
        const mainValidationError = validateAtomicLinkedCandidate(mainCandidate);
        if (mainValidationError) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: mainValidationError });
        }

        const linkedCandidates = [];
        for (const row of linkedRows) {
            const patch = linkedPatchById.get(row.id) || {};
            const candidate = buildAtomicLinkedCandidate(row, patch);
            const validationError = validateAtomicLinkedCandidate(candidate);
            if (validationError) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: validationError, conflictBookingId: row.id });
            }
            if (Object.keys(patch).length > 0) linkedCandidates.push(candidate);
        }

        const mainLineConflict = await findAtomicLineConflict(client, mainCandidate, groupIds);
        if (mainLineConflict) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `Час зайнятий: ${mainLineConflict.label || mainLineConflict.program_code || mainLineConflict.id}`,
                conflictBookingId: mainLineConflict.id
            });
        }

        const mainRoomConflict = await findAtomicRoomConflict(client, mainCandidate, groupIds);
        if (mainRoomConflict) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `Кімната зайнята: ${mainRoomConflict.label || mainRoomConflict.program_code || mainRoomConflict.id}`,
                conflictBookingId: mainRoomConflict.id
            });
        }

        for (const candidate of linkedCandidates) {
            const linkedLineConflict = await findAtomicLineConflict(client, candidate, groupIds);
            if (linkedLineConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `Час зайнятий у пов'язаного бронювання: ${linkedLineConflict.label || linkedLineConflict.program_code || linkedLineConflict.id}`,
                    conflictBookingId: linkedLineConflict.id
                });
            }
        }

        const savedMainRow = await updateAtomicLinkedBookingFields(client, id, mainPatch, businessContext);
        const savedLinkedRows = [];
        const updatedLinkedRows = [];
        for (const row of linkedRows) {
            const patch = linkedPatchById.get(row.id) || {};
            const savedRow = await updateAtomicLinkedBookingFields(client, row.id, patch, businessContext);
            if (savedRow) savedLinkedRows.push(savedRow);
            if (savedRow && Object.keys(patch).length > 0) updatedLinkedRows.push(savedRow);
        }

        if (body.historyAction) {
            await client.query(
                'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
                [body.historyAction, req.user?.username, JSON.stringify(body.historyData || {
                    bookingId: id,
                    main: body.main || {},
                    linked: linkedInput
                })]
            );
        }

        await client.query('COMMIT');

        const mainBooking = savedMainRow ? mapBookingRow(savedMainRow) : mapBookingRow(oldMain);
        const linkedBookings = savedLinkedRows.map(mapBookingRow);

        broadcast('booking:updated', mainBooking, req.user?.id?.toString(), mainBooking.date);
        for (const linkedRow of updatedLinkedRows) {
            const linkedBooking = mapBookingRow(linkedRow);
            broadcast('booking:updated', linkedBooking, req.user?.id?.toString(), linkedBooking.date);
        }
        _alertPush();

        if (sideEffectsAllowedForContext(businessContext) && mainBooking.status !== 'preliminary') {
            getLineName(mainBooking.lineId, mainBooking.date, businessContext).then(lineName => notifyTelegram('edit', {
                ...mainBooking,
                program_code: mainBooking.programCode,
                program_name: mainBooking.programName,
                kids_count: mainBooking.kidsCount,
                created_by: mainBooking.createdBy
            }, { username: req.user?.username, bookingId: id, lineName, businessContext }))
                .catch(err => log.error(`Telegram notify failed (linked-atomic): ${err.message}`));
        }

        res.json({ success: true, booking: mainBooking, linkedBookings });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (linked-atomic)', rbErr));
        log.error('Error updating linked booking group atomically', err);
        res.status(500).json({ error: 'Failed to update linked bookings atomically' });
    } finally {
        client.release();
    }
});

router.post('/:id/confirm', requireAction('edit_booking'), async (req, res) => {
    const { id } = req.params;
    if (!validateId(id)) return res.status(400).json({ success: false, error: 'Invalid booking id' });

    const source = normalizeConfirmationSource(req.body?.source);
    const note = normalizeConfirmationNote(req.body?.note);
    const actor = req.user || {};
    const userId = actorUserId(actor);
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'edit')) return;
    const client = await pool.connect();
    let confirmedRow = null;
    let confirmedRows = [];

    try {
        await client.query('BEGIN');

        const current = await getScopedBookingById(client, id, businessContext, { forUpdate: true });
        if (!current) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Booking not found' });
        }
        if (!canEditBooking(req.user, current)) {
            await client.query('ROLLBACK');
            return sendBookingDenied(req, res, current);
        }

        if (current.status === 'confirmed') {
            await client.query('COMMIT');
            return res.json({
                success: true,
                ok: true,
                booking: mapBookingRow(current),
                action: { type: 'booking_confirmed', source, idempotent: true, durableMutation: false }
            });
        }

        if (current.status !== 'preliminary') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Only preliminary bookings can be confirmed through this action',
                currentStatus: current.status || null
            });
        }

        const updateResult = await client.query(
            `UPDATE bookings
             SET status = 'confirmed',
                 confirmed_at = NOW(),
                 confirmed_by = $1,
                 confirmation_note = $2,
                 confirmation_source = $3,
                 updated_at = NOW()
             WHERE (id = $4 OR linked_to = $4)
               AND ${bookingContextSql('', '$5')}
             RETURNING *`,
            [userId, note, source, id, businessContext]
        );

        confirmedRows = updateResult.rows;
        confirmedRow = updateResult.rows.find(row => row.id === id) || updateResult.rows[0];
        if (!confirmedRow) {
            await client.query('ROLLBACK');
            return res.status(500).json({ success: false, error: 'Booking confirmation did not update a row' });
        }

        await insertBookingConfirmationHistory(client, {
            booking: confirmedRow,
            actor,
            source,
            note,
            confirmedAt: confirmedRow.confirmed_at
        });

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (confirm)', rbErr));
        log.error('Error confirming booking', err);
        return res.status(500).json({ success: false, error: 'Failed to confirm booking' });
    } finally {
        client.release();
    }

    if (sideEffectsAllowedForContext(confirmedRow.business_context || DEFAULT_TIMELINE_CONTEXT)) {
        runBookingConfirmationSideEffects(confirmedRow, actor, source, confirmedRows);
    }
    res.json({
        success: true,
        ok: true,
        booking: mapBookingRow(confirmedRow),
        action: { type: 'booking_confirmed', source, durableMutation: true }
    });
});

router.put('/:id', requireAction('edit_booking'), async (req, res) => {
    const { id } = req.params;
    const b = req.body;
    const clientUpdatedAt = b.updatedAt || null;
    if (!validateId(id)) { return res.status(400).json({ error: 'Invalid booking ID' }); }
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'edit')) return;

    // v40: Merge missing fields from existing booking (before pool.connect to avoid leaks)
    const old = await getScopedBookingById(pool, id, businessContext);
    if (!old) { return res.status(404).json({ error: 'Booking not found' }); }
    b.businessContext = businessContext;
    if (!canEditBooking(req.user, old)) {
        return sendBookingDenied(req, res, old);
    }
    if (!b.date) b.date = old.date;
    if (!b.time) b.time = old.time;
    if (b.lineId === undefined) b.lineId = old.line_id;
    if (b.duration === undefined) b.duration = old.duration;
    if (b.room === undefined) b.room = old.room;
    if (b.label === undefined) b.label = old.label;
    if (b.status === undefined) b.status = old.status;
    if (b.price === undefined) b.price = old.price;
    if (b.programId === undefined) b.programId = old.program_id;
    if (b.category === undefined) b.category = old.category;
    if (b.pinataMode === undefined) b.pinataMode = old.pinata_mode;
    if (b.pinataNumber === undefined) b.pinataNumber = old.pinata_number;
    if (b.pinataFillerNumber === undefined) b.pinataFillerNumber = old.pinata_filler_number;
    if (b.pinataFiller === undefined) b.pinataFiller = old.pinata_filler;
    if (b.clientPinataServicePrice === undefined) b.clientPinataServicePrice = old.client_pinata_service_price;
    if (b.clientPinataServiceNote === undefined) b.clientPinataServiceNote = old.client_pinata_service_note;
    if (b.banquetGuests === undefined) b.banquetGuests = old.banquet_guests;
    if (b.banquetTables === undefined) b.banquetTables = old.banquet_tables;
    if (b.banquetMenu === undefined) b.banquetMenu = old.banquet_menu;

    if (!validateDate(b.date)) { return res.status(400).json({ error: 'Invalid date format' }); }
    if (!validateTime(b.time)) { return res.status(400).json({ error: 'Invalid time format' }); }
    await hydrateBookingRoomFromTimelineResource(pool, b, businessContext);
    const roomError = requireBookingRoom(b);
    if (roomError) { return res.status(400).json({ error: roomError }); }
    const capacityError = await validateBookingTimelineResourceCapacity(pool, b, businessContext);
    if (capacityError) { return res.status(409).json({ success: false, error: capacityError.error, resource: capacityError.resource }); }

    const client = await pool.connect();
    try {

        // v19.14: Input length validation
        if (b.notes && b.notes.length > 2000) { return res.status(400).json({ error: 'Нотатки: макс. 2000 символів' }); }
        if (b.label && b.label.length > 200) { return res.status(400).json({ error: 'Назва: макс. 200 символів' }); }
        if (b.room && b.room.length > 100) { return res.status(400).json({ error: 'Кімната: макс. 100 символів' }); }
        if (b.groupName && b.groupName.length > 200) { return res.status(400).json({ error: 'Група: макс. 200 символів' }); }
        const dur = parseInt(b.duration) || 0;
        if (dur < 0 || dur > 1440) { return res.status(400).json({ error: 'Тривалість: 0-1440 хвилин' }); }
        // v38.5.0: Prevent bookings spanning midnight
        if (b.time && dur > 0) {
            const [_hh, _mm] = b.time.split(':').map(Number);
            if (_hh * 60 + _mm + dur > 1440) {
                return res.status(400).json({ error: `Бронювання не може перевищувати опівніч. Макс: ${1440 - _hh * 60 - _mm} хв` });
            }
        }
        const pinataFields = applyPinataNormalization(b);
        if (pinataFields.error) {
            return res.status(400).json({ success: false, error: pinataFields.error });
        }
        applyBookingPackage(b);

        await client.query('BEGIN');

        const oldBooking = await getScopedBookingById(client, id, businessContext);
        if (!oldBooking) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Бронювання не знайдено' });
        }
        if (!b.linkedTo) {
            // v19.13: Skip conflict checks if date/time/line/duration unchanged
            const timeSlotChanged = oldBooking.date !== b.date || oldBooking.time !== b.time
                || oldBooking.line_id !== b.lineId || (oldBooking.duration || 0) !== (b.duration || 0);
            const roomChanged = oldBooking.room !== b.room || timeSlotChanged;

            if (timeSlotChanged) {
                const conflict = await checkServerConflicts(client, b.date, b.lineId, b.time, b.duration || 0, id, businessContext);
                if (conflict.overlap) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: `Час зайнятий: ${conflict.conflictWith.label || conflict.conflictWith.program_code} о ${conflict.conflictWith.time}`
                    });
                }
            }

            if (roomChanged && b.room && b.room !== 'Інше') {
                // v12.6: Exclude linked bookings of this booking from room conflict check
                const linkedIds = await client.query(
                    `SELECT id FROM bookings WHERE linked_to = $1 AND ${bookingContextSql('', '$2')}`,
                    [id, businessContext]
                );
                const excludeIds = [id, ...linkedIds.rows.map(r => r.id)];
                let roomConflict = null;
                const roomResult = await client.query(
                    `SELECT id, time, duration, label, program_code
                     FROM bookings
                     WHERE date = $1 AND room = $2 AND ${bookingContextSql('', '$3')} AND status != 'cancelled' AND id != ALL($4::text[])`,
                    [b.date, b.room, businessContext, excludeIds]
                );
                const newStart = timeToMinutes(b.time);
                const newEnd = newStart + (b.duration || 0);
                for (const rc of roomResult.rows) {
                    const rcStart = timeToMinutes(rc.time);
                    const rcEnd = rcStart + (rc.duration || 0);
                    if (newStart < rcEnd && newEnd > rcStart) {
                        roomConflict = rc;
                        break;
                    }
                }
                if (roomConflict) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        error: `Кімната "${b.room}" зайнята: ${roomConflict.label || roomConflict.program_code} о ${roomConflict.time}`
                    });
                }
            }

            if (String(b.status || oldBooking.status || '').toLowerCase() !== 'cancelled') {
                const teacherExcludeRows = await client.query(
                    `SELECT id FROM bookings WHERE linked_to = $1 AND ${bookingContextSql('', '$2')}`,
                    [id, businessContext]
                );
                const teacherConflict = await validateEducationLessonTeacherConflict(
                    client,
                    b,
                    businessContext,
                    [id, ...teacherExcludeRows.rows.map(r => r.id)]
                );
                if (teacherConflict) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({ success: false, error: teacherConflict.error, conflictBookingId: teacherConflict.conflict.id });
                }
            }
        }

        // Primary animator occupancy is represented by line_id. Do not use
        // bookings.hosts here: in this CRM it is the host count from product
        // setup, so treating hosts=1 as staff id 1 creates false conflicts.

        // v38.5.0: Status whitelist — prevent invalid status values and transitions
        const VALID_STATUSES = ['confirmed', 'preliminary', 'cancelled'];
        const newStatus = VALID_STATUSES.includes(b.status) ? b.status : (oldBooking.status || 'confirmed');
        // Prevent cancelled → confirmed/preliminary (must create new booking)
        if (oldBooking.status === 'cancelled' && newStatus !== 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Скасоване бронювання не можна відновити. Створіть нове.' });
        }

        // CRM: resolve customer_id for update
        const customerIdProvided = Object.prototype.hasOwnProperty.call(b, 'customerId')
            || Object.prototype.hasOwnProperty.call(b, 'customer_id');
        let updateCustomerId = sideEffectsAllowedForContext(businessContext)
            ? (customerIdProvided
                ? (b.customerId || b.customer_id ? parseInt(b.customerId || b.customer_id) : null)
                : (b.customer && b.customer.name ? null : (oldBooking.customer_id || null)))
            : null;
        if (sideEffectsAllowedForContext(businessContext) && !updateCustomerId && b.customer && b.customer.name) {
            const c = b.customer;
            if (c.phone && c.phone.trim()) {
                const existing = await client.query(
                    "SELECT id FROM customers WHERE phone = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
                    [c.phone.trim(), businessContext]
                );
                if (existing.rows.length > 0) {
                    updateCustomerId = existing.rows[0].id;
                }
            }
            if (!updateCustomerId) {
                const custResult = await client.query(
                    `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                    [businessContext, c.name.trim(), c.phone || null, c.instagram || null, c.childName || null, c.childBirthday || null, normalizeCustomerSource(c.source)]
                );
                updateCustomerId = custResult.rows[0].id;
            }
        }
        if (updateCustomerId) {
            const scopedCustomer = await client.query(
                "SELECT id FROM customers WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
                [updateCustomerId, businessContext]
            );
            if (!scopedCustomer.rows.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Customer does not belong to this business context' });
            }
        }
        b.customerId = updateCustomerId;

        let updateResult;
        if (clientUpdatedAt) {
            // Optimistic locking: check updated_at matches client's version
            // Use date_trunc('milliseconds', ...) because JS Date has only ms precision
            updateResult = await client.query(
                `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
                 label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
                 second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
                 linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22, customer_id=$25,
                 payment_method=$26, pinata_mode=$27, client_pinata_service_price=$28,
                 client_pinata_service_note=$29, pinata_number=$30, pinata_filler_number=$31,
                 banquet_guests=$32, banquet_tables=$33, banquet_menu=$34
                 WHERE id=$23
                   AND ${bookingContextSql('', '$35')}
                   AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $24::timestamp)
                 RETURNING *`,
                [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
                 b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
                 b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
                 b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null,
                 id, clientUpdatedAt, updateCustomerId, b.paymentMethod || null, b.pinataMode,
                 b.clientPinataServicePrice, b.clientPinataServiceNote, b.pinataNumber, b.pinataFillerNumber,
                 b.banquetGuests || null, b.banquetTables || null, b.banquetMenu || null, businessContext]
            );
        } else {
            // Legacy: no optimistic locking (backward compatibility)
            updateResult = await client.query(
                `UPDATE bookings SET date=$1, time=$2, line_id=$3, program_id=$4, program_code=$5,
                 label=$6, program_name=$7, category=$8, duration=$9, price=$10, hosts=$11,
                 second_animator=$12, pinata_filler=$13, costume=$14, room=$15, notes=$16, created_by=$17,
                 linked_to=$18, status=$19, kids_count=$20, group_name=$21, extra_data=$22, customer_id=$24,
                 payment_method=$25, pinata_mode=$26, client_pinata_service_price=$27,
                 client_pinata_service_note=$28, pinata_number=$29, pinata_filler_number=$30,
                 banquet_guests=$31, banquet_tables=$32, banquet_menu=$33
                 WHERE id=$23 AND ${bookingContextSql('', '$34')}
                 RETURNING *`,
                [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
                 b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
                 b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
                 b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null, id, updateCustomerId,
                 b.paymentMethod || null, b.pinataMode, b.clientPinataServicePrice, b.clientPinataServiceNote,
                 b.pinataNumber, b.pinataFillerNumber, b.banquetGuests || null, b.banquetTables || null, b.banquetMenu || null, businessContext]
            );
        }

        // Optimistic locking: conflict detected (0 rows updated)
        if (updateResult.rowCount === 0) {
            const currentResult = await client.query(
                `SELECT * FROM bookings WHERE id = $1 AND ${bookingContextSql('', '$2')}`,
                [id, businessContext]
            );
            await client.query('ROLLBACK');

            if (currentResult.rows.length === 0) {
                return res.status(404).json({ error: 'Бронювання не знайдено' });
            }

            const currentBooking = mapBookingRow(currentResult.rows[0]);
            return res.status(409).json({
                success: false,
                error: 'Бронювання було змінено іншим користувачем',
                conflict: true,
                currentData: currentBooking
            });
        }

        const savedBooking = mapBookingRow(updateResult.rows[0]);

        // v8.7: Sync linked bookings when secondAnimator changes
        if (!b.linkedTo) {
            const linkedResult = await client.query(
                `SELECT id, line_id FROM bookings WHERE linked_to = $1 AND ${bookingContextSql('', '$2')}`,
                [id, businessContext]
            );
            const oldSecond = oldBooking.second_animator;
            const newSecond = b.secondAnimator;
            const secondChanged = (oldSecond || '') !== (newSecond || '');

            if (secondChanged && linkedResult.rows.length > 0) {
                // Delete old linked bookings — secondAnimator changed or was cleared
                for (const linked of linkedResult.rows) {
                    await client.query(
                        `DELETE FROM bookings WHERE id = $1 AND ${bookingContextSql('', '$2')}`,
                        [linked.id, businessContext]
                    );
                }
                // Create new linked booking if secondAnimator is set
                if (newSecond) {
                    const ensuredLine = await ensureParkAnimatorLine(client, {
                        businessContext,
                        date: b.date,
                        lineId: null,
                        name: newSecond
                    });
                    if (ensuredLine) {
                        const newLinkedId = await generateBookingNumber(client);
                        await client.query(
                            `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
                            [newLinkedId, businessContext, b.date, b.time, ensuredLine.lineId, b.programId, b.programCode,
                             b.label, b.programName, b.category, b.duration, 0, b.hosts,
                             ensuredLine.name, b.pinataFiller, b.pinataMode, b.pinataNumber,
                             b.pinataFillerNumber, b.clientPinataServicePrice,
                             b.clientPinataServiceNote, b.costume || null, b.room, b.notes,
                             b.createdBy, id, newStatus, b.kidsCount || null, b.groupName || null,
                             null]
                        );
                    } else {
                        log.warn(`Second animator line not found: "${newSecond}" on ${b.date}`);
                    }
                }
            } else if (!secondChanged) {
                // No change in secondAnimator — cascade basic fields to existing linked
                for (const linked of linkedResult.rows) {
                    await client.query(
                        `UPDATE bookings SET date=$1, time=$2, duration=$3, status=$4, room=$5,
                         pinata_filler=$6, pinata_mode=$7, client_pinata_service_price=$8,
                         client_pinata_service_note=$9, pinata_number=$10, pinata_filler_number=$11,
                          updated_at=NOW() WHERE id=$12 AND ${bookingContextSql('', '$13')}`,
                        [b.date, b.time, b.duration, newStatus, b.room, b.pinataFiller, b.pinataMode,
                         b.clientPinataServicePrice, b.clientPinataServiceNote, b.pinataNumber,
                         b.pinataFillerNumber, linked.id, businessContext]
                    );
                }
            } else if (secondChanged && newSecond && linkedResult.rows.length === 0) {
                // Was missing linked booking (old bug) — create it now
                const ensuredLine = await ensureParkAnimatorLine(client, {
                    businessContext,
                    date: b.date,
                    lineId: null,
                    name: newSecond
                });
                if (ensuredLine) {
                    const newLinkedId = await generateBookingNumber(client);
                    await client.query(
                        `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
                        [newLinkedId, businessContext, b.date, b.time, ensuredLine.lineId, b.programId, b.programCode,
                         b.label, b.programName, b.category, b.duration, 0, b.hosts,
                         ensuredLine.name, b.pinataFiller, b.pinataMode, b.pinataNumber,
                         b.pinataFillerNumber, b.clientPinataServicePrice,
                         b.clientPinataServiceNote, b.costume || null, b.room, b.notes,
                         b.createdBy, id, newStatus, b.kidsCount || null, b.groupName || null,
                         null]
                    );
                } else {
                    log.warn(`Second animator line not found: "${newSecond}" on ${b.date}`);
                }
            }
        }

        await client.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['edit', req.user?.username, JSON.stringify({
                ...b,
                audit: bookingPackageAudit(oldBooking, b)
            })]
        );

        if (parkSideEffectsAllowedForContext(businessContext) && !b.linkedTo && b.price > 0 && newStatus !== 'preliminary') {
            await runOptionalBookingTransactionStep(client, 'Finance auto-record sync (update)', async () => {
                const finUpdate = await client.query(
                    `UPDATE finance_transactions
                     SET amount = $1,
                         description = $2,
                         date = $3,
                         payment_method = $4
                     WHERE booking_id = $5
                       AND type = 'income'
                       AND certificate_id IS NULL
                       AND COALESCE(business_context, 'event_genix') = $6`,
                    [b.price, `${b.programName || b.label || b.programCode} (${id})`, b.date, b.paymentMethod || null, id, businessContext]
                );
                if (finUpdate.rowCount === 0) {
                    await client.query(
                        `INSERT INTO finance_transactions (business_context, type, category_id, amount, description, date, payment_method, booking_id, created_by)
                         VALUES ($1, 'income', (SELECT id FROM finance_categories WHERE name = 'Бронювання' AND type = 'income' AND COALESCE(business_context, 'event_genix') = $1 LIMIT 1),
                                 $2, $3, $4, $5, $6, $7)`,
                        [businessContext, b.price, `${b.programName || b.label || b.programCode} (${id})`, b.date, b.paymentMethod || null, id, req.user?.username]
                    );
                }
            });
        }

        await commitBookingTransaction(client, 'booking update');

        const username = req.user?.username;
        const bookingForNotify = {
            ...b, id, label: b.label, program_code: b.programCode,
            program_name: b.programName, kids_count: b.kidsCount,
            status: newStatus,
            businessContext
        };

        const statusChanged = oldBooking.status !== newStatus;
        const notifyCatch = err => log.error(`Telegram notify failed (update): ${err.message}`);
        if (sideEffectsAllowedForContext(businessContext)) {
            getLineName(b.lineId, b.date, businessContext).then(lineName => {
                if (statusChanged && oldBooking.status === 'preliminary' && newStatus === 'confirmed') {
                    notifyTelegram('create', bookingForNotify, { username, bookingId: id, lineName, businessContext }).catch(notifyCatch);
                } else if (statusChanged) {
                    notifyTelegram('status_change', bookingForNotify, { username, bookingId: id, lineName, businessContext }).catch(notifyCatch);
                } else if (!b.linkedTo && newStatus !== 'preliminary') {
                    notifyTelegram('edit', bookingForNotify, { username, bookingId: id, lineName, businessContext }).catch(notifyCatch);
                }
            }).catch(notifyCatch);
        }
        if (sideEffectsAllowedForContext(businessContext) && statusChanged && oldBooking.status === 'preliminary' && newStatus === 'confirmed') {
            // v8.3.2: Fetch fresh row from DB for automation (req.body may lack extra_data)
            pool.query(
                `SELECT * FROM bookings WHERE id = $1 AND ${bookingContextSql('', '$2')}`,
                [id, businessContext]
            )
                .then(r => r.rows[0] ? processBookingAutomation({ ...mapBookingRow(r.rows[0]), _event: 'confirm' }) : null)
                .catch(err => log.error(`Automation failed (non-blocking): ${err.message}`));
        }

        // WebSocket: notify other clients
        broadcast('booking:updated', savedBooking, req.user?.id?.toString(), b.date);
        _alertPush();

        // v19.1: Publish status change events to event queue
        if (sideEffectsAllowedForContext(businessContext) && statusChanged) {
            const eventType = newStatus === 'confirmed' ? 'booking.confirmed' : `booking.status_changed`;
            publishEvent(eventType, {
                booking_id: id, business_context: businessContext, date: b.date, time: b.time, room: b.room,
                program_code: b.programCode, old_status: oldBooking.status,
                new_status: newStatus, updated_by: req.user?.username
            }, `booking_status_${id}_${Date.now()}`);
        }

        res.json({ success: true, booking: savedBooking });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (update)', rbErr));
        log.error('Error updating booking', err);
        res.status(err.statusCode || 500).json({
            success: false,
            error: err.publicMessage || 'Failed to update booking',
            code: err.code || 'internal_error'
        });
    } finally {
        client.release();
    }
});

// v29.1.0: Checkbox MVP — update payment method
router.patch('/:id/payment', requireAction('edit_booking'), async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_method, fiscal_required } = req.body;
        if (!validateId(id)) return res.status(400).json({ error: 'Invalid booking ID' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'edit')) return;

        const booking = await getScopedBookingById(pool, id, businessContext);
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        if (!canEditBooking(req.user, booking)) {
            return sendBookingDenied(req, res, booking);
        }

        const updates = ['updated_at = NOW()'];
        const params = [];

        if (payment_method !== undefined) {
            params.push(payment_method);
            updates.push(`payment_method = $${params.length}`);
        }
        if (fiscal_required !== undefined) {
            params.push(fiscal_required);
            updates.push(`fiscal_required = $${params.length}`);
        }

        if (params.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(id);
        params.push(businessContext);
        const result = await pool.query(
            `UPDATE bookings SET ${updates.join(', ')}
             WHERE id = $${params.length - 1} AND ${bookingContextSql('', `$${params.length}`)}
             RETURNING id, business_context, payment_method, fiscal_required`,
            params
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        res.json({ success: true, booking: mapBookingRow(result.rows[0]) });
    } catch (err) {
        log.error('PATCH /bookings/:id/payment error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
