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
    RECONCILE_GROUP_STATE_CONFIRMATION,
    CANCEL_EMPTY_STALE_GROUP_CONFIRMATION,
    persistDetachPair,
    runAudit,
    runDetachApply,
    runDetachDryRun,
    runQaCleanupApply,
    runQaCleanupDryRun,
    runReconcileGroupStateApply,
    runReconcileGroupStateDryRun,
    runRecoveryApply,
    runRecoveryDryRun
} = require('../../scripts/banquet-production-recovery');
const {
    QA_CLEANUP_GROUP_LOCK_NAMESPACE
} = require('../../services/disposableQaCancellation');

const enabled = process.env.RUN_BANQUET_PRODUCTION_RECOVERY_INTEGRATION === 'true';
const BUSINESS_CONTEXT = 'event_genix';
const RELATION_TYPE = 'banquet_activity';
const RECONCILE_HISTORY_ACTION = 'banquet_group_state_reconciled_cancel_stale_group';
const EMPTY_RECONCILE_HISTORY_ACTION = 'banquet_group_state_reconciled_cancel_empty_stale_group';

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

const QA_CLEANUP_CREATED_AT = '2099-08-20T10:00:00.000Z';
const QA_CLEANUP_NOW_MS = Date.parse('2099-08-20T12:00:00.000Z');

