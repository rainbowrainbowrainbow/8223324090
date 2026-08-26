'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    STARTUP_SCHEMA_TABLES,
    STARTUP_SCHEMA_COLUMNS,
    STARTUP_SCHEMA_INDEXES,
    STARTUP_SCHEMA_FUNCTIONS,
    STARTUP_SCHEMA_TRIGGERS,
    TASK22_BASELINE_STARTUP_SCHEMA,
    DB_STARTUP_SCHEMA_OWNERSHIP_MATRIX
} = require('../config/dbStartupSurface');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function stripSqlComments(sql) {
    return sql
        .split(/\r?\n/)
        .filter(line => !line.trimStart().startsWith('--'))
        .join('\n');
}

const dbIndex = read('db/index.js');
const migration244 = read('db/migrations/244_user_action_permission_overrides.sql');
const migration265 = read('db/migrations/265_banquet_groups.sql');
const migration266 = read('db/migrations/266_profile_avatar_postgres_storage.sql');
const migration340 = read('db/migrations/340_db_startup_schema_ownership.sql');
const startupDoc = read('docs/DB_STARTUP_SURFACE.md');

test('DB startup Task 22 keeps only proven pre-migration compatibility schema', () => {
    assert.equal(STARTUP_SCHEMA_TABLES.length, 14);
    assert.equal(STARTUP_SCHEMA_COLUMNS.length, 7);
    assert.equal(STARTUP_SCHEMA_INDEXES.length, 0);
    assert.equal(STARTUP_SCHEMA_FUNCTIONS.length, 0);
    assert.equal(STARTUP_SCHEMA_TRIGGERS.length, 0);

    for (const table of [
        'banquet_groups',
        'banquet_group_bookings',
        'profile_avatar_blobs',
        'task_logs',
        'user_points',
        'point_transactions',
        'user_action_log',
        'user_streaks',
        'kleshnya_messages',
        'design_tags',
        'contractor_notifications'
    ]) {
        assert.equal(STARTUP_SCHEMA_TABLES.includes(table), false, `${table} must not remain startup-owned`);
    }

    for (const column of [
        'users.action_allowlist',
        'users.action_denylist',
        'users.telegram_chat_id',
        'users.telegram_username',
        'bookings.skip_notification',
        'certificates.value_uah',
        'tasks.task_type',
        'tasks.owner',
        'tasks.control_policy'
    ]) {
        assert.equal(STARTUP_SCHEMA_COLUMNS.includes(column), false, `${column} must not remain startup-owned`);
    }

    for (const column of [
        'bookings.payment_method',
        'certificates.customer_id',
        'staff.telegram_username',
        'tasks.deadline',
        'tasks.dependency_ids',
        'tasks.source_id',
        'tasks.source_type'
    ]) {
        assert.equal(STARTUP_SCHEMA_COLUMNS.includes(column), true, `${column} must remain a documented pre-migration dependency`);
    }

    for (const index of [
        'idx_users_action_allowlist_gin',
        'idx_users_action_denylist_gin',
        'idx_banquet_groups_business_date',
        'idx_banquet_groups_primary_booking',
        'idx_banquet_group_bookings_group',
        'idx_banquet_group_bookings_booking',
        'idx_profile_avatar_blobs_username',
        'idx_profile_avatar_blobs_created_at_desc',
        'idx_tasks_deadline',
        'idx_task_logs_task_id',
        'idx_user_points_username',
        'idx_kleshnya_messages_scope',
        'idx_finance_transactions_type'
    ]) {
        assert.equal(STARTUP_SCHEMA_INDEXES.includes(index), false, `${index} must not remain startup-owned`);
    }
});

