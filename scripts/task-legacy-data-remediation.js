#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { duplicateSignatureSql } = require('../services/taskDuplicatePolicy');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, '.codex-temp', '_preserved-artifacts', 'task28-legacy-remediation');
const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const APPLY_CONFIRMATION = 'TASK28_APPLY_TYPED_OWNER';
const SAFE_COHORT = 'typed-owner-single-active-user';
const OPAQUE_ID_SALT = 'task28-legacy-data-remediation-v1';

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        mode: 'dry-run',
        cohort: SAFE_COHORT,
        outputDir: DEFAULT_OUTPUT_ROOT,
        expectedCount: null,
        manifestHash: '',
        confirmation: '',
        json: false
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = () => argv[++i];
        if (arg === 'audit' || arg === 'dry-run' || arg === 'apply') options.mode = arg;
        else if (arg === '--audit') options.mode = 'audit';
        else if (arg === '--dry-run') options.mode = 'dry-run';
        else if (arg === '--apply') options.mode = 'apply';
        else if (arg === '--json') options.json = true;
        else if (arg === '--cohort') options.cohort = next();
        else if (arg.startsWith('--cohort=')) options.cohort = arg.slice('--cohort='.length);
        else if (arg === '--out-dir') options.outputDir = path.resolve(next());
        else if (arg.startsWith('--out-dir=')) options.outputDir = path.resolve(arg.slice('--out-dir='.length));
        else if (arg === '--expected-count') options.expectedCount = Number.parseInt(next(), 10);
        else if (arg.startsWith('--expected-count=')) options.expectedCount = Number.parseInt(arg.slice('--expected-count='.length), 10);
        else if (arg === '--manifest-hash') options.manifestHash = next();
        else if (arg.startsWith('--manifest-hash=')) options.manifestHash = arg.slice('--manifest-hash='.length);
        else if (arg === '--confirm') options.confirmation = next();
        else if (arg.startsWith('--confirm=')) options.confirmation = arg.slice('--confirm='.length);
        else throw new Error(`Unknown argument: ${arg}`);
    }

    if (!['audit', 'dry-run', 'apply'].includes(options.mode)) throw new Error(`Unsupported mode: ${options.mode}`);
    if (options.cohort !== SAFE_COHORT) throw new Error(`Unsupported cohort: ${options.cohort}`);
    return options;
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function normalizeCount(row, key) {
    return Number(row?.[key] || 0);
}

function redactedTaskId(id, salt) {
    return `task_${sha256(`${salt}:${id}`).slice(0, 20)}`;
}

function buildTerminalWorkflowMismatchSql(alias = 't') {
    return `(
        (LOWER(COALESCE(${alias}.status, 'todo')) = 'done' AND LOWER(COALESCE(${alias}.workflow_state, '')) <> 'done')
        OR (LOWER(COALESCE(${alias}.status, 'todo')) = 'archived' AND LOWER(COALESCE(${alias}.workflow_state, '')) <> 'archived')
        OR (LOWER(COALESCE(${alias}.workflow_state, '')) = 'done' AND LOWER(COALESCE(${alias}.status, 'todo')) <> 'done')
        OR (LOWER(COALESCE(${alias}.workflow_state, '')) = 'archived' AND LOWER(COALESCE(${alias}.status, 'todo')) <> 'archived')
    )`;
}