function qaCleanupMarker(runId, kind) {
    return {
        disposableQa: {
            schemaVersion: 1,
            runId,
            source: 'timeline_browser_smoke',
            cleanupExpected: true,
            testCustomerMarker: `timeline_browser_smoke:${runId}:test_customer`,
            kind,
            createdAt: QA_CLEANUP_CREATED_AT
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
        price: 350,
        extraData: qaCleanupMarker(runId, 'banquet_activity')
    });
    await insertBooking(pool, kitchenId, {
        customerId,
        lineId: 'banquet-service',
        programId: null,
        programCode: 'KITCHEN',
        label: 'QA kitchen',
        programName: 'QA kitchen',
        category: 'banquet',
        extraData: qaCleanupMarker(runId, 'banquet_kitchen')
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
    await pool.query(
        `INSERT INTO finance_transactions
            (business_context, type, amount, description, date, booking_id, created_by)
         VALUES ($1, 'income', 350, $2, '2099-08-20', $3, 'banquet-recovery-integration')`,
        [BUSINESS_CONTEXT, `Disposable QA ${suffix}`, primaryId]
    );
    return {
        runId,
        groupId,
        primaryId,
        kitchenId,
        marker
    };
}

function qaCleanupOptions(target, overrides = {}) {
    return {
        mode: 'marker',
        apply: true,
        confirmation: QA_CLEANUP_CONFIRMATION,
        businessContext: BUSINESS_CONTEXT,
        runId: target.runId,
        groupId: target.groupId,
        primaryBookingId: target.primaryId,
        expectedBookingIds: [target.primaryId, target.kitchenId].sort(),
        source: 'timeline_browser_smoke',
        testCustomerMarker: target.marker,
        markerClock: { nowMs: QA_CLEANUP_NOW_MS },
        ...overrides
    };
}

async function readQaCleanupState(pool, target, bookingIds = null) {
    const ids = (bookingIds || [target.primaryId, target.kitchenId]).map(String).sort();
    const result = await pool.query(
        `SELECT
            (SELECT status FROM banquet_groups WHERE id = $1) AS group_status,
            ARRAY_AGG(status ORDER BY id) AS booking_statuses,
            (
                SELECT COUNT(*)::int
                  FROM finance_transactions
                 WHERE business_context = $2
                   AND booking_id = ANY($3::text[])
            ) AS finance_count,
            (
                SELECT COUNT(*)::int
                  FROM banquet_deposits
                 WHERE business_context = $2
                   AND (
                       banquet_group_id = $1
                       OR primary_booking_id = ANY($3::text[])
                   )
            ) AS deposit_count,
            (
                SELECT COUNT(*)::int
                  FROM history
                 WHERE business_context = $2
                   AND action = 'timeline_browser_smoke_qa_cleanup'
                   AND data->>'group_id' = $1
            ) AS history_count
           FROM bookings
          WHERE id = ANY($3::text[])`,
        [target.groupId, BUSINESS_CONTEXT, ids]
    );
    return result.rows[0];
}

function assertQaCleanupStateUntouched(state, expectedBookingCount = 2) {
    assert.equal(state.group_status, 'active');
    assert.deepEqual(state.booking_statuses, Array(expectedBookingCount).fill('confirmed'));
    assert.equal(state.finance_count, 1);
    assert.equal(state.history_count, 0);
}

async function seedActiveGroupWithCancelledPrimary(pool, suffix) {
    const customerId = await insertCustomer(pool, suffix);
    const primaryId = compactId('bpr-state-primary', suffix);
    const kitchenId = compactId('bpr-state-kitchen', suffix);
    const groupId = compactId('bpr-state-group', suffix);
    await insertBooking(pool, primaryId, {
        customerId,
        lineId: 'line-primary',
        programId: 'qa-activity',
        programCode: 'QA-ACT',
        label: 'State primary fixture',
        programName: 'State primary fixture',
        category: 'animation',
        status: 'cancelled'
    });
    await insertBooking(pool, kitchenId, {
        customerId,
        lineId: 'banquet-service',
        programId: null,
        programCode: 'KITCHEN',
        label: 'State kitchen fixture',
        programName: 'State kitchen fixture',
        category: 'banquet',
        status: 'confirmed'
    });
    await pool.query(
        `INSERT INTO banquet_groups
            (id, business_context, primary_booking_id, customer_id, date, room, group_name,
             guest_arrival_time, status, source, created_by)
         VALUES ($1, $2, $3, $4, '2099-08-20', 'Room A', $5,
                 '11:45', 'active', 'integration_test', 'banquet-recovery-integration')`,
        [groupId, BUSINESS_CONTEXT, primaryId, customerId, `State ${suffix}`]
    );
    await pool.query(
        `INSERT INTO banquet_group_bookings
            (group_id, business_context, booking_id, role, sort_order, created_by)
         VALUES
            ($1, $2, $3, 'primary', 10, 'banquet-recovery-integration'),
            ($1, $2, $4, 'kitchen', 20, 'banquet-recovery-integration')`,
        [groupId, BUSINESS_CONTEXT, primaryId, kitchenId]
    );
    return { groupId, primaryId, kitchenId, customerId };
}

async function seedEmptyActiveGroupWithCancelledPrimary(pool, suffix) {
    const target = await seedActiveGroupWithCancelledPrimary(pool, suffix);
    await pool.query(
        `UPDATE bookings
            SET status = 'cancelled',
                updated_at = NOW()
          WHERE id = $1
            AND business_context = $2`,
        [target.kitchenId, BUSINESS_CONTEXT]
    );
    await pool.query(
        `DELETE FROM banquet_group_bookings
          WHERE group_id = $1
            AND business_context = $2
            AND booking_id = $3`,
        [target.groupId, BUSINESS_CONTEXT, target.kitchenId]
    );
    return target;
}

async function insertBanquetDeposit(pool, target) {
    await pool.query(
        `INSERT INTO banquet_deposits (
             business_context, banquet_group_id, primary_booking_id, customer_id,
             event_date, amount, status, source_kind, source_payload
         )
         VALUES ($1, $2, $3, $4, '2099-08-20', 100, 'manager_reported', 'integration_test', $5::jsonb)`,
        [
            BUSINESS_CONTEXT,
            target.groupId,
            target.primaryId,
            target.customerId,
            JSON.stringify({ source: 'banquet-production-recovery.integration' })
        ]
    );
}
async function readReconcileApplyState(
    pool,
    target,
    extraBookingIds = [],
    historyAction = RECONCILE_HISTORY_ACTION
) {
    const bookingIds = [target.primaryId, target.kitchenId, ...extraBookingIds].map(String).sort();
    const result = await pool.query(
        `SELECT
            (SELECT status FROM banquet_groups WHERE id = $1) AS group_status,
            COALESCE(
                JSONB_OBJECT_AGG(bookings.id, bookings.status ORDER BY bookings.id)
                    FILTER (WHERE bookings.id IS NOT NULL),
                '{}'::jsonb
            ) AS booking_statuses,
            (
                SELECT COUNT(*)::int
                  FROM banquet_group_bookings membership
                  JOIN bookings member_booking ON member_booking.id = membership.booking_id
                 WHERE membership.business_context = $2
                   AND membership.group_id = $1
                   AND member_booking.id <> $3
                   AND LOWER(COALESCE(NULLIF(BTRIM(member_booking.status), ''), 'confirmed')) <> 'cancelled'
            ) AS active_non_primary_members,
            (
                SELECT COUNT(*)::int
                  FROM history
                 WHERE business_context = $2
                   AND action = $5
                   AND data->>'group_id' = $1
            ) AS history_count
           FROM bookings
          WHERE bookings.id = ANY($4::text[])`,
        [target.groupId, BUSINESS_CONTEXT, target.primaryId, bookingIds, historyAction]
    );
    return result.rows[0];
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

    test('audit classifies active group with cancelled primary as state integrity, not missing deposit', async () => {
        const target = await seedActiveGroupWithCancelledPrimary(pool, `${suffix}_state`);

        const report = await withClient(pool, client => runAudit(client, {
            businessContext: BUSINESS_CONTEXT,
            from: '2099-08-20',
            to: '2099-08-20'
        }));

        assert.equal(report.readOnly, true);
        assert.equal(
            report.depositsForManualReview.some(item => item.groupId === target.groupId),
            false
        );
        assert.ok(report.groupStateIntegrityIssues.some(item => (
            item.groupId === target.groupId
            && item.primaryBookingId === target.primaryId
            && item.issueCode === 'active_group_cancelled_primary'
            && item.groupStatus === 'active'
            && item.primaryStatus === 'cancelled'
            && item.memberCount === 2
            && item.activeMemberCount === 1
        )));
        assert.equal(JSON.stringify(report).includes('customerId'), false);
        assert.equal(JSON.stringify(report).includes('customer_id'), false);
    });

    test('dry-runs stale banquet group reconciliation without mutating records', async () => {
        const target = await seedActiveGroupWithCancelledPrimary(pool, `${suffix}_reconcile_ready`);
        const options = {
            businessContext: BUSINESS_CONTEXT,
            groupId: target.groupId,
            strategy: 'cancel-stale-group',
            expectedClassification: 'active_group_cancelled_primary'
        };

        const first = await withClient(pool, client => runReconcileGroupStateDryRun(client, options));
        assert.equal(first.readOnly, true);
        assert.equal(first.mode, 'reconcile-group-state-dry-run');
        assert.equal(first.result.status, 'ready');
        assert.equal(first.result.classification, 'active_group_cancelled_primary');
        assert.deepEqual(first.result.activeNonPrimaryMemberIds, [target.kitchenId]);

        const second = await withClient(pool, client => runReconcileGroupStateDryRun(client, options));
        assert.equal(second.result.status, 'ready');
        assert.deepEqual(second.summary, first.summary);

        const statuses = await pool.query(
            `SELECT
                (SELECT status FROM banquet_groups WHERE id = $1) AS group_status,
                (SELECT status FROM bookings WHERE id = $3) AS primary_status,
                (SELECT status FROM bookings WHERE id = $4) AS kitchen_status,
                (
                    SELECT COUNT(*)::int
                      FROM history
                     WHERE business_context = $2
                       AND action LIKE 'banquet_group_state_reconciliation%'
                       AND data->>'group_id' = $1
                ) AS history_count
            `,
            [target.groupId, BUSINESS_CONTEXT, target.primaryId, target.kitchenId]
        );
        assert.equal(statuses.rows[0].group_status, 'active');
        assert.equal(statuses.rows[0].primary_status, 'cancelled');
        assert.equal(statuses.rows[0].kitchen_status, 'confirmed');
        assert.equal(statuses.rows[0].history_count, 0);
    });

    test('dry-run blocks stale group reconciliation when active deposit exists', async () => {
        const target = await seedActiveGroupWithCancelledPrimary(pool, `${suffix}_reconcile_deposit`);
        await insertBanquetDeposit(pool, target);

        const report = await withClient(pool, client => runReconcileGroupStateDryRun(client, {
            businessContext: BUSINESS_CONTEXT,
            groupId: target.groupId,
            strategy: 'cancel-stale-group',
            expectedClassification: 'active_group_cancelled_primary'
        }));

        assert.equal(report.readOnly, true);
        assert.equal(report.result.status, 'blocked');
        assert.match(report.result.reason, /active_deposit_rows_present/);
        assert.equal(report.summary.activeDepositRows, 1);
    });

    test('guarded stale group reconciliation apply cancels only allowlisted active member and is idempotent', async () => {
        const target = await seedActiveGroupWithCancelledPrimary(pool, `${suffix}_reconcile_apply`);
        const options = {
            apply: true,
            confirmation: RECONCILE_GROUP_STATE_CONFIRMATION,
            businessContext: BUSINESS_CONTEXT,
            groupId: target.groupId,
            strategy: 'cancel-stale-group',
            expectedClassification: 'active_group_cancelled_primary',
            allowlist: [target.kitchenId]
        };

        const apply = await withClient(pool, client => runReconcileGroupStateApply(client, options));
        assert.equal(apply.mode, 'reconcile-group-state-apply');
        assert.equal(apply.summary.applied, 1);
        assert.equal(apply.summary.cancelledBookings, 1);
        assert.equal(apply.summary.cancelledGroups, 1);
        assert.equal(apply.after.status, 'already_applied');

        const state = await readReconcileApplyState(pool, target);
        assert.equal(state.group_status, 'cancelled');
        assert.equal(state.booking_statuses[target.primaryId], 'cancelled');
        assert.equal(state.booking_statuses[target.kitchenId], 'cancelled');
        assert.equal(state.active_non_primary_members, 0);
        assert.equal(state.history_count, 1);

        const rerun = await withClient(pool, client => runReconcileGroupStateApply(client, options));
        assert.equal(rerun.summary.applied, 0);
        assert.equal(rerun.summary.alreadyApplied, 1);
        assert.equal(rerun.after.status, 'already_applied');

        const afterRerun = await readReconcileApplyState(pool, target);
        assert.equal(afterRerun.history_count, 1);
    });

    test('guarded stale group reconciliation apply blocks changed member set without writes', async () => {
        const target = await seedActiveGroupWithCancelledPrimary(pool, `${suffix}_reconcile_changed_members`);
        const extraId = compactId('bpr-state-extra', `${suffix}_changed_members`);
        await insertBooking(pool, extraId, {
            customerId: target.customerId,
            lineId: 'banquet-service-extra',
            programId: null,
            programCode: 'SERVICE',
            label: 'State extra fixture',
            programName: 'State extra fixture',
            category: 'banquet',
            status: 'confirmed'
        });
        await pool.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by)
             VALUES ($1, $2, $3, 'service', 30, 'banquet-recovery-integration')`,
            [target.groupId, BUSINESS_CONTEXT, extraId]
        );

        await assert.rejects(
            withClient(pool, client => runReconcileGroupStateApply(client, {
                apply: true,
                confirmation: RECONCILE_GROUP_STATE_CONFIRMATION,
                businessContext: BUSINESS_CONTEXT,
                groupId: target.groupId,
                strategy: 'cancel-stale-group',
                expectedClassification: 'active_group_cancelled_primary',
                allowlist: [target.kitchenId]
            })),
            /allowlist_member_set_mismatch/
        );

        const state = await readReconcileApplyState(pool, target, [extraId]);
        assert.equal(state.group_status, 'active');
        assert.equal(state.booking_statuses[target.primaryId], 'cancelled');
        assert.equal(state.booking_statuses[target.kitchenId], 'confirmed');
        assert.equal(state.booking_statuses[extraId], 'confirmed');
        assert.equal(state.active_non_primary_members, 2);
        assert.equal(state.history_count, 0);
    });

    test('guarded stale group reconciliation apply rolls back if technical history insert fails', async () => {
        const target = await seedActiveGroupWithCancelledPrimary(pool, `${suffix}_reconcile_history_rollback`);
        await pool.query(`DROP TRIGGER IF EXISTS bpr_fail_reconcile_history_insert ON history`);
        await pool.query(`DROP FUNCTION IF EXISTS bpr_fail_reconcile_history_insert()`);
        await pool.query(`
            CREATE FUNCTION bpr_fail_reconcile_history_insert()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF NEW.action = 'banquet_group_state_reconciled_cancel_stale_group' THEN
                    RAISE EXCEPTION 'forced reconcile history insert failure';
                END IF;
                RETURN NEW;
            END;
            $$
        `);
        await pool.query(`
            CREATE TRIGGER bpr_fail_reconcile_history_insert
            BEFORE INSERT ON history
            FOR EACH ROW
            EXECUTE FUNCTION bpr_fail_reconcile_history_insert()
        `);
        try {
            await assert.rejects(
                withClient(pool, client => runReconcileGroupStateApply(client, {
                    apply: true,
                    confirmation: RECONCILE_GROUP_STATE_CONFIRMATION,
                    businessContext: BUSINESS_CONTEXT,
                    groupId: target.groupId,
                    strategy: 'cancel-stale-group',
                    expectedClassification: 'active_group_cancelled_primary',
                    allowlist: [target.kitchenId]
                })),
                /forced reconcile history insert failure/
            );
        } finally {
            await pool.query(`DROP TRIGGER IF EXISTS bpr_fail_reconcile_history_insert ON history`);
            await pool.query(`DROP FUNCTION IF EXISTS bpr_fail_reconcile_history_insert()`);
        }

        const state = await readReconcileApplyState(pool, target);
        assert.equal(state.group_status, 'active');
        assert.equal(state.booking_statuses[target.primaryId], 'cancelled');
        assert.equal(state.booking_statuses[target.kitchenId], 'confirmed');
        assert.equal(state.active_non_primary_members, 1);
        assert.equal(state.history_count, 0);
    });

    test('dry-runs empty stale group reconciliation without mutating bookings or group', async () => {
        const target = await seedEmptyActiveGroupWithCancelledPrimary(pool, `${suffix}_empty_dry_run`);
        const options = {
            businessContext: BUSINESS_CONTEXT,
            groupId: target.groupId,
            strategy: 'cancel-empty-stale-group',
            expectedClassification: 'active_group_without_active_members'
        };

        const report = await withClient(pool, client => runReconcileGroupStateDryRun(client, options));
        assert.equal(report.readOnly, true);
        assert.equal(report.result.status, 'ready');
        assert.equal(report.result.classification, 'active_group_without_active_members');
        assert.equal(report.result.activeMemberCount, 0);
        assert.deepEqual(report.result.memberIds, [target.primaryId]);

        const state = await readReconcileApplyState(
            pool,
            target,
            [],
            EMPTY_RECONCILE_HISTORY_ACTION
        );
        assert.equal(state.group_status, 'active');
        assert.equal(state.booking_statuses[target.primaryId], 'cancelled');
        assert.equal(state.booking_statuses[target.kitchenId], 'cancelled');
        assert.equal(state.active_non_primary_members, 0);
        assert.equal(state.history_count, 0);
    });

    test('guarded empty stale group apply cancels only the group and reruns idempotently', async () => {
        const target = await seedEmptyActiveGroupWithCancelledPrimary(pool, `${suffix}_empty_apply`);
        const options = {
            apply: true,
            confirmation: CANCEL_EMPTY_STALE_GROUP_CONFIRMATION,
            businessContext: BUSINESS_CONTEXT,
            groupId: target.groupId,
            strategy: 'cancel-empty-stale-group',
            expectedClassification: 'active_group_without_active_members',
            allowlist: [target.primaryId]
        };

        const apply = await withClient(pool, client => runReconcileGroupStateApply(client, options));
        assert.equal(apply.summary.applied, 1);
        assert.equal(apply.summary.cancelledBookings, 0);
        assert.equal(apply.summary.cancelledGroups, 1);
        assert.equal(apply.after.status, 'already_applied');

        const state = await readReconcileApplyState(
            pool,
            target,
            [],
            EMPTY_RECONCILE_HISTORY_ACTION
        );
        assert.equal(state.group_status, 'cancelled');
        assert.equal(state.booking_statuses[target.primaryId], 'cancelled');
        assert.equal(state.booking_statuses[target.kitchenId], 'cancelled');
        assert.equal(state.active_non_primary_members, 0);
        assert.equal(state.history_count, 1);

        const rerun = await withClient(pool, client => runReconcileGroupStateApply(client, options));
        assert.equal(rerun.summary.applied, 0);
        assert.equal(rerun.summary.alreadyApplied, 1);
        assert.equal(rerun.after.status, 'already_applied');

        const afterRerun = await readReconcileApplyState(
            pool,
            target,
            [],
            EMPTY_RECONCILE_HISTORY_ACTION
        );
        assert.equal(afterRerun.history_count, 1);
    });

    test('empty stale group dry-run blocks active members, deposits, ticket snapshots, and finance transactions', async () => {
        const optionsFor = target => ({
            businessContext: BUSINESS_CONTEXT,
            groupId: target.groupId,
            strategy: 'cancel-empty-stale-group',
            expectedClassification: 'active_group_without_active_members'
        });

        const activeTarget = await seedEmptyActiveGroupWithCancelledPrimary(pool, `${suffix}_empty_active_block`);
        await pool.query(
            `UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
            [activeTarget.kitchenId]
        );
        await pool.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by)
             VALUES ($1, $2, $3, 'kitchen', 20, 'banquet-recovery-integration')`,
            [activeTarget.groupId, BUSINESS_CONTEXT, activeTarget.kitchenId]
        );
        const activeBlocked = await withClient(
            pool,
            client => runReconcileGroupStateDryRun(client, optionsFor(activeTarget))
        );
        assert.match(activeBlocked.result.reason, /active_members_present/);

        const depositTarget = await seedEmptyActiveGroupWithCancelledPrimary(pool, `${suffix}_empty_deposit_block`);
        await insertBanquetDeposit(pool, depositTarget);
        const depositBlocked = await withClient(
            pool,
            client => runReconcileGroupStateDryRun(client, optionsFor(depositTarget))
        );
        assert.match(depositBlocked.result.reason, /active_deposit_rows_present/);

        const ticketTarget = await seedEmptyActiveGroupWithCancelledPrimary(pool, `${suffix}_empty_ticket_block`);
        await pool.query(
            `UPDATE bookings
                SET extra_data = $2::jsonb,
                    updated_at = NOW()
              WHERE id = $1`,
            [ticketTarget.primaryId, JSON.stringify({ ticketLines: [{ id: 'fixture-ticket' }] })]
        );
        const ticketBlocked = await withClient(
            pool,
            client => runReconcileGroupStateDryRun(client, optionsFor(ticketTarget))
        );
        assert.match(ticketBlocked.result.reason, /ticket_ownership_conflict/);

        const financeTarget = await seedEmptyActiveGroupWithCancelledPrimary(pool, `${suffix}_empty_finance_block`);
        await pool.query(
            `INSERT INTO finance_transactions
                (business_context, type, amount, description, date, booking_id, created_by)
             VALUES ($1, 'income', 100, 'Empty stale blocker fixture', '2099-08-20', $2,
                     'banquet-recovery-integration')`,
            [BUSINESS_CONTEXT, financeTarget.primaryId]
        );
        const financeBlocked = await withClient(
            pool,
            client => runReconcileGroupStateDryRun(client, optionsFor(financeTarget))
        );
        assert.match(financeBlocked.result.reason, /finance_transaction_conflict/);
    });

    test('empty stale group apply blocks a changed full member set without writes', async () => {
        const target = await seedEmptyActiveGroupWithCancelledPrimary(pool, `${suffix}_empty_member_change`);
        const extraId = compactId('bpr-empty-cancelled-extra', `${suffix}_empty_member_change`);
        await insertBooking(pool, extraId, {
            customerId: target.customerId,
            lineId: 'banquet-service-extra',
            programId: null,
            programCode: 'SERVICE',
            label: 'Empty stale cancelled member',
            programName: 'Empty stale cancelled member',
            category: 'banquet',
            status: 'cancelled'
        });
        await pool.query(
            `INSERT INTO banquet_group_bookings
                (group_id, business_context, booking_id, role, sort_order, created_by)
             VALUES ($1, $2, $3, 'service', 30, 'banquet-recovery-integration')`,
            [target.groupId, BUSINESS_CONTEXT, extraId]
        );

        await assert.rejects(
            withClient(pool, client => runReconcileGroupStateApply(client, {
                apply: true,
                confirmation: CANCEL_EMPTY_STALE_GROUP_CONFIRMATION,
                businessContext: BUSINESS_CONTEXT,
                groupId: target.groupId,
                strategy: 'cancel-empty-stale-group',
                expectedClassification: 'active_group_without_active_members',
                allowlist: [target.primaryId]
            })),
            /allowlist_member_set_mismatch/
        );

        const state = await readReconcileApplyState(
            pool,
            target,
            [extraId],
            EMPTY_RECONCILE_HISTORY_ACTION
        );
        assert.equal(state.group_status, 'active');
        assert.equal(state.booking_statuses[extraId], 'cancelled');
        assert.equal(state.history_count, 0);
    });

    test('empty stale group apply rolls back group cancellation when history insert fails', async () => {
        const target = await seedEmptyActiveGroupWithCancelledPrimary(pool, `${suffix}_empty_history_rollback`);
        await pool.query(`DROP TRIGGER IF EXISTS bpr_fail_empty_reconcile_history_insert ON history`);
        await pool.query(`DROP FUNCTION IF EXISTS bpr_fail_empty_reconcile_history_insert()`);
        await pool.query(`
            CREATE FUNCTION bpr_fail_empty_reconcile_history_insert()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF NEW.action = 'banquet_group_state_reconciled_cancel_empty_stale_group' THEN
                    RAISE EXCEPTION 'forced empty reconcile history insert failure';
                END IF;
                RETURN NEW;
            END;
            $$
        `);
        await pool.query(`
            CREATE TRIGGER bpr_fail_empty_reconcile_history_insert
            BEFORE INSERT ON history
            FOR EACH ROW
            EXECUTE FUNCTION bpr_fail_empty_reconcile_history_insert()
        `);
        try {
            await assert.rejects(
                withClient(pool, client => runReconcileGroupStateApply(client, {
                    apply: true,
                    confirmation: CANCEL_EMPTY_STALE_GROUP_CONFIRMATION,
                    businessContext: BUSINESS_CONTEXT,
                    groupId: target.groupId,
                    strategy: 'cancel-empty-stale-group',
                    expectedClassification: 'active_group_without_active_members',
                    allowlist: [target.primaryId]
                })),
                /forced empty reconcile history insert failure/
            );
        } finally {
            await pool.query(`DROP TRIGGER IF EXISTS bpr_fail_empty_reconcile_history_insert ON history`);
            await pool.query(`DROP FUNCTION IF EXISTS bpr_fail_empty_reconcile_history_insert()`);
        }

        const state = await readReconcileApplyState(
            pool,
            target,
            [],
            EMPTY_RECONCILE_HISTORY_ACTION
        );
        assert.equal(state.group_status, 'active');
        assert.equal(state.booking_statuses[target.primaryId], 'cancelled');
        assert.equal(state.history_count, 0);
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
            expectedBookingIds: [target.primaryId, target.kitchenId].sort(),
            source: 'timeline_browser_smoke',
            testCustomerMarker: target.marker,
            markerClock: { nowMs: QA_CLEANUP_NOW_MS }
        };

        const dryRun = await withClient(pool, client => runQaCleanupDryRun(client, {
            ...options,
            apply: false,
            confirmation: ''
        }));
        assert.equal(dryRun.readOnly, true);
        assert.equal(dryRun.summary.ready, 1);
        assert.equal(dryRun.groups[0].activeBookingIds.length, 2);
        assert.equal(dryRun.groups[0].removableFinanceTransactionCount, 1);

        const apply = await withClient(pool, client => runQaCleanupApply(client, options));
        assert.equal(apply.summary.cancelledGroups, 1);
        assert.equal(apply.summary.cancelledBookings, 2);
        assert.equal(apply.after[0].status, 'already_cancelled_clean');

        const statuses = await pool.query(
            `SELECT
                (SELECT status FROM banquet_groups WHERE id = $1) AS group_status,
                ARRAY_AGG(status ORDER BY id) AS booking_statuses,
                (
                    SELECT COUNT(*)::int
                      FROM finance_transactions
                     WHERE business_context = $2
                       AND booking_id = ANY($3::text[])
                ) AS finance_count,
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
        assert.equal(statuses.rows[0].finance_count, 0);
        assert.equal(statuses.rows[0].history_count, 1);

        const rerun = await withClient(pool, client => runQaCleanupApply(client, options));
        assert.equal(rerun.summary.cancelledGroups, 0);
        assert.equal(rerun.summary.cancelledBookings, 0);
        assert.equal(rerun.after[0].status, 'already_cancelled_clean');
    });

    test('rolls back the full disposable QA group when strict finance synchronization fails', async () => {
        const target = await seedQaCleanupGroup(pool, `${suffix}_qa_finance_rollback`);
        const options = {
            mode: 'marker',
            apply: true,
            confirmation: QA_CLEANUP_CONFIRMATION,
            businessContext: BUSINESS_CONTEXT,
            runId: target.runId,
            groupId: target.groupId,
            primaryBookingId: target.primaryId,
            expectedBookingIds: [target.primaryId, target.kitchenId].sort(),
            source: 'timeline_browser_smoke',
            testCustomerMarker: target.marker,
            markerClock: { nowMs: QA_CLEANUP_NOW_MS }
        };

        await assert.rejects(
            withClient(pool, client => runQaCleanupApply(client, options, {
                syncBookingFinanceInTransaction: async () => {
                    throw new Error('simulated strict finance failure');
                }
            })),
            /simulated strict finance failure/
        );

        const state = await pool.query(
            `SELECT
                (SELECT status FROM banquet_groups WHERE id = $1) AS group_status,
                ARRAY_AGG(status ORDER BY id) AS booking_statuses,
                (
                    SELECT COUNT(*)::int
                      FROM finance_transactions
                     WHERE business_context = $2
                       AND booking_id = ANY($3::text[])
                ) AS finance_count,
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
        assert.equal(state.rows[0].group_status, 'active');
        assert.deepEqual(state.rows[0].booking_statuses, ['confirmed', 'confirmed']);
        assert.equal(state.rows[0].finance_count, 1);
        assert.equal(state.rows[0].history_count, 0);
    });

    test('blocks missing marker without changing bookings, finance, group, or history', async () => {
        const target = await seedQaCleanupGroup(pool, `${suffix}_qa_missing_marker`);
        const options = qaCleanupOptions(target);
        await pool.query(
            `UPDATE bookings
                SET extra_data = '{}'::jsonb
              WHERE id = $1`,
            [target.kitchenId]
        );

        const dryRun = await withClient(pool, client => runQaCleanupDryRun(client, {
            ...options,
            apply: false,
            confirmation: ''
        }));
        assert.equal(dryRun.groups[0].status, 'marker_mismatch');
        assert.match(dryRun.groups[0].reason, /missing_marker/);
        await assert.rejects(
            withClient(pool, client => runQaCleanupApply(client, options)),
            error => error?.code === 'DISPOSABLE_QA_PREFLIGHT_BLOCKED'
        );

        assertQaCleanupStateUntouched(await readQaCleanupState(pool, target));
    });

    test('blocks a foreign customer without partially cancelling the group', async () => {
        const target = await seedQaCleanupGroup(pool, `${suffix}_qa_foreign_customer`);
        const foreignCustomerId = await insertCustomer(pool, `${suffix}_qa_foreign`);
        const options = qaCleanupOptions(target);
        await pool.query(
            `UPDATE bookings
                SET customer_id = $1
              WHERE id = $2`,
            [foreignCustomerId, target.kitchenId]
        );

        const dryRun = await withClient(pool, client => runQaCleanupDryRun(client, {
            ...options,
            apply: false,
            confirmation: ''
        }));
        assert.equal(dryRun.groups[0].status, 'real_customer_blocked');
        assert.match(dryRun.groups[0].reason, /group_customer_mismatch|customer_marker_missing/);
        await assert.rejects(
            withClient(pool, client => runQaCleanupApply(client, options)),
            error => error?.code === 'DISPOSABLE_QA_PREFLIGHT_BLOCKED'
        );

        assertQaCleanupStateUntouched(await readQaCleanupState(pool, target));
    });

    test('blocks an unmarked linked child and never broad-cancels it', async () => {
        const target = await seedQaCleanupGroup(pool, `${suffix}_qa_unmarked_child`);
        const childId = compactId('bpr-qa-child', `${suffix}_qa_unmarked_child`);
        await insertBooking(pool, childId, {
            customerId: (
                await pool.query('SELECT customer_id FROM banquet_groups WHERE id = $1', [target.groupId])
            ).rows[0].customer_id,
            lineId: 'line-linked-child',
            programId: 'qa-child',
            programCode: 'QA-CHILD',
            label: 'Unmarked QA child',
            programName: 'Unmarked QA child',
            category: 'animation',
            price: 0,
            extraData: {}
        });
        await pool.query(
            'UPDATE bookings SET linked_to = $1 WHERE id = $2',
            [target.primaryId, childId]
        );
        const options = qaCleanupOptions(target, {
            expectedBookingIds: [target.primaryId, target.kitchenId, childId].sort()
        });

        const dryRun = await withClient(pool, client => runQaCleanupDryRun(client, {
            ...options,
            apply: false,
            confirmation: ''
        }));
        assert.equal(dryRun.groups[0].status, 'unmarked_child');
        assert.match(dryRun.groups[0].reason, /missing_marker/);
        await assert.rejects(
            withClient(pool, client => runQaCleanupApply(client, options)),
            error => error?.code === 'DISPOSABLE_QA_PREFLIGHT_BLOCKED'
        );

        assertQaCleanupStateUntouched(
            await readQaCleanupState(pool, target, options.expectedBookingIds),
            3
        );
    });

    test('blocks a canonical banquet deposit and preserves every dependency', async () => {
        const target = await seedQaCleanupGroup(pool, `${suffix}_qa_deposit`);
        const options = qaCleanupOptions(target);
        const customerId = (
            await pool.query('SELECT customer_id FROM banquet_groups WHERE id = $1', [target.groupId])
        ).rows[0].customer_id;
        await pool.query(
            `INSERT INTO banquet_deposits
                (business_context, banquet_group_id, primary_booking_id, customer_id,
                 event_date, amount, status, source_kind)
             VALUES ($1, $2, $3, $4, '2099-08-20', 2000, 'manager_reported', 'integration_test')`,
            [BUSINESS_CONTEXT, target.groupId, target.primaryId, customerId]
        );

        const dryRun = await withClient(pool, client => runQaCleanupDryRun(client, {
            ...options,
            apply: false,
            confirmation: ''
        }));
        assert.equal(dryRun.groups[0].status, 'financial_dependencies_present');
        assert.equal(dryRun.groups[0].depositCount, 1);
        await assert.rejects(
            withClient(pool, client => runQaCleanupApply(client, options)),
            error => error?.code === 'DISPOSABLE_QA_PREFLIGHT_BLOCKED'
        );

        const state = await readQaCleanupState(pool, target);
        assertQaCleanupStateUntouched(state);
        assert.equal(state.deposit_count, 1);
    });

    test('wrong run and group ids are blocked without mutation or audit history', async () => {
        const target = await seedQaCleanupGroup(pool, `${suffix}_qa_wrong_ids`);
        const wrongRun = qaCleanupOptions(target, { runId: `${target.runId}-wrong` });
        const wrongRunDry = await withClient(pool, client => runQaCleanupDryRun(client, {
            ...wrongRun,
            apply: false,
            confirmation: ''
        }));
        assert.equal(wrongRunDry.groups[0].status, 'marker_mismatch');
        assert.match(wrongRunDry.groups[0].reason, /run_id_mismatch/);
        await assert.rejects(
            withClient(pool, client => runQaCleanupApply(client, wrongRun)),
            error => error?.code === 'DISPOSABLE_QA_PREFLIGHT_BLOCKED'
        );

        const wrongGroup = qaCleanupOptions(target, {
            groupId: compactId('bpr-qa-missing-group', suffix)
        });
        const wrongGroupDry = await withClient(pool, client => runQaCleanupDryRun(client, {
            ...wrongGroup,
            apply: false,
            confirmation: ''
        }));
        assert.equal(wrongGroupDry.groups[0].status, 'not_found');
        await assert.rejects(
            withClient(pool, client => runQaCleanupApply(client, wrongGroup)),
            error => error?.code === 'DISPOSABLE_QA_PREFLIGHT_BLOCKED'
        );

        assertQaCleanupStateUntouched(await readQaCleanupState(pool, target));
    });

    test('group advisory lock serializes a concurrent cleanup attempt', async () => {
        const target = await seedQaCleanupGroup(pool, `${suffix}_qa_locked`);
        const options = qaCleanupOptions(target);
        const blocker = await pool.connect();
        let settled = false;
        let applyPromise;
        try {
            await blocker.query('BEGIN');
            await blocker.query(
                'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
                [`${QA_CLEANUP_GROUP_LOCK_NAMESPACE}:${BUSINESS_CONTEXT}:${target.groupId}`]
            );
            applyPromise = withClient(pool, client => runQaCleanupApply(client, options));
            void applyPromise.then(
                () => { settled = true; },
                () => { settled = true; }
            );
            await new Promise(resolve => setTimeout(resolve, 150));
            assert.equal(settled, false, 'cleanup waits for the group-scoped advisory lock');
        } finally {
            await blocker.query('COMMIT').catch(() => blocker.query('ROLLBACK').catch(() => {}));
            blocker.release();
        }

        const apply = await applyPromise;
        assert.equal(apply.summary.cancelledGroups, 1);
        assert.equal(apply.after[0].status, 'already_cancelled_clean');
        const state = await readQaCleanupState(pool, target);
        assert.equal(state.group_status, 'cancelled');
        assert.deepEqual(state.booking_statuses, ['cancelled', 'cancelled']);
        assert.equal(state.finance_count, 0);
        assert.equal(state.history_count, 1);
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
