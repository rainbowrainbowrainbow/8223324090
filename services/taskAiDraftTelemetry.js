'use strict';

const { createLogger } = require('../utils/logger');

const log = createLogger('TaskAiDraftTelemetry');

const ALLOWED_EVENT_TYPES = Object.freeze(['preview', 'commit', 'bundle_commit']);
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
const SAFE_FIELD_MASK = Object.freeze(['title', 'description', 'mode', 'impactIds', 'subtasks', 'scheduleDate', 'priority', 'owner', 'visibility', 'workflow']);
const SAFE_TELEMETRY_INPUT_KEYS = new Set([
    'type',
    'status',
    'latencyMs',
    'model',
    'provider',
    'contractVersion',
    'promptVersion',
    'schemaName',
    'reasonCode',
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
    return {
        type,
        status,
        latencyMs: safeInteger(source.latencyMs),
        model: compactString(source.model, 80),
        provider: compactString(source.provider || 'openai', 40),
        contractVersion: compactString(source.contractVersion, 80),
        promptVersion: compactString(source.promptVersion, 80),
        schemaName: compactString(source.schemaName, 80),
        reasonCode: compactString(source.reasonCode || source.code || '', 80),
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

function assertNoSensitiveTelemetryFields(event = {}) {
    const forbidden = Object.keys(event || {}).filter(key => !SAFE_TELEMETRY_INPUT_KEYS.has(key) && SENSITIVE_KEY_PATTERN.test(key));
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
        summary.total += 1;
        summary.byType[safe.type] = (summary.byType[safe.type] || 0) + 1;
        summary.byStatus[safe.status] = (summary.byStatus[safe.status] || 0) + 1;
        summary.byTypeStatus[key] = (summary.byTypeStatus[key] || 0) + 1;
        summary.taskCount += safe.taskCount;
        summary.acceptedTaskCount += safe.acceptedTaskCount;
        summary.rejectedTaskCount += safe.rejectedTaskCount;
        summary.editedTaskCount += safe.editedTaskCount;
        if (safe.replay) summary.replayed += 1;
        return summary;
    }, {
        total: 0,
        byType: {},
        byStatus: {},
        byTypeStatus: {},
        taskCount: 0,
        acceptedTaskCount: 0,
        rejectedTaskCount: 0,
        editedTaskCount: 0,
        replayed: 0
    });
}

module.exports = {
    SAFE_FIELD_MASK,
    aggregateTaskAiDraftTelemetry,
    assertNoSensitiveTelemetryFields,
    recordTaskAiDraftTelemetry,
    sanitizeTelemetryEvent
};
