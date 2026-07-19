/**
 * Real PostgreSQL coverage for banquet production recovery detach and recovery safety.
 *
 * Run only through:
 *   npm run test:integration:banquet-recovery:isolated
 */
'use strict';

const crypto = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    APPLY_CONFIRMATION,
    DETACH_CONFIRMATION,
    QA_CLEANUP_CONFIRMATION,
    persistDetachPair,
    runDetachApply,
    runDetachDryRun,
    runQaCleanupApply,
    runQaCleanupDryRun,
    runRecoveryApply,
    runRecoveryDryRun
} = require('../../scripts/banquet-production-recovery');

const enabled = process.env.RUN_BANQUET_PRODUCTION_RECOVERY_INTEGRATION === 'true';
const BUSINESS_CONTEXT = 'event_genix';
const RELATION_TYPE = 'banquet_activity';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_BANQUET_PRODUCTION_RECOVERY_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL);
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createPool(testDb) {
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 10_000
    });
}

function compactId(prefix, suffix) {
    return `${prefix}-${suffix}`.slice(0, 50);
}

async function withClient(pool, callback) {
    const client = await pool.connect();
    try {
        return await callback(client);
    } finally {
        client.release();
    }
}

async function insertCustomer(pool, suffix) {
    const result = await pool.query(
        `INSERT INTO customers (name, phone, source, notes)
         VALUES ($1, $2, 'integration_test', 'banquet production recovery isolated fixture')
         RETURNING id`,
        [`Banquet Recovery ${suffix}`, `+380000${String(suffix).slice(-8)}`]
    );
    return result.rows[0].id;
}

async function insertBooking(pool, id, overrides = {}) {
    await pool.query(
        `INSERT INTO bookings (
             id, business_context, date, time, line_id, customer_id,
             program_id, program_code, label, program_name, category,
             duration, price, hosts, room, status, created_by, extra_data
         )
         VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18::jsonb
         )`,
        [
            id,
            BUSINESS_CONTEXT,
            overrides.date || '2099-08-20',
            overrides.time || '13:00',
            overrides.lineId || 'line-main',
            overrides.customerId,
            overrides.programId ?? 'pinata',
            overrides.programCode ?? 'PIN',
            overrides.label || 'Pinata fixture',
            overrides.programName || 'Pinata fixture',
            overrides.category || 'pinata',
            overrides.duration ?? 30,
            overrides.price ?? 0,
            overrides.hosts ?? 1,
            overrides.room || 'Room A',
            overrides.status || 'confirmed',
            'banquet-recovery-integration',
            JSON.stringify(overrides.extraData || {})
        ]
    );
}

