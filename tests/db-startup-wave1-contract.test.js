'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    STARTUP_SCHEMA_TABLES,
    STARTUP_SCHEMA_COLUMNS,
    STARTUP_SCHEMA_INDEXES
} = require('../config/dbStartupSurface');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const dbIndex = read('db/index.js');
const migration244 = read('db/migrations/244_user_action_permission_overrides.sql');
const migration265 = read('db/migrations/265_banquet_groups.sql');
const migration266 = read('db/migrations/266_profile_avatar_postgres_storage.sql');
const startupDoc = read('docs/DB_STARTUP_SURFACE.md');

test('DB startup wave 1 removes only schema now owned by durable migrations', () => {
    assert.equal(STARTUP_SCHEMA_TABLES.length, 39);
    assert.equal(STARTUP_SCHEMA_COLUMNS.length, 50);
    assert.equal(STARTUP_SCHEMA_INDEXES.length, 82);

    for (const table of [
        'banquet_groups',
        'banquet_group_bookings',
        'profile_avatar_blobs'
    ]) {
        assert.equal(STARTUP_SCHEMA_TABLES.includes(table), false, `${table} must not remain startup-owned`);
    }

    for (const column of [
        'users.action_allowlist',
        'users.action_denylist'
    ]) {
        assert.equal(STARTUP_SCHEMA_COLUMNS.includes(column), false, `${column} must not remain startup-owned`);
    }

    for (const index of [
        'idx_users_action_allowlist_gin',
        'idx_users_action_denylist_gin',
        'idx_banquet_groups_business_date',
        'idx_banquet_groups_primary_booking',
        'idx_banquet_group_bookings_group',
        'idx_banquet_group_bookings_booking',
        'idx_profile_avatar_blobs_username',
        'idx_profile_avatar_blobs_created_at_desc'
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

test('DB startup wave 1 candidates are not reintroduced before migrations run', () => {
    assert.doesNotMatch(dbIndex, /ALTER TABLE users ADD COLUMN IF NOT EXISTS action_allowlist/i);
    assert.doesNotMatch(dbIndex, /ALTER TABLE users ADD COLUMN IF NOT EXISTS action_denylist/i);
    assert.doesNotMatch(dbIndex, /CREATE INDEX IF NOT EXISTS idx_users_action_allowlist_gin/i);
    assert.doesNotMatch(dbIndex, /CREATE INDEX IF NOT EXISTS idx_users_action_denylist_gin/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS banquet_groups/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS banquet_group_bookings/i);
    assert.doesNotMatch(dbIndex, /CREATE TABLE IF NOT EXISTS profile_avatar_blobs/i);

    const bootstrapInsert = dbIndex.match(/INSERT INTO users \(([^)]+)\)/i);
    assert.ok(bootstrapInsert, 'first-user bootstrap INSERT must remain explicit');
    assert.equal(bootstrapInsert[1].includes('action_allowlist'), false);
    assert.equal(bootstrapInsert[1].includes('action_denylist'), false);
});

test('DB startup surface docs record the wave 1 ownership boundary', () => {
    assert.match(startupDoc, /The guard tracks 82 startup indexes/);
    assert.match(startupDoc, /Wave 1 Ownership Removed From Startup/);
    assert.match(startupDoc, /244_user_action_permission_overrides\.sql/);
    assert.match(startupDoc, /265_banquet_groups\.sql/);
    assert.match(startupDoc, /266_profile_avatar_postgres_storage\.sql/);
    assert.match(startupDoc, /must not be re-added to `initDatabase\(\)`/);
});
