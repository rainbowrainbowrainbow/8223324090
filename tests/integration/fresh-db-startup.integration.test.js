'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { pool: appPool, initDatabase } = require('../../db');
const { runMigrations } = require('../../db/migrate');
const {
    lockSchemaMigrations,
    unlockSchemaMigrations
} = require('../../services/backupSchemaLock');

const enabled = process.env.RUN_FRESH_DB_STARTUP_INTEGRATION === 'true';
const root = path.resolve(__dirname, '..', '..');

function uniqueId(prefix) {
    return `${prefix}_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function runSchemaFencedStartup() {
    const guardClient = await appPool.connect();
    let schemaLockHeld = false;
    try {
        await lockSchemaMigrations(guardClient);
        schemaLockHeld = true;
        await initDatabase();
        await runMigrations(appPool, { schemaLockAlreadyHeld: true });
        await initDatabase();
    } finally {
        if (schemaLockHeld) await unlockSchemaMigrations(guardClient);
        guardClient.release();
    }
}

async function insertWave1SentinelData(pool) {
    const suffix = uniqueId('wave1');
    const username = `user_${suffix}`;
    const bookingId = `BK-${suffix}`;
    const groupId = `BQ-${suffix}`;
    const roomResourceId = `room-${suffix}`;
    const storageKey = `profile-avatars/${username}.png`;
    const taskSourceId = `task-source-${suffix}`;
    const contractorInvite = `invite-${suffix}`;

    await pool.query(
        `INSERT INTO users (username, password_hash, role, name, action_allowlist, action_denylist)
         VALUES ($1, $2, $3, $4, $5::text[], $6::text[])`,
        [username, 'test-hash', 'manager', 'Wave 1 User', ['tasks.create'], ['export_data']]
    );
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO bookings (id, date, time, line_id, room, room_resource_id, program_id, label, program_name, category, duration, price, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [bookingId, '2099-01-01', '10:00', 'wave1-line', 'Wave Room', roomResourceId, null, 'Wave 1', 'Wave 1', 'banquet', 60, 0, 'wave1']
        );
        await client.query(
            `INSERT INTO banquet_groups (id, business_context, primary_booking_id, date, room, room_resource_id, guest_arrival_time, group_name, status, source, meta, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
            [groupId, 'event_genix', bookingId, '2099-01-01', 'Wave Room', roomResourceId, '10:00', 'Wave 1 Group', 'active', 'test', '{"sentinel":true}', 'wave1']
        );
        await client.query(
            `INSERT INTO banquet_group_bookings (group_id, business_context, booking_id, role, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [groupId, 'event_genix', bookingId, 'primary', 10, 'wave1']
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
    await pool.query(
        `INSERT INTO profile_avatar_blobs (username, storage_key, original_name, content_type, file_size, data, checksum_sha256)
         VALUES ($1, $2, $3, $4, $5, decode($6, 'hex'), $7)`,
        [username, storageKey, 'avatar.png', 'image/png', 1, '00', '00']
    );
    const task = await pool.query(
        `INSERT INTO tasks (
            title, status, created_by, business_context, source_type, source_id,
            deadline, dependency_ids, task_type, owner, control_policy, escalation_level
         )
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 day', $7::integer[], $8, $9, $10::jsonb, $11)
         RETURNING id`,
        [
            `Task 22 ${suffix}`,
            'todo',
            username,
            'event_genix',
            'task22_startup_contract',
            taskSourceId,
            [],
            'human',
            username,
            '{"reminder_minutes":[60],"escalation_after_minutes":120}',
            1
        ]
    );
    const taskId = task.rows[0].id;
    await pool.query(
        `INSERT INTO task_logs (task_id, action, old_value, new_value, actor)
         VALUES ($1, $2, $3, $4, $5)`,
        [taskId, 'created', null, 'task22', username]
    );
    await pool.query(
        `INSERT INTO user_points (username, permanent_points, monthly_points, month)
         VALUES ($1, $2, $3, $4)`,
        [username, 7, 3, '2099-01']
    );
    await pool.query(
        `INSERT INTO point_transactions (username, points, type, reason, task_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [username, 3, 'monthly', 'task22 sentinel', taskId]
    );
    await pool.query(
        `INSERT INTO user_action_log (username, action, target, meta)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [username, 'task22_sentinel', 'db_startup', '{"sentinel":true}']
    );
    await pool.query(
        `INSERT INTO user_streaks (username, current_streak, longest_streak, last_active_date)
         VALUES ($1, $2, $3, $4)`,
        [username, 1, 2, '2099-01-01']
    );
    await pool.query(
        `INSERT INTO kleshnya_messages (scope, target_date, target_user, message, context, source, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW() + INTERVAL '1 day')`,
        ['task22_sentinel', '2099-01-01', username, 'sentinel', '{"sentinel":true}', 'test']
    );
    const contractor = await pool.query(
        `INSERT INTO contractors (name, phone, telegram_username, invite_token, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [`Contractor ${suffix}`, null, null, contractorInvite, true]
    );
    await pool.query(
        `INSERT INTO contractor_notifications (contractor_id, booking_id, rule_id, message_id, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [contractor.rows[0].id, bookingId, null, 1, 'sent']
    );

    return { username, bookingId, groupId, storageKey, taskId, taskSourceId, contractorInvite };
}

async function assertWave1SentinelDataPreserved(pool, sentinel) {
    const result = await pool.query(
        `SELECT
            (SELECT action_allowlist FROM users WHERE username = $1) AS action_allowlist,
            (SELECT action_denylist FROM users WHERE username = $1) AS action_denylist,
            (SELECT COUNT(*)::int FROM banquet_groups WHERE id = $2) AS banquet_groups,
            (SELECT COUNT(*)::int FROM banquet_group_bookings WHERE group_id = $2 AND booking_id = $3) AS banquet_memberships,
            (SELECT COUNT(*)::int FROM profile_avatar_blobs WHERE storage_key = $4) AS profile_avatar_blobs,
            (SELECT COUNT(*)::int FROM tasks WHERE id = $5 AND source_id = $6 AND dependency_ids = '{}'::integer[]) AS task22_tasks,
            (SELECT COUNT(*)::int FROM task_logs WHERE task_id = $5 AND action = 'created') AS task_logs,
            (SELECT COUNT(*)::int FROM user_points WHERE username = $1 AND month = '2099-01') AS user_points,
            (SELECT COUNT(*)::int FROM point_transactions WHERE username = $1 AND task_id = $5) AS point_transactions,
            (SELECT COUNT(*)::int FROM user_action_log WHERE username = $1 AND action = 'task22_sentinel') AS user_action_log,
            (SELECT COUNT(*)::int FROM user_streaks WHERE username = $1) AS user_streaks,
            (SELECT COUNT(*)::int FROM kleshnya_messages WHERE target_user = $1 AND scope = 'task22_sentinel') AS kleshnya_messages,
            (SELECT COUNT(*)::int
               FROM contractor_notifications cn
               JOIN contractors c ON c.id = cn.contractor_id
              WHERE c.invite_token = $7 AND cn.booking_id = $3) AS contractor_notifications`,
        [
            sentinel.username,
            sentinel.groupId,
            sentinel.bookingId,
            sentinel.storageKey,
            sentinel.taskId,
            sentinel.taskSourceId,
            sentinel.contractorInvite
        ]
    );
    assert.deepEqual(result.rows[0], {
        action_allowlist: ['tasks.create'],
        action_denylist: ['export_data'],
        banquet_groups: 1,
        banquet_memberships: 1,
        profile_avatar_blobs: 1,
        task22_tasks: 1,
        task_logs: 1,
        user_points: 1,
        point_transactions: 1,
        user_action_log: 1,
        user_streaks: 1,
        kleshnya_messages: 1,
        contractor_notifications: 1
    });
}

after(async () => {
    await appPool.end().catch(() => {});
});

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_FRESH_DB_STARTUP_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
}

describe('fresh PostgreSQL startup contract', { skip: !enabled }, () => {
    it('applies every migration and leaves the dependent schema ready after one startup', async () => {
        const testDb = requireIsolatedDatabase();
        const pool = new Pool({
            connectionString: testDb.url.toString(),
            ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
            max: 2
        });
        try {
            const expectedVersions = fs.readdirSync(path.join(root, 'db', 'migrations'))
                .filter(file => file.endsWith('.sql'))
                .map(file => file.slice(0, -4));
            const ledger = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
            const appliedVersions = new Set(ledger.rows.map(row => row.version));
            const missingVersions = expectedVersions.filter(version => !appliedVersions.has(version));
            assert.deepEqual(missingVersions, [], 'fresh startup applies every SQL migration');
            assert.equal(appliedVersions.has('244_user_action_permission_overrides'), true);
            assert.equal(appliedVersions.has('261_leads_customer_card_canonical_customers'), true);
            assert.equal(appliedVersions.has('265_banquet_groups'), true);
            assert.equal(appliedVersions.has('266_profile_avatar_postgres_storage'), true);
            assert.equal(appliedVersions.has('274_add_leads_updated_at'), true);
            assert.equal(appliedVersions.has('340_db_startup_schema_ownership'), true);

            const schema = await pool.query(`
                SELECT
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'leads'
                          AND column_name = 'updated_at'
                    ) AS leads_updated_at,
                    to_regclass('public.procurement_lists') IS NOT NULL AS procurement_lists,
                    to_regclass('public.procurement_items') IS NOT NULL AS procurement_items,
                    to_regclass('public.idx_procurement_lists_status') IS NOT NULL AS procurement_lists_status_index,
                    to_regclass('public.idx_procurement_items_list') IS NOT NULL AS procurement_items_list_index,
                    to_regclass('public.idx_procurement_items_stock') IS NOT NULL AS procurement_items_stock_index,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'users'
                          AND column_name = 'action_allowlist'
                    ) AS users_action_allowlist,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'users'
                          AND column_name = 'action_denylist'
                    ) AS users_action_denylist,
                    to_regclass('public.idx_users_action_allowlist_gin') IS NOT NULL AS users_action_allowlist_index,
                    to_regclass('public.idx_users_action_denylist_gin') IS NOT NULL AS users_action_denylist_index,
                    to_regclass('public.banquet_groups') IS NOT NULL AS banquet_groups,
                    to_regclass('public.banquet_group_bookings') IS NOT NULL AS banquet_group_bookings,
                    to_regclass('public.idx_banquet_groups_business_date') IS NOT NULL AS banquet_groups_business_date_index,
                    to_regclass('public.idx_banquet_groups_primary_booking') IS NOT NULL AS banquet_groups_primary_booking_index,
                    to_regclass('public.idx_banquet_group_bookings_group') IS NOT NULL AS banquet_group_bookings_group_index,
                    to_regclass('public.idx_banquet_group_bookings_booking') IS NOT NULL AS banquet_group_bookings_booking_index,
                    to_regclass('public.profile_avatar_blobs') IS NOT NULL AS profile_avatar_blobs,
                    to_regclass('public.idx_profile_avatar_blobs_username') IS NOT NULL AS profile_avatar_blobs_username_index,
                    to_regclass('public.idx_profile_avatar_blobs_created_at_desc') IS NOT NULL AS profile_avatar_blobs_created_at_desc_index,
                    to_regclass('public.task_logs') IS NOT NULL AS task_logs,
                    to_regclass('public.user_points') IS NOT NULL AS user_points,
                    to_regclass('public.point_transactions') IS NOT NULL AS point_transactions,
                    to_regclass('public.user_action_log') IS NOT NULL AS user_action_log,
                    to_regclass('public.user_streaks') IS NOT NULL AS user_streaks,
                    to_regclass('public.kleshnya_messages') IS NOT NULL AS kleshnya_messages,
                    to_regclass('public.design_tags') IS NOT NULL AS design_tags,
                    to_regclass('public.contractor_notifications') IS NOT NULL AS contractor_notifications,
                    to_regclass('public.idx_task_logs_task_id') IS NOT NULL AS task_logs_task_id_index,
                    to_regclass('public.idx_user_points_username') IS NOT NULL AS user_points_username_index,
                    to_regclass('public.idx_kleshnya_messages_scope') IS NOT NULL AS kleshnya_messages_scope_index,
                    to_regclass('public.idx_contractor_notif_contractor') IS NOT NULL AS contractor_notif_contractor_index,
                    to_regclass('public.idx_tasks_deadline') IS NOT NULL AS tasks_deadline_index,
                    to_regclass('public.idx_finance_transactions_type') IS NOT NULL AS finance_transactions_type_index,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'users'
                          AND column_name = 'telegram_chat_id'
                    ) AS users_telegram_chat_id,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'bookings'
                          AND column_name = 'skip_notification'
                    ) AS bookings_skip_notification,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'certificates'
                          AND column_name = 'value_uah'
                    ) AS certificates_value_uah,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'tasks'
                          AND column_name = 'control_policy'
                    ) AS tasks_control_policy
            `);
            assert.deepEqual(schema.rows[0], {
                leads_updated_at: true,
                procurement_lists: true,
                procurement_items: true,
                procurement_lists_status_index: true,
                procurement_items_list_index: true,
                procurement_items_stock_index: true,
                users_action_allowlist: true,
                users_action_denylist: true,
                users_action_allowlist_index: true,
                users_action_denylist_index: true,
                banquet_groups: true,
                banquet_group_bookings: true,
                banquet_groups_business_date_index: true,
                banquet_groups_primary_booking_index: true,
                banquet_group_bookings_group_index: true,
                banquet_group_bookings_booking_index: true,
                profile_avatar_blobs: true,
                profile_avatar_blobs_username_index: true,
                profile_avatar_blobs_created_at_desc_index: true,
                task_logs: true,
                user_points: true,
                point_transactions: true,
                user_action_log: true,
                user_streaks: true,
                kleshnya_messages: true,
                design_tags: true,
                contractor_notifications: true,
                task_logs_task_id_index: true,
                user_points_username_index: true,
                kleshnya_messages_scope_index: true,
                contractor_notif_contractor_index: true,
                tasks_deadline_index: true,
                finance_transactions_type_index: true,
                users_telegram_chat_id: true,
                bookings_skip_notification: true,
                certificates_value_uah: true,
                tasks_control_policy: true
            });

            const sentinel = await insertWave1SentinelData(pool);
            await Promise.all([
                runSchemaFencedStartup(),
                runSchemaFencedStartup()
            ]);
            await assertWave1SentinelDataPreserved(pool, sentinel);
        } finally {
            await pool.end();
        }
    });
});