async function seedDetachPair(pool, suffix, options = {}) {
    const customerId = await insertCustomer(pool, suffix);
    const pinataId = compactId(options.pinataPrefix || 'bpr-pinata', suffix);
    const primaryId = compactId(options.primaryPrefix || 'bpr-primary', suffix);
    const groupId = compactId(options.groupPrefix || 'bpr-group', suffix);
    await insertBooking(pool, primaryId, {
        customerId,
        lineId: 'line-primary',
        programId: 'paper-show',
        programCode: 'PAPER',
        label: 'Primary fixture',
        programName: 'Primary fixture',
        category: 'show'
    });
    await insertBooking(pool, pinataId, {
        customerId,
        lineId: 'line-pinata',
        category: options.pinataCategory || 'pinata',
        programId: options.pinataProgramId ?? 'pinata',
        programCode: options.pinataProgramCode ?? 'PIN'
    });
    await pool.query(
        `INSERT INTO banquet_groups
            (id, business_context, primary_booking_id, customer_id, date, room, group_name,
             guest_arrival_time, status, source, created_by)
         VALUES ($1, $2, $3, $4, '2099-08-20', 'Room A', $5,
                 '12:30', 'active', 'integration_test', 'banquet-recovery-integration')`,
        [groupId, BUSINESS_CONTEXT, primaryId, customerId, `Recovery ${suffix}`]
    );
    if (options.membership !== false) {
        await pool.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by)
             VALUES ($1, $2, $3, $4, 100, 'banquet-recovery-integration')`,
            [groupId, BUSINESS_CONTEXT, pinataId, options.role || 'activity']
        );
    }
    if (options.link !== false) {
        await pool.query(
            `INSERT INTO booking_banquet_links
                (business_context, booking_a_id, booking_b_id, relation_type, label, created_by)
             VALUES ($1, $2, $3, $4, $5, 'banquet-recovery-integration')`,
            [BUSINESS_CONTEXT, primaryId, pinataId, RELATION_TYPE, `Recovery ${suffix}`]
        );
    }
    return { bookingId: pinataId, groupId, primaryId };
}

function qaCleanupMarker(runId) {
    return {
        disposableQa: {
            schemaVersion: 1,
            runId,
            source: 'timeline_browser_smoke',
            cleanupExpected: true,
            testCustomerMarker: `timeline_browser_smoke:${runId}:test_customer`
        }
    };
}

async function seedQaCleanupGroup(pool, suffix) {
    const runId = `task37-${suffix}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80);
    const marker = `timeline_browser_smoke:${runId}:test_customer`;
    const customer = await pool.query(
        `INSERT INTO customers (name, phone, source, notes)
         VALUES ($1, $2, 'integration_test', $3)
         RETURNING id`,
        [`Timeline QA ${suffix}`, `+380001${String(suffix).slice(-8)}`, `timeline browser smoke ${runId}; ${marker}`]
    );
    const customerId = customer.rows[0].id;
    const primaryId = compactId('bpr-qa-primary', suffix);
    const kitchenId = compactId('bpr-qa-kitchen', suffix);
    const groupId = compactId('bpr-qa-group', suffix);
    await insertBooking(pool, primaryId, {
        customerId,
        lineId: 'line-primary',
        programId: 'qa-activity',
        programCode: 'QA-ACT',
        label: 'QA activity',
        programName: 'QA activity',
        category: 'animation',
        extraData: qaCleanupMarker(runId)
    });
    await insertBooking(pool, kitchenId, {
        customerId,
        lineId: 'banquet-service',
        programId: null,
        programCode: 'KITCHEN',
        label: 'QA kitchen',
        programName: 'QA kitchen',
        category: 'banquet',
        extraData: qaCleanupMarker(runId)
    });
    await pool.query(
        `INSERT INTO banquet_groups
            (id, business_context, primary_booking_id, customer_id, date, room, group_name,
             guest_arrival_time, status, source, created_by)
         VALUES ($1, $2, $3, $4, '2099-08-20', 'Room A', $5,
                 '11:45', 'active', 'timeline_browser_smoke', 'banquet-recovery-integration')`,
        [groupId, BUSINESS_CONTEXT, primaryId, customerId, `QA ${suffix}`]
    );
    await pool.query(
        `INSERT INTO banquet_group_bookings
            (group_id, business_context, booking_id, role, sort_order, created_by)
         VALUES
            ($1, $2, $3, 'primary', 10, 'banquet-recovery-integration'),
            ($1, $2, $4, 'kitchen', 20, 'banquet-recovery-integration')`,
        [groupId, BUSINESS_CONTEXT, primaryId, kitchenId]
    );
    await pool.query(
        `INSERT INTO booking_banquet_links
            (business_context, booking_a_id, booking_b_id, relation_type, label, created_by)
         VALUES ($1, $2, $3, $4, $5, 'banquet-recovery-integration')`,
        [BUSINESS_CONTEXT, primaryId, kitchenId, RELATION_TYPE, `QA ${suffix}`]
    );
    return {
        runId,
        groupId,
        primaryId,
        kitchenId,
        marker
    };
}

async function countRows(pool, pair, action = 'banquet_pinata_membership_detached') {
    const [membership, links, history] = await Promise.all([
        pool.query(
            `SELECT COUNT(*)::int AS count
               FROM banquet_group_bookings
              WHERE business_context = $1
                AND booking_id = $2
                AND group_id = $3`,
            [BUSINESS_CONTEXT, pair.bookingId, pair.groupId]
        ),
        pool.query(
            `SELECT COUNT(*)::int AS count
               FROM booking_banquet_links
              WHERE business_context = $1
                AND relation_type = $4
                AND (
                    (booking_a_id = $2 AND booking_b_id = $3)
                    OR (booking_a_id = $3 AND booking_b_id = $2)
                )`,
            [BUSINESS_CONTEXT, pair.bookingId, pair.primaryId, RELATION_TYPE]
        ),
        pool.query(
            `SELECT COUNT(*)::int AS count
               FROM history
              WHERE business_context = $1
                AND action = $4
                AND data->>'booking_id' = $2
                AND data->>'group_id' = $3`,
            [BUSINESS_CONTEXT, pair.bookingId, pair.groupId, action]
        )
    ]);
    return {
        memberships: membership.rows[0].count,
        links: links.rows[0].count,
        history: history.rows[0].count
    };
}

