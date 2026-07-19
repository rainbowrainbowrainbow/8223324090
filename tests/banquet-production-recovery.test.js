'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    APPLY_CONFIRMATION,
    DETACH_CONFIRMATION,
    QA_CLEANUP_CONFIRMATION,
    RECONCILE_GROUP_STATE_CONFIRMATION,
    buildAuditReport,
    buildAuditSummaryOnlyReport,
    classifyDetachInspection,
    classifyReconcileGroupStateTarget,
    classifyRecoveryInspection,
    inspectQaCleanupGroupRows,
    loadQaCleanupGroupState,
    loadQaCleanupRootBookings,
    parseArgs,
    parseRecoveryPairs,
    printAuditSummaryOnlyReport,
    persistDetachPair,
    persistRecoveryPair,
    runAudit,
    runDetachApply,
    runDetachDryRun,
    runQaCleanupApply,
    runQaCleanupDryRun,
    runReconcileGroupStateApply,
    runReconcileGroupStateDryRun,
    runRecoveryApply,
    runRecoveryDryRun
} = require('../scripts/banquet-production-recovery');

const ROOT = path.resolve(__dirname, '..');

function recoveryTarget(overrides = {}) {
    return {
        pinata_booking_id: 'BK-PINATA-1',
        pinata_business_context: 'event_genix',
        pinata_date: '2099-08-20',
        pinata_room: 'Room A',
        pinata_customer_id: 701,
        pinata_category: 'pinata',
        pinata_program_id: 'pinata',
        pinata_program_code: 'PIN',
        pinata_status: 'confirmed',
        pinata_linked_to: null,
        group_id: 'BQ-1',
        group_status: 'active',
        group_name: 'Test banquet',
        primary_booking_id: 'BK-PRIMARY-1',
        primary_date: '2099-08-20',
        primary_room: 'Room A',
        primary_customer_id: 701,
        primary_status: 'confirmed',
        ...overrides
    };
}

function detachInspectionState(overrides = {}) {
    const target = recoveryTarget(overrides.target || {});
    return {
        memberships: Object.prototype.hasOwnProperty.call(overrides, 'memberships')
            ? overrides.memberships
            : [{
                group_id: target.group_id,
                booking_id: target.pinata_booking_id,
                role: 'activity'
            }],
        group: Object.prototype.hasOwnProperty.call(overrides, 'group')
            ? overrides.group
            : {
                group_id: target.group_id,
                business_context: 'event_genix',
                status: target.group_status,
                group_name: target.group_name,
                primary_booking_id: target.primary_booking_id
            },
        pinataBooking: Object.prototype.hasOwnProperty.call(overrides, 'pinataBooking')
            ? overrides.pinataBooking
            : {
                booking_id: target.pinata_booking_id,
                business_context: target.pinata_business_context,
                date: target.pinata_date,
                room: target.pinata_room,
                customer_id: target.pinata_customer_id,
                category: target.pinata_category,
                program_id: target.pinata_program_id,
                program_code: target.pinata_program_code,
                status: target.pinata_status,
                linked_to: target.pinata_linked_to
            },
        primaryBooking: Object.prototype.hasOwnProperty.call(overrides, 'primaryBooking')
            ? overrides.primaryBooking
            : {
                booking_id: target.primary_booking_id,
                business_context: 'event_genix',
                date: target.primary_date,
                room: target.primary_room,
                customer_id: target.primary_customer_id,
                category: 'show',
                program_id: 'paper-show',
                program_code: 'PAPER',
                status: target.primary_status,
                linked_to: null
            },
        compatibilityLinks: Object.prototype.hasOwnProperty.call(overrides, 'compatibilityLinks')
            ? overrides.compatibilityLinks
            : [{
                id: 91,
                booking_a_id: target.primary_booking_id,
                booking_b_id: target.pinata_booking_id,
                relation_type: 'banquet_activity'
            }]
    };
}

test('banquet recovery audit separates exact, ambiguous, standalone, deposit-review, and integrity rows without customer data', () => {
    const options = {
        businessContext: 'event_genix',
        from: '2099-08-01',
        to: '2099-08-31'
    };
    const pinataRows = [
        {
            pinata_booking_id: 'BK-EXACT',
            business_context: 'event_genix',
            date: '2099-08-20',
            room: 'Room A',
            customer_id: 701,
            candidate_group_id: 'BQ-EXACT'
        },
        {
            pinata_booking_id: 'BK-AMBIGUOUS',
            business_context: 'event_genix',
            date: '2099-08-21',
            room: 'Room B',
            customer_id: 702,
            candidate_group_id: 'BQ-A'
        },
        {
            pinata_booking_id: 'BK-AMBIGUOUS',
            business_context: 'event_genix',
            date: '2099-08-21',
            room: 'Room B',
            customer_id: 702,
            candidate_group_id: 'BQ-B'
        },
        {
            pinata_booking_id: 'BK-STANDALONE',
            business_context: 'event_genix',
            date: '2099-08-22',
            room: 'Room C',
            customer_id: 703,
            candidate_group_id: null
        }
    ];
    const depositRows = [{
        group_id: 'BQ-NO-DEPOSIT',
        primary_booking_id: 'BK-PRIMARY-NO-DEPOSIT',
        business_context: 'event_genix',
        date: '2099-08-23',
        room: 'Room D',
        customer_id: 704
    }];
    const integrityRows = [{
        pinata_booking_id: 'BK-BROKEN',
        group_ids: ['BQ-X', 'BQ-Y'],
        membership_count: 2,
        role_mismatch: true,
        exact_key_mismatch: false
    }];

    const report = buildAuditReport(pinataRows, depositRows, integrityRows, options);

    assert.equal(report.readOnly, true);
    assert.deepEqual(report.summary, {
        ungroupedPinatas: 3,
        exactMatchPinatas: 1,
        ambiguousPinatas: 1,
        standalonePinatas: 1,
        groupsMissingCanonicalDeposit: 1,
        pinataIntegrityIssues: 1,
        groupStateIntegrityIssues: 0
    });
    assert.equal(report.pinatas.exactMatches[0].candidateGroupId, 'BQ-EXACT');
    assert.deepEqual(report.pinatas.ambiguous[0].candidateGroupIds, ['BQ-A', 'BQ-B']);
    assert.equal(report.pinatas.standalone[0].pinataBookingId, 'BK-STANDALONE');
    assert.equal(report.depositsForManualReview[0].reason, 'canonical_deposit_missing_manual_review_required');
    assert.deepEqual(report.integrityIssues[0].groupIds, ['BQ-X', 'BQ-Y']);
    assert.equal(JSON.stringify(report).includes('customerId'), false);
    assert.equal(JSON.stringify(report).includes('customer_id'), false);
});

