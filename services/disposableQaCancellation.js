'use strict';

const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');
const {
    DISPOSABLE_QA_SOURCE,
    inspectDisposableQaMarker
} = require('./disposableQa');
const { syncBookingFinanceInTransaction } = require('./bookingFinanceSync');
const { insertHistory } = require('./historyLog');

const QA_CLEANUP_CONFIRMATION = 'CANCEL_DISPOSABLE_QA_BANQUET';
const QA_CLEANUP_ACTOR = 'timeline-browser-smoke-cleanup';
const QA_CLEANUP_HISTORY_ACTION = 'timeline_browser_smoke_qa_cleanup';
const QA_CLEANUP_GROUP_LOCK_NAMESPACE = 'disposable-qa-banquet-cancellation:v1';
const BANQUET_RELATION_TYPE = 'banquet_activity';
const SAFE_PAYMENT_STATUSES = new Set(['', 'pending', 'unpaid']);

class DisposableQaCancellationError extends Error {
    constructor(message, code, details = null) {
        super(message);
        this.name = 'DisposableQaCancellationError';
        this.code = code || 'DISPOSABLE_QA_CANCELLATION_ERROR';
        this.details = details;
    }
}

function contextSql(alias, placeholder) {
    return `CASE
        WHEN LOWER(COALESCE(NULLIF(BTRIM(${alias}.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
             IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_BUSINESS_CONTEXT}'
        ELSE LOWER(COALESCE(NULLIF(BTRIM(${alias}.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}'))
    END = ${placeholder}`;
}

function activeStatusSql(alias) {
    return `LOWER(COALESCE(NULLIF(BTRIM(${alias}.status), ''), 'confirmed')) <> 'cancelled'`;
}

function normalizedBookingIdSet(values = []) {
    return [...new Set(
        (values || []).map(value => String(value || '').trim()).filter(Boolean)
    )].sort();
}

function bookingActive(status) {
    return String(status || 'confirmed').trim().toLowerCase() !== 'cancelled';
}

function qaMarkerInspection(row = {}, options = {}) {
    return inspectDisposableQaMarker(row, {
        runId: options.runId,
        source: options.source || DISPOSABLE_QA_SOURCE,
        testCustomerMarker: options.testCustomerMarker
    }, options.markerClock || {});
}

async function loadQaCleanupGroupRecord(db, options, { forUpdate = false } = {}) {
    const result = await db.query(
        `SELECT bg.id AS group_id,
                bg.business_context AS group_business_context,
                bg.primary_booking_id,
                bg.customer_id AS group_customer_id,
                bg.date AS group_date,
                bg.room AS group_room,
                bg.group_name,
                bg.status AS group_status,
                bg.source AS group_source,
                bg.guest_arrival_time
           FROM banquet_groups bg
          WHERE bg.id = $1
            AND ${contextSql('bg', '$2')}
          ${forUpdate ? 'FOR UPDATE OF bg' : ''}`,
        [options.groupId, options.businessContext]
    );
    return result.rows?.[0] || null;
}

async function loadQaCleanupMemberships(db, options, { forUpdate = false } = {}) {
    const result = await db.query(
        `SELECT bgb.group_id,
                bgb.booking_id,
                bgb.role,
                bgb.sort_order
           FROM banquet_group_bookings bgb
          WHERE bgb.group_id = $1
            AND ${contextSql('bgb', '$2')}
          ORDER BY bgb.sort_order, bgb.booking_id
          ${forUpdate ? 'FOR UPDATE OF bgb' : ''}`,
        [options.groupId, options.businessContext]
    );
    return result.rows || [];
}

function qaCleanupBookingProjectionSql(alias = 'b') {
    return `${alias}.id AS booking_id,
                ${alias}.status AS booking_status,
                ${alias}.linked_to,
                ${alias}.customer_id AS booking_customer_id,
                ${alias}.date AS booking_date,
                ${alias}.time AS booking_time,
                ${alias}.room AS booking_room,
                ${alias}.label AS booking_label,
                ${alias}.program_id,
                ${alias}.program_code,
                ${alias}.category,
                ${alias}.price,
                ${alias}.extra_data,
                ${alias}.certificate_id,
                ${alias}.checkbox_receipt_id,
                ${alias}.paid_amount,
                ${alias}.payment_status,
                EXISTS (
                    SELECT 1
                      FROM customers c
                     WHERE c.id = ${alias}.customer_id
                       AND ${contextSql('c', '$2')}
                       AND POSITION($3 IN COALESCE(c.notes, '')) > 0
                ) AS customer_marker_ok`;
}

