#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const {
    aggregateTaskAiDraftTelemetry,
    sanitizeTelemetryEvent
} = require('../services/taskAiDraftTelemetry');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'output', 'task-ai-rollout');
const DEFAULTS = Object.freeze({
    hours: 24,
    minProposals: 30,
    providerErrorRateMax: 0.05
});
const EVENT_MESSAGE = 'task_ai_draft_event';
const FAILURE_STATUSES = new Set([
    'provider_unavailable',
    'provider_error',
    'timeout',
    'invalid_response',
    'rate_limited',
    'error'
]);

function parseArgs(argv = []) {
    const options = {
        eventsFile: '',
        useDatabase: false,
        output: '',
        format: 'json',
        businessContext: '',
        hours: DEFAULTS.hours,
        minProposals: DEFAULTS.minProposals,
        providerErrorRateMax: DEFAULTS.providerErrorRateMax
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = () => {
            index += 1;
            if (index >= argv.length) throw new Error(`${arg} requires a value.`);
            return argv[index];
        };
        if (arg === '--events-file') options.eventsFile = next();
        else if (arg === '--database') options.useDatabase = true;
        else if (arg === '--output') options.output = next();
        else if (arg === '--format') options.format = next();
        else if (arg === '--business-context') options.businessContext = next();
        else if (arg === '--hours') options.hours = Number(next());
        else if (arg === '--min-proposals') options.minProposals = Number(next());
        else if (arg === '--provider-error-rate-max') options.providerErrorRateMax = Number(next());
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be json or markdown.');
    if (!Number.isFinite(options.hours) || options.hours <= 0 || options.hours > 24 * 14) throw new Error('--hours must be between 1 and 336.');
    if (!Number.isFinite(options.minProposals) || options.minProposals < 1) throw new Error('--min-proposals must be positive.');
    if (!Number.isFinite(options.providerErrorRateMax) || options.providerErrorRateMax < 0 || options.providerErrorRateMax > 1) {
        throw new Error('--provider-error-rate-max must be between 0 and 1.');
    }
    return options;
}

function usage() {
    return [
        'Usage:',
        '  node scripts/task-ai-rollout-report.js --events-file railway-task-ai.jsonl --database --format markdown',
        '',
        'Inputs:',
        '  --events-file <path>      Exported structured logs containing task_ai_draft_event rows.',
        '  --database                Also read durable commit/bundle evidence from TASK_AI_ROLLOUT_DATABASE_URL.',
        '  --hours <n>               Window size, default 24.',
        '  --min-proposals <n>       Required successful preview proposals, default 30.',
        '  --provider-error-rate-max <n>  Default 0.05.',
        '',
        'Safety:',
        '  No DATABASE_URL fallback is used. DB mode requires TASK_AI_ROLLOUT_DATABASE_URL.'
    ].join('\n');
}

function safeDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function observedEvent(observedAt, event, source = 'logs') {
    return {
        observedAt: safeDate(observedAt)?.toISOString() || null,
        source,
        event: sanitizeTelemetryEvent(event)
    };
}

function parseJsonLine(line) {
    try { return JSON.parse(line); } catch { return null; }
}

function parsePrettyLine(line) {
    const markerIndex = line.indexOf(EVENT_MESSAGE);
    if (markerIndex < 0) return null;
    const jsonStart = line.indexOf('{', markerIndex + EVENT_MESSAGE.length);
    if (jsonStart < 0) return null;
    return parseJsonLine(line.slice(jsonStart));
}

function eventFromStructuredLog(row = {}) {
    if (!row || typeof row !== 'object') return null;
    if (row.msg === EVENT_MESSAGE && row.data) {
        return observedEvent(row.ts || row.time || row.timestamp, row.data, 'logs');
    }
    if (row.message === EVENT_MESSAGE && row.data) {
        return observedEvent(row.ts || row.time || row.timestamp, row.data, 'logs');
    }
    if (row.msg === EVENT_MESSAGE && row.event) {
        return observedEvent(row.ts || row.time || row.timestamp, row.event, 'logs');
    }
    return null;
}

function parseTelemetryLogText(text = '') {
    const events = [];
    for (const line of String(text || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const asJson = parseJsonLine(trimmed);
        if (Array.isArray(asJson)) {
            for (const item of asJson) {
                const event = eventFromStructuredLog(item);
                if (event) events.push(event);
            }
            continue;
        }
        const structured = eventFromStructuredLog(asJson);
        if (structured) {
            events.push(structured);
            continue;
        }
        const pretty = parsePrettyLine(trimmed);
        if (pretty) events.push(observedEvent(null, pretty, 'logs'));
    }
    return events;
}

function loadTelemetryEvents(filePath) {
    if (!filePath) return [];
    const resolved = path.resolve(filePath);
    const text = fs.readFileSync(resolved, 'utf8');
    return parseTelemetryLogText(text);
}

function percentile(values, fraction) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function fieldMaskCounts(events, key) {
    const counts = {};
    for (const event of events) {
        for (const field of event[key] || []) counts[field] = (counts[field] || 0) + 1;
    }
    return counts;
}

function summarizeRolloutTelemetry(observedEvents = []) {
    const events = observedEvents.map(item => item.event);
    const aggregate = aggregateTaskAiDraftTelemetry(events);
    const latencies = events.map(event => event.latencyMs).filter(value => Number.isFinite(value) && value >= 0);
    const usage = events.reduce((acc, event) => {
        acc.inputTokens += Number(event.usage?.inputTokens || 0);
        acc.outputTokens += Number(event.usage?.outputTokens || 0);
        acc.totalTokens += Number(event.usage?.totalTokens || 0);
        return acc;
    }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const byReasonCode = {};
    for (const event of events) {
        const reason = event.reasonCode || 'none';
        byReasonCode[reason] = (byReasonCode[reason] || 0) + 1;
    }
    return {
        ...aggregate,
        previewAttempts: events.filter(event => event.type === 'preview').length,
        successfulProposals: events.filter(event => event.type === 'preview' && event.status === 'success').length,
        providerFailures: events.filter(event => FAILURE_STATUSES.has(event.status)).length,
        byReasonCode,
        latencyMs: {
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95),
            max: latencies.length ? Math.max(...latencies) : null
        },
        usage,
        acceptedFieldMask: fieldMaskCounts(events, 'acceptedFieldMask'),
        rejectedFieldMask: fieldMaskCounts(events, 'rejectedFieldMask'),
        editedFieldMask: fieldMaskCounts(events, 'editedFieldMask'),
        changedFields: fieldMaskCounts(events, 'changedFields')
    };
}

function eventWindow(observedEvents = []) {
    const dates = observedEvents
        .map(item => safeDate(item.observedAt))
        .filter(Boolean)
        .sort((a, b) => a - b);
    if (!dates.length) return { from: null, to: null, spanHours: 0, hasTimestamps: false };
    const from = dates[0];
    const to = dates[dates.length - 1];
    return {
        from: from.toISOString(),
        to: to.toISOString(),
        spanHours: Math.round(((to - from) / 3_600_000) * 10) / 10,
        hasTimestamps: true
    };
}

function poolFromEnv(env = process.env) {
    const connectionString = String(env.TASK_AI_ROLLOUT_DATABASE_URL || '').trim();
    if (!connectionString) throw new Error('TASK_AI_ROLLOUT_DATABASE_URL is required for --database. DATABASE_URL is intentionally ignored.');
    return new Pool({
        connectionString,
        ssl: String(env.PGSSLMODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : undefined,
        application_name: 'task_ai_rollout_report_readonly'
    });
}

async function queryOne(client, text, params = []) {
    const result = await client.query(text, params);
    return result.rows?.[0] || {};
}

async function collectDatabaseEvidence(options = {}, env = process.env) {
    const pool = options.pool || poolFromEnv(env);
    const ownsPool = !options.pool;
    const params = [Number(options.hours || DEFAULTS.hours)];
    let businessSql = '';
    if (options.businessContext) {
        params.push(String(options.businessContext));
        businessSql = ` AND COALESCE(t.business_context, 'event_genix') = $${params.length}`;
    }
    try {
        const rowsResult = await pool.query(
            `SELECT h.action_type, h.source_surface, h.created_at, h.actor_user_id,
                    h.new_value_json, h.meta_json, COALESCE(t.business_context, 'event_genix') AS business_context
             FROM task_action_history h
             JOIN tasks t ON t.id = h.task_id
             WHERE h.action_type IN ('task_ai_draft_committed', 'task_ai_draft_bundle_committed')
               AND h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
               ${businessSql}
             ORDER BY h.created_at ASC`,
            params
        );
        const historyEvents = rowsResult.rows.map(row => {
            const isBundle = row.action_type === 'task_ai_draft_bundle_committed';
            const nextValue = row.new_value_json || {};
            const meta = row.meta_json || {};
            return observedEvent(row.created_at, {
                type: isBundle ? 'bundle_commit' : 'commit',
                status: 'success',
                model: meta.model || '',
                provider: meta.provider || 'openai',
                contractVersion: meta.contractVersion || meta.contract_version || '',
                promptVersion: meta.promptVersion || meta.prompt_version || '',
                businessContext: row.business_context || '',
                changedFields: nextValue.changedFields || [],
                acceptedFieldMask: meta.acceptedFieldMask || [],
                taskCount: isBundle ? Number(nextValue.taskCount || 0) : 1,
                acceptedTaskCount: isBundle ? Number(Array.isArray(nextValue.acceptedTaskMask) ? nextValue.acceptedTaskMask.length : 0) : 0,
                rejectedTaskCount: isBundle ? Number(Array.isArray(nextValue.rejectedTaskMask) ? nextValue.rejectedTaskMask.length : 0) : 0,
                reasonCode: isBundle ? 'durable_bundle_history' : 'durable_commit_history'
            }, 'database');
        });
        const duplicateSingle = await queryOne(pool, `
            SELECT COUNT(*)::int AS count
            FROM (
                SELECT h.actor_user_id, h.meta_json->>'idempotencyKey' AS idempotency_key, COUNT(*)::int AS event_count
                FROM task_action_history h
                JOIN tasks t ON t.id = h.task_id
                WHERE h.action_type = 'task_ai_draft_committed'
                  AND h.source_surface = 'task_ai_draft_commit'
                  AND h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
                  AND COALESCE(h.meta_json->>'idempotencyKey', '') <> ''
                  ${businessSql}
                GROUP BY h.actor_user_id, h.meta_json->>'idempotencyKey'
                HAVING COUNT(*) > 1
            ) duplicates`, params);
        const partialImpacts = await queryOne(pool, `
            SELECT COUNT(*)::int AS count
            FROM task_action_history h
            JOIN tasks t ON t.id = h.task_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS impact_count
                FROM my_day_task_impacts ti
                WHERE ti.task_id = h.task_id
                  AND ti.user_id = h.actor_user_id
            ) actual ON true
            WHERE h.action_type = 'task_ai_draft_committed'
              AND h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
              AND COALESCE((h.new_value_json->>'impactCount')::int, 0) <> COALESCE(actual.impact_count, 0)
              ${businessSql}`, params);
        const partialSubtasks = await queryOne(pool, `
            SELECT COUNT(*)::int AS count
            FROM task_action_history h
            JOIN tasks t ON t.id = h.task_id
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS subtask_count
                FROM task_subtasks st
                WHERE st.task_id = h.task_id
            ) actual ON true
            WHERE h.action_type = 'task_ai_draft_committed'
              AND h.source_surface = 'task_ai_draft_commit'
              AND h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
              AND COALESCE((h.new_value_json->>'subtaskCount')::int, 0) <> COALESCE(actual.subtask_count, 0)
              ${businessSql}`, params);
        const partialBundles = await queryOne(pool, `
            SELECT COUNT(*)::int AS count
            FROM task_bundles b
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS member_count
                FROM task_bundle_tasks bt
                JOIN tasks t ON t.id = bt.task_id
                WHERE bt.bundle_id = b.id
            ) members ON true
            WHERE b.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
              AND COALESCE(members.member_count, 0) <> b.task_count
              ${options.businessContext ? `AND b.business_context = $2` : ''}`,
            options.businessContext ? [Number(options.hours || DEFAULTS.hours), String(options.businessContext)] : [Number(options.hours || DEFAULTS.hours)]
        );
        const scheduleFailures = await queryOne(pool, `
            SELECT COUNT(*)::int AS count
            FROM task_action_history h
            JOIN tasks t ON t.id = h.task_id
            WHERE h.action_type = 'task_ai_draft_committed'
              AND h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
              AND COALESCE((h.new_value_json->>'scheduleWritten')::boolean, false) = true
              AND t.date IS NULL
              ${businessSql}`, params);
        return {
            available: true,
            events: historyEvents,
            checks: {
                duplicateCommits: Number(duplicateSingle.count || 0),
                partialImpactWrites: Number(partialImpacts.count || 0),
                partialSubtaskWrites: Number(partialSubtasks.count || 0),
                partialBundleWrites: Number(partialBundles.count || 0),
                schedulePlacementFailures: Number(scheduleFailures.count || 0)
            }
        };
    } finally {
        if (ownsPool) await pool.end();
    }
}

function buildVerdict({ telemetry, window, dbEvidence = {}, thresholds = {} }) {
    const providerErrorRate = telemetry.previewAttempts
        ? telemetry.providerFailures / telemetry.previewAttempts
        : null;
    const checks = dbEvidence.checks || {};
    const gates = {
        enoughSuccessfulProposals: telemetry.successfulProposals >= thresholds.minProposals,
        enoughTimeEvidence: window.hasTimestamps && window.spanHours >= thresholds.hours,
        providerErrorRate: providerErrorRate !== null && providerErrorRate <= thresholds.providerErrorRateMax,
        partialWrites: dbEvidence.available === true
            && Number(checks.partialImpactWrites || 0) === 0
            && Number(checks.partialSubtaskWrites || 0) === 0
            && Number(checks.partialBundleWrites || 0) === 0,
        duplicateCommits: dbEvidence.available === true && Number(checks.duplicateCommits || 0) === 0,
        unknownImpactIds: Number(telemetry.byReasonCode?.TASK_AI_DRAFT_UNKNOWN_IMPACT || 0) === 0
            && Number(telemetry.byReasonCode?.TASK_AI_BUNDLE_UNKNOWN_IMPACT || 0) === 0,
        schedulePlacementFailures: dbEvidence.available === true && Number(checks.schedulePlacementFailures || 0) === 0
    };
    const missingEvidence = [];
    if (!telemetry.previewAttempts) missingEvidence.push('structured telemetry logs with preview events');
    if (!window.hasTimestamps) missingEvidence.push('timestamped telemetry window');
    if (dbEvidence.available !== true) missingEvidence.push('read-only database evidence from TASK_AI_ROLLOUT_DATABASE_URL');
    return {
        status: Object.values(gates).every(Boolean) ? 'pass' : 'hold',
        gates,
        thresholds,
        providerErrorRate,
        missingEvidence
    };
}

function buildReport({ logEvents = [], dbEvidence = {}, options = {} }) {
    const dbEvents = Array.isArray(dbEvidence.events) ? dbEvidence.events : [];
    const events = [...logEvents, ...dbEvents];
    const telemetry = summarizeRolloutTelemetry(events);
    const window = eventWindow(events);
    const thresholds = {
        hours: Number(options.hours || DEFAULTS.hours),
        minProposals: Number(options.minProposals || DEFAULTS.minProposals),
        providerErrorRateMax: Number(options.providerErrorRateMax ?? DEFAULTS.providerErrorRateMax)
    };
    return {
        generatedAt: new Date().toISOString(),
        report: 'task_ai_rollout_gate',
        contentPolicy: 'sanitized metadata only; task content and secrets are excluded',
        sources: {
            logs: { available: logEvents.length > 0, events: logEvents.length },
            database: { available: dbEvidence.available === true, events: dbEvents.length }
        },
        window,
        telemetry,
        databaseChecks: dbEvidence.checks || null,
        verdict: buildVerdict({ telemetry, window, dbEvidence, thresholds })
    };
}

function reportMarkdown(report = {}) {
    const t = report.telemetry || {};
    const v = report.verdict || {};
    const checks = report.databaseChecks || {};
    return [
        `# Task AI rollout report`,
        '',
        `- generatedAt: \`${report.generatedAt}\``,
        `- verdict: \`${v.status || 'hold'}\``,
        `- window: \`${report.window?.from || 'unknown'} → ${report.window?.to || 'unknown'}\` (${report.window?.spanHours || 0}h)`,
        `- successful proposals: ${t.successfulProposals || 0}`,
        `- preview attempts: ${t.previewAttempts || 0}`,
        `- provider failures: ${t.providerFailures || 0}`,
        `- provider error rate: ${v.providerErrorRate === null || v.providerErrorRate === undefined ? 'n/a' : `${Math.round(v.providerErrorRate * 1000) / 10}%`}`,
        `- latency p50/p95/max: ${t.latencyMs?.p50 ?? 'n/a'} / ${t.latencyMs?.p95 ?? 'n/a'} / ${t.latencyMs?.max ?? 'n/a'} ms`,
        `- tokens total: ${t.usage?.totalTokens || 0}`,
        `- task counts: proposed/accepted/rejected/edited ${t.taskCount || 0}/${t.acceptedTaskCount || 0}/${t.rejectedTaskCount || 0}/${t.editedTaskCount || 0}`,
        `- duplicate commits: ${checks.duplicateCommits ?? 'n/a'}`,
        `- partial writes: impacts=${checks.partialImpactWrites ?? 'n/a'}, subtasks=${checks.partialSubtaskWrites ?? 'n/a'}, bundles=${checks.partialBundleWrites ?? 'n/a'}`,
        `- schedule placement failures: ${checks.schedulePlacementFailures ?? 'n/a'}`,
        '',
        '## Gates',
        '',
        ...Object.entries(v.gates || {}).map(([key, value]) => `- ${value ? 'PASS' : 'HOLD'} ${key}`),
        '',
        '## Missing evidence',
        '',
        ...((v.missingEvidence || []).length ? v.missingEvidence.map(item => `- ${item}`) : ['- none']),
        ''
    ].join('\n');
}

function safeOutputPath(customOutput, format) {
    if (customOutput) return path.resolve(customOutput);
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(OUTPUT_ROOT, `${stamp}.${format === 'markdown' ? 'md' : 'json'}`);
}

function writeReportArtifact(report, options = {}) {
    const outputPath = safeOutputPath(options.output, options.format);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const body = options.format === 'markdown' ? reportMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`;
    fs.writeFileSync(outputPath, body, 'utf8');
    return outputPath;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const logEvents = loadTelemetryEvents(options.eventsFile);
    const dbEvidence = options.useDatabase
        ? await collectDatabaseEvidence(options)
        : { available: false, events: [], checks: null };
    const report = buildReport({ logEvents, dbEvidence, options });
    const artifactPath = writeReportArtifact(report, options);
    const output = {
        verdict: report.verdict.status,
        generatedAt: report.generatedAt,
        artifact: path.relative(ROOT, artifactPath),
        successfulProposals: report.telemetry.successfulProposals,
        previewAttempts: report.telemetry.previewAttempts,
        missingEvidence: report.verdict.missingEvidence,
        gates: report.verdict.gates
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (report.verdict.status !== 'pass') process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Task AI rollout report failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULTS,
    buildReport,
    buildVerdict,
    collectDatabaseEvidence,
    parseArgs,
    parseTelemetryLogText,
    poolFromEnv,
    reportMarkdown,
    summarizeRolloutTelemetry,
    writeReportArtifact
};
