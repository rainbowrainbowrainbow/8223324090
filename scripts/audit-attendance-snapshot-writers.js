#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');

const DEFAULT_EFFECTIVE_DATE = '2026-07-18';
const CONFIRMATION = 'READ_ONLY_ATTENDANCE_SNAPSHOT_AUDIT';
const WRITER_CATEGORIES = Object.freeze([
    'clock_in_out',
    'hermes_import',
    'terminal_status',
    'leave_approval',
    'no_show_scheduler',
    'auto_close',
    'correction',
    'qa_helper',
    'unknown'
]);
const SNAPSHOT_AUDIT_RELEASE_BLOCKERS = Object.freeze({
    INCOMPLETE: 'ATTENDANCE_SNAPSHOT_AUDIT_INCOMPLETE',
    POST_FIX_MISSING: 'ATTENDANCE_POST_FIX_MISSING_SNAPSHOT',
    PAID_WITHOUT_FINAL: 'ATTENDANCE_POST_FIX_PAID_ALLOCATION_WITHOUT_FINAL_SNAPSHOT',
    UNKNOWN_WRITER: 'ATTENDANCE_POST_FIX_UNKNOWN_WRITER'
});
const REQUIRED_TABLE_COLUMNS = Object.freeze({
    hr_time_records: Object.freeze([
        'id',
        'staff_id',
        'record_date',
        'created_at',
        'updated_at',
        'status',
        'clock_in',
        'clock_out',
        'auto_closed',
        'corrected_at',
        'correction_reason',
        'notes',
        'compensation_snapshot'
    ]),
    hr_audit_log: Object.freeze([
        'id',
        'staff_id',
        'action',
        'details',
        'created_at'
    ])
});

function booleanEnv(value) {
    return /^(1|true|yes|y)$/i.test(String(value || '').trim());
}

function readOption(argv, name) {
    const equalsPrefix = `${name}=`;
    const equals = argv.find(arg => arg.startsWith(equalsPrefix));
    if (equals) return equals.slice(equalsPrefix.length);
    const index = argv.indexOf(name);
    if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
    return null;
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
    return {
        help: argv.includes('--help') || argv.includes('-h'),
        confirmation: env.ATTENDANCE_SNAPSHOT_AUDIT_CONFIRM || readOption(argv, '--confirm'),
        databaseUrl: env.DATABASE_PUBLIC_URL || env.TEST_DATABASE_URL || env.DATABASE_URL || null,
        effectiveDate: readOption(argv, '--effective-date')
            || env.ATTENDANCE_SNAPSHOT_EFFECTIVE_DATE
            || DEFAULT_EFFECTIVE_DATE,
        deploymentCutoff: readOption(argv, '--deployment-cutoff')
            || env.ATTENDANCE_SNAPSHOT_DEPLOYED_AT
            || env.ATTENDANCE_SNAPSHOT_DEPLOYMENT_CUTOFF
            || null,
        deploymentEvidence: readOption(argv, '--deployment-evidence')
            || env.ATTENDANCE_SNAPSHOT_DEPLOYMENT_EVIDENCE
            || null,
        releaseGate: argv.includes('--release-gate')
            || booleanEnv(env.ATTENDANCE_SNAPSHOT_RELEASE_GATE),
        json: !argv.includes('--no-json')
    };
}

function usage() {
    return [
        'Usage:',
        '  ATTENDANCE_SNAPSHOT_AUDIT_CONFIRM=READ_ONLY_ATTENDANCE_SNAPSHOT_AUDIT \\',
        '  ATTENDANCE_SNAPSHOT_DEPLOYED_AT=2026-07-18T12:34:56+03:00 \\',
        '  ATTENDANCE_SNAPSHOT_DEPLOYMENT_EVIDENCE="CI/Railway deploy completed timestamp" \\',
        '  DATABASE_PUBLIC_URL=... node scripts/audit-attendance-snapshot-writers.js --release-gate',
        '',
        'The deployment cutoff must be the exact deploy-completed timestamp from CI/Railway evidence.',
        'Do not use a commit timestamp as the cutoff.'
    ].join('\n');
}

