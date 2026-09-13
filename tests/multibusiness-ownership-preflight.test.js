'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, poolConfig, runOwnershipPreflight, safeFailure } = require('../scripts/audit-multibusiness-ownership');

const sentinel = 'SYNTHETIC_PRIVATE_VALUE_MUST_NOT_APPEAR';
const entry = path.join(__dirname, '../scripts/audit-multibusiness-ownership.js');

function fixturePool({ readonly = 'on', isolation = 'repeatable read', metadata = [], countRow,
    metadataFailure, rollbackFailure } = {}) {
    const queries = [];
    const releases = [];
    return {
        queries, releases,
        async connect() {
            return {
                async query(sql) {
                    queries.push(sql);
                    if (sql === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: readonly }] };
                    if (sql === 'SHOW transaction_isolation') return { rows: [{ transaction_isolation: isolation }] };
                    if (sql.includes('pg_catalog.pg_class')) {
                        if (metadataFailure) throw metadataFailure;
                        return { rows: metadata };
                    }
                    if (sql.startsWith('SELECT COUNT(*)')) return { rows: [countRow] };
                    if (sql === 'ROLLBACK' && rollbackFailure) throw rollbackFailure;
                    if (/^(BEGIN|SET LOCAL|ROLLBACK)/.test(sql)) return { rows: [] };
                    throw new Error('Unexpected fixture query');
                },
                release(error) { releases.push(error); }
            };
        }
    };
}

test('ownership audit has no apply mode and never echoes rejected arguments', () => {
    assert.deepEqual(parseArgs([]), { help: false });
    assert.deepEqual(parseArgs(['--help']), { help: true });
    for (const args of [['apply'], ['--apply'], ['--table', sentinel], ['--help', sentinel]]) {
        assert.throws(() => parseArgs(args), error => error.code === 'AUDIT_INVALID_ARGUMENTS' && !error.message.includes(sentinel));
    }
});

test('connection requires the dedicated read-only URL and ignores application defaults', () => {
    assert.throws(() => poolConfig({ DATABASE_URL: `postgresql://fixture:${sentinel}@localhost/test` }),
        { code: 'AUDIT_READONLY_CONNECTION_REQUIRED' });
    const connection = `postgresql://fixture:${sentinel}@localhost/disposable_test`;
    const config = poolConfig({ MULTIBUSINESS_AUDIT_DATABASE_URL: connection, DATABASE_URL: 'ignored' });
    assert.equal(config.connectionString, connection);
    assert.equal(config.max, 1);
    assert.equal(config.connectionTimeoutMillis, 5000);
    assert.equal(Object.hasOwn(config, 'ssl'), false, 'Do not disable certificate verification');
    for (const invalid of [sentinel, 'https://example.invalid/db', 'postgresql://localhost/']) {
        assert.throws(() => poolConfig({ MULTIBUSINESS_AUDIT_DATABASE_URL: invalid }), { code: 'AUDIT_INVALID_CONNECTION' });
    }
});

test('failure reporting never includes driver errors, connection strings or arbitrary codes', () => {
    assert.deepEqual(safeFailure({ message: sentinel, detail: sentinel, code: sentinel }),
        { status: 'AUDIT_FAILED', code: 'AUDIT_DATABASE_FAILED' });
    assert.deepEqual(safeFailure({ code: 'AUDIT_READONLY_SNAPSHOT_REQUIRED', message: sentinel }),
        { status: 'AUDIT_FAILED', code: 'AUDIT_READONLY_SNAPSHOT_REQUIRED' });
});

test('unverified read-only or snapshot isolation fails before inspecting schema/data and releases the client', async () => {
    for (const options of [{ readonly: 'off' }, { isolation: 'read committed' }]) {
        const pool = fixturePool(options);
        await assert.rejects(runOwnershipPreflight(pool), { code: 'AUDIT_READONLY_SNAPSHOT_REQUIRED' });
        assert.equal(pool.queries.some(sql => sql.includes('pg_catalog') || sql.includes('FROM public')), false);
        assert.equal(pool.queries.at(-1), 'ROLLBACK');
        assert.equal(pool.releases.length, 1);
    }
});

