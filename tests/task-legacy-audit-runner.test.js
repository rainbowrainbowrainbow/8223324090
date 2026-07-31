'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts', 'audit-legacy-task-data-read-only.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const {
    READ_ONLY_CONNECTION_ENV_KEY,
    buildRules,
    parseArgs,
    poolConfig,
    renderMarkdown,
    resolveReadOnlyConnectionString,
    runAudit,
    safeErrorCode
} = require('../scripts/audit-legacy-task-data-read-only');

test('legacy task audit accepts only the dedicated read-only connection string', () => {
    assert.equal(READ_ONLY_CONNECTION_ENV_KEY, 'PRODUCTION_READONLY_DATABASE_URL');
    assert.throws(
        () => resolveReadOnlyConnectionString({ DATABASE_URL: 'postgres://writer.example.invalid/app' }),
        error => error.code === 'TASK_LEGACY_AUDIT_READ_ONLY_DATABASE_REQUIRED'
    );
    assert.deepEqual(resolveReadOnlyConnectionString({
        DATABASE_URL: 'postgres://writer.example.invalid/app',
        PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example.invalid/app'
    }), {
        key: 'PRODUCTION_READONLY_DATABASE_URL',
        connectionString: 'postgres://readonly.example.invalid/app'
    });
    assert.deepEqual(poolConfig({ PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example.invalid/app' }), {
        connectionString: 'postgres://readonly.example.invalid/app',
        ssl: { rejectUnauthorized: false },
        application_name: 'task_legacy_readonly_audit'
    });
});

test('legacy task audit has mandatory read-only transaction and no mutation SQL', () => {
    assert.match(scriptSource, /BEGIN READ ONLY/);
    assert.match(scriptSource, /SHOW transaction_read_only/);
    assert.match(scriptSource, /query\('ROLLBACK'\)/);
    assert.doesNotMatch(scriptSource, /\bINSERT\s+(?:INTO|OVERRIDING)\b/i);
    assert.doesNotMatch(scriptSource, /\bUPDATE\s+[a-z_"][\w"]*\s+SET\b/i);
    assert.doesNotMatch(scriptSource, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(scriptSource, /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INDEX|VIEW|FUNCTION|TRIGGER)\b/i);
});

test('legacy task audit rejects every unsupported mode and supports safe output formats only', () => {
    assert.deepEqual(parseArgs([]), { format: 'json' });
    assert.deepEqual(parseArgs(['--format', 'markdown']), { format: 'markdown' });
    for (const option of ['--apply', '--fix', '--write', '--execute', '--migration']) {
        assert.throws(
            () => parseArgs([option]),
            error => error.code === 'TASK_LEGACY_AUDIT_ARGUMENT_UNSUPPORTED'
        );
    }
    assert.throws(
        () => parseArgs(['--format', 'csv']),
        error => error.code === 'TASK_LEGACY_AUDIT_FORMAT_INVALID'
    );
});

test('legacy task audit result exposes only rule count and classification', () => {
    const rules = buildRules({
        ambiguousOwner: 1,
        uniqueOwnerBackfill: 2,
        statusWorkflowConflict: 3,
        dateScheduleConflict: 4,
        completedButActive: 5,
        missingBusinessContext: 6,
        orphanSource: 7,
        activeDuplicates: 8
    });
    assert.equal(rules.length, 8);
    for (const rule of rules) {
        assert.deepEqual(Object.keys(rule).sort(), ['classification', 'count', 'rule']);
        assert.equal(typeof rule.count, 'number');
    }
    const output = renderMarkdown(rules);
    assert.match(output, /ambiguous_owner/);
    assert.match(output, /\| 8 \| manual_review \|/);
    assert.doesNotMatch(output, /title|description|sourceId|ownerToken/i);
});

test('legacy task audit keeps one read-only transaction and returns aggregate rules only', async () => {
    const queries = [];
    const aggregateRows = [
        { ambiguous_owner: '1', unique_owner_backfill: '2' },
        { count: '3' }, { count: '4' }, { count: '5' }, { count: '6' }, { count: '7' }, { count: '8' }
    ];
    const client = {
        async query(text) {
            queries.push(String(text).trim());
            if (text === 'BEGIN READ ONLY' || text === 'ROLLBACK') return { rows: [] };
            if (text === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: 'on' }] };
            return { rows: [aggregateRows.shift()] };
        },
        release() {}
    };
    class FakePool {
        constructor(config) { this.config = config; }
        async connect() { return client; }
        async end() {}
    }

    const rules = await runAudit({}, {
        Pool: FakePool,
        env: { PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example.invalid/app' }
    });

    assert.equal(queries[0], 'BEGIN READ ONLY');
    assert.equal(queries[1], 'SHOW transaction_read_only');
    assert.equal(queries.at(-1), 'ROLLBACK');
    for (const query of queries.slice(2, -1)) {
        assert.match(query, /\bSELECT\b/i);
        assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
    }
    assert.deepEqual(rules.map(item => item.count), [1, 2, 3, 4, 5, 6, 7, 8]);
});
test('legacy task audit errors are safe to print', () => {
    assert.equal(safeErrorCode({ code: 'TASK_LEGACY_AUDIT_READ_ONLY_DATABASE_REQUIRED' }), 'TASK_LEGACY_AUDIT_READ_ONLY_DATABASE_REQUIRED');
    assert.equal(safeErrorCode({ code: 'ECONNREFUSED', message: 'postgres://secret.example.invalid' }), 'TASK_LEGACY_AUDIT_FAILED');
});
