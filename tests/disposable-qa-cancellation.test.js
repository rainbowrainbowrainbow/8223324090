'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    QA_CLEANUP_CONFIRMATION,
    cancelExactQaBookingSet,
    inspectQaCleanupGroupState,
    runQaCleanupApply
} = require('../services/disposableQaCancellation');

const RUN_ID = 'task37-cancellation';
const CUSTOMER_MARKER = `timeline_browser_smoke:${RUN_ID}:test_customer`;
const NOW_MS = Date.parse('2099-08-20T12:00:00.000Z');
const OPTIONS = {
    mode: 'marker',
    apply: true,
    confirmation: QA_CLEANUP_CONFIRMATION,
    businessContext: 'event_genix',
    runId: RUN_ID,
    groupId: 'BQ-QA-CANCEL',
    primaryBookingId: 'BK-QA-PRIMARY',
    expectedBookingIds: ['BK-QA-PRIMARY'],
    source: 'timeline_browser_smoke',
    testCustomerMarker: CUSTOMER_MARKER,
    markerClock: { nowMs: NOW_MS }
};

function marker(kind = 'banquet_member') {
    return {
        disposableQa: {
            schemaVersion: 1,
            runId: RUN_ID,
            source: 'timeline_browser_smoke',
            cleanupExpected: true,
            testCustomerMarker: CUSTOMER_MARKER,
            kind,
            createdAt: '2099-08-20T11:00:00.000Z'
        }
    };
}

function bookingRow(overrides = {}) {
    return {
        booking_id: 'BK-QA-PRIMARY',
        booking_status: 'confirmed',
        linked_to: null,
        booking_customer_id: 9001,
        booking_date: '2099-08-20',
        booking_time: '13:00',
        booking_room: 'Room QA',
        booking_label: 'QA booking',
        program_id: 'QA',
        program_code: 'QA',
        category: 'animation',
        price: 350,
        extra_data: marker(),
        certificate_id: null,
        checkbox_receipt_id: null,
        paid_amount: 0,
        payment_status: 'pending',
        customer_marker_ok: true,
        ...overrides
    };
}

function groupState(overrides = {}) {
    return {
        group: {
            group_id: 'BQ-QA-CANCEL',
            group_business_context: 'event_genix',
            primary_booking_id: 'BK-QA-PRIMARY',
            group_customer_id: 9001,
            group_date: '2099-08-20',
            group_room: 'Room QA',
            group_status: 'active',
            group_source: 'timeline_browser_smoke'
        },
        memberships: [{
            group_id: 'BQ-QA-CANCEL',
            booking_id: 'BK-QA-PRIMARY',
            role: 'primary',
            sort_order: 10
        }],
        bookings: [bookingRow()],
        children: [],
        compatibilityLinks: [],
        deposits: [],
        financeTransactions: [],
        receipts: [],
        certificateReferences: [],
        stockDependencies: [],
        ...overrides
    };
}

test('preflight allows one canonical booking income for strict finance synchronization', () => {
    const inspection = inspectQaCleanupGroupState(groupState({
        financeTransactions: [{
            id: 71,
            booking_id: 'BK-QA-PRIMARY',
            type: 'income',
            certificate_id: null,
            amount: 350
        }]
    }), OPTIONS);

    assert.equal(inspection.status, 'ready');
    assert.equal(inspection.financeTransactionCount, 1);
    assert.equal(inspection.removableFinanceTransactionCount, 1);
    assert.equal(inspection.blockingFinanceTransactionCount, 0);
});

test('preflight exposes sanitized compatibility link scope when cleanup blocks', () => {
    const inspection = inspectQaCleanupGroupState(groupState({
        compatibilityLinks: [{
            id: 205,
            booking_a_id: 'BK-QA-PRIMARY',
            booking_b_id: 'BK-EXTERNAL',
            relation_type: 'shared_room_activity',
            label: 'must not leak into operator report'
        }]
    }), OPTIONS);

    assert.equal(inspection.status, 'inconsistent');
    assert.deepEqual(inspection.compatibilityLinks, [{
        id: 205,
        bookingAId: 'BK-QA-PRIMARY',
        bookingBId: 'BK-EXTERNAL',
        relationType: 'shared_room_activity'
    }]);
    assert.equal(JSON.stringify(inspection).includes('must not leak'), false);
});

