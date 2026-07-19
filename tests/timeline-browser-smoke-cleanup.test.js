'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const smoke = require('./browser/timeline-browser-smoke');

const ROOT = path.join(__dirname, '..');
const SMOKE_PATH = path.join(ROOT, 'tests', 'browser', 'timeline-browser-smoke.js');

function markedBooking(id, kind = 'banquet_member') {
    const pathname = kind === 'banquet_activity'
        ? '/api/banquets/from-source/activity-booking'
        : '/api/banquets/from-source/member-booking';
    const key = kind === 'banquet_activity' ? 'activityBooking' : 'booking';
    return smoke.markCreateRequestPayload({
        role: kind === 'banquet_activity' ? 'activity' : 'kitchen',
        [key]: { id, extraData: { preserved: true } }
    }, pathname)[key];
}

function snapshotOf(bookings, { groupId = 'BQ-SMOKE', status = 'active' } = {}) {
    return {
        groupId,
        group: {
            id: groupId,
            status,
            primaryBookingId: bookings[0]?.id || null
        },
        members: bookings.map((booking, index) => ({
            bookingId: booking.id,
            booking,
            isPrimary: index === 0,
            technicalChildren: []
        }))
    };
}

test('timeline smoke marker interceptor is restricted to booking create endpoints', () => {
    const allowed = [
        '/api/bookings',
        '/api/bookings/full',
        '/api/banquets/from-source/member-booking',
        '/api/banquets/from-source/activity-booking',
        '/api/banquets/BQ-1/member-booking',
        '/api/banquets/BQ-1/activity-booking'
    ];
    for (const pathname of allowed) {
        assert.equal(smoke.isBookingCreateEndpoint(pathname), true, pathname);
        assert.equal(smoke.BOOKING_CREATE_ROUTE_PATTERN.test(`https://crm.test${pathname}?businessContext=event_genix`), true);
    }
    for (const pathname of ['/api/customers', '/api/bookings/BK-1', '/api/finance/transactions']) {
        assert.equal(smoke.isBookingCreateEndpoint(pathname), false, pathname);
        assert.equal(smoke.BOOKING_CREATE_ROUTE_PATTERN.test(`https://crm.test${pathname}`), false);
    }
});

test('timeline smoke marker builder covers root, members, activity, service and linked children', () => {
    const source = {
        role: 'service',
        main: { id: 'BK-MAIN' },
        rootBooking: { id: 'BK-ROOT' },
        booking: { id: 'BK-SERVICE' },
        activityBooking: { id: 'BK-ACTIVITY' },
        linked: [{ id: 'BK-LINKED-A' }],
        linkedBookings: [{ id: 'BK-LINKED-B' }],
        linked_bookings: [{ id: 'BK-LINKED-C' }],
        activities: [{ id: 'BK-ACTIVITY-B' }]
    };
    const marked = smoke.markCreateRequestPayload(
        source,
        '/api/banquets/BQ-1/member-booking'
    );
    assert.equal(source.main.extraData, undefined, 'input payload is not mutated');

    const records = [
        marked.main,
        marked.rootBooking,
        marked.booking,
        marked.activityBooking,
        ...marked.linked,
        ...marked.linkedBookings,
        ...marked.linked_bookings,
        ...marked.activities
    ];
    assert.ok(records.every(record => record.extraData?.disposableQa?.cleanupExpected === true));
    assert.ok(records.every(record => record.extraData.disposableQa.runId));
    assert.ok(records.every(record => record.extraData.disposableQa.createdAt));
    assert.equal(marked.booking.extraData.disposableQa.kind, 'banquet_service');
    assert.equal(marked.activityBooking.extraData.disposableQa.kind, 'banquet_activity');
    assert.ok([
        marked.linked[0],
        marked.linkedBookings[0],
        marked.linked_bookings[0]
    ].every(record => record.extraData.disposableQa.kind === 'linked_technical_child'));
});

test('timeline smoke records every root, linked child and multi-activity response id', () => {
    assert.deepEqual(smoke.bookingCreateResult({
        success: true,
        mainBooking: { id: 'BK-ROOT' },
        linkedBookings: [{ id: 'BK-LINKED-B' }, { id: 'BK-LINKED-A' }],
        activityBookings: [{ id: 'BK-ACTIVITY-B' }, { id: 'BK-ACTIVITY-A' }]
    }).bookingIds, [
        'BK-ACTIVITY-A',
        'BK-ACTIVITY-B',
        'BK-LINKED-A',
        'BK-LINKED-B',
        'BK-ROOT'
    ]);
});