async function loadQaCleanupRootBookings(db, options, bookingIds, { forUpdate = false } = {}) {
    const ids = normalizedBookingIdSet(bookingIds);
    if (!ids.length) return [];
    const result = await db.query(
        `SELECT ${qaCleanupBookingProjectionSql('b')}
           FROM bookings b
          WHERE b.id = ANY($1::text[])
            AND ${contextSql('b', '$2')}
          ORDER BY b.id
          ${forUpdate ? 'FOR UPDATE OF b' : ''}`,
        [ids, options.businessContext, options.testCustomerMarker]
    );
    return result.rows || [];
}

async function loadQaCleanupChildBookings(db, options, rootBookingIds, { forUpdate = false } = {}) {
    const ids = normalizedBookingIdSet(rootBookingIds);
    if (!ids.length) return [];
    const result = await db.query(
        `WITH RECURSIVE descendant_ids(id) AS (
            SELECT child.id
              FROM bookings child
             WHERE child.linked_to = ANY($1::text[])
               AND ${contextSql('child', '$2')}
            UNION
            SELECT child.id
              FROM bookings child
              JOIN descendant_ids parent ON child.linked_to = parent.id
             WHERE ${contextSql('child', '$2')}
        )
        SELECT ${qaCleanupBookingProjectionSql('b')}
          FROM bookings b
          JOIN descendant_ids descendants ON descendants.id = b.id
         WHERE ${contextSql('b', '$2')}
         ORDER BY b.id
         ${forUpdate ? 'FOR UPDATE OF b' : ''}`,
        [ids, options.businessContext, options.testCustomerMarker]
    );
    return result.rows || [];
}

async function loadQaCleanupCompatibilityLinks(db, options, bookingIds, { forUpdate = false } = {}) {
    const ids = normalizedBookingIdSet(bookingIds);
    if (!ids.length) return [];
    const result = await db.query(
        `SELECT link.id,
                link.booking_a_id,
                link.booking_b_id,
                link.relation_type
           FROM booking_banquet_links link
          WHERE ${contextSql('link', '$2')}
            AND (link.booking_a_id = ANY($1::text[]) OR link.booking_b_id = ANY($1::text[]))
          ORDER BY link.id
          ${forUpdate ? 'FOR UPDATE OF link' : ''}`,
        [ids, options.businessContext]
    );
    return result.rows || [];
}

async function loadQaCleanupDeposits(db, options, bookingIds, { forUpdate = false } = {}) {
    const ids = normalizedBookingIdSet(bookingIds);
    const result = await db.query(
        `SELECT deposit.id,
                deposit.banquet_group_id,
                deposit.primary_booking_id,
                deposit.finance_transaction_id,
                deposit.status
           FROM banquet_deposits deposit
          WHERE ${contextSql('deposit', '$3')}
            AND (
                deposit.banquet_group_id = $1
                OR deposit.primary_booking_id = ANY($2::text[])
            )
          ORDER BY deposit.id
          ${forUpdate ? 'FOR UPDATE OF deposit' : ''}`,
        [options.groupId, ids, options.businessContext]
    );
    return result.rows || [];
}

async function loadQaCleanupFinanceTransactions(db, options, bookingIds, { forUpdate = false } = {}) {
    const ids = normalizedBookingIdSet(bookingIds);
    if (!ids.length) return [];
    const result = await db.query(
        `SELECT finance.id,
                finance.booking_id,
                finance.certificate_id,
                finance.type,
                finance.amount,
                finance.source
           FROM finance_transactions finance
          WHERE finance.booking_id = ANY($1::text[])
            AND ${contextSql('finance', '$2')}
          ORDER BY finance.id
          ${forUpdate ? 'FOR UPDATE OF finance' : ''}`,
        [ids, options.businessContext]
    );
    return result.rows || [];
}

async function loadQaCleanupReceipts(
    db,
    options,
    bookingIds,
    financeTransactionIds,
    { forUpdate = false } = {}
) {
    const ids = normalizedBookingIdSet(bookingIds);
    const financeIds = [...new Set(
        (financeTransactionIds || []).map(Number).filter(Number.isSafeInteger)
    )].sort((left, right) => left - right);
    if (!ids.length && !financeIds.length) return [];
    const result = await db.query(
        `SELECT receipt.id,
                receipt.booking_id,
                receipt.transaction_id,
                receipt.receipt_number
           FROM receipts receipt
          WHERE ${contextSql('receipt', '$3')}
            AND (
                receipt.booking_id = ANY($1::text[])
                OR receipt.transaction_id = ANY($2::int[])
            )
          ORDER BY receipt.id
          ${forUpdate ? 'FOR UPDATE OF receipt' : ''}`,
        [ids, financeIds, options.businessContext]
    );
    return result.rows || [];
}