function buildSafeOwnerCandidateSql({ forUpdate = false } = {}) {
    return `
        WITH legacy_tokens AS (
            SELECT t.id AS task_id,
                   COALESCE(NULLIF(BTRIM(t.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                   token.value AS token
            FROM tasks t
            CROSS JOIN LATERAL (
                VALUES (NULLIF(BTRIM(t.assigned_to), '')),
                       (NULLIF(BTRIM(t.owner), ''))
            ) AS token(value)
            WHERE t.owner_user_id IS NULL
              AND token.value IS NOT NULL
        ),
        matched_users AS (
            SELECT lt.task_id,
                   lt.business_context,
                   u.id AS user_id
            FROM legacy_tokens lt
            JOIN users u
              ON COALESCE(u.is_active, true) IS TRUE
             AND (
                    LOWER(BTRIM(u.username)) = LOWER(lt.token)
                 OR LOWER(BTRIM(COALESCE(u.name, ''))) = LOWER(lt.token)
             )
             AND (
                    COALESCE(u.business_contexts, ARRAY['${DEFAULT_BUSINESS_CONTEXT}']::text[]) @> ARRAY[lt.business_context]::text[]
                 OR cardinality(COALESCE(u.business_contexts, ARRAY[]::text[])) = 0
             )
        ),
        unique_matches AS (
            SELECT task_id,
                   MIN(user_id) AS user_id,
                   COUNT(DISTINCT user_id) AS matched_user_count
            FROM matched_users
            GROUP BY task_id
        )
        SELECT t.id AS task_id,
               um.user_id,
               COALESCE(NULLIF(BTRIM(t.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
               CASE
                   WHEN NULLIF(BTRIM(t.assigned_to), '') IS NOT NULL THEN 'assigned_to'
                   WHEN NULLIF(BTRIM(t.owner), '') IS NOT NULL THEN 'owner'
                   ELSE 'none'
               END AS owner_token_source
        FROM tasks t
        JOIN unique_matches um ON um.task_id = t.id AND um.matched_user_count = 1
        WHERE t.owner_user_id IS NULL
        ORDER BY t.id ASC
        ${forUpdate ? 'FOR UPDATE OF t' : ''}
    `;
}

function buildAggregateAuditSql() {
    const signature = duplicateSignatureSql('t');
    const terminalMismatch = buildTerminalWorkflowMismatchSql('t');
    return `
        WITH legacy_tokens AS (
            SELECT t.id AS task_id,
                   COALESCE(NULLIF(BTRIM(t.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                   token.value AS token
            FROM tasks t
            CROSS JOIN LATERAL (
                VALUES (NULLIF(BTRIM(t.assigned_to), '')),
                       (NULLIF(BTRIM(t.owner), ''))
            ) AS token(value)
            WHERE t.owner_user_id IS NULL
              AND token.value IS NOT NULL
        ),
        owner_matches AS (
            SELECT lt.task_id,
                   COUNT(DISTINCT u.id) AS matched_user_count
            FROM legacy_tokens lt
            LEFT JOIN users u
              ON COALESCE(u.is_active, true) IS TRUE
             AND (
                    LOWER(BTRIM(u.username)) = LOWER(lt.token)
                 OR LOWER(BTRIM(COALESCE(u.name, ''))) = LOWER(lt.token)
             )
             AND (
                    COALESCE(u.business_contexts, ARRAY['${DEFAULT_BUSINESS_CONTEXT}']::text[]) @> ARRAY[lt.business_context]::text[]
                 OR cardinality(COALESCE(u.business_contexts, ARRAY[]::text[])) = 0
             )
            GROUP BY lt.task_id
        ),
        active_duplicate_groups AS (
            SELECT duplicate_signature, COUNT(*) AS group_count
            FROM (
                SELECT t.id, ${signature} AS duplicate_signature
                FROM tasks t
                WHERE COALESCE(t.status, 'todo') NOT IN ('done','archived','cancelled')
                  AND NULLIF(BTRIM(COALESCE(t.title, '')), '') IS NOT NULL
            ) input
            GROUP BY duplicate_signature
            HAVING COUNT(*) > 1
        )
        SELECT
            (SELECT COUNT(*) FROM tasks)::int AS total_tasks,
            (SELECT COUNT(*) FROM tasks WHERE owner_user_id IS NULL)::int AS missing_owner_user_id,
            (SELECT COUNT(*) FROM owner_matches WHERE matched_user_count = 1)::int AS owner_token_single_active_user_candidate,
            (SELECT COUNT(*) FROM owner_matches WHERE matched_user_count <> 1)::int AS owner_token_manual_review,
            (SELECT COUNT(*) FROM tasks t WHERE ${terminalMismatch})::int AS terminal_status_workflow_mismatch,
            (SELECT COUNT(*) FROM tasks WHERE COALESCE(status, 'todo') NOT IN ('done','archived','cancelled') AND completed_at IS NOT NULL)::int AS active_with_completed_at,
            (SELECT COUNT(*) FROM tasks WHERE date IS NOT NULL AND deadline IS NOT NULL AND date::date <> deadline::date)::int AS date_deadline_disagreement,
            (SELECT COUNT(*) FROM tasks WHERE date IS NOT NULL AND scheduled_start_at IS NOT NULL AND date::date <> scheduled_start_at::date)::int AS date_scheduled_start_disagreement,
            (SELECT COUNT(*) FROM tasks WHERE deadline IS NOT NULL AND scheduled_start_at IS NOT NULL AND deadline::date <> scheduled_start_at::date)::int AS deadline_scheduled_start_disagreement,
            (SELECT COUNT(*) FROM tasks WHERE NULLIF(BTRIM(COALESCE(business_context, '')), '') IS NULL)::int AS missing_blank_business_context,
            (SELECT COUNT(*) FROM tasks WHERE (NULLIF(BTRIM(COALESCE(source_type, '')), '') IS NULL) <> (NULLIF(BTRIM(COALESCE(source_id::text, '')), '') IS NULL))::int AS partial_source_reference,
            COALESCE((SELECT SUM(group_count)::int FROM active_duplicate_groups), 0)::int AS active_tasks_with_duplicate_signature_input,
            (SELECT COUNT(*)::int FROM active_duplicate_groups) AS active_duplicate_signature_groups,
            (SELECT COUNT(*)::int FROM task_action_history) AS task_action_history_rows,
            (SELECT COUNT(*)::int FROM task_subtasks) AS task_subtask_rows,
            (SELECT COUNT(*)::int FROM task_dependencies) AS task_dependency_rows,
            (SELECT COUNT(*)::int FROM my_day_task_impacts) AS my_day_task_impact_rows
    `;
}