test('persisted snapshot verification requires the exact marked booking set', () => {
    const root = markedBooking('BK-ROOT');
    const activity = markedBooking('BK-ACTIVITY', 'banquet_activity');
    const snapshot = snapshotOf([root, activity]);
    const inventory = smoke.assertPersistedDisposableBookingSet(
        snapshot,
        ['BK-ACTIVITY', 'BK-ROOT'],
        'unit snapshot'
    );
    assert.deepEqual(inventory.bookingIds, ['BK-ACTIVITY', 'BK-ROOT']);

    const unmarkedUnexpected = { id: 'BK-REAL', extraData: {} };
    assert.throws(
        () => smoke.assertPersistedDisposableBookingSet(
            snapshotOf([root, activity, unmarkedUnexpected]),
            ['BK-ACTIVITY', 'BK-REAL', 'BK-ROOT'],
            'unexpected member'
        ),
        /persisted disposable marker is valid/
    );
    assert.throws(
        () => smoke.assertPersistedDisposableBookingSet(
            snapshot,
            ['BK-ROOT'],
            'missing expected member'
        ),
        /persisted booking ID set is exact/
    );
});

test('cleanup dry-run assertion requires matching expected and actual booking sets', () => {
    const target = { groupId: 'BQ-SMOKE', bookingIds: ['BK-A', 'BK-B'] };
    const report = {
        mode: 'qa-cleanup-group-dry-run',
        groups: [{
            groupId: 'BQ-SMOKE',
            status: 'ready',
            expectedBookingIds: ['BK-B', 'BK-A'],
            actualBookingIds: ['BK-A', 'BK-B']
        }]
    };
    assert.equal(smoke.assertQaCleanupDryRunReady(report, target).status, 'ready');

    assert.throws(
        () => smoke.assertQaCleanupDryRunReady({
            ...report,
            groups: [{
                ...report.groups[0],
                status: 'unexpected_member',
                actualBookingIds: ['BK-A', 'BK-B', 'BK-REAL']
            }]
        }, target),
        /actual booking set/
    );
});

test('cleanup apply assertion proves cancellation, finance cleanup and repeated no-op', () => {
    const target = { groupId: 'BQ-SMOKE', bookingIds: ['BK-A', 'BK-B'] };
    const report = {
        mode: 'qa-cleanup-apply',
        after: [{
            groupId: 'BQ-SMOKE',
            groupStatus: 'cancelled',
            status: 'already_cancelled_clean',
            actualBookingIds: ['BK-A', 'BK-B'],
            activeBookingIds: [],
            financeTransactionCount: 0
        }],
        cleanup: [{ status: 'already_cancelled_clean' }],
        summary: { cancelledBookings: 0, cancelledGroups: 0 }
    };
    assert.equal(
        smoke.assertQaCleanupApplyVerified(report, target, { expectNoop: true }).status,
        'already_cancelled_clean'
    );
    assert.throws(
        () => smoke.assertQaCleanupApplyVerified({
            ...report,
            after: [{ ...report.after[0], financeTransactionCount: 1 }]
        }, target),
        /removes finance rows/
    );
});

test('aggregate failure output preserves both scenario and cleanup causes', () => {
    const scenario = new Error('room marker wait failed for BK-QA');
    const cleanup = new Error('guarded cleanup preflight blocked');
    const output = smoke.formatErrorForOutput(new AggregateError(
        [scenario, cleanup],
        'scenario and cleanup failed'
    ));

    assert.match(output, /scenario and cleanup failed/);
    assert.match(output, /room marker wait failed for BK-QA/);
    assert.match(output, /guarded cleanup preflight blocked/);
});

test('cleanup diagnostics retain only allowlisted technical classification fields', () => {
    assert.deepEqual(smoke.safeCleanupClassification({
        status: 'marker_mismatch',
        blockers: [
            'marker_mismatch:BK-1=run_id_mismatch',
            'customer name: Sensitive Person',
            'authorization=Bearer secret/value'
        ],
        financeTransactionCount: 2,
        receiptCount: 1,
        ignoredCustomer: { phone: '+380000000000' }
    }), {
        status: 'marker_mismatch',
        blockers: ['marker_mismatch:BK-1=run_id_mismatch'],
        financeTransactionCount: 2,
        receiptCount: 1,
        certificateReferenceCount: 0,
        stockDependencyCount: 0
    });
});

test('timeline smoke source keeps cleanup fail-closed and does not alter protected renderers', () => {
    const source = fs.readFileSync(SMOKE_PATH, 'utf8');
    assert.doesNotMatch(source, /context\.route\(['"]\*\*\/api\/\*\*/);
    assert.doesNotMatch(source, /Timeline smoke cleanup failed after scenario failure/);
    assert.match(source, /new AggregateError\(/);
    assert.match(source, /const repeatedApply = runQaCleanupOperator\(applyArgs\)/);
    assert.match(source, /await verifyCancelledBanquetSnapshot\(/);
    assert.doesNotMatch(source, /showBookingDetails\s*=\s*|bookingDetails\.innerHTML|bookingModal\.innerHTML/);
});
