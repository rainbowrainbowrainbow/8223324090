'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { BACKUP_TABLES } = require('../services/backup');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

function readMigration() {
    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(file => /^\d{3}_hr_shift_segments\.sql$/.test(file));
    assert.equal(files.length, 1, 'Expected exactly one governed HR shift segments migration');
    return fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), 'utf8');
}

function stripSqlComments(sql) {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*--.*$/gm, ' ');
}

const migration = readMigration();
const migrationSql = stripSqlComments(migration);
const initialSchema = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial_schema.sql'), 'utf8');
const hrModuleSchema = fs.readFileSync(path.join(MIGRATIONS_DIR, '007_hr_module.sql'), 'utf8');
const backupService = fs.readFileSync(path.join(ROOT, 'services', 'backup.js'), 'utf8');

test('HR shift segments migration is additive and governed', () => {
    assert.match(migration, /-- MIGRATION_KIND: mixed/);
    assert.match(migration, /-- SAFETY:/);
    assert.match(migration, /-- ROLLBACK:/);
    assert.match(migration, /-- DATA_SCOPE:/);
    assert.match(migration, /LOCK TABLE staff, hr_shifts, staff_schedule IN SHARE ROW EXCLUSIVE MODE/);

    assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_shift_segments/);
    assert.match(migration, /id BIGSERIAL PRIMARY KEY/);
    assert.match(migration, /hr_shift_id INTEGER NOT NULL REFERENCES hr_shifts\(id\) ON DELETE CASCADE/);
    assert.match(migration, /profession_key VARCHAR\(64\) NOT NULL/);
    assert.match(migration, /planned_start TIME NOT NULL/);
    assert.match(migration, /planned_end TIME NOT NULL/);
    assert.match(migration, /break_minutes INTEGER NOT NULL DEFAULT 0/);
    assert.match(migration, /notes TEXT/);
    assert.match(migration, /sort_order INTEGER NOT NULL DEFAULT 0/);
    assert.match(migration, /created_by VARCHAR\(100\)/);
    assert.match(migration, /updated_by VARCHAR\(100\)/);
    assert.match(migration, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.match(migration, /updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.match(migration, /CHECK \(planned_start <> planned_end\)/);
    assert.match(migration, /CHECK \(break_minutes >= 0\)/);
    assert.match(migration, /UNIQUE \(hr_shift_id, profession_key, planned_start, planned_end\)/);

    assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_shift_segment_roles/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_shift_segment_roles \([\s\S]*id BIGSERIAL PRIMARY KEY/);
    assert.match(migration, /segment_id BIGINT NOT NULL REFERENCES hr_shift_segments\(id\) ON DELETE CASCADE/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_shift_segment_roles \([\s\S]*profession_key VARCHAR\(64\) NOT NULL/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_shift_segment_roles \([\s\S]*created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_shift_segment_roles \([\s\S]*updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
    assert.match(migration, /UNIQUE \(segment_id, profession_key\)/);

    assert.doesNotMatch(migrationSql, /\bCREATE\s+EXTENSION\b/i);
    assert.doesNotMatch(migrationSql, /\bjob_vacanc(?:y|ies)(?:\b|_)/i);
    assert.doesNotMatch(migrationSql, /\bALTER\s+TABLE\s+(?:hr_shifts|staff_schedule|hr_time_records)\b/i);
    assert.doesNotMatch(
        migrationSql,
        /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:hr_shifts|staff_schedule|hr_time_records)\b/i
    );
});

test('legacy HR shifts backfill to one equivalent segment without additional roles', () => {
    assert.match(migrationSql, /profession_key IS NULL OR BTRIM\(profession_key\) = ''/);
    assert.match(migrationSql, /planned_start = planned_end/);
    assert.match(migrationSql, /break_minutes IS NULL/);
    assert.match(migrationSql, /break_minutes < 0/);
    assert.match(migrationSql, /break_minutes > EXTRACT\(EPOCH FROM/);
    assert.match(migrationSql, /EXTRACT\(HOUR FROM planned_start\) = 24/);
    assert.match(migrationSql, /EXTRACT\(SECOND FROM planned_end\) <> 0/);
    assert.match(migrationSql, /IF missing_profession_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 cannot backfill % hr_shifts rows without profession_key'/);
    assert.match(migrationSql, /IF noncanonical_profession_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 cannot backfill % hr_shifts rows with noncanonical profession_key'/);
    assert.match(migrationSql, /BTRIM\(profession_key\) !~ '\^\[a-z0-9_:-\]\{1,64\}\$'/);
    assert.match(migrationSql, /WITH eligible_schedule_rows AS \([^]*?LEFT JOIN hr_shifts hs[^]*?ss\.status IN \('working', 'remote'\)[^]*?hs\.id IS NULL/);
    assert.match(migrationSql, /COALESCE\(\s*NULLIF\(BTRIM\(ss\.profession_key\), ''\),\s*NULLIF\(BTRIM\(s\.role_type\), ''\)\s*\) AS profession_key/);
    assert.match(migrationSql, /IF noncanonical_schedule_profession_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 found % eligible staff_schedule-only rows with noncanonical profession_key'/);
    assert.match(migrationSql, /jsonb_array_elements_text\(secondary_professions\) AS secondary\(value\)/);
    assert.match(migrationSql, /IF unassigned_schedule_profession_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 found % eligible staff_schedule-only rows whose profession is absent from the staff HR card'/);
    assert.match(migrationSql, /IF zero_length_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 cannot backfill % zero-length hr_shifts rows'/);
    assert.match(migrationSql, /IF null_break_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 cannot backfill % hr_shifts rows with NULL break_minutes'/);
    assert.match(migrationSql, /IF negative_break_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 cannot backfill % hr_shifts rows with negative break_minutes'/);
    assert.match(migrationSql, /IF oversized_break_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 cannot backfill % hr_shifts rows whose break exceeds shift duration'/);
    assert.match(migrationSql, /IF non_minute_time_count > 0 THEN\s+RAISE EXCEPTION\s+'Migration 287 cannot backfill % hr_shifts rows outside minute-precision HH:mm time'/);
    assert.match(migration, /INSERT INTO hr_shift_segments/);
    assert.match(migration, /hs\.id,[\s\S]*hs\.profession_key,[\s\S]*hs\.planned_start,[\s\S]*hs\.planned_end,[\s\S]*hs\.break_minutes/);
    assert.match(migration, /WHERE NOT EXISTS \([\s\S]*existing\.hr_shift_id = hs\.id[\s\S]*\)/);
    assert.match(migration, /ON CONFLICT \(hr_shift_id, profession_key, planned_start, planned_end\) DO NOTHING/);
    assert.doesNotMatch(migrationSql, /INSERT\s+INTO\s+hr_shift_segment_roles/i);
});

test('migration preserves canonical one-row-per-person-day definitions', () => {
    assert.match(hrModuleSchema, /UNIQUE\(staff_id, shift_date\)/);
    assert.match(initialSchema, /UNIQUE\(staff_id, date\)/);
    assert.match(hrModuleSchema, /UNIQUE\(staff_id, record_date\)/);
    assert.doesNotMatch(migrationSql, /DROP\s+CONSTRAINT/i);
});

test('backup inventory orders shift segments parent-first', () => {
    const shiftsIndex = BACKUP_TABLES.indexOf('hr_shifts');
    const segmentsIndex = BACKUP_TABLES.indexOf('hr_shift_segments');
    const rolesIndex = BACKUP_TABLES.indexOf('hr_shift_segment_roles');

    assert.ok(shiftsIndex >= 0, 'hr_shifts must remain in backup inventory');
    assert.ok(segmentsIndex > shiftsIndex, 'hr_shift_segments must restore after hr_shifts');
    assert.ok(rolesIndex > segmentsIndex, 'hr_shift_segment_roles must restore after hr_shift_segments');
    assert.equal(BACKUP_TABLES.filter(table => table === 'hr_shift_segments').length, 1);
    assert.equal(BACKUP_TABLES.filter(table => table === 'hr_shift_segment_roles').length, 1);
    assert.match(backupService, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(backupService, /SAVEPOINT backup_table_read/);
    assert.match(backupService, /pg_get_serial_sequence\('\$\{table\}', 'id'\)/);
});