function buildManualReviewSql() {
    const terminalMismatch = buildTerminalWorkflowMismatchSql('t');
    return `
        WITH legacy_tokens AS (
            SELECT t.id AS task_id,
                   COALESCE(NULLIF(BTRIM(t.business_context), ''), '${DEFAULT_BUSINESS_CONTEXT}') AS business_context,
                   token.value AS token
            FROM tasks t
            CROSS JOIN LATERAL (
                VALUES (NULLIF(BTRIM(t.assigned_to), '')),
                       (NULLIF(BTRIM(t.owner), ''))
            ) AS token(value)
            WHERE t.owner_user_id IS NULL
              AND token.value IS NOT NULL
        ),
        owner_matches AS (
            SELECT lt.task_id,
                   COUNT(DISTINCT u.id) AS matched_user_count
            FROM legacy_tokens lt
            LEFT JOIN users u
              ON COALESCE(u.is_active, true) IS TRUE
             AND (
                    LOWER(BTRIM(u.username)) = LOWER(lt.token)
                 OR LOWER(BTRIM(COALESCE(u.name, ''))) = LOWER(lt.token)
             )
             AND (
                    COALESCE(u.business_contexts, ARRAY['${DEFAULT_BUSINESS_CONTEXT}']::text[]) @> ARRAY[lt.business_context]::text[]
                 OR cardinality(COALESCE(u.business_contexts, ARRAY[]::text[])) = 0
             )
            GROUP BY lt.task_id
        )
        SELECT DISTINCT task_id, reason_code, affected_fields, evidence_status
        FROM (
            SELECT task_id,
                   'OWNER_TOKEN_MANUAL_REVIEW' AS reason_code,
                   ARRAY['owner_user_id', 'assigned_to', 'owner']::text[] AS affected_fields,
                   'NO_UNIQUE_ACTIVE_USER_MATCH' AS evidence_status
            FROM owner_matches
            WHERE matched_user_count <> 1
            UNION ALL
            SELECT t.id AS task_id,
                   'TERMINAL_STATUS_WORKFLOW_MISMATCH' AS reason_code,
                   ARRAY['status', 'workflow_state']::text[] AS affected_fields,
                   'NO_APPROVED_CANONICAL_MAPPING_FOR_LEGACY_ROWS' AS evidence_status
            FROM tasks t
            WHERE ${terminalMismatch}
            UNION ALL
            SELECT t.id AS task_id,
                   'DATE_DEADLINE_DISAGREEMENT' AS reason_code,
                   ARRAY['date', 'deadline']::text[] AS affected_fields,
                   'SCHEDULE_AND_DEADLINE_CAN_INTENTIONALLY_DIFFER' AS evidence_status
            FROM tasks t
            WHERE t.date IS NOT NULL
              AND t.deadline IS NOT NULL
              AND t.date::date <> t.deadline::date
            UNION ALL
            SELECT t.id AS task_id,
                   'PARTIAL_SOURCE_REFERENCE' AS reason_code,
                   ARRAY['source_type', 'source_id']::text[] AS affected_fields,
                   'MISSING_SOURCE_COUNTERPART_OR_EXTERNAL_LEGACY_SOURCE' AS evidence_status
            FROM tasks t
            WHERE (NULLIF(BTRIM(COALESCE(t.source_type, '')), '') IS NULL)
               <> (NULLIF(BTRIM(COALESCE(t.source_id::text, '')), '') IS NULL)
        ) manual_review
        ORDER BY reason_code, task_id
    `;
}