test('banquet recovery audit reports active group with cancelled primary as state integrity, not deposit review', () => {
    const options = {
        businessContext: 'event_genix',
        from: '2099-08-01',
        to: '2099-08-31'
    };
    const groupStateRows = [
        {
            group_id: 'BQ-CANCELLED-PRIMARY',
            primary_booking_id: 'BK-PRIMARY-CANCELLED',
            business_context: 'event_genix',
            date: '2099-08-24',
            room: 'Kitchen Line',
            customer_id: 705,
            group_status: 'active',
            primary_status: 'cancelled',
            member_count: 2,
            active_member_count: 1,
            cancelled_member_count: 1,
            primary_membership_count: 1,
            issue_code: 'active_group_cancelled_primary'
        },
        {
            group_id: 'BQ-CANCELLED-PRIMARY',
            primary_booking_id: 'BK-PRIMARY-CANCELLED',
            business_context: 'event_genix',
            date: '2099-08-24',
            room: 'Kitchen Line',
            customer_id: 705,
            group_status: 'active',
            primary_status: 'cancelled',
            member_count: 2,
            active_member_count: 1,
            cancelled_member_count: 1,
            primary_membership_count: 1,
            issue_code: 'member_status_mismatch'
        }
    ];

    const report = buildAuditReport([], [], [], groupStateRows, options);

    assert.equal(report.summary.groupsMissingCanonicalDeposit, 0);
    assert.equal(report.summary.groupStateIntegrityIssues, 2);
    assert.deepEqual(
        report.groupStateIntegrityIssues.map(item => item.issueCode).sort(),
        ['active_group_cancelled_primary', 'member_status_mismatch']
    );
    assert.equal(report.groupStateIntegrityIssues[0].groupId, 'BQ-CANCELLED-PRIMARY');
    assert.equal(report.groupStateIntegrityIssues[0].primaryStatus, 'cancelled');
    assert.equal(report.groupStateIntegrityIssues[0].activeMemberCount, 1);
    assert.equal(JSON.stringify(report).includes('customerId'), false);
    assert.equal(JSON.stringify(report).includes('customer_id'), false);
});

test('banquet recovery audit summary-only omits technical ids, rooms, fingerprints, and customer fields', () => {
    const report = buildAuditReport(
        [{
            pinata_booking_id: 'BK-SENSITIVE-PINATA',
            business_context: 'event_genix',
            date: '2099-08-20',
            room: 'Sensitive Room',
            customer_id: 701,
            candidate_group_id: 'BQ-SENSITIVE-GROUP'
        }],
        [{
            group_id: 'BQ-NO-DEPOSIT',
            primary_booking_id: 'BK-PRIMARY-NO-DEPOSIT',
            business_context: 'event_genix',
            date: '2099-08-21',
            room: 'Deposit Room',
            customer_id: 702
        }],
        [{
            pinata_booking_id: 'BK-BROKEN',
            group_ids: ['BQ-BROKEN'],
            membership_count: 1,
            role_mismatch: true,
            exact_key_mismatch: false
        }],
        [{
            group_id: 'BQ-STATE',
            primary_booking_id: 'BK-STATE-PRIMARY',
            business_context: 'event_genix',
            date: '2099-08-22',
            room: 'State Room',
            customer_id: 703,
            group_status: 'active',
            primary_status: 'cancelled',
            member_count: 2,
            active_member_count: 1,
            cancelled_member_count: 1,
            primary_membership_count: 1,
            issue_code: 'active_group_cancelled_primary'
        }],
        {
            businessContext: 'event_genix',
            from: '2099-08-01',
            to: '2099-08-31'
        }
    );
    const summaryOnly = buildAuditSummaryOnlyReport(report);
    assert.deepEqual(Object.keys(summaryOnly), ['readOnly', 'businessContext', 'range', 'summary']);

    const lines = [];
    const originalLog = console.log;
    try {
        console.log = line => lines.push(String(line));
        printAuditSummaryOnlyReport(report);
    } finally {
        console.log = originalLog;
    }
    const output = lines.join('\n');

    assert.match(output, /audit summary \(read-only\)/);
    assert.match(output, /groupStateIntegrityIssues=1/);
    assert.doesNotMatch(output, /\b(?:BK|BQ)-[A-Z0-9-]+\b/);
    assert.doesNotMatch(output, /Sensitive Room|Deposit Room|State Room/);
    assert.doesNotMatch(output, /fingerprint|customer_id|customerId|phone|notes/i);
});

