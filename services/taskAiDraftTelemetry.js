'use strict';

const { createLogger } = require('../utils/logger');

const log = createLogger('TaskAiDraftTelemetry');

const ALLOWED_EVENT_TYPES = Object.freeze(['preview', 'commit', 'bundle_commit', 'deprecation']);
const ALLOWED_STATUSES = Object.freeze([
    'attempt',
    'success',
    'replayed',
    'provider_unavailable',
    'provider_error',
    'timeout',
    'invalid_response',
    'rate_limited',
    'conflict',
    'rollback',
    'error'
]);
const ALLOWED_FALLBACK_REASONS = Object.freeze([
    'malformed_response',
    'provider_failure',
    'minimal_content',
    'invalid_impacts'
]);
const ALLOWED_OUTCOMES = Object.freeze([
    'success',
    'fallback_proposal',
    'provider_error',
    'validation_filtered',
    'validation_error',
    'commit_success',
    'replayed',
    'conflict',
    'rollback',
    'legacy_wrapper',
    'error'
]);
const SAFE_FIELD_MASK = Object.freeze(['title', 'description', 'mode', 'impactIds', 'subtasks', 'scheduleDate', 'priority', 'owner', 'visibility', 'workflow']);
const SAFE_TELEMETRY_INPUT_KEYS = new Set([
    'type',
    'status',
    'outcome',
    'latencyMs',
    'model',
    'provider',
    'contractVersion',
    'promptVersion',
    'schemaName',
    'reasoningEffort',
    'reasonCode',
    'fallbackReason',
    'impactFilterReason',
    'filteredImpactCount',
    'route',
    'mode',
    'clientVersion',
    'requestId',
    'canonicalTarget',
    'code',
    'userHash',
    'businessContext',
    'changedFields',
    'acceptedFieldMask',
    'rejectedFieldMask',
    'editedFieldMask',
    'taskCount',
    'acceptedTaskCount',
    'rejectedTaskCount',
    'editedTaskCount',
    'replay',
    'errorCategory',
    'usage'
]);
const SENSITIVE_KEY_PATTERN = /(title|description|prompt|response|text|body|draft|task|secret|token|key|authorization)/i;
const LEGACY_DECOMPOSE_ROUTE = '/api/tasks/decompose-draft';
const LEGACY_AI_DRAFT_QA_CLIENT_PATTERN = /(test|qa|smoke|playwright|actual-app|fixture|codex|local)/i;

