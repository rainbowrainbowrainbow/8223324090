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

// Transaction ownership contract:
// - pg.Pool owns connect(), BEGIN/COMMIT/ROLLBACK, and release().
// - A checked-out pg.Client is already a queryable transaction participant.
// - Nested services must not reconnect, open, commit, roll back, or release it.
// - Use explicit reuseClient when a helper can receive an already-open client
//   through an ambiguous db/queryable option.
describe('transaction ownership helpers', () => {
    function readProjectFile(file) {
        return fs.readFileSync(path.join(ROOT, file), 'utf8');
    }

    function sliceFrom(source, marker) {
        const start = source.indexOf(marker);
        assert.ok(start >= 0, `${marker} should exist`);
        return source.slice(start);
    }

    it('reuses already checked-out pg clients instead of reconnecting them', () => {
        const customerChildren = readProjectFile('services/customerChildren.js');
        const leadRepair = readProjectFile('services/leadCustomerRepair.js');
        const taskLibrary = readProjectFile('services/taskDecompositionLibrary.js');
        const taskScheduling = readProjectFile('services/taskScheduling.js');
        const hermesStudio = readProjectFile('routes/hermes-studio.js');
        const backfillRoom = readProjectFile('scripts/backfill-room-resource-id.js');

        assert.match(customerChildren, /function isExistingTransactionClient/);
        assert.match(customerChildren, /typeof value\.release === 'function'/);
        const customerBlock = sliceFrom(customerChildren, 'async function withTransaction(options, callback)');
        assert.match(customerBlock, /options\.reuseClient === true/);
        assert.match(customerBlock, /isExistingTransactionClient\(options\.db\)/);
        assert.ok(
            customerBlock.indexOf('options.reuseClient === true') < customerBlock.indexOf('await pool.connect()'),
            'customer children must decide to reuse a passed client before connecting a pool'
        );

        const leadBlock = sliceFrom(leadRepair, 'async function withTransaction(queryable, work)');
        assert.match(leadBlock, /typeof queryable\.release === 'function'/);
        assert.ok(
            leadBlock.indexOf("typeof queryable.release === 'function'") < leadBlock.indexOf('await queryable.connect()'),
            'lead repair must reuse a passed client before connecting a pool'
        );

        const taskLibraryBlock = sliceFrom(taskLibrary, 'async function withTransaction(db, callback)');
        assert.match(taskLibraryBlock, /existingClient/);
        assert.match(taskLibraryBlock, /typeof db\.release === 'function'/);
        assert.match(taskLibraryBlock, /!existingClient && typeof db\.connect === 'function'/);

        const taskSchedulingBlock = sliceFrom(taskScheduling, 'async function withTransaction(options, work)');
        assert.match(taskSchedulingBlock, /typeof query\.release === 'function'/);
        assert.ok(
            taskSchedulingBlock.indexOf("typeof query.release === 'function'") < taskSchedulingBlock.indexOf('await query.connect()'),
            'task scheduling must treat a passed pg client as queryable'
        );

        const hermesBlock = sliceFrom(hermesStudio, 'async function withTransaction(queryable, fn)');
        assert.match(hermesBlock, /typeof queryable\.release === 'function'/);
        assert.ok(
            hermesBlock.indexOf("typeof queryable.release === 'function'") < hermesBlock.indexOf('await queryable.connect()'),
            'Hermes Studio must reuse a passed client before connecting a pool'
        );

        const backfillStart = backfillRoom.indexOf('async function applyBackfill');
        assert.ok(backfillStart >= 0, 'async function applyBackfill should exist');
        const backfillBlock = backfillRoom.slice(backfillStart);
        assert.match(backfillBlock, /options\.reuseClient === true/);
        assert.match(backfillBlock, /typeof db\.release === 'function'/);
        assert.match(backfillBlock, /if \(!reuseClient\) await client\.query\('BEGIN'\)/);
        assert.match(backfillBlock, /if \(!reuseClient\) await client\.query\('COMMIT'\)/);
        assert.match(backfillBlock, /if \(!reuseClient\)[\s\S]*ROLLBACK/);
        assert.match(backfillBlock, /if \(!reuseClient && client !== db/);
    });

    it('keeps payroll bulk nested writes on the explicit reuseClient contract', () => {
        const payrollProfiles = readProjectFile('services/hrPayrollProfiles.js');
        const bulkStart = payrollProfiles.indexOf('async function applyPayrollProfileBulk');
        assert.ok(bulkStart >= 0, 'async function applyPayrollProfileBulk should exist');
        const bulkBlock = payrollProfiles.slice(bulkStart);

        assert.match(payrollProfiles, /const reuseClient = options\?\.reuseClient === true/);
        assert.match(payrollProfiles, /const canConnect = !reuseClient && typeof source\.connect === 'function'/);
        assert.ok((bulkBlock.match(/reuseClient: true/g) || []).length >= 4);
        assert.doesNotMatch(bulkBlock, /manageTransaction: false(?!,\s*reuseClient: true)/);
    });
});