test('banquet recovery audit uses a read-only transaction and never writes', async () => {
    const queries = [];
    const db = {
        query: async text => {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            queries.push(sql);
            if (/WITH ungrouped_pinatas AS/i.test(sql)) return { rows: [] };
            if (/FROM banquet_groups bg/i.test(sql) && /FROM banquet_deposits deposit/i.test(sql)) return { rows: [] };
            if (/ARRAY_AGG\(membership\.group_id/i.test(sql)) return { rows: [] };
            if (/WITH group_state AS/i.test(sql)) return { rows: [] };
            return { rows: [] };
        }
    };

    const report = await runAudit(db, {
        businessContext: 'event_genix',
        from: '2099-08-01',
        to: '2099-08-31'
    });

    assert.equal(report.readOnly, true);
    assert.equal(queries[0], 'BEGIN TRANSACTION READ ONLY');
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.equal(queries.some(sql => /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(sql)), false);
});

test('banquet recovery arguments require bounded audit dates and explicit recovery pairs', () => {
    assert.deepEqual(
        parseArgs(['audit', '--from=2099-08-01', '--summary-only']),
        {
            command: 'audit',
            from: '2099-08-01',
            to: '2099-08-01',
            businessContext: 'event_genix',
            json: false,
            summaryOnly: true,
            strict: false
        }
    );
    assert.throws(() => parseArgs(['audit']), /--from/);
    assert.throws(
        () => parseArgs(['recover']),
        /--pairs/
    );
    assert.throws(
        () => parseArgs(['recover', '--pairs=BK-1:BQ-1', '--apply']),
        new RegExp(APPLY_CONFIRMATION)
    );
    assert.deepEqual(
        parseRecoveryPairs('BK-2:BQ-2,BK-1:BQ-1,BK-1:BQ-1'),
        [
            { bookingId: 'BK-1', groupId: 'BQ-1' },
            { bookingId: 'BK-2', groupId: 'BQ-2' }
        ]
    );
    assert.throws(
        () => parseRecoveryPairs('BK-1:BQ-1,BK-1:BQ-2'),
        /more than one group/
    );
});

test('detach and qa-cleanup arguments are allowlisted and confirmation guarded', () => {
    assert.throws(
        () => parseArgs(['detach', '--pairs=BK-1:BQ-1', '--apply']),
        new RegExp(DETACH_CONFIRMATION)
    );
    assert.deepEqual(
        parseArgs(['detach', '--pairs=BK-1:BQ-1']),
        {
            command: 'detach',
            apply: false,
            json: false,
            businessContext: 'event_genix',
            confirmation: '',
            pairs: [{ bookingId: 'BK-1', groupId: 'BQ-1' }]
        }
    );
    assert.deepEqual(
        parseArgs(['qa-cleanup']).bookingIds,
        [
            'BK-2026-0662',
            'BK-2026-0663',
            'BK-2026-0664',
            'BK-2026-0665',
            'BK-2026-0666',
            'BK-2026-0667',
            'BK-2026-0668'
        ]
    );
    assert.throws(
        () => parseArgs(['qa-cleanup', '--bookings=BK-2026-0662,BK-2026-9999']),
        /allowlisted only/
    );
    assert.throws(
        () => parseArgs(['qa-cleanup', '--source=untrusted_runner']),
        /source must be exactly timeline_browser_smoke/
    );
    assert.throws(
        () => parseArgs(['qa-cleanup', '--apply']),
        /--group-id/
    );
    assert.throws(
        () => parseArgs([
            'qa-cleanup',
            '--run-id=task37-1',
            '--group-id=BQ-1',
            '--primary-booking-id=BK-1',
            '--expected-bookings=BK-1',
            '--test-customer-marker=timeline_browser_smoke:task37-1:test_customer',
            '--apply'
        ]),
        new RegExp(QA_CLEANUP_CONFIRMATION)
    );
    assert.deepEqual(
        parseArgs([
            'qa-cleanup',
            '--run-id=task37-1',
            '--group-id=BQ-1',
            '--primary-booking-id=BK-1',
            '--expected-bookings=BK-1',
            '--test-customer-marker=timeline_browser_smoke:task37-1:test_customer',
            '--apply',
            `--confirm=${QA_CLEANUP_CONFIRMATION}`
        ]),
        {
            command: 'qa-cleanup',
            mode: 'marker',
            apply: true,
            json: false,
            businessContext: 'event_genix',
            confirmation: QA_CLEANUP_CONFIRMATION,
            runId: 'task37-1',
            groupId: 'BQ-1',
            primaryBookingId: 'BK-1',
            source: 'timeline_browser_smoke',
            testCustomerMarker: 'timeline_browser_smoke:task37-1:test_customer',
            expectedBookingIds: ['BK-1']
        }
    );
});

test('group state reconciliation arguments require exact scope and guarded apply approval', () => {
    assert.throws(
        () => parseArgs(['reconcile-group-state']),
        /--group-id/
    );
    assert.throws(
        () => parseArgs(['reconcile-group-state', '--group-id=BQ-1', '--expected-classification=active_group_cancelled_primary']),
        /--strategy=/
    );
    assert.throws(
        () => parseArgs(['reconcile-group-state', '--group-id=BQ-1', '--strategy=restore-primary', '--expected-classification=active_group_cancelled_primary']),
        /--strategy=/
    );
    assert.throws(
        () => parseArgs(['reconcile-group-state', '--group-id=BQ-1', '--strategy=cancel-stale-group']),
        /--expected-classification=/
    );
    assert.throws(
        () => parseArgs([
            'reconcile-group-state',
            '--group-id=BQ-1',
            '--strategy=cancel-stale-group',
            '--expected-classification=active_group_cancelled_primary',
            '--apply'
        ]),
        /--confirm=RECONCILE_STALE_BANQUET_GROUP/
    );
    assert.throws(
        () => parseArgs([
            'reconcile-group-state',
            '--group-id=BQ-1',
            '--strategy=cancel-stale-group',
            '--expected-classification=active_group_cancelled_primary',
            '--apply',
            `--confirm=${RECONCILE_GROUP_STATE_CONFIRMATION}`
        ]),
        /--allowlist=/
    );
    assert.deepEqual(
        parseArgs([
            'reconcile-group-state',
            '--group-id=BQ-1',
            '--strategy=cancel-stale-group',
            '--expected-classification=active_group_cancelled_primary',
            '--business-context=event_genix',
            '--json'
        ]),
        {
            command: 'reconcile-group-state',
            apply: false,
            json: true,
            businessContext: 'event_genix',
            confirmation: '',
            groupId: 'BQ-1',
            strategy: 'cancel-stale-group',
            expectedClassification: 'active_group_cancelled_primary',
            allowlist: []
        }
    );
    assert.deepEqual(
        parseArgs([
            'reconcile-group-state',
            '--group-id=BQ-1',
            '--strategy=cancel-stale-group',
            '--expected-classification=active_group_cancelled_primary',
            '--business-context=event_genix',
            '--apply',
            `--confirm=${RECONCILE_GROUP_STATE_CONFIRMATION}`,
            '--allowlist=BK-2,BK-1'
        ]),
        {
            command: 'reconcile-group-state',
            apply: true,
            json: false,
            businessContext: 'event_genix',
            confirmation: RECONCILE_GROUP_STATE_CONFIRMATION,
            groupId: 'BQ-1',
            strategy: 'cancel-stale-group',
            expectedClassification: 'active_group_cancelled_primary',
            allowlist: ['BK-1', 'BK-2']
        }
    );
});

test('recovery inspection requires one exact group and is idempotent for an existing activity membership', () => {
    const pair = { bookingId: 'BK-PINATA-1', groupId: 'BQ-1' };
    const target = recoveryTarget();

    const ready = classifyRecoveryInspection(pair, target, [], ['BQ-1'], 'event_genix');
    assert.equal(ready.status, 'ready');
    assert.equal(ready.reason, null);

    const ambiguous = classifyRecoveryInspection(pair, target, [], ['BQ-1', 'BQ-2'], 'event_genix');
    assert.equal(ambiguous.status, 'blocked');
    assert.equal(ambiguous.reason, 'multiple_exact_groups');

    const repeated = classifyRecoveryInspection(
        pair,
        target,
        [{ booking_id: pair.bookingId, group_id: pair.groupId, role: 'activity' }],
        ['BQ-1'],
        'event_genix'
    );
    assert.equal(repeated.status, 'already_applied');
});

test('recovery dry-run reports selected pairs without write queries', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).trim());
            return { rows: [] };
        }
    };
    const options = {
        businessContext: 'event_genix',
        pairs: [{ bookingId: 'BK-PINATA-1', groupId: 'BQ-1' }]
    };
    const inspectRecoveryPair = async (_db, pair) => ({
        result: {
            pinataBookingId: pair.bookingId,
            groupId: pair.groupId,
            businessContext: 'event_genix',
            status: 'ready',
            reason: null,
            matchFingerprint: 'abc123'
        },
        target: recoveryTarget()
    });

    const report = await runRecoveryDryRun(db, options, { inspectRecoveryPair });

    assert.equal(report.mode, 'dry-run');
    assert.equal(report.summary.ready, 1);
    assert.deepEqual(queries, ['BEGIN TRANSACTION READ ONLY', 'ROLLBACK']);
});

test('qa cleanup dry-run inventories only allowlisted technical records without writes or customer data', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            if (/FROM bookings b/i.test(String(text))) {
                return {
                    rows: [{
                        booking_id: 'BK-2026-0662',
                        business_context: 'event_genix',
                        date: '2099-08-20',
                        room: 'Room A',
                        status: 'confirmed',
                        linked_to: null,
                        category: 'pinata',
                        program_id: 'pinata',
                        program_code: 'PIN',
                        banquet_memberships: ['BQ-1:activity'],
                        banquet_links: ['91:BK-PRIMARY-1:banquet_activity'],
                        deposit_ids: ['25']
                    }]
                };
            }
            return { rows: [] };
        }
    };

    const report = await runQaCleanupDryRun(db, {
        businessContext: 'event_genix',
        bookingIds: ['BK-2026-0662', 'BK-2026-0663']
    });

    assert.equal(report.mode, 'qa-cleanup-dry-run');
    assert.equal(report.readOnly, true);
    assert.equal(report.summary.found, 1);
    assert.equal(report.summary.missing, 1);
    assert.equal(report.records[0].bookingId, 'BK-2026-0662');
    assert.equal(report.records[1].status, 'missing');
    assert.equal(JSON.stringify(report).includes('customerId'), false);
    assert.equal(JSON.stringify(report).includes('customer_id'), false);
    assert.equal(queries[0], 'BEGIN TRANSACTION READ ONLY');
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.equal(queries.some(sql => /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(sql)), false);
});

