/**
 * routes/bookings.js — Booking CRUD endpoints
 */
const router = require('express').Router();
const { pool, generateBookingNumber } = require('../db');
const {
    validateDate,
    validateTime,
    validateId,
    mapBookingRow,
    checkServerConflicts,
    checkServerDuplicate,
    checkRoomConflict,
    timeToMinutes,
    minutesToTime,
    normalizeBookingStatus,
    lockBookingConflictResources,
    isLineConflictBlockingLine,
    isRoomConflictBlockingRoom,
    findRoomConflictAmongCandidates,
    ALL_ROOMS,
    BANQUET_SERVICE_LINE_ID,
    validateBanquetCreationContext
} = require('../services/booking');
const { normalizePinataFields } = require('../services/pinataMode');
const { notifyTelegram } = require('../services/telegram');
const { processBookingAutomation } = require('../services/bookingAutomation');
const { insertHistory } = require('../services/historyLog');
const { attachLeadBookingLink, ensureLeadForBooking } = require('../services/leadBookingLink');
const { applyBookingPackage, applyBookingPackageEntryCharge, bookingPackageAudit } = require('../services/bookingPackage');
const { buildBanquetSummary, normalizeBanquetSummaryMode } = require('../services/banquetSummary');
const {
    buildBanquetSummaryPdfBuffer,
    banquetSummaryPdfFilename
} = require('../services/banquetSummaryPdf');
const { loadBanquetTermsDefaults, snapshotBanquetTermsForBooking } = require('../services/banquetTerms');
const { upsertManagerBookingDeposit } = require('../services/banquetDeposits');
const {
    loadBanquetGroupByBookingId,
    loadBanquetGroupById,
    reconcileBanquetGroupForBooking,
    createBanquetGroupInTransaction,
    persistDerivedBookingSetMetadata,
    validateSingleBookingActivitySetUpdate
} = require('../services/banquetGroups');
const { applyEffectiveBookingPrice, refreshMultiActivityPriceTotals } = require('../services/productPricing');
const { broadcastBookingEvent } = require('../services/websocket');
const { publish: publishEvent, publishInTransaction } = require('../services/eventBus');
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
const { scheduleableStaffWhere } = require('../services/staffOperationalFilters');
const { normalizeCustomerSource } = require('../services/customerSource');
const {
    listCustomerChildren,
    buildCustomerChildrenProjection
} = require('../services/customerChildren');
const {
    findTimelineResource,
    findTimelineResourceByName,
    getTimelineDisplaySettings,
    listTimelineResources,
    resolveRoomTimelineResourceIdentity,
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

const { requireAction, authenticateToken, userHasAnyRole } = require('../middleware/auth');
const log = createLogger('Bookings');

// v39.8: Security — require authentication for all booking endpoints
router.use(authenticateToken);

function applyBookingStatusForCreate(booking, fallback = 'confirmed') {
    const status = normalizeBookingStatus(booking?.status, fallback);
    if (!status) return 'invalid';
    if (booking) booking.status = status;
    return null;
}

async function insertScopedHistory(queryable, action, username, data, businessContext) {
    await insertHistory(queryable, {
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
        action,
        username,
        data
    });
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

async function getScopedBookingById(queryable, id, businessContext, { forUpdate = false } = {}) {
    const result = await queryable.query(
        `SELECT * FROM bookings WHERE id = $1 AND ${bookingContextSql('', '$2')}${forUpdate ? ' FOR UPDATE' : ''}`,
        [id, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    return result.rows[0] || null;
}

async function getBanquetMembershipForDelete(queryable, bookingId, businessContext) {
    try {
        const result = await queryable.query(
            `SELECT bgb.group_id, bgb.booking_id, bgb.role, bg.primary_booking_id, bg.status AS group_status
               FROM banquet_group_bookings bgb
               JOIN banquet_groups bg ON bg.id = bgb.group_id
              WHERE bgb.booking_id = $1
                AND ${bookingContextSql('bgb', '$2')}
                AND ${bookingContextSql('bg', '$2')}
              FOR UPDATE OF bgb, bg`,
            [bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
        );
        return result.rows[0] || null;
    } catch (err) {
        if (isMissingBanquetSchemaError(err)) return null;
        throw err;
    }
}

async function detachBanquetMembershipOnSoftDelete(queryable, bookingId, businessContext, user) {
    const membership = await getBanquetMembershipForDelete(queryable, bookingId, businessContext);
    if (!membership) return { detached: false, membership: null };
    const primaryBookingId = String(membership.primary_booking_id || '').trim();
    if (!primaryBookingId || String(membership.role || '').toLowerCase() === 'primary' || primaryBookingId === String(bookingId)) {
        const activeMembers = await queryable.query(
            `SELECT b.id
               FROM banquet_group_bookings bgb
               JOIN bookings b ON b.id = bgb.booking_id
              WHERE bgb.group_id = $1
                AND ${bookingContextSql('bgb', '$2')}
                AND ${bookingContextSql('b', '$2')}
                AND ${bookingActiveStatusSql('b')}
              LIMIT 1
              FOR UPDATE OF b`,
            [membership.group_id, businessContext || DEFAULT_TIMELINE_CONTEXT]
        );
        if (activeMembers.rows.length) return { detached: false, membership, groupCancelled: false };

        const cancelledGroup = await queryable.query(
            `UPDATE banquet_groups
                SET status = 'cancelled', updated_at = NOW(), updated_by = $3
              WHERE id = $1
                AND ${bookingContextSql('', '$2')}
                AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) != 'cancelled'
              RETURNING id`,
            [membership.group_id, businessContext || DEFAULT_TIMELINE_CONTEXT, user?.username || 'system']
        );
        if (cancelledGroup.rows.length) {
            await insertScopedHistory(queryable, 'banquet_group_cancelled_on_primary_delete', user?.username, {
                group_id: membership.group_id,
                primary_booking_id: primaryBookingId || bookingId,
                reason: 'all_group_bookings_cancelled',
                cancelled_via: 'booking_soft_delete'
            }, businessContext || DEFAULT_TIMELINE_CONTEXT);
        }
        return { detached: false, membership, groupCancelled: Boolean(cancelledGroup.rows.length) };
    }

    await queryable.query(
        `DELETE FROM banquet_group_bookings
          WHERE group_id = $1
            AND booking_id = $2
            AND ${bookingContextSql('', '$3')}`,
        [membership.group_id, bookingId, businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    await queryable.query(
        `DELETE FROM booking_banquet_links
          WHERE business_context = $1
            AND relation_type = $4
            AND (
                (booking_a_id = $2 AND booking_b_id = $3)
                OR (booking_a_id = $3 AND booking_b_id = $2)
            )`,
        [businessContext || DEFAULT_TIMELINE_CONTEXT, primaryBookingId, bookingId, 'banquet_activity']
    );
    await queryable.query(
        `UPDATE banquet_groups
            SET updated_at = NOW(), updated_by = $3
          WHERE id = $1
            AND ${bookingContextSql('', '$2')}`,
        [membership.group_id, businessContext || DEFAULT_TIMELINE_CONTEXT, user?.username || 'system']
    );
    await insertScopedHistory(queryable, 'banquet_group_booking_detached', user?.username, {
        group_id: membership.group_id,
        primary_booking_id: primaryBookingId,
        booking_id: bookingId,
        role: membership.role || null,
        detached_via: 'booking_soft_delete'
    }, businessContext || DEFAULT_TIMELINE_CONTEXT);
    return { detached: true, membership };
}

function sendBookingDenied(req, res, booking) {
    if (!canViewBooking(req.user, booking)) {
        return res.status(404).json(bookingAccessDeniedPayload());
    }
    return res.status(403).json({ success: false, error: 'Insufficient booking permissions' });
}

function requirePermanentBookingDelete(req, res) {
    if (userHasAnyRole(req.user, ['creator', 'director'])) return true;
    res.status(403).json({ success: false, error: 'Insufficient permissions' });
    return false;
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
                 AND ${bookingActiveStatusSql('b')}
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

function bookingTimelineProjectionContract(booking = {}) {
    const identity = booking.timelineIdentity || {};
    const projection = booking.timelineProjection || {};
    return {
        id: booking.id || null,
        resourceId: projection.resourceId || booking.resourceId || booking.lineId || identity.resourceId || identity.lineId || null,
        resourceType: projection.resourceType || booking.resourceType || identity.resourceType || null,
        displayName: projection.resourceName || booking.displayName || booking.lineName || identity.displayName || identity.resourceName || null,
        businessContext: booking.businessContext || identity.businessContext || DEFAULT_TIMELINE_CONTEXT,
        date: booking.date || null,
        source: identity.source || booking.source || 'booking_row',
        capacity: booking.capacity || identity.capacity || null,
        visibility: booking.timelineVisibility || booking.timelineProjectionStatus || booking.timeline_projection_status || null,
        timelineProjection: booking.timelineProjection || null
    };
}

function projectCreatedBookingsForTimelineResponse(bookings = [], timelineView = 'animators') {
    const visibilityById = new Map((Array.isArray(bookings) ? bookings : [])
        .map(booking => [String(booking?.id || ''), booking?.timelineProjection || null])
        .filter(([id]) => Boolean(id)));
    return projectBookingsForTimelineView(bookings, timelineView).map(booking => {
        const visibility = visibilityById.get(String(booking?.id || '')) || null;
        return {
            ...booking,
            timelineVisibility: visibility,
            timelineProjectionStatus: visibility,
            timeline_projection_status: visibility
        };
    });
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

async function queueBookingEventInTransaction(client, eventType, payload, aggregateId, idempotencyKey) {
    if (typeof publishInTransaction !== 'function') {
        publishEvent(eventType, payload, idempotencyKey);
        return;
    }
    await publishInTransaction(
        client,
        eventType,
        payload,
        'booking',
        aggregateId,
        idempotencyKey
    );
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
            AND ${bookingActiveStatusSql('b')}`,
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

async function reconcileBookingBanquetGroupsSafely(bookingIds, businessContext, user) {
    if (!sideEffectsAllowedForContext(businessContext)) return [];
    const uniqueIds = [...new Set((Array.isArray(bookingIds) ? bookingIds : [bookingIds])
        .map(id => String(id || '').trim())
        .filter(Boolean))];
    const results = [];
    for (const bookingId of uniqueIds) {
        try {
            const result = await reconcileBanquetGroupForBooking({
                bookingId,
                businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
                user,
                source: 'booking_write_auto_group'
            });
            results.push(result);
        } catch (err) {
            log.warn(`Banquet auto-group reconciliation failed for ${bookingId}: ${err.message}`);
            results.push({
                success: false,
                reconciled: false,
                skipped: true,
                reason: 'reconciliation_failed',
                bookingId,
                error: err.message
            });
        }
    }
    return results;
}

function bookingLeadAutoCreateAllowedForContext(context) {
    return sideEffectsAllowedForContext(context) && (context || DEFAULT_TIMELINE_CONTEXT) !== DEFAULT_TIMELINE_CONTEXT;
}

function hasBookingLeadIdentity(booking, customerId) {
    const customer = booking?.customer || {};
    const telegram = booking?.telegram || customer.telegram || {};
    return Boolean(
        customerId
        || String(customer.name || '').trim()
        || String(customer.phone || '').trim()
        || String(customer.instagram || '').trim()
        || String(customer.email || booking?.email || '').trim()
        || String(customer.whatsapp || customer.whatsapp_phone || booking?.whatsapp || booking?.whatsapp_phone || '').trim()
        || String(customer.telegramId || customer.telegram_id || booking?.telegramId || booking?.telegram_id || telegram.id || '').trim()
        || String(customer.telegramUsername || customer.telegram_username || booking?.telegramUsername || booking?.telegram_username || telegram.username || '').trim()
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
                businessContext,
                bookingStatus: booking.status
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

    if (requestedLineId === BANQUET_SERVICE_LINE_ID) {
        const serviceName = requestedName || 'Банкет / кімната';
        await client.query(
            `INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet)
             VALUES ($1, $2, $3, $4, $5, false)
             ON CONFLICT (business_context, date, line_id)
             DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color`,
            [context, safeDate, BANQUET_SERVICE_LINE_ID, serviceName, '#14B8A6']
        );
        return { lineId: BANQUET_SERVICE_LINE_ID, name: serviceName, color: '#14B8A6' };
    }

    const existing = await client.query(
        `SELECT line_id, name, color
           FROM lines_by_date
          WHERE date = $1
            AND ${bookingContextSql('', '$2')}
            AND (
                from_sheet IS DISTINCT FROM true
                OR EXISTS (
                    SELECT 1
                    FROM staff_schedule ss
                    JOIN staff scheduled_staff ON scheduled_staff.id = ss.staff_id
                    WHERE ss.staff_id::text = lines_by_date.line_id
                      AND LEFT(ss.date::text, 10) = $1
                      AND ss.status IN ('working', 'remote')
                      AND ${scheduleableStaffWhere('scheduled_staff', { dateExpression: '$1' })}
                )
            )
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
          WHERE ${scheduleableStaffWhere('s', { dateExpression: '$3' })}
            AND ${staffAnimatorWhere('s')}
            AND (
                ($1 <> '' AND s.id::text = $1)
                OR ($2 <> '' AND LOWER(BTRIM(s.name)) = LOWER(BTRIM($2)))
                OR ($2 <> '' AND LOWER(BTRIM(COALESCE(s.display_name, ''))) = LOWER(BTRIM($2)))
            )
          ORDER BY CASE WHEN s.id::text = $1 THEN 0 ELSE 1 END, s.name
          LIMIT 1`,
        [requestedLineId, requestedName, safeDate]
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
            AND (
                from_sheet IS DISTINCT FROM true
                OR EXISTS (
                    SELECT 1
                    FROM staff_schedule ss
                    JOIN staff scheduled_staff ON scheduled_staff.id = ss.staff_id
                    WHERE ss.staff_id::text = lines_by_date.line_id
                      AND LEFT(ss.date::text, 10) = $1
                      AND ss.status IN ('working', 'remote')
                      AND ${scheduleableStaffWhere('scheduled_staff', { dateExpression: '$1' })}
                )
            )
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
        lineId: identity.lineId || identity.resourceId || booking.lineId || null,
        resourceType: identity.resourceType || identity.type || null,
        resourceName: identity.resourceName || identity.name || booking.lineName || booking.room || null,
        lineName: identity.lineName || identity.resourceName || identity.name || booking.lineName || null,
        source: identity.source || null
    };
    return extra.timelineIdentity;
}

function timelineResourceTypeForBooking(businessContext, booking = {}) {
    return booking.resourceType
        || booking.resource_type
        || (businessContext === DEFAULT_TIMELINE_CONTEXT ? 'animator' : 'specialist');
}

function attachLinkedBookingTimelineIdentity(booking, businessContext, identity = {}) {
    if (!booking || !booking.lineId) return null;
    return attachTimelineIdentityToBooking(booking, {
        businessContext,
        resourceId: identity.resourceId || identity.lineId || booking.resourceId || booking.lineId,
        lineId: identity.lineId || booking.lineId,
        resourceType: identity.resourceType || identity.type || timelineResourceTypeForBooking(businessContext, booking),
        resourceName: identity.resourceName || identity.name || booking.lineName || booking.secondAnimator || booking.room || null,
        source: identity.source || booking.resourceSource || 'linked_booking_line'
    });
}

function bookingExtraDataSqlValue(booking = {}) {
    const extra = booking.extraData;
    if (!extra) return null;
    if (typeof extra === 'string') return extra.trim() ? extra : null;
    if (typeof extra === 'object' && !Array.isArray(extra) && Object.keys(extra).length > 0) {
        return JSON.stringify(extra);
    }
    return null;
}

function parsePayloadExtraData(payload = {}) {
    const extra = payload.extraData ?? payload.extra_data;
    if (!extra) return null;
    if (typeof extra === 'object' && !Array.isArray(extra)) return extra;
    if (typeof extra === 'string' && extra.trim()) {
        try {
            const parsed = JSON.parse(extra);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

function mergeExistingExtraDataForBookingUpdate(payload = {}, oldRow = {}) {
    if (!payload) return;
    const previousExtra = getBookingExtraDataObject({ extraData: oldRow.extra_data });
    const incomingExtra = parsePayloadExtraData(payload) || {};
    if (!Object.keys(previousExtra).length && !Object.keys(incomingExtra).length) return;
    payload.extraData = {
        ...cloneJson(previousExtra),
        ...cloneJson(incomingExtra)
    };
}

function banquetGroupPayloads(payload = {}) {
    const extra = parsePayloadExtraData(payload);
    return [
        extra?.banquetGroup,
        extra?.banquet_group,
        payload.banquetGroup,
        payload.banquet_group
    ].filter(group => group && typeof group === 'object' && !Array.isArray(group));
}

function banquetGroupRequiresMembership(group = {}) {
    const requiresMembership = group.requiresMembership ?? group.requires_membership;
    return requiresMembership === true || String(requiresMembership || '').trim().toLowerCase() === 'true';
}

function hasExplicitBanquetAddToExistingIntent(payload = {}) {
    return banquetGroupPayloads(payload).some(group => (
        String(group.intent || '').trim().toLowerCase() === 'add_to_existing'
        || banquetGroupRequiresMembership(group)
    ));
}

function hasBanquetGroupPayload(payload = {}) {
    return banquetGroupPayloads(payload).some(group => Boolean(
        hasExplicitBanquetAddToExistingIntent({ banquetGroup: group })
        || group.groupId
        || group.group_id
        || group.sourceBookingId
        || group.source_booking_id
        || group.role
        || group.source === 'room_booking_animation_bridge'
    ));
}

function banquetAddToExistingRequiresAtomicPayload() {
    return {
        success: false,
        code: 'BANQUET_ADD_TO_EXISTING_REQUIRES_ATOMIC_ENDPOINT',
        error: 'Add-to-existing banquet bookings must be created through atomic banquet endpoints.',
        useEndpoints: [
            '/api/banquets/:groupId/member-booking',
            '/api/banquets/:groupId/activity-booking'
        ]
    };
}

function rejectExplicitBanquetAddToExistingGenericCreate(res, payload = {}) {
    if (!hasExplicitBanquetAddToExistingIntent(payload)) return false;
    res.status(409).json(banquetAddToExistingRequiresAtomicPayload());
    return true;
}

function validateBookingBanquetCreationContract(res, value) {
    const validation = validateBanquetCreationContext(value);
    if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error, code: validation.code });
        return { rejected: true, context: null };
    }
    if (validation.context?.mode === 'existing') {
        res.status(409).json(banquetAddToExistingRequiresAtomicPayload());
        return { rejected: true, context: null };
    }
    return { rejected: false, context: validation.context };
}

function hasAnyBanquetGroupPayload(...payloadGroups) {
    return payloadGroups.flat().filter(Boolean).some(hasBanquetGroupPayload);
}

function cleanRoomConflictPolicyValue(value) {
    const text = String(value || '').trim();
    return text || null;
}

function banquetGroupConflictContextFromPayload(payload = {}) {
    const extra = getBookingExtraDataObject(payload);
    const group = extra.banquetGroup || extra.banquet_group || payload.banquetGroup || payload.banquet_group || {};
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const workspaceGroup = workspace.banquetGroup || workspace.banquet_group || {};
    return {
        groupId: cleanRoomConflictPolicyValue(
            group.groupId
            || group.group_id
            || group.id
            || workspace.banquetGroupId
            || workspace.banquet_group_id
            || workspaceGroup.groupId
            || workspaceGroup.group_id
            || workspaceGroup.id
            || payload.banquetGroupId
            || payload.banquet_group_id
        ),
        sourceBookingId: cleanRoomConflictPolicyValue(
            group.sourceBookingId
            || group.source_booking_id
            || workspace.sourceBookingId
            || workspace.source_booking_id
            || payload.sourceBookingId
            || payload.source_booking_id
        )
    };
}

function bookingRoomConflictPolicyOptions(booking = {}, options = {}) {
    const base = options && typeof options === 'object' && !Array.isArray(options) ? { ...options } : {};
    const context = banquetGroupConflictContextFromPayload(booking);
    const groupId = cleanRoomConflictPolicyValue(base.banquetGroupId || base.banquet_group_id || context.groupId);
    const sourceBookingId = cleanRoomConflictPolicyValue(base.sourceBookingId || base.source_booking_id || context.sourceBookingId);
    if (!groupId && !sourceBookingId) return Object.keys(base).length ? base : null;
    return {
        ...base,
        banquetGroupId: groupId || undefined,
        sourceBookingId: sourceBookingId || undefined,
        candidateBooking: booking,
        allowSameBanquetOperationalOverlap: true
    };
}

function bookingSecondAnimatorName(booking = {}) {
    return String(booking.secondAnimator ?? booking.second_animator ?? '').trim();
}

function bookingSecondAnimatorLineId(booking = {}) {
    return String(
        booking.secondAnimatorLineId
        ?? booking.second_animator_line_id
        ?? booking.extraData?.bookingWorkspace?.secondAnimatorLineId
        ?? booking.extra_data?.bookingWorkspace?.secondAnimatorLineId
        ?? ''
    ).trim();
}

function bookingRequiresSecondAnimatorLink(booking = {}) {
    return Boolean(bookingSecondAnimatorName(booking));
}

function normalizeBookingSecondAnimatorFields(booking = {}) {
    const secondAnimator = bookingSecondAnimatorName(booking);
    if (!secondAnimator) {
        if (Object.prototype.hasOwnProperty.call(booking, 'secondAnimator')) booking.secondAnimator = null;
        return booking;
    }
    booking.secondAnimator = secondAnimator;
    const hostCount = Number(booking.hosts || 0);
    if (!Number.isFinite(hostCount) || hostCount < 2) booking.hosts = 2;
    return booking;
}

async function ensureSecondAnimatorLineForBooking(client, booking, businessContext) {
    const secondAnimator = bookingSecondAnimatorName(booking);
    if (!secondAnimator) return null;
    return ensureParkAnimatorLine(client, {
        businessContext,
        date: booking.date,
        lineId: bookingSecondAnimatorLineId(booking) || null,
        name: secondAnimator
    });
}

async function insertSecondAnimatorLinkedBooking(client, { booking, businessContext, mainBookingId, status, ensuredLine }) {
    const linkedBooking = {
        ...booking,
        lineId: ensuredLine.lineId,
        lineName: ensuredLine.name,
        price: 0,
        secondAnimator: ensuredLine.name,
        extraData: {}
    };
    attachLinkedBookingTimelineIdentity(linkedBooking, businessContext, {
        ...ensuredLine,
        source: 'staff_animator'
    });
    const newLinkedId = await generateBookingNumber(client);
    const insert = await client.query(
        `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
         RETURNING *`,
        [newLinkedId, businessContext, booking.date, booking.time, ensuredLine.lineId, booking.programId, booking.programCode,
         booking.label, booking.programName, booking.category, booking.duration, 0, booking.hosts,
         ensuredLine.name, booking.pinataFiller, booking.pinataMode, booking.pinataNumber,
         booking.pinataFillerNumber, booking.clientPinataServicePrice,
         booking.clientPinataServiceNote, booking.costume || null, booking.room, booking.notes,
         booking.createdBy, mainBookingId, status, booking.kidsCount || null, booking.groupName || null,
         bookingExtraDataSqlValue(linkedBooking)]
    );
    return insert.rows[0] || { id: newLinkedId };
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
    await insertScopedHistory(client, 'booking_confirmed', actor?.username, {
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
        },
        booking.business_context || DEFAULT_TIMELINE_CONTEXT
    );
}

async function insertBookingMarkedPreliminaryHistory(client, { booking, actor, source, note, previousStatus, changedAt }) {
    await insertScopedHistory(client, 'booking_marked_preliminary', actor?.username, {
            entity_type: 'booking',
            entity_id: booking.id,
            business_context: booking.business_context || DEFAULT_TIMELINE_CONTEXT,
            action_type: 'booking_marked_preliminary',
            actor_user_id: actorUserId(actor),
            meta: {
                from_status: previousStatus || 'confirmed',
                to_status: 'preliminary',
                source,
                note,
                marked_preliminary_at: changedAt || booking.updated_at || null
            }
        },
        booking.business_context || DEFAULT_TIMELINE_CONTEXT
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
        broadcastBookingEvent('booking:updated', updatedBooking, actor?.id?.toString());
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

function runBookingPreliminarySideEffects(row, actor, source, updatedRows = [], previousStatus = 'confirmed') {
    const booking = mapBookingRow(row);
    const username = actor?.username;

    const broadcastRows = updatedRows.length ? updatedRows : [row];
    for (const updatedRow of broadcastRows) {
        const updatedBooking = mapBookingRow(updatedRow);
        broadcastBookingEvent('booking:updated', updatedBooking, actor?.id?.toString());
    }
    _alertPush();

    publishEvent('booking.status_changed', {
        booking_id: booking.id,
        business_context: booking.businessContext || DEFAULT_TIMELINE_CONTEXT,
        date: booking.date,
        time: booking.time,
        room: booking.room,
        program_code: booking.programCode,
        old_status: previousStatus || 'confirmed',
        new_status: 'preliminary',
        updated_by: username,
        status_source: source
    }, `booking_preliminary_${booking.id}_${Date.now()}`);
}

const ATOMIC_LINKED_FIELDS = new Map([
    ['date', 'date'],
    ['time', 'time'],
    ['lineId', 'line_id'],
    ['room', 'room'],
    ['duration', 'duration']
]);

const ATOMIC_LINKED_HISTORY_ACTIONS = new Set([
    'drag', 'undo_drag',
    'resize', 'undo_resize',
    'shift', 'undo_shift'
]);

const BANQUET_LINK_RELATION_TYPE = 'banquet_activity';
const SHARED_ROOM_LINK_RELATION_TYPE = 'shared_room_activity';
const BOOKING_VISUAL_LINK_RELATION_TYPES = Object.freeze([
    BANQUET_LINK_RELATION_TYPE,
    SHARED_ROOM_LINK_RELATION_TYPE
]);

function normalizeBookingLinkRelationType(value, fallback = BANQUET_LINK_RELATION_TYPE) {
    const relationType = String(value || '').trim();
    return BOOKING_VISUAL_LINK_RELATION_TYPES.includes(relationType) ? relationType : fallback;
}

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

function mapBookingVisualLinkRowsForResponse(rows = [], preferredBookingId = null, fallbackBookingIds = []) {
    const fallbackSet = new Set((Array.isArray(fallbackBookingIds) ? fallbackBookingIds : [])
        .filter(Boolean)
        .map(id => String(id)));
    return (Array.isArray(rows) ? rows : []).map(row => {
        const preferred = preferredBookingId && (
            String(row.booking_a_id) === String(preferredBookingId)
            || String(row.booking_b_id) === String(preferredBookingId)
        )
            ? preferredBookingId
            : null;
        const fallback = preferred || [row.booking_a_id, row.booking_b_id].find(id => fallbackSet.has(String(id)));
        return mapBanquetLinkRow(row, fallback || preferredBookingId || row.booking_a_id);
    });
}

async function attachBanquetLinksToBookings(bookings, businessContext) {
    if (!Array.isArray(bookings) || bookings.length === 0) return bookings;
    const ids = bookings.map(booking => booking.id).filter(Boolean);
    if (ids.length === 0) return bookings;

    let linksResult;
    try {
        linksResult = await pool.query(
            `SELECT id, booking_a_id, booking_b_id, relation_type, label, created_at, created_by
               FROM booking_banquet_links
              WHERE business_context = $1
                AND relation_type = ANY($2::text[])
                AND booking_a_id = ANY($3::text[])
                AND booking_b_id = ANY($3::text[])
              ORDER BY created_at ASC, id ASC`,
            [businessContext || DEFAULT_TIMELINE_CONTEXT, BOOKING_VISUAL_LINK_RELATION_TYPES, ids]
        );
    } catch (err) {
        log.warn(`Booking visual link enrichment skipped: ${err.message}`);
        return bookings.map(booking => ({
            ...booking,
            bookingLinks: Array.isArray(booking.bookingLinks) ? booking.bookingLinks : [],
            banquetLinks: Array.isArray(booking.banquetLinks) ? booking.banquetLinks : [],
            sharedRoomLinks: Array.isArray(booking.sharedRoomLinks) ? booking.sharedRoomLinks : []
        }));
    }
    const byBooking = new Map(ids.map(id => [String(id), []]));
    linksResult.rows.forEach(row => {
        const a = String(row.booking_a_id);
        const b = String(row.booking_b_id);
        if (byBooking.has(a)) byBooking.get(a).push(mapBanquetLinkRow(row, a));
        if (byBooking.has(b)) byBooking.get(b).push(mapBanquetLinkRow(row, b));
    });
    return bookings.map(booking => {
        const bookingLinks = byBooking.get(String(booking.id)) || [];
        return {
            ...booking,
            bookingLinks,
            banquetLinks: bookingLinks.filter(link => link.relationType === BANQUET_LINK_RELATION_TYPE),
            sharedRoomLinks: bookingLinks.filter(link => link.relationType === SHARED_ROOM_LINK_RELATION_TYPE)
        };
    });
}

async function upsertBanquetLink(client, businessContext, sourceId, targetId, label, user, relationType = BANQUET_LINK_RELATION_TYPE) {
    const pair = normalizeBanquetLinkPair(sourceId, targetId);
    if (!pair) return null;
    const normalizedRelationType = normalizeBookingLinkRelationType(relationType);
    await client.query(
        `DELETE FROM booking_banquet_links
          WHERE business_context = $1
            AND booking_a_id = $3
            AND booking_b_id = $2
            AND relation_type = $4`,
        [businessContext, pair[0], pair[1], normalizedRelationType]
    );
    const insert = await client.query(
        `INSERT INTO booking_banquet_links
            (business_context, booking_a_id, booking_b_id, relation_type, label, created_by_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (business_context, booking_a_id, booking_b_id, relation_type)
         DO UPDATE SET label = COALESCE(EXCLUDED.label, booking_banquet_links.label),
                       updated_at = NOW()
         RETURNING id, booking_a_id, booking_b_id, relation_type, label, created_at, created_by`,
        [businessContext, pair[0], pair[1], normalizedRelationType, label || null, actorUserId(user), user?.username || null]
    );
    return insert.rows[0] || null;
}

function bookingTimesOverlap(first, second) {
    if (!first?.time || !second?.time) return false;
    const firstStart = timeToMinutes(first.time);
    const secondStart = timeToMinutes(second.time);
    if (!Number.isFinite(firstStart) || !Number.isFinite(secondStart)) return false;
    const firstEnd = firstStart + (parseInt(first.duration, 10) || 0);
    const secondEnd = secondStart + (parseInt(second.duration, 10) || 0);
    return firstStart < secondEnd && firstEnd > secondStart;
}

function isRootBookingRow(row = {}) {
    return !String(row.linked_to || row.linkedTo || '').trim();
}

function sharedRoomLinkLabel(row = {}) {
    const room = String(row.room || '').trim();
    return room ? `same room: ${room}` : 'same room';
}

async function bookingVisualLinkPairExists(client, businessContext, sourceId, targetId) {
    const pair = normalizeBanquetLinkPair(sourceId, targetId);
    if (!pair) return true;
    const existing = await client.query(
        `SELECT 1
           FROM booking_banquet_links
          WHERE business_context = $1
            AND booking_a_id = $2
            AND booking_b_id = $3
            AND relation_type = ANY($4::text[])
          LIMIT 1`,
        [businessContext || DEFAULT_TIMELINE_CONTEXT, pair[0], pair[1], BOOKING_VISUAL_LINK_RELATION_TYPES]
    );
    return existing.rowCount > 0;
}

async function createSharedRoomActivityLinks(client, businessContext, bookingRow, user) {
    if (!bookingRow?.id || !isRootBookingRow(bookingRow) || !isRealRoom(bookingRow.room)) return [];
    if (!isRoomConflictBlockingRoom(bookingRow.room)) return [];
    if (!bookingRow.date || !bookingRow.time) return [];
    try {
        const result = await client.query(
            `SELECT id, date, time, duration, room, status, linked_to, label, program_code, program_name, group_name
               FROM bookings
              WHERE date = $1
                AND room = $2
                AND COALESCE(business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $3
                AND ${bookingActiveStatusSql()}
                AND id <> $4
                AND NULLIF(COALESCE(linked_to, ''), '') IS NULL
              ORDER BY time ASC, id ASC`,
            [bookingRow.date, bookingRow.room, businessContext || DEFAULT_TIMELINE_CONTEXT, bookingRow.id]
        );
        const created = [];
        for (const candidate of result.rows) {
            if (bookingTimesOverlap(bookingRow, candidate)) continue;
            if (await bookingVisualLinkPairExists(client, businessContext, bookingRow.id, candidate.id)) continue;
            const linkRow = await upsertBanquetLink(
                client,
                businessContext || DEFAULT_TIMELINE_CONTEXT,
                bookingRow.id,
                candidate.id,
                sharedRoomLinkLabel(bookingRow),
                user,
                SHARED_ROOM_LINK_RELATION_TYPE
            );
            if (!linkRow) continue;
            created.push(linkRow);
            await insertScopedHistory(client, 'booking_shared_room_link_created', user?.username, {
                booking_id: bookingRow.id,
                target_booking_id: candidate.id,
                business_context: businessContext || DEFAULT_TIMELINE_CONTEXT,
                relation_type: SHARED_ROOM_LINK_RELATION_TYPE,
                room: bookingRow.room,
                date: bookingRow.date
            }, businessContext || DEFAULT_TIMELINE_CONTEXT);
        }
        return created;
    } catch (err) {
        log.warn(`Shared-room visual links skipped for booking ${bookingRow.id}: ${err.message}`);
        return [];
    }
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
        room: Object.prototype.hasOwnProperty.call(patch, 'room') ? patch.room : row.room,
        hosts: row.hosts,
        label: row.label,
        program_code: row.program_code,
        program_name: row.program_name,
        category: row.category,
        extra_data: row.extra_data,
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

function normalizeTimelineView(value) {
    return String(value || '').trim().toLowerCase() === 'rooms' ? 'rooms' : 'animators';
}

function timelineViewFromRequest(req, fallback = 'animators') {
    const body = req?.body || {};
    return normalizeTimelineView(
        req?.query?.timelineView
        || body.timelineView
        || body.main?.timelineView
        || fallback
    );
}

function bookingTimelineIdentity(booking = {}) {
    const candidates = [
        booking.timelineIdentity,
        booking.timeline_identity,
        booking.extraData?.timelineIdentity,
        booking.extraData?.timeline_identity,
        booking.extra_data?.timelineIdentity,
        booking.extra_data?.timeline_identity
    ];
    for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
    }
    for (const raw of [booking.extraData, booking.extra_data]) {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        try {
            const parsed = JSON.parse(raw);
            const identity = parsed?.timelineIdentity || parsed?.timeline_identity;
            if (identity && typeof identity === 'object' && !Array.isArray(identity)) return identity;
        } catch {}
    }
    return {};
}

function bookingSourceLineId(booking = {}) {
    const identity = bookingTimelineIdentity(booking);
    return String(
        booking.lineId
        || booking.line_id
        || identity.lineId
        || identity.line_id
        || identity.resourceId
        || identity.resource_id
        || booking.resourceId
        || booking.resource_id
        || ''
    ).trim();
}

function bookingSourceResourceId(booking = {}) {
    const identity = bookingTimelineIdentity(booking);
    return String(
        booking.resourceId
        || booking.resource_id
        || identity.resourceId
        || identity.resource_id
        || bookingSourceLineId(booking)
        || ''
    ).trim();
}

function bookingSourceResourceType(booking = {}, businessContext = DEFAULT_TIMELINE_CONTEXT) {
    const identity = bookingTimelineIdentity(booking);
    return String(
        booking.resourceType
        || booking.resource_type
        || identity.resourceType
        || identity.resource_type
        || timelineResourceTypeForBooking(businessContext, booking)
        || ''
    ).trim() || null;
}

function bookingSourceResourceName(booking = {}) {
    const identity = bookingTimelineIdentity(booking);
    return String(
        booking.resourceName
        || booking.resource_name
        || booking.lineName
        || booking.line_name
        || identity.resourceName
        || identity.resource_name
        || identity.lineName
        || identity.line_name
        || ''
    ).trim() || null;
}

function bookingHasRoomServiceMarkerSurface(booking = {}) {
    if (!isBanquetServiceRootBooking(booking)) return false;
    const bookingPackage = bookingPackageFromPayload(booking);
    return hasNonEmptyArray(bookingPackage.serviceEvents || bookingPackage.service_events)
        || hasNonEmptyArray(bookingPackage.menuPositions || bookingPackage.menu_positions);
}

function buildBookingTimelineProjection(booking = {}, timelineView = 'animators') {
    const view = normalizeTimelineView(timelineView);
    const businessContext = booking.businessContext || booking.business_context || DEFAULT_TIMELINE_CONTEXT;
    const status = String(booking.status || 'confirmed').trim().toLowerCase();
    const cancelled = status === 'cancelled';
    const linkedChild = Boolean(String(booking.linkedTo || booking.linked_to || '').trim());
    const sourceLineId = bookingSourceLineId(booking) || null;
    const sourceResourceId = bookingSourceResourceId(booking) || null;
    const sourceResourceType = bookingSourceResourceType(booking, businessContext);
    const sourceResourceName = bookingSourceResourceName(booking);
    const room = String(booking.room || '').trim();
    const hasRoom = isRealRoom(room);
    const roomResolution = booking.roomTimelineResolution || booking.room_timeline_resolution || null;
    const roomResourceId = roomResolution?.resourceId || (hasRoom ? room : null);
    const roomResourceName = roomResolution?.resourceName || (hasRoom ? room : null);
    const banquetService = isBanquetServiceTimelineBooking(booking);
    const banquetServiceRoot = isBanquetServiceRootBooking(booking);
    const roomProjectableService = isRoomProjectableBanquetServiceRootBooking(booking);
    const visibleInAnimatorTimeline = Boolean(!cancelled && !banquetService && sourceResourceId);
    const visibleInRoomTimeline = Boolean(
        !cancelled
        && !linkedChild
        && hasRoom
        && (!banquetServiceRoot || roomProjectableService)
    );
    const currentVisible = view === 'rooms' ? visibleInRoomTimeline : visibleInAnimatorTimeline;
    const resourceId = view === 'rooms' ? roomResourceId : sourceResourceId;
    const resourceType = view === 'rooms' ? 'room' : (banquetService ? 'service' : (sourceResourceType || 'unknown'));
    const resourceName = view === 'rooms' ? roomResourceName : sourceResourceName;
    let displaySurface = 'hidden';
    let hiddenReason = null;

    if (currentVisible) {
        displaySurface = view === 'rooms' && banquetServiceRoot && bookingHasRoomServiceMarkerSurface(booking)
            ? 'service_marker'
            : 'booking_block';
    } else if (cancelled) {
        hiddenReason = 'cancelled';
    } else if (view !== 'rooms' && banquetService) {
        hiddenReason = 'banquet_service_hidden_from_animator';
    } else if (view !== 'rooms' && !sourceResourceId) {
        hiddenReason = 'missing_animator_resource';
    } else if (view === 'rooms' && linkedChild) {
        hiddenReason = 'linked_child_hidden_from_room_timeline';
    } else if (view === 'rooms' && !hasRoom) {
        hiddenReason = 'missing_room_resource';
    } else if (view === 'rooms' && banquetServiceRoot && !roomProjectableService) {
        hiddenReason = 'banquet_service_not_room_projectable';
    } else {
        hiddenReason = 'not_visible_in_timeline_view';
    }

    return {
        timelineView: view,
        view,
        resourceType,
        resourceId,
        resourceName,
        lineId: sourceLineId,
        sourceLineId,
        visibleInAnimatorTimeline,
        visibleInRoomTimeline,
        displaySurface,
        hiddenReason,
        businessContext,
        date: booking.date || null,
        legacyRoomName: view === 'rooms' ? (roomResolution?.legacyRoomName || room || null) : null,
        roomResourceStatus: view === 'rooms' ? (roomResolution?.status || (hasRoom ? 'legacy' : 'missing')) : null,
        diagnosticReason: view === 'rooms' ? (roomResolution?.diagnosticReason || null) : null,
        assignmentAllowed: view === 'rooms' ? roomResolution?.assignmentAllowed !== false : true
    };
}

function projectBookingForTimelineView(booking = {}, timelineView = 'animators') {
    const projection = buildBookingTimelineProjection(booking, timelineView);
    if (timelineView !== 'rooms') {
        const previousIdentity = bookingTimelineIdentity(booking);
        return {
            ...booking,
            timelineIdentity: {
                ...previousIdentity,
                businessContext: previousIdentity.businessContext || previousIdentity.business_context || projection.businessContext,
                resourceId: previousIdentity.resourceId || previousIdentity.resource_id || projection.resourceId,
                lineId: previousIdentity.lineId || previousIdentity.line_id || projection.lineId,
                resourceType: previousIdentity.resourceType || previousIdentity.resource_type || projection.resourceType,
                resourceName: previousIdentity.resourceName || previousIdentity.resource_name || projection.resourceName,
                lineName: previousIdentity.lineName || previousIdentity.line_name || projection.resourceName
            },
            timelineProjection: {
                ...(booking.timelineProjection || {}),
                ...projection
            }
        };
    }
    const room = String(booking.room || '').trim();
    if (!room) {
        return {
            ...booking,
            timelineProjection: {
                ...(booking.timelineProjection || {}),
                ...projection
            }
        };
    }
    const previousIdentity = booking.timelineIdentity || {};
    return {
        ...booking,
        resourceId: projection.resourceId,
        resourceType: 'room',
        timelineIdentity: {
            ...previousIdentity,
            businessContext: booking.businessContext || previousIdentity.businessContext || DEFAULT_TIMELINE_CONTEXT,
            resourceId: projection.resourceId,
            resourceType: 'room',
            resourceName: projection.resourceName,
            legacyRoomName: projection.legacyRoomName,
            lineId: booking.lineId || previousIdentity.lineId || null,
            source: projection.diagnosticReason ? 'room_timeline_resolver' : 'room_timeline_projection'
        },
        timelineProjection: {
            ...(booking.timelineProjection || {}),
            ...projection
        }
    };
}

function bookingMatchesBanquetServiceLine(value) {
    return String(value || '').trim() === BANQUET_SERVICE_LINE_ID;
}

function isBanquetServiceTimelineBooking(booking = {}) {
    const identity = booking.timelineIdentity || booking.timeline_identity || {};
    return [
        booking.lineId,
        booking.line_id,
        booking.resourceId,
        booking.resource_id,
        identity.resourceId,
        identity.resource_id,
        identity.lineId,
        identity.line_id
    ].some(bookingMatchesBanquetServiceLine);
}

function isBanquetServiceRootBooking(booking = {}) {
    return isBanquetServiceTimelineBooking(booking)
        && !String(booking.linkedTo || booking.linked_to || '').trim();
}

function getBookingExtraDataObject(booking = {}) {
    const extra = booking.extraData ?? booking.extra_data;
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) return extra;
    if (typeof extra === 'string' && extra.trim()) {
        try {
            const parsed = JSON.parse(extra);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function hasNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

const BOOKING_PAST_VALIDATION_TIME_ZONE = 'Europe/Kyiv';

function bookingKyivClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: BOOKING_PAST_VALIDATION_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(now).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});
    const hour = Number(parts.hour || 0);
    const minute = Number(parts.minute || 0);
    const second = Number(parts.second || 0);
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        seconds: (hour * 3600) + (minute * 60) + second
    };
}

function bookingPackageFromPayload(booking = {}) {
    const extra = getBookingExtraDataObject(booking);
    return booking.bookingPackage
        || booking.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
}

function normalizedBookingPastValidationTime(value) {
    const time = String(value || '').trim();
    return validateTime(time) ? time : null;
}

function bookingPackageOperationalTimeCandidates(booking = {}) {
    const bookingPackage = bookingPackageFromPayload(booking);
    const positions = bookingPackage.menuPositions || bookingPackage.menu_positions || booking.menuPositions || booking.menu_positions || [];
    const events = bookingPackage.serviceEvents || bookingPackage.service_events || booking.serviceEvents || booking.service_events || [];
    const candidates = [];

    if (Array.isArray(positions)) {
        positions.forEach(item => {
            const time = normalizedBookingPastValidationTime(item?.servingTime || item?.serving_time);
            if (time) candidates.push({ time, label: 'Час видачі' });
        });
    }
    if (Array.isArray(events)) {
        events.forEach(item => {
            const time = normalizedBookingPastValidationTime(item?.time || item?.servingTime || item?.serving_time);
            if (time) candidates.push({ time, label: 'Час події' });
        });
    }
    return candidates;
}

function shouldUseKitchenOperationalPastValidation(booking = {}) {
    const extra = getBookingExtraDataObject(booking);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const scenario = String(workspace.scenario || booking.scenario || '').trim().toLowerCase();
    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    return scenario === 'kitchen_only'
        || programCode === 'KITCHEN'
        || isBanquetServiceRootBooking(booking);
}

function bookingPastValidationTimeCandidates(booking = {}) {
    const operationalCandidates = shouldUseKitchenOperationalPastValidation(booking)
        ? bookingPackageOperationalTimeCandidates(booking)
        : [];
    if (operationalCandidates.length) return operationalCandidates;
    const fallbackTime = normalizedBookingPastValidationTime(booking.time);
    return fallbackTime ? [{ time: fallbackTime, label: 'Час бронювання' }] : [];
}

function bookingTimeCandidateIsPast(date, time, now = new Date()) {
    if (!validateDate(date) || !validateTime(time)) return false;
    const today = bookingKyivClock(now);
    if (date < today.date) return true;
    if (date > today.date) return false;
    return timeToMinutes(time) * 60 < today.seconds;
}

function bookingPastValidationError(booking = {}, now = new Date()) {
    const date = String(booking.date || '').trim();
    const pastCandidate = bookingPastValidationTimeCandidates(booking)
        .find(candidate => bookingTimeCandidateIsPast(date, candidate.time, now));
    if (!pastCandidate) return null;
    const label = pastCandidate.label || 'Час бронювання';
    return `${label} ${pastCandidate.time} вже в минулому. Оберіть майбутній час.`;
}

function isRoomProjectableBanquetServiceRootBooking(booking = {}) {
    if (!isBanquetServiceRootBooking(booking) || !isRealRoom(booking.room)) return false;
    const extra = getBookingExtraDataObject(booking);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const bookingPackage = bookingPackageFromPayload(booking);
    return String(booking.category || booking.category_id || '').trim().toLowerCase() === 'banquet'
        || String(booking.programCode || booking.program_code || '').trim().toUpperCase() === 'KITCHEN'
        || String(workspace.scenario || '').trim().toLowerCase() === 'kitchen_only'
        || hasNonEmptyArray(bookingPackage.menuPositions || bookingPackage.menu_positions)
        || hasNonEmptyArray(bookingPackage.serviceEvents || bookingPackage.service_events)
        || Boolean(String(booking.banquetMenu || booking.banquet_menu || '').trim())
        || Boolean(booking.banquetGuests || booking.banquet_guests || booking.banquetAdults || booking.banquet_adults || booking.banquetTables || booking.banquet_tables);
}

function managerDepositPayloadForBooking(booking = {}) {
    const extra = getBookingExtraDataObject(booking);
    const payload = booking.deposit
        || booking.banquetDeposit
        || booking.bookingDeposit
        || booking.depositData
        || extra.deposit
        || extra.banquetDeposit
        || extra.bookingDeposit
        || extra.depositData
        || null;
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

function bookingAcceptsManagerDeposit(booking = {}) {
    if (isRoomProjectableBanquetServiceRootBooking(booking)) return true;
    const extra = getBookingExtraDataObject(booking);
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const bookingPackage = bookingPackageFromPayload(booking);
    const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    return category === 'banquet'
        || category === 'kitchen'
        || programCode === 'KITCHEN'
        || String(workspace.scenario || '').trim().toLowerCase() === 'kitchen_only'
        || hasNonEmptyArray(bookingPackage.menuPositions || bookingPackage.menu_positions)
        || Boolean(String(booking.banquetMenu || booking.banquet_menu || '').trim())
        || Boolean(booking.banquetGuests || booking.banquet_guests || booking.banquetAdults || booking.banquet_adults || booking.banquetTables || booking.banquet_tables);
}

async function syncManagerDepositForBooking(db, booking = {}, row = {}, businessContext, user) {
    const payload = managerDepositPayloadForBooking(booking);
    if (!payload || !bookingAcceptsManagerDeposit({ ...booking, ...row })) return null;
    return upsertManagerBookingDeposit({
        bookingId: row.id || booking.id,
        businessContext,
        deposit: payload,
        source: 'routes/bookings.syncManagerDepositForBooking',
        actor: user,
        managerReportedBy: user?.id || null
    }, { db });
}

function projectBookingsForTimelineView(bookings = [], timelineView = 'animators') {
    if (timelineView !== 'rooms') {
        return bookings.map(booking => projectBookingForTimelineView(booking, timelineView));
    }
    return bookings
        .filter(booking => !isBanquetServiceRootBooking(booking) || isRoomProjectableBanquetServiceRootBooking(booking))
        .filter(booking => !String(booking.linkedTo || '').trim() && isRealRoom(booking.room))
        .map(booking => projectBookingForTimelineView(booking, timelineView));
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
           AND ${bookingActiveStatusSql()}
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
        if (isRealRoom(other.room) && isRealRoom(current.room)
            && isRoomConflictBlockingRoom(other.room) && isRoomConflictBlockingRoom(current.room)
            && String(other.room) === String(current.room)) {
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
    if (!isLineConflictBlockingLine(candidate.line_id)) return null;
    const result = await client.query(
        `SELECT id, time, duration, label, program_code
         FROM bookings
         WHERE date = $1 AND line_id = $2 AND ${bookingContextSql('', '$3')} AND ${bookingActiveStatusSql()}
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
    if (!isRoomConflictBlockingRoom(candidate.room)) return null;
    return checkRoomConflict(
        client,
        candidate.date,
        candidate.room,
        candidate.time,
        candidate.duration || 0,
        bookingRoomConflictPolicyOptions(candidate, { excludeIds }),
        candidate.business_context || DEFAULT_TIMELINE_CONTEXT
    );
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
              AND ${bookingActiveStatusSql('b')} AND b.linked_to IS NULL
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
                ${req.query.includeCancelled === 'true' ? '' : `AND ${bookingActiveStatusSql('b')}`}
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
                AND ${bookingActiveStatusSql('b')}
                ${dateFilter}
              RETURNING b.*`,
            params
        );
        const cancelled = result.rows.map(mapBookingRow);
        await insertScopedHistory(client, 'education_series_cancel', req.user?.username, {
                seriesId,
                businessContext,
                scope,
                fromDate,
                count: cancelled.length
            },
            businessContext
        );
        await client.query('COMMIT');

        cancelled.forEach(booking => {
            broadcastBookingEvent('booking:deleted', booking, req.user?.id?.toString(), { businessContext });
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

function jsonObject(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function attachRoomTimelineResourceResolution(queryable, bookings = [], businessContext = DEFAULT_TIMELINE_CONTEXT) {
    const resources = await listTimelineResources(queryable, {
        context: businessContext,
        type: 'room',
        includeInactive: true
    });
    return (Array.isArray(bookings) ? bookings : []).map(booking => ({
        ...booking,
        roomTimelineResolution: resolveRoomTimelineResourceIdentity(resources, booking, {
            legacyRoomNames: ALL_ROOMS,
            quarantineResourceId: 'room-quarantine',
            quarantineName: 'Невідома / неактивна кімната',
            takeawayName: 'На виніс'
        })
    }));
}

async function attachAtomicBanquetConflictMetadata(client, candidates, businessContext) {
    const byId = new Map((candidates || []).filter(candidate => candidate?.id).map(candidate => [String(candidate.id), candidate]));
    if (!byId.size) return candidates;
    const result = await client.query(
        `SELECT booking_id, group_id, role
           FROM banquet_group_bookings
          WHERE booking_id = ANY($1::text[])
            AND COALESCE(business_context, 'event_genix') = $2`,
        [Array.from(byId.keys()), businessContext || DEFAULT_TIMELINE_CONTEXT]
    );
    for (const row of result.rows || []) {
        const candidate = byId.get(String(row.booking_id));
        if (!candidate) continue;
        candidate.banquet_group_id = candidate.banquet_group_id || row.group_id;
        candidate.banquet_group_role = candidate.banquet_group_role || row.role;
    }
    return candidates;
}

function banquetSummaryDepositProjection(row = null, context = {}) {
    if (!row) {
        return {
            state: 'missing',
            status: 'missing',
            deposit: null,
            businessContext: context.businessContext || DEFAULT_TIMELINE_CONTEXT,
            bookingId: context.bookingId || null,
            banquetGroupId: context.groupId || null,
            display: {
                amount: null,
                paymentMethod: null,
                isVerified: false,
                needsBookingLink: false
            }
        };
    }
    const sourcePayload = jsonObject(row.source_payload);
    const meta = jsonObject(row.meta);
    return {
        state: ['accountant_verified', 'corrected'].includes(row.status) ? 'verified' : (row.status === 'cancelled' ? 'cancelled' : 'pending'),
        status: row.status || 'manager_reported',
        deposit: {
            id: row.id || null,
            businessContext: row.business_context || context.businessContext || DEFAULT_TIMELINE_CONTEXT,
            banquetGroupId: row.banquet_group_id || null,
            primaryBookingId: row.primary_booking_id || null,
            leadId: row.lead_id || null,
            customerId: row.customer_id || null,
            accountantTaskId: row.accountant_task_id || null,
            clientNameSnapshot: row.client_name_snapshot || null,
            eventDate: row.event_date || null,
            banquetNumberSnapshot: row.banquet_number_snapshot || null,
            amount: row.amount ?? null,
            expectedAmount: row.expected_amount ?? null,
            paidAmount: row.paid_amount ?? null,
            paymentMethod: row.payment_method || null,
            status: row.status || 'manager_reported',
            managerStatus: row.manager_status || null,
            accountingStatus: row.accounting_status || null,
            dueDate: row.due_date || null,
            sourceKind: row.source_kind || null,
            sourcePayload,
            verifiedAt: row.verified_at || null,
            verifiedBy: row.verified_by || null,
            correctedAt: row.corrected_at || null,
            correctedBy: row.corrected_by || null,
            meta
        },
        businessContext: row.business_context || context.businessContext || DEFAULT_TIMELINE_CONTEXT,
        bookingId: row.primary_booking_id || context.bookingId || null,
        banquetGroupId: row.banquet_group_id || context.groupId || null,
        display: {
            amount: row.paid_amount ?? row.expected_amount ?? row.amount ?? null,
            paymentMethod: row.payment_method || null,
            isVerified: ['accountant_verified', 'corrected'].includes(row.status) || row.accounting_status === 'Підтверджено',
            needsBookingLink: row.status === 'needs_booking_link'
        }
    };
}

async function loadBanquetSummaryDepositProjection({ businessContext, groupId = null, bookingId = null } = {}) {
    const context = {
        businessContext: businessContext || DEFAULT_TIMELINE_CONTEXT,
        groupId: groupId || null,
        bookingId: bookingId || null
    };
    if (!groupId && !bookingId) return banquetSummaryDepositProjection(null, context);
    if (groupId && bookingId) {
        const result = await pool.query(
            `SELECT *
               FROM banquet_deposits
              WHERE business_context = $1
                AND (banquet_group_id = $2 OR primary_booking_id = $3)
              ORDER BY
                CASE WHEN banquet_group_id = $2 THEN 0 ELSE 1 END,
                CASE status
                    WHEN 'accountant_verified' THEN 0
                    WHEN 'corrected' THEN 1
                    WHEN 'manager_reported' THEN 2
                    WHEN 'needs_booking_link' THEN 3
                    ELSE 9
                END,
                updated_at DESC NULLS LAST,
                id DESC
              LIMIT 1`,
            [context.businessContext, groupId, bookingId]
        );
        return banquetSummaryDepositProjection(result.rows[0] || null, context);
    }
    const identityColumn = groupId ? 'banquet_group_id' : 'primary_booking_id';
    const identityValue = groupId || bookingId;
    const result = await pool.query(
        `SELECT *
           FROM banquet_deposits
          WHERE business_context = $1
            AND ${identityColumn} = $2
          ORDER BY
            CASE status
                WHEN 'accountant_verified' THEN 0
                WHEN 'corrected' THEN 1
                WHEN 'manager_reported' THEN 2
                WHEN 'needs_booking_link' THEN 3
                ELSE 9
            END,
            updated_at DESC NULLS LAST,
            id DESC
          LIMIT 1`,
        [context.businessContext, identityValue]
    );
    return banquetSummaryDepositProjection(result.rows[0] || null, context);
}

async function resolveBanquetSummaryForRequest(req, res) {
    const { id } = req.params;
    if (!validateId(id)) {
        res.status(400).json({ success: false, error: 'Invalid booking ID' });
        return null;
    }
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return null;
    const mode = normalizeBanquetSummaryMode(req.query?.mode);

    const mainResult = await pool.query(
        `SELECT b.*
           FROM bookings b
          WHERE b.id = $1
            AND ${bookingContextSql('b', '$2')}
          LIMIT 1`,
        [id, businessContext]
    );
    const mainBooking = mainResult.rows[0] || null;
    if (!mainBooking) {
        res.status(404).json({ success: false, error: 'Booking not found' });
        return null;
    }
    if (!canViewBooking(req.user, mainBooking)) {
        sendBookingDenied(req, res, mainBooking);
        return null;
    }

    let resolvedGroup = null;
    const groupId = String(req.query?.groupId || req.query?.group_id || '').trim();
    const snapshot = groupId
        ? await (async () => {
            if (!validateId(groupId)) return { invalid: true };
            return loadBanquetGroupById({ groupId, businessContext });
        })()
        : await loadBanquetGroupByBookingId({ bookingId: id, businessContext });
    if (snapshot?.invalid) {
        res.status(400).json({ success: false, error: 'Invalid banquet group ID' });
        return null;
    }
    if (groupId && !snapshot?.groupId) {
        res.status(404).json({ success: false, error: 'Banquet group not found' });
        return null;
    }

    if (snapshot?.members?.length && snapshot.source !== 'single_booking') {
        const visibleMembers = (snapshot.members || []).filter(member => canViewBooking(req.user, member.booking));
        const requestBookingInGroup = visibleMembers.some(member => String(member.bookingId) === String(id))
            || visibleMembers.some(member => (member.technicalChildren || []).some(child => String(child.id) === String(id)));
        if (!requestBookingInGroup) {
            sendBookingDenied(req, res, mainBooking);
            return null;
        }
        if (visibleMembers.length) {
            const visibleBookingIds = new Set(visibleMembers.map(member => String(member.bookingId)));
            resolvedGroup = {
                ...snapshot,
                memberships: (snapshot.memberships || []).filter(item => visibleBookingIds.has(String(item.bookingId))),
                members: visibleMembers,
                bookings: {
                    ...snapshot.bookings,
                    primary: (visibleMembers.find(member => member.isPrimary) || null)?.booking || snapshot.bookings?.primary || mainBooking,
                    kitchen: visibleMembers
                        .filter(member => member.role === 'kitchen' || member.isKitchenCandidate)
                        .map(member => member.booking),
                    activities: visibleMembers
                        .filter(member => member.role === 'activity')
                        .map(member => member.booking),
                    services: visibleMembers
                        .filter(member => member.role === 'service')
                        .map(member => member.booking),
                    manual: visibleMembers
                        .filter(member => member.role === 'manual')
                        .map(member => member.booking)
                }
            };
        }
    }

    const summaryPrimaryBooking = resolvedGroup?.bookings?.primary || mainBooking;

    let customer = null;
    const customerId = summaryPrimaryBooking.customer_id || summaryPrimaryBooking.customerId || null;
    if (customerId) {
        const customerResult = await pool.query(
            `SELECT id, business_context, name, phone, instagram, child_name, child_birthday, source, notes,
                    created_at, updated_at
               FROM customers
              WHERE id = $1
                AND COALESCE(business_context, '${DEFAULT_TIMELINE_CONTEXT}') = $2
              LIMIT 1`,
            [customerId, businessContext]
        );
        customer = customerResult.rows[0] || null;
        if (customer) {
            customer.children = buildCustomerChildrenProjection(
                customer,
                await listCustomerChildren(customer.id, businessContext, { db: pool })
            );
        }
    }

    let linkedBookings = [];
    if (!resolvedGroup && !groupId) {
        const linksResult = await pool.query(
            `SELECT id, booking_a_id, booking_b_id, relation_type, label, created_at, created_by
               FROM booking_banquet_links
              WHERE business_context = $1
                AND relation_type = $2
                AND ($3 = booking_a_id OR $3 = booking_b_id)
              ORDER BY created_at ASC, id ASC`,
            [businessContext, BANQUET_LINK_RELATION_TYPE, id]
        );
        const linkedIds = linksResult.rows
            .map(link => String(link.booking_a_id) === String(id) ? link.booking_b_id : link.booking_a_id)
            .filter(Boolean);
        const linkByTarget = new Map(linksResult.rows.map(link => {
            const targetId = String(link.booking_a_id) === String(id) ? link.booking_b_id : link.booking_a_id;
            return [String(targetId), link];
        }));
        if (linkedIds.length) {
            const linkedResult = await pool.query(
                `SELECT b.*
                   FROM bookings b
                  WHERE b.id = ANY($1::text[])
                    AND ${bookingContextSql('b', '$2')}
                    AND ${bookingActiveStatusSql('b')}
                  ORDER BY b.date ASC, b.time ASC, b.id ASC`,
                [linkedIds, businessContext]
            );
            linkedBookings = linkedResult.rows
                .filter(row => canViewBooking(req.user, row))
                .map(row => ({
                    ...row,
                    _banquetLink: linkByTarget.get(String(row.id)) || null
                }));
        }
    }

    const banquetTermsDefaults = await loadBanquetTermsDefaults(pool);
    const summaryGroupId = resolvedGroup?.groupId || resolvedGroup?.group?.id || null;
    const canonicalDepositProjection = await loadBanquetSummaryDepositProjection({
        businessContext,
        groupId: summaryGroupId,
        bookingId: summaryPrimaryBooking.id || id
    });
    return buildBanquetSummary({
        mainBooking: summaryPrimaryBooking,
        customer,
        linkedBookings,
        businessContext,
        generatedBy: req.user,
        resolvedGroup,
        banquetTermsDefaults,
        mode,
        canonicalDepositProjection
    });
}

router.get('/:id/banquet-summary', async (req, res) => {
    try {
        const summary = await resolveBanquetSummaryForRequest(req, res);
        if (!summary || res.headersSent) return;
        res.json(summary);
    } catch (err) {
        log.error('GET /bookings/:id/banquet-summary error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/:id/banquet-summary.pdf', async (req, res) => {
    try {
        const summary = await resolveBanquetSummaryForRequest(req, res);
        if (!summary || res.headersSent) return;

        const mode = normalizeBanquetSummaryMode(req.query?.mode);
        const filename = banquetSummaryPdfFilename(summary, mode);
        const buffer = await buildBanquetSummaryPdfBuffer(summary, { mode });

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
            'X-Banquet-Summary-Mode': mode
        });
        res.send(buffer);
    } catch (err) {
        if (err.code === 'banquet_summary_pdf_validation_failed') {
            log.warn('GET /bookings/:id/banquet-summary.pdf blocked by validation', {
                mode: err.mode,
                details: err.details
            });
        } else {
            log.error('GET /bookings/:id/banquet-summary.pdf error', err);
        }
        const status = Number(err.statusCode) || 500;
        res.status(status).json({
            success: false,
            error: err.code === 'pdf_font_missing'
                ? 'PDF font with Cyrillic support is not available'
                : (err.code === 'banquet_summary_pdf_validation_failed'
                    ? (err.publicMessage || err.message || 'Неможливо сформувати PDF')
                    : 'Internal server error'),
            code: err.code || undefined,
            mode: err.mode || undefined,
            details: Array.isArray(err.details) ? err.details : undefined
        });
    }
});

router.get('/detail/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!validateId(id)) return res.status(400).json({ success: false, error: 'Invalid booking ID' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;

        const result = await pool.query(
            `SELECT b.*
               FROM bookings b
              WHERE b.id = $1
                AND ${bookingContextSql('b', '$2')}
                AND ${bookingActiveStatusSql('b')}
              LIMIT 1`,
            [id, businessContext]
        );
        const row = result.rows[0] || null;
        if (!row) return res.status(404).json({ success: false, error: 'Booking not found' });
        if (!canViewBooking(req.user, row)) return sendBookingDenied(req, res, row);

        const [booking] = await attachBanquetLinksToBookings([mapBookingRow(row)], businessContext);
        res.json({ success: true, booking });
    } catch (err) {
        log.error('GET /bookings/detail/:id error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Get bookings for a date
router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date format' });
        const businessContext = timelineContextFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        const timelineView = normalizeTimelineView(req.query.timelineView);
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
                    confirmed_at, confirmed_by, confirmation_note, confirmation_source,
                    banquet_guests, banquet_adults, banquet_tables, banquet_menu
             FROM bookings b
             WHERE b.date = $1 AND ${bookingContextSql('b', '$2')} AND ${bookingActiveStatusSql('b')}
               ${visibility}
             ORDER BY time`,
            params
        );
        const sourceBookings = result.rows.map(mapBookingRow);
        const resolvedBookings = timelineView === 'rooms'
            ? await attachRoomTimelineResourceResolution(pool, sourceBookings, businessContext)
            : sourceBookings;
        const mapped = projectBookingsForTimelineView(resolvedBookings, timelineView);
        res.set('X-Timeline-View', timelineView);
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
        const insertedLink = await upsertBanquetLink(client, businessContext, pair[0], pair[1], label, req.user);
        await insertScopedHistory(client, 'booking_banquet_link_created', req.user?.username, {
                booking_id: id,
                target_booking_id: targetId,
                business_context: businessContext,
                relation_type: BANQUET_LINK_RELATION_TYPE
            },
            businessContext
        );
        await client.query('COMMIT');
        const link = mapBanquetLinkRow(insertedLink, id);
        broadcastBookingEvent('booking:banquet-link-updated', source, req.user?.id?.toString(), { businessContext });
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
    const relationType = normalizeBookingLinkRelationType(req.query?.relationType || req.query?.relation_type, BANQUET_LINK_RELATION_TYPE);
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
            [businessContext, pair[0], pair[1], relationType]
        );
        await insertScopedHistory(client, 'booking_banquet_link_deleted', req.user?.username, {
                booking_id: id,
                target_booking_id: targetId,
                business_context: businessContext,
                relation_type: relationType,
                deleted: deleted.rowCount > 0
            },
            businessContext
        );
        await client.query('COMMIT');
        const link = deleted.rows[0] ? mapBanquetLinkRow(deleted.rows[0], id) : null;
        broadcastBookingEvent('booking:banquet-link-updated', source, req.user?.id?.toString(), { businessContext });
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
    const timelineView = timelineViewFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'create')) return;
    b.businessContext = businessContext;
    if (rejectExplicitBanquetAddToExistingGenericCreate(res, b)) return;
    const banquetContract = validateBookingBanquetCreationContract(res, b.banquetContext);
    if (banquetContract.rejected) return;
    const banquetContext = banquetContract.context;
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
    applyBookingPackage(b);
    if (!b.linkedTo) {
        const pastValidationError = bookingPastValidationError(b);
        if (pastValidationError) return res.status(400).json({ success: false, error: pastValidationError });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pinataFields = applyPinataNormalization(b);
        if (pinataFields.error) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: pinataFields.error });
        }
        await applyEffectiveBookingPrice(client, b, { businessContext });
        await applyBookingPackageEntryCharge(client, b, { businessContext });
        await snapshotBanquetTermsForBooking(client, b);
        normalizeBookingSecondAnimatorFields(b);
        if (applyBookingStatusForCreate(b) === 'invalid') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Invalid booking status' });
        }

        const ensuredPrimaryLine = await ensureBookingTimelineLine(client, b, businessContext, {
            name: b.lineName || b.animatorName || null
        });
        if (!ensuredPrimaryLine) {
            await client.query('ROLLBACK');
            return res.status(400).json(bookingLineUnavailablePayload());
        }

        let ensuredSecondAnimatorLine = null;
        if (!b.linkedTo && bookingRequiresSecondAnimatorLink(b)) {
            ensuredSecondAnimatorLine = await ensureSecondAnimatorLineForBooking(client, b, businessContext);
            if (!ensuredSecondAnimatorLine) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Другого ведучого не знайдено серед активних аніматорів' });
            }
            b.secondAnimator = ensuredSecondAnimatorLine.name;
        }

        if (!b.linkedTo) {
            const lockTargets = [b];
            if (ensuredSecondAnimatorLine && String(ensuredSecondAnimatorLine.lineId) !== String(b.lineId)) {
                lockTargets.push({ ...b, lineId: ensuredSecondAnimatorLine.lineId });
            }
            await lockBookingConflictResources(client, lockTargets, businessContext);

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

            const roomConflict = await checkRoomConflict(
                client,
                b.date,
                b.room,
                b.time,
                b.duration || 0,
                bookingRoomConflictPolicyOptions(b),
                businessContext
            );
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
            `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method, certificate_id, banquet_guests, banquet_adults, banquet_tables, banquet_menu)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37)
             RETURNING *`,
            [b.id, businessContext, b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName, b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller, b.pinataMode, b.pinataNumber, b.pinataFillerNumber, b.clientPinataServicePrice, b.clientPinataServiceNote, b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, b.status, b.kidsCount || null, b.groupName || null, b.extraData ? JSON.stringify(b.extraData) : null, sideEffectsAllowedForContext(businessContext) ? (b.skipNotification || false) : true, customerId, b.paymentMethod || null, certificateId, b.banquetGuests || null, b.banquetAdults || null, b.banquetTables || null, b.banquetMenu || null]
        );
        const managerDepositResult = await syncManagerDepositForBooking(client, b, insertResult.rows[0], businessContext, req.user);

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
                 b.createdBy, b.id, b.status, b.kidsCount || null, b.groupName || null,
                 null]
            );
            if (linkedInsert.rows[0]) linkedInsertedRows.push(linkedInsert.rows[0]);
        }

        const sharedRoomLinkRows = await createSharedRoomActivityLinks(client, businessContext, insertResult.rows[0], req.user);

        const createdBanquetGroup = banquetContext?.mode === 'new'
            ? await createBanquetGroupInTransaction({
                db: client,
                primaryBooking: insertResult.rows[0],
                businessContext,
                user: req.user,
                groupName: b.groupName,
                source: 'booking_create',
                meta: { creationContract: 'banquet_context_v1' },
                banquetContext
            })
            : null;

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

        await insertScopedHistory(client, 'create', b.createdBy || req.user?.username, b, businessContext);

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

        if (sideEffectsAllowedForContext(businessContext) && !b.linkedTo) {
            await queueBookingEventInTransaction(client, 'booking.created', {
                booking_id: b.id, business_context: businessContext, date: b.date, time: b.time, room: b.room,
                program_code: b.programCode, program_name: b.programName,
                status: b.status, price: b.price || 0,
                kids_count: b.kidsCount, created_by: b.createdBy
            }, b.id, `booking_created_${b.id}`);
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
        if (!createdBanquetGroup) {
            await reconcileBookingBanquetGroupsSafely(
                [booking.id || b.id, ...linkedBookings.map(item => item.id)],
                businessContext,
                req.user
            );
        }
        let allCreatedBookings = [booking, ...linkedBookings];
        await Promise.all(allCreatedBookings.map(async createdBooking => {
            createdBooking.timelineProjection = await bookingDayProjectionStatus(client, {
                id: createdBooking.id || b.id,
                date: createdBooking.linkedTo ? (createdBooking.date || b.date) : (b.date || createdBooking.date),
                businessContext,
                user: req.user
            });
            if (createdBooking.timelineProjection.visible === false) {
                log.warn(`Created booking ${createdBooking.id || b.id} is not visible in same day timeline projection`, {
                    date: createdBooking.timelineProjection.date,
                    businessContext: createdBooking.timelineProjection.businessContext,
                    userId: req.user?.id || null
                });
            }
        }));

        if (timelineView === 'rooms') {
            allCreatedBookings = await attachRoomTimelineResourceResolution(client, allCreatedBookings, businessContext);
        }
        let allBookings = projectCreatedBookingsForTimelineResponse(allCreatedBookings, timelineView);
        try {
            allBookings = await attachBanquetLinksToBookings(allBookings, businessContext);
        } catch (linkErr) {
            log.warn(`Created booking visual link enrichment failed: ${linkErr.message}`);
        }
        const responseBooking = allBookings.find(item => String(item.id) === String(booking.id)) || booking;
        if (managerDepositResult?.projection) responseBooking.banquetDeposit = managerDepositResult.projection;
        const linkedIdSet = new Set(linkedInsertedRows.map(row => String(row.id)));
        const responseLinkedBookings = allBookings.filter(item => linkedIdSet.has(String(item.id)));

        // WebSocket: notify other clients
        broadcastBookingEvent('booking:created', responseBooking, req.user?.id?.toString(), { businessContext });
        _alertPush();

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
                        `SELECT id, name FROM staff
                         WHERE (display_name ILIKE $1 OR name ILIKE $1)
                           AND ${scheduleableStaffWhere('staff', { dateExpression: '$2' })}
                         LIMIT 1`,
                        [animName, b.date]
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
        if (parkSideEffectsAllowedForContext(businessContext) && (b.programName || '').toLowerCase().match(/день народж|birthday|дн\b/i) && b.date && b.time) {
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

        res.set('X-Timeline-View', timelineView);
        res.json({
            success: true,
            booking: responseBooking,
            linkedBookings: responseLinkedBookings,
            sharedRoomLinks: sharedRoomLinkRows.map(row => mapBanquetLinkRow(row, b.id)),
            banquetGroup: createdBanquetGroup ? {
                group: createdBanquetGroup.group,
                membership: createdBanquetGroup.membership,
                members: createdBanquetGroup.members
            } : null,
            allBookings,
            projection: {
                main: responseBooking.timelineProjection || null,
                bookings: allBookings.map(item => bookingTimelineProjectionContract(item))
            },
            serverVerified: true
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (create)', rbErr));
        log.error('Error creating booking', err);
        res.status(err.statusCode || err.status || 500).json({
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
        if (applyBookingStatusForCreate(candidate) === 'invalid') {
            return res.status(400).json({ success: false, error: 'Invalid booking status' });
        }
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
        await lockBookingConflictResources(client, candidates, businessContext);

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
            await applyEffectiveBookingPrice(client, candidate, { businessContext });
            normalizeBookingSecondAnimatorFields(candidate);
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

            const roomConflict = await checkRoomConflict(
                client,
                candidate.date,
                candidate.room,
                candidate.time,
                candidate.duration || 0,
                bookingRoomConflictPolicyOptions(candidate),
                businessContext
            );
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
                `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method, banquet_guests, banquet_adults, banquet_tables, banquet_menu)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
                 RETURNING *`,
                [candidate.id, businessContext, candidate.date, candidate.time, candidate.lineId, candidate.programId, candidate.programCode, candidate.label, candidate.programName, candidate.category, candidate.duration, candidate.price, candidate.hosts, candidate.secondAnimator, candidate.pinataFiller, candidate.pinataMode, candidate.pinataNumber, candidate.pinataFillerNumber, candidate.clientPinataServicePrice, candidate.clientPinataServiceNote, candidate.costume || null, candidate.room, candidate.notes, candidate.createdBy || req.user?.username, null, candidate.status, candidate.kidsCount || null, candidate.groupName || null, candidate.extraData ? JSON.stringify(candidate.extraData) : null, sideEffectsAllowedForContext(businessContext) ? Boolean(candidate.skipNotification) : true, customerId, candidate.paymentMethod || null, candidate.banquetGuests || null, candidate.banquetAdults || null, candidate.banquetTables || null, candidate.banquetMenu || null]
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

        await insertScopedHistory(client, 'education_series_create', main.createdBy || req.user?.username, {
                seriesId,
                rootBookingId,
                count: insertedRows.length,
                businessContext,
                date: main.date,
                time: main.time,
                title: lesson.title,
                teacherId: lesson.teacherId || null,
                teacherName: lesson.teacherName || null
            },
            businessContext
        );

        await client.query('COMMIT');

        const bookings = insertedRows.map(mapBookingRow);
        bookings.forEach(booking => {
            broadcastBookingEvent('booking:created', booking, req.user?.id?.toString(), { businessContext });
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
                status: bookings[0]?.status || 'confirmed',
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
        const banquetActivities = Array.isArray(req.body?.banquetActivities) ? req.body.banquetActivities : [];
        const banquetContract = validateBookingBanquetCreationContract(res, req.body?.banquetContext);
        if (banquetContract.rejected) return;
        const banquetContext = banquetContract.context;
        const businessContext = timelineContextFromRequest(req);
        const timelineView = timelineViewFromRequest(req);
        if (!requireTimelineContext(req, res, businessContext)) return;
        if (!requireTimelineAction(req, res, businessContext, 'create')) return;
        if (!main || !main.date || !main.time || !main.lineId) {
            return res.status(400).json({ error: 'Missing required fields: date, time, lineId' });
        }
        if (hasAnyBanquetGroupPayload(main, linked, banquetActivities)) {
            return res.status(409).json({
                success: false,
                code: 'BANQUET_GROUP_ACTIVITY_REQUIRES_ATOMIC_ENDPOINT',
                error: 'Banquet group activity bookings must be created through /api/banquets/:groupId/activity-booking'
            });
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
        const mainPastValidationError = bookingPastValidationError(main);
        if (mainPastValidationError) return res.status(400).json({ success: false, error: mainPastValidationError });
        normalizeBookingSecondAnimatorFields(main);
        if (applyBookingStatusForCreate(main) === 'invalid') {
            return res.status(400).json({ success: false, error: 'Invalid booking status' });
        }
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
                if (applyBookingStatusForCreate(lb, main.status) === 'invalid') {
                    return res.status(400).json({ success: false, error: 'Invalid linked booking status' });
                }
            }
        }
        for (const activity of banquetActivities) {
            if (!activity.date) activity.date = main.date;
            if (!activity.time) activity.time = main.time;
            if (!activity.lineId) activity.lineId = main.lineId;
            if (!String(activity.room || '').trim()) activity.room = main.room;
            activity.businessContext = businessContext;
            if (!validateDate(activity.date)) return res.status(400).json({ success: false, error: 'Invalid activity date format' });
            if (!validateTime(activity.time)) return res.status(400).json({ success: false, error: 'Invalid activity time format' });
            const duration = parseInt(activity.duration, 10) || 0;
            if (duration <= 0 || duration > 1440) {
                return res.status(400).json({ success: false, error: 'Activity duration must be between 1 and 1440 minutes' });
            }
            await hydrateBookingRoomFromTimelineResource(pool, activity, businessContext);
            const activityRoomError = requireBookingRoom(activity);
            if (activityRoomError) return res.status(400).json({ error: activityRoomError });
            const activityCapacityError = await validateBookingTimelineResourceCapacity(pool, activity, businessContext);
            if (activityCapacityError) return res.status(409).json({ success: false, error: activityCapacityError.error, resource: activityCapacityError.resource });
            const activityPinataFields = applyPinataNormalization(activity);
            if (activityPinataFields.error) return res.status(400).json({ success: false, error: activityPinataFields.error });
            applyBookingPackage(activity);
            const activityPastValidationError = bookingPastValidationError(activity);
            if (activityPastValidationError) return res.status(400).json({ success: false, error: activityPastValidationError });
            normalizeBookingSecondAnimatorFields(activity);
            if (applyBookingStatusForCreate(activity, main.status) === 'invalid') {
                return res.status(400).json({ success: false, error: 'Invalid activity booking status' });
            }
            if (activity.price != null) {
                activity.price = parseFloat(activity.price);
                if (!Number.isFinite(activity.price) || activity.price < 0) {
                    return res.status(400).json({ success: false, error: 'Activity price must be non-negative' });
                }
            }
        }

        await client.query('BEGIN');
        const activitySecondAnimatorLines = new Map();

        await applyEffectiveBookingPrice(client, main, { businessContext });
        await applyBookingPackageEntryCharge(client, main, { businessContext });
        for (const activity of banquetActivities) {
            await applyEffectiveBookingPrice(client, activity, { businessContext });
            await applyBookingPackageEntryCharge(client, activity, { businessContext });
        }
        refreshMultiActivityPriceTotals([main, ...banquetActivities]);
        await snapshotBanquetTermsForBooking(client, main);
        for (const activity of banquetActivities) {
            await snapshotBanquetTermsForBooking(client, activity);
        }

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
            attachLinkedBookingTimelineIdentity(lb, businessContext, ensuredLinkedLine);
        }

        if (bookingRequiresSecondAnimatorLink(main)) {
            const hasSecondLinked = linked.some(lb => lb.secondAnimator === main.secondAnimator
                || (
                    lb.secondAnimator
                    && lb.programId === main.programId
                    && String(lb.date || main.date) === String(main.date)
                    && String(lb.time || main.time) === String(main.time)
                    && Number(lb.price || 0) === 0
                ));
            if (!hasSecondLinked) {
                const ensuredSecondLine = await ensureSecondAnimatorLineForBooking(client, main, businessContext);
                if (!ensuredSecondLine) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Другого ведучого не знайдено серед активних аніматорів' });
                }
                linked.push({
                    date: main.date,
                    time: main.time,
                    lineId: ensuredSecondLine.lineId,
                    lineName: ensuredSecondLine.name,
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
                    status: main.status,
                    kidsCount: main.kidsCount || null,
                    groupName: main.groupName || null,
                    extraData: {}
                });
            }
        }

        for (const activity of banquetActivities) {
            const ensuredActivityLine = await ensureBookingTimelineLine(client, activity, businessContext, {
                name: activity.lineName || activity.animatorName || null
            });
            if (!ensuredActivityLine) {
                await client.query('ROLLBACK');
                return res.status(400).json(bookingLineUnavailablePayload());
            }
            attachLinkedBookingTimelineIdentity(activity, businessContext, {
                ...ensuredActivityLine,
                source: 'multi_activity_line'
            });
            if (bookingRequiresSecondAnimatorLink(activity)) {
                const ensuredSecondLine = await ensureSecondAnimatorLineForBooking(client, activity, businessContext);
                if (!ensuredSecondLine) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Другого ведучого для активності не знайдено серед активних аніматорів' });
                }
                activity.secondAnimator = ensuredSecondLine.name || activity.secondAnimator;
                activity.secondAnimatorLineId = ensuredSecondLine.lineId;
                activity.secondAnimatorLineName = ensuredSecondLine.name;
                const activityExtra = ensureBookingExtraDataObject(activity);
                activityExtra.bookingWorkspace = {
                    ...(activityExtra.bookingWorkspace || {}),
                    secondAnimator: activity.secondAnimator,
                    secondAnimatorLineId: ensuredSecondLine.lineId,
                    secondAnimatorLineName: ensuredSecondLine.name
                };
                activitySecondAnimatorLines.set(activity, ensuredSecondLine);
            }
        }

        const lockTargets = [main, ...linked, ...banquetActivities];
        for (const [activity, ensuredSecondLine] of activitySecondAnimatorLines.entries()) {
            lockTargets.push({
                ...activity,
                lineId: ensuredSecondLine.lineId,
                lineName: ensuredSecondLine.name,
                price: 0
            });
        }
        await lockBookingConflictResources(client, lockTargets, businessContext);

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

        const roomConflict = await checkRoomConflict(
            client,
            main.date,
            main.room,
            main.time,
            main.duration || 0,
            bookingRoomConflictPolicyOptions(main),
            businessContext
        );
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
            `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method, banquet_guests, banquet_adults, banquet_tables, banquet_menu)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
             RETURNING *`,
            [main.id, businessContext, main.date, main.time, main.lineId, main.programId, main.programCode, main.label, main.programName, main.category, main.duration, main.price, main.hosts, main.secondAnimator, main.pinataFiller, main.pinataMode, main.pinataNumber, main.pinataFillerNumber, main.clientPinataServicePrice, main.clientPinataServiceNote, main.costume || null, main.room, main.notes, main.createdBy, null, main.status, main.kidsCount || null, main.groupName || null, main.extraData ? JSON.stringify(main.extraData) : null, main.skipNotification || false, customerId, main.paymentMethod || null, main.banquetGuests || null, main.banquetAdults || null, main.banquetTables || null, main.banquetMenu || null]
        );
        const managerDepositResult = await syncManagerDepositForBooking(client, main, mainInsert.rows[0], businessContext, req.user);

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
                attachLinkedBookingTimelineIdentity(lb, businessContext, {
                    lineId: lb.lineId,
                    name: lb.lineName || lb.secondAnimator || null,
                    source: 'linked_booking_line'
                });
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
                    [lbId, businessContext, lb.date, lb.time, lb.lineId, lb.programId, lb.programCode, lb.label, lb.programName, lb.category, lb.duration, lb.price, lb.hosts, lb.secondAnimator, lb.pinataFiller, lb.pinataMode, lb.pinataNumber, lb.pinataFillerNumber, lb.clientPinataServicePrice, lb.clientPinataServiceNote, lb.costume || null, lb.room, lb.notes, lb.createdBy, main.id, lb.status, lb.kidsCount || null, lb.groupName || main.groupName || null, bookingExtraDataSqlValue(lb)]
                );
                if (lbInsert.rows[0]) linkedRows.push(lbInsert.rows[0]);
            }
        }

        const activityRows = [];
        const banquetLinkRows = [];
        for (const activity of banquetActivities) {
            const activityConflict = await checkServerConflicts(client, activity.date, activity.lineId, activity.time, activity.duration || 0, null, businessContext);
            if (activityConflict.overlap) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    conflictBookingId: activityConflict.conflictWith.id,
                    error: `Час зайнятий для активності: ${activityConflict.conflictWith.label || activityConflict.conflictWith.program_code} о ${activityConflict.conflictWith.time}`
                });
            }

            const activityDuplicate = await checkServerDuplicate(client, activity.date, activity.programId, activity.time, activity.duration || 0, null, businessContext);
            if (activityDuplicate) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, conflictBookingId: activityDuplicate.id, error: `Активність вже є ${activity.date} о ${activity.time}` });
            }

            const activityRoomConflict = await checkRoomConflict(
                client,
                activity.date,
                activity.room,
                activity.time,
                activity.duration || 0,
                bookingRoomConflictPolicyOptions(activity, { excludeIds: [main.id] }),
                businessContext
            );
            if (activityRoomConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    conflictBookingId: activityRoomConflict.id,
                    error: `Кімната "${activity.room}" зайнята для активності: ${activityRoomConflict.label || activityRoomConflict.program_code} о ${activityRoomConflict.time}`
                });
            }

            const activityTeacherConflict = await validateEducationLessonTeacherConflict(client, activity, businessContext);
            if (activityTeacherConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: activityTeacherConflict.error, conflictBookingId: activityTeacherConflict.conflict.id });
            }

            activity.id = await generateBookingNumber(client);
            const activityInsert = await client.query(
                `INSERT INTO bookings (id, business_context, date, time, line_id, program_id, program_code, label, program_name, category, duration, price, hosts, second_animator, pinata_filler, pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price, client_pinata_service_note, costume, room, notes, created_by, linked_to, status, kids_count, group_name, extra_data, skip_notification, customer_id, payment_method, banquet_guests, banquet_adults, banquet_tables, banquet_menu)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
                 RETURNING *`,
                [activity.id, businessContext, activity.date, activity.time, activity.lineId, activity.programId, activity.programCode, activity.label, activity.programName, activity.category, activity.duration, activity.price || 0, activity.hosts, activity.secondAnimator, activity.pinataFiller, activity.pinataMode, activity.pinataNumber, activity.pinataFillerNumber, activity.clientPinataServicePrice, activity.clientPinataServiceNote, activity.costume || null, activity.room, activity.notes, activity.createdBy || main.createdBy, null, activity.status || main.status, activity.kidsCount || null, activity.groupName || main.groupName || null, activity.extraData ? JSON.stringify(activity.extraData) : null, sideEffectsAllowedForContext(businessContext) ? Boolean(activity.skipNotification) : true, customerId, activity.paymentMethod || main.paymentMethod || null, activity.banquetGuests || null, activity.banquetAdults || null, activity.banquetTables || null, activity.banquetMenu || null]
            );
            if (activityInsert.rows[0]) {
                activityRows.push(activityInsert.rows[0]);
                const linkRow = await upsertBanquetLink(client, businessContext, main.id, activity.id, main.groupName || activity.groupName || null, req.user);
                if (linkRow) banquetLinkRows.push(linkRow);
            }
            const ensuredSecondActivityLine = activitySecondAnimatorLines.get(activity);
            if (ensuredSecondActivityLine) {
                const secondActivityConflict = await checkServerConflicts(client, activity.date, ensuredSecondActivityLine.lineId, activity.time, activity.duration || 0, null, businessContext);
                if (secondActivityConflict.overlap) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        success: false,
                        conflictBookingId: secondActivityConflict.conflictWith.id,
                        error: `Другий ведучий зайнятий для активності: ${secondActivityConflict.conflictWith.label || secondActivityConflict.conflictWith.program_code} о ${secondActivityConflict.conflictWith.time}`
                    });
                }
                const secondActivityRow = await insertSecondAnimatorLinkedBooking(client, {
                    booking: {
                        ...activity,
                        createdBy: activity.createdBy || main.createdBy,
                        groupName: activity.groupName || main.groupName || null
                    },
                    businessContext,
                    mainBookingId: activity.id,
                    status: activity.status || main.status,
                    ensuredLine: ensuredSecondActivityLine
                });
                if (secondActivityRow) linkedRows.push(secondActivityRow);
            }
        }

        const sharedRoomLinkRows = [];
        for (const rootRow of [mainInsert.rows[0], ...activityRows].filter(Boolean)) {
            const createdRoomLinks = await createSharedRoomActivityLinks(client, businessContext, rootRow, req.user);
            sharedRoomLinkRows.push(...createdRoomLinks);
        }

        const createdBanquetGroup = banquetContext?.mode === 'new'
            ? await createBanquetGroupInTransaction({
                db: client,
                primaryBooking: mainInsert.rows[0],
                businessContext,
                user: req.user,
                groupName: main.groupName,
                source: 'booking_create_full',
                meta: { creationContract: 'banquet_context_v1' },
                banquetContext,
                members: activityRows.map(row => ({ bookingId: row.id, role: 'activity' }))
            })
            : null;
        if (createdBanquetGroup?.groupRow) {
            await persistDerivedBookingSetMetadata(
                client,
                createdBanquetGroup.groupRow,
                businessContext,
                { source: 'booking_create_full' }
            );
        }

        await insertScopedHistory(client, 'create', main.createdBy || req.user?.username, main, businessContext);
        for (const activityRow of activityRows) {
            await insertScopedHistory(
                client,
                'create',
                activityRow.created_by || main.createdBy || req.user?.username,
                mapBookingRow(activityRow),
                businessContext
            );
        }

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
        for (const activityRow of activityRows) {
            const activityPrice = Number(activityRow.price || 0);
            if (parkSideEffectsAllowedForContext(businessContext) && activityPrice > 0 && activityRow.status !== 'preliminary') {
                await runOptionalBookingTransactionStep(client, 'Finance auto-record (create/full activity)', async () => {
                    await client.query(
                        `INSERT INTO finance_transactions (business_context, type, category_id, amount, description, date, payment_method, booking_id, created_by)
                         VALUES ($1, 'income', (SELECT id FROM finance_categories WHERE name = 'Бронювання' AND type = 'income' AND COALESCE(business_context, 'event_genix') = $1 LIMIT 1),
                                 $2, $3, $4, $5, $6, $7)`,
                        [
                            businessContext,
                            activityPrice,
                            `${activityRow.program_name || activityRow.label || activityRow.program_code} (${activityRow.id})`,
                            activityRow.date,
                            activityRow.payment_method || main.paymentMethod || null,
                            activityRow.id,
                            activityRow.created_by || main.createdBy || req.user?.username
                        ]
                    );
                });
            }
        }

        if (sideEffectsAllowedForContext(businessContext)) {
            await queueBookingEventInTransaction(client, 'booking.created', {
                booking_id: main.id, business_context: businessContext, date: main.date, time: main.time, room: main.room,
                program_code: main.programCode, program_name: main.programName,
                status: main.status, price: main.price || 0,
                kids_count: main.kidsCount, created_by: main.createdBy,
                linked_count: linkedRows.length,
                activity_count: activityRows.length,
                banquet_link_count: banquetLinkRows.length,
                shared_room_link_count: sharedRoomLinkRows.length
            }, main.id, `booking_created_${main.id}`);
            for (const activityRow of activityRows) {
                await queueBookingEventInTransaction(client, 'booking.created', {
                    booking_id: activityRow.id,
                    business_context: businessContext,
                    date: activityRow.date,
                    time: activityRow.time,
                    room: activityRow.room,
                    program_code: activityRow.program_code,
                    program_name: activityRow.program_name,
                    status: activityRow.status,
                    price: Number(activityRow.price || 0),
                    kids_count: activityRow.kids_count,
                    created_by: activityRow.created_by || main.createdBy,
                    linked_count: 0,
                    activity_count: 0,
                    banquet_parent_id: main.id,
                    banquet_link_count: 1,
                    shared_room_link_count: sharedRoomLinkRows.filter(link =>
                        String(link.booking_a_id) === String(activityRow.id) || String(link.booking_b_id) === String(activityRow.id)
                    ).length
                }, activityRow.id, `booking_created_${activityRow.id}`);
            }
        }

        await commitBookingTransaction(client, 'booking create/full');

        const durableRows = await assertDurableCreatedBookings(
            client,
            [main.id, ...linkedRows.map(row => row.id), ...activityRows.map(row => row.id)],
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
        const activityBookings = activityRows.map(row => {
            const mapped = mapBookingRow(durableById.get(String(row.id)) || row);
            mapped.serverVerified = true;
            return mapped;
        });
        if (!createdBanquetGroup) {
            await reconcileBookingBanquetGroupsSafely(
                [mainBooking.id || main.id, ...linkedBookings.map(item => item.id), ...activityBookings.map(item => item.id)],
                businessContext,
                req.user
            );
        }
        let allBookings = [mainBooking, ...linkedBookings, ...activityBookings];
        await Promise.all(allBookings.map(async booking => {
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
        if (timelineView === 'rooms') {
            allBookings = await attachRoomTimelineResourceResolution(client, allBookings, businessContext);
        }
        allBookings = projectCreatedBookingsForTimelineResponse(allBookings, timelineView);
        try {
            allBookings = await attachBanquetLinksToBookings(allBookings, businessContext);
        } catch (linkErr) {
            log.warn(`Created booking banquet link enrichment failed: ${linkErr.message}`);
        }
        const linkedIdSet = new Set(linkedRows.map(row => String(row.id)));
        const activityIdSet = new Set(activityRows.map(row => String(row.id)));
        const responseMainBooking = allBookings.find(item => String(item.id) === String(mainBooking.id)) || mainBooking;
        if (managerDepositResult?.projection) responseMainBooking.banquetDeposit = managerDepositResult.projection;
        const responseLinkedBookings = allBookings.filter(item => linkedIdSet.has(String(item.id)));
        const responseActivityBookings = allBookings.filter(item => activityIdSet.has(String(item.id)));

        // WebSocket: notify other clients
        allBookings.forEach(booking => {
            broadcastBookingEvent('booking:created', booking, req.user?.id?.toString(), { businessContext });
        });

        res.set('X-Timeline-View', timelineView);
        res.json({
            success: true,
            mainBooking: responseMainBooking,
            linkedBookings: responseLinkedBookings,
            activityBookings: responseActivityBookings,
            banquetLinks: mapBookingVisualLinkRowsForResponse(banquetLinkRows, main.id),
            banquetGroup: createdBanquetGroup ? {
                group: createdBanquetGroup.group,
                membership: createdBanquetGroup.membership,
                members: createdBanquetGroup.members
            } : null,
            sharedRoomLinks: mapBookingVisualLinkRowsForResponse(
                sharedRoomLinkRows,
                main.id,
                [main.id, ...activityRows.map(row => row.id)]
            ),
            allBookings,
            projection: {
                main: responseMainBooking.timelineProjection || null,
                bookings: allBookings.map(item => bookingTimelineProjectionContract(item))
            },
            serverVerified: true
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (create/full)', rbErr));
        log.error('Error creating full booking', err);
        res.status(err.statusCode || err.status || 500).json({
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
        if (permanent && !requirePermanentBookingDelete(req, res)) return;
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
        await insertScopedHistory(client, action, req.user?.username, mapBookingRow(booking), businessContext);

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
            // Keep banquet group read models in sync for cancelled non-primary members.
            await detachBanquetMembershipOnSoftDelete(client, id, businessContext, req.user);
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
        broadcastBookingEvent('booking:deleted', booking, req.user?.id?.toString(), { businessContext });
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
                AND ${bookingActiveStatusSql()}
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
        if (Object.prototype.hasOwnProperty.call(mainPatch, 'room')) {
            for (const row of linkedRows) {
                const patch = linkedPatchById.get(row.id) || {};
                if (!Object.prototype.hasOwnProperty.call(patch, 'room')) {
                    patch.room = mainPatch.room;
                    linkedPatchById.set(row.id, patch);
                }
            }
        }

        const mainTimeShapeChanged = ['date', 'time', 'duration'].some(field =>
            Object.prototype.hasOwnProperty.call(mainPatch, field)
        );
        if (mainTimeShapeChanged && linkedRows.length > 0) {
            const requiredLinkedFields = ['date', 'time', 'duration'].filter(field =>
                Object.prototype.hasOwnProperty.call(mainPatch, field)
            );
            const oldMainStart = timeToMinutes(oldMain.time);
            const newMainStart = Object.prototype.hasOwnProperty.call(mainPatch, 'time')
                ? timeToMinutes(mainPatch.time)
                : oldMainStart;
            const timeDelta = Number.isFinite(oldMainStart) && Number.isFinite(newMainStart)
                ? newMainStart - oldMainStart
                : 0;
            for (const row of linkedRows) {
                const patch = linkedPatchById.get(row.id) || {};
                for (const field of requiredLinkedFields) {
                    if (Object.prototype.hasOwnProperty.call(patch, field)) continue;
                    if (field === 'time') {
                        patch.time = minutesToTime(timeToMinutes(row.time) + timeDelta);
                    } else {
                        patch[field] = mainPatch[field];
                    }
                }
                linkedPatchById.set(row.id, patch);
            }
        }
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
        const allLinkedCandidates = [];
        for (const row of linkedRows) {
            const patch = linkedPatchById.get(row.id) || {};
            const candidate = buildAtomicLinkedCandidate(row, patch);
            allLinkedCandidates.push(candidate);
            const validationError = validateAtomicLinkedCandidate(candidate);
            if (validationError) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: validationError, conflictBookingId: row.id });
            }
            if (Object.keys(patch).length > 0) linkedCandidates.push(candidate);
        }

        await lockBookingConflictResources(
            client,
            [oldMain, mainCandidate, ...linkedRows, ...linkedCandidates],
            businessContext
        );

        const atomicCandidates = [mainCandidate, ...allLinkedCandidates];
        await attachAtomicBanquetConflictMetadata(client, atomicCandidates, businessContext);
        const internalRoomConflict = findRoomConflictAmongCandidates(atomicCandidates);
        if (internalRoomConflict) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: `Кімната зайнята: ${internalRoomConflict.conflict.label || internalRoomConflict.conflict.program_code || internalRoomConflict.conflict.id}`,
                conflictBookingId: internalRoomConflict.conflict.id
            });
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
            const linkedRoomConflict = await findAtomicRoomConflict(client, candidate, groupIds);
            if (linkedRoomConflict) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: `РљС–РјРЅР°С‚Р° Р·Р°Р№РЅСЏС‚Р° Сѓ РїРѕРІ'СЏР·Р°РЅРѕРіРѕ Р±СЂРѕРЅСЋРІР°РЅРЅСЏ: ${linkedRoomConflict.label || linkedRoomConflict.program_code || linkedRoomConflict.id}`,
                    conflictBookingId: linkedRoomConflict.id
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
            await insertScopedHistory(client, body.historyAction, req.user?.username, body.historyData || {
                    bookingId: id,
                    main: body.main || {},
                    linked: linkedInput
                },
                businessContext
            );
        }

        await client.query('COMMIT');

        const mainBooking = savedMainRow ? mapBookingRow(savedMainRow) : mapBookingRow(oldMain);
        const linkedBookings = savedLinkedRows.map(mapBookingRow);

        broadcastBookingEvent('booking:updated', mainBooking, req.user?.id?.toString(), {
            businessContext,
            previousBooking: mapBookingRow(oldMain)
        });
        for (const linkedRow of updatedLinkedRows) {
            const linkedBooking = mapBookingRow(linkedRow);
            const previousLinked = linkedRows.find(row => String(row.id) === String(linkedRow.id));
            broadcastBookingEvent('booking:updated', linkedBooking, req.user?.id?.toString(), {
                businessContext,
                previousBooking: previousLinked ? mapBookingRow(previousLinked) : null
            });
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
               AND status = 'preliminary'
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
        action: { type: 'booking_confirmed', source, durableMutation: true },
        cascade: { confirmedCount: confirmedRows.length }
    });
});