async function loadQaCleanupCertificateReferences(db, options, bookingIds) {
    const ids = normalizedBookingIdSet(bookingIds);
    if (!ids.length) return [];
    const result = await db.query(
        `SELECT 'booking'::text AS reference_type,
                b.id::text AS reference_id,
                b.id AS booking_id,
                b.certificate_id
           FROM bookings b
          WHERE b.id = ANY($1::text[])
            AND ${contextSql('b', '$2')}
            AND b.certificate_id IS NOT NULL
          UNION ALL
         SELECT 'finance_transaction'::text AS reference_type,
                finance.id::text AS reference_id,
                finance.booking_id,
                finance.certificate_id
           FROM finance_transactions finance
          WHERE finance.booking_id = ANY($1::text[])
            AND ${contextSql('finance', '$2')}
            AND finance.certificate_id IS NOT NULL
          ORDER BY reference_type, reference_id`,
        [ids, options.businessContext]
    );
    return result.rows || [];
}

async function loadQaCleanupStockDependencies(db, options, bookingIds) {
    const ids = normalizedBookingIdSet(bookingIds);
    if (!ids.length) return [];
    const result = await db.query(
        `SELECT b.id AS booking_id,
                b.program_id,
                COUNT(psr.id)::int AS dependency_count
           FROM bookings b
           JOIN product_stock_requirements psr
             ON psr.product_id::text = b.program_id::text
          WHERE b.id = ANY($1::text[])
            AND ${contextSql('b', '$2')}
          GROUP BY b.id, b.program_id
          ORDER BY b.id`,
        [ids, options.businessContext]
    );
    return result.rows || [];
}

function emptyQaCleanupGroupState() {
    return {
        group: null,
        memberships: [],
        bookings: [],
        children: [],
        compatibilityLinks: [],
        deposits: [],
        financeTransactions: [],
        receipts: [],
        certificateReferences: [],
        stockDependencies: []
    };
}

async function loadQaCleanupGroupState(db, options, { forUpdate = false } = {}) {
    const group = await loadQaCleanupGroupRecord(db, options, { forUpdate });
    if (!group) return emptyQaCleanupGroupState();

    const memberships = await loadQaCleanupMemberships(db, options, { forUpdate });
    const membershipIds = normalizedBookingIdSet(memberships.map(row => row.booking_id));
    const rootBookingIds = normalizedBookingIdSet([
        ...membershipIds,
        group.primary_booking_id
    ]);
    const bookings = await loadQaCleanupRootBookings(db, options, rootBookingIds, { forUpdate });
    const children = await loadQaCleanupChildBookings(db, options, rootBookingIds, { forUpdate });
    const allBookingIds = normalizedBookingIdSet([
        ...rootBookingIds,
        ...children.map(row => row.booking_id)
    ]);

    // Keep lock acquisition deterministic on a single PostgreSQL client.
    const compatibilityLinks = await loadQaCleanupCompatibilityLinks(
        db,
        options,
        allBookingIds,
        { forUpdate }
    );
    const deposits = await loadQaCleanupDeposits(db, options, allBookingIds, { forUpdate });
    // Canonical booking-finance synchronization acquires its advisory identity
    // before row locks. The apply path pre-acquires those same identities, so
    // this inventory read must not invert the lock order with FOR UPDATE.
    const financeTransactions = await loadQaCleanupFinanceTransactions(
        db,
        options,
        allBookingIds,
        { forUpdate: false }
    );
    const receipts = await loadQaCleanupReceipts(
        db,
        options,
        allBookingIds,
        financeTransactions.map(row => row.id),
        { forUpdate }
    );
    const certificateReferences = await loadQaCleanupCertificateReferences(
        db,
        options,
        allBookingIds
    );
    const stockDependencies = await loadQaCleanupStockDependencies(db, options, allBookingIds);

    return {
        group,
        memberships,
        bookings,
        children,
        compatibilityLinks,
        deposits,
        financeTransactions,
        receipts,
        certificateReferences,
        stockDependencies
    };
}

async function loadQaCleanupGroupRows(db, options, lockOptions = {}) {
    return loadQaCleanupGroupState(db, options, lockOptions);
}

function qaCleanupLegacyRowsToState(rows = []) {
    const first = rows[0] || null;
    if (!first) return emptyQaCleanupGroupState();
    const unresolvedChildren = rows.reduce(
        (total, row) => total + Number(row.active_child_booking_count || 0),
        0
    );
    const deposits = Array.from({
        length: Math.max(0, ...rows.map(row => Number(row.active_deposit_count || 0)))
    }, (_, index) => ({ id: `legacy-deposit-${index + 1}` }));
    return {
        group: first,
        memberships: rows.map(row => ({
            group_id: row.group_id,
            booking_id: row.booking_id,
            role: row.role
        })),
        bookings: rows,
        children: [],
        compatibilityLinks: [],
        deposits,
        financeTransactions: [],
        receipts: [],
        certificateReferences: [],
        stockDependencies: [],
        unresolvedChildCount: unresolvedChildren,
        legacyBanquetLinkCount: Math.max(0, ...rows.map(
            row => Number(row.banquet_link_count || 0)
        ))
    };
}

