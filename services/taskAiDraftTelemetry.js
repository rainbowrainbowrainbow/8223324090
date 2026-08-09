'use strict';

const { createLogger } = require('../utils/logger');

const log = createLogger('TaskAiDraftTelemetry');

const ALLOWED_EVENT_TYPES = Object.freeze(['preview', 'commit']);
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
const SAFE_FIELD_MASK = Object.freeze(['title', 'description', 'mode', 'impactIds', 'subtasks', 'schedule']);
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
    const type = ALLOWED_EVENT_TYPES.includes(source.type) ? source.type : 'preview';
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

module.exports = {
    SAFE_FIELD_MASK,
    assertNoSensitiveTelemetryFields,
    recordTaskAiDraftTelemetry,
    sanitizeTelemetryEvent
};