function qaCleanupRow(overrides = {}) {
    return {
        group_id: 'BQ-QA-1',
        group_business_context: 'event_genix',
        primary_booking_id: 'BK-QA-PRIMARY',
        group_customer_id: 9001,
        group_date: '2099-08-20',
        group_room: 'Room QA',
        group_name: 'QA group',
        group_status: 'active',
        group_source: 'activity_first_kitchen_bridge',
        guest_arrival_time: '11:45',
        record_kind: 'member',
        parent_booking_id: null,
        booking_id: 'BK-QA-PRIMARY',
        booking_business_context: 'event_genix',
        role: 'primary',
        booking_status: 'confirmed',
        linked_to: null,
        booking_customer_id: 9001,
        booking_date: '2099-08-20',
        booking_time: '13:00',
        booking_room: 'Room QA',
        booking_label: 'QA booking',
        program_code: 'QA',
        category: 'animation',
        extra_data: {
            disposableQa: {
                schemaVersion: 1,
                runId: 'task37-unit',
                source: 'timeline_browser_smoke',
                cleanupExpected: true,
                testCustomerMarker: 'timeline_browser_smoke:task37-unit:test_customer',
                kind: 'banquet_member',
                createdAt: '2099-08-20T11:00:00.000Z'
            }
        },
        customer_marker_ok: true,
        active_deposit_count: 0,
        banquet_link_count: 1,
        ...overrides
    };
}

const qaCleanupOptions = {
    mode: 'marker',
    apply: true,
    confirmation: QA_CLEANUP_CONFIRMATION,
    businessContext: 'event_genix',
    runId: 'task37-unit',
    groupId: 'BQ-QA-1',
    primaryBookingId: 'BK-QA-PRIMARY',
    source: 'timeline_browser_smoke',
    testCustomerMarker: 'timeline_browser_smoke:task37-unit:test_customer',
    expectedBookingIds: ['BK-QA-KITCHEN', 'BK-QA-LINKED', 'BK-QA-PRIMARY'],
    markerClock: {
        nowMs: Date.parse('2099-08-20T12:00:00.000Z')
    }
};
const singleQaCleanupOptions = {
    ...qaCleanupOptions,
    expectedBookingIds: ['BK-QA-PRIMARY']
};

test('qa cleanup group preflight requires disposable marker and marked test customer', () => {
    const ready = inspectQaCleanupGroupRows([
        qaCleanupRow(),
        qaCleanupRow({
            booking_id: 'BK-QA-KITCHEN',
            role: 'kitchen',
            booking_status: 'confirmed'
        }),
        qaCleanupRow({
            record_kind: 'linked_child',
            parent_booking_id: 'BK-QA-PRIMARY',
            booking_id: 'BK-QA-LINKED',
            role: null,
            linked_to: 'BK-QA-PRIMARY',
            booking_status: 'confirmed'
        })
    ], qaCleanupOptions);
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.activeBookingIds, ['BK-QA-PRIMARY', 'BK-QA-KITCHEN', 'BK-QA-LINKED']);

    const noMarker = inspectQaCleanupGroupRows([
        qaCleanupRow({ extra_data: {} })
    ], singleQaCleanupOptions);
    assert.equal(noMarker.status, 'marker_mismatch');
    assert.match(noMarker.reason, /missing_marker/);

    const realCustomer = inspectQaCleanupGroupRows([
        qaCleanupRow({ customer_marker_ok: false })
    ], singleQaCleanupOptions);
    assert.equal(realCustomer.status, 'real_customer_blocked');
    assert.match(realCustomer.reason, /real_customer_blocked/);

    const alreadyCancelled = inspectQaCleanupGroupRows([
        qaCleanupRow({
            group_status: 'cancelled',
            booking_status: 'cancelled'
        })
    ], singleQaCleanupOptions);
    assert.equal(alreadyCancelled.status, 'already_cancelled_clean');
});

function qaCleanupState(overrides = {}) {
    return {
        group: qaCleanupRow(),
        memberships: [{
            group_id: 'BQ-QA-1',
            booking_id: 'BK-QA-PRIMARY',
            role: 'primary'
        }],
        bookings: [qaCleanupRow()],
        children: [],
        compatibilityLinks: [],
        deposits: [],
        financeTransactions: [],
        certificateReferences: [],
        stockDependencies: [],
        ...overrides
    };
}

test('qa cleanup preflight blocks unmarked linked children and unexpected group members', () => {
    const childId = 'BK-QA-CHILD';
    const unmarkedChild = inspectQaCleanupGroupRows(qaCleanupState({
        children: [qaCleanupRow({
            booking_id: childId,
            linked_to: 'BK-QA-PRIMARY',
            extra_data: {}
        })]
    }), {
        ...singleQaCleanupOptions,
        expectedBookingIds: ['BK-QA-PRIMARY', childId]
    });
    assert.equal(unmarkedChild.status, 'unmarked_child');
    assert.match(unmarkedChild.reason, /missing_marker/);

    const unexpectedId = 'BK-QA-UNEXPECTED';
    const unexpected = inspectQaCleanupGroupRows(qaCleanupState({
        memberships: [
            {
                group_id: 'BQ-QA-1',
                booking_id: 'BK-QA-PRIMARY',
                role: 'primary'
            },
            {
                group_id: 'BQ-QA-1',
                booking_id: unexpectedId,
                role: 'kitchen'
            }
        ],
        bookings: [
            qaCleanupRow(),
            qaCleanupRow({ booking_id: unexpectedId, role: 'kitchen' })
        ]
    }), singleQaCleanupOptions);
    assert.equal(unexpected.status, 'unexpected_member');
    assert.deepEqual(unexpected.actualBookingIds, ['BK-QA-PRIMARY', unexpectedId]);
});

test('qa cleanup preflight reports finance, certificate, and stock dependencies separately', () => {
    const inspection = inspectQaCleanupGroupRows(qaCleanupState({
        financeTransactions: [{ id: 81, booking_id: 'BK-QA-PRIMARY', certificate_id: null }],
        certificateReferences: [{
            reference_type: 'booking',
            reference_id: 'BK-QA-PRIMARY',
            booking_id: 'BK-QA-PRIMARY',
            certificate_id: 71
        }],
        stockDependencies: [{ booking_id: 'BK-QA-PRIMARY', program_id: 'QA', dependency_count: 1 }]
    }), singleQaCleanupOptions);

    assert.equal(inspection.status, 'financial_dependencies_present');
    assert.equal(inspection.financeTransactionCount, 1);
    assert.equal(inspection.certificateReferenceCount, 1);
    assert.equal(inspection.stockDependencyCount, 1);
});

test('qa cleanup customer marker query uses literal POSITION matching instead of LIKE wildcards', async () => {
    let sql = '';
    await loadQaCleanupRootBookings({
        query: async text => {
            sql = String(text);
            return { rows: [] };
        }
    }, singleQaCleanupOptions, ['BK-QA-PRIMARY']);

    assert.match(sql, /POSITION\(\$3 IN COALESCE\(c\.notes, ''\)\) > 0/);
    assert.doesNotMatch(sql, /\bLIKE\b/i);
});

test('qa cleanup group inventory reads every dependency surface without write queries', async () => {
    const queries = [];
    const state = await loadQaCleanupGroupState({
        query: async text => {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            queries.push(sql);
            if (/FROM banquet_groups bg/i.test(sql)) return { rows: [qaCleanupRow()] };
            if (/FROM banquet_group_bookings bgb/i.test(sql)) {
                return {
                    rows: [{
                        group_id: 'BQ-QA-1',
                        booking_id: 'BK-QA-PRIMARY',
                        role: 'primary',
                        sort_order: 10
                    }]
                };
            }
            if (/WITH RECURSIVE descendant_ids/i.test(sql)) return { rows: [] };
            if (/FROM bookings b/i.test(sql) && /customer_marker_ok/i.test(sql)) {
                return { rows: [qaCleanupRow()] };
            }
            return { rows: [] };
        }
    }, singleQaCleanupOptions);

    assert.equal(state.group.group_id, 'BQ-QA-1');
    assert.equal(state.memberships.length, 1);
    assert.equal(state.bookings.length, 1);
    for (const table of [
        'banquet_groups',
        'banquet_group_bookings',
        'bookings',
        'booking_banquet_links',
        'banquet_deposits',
        'finance_transactions',
        'product_stock_requirements'
    ]) {
        assert.equal(queries.some(sql => sql.includes(table)), true, `${table} inventory query`);
    }
    assert.equal(
        queries.filter(sql => sql.includes('certificate_id')).length >= 2,
        true,
        'certificate references loaded separately'
    );
    assert.equal(queries.some(sql => /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(sql)), false);
});

