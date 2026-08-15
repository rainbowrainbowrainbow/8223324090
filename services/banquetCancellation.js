'use strict';

const { pool: defaultPool } = require('../db');
const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');
const { syncBookingFinanceInTransaction } = require('./bookingFinanceSync');
const { syncBanquetActualMenuTask } = require('./banquetMenuTaskSync');
const { insertHistory } = require('./historyLog');
const {
    broadcastBanquetEvent,
    broadcastBookingEvent
} = require('./websocket');

const ACTIVE_BOOKING_STATUS_SQL = "LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled'";
const ACTIVE_GROUP_STATUS_SQL = "LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) <> 'cancelled'";
const SAFE_PAYMENT_STATUSES = new Set(['', 'pending', 'unpaid', 'not_paid', 'none']);

class BanquetCancellationError extends Error {
    constructor(message, code, details = {}, statusCode = 409) {
        super(message);
        this.name = 'BanquetCancellationError';
        this.code = code || 'BANQUET_CANCELLATION_ERROR';
        this.details = details || {};
        this.statusCode = statusCode;
        this.publicMessage = message;
    }
}

function contextSql(alias, placeholder) {
    const prefix = alias ? `${alias}.` : '';
    return `CASE
        WHEN LOWER(COALESCE(NULLIF(BTRIM(${prefix}business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
             IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_BUSINESS_CONTEXT}'
        ELSE LOWER(COALESCE(NULLIF(BTRIM(${prefix}business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
    END = ${placeholder}`;
}

function cleanId(value) {
    return String(value || '').trim();
}

function activeStatus(value, fallback = 'confirmed') {
    return String(value || fallback).trim().toLowerCase() !== 'cancelled';
}

function unique(values = []) {
    return [...new Set(values.map(value => cleanId(value)).filter(Boolean))];
}

function blocker(code, message, details = {}) {
    return { code, message, details };
}

function blockerCodes(blockers = []) {
    return blockers.map(item => item.code);
}

function publicBlockerMessage(blockers = []) {
    const text = blockers.map(item => item.message).filter(Boolean).join('; ');
    return `Скасування заблоковано: ${text || 'потрібна ручна перевірка'}.`;
}

function operationNextAction(operation, allowed, blockers = []) {
    if (!allowed) return blockers.length ? 'manual_resolution' : 'refresh_readiness';
    if (operation === 'banquet_activity_cancel') return 'cancel_banquet_activity';
    if (operation === 'banquet_group_cancel') return 'cancel_banquet_group';
    return 'cancel_standalone_booking';
}

function canonicalReadinessPayload(payload = {}) {
    const blockers = Array.isArray(payload.blockers) ? payload.blockers : [];
    const allowed = blockers.length === 0 && payload.allowed !== false;
    const operation = payload.operation || 'standalone_cancel';
    return {
        success: true,
        operation,
        allowed,
        memberRole: payload.memberRole || null,
        groupId: payload.groupId || null,
        primaryBookingId: payload.primaryBookingId || null,
        groupUpdatedAt: payload.groupUpdatedAt || null,
        blockers,
        blockerCodes: blockerCodes(blockers),
        nextAction: operationNextAction(operation, allowed, blockers),
        affectedBookingIds: unique(payload.affectedBookingIds || []),
        affectedDates: unique(payload.affectedDates || []),
        primaryBooking: payload.primaryBooking || null
    };
}

function routeRequiredPayload(readiness, message = 'Banquet member cancellation must use the canonical banquet route') {
    const payload = canonicalReadinessPayload({
        ...readiness,
        allowed: false,
        blockers: readiness.blockers?.length
            ? readiness.blockers
            : [blocker('banquet_route_required', 'Складова банкету скасовується окремою банкетною дією')]
    });
    return {
        success: false,
        code: 'BANQUET_ROUTE_REQUIRED',
        error: message,
        details: payload
    };
}

function idempotencyKeyFromInput(input = {}) {
    return cleanId(input.idempotencyKey || input.idempotency_key || input.headers?.['idempotency-key']);
}

