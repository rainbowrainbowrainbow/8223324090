'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lifecycle = require('../scripts/with-temporary-attendance-audit-role');

test('temporary attendance audit role name is unique, bounded and recovery-safe', () => {
    const first = lifecycle.generateRoleName(
        new Date('2026-07-19T12:34:56.789Z'),
        size => Buffer.alloc(size, 0x11)
    );
    const second = lifecycle.generateRoleName(
        new Date('2026-07-19T12:34:56.789Z'),
        size => Buffer.alloc(size, 0x22)
    );

    assert.equal(first, 'eg_attendance_audit_20260719t123456z_1111111111');
    assert.notEqual(first, second);
    assert.match(first, lifecycle.GENERATED_ROLE_PATTERN);
    assert.ok(first.length <= 63);
    assert.throws(() => lifecycle.assertGeneratedRoleName('postgres'), /must exactly match/);
    assert.throws(
        () => lifecycle.assertGeneratedRoleName('eg_attendance_audit_20260719t123456z_1111111111"; DROP ROLE postgres; --'),
        /must exactly match/
    );
});

test('temporary role password is converted to SCRAM verifier without retaining plaintext', () => {
    const password = 'fixture-password-that-must-not-appear';
    const verifier = lifecycle.buildScramVerifier(password, {
        salt: Buffer.alloc(16, 0x33),
        iterations: 4096
    });

    assert.match(verifier, /^SCRAM-SHA-256\$4096:/);
    assert.doesNotMatch(verifier, new RegExp(password));
});

test('operator CLI separates lifecycle options from attendance audit arguments', () => {
    const options = lifecycle.parseArgs([
        '--ttl-minutes', '10',
        '--from', '2026-07-01',
        '--to', '2026-07-31',
        '--format', 'markdown'
    ]);

    assert.equal(options.ttlMinutes, 10);
    assert.deepEqual(options.auditArgs, [
        '--from', '2026-07-01',
        '--to', '2026-07-31',
        '--format', 'markdown'
    ]);
    assert.throws(() => lifecycle.parseArgs(['--ttl-minutes', '0', '--from', '2026-07-01']), /1 to 60/);
    assert.throws(() => lifecycle.parseArgs(['--ttl-minutes', '61', '--from', '2026-07-01']), /1 to 60/);
    assert.throws(
        () => lifecycle.parseArgs([
            '--recover-role', 'eg_attendance_audit_20260719t123456z_1111111111',
            '--from', '2026-07-01'
        ]),
        /cannot be combined/
    );
});

test('audit child environment keeps the generated credential in memory and strips other DB variables', () => {
    const environment = lifecycle.buildAuditChildEnvironment(
        'postgres://temporary-role:temporary-password@localhost/event_genix',
        {
            PATH: 'fixture-path',
            DATABASE_URL: 'postgres://write/main',
            ATTENDANCE_DATA_FIX_DATABASE_URL: 'postgres://write/datafix',
            ATTENDANCE_AUDIT_ADMIN_DATABASE_URL: 'postgres://admin/main',
            PRODUCTION_READONLY_DATABASE_URL: 'postgres://old/readonly',
            PGHOST: 'unsafe-host',
            PGPORT: '5432'
        }
    );

    assert.equal(environment.PATH, 'fixture-path');
    assert.equal(
        environment.ATTENDANCE_AUDIT_DATABASE_URL,
        'postgres://temporary-role:temporary-password@localhost/event_genix'
    );
    assert.equal(environment.DATABASE_URL, undefined);
    assert.equal(environment.ATTENDANCE_DATA_FIX_DATABASE_URL, undefined);
    assert.equal(environment.ATTENDANCE_AUDIT_ADMIN_DATABASE_URL, undefined);
    assert.equal(environment.PRODUCTION_READONLY_DATABASE_URL, undefined);
    assert.equal(environment.PGHOST, undefined);
    assert.equal(environment.PGPORT, undefined);
});