test('qa cleanup group preflight blocks unverified linked children', () => {
    const unmarkedChild = inspectQaCleanupGroupRows([
        qaCleanupRow(),
        qaCleanupRow({
            record_kind: 'linked_child',
            parent_booking_id: 'BK-QA-PRIMARY',
            booking_id: 'BK-QA-LINKED',
            role: null,
            linked_to: 'BK-QA-PRIMARY',
            extra_data: {}
        })
    ], {
        ...qaCleanupOptions,
        expectedBookingIds: ['BK-QA-LINKED', 'BK-QA-PRIMARY']
    });
    assert.equal(unmarkedChild.status, 'marker_mismatch');
    assert.match(unmarkedChild.reason, /marker_mismatch:BK-QA-LINKED=.*missing_marker/);

    const foreignChild = inspectQaCleanupGroupRows([
        qaCleanupRow(),
        qaCleanupRow({
            record_kind: 'linked_child',
            parent_booking_id: 'BK-QA-PRIMARY',
            booking_id: 'BK-QA-FOREIGN',
            booking_business_context: 'other_context',
            booking_customer_id: 9002,
            role: null,
            linked_to: 'BK-QA-PRIMARY'
        })
    ], {
        ...qaCleanupOptions,
        expectedBookingIds: ['BK-QA-FOREIGN', 'BK-QA-PRIMARY']
    });
    assert.equal(foreignChild.status, 'real_customer_blocked');
    assert.match(foreignChild.reason, /real_customer_blocked:BK-QA-FOREIGN=group_customer_mismatch/);
});

test('qa cleanup marker dry-run uses read-only transaction and reports exact group scope', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [] };
        }
    };
    const report = await runQaCleanupDryRun(db, {
        ...singleQaCleanupOptions,
        apply: false,
        confirmation: ''
    }, {
        inspectQaCleanupGroup: async () => inspectQaCleanupGroupRows([qaCleanupRow()], singleQaCleanupOptions)
    });

    assert.equal(report.mode, 'qa-cleanup-group-dry-run');
    assert.equal(report.readOnly, true);
    assert.equal(report.summary.ready, 1);
    assert.equal(report.groups[0].groupId, 'BQ-QA-1');
    assert.deepEqual(queries, ['BEGIN TRANSACTION READ ONLY', 'ROLLBACK']);
});

test('qa cleanup apply is transactional, verifies cancellation, and reruns as no-op', async () => {
    const queries = [];
    const ready = inspectQaCleanupGroupRows([qaCleanupRow()], singleQaCleanupOptions);
    const cancelled = inspectQaCleanupGroupRows([
        qaCleanupRow({
            group_status: 'cancelled',
            booking_status: 'cancelled'
        })
    ], singleQaCleanupOptions);
    const db = {
        query: async text => {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [] };
        }
    };
    let inspected = 0;
    const report = await runQaCleanupApply(db, singleQaCleanupOptions, {
        inspectQaCleanupGroup: async () => {
            inspected += 1;
            return inspected === 1 ? ready : cancelled;
        },
        cancelExactQaBookingSet: async (_db, inspection) => {
            await db.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", ['BK-QA-PRIMARY']);
            await db.query("UPDATE banquet_groups SET status = 'cancelled' WHERE id = $1", [inspection.groupId]);
            return {
                groupId: inspection.groupId,
                status: 'cancelled',
                bookingIds: ['BK-QA-PRIMARY'],
                cancelledBookings: 1,
                cancelledGroups: 1,
                finance: []
            };
        },
        writeQaCleanupHistory: async () => {
            await db.query('INSERT INTO history DEFAULT VALUES');
        }
    });

    assert.equal(report.mode, 'qa-cleanup-apply');
    assert.equal(report.summary.cancelledBookings, 1);
    assert.equal(report.summary.cancelledGroups, 1);
    assert.equal(report.after[0].status, 'already_cancelled_clean');
    assert.equal(queries[0], 'BEGIN ISOLATION LEVEL SERIALIZABLE');
    assert.equal(queries.at(-1), 'COMMIT');
    assert.ok(queries.some(sql => /^UPDATE bookings/i.test(sql)));
    assert.equal(queries.some(sql => /linked_to = ANY/i.test(sql)), false);
    assert.ok(queries.some(sql => /^UPDATE banquet_groups/i.test(sql)));
    assert.ok(queries.some(sql => /^INSERT INTO history/i.test(sql)));

    const noOpQueries = [];
    const rerun = await runQaCleanupApply({
        query: async text => {
            noOpQueries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [] };
        }
    }, singleQaCleanupOptions, {
        inspectQaCleanupGroup: async () => cancelled
    });
    assert.equal(rerun.summary.cancelledBookings, 0);
    assert.equal(rerun.summary.cancelledGroups, 0);
    assert.equal(rerun.after[0].status, 'already_cancelled_clean');
    assert.equal(noOpQueries.some(sql => /^UPDATE bookings|^UPDATE banquet_groups|^INSERT INTO history/i.test(sql)), false);
});

test('qa cleanup apply rolls back when preflight finds real customer or missing marker', async () => {
    const queries = [];
    await assert.rejects(
        runQaCleanupApply({
            query: async text => {
                queries.push(String(text).replace(/\s+/g, ' ').trim());
                return { rows: [] };
            }
        }, singleQaCleanupOptions, {
            inspectQaCleanupGroup: async () => inspectQaCleanupGroupRows([
                qaCleanupRow({
                    extra_data: {},
                    customer_marker_ok: false
                })
            ], singleQaCleanupOptions)
        }),
        /QA cleanup blocked by preflight/
    );
    assert.deepEqual(queries, [
        'BEGIN ISOLATION LEVEL SERIALIZABLE',
        'SELECT pg_advisory_xact_lock( hashtextextended($1::text, 0) )',
        'SELECT pg_advisory_xact_lock( hashtextextended($1::text, 0) )',
        'ROLLBACK'
    ]);
});

function staleGroupStateRow(overrides = {}) {
    return {
        group_id: 'BQ-STALE-1',
        business_context: 'event_genix',
        primary_booking_id: 'BK-STALE-PRIMARY',
        customer_id: 9101,
        date: '2099-08-20',
        room: 'Room Stale',
        group_status: 'active',
        primary_status: 'cancelled',
        member_count: 2,
        active_member_count: 1,
        active_non_primary_member_count: 1,
        cancelled_member_count: 1,
        primary_membership_count: 1,
        member_ids: ['BK-STALE-KITCHEN', 'BK-STALE-PRIMARY'],
        non_primary_member_ids: ['BK-STALE-KITCHEN'],
        active_member_ids: ['BK-STALE-KITCHEN'],
        active_non_primary_member_ids: ['BK-STALE-KITCHEN'],
        active_deposit_count: 0,
        ticket_snapshot_member_count: 0,
        priced_active_member_count: 0,
        finance_transaction_count: 0,
        ...overrides
    };
}

