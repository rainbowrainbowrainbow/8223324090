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

    return { username, bookingId, groupId, storageKey };
}

async function assertWave1SentinelDataPreserved(pool, sentinel) {
    const result = await pool.query(
        `SELECT
            (SELECT action_allowlist FROM users WHERE username = $1) AS action_allowlist,
            (SELECT action_denylist FROM users WHERE username = $1) AS action_denylist,
            (SELECT COUNT(*)::int FROM banquet_groups WHERE id = $2) AS banquet_groups,
            (SELECT COUNT(*)::int FROM banquet_group_bookings WHERE group_id = $2 AND booking_id = $3) AS banquet_memberships,
            (SELECT COUNT(*)::int FROM profile_avatar_blobs WHERE storage_key = $4) AS profile_avatar_blobs`,
        [sentinel.username, sentinel.groupId, sentinel.bookingId, sentinel.storageKey]
    );
    assert.deepEqual(result.rows[0], {
        action_allowlist: ['tasks.create'],
        action_denylist: ['export_data'],
        banquet_groups: 1,
        banquet_memberships: 1,
        profile_avatar_blobs: 1
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
                    to_regclass('public.idx_profile_avatar_blobs_created_at_desc') IS NOT NULL AS profile_avatar_blobs_created_at_desc_index
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
                profile_avatar_blobs_created_at_desc_index: true
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
