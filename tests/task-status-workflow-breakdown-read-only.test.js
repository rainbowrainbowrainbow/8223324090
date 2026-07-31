'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts', 'audit-task-status-workflow-breakdown-read-only.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const {
    READ_ONLY_CONNECTION_ENV_KEY,
    normalizeBreakdownRows,
    normalizeStateValue,
    parseArgs,
    poolConfig,
    renderMarkdown,
    runBreakdown,
    safeErrorCode
} = require('../scripts/audit-task-status-workflow-breakdown-read-only');

test('status/workflow breakdown accepts only the dedicated read-only connection string', () => {
    assert.equal(READ_ONLY_CONNECTION_ENV_KEY, 'PRODUCTION_READONLY_DATABASE_URL');
    assert.throws(
        () => poolConfig({ DATABASE_URL: 'postgres://writer.example.invalid/app' }),
        error => error.code === 'TASK_LEGACY_AUDIT_READ_ONLY_DATABASE_REQUIRED'
    );
    assert.deepEqual(poolConfig({ PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example.invalid/app' }), {
        connectionString: 'postgres://readonly.example.invalid/app',
        ssl: { rejectUnauthorized: false },
        application_name: 'task_status_workflow_breakdown_readonly_audit'
    });
});

test('status/workflow breakdown is read-only and has no mutation mode or task-detail output', () => {
    assert.match(scriptSource, /BEGIN READ ONLY/);
    assert.match(scriptSource, /SHOW transaction_read_only/);
    assert.match(scriptSource, /query\('ROLLBACK'\)/);
    assert.doesNotMatch(scriptSource, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
    assert.doesNotMatch(scriptSource, /\b(?:title|description|owner_user_id|business_context|source_id)\b/i);
    for (const option of ['--apply', '--fix', '--write', '--execute', '--migration']) {
        assert.throws(
            () => parseArgs([option]),
            error => error.code === 'TASK_STATUS_WORKFLOW_BREAKDOWN_ARGUMENT_UNSUPPORTED'
        );
    }
});

test('status/workflow breakdown masks unexpected state values and exposes aggregate fields only', () => {
    assert.equal(normalizeStateValue('IN_PROGRESS'), 'in_progress');
    assert.equal(normalizeStateValue('possible personal value'), 'legacy_other');
    const rows = normalizeBreakdownRows([
        { status: 'todo', workflow_state: 'done', count: '12' },
        { status: 'possible personal value', workflow_state: 'ARCHIVED', count: '3' }
    ]);
    assert.deepEqual(rows, [
        { status: 'todo', workflowState: 'done', count: 12 },
        { status: 'legacy_other', workflowState: 'archived', count: 3 }
    ]);
    assert.match(renderMarkdown(rows), /\| todo \| done \| 12 \|/);
    assert.equal(safeErrorCode({ code: 'TASK_STATUS_WORKFLOW_BREAKDOWN_TRANSACTION_NOT_READ_ONLY' }), 'TASK_STATUS_WORKFLOW_BREAKDOWN_TRANSACTION_NOT_READ_ONLY');
    assert.equal(safeErrorCode({ code: 'ECONNREFUSED' }), 'TASK_STATUS_WORKFLOW_BREAKDOWN_FAILED');
});

test('status/workflow breakdown keeps one read-only transaction and returns aggregate pairs', async () => {
    const queries = [];
    const client = {
        async query(text) {
            queries.push(String(text).trim());
            if (text === 'BEGIN READ ONLY' || text === 'ROLLBACK') return { rows: [] };
            if (text === 'SHOW transaction_read_only') return { rows: [{ transaction_read_only: 'on' }] };
            return { rows: [{ status: 'todo', workflow_state: 'done', count: '639' }] };
        },
        release() {}
    };
    class FakePool {
        async connect() { return client; }
        async end() {}
    }

    const rows = await runBreakdown({}, {
        Pool: FakePool,
        env: { PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example.invalid/app' }
    });

    assert.deepEqual(rows, [{ status: 'todo', workflowState: 'done', count: 639 }]);
    assert.equal(queries[0], 'BEGIN READ ONLY');
    assert.equal(queries[1], 'SHOW transaction_read_only');
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.match(queries[2], /\bSELECT\b/i);
    assert.doesNotMatch(queries[2], /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
});