const reconcileOptions = {
    command: 'reconcile-group-state',
    apply: false,
    json: false,
    businessContext: 'event_genix',
    groupId: 'BQ-STALE-1',
    strategy: 'cancel-stale-group',
    expectedClassification: 'active_group_cancelled_primary'
};

test('group state reconciliation classifies stale active group with cancelled primary', () => {
    const ready = classifyReconcileGroupStateTarget(staleGroupStateRow(), reconcileOptions);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.classification, 'active_group_cancelled_primary');
    assert.deepEqual(ready.activeNonPrimaryMemberIds, ['BK-STALE-KITCHEN']);
    assert.equal(JSON.stringify(ready).includes('customerId'), false);
    assert.equal(JSON.stringify(ready).includes('customer_id'), false);

    const depositBlocked = classifyReconcileGroupStateTarget(
        staleGroupStateRow({ active_deposit_count: 1 }),
        reconcileOptions
    );
    assert.equal(depositBlocked.status, 'blocked');
    assert.match(depositBlocked.reason, /active_deposit_rows_present/);

    const ticketBlocked = classifyReconcileGroupStateTarget(
        staleGroupStateRow({ ticket_snapshot_member_count: 1 }),
        reconcileOptions
    );
    assert.equal(ticketBlocked.status, 'blocked');
    assert.match(ticketBlocked.reason, /ticket_ownership_conflict/);

    const financialBlocked = classifyReconcileGroupStateTarget(
        staleGroupStateRow({ priced_active_member_count: 1 }),
        reconcileOptions
    );
    assert.equal(financialBlocked.status, 'blocked');
    assert.match(financialBlocked.reason, /member_financial_fields_present/);

    const financeTransactionBlocked = classifyReconcileGroupStateTarget(
        staleGroupStateRow({ finance_transaction_count: 1 }),
        reconcileOptions
    );
    assert.equal(financeTransactionBlocked.status, 'blocked');
    assert.match(financeTransactionBlocked.reason, /finance_transaction_conflict/);

    const allowlistMismatch = classifyReconcileGroupStateTarget(
        staleGroupStateRow(),
        { ...reconcileOptions, allowlist: ['BK-OTHER'] }
    );
    assert.equal(allowlistMismatch.status, 'blocked');
    assert.match(allowlistMismatch.reason, /allowlist_member_set_mismatch/);

    const alreadyApplied = classifyReconcileGroupStateTarget(
        staleGroupStateRow({
            group_status: 'cancelled',
            active_member_count: 0,
            active_non_primary_member_count: 0,
            cancelled_member_count: 2,
            active_member_ids: [],
            active_non_primary_member_ids: [],
            cancelled_non_primary_member_ids: ['BK-STALE-KITCHEN']
        }),
        { ...reconcileOptions, allowlist: ['BK-STALE-KITCHEN'] }
    );
    assert.equal(alreadyApplied.status, 'already_applied');
    assert.equal(alreadyApplied.reason, null);
});

test('group state reconciliation apply uses serializable transaction and rolls back blocked targets', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [] };
        }
    };
    let persisted = false;

    await assert.rejects(
        runReconcileGroupStateApply(db, {
            ...reconcileOptions,
            apply: true,
            confirmation: RECONCILE_GROUP_STATE_CONFIRMATION,
            allowlist: ['BK-STALE-KITCHEN']
        }, {
            loadReconcileGroupStateTarget: async () => staleGroupStateRow({ active_deposit_count: 1 }),
            persistReconcileGroupStateCancellation: async () => {
                persisted = true;
            }
        }),
        /blocked by preflight.*active_deposit_rows_present/
    );

    assert.equal(persisted, false);
    assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'ROLLBACK']);
});

test('group state reconciliation apply verifies idempotent after-state without production ids', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [] };
        }
    };
    let loadCalls = 0;
    const report = await runReconcileGroupStateApply(db, {
        ...reconcileOptions,
        apply: true,
        confirmation: RECONCILE_GROUP_STATE_CONFIRMATION,
        allowlist: ['BK-STALE-KITCHEN']
    }, {
        loadReconcileGroupStateTarget: async () => {
            loadCalls += 1;
            if (loadCalls === 1) return staleGroupStateRow();
            return staleGroupStateRow({
                group_status: 'cancelled',
                active_member_count: 0,
                active_non_primary_member_count: 0,
                cancelled_member_count: 2,
                active_member_ids: [],
                active_non_primary_member_ids: [],
                cancelled_non_primary_member_ids: ['BK-STALE-KITCHEN']
            });
        },
        persistReconcileGroupStateCancellation: async (_db, result) => ({
            groupId: result.groupId,
            primaryBookingId: result.primaryBookingId,
            cancelledMemberBookingIds: result.activeNonPrimaryMemberIds,
            cancelledBookings: result.activeNonPrimaryMemberIds.length,
            cancelledGroups: 1,
            status: 'applied',
            matchFingerprint: result.matchFingerprint
        })
    });

    assert.equal(report.mode, 'reconcile-group-state-apply');
    assert.equal(report.summary.applied, 1);
    assert.equal(report.summary.verifiedAfter, 1);
    assert.equal(report.after.status, 'already_applied');
    assert.equal(JSON.stringify(report).includes('customerId'), false);
    assert.equal(JSON.stringify(report).includes('customer_id'), false);
    assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'COMMIT']);
});

test('group state reconciliation dry-run is read-only and never writes', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [] };
        }
    };
    const report = await runReconcileGroupStateDryRun(db, reconcileOptions, {
        loadReconcileGroupStateTarget: async () => staleGroupStateRow()
    });

    assert.equal(report.mode, 'reconcile-group-state-dry-run');
    assert.equal(report.readOnly, true);
    assert.equal(report.summary.ready, 1);
    assert.equal(report.summary.activeNonPrimaryMembers, 1);
    assert.equal(report.result.status, 'ready');
    assert.deepEqual(queries, ['BEGIN TRANSACTION READ ONLY', 'ROLLBACK']);
    assert.equal(queries.some(sql => /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCOMMIT\b/i.test(sql)), false);
});

test('detach inspection allows only pinata activity membership and is idempotent when already absent', () => {
    const pair = { bookingId: 'BK-PINATA-1', groupId: 'BQ-1' };
    const attached = classifyDetachInspection(pair, detachInspectionState(), 'event_genix');
    assert.equal(attached.status, 'attached');
    assert.equal(attached.existingRole, 'activity');
    assert.equal(attached.compatibilityLinkCount, 1);

    const cleanDetached = classifyDetachInspection(
        pair,
        detachInspectionState({
            memberships: [],
            compatibilityLinks: []
        }),
        'event_genix'
    );
    assert.equal(cleanDetached.status, 'already_detached_and_clean');
    assert.equal(cleanDetached.compatibilityLinkCount, 0);

    const orphanLink = classifyDetachInspection(
        pair,
        detachInspectionState({ memberships: [] }),
        'event_genix'
    );
    assert.equal(orphanLink.status, 'orphan_link');
    assert.equal(orphanLink.reason, 'compatibility_link_without_membership');

    const wrongIds = classifyDetachInspection(
        pair,
        detachInspectionState({
            memberships: [],
            group: null,
            pinataBooking: null,
            primaryBooking: null,
            compatibilityLinks: []
        }),
        'event_genix'
    );
    assert.equal(wrongIds.status, 'not_found');
    assert.equal(wrongIds.reason, 'booking_and_group_not_found');

    const primaryBlocked = classifyDetachInspection(
        pair,
        detachInspectionState({
            target: { primary_booking_id: 'BK-PINATA-1' },
            memberships: [{ group_id: 'BQ-1', booking_id: 'BK-PINATA-1', role: 'primary' }]
        }),
        'event_genix'
    );
    assert.equal(primaryBlocked.status, 'inconsistent');
    assert.equal(primaryBlocked.reason, 'pinata_is_group_primary');
});

