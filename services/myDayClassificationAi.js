'use strict';

const {
    MAX_IMPACTS_PER_TASK,
    normalizeImpactIds,
    myDayError
} = require('./myDayTaxonomy');

const DEFAULT_MY_DAY_CLASSIFICATION_MODEL = 'gpt-5.6-luna';
const ALLOWED_MY_DAY_CLASSIFICATION_MODELS = Object.freeze([
    DEFAULT_MY_DAY_CLASSIFICATION_MODEL
]);
const MIN_CLASSIFICATION_CONFIDENCE = 0.55;
const MAX_TASK_TITLE_CHARS = 180;
const MAX_TASK_DESCRIPTION_CHARS = 700;
const MAX_IMPACT_NAME_CHARS = 80;
const MAX_ACTIVE_IMPACTS_FOR_PROMPT = 80;
const MAX_CLASSIFICATION_REASON_CHARS = 180;
const MY_DAY_CLASSIFICATION_TIMEOUT_MS = 10_000;
const MY_DAY_CLASSIFICATION_MAX_OUTPUT_TOKENS = 220;
const OPENAI_RESPONSES_SCHEMA_NAME = 'my_day_task_classification';

const MY_DAY_CLASSIFICATION_JSON_SCHEMA = Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['impactIds', 'confidence', 'reason'],
    properties: {
        impactIds: {
            type: 'array',
            maxItems: MAX_IMPACTS_PER_TASK,
            uniqueItems: true,
            items: { type: 'integer' }
        },
        confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1
        },
        reason: {
            type: 'string',
            minLength: 1,
            maxLength: MAX_CLASSIFICATION_REASON_CHARS
        }
    }
});

function compactString(value, limit) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function resolveMyDayClassificationModel(env = process.env) {
    const requested = String(env.MY_DAY_CLASSIFICATION_MODEL || '').trim();
    const model = requested || DEFAULT_MY_DAY_CLASSIFICATION_MODEL;
    if (!ALLOWED_MY_DAY_CLASSIFICATION_MODELS.includes(model)) {
        throw myDayError('Unsupported My Day classification model.', 503, 'MY_DAY_AI_MODEL_NOT_ALLOWED');
    }
    return model;
}