test('preflight blocks deposits, receipts, payment references, and noncanonical finance', () => {
    const inspection = inspectQaCleanupGroupState(groupState({
        bookings: [bookingRow({ paid_amount: 100, payment_status: 'paid' })],
        deposits: [{ id: 1 }],
        financeTransactions: [
            {
                id: 71,
                booking_id: 'BK-QA-PRIMARY',
                type: 'income',
                certificate_id: null
            },
            {
                id: 72,
                booking_id: 'BK-QA-PRIMARY',
                type: 'expense',
                certificate_id: null
            }
        ],
        receipts: [{ id: 81, booking_id: 'BK-QA-PRIMARY', transaction_id: 71 }]
    }), OPTIONS);

    assert.equal(inspection.status, 'financial_dependencies_present');
    assert.equal(inspection.depositCount, 1);
    assert.equal(inspection.receiptCount, 1);
    assert.equal(inspection.paymentReferenceCount, 1);
    assert.equal(inspection.blockingFinanceTransactionCount, 2);
});

test('exact cancellation updates only verified ids and synchronizes finance before group status', async () => {
    const sql = [];
    const financeBookingIds = [];
    const inspection = inspectQaCleanupGroupState(groupState(), OPTIONS);
    const db = {
        query: async (text, params = []) => {
            const normalized = String(text).replace(/\s+/g, ' ').trim();
            sql.push(normalized);
            if (/^UPDATE bookings/i.test(normalized)) {
                return {
                    rowCount: 1,
                    rows: [{
                        id: params[0],
                        business_context: 'event_genix',
                        status: 'cancelled',
                        linked_to: null,
                        price: 350,
                        date: '2099-08-20',
                        label: 'QA booking'
                    }]
                };
            }
            if (/^UPDATE banquet_groups/i.test(normalized)) {
                return { rowCount: 1, rows: [{ id: 'BQ-QA-CANCEL' }] };
            }
            return { rowCount: 0, rows: [] };
        }
    };

    const result = await cancelExactQaBookingSet(db, inspection, OPTIONS, {
        syncBookingFinanceInTransaction: async (_db, booking, options) => {
            financeBookingIds.push(booking.id);
            assert.equal(options.optional, false);
            return { action: 'deleted', bookingId: booking.id };
        }
    });

    assert.deepEqual(result.bookingIds, ['BK-QA-PRIMARY']);
    assert.deepEqual(financeBookingIds, ['BK-QA-PRIMARY']);
    assert.equal(sql.filter(query => /^UPDATE bookings/i.test(query)).length, 1);
    assert.match(sql.find(query => /^UPDATE bookings/i.test(query)), /WHERE id = \$1/);
    assert.doesNotMatch(sql.find(query => /^UPDATE bookings/i.test(query)), /linked_to\s*=/i);
    assert.equal(
        sql.findIndex(query => /^UPDATE banquet_groups/i.test(query))
            > sql.findIndex(query => /^UPDATE bookings/i.test(query)),
        true
    );
});

test('transaction applies advisory lock, verifies after mutation, and writes one audit event', async () => {
    const queries = [];
    const ready = inspectQaCleanupGroupState(groupState(), OPTIONS);
    const cancelled = inspectQaCleanupGroupState(groupState({
        group: { ...groupState().group, group_status: 'cancelled' },
        bookings: [bookingRow({ booking_status: 'cancelled' })]
    }), OPTIONS);
    let inspections = 0;
    let historyWrites = 0;

    const report = await runQaCleanupApply({
        query: async text => {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [], rowCount: 0 };
        }
    }, OPTIONS, {
        inspectQaCleanupGroup: async (_db, _options, lockOptions) => {
            inspections += 1;
            if (inspections === 1) assert.equal(lockOptions.forUpdate, true);
            return inspections === 1 ? ready : cancelled;
        },
        cancelExactQaBookingSet: async () => ({
            groupId: ready.groupId,
            status: 'cancelled',
            bookingIds: ready.actualBookingIds,
            cancelledBookings: 1,
            cancelledGroups: 1,
            finance: [{ action: 'deleted' }]
        }),
        writeQaCleanupHistory: async (_db, before, after, cleanup) => {
            historyWrites += 1;
            assert.equal(before.status, 'ready');
            assert.equal(after.status, 'already_cancelled_clean');
            assert.deepEqual(cleanup.bookingIds, ['BK-QA-PRIMARY']);
        }
    });

    assert.equal(report.after[0].status, 'already_cancelled_clean');
    assert.equal(historyWrites, 1);
    assert.equal(queries[0], 'BEGIN ISOLATION LEVEL SERIALIZABLE');
    assert.match(queries[1], /pg_advisory_xact_lock/);
    assert.equal(queries.at(-1), 'COMMIT');
});