router.post('/:id/preliminary', requireAction('edit_booking'), async (req, res) => {
    const { id } = req.params;
    if (!validateId(id)) return res.status(400).json({ success: false, error: 'Invalid booking id' });

    const source = normalizeConfirmationSource(req.body?.source);
    const note = normalizeConfirmationNote(req.body?.note);
    const actor = req.user || {};
    const businessContext = timelineContextFromRequest(req);
    if (!requireTimelineContext(req, res, businessContext)) return;
    if (!requireTimelineAction(req, res, businessContext, 'edit')) return;
    const client = await pool.connect();
    let preliminaryRow = null;
    let preliminaryRows = [];
    let previousStatus = 'confirmed';

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

        let rootBooking = current;
        if (current.linked_to) {
            rootBooking = await getScopedBookingById(client, current.linked_to, businessContext, { forUpdate: true });
            if (!rootBooking) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, error: 'Root booking not found' });
            }
            if (!canEditBooking(req.user, rootBooking)) {
                await client.query('ROLLBACK');
                return sendBookingDenied(req, res, rootBooking);
            }
        }

        const currentStatus = normalizeBookingStatus(current.status, 'confirmed');
        const rootStatus = normalizeBookingStatus(rootBooking.status, 'confirmed');
        previousStatus = rootStatus || currentStatus || 'confirmed';

        if (currentStatus === 'cancelled' || rootStatus === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Cancelled bookings cannot be marked preliminary',
                currentStatus: currentStatus === 'cancelled' ? currentStatus : rootStatus || null
            });
        }

        const rootId = rootBooking.id;
        const updateResult = await client.query(
            `UPDATE bookings
             SET status = 'preliminary',
                 confirmed_at = NULL,
                 confirmed_by = NULL,
                 confirmation_note = NULL,
                 confirmation_source = NULL,
                 updated_at = NOW()
             WHERE (id = $1 OR linked_to = $1)
               AND ${bookingContextSql('', '$2')}
               AND ${bookingActiveStatusSql()}
               AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) != 'preliminary'
             RETURNING *`,
            [rootId, businessContext]
        );

        preliminaryRows = updateResult.rows;
        preliminaryRow = updateResult.rows.find(row => row.id === rootId)
            || {
                ...rootBooking,
                status: 'preliminary',
                confirmed_at: null,
                confirmed_by: null,
                confirmation_note: null,
                confirmation_source: null
            };

        if (!preliminaryRows.length) {
            await client.query('COMMIT');
            return res.json({
                success: true,
                ok: true,
                booking: mapBookingRow(preliminaryRow),
                action: { type: 'booking_marked_preliminary', source, idempotent: true, durableMutation: false },
                cascade: { markedPreliminaryCount: 0 }
            });
        }

        await insertBookingMarkedPreliminaryHistory(client, {
            booking: preliminaryRow,
            actor,
            source,
            note,
            previousStatus,
            changedAt: preliminaryRows[0]?.updated_at || preliminaryRow.updated_at
        });

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed (preliminary)', rbErr));
        log.error('Error marking booking preliminary', err);
        return res.status(500).json({ success: false, error: 'Failed to mark booking preliminary' });
    } finally {
        client.release();
    }

    if (sideEffectsAllowedForContext(preliminaryRow.business_context || DEFAULT_TIMELINE_CONTEXT)) {
        runBookingPreliminarySideEffects(preliminaryRow, actor, source, preliminaryRows, previousStatus);
    }
    res.json({
        success: true,
        ok: true,
        booking: mapBookingRow(preliminaryRow),
        action: { type: 'booking_marked_preliminary', source, durableMutation: true },
        cascade: { markedPreliminaryCount: preliminaryRows.length }
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
    const activitySetGuard = await validateSingleBookingActivitySetUpdate({
        bookingId: id,
        extraData: b.extraData || b.extra_data,
        businessContext
    });
    if (!activitySetGuard.allowed) {
        return res.status(409).json({
            success: false,
            code: 'BANQUET_ACTIVITY_SET_REQUIRES_ATOMIC_ENDPOINT',
            error: 'Banquet activity membership must be changed through the atomic banquet booking-set endpoint',
            groupId: activitySetGuard.groupId,
            requestedActivityIds: activitySetGuard.requestedActivityIds,
            actualActivityIds: activitySetGuard.actualActivityIds
        });
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
    if (b.banquetAdults === undefined) b.banquetAdults = old.banquet_adults;
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
        normalizeBookingSecondAnimatorFields(b);

        await client.query('BEGIN');

        const oldBooking = await getScopedBookingById(client, id, businessContext, { forUpdate: true });
        if (!oldBooking) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Бронювання не знайдено' });
        }
        mergeExistingExtraDataForBookingUpdate(b, oldBooking);
        await lockBookingConflictResources(client, [oldBooking, b], businessContext);
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
                const roomConflict = await checkRoomConflict(
                    client,
                    b.date,
                    b.room,
                    b.time,
                    b.duration || 0,
                    bookingRoomConflictPolicyOptions(b, { excludeIds }),
                    businessContext
                );
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
            return res.status(400).json({
                success: false,
                code: 'cancelled_booking_cannot_be_restored',
                currentStatus: 'cancelled',
                error: 'Скасоване бронювання не можна відновити. Створіть нове.'
            });
        }

        // CRM: resolve customer_id for update
        const customerIdProvided = Object.prototype.hasOwnProperty.call(b, 'customerId')
            || Object.prototype.hasOwnProperty.call(b, 'customer_id');
        const rawCustomerId = Object.prototype.hasOwnProperty.call(b, 'customerId') ? b.customerId : b.customer_id;
        let providedCustomerId = null;
        if (customerIdProvided) {
            const rawText = rawCustomerId === null || rawCustomerId === undefined ? '' : String(rawCustomerId).trim();
            if (rawCustomerId === null) {
                providedCustomerId = null;
            } else if (!rawText) {
                providedCustomerId = oldBooking.customer_id || null;
            } else {
                providedCustomerId = parseInt(rawText, 10);
                if (!Number.isFinite(providedCustomerId)) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ success: false, error: 'Invalid customerId' });
                }
            }
        }
        let updateCustomerId = sideEffectsAllowedForContext(businessContext)
            ? (customerIdProvided
                ? providedCustomerId
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

        await applyEffectiveBookingPrice(client, b, { businessContext });
        await applyBookingPackageEntryCharge(client, b, { businessContext });
        await snapshotBanquetTermsForBooking(client, b);
        const updateExtraDataSql = bookingExtraDataSqlValue(b);

        let ensuredSecondAnimatorLineForUpdate = null;
        if (!b.linkedTo && bookingRequiresSecondAnimatorLink(b)) {
            ensuredSecondAnimatorLineForUpdate = await ensureSecondAnimatorLineForBooking(client, b, businessContext);
            if (!ensuredSecondAnimatorLineForUpdate) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Другого ведучого не знайдено серед активних аніматорів' });
            }
            if (String(ensuredSecondAnimatorLineForUpdate.lineId) === String(b.lineId)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ success: false, error: 'Другий ведучий не може бути на тій самій лінії, що й основний аніматор' });
            }
            b.secondAnimator = ensuredSecondAnimatorLineForUpdate.name;
        }

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
                 banquet_guests=$32, banquet_adults=$33, banquet_tables=$34, banquet_menu=$35
                 WHERE id=$23
                   AND ${bookingContextSql('', '$36')}
                   AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $24::timestamp)
                 RETURNING *`,
                [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
                 b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
                 b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
                 b.kidsCount || null, b.groupName || null, updateExtraDataSql,
                 id, clientUpdatedAt, updateCustomerId, b.paymentMethod || null, b.pinataMode,
                 b.clientPinataServicePrice, b.clientPinataServiceNote, b.pinataNumber, b.pinataFillerNumber,
                 b.banquetGuests || null, b.banquetAdults || null, b.banquetTables || null, b.banquetMenu || null, businessContext]
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
                 banquet_guests=$31, banquet_adults=$32, banquet_tables=$33, banquet_menu=$34
                 WHERE id=$23 AND ${bookingContextSql('', '$35')}
                 RETURNING *`,
                [b.date, b.time, b.lineId, b.programId, b.programCode, b.label, b.programName,
                 b.category, b.duration, b.price, b.hosts, b.secondAnimator, b.pinataFiller,
                 b.costume || null, b.room, b.notes, b.createdBy, b.linkedTo, newStatus,
                 b.kidsCount || null, b.groupName || null, updateExtraDataSql, id, updateCustomerId,
                 b.paymentMethod || null, b.pinataMode, b.clientPinataServicePrice, b.clientPinataServiceNote,
                 b.pinataNumber, b.pinataFillerNumber, b.banquetGuests || null, b.banquetAdults || null, b.banquetTables || null, b.banquetMenu || null, businessContext]
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
        const managerDepositResult = await syncManagerDepositForBooking(client, b, updateResult.rows[0], businessContext, req.user);

        // v8.7: Sync linked bookings when secondAnimator changes
        if (!b.linkedTo) {
            const linkedResult = await client.query(
                `SELECT id, line_id, second_animator, program_id, price
                   FROM bookings
                  WHERE linked_to = $1 AND ${bookingContextSql('', '$2')} AND ${bookingActiveStatusSql()}`,
                [id, businessContext]
            );
            const oldSecond = String(oldBooking.second_animator || '').trim();
            const newSecond = bookingSecondAnimatorName(b);
            const secondChanged = (oldSecond || '') !== (newSecond || '');
            const shouldHaveSecondLink = bookingRequiresSecondAnimatorLink(b);

            const ensureSecondAnimatorLinkedBooking = async () => {
                const ensuredLine = ensuredSecondAnimatorLineForUpdate
                    || await ensureSecondAnimatorLineForBooking(client, b, businessContext);
                if (!ensuredLine) {
                    const err = new Error('Другого ведучого не знайдено серед активних аніматорів');
                    err.statusCode = 400;
                    err.publicMessage = err.message;
                    throw err;
                }
                if (String(ensuredLine.lineId) === String(b.lineId)) {
                    const err = new Error('Другий ведучий не може бути на тій самій лінії, що й основний аніматор');
                    err.statusCode = 409;
                    err.publicMessage = err.message;
                    throw err;
                }
                await lockBookingConflictResources(client, [{ ...b, lineId: ensuredLine.lineId }], businessContext);
                const secondConflict = await checkServerConflicts(
                    client,
                    b.date,
                    ensuredLine.lineId,
                    b.time,
                    b.duration || 0,
                    id,
                    businessContext
                );
                if (secondConflict.overlap) {
                    const err = new Error(`Час зайнятий у другого ведучого: ${secondConflict.conflictWith.label || secondConflict.conflictWith.program_code}`);
                    err.statusCode = 409;
                    err.publicMessage = err.message;
                    throw err;
                }
                await insertSecondAnimatorLinkedBooking(client, {
                    booking: b,
                    businessContext,
                    mainBookingId: id,
                    status: newStatus,
                    ensuredLine
                });
            };

            if (secondChanged && linkedResult.rows.length > 0) {
                // Delete old linked bookings — secondAnimator changed or was cleared
                for (const linked of linkedResult.rows) {
                    await client.query(
                        `DELETE FROM bookings WHERE id = $1 AND ${bookingContextSql('', '$2')}`,
                        [linked.id, businessContext]
                    );
                }
                // Create new linked booking if secondAnimator is set
                if (shouldHaveSecondLink) await ensureSecondAnimatorLinkedBooking();
            } else if (!secondChanged && linkedResult.rows.length > 0) {
                // No change in secondAnimator — cascade basic fields to existing linked
                for (const linked of linkedResult.rows) {
                    await client.query(
                        `UPDATE bookings SET date=$1, time=$2, duration=$3, status=$4, room=$5,
                         pinata_filler=$6, pinata_mode=$7, client_pinata_service_price=$8,
                         client_pinata_service_note=$9, pinata_number=$10, pinata_filler_number=$11,
                           updated_at=NOW() WHERE id=$12 AND ${bookingContextSql('', '$13')} AND ${bookingActiveStatusSql()}`,
                        [b.date, b.time, b.duration, newStatus, b.room, b.pinataFiller, b.pinataMode,
                         b.clientPinataServicePrice, b.clientPinataServiceNote, b.pinataNumber,
                         b.pinataFillerNumber, linked.id, businessContext]
                    );
                }
            } else if (shouldHaveSecondLink && linkedResult.rows.length === 0) {
                // Was missing linked booking (old bug) — create it now
                await ensureSecondAnimatorLinkedBooking();
            }
        }

        await insertScopedHistory(client, 'edit', req.user?.username, {
                ...b,
                audit: bookingPackageAudit(oldBooking, b)
            },
            businessContext
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
        await reconcileBookingBanquetGroupsSafely([id], businessContext, req.user);

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
        if (managerDepositResult?.projection) savedBooking.banquetDeposit = managerDepositResult.projection;
        broadcastBookingEvent('booking:updated', savedBooking, req.user?.id?.toString(), {
            businessContext,
            previousBooking: mapBookingRow(oldBooking)
        });
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