function buildRedactedCandidateManifest(rows, salt) {
    return rows.map(row => ({
        opaqueTaskId: redactedTaskId(row.task_id, salt),
        cohort: SAFE_COHORT,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        ownerTokenSource: row.owner_token_source,
        old: { owner_user_id: null },
        new: { owner_user_id: 'matched_active_user' }
    }));
}

function buildRedactedManualReviewManifest(rows, salt) {
    return rows.map(row => ({
        opaqueTaskId: redactedTaskId(row.task_id, salt),
        reasonCode: row.reason_code,
        affectedFields: row.affected_fields,
        evidenceStatus: row.evidence_status
    }));
}

function manifestHash(manifest) {
    return sha256(stableJson({ rows: manifest }));
}

async function withClient(connectionString, fn) {
    const pool = new Pool({ connectionString, application_name: 'task28_legacy_data_remediation' });
    const client = await pool.connect();
    try {
        return await fn(client);
    } finally {
        client.release();
        await pool.end();
    }
}

function connectionStringForMode(mode) {
    if (mode === 'apply') {
        const value = process.env.TASK_LEGACY_REMEDIATION_DATABASE_URL;
        if (!value) throw new Error('TASK_LEGACY_REMEDIATION_DATABASE_URL is required for apply mode');
        return value;
    }
    const value = process.env.TASK_AI_ROLLOUT_DATABASE_URL;
    if (!value) throw new Error('TASK_AI_ROLLOUT_DATABASE_URL is required for read-only audit/dry-run');
    return value;
}