describe('banquet production recovery on isolated PostgreSQL', {
    skip: !enabled,
    concurrency: 1
}, () => {
    let pool;
    let suffix;

    before(() => {
        const testDb = requireIsolatedDatabase();
        pool = createPool(testDb);
        suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
    });

    after(async () => {
        await pool?.end();
    });

    test('recovers missing pinata membership and compatibility link, then reruns cleanly', async () => {
        const pair = await seedDetachPair(pool, `${suffix}_recover`, { membership: false, link: false });

        const dryRun = await withClient(pool, client => runRecoveryDryRun(client, {
            businessContext: BUSINESS_CONTEXT,
            pairs: [pair]
        }));
        assert.equal(dryRun.readOnly, true);
        assert.equal(dryRun.summary.ready, 1);

        const apply = await withClient(pool, client => runRecoveryApply(client, {
            apply: true,
            confirmation: APPLY_CONFIRMATION,
            businessContext: BUSINESS_CONTEXT,
            pairs: [pair]
        }));
        assert.equal(apply.summary.applied, 1);
        assert.equal(apply.after[0].status, 'already_applied');

        const afterApply = await countRows(pool, pair, 'banquet_pinata_membership_recovered');
        assert.deepEqual(afterApply, { memberships: 1, links: 1, history: 1 });

        const rerun = await withClient(pool, client => runRecoveryApply(client, {
            apply: true,
            confirmation: APPLY_CONFIRMATION,
            businessContext: BUSINESS_CONTEXT,
            pairs: [pair]
        }));
        assert.equal(rerun.summary.applied, 0);
        assert.equal(rerun.summary.alreadyApplied, 1);
        assert.equal(rerun.after[0].status, 'already_applied');
    });

    test('detaches an attached pinata, removes compatibility link, writes history, and reruns cleanly', async () => {
        const pair = await seedDetachPair(pool, `${suffix}_detach`);

        const dryRun = await withClient(pool, client => runDetachDryRun(client, {
            businessContext: BUSINESS_CONTEXT,
            pairs: [pair]
        }));
        assert.equal(dryRun.readOnly, true);
        assert.equal(dryRun.summary.attached, 1);
        assert.equal(dryRun.summary.blocked, 0);
        assert.equal(dryRun.pairs[0].status, 'attached');

        const apply = await withClient(pool, client => runDetachApply(client, {
            apply: true,
            confirmation: DETACH_CONFIRMATION,
            businessContext: BUSINESS_CONTEXT,
            pairs: [pair]
        }));
        assert.equal(apply.summary.detached, 1);
        assert.equal(apply.before[0].status, 'attached');
        assert.equal(apply.after[0].status, 'already_detached_and_clean');

        const afterApply = await countRows(pool, pair);
        assert.deepEqual(afterApply, { memberships: 0, links: 0, history: 1 });

        const rerun = await withClient(pool, client => runDetachApply(client, {
            apply: true,
            confirmation: DETACH_CONFIRMATION,
            businessContext: BUSINESS_CONTEXT,
            pairs: [pair]
        }));
        assert.equal(rerun.summary.detached, 0);
        assert.equal(rerun.summary.alreadyDetachedAndClean, 1);
        assert.equal(rerun.after[0].status, 'already_detached_and_clean');

        const afterRerun = await countRows(pool, pair);
        assert.deepEqual(afterRerun, { memberships: 0, links: 0, history: 1 });
    });

    test('cancels disposable timeline QA banquet group and reruns as guarded no-op', async () => {
        const target = await seedQaCleanupGroup(pool, `${suffix}_qa_cleanup`);
        const options = {
            mode: 'marker',
            apply: true,
            confirmation: QA_CLEANUP_CONFIRMATION,
            businessContext: BUSINESS_CONTEXT,
            runId: target.runId,
            groupId: target.groupId,
            primaryBookingId: target.primaryId,
            source: 'timeline_browser_smoke',
            testCustomerMarker: target.marker
        };

        const dryRun = await withClient(pool, client => runQaCleanupDryRun(client, {
            ...options,
            apply: false,
            confirmation: ''
        }));
        assert.equal(dryRun.readOnly, true);
        assert.equal(dryRun.summary.ready, 1);
        assert.equal(dryRun.groups[0].activeBookingIds.length, 2);

        const apply = await withClient(pool, client => runQaCleanupApply(client, options));
        assert.equal(apply.summary.cancelledGroups, 1);
        assert.equal(apply.summary.cancelledBookings, 2);
        assert.equal(apply.after[0].status, 'already_cancelled');

        const statuses = await pool.query(
            `SELECT
                (SELECT status FROM banquet_groups WHERE id = $1) AS group_status,
                ARRAY_AGG(status ORDER BY id) AS booking_statuses,
                (
                    SELECT COUNT(*)::int
                      FROM history
                     WHERE business_context = $2
                       AND action = 'timeline_browser_smoke_qa_cleanup'
                       AND data->>'group_id' = $1
                ) AS history_count
               FROM bookings
              WHERE id = ANY($3::text[])`,
            [target.groupId, BUSINESS_CONTEXT, [target.primaryId, target.kitchenId]]
        );
        assert.equal(statuses.rows[0].group_status, 'cancelled');
        assert.deepEqual(statuses.rows[0].booking_statuses, ['cancelled', 'cancelled']);
        assert.equal(statuses.rows[0].history_count, 1);

        const rerun = await withClient(pool, client => runQaCleanupApply(client, options));
        assert.equal(rerun.summary.cancelledGroups, 0);
        assert.equal(rerun.summary.cancelledBookings, 0);
        assert.equal(rerun.after[0].status, 'already_cancelled');
    });

    test('rolls back membership, link, and history when persistence fails after a real delete', async () => {
        const pair = await seedDetachPair(pool, `${suffix}_rollback`);

        await assert.rejects(
            withClient(pool, client => runDetachApply(client, {
                apply: true,
                confirmation: DETACH_CONFIRMATION,
                businessContext: BUSINESS_CONTEXT,
                pairs: [pair]
            }, {
                persistDetachPair: async (db, inspection, businessContext) => {
                    await persistDetachPair(db, inspection, businessContext);
                    throw new Error('simulated post-persist failure');
                }
            })),
            /simulated post-persist failure/
        );

        const afterRollback = await countRows(pool, pair);
        assert.deepEqual(afterRollback, { memberships: 1, links: 1, history: 0 });
    });

    test('classifies orphan compatibility link separately from clean detached state', async () => {
        const pair = await seedDetachPair(pool, `${suffix}_orphan`, { membership: false });

        const dryRun = await withClient(pool, client => runDetachDryRun(client, {
            businessContext: BUSINESS_CONTEXT,
            pairs: [pair]
        }));
        assert.equal(dryRun.summary.orphanLink, 1);
        assert.equal(dryRun.summary.blocked, 1);
        assert.equal(dryRun.pairs[0].status, 'orphan_link');
        assert.equal(dryRun.pairs[0].reason, 'compatibility_link_without_membership');

        await assert.rejects(
            withClient(pool, client => runDetachApply(client, {
                apply: true,
                confirmation: DETACH_CONFIRMATION,
                businessContext: BUSINESS_CONTEXT,
                pairs: [pair]
            })),
            /compatibility_link_without_membership/
        );

        const afterBlockedApply = await countRows(pool, pair);
        assert.deepEqual(afterBlockedApply, { memberships: 0, links: 1, history: 0 });
    });

    test('classifies wrong booking and group ids as not_found instead of clean detached', async () => {
        const pair = {
            bookingId: compactId('bpr-missing-pinata', suffix),
            groupId: compactId('bpr-missing-group', suffix),
            primaryId: compactId('bpr-missing-primary', suffix)
        };

        const dryRun = await withClient(pool, client => runDetachDryRun(client, {
            businessContext: BUSINESS_CONTEXT,
            pairs: [pair]
        }));
        assert.equal(dryRun.summary.notFound, 1);
        assert.equal(dryRun.summary.alreadyDetachedAndClean, 0);
        assert.equal(dryRun.pairs[0].status, 'not_found');
        assert.equal(dryRun.pairs[0].reason, 'booking_and_group_not_found');
    });
});