async function withSerializableTransaction(db, fn) {
    const client = await db.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function loadBooking(queryable, bookingId, businessContext, { forUpdate = false } = {}) {
    const result = await queryable.query(
        `SELECT *
           FROM bookings
          WHERE id = $1
            AND ${contextSql('', '$2')}
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [bookingId, businessContext]
    );
    return result.rows?.[0] || null;
}

async function loadMembershipByBooking(queryable, bookingId, businessContext, { forUpdate = false } = {}) {
    const result = await queryable.query(
        `SELECT bgb.group_id,
                bgb.booking_id,
                bgb.role,
                bgb.sort_order,
                bg.primary_booking_id,
                bg.updated_at AS group_updated_at,
                bg.status AS group_status
           FROM banquet_group_bookings bgb
           JOIN banquet_groups bg ON bg.id = bgb.group_id
          WHERE bgb.booking_id = $1
            AND ${contextSql('bgb', '$2')}
            AND ${contextSql('bg', '$2')}
          ${forUpdate ? 'FOR UPDATE OF bgb, bg' : ''}`,
        [bookingId, businessContext]
    );
    return result.rows?.[0] || null;
}

async function loadGroup(queryable, groupId, businessContext, { forUpdate = false } = {}) {
    const result = await queryable.query(
        `SELECT *
           FROM banquet_groups
          WHERE id = $1
            AND ${contextSql('', '$2')}
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [groupId, businessContext]
    );
    return result.rows?.[0] || null;
}

async function loadGroupMembers(queryable, groupId, businessContext, { forUpdate = false } = {}) {
    const result = await queryable.query(
        `SELECT bgb.group_id,
                bgb.booking_id,
                bgb.role,
                bgb.sort_order,
                b.*
           FROM banquet_group_bookings bgb
           JOIN bookings b ON b.id = bgb.booking_id
          WHERE bgb.group_id = $1
            AND ${contextSql('bgb', '$2')}
            AND ${contextSql('b', '$2')}
          ORDER BY bgb.sort_order, bgb.booking_id
          ${forUpdate ? 'FOR UPDATE OF bgb, b' : ''}`,
        [groupId, businessContext]
    );
    return result.rows || [];
}

async function loadLinkedDescendants(queryable, rootIds, businessContext, { forUpdate = false } = {}) {
    const ids = unique(rootIds);
    if (!ids.length) return [];
    const result = await queryable.query(
        `WITH RECURSIVE descendants(id) AS (
            SELECT b.id
              FROM bookings b
             WHERE b.linked_to = ANY($1::text[])
               AND ${contextSql('b', '$2')}
            UNION
            SELECT child.id
              FROM bookings child
              JOIN descendants parent ON child.linked_to = parent.id
             WHERE ${contextSql('child', '$2')}
        )
        SELECT b.*
          FROM bookings b
          JOIN descendants d ON d.id = b.id
         WHERE ${contextSql('b', '$2')}
         ORDER BY b.id
         ${forUpdate ? 'FOR UPDATE OF b' : ''}`,
        [ids, businessContext]
    );
    return result.rows || [];
}

async function loadFinanceRows(queryable, bookingIds, businessContext, { forUpdate = false } = {}) {
    const ids = unique(bookingIds);
    if (!ids.length) return [];
    const result = await queryable.query(
        `SELECT id, booking_id, type, amount, payment_method, certificate_id, category_id, description, date, created_by
           FROM finance_transactions
          WHERE booking_id = ANY($1::text[])
            AND ${contextSql('', '$2')}
          ORDER BY booking_id, id
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [ids, businessContext]
    );
    return result.rows || [];
}

async function loadReceiptRows(queryable, bookingIds, businessContext, { forUpdate = false } = {}) {
    const ids = unique(bookingIds);
    if (!ids.length) return [];
    const result = await queryable.query(
        `SELECT id, booking_id, transaction_id, amount
           FROM receipts
          WHERE booking_id = ANY($1::text[])
            AND ${contextSql('', '$2')}
          ORDER BY booking_id, id
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [ids, businessContext]
    );
    return result.rows || [];
}

async function loadDeposits(queryable, groupId, primaryBookingId, businessContext, { forUpdate = false } = {}) {
    const result = await queryable.query(
        `SELECT id, status, accountant_task_id, paid_amount, payment_method,
                verified_at, verified_by, finance_transaction_id
           FROM banquet_deposits
          WHERE ${contextSql('', '$1')}
            AND (banquet_group_id = $2 OR primary_booking_id = $3)
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'manager_reported')) <> 'cancelled'
          ORDER BY id
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [businessContext, groupId, primaryBookingId]
    );
    return result.rows || [];
}

async function loadStockDependencies(queryable, bookings, { forUpdate = false } = {}) {
    const programIds = unique(bookings.map(row => row.program_id));
    if (!programIds.length) return [];
    const result = await queryable.query(
        `SELECT psr.product_id, psr.stock_id, psr.quantity
           FROM product_stock_requirements psr
          WHERE psr.product_id::text = ANY($1::text[])
          ORDER BY psr.product_id, psr.stock_id
          ${forUpdate ? 'FOR SHARE' : ''}`,
        [programIds]
    );
    return result.rows || [];
}

function bookingHardBlockers(booking = {}) {
    const id = cleanId(booking.id || booking.booking_id);
    const paymentStatus = String(booking.payment_status || '').trim().toLowerCase();
    const blockers = [];
    if (Number(booking.paid_amount || 0) > 0) blockers.push(blocker('paid_amount', 'у бронюванні є фактична оплата', { bookingId: id }));
    if (paymentStatus && !SAFE_PAYMENT_STATUSES.has(paymentStatus)) blockers.push(blocker('payment_status', 'статус оплати не є unpaid/pending', { bookingId: id, paymentStatus }));
    if (booking.certificate_id) blockers.push(blocker('certificate', 'бронювання привʼязане до сертифіката', { bookingId: id }));
    if (booking.checkbox_receipt_id) blockers.push(blocker('fiscal_receipt', 'бронювання має фіскальний чек', { bookingId: id }));
    if (booking.fiscal_required === true) blockers.push(blocker('fiscal_required', 'для бронювання потрібен фіскальний облік', { bookingId: id }));
    return blockers;
}

function financeHardBlockers(bookings = [], financeRows = [], receipts = []) {
    const byBooking = new Map(bookings.map(row => [cleanId(row.id || row.booking_id), row]));
    const rowsByBooking = new Map();
    for (const row of financeRows) {
        const id = cleanId(row.booking_id);
        if (!rowsByBooking.has(id)) rowsByBooking.set(id, []);
        rowsByBooking.get(id).push(row);
    }
    const blockers = [];
    for (const [bookingId, rows] of rowsByBooking) {
        const booking = byBooking.get(bookingId) || {};
        const nonCertificateRows = rows.filter(row => !row.certificate_id);
        const certificateRows = rows.filter(row => row.certificate_id);
        if (certificateRows.length) blockers.push(blocker('certificate_finance', 'існує фінансова операція по сертифікату', { bookingId, count: certificateRows.length }));
        if (nonCertificateRows.length > 1) {
            blockers.push(blocker('noncanonical_finance', 'існує кілька фінансових операцій для бронювання', { bookingId, count: nonCertificateRows.length }));
            continue;
        }
        if (nonCertificateRows.length === 1) {
            const row = nonCertificateRows[0];
            const amount = Number(row.amount || 0);
            const price = Number(booking.price || 0);
            if (String(row.type || '').toLowerCase() !== 'income' || amount !== price) {
                blockers.push(blocker('noncanonical_finance', 'фінансова операція не схожа на canonical unpaid booking row', {
                    bookingId,
                    financeTransactionId: row.id,
                    amount,
                    price
                }));
            }
        }
    }
    for (const row of receipts) {
        blockers.push(blocker('receipt', 'існує receipt для бронювання', {
            bookingId: cleanId(row.booking_id),
            receiptId: row.id
        }));
    }
    return blockers;
}

function depositHardBlockers(deposits = []) {
    return deposits.map(row => blocker('active_deposit', 'у банкеті є активний завдаток', {
        depositId: row.id,
        status: row.status || null,
        paidAmount: row.paid_amount || null,
        accountantTaskId: row.accountant_task_id || null,
        verified: Boolean(row.verified_at || row.verified_by)
    }));
}

function stockHardBlockers(stockDependencies = []) {
    if (!stockDependencies.length) return [];
    return [blocker('stock_without_provenance', 'для програми є складська залежність без durable movement provenance', {
        count: stockDependencies.length
    })];
}

async function classifyCancellationBlockers(queryable, {
    operation,
    group,
    members,
    affectedBookings,
    businessContext,
    forUpdate = false
}) {
    const activeAffected = affectedBookings.filter(row => activeStatus(row.status));
    const bookingIds = unique(affectedBookings.map(row => row.id || row.booking_id));
    const blockers = [];
    activeAffected.forEach(row => blockers.push(...bookingHardBlockers(row)));
    const [financeRows, receipts, deposits, stockDependencies] = await Promise.all([
        loadFinanceRows(queryable, bookingIds, businessContext, { forUpdate }),
        loadReceiptRows(queryable, bookingIds, businessContext, { forUpdate }),
        group ? loadDeposits(queryable, group.id, group.primary_booking_id, businessContext, { forUpdate }) : Promise.resolve([]),
        loadStockDependencies(queryable, activeAffected, { forUpdate })
    ]);
    blockers.push(...financeHardBlockers(affectedBookings, financeRows, receipts));
    blockers.push(...depositHardBlockers(deposits));
    blockers.push(...stockHardBlockers(stockDependencies));

    if (operation === 'banquet_activity_cancel') {
        const targetIds = new Set(bookingIds);
        const activePrimary = members.find(row => (
            cleanId(row.booking_id || row.id) === cleanId(group?.primary_booking_id)
            && activeStatus(row.status)
        ));
        if (!activePrimary) blockers.push(blocker('state_changed', 'primary бронювання банкету вже не активне'));
        if ([...targetIds].includes(cleanId(group?.primary_booking_id))) {
            blockers.push(blocker('primary_requires_group_cancel', 'primary бронювання скасовується тільки через скасування всього банкету'));
        }
    }

    return blockers;
}

async function getBookingCancellationReadiness({
    db = defaultPool,
    bookingId,
    businessContext = DEFAULT_BUSINESS_CONTEXT,
    forUpdate = false
} = {}) {
    const context = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
    const cleanBookingId = cleanId(bookingId);
    const booking = await loadBooking(db, cleanBookingId, context, { forUpdate });
    if (!booking) {
        return canonicalReadinessPayload({
            operation: 'unknown',
            allowed: false,
            blockers: [blocker('booking_not_found', 'бронювання не знайдено')],
            affectedBookingIds: [cleanBookingId]
        });
    }
    const membership = await loadMembershipByBooking(db, cleanBookingId, context, { forUpdate });
    if (!membership || !activeStatus(membership.group_status, 'active')) {
        const linkedChildren = await loadLinkedDescendants(db, [cleanBookingId], context, { forUpdate });
        return canonicalReadinessPayload({
            operation: 'standalone_cancel',
            allowed: true,
            affectedBookingIds: [cleanBookingId, ...linkedChildren.map(row => row.id)],
            affectedDates: [booking.date, ...linkedChildren.map(row => row.date)],
            primaryBooking: booking
        });
    }

    const group = await loadGroup(db, membership.group_id, context, { forUpdate });
    const members = await loadGroupMembers(db, membership.group_id, context, { forUpdate });
    const memberRole = String(membership.role || '').trim().toLowerCase() || null;
    const isPrimary = cleanId(membership.primary_booking_id) === cleanBookingId && memberRole === 'primary';
    const operation = isPrimary ? 'banquet_group_cancel' : 'banquet_activity_cancel';
    const roots = isPrimary ? members : members.filter(row => cleanId(row.booking_id || row.id) === cleanBookingId);
    const linkedChildren = await loadLinkedDescendants(db, roots.map(row => row.booking_id || row.id), context, { forUpdate });
    const affectedBookings = [...roots, ...linkedChildren];
    const blockers = await classifyCancellationBlockers(db, {
        operation,
        group,
        members,
        affectedBookings,
        businessContext: context,
        forUpdate
    });
    return canonicalReadinessPayload({
        operation,
        memberRole,
        groupId: membership.group_id,
        primaryBookingId: membership.primary_booking_id,
        groupUpdatedAt: group?.updated_at || membership.group_updated_at || null,
        blockers,
        affectedBookingIds: affectedBookings.map(row => row.id || row.booking_id),
        affectedDates: affectedBookings.map(row => row.date),
        primaryBooking: members.find(row => cleanId(row.booking_id || row.id) === cleanId(membership.primary_booking_id)) || booking
    });
}

async function syncCancelledBookingSideEffects(client, booking, businessContext, user) {
    await syncBanquetActualMenuTask(client, booking, { businessContext, actor: user, cancel: true });
    await syncBookingFinanceInTransaction(client, booking, {
        businessContext,
        createdBy: user?.username || 'system',
        optional: false,
        label: 'Canonical banquet cancellation finance synchronization'
    });
}

async function softCancelBookings(client, bookingIds, businessContext) {
    const ids = unique(bookingIds);
    if (!ids.length) return [];
    const result = await client.query(
        `UPDATE bookings
            SET status = 'cancelled',
                updated_at = NOW()
          WHERE id = ANY($1::text[])
            AND ${contextSql('', '$2')}
            AND ${ACTIVE_BOOKING_STATUS_SQL}
          RETURNING *`,
        [ids, businessContext]
    );
    return result.rows || [];
}

async function detachActivityMembership(client, groupId, bookingId, primaryBookingId, businessContext, user) {
    await client.query(
        `DELETE FROM banquet_group_bookings
          WHERE group_id = $1
            AND booking_id = $2
            AND ${contextSql('', '$3')}`,
        [groupId, bookingId, businessContext]
    );
    await client.query(
        `DELETE FROM booking_banquet_links
          WHERE business_context = $1
            AND relation_type = 'banquet_activity'
            AND (
                (booking_a_id = $2 AND booking_b_id = $3)
                OR (booking_a_id = $3 AND booking_b_id = $2)
            )`,
        [businessContext, primaryBookingId, bookingId]
    );
    await client.query(
        `UPDATE banquet_groups
            SET updated_at = NOW(),
                updated_by = $3
          WHERE id = $1
            AND ${contextSql('', '$2')}`,
        [groupId, businessContext, user?.username || 'system']
    );
}

function assertAllowed(readiness) {
    if (readiness.allowed) return;
    throw new BanquetCancellationError(
        publicBlockerMessage(readiness.blockers),
        'BANQUET_CANCELLATION_BLOCKED',
        readiness,
        409
    );
}

async function cancelBanquetActivity({
    db = defaultPool,
    groupId,
    bookingId,
    businessContext = DEFAULT_BUSINESS_CONTEXT,
    user = {},
    idempotencyKey = null
} = {}) {
    const context = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
    return withSerializableTransaction(db, async client => {
        const group = await loadGroup(client, groupId, context, { forUpdate: true });
        if (!group) {
            throw new BanquetCancellationError('Banquet group not found', 'BANQUET_GROUP_NOT_FOUND', { groupId }, 404);
        }
        const membership = await loadMembershipByBooking(client, bookingId, context, { forUpdate: true });
        const booking = await loadBooking(client, bookingId, context, { forUpdate: true });
        if (!booking) {
            throw new BanquetCancellationError('Booking not found', 'BOOKING_NOT_FOUND', { bookingId }, 404);
        }
        if (!membership || cleanId(membership.group_id) !== cleanId(groupId)) {
            if (!activeStatus(booking.status)) {
                return {
                    success: true,
                    operation: 'banquet_activity_cancel',
                    idempotent: true,
                    noop: true,
                    booking,
                    readiness: await getBookingCancellationReadiness({ db: client, bookingId, businessContext: context, forUpdate: true })
                };
            }
            throw new BanquetCancellationError('Booking is not a member of this banquet group', 'BANQUET_MEMBER_NOT_FOUND', { groupId, bookingId }, 404);
        }
        if (cleanId(group.primary_booking_id) === cleanId(bookingId) || String(membership.role || '').toLowerCase() === 'primary') {
            throw new BanquetCancellationError('Primary booking requires full banquet cancellation', 'BANQUET_PRIMARY_REQUIRES_GROUP_CANCEL', {
                groupId,
                bookingId,
                nextAction: 'cancel_banquet_group'
            });
        }
        const readiness = await getBookingCancellationReadiness({ db: client, bookingId, businessContext: context, forUpdate: true });
        assertAllowed(readiness);
        const cancelledRows = await softCancelBookings(client, readiness.affectedBookingIds, context);
        for (const row of cancelledRows) {
            await syncCancelledBookingSideEffects(client, row, context, user);
        }
        await detachActivityMembership(client, groupId, bookingId, group.primary_booking_id, context, user);
        await insertHistory(client, {
            businessContext: context,
            action: 'banquet_activity_cancelled',
            username: user?.username || 'system',
            data: {
                group_id: groupId,
                booking_id: bookingId,
                primary_booking_id: group.primary_booking_id,
                affected_booking_ids: readiness.affectedBookingIds,
                idempotency_key: idempotencyKey || null
            }
        });
        return {
            success: true,
            operation: 'banquet_activity_cancel',
            groupId,
            bookingId,
            affectedBookingIds: readiness.affectedBookingIds,
            affectedDates: readiness.affectedDates,
            bookings: cancelledRows,
            primaryBooking: readiness.primaryBooking,
            readiness
        };
    }).then(result => {
        broadcastCancellation(result, user);
        return result;
    });
}

async function cancelBanquetGroup({
    db = defaultPool,
    groupId,
    businessContext = DEFAULT_BUSINESS_CONTEXT,
    user = {},
    idempotencyKey = null
} = {}) {
    const context = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
    return withSerializableTransaction(db, async client => {
        const group = await loadGroup(client, groupId, context, { forUpdate: true });
        if (!group) {
            throw new BanquetCancellationError('Banquet group not found', 'BANQUET_GROUP_NOT_FOUND', { groupId }, 404);
        }
        const members = await loadGroupMembers(client, groupId, context, { forUpdate: true });
        const activeMembers = members.filter(row => activeStatus(row.status));
        if (!activeStatus(group.status, 'active') && !activeMembers.length) {
            return {
                success: true,
                operation: 'banquet_group_cancel',
                idempotent: true,
                noop: true,
                groupId,
                affectedBookingIds: members.map(row => row.booking_id || row.id),
                affectedDates: members.map(row => row.date),
                primaryBooking: members.find(row => cleanId(row.booking_id || row.id) === cleanId(group.primary_booking_id)) || null
            };
        }
        const primaryBookingId = cleanId(group.primary_booking_id);
        const primary = members.find(row => cleanId(row.booking_id || row.id) === primaryBookingId);
        if (!primary) {
            throw new BanquetCancellationError('Banquet primary booking is missing', 'BANQUET_PRIMARY_MISSING', { groupId, primaryBookingId });
        }
        const readiness = await getBookingCancellationReadiness({ db: client, bookingId: primaryBookingId, businessContext: context, forUpdate: true });
        assertAllowed(readiness);
        const cancelledRows = await softCancelBookings(client, readiness.affectedBookingIds, context);
        for (const row of cancelledRows) {
            await syncCancelledBookingSideEffects(client, row, context, user);
        }
        await client.query(
            `UPDATE banquet_groups
                SET status = 'cancelled',
                    updated_at = NOW(),
                    updated_by = $3
              WHERE id = $1
                AND ${contextSql('', '$2')}
                AND ${ACTIVE_GROUP_STATUS_SQL}
              RETURNING id`,
            [groupId, context, user?.username || 'system']
        );
        await insertHistory(client, {
            businessContext: context,
            action: 'banquet_group_cancelled',
            username: user?.username || 'system',
            data: {
                group_id: groupId,
                primary_booking_id: primaryBookingId,
                affected_booking_ids: readiness.affectedBookingIds,
                idempotency_key: idempotencyKey || null
            }
        });
        return {
            success: true,
            operation: 'banquet_group_cancel',
            groupId,
            primaryBookingId,
            affectedBookingIds: readiness.affectedBookingIds,
            affectedDates: readiness.affectedDates,
            bookings: cancelledRows,
            primaryBooking: readiness.primaryBooking || primary,
            readiness
        };
    }).then(result => {
        broadcastCancellation(result, user);
        return result;
    });
}

function broadcastCancellation(result = {}, user = {}) {
    const excludeUserId = user?.id == null ? null : String(user.id);
    const businessContext = result.readiness?.primaryBooking?.business_context
        || result.primaryBooking?.business_context
        || DEFAULT_BUSINESS_CONTEXT;
    const primaryBooking = result.primaryBooking || result.readiness?.primaryBooking || result.bookings?.[0] || null;
    for (const booking of result.bookings || []) {
        broadcastBookingEvent('booking:deleted', booking, excludeUserId, { businessContext });
    }
    if (result.groupId && primaryBooking) {
        broadcastBanquetEvent('banquet:booking-set-updated', {
            groupId: result.groupId,
            date: primaryBooking.date || result.affectedDates?.[0],
            businessContext,
            updatedAt: new Date().toISOString(),
            primaryBooking
        }, null, {
            visibilityBooking: primaryBooking,
            extraPayload: {
                groupId: result.groupId,
                affectedBookingIds: result.affectedBookingIds || [],
                affectedDates: result.affectedDates || [],
                primaryBooking,
                operation: result.operation
            }
        });
    }
}

module.exports = {
    BanquetCancellationError,
    cancelBanquetActivity,
    cancelBanquetGroup,
    canonicalReadinessPayload,
    getBookingCancellationReadiness,
    idempotencyKeyFromInput,
    publicBlockerMessage,
    routeRequiredPayload
};
