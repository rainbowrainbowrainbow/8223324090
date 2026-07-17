'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(
    ROOT,
    'db',
    'migrations',
    '297_payroll_profiles_foundation.sql'
);
const INTEGRATION_PATH = path.join(
    ROOT,
    'tests',
    'integration',
    'payroll-profiles.integration.test.js'
);

const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const integration = fs.readFileSync(INTEGRATION_PATH, 'utf8');
const isolatedRunner = fs.readFileSync(
    path.join(ROOT, 'scripts', 'run-isolated-postgres-tests.js'),
    'utf8'
);
const packageJson = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const migrationSql = migration
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ');

test('migration 297 is governed, additive, and isolated from legacy payroll data', () => {
    assert.match(migration, /-- MIGRATION_KIND:\s*schema/i);
    assert.match(migration, /-- SAFETY:/i);
    assert.match(migration, /-- ROLLBACK:/i);

    assert.doesNotMatch(migrationSql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(migrationSql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migrationSql, /\bUPDATE\s+[a-z_][a-z0-9_]*\s+SET\b/i);
    assert.doesNotMatch(
        migrationSql,
        /\bALTER\s+TABLE\s+(?:staff|payroll_schemes|staff_profession_rates|payroll_reports)\b/i
    );
    assert.doesNotMatch(migrationSql, /\bCREATE\s+EXTENSION\b/i);
});

test('migration 297 creates shared and personal payroll profiles with source lineage', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_profiles/);
    assert.match(migration, /title VARCHAR\(160\) NOT NULL/);
    assert.match(
        migration,
        /profession_key VARCHAR\(64\) NOT NULL REFERENCES hr_professions\(key\) ON DELETE RESTRICT/
    );
    assert.match(migration, /profile_kind VARCHAR\(16\) NOT NULL DEFAULT 'shared'/);
    assert.match(migration, /owner_staff_id INTEGER REFERENCES staff\(id\) ON DELETE RESTRICT/);
    assert.match(migration, /is_default_for_profession BOOLEAN NOT NULL DEFAULT false/);
    assert.match(migration, /status VARCHAR\(16\) NOT NULL DEFAULT 'draft'/);
    assert.match(migration, /profile_kind IN \('shared', 'personal'\)/);
    assert.match(migration, /status IN \('draft', 'active', 'archived'\)/);
    assert.match(
        migration,
        /\(profile_kind = 'shared' AND owner_staff_id IS NULL\)[\s\S]*\(profile_kind = 'personal' AND owner_staff_id IS NOT NULL\)/
    );
    assert.match(
        migration,
        /FOREIGN KEY \(source_profile_id, profession_key\)[\s\S]*REFERENCES payroll_profiles\(id, profession_key\)/
    );
    assert.match(
        migration,
        /FOREIGN KEY \(source_profile_id, source_version_id\)[\s\S]*REFERENCES payroll_profile_versions\(profile_id, id\)[\s\S]*MATCH FULL/
    );
    assert.match(
        migration,
        /CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_profiles_active_default_profession_v297[\s\S]*WHERE status = 'active'[\s\S]*is_default_for_profession = true/
    );
});

test('migration 297 versions positive rates and rejects ambiguous version timelines', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_profile_versions/);
    assert.match(migration, /version_number INTEGER NOT NULL/);
    assert.match(migration, /rate_unit IN \('hour', 'day', 'month'\)/);
    assert.match(migration, /default_rate NUMERIC\(12,2\) NOT NULL/);
    assert.match(migration, /CHECK \(default_rate > 0\)/);
    assert.match(migration, /effective_from DATE NOT NULL/);
    assert.match(migration, /CHECK \(effective_to IS NULL OR effective_to >= effective_from\)/);
    assert.match(migration, /UNIQUE \(profile_id, version_number\)/);
    assert.match(migration, /hashtextextended\([\s\S]*'payroll_profile_version:'/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(
        migration,
        /existing\.effective_from <= COALESCE\(NEW\.effective_to, 'infinity'::date\)[\s\S]*NEW\.effective_from <= COALESCE\(existing\.effective_to, 'infinity'::date\)/
    );
    assert.match(migration, /USING ERRCODE = '23P01'/);
    assert.match(
        migration,
        /CREATE TRIGGER trg_payroll_profile_versions_timeline_v297[\s\S]*BEFORE INSERT OR UPDATE ON payroll_profile_versions/
    );
});