function qaCleanupClassificationStatus(blockerKinds = new Set()) {
    const priority = [
        'unexpected_member',
        'unmarked_child',
        'marker_mismatch',
        'real_customer_blocked',
        'financial_dependencies_present',
        'inconsistent'
    ];
    return priority.find(status => blockerKinds.has(status)) || 'inconsistent';
}

function inspectQaCleanupGroupState(state = {}, options = {}) {
    const group = state.group || null;
    if (!group) {
        return {
            groupId: options.groupId,
            primaryBookingId: options.primaryBookingId || null,
            status: 'not_found',
            reason: 'group_not_found_or_empty',
            blockers: ['group_not_found_or_empty'],
            bookings: [],
            children: [],
            expectedBookingIds: normalizedBookingIdSet(options.expectedBookingIds),
            actualBookingIds: [],
            activeBookingIds: [],
            activeChildBookingCount: 0,
            depositCount: 0,
            activeDepositCount: 0,
            financeTransactionCount: 0,
            removableFinanceTransactionCount: 0,
            blockingFinanceTransactionCount: 0,
            receiptCount: 0,
            paymentReferenceCount: 0,
            certificateReferenceCount: 0,
            stockDependencyCount: 0,
            banquetLinkCount: 0
        };
    }

    const groupStatus = String(group.group_status || 'active').trim().toLowerCase();
    const primaryBookingId = String(group.primary_booking_id || '').trim() || null;
    const blockers = [];
    const blockerKinds = new Set();
    const addBlocker = (kind, detail) => {
        blockerKinds.add(kind);
        blockers.push(detail ? `${kind}:${detail}` : kind);
    };

    if (options.primaryBookingId && primaryBookingId !== String(options.primaryBookingId)) {
        addBlocker('inconsistent', 'primary_booking_id_mismatch');
    }
    if (!primaryBookingId) addBlocker('inconsistent', 'primary_booking_missing');

    const memberships = Array.isArray(state.memberships) ? state.memberships : [];
    const membershipIds = normalizedBookingIdSet(
        memberships.map(row => row.booking_id || row.bookingId)
    );
    if (!memberships.length) addBlocker('inconsistent', 'memberships_missing');
    if (membershipIds.length !== memberships.length) addBlocker('inconsistent', 'duplicate_memberships');
    if (primaryBookingId && !membershipIds.includes(primaryBookingId)) {
        addBlocker('inconsistent', 'primary_booking_membership_missing');
    }

    const projectBooking = (row, recordKind) => {
        const marker = qaMarkerInspection(row, options);
        return {
            bookingId: String(row.booking_id || '').trim(),
            linkedTo: String(row.linked_to || '').trim() || null,
            status: String(row.booking_status || '').trim() || null,
            active: bookingActive(row.booking_status),
            customerMarkerOk: row.customer_marker_ok === true,
            customerId: row.booking_customer_id ?? null,
            certificateId: row.certificate_id ?? null,
            checkboxReceiptId: String(row.checkbox_receipt_id || '').trim() || null,
            paidAmount: Number(row.paid_amount || 0),
            paymentStatus: String(row.payment_status || '').trim().toLowerCase(),
            recordKind,
            marker: marker.marker,
            markerOk: marker.ok,
            markerReasons: marker.reasons
        };
    };

    const bookingRows = Array.isArray(state.bookings) ? state.bookings : [];
    const childRows = Array.isArray(state.children) ? state.children : [];
    const bookings = bookingRows.map(row => {
        const projected = projectBooking(row, 'member');
        const membership = memberships.find(
            item => String(item.booking_id || item.bookingId) === projected.bookingId
        );
        return {
            ...projected,
            role: String(membership?.role || row.role || '').trim() || null
        };
    });
    const children = childRows.map(row => projectBooking(row, 'child'));

    const bookingRowIds = normalizedBookingIdSet(bookings.map(item => item.bookingId));
    const missingMembershipRows = membershipIds.filter(id => !bookingRowIds.includes(id));
    if (missingMembershipRows.length) {
        addBlocker('inconsistent', `membership_booking_missing=${missingMembershipRows.join('+')}`);
    }
    for (const item of bookings) {
        if (!item.markerOk) {
            addBlocker('marker_mismatch', `${item.bookingId}=${item.markerReasons.join('+')}`);
        }
    }
    for (const item of children) {
        if (!item.markerOk) {
            addBlocker('unmarked_child', `${item.bookingId}=${item.markerReasons.join('+')}`);
        }
    }
    if (Number(state.unresolvedChildCount || 0) > 0) {
        addBlocker('unmarked_child', `unresolved=${Number(state.unresolvedChildCount)}`);
    }

    const groupCustomerId = group.group_customer_id ?? null;
    if (!groupCustomerId) addBlocker('real_customer_blocked', 'group_customer_missing');
    for (const item of [...bookings, ...children]) {
        if (!item.customerId) addBlocker('real_customer_blocked', `${item.bookingId}=customer_missing`);
        if (item.customerId && item.customerMarkerOk !== true) {
            addBlocker('real_customer_blocked', `${item.bookingId}=customer_marker_missing`);
        }
        if (
            groupCustomerId
            && item.customerId
            && String(item.customerId) !== String(groupCustomerId)
        ) {
            addBlocker('real_customer_blocked', `${item.bookingId}=group_customer_mismatch`);
        }
    }

    const expectedBookingIds = normalizedBookingIdSet(options.expectedBookingIds);
    if (!expectedBookingIds.length) addBlocker('inconsistent', 'expected_booking_ids_missing');
    const actualBookingIds = normalizedBookingIdSet([
        ...membershipIds,
        ...bookings.map(item => item.bookingId),
        ...children.map(item => item.bookingId)
    ]);
    const unexpectedIds = actualBookingIds.filter(id => !expectedBookingIds.includes(id));
    const missingExpectedIds = expectedBookingIds.filter(id => !actualBookingIds.includes(id));
    if (unexpectedIds.length) addBlocker('unexpected_member', unexpectedIds.join('+'));
    if (missingExpectedIds.length) {
        addBlocker('inconsistent', `expected_booking_missing=${missingExpectedIds.join('+')}`);
    }

    const actualIdSet = new Set(actualBookingIds);
    const compatibilityLinks = Array.isArray(state.compatibilityLinks)
        ? state.compatibilityLinks
        : [];
    for (const link of compatibilityLinks) {
        const a = String(link.booking_a_id || '').trim();
        const b = String(link.booking_b_id || '').trim();
        if (String(link.relation_type || '').trim() !== BANQUET_RELATION_TYPE) {
            addBlocker(
                'inconsistent',
                `unexpected_compatibility_relation=${link.id || `${a}-${b}`}`
            );
        }
        if (!actualIdSet.has(a) || !actualIdSet.has(b)) {
            addBlocker('inconsistent', `external_compatibility_link=${link.id || `${a}-${b}`}`);
        }
    }

    const deposits = Array.isArray(state.deposits) ? state.deposits : [];
    const financeTransactions = Array.isArray(state.financeTransactions)
        ? state.financeTransactions
        : [];
    const receipts = Array.isArray(state.receipts) ? state.receipts : [];
    const certificateReferences = Array.isArray(state.certificateReferences)
        ? state.certificateReferences
        : [];
    const stockDependencies = Array.isArray(state.stockDependencies)
        ? state.stockDependencies
        : [];

    const bookingById = new Map(
        [...bookings, ...children].map(item => [item.bookingId, item])
    );
    const financeRowsByBooking = new Map();
    for (const row of financeTransactions) {
        const bookingId = String(row.booking_id || '').trim();
        const rows = financeRowsByBooking.get(bookingId) || [];
        rows.push(row);
        financeRowsByBooking.set(bookingId, rows);
    }
    const removableFinanceTransactions = [];
    const blockingFinanceTransactions = [];
    for (const [bookingId, rows] of financeRowsByBooking) {
        const booking = bookingById.get(bookingId);
        const singleCanonicalIncome = rows.length === 1
            && Boolean(booking)
            && !booking.linkedTo
            && String(rows[0].type || '').trim().toLowerCase() === 'income'
            && (rows[0].certificate_id === null || rows[0].certificate_id === undefined);
        if (singleCanonicalIncome) removableFinanceTransactions.push(rows[0]);
        else blockingFinanceTransactions.push(...rows);
    }

    const paymentReferenceBookings = [...bookings, ...children].filter(item => (
        Boolean(item.checkboxReceiptId)
        || (Number.isFinite(item.paidAmount) && item.paidAmount > 0)
        || !SAFE_PAYMENT_STATUSES.has(item.paymentStatus)
    ));

    if (deposits.length) addBlocker('financial_dependencies_present', `deposits=${deposits.length}`);
    if (blockingFinanceTransactions.length) {
        addBlocker(
            'financial_dependencies_present',
            `noncanonical_finance_transactions=${blockingFinanceTransactions.length}`
        );
    }
    if (receipts.length) addBlocker('financial_dependencies_present', `receipts=${receipts.length}`);
    if (paymentReferenceBookings.length) {
        addBlocker(
            'financial_dependencies_present',
            `booking_payment_references=${paymentReferenceBookings.length}`
        );
    }
    if (certificateReferences.length) {
        addBlocker(
            'financial_dependencies_present',
            `certificate_references=${certificateReferences.length}`
        );
    }
    if (stockDependencies.length) {
        addBlocker('financial_dependencies_present', `stock_dependencies=${stockDependencies.length}`);
    }

    const allBookings = [...bookings, ...children];
    const activeBookingIds = allBookings.filter(item => item.active).map(item => item.bookingId);
    const allCancelled = allBookings.length > 0 && activeBookingIds.length === 0;
    const allActive = allBookings.length > 0 && activeBookingIds.length === allBookings.length;
    if (!['active', 'cancelled'].includes(groupStatus)) {
        addBlocker('inconsistent', `group_status=${groupStatus}`);
    }
    if (groupStatus === 'active' && !allActive) {
        addBlocker('inconsistent', 'active_group_has_cancelled_booking');
    }
    if (groupStatus === 'cancelled' && !allCancelled) {
        addBlocker('inconsistent', 'cancelled_group_has_active_booking');
    }

    const uniqueBlockers = [...new Set(blockers)];
    const status = uniqueBlockers.length
        ? qaCleanupClassificationStatus(blockerKinds)
        : (groupStatus === 'cancelled' ? 'already_cancelled_clean' : 'ready');
    return {
        groupId: String(group.group_id || options.groupId || '').trim(),
        businessContext: normalizeBusinessContext(
            group.group_business_context || options.businessContext
        ),
        primaryBookingId,
        groupStatus,
        groupSource: String(group.group_source || '').trim() || null,
        date: String(group.group_date || '').slice(0, 10),
        room: String(group.group_room || '').trim() || null,
        guestArrivalTime: String(group.guest_arrival_time || '').trim() || null,
        status,
        reason: uniqueBlockers.join(',') || null,
        blockers: uniqueBlockers,
        bookings,
        children,
        expectedBookingIds,
        actualBookingIds,
        activeBookingIds,
        activeChildBookingCount: children.filter(item => item.active).length
            + Number(state.unresolvedChildCount || 0),
        depositCount: deposits.length,
        activeDepositCount: deposits.length,
        financeTransactionCount: financeTransactions.length,
        removableFinanceTransactionCount: removableFinanceTransactions.length,
        blockingFinanceTransactionCount: blockingFinanceTransactions.length,
        receiptCount: receipts.length,
        paymentReferenceCount: paymentReferenceBookings.length,
        certificateReferenceCount: certificateReferences.length,
        stockDependencyCount: stockDependencies.length,
        banquetLinkCount: compatibilityLinks.length
            || Number(state.legacyBanquetLinkCount || 0)
    };
}