function getOpenAIApiBase(env = process.env) {
    return String(env.OPENAI_API_BASE || env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function getOpenAIKey(env = process.env) {
    return String(env.OPENAI_API_KEY || '').trim();
}

function resolveMyDayClassificationTimeoutMs(env = process.env) {
    const parsed = Number.parseInt(env.MY_DAY_CLASSIFICATION_TIMEOUT_MS || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return MY_DAY_CLASSIFICATION_TIMEOUT_MS;
    return Math.max(100, Math.min(30_000, parsed));
}

function taskSnapshot(task = {}) {
    return {
        id: Number(task.id || task.task_id || task.taskId || 0),
        title: compactString(task.title, MAX_TASK_TITLE_CHARS),
        description: compactString(task.description, MAX_TASK_DESCRIPTION_CHARS),
        status: String(task.status || '').trim(),
        priority: String(task.priority || '').trim(),
        deadline: String(task.deadline || task.date || task.scheduled_start_at || task.scheduledStartAt || '').trim(),
        ownerUserId: task.owner_user_id || task.ownerUserId || null,
        assignedTo: task.assigned_to || task.assignedTo || null,
        updatedAt: task.updated_at || task.updatedAt || null
    };
}

function taskFingerprint(task = {}) {
    return JSON.stringify(taskSnapshot(task));
}

function activeImpactPayload(impacts = []) {
    return (Array.isArray(impacts) ? impacts : [])
        .filter(impact => impact && impact.isActive !== false)
        .map(impact => ({
            id: Number(impact.id),
            name: compactString(impact.name, MAX_IMPACT_NAME_CHARS),
            icon: compactString(impact.icon, 16)
        }))
        .filter(impact => Number.isInteger(impact.id) && impact.id > 0 && impact.name)
        .slice(0, MAX_ACTIVE_IMPACTS_FOR_PROMPT);
}

function buildSystemPrompt() {
    return [
        'You classify one personal My Day task for Event Genix CRM.',
        'Return exactly one JSON object that satisfies the provided schema.',
        'Do not classify task directions, status, priority, deadline, owner, or dependencies.',
        `Choose 1-${MAX_IMPACTS_PER_TASK} impactIds only from the provided activeImpacts list.`,
        'Never create new impact IDs or rename impacts.',
        'If the task is too unclear or no provided impact fits, return an empty impactIds array and confidence below 0.55.',
        'The reason must be short and must not include private data beyond the task summary.'
    ].join('\n');
}

function buildUserMessage({ task, impacts }) {
    const safeTask = taskSnapshot(task);
    return JSON.stringify({
        task: {
            title: safeTask.title,
            description: safeTask.description
        },
        activeImpacts: activeImpactPayload(impacts)
    });
}

function buildOpenAIResponsesInput({ task, impacts }) {
    return [
        {
            role: 'system',
            content: [{ type: 'input_text', text: buildSystemPrompt() }]
        },
        {
            role: 'user',
            content: [{ type: 'input_text', text: buildUserMessage({ task, impacts }) }]
        }
    ];
}

function stripJsonFence(text = '') {
    return String(text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function parseAiJson(text = '') {
    if (text && typeof text === 'object' && !Array.isArray(text)) return text;
    const cleaned = stripJsonFence(text);
    if (!cleaned) throw myDayError('AI did not return JSON.', 422, 'MY_DAY_AI_INVALID_JSON');
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        throw myDayError('AI returned invalid JSON.', 422, 'MY_DAY_AI_INVALID_JSON');
    }
}

function extractOpenAIResponseText(payload = {}) {
    if (typeof payload.output_text === 'string') return payload.output_text;
    const chunks = [];
    for (const output of Array.isArray(payload.output) ? payload.output : []) {
        for (const content of Array.isArray(output?.content) ? output.content : []) {
            if (typeof content?.text === 'string') chunks.push(content.text);
            if (typeof content?.text?.value === 'string') chunks.push(content.text.value);
            if (typeof content?.output_text === 'string') chunks.push(content.output_text);
        }
    }
    return chunks.join('\n').trim();
}

function extractOpenAIResponseObject(payload = {}) {
    if (payload && typeof payload.output_parsed === 'object' && !Array.isArray(payload.output_parsed)) {
        return payload.output_parsed;
    }
    for (const output of Array.isArray(payload.output) ? payload.output : []) {
        for (const content of Array.isArray(output?.content) ? output.content : []) {
            if (content?.parsed && typeof content.parsed === 'object' && !Array.isArray(content.parsed)) {
                return content.parsed;
            }
        }
    }
    return parseAiJson(extractOpenAIResponseText(payload));
}

async function callOpenAIResponsesForClassification(request = {}, options = {}) {
    const env = request.env || options.env || process.env;
    const apiKey = getOpenAIKey(env);
    const model = request.model || resolveMyDayClassificationModel(env);
    if (!apiKey) {
        return {
            ok: false,
            provider: 'openai',
            model,
            reason: 'missing_key',
            statusCode: 503
        };
    }

    const fetchImpl = options.fetchImpl || request.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        return {
            ok: false,
            provider: 'openai',
            model,
            reason: 'fetch_unavailable',
            statusCode: 503
        };
    }

    const controller = new AbortController();
    const timeoutMs = Number(request.timeoutMs || options.timeoutMs || resolveMyDayClassificationTimeoutMs(env));
    const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : MY_DAY_CLASSIFICATION_TIMEOUT_MS);
    try {
        const response = await fetchImpl(`${getOpenAIApiBase(env)}/responses`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                input: request.input,
                text: {
                    format: {
                        type: 'json_schema',
                        name: OPENAI_RESPONSES_SCHEMA_NAME,
                        strict: true,
                        schema: MY_DAY_CLASSIFICATION_JSON_SCHEMA
                    }
                },
                reasoning: { effort: 'none' },
                max_output_tokens: MY_DAY_CLASSIFICATION_MAX_OUTPUT_TOKENS,
                store: false
            }),
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                ok: false,
                provider: 'openai',
                model,
                reason: response.status === 401 || response.status === 403 ? 'auth_failed' : 'provider_error',
                statusCode: response.status >= 500 ? 503 : response.status
            };
        }
        return {
            ok: true,
            provider: 'openai',
            model,
            payload,
            text: extractOpenAIResponseText(payload),
            usage: payload.usage || {}
        };
    } catch (error) {
        return {
            ok: false,
            provider: 'openai',
            model,
            reason: error?.name === 'AbortError' ? 'timeout' : 'network_error',
            statusCode: error?.name === 'AbortError' ? 504 : 503
        };
    } finally {
        clearTimeout(timeout);
    }
}

function assertStrictClassificationKeys(payload = {}) {
    const allowed = new Set(['impactIds', 'confidence', 'reason']);
    const extra = Object.keys(payload).filter(key => !allowed.has(key));
    if (extra.length) {
        throw myDayError('AI response contains unsupported fields.', 422, 'MY_DAY_AI_INVALID_RESPONSE');
    }
}

function normalizeAiClassification(raw, impacts = []) {
    const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    assertStrictClassificationKeys(payload);
    if (!Array.isArray(payload.impactIds)) {
        throw myDayError('AI response is missing impactIds.', 422, 'MY_DAY_AI_INVALID_RESPONSE');
    }
    const impactIds = normalizeImpactIds(payload.impactIds);
    const allowedImpactIds = new Set(activeImpactPayload(impacts).map(impact => impact.id));
    const unknownIds = impactIds.filter(id => !allowedImpactIds.has(id));
    if (unknownIds.length) {
        throw myDayError('AI proposed an unavailable impact.', 422, 'MY_DAY_AI_UNKNOWN_IMPACT');
    }

    const confidence = Number(payload.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw myDayError('AI response has invalid confidence.', 422, 'MY_DAY_AI_INVALID_RESPONSE');
    }

    const reason = String(payload.reason || '').trim();
    if (!reason || reason.length > MAX_CLASSIFICATION_REASON_CHARS) {
        throw myDayError('AI response has invalid reason.', 422, 'MY_DAY_AI_INVALID_RESPONSE');
    }

    return { impactIds, confidence, reason };
}

