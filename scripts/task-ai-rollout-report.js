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
const PROVIDER_FAILURE_STATUSES = new Set([
    'provider_unavailable',
    'provider_error',
    'timeout',
    'invalid_response'
]);
const ACTIONABLE_PREVIEW_DECISIONS = new Set(['apply', 'single_task', 'checklist', 'task_bundle']);
const ZERO_LATENCY_DB_SOURCES = new Set(['database']);

function parseArgs(argv = []) {
    const options = {
        eventsFile: '',
        stdin: false,
        useDatabase: false,
        output: '',
        format: 'json',
        stage: '',
        version: '',
        sha: '',
        promptVersion: '',
        contractVersion: '',
        deploymentId: '',
        deploymentStart: '',
        deploymentEnd: '',
        expectedRolloutPercent: '',
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
        else if (arg === '--stdin') options.stdin = true;
        else if (arg === '--database') options.useDatabase = true;
        else if (arg === '--output') options.output = next();
        else if (arg === '--format') options.format = next();
        else if (arg === '--stage') options.stage = next();
        else if (arg === '--version') options.version = next();
        else if (arg === '--sha') options.sha = next();
        else if (arg === '--prompt-version') options.promptVersion = next();
        else if (arg === '--contract-version') options.contractVersion = next();
        else if (arg === '--deployment-id') options.deploymentId = next();
        else if (arg === '--deployment-start') options.deploymentStart = next();
        else if (arg === '--deployment-end') options.deploymentEnd = next();
        else if (arg === '--expected-rollout-percent') options.expectedRolloutPercent = next();
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
        '  --stdin                   Read structured logs from stdin instead of a raw saved log file.',
        '  --database                Also read durable commit/bundle evidence from TASK_AI_ROLLOUT_DATABASE_URL.',
        '  --hours <n>               Window size, default 24.',
        '  --min-proposals <n>       Required successful preview proposals, default 30.',
        '  --provider-error-rate-max <n>  Default 0.05.',
        '  --stage <name>            Rollout stage label, for example 20, 50, bundle-test.',
        '  --version <version>       Exact deployed application version for the evidence artifact.',
        '  --sha <sha>               Exact deployed commit SHA for the evidence artifact.',
        '  --prompt-version <version> Exact prompt version; events missing/mismatching it are excluded.',
        '  --contract-version <version> Exact contract/schema version; events missing/mismatching it are excluded.',
        '  --deployment-id <id>       Exact deployment ID; events missing/mismatching it are excluded.',
        '  --deployment-start <iso>   Exclude events before this timestamp.',
        '  --deployment-end <iso>     Exclude events after this timestamp.',
        '  --expected-rollout-percent <n>  Expected rollout percentage for this artifact.',
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

function canonicalSha(value) {
    return String(value || '').trim().toLowerCase();
}

function canonicalString(value) {
    return String(value || '').trim();
}

function matchesExactFilters(item = {}, options = {}) {
    const event = item.event || {};
    if (options.sha && canonicalSha(event.releaseSha) !== canonicalSha(options.sha)) return false;
    if (options.version && canonicalString(event.releaseVersion) !== canonicalString(options.version)) return false;
    if (options.promptVersion && canonicalString(event.promptVersion) !== canonicalString(options.promptVersion)) return false;
    if (options.contractVersion && canonicalString(event.contractVersion) !== canonicalString(options.contractVersion)) return false;
    if (options.deploymentId && canonicalString(event.deploymentId) !== canonicalString(options.deploymentId)) return false;
    if (options.expectedRolloutPercent && canonicalString(event.expectedRolloutPercent) !== canonicalString(options.expectedRolloutPercent)) return false;
    if (options.stage && event.rolloutStage && canonicalString(event.rolloutStage) !== canonicalString(options.stage)) return false;
    const observedAt = safeDate(item.observedAt);
    const start = safeDate(options.deploymentStart);
    const end = safeDate(options.deploymentEnd);
    if (start && (!observedAt || observedAt < start)) return false;
    if (end && (!observedAt || observedAt > end)) return false;
    return true;
}

function filterExactEvents(observedEvents = [], options = {}) {
    return observedEvents.filter(item => matchesExactFilters(item, options));
}

function eventDedupeKey(item = {}) {
    const event = item.event || {};
    if (event.correlationId) return `correlation:${event.correlationId}`;
    return [
        'fallback',
        event.type,
        event.status,
        event.releaseSha,
        event.promptVersion,
        event.contractVersion,
        event.userHash,
        event.businessContext,
        event.requestId,
        item.observedAt
    ].map(part => String(part || '')).join('|');
}

function dedupeObservedEvents(observedEvents = []) {
    const merged = new Map();
    for (const item of observedEvents) {
        const key = eventDedupeKey(item);
        const existing = merged.get(key);
        if (!existing) {
            merged.set(key, { ...item });
            continue;
        }
        const existingIsDb = existing.source === 'database';
        const incomingIsLog = item.source === 'logs';
        const chosen = existingIsDb && incomingIsLog ? item : existing;
        const sources = new Set(String(existing.source || '').split('+').filter(Boolean));
        sources.add(item.source || 'unknown');
        merged.set(key, { ...chosen, source: [...sources].sort().join('+') });
    }
    return [...merged.values()];
}

function isProviderPreviewAttempt(event = {}) {
    return event.type === 'preview'
        && Boolean(event.provider)
        && event.status !== 'attempt'
        && event.status !== 'rate_limited'
        && event.status !== 'conflict'
        && event.status !== 'rollback';
}

function isActionablePreviewSuccess(event = {}) {
    return event.type === 'preview'
        && event.status === 'success'
        && event.outcome === 'success'
        && ACTIONABLE_PREVIEW_DECISIONS.has(event.reasonCode)
        && !event.fallbackReason
        && !event.impactFilterReason
        && Number(event.filteredImpactCount || 0) === 0;
}

function isProviderPreviewFailure(event = {}) {
    return isProviderPreviewAttempt(event)
        && (PROVIDER_FAILURE_STATUSES.has(event.status)
            || event.outcome === 'provider_error'
            || event.outcome === 'validation_error');
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

function loadTelemetryFromStdin() {
    const text = fs.readFileSync(0, 'utf8');
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
    const normalizedObservedEvents = observedEvents.map(item => ({
        ...item,
        event: sanitizeTelemetryEvent(item.event)
    }));
    const events = normalizedObservedEvents.map(item => item.event);
    const aggregate = aggregateTaskAiDraftTelemetry(events);
    const latencyBucket = (predicate) => observedEvents
        .map(item => ({ ...item, event: sanitizeTelemetryEvent(item.event) }))
        .filter(item => predicate(item.event || {}, item))
        .filter(item => !ZERO_LATENCY_DB_SOURCES.has(item.source))
        .map(item => item.event?.latencyMs)
        .filter(value => Number.isFinite(value) && value > 0);
    const providerPreviewLatencies = latencyBucket(event => isProviderPreviewAttempt(event));
    const commitLatencies = latencyBucket(event => event.type === 'commit');
    const bundleCommitLatencies = latencyBucket(event => event.type === 'bundle_commit');
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
        providerPreviewAttempts: events.filter(isProviderPreviewAttempt).length,
        successfulProposals: events.filter(isActionablePreviewSuccess).length,
        providerFailures: events.filter(isProviderPreviewFailure).length,
        fallbackProposalCount: Number(aggregate.byOutcome?.fallback_proposal || 0),
        validationFilteredCount: Number(aggregate.byOutcome?.validation_filtered || 0),
        byReasonCode,
        latencyMs: {
            providerPreview: {
                p50: percentile(providerPreviewLatencies, 0.5),
                p95: percentile(providerPreviewLatencies, 0.95),
                max: providerPreviewLatencies.length ? Math.max(...providerPreviewLatencies) : null
            },
            commit: {
                p50: percentile(commitLatencies, 0.5),
                p95: percentile(commitLatencies, 0.95),
                max: commitLatencies.length ? Math.max(...commitLatencies) : null
            },
            bundleCommit: {
                p50: percentile(bundleCommitLatencies, 0.5),
                p95: percentile(bundleCommitLatencies, 0.95),
                max: bundleCommitLatencies.length ? Math.max(...bundleCommitLatencies) : null
            }
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
    const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
    const releaseClient = typeof client.release === 'function' ? () => client.release() : null;
    let transactionOpen = false;
    const params = [Number(options.hours || DEFAULTS.hours)];
    let businessSql = '';
    if (options.businessContext) {
        params.push(String(options.businessContext));
        businessSql = ` AND COALESCE(t.business_context, 'event_genix') = $${params.length}`;
    }
    let historyExactSql = '';
    if (options.sha) {
        params.push(String(options.sha).toLowerCase());
        historyExactSql += ` AND lower(COALESCE(h.meta_json->>'releaseSha', '')) = $${params.length}`;
    }
    if (options.version) {
        params.push(String(options.version));
        historyExactSql += ` AND COALESCE(h.meta_json->>'releaseVersion', '') = $${params.length}`;
    }
    if (options.promptVersion) {
        params.push(String(options.promptVersion));
        historyExactSql += ` AND COALESCE(h.meta_json->>'promptVersion', h.meta_json->>'prompt_version', '') = $${params.length}`;
    }
    if (options.contractVersion) {
        params.push(String(options.contractVersion));
        historyExactSql += ` AND COALESCE(h.meta_json->>'contractVersion', h.meta_json->>'contract_version', '') = $${params.length}`;
    }
    if (options.deploymentId) {
        params.push(String(options.deploymentId));
        historyExactSql += ` AND COALESCE(h.meta_json->>'deploymentId', '') = $${params.length}`;
    }
    try {
        if (typeof pool.connect === 'function') {
            await client.query('BEGIN READ ONLY');
            transactionOpen = true;
            await client.query(`SET LOCAL statement_timeout = '5000ms'`);
            await client.query(`SET TRANSACTION READ ONLY`);
        }
        const rowsResult = await client.query(
            `SELECT h.action_type, h.source_surface, h.created_at, h.actor_user_id,
                    h.new_value_json, h.meta_json, COALESCE(t.business_context, 'event_genix') AS business_context
             FROM task_action_history h
             JOIN tasks t ON t.id = h.task_id
             WHERE h.action_type IN ('task_ai_draft_committed', 'task_ai_draft_bundle_committed')
               AND h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
               ${businessSql}
               ${historyExactSql}
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
                releaseVersion: meta.releaseVersion || '',
                releaseSha: meta.releaseSha || '',
                deploymentId: meta.deploymentId || '',
                contractVersion: meta.contractVersion || meta.contract_version || '',
                promptVersion: meta.promptVersion || meta.prompt_version || '',
                schemaName: meta.schemaName || meta.schema_name || '',
                reasoningEffort: meta.reasoningEffort || '',
                correlationId: meta.correlationId || '',
                businessContext: row.business_context || '',
                changedFields: nextValue.changedFields || [],
                acceptedFieldMask: meta.acceptedFieldMask || [],
                taskCount: isBundle ? Number(nextValue.taskCount || 0) : 1,
                acceptedTaskCount: isBundle ? Number(Array.isArray(nextValue.acceptedTaskMask) ? nextValue.acceptedTaskMask.length : 0) : 0,
                rejectedTaskCount: isBundle ? Number(Array.isArray(nextValue.rejectedTaskMask) ? nextValue.rejectedTaskMask.length : 0) : 0,
                reasonCode: isBundle ? 'durable_bundle_history' : 'durable_commit_history'
            }, 'database');
        });
        const duplicateSingle = await queryOne(client, `
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
                  ${historyExactSql}
                GROUP BY h.actor_user_id, h.meta_json->>'idempotencyKey'
                HAVING COUNT(*) > 1
            ) duplicates`, params);
        const partialImpacts = await queryOne(client, `
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
              ${businessSql}
              ${historyExactSql}`, params);
        const partialSubtasks = await queryOne(client, `
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
              ${businessSql}
              ${historyExactSql}`, params);
        const partialBundles = await queryOne(client, `
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
              AND EXISTS (
                  SELECT 1
                  FROM task_action_history h
                  WHERE h.action_type = 'task_ai_draft_bundle_committed'
                    AND h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
                    AND h.meta_json->>'bundleId' = b.id::text
                    ${historyExactSql}
              )
              ${options.businessContext ? `AND b.business_context = $2` : ''}`,
            params
        );
        const scheduleFailures = await queryOne(client, `
            SELECT COUNT(*)::int AS count
            FROM task_action_history h
            JOIN tasks t ON t.id = h.task_id
            WHERE h.action_type = 'task_ai_draft_committed'
              AND h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')
              AND COALESCE((h.new_value_json->>'scheduleWritten')::boolean, false) = true
              AND t.date IS NULL
              ${businessSql}
              ${historyExactSql}`, params);
        const evidence = {
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
        if (transactionOpen) {
            await client.query('COMMIT');
            transactionOpen = false;
        }
        return evidence;
    } finally {
        if (transactionOpen) {
            try { await client.query('ROLLBACK'); } catch {}
        }
        if (releaseClient) releaseClient();
        if (ownsPool) await pool.end();
    }
}

function buildVerdict({ telemetry, window, dbEvidence = {}, thresholds = {} }) {
    const providerErrorRate = telemetry.providerPreviewAttempts
        ? telemetry.providerFailures / telemetry.providerPreviewAttempts
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
    gates.enoughVolumeOrTimeEvidence = gates.enoughSuccessfulProposals || gates.enoughTimeEvidence;
    const missingEvidence = [];
    if (!telemetry.previewAttempts) missingEvidence.push('structured telemetry logs with preview events');
    if (!window.hasTimestamps) missingEvidence.push('timestamped telemetry window');
    if (dbEvidence.available !== true) missingEvidence.push('read-only database evidence from TASK_AI_ROLLOUT_DATABASE_URL');
    if (!gates.enoughVolumeOrTimeEvidence) missingEvidence.push(`at least ${thresholds.minProposals} successful proposals or ${thresholds.hours}h of timestamped evidence`);
    return {
        status: gates.enoughVolumeOrTimeEvidence
            && gates.providerErrorRate
            && gates.partialWrites
            && gates.duplicateCommits
            && gates.unknownImpactIds
            && gates.schedulePlacementFailures
            ? 'pass'
            : 'hold',
        gates,
        thresholds,
        providerErrorRate,
        missingEvidence
    };
}

function buildReport({ logEvents = [], dbEvidence = {}, options = {} }) {
    const dbEvents = Array.isArray(dbEvidence.events) ? dbEvidence.events : [];
    const rawEvents = [...logEvents, ...dbEvents];
    const exactEvents = filterExactEvents(rawEvents, options);
    const events = dedupeObservedEvents(exactEvents);
    const telemetry = summarizeRolloutTelemetry(events);
    const window = eventWindow(events.filter(item => isProviderPreviewAttempt(item.event || {})));
    const thresholds = {
        hours: Number(options.hours || DEFAULTS.hours),
        minProposals: Number(options.minProposals || DEFAULTS.minProposals),
        providerErrorRateMax: Number(options.providerErrorRateMax ?? DEFAULTS.providerErrorRateMax)
    };
    return {
        generatedAt: new Date().toISOString(),
        report: 'task_ai_rollout_gate',
        contentPolicy: 'sanitized metadata only; task content and secrets are excluded',
        release: {
            version: String(options.version || '').trim() || null,
            sha: String(options.sha || '').trim() || null,
            stage: String(options.stage || '').trim() || null,
            expectedRolloutPercent: String(options.expectedRolloutPercent || '').trim() || null,
            promptVersion: String(options.promptVersion || '').trim() || null,
            contractVersion: String(options.contractVersion || '').trim() || null,
            deploymentId: String(options.deploymentId || '').trim() || null,
            deploymentStart: String(options.deploymentStart || '').trim() || null,
            deploymentEnd: String(options.deploymentEnd || '').trim() || null
        },
        sources: {
            logs: { available: logEvents.length > 0, events: logEvents.length },
            database: { available: dbEvidence.available === true, events: dbEvents.length },
            exactFilteredEvents: exactEvents.length,
            deduplicatedEvents: events.length
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
        `- version/SHA: \`${report.release?.version || 'unknown'}\` / \`${report.release?.sha || 'unknown'}\``,
        `- stage: \`${report.release?.stage || 'unknown'}\` (expected rollout ${report.release?.expectedRolloutPercent || 'unknown'}%)`,
        `- verdict: \`${v.status || 'hold'}\``,
        `- window: \`${report.window?.from || 'unknown'} → ${report.window?.to || 'unknown'}\` (${report.window?.spanHours || 0}h)`,
        `- successful proposals: ${t.successfulProposals || 0}`,
        `- preview attempts: ${t.previewAttempts || 0}`,
        `- provider preview attempts: ${t.providerPreviewAttempts || 0}`,
        `- provider failures: ${t.providerFailures || 0}`,
        `- fallback proposals: ${t.fallbackProposalCount || 0}`,
        `- validation-filtered events: ${t.validationFilteredCount || 0}`,
        `- fallback reasons: ${JSON.stringify(t.byFallbackReason || {})}`,
        `- outcomes: ${JSON.stringify(t.byOutcome || {})}`,
        `- filtered impact IDs: ${t.filteredImpactCount || 0}`,
        `- provider error rate: ${v.providerErrorRate === null || v.providerErrorRate === undefined ? 'n/a' : `${Math.round(v.providerErrorRate * 1000) / 10}%`}`,
        `- provider preview latency p50/p95/max: ${t.latencyMs?.providerPreview?.p50 ?? 'n/a'} / ${t.latencyMs?.providerPreview?.p95 ?? 'n/a'} / ${t.latencyMs?.providerPreview?.max ?? 'n/a'} ms`,
        `- commit latency p50/p95/max: ${t.latencyMs?.commit?.p50 ?? 'n/a'} / ${t.latencyMs?.commit?.p95 ?? 'n/a'} / ${t.latencyMs?.commit?.max ?? 'n/a'} ms`,
        `- bundle commit latency p50/p95/max: ${t.latencyMs?.bundleCommit?.p50 ?? 'n/a'} / ${t.latencyMs?.bundleCommit?.p95 ?? 'n/a'} / ${t.latencyMs?.bundleCommit?.max ?? 'n/a'} ms`,
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
    const logEvents = [
        ...loadTelemetryEvents(options.eventsFile),
        ...(options.stdin ? loadTelemetryFromStdin() : [])
    ];
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
    dedupeObservedEvents,
    filterExactEvents,
    isActionablePreviewSuccess,
    isProviderPreviewAttempt,
    parseArgs,
    parseTelemetryLogText,
    poolFromEnv,
    reportMarkdown,
    summarizeRolloutTelemetry,
    writeReportArtifact
};
