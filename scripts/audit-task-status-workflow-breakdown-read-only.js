#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const {
    READ_ONLY_CONNECTION_ENV_KEY,
    resolveReadOnlyConnectionString
} = require('./audit-legacy-task-data-read-only');

const OUTPUT_FORMATS = new Set(['json', 'markdown']);
const SAFE_STATE_VALUES = new Set([
    'archived',
    'cancelled',
    'done',
    'in_progress',
    'inbox',
    'scheduled',
    'todo',
    'waiting'
]);

function usage() {
    return [
        'Usage:',
        '  node scripts/audit-task-status-workflow-breakdown-read-only.js [--format json|markdown]',
        '',
        `Connection: ${READ_ONLY_CONNECTION_ENV_KEY}.`,
        'Safety: aggregate read-only status/workflow breakdown; unsupported options are rejected.'
    ].join('\n');
}

function taskError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function parseArgs(argv = []) {
    const options = { format: 'json' };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg !== '--format') {
            throw taskError('TASK_STATUS_WORKFLOW_BREAKDOWN_ARGUMENT_UNSUPPORTED', `Unsupported option: ${arg}`);
        }
        const value = String(argv[index + 1] || '').trim();
        if (!OUTPUT_FORMATS.has(value)) {
            throw taskError('TASK_STATUS_WORKFLOW_BREAKDOWN_FORMAT_INVALID', '--format must be json or markdown');
        }
        options.format = value;
        index += 1;
    }
    return options;
}

function poolConfig(env = process.env) {
    const { connectionString } = resolveReadOnlyConnectionString(env);
    return {
        connectionString,
        ssl: { rejectUnauthorized: false },
        application_name: 'task_status_workflow_breakdown_readonly_audit'
    };
}

function normalizeStateValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SAFE_STATE_VALUES.has(normalized) ? normalized : 'legacy_other';
}

function countFromRow(row = {}) {
    const count = Number(row.count || 0);
    if (!Number.isSafeInteger(count) || count <= 0) {
        throw taskError('TASK_STATUS_WORKFLOW_BREAKDOWN_INVALID_COUNT', 'Breakdown aggregate returned an invalid count');
    }
    return count;
}

function normalizeBreakdownRows(rows = []) {
    return rows.map(row => ({
        status: normalizeStateValue(row.status),
        workflowState: normalizeStateValue(row.workflow_state),
        count: countFromRow(row)
    }));
}

async function loadBreakdown(client) {
    const result = await client.query(`
        WITH conflicting_tasks AS (
            SELECT CASE
                       WHEN lower(COALESCE(t.status, 'todo')) IN ('archived', 'cancelled', 'done', 'in_progress', 'inbox', 'scheduled', 'todo', 'waiting')
                           THEN lower(COALESCE(t.status, 'todo'))
                       ELSE 'legacy_other'
                   END AS status,
                   CASE
                       WHEN lower(COALESCE(t.workflow_state, 'todo')) IN ('archived', 'cancelled', 'done', 'in_progress', 'inbox', 'scheduled', 'todo', 'waiting')
                           THEN lower(COALESCE(t.workflow_state, 'todo'))
                       ELSE 'legacy_other'
                   END AS workflow_state
            FROM tasks t
            WHERE (COALESCE(t.status, 'todo') IN ('done', 'archived')
                       AND COALESCE(t.workflow_state, 'todo') IS DISTINCT FROM t.status)
               OR (COALESCE(t.status, 'todo') NOT IN ('done', 'archived', 'cancelled')
                       AND COALESCE(t.workflow_state, 'todo') IN ('done', 'archived'))
        )
        SELECT status, workflow_state, COUNT(*)::int AS count
        FROM conflicting_tasks
        GROUP BY status, workflow_state
        ORDER BY count DESC, status ASC, workflow_state ASC
    `);
    return normalizeBreakdownRows(result.rows || []);
}

async function runBreakdown(options = {}, dependencies = {}) {
    const PoolCtor = dependencies.Pool || Pool;
    const pool = new PoolCtor(poolConfig(dependencies.env || process.env));
    let client;
    let transactionOpen = false;
    try {
        client = await pool.connect();
        await client.query('BEGIN READ ONLY');
        transactionOpen = true;
        const readOnly = await client.query('SHOW transaction_read_only');
        if (readOnly.rows[0]?.transaction_read_only !== 'on') {
            throw taskError('TASK_STATUS_WORKFLOW_BREAKDOWN_TRANSACTION_NOT_READ_ONLY', 'Transaction is not read-only');
        }
        return loadBreakdown(client);
    } finally {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        client?.release();
        await pool.end();
    }
}

function renderMarkdown(rows = []) {
    return [
        '| Status | Workflow state | Count |',
        '| --- | --- | ---: |',
        ...rows.map(row => `| ${row.status} | ${row.workflowState} | ${row.count} |`)
    ].join('\n');
}

function safeErrorCode(error) {
    return error?.code && /^TASK_STATUS_WORKFLOW_BREAKDOWN_[A-Z_]+$/.test(error.code)
        ? error.code
        : 'TASK_STATUS_WORKFLOW_BREAKDOWN_FAILED';
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const rows = await runBreakdown(options);
    process.stdout.write(options.format === 'markdown'
        ? `${renderMarkdown(rows)}\n`
        : `${JSON.stringify(rows)}\n`);
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Task status/workflow breakdown failed: ${safeErrorCode(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    READ_ONLY_CONNECTION_ENV_KEY,
    normalizeBreakdownRows,
    normalizeStateValue,
    parseArgs,
    poolConfig,
    renderMarkdown,
    runBreakdown,
    safeErrorCode
};