test('empty schema is explicitly incomplete with unknown counts, never a green cutover', async () => {
    const pool = fixturePool();
    const report = await runOwnershipPreflight(pool);
    assert.equal(report.status, 'HOLD_OWNERSHIP_DECISIONS');
    assert.equal(report.collectionStatus, 'INCOMPLETE_SCHEMA');
    assert.equal(report.safeToAutoBackfill, false);
    assert.equal(report.ownershipEstablished, false);
    assert.equal(report.tables.catalog_items.status, 'NOT_CHECKED_MISSING_TABLE');
    assert.equal(report.tables.catalog_items.totalRows, null);
    assert.equal(report.relationships.recurring_instances.status, 'NOT_CHECKED_MISSING_SCHEMA');
    assert.equal(report.relationships.recurring_instances.counts, null);
    assert.equal(pool.queries.some(sql => sql.startsWith('SELECT COUNT(*)')), false);
    assert.equal(pool.queries.at(-1), 'ROLLBACK');
    assert.equal(pool.releases.length, 1);
});

test('zero rows and an observed owner column cannot establish ownership or authorize backfill', async () => {
    const pool = fixturePool({ metadata: ['id', 'business_id'].map(column_name => ({ table_name: 'catalog_items', column_name })),
        countRow: { totalRows: '0', business_id: '0' } });
    const report = await runOwnershipPreflight(pool);
    assert.deepEqual(report.tables.catalog_items, { status: 'OBSERVED', totalRows: 0,
        ownershipColumns: ['business_id'], missingOwnerRows: { business_id: 0 } });
    assert.equal(report.status, 'HOLD_OWNERSHIP_DECISIONS');
    assert.equal(report.ownershipEstablished, false);
    assert.equal(report.safeToAutoBackfill, false);
});

test('RLS tables and dependent metrics are unknown, preserving both schema and visibility gaps', async () => {
    const pool = fixturePool({ metadata: ['id', 'catalog_id', 'business_id'].map(column_name =>
        ({ table_name: 'catalog_items', column_name, row_security: true })) });
    const report = await runOwnershipPreflight(pool);
    assert.equal(report.tables.catalog_items.status, 'NOT_CHECKED_ROW_SECURITY');
    assert.equal(report.tables.catalog_items.totalRows, null);
    assert.equal(report.relationships.catalog_items_definition.status, 'NOT_CHECKED_ROW_SECURITY');
    assert.equal(report.relationships.catalog_items_definition.counts, null);
    assert.deepEqual(new Set(report.collectionIssues), new Set(['MISSING_SCHEMA', 'ROW_SECURITY']));
    assert.equal(report.collectionStatus, 'INCOMPLETE_VISIBILITY');
    assert.equal(pool.queries.some(sql => /FROM public[."]/.test(sql)), false);
    assert.equal(report.status, 'HOLD_OWNERSHIP_DECISIONS');
});

test('audit rejects inexact or nonnumeric counts without silently rounding evidence', async () => {
    for (const totalRows of ['9007199254740992', sentinel, null]) {
        const pool = fixturePool({ metadata: [{ table_name: 'catalog_items', column_name: 'id' }], countRow: { totalRows } });
        await assert.rejects(runOwnershipPreflight(pool), error => ['AUDIT_INVALID_COUNT', 'AUDIT_COUNT_OUT_OF_RANGE'].includes(error.code));
        assert.equal(pool.queries.at(-1), 'ROLLBACK');
        assert.equal(pool.releases.length, 1);
    }
});

test('failed reads roll back and a failed rollback destroys instead of returning a dirty client', async () => {
    const failure = Object.assign(new Error(sentinel), { code: '42501' });
    const rollbackFailure = new Error('Synthetic connection closed');
    const pool = fixturePool({ metadataFailure: failure, rollbackFailure });
    await assert.rejects(runOwnershipPreflight(pool), error => error === failure);
    assert.equal(pool.queries.at(-1), 'ROLLBACK');
    assert.deepEqual(pool.releases, [rollbackFailure]);
    assert.equal(JSON.stringify(safeFailure(failure)).includes(sentinel), false);
});

test('CLI help is connection-free and missing connection/invalid arguments produce only redacted errors', () => {
    const env = { ...process.env, MULTIBUSINESS_AUDIT_DATABASE_URL: '', DATABASE_URL: sentinel };
    const help = spawnSync(process.execPath, [entry, '--help'], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /No apply mode/);
    assert.equal(help.stdout.includes(sentinel), false);
    for (const args of [[], ['--apply', sentinel]]) {
        const result = spawnSync(process.execPath, [entry, ...args], { env, encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr.includes(sentinel), false);
        assert.equal(JSON.parse(result.stderr).status, 'AUDIT_FAILED');
    }
});