test('DB startup wave 1 candidates retain complete migration ownership', () => {
    assert.match(migration244, /ALTER TABLE users[\s\S]*ADD COLUMN IF NOT EXISTS action_allowlist TEXT\[\] NOT NULL DEFAULT '\{\}'::text\[\]/i);
    assert.match(migration244, /ADD COLUMN IF NOT EXISTS action_denylist TEXT\[\] NOT NULL DEFAULT '\{\}'::text\[\]/i);
    assert.match(migration244, /CREATE INDEX IF NOT EXISTS idx_users_action_allowlist_gin[\s\S]*ON users USING GIN \(action_allowlist\)/i);
    assert.match(migration244, /CREATE INDEX IF NOT EXISTS idx_users_action_denylist_gin[\s\S]*ON users USING GIN \(action_denylist\)/i);

    assert.match(migration265, /CREATE TABLE IF NOT EXISTS banquet_groups/i);
    assert.match(migration265, /primary_booking_id\s+VARCHAR\(50\) REFERENCES bookings\(id\) ON DELETE SET NULL/i);
    assert.match(migration265, /customer_id\s+INTEGER REFERENCES customers\(id\) ON DELETE SET NULL/i);
    assert.match(migration265, /CONSTRAINT banquet_groups_status_check[\s\S]*CHECK \(status IN \('active', 'closed', 'cancelled'\)\)/i);
    assert.match(migration265, /CREATE TABLE IF NOT EXISTS banquet_group_bookings/i);
    assert.match(migration265, /CONSTRAINT banquet_group_bookings_role_check[\s\S]*CHECK \(role IN \('primary', 'kitchen', 'activity', 'service', 'manual'\)\)/i);
    assert.match(migration265, /CONSTRAINT banquet_group_bookings_booking_unique[\s\S]*UNIQUE \(booking_id\)/i);
    assert.match(migration265, /CONSTRAINT banquet_group_bookings_group_booking_unique[\s\S]*UNIQUE \(group_id, booking_id\)/i);
    assert.match(migration265, /CREATE INDEX IF NOT EXISTS idx_banquet_groups_business_date[\s\S]*ON banquet_groups\(business_context, date\)/i);
    assert.match(migration265, /CREATE INDEX IF NOT EXISTS idx_banquet_groups_primary_booking[\s\S]*ON banquet_groups\(primary_booking_id\)/i);
    assert.match(migration265, /CREATE INDEX IF NOT EXISTS idx_banquet_group_bookings_group[\s\S]*ON banquet_group_bookings\(group_id\)/i);
    assert.match(migration265, /CREATE INDEX IF NOT EXISTS idx_banquet_group_bookings_booking[\s\S]*ON banquet_group_bookings\(booking_id\)/i);

    assert.match(migration266, /CREATE TABLE IF NOT EXISTS profile_avatar_blobs/i);
    assert.match(migration266, /storage_key TEXT NOT NULL UNIQUE/i);
    assert.match(migration266, /data BYTEA NOT NULL/i);
    assert.match(migration266, /checksum_sha256 TEXT NOT NULL/i);
    assert.match(migration266, /CREATE INDEX IF NOT EXISTS idx_profile_avatar_blobs_username[\s\S]*ON profile_avatar_blobs\(username\)/i);
    assert.match(migration266, /CREATE INDEX IF NOT EXISTS idx_profile_avatar_blobs_created_at_desc[\s\S]*ON profile_avatar_blobs\(created_at DESC\)/i);
});

test('DB startup Task 22 ownership migration is additive and covers removed startup-only schema', () => {
    const migration340Sql = stripSqlComments(migration340);
    assert.match(migration340, /-- MIGRATION_KIND: schema/);
    assert.match(migration340, /-- SAFETY: Additive\/idempotent ownership migration/);
    assert.match(migration340, /-- ROLLBACK:/);
    assert.doesNotMatch(migration340Sql, /^\s*INSERT\b/im);
    assert.doesNotMatch(migration340Sql, /^\s*UPDATE\b/im);
    assert.doesNotMatch(migration340Sql, /^\s*DELETE\b/im);

    for (const expected of [
        'CREATE TABLE IF NOT EXISTS task_logs',
        'CREATE TABLE IF NOT EXISTS user_points',
        'CREATE TABLE IF NOT EXISTS point_transactions',
        'CREATE TABLE IF NOT EXISTS user_action_log',
        'CREATE TABLE IF NOT EXISTS user_streaks',
        'CREATE TABLE IF NOT EXISTS kleshnya_messages',
        'CREATE TABLE IF NOT EXISTS design_tags',
        'CREATE TABLE IF NOT EXISTS contractor_notifications',
        'ADD COLUMN IF NOT EXISTS telegram_chat_id',
        'ADD COLUMN IF NOT EXISTS skip_notification',
        'ADD COLUMN IF NOT EXISTS value_uah',
        'CREATE INDEX IF NOT EXISTS idx_tasks_deadline',
        'CREATE INDEX IF NOT EXISTS idx_finance_transactions_type'
    ]) {
        assert.match(migration340, new RegExp(expected.replace(/[()]/g, '\\$&'), 'i'));
    }
});

