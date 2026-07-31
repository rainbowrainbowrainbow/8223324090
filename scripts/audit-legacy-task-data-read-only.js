#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { duplicateSignatureSql } = require('../services/taskDuplicatePolicy');

const READ_ONLY_CONNECTION_ENV_KEY = 'PRODUCTION_READONLY_DATABASE_URL';
const OUTPUT_FORMATS = new Set(['json', 'markdown']);

function usage() {
    return [
        'Usage:',
        '  node scripts/audit-legacy-task-data-read-only.js [--format json|markdown]',
        '',
        `Connection: ${READ_ONLY_CONNECTION_ENV_KEY}.`,
        'Safety: aggregate read-only task audit; unsupported options are rejected.'
    ].join('\n');
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
            const error = new Error(`Unsupported option: ${arg}`);
            error.code = 'TASK_LEGACY_AUDIT_ARGUMENT_UNSUPPORTED';
            throw error;
        }
        const value = String(argv[index + 1] || '').trim();
        if (!OUTPUT_FORMATS.has(value)) {
            const error = new Error('--format must be json or markdown');
            error.code = 'TASK_LEGACY_AUDIT_FORMAT_INVALID';
            throw error;
        }
        options.format = value;
        index += 1;
    }
    return options;
}

function resolveReadOnlyConnectionString(env = process.env) {
    const connectionString = String(env[READ_ONLY_CONNECTION_ENV_KEY] || '').trim();
    if (connectionString) return { key: READ_ONLY_CONNECTION_ENV_KEY, connectionString };
    const error = new Error(`${READ_ONLY_CONNECTION_ENV_KEY} is required`);
    error.code = 'TASK_LEGACY_AUDIT_READ_ONLY_DATABASE_REQUIRED';
    throw error;
}

function poolConfig(env = process.env) {
    const { connectionString } = resolveReadOnlyConnectionString(env);
    return {
        connectionString,
        ssl: { rejectUnauthorized: false },
        application_name: 'task_legacy_readonly_audit'
    };
}

function countFromRow(row = {}) {
    const count = Number(row.count || 0);
    if (!Number.isFinite(count) || count < 0) {
        const error = new Error('Audit aggregate returned an invalid count');
        error.code = 'TASK_LEGACY_AUDIT_INVALID_COUNT';
        throw error;
    }
    return count;
}

async function loadOwnerCounts(client) {
    const result = await client.query(`
        WITH owner_tokens AS (
            SELECT t.id,
                   NULLIF(trim(COALESCE(t.assigned_to, '')), '') AS assigned_token,
                   NULLIF(trim(COALESCE(t.owner, '')), '') AS owner_token
            FROM tasks t
            WHERE t.owner_user_id IS NULL
        ),
        candidates AS (
            SELECT id,
                   COALESCE(assigned_token, owner_token) AS owner_token,
                   assigned_token IS NOT NULL
                     AND owner_token IS NOT NULL
                     AND lower(assigned_token) <> lower(owner_token) AS conflicting_tokens
            FROM owner_tokens
            WHERE assigned_token IS NOT NULL OR owner_token IS NOT NULL
        ),
        matched AS (
            SELECT c.id,
                   c.conflicting_tokens,
                   COUNT(DISTINCT u.id) FILTER (
                       WHERE c.owner_token = u.id::text
                          OR lower(c.owner_token) = lower(u.username)
                   )::int AS active_matches
            FROM candidates c
            LEFT JOIN users u
              ON COALESCE(u.is_active, true) IS TRUE
             AND (c.owner_token = u.id::text OR lower(c.owner_token) = lower(u.username))
            GROUP BY c.id, c.conflicting_tokens
        )
        SELECT COUNT(*) FILTER (WHERE conflicting_tokens OR active_matches <> 1)::int AS ambiguous_owner,
               COUNT(*) FILTER (WHERE NOT conflicting_tokens AND active_matches = 1)::int AS unique_owner_backfill
        FROM matched
    `);
    const row = result.rows[0] || {};
    return {
        ambiguousOwner: countFromRow({ count: row.ambiguous_owner }),
        uniqueOwnerBackfill: countFromRow({ count: row.unique_owner_backfill })
    };
}

