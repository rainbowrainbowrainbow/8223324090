#!/usr/bin/env node
/**
 * Report-only stale machine task classifier.
 *
 * This script intentionally has no apply/archive mode. It reads production data
 * in a repeatable-read read-only transaction, rolls back, then writes only a
 * PII-free aggregate manifest if an output path is provided.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const {
    CLASSIFIER_VERSION,
    buildStaleMachineReport,
    summaryForStdout
} = require('../services/taskStaleMachineReport');

const BLOCKED_FLAGS = Object.freeze([
    '--apply',
    '--archive',
    '--delete',
    '--update',
    '--restore',
    '--commit',
    '--write-production'
]);

function parseArgs(argv = process.argv.slice(2)) {
    const parsed = { output: null, help: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (BLOCKED_FLAGS.includes(arg)) {
            throw new Error(`task-stale-machine-report is report-only; ${arg} is not supported`);
        }
        if (arg === '--help' || arg === '-h') {
            parsed.help = true;
            continue;
        }
        if (arg === '--output') {
            parsed.output = argv[index + 1];
            index += 1;
            continue;
        }
        if (!arg.startsWith('--') && !parsed.output) {
            parsed.output = arg;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return parsed;
}

function printHelp() {
    console.log(`Usage: node scripts/task-stale-machine-report.js [--output <path>]

Report-only classifier: ${CLASSIFIER_VERSION}

Environment:
  TASK_CLEANUP_READONLY_DATABASE_URL or DATABASE_URL

Blocked by design:
  ${BLOCKED_FLAGS.join(', ')}`);
}

function poolConfig(env = process.env) {
    const connectionString = env.TASK_CLEANUP_READONLY_DATABASE_URL || env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('TASK_CLEANUP_READONLY_DATABASE_URL or DATABASE_URL is required');
    }
    const sslMode = String(env.PGSSLMODE || '').toLowerCase();
    return {
        connectionString,
        ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false }
    };
}

function canonicalDueDateSql(alias = 't') {
    return `COALESCE(
        (${alias}.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.snoozed_until AT TIME ZONE 'Europe/Kyiv')::date,
        CASE
            WHEN LEFT(COALESCE(${alias}.date::text, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
            THEN LEFT(${alias}.date::text, 10)::date
            ELSE NULL
        END,
        (${alias}.deadline AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.remind_at AT TIME ZONE 'Europe/Kyiv')::date
    )`;
}

function humanTouchPredicateSql(alias = 't') {
    return `(
        EXISTS (
            SELECT 1
            FROM task_logs tl
            WHERE tl.task_id = ${alias}.id
              AND LOWER(COALESCE(tl.actor, '')) <> ALL(ARRAY['', 'system', 'kleshnya', 'rule_engine', 'scheduler', 'task_lifecycle', 'automation'])
            LIMIT 1
        )
        OR EXISTS (
            SELECT 1
            FROM task_action_history tah
            WHERE tah.task_id = ${alias}.id
              AND (
                  tah.actor_user_id IS NOT NULL
                  OR LOWER(COALESCE(tah.actor_name_snapshot, '')) <> ALL(ARRAY['', 'system', 'kleshnya', 'rule_engine', 'scheduler', 'task_lifecycle', 'automation'])
              )
            LIMIT 1
        )
    )`;
}

function buildReportSql() {
    const due = canonicalDueDateSql('t');
    return `
        WITH runtime AS (
            SELECT (NOW() AT TIME ZONE 'Europe/Kyiv')::date AS kyiv_today, NOW() AS captured_at
        )
        SELECT
            t.id::int AS task_id,
            LOWER(COALESCE(t.status, 'todo')) AS task_status,
            LOWER(COALESCE(t.workflow_state, 'todo')) AS workflow_state,
            LOWER(COALESCE(t.type, '')) AS task_type,
            LOWER(COALESCE(t.source_type, '')) AS source_type,
            LOWER(COALESCE(t.source_module, '')) AS source_module,
            CASE
                WHEN LOWER(COALESCE(t.created_by, '')) = ANY(ARRAY['rule_engine', 'system', 'scheduler', 'kleshnya', 'task_lifecycle', 'automation'])
                THEN LOWER(COALESCE(t.created_by, ''))
                WHEN COALESCE(t.created_by, '') = '' THEN 'unknown'
                ELSE 'human_named_or_legacy'
            END AS creator_class,
            COALESCE(t.created_by_user_id, 0)::int AS created_by_user_id,
            LOWER(COALESCE(t.visibility, 'team')) AS visibility,
            LOWER(COALESCE(t.task_mode, 'work')) AS task_mode,
            COALESCE(t.focus_rank, 0)::int AS focus_rank,
            t.snoozed_until IS NOT NULL AS has_snooze,
            (t.snoozed_until IS NOT NULL AND t.snoozed_until > NOW()) AS has_future_snooze,
            LOWER(COALESCE(t.status, 'todo')) NOT IN ('done', 'completed', 'cancelled', 'canceled', 'archived')
                AND t.archived_at IS NULL AS active,
            t.archived_at IS NOT NULL AS archived,
            (${due})::text AS due_date,
            (
                ${due} < runtime.kyiv_today
                AND (t.snoozed_until IS NULL OR t.snoozed_until <= NOW())
                AND LOWER(COALESCE(t.status, 'todo')) NOT IN ('done', 'completed', 'cancelled', 'canceled', 'archived')
                AND t.archived_at IS NULL
            ) AS canonical_overdue,
            ${humanTouchPredicateSql('t')} AS human_touched,
            COALESCE((SELECT COUNT(*)::int FROM task_subtasks st WHERE st.task_id = t.id), 0) AS subtask_count,
            COALESCE((SELECT COUNT(*)::int FROM task_dependencies td WHERE td.task_id = t.id OR td.depends_on_task_id = t.id), 0) AS dependency_count,
            COALESCE((SELECT COUNT(*)::int FROM task_observers tob WHERE tob.task_id = t.id), 0) AS observer_count,
            b.id IS NOT NULL AS booking_found,
            LOWER(COALESCE(b.status, '')) AS booking_status,
            CASE
                WHEN b.id IS NULL THEN 'missing'
                WHEN b.date::date >= runtime.kyiv_today THEN 'today_or_future'
                ELSE 'past'
            END AS booking_date_bucket,
            t.template_id IS NOT NULL AS has_template_id,
            tt.id IS NOT NULL AS template_found,
            COALESCE(tt.is_active, false) AS template_active,
            CASE
                WHEN tt.id IS NULL THEN NULL
                ELSE COALESCE(tt.business_context, t.business_context, 'event_genix') = COALESCE(t.business_context, 'event_genix')
            END AS template_context_match,
            runtime.kyiv_today::text AS kyiv_today,
            runtime.captured_at::text AS captured_at
        FROM tasks t
        CROSS JOIN runtime
        LEFT JOIN bookings b ON b.id::text = NULLIF(BTRIM(COALESCE(t.source_id, '')), '')
        LEFT JOIN task_templates tt ON tt.id = t.template_id
        WHERE
            LOWER(COALESCE(t.source_type, '')) = ANY(ARRAY['booking', 'manual', 'recurring', 'attendance', 'hermes', 'integration', 'ai_draft', 'ai_draft_bundle'])
            OR LOWER(COALESCE(t.source_module, '')) = ANY(ARRAY['attendance', 'hermes', 'integration'])
            OR LOWER(COALESCE(t.type, '')) = ANY(ARRAY['auto', 'auto_complete', 'recurring', 'ai_draft', 'ai_draft_bundle'])
            OR LOWER(COALESCE(t.created_by, '')) = ANY(ARRAY['rule_engine', 'system', 'scheduler'])
            OR t.template_id IS NOT NULL
        ORDER BY t.id ASC
    `;
}

async function runReport(options = {}, env = process.env) {
    const pool = new Pool(poolConfig(env));
    let client;
    let rows = [];
    try {
        client = await pool.connect();
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const readOnly = await client.query('SHOW transaction_read_only');
        const isolation = await client.query('SHOW transaction_isolation');
        if (readOnly.rows?.[0]?.transaction_read_only !== 'on') {
            throw new Error('read_only_transaction_not_verified');
        }
        if (String(isolation.rows?.[0]?.transaction_isolation || '').toLowerCase() !== 'repeatable read') {
            throw new Error('repeatable_read_transaction_not_verified');
        }
        const result = await client.query(buildReportSql());
        rows = result.rows;
        await client.query('ROLLBACK');
    } catch (error) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch {}
        }
        throw error;
    } finally {
        if (client) client.release();
        await pool.end();
    }

    const report = buildStaleMachineReport(rows, {
        capturedAt: rows[0]?.captured_at,
        kyivToday: rows[0]?.kyiv_today
    });

    if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    return report;
}

async function main() {
    const args = parseArgs();
    if (args.help) {
        printHelp();
        return;
    }
    const report = await runReport(args);
    console.log(JSON.stringify(summaryForStdout(report), null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    BLOCKED_FLAGS,
    parseArgs,
    poolConfig,
    canonicalDueDateSql,
    humanTouchPredicateSql,
    buildReportSql,
    runReport
};
