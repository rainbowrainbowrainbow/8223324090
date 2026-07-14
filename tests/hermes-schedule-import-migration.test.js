'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.resolve(__dirname, '..', 'db', 'migrations', '288_hermes_schedule_imports.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('Hermes schedule import migration is additive and governed', () => {
    assert.match(migration, /-- MIGRATION_KIND: schema/);
    assert.match(migration, /-- SAFETY: .*Existing schedules, Hermes jobs, and business data are not read or modified/);
    assert.match(migration, /-- ROLLBACK:/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes_schedule_imports/);
    assert.doesNotMatch(
        migration.replace(/^--.*$/gm, ''),
        /^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/im
    );
    assert.doesNotMatch(migration, /\bhermes_jobs\s+(?:SET|VALUES|WHERE)\b/i);
});

test('migration persists the complete import snapshot and terminal result', () => {
    for (const column of [
        'public_id',
        'business_context',
        'status',
        'source',
        'source_reference',
        'source_dedupe_key',
        'document_date',
        'extracted_rows',
        'preview_rows',
        'current_state_snapshot',
        'preview_hash',
        'expires_at',
        'created_by_user_id',
        'applied_by_user_id',
        'apply_result',
        'error_message',
        'applied_at',
        'created_at',
        'updated_at'
    ]) {
        assert.match(migration, new RegExp(`\\b${column}\\b`));
    }

    for (const status of ['draft', 'needs_review', 'ready', 'applied', 'cancelled', 'expired', 'failed']) {
        assert.match(migration, new RegExp(`'${status}'`));
    }
    assert.match(migration, /jsonb_typeof\(source_reference\) = 'object'/);
    assert.match(migration, /jsonb_typeof\(current_state_snapshot\) = 'array'/);
    assert.match(migration, /status NOT IN \('ready', 'applied'\) OR preview_hash IS NOT NULL/);
});

test('migration enforces dedupe, expiry lookup, and immutable ready previews', () => {
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_schedule_imports_public_id/);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_hermes_schedule_imports_status_expires[\s\S]*status, expires_at/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_hermes_schedule_imports_dedupe[\s\S]*business_context, source_dedupe_key/);
    assert.match(migration, /WHERE source_dedupe_key IS NOT NULL/);
    assert.match(migration, /OLD\.status NOT IN \('draft', 'needs_review'\)/);
    assert.match(migration, /NEW\.preview_rows IS DISTINCT FROM OLD\.preview_rows/);
    assert.match(migration, /NEW\.current_state_snapshot IS DISTINCT FROM OLD\.current_state_snapshot/);
    assert.match(migration, /Hermes schedule import source identity is immutable/);
    assert.match(migration, /Hermes schedule import apply result is immutable/);
    assert.match(migration, /Invalid Hermes schedule import status transition/);
});

test('migration blocks top-level secret and binary source-reference fields', () => {
    for (const forbidden of ['photo_binary', 'telegram_bot_token', 'api_key', 'cookies', 'raw_headers', 'headers']) {
        assert.match(migration, new RegExp(`'${forbidden}'`));
    }
});