test('detach dry-run reports selected pairs without write queries', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).trim());
            return { rows: [] };
        }
    };
    const options = {
        businessContext: 'event_genix',
        pairs: [
            { bookingId: 'BK-PINATA-1', groupId: 'BQ-1' },
            { bookingId: 'BK-CLEAN', groupId: 'BQ-1' },
            { bookingId: 'BK-ORPHAN', groupId: 'BQ-1' },
            { bookingId: 'BK-MISSING', groupId: 'BQ-404' },
            { bookingId: 'BK-BADROLE', groupId: 'BQ-1' }
        ]
    };
    const inspectDetachPair = async (_db, pair) => {
        const byBookingId = {
            'BK-PINATA-1': { status: 'attached', reason: null, compatibilityLinkCount: 1 },
            'BK-CLEAN': { status: 'already_detached_and_clean', reason: null, compatibilityLinkCount: 0 },
            'BK-ORPHAN': {
                status: 'orphan_link',
                reason: 'compatibility_link_without_membership',
                compatibilityLinkCount: 1
            },
            'BK-MISSING': { status: 'not_found', reason: 'booking_and_group_not_found', compatibilityLinkCount: 0 },
            'BK-BADROLE': { status: 'inconsistent', reason: 'not_activity_membership', compatibilityLinkCount: 0 }
        };
        return {
            result: {
                ...byBookingId[pair.bookingId],
                pinataBookingId: pair.bookingId,
                groupId: pair.groupId,
                businessContext: 'event_genix',
                matchFingerprint: 'abc123'
            },
            target: { ...recoveryTarget(), membership_role: 'activity' }
        };
    };

    const report = await runDetachDryRun(db, options, { inspectDetachPair });

    assert.equal(report.mode, 'detach-dry-run');
    assert.deepEqual(report.summary, {
        requested: 5,
        attached: 1,
        alreadyDetachedAndClean: 1,
        orphanLink: 1,
        notFound: 1,
        inconsistent: 1,
        blocked: 3
    });
    assert.equal(Object.prototype.hasOwnProperty.call(report.summary, 'ready'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(report.summary, 'alreadyDetached'), false);
    assert.deepEqual(queries, ['BEGIN TRANSACTION READ ONLY', 'ROLLBACK']);
    assert.equal(queries.some(sql => /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(sql)), false);
});

test('detach inspection reports member role conflicts as inconsistent', () => {
    const pair = { bookingId: 'BK-PINATA-1', groupId: 'BQ-1' };
    const roleConflict = classifyDetachInspection(
        pair,
        detachInspectionState({
            memberships: [{ group_id: 'BQ-1', booking_id: 'BK-PINATA-1', role: 'primary' }]
        }),
        'event_genix'
    );

    assert.equal(roleConflict.status, 'inconsistent');
    assert.equal(roleConflict.reason, 'not_activity_membership');
    assert.equal(roleConflict.existingRole, 'primary');
});

test('detach apply requires confirmation before opening a transaction', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).trim());
            return { rows: [] };
        }
    };

    await assert.rejects(
        runDetachApply(db, {
            apply: true,
            confirmation: 'WRONG',
            businessContext: 'event_genix',
            pairs: [{ bookingId: 'BK-PINATA-1', groupId: 'BQ-1' }]
        }),
        new RegExp(DETACH_CONFIRMATION)
    );
    assert.deepEqual(queries, []);
});

test('detach apply rolls back the full allowlist on persistence failure', async () => {
    const queries = [];
    const db = {
        query: async text => {
            queries.push(String(text).trim());
            return { rows: [] };
        }
    };
    const options = {
        apply: true,
        confirmation: DETACH_CONFIRMATION,
        businessContext: 'event_genix',
        pairs: [{ bookingId: 'BK-PINATA-1', groupId: 'BQ-1' }]
    };
    const inspectDetachPair = async (_db, pair) => ({
        result: {
            pinataBookingId: pair.bookingId,
            groupId: pair.groupId,
            businessContext: 'event_genix',
            status: 'attached',
            reason: null,
            matchFingerprint: 'abc123'
        },
        target: { ...recoveryTarget(), membership_role: 'activity' }
    });

    await assert.rejects(
        runDetachApply(db, options, {
            inspectDetachPair,
            persistDetachPair: async () => {
                throw new Error('simulated detach failure');
            }
        }),
        /simulated detach failure/
    );
    assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'ROLLBACK']);
});

test('detach apply is idempotent when every allowlisted pair is already detached', async () => {
    const queries = [];
    let persistCalls = 0;
    const db = {
        query: async text => {
            queries.push(String(text).trim());
            return { rows: [] };
        }
    };
    const options = {
        apply: true,
        confirmation: DETACH_CONFIRMATION,
        businessContext: 'event_genix',
        pairs: [{ bookingId: 'BK-PINATA-1', groupId: 'BQ-1' }]
    };
    const inspectDetachPair = async (_db, pair) => ({
        result: {
            pinataBookingId: pair.bookingId,
            groupId: pair.groupId,
            businessContext: 'event_genix',
            status: 'already_detached_and_clean',
            reason: null,
            matchFingerprint: null
        },
        target: null
    });

    const report = await runDetachApply(db, options, {
        inspectDetachPair,
        persistDetachPair: async () => {
            persistCalls += 1;
        }
    });

    assert.equal(persistCalls, 0);
    assert.equal(report.summary.detached, 0);
    assert.equal(report.summary.alreadyDetachedAndClean, 1);
    assert.equal(report.summary.blocked, 0);
    assert.equal(report.summary.verifiedAfter, 1);
    assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'COMMIT']);
});

test('detach apply blocks orphan compatibility links before persistence', async () => {
    const queries = [];
    let persistCalls = 0;
    const db = {
        query: async text => {
            queries.push(String(text).trim());
            return { rows: [] };
        }
    };
    const options = {
        apply: true,
        confirmation: DETACH_CONFIRMATION,
        businessContext: 'event_genix',
        pairs: [{ bookingId: 'BK-PINATA-1', groupId: 'BQ-1' }]
    };
    const inspectDetachPair = async (_db, pair) => ({
        result: {
            pinataBookingId: pair.bookingId,
            groupId: pair.groupId,
            businessContext: 'event_genix',
            status: 'orphan_link',
            reason: 'compatibility_link_without_membership',
            matchFingerprint: 'abc123',
            compatibilityLinkCount: 1
        },
        target: null
    });

    await assert.rejects(
        runDetachApply(db, options, {
            inspectDetachPair,
            persistDetachPair: async () => {
                persistCalls += 1;
            }
        }),
        /compatibility_link_without_membership/
    );
    assert.equal(persistCalls, 0);
    assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'ROLLBACK']);
});