async function loadStatusWorkflowConflictCount(client) {
    const result = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM tasks t
        WHERE (COALESCE(t.status, 'todo') IN ('done', 'archived')
                   AND COALESCE(t.workflow_state, 'todo') IS DISTINCT FROM t.status)
           OR (COALESCE(t.status, 'todo') NOT IN ('done', 'archived', 'cancelled')
                   AND COALESCE(t.workflow_state, 'todo') IN ('done', 'archived'))
    `);
    return countFromRow(result.rows[0]);
}

async function loadDateScheduleConflictCount(client) {
    const result = await client.query(`
        WITH calendar_values AS (
            SELECT NULLIF(left(trim(COALESCE(t.date, '')), 10), '') AS legacy_day,
                   CASE WHEN t.deadline IS NULL THEN NULL
                        ELSE to_char(t.deadline::date, 'YYYY-MM-DD') END AS deadline_day,
                   CASE WHEN t.scheduled_start_at IS NULL THEN NULL
                        ELSE to_char(t.scheduled_start_at AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD') END AS scheduled_day
            FROM tasks t
        )
        SELECT COUNT(*)::int AS count
        FROM calendar_values
        WHERE (legacy_day IS NOT NULL AND deadline_day IS NOT NULL AND legacy_day <> deadline_day)
           OR (legacy_day IS NOT NULL AND scheduled_day IS NOT NULL AND legacy_day <> scheduled_day)
           OR (deadline_day IS NOT NULL AND scheduled_day IS NOT NULL AND deadline_day <> scheduled_day)
    `);
    return countFromRow(result.rows[0]);
}

async function loadCompletedActiveCount(client) {
    const result = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM tasks t
        WHERE t.completed_at IS NOT NULL
          AND COALESCE(t.status, 'todo') NOT IN ('done', 'archived', 'cancelled')
    `);
    return countFromRow(result.rows[0]);
}

async function loadMissingBusinessContextCount(client) {
    const result = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM tasks t
        WHERE NULLIF(trim(COALESCE(t.business_context, '')), '') IS NULL
    `);
    return countFromRow(result.rows[0]);
}

async function loadOrphanSourceCount(client) {
    const result = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM tasks t
        WHERE (lower(COALESCE(t.source_type, '')) = 'booking'
                   AND NULLIF(trim(COALESCE(t.source_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id::text = t.source_id::text))
           OR (lower(COALESCE(t.source_type, '')) = 'lead'
                   AND NULLIF(trim(COALESCE(t.source_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id::text = t.source_id::text))
           OR (lower(COALESCE(t.source_type, '')) = 'customer'
                   AND NULLIF(trim(COALESCE(t.source_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id::text = t.source_id::text))
           OR (lower(COALESCE(t.source_type, '')) = 'report'
                   AND NULLIF(trim(COALESCE(t.source_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.id::text = t.source_id::text))
           OR (lower(COALESCE(t.source_type, '')) IN ('event', 'afisha')
                   AND NULLIF(trim(COALESCE(t.source_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM afisha a WHERE a.id::text = t.source_id::text))
           OR (lower(COALESCE(t.source_type, '')) = 'conversation_reply'
                   AND NULLIF(trim(COALESCE(t.source_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.id::text = t.source_id::text))
           OR (lower(COALESCE(t.source_entity_type, '')) = 'lead'
                   AND NULLIF(trim(COALESCE(t.source_entity_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id::text = t.source_entity_id::text))
           OR (lower(COALESCE(t.source_entity_type, '')) = 'customer'
                   AND NULLIF(trim(COALESCE(t.source_entity_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id::text = t.source_entity_id::text))
           OR (lower(COALESCE(t.source_entity_type, '')) = 'report'
                   AND NULLIF(trim(COALESCE(t.source_entity_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.id::text = t.source_entity_id::text))
           OR (lower(COALESCE(t.related_entity_type, '')) = 'conversation'
                   AND NULLIF(trim(COALESCE(t.related_entity_id::text, '')), '') IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id::text = t.related_entity_id::text))
    `);
    return countFromRow(result.rows[0]);
}

