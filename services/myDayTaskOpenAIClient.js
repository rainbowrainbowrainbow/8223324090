'use strict';

const crypto = require('node:crypto');

const MY_DAY_TASK_AI_MODEL = 'gpt-5.6-luna';
const OPENAI_OFFICIAL_ORIGIN = 'https://api.openai.com';
const DEFAULT_OPENAI_API_BASE = `${OPENAI_OFFICIAL_ORIGIN}/v1`;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_REASONING_EFFORT = 'low';

function compactString(value, limit) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function getOpenAIKey(env = process.env) {
    return String(env.OPENAI_API_KEY || '').trim();
}

function isProductionEnv(env = process.env) {
    return String(env.NODE_ENV || '').toLowerCase() === 'production'
        || String(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || '').toLowerCase() === 'production';
}

function resolveOpenAIResponsesBase(env = process.env) {
    const raw = String(env.OPENAI_API_BASE || env.OPENAI_API_BASE_URL || DEFAULT_OPENAI_API_BASE).trim() || DEFAULT_OPENAI_API_BASE;
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        const error = new Error('Invalid OpenAI API base URL.');
        error.code = 'OPENAI_API_BASE_INVALID';
        error.statusCode = 503;
        throw error;
    }

    if (isProductionEnv(env) && parsed.origin !== OPENAI_OFFICIAL_ORIGIN) {
        const error = new Error('Production My Day task AI must use the official OpenAI API host.');
        error.code = 'OPENAI_API_BASE_NOT_ALLOWED';
        error.statusCode = 503;
        throw error;
    }

    return parsed.toString().replace(/\/+$/, '');
}

function resolveMyDayTaskAiModel(model) {
    const resolved = compactString(model || MY_DAY_TASK_AI_MODEL, 120);
    if (resolved !== MY_DAY_TASK_AI_MODEL) {
        const error = new Error('Unsupported My Day task AI model.');
        error.code = 'MY_DAY_TASK_AI_MODEL_NOT_ALLOWED';
        error.statusCode = 503;
        throw error;
    }
    return resolved;
}

function resolveTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.max(100, Math.min(30_000, parsed));
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
    if (!cleaned) {
        const error = new Error('AI did not return JSON.');
        error.code = 'AI_INVALID_JSON';
        error.statusCode = 422;
        throw error;
    }
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        const error = new Error('AI returned invalid JSON.');
        error.code = 'AI_INVALID_JSON';
        error.statusCode = 422;
        throw error;
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

function hmacSafetyIdentifier(value, secret) {
    const stableValue = compactString(value, 200);
    const stableSecret = String(secret || process.env.JWT_SECRET || '').trim();
    if (!stableValue || !stableSecret) return null;
    return crypto
        .createHmac('sha256', stableSecret)
        .update(stableValue)
        .digest('base64url')
        .slice(0, 64);
}

function providerFailure(reason, statusCode, model) {
    return {
        ok: false,
        provider: 'openai',
        model: model || MY_DAY_TASK_AI_MODEL,
        reason,
        statusCode
    };
}

function isTestRuntime(env = process.env) {
    return String(env.NODE_ENV || '').toLowerCase() === 'test'
        || String(env.CI || '').toLowerCase() === 'true';
}

function shouldBlockRealOpenAIInTests(env = process.env, options = {}) {
    if (!isTestRuntime(env)) return false;
    if (String(env.ALLOW_REAL_OPENAI_TESTS || '').toLowerCase() === 'true') return false;
    return typeof options.fetchImpl !== 'function' && typeof options.transport !== 'function';
}

function shouldRetryResponse(status) {
    return status === 429 || status >= 500;
}

async function callMyDayTaskOpenAIResponses(request = {}, options = {}) {
    const env = request.env || options.env || process.env;
    let model;
    try {
        model = resolveMyDayTaskAiModel(request.model || options.model);
    } catch (error) {
        return providerFailure('model_not_allowed', error.statusCode || 503, request.model || options.model);
    }

    const apiKey = getOpenAIKey(env);
    if (!apiKey) return providerFailure('missing_key', 503, model);

    let apiBase;
    try {
        apiBase = resolveOpenAIResponsesBase(env);
    } catch (error) {
        return providerFailure(error.code === 'OPENAI_API_BASE_NOT_ALLOWED' ? 'api_base_not_allowed' : 'invalid_api_base', error.statusCode || 503, model);
    }

    const fetchImpl = options.fetchImpl || request.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') return providerFailure('fetch_unavailable', 503, model);
    if (shouldBlockRealOpenAIInTests(env, { ...options, fetchImpl: options.fetchImpl || request.fetchImpl })) {
        return providerFailure('real_openai_blocked_in_tests', 503, model);
    }

    const timeoutMs = resolveTimeoutMs(request.timeoutMs || options.timeoutMs, DEFAULT_TIMEOUT_MS);
    const attempts = Math.max(1, Math.min(DEFAULT_MAX_ATTEMPTS, Number.parseInt(request.maxAttempts || options.maxAttempts || DEFAULT_MAX_ATTEMPTS, 10) || DEFAULT_MAX_ATTEMPTS));
    const body = {
        model,
        input: request.input,
        text: {
            format: {
                type: 'json_schema',
                name: request.schemaName,
                strict: true,
                schema: request.schema
            }
        },
        reasoning: { effort: request.reasoningEffort || DEFAULT_REASONING_EFFORT },
        max_output_tokens: request.maxOutputTokens,
        store: false
    };
    if (request.safetyIdentifier) body.safety_identifier = String(request.safetyIdentifier);

    let lastFailure = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(`${apiBase}/responses`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                lastFailure = providerFailure(response.status === 401 || response.status === 403 ? 'auth_failed' : 'provider_error', response.status >= 500 ? 503 : response.status, model);
                if (attempt < attempts && shouldRetryResponse(response.status)) continue;
                return lastFailure;
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
            lastFailure = providerFailure(error?.name === 'AbortError' ? 'timeout' : 'network_error', error?.name === 'AbortError' ? 504 : 503, model);
            if (error?.name === 'AbortError' || attempt >= attempts) return lastFailure;
        } finally {
            clearTimeout(timeout);
        }
    }
    return lastFailure || providerFailure('provider_error', 503, model);
}

module.exports = {
    DEFAULT_OPENAI_API_BASE,
    DEFAULT_REASONING_EFFORT,
    DEFAULT_TIMEOUT_MS,
    MY_DAY_TASK_AI_MODEL,
    OPENAI_OFFICIAL_ORIGIN,
    callMyDayTaskOpenAIResponses,
    compactString,
    extractOpenAIResponseObject,
    extractOpenAIResponseText,
    getOpenAIKey,
    hmacSafetyIdentifier,
    isTestRuntime,
    parseAiJson,
    resolveMyDayTaskAiModel,
    resolveOpenAIResponsesBase,
    resolveTimeoutMs,
    shouldBlockRealOpenAIInTests,
    stripJsonFence
};