test('temporary role audit scope defaults safely and rejects hr_shifts-dependent inference', () => {
    assert.deepEqual(
        lifecycle.normalizeAuditArgs(['--from', '2026-07-01']),
        [
            '--from', '2026-07-01',
            '--categories', lifecycle.SAFE_AUDIT_CATEGORIES.join(',')
        ]
    );
    assert.throws(
        () => lifecycle.normalizeAuditArgs([
            '--categories',
            'late-grace,inferred-profession-card'
        ]),
        /outside the approved temporary-role table scope/
    );
});

test('role preflight accepts only read-only least-privilege access', () => {
    const validReport = {
        defaultTransactionReadOnly: 'on',
        transactionReadOnly: 'on',
        statementTimeoutMs: lifecycle.STATEMENT_TIMEOUT_MS,
        lockTimeoutMs: lifecycle.LOCK_TIMEOUT_MS,
        databaseConnect: true,
        databaseCreate: false,
        schemaUsage: true,
        schemaCreate: false,
        roleAttributes: {
            canLogin: true,
            superuser: false,
            createDb: false,
            createRole: false,
            inherit: false,
            replication: false,
            bypassRls: false,
            connectionLimit: 1,
            memberships: 0,
            validUntil: new Date(Date.now() + 5 * 60_000).toISOString()
        },
        tables: lifecycle.REQUIRED_TABLES.map(tableName => ({
            tableName,
            canSelect: true,
            canInsert: false,
            canUpdate: false,
            canDelete: false,
            canTruncate: false,
            selectGrantable: false
        })),
        extraSelectableTables: 0
    };

    assert.doesNotThrow(() => lifecycle.assertRoleAccessReport(validReport));
    assert.throws(
        () => lifecycle.assertRoleAccessReport({
            ...validReport,
            tables: validReport.tables.map((table, index) => (
                index === 0 ? { ...table, canUpdate: true } : table
            ))
        }),
        /invalid table privileges/
    );
    assert.throws(
        () => lifecycle.assertRoleAccessReport({ ...validReport, extraSelectableTables: 1 }),
        /non-approved public tables/
    );
});

test('cleanup failure remains command-fatal and preserves the original error context', () => {
    const primary = new Error('audit failed');
    const cleanup = new Error('drop role failed');
    const combined = lifecycle.combineLifecycleErrors(primary, cleanup);

    assert.match(combined.message, /audit failed/);
    assert.match(combined.message, /drop role failed/);
    assert.equal(combined.primaryError, primary);
    assert.equal(combined.cause, cleanup);
    assert.equal(lifecycle.combineLifecycleErrors(primary, null), primary);
    assert.equal(lifecycle.combineLifecycleErrors(null, cleanup), cleanup);
});

test('operator error output redacts admin URLs and passwords', () => {
    const adminUrl = 'postgres://admin:super-secret-password@db.example/event_genix';
    const message = lifecycle.redactOperatorError(
        new Error(`connection failed for ${adminUrl}: super-secret-password`),
        { ATTENDANCE_AUDIT_ADMIN_DATABASE_URL: adminUrl }
    );

    assert.doesNotMatch(message, /super-secret-password/);
    assert.doesNotMatch(message, /postgres:\/\/admin/);
    assert.match(message, /\[REDACTED\]/);
});

test('temporary role helper stays dormant outside explicit operator invocation', () => {
    const root = path.resolve(__dirname, '..');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const routeSources = fs.readdirSync(path.join(root, 'routes'))
        .filter(file => file.endsWith('.js'))
        .map(file => fs.readFileSync(path.join(root, 'routes', file), 'utf8'))
        .join('\n');
    const schedulerSources = fs.readdirSync(path.join(root, 'services'))
        .filter(file => file.endsWith('.js'))
        .map(file => fs.readFileSync(path.join(root, 'services', file), 'utf8'))
        .join('\n');

    const needle = 'with-temporary-attendance-audit-role';
    assert.doesNotMatch(server, new RegExp(needle));
    assert.doesNotMatch(routeSources, new RegExp(needle));
    assert.doesNotMatch(schedulerSources, new RegExp(needle));
});
