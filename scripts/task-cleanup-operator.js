#!/usr/bin/env node
'use strict';

/**
 * Safe operator toolkit for approved task cleanup waves.
 *
 * Default mode is dry-run only:
 *   - opens a REPEATABLE READ READ ONLY transaction;
 *   - verifies transaction_read_only and transaction_isolation;
 *   - builds deterministic manifests/checksums;
 *   - prints aggregate-only stdout.
 *
 * Apply mode is fail-closed and is intentionally awkward:
 *   - requires --apply plus exact approved classifier/count/checksum/reason;
 *   - uses TASK_CLEANUP_APPLY_DATABASE_URL, never generic DATABASE_URL;
 *   - writes a rollback manifest before mutation;
 *   - repeats all safety predicates inside UPDATE;
 *   - archives only; DELETE and status=done are not supported.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const BLOCKED_FLAGS = new Set([
    '--backfill',
    '--delete',
    '--done',
    '--execute',
    '--fix',
    '--mutate',
    '--repair',
    '--restore',
    '--status',
    '--update',
    '--write'
]);

const TERMINAL_STATUSES = ['done', 'completed', 'cancelled', 'canceled', 'archived'];
const PRIVATE_OR_PERSONAL = ['private', 'me_only', 'personal'];
const SYSTEM_ACTORS = ['', 'system', 'kleshnya', 'rule_engine', 'scheduler', 'task_lifecycle', 'automation'];
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

function usage() {
    return [
        'Usage:',
        '  node scripts/task-cleanup-operator.js --classifier <classifierVersion> [--output manifest.json]',
        '  node scripts/task-cleanup-operator.js --classifier <classifierVersion> --apply \\',
        '    --approved-classifier <classifierVersion> \\',
        '    --approved-count <count> \\',
        '    --approved-membership-checksum <checksum> \\',
        '    --archive-reason cleanup_reason_v1 \\',
        '    --rollback-output rollback.json',
        '',
        'Dry-run connection:',
        '  TASK_CLEANUP_AUDIT_DATABASE_URL, TASK_AUDIT_DATABASE_URL, or PRODUCTION_READONLY_DATABASE_URL.',
        '',
        'Apply connection:',
        '  TASK_CLEANUP_APPLY_DATABASE_URL only. Generic DATABASE_URL is intentionally refused.',
        '',
        'Safety:',
        '  Dry-run is the default. Apply requires exact approved classifier/count/checksum.',
        '  DELETE, status=done, restore, generic update, schema, and scheduler actions are not supported.',
        '  stdout never prints task IDs, titles, owner names, source IDs, or secrets.',
        '',
        'Supported classifiers:',
        ...Object.keys(CLASSIFIERS).map(name => `  - ${name}`)
    ].join('\n');
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function sha(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function readRequiredValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    return value.trim();
}

function parseArgs(argv) {
    const options = {
        apply: false,
        approvedClassifier: '',
        approvedCount: null,
        approvedMembershipChecksum: '',
        archiveReason: '',
        batchSize: DEFAULT_BATCH_SIZE,
        classifier: '',
        help: false,
        output: '',
        rollbackOutput: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (BLOCKED_FLAGS.has(arg) || [...BLOCKED_FLAGS].some(flag => arg.startsWith(`${flag}=`))) {
            throw new Error(`${arg} is not supported by task-cleanup-operator`);
        }
        if (arg === '--apply') {
            options.apply = true;
            continue;
        }
        const setString = (key, flag) => {
            options[key] = readRequiredValue(argv, index, flag);
            index += 1;
        };
        if (arg === '--approved-classifier') setString('approvedClassifier', arg);
        else if (arg === '--approved-membership-checksum') setString('approvedMembershipChecksum', arg);
        else if (arg === '--archive-reason') setString('archiveReason', arg);
        else if (arg === '--classifier') setString('classifier', arg);
        else if (arg === '--output') setString('output', arg);
        else if (arg === '--rollback-output') setString('rollbackOutput', arg);
        else if (arg === '--approved-count') {
            const value = readRequiredValue(argv, index, arg);
            if (!/^\d+$/.test(value)) throw new Error('--approved-count must be a non-negative integer');
            options.approvedCount = Number(value);
            index += 1;
        } else if (arg === '--batch-size') {
            const value = readRequiredValue(argv, index, arg);
            if (!/^\d+$/.test(value)) throw new Error('--batch-size must be a positive integer');
            options.batchSize = Number(value);
            if (options.batchSize < 1 || options.batchSize > MAX_BATCH_SIZE) {
                throw new Error(`--batch-size must be between 1 and ${MAX_BATCH_SIZE}`);
            }
            index += 1;
        } else if (!arg.startsWith('--') && !options.classifier) {
            options.classifier = arg.trim();
        } else if (!arg.startsWith('--') && !options.output) {
            options.output = arg.trim();
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!options.help && !options.classifier) throw new Error('--classifier is required');
    if (options.classifier && !CLASSIFIERS[options.classifier]) {
        throw new Error(`Unsupported classifier: ${options.classifier}`);
    }
    if (options.apply) validateApplyOptionsShape(options);
    return options;
}

function validateApplyOptionsShape(options) {
    const missing = [];
    if (!options.approvedClassifier) missing.push('--approved-classifier');
    if (options.approvedCount == null) missing.push('--approved-count');
    if (!options.approvedMembershipChecksum) missing.push('--approved-membership-checksum');
    if (!options.archiveReason) missing.push('--archive-reason');
    if (!options.rollbackOutput) missing.push('--rollback-output');
    if (missing.length) throw new Error(`Apply mode requires ${missing.join(', ')}`);
    if (options.approvedClassifier !== options.classifier) {
        throw new Error('Approved classifier does not match selected classifier');
    }
    if (!/^[a-f0-9]{64}$/i.test(options.approvedMembershipChecksum)) {
        throw new Error('Approved membership checksum must be a SHA-256 hex string');
    }
    if (!/^cleanup_[a-z0-9_:-]{8,120}$/i.test(options.archiveReason)) {
        throw new Error('--archive-reason must be deterministic and start with cleanup_');
    }
    if (/done|delete|remove|purge|drop/i.test(options.archiveReason)) {
        throw new Error('--archive-reason must not describe delete/done/purge behavior');
    }
}

function poolConfig(mode, env = process.env) {
    if (mode === 'apply') {
        const connectionString = String(env.TASK_CLEANUP_APPLY_DATABASE_URL || '').trim();
        if (!connectionString) {
            throw new Error('Set TASK_CLEANUP_APPLY_DATABASE_URL for apply mode; generic DATABASE_URL is refused');
        }
        return {
            connectionString,
            ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
            application_name: 'task_cleanup_operator_apply'
        };
    }

    const connectionString = String(
        env.TASK_CLEANUP_AUDIT_DATABASE_URL
        || env.TASK_AUDIT_DATABASE_URL
        || env.PRODUCTION_READONLY_DATABASE_URL
        || ''
    ).trim();
    if (!connectionString) {
        throw new Error('Set TASK_CLEANUP_AUDIT_DATABASE_URL, TASK_AUDIT_DATABASE_URL, or PRODUCTION_READONLY_DATABASE_URL for dry-run');
    }
    return {
        connectionString,
        ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        application_name: 'task_cleanup_operator_dry_run'
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

function commonSafetyPredicateSql(alias = 't') {
    const due = canonicalDueDateSql(alias);
    return `
        LOWER(COALESCE(${alias}.status, 'todo')) <> ALL(ARRAY['done', 'completed', 'cancelled', 'canceled', 'archived'])
        AND ${alias}.archived_at IS NULL
        AND ${due} < runtime.kyiv_today
        AND LOWER(COALESCE(${alias}.status, 'todo')) <> 'in_progress'
        AND LOWER(COALESCE(${alias}.workflow_state, 'todo')) <> 'in_progress'
        AND COALESCE(${alias}.created_by_user_id, 0) = 0
        AND LOWER(COALESCE(${alias}.visibility, 'team')) <> ALL(ARRAY['private', 'me_only', 'personal'])
        AND LOWER(COALESCE(${alias}.task_mode, 'work')) <> ALL(ARRAY['private', 'me_only', 'personal'])
        AND COALESCE(${alias}.focus_rank, 0) = 0
        AND ${alias}.snoozed_until IS NULL
        AND NOT ${humanTouchPredicateSql(alias)}
        AND NOT EXISTS (SELECT 1 FROM task_subtasks st WHERE st.task_id = ${alias}.id)
        AND NOT EXISTS (SELECT 1 FROM task_dependencies td WHERE td.task_id = ${alias}.id OR td.depends_on_task_id = ${alias}.id)
        AND NOT EXISTS (SELECT 1 FROM task_observers tob WHERE tob.task_id = ${alias}.id)
        AND LOWER(COALESCE(${alias}.source_type, '')) NOT LIKE '%ai%'
        AND LOWER(COALESCE(${alias}.source_module, '')) NOT LIKE '%ai%'
        AND LOWER(COALESCE(${alias}.type, '')) <> ALL(ARRAY['ai_draft', 'ai_draft_bundle'])
        AND LOWER(COALESCE(${alias}.source_type, '')) NOT LIKE '%hermes%'
        AND LOWER(COALESCE(${alias}.source_module, '')) NOT LIKE '%hermes%'
        AND LOWER(COALESCE(${alias}.source_type, '')) NOT LIKE '%integration%'
        AND LOWER(COALESCE(${alias}.source_module, '')) NOT LIKE '%integration%'
        AND LOWER(COALESCE(${alias}.source_type, '')) NOT LIKE '%attendance%'
        AND LOWER(COALESCE(${alias}.source_module, '')) NOT LIKE '%attendance%'
    `;
}

function baseSelectSql(extraPredicate) {
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
            CASE
                WHEN LOWER(COALESCE(t.created_by, '')) = ANY(ARRAY['rule_engine', 'system', 'scheduler', 'kleshnya', 'task_lifecycle', 'automation'])
                THEN LOWER(COALESCE(t.created_by, ''))
                WHEN COALESCE(t.created_by, '') = '' THEN 'unknown'
                ELSE 'human_named_or_legacy'
            END AS creator_class,
            (${canonicalDueDateSql('t')})::text AS due_date,
            LOWER(COALESCE(b.status, '')) AS booking_status,
            CASE
                WHEN b.id IS NULL THEN 'missing'
                WHEN b.date::date >= runtime.kyiv_today THEN 'today_or_future'
                ELSE 'past'
            END AS booking_date_bucket,
            runtime.kyiv_today::text AS kyiv_today,
            runtime.captured_at,
            false AS has_protections
        FROM tasks t
        CROSS JOIN runtime
        JOIN bookings b ON b.id::text = NULLIF(BTRIM(COALESCE(t.source_id, '')), '')
        WHERE ${commonSafetyPredicateSql('t')}
          AND ${extraPredicate}
        ORDER BY t.id ASC
    `;
}

const CLASSIFIERS = Object.freeze({
    task5_strict_auto_complete_cancelled_booking_v1_2026_08_09: {
        label: 'strict auto_complete booking tasks linked to cancelled bookings',
        predicateSql: `
            LOWER(COALESCE(t.source_type, '')) = 'booking'
            AND LOWER(COALESCE(t.type, '')) = 'auto_complete'
            AND LOWER(COALESCE(t.created_by, '')) = 'rule_engine'
            AND LOWER(COALESCE(b.status, '')) = ANY(ARRAY['cancelled', 'canceled'])
        `
    },
    task_strict_auto_complete_past_booking_backlog_v1_2026_08_10: {
        label: 'strict auto_complete booking tasks linked to past non-cancelled bookings',
        predicateSql: `
            LOWER(COALESCE(t.source_type, '')) = 'booking'
            AND LOWER(COALESCE(t.type, '')) = 'auto_complete'
            AND LOWER(COALESCE(t.created_by, '')) = 'rule_engine'
            AND LOWER(COALESCE(b.status, '')) <> ALL(ARRAY['cancelled', 'canceled'])
            AND b.date::date < runtime.kyiv_today
        `
    },
    task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_past_confirmed_booking: {
        label: 'strict type=auto booking tasks linked to past confirmed bookings',
        predicateSql: `
            LOWER(COALESCE(t.source_type, '')) = 'booking'
            AND LOWER(COALESCE(t.type, '')) = 'auto'
            AND LOWER(COALESCE(t.created_by, '')) = 'rule_engine'
            AND LOWER(COALESCE(b.status, '')) = 'confirmed'
            AND b.date::date < runtime.kyiv_today
        `
    },
    task_strict_rule_engine_booking_type_auto_backlog_v1_2026_08_10_cancelled_booking: {
        label: 'strict type=auto booking tasks linked to cancelled bookings',
        predicateSql: `
            LOWER(COALESCE(t.source_type, '')) = 'booking'
            AND LOWER(COALESCE(t.type, '')) = 'auto'
            AND LOWER(COALESCE(t.created_by, '')) = 'rule_engine'
            AND LOWER(COALESCE(b.status, '')) = ANY(ARRAY['cancelled', 'canceled'])
        `
    }
});

function buildDryRunSql(classifierVersion) {
    return baseSelectSql(CLASSIFIERS[classifierVersion].predicateSql);
}

function buildArchiveUpdateSql(classifierVersion) {
    const extraPredicate = CLASSIFIERS[classifierVersion].predicateSql.replace(/\bt\./g, 'candidate.').replace(/\bb\./g, 'b.');
    return `
        WITH runtime AS (
            SELECT (NOW() AT TIME ZONE 'Europe/Kyiv')::date AS kyiv_today
        ),
        approved(id) AS (
            SELECT UNNEST($1::int[])
        ),
        eligible AS (
            SELECT candidate.id
            FROM tasks candidate
            JOIN approved ON approved.id = candidate.id
            JOIN bookings b ON b.id::text = NULLIF(BTRIM(COALESCE(candidate.source_id, '')), '')
            CROSS JOIN runtime
            WHERE ${commonSafetyPredicateSql('candidate')}
              AND ${extraPredicate}
        )
        UPDATE tasks target
        SET
            status = 'archived',
            workflow_state = 'archived',
            archived_at = NOW(),
            archive_reason = $2::text,
            updated_at = NOW()
        FROM eligible
        WHERE target.id = eligible.id
        RETURNING target.id::int AS task_id
    `;
}

async function verifyReadOnlyTransaction(client) {
    const readOnly = await client.query('SHOW transaction_read_only');
    const isolation = await client.query('SHOW transaction_isolation');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') {
        throw new Error('transaction_read_only guard failed');
    }
    if (isolation.rows[0]?.transaction_isolation !== 'repeatable read') {
        throw new Error('transaction_isolation guard failed');
    }
}

function normalizeEvidenceRow(row) {
    return {
        taskId: Number(row.task_id),
        status: normalize(row.task_status),
        workflowState: normalize(row.workflow_state),
        taskType: normalize(row.task_type),
        sourceType: normalize(row.source_type),
        creatorClass: normalize(row.creator_class),
        dueDate: String(row.due_date || '').slice(0, 10),
        bookingStatusClass: normalize(row.booking_status),
        bookingDateBucket: normalize(row.booking_date_bucket),
        hasProtections: Boolean(row.has_protections)
    };
}

function buildWaveManifest(rows, classifierVersion, runtime = {}) {
    const normalizedRows = rows.map(normalizeEvidenceRow).sort((left, right) => left.taskId - right.taskId);
    const ids = normalizedRows.map(row => row.taskId);
    const kyivToday = rows[0]?.kyiv_today ? String(rows[0].kyiv_today).slice(0, 10) : String(runtime.kyivToday || '').slice(0, 10) || null;
    const evidenceChecksum = sha({ classifierVersion, kyivToday, rows: normalizedRows });
    const membershipChecksum = sha({ classifierVersion, kyivToday, ids });
    return {
        classifierVersion,
        classifierLabel: CLASSIFIERS[classifierVersion].label,
        capturedAt: rows[0]?.captured_at ? new Date(rows[0].captured_at).toISOString() : (runtime.capturedAt ? new Date(runtime.capturedAt).toISOString() : new Date().toISOString()),
        kyivToday,
        safety: {
            dryRunTransaction: 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
            applyRequiresExplicitApproval: true,
            deleteSupported: false,
            statusDoneSupported: false,
            stdoutPolicy: 'aggregate counts/checksums only',
            piiPolicy: 'No titles, owner names, customer data, raw source IDs, or secrets.'
        },
        count: ids.length,
        ids,
        rows: normalizedRows,
        membershipChecksum,
        evidenceChecksum,
        manifestChecksum: sha({ classifierVersion, kyivToday, count: ids.length, membershipChecksum, evidenceChecksum })
    };
}

function summaryForStdout(manifest, extra = {}) {
    return {
        classifierVersion: manifest.classifierVersion,
        classifierLabel: manifest.classifierLabel,
        capturedAt: manifest.capturedAt,
        kyivToday: manifest.kyivToday,
        count: manifest.count,
        membershipChecksum: manifest.membershipChecksum,
        evidenceChecksum: manifest.evidenceChecksum,
        manifestChecksum: manifest.manifestChecksum,
        applyMode: extra.applyMode === true,
        batches: extra.batches || undefined,
        output: extra.output || undefined,
        rollbackOutput: extra.rollbackOutput || undefined
    };
}

function validateApprovedManifest(options, manifest) {
    if (options.approvedClassifier !== manifest.classifierVersion) {
        throw new Error('Approved classifier drift');
    }
    if (Number(options.approvedCount) !== Number(manifest.count)) {
        throw new Error(`Approved count drift: expected ${options.approvedCount}, got ${manifest.count}`);
    }
    if (normalize(options.approvedMembershipChecksum) !== normalize(manifest.membershipChecksum)) {
        throw new Error('Approved membership checksum drift');
    }
}

async function fetchDryRunRows(pool, classifierVersion) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await verifyReadOnlyTransaction(client);
        const result = await client.query(buildDryRunSql(classifierVersion));
        const runtime = await client.query("SELECT (NOW() AT TIME ZONE 'Europe/Kyiv')::date::text AS kyiv_today, NOW() AS captured_at");
        return {
            rows: result.rows,
            runtime: {
                kyivToday: runtime.rows[0]?.kyiv_today || null,
                capturedAt: runtime.rows[0]?.captured_at || null
            }
        };
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
    }
}

function writeJson(filePath, data, { noOverwrite = false } = {}) {
    const resolved = path.resolve(filePath);
    if (noOverwrite && fs.existsSync(resolved)) {
        throw new Error(`Refusing to overwrite existing file: ${resolved}`);
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return resolved;
}

function buildRollbackManifest(manifest, archiveReason) {
    return {
        classifierVersion: manifest.classifierVersion,
        basedOnMembershipChecksum: manifest.membershipChecksum,
        basedOnEvidenceChecksum: manifest.evidenceChecksum,
        createdAt: new Date().toISOString(),
        archiveReason,
        rollbackInstructions: {
            automaticRollbackSupported: false,
            reason: 'Rollback requires separate explicit production authorization.',
            restoreOnlyTheseIds: manifest.ids
        },
        rows: manifest.rows.map(row => ({
            taskId: row.taskId,
            previousStatus: row.status,
            previousWorkflowState: row.workflowState,
            previousArchivedAt: null,
            previousArchiveReason: null
        })),
        checksum: sha({
            classifierVersion: manifest.classifierVersion,
            basedOnMembershipChecksum: manifest.membershipChecksum,
            archiveReason,
            ids: manifest.ids
        })
    };
}

function chunk(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

async function applyArchive(pool, manifest, options) {
    const batches = [];
    const sql = buildArchiveUpdateSql(manifest.classifierVersion);
    for (const ids of chunk(manifest.ids, options.batchSize)) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(sql, [ids, options.archiveReason]);
            const affected = result.rows.map(row => Number(row.task_id)).sort((left, right) => left - right);
            const expected = [...ids].sort((left, right) => left - right);
            if (affected.length !== expected.length || JSON.stringify(affected) !== JSON.stringify(expected)) {
                await client.query('ROLLBACK');
                throw new Error(`Batch drift: expected ${expected.length}, affected ${affected.length}`);
            }
            await client.query('COMMIT');
            batches.push({ count: affected.length, membershipChecksum: sha({ classifierVersion: manifest.classifierVersion, ids: affected }) });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }
    return batches;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }

    const pool = new Pool(poolConfig(options.apply ? 'apply' : 'dry-run'));
    try {
        const dryRun = await fetchDryRunRows(pool, options.classifier);
        const manifest = buildWaveManifest(dryRun.rows, options.classifier, dryRun.runtime);
        if (options.output) {
            const output = writeJson(options.output, manifest, { noOverwrite: true });
            manifest.output = output;
        }

        if (!options.apply) {
            console.log(JSON.stringify(summaryForStdout(manifest, { output: manifest.output }), null, 2));
            return;
        }

        validateApprovedManifest(options, manifest);
        const rollbackManifest = buildRollbackManifest(manifest, options.archiveReason);
        const rollbackOutput = writeJson(options.rollbackOutput, rollbackManifest, { noOverwrite: true });
        const batches = await applyArchive(pool, manifest, options);
        console.log(JSON.stringify(summaryForStdout(manifest, {
            applyMode: true,
            batches,
            output: manifest.output,
            rollbackOutput
        }), null, 2));
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`task cleanup operator failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    BLOCKED_FLAGS,
    CLASSIFIERS,
    buildArchiveUpdateSql,
    buildDryRunSql,
    buildRollbackManifest,
    buildWaveManifest,
    canonicalDueDateSql,
    commonSafetyPredicateSql,
    parseArgs,
    poolConfig,
    summaryForStdout,
    validateApprovedManifest,
    validateApplyOptionsShape
};