function normalizeDeploymentCutoff(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('ATTENDANCE_SNAPSHOT_DEPLOYED_AT is required and must come from CI/Railway deploy evidence');
    }
    if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
        throw new Error('ATTENDANCE_SNAPSHOT_DEPLOYED_AT must include an explicit timezone, for example 2026-07-18T12:34:56+03:00');
    }
    const timestamp = new Date(raw);
    if (Number.isNaN(timestamp.getTime())) {
        throw new Error('ATTENDANCE_SNAPSHOT_DEPLOYED_AT must be a valid ISO timestamp');
    }
    return timestamp.toISOString();
}

function requireConfiguration(config = parseArgs()) {
    if (config.help) return { ...config };
    if (config.confirmation !== CONFIRMATION) {
        throw new Error(`set ATTENDANCE_SNAPSHOT_AUDIT_CONFIRM=${CONFIRMATION}`);
    }
    if (!config.databaseUrl) {
        throw new Error('DATABASE_PUBLIC_URL, TEST_DATABASE_URL, or DATABASE_URL is required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(config.effectiveDate)) {
        throw new Error('ATTENDANCE_SNAPSHOT_EFFECTIVE_DATE must be YYYY-MM-DD');
    }
    const deploymentCutoffIso = normalizeDeploymentCutoff(config.deploymentCutoff);
    if (!String(config.deploymentEvidence || '').trim()) {
        throw new Error('ATTENDANCE_SNAPSHOT_DEPLOYMENT_EVIDENCE is required; use CI/Railway deploy-completed evidence, not a commit timestamp');
    }
    return {
        ...config,
        deploymentCutoffIso
    };
}

function noteCategory(notes) {
    const value = String(notes || '');
    if (/Hermes arrival-sheet import/i.test(value)) return 'hermes_import';
    if (/\u0417\u0430\u044f\u0432\u043a\u0430\s*#/iu.test(value) || /Р—Р°СЏРІРєР°\s*#/iu.test(value)) return 'leave_approval';
    if (/live[_ -]?qa|disposable/iu.test(value)) return 'qa_helper';
    return value.trim() ? 'manual_or_other' : 'none';
}

function hasAny(set, values) {
    return values.some(value => set.has(value));
}

function classifyWriter(row = {}) {
    const events = Array.isArray(row.audit_events || row.auditEvents)
        ? (row.audit_events || row.auditEvents)
        : [];
    const actions = new Set(events.map(event => event.action).filter(Boolean));
    const methods = new Set(events.map(event => event.method).filter(Boolean));
    const sources = new Set(events.map(event => event.source).filter(Boolean));
    const triggers = new Set(events.map(event => event.trigger).filter(Boolean));
    const notes = noteCategory(row.notes);
    const status = String(row.status || '');

    if (hasAny(actions, ['attendance_hermes_apply', 'hermes_attendance_import'])
        || sources.has('hermes_attendance_import')
        || notes === 'hermes_import') {
        return 'hermes_import';
    }
    if (hasAny(actions, ['live_multi_segment_qa_attendance_create'])
        || sources.has('live_multi_segment_qa')
        || notes === 'qa_helper') {
        return 'qa_helper';
    }
    if (hasAny(actions, ['leave_request_review']) || triggers.has('leave_request') || notes === 'leave_approval') {
        return 'leave_approval';
    }
    if (hasAny(actions, ['no_show']) || status === 'no_show') {
        return 'no_show_scheduler';
    }
    if (hasAny(actions, ['auto_close']) || row.auto_closed === true || row.autoClosed === true) {
        return 'auto_close';
    }
    if (hasAny(actions, ['correction', 'manual_correction', 'compensation_snapshot_corrected'])
        || row.corrected_at
        || row.correctedAt
        || row.correction_reason
        || row.correctionReason) {
        return 'correction';
    }
    if (hasAny(actions, ['mark_absent', 'attendance_status', 'record_attendance_status'])
        || (!row.clock_in && !row.clock_out && !row.clockIn && !row.clockOut
            && ['absent', 'sick', 'vacation', 'day_off', 'holiday', 'leave', 'paid_leave', 'unpaid_leave'].includes(status))) {
        return 'terminal_status';
    }
    if (hasAny(actions, ['clock_in', 'clock_out'])
        || hasAny(methods, ['camera', 'face', 'manual', 'import'])
        || hasAny(sources, ['camera', 'face_checkin', 'manual_clock', 'hr_today'])
        || row.clock_in
        || row.clock_out
        || row.clockIn
        || row.clockOut) {
        return 'clock_in_out';
    }
    return 'unknown';
}

function emptyCohortSummary() {
    return {
        total: 0,
        plannedSnapshots: 0,
        finalSnapshots: 0,
        explicitBaseOnlyFinalSnapshots: 0,
        missingSnapshots: 0,
        invalidOrManualReviewSnapshots: 0,
        paidAllocationWithoutValidFinalSnapshot: 0,
        unknownWriters: 0,
        writerCategories: Object.fromEntries(WRITER_CATEGORIES.map(category => [category, 0]))
    };
}

function addRow(summary, row = {}) {
    const writerCategory = WRITER_CATEGORIES.includes(row.writer_category)
        ? row.writer_category
        : 'unknown';
    const total = Number(row.total || 0);
    summary.total += total;
    summary.plannedSnapshots += Number(row.planned_snapshots || 0);
    summary.finalSnapshots += Number(row.final_snapshots || 0);
    summary.explicitBaseOnlyFinalSnapshots += Number(row.explicit_base_only_final_snapshots || 0);
    summary.missingSnapshots += Number(row.missing_snapshots || 0);
    summary.invalidOrManualReviewSnapshots += Number(row.invalid_or_manual_review_snapshots || 0);
    summary.paidAllocationWithoutValidFinalSnapshot += Number(row.paid_allocation_without_valid_final_snapshot || 0);
    summary.unknownWriters += Number(row.unknown_writers || (writerCategory === 'unknown' ? total : 0));
    summary.writerCategories[writerCategory] = (summary.writerCategories[writerCategory] || 0) + total;
}

function buildReleaseGate(report) {
    const blockers = [];
    const postFix = report.cohorts.postFix;
    if (!report.queryComplete || report.classificationIncomplete) {
        blockers.push({
            code: SNAPSHOT_AUDIT_RELEASE_BLOCKERS.INCOMPLETE,
            message: 'Audit query or writer classification is incomplete'
        });
    }
    if (postFix.missingSnapshots > 0) {
        blockers.push({
            code: SNAPSHOT_AUDIT_RELEASE_BLOCKERS.POST_FIX_MISSING,
            count: postFix.missingSnapshots,
            message: 'Post-fix attendance records without compensation snapshot were found'
        });
    }
    if (postFix.paidAllocationWithoutValidFinalSnapshot > 0) {
        blockers.push({
            code: SNAPSHOT_AUDIT_RELEASE_BLOCKERS.PAID_WITHOUT_FINAL,
            count: postFix.paidAllocationWithoutValidFinalSnapshot,
            message: 'Post-fix paid allocations without a valid final snapshot were found'
        });
    }
    if (postFix.unknownWriters > 0) {
        blockers.push({
            code: SNAPSHOT_AUDIT_RELEASE_BLOCKERS.UNKNOWN_WRITER,
            count: postFix.unknownWriters,
            message: 'Post-fix attendance records with unknown writer path were found'
        });
    }
    return {
        enabled: Boolean(report.releaseGateEnabled),
        status: blockers.length > 0 ? 'failed' : 'passed',
        blockers
    };
}

function summarizeAuditRows(rows = [], config = {}, metadata = {}) {
    const historicalExceptions = emptyCohortSummary();
    const postFix = emptyCohortSummary();
    let classificationIncomplete = false;

    for (const row of rows) {
        if (!WRITER_CATEGORIES.includes(row.writer_category)) classificationIncomplete = true;
        if (row.cohort === 'historical_exceptions') {
            addRow(historicalExceptions, row);
        } else if (row.cohort === 'post_fix') {
            addRow(postFix, row);
        } else if (row.cohort) {
            classificationIncomplete = true;
        }
    }

    const report = {
        mode: 'repeatable_read_read_only',
        productionImpact: true,
        outputPolicy: 'aggregate_only_no_pii_no_ids_no_rates_no_amounts',
        effectiveDate: config.effectiveDate || DEFAULT_EFFECTIVE_DATE,
        deploymentCutoff: {
            deployedAt: config.deploymentCutoffIso || null,
            source: 'exact_ci_or_railway_deploy_completed_timestamp',
            evidenceProvided: Boolean(String(config.deploymentEvidence || '').trim())
        },
        cohortAxes: {
            policyAxis: 'record_date >= effectiveDate',
            writerBehaviorAxis: 'created_at >= deploymentCutoff.deployedAt'
        },
        queryComplete: metadata.queryComplete !== false,
        classificationIncomplete: classificationIncomplete || metadata.classificationIncomplete === true,
        metadata: {
            requiredTablesAvailable: metadata.requiredTablesAvailable !== false,
            missingRequirements: Array.isArray(metadata.missingRequirements)
                ? metadata.missingRequirements.map(item => ({
                    table: item.table,
                    column: item.column
                }))
                : []
        },
        coverage: metadata.coverage || emptyCoverageSummary(),
        cohorts: {
            historicalExceptions,
            postFix
        },
        historicalWarning: {
            type: 'dated_pre_cutoff_warning',
            message: 'Historical missing snapshots are shown separately and do not prove or disprove post-fix writer behavior.',
            missingSnapshots: historicalExceptions.missingSnapshots,
            writerCategories: historicalExceptions.writerCategories
        },
        releaseGateEnabled: Boolean(config.releaseGate)
    };
    report.releaseGate = buildReleaseGate(report);
    return report;
}

function buildColumnAuditSql() {
    return `SELECT table_name, column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
            ORDER BY table_name, ordinal_position`;
}

function emptyCoverageSummary() {
    return {
        policyRecords: 0,
        policyWithSnapshot: 0,
        policyWithoutSnapshot: 0,
        preCutoffRecords: 0,
        preCutoffWithSnapshot: 0,
        preCutoffWithoutSnapshot: 0,
        postFixRecords: 0,
        postFixWithSnapshot: 0,
        postFixWithoutSnapshot: 0
    };
}

function normalizeCoverage(row = {}) {
    return {
        policyRecords: Number(row.policy_records || 0),
        policyWithSnapshot: Number(row.policy_with_snapshot || 0),
        policyWithoutSnapshot: Number(row.policy_without_snapshot || 0),
        preCutoffRecords: Number(row.pre_cutoff_records || 0),
        preCutoffWithSnapshot: Number(row.pre_cutoff_with_snapshot || 0),
        preCutoffWithoutSnapshot: Number(row.pre_cutoff_without_snapshot || 0),
        postFixRecords: Number(row.post_fix_records || 0),
        postFixWithSnapshot: Number(row.post_fix_with_snapshot || 0),
        postFixWithoutSnapshot: Number(row.post_fix_without_snapshot || 0)
    };
}

function buildCoverageSql() {
    return `SELECT COUNT(*) FILTER (WHERE record_date >= $1::date)::int AS policy_records,
                   COUNT(*) FILTER (WHERE record_date >= $1::date AND compensation_snapshot IS NOT NULL)::int AS policy_with_snapshot,
                   COUNT(*) FILTER (WHERE record_date >= $1::date AND compensation_snapshot IS NULL)::int AS policy_without_snapshot,
                   COUNT(*) FILTER (WHERE record_date >= $1::date AND created_at < $2::timestamptz)::int AS pre_cutoff_records,
                   COUNT(*) FILTER (WHERE record_date >= $1::date AND created_at < $2::timestamptz AND compensation_snapshot IS NOT NULL)::int AS pre_cutoff_with_snapshot,
                   COUNT(*) FILTER (WHERE record_date >= $1::date AND created_at < $2::timestamptz AND compensation_snapshot IS NULL)::int AS pre_cutoff_without_snapshot,
                   COUNT(*) FILTER (WHERE record_date >= $1::date AND created_at >= $2::timestamptz)::int AS post_fix_records,
                   COUNT(*) FILTER (WHERE record_date >= $1::date AND created_at >= $2::timestamptz AND compensation_snapshot IS NOT NULL)::int AS post_fix_with_snapshot,
                   COUNT(*) FILTER (WHERE record_date >= $1::date AND created_at >= $2::timestamptz AND compensation_snapshot IS NULL)::int AS post_fix_without_snapshot
            FROM hr_time_records`;
}

function missingRequirements(columnRows = []) {
    const found = new Map();
    for (const row of columnRows) {
        if (!found.has(row.table_name)) found.set(row.table_name, new Set());
        found.get(row.table_name).add(row.column_name);
    }
    const missing = [];
    for (const [table, columns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
        const tableColumns = found.get(table) || new Set();
        for (const column of columns) {
            if (!tableColumns.has(column)) missing.push({ table, column });
        }
    }
    return missing;
}

function buildAuditSql() {
    return `WITH base AS (
                SELECT tr.record_date,
                       tr.created_at,
                       tr.updated_at,
                       tr.status,
                       tr.clock_in,
                       tr.clock_out,
                       tr.auto_closed,
                       tr.corrected_at,
                       tr.correction_reason,
                       tr.notes,
                       tr.compensation_snapshot,
                       COALESCE((
                           SELECT jsonb_agg(
                               jsonb_build_object(
                                   'action', audit.action,
                                   'method', audit.details->>'method',
                                   'source', audit.details->>'source',
                                   'trigger', audit.details->>'trigger'
                               )
                               ORDER BY audit.created_at, audit.id
                           )
                           FROM hr_audit_log audit
                           WHERE audit.staff_id = tr.staff_id
                             AND audit.created_at BETWEEN tr.created_at - INTERVAL '5 minutes'
                                                      AND GREATEST(tr.updated_at, tr.created_at) + INTERVAL '5 minutes'
                             AND (
                                 audit.details->>'record_id' = tr.id::text
                                 OR audit.details->>'recordId' = tr.id::text
                                 OR audit.details->>'attendance_record_id' = tr.id::text
                                 OR audit.details->>'attendanceRecordId' = tr.id::text
                                 OR COALESCE(
                                     audit.details->>'record_date',
                                     audit.details->>'recordDate',
                                     audit.details->>'documentDate'
                                 ) = tr.record_date::text
                                 OR audit.action IN (
                                     'attendance_hermes_apply',
                                     'live_multi_segment_qa_attendance_create',
                                     'mark_absent',
                                     'leave_request_review',
                                     'no_show',
                                     'auto_close',
                                     'correction',
                                     'manual_correction',
                                     'compensation_snapshot_corrected',
                                     'clock_in',
                                     'clock_out'
                                 )
                             )
                       ), '[]'::jsonb) AS audit_events
                FROM hr_time_records tr
                WHERE tr.record_date >= $1::date
            ), classified AS (
                SELECT *,
                       CASE
                           WHEN compensation_snapshot IS NULL THEN 'missing'
                           WHEN jsonb_typeof(compensation_snapshot) <> 'object' THEN 'invalid'
                           WHEN COALESCE(compensation_snapshot->>'state', '') = 'manual_review'
                                OR LOWER(COALESCE(compensation_snapshot->>'manualReview', 'false')) = 'true'
                               THEN 'manual_review'
                           WHEN COALESCE(compensation_snapshot->>'state', '') = 'planned' THEN 'planned'
                           WHEN COALESCE(compensation_snapshot->>'state', '') = 'final' THEN 'final'
                           WHEN COALESCE(compensation_snapshot->>'state', '') = 'legacy_base_only' THEN 'legacy_base_only'
                           ELSE 'invalid'
                       END AS snapshot_class,
                       CASE
                           WHEN compensation_snapshot IS NULL OR jsonb_typeof(compensation_snapshot) <> 'object' THEN false
                           ELSE EXISTS (
                               SELECT 1
                               FROM jsonb_array_elements(\n                                   CASE\n                                       WHEN jsonb_typeof(compensation_snapshot->'compensationAllocations') = 'array'\n                                           THEN compensation_snapshot->'compensationAllocations'\n                                       ELSE '[]'::jsonb\n                                   END\n                               ) allocation
                               WHERE allocation->>'allocationType' = 'simultaneous_additional'
                                 AND CASE
                                     WHEN COALESCE(allocation->>'actualMinutes', '') ~ '^\\d+$'
                                         THEN (allocation->>'actualMinutes')::int
                                     ELSE 0
                                 END > 0
                           )
                       END AS has_paid_allocation,
                       CASE
                           WHEN compensation_snapshot IS NULL OR jsonb_typeof(compensation_snapshot) <> 'object' THEN false
                           ELSE NOT EXISTS (
                               SELECT 1
                               FROM jsonb_array_elements(\n                                   CASE\n                                       WHEN jsonb_typeof(compensation_snapshot->'compensationAllocations') = 'array'\n                                           THEN compensation_snapshot->'compensationAllocations'\n                                       ELSE '[]'::jsonb\n                                   END\n                               ) allocation
                               WHERE allocation->>'allocationType' = 'simultaneous_additional'
                                 AND CASE
                                     WHEN COALESCE(allocation->>'actualMinutes', '') ~ '^\\d+$'
                                         THEN (allocation->>'actualMinutes')::int
                                     ELSE 0
                                 END > 0
                           )
                       END AS has_no_paid_allocation,
                       CASE
                           WHEN EXISTS (
                               SELECT 1 FROM jsonb_array_elements(audit_events) event
                               WHERE event->>'action' IN ('attendance_hermes_apply', 'hermes_attendance_import')
                                  OR event->>'source' = 'hermes_attendance_import'
                           ) OR COALESCE(notes, '') ~* 'Hermes arrival-sheet import'
                               THEN 'hermes_import'
                           WHEN EXISTS (
                               SELECT 1 FROM jsonb_array_elements(audit_events) event
                               WHERE event->>'action' = 'live_multi_segment_qa_attendance_create'
                                  OR event->>'source' = 'live_multi_segment_qa'
                           ) OR COALESCE(notes, '') ~* '(live[_ -]?qa|disposable)'
                               THEN 'qa_helper'
                           WHEN EXISTS (
                               SELECT 1 FROM jsonb_array_elements(audit_events) event
                               WHERE event->>'action' = 'leave_request_review'
                                  OR event->>'trigger' = 'leave_request'
                           ) OR COALESCE(notes, '') ~* '(\u0417\u0430\u044f\u0432\u043a\u0430\\s*#|Р—Р°СЏРІРєР°\\s*#)'
                               THEN 'leave_approval'
                           WHEN EXISTS (
                               SELECT 1 FROM jsonb_array_elements(audit_events) event
                               WHERE event->>'action' = 'no_show'
                           ) OR status = 'no_show'
                               THEN 'no_show_scheduler'
                           WHEN EXISTS (
                               SELECT 1 FROM jsonb_array_elements(audit_events) event
                               WHERE event->>'action' = 'auto_close'
                           ) OR auto_closed IS TRUE
                               THEN 'auto_close'
                           WHEN EXISTS (
                               SELECT 1 FROM jsonb_array_elements(audit_events) event
                               WHERE event->>'action' IN ('correction', 'manual_correction', 'compensation_snapshot_corrected')
                           ) OR corrected_at IS NOT NULL OR correction_reason IS NOT NULL
                               THEN 'correction'
                           WHEN EXISTS (
                               SELECT 1 FROM jsonb_array_elements(audit_events) event
                               WHERE event->>'action' IN ('mark_absent', 'attendance_status', 'record_attendance_status')
                           ) OR (clock_in IS NULL AND clock_out IS NULL
                                 AND status IN ('absent', 'sick', 'vacation', 'day_off', 'holiday', 'leave', 'paid_leave', 'unpaid_leave'))
                               THEN 'terminal_status'
                           WHEN EXISTS (
                               SELECT 1 FROM jsonb_array_elements(audit_events) event
                               WHERE event->>'action' IN ('clock_in', 'clock_out')
                                  OR event->>'method' IN ('camera', 'face', 'manual', 'import')
                                  OR event->>'source' IN ('camera', 'face_checkin', 'manual_clock', 'hr_today')
                           ) OR clock_in IS NOT NULL OR clock_out IS NOT NULL
                               THEN 'clock_in_out'
                           ELSE 'unknown'
                       END AS writer_category
                FROM base
            ), cohorted AS (
                SELECT *,
                       CASE
                           WHEN created_at >= $2::timestamptz THEN 'post_fix'
                           WHEN compensation_snapshot IS NULL THEN 'historical_exceptions'
                           ELSE 'pre_fix_with_snapshot'
                       END AS cohort,
                       CASE
                           WHEN compensation_snapshot IS NULL OR jsonb_typeof(compensation_snapshot) <> 'object' THEN 0
                           WHEN COALESCE(compensation_snapshot->'totals'->>'simultaneousAdditionalMinutes', '') ~ '^\\d+$'
                               THEN (compensation_snapshot->'totals'->>'simultaneousAdditionalMinutes')::int
                           ELSE 0
                       END AS simultaneous_additional_minutes
                FROM classified
            )
            SELECT cohort,
                   writer_category,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE snapshot_class = 'planned')::int AS planned_snapshots,
                   COUNT(*) FILTER (WHERE snapshot_class = 'final')::int AS final_snapshots,
                   COUNT(*) FILTER (
                       WHERE snapshot_class IN ('final', 'legacy_base_only')
                         AND has_no_paid_allocation
                         AND simultaneous_additional_minutes = 0
                   )::int AS explicit_base_only_final_snapshots,
                   COUNT(*) FILTER (WHERE snapshot_class = 'missing')::int AS missing_snapshots,
                   COUNT(*) FILTER (WHERE snapshot_class IN ('invalid', 'manual_review'))::int AS invalid_or_manual_review_snapshots,
                   COUNT(*) FILTER (WHERE has_paid_allocation AND snapshot_class <> 'final')::int AS paid_allocation_without_valid_final_snapshot,
                   COUNT(*) FILTER (WHERE writer_category = 'unknown')::int AS unknown_writers
            FROM cohorted
            WHERE cohort IN ('historical_exceptions', 'post_fix')
            GROUP BY cohort, writer_category
            ORDER BY cohort, writer_category`;
}

async function loadColumnMetadata(client) {
    const tables = Object.keys(REQUIRED_TABLE_COLUMNS);
    const result = await client.query(buildColumnAuditSql(), [tables]);
    const missing = missingRequirements(result.rows);
    return {
        requiredTablesAvailable: missing.length === 0,
        queryComplete: missing.length === 0,
        missingRequirements: missing
    };
}

async function runAudit(client, config) {
    const metadata = await loadColumnMetadata(client);
    if (!metadata.queryComplete) {
        return summarizeAuditRows([], config, metadata);
    }
    const coverageResult = await client.query(buildCoverageSql(), [config.effectiveDate, config.deploymentCutoffIso]);
    metadata.coverage = normalizeCoverage(coverageResult.rows[0]);
    const result = await client.query(buildAuditSql(), [config.effectiveDate, config.deploymentCutoffIso]);
    return summarizeAuditRows(result.rows, config, metadata);
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const parsed = parseArgs(argv, env);
    if (parsed.help) {
        console.log(usage());
        return { help: true };
    }
    const config = requireConfiguration(parsed);
    const pool = new Pool({
        connectionString: config.databaseUrl,
        ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 1,
        connectionTimeoutMillis: 10_000
    });
    const client = await pool.connect();
    let report;
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        report = await runAudit(client, config);
        await client.query('ROLLBACK');
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (_) {
            // Best-effort rollback; the original audit error remains authoritative.
        }
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
    console.log(JSON.stringify(report, null, 2));
    if (config.releaseGate && report.releaseGate.status !== 'passed') {
        process.exitCode = 1;
    }
    return report;
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.code || error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    CONFIRMATION,
    DEFAULT_EFFECTIVE_DATE,
    REQUIRED_TABLE_COLUMNS,
    SNAPSHOT_AUDIT_RELEASE_BLOCKERS,
    WRITER_CATEGORIES,
    booleanEnv,
    buildAuditSql,
    buildColumnAuditSql,
    buildCoverageSql,
    buildReleaseGate,
    classifyWriter,
    emptyCohortSummary,
    emptyCoverageSummary,
    main,
    missingRequirements,
    noteCategory,
    normalizeCoverage,
    normalizeDeploymentCutoff,
    parseArgs,
    requireConfiguration,
    runAudit,
    summarizeAuditRows,
    usage
};