test('recovery apply is transactional and verifies every allowlisted pair after persistence', async () => {
    const queries = [];
    let applied = false;
    const db = {
        query: async text => {
            queries.push(String(text).trim());
            return { rows: [] };
        }
    };
    const options = {
        apply: true,
        confirmation: APPLY_CONFIRMATION,
        businessContext: 'event_genix',
        pairs: [{ bookingId: 'BK-PINATA-1', groupId: 'BQ-1' }]
    };
    const inspectRecoveryPair = async (_db, pair) => ({
        result: {
            pinataBookingId: pair.bookingId,
            groupId: pair.groupId,
            businessContext: 'event_genix',
            status: applied ? 'already_applied' : 'ready',
            reason: null,
            matchFingerprint: 'abc123'
        },
        target: recoveryTarget()
    });
    const persistRecoveryPair = async (_db, inspection) => {
        applied = true;
        return {
            pinataBookingId: inspection.result.pinataBookingId,
            groupId: inspection.result.groupId,
            role: 'activity',
            status: 'applied',
            matchFingerprint: inspection.result.matchFingerprint
        };
    };

    const report = await runRecoveryApply(db, options, {
        inspectRecoveryPair,
        persistRecoveryPair
    });

    assert.equal(report.summary.applied, 1);
    assert.equal(report.summary.verifiedAfter, 1);
    assert.equal(report.after[0].status, 'already_applied');
    assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'COMMIT']);
});

test('recovery apply rolls back the full allowlist when preflight is ambiguous', async () => {
    const queries = [];
    let persistCalls = 0;
    const db = {
        query: async text => {
            queries.push(String(text).trim());
            return { rows: [] };
        }
    };
    const options = {
        apply: true,
        confirmation: APPLY_CONFIRMATION,
        businessContext: 'event_genix',
        pairs: [{ bookingId: 'BK-PINATA-1', groupId: 'BQ-1' }]
    };
    const inspectRecoveryPair = async (_db, pair) => ({
        result: {
            pinataBookingId: pair.bookingId,
            groupId: pair.groupId,
            businessContext: 'event_genix',
            status: 'blocked',
            reason: 'multiple_exact_groups',
            matchFingerprint: 'abc123',
            candidateGroupIds: ['BQ-1', 'BQ-2']
        },
        target: recoveryTarget()
    });

    await assert.rejects(
        runRecoveryApply(db, options, {
            inspectRecoveryPair,
            persistRecoveryPair: async () => {
                persistCalls += 1;
            }
        }),
        /multiple_exact_groups/
    );
    assert.equal(persistCalls, 0);
    assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'ROLLBACK']);
});

test('recovery persistence writes only canonical membership, compatibility link, group timestamp, and technical history', async () => {
    const queries = [];
    const db = {
        query: async (text, params = []) => {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            queries.push({ sql, params });
            if (/^INSERT INTO banquet_group_bookings/i.test(sql)) {
                return {
                    rows: [{ booking_id: 'BK-PINATA-1', group_id: 'BQ-1', role: 'activity' }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 1 };
        }
    };
    const inspection = {
        result: {
            pinataBookingId: 'BK-PINATA-1',
            groupId: 'BQ-1',
            businessContext: 'event_genix',
            status: 'ready',
            reason: null,
            matchFingerprint: 'abc123'
        },
        target: recoveryTarget()
    };

    const result = await persistRecoveryPair(db, inspection, 'event_genix');

    assert.equal(result.role, 'activity');
    assert.equal(queries.filter(query => /^INSERT INTO banquet_group_bookings/i.test(query.sql)).length, 1);
    assert.ok(queries.some(query => /^INSERT INTO booking_banquet_links/i.test(query.sql)));
    assert.ok(queries.some(query => /^INSERT INTO history/i.test(query.sql)));
    assert.equal(queries.some(query => /INSERT INTO banquet_deposits/i.test(query.sql)), false);
    assert.equal(queries.some(query => /customers|phone|instagram|client_name/i.test(query.sql)), false);
});

test('detach persistence deletes only activity membership, compatibility link, and writes technical history', async () => {
    const queries = [];
    const db = {
        query: async (text, params = []) => {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            queries.push({ sql, params });
            if (/^DELETE FROM banquet_group_bookings/i.test(sql)) {
                return {
                    rows: [{ booking_id: 'BK-PINATA-1', group_id: 'BQ-1', role: 'activity' }],
                    rowCount: 1
                };
            }
            if (/^DELETE FROM booking_banquet_links/i.test(sql)) {
                return { rows: [{ id: 91 }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
        }
    };
    const inspection = {
        result: {
            pinataBookingId: 'BK-PINATA-1',
            groupId: 'BQ-1',
            businessContext: 'event_genix',
            status: 'attached',
            reason: null,
            matchFingerprint: 'abc123'
        },
        target: {
            ...recoveryTarget(),
            membership_role: 'activity'
        }
    };

    const result = await persistDetachPair(db, inspection, 'event_genix');

    assert.equal(result.status, 'detached');
    assert.equal(result.deletedCompatibilityLinks, 1);
    const membershipDeleteIndex = queries.findIndex(query => /^DELETE FROM banquet_group_bookings/i.test(query.sql));
    const historyInsertIndex = queries.findIndex(query => /^INSERT INTO history/i.test(query.sql));
    assert.equal(queries.filter(query => /^DELETE FROM banquet_group_bookings/i.test(query.sql)).length, 1);
    assert.ok(historyInsertIndex > membershipDeleteIndex);
    assert.ok(queries.some(query => /^DELETE FROM booking_banquet_links/i.test(query.sql)));
    assert.ok(queries.some(query => /^UPDATE banquet_groups/i.test(query.sql)));
    assert.ok(queries.some(query => /^INSERT INTO history/i.test(query.sql)));
    assert.equal(queries.some(query => /DELETE FROM bookings/i.test(query.sql)), false);
    assert.equal(queries.some(query => /^UPDATE bookings/i.test(query.sql)), false);
    assert.equal(queries.some(query => /banquet_deposits/i.test(query.sql)), false);
    assert.equal(queries.some(query => /customers|phone|instagram|client_name/i.test(query.sql)), false);
});

test('detach persistence does not write history when activity membership delete fails', async () => {
    const queries = [];
    const db = {
        query: async (text, params = []) => {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            queries.push({ sql, params });
            if (/^DELETE FROM banquet_group_bookings/i.test(sql)) {
                return { rows: [], rowCount: 0 };
            }
            return { rows: [], rowCount: 1 };
        }
    };
    const inspection = {
        result: {
            pinataBookingId: 'BK-PINATA-1',
            groupId: 'BQ-1',
            businessContext: 'event_genix',
            status: 'attached',
            reason: null,
            matchFingerprint: 'abc123'
        },
        target: {
            ...recoveryTarget(),
            membership_role: 'activity'
        }
    };

    await assert.rejects(
        persistDetachPair(db, inspection, 'event_genix'),
        /Activity membership detach was not applied/
    );
    assert.ok(queries.some(query => /^DELETE FROM banquet_group_bookings/i.test(query.sql)));
    assert.equal(queries.some(query => /^INSERT INTO history/i.test(query.sql)), false);
    assert.equal(queries.some(query => /^UPDATE banquet_groups/i.test(query.sql)), false);
});

test('production recovery script contains no automatic deposit creation or customer PII query', () => {
    const source = fs.readFileSync(
        path.join(ROOT, 'scripts', 'banquet-production-recovery.js'),
        'utf8'
    );
    assert.match(source, /BEGIN TRANSACTION READ ONLY/);
    assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
    assert.match(source, /--confirm=\$\{APPLY_CONFIRMATION\}/);
    assert.match(source, /--confirm=\$\{DETACH_CONFIRMATION\}/);
    assert.match(source, /canonical_deposit_missing_manual_review_required/);
    assert.doesNotMatch(source, /INSERT INTO banquet_deposits/i);
    assert.doesNotMatch(source, /DELETE FROM bookings/i);
    assert.doesNotMatch(source, /DELETE FROM banquet_deposits/i);
    assert.doesNotMatch(source, /JOIN customers|phone|instagram|client_name/i);
});