function myDayClassificationDiagnostics(env = process.env) {
    let model = DEFAULT_MY_DAY_CLASSIFICATION_MODEL;
    let modelAllowed = true;
    try {
        model = resolveMyDayClassificationModel(env);
    } catch {
        model = String(env.MY_DAY_CLASSIFICATION_MODEL || '').trim() || DEFAULT_MY_DAY_CLASSIFICATION_MODEL;
        modelAllowed = false;
    }
    const configured = Boolean(getOpenAIKey(env)) && modelAllowed;
    return {
        id: 'my_day_classification',
        provider: 'openai',
        status: configured ? 'ready' : (modelAllowed ? 'missing_key' : 'model_not_allowed'),
        configured,
        model,
        keyEnv: 'OPENAI_API_KEY',
        boundary: 'my_day_direct_openai_responses',
        structuredOutputs: true,
        store: false
    };
}

async function classifyMyDayTask(input = {}, options = {}) {
    const env = options.env || process.env;
    let model;
    try {
        model = resolveMyDayClassificationModel(env);
    } catch (error) {
        return {
            ok: false,
            code: error.code || 'MY_DAY_AI_MODEL_NOT_ALLOWED',
            statusCode: error.statusCode || 503,
            reason: 'model_not_allowed',
            provider: 'openai',
            model: String(env.MY_DAY_CLASSIFICATION_MODEL || '').trim() || DEFAULT_MY_DAY_CLASSIFICATION_MODEL
        };
    }

    const task = input.task || {};
    const impacts = activeImpactPayload(input.impacts || []);
    const aiClient = options.openAIClient || options.aiClient || callOpenAIResponsesForClassification;
    const result = await aiClient({
        model,
        input: buildOpenAIResponsesInput({ task, impacts }),
        env,
        timeoutMs: options.timeoutMs || resolveMyDayClassificationTimeoutMs(env)
    }, options);

    if (!result?.ok) {
        return {
            ok: false,
            code: result?.reason === 'missing_key' || result?.reason === 'auth_failed' || result?.reason === 'fetch_unavailable'
                ? 'MY_DAY_AI_PROVIDER_UNAVAILABLE'
                : (result?.reason === 'timeout' ? 'MY_DAY_AI_TIMEOUT' : 'MY_DAY_AI_PROVIDER_ERROR'),
            statusCode: result?.statusCode || 503,
            reason: result?.reason || 'provider_error',
            provider: 'openai',
            model: result?.model || model
        };
    }

    let normalized;
    try {
        normalized = normalizeAiClassification(
            result.payload ? extractOpenAIResponseObject(result.payload) : parseAiJson(result.text),
            impacts
        );
    } catch (error) {
        return {
            ok: false,
            code: error.code || 'MY_DAY_AI_INVALID_JSON',
            statusCode: error.statusCode || 422,
            reason: error.code || 'invalid_json',
            provider: 'openai',
            model: result.model || model
        };
    }

    if (!normalized.impactIds.length) {
        return {
            ok: false,
            code: 'MY_DAY_AI_NO_MATCH',
            statusCode: 422,
            reason: 'no_match',
            confidence: normalized.confidence,
            aiReason: normalized.reason,
            provider: 'openai',
            model: result.model || model
        };
    }

    if (normalized.confidence < MIN_CLASSIFICATION_CONFIDENCE) {
        return {
            ok: false,
            code: 'MY_DAY_AI_LOW_CONFIDENCE',
            statusCode: 422,
            reason: 'low_confidence',
            confidence: normalized.confidence,
            aiReason: normalized.reason,
            provider: 'openai',
            model: result.model || model
        };
    }

    return {
        ok: true,
        classification: {
            impactIds: normalized.impactIds
        },
        confidence: normalized.confidence,
        reason: normalized.reason,
        provider: 'openai',
        model: result.model || model,
        usage: result.usage || {}
    };
}

module.exports = {
    ALLOWED_MY_DAY_CLASSIFICATION_MODELS,
    DEFAULT_MY_DAY_CLASSIFICATION_MODEL,
    MIN_CLASSIFICATION_CONFIDENCE,
    MY_DAY_CLASSIFICATION_JSON_SCHEMA,
    MY_DAY_CLASSIFICATION_MAX_OUTPUT_TOKENS,
    MY_DAY_CLASSIFICATION_TIMEOUT_MS,
    activeImpactPayload,
    buildOpenAIResponsesInput,
    buildSystemPrompt,
    buildUserMessage,
    callOpenAIResponsesForClassification,
    classifyMyDayTask,
    extractOpenAIResponseObject,
    extractOpenAIResponseText,
    myDayClassificationDiagnostics,
    normalizeAiClassification,
    parseAiJson,
    resolveMyDayClassificationTimeoutMs,
    resolveMyDayClassificationModel,
    taskFingerprint,
    taskSnapshot
};