function inspectQaCleanupGroupRows(rowsOrState = [], options = {}) {
    const state = Array.isArray(rowsOrState)
        ? qaCleanupLegacyRowsToState(rowsOrState)
        : (rowsOrState || {});
    return inspectQaCleanupGroupState(state, options);
}

function summarizeQaCleanupGroupInspections(inspections = []) {
    const count = status => inspections.filter(item => item.status === status).length;
    return {
        requested: inspections.length,
        ready: count('ready'),
        alreadyCancelledClean: count('already_cancelled_clean'),
        notFound: count('not_found'),
        markerMismatch: count('marker_mismatch'),
        unexpectedMember: count('unexpected_member'),
        unmarkedChild: count('unmarked_child'),
        realCustomerBlocked: count('real_customer_blocked'),
        financialDependenciesPresent: count('financial_dependencies_present'),
        inconsistent: count('inconsistent'),
        blocked: inspections.filter(
            item => !['ready', 'already_cancelled_clean'].includes(item.status)
        ).length,
        activeBookings: inspections.reduce(
            (total, item) => total + (item.activeBookingIds?.length || 0),
            0
        ),
        activeChildBookings: inspections.reduce(
            (total, item) => total + Number(item.activeChildBookingCount || 0),
            0
        ),
        depositRows: inspections.reduce(
            (total, item) => total + Number(item.depositCount || 0),
            0
        ),
        financeTransactions: inspections.reduce(
            (total, item) => total + Number(item.financeTransactionCount || 0),
            0
        ),
        removableFinanceTransactions: inspections.reduce(
            (total, item) => total + Number(item.removableFinanceTransactionCount || 0),
            0
        ),
        blockingFinanceTransactions: inspections.reduce(
            (total, item) => total + Number(item.blockingFinanceTransactionCount || 0),
            0
        ),
        receipts: inspections.reduce(
            (total, item) => total + Number(item.receiptCount || 0),
            0
        ),
        certificateReferences: inspections.reduce(
            (total, item) => total + Number(item.certificateReferenceCount || 0),
            0
        ),
        stockDependencies: inspections.reduce(
            (total, item) => total + Number(item.stockDependencyCount || 0),
            0
        )
    };
}