function writeArtifact(outputDir, payload) {
    fs.mkdirSync(outputDir, { recursive: true });
    const file = path.join(outputDir, `task28-legacy-remediation-${payload.generatedAt.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    return file;
}

async function runAudit(options = parseArgs()) {
    const connectionString = connectionStringForMode(options.mode);
    const generatedAt = new Date().toISOString();
    const salt = OPAQUE_ID_SALT;

    return withClient(connectionString, async client => {
        if (options.mode === 'apply') {
            if (options.confirmation !== APPLY_CONFIRMATION) throw new Error(`--confirm ${APPLY_CONFIRMATION} is required for apply`);
            if (!Number.isInteger(options.expectedCount) || options.expectedCount < 0) throw new Error('--expected-count is required for apply');
            if (!/^[a-f0-9]{64}$/i.test(options.manifestHash)) throw new Error('--manifest-hash must be a SHA256 hex digest');
            await client.query('BEGIN');
        } else {
            await client.query('BEGIN READ ONLY');
        }

        try {
            const readOnly = await client.query('SHOW transaction_read_only');
            const audit = (await client.query(buildAggregateAuditSql())).rows[0];
            const candidateRows = (await client.query(buildSafeOwnerCandidateSql({ forUpdate: options.mode === 'apply' }))).rows;
            const manualReviewRows = (await client.query(buildManualReviewSql())).rows;
            const manifest = buildRedactedCandidateManifest(candidateRows, salt);
            const hash = manifestHash(manifest);
            const manualReviewManifest = buildRedactedManualReviewManifest(manualReviewRows, salt);
            const manualReviewHash = manifestHash(manualReviewManifest);

            let appliedRows = 0;
            if (options.mode === 'apply') {
                if (candidateRows.length !== options.expectedCount) throw new Error(`candidate count changed: expected ${options.expectedCount}, got ${candidateRows.length}`);
                if (hash !== options.manifestHash) throw new Error(`manifest hash changed: expected ${options.manifestHash}, got ${hash}`);
                if (candidateRows.length > 0) {
                    const values = [];
                    const tuples = candidateRows.map((row, index) => {
                        values.push(Number(row.task_id), Number(row.user_id));
                        const taskParam = index * 2 + 1;
                        return `($${taskParam}::int, $${taskParam + 1}::int)`;
                    }).join(', ');
                    const update = await client.query(
                        `WITH candidates(task_id, user_id) AS (VALUES ${tuples})
                         UPDATE tasks t
                            SET owner_user_id = candidates.user_id,
                                updated_at = NOW()
                           FROM candidates
                          WHERE t.id = candidates.task_id
                            AND t.owner_user_id IS NULL`,
                        values
                    );
                    appliedRows = update.rowCount;
                    if (appliedRows !== candidateRows.length) throw new Error(`updated rows mismatch: expected ${candidateRows.length}, got ${appliedRows}`);
                }
            }

            const payload = {
                generatedAt,
                mode: options.mode,
                cohort: options.cohort,
                transactionReadOnly: readOnly.rows[0]?.transaction_read_only || null,
                counts: {
                    totalTasks: normalizeCount(audit, 'total_tasks'),
                    missingOwnerUserId: normalizeCount(audit, 'missing_owner_user_id'),
                    ownerTokenSingleActiveUserCandidate: normalizeCount(audit, 'owner_token_single_active_user_candidate'),
                    ownerTokenManualReview: normalizeCount(audit, 'owner_token_manual_review'),
                    terminalStatusWorkflowMismatch: normalizeCount(audit, 'terminal_status_workflow_mismatch'),
                    activeWithCompletedAt: normalizeCount(audit, 'active_with_completed_at'),
                    dateDeadlineDisagreement: normalizeCount(audit, 'date_deadline_disagreement'),
                    dateScheduledStartDisagreement: normalizeCount(audit, 'date_scheduled_start_disagreement'),
                    deadlineScheduledStartDisagreement: normalizeCount(audit, 'deadline_scheduled_start_disagreement'),
                    missingBlankBusinessContext: normalizeCount(audit, 'missing_blank_business_context'),
                    partialSourceReference: normalizeCount(audit, 'partial_source_reference'),
                    activeTasksWithDuplicateSignatureInput: normalizeCount(audit, 'active_tasks_with_duplicate_signature_input'),
                    activeDuplicateSignatureGroups: normalizeCount(audit, 'active_duplicate_signature_groups'),
                    taskActionHistoryRows: normalizeCount(audit, 'task_action_history_rows'),
                    taskSubtaskRows: normalizeCount(audit, 'task_subtask_rows'),
                    taskDependencyRows: normalizeCount(audit, 'task_dependency_rows'),
                    myDayTaskImpactRows: normalizeCount(audit, 'my_day_task_impact_rows')
                },
                safeCohorts: [{
                    cohort: SAFE_COHORT,
                    autoFixSafe: candidateRows.length > 0,
                    candidateCount: candidateRows.length,
                    manifestHash: hash,
                    redactedManifest: manifest
                }],
                manualReview: {
                    recordCount: manualReviewRows.length,
                    manifestHash: manualReviewHash,
                    redactedManifest: manualReviewManifest
                },
                verdict: candidateRows.length > 0 ? 'AUTO_FIX_SAFE_AVAILABLE' : 'NO_AUTO_FIX_SAFE_RECORDS',
                appliedRows
            };

            const artifactPath = writeArtifact(options.outputDir, payload);
            if (options.mode === 'apply') await client.query('COMMIT');
            else await client.query('ROLLBACK');
            return { ...payload, artifactPath };
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        }
    });
}

if (require.main === module) {
    runAudit()
        .then(result => {
            const output = {
                generatedAt: result.generatedAt,
                mode: result.mode,
                cohort: result.cohort,
                transactionReadOnly: result.transactionReadOnly,
                counts: result.counts,
                safeCohorts: result.safeCohorts.map(item => ({
                    cohort: item.cohort,
                    autoFixSafe: item.autoFixSafe,
                    candidateCount: item.candidateCount,
                    manifestHash: item.manifestHash
                })),
                manualReview: {
                    recordCount: result.manualReview.recordCount,
                    manifestHash: result.manualReview.manifestHash
                },
                verdict: result.verdict,
                appliedRows: result.appliedRows,
                artifactPath: result.artifactPath
            };
            console.log(JSON.stringify(output, null, 2));
        })
        .catch(error => {
            console.error(`[task-legacy-data-remediation] ${error.message}`);
            process.exit(1);
        });
}

module.exports = {
    APPLY_CONFIRMATION,
    OPAQUE_ID_SALT,
    SAFE_COHORT,
    buildAggregateAuditSql,
    buildRedactedCandidateManifest,
    buildRedactedManualReviewManifest,
    buildManualReviewSql,
    buildSafeOwnerCandidateSql,
    buildTerminalWorkflowMismatchSql,
    manifestHash,
    parseArgs,
    runAudit,
    stableJson
};
