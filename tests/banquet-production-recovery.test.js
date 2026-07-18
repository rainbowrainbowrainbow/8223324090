'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    APPLY_CONFIRMATION,
    DETACH_CONFIRMATION,
    buildAuditReport,
    classifyDetachInspection,
    classifyRecoveryInspection,
    parseArgs,
    parseRecoveryPairs,
    persistDetachPair,
    persistRecoveryPair,
    runAudit,
    runDetachApply,
    runDetachDryRun,
    runQaCleanupDryRun,
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
        pinataIntegrityIssues: 1
    });
    assert.equal(report.pinatas.exactMatches[0].candidateGroupId, 'BQ-EXACT');
    assert.deepEqual(report.pinatas.ambiguous[0].candidateGroupIds, ['BQ-A', 'BQ-B']);
    assert.equal(report.pinatas.standalone[0].pinataBookingId, 'BK-STANDALONE');
    assert.equal(report.depositsForManualReview[0].reason, 'canonical_deposit_missing_manual_review_required');
    assert.deepEqual(report.integrityIssues[0].groupIds, ['BQ-X', 'BQ-Y']);
    assert.equal(JSON.stringify(report).includes('customerId'), false);
    assert.equal(JSON.stringify(report).includes('customer_id'), false);
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
        parseArgs(['audit', '--from=2099-08-01']),
        {
            command: 'audit',
            from: '2099-08-01',
            to: '2099-08-01',
            businessContext: 'event_genix',
            json: false,
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
        () => parseArgs(['qa-cleanup', '--apply']),
        /read-only dry-run only/
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

test('detach inspection allows only pinata activity membership and is idempotent when already absent', () => {
    const pair = { bookingId: 'BK-PINATA-1', groupId: 'BQ-1' };
    const ready = classifyDetachInspection(
        pair,
        {
            ...recoveryTarget(),
            membership_role: 'activity'
        },
        'event_genix'
    );
    assert.equal(ready.status, 'ready');

    const alreadyDetached = classifyDetachInspection(pair, null, 'event_genix');
    assert.equal(alreadyDetached.status, 'already_detached');

    const primaryBlocked = classifyDetachInspection(
        pair,
        {
            ...recoveryTarget({ primary_booking_id: 'BK-PINATA-1' }),
            membership_role: 'primary'
        },
        'event_genix'
    );
    assert.equal(primaryBlocked.status, 'blocked');
    assert.equal(primaryBlocked.reason, 'not_activity_membership');
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
        pairs: [{ bookingId: 'BK-PINATA-1', groupId: 'BQ-1' }]
    };
    const inspectDetachPair = async (_db, pair) => ({
        result: {
            pinataBookingId: pair.bookingId,
            groupId: pair.groupId,
            businessContext: 'event_genix',
            status: 'ready',
            reason: null,
            matchFingerprint: 'abc123'
        },
        target: { ...recoveryTarget(), membership_role: 'activity' }
    });

    const report = await runDetachDryRun(db, options, { inspectDetachPair });

    assert.equal(report.mode, 'detach-dry-run');
    assert.equal(report.summary.ready, 1);
    assert.deepEqual(queries, ['BEGIN TRANSACTION READ ONLY', 'ROLLBACK']);
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
            status: 'ready',
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
            status: 'already_detached',
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
    assert.equal(report.summary.alreadyDetached, 1);
    assert.equal(report.summary.verifiedAfter, 1);
    assert.deepEqual(queries, ['BEGIN ISOLATION LEVEL SERIALIZABLE', 'COMMIT']);
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
            status: 'ready',
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
    assert.equal(queries.filter(query => /^DELETE FROM banquet_group_bookings/i.test(query.sql)).length, 1);
    assert.ok(queries.some(query => /^DELETE FROM booking_banquet_links/i.test(query.sql)));
    assert.ok(queries.some(query => /^UPDATE banquet_groups/i.test(query.sql)));
    assert.ok(queries.some(query => /^INSERT INTO history/i.test(query.sql)));
    assert.equal(queries.some(query => /DELETE FROM bookings/i.test(query.sql)), false);
    assert.equal(queries.some(query => /banquet_deposits/i.test(query.sql)), false);
    assert.equal(queries.some(query => /customers|phone|instagram|client_name/i.test(query.sql)), false);
});

test('production recovery script contains no automatic deposit creation or customer PII query', () => {
    const source = fs.readFileSync(
        path.join(ROOT, 'scripts', 'banquet-production-recovery.js'),
        'utf8'
    );
    assert.match(source, /BEGIN TRANSACTION READ ONLY/);
    assert.match(source, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
    assert.match(source, /--confirm=\$\{APPLY_CONFIRMATION\}/);
    assert.match(source, /canonical_deposit_missing_manual_review_required/);
    assert.doesNotMatch(source, /INSERT INTO banquet_deposits/i);
    assert.doesNotMatch(source, /DELETE FROM bookings/i);
    assert.doesNotMatch(source, /DELETE FROM banquet_deposits/i);
    assert.doesNotMatch(source, /JOIN customers|phone|instagram|client_name/i);
});
