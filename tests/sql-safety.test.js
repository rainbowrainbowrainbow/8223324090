/**
 * tests/sql-safety.test.js — SQL safety utilities unit tests (v38.4.0)
 * Tests safeOrderBy, safeTableName, safeSets
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { safeOrderBy, safeTableName, safeSets } = require('../utils/sqlSafe');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

function readMigration(file) {
    return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
}

describe('safeOrderBy', () => {
    const allowed = {
        date: 'event_date ASC',
        name: 'client_name ASC',
        created: 'created_at DESC'
    };

    it('returns allowed sort clause', () => {
        assert.equal(safeOrderBy('date', allowed, 'id ASC'), 'event_date ASC');
        assert.equal(safeOrderBy('name', allowed, 'id ASC'), 'client_name ASC');
    });

    it('returns default for unknown input', () => {
        assert.equal(safeOrderBy('DROP TABLE', allowed, 'id ASC'), 'id ASC');
        assert.equal(safeOrderBy(undefined, allowed, 'id ASC'), 'id ASC');
        assert.equal(safeOrderBy('', allowed, 'id ASC'), 'id ASC');
    });

    it('rejects SQL injection attempts', () => {
        assert.equal(safeOrderBy("'; DROP TABLE users; --", allowed, 'id ASC'), 'id ASC');
        assert.equal(safeOrderBy('1; DELETE FROM bookings', allowed, 'id ASC'), 'id ASC');
    });
});

describe('safeTableName', () => {
    const tables = new Set(['bookings', 'users', 'staff', 'tasks']);

    it('returns quoted name for allowed table', () => {
        assert.equal(safeTableName('bookings', tables), '"bookings"');
        assert.equal(safeTableName('users', tables), '"users"');
    });

    it('throws for disallowed table', () => {
        assert.throws(() => safeTableName('secrets', tables), {
            message: /not in allowlist/
        });
    });

    it('throws for SQL injection in table name', () => {
        assert.throws(() => safeTableName("bookings; DROP TABLE users", tables));
        assert.throws(() => safeTableName("' OR 1=1 --", tables));
    });

    it('accepts array as allowlist', () => {
        assert.equal(safeTableName('bookings', ['bookings', 'users']), '"bookings"');
    });

    it('throws for empty table name', () => {
        assert.throws(() => safeTableName('', tables));
    });
});

describe('safeSets', () => {
    it('builds SET clause from field definitions', () => {
        const result = safeSets({
            name: { column: 'name', value: 'Test' },
            email: { column: 'email', value: 'test@test.com' }
        }, 1);
        assert.ok(result, 'should return result');
        assert.equal(result.sets.length, 2, 'should have 2 sets');
        assert.ok(result.sets[0].includes('name'), 'should include name column');
        assert.ok(result.sets[1].includes('email'), 'should include email column');
        assert.equal(result.params.length, 2, 'should have 2 params');
        assert.equal(result.params[0], 'Test');
        assert.equal(result.params[1], 'test@test.com');
    });

    it('skips fields with undefined value', () => {
        const result = safeSets({
            name: { column: 'name', value: 'Test' },
            email: { column: 'email', value: undefined }
        }, 1);
        assert.ok(result);
        assert.equal(result.sets.length, 1, 'should have 1 set');
        assert.equal(result.params.length, 1, 'should have 1 param');
    });

    it('returns null when all values undefined', () => {
        const result = safeSets({
            name: { column: 'name', value: undefined },
            email: { column: 'email', value: undefined }
        }, 1);
        assert.equal(result, null);
    });

    it('handles startIdx parameter', () => {
        const result = safeSets({
            name: { column: 'name', value: 'Test' }
        }, 5);
        assert.ok(result.sets[0].includes('$5'), 'should use $5');
        assert.equal(result.nextIdx, 6, 'nextIdx should be 6');
    });

    it('increments parameter indices correctly', () => {
        const result = safeSets({
            a: { column: 'col_a', value: 'A' },
            b: { column: 'col_b', value: 'B' },
            c: { column: 'col_c', value: 'C' }
        }, 3);
        assert.ok(result.sets[0].includes('$3'));
        assert.ok(result.sets[1].includes('$4'));
        assert.ok(result.sets[2].includes('$5'));
        assert.equal(result.nextIdx, 6);
    });
});

describe('lead migration prerequisites', () => {
    it('keeps leads.updated_at schema support independent of the 261 data-fix', () => {
        const migration261 = readMigration('261_leads_customer_card_canonical_customers.sql');
        const migrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter(file => file.endsWith('.sql'));
        const supportMigrations = migrationFiles
            .filter(file => file !== '261_leads_customer_card_canonical_customers.sql')
            .map(file => ({ file, sql: readMigration(file) }))
            .filter(({ sql }) => (
                /MIGRATION_KIND:\s*schema/i.test(sql)
                && /ALTER\s+TABLE\s+leads/i.test(sql)
                && /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+updated_at\s+TIMESTAMPTZ/i.test(sql)
            ));

        assert.match(migration261, /MIGRATION_KIND:\s*data-fix/i);
        assert.match(migration261, /updated_at\s*=\s*NOW\(\)/i);
        assert.doesNotMatch(
            migration261,
            /\b(?:ALTER\s+TABLE|CREATE\s+(?:TABLE|INDEX)|DROP\s+TABLE)\b/i,
            'migration 261 must remain a skippable data-fix so later independent schema migrations can run'
        );

        assert.equal(
            supportMigrations.some(({ file }) => file === '274_add_leads_updated_at.sql'),
            true,
            'leads.updated_at must be created by a dedicated schema migration outside migration 261'
        );

        const supportSql = supportMigrations.map(({ sql }) => sql).join('\n');
        assert.match(supportSql, /UPDATE\s+leads\s+SET\s+updated_at\s*=\s*COALESCE\(created_at::timestamptz,\s*NOW\(\)\)\s+WHERE\s+updated_at\s+IS\s+NULL/i);
        assert.match(supportSql, /ALTER\s+TABLE\s+leads[\s\S]*ALTER\s+COLUMN\s+updated_at\s+SET\s+DEFAULT\s+NOW\(\)/i);
    });
});

describe('Hermes job status migration repair', () => {
    it('keeps live Hermes job status constraints aligned with the worker lifecycle', () => {
        const migration = readMigration('278_hermes_job_status_constraints.sql');
        const expectedStatuses = [
            'queued',
            'claimed',
            'in_progress',
            'needs_input',
            'ready_for_review',
            'revision_requested',
            'approved',
            'rejected',
            'failed',
            'cancelled'
        ];

        for (const constraintName of [
            'hermes_jobs_status_check',
            'hermes_job_events_status_from_check',
            'hermes_job_events_status_to_check'
        ]) {
            assert.match(migration, new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+${constraintName}`, 'i'));
            assert.match(migration, new RegExp(`ADD\\s+CONSTRAINT\\s+${constraintName}`, 'i'));
            assert.match(migration, new RegExp(`VALIDATE\\s+CONSTRAINT\\s+${constraintName}`, 'i'));
        }

        for (const status of expectedStatuses) {
            const occurrences = migration.match(new RegExp(`'${status}'`, 'g')) || [];
            assert.equal(
                occurrences.length,
                3,
                `${status} must be present in jobs, event status_from, and event status_to constraints`
            );
        }
    });
});