test('migration 297 stores one positive weekday exception and forbids month overrides declaratively', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_profile_day_rates/);
    assert.match(migration, /iso_weekday SMALLINT NOT NULL/);
    assert.match(migration, /CHECK \(iso_weekday BETWEEN 1 AND 7\)/);
    assert.match(migration, /rate NUMERIC\(12,2\) NOT NULL/);
    assert.match(migration, /CHECK \(rate > 0\)/);
    assert.match(migration, /UNIQUE \(profile_version_id, iso_weekday\)/);
    assert.match(migration, /CHECK \(rate_unit IN \('hour', 'day'\)\)/);
    assert.match(
        migration,
        /FOREIGN KEY \(profile_version_id, rate_unit\)[\s\S]*REFERENCES payroll_profile_versions\(id, rate_unit\)/
    );
});

test('migration 297 enforces profession, personal-owner, temporary-date, and no-overlap assignment rules', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_payroll_profile_assignments/);
    assert.match(migration, /staff_id INTEGER NOT NULL REFERENCES staff\(id\) ON DELETE RESTRICT/);
    assert.match(migration, /assignment_kind IN \('explicit', 'temporary'\)/);
    assert.match(
        migration,
        /CHECK \(assignment_kind <> 'temporary' OR effective_to IS NOT NULL\)/
    );
    assert.match(
        migration,
        /FOREIGN KEY \(profile_id, profession_key\)[\s\S]*REFERENCES payroll_profiles\(id, profession_key\)/
    );
    assert.match(migration, /'payroll_assignment:' \|\| NEW\.staff_id::text/);
    assert.match(
        migration,
        /assigned_profile_kind = 'personal'[\s\S]*assigned_profile_owner IS DISTINCT FROM NEW\.staff_id/
    );
    assert.match(
        migration,
        /FROM payroll_profiles[\s\S]*id = NEW\.profile_id[\s\S]*profession_key = NEW\.profession_key[\s\S]*FOR SHARE/
    );
    assert.doesNotMatch(migration, /FOR KEY SHARE/);
    assert.match(
        migration,
        /existing\.staff_id = NEW\.staff_id[\s\S]*existing\.profession_key = NEW\.profession_key[\s\S]*existing\.effective_from <= COALESCE\(NEW\.effective_to, 'infinity'::date\)/
    );
    assert.match(
        migration,
        /CREATE TRIGGER trg_staff_payroll_assignment_v297[\s\S]*BEFORE INSERT OR UPDATE ON staff_payroll_profile_assignments/
    );
    assert.match(
        migration,
        /CREATE TRIGGER trg_payroll_profile_personal_owner_v297[\s\S]*BEFORE UPDATE OF profile_kind, owner_staff_id ON payroll_profiles/
    );
});

test('migration 297 has an isolated PostgreSQL contract suite for runtime and concurrency semantics', () => {
    assert.match(
        isolatedRunner,
        /payroll:\s*\[\s*'tests\/integration\/payroll-profiles\.integration\.test\.js',/
    );
    assert.match(isolatedRunner, /RUN_PAYROLL_PROFILES_INTEGRATION/);
    assert.match(
        packageJson,
        /"test:integration:payroll-profiles:isolated":\s*"node scripts\/run-isolated-postgres-tests\.js payroll"/
    );
    assert.match(integration, /assertSafeTestDatabaseUrl/);
    assert.match(integration, /ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER/);
    assert.match(integration, /pg_locks/);
    assert.match(integration, /pg_stat_activity/);
    assert.match(integration, /Personal payroll profile/);
    assert.match(integration, /month version rejects weekday overrides/);
});