async function loadActiveDuplicateCount(client) {
    const signature = duplicateSignatureSql('t');
    const result = await client.query(`
        WITH active AS (
            SELECT ${signature} AS duplicate_signature
            FROM tasks t
            WHERE COALESCE(t.status, 'todo') NOT IN ('done', 'archived', 'cancelled')
              AND COALESCE(trim(t.title), '') <> ''
        ),
        duplicate_groups AS (
            SELECT duplicate_signature, COUNT(*)::int AS group_count
            FROM active
            GROUP BY duplicate_signature
            HAVING COUNT(*) > 1
        )
        SELECT COALESCE(SUM(group_count - 1), 0)::int AS count
        FROM duplicate_groups
    `);
    return countFromRow(result.rows[0]);
}

function buildRules(counts) {
    return [
        { rule: 'ambiguous_owner', count: counts.ambiguousOwner, classification: 'manual_review' },
        { rule: 'unique_owner_backfill_candidate', count: counts.uniqueOwnerBackfill, classification: 'deterministic_candidate' },
        { rule: 'status_workflow_conflict', count: counts.statusWorkflowConflict, classification: 'manual_review' },
        { rule: 'date_deadline_schedule_conflict', count: counts.dateScheduleConflict, classification: 'manual_review' },
        { rule: 'completed_but_active', count: counts.completedButActive, classification: 'manual_review' },
        { rule: 'missing_business_context', count: counts.missingBusinessContext, classification: 'manual_review' },
        { rule: 'orphan_source', count: counts.orphanSource, classification: 'manual_review' },
        { rule: 'active_duplicates', count: counts.activeDuplicates, classification: 'manual_review' }
    ];
}

async function runAudit(options = {}, dependencies = {}) {
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
            const error = new Error('Transaction is not read-only');
            error.code = 'TASK_LEGACY_AUDIT_TRANSACTION_NOT_READ_ONLY';
            throw error;
        }
        const owner = await loadOwnerCounts(client);
        const counts = {
            ambiguousOwner: owner.ambiguousOwner,
            uniqueOwnerBackfill: owner.uniqueOwnerBackfill,
            statusWorkflowConflict: await loadStatusWorkflowConflictCount(client),
            dateScheduleConflict: await loadDateScheduleConflictCount(client),
            completedButActive: await loadCompletedActiveCount(client),
            missingBusinessContext: await loadMissingBusinessContextCount(client),
            orphanSource: await loadOrphanSourceCount(client),
            activeDuplicates: await loadActiveDuplicateCount(client)
        };
        return buildRules(counts);
    } finally {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        client?.release();
        await pool.end();
    }
}

function renderMarkdown(rules = []) {
    return [
        '| Rule | Count | Classification |',
        '| --- | ---: | --- |',
        ...rules.map(item => `| ${item.rule} | ${item.count} | ${item.classification} |`)
    ].join('\n');
}

function safeErrorCode(error) {
    return error?.code && /^TASK_LEGACY_AUDIT_[A-Z_]+$/.test(error.code)
        ? error.code
        : 'TASK_LEGACY_AUDIT_FAILED';
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const rules = await runAudit(options);
    process.stdout.write(options.format === 'markdown'
        ? `${renderMarkdown(rules)}\n`
        : `${JSON.stringify(rules)}\n`);
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Task legacy audit failed: ${safeErrorCode(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    READ_ONLY_CONNECTION_ENV_KEY,
    buildRules,
    parseArgs,
    poolConfig,
    renderMarkdown,
    resolveReadOnlyConnectionString,
    runAudit,
    safeErrorCode
};