test('partial failure rolls back and repeated clean apply is a no-op', async () => {
    const ready = inspectQaCleanupGroupState(groupState(), OPTIONS);
    const cancelled = inspectQaCleanupGroupState(groupState({
        group: { ...groupState().group, group_status: 'cancelled' },
        bookings: [bookingRow({ booking_status: 'cancelled' })]
    }), OPTIONS);
    const failedQueries = [];
    let historyWrites = 0;

    await assert.rejects(
        runQaCleanupApply({
            query: async text => {
                failedQueries.push(String(text).replace(/\s+/g, ' ').trim());
                return { rows: [], rowCount: 0 };
            }
        }, OPTIONS, {
            inspectQaCleanupGroup: async () => ready,
            cancelExactQaBookingSet: async () => {
                throw new Error('simulated finance failure');
            },
            writeQaCleanupHistory: async () => {
                historyWrites += 1;
            }
        }),
        /simulated finance failure/
    );
    assert.equal(failedQueries.at(-1), 'ROLLBACK');
    assert.equal(failedQueries.includes('COMMIT'), false);
    assert.equal(historyWrites, 0);

    const noOpQueries = [];
    const rerun = await runQaCleanupApply({
        query: async text => {
            noOpQueries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [], rowCount: 0 };
        }
    }, OPTIONS, {
        inspectQaCleanupGroup: async () => cancelled,
        cancelExactQaBookingSet: async () => {
            throw new Error('no-op must not mutate');
        },
        writeQaCleanupHistory: async () => {
            throw new Error('no-op must not write history');
        }
    });
    assert.equal(rerun.summary.cancelledBookings, 0);
    assert.equal(rerun.after[0].status, 'already_cancelled_clean');
    assert.equal(noOpQueries.at(-1), 'COMMIT');
});

test('apply confirmation and marker scope guards reject before opening a transaction', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text));
            return { rows: [], rowCount: 0 };
        }
    };

    await assert.rejects(
        runQaCleanupApply(db, {
            ...OPTIONS,
            confirmation: 'WRONG_CONFIRMATION'
        }),
        error => error?.code === 'DISPOSABLE_QA_CONFIRMATION_REQUIRED'
    );
    await assert.rejects(
        runQaCleanupApply(db, {
            ...OPTIONS,
            mode: 'legacy'
        }),
        error => error?.code === 'DISPOSABLE_QA_MARKER_SCOPE_REQUIRED'
    );
    assert.deepEqual(queries, []);
});

test('preflight fails closed for wrong run id and wrong group id', () => {
    const wrongRun = inspectQaCleanupGroupState(groupState(), {
        ...OPTIONS,
        runId: 'task37-wrong-run'
    });
    assert.equal(wrongRun.status, 'marker_mismatch');
    assert.match(wrongRun.reason, /run_id_mismatch/);

    const wrongGroup = inspectQaCleanupGroupState({ group: null }, {
        ...OPTIONS,
        groupId: 'BQ-QA-WRONG'
    });
    assert.equal(wrongGroup.status, 'not_found');
    assert.equal(wrongGroup.groupId, 'BQ-QA-WRONG');
    assert.deepEqual(wrongGroup.activeBookingIds, []);
});

test('operator CLI delegates cancellation and contains no direct broad cancellation SQL', () => {
    const cli = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'banquet-production-recovery.js'),
        'utf8'
    );
    assert.match(cli, /qaCancellationService\.runQaCleanupApply/);
    assert.doesNotMatch(
        cli,
        /UPDATE bookings[\s\S]{0,500}linked_to\s*=\s*ANY\([\s\S]{0,200}status\s*=\s*'cancelled'/i
    );
    assert.doesNotMatch(cli, /bookings\.status\.status/);
});