test('DB startup Task 22 ownership matrix covers every old startup schema object once', () => {
    const baselineKeys = new Set([
        ...TASK22_BASELINE_STARTUP_SCHEMA.tables.map(object => `table:${object}`),
        ...TASK22_BASELINE_STARTUP_SCHEMA.columns.map(object => `column:${object}`),
        ...TASK22_BASELINE_STARTUP_SCHEMA.indexes.map(object => `index:${object}`),
        ...TASK22_BASELINE_STARTUP_SCHEMA.functions.map(object => `function:${object}`),
        ...TASK22_BASELINE_STARTUP_SCHEMA.triggers.map(object => `trigger:${object}`)
    ]);
    assert.equal(baselineKeys.size, 173);
    assert.equal(DB_STARTUP_SCHEMA_OWNERSHIP_MATRIX.length, baselineKeys.size);

    const seen = new Set();
    for (const entry of DB_STARTUP_SCHEMA_OWNERSHIP_MATRIX) {
        const key = `${entry.kind}:${entry.object}`;
        assert.equal(baselineKeys.has(key), true, `${key} must be in Task 22 baseline`);
        assert.equal(seen.has(key), false, `${key} must not have duplicate matrix entries`);
        assert.ok(entry.migrationOwner);
        assert.ok(entry.freshDbDependency);
        assert.ok(entry.preMigrationReadDependency);
        assert.ok(entry.upgradeDependency);
        seen.add(key);
    }

    assert.equal(
        DB_STARTUP_SCHEMA_OWNERSHIP_MATRIX.some(entry => entry.verdict === 'BLOCKED_WITH_EVIDENCE'),
        false,
        'Task 22 must not leave blocked ownership entries'
    );
});

test('DB startup Task 22 removed objects are not reintroduced before migrations run', () => {
    assert.doesNotMatch(dbIndex, /ALTER TABLE users ADD COLUMN IF NOT EXISTS action_allowlist/i);
    assert.doesNotMatch(dbIndex, /ALTER TABLE users ADD COLUMN IF NOT EXISTS action_denylist/i);
    assert.doesNotMatch(dbIndex, /CREATE INDEX IF NOT EXISTS idx_users_action_allowlist_gin/i);
    assert.doesNotMatch(dbIndex, /CREATE INDEX IF NOT EXISTS idx_users_action_denylist_gin/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS banquet_groups/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS banquet_group_bookings/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS profile_avatar_blobs/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS task_logs/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS user_points/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS point_transactions/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS user_action_log/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS user_streaks/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS kleshnya_messages/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS design_tags/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS contractor_notifications/i);
    assert.doesNotMatch(dbIndex, /CREATE INDEX IF NOT EXISTS /i);
    assert.doesNotMatch(dbIndex, /CREATE OR REPLACE FUNCTION update_updated_at_column/i);
    assert.doesNotMatch(dbIndex, /CREATE TRIGGER trg_bookings_updated_at/i);

    const bootstrapInsert = dbIndex.match(/INSERT INTO users \(([^)]+)\)/i);
    assert.ok(bootstrapInsert, 'first-user bootstrap INSERT must remain explicit');
    assert.equal(bootstrapInsert[1].includes('action_allowlist'), false);
    assert.equal(bootstrapInsert[1].includes('action_denylist'), false);
});

test('DB startup surface docs record the Task 22 ownership boundary', () => {
    assert.match(startupDoc, /14 tables/);
    assert.match(startupDoc, /7 columns/);
    assert.match(startupDoc, /No startup indexes remain/);
    assert.match(startupDoc, /Task 22 Ownership Matrix/);
    assert.match(startupDoc, /340_db_startup_schema_ownership\.sql/);
    assert.match(startupDoc, /KEEP_PRE_MIGRATION_DEPENDENCY/);
    assert.match(startupDoc, /ADD_ADDITIVE_OWNERSHIP_MIGRATION/);
    assert.match(startupDoc, /REMOVE_DUPLICATE/);
    assert.match(startupDoc, /Wave 1 Ownership Removed From Startup/);
    assert.match(startupDoc, /244_user_action_permission_overrides\.sql/);
    assert.match(startupDoc, /265_banquet_groups\.sql/);
    assert.match(startupDoc, /266_profile_avatar_postgres_storage\.sql/);
    assert.match(startupDoc, /must not be re-added to `initDatabase\(\)`/);
});
