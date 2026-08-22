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
const BUNDLE_OUTPUT_ROOT = path.join(ROOT, 'output', 'task-ai-bundle-rollout');
const DEFAULTS = Object.freeze({
    hours: 24,
    minProposals: 30,
    providerErrorRateMax: 0.05
});
const EVENT_MESSAGE = 'task_ai_draft_event';
const VERDICT_REASONS = Object.freeze({
    PASS: 'PASS',
    HOLD_INSUFFICIENT_TRAFFIC: 'HOLD_INSUFFICIENT_TRAFFIC',
    HOLD_PROVIDER_ERRORS: 'HOLD_PROVIDER_ERRORS',
    TELEMETRY_GAP: 'TELEMETRY_GAP',
    SAFETY_GATE_FAILURE: 'SAFETY_GATE_FAILURE'
});
const ACTIONABLE_PREVIEW_DECISIONS = new Set(['single_task', 'checklist', 'task_bundle']);
const AI_HTTP_ROUTES = Object.freeze({
    preview: '/api/tasks/ai-draft/preview',
    commit: '/api/tasks/ai-draft/commit',
    bundleCommit: '/api/tasks/ai-draft/bundle/commit'
});
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
        stdin: false,
        useDatabase: false,
        output: '',
        format: 'json',
        stage: '',
        version: '',
        sha: '',
        expectedRolloutPercent: '',
        deploymentId: '',
        deploymentStart: '',
        deploymentEnd: '',
        promptVersion: '',
        schemaName: '',
        contractVersion: '',
        scope: '',
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
        else if (arg === '--expected-rollout-percent') options.expectedRolloutPercent = next();
        else if (arg === '--deployment-id') options.deploymentId = next();
        else if (arg === '--deployment-start') options.deploymentStart = next();
        else if (arg === '--deployment-end') options.deploymentEnd = next();
        else if (arg === '--prompt-version') options.promptVersion = next();
        else if (arg === '--schema-name') options.schemaName = next();
        else if (arg === '--contract-version') options.contractVersion = next();
        else if (arg === '--scope') options.scope = next();
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
    if (options.scope && !['single', 'bundle'].includes(options.scope)) throw new Error('--scope must be single or bundle.');
    if (options.sha && !/^[a-f0-9]{40}$/i.test(options.sha)) throw new Error('--sha must be an exact 40-character commit SHA.');
    for (const key of ['deploymentStart', 'deploymentEnd']) {
        if (options[key] && !safeDate(options[key])) throw new Error(`--${key === 'deploymentStart' ? 'deployment-start' : 'deployment-end'} must be an ISO timestamp.`);
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
        '  --expected-rollout-percent <n>  Expected rollout percentage for this artifact.',
        '  --deployment-id <id>      Exact Railway deployment ID.',
        '  --deployment-start <iso>  Inclusive exact deployment evidence boundary.',
        '  --deployment-end <iso>    Exclusive exact deployment evidence boundary.',
        '  --prompt-version <value>  Exact prompt version filter.',
        '  --schema-name <value>     Exact Structured Output schema filter.',
        '  --contract-version <value> Exact proposal/commit contract filter.',
        '  --scope <single|bundle>   Build separate single/checklist or bundle evidence.',
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

function observedEvent(observedAt, event, source = 'logs', envelope = {}) {
    const sourceEvent = event && typeof event === 'object' && !Array.isArray(event) ? event : {};
    return {
        observedAt: safeDate(observedAt)?.toISOString() || null,
        source,
        event: sanitizeTelemetryEvent({
            ...sourceEvent,
            requestId: sourceEvent.requestId || envelope.requestId || envelope.reqId || '',
            deploymentId: sourceEvent.deploymentId || envelope.deploymentId || '',
            releaseVersion: sourceEvent.releaseVersion || envelope.releaseVersion || '',
            releaseSha: sourceEvent.releaseSha || envelope.releaseSha || ''
        })
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

function eventFromStructuredLog(row = {}, envelope = {}) {
    if (!row || typeof row !== 'object') return null;
    const mergedEnvelope = {
        ...envelope,
        requestId: row.requestId || row.reqId || envelope.requestId || envelope.reqId || '',
        deploymentId: row.deploymentId || envelope.deploymentId || '',
        releaseVersion: row.releaseVersion || envelope.releaseVersion || '',
        releaseSha: row.releaseSha || envelope.releaseSha || ''
    };
    if (row.msg === EVENT_MESSAGE && row.data) {
        return observedEvent(row.ts || row.time || row.timestamp || envelope.observedAt, row.data, 'logs', mergedEnvelope);
    }
    if (row.message === EVENT_MESSAGE && row.data) {
        return observedEvent(row.ts || row.time || row.timestamp || envelope.observedAt, row.data, 'logs', mergedEnvelope);
    }
    if (row.msg === EVENT_MESSAGE && row.event) {
        return observedEvent(row.ts || row.time || row.timestamp || envelope.observedAt, row.event, 'logs', mergedEnvelope);
    }
    if (typeof row.message === 'string') {
        const nested = parseJsonLine(row.message.trim());
        if (nested && nested !== row) {
            return eventFromStructuredLog(nested, {
                ...mergedEnvelope,
                observedAt: row.timestamp || row.ts || row.time || envelope.observedAt || null
            });
        }
    }
    return null;
}

function normalizeHttpPath(value) {
    const pathValue = String(value || '').trim().split('?')[0];
    return Object.values(AI_HTTP_ROUTES).includes(pathValue) ? pathValue : '';
}

function httpRequestFromStructuredLog(row = {}, envelope = {}) {
    if (!row || typeof row !== 'object') return null;
    const pathValue = normalizeHttpPath(row.path || row.requestPath || row.url);
    if (!pathValue) return null;
    const method = String(row.method || '').trim().toUpperCase();
    if (method !== 'POST') return null;
    const status = Number(row.httpStatus ?? row.status ?? row.statusCode);
    return {
        observedAt: safeDate(row.timestamp || row.ts || row.time || envelope.observedAt)?.toISOString() || null,
        source: 'http',
        requestId: String(row.requestId || row.reqId || envelope.requestId || '').trim().slice(0, 120),
        deploymentId: String(row.deploymentId || envelope.deploymentId || '').trim().slice(0, 80),
        method,
        path: pathValue,
        status: Number.isFinite(status) ? status : null
    };
}

function parseRolloutLogText(text = '', defaults = {}) {
    const telemetryEvents = [];
    const httpRequests = [];
    let nonEmptyLines = 0;
    let recognizedLines = 0;
    for (const line of String(text || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        nonEmptyLines += 1;
        const asJson = parseJsonLine(trimmed);
        if (Array.isArray(asJson)) {
            for (const item of asJson) {
                const httpRequest = httpRequestFromStructuredLog(item, defaults);
                const event = eventFromStructuredLog(item, defaults);
                if (httpRequest) httpRequests.push(httpRequest);
                if (event) telemetryEvents.push(event);
                if (httpRequest || event) recognizedLines += 1;
            }
            continue;
        }
        const httpRequest = httpRequestFromStructuredLog(asJson, defaults);
        const structured = eventFromStructuredLog(asJson, defaults);
        if (httpRequest) httpRequests.push(httpRequest);
        if (structured) {
            telemetryEvents.push(structured);
        }
        if (httpRequest || structured) {
            recognizedLines += 1;
            continue;
        }
        const pretty = parsePrettyLine(trimmed);
        if (pretty) {
            telemetryEvents.push(observedEvent(null, pretty, 'logs', defaults));
            recognizedLines += 1;
        }
    }
    return { telemetryEvents, httpRequests, nonEmptyLines, recognizedLines };
}

function parseTelemetryLogText(text = '', defaults = {}) {
    return parseRolloutLogText(text, defaults).telemetryEvents;
}

function assertRecognizedInput(input = {}, label = 'Input') {
    if (Number(input.nonEmptyLines || 0) > 0 && Number(input.recognizedLines || 0) === 0) {
        throw new Error(`${label} contained data but no recognized Task AI telemetry or HTTP request records. Refusing a false zero report.`);
    }
    return input;
}

function loadRolloutLogInput(filePath, defaults = {}) {
    if (!filePath) return { telemetryEvents: [], httpRequests: [], nonEmptyLines: 0, recognizedLines: 0 };
    const resolved = path.resolve(filePath);
    const text = fs.readFileSync(resolved, 'utf8');
    return parseRolloutLogText(text, defaults);
}

function loadRolloutLogInputFromStdin(defaults = {}) {
    const text = fs.readFileSync(0, 'utf8');
    return parseRolloutLogText(text, defaults);
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

function evidenceScope(options = {}) {
    if (options.scope) return options.scope;
    return String(options.stage || '').toLowerCase().startsWith('bundle') ? 'bundle' : 'single';
}

function eventMatchesExactMetadata(item = {}, options = {}) {
    const event = item.event || {};
    const exactPairs = [
        ['releaseVersion', options.version],
        ['releaseSha', options.sha],
        ['deploymentId', options.deploymentId],
        ['promptVersion', options.promptVersion],
        ['schemaName', options.schemaName],
        ['contractVersion', options.contractVersion]
    ];
    for (const [field, expectedRaw] of exactPairs) {
        const expected = String(expectedRaw || '').trim();
        const actual = String(event[field] || '').trim();
        if (expected && actual && actual !== expected) return false;
    }
    const observedAt = safeDate(item.observedAt);
    const start = safeDate(options.deploymentStart);
    const end = safeDate(options.deploymentEnd);
    if (start && (!observedAt || observedAt < start)) return false;
    if (end && (!observedAt || observedAt >= end)) return false;
    if (options.deploymentId && !event.deploymentId && !event.releaseSha && !start) return false;
    if (options.sha && !event.releaseSha && !event.deploymentId && !start) return false;
    return true;
}

function previewBelongsToScope(event = {}, scope = 'single') {
    if (event.type !== 'preview') return true;
    const decision = String(event.mode || event.reasonCode || '').trim();
    if (scope === 'bundle') return decision === 'task_bundle';
    return decision !== 'task_bundle';
}

function filterObservedEvents(observedEvents = [], options = {}) {
    const scope = evidenceScope(options);
    return observedEvents.filter(item => {
        if (!eventMatchesExactMetadata(item, options)) return false;
        const event = item.event || {};
        if (scope === 'bundle') {
            if (event.type === 'commit') return false;
            return previewBelongsToScope(event, scope);
        }
        if (event.type === 'bundle_commit') return false;
        return previewBelongsToScope(event, scope);
    });
}

function deduplicateObservedEvents(observedEvents = []) {
    const seen = new Set();
    const result = [];
    for (const item of observedEvents) {
        const event = item.event || {};
        const requestId = String(event.requestId || '').trim();
        const key = requestId
            ? `${requestId}:${event.type}:${event.status}:${event.outcome}`
            : '';
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        result.push(item);
    }
    return result;
}

function filterHttpRequests(httpRequests = [], options = {}) {
    const scope = evidenceScope(options);
    const start = safeDate(options.deploymentStart);
    const end = safeDate(options.deploymentEnd);
    const allowedPaths = scope === 'bundle'
        ? new Set([AI_HTTP_ROUTES.preview, AI_HTTP_ROUTES.bundleCommit])
        : new Set([AI_HTTP_ROUTES.preview, AI_HTTP_ROUTES.commit]);
    return httpRequests.filter(request => {
        if (!allowedPaths.has(request.path)) return false;
        if (options.deploymentId && request.deploymentId && request.deploymentId !== options.deploymentId) return false;
        const observedAt = safeDate(request.observedAt);
        if (start && (!observedAt || observedAt < start)) return false;
        if (end && (!observedAt || observedAt >= end)) return false;
        return true;
    });
}

function actionablePreviewSuccess(event = {}) {
    return event.type === 'preview'
        && event.status === 'success'
        && event.outcome === 'success'
        && ACTIONABLE_PREVIEW_DECISIONS.has(String(event.reasonCode || event.mode || '').trim())
        && !event.fallbackReason
        && !event.impactFilterReason
        && Number(event.filteredImpactCount || 0) === 0;
}

function summarizeRolloutTelemetry(observedEvents = []) {
    const events = observedEvents.map(item => sanitizeTelemetryEvent(item.event));
    const aggregate = aggregateTaskAiDraftTelemetry(events);
    const latencyFor = type => events
        .filter(event => event.type === type)
        .map(event => event.latencyMs)
        .filter(value => Number.isFinite(value) && value > 0);
    const previewLatencies = latencyFor('preview');
    const commitLatencies = latencyFor('commit');
    const bundleCommitLatencies = latencyFor('bundle_commit');
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
        successfulProposals: events.filter(actionablePreviewSuccess).length,
        providerFailures: events.filter(event => event.type === 'preview' && FAILURE_STATUSES.has(event.status)).length,
        fallbackProposalCount: Number(aggregate.byOutcome?.fallback_proposal || 0),
        validationFilteredCount: Number(aggregate.byOutcome?.validation_filtered || 0),
        byReasonCode,
        latencyMs: {
            providerPreview: {
                p50: percentile(previewLatencies, 0.5),
                p95: percentile(previewLatencies, 0.95),
                max: previewLatencies.length ? Math.max(...previewLatencies) : null
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

function databaseWindow(options = {}) {
    const start = safeDate(options.deploymentStart);
    const end = safeDate(options.deploymentEnd);
    if (start) {
        const params = [start.toISOString()];
        let clause = 'h.created_at >= $1::timestamptz';
        if (end) {
            params.push(end.toISOString());
            clause += ' AND h.created_at < $2::timestamptz';
        }
        return { clause, bundleClause: clause.replaceAll('h.created_at', 'b.created_at'), params };
    }
    return {
        clause: `h.created_at >= NOW() - ($1::int * INTERVAL '1 hour')`,
        bundleClause: `b.created_at >= NOW() - ($1::int * INTERVAL '1 hour')`,
        params: [Number(options.hours || DEFAULTS.hours)]
    };
}

async function collectDatabaseEvidence(options = {}, env = process.env) {
    const pool = options.pool || poolFromEnv(env);
    const ownsPool = !options.pool;
    const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
    const releaseClient = typeof client.release === 'function' ? () => client.release() : null;
    let transactionOpen = false;
    const timeWindow = databaseWindow(options);
    const params = [...timeWindow.params];
    let businessSql = '';
    if (options.businessContext) {
        params.push(String(options.businessContext));
        businessSql = ` AND COALESCE(t.business_context, 'event_genix') = $${params.length}`;
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
               AND ${timeWindow.clause}
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
                schemaName: meta.schemaName || meta.schema_name || '',
                reasoningEffort: meta.reasoningEffort || meta.reasoning_effort || '',
                releaseVersion: meta.releaseVersion || meta.release_version || '',
                releaseSha: meta.releaseSha || meta.release_sha || '',
                deploymentId: meta.deploymentId || meta.deployment_id || '',
                requestId: meta.requestId || meta.request_id || '',
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
                  AND ${timeWindow.clause}
                  AND COALESCE(h.meta_json->>'idempotencyKey', '') <> ''
                  ${businessSql}
                GROUP BY h.actor_user_id, h.meta_json->>'idempotencyKey'
                HAVING COUNT(*) > 1
            ) duplicates`, params);
        const duplicateBundles = await queryOne(client, `
            SELECT COUNT(*)::int AS count
            FROM (
                SELECT h.actor_user_id,
                       COALESCE(h.meta_json->>'bundleId', h.meta_json->>'idempotencyKey') AS bundle_key,
                       COUNT(*)::int AS event_count
                FROM task_action_history h
                JOIN tasks t ON t.id = h.task_id
                WHERE h.action_type = 'task_ai_draft_bundle_committed'
                  AND ${timeWindow.clause}
                  AND COALESCE(h.meta_json->>'bundleId', h.meta_json->>'idempotencyKey', '') <> ''
                  ${businessSql}
                GROUP BY h.actor_user_id, COALESCE(h.meta_json->>'bundleId', h.meta_json->>'idempotencyKey')
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
              AND ${timeWindow.clause}
              AND COALESCE((h.new_value_json->>'impactCount')::int, 0) <> COALESCE(actual.impact_count, 0)
              ${businessSql}`, params);
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
              AND ${timeWindow.clause}
              AND COALESCE((h.new_value_json->>'subtaskCount')::int, 0) <> COALESCE(actual.subtask_count, 0)
              ${businessSql}`, params);
        const partialBundles = await queryOne(client, `
            SELECT COUNT(*)::int AS count
            FROM task_bundles b
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS member_count
                FROM task_bundle_tasks bt
                JOIN tasks t ON t.id = bt.task_id
                WHERE bt.bundle_id = b.id
            ) members ON true
            WHERE ${timeWindow.bundleClause}
              AND COALESCE(members.member_count, 0) <> b.task_count
              ${options.businessContext ? `AND b.business_context = $${timeWindow.params.length + 1}` : ''}`,
            options.businessContext ? [...timeWindow.params, String(options.businessContext)] : [...timeWindow.params]
        );
        const scheduleFailures = await queryOne(client, `
            SELECT COUNT(*)::int AS count
            FROM task_action_history h
            JOIN tasks t ON t.id = h.task_id
            WHERE h.action_type = 'task_ai_draft_committed'
              AND ${timeWindow.clause}
              AND COALESCE((h.new_value_json->>'scheduleWritten')::boolean, false) = true
              AND t.date IS NULL
              ${businessSql}`, params);
        const evidence = {
            available: true,
            events: historyEvents,
            checks: {
                duplicateCommits: Number(duplicateSingle.count || 0),
                duplicateBundleCommits: Number(duplicateBundles.count || 0),
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

function buildVerdict({ telemetry, telemetryCoverage = telemetry, window, http = {}, dbEvidence = {}, thresholds = {} }) {
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
        duplicateCommits: dbEvidence.available === true
            && Number(checks.duplicateCommits || 0) === 0
            && Number(checks.duplicateBundleCommits || 0) === 0,
        unknownImpactIds: Number(telemetry.byReasonCode?.TASK_AI_DRAFT_UNKNOWN_IMPACT || 0) === 0
            && Number(telemetry.byReasonCode?.TASK_AI_BUNDLE_UNKNOWN_IMPACT || 0) === 0,
        unacceptedFieldWrites: Number(telemetry.byReasonCode?.TASK_AI_BUNDLE_FIELD_NOT_ACCEPTED || 0) === 0,
        schedulePlacementFailures: dbEvidence.available === true && Number(checks.schedulePlacementFailures || 0) === 0
    };
    gates.enoughVolumeOrTimeEvidence = gates.enoughSuccessfulProposals || gates.enoughTimeEvidence;
    const httpPreviewCount = Number(http.byRoute?.[`POST ${AI_HTTP_ROUTES.preview}`] || 0);
    const telemetryGap = httpPreviewCount > 0 && Number(telemetryCoverage.previewAttempts || 0) === 0;
    const missingEvidence = [];
    if (!telemetry.previewAttempts) missingEvidence.push('structured telemetry logs with preview events');
    if (!window.hasTimestamps) missingEvidence.push('timestamped telemetry window');
    if (dbEvidence.available !== true) missingEvidence.push('read-only database evidence from TASK_AI_ROLLOUT_DATABASE_URL');
    if (!gates.enoughVolumeOrTimeEvidence) missingEvidence.push(`at least ${thresholds.minProposals} successful proposals or ${thresholds.hours}h of timestamped evidence`);
    if (telemetryGap) missingEvidence.push('HTTP AI requests exist but matching structured preview telemetry is missing');
    const passed = !telemetryGap
        && gates.enoughVolumeOrTimeEvidence
            && gates.providerErrorRate
            && gates.partialWrites
            && gates.duplicateCommits
            && gates.unknownImpactIds
            && gates.unacceptedFieldWrites
            && gates.schedulePlacementFailures;
    let reason = VERDICT_REASONS.PASS;
    if (!passed) {
        const safetyGateFailed = (dbEvidence.available === true && (
            Number(checks.partialImpactWrites || 0) > 0
            || Number(checks.partialSubtaskWrites || 0) > 0
            || Number(checks.partialBundleWrites || 0) > 0
            || Number(checks.duplicateCommits || 0) > 0
            || Number(checks.duplicateBundleCommits || 0) > 0
            || Number(checks.schedulePlacementFailures || 0) > 0
        )) || !gates.unknownImpactIds || !gates.unacceptedFieldWrites;
        if (telemetryGap) reason = VERDICT_REASONS.TELEMETRY_GAP;
        else if (safetyGateFailed) {
            reason = VERDICT_REASONS.SAFETY_GATE_FAILURE;
        } else if (telemetry.previewAttempts > 0 && !gates.providerErrorRate) {
            reason = VERDICT_REASONS.HOLD_PROVIDER_ERRORS;
        } else {
            reason = VERDICT_REASONS.HOLD_INSUFFICIENT_TRAFFIC;
        }
    }
    return {
        status: passed ? 'pass' : 'hold',
        reason,
        gates,
        thresholds,
        providerErrorRate,
        telemetryGap,
        missingEvidence
    };
}

function summarizeHttpRequests(httpRequests = []) {
    const byRoute = {};
    const byStatusClass = {};
    for (const request of httpRequests) {
        const route = `${request.method} ${request.path}`;
        byRoute[route] = (byRoute[route] || 0) + 1;
        const statusClass = Number.isFinite(request.status) ? `${Math.floor(request.status / 100)}xx` : 'unknown';
        byStatusClass[statusClass] = (byStatusClass[statusClass] || 0) + 1;
    }
    return { totalRequests: httpRequests.length, byRoute, byStatusClass };
}

function buildReport({ logEvents = [], httpRequests = [], dbEvidence = {}, options = {} }) {
    const dbEvents = Array.isArray(dbEvidence.events) ? dbEvidence.events : [];
    const filteredLogEvents = filterObservedEvents(logEvents, options);
    const filteredDbEvents = filterObservedEvents(dbEvents, options);
    const coverageEvents = deduplicateObservedEvents(
        [...logEvents, ...dbEvents].filter(item => eventMatchesExactMetadata(item, options))
    );
    const events = deduplicateObservedEvents([...filteredLogEvents, ...filteredDbEvents]);
    const filteredHttpRequests = filterHttpRequests(httpRequests, options);
    const http = summarizeHttpRequests(filteredHttpRequests);
    const telemetry = summarizeRolloutTelemetry(events);
    const telemetryCoverage = summarizeRolloutTelemetry(coverageEvents);
    const previewEvents = events.filter(item => item.event?.type === 'preview');
    const window = eventWindow(previewEvents);
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
            scope: evidenceScope(options),
            deploymentId: String(options.deploymentId || '').trim() || null,
            deploymentStart: safeDate(options.deploymentStart)?.toISOString() || null,
            deploymentEnd: safeDate(options.deploymentEnd)?.toISOString() || null,
            promptVersion: String(options.promptVersion || '').trim() || null,
            schemaName: String(options.schemaName || '').trim() || null,
            contractVersion: String(options.contractVersion || '').trim() || null
        },
        sources: {
            http: {
                available: options.httpEvidenceAvailable === true || httpRequests.length > 0,
                requests: filteredHttpRequests.length
            },
            logs: {
                available: logEvents.length > 0,
                events: filteredLogEvents.length,
                structuredPreviewEventsAllScopes: telemetryCoverage.previewAttempts
            },
            database: { available: dbEvidence.available === true, events: filteredDbEvents.length }
        },
        http,
        window,
        telemetry,
        databaseChecks: dbEvidence.checks || null,
        verdict: buildVerdict({ telemetry, telemetryCoverage, window, http, dbEvidence, thresholds })
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
        `- verdict reason: \`${v.reason || VERDICT_REASONS.HOLD_INSUFFICIENT_TRAFFIC}\``,
        `- scope/deployment: \`${report.release?.scope || 'single'}\` / \`${report.release?.deploymentId || 'unknown'}\``,
        `- window: \`${report.window?.from || 'unknown'} → ${report.window?.to || 'unknown'}\` (${report.window?.spanHours || 0}h)`,
        `- matching HTTP requests: ${report.http?.totalRequests || 0}`,
        `- HTTP routes: ${JSON.stringify(report.http?.byRoute || {})}`,
        `- successful proposals: ${t.successfulProposals || 0}`,
        `- preview attempts: ${t.previewAttempts || 0}`,
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
        `- duplicate commits: single=${checks.duplicateCommits ?? 'n/a'}, bundle=${checks.duplicateBundleCommits ?? 'n/a'}`,
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

function safeOutputPath(customOutput, format, options = {}) {
    if (customOutput) return path.resolve(customOutput);
    const outputRoot = evidenceScope(options) === 'bundle' ? BUNDLE_OUTPUT_ROOT : OUTPUT_ROOT;
    fs.mkdirSync(outputRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(outputRoot, `${stamp}.${format === 'markdown' ? 'md' : 'json'}`);
}

function writeReportArtifact(report, options = {}) {
    const outputPath = safeOutputPath(options.output, options.format, options);
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
    const defaults = {
        deploymentId: options.deploymentId,
        releaseVersion: options.version,
        releaseSha: options.sha
    };
    const inputs = [
        loadRolloutLogInput(options.eventsFile, defaults),
        ...(options.stdin ? [loadRolloutLogInputFromStdin(defaults)] : [])
    ];
    const inputStats = inputs.reduce((summary, input) => {
        summary.telemetryEvents.push(...input.telemetryEvents);
        summary.httpRequests.push(...input.httpRequests);
        summary.nonEmptyLines += input.nonEmptyLines;
        summary.recognizedLines += input.recognizedLines;
        return summary;
    }, { telemetryEvents: [], httpRequests: [], nonEmptyLines: 0, recognizedLines: 0 });
    assertRecognizedInput(inputStats);
    const dbEvidence = options.useDatabase
        ? await collectDatabaseEvidence(options)
        : { available: false, events: [], checks: null };
    const report = buildReport({
        logEvents: inputStats.telemetryEvents,
        httpRequests: inputStats.httpRequests,
        dbEvidence,
        options: {
            ...options,
            httpEvidenceAvailable: options.stdin || Boolean(options.eventsFile)
        }
    });
    const artifactPath = writeReportArtifact(report, options);
    const output = {
        verdict: report.verdict.status,
        verdictReason: report.verdict.reason,
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
    ACTIONABLE_PREVIEW_DECISIONS,
    AI_HTTP_ROUTES,
    DEFAULTS,
    VERDICT_REASONS,
    assertRecognizedInput,
    buildReport,
    buildVerdict,
    collectDatabaseEvidence,
    parseArgs,
    parseRolloutLogText,
    parseTelemetryLogText,
    poolFromEnv,
    reportMarkdown,
    summarizeRolloutTelemetry,
    writeReportArtifact
};