async function inspectQaCleanupGroup(db, options, { forUpdate = false } = {}) {
    const state = await loadQaCleanupGroupState(db, options, { forUpdate });
    return inspectQaCleanupGroupState(state, options);
}

async function runQaCleanupGroupDryRun(db, options, dependencies = {}) {
    const inspect = dependencies.inspectQaCleanupGroup || inspectQaCleanupGroup;
    await db.query('BEGIN TRANSACTION READ ONLY');
    try {
        const inspection = await inspect(db, options, { forUpdate: false });
        await db.query('ROLLBACK');
        return {
            mode: 'qa-cleanup-group-dry-run',
            readOnly: true,
            businessContext: options.businessContext,
            runId: options.runId,
            source: options.source,
            testCustomerMarker: options.testCustomerMarker,
            groups: [inspection],
            summary: summarizeQaCleanupGroupInspections([inspection])
        };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

async function lockQaCleanupGroup(db, options) {
    await db.query(
        `SELECT pg_advisory_xact_lock(
            hashtextextended($1::text, 0)
        )`,
        [
            `${QA_CLEANUP_GROUP_LOCK_NAMESPACE}:`
            + `${normalizeBusinessContext(options.businessContext)}:${options.groupId}`
        ]
    );
}

async function lockQaCleanupFinanceIdentities(db, options) {
    for (const bookingId of normalizedBookingIdSet(options.expectedBookingIds)) {
        await db.query(
            `SELECT pg_advisory_xact_lock(
                hashtextextended($1::text, 0)
            )`,
            [
                `booking-finance:${normalizeBusinessContext(options.businessContext)}:${bookingId}`
            ]
        );
    }
}

function assertExactVerifiedBookingSet(inspection, options) {
    const expected = normalizedBookingIdSet(options.expectedBookingIds);
    const actual = normalizedBookingIdSet(inspection.actualBookingIds);
    if (
        !expected.length
        || expected.length !== actual.length
        || expected.some((id, index) => id !== actual[index])
    ) {
        throw new DisposableQaCancellationError(
            'Disposable QA booking set changed after preflight',
            'DISPOSABLE_QA_BOOKING_SET_CHANGED',
            { expectedBookingIds: expected, actualBookingIds: actual }
        );
    }
    return expected;
}

async function cancelExactQaBookingSet(db, inspection, options, dependencies = {}) {
    const syncFinance = dependencies.syncBookingFinanceInTransaction
        || syncBookingFinanceInTransaction;
    const bookingIds = assertExactVerifiedBookingSet(inspection, options);
    const finance = [];

    for (const bookingId of bookingIds) {
        const result = await db.query(
            `UPDATE bookings
                SET status = 'cancelled',
                    updated_at = NOW()
              WHERE id = $1
                AND ${contextSql('bookings', '$2')}
                AND ${activeStatusSql('bookings')}
              RETURNING *`,
            [bookingId, options.businessContext]
        );
        if (result.rowCount !== 1 || !result.rows?.[0]) {
            throw new DisposableQaCancellationError(
                'Disposable QA booking changed while it was being cancelled',
                'DISPOSABLE_QA_BOOKING_CANCEL_CONFLICT',
                { bookingId }
            );
        }
        finance.push(await syncFinance(db, result.rows[0], {
            businessContext: options.businessContext,
            createdBy: QA_CLEANUP_ACTOR,
            optional: false,
            label: 'Disposable QA cancellation finance synchronization'
        }));
    }

    const groupResult = await db.query(
        `UPDATE banquet_groups
            SET status = 'cancelled',
                updated_at = NOW(),
                updated_by = $3
          WHERE id = $1
            AND ${contextSql('banquet_groups', '$2')}
            AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'active')) <> 'cancelled'
          RETURNING id`,
        [inspection.groupId, options.businessContext, QA_CLEANUP_ACTOR]
    );
    if (groupResult.rowCount !== 1) {
        throw new DisposableQaCancellationError(
            'Disposable QA banquet group changed while it was being cancelled',
            'DISPOSABLE_QA_GROUP_CANCEL_CONFLICT',
            { groupId: inspection.groupId }
        );
    }

    return {
        groupId: inspection.groupId,
        status: 'cancelled',
        bookingIds,
        cancelledBookings: bookingIds.length,
        cancelledGroups: 1,
        finance
    };
}

async function writeQaCleanupHistory(db, before, after, cleanup, options) {
    await insertHistory(db, {
        businessContext: options.businessContext,
        action: QA_CLEANUP_HISTORY_ACTION,
        username: QA_CLEANUP_ACTOR,
        data: {
            group_id: before.groupId,
            booking_ids: cleanup.bookingIds,
            run_id: options.runId,
            source: options.source,
            before: {
                status: before.status,
                blockers: before.blockers
            },
            after: {
                status: after.status,
                blockers: after.blockers
            }
        }
    });
}

async function runQaCleanupApply(db, options, dependencies = {}) {
    if (!options.apply || options.confirmation !== QA_CLEANUP_CONFIRMATION) {
        throw new DisposableQaCancellationError(
            `QA cleanup apply requires --apply --confirm=${QA_CLEANUP_CONFIRMATION}`,
            'DISPOSABLE_QA_CONFIRMATION_REQUIRED'
        );
    }
    if (options.mode !== 'marker') {
        throw new DisposableQaCancellationError(
            'QA cleanup apply requires --run-id and --group-id disposable marker scope',
            'DISPOSABLE_QA_MARKER_SCOPE_REQUIRED'
        );
    }

    const inspect = dependencies.inspectQaCleanupGroup || inspectQaCleanupGroup;
    const cancelExact = dependencies.cancelExactQaBookingSet || cancelExactQaBookingSet;
    const writeHistory = dependencies.writeQaCleanupHistory || writeQaCleanupHistory;

    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
        await lockQaCleanupGroup(db, options);
        await lockQaCleanupFinanceIdentities(db, options);
        const before = await inspect(db, options, { forUpdate: true });
        if (!['ready', 'already_cancelled_clean'].includes(before.status)) {
            throw new DisposableQaCancellationError(
                `QA cleanup blocked by preflight: ${before.reason || before.status}`,
                'DISPOSABLE_QA_PREFLIGHT_BLOCKED',
                { status: before.status, blockers: before.blockers }
            );
        }

        if (before.status === 'already_cancelled_clean') {
            await db.query('COMMIT');
            return {
                mode: 'qa-cleanup-apply',
                readOnly: false,
                businessContext: options.businessContext,
                runId: options.runId,
                source: options.source,
                testCustomerMarker: options.testCustomerMarker,
                before: [before],
                cleanup: [{
                    groupId: before.groupId,
                    status: 'already_cancelled_clean',
                    bookingIds: before.actualBookingIds,
                    cancelledBookings: 0,
                    cancelledGroups: 0,
                    finance: []
                }],
                after: [before],
                summary: {
                    ...summarizeQaCleanupGroupInspections([before]),
                    cancelledBookings: 0,
                    cancelledGroups: 0,
                    verifiedAfter: 1
                }
            };
        }

        const cleanup = await cancelExact(db, before, options, dependencies);
        const after = await inspect(db, options, { forUpdate: false });
        if (after.status !== 'already_cancelled_clean') {
            throw new DisposableQaCancellationError(
                `Post-cleanup verification failed: ${after.reason || after.status}`,
                'DISPOSABLE_QA_POSTCHECK_FAILED',
                { status: after.status, blockers: after.blockers }
            );
        }
        await writeHistory(db, before, after, cleanup, options);
        await db.query('COMMIT');

        return {
            mode: 'qa-cleanup-apply',
            readOnly: false,
            businessContext: options.businessContext,
            runId: options.runId,
            source: options.source,
            testCustomerMarker: options.testCustomerMarker,
            before: [before],
            cleanup: [cleanup],
            after: [after],
            summary: {
                ...summarizeQaCleanupGroupInspections([before]),
                cancelledBookings: cleanup.cancelledBookings,
                cancelledGroups: cleanup.cancelledGroups,
                verifiedAfter: 1
            }
        };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    }
}

module.exports = {
    BANQUET_RELATION_TYPE,
    DisposableQaCancellationError,
    QA_CLEANUP_ACTOR,
    QA_CLEANUP_CONFIRMATION,
    QA_CLEANUP_GROUP_LOCK_NAMESPACE,
    QA_CLEANUP_HISTORY_ACTION,
    assertExactVerifiedBookingSet,
    cancelExactQaBookingSet,
    inspectQaCleanupGroup,
    inspectQaCleanupGroupRows,
    inspectQaCleanupGroupState,
    loadQaCleanupCertificateReferences,
    loadQaCleanupChildBookings,
    loadQaCleanupCompatibilityLinks,
    loadQaCleanupDeposits,
    loadQaCleanupFinanceTransactions,
    loadQaCleanupGroupRecord,
    loadQaCleanupGroupRows,
    loadQaCleanupGroupState,
    loadQaCleanupMemberships,
    loadQaCleanupReceipts,
    loadQaCleanupRootBookings,
    loadQaCleanupStockDependencies,
    lockQaCleanupGroup,
    lockQaCleanupFinanceIdentities,
    normalizedBookingIdSet,
    runQaCleanupApply,
    runQaCleanupGroupDryRun,
    summarizeQaCleanupGroupInspections,
    writeQaCleanupHistory
};