function compactString(value, limit = 120) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function safeInteger(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeFieldMask(value) {
    const raw = Array.isArray(value) ? value : [];
    return [...new Set(raw.map(item => String(item || '').trim()).filter(field => SAFE_FIELD_MASK.includes(field)))];
}

function safeFallbackReason(value) {
    const reason = compactString(value, 80);
    return ALLOWED_FALLBACK_REASONS.includes(reason) ? reason : '';
}

function safeOutcome(value) {
    const outcome = compactString(value, 80);
    return ALLOWED_OUTCOMES.includes(outcome) ? outcome : '';
}

function derivedOutcome(source = {}, status = 'error', fallbackReason = '') {
    const explicit = safeOutcome(source.outcome);
    if (explicit) return explicit;
    if (status === 'replayed') return 'replayed';
    if (status === 'conflict') return 'conflict';
    if (status === 'rollback') return 'rollback';
    if (fallbackReason === 'provider_failure' || ['provider_unavailable', 'provider_error', 'timeout', 'rate_limited'].includes(status)) {
        return 'provider_error';
    }
    if (fallbackReason === 'malformed_response' || fallbackReason === 'minimal_content') return 'fallback_proposal';
    if (fallbackReason === 'invalid_impacts' || source.impactFilterReason === 'filter_known_active' || safeInteger(source.filteredImpactCount) > 0) {
        return 'validation_filtered';
    }
    if (status === 'invalid_response') return 'validation_error';
    if (status === 'success' && (source.type === 'commit' || source.type === 'bundle_commit')) return 'commit_success';
    if (source.type === 'deprecation' && source.reasonCode === 'legacy_decompose_wrapper_used') return 'legacy_wrapper';
    if (status === 'success') return 'success';
    return 'error';
}

function sanitizeUsage(usage = {}) {
    const source = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage : {};
    return {
        inputTokens: safeNumber(source.input_tokens ?? source.prompt_tokens),
        outputTokens: safeNumber(source.output_tokens ?? source.completion_tokens),
        totalTokens: safeNumber(source.total_tokens ?? source.totalTokens)
    };
}

function sanitizeTelemetryEvent(event = {}) {
    const source = event && typeof event === 'object' && !Array.isArray(event) ? event : {};
    const type = ALLOWED_EVENT_TYPES.includes(source.type) ? source.type : 'unknown';
    const status = ALLOWED_STATUSES.includes(source.status) ? source.status : 'error';
    const fallbackReason = safeFallbackReason(source.fallbackReason);
    return {
        type,
        status,
        outcome: derivedOutcome(source, status, fallbackReason),
        latencyMs: safeInteger(source.latencyMs),
        model: compactString(source.model, 80),
        provider: compactString(source.provider || 'openai', 40),
        contractVersion: compactString(source.contractVersion, 80),
        promptVersion: compactString(source.promptVersion, 80),
        schemaName: compactString(source.schemaName, 80),
        reasoningEffort: compactString(source.reasoningEffort || '', 40),
        reasonCode: compactString(source.reasonCode || source.code || '', 80),
        fallbackReason,
        impactFilterReason: compactString(source.impactFilterReason || '', 80) === 'filter_known_active' ? 'filter_known_active' : '',
        filteredImpactCount: safeInteger(source.filteredImpactCount),
        route: compactString(source.route || '', 120),
        mode: compactString(source.mode || '', 40),
        clientVersion: compactString(source.clientVersion || '', 80),
        requestId: compactString(source.requestId || '', 120),
        canonicalTarget: compactString(source.canonicalTarget || '', 120),
        userHash: compactString(source.userHash || '', 80),
        businessContext: compactString(source.businessContext || '', 80),
        changedFields: safeFieldMask(source.changedFields),
        acceptedFieldMask: safeFieldMask(source.acceptedFieldMask),
        rejectedFieldMask: safeFieldMask(source.rejectedFieldMask),
        editedFieldMask: safeFieldMask(source.editedFieldMask),
        taskCount: safeInteger(source.taskCount),
        acceptedTaskCount: safeInteger(source.acceptedTaskCount),
        rejectedTaskCount: safeInteger(source.rejectedTaskCount),
        editedTaskCount: safeInteger(source.editedTaskCount),
        replay: source.replay === true || source.replayed === true,
        errorCategory: compactString(source.errorCategory || '', 80),
        usage: sanitizeUsage(source.usage)
    };
}

function isKnownLegacyAiDraftQaClient(event = {}) {
    const safe = sanitizeTelemetryEvent(event);
    const source = `${safe.clientVersion} ${safe.requestId}`.trim();
    return Boolean(source && LEGACY_AI_DRAFT_QA_CLIENT_PATTERN.test(source));
}

function aggregateLegacyAiDraftDeprecationUsage(events = []) {
    const rows = Array.isArray(events) ? events : [];
    const summary = {
        totalEvents: 0,
        attempts: 0,
        used: 0,
        nonApply: 0,
        qaEvents: 0,
        realUsageEvents: 0,
        realUsageRequests: 0,
        byClientVersion: {},
        byReasonCode: {}
    };
    const realRequestKeys = new Set();
    for (const event of rows) {
        const safe = sanitizeTelemetryEvent(event);
        if (safe.type !== 'deprecation' || safe.route !== LEGACY_DECOMPOSE_ROUTE) continue;
        summary.totalEvents += 1;
        summary.byReasonCode[safe.reasonCode] = (summary.byReasonCode[safe.reasonCode] || 0) + 1;
        const clientKey = safe.clientVersion || 'unknown';
        summary.byClientVersion[clientKey] = (summary.byClientVersion[clientKey] || 0) + 1;
        if (safe.reasonCode === 'legacy_decompose_wrapper_attempt') summary.attempts += 1;
        if (safe.reasonCode === 'legacy_decompose_wrapper_used') summary.used += 1;
        if (safe.reasonCode === 'legacy_decompose_wrapper_non_apply') summary.nonApply += 1;
        if (isKnownLegacyAiDraftQaClient(safe)) {
            summary.qaEvents += 1;
            continue;
        }
        summary.realUsageEvents += 1;
        realRequestKeys.add(safe.requestId || `${clientKey}:${safe.reasonCode}:${summary.totalEvents}`);
    }
    summary.realUsageRequests = realRequestKeys.size;
    return summary;
}

function assertNoSensitiveTelemetryFields(event = {}) {
    const forbidden = [];
    function visitUnknown(value, path = '') {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            value.forEach((item, index) => visitUnknown(item, `${path}[${index}]`));
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            const nextPath = path ? `${path}.${key}` : key;
            if (!path && SAFE_TELEMETRY_INPUT_KEYS.has(key)) continue;
            if (SENSITIVE_KEY_PATTERN.test(key)) forbidden.push(nextPath);
            visitUnknown(child, nextPath);
        }
    }
    visitUnknown(event || {});
    if (forbidden.length) {
        const error = new Error('Task AI telemetry event contains sensitive fields.');
        error.code = 'TASK_AI_TELEMETRY_SENSITIVE_FIELD';
        error.fields = forbidden;
        throw error;
    }
}

