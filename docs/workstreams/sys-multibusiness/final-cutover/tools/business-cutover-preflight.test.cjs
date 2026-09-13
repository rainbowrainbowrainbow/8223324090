'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, poolConfig, cohortCounts, safeFailure, table, runPreflight } = require('./business-cutover-preflight.cjs');

test('CLI accepts exactly one canonical remaining business and no apply or connection flag', () => {
    for (const context of ['maysternya_doli', 'crm']) assert.deepEqual(parseArgs(['--context', context]), { context });
    for (const argv of [[], ['--context', 'md'], ['--context', 'event_genix'], ['--context', 'crm', '--apply'],
        ['--context', 'crm', '--context', 'maysternya_doli'], ['--context', "crm'; DROP TABLE users;--"], ['crm']]) {
        assert.throws(() => parseArgs(argv), { code: 'AUDIT_SINGLE_CONTEXT_REQUIRED' });
    }
    assert.deepEqual(parseArgs(['--help']), { help: true });
});
test('only explicit operator read-only URL is consumed and errors do not disclose connection details', () => {
    assert.throws(() => poolConfig({ DATABASE_URL: 'postgresql://SECRET_USER:SECRET_PASSWORD@production/SECRET_DATABASE' }),
        { code: 'AUDIT_READONLY_CONNECTION_REQUIRED' });
    assert.throws(() => poolConfig({ MULTIBUSINESS_AUDIT_DATABASE_URL: 'https://invalid/SECRET' }), { code: 'AUDIT_INVALID_CONNECTION' });
    const config = poolConfig({ MULTIBUSINESS_AUDIT_DATABASE_URL: 'postgresql://localhost/test' });
    assert.equal(config.max, 1);
    assert.equal(config.connectionTimeoutMillis, 5000);
    assert.deepEqual(safeFailure(Object.assign(new Error('SECRET_DATABASE_FAILURE'), { code: '28P01' })),
        { status: 'AUDIT_FAILED', code: 'AUDIT_DATABASE_FAILED', safeToApply: false });
});
test('SQL identifiers and callable contexts are allowlisted before obtaining any connection', async () => {
    assert.equal(table('users'), 'public."users"');
    assert.throws(() => table('users;SELECT secret'), { code: 'AUDIT_TABLE_NOT_ALLOWED' });
    await assert.rejects(() => runPreflight({ connect() { assert.fail('must not connect'); } }, 'md'), { code: 'AUDIT_SINGLE_CONTEXT_REQUIRED' });
});
test('pure legacy cohort retains current global roles, aliases and non-switch role limitations', () => {
    const users = [
        { role: 'director', business_contexts: ['md'], default_business_context: 'maysternya' },
        { role: 'manager', extra_roles: ['director'], business_contexts: ['maysternya_doli'] },
        { role: 'creator', business_contexts: [] },
        { role: 'manager', business_contexts: ['maysternya_doli'], default_business_context: 'md' },
        { role: 'director', business_contexts: ['crm'], default_business_context: 'crm' },
        { role: 'director', business_contexts: ['sales_crm'], default_business_context: 'срм', page_allowlist: ['/SECRET_PATH'] }
    ];
    const md = cohortCounts(users, 'maysternya_doli');
    assert.equal(md.legacyPotentialCohortUsers, 3);
    assert.equal(md.explicitAssignmentUsers, 3);
    assert.equal(md.unassignedRoleFallbackUsers, 1);
    assert.equal(md.aliasAssignmentUsers, 1);
    assert.equal(md.aliasDefaultUsers, 2);
    assert.equal(md.globalExplicitDefaultOutsideLegacyAllowedUsers, 1);
    assert.equal(md.cohortWithExtraRolesUsers, 1);
    assert.equal(cohortCounts(users, 'crm').legacyPotentialCohortUsers, 3);
    assert.equal(cohortCounts(users, 'crm').globalExplicitDefaultOutsideLegacyAllowedUsers, 1,
        'An unrelated MD-only invalid default is deliberately reported with an explicit global name');
    assert.doesNotMatch(JSON.stringify(md), /SECRET_PATH|manager|director/);
});
test('CLI has no DATABASE_URL fallback, app startup or raw failure output', () => {
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: 'postgresql://SECRET:SECRET@127.0.0.1/SECRET' };
    const result = spawnSync(process.execPath, [path.join(__dirname, 'business-cutover-preflight.cjs'), '--context', 'crm'],
        { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { status: 'AUDIT_FAILED', code: 'AUDIT_READONLY_CONNECTION_REQUIRED', safeToApply: false });
});
test('a total-budget exhaustion rolls back without beginning data collection', async t => {
    let clock = 0;
    t.mock.method(Date, 'now', () => clock);
    const sql = [];
    let released = false;
    const pool = { async connect() { return {
        async query(statement) {
            sql.push(statement);
            if (statement === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: 'on' }] };
            if (statement === 'SHOW transaction_isolation') { clock = 60001; return { rows: [{ transaction_isolation: 'repeatable read' }] }; }
            return { rows: [] };
        }, release() { released = true; }
    }; } };
    await assert.rejects(() => runPreflight(pool, 'crm'), { code: 'AUDIT_TOTAL_BUDGET_EXCEEDED' });
    assert.equal(sql.at(-1), 'ROLLBACK');
    assert.equal(sql.some(query => /pg_catalog/.test(query)), false);
    assert.equal(released, true);
});
test('a database that does not verify read-only mode is rejected and rolled back', async () => {
    const sql = [];
    const pool = { async connect() { return {
        async query(statement) { sql.push(statement); return { rows: [{ transaction_read_only: 'off', transaction_isolation: 'read committed' }] }; },
        release() {}
    }; } };
    await assert.rejects(() => runPreflight(pool, 'maysternya_doli'), { code: 'AUDIT_READONLY_SNAPSHOT_REQUIRED' });
    assert.equal(sql.at(-1), 'ROLLBACK');
});