function recordTaskAiDraftTelemetry(event = {}, options = {}) {
    assertNoSensitiveTelemetryFields(event);
    const safe = sanitizeTelemetryEvent(event);
    const logger = options.logger || log;
    if (typeof logger.info === 'function') {
        logger.info('task_ai_draft_event', safe);
    }
    return safe;
}

function aggregateTaskAiDraftTelemetry(events = []) {
    const rows = Array.isArray(events) ? events : [];
    return rows.reduce((summary, event) => {
        const safe = sanitizeTelemetryEvent(event);
        const key = `${safe.type}:${safe.status}`;
        const outcomeKey = `${safe.type}:${safe.outcome}`;
        summary.total += 1;
        summary.byType[safe.type] = (summary.byType[safe.type] || 0) + 1;
        summary.byStatus[safe.status] = (summary.byStatus[safe.status] || 0) + 1;
        summary.byOutcome[safe.outcome] = (summary.byOutcome[safe.outcome] || 0) + 1;
        summary.byTypeStatus[key] = (summary.byTypeStatus[key] || 0) + 1;
        summary.byTypeOutcome[outcomeKey] = (summary.byTypeOutcome[outcomeKey] || 0) + 1;
        summary.taskCount += safe.taskCount;
        summary.acceptedTaskCount += safe.acceptedTaskCount;
        summary.rejectedTaskCount += safe.rejectedTaskCount;
        summary.editedTaskCount += safe.editedTaskCount;
        if (safe.replay) summary.replayed += 1;
        if (safe.fallbackReason) {
            summary.fallbackCount += 1;
            summary.byFallbackReason[safe.fallbackReason] = (summary.byFallbackReason[safe.fallbackReason] || 0) + 1;
        }
        if (safe.impactFilterReason || safe.filteredImpactCount) {
            summary.filteredImpactCount += safe.filteredImpactCount;
        }
        return summary;
    }, {
        total: 0,
        byType: {},
        byStatus: {},
        byOutcome: {},
        byTypeStatus: {},
        byTypeOutcome: {},
        taskCount: 0,
        acceptedTaskCount: 0,
        rejectedTaskCount: 0,
        editedTaskCount: 0,
        replayed: 0,
        fallbackCount: 0,
        filteredImpactCount: 0,
        byFallbackReason: {}
    });
}

module.exports = {
    ALLOWED_FALLBACK_REASONS,
    ALLOWED_OUTCOMES,
    SAFE_FIELD_MASK,
    aggregateTaskAiDraftTelemetry,
    aggregateLegacyAiDraftDeprecationUsage,
    assertNoSensitiveTelemetryFields,
    isKnownLegacyAiDraftQaClient,
    recordTaskAiDraftTelemetry,
    sanitizeTelemetryEvent
};
