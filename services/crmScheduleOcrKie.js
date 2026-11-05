'use strict';

const { executionError } = require('./crmProviderExecution');
const KIE_OCR_MODEL = 'gemini-3-8-flash-openai';
const KIE_OCR_ENDPOINT = 'https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions';
const MAX_RESPONSE_BYTES = 1024 * 1024;

function assertKieOcrReady({ model, env, fetchImpl }) {
    if (model !== KIE_OCR_MODEL || !env.KIE_API_KEY) throw executionError('CRM_OCR_PROVIDER_NOT_CONFIGURED', 503);
    if (String(env.NODE_ENV || '').toLowerCase() === 'test' && (!fetchImpl || fetchImpl === global.fetch)) {
        throw executionError('CRM_OCR_PROVIDER_BLOCKED_IN_TESTS', 503);
    }
}

async function boundedJson(response) {
    const length = Number(response.headers?.get?.('content-length'));
    if (length > MAX_RESPONSE_BYTES || !response.body) throw executionError('CRM_OCR_PROVIDER_FAILED', 502);
    const chunks = []; let size = 0;
    for await (const part of response.body) {
        size += part.length;
        if (size > MAX_RESPONSE_BYTES) throw executionError('CRM_OCR_PROVIDER_FAILED', 502);
        chunks.push(part);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw executionError('CRM_OCR_PROVIDER_FAILED', 502); }
}

async function recognizeDocumentWithKie({ image, documentDate, model, instructions, env, fetchImpl, onReceipt, attendance = false }) {
    assertKieOcrReady({ model, env, fetchImpl });
    if (!Buffer.isBuffer(image?.bytes) || !image.bytes.length || image.bytes.length > 4 * 1024 * 1024
        || !['image/png', 'image/jpeg'].includes(image.mimeType)) throw executionError('CRM_OCR_IMAGE_TYPE_INVALID', 400);
    const request = {
        stream: false, max_tokens: 6000, include_thoughts: false, reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: [
                { type: 'text', text: `Document date: ${documentDate}. Extract only visible ${attendance ? 'arrival/departure' : 'schedule'} data.` },
                { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}` } }
            ] }
        ]
    };
    // A single chat request, no upload service, tool use, search or paid fallback.
    const response = await (fetchImpl || global.fetch)(KIE_OCR_ENDPOINT, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { Authorization: `Bearer ${env.KIE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
    });
    if (!response.ok) throw executionError('CRM_OCR_PROVIDER_FAILED', 502);
    const payload = await boundedJson(response);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw executionError('CRM_OCR_PROVIDER_FAILED', 502);
    if (payload.code !== undefined && payload.code !== 200) throw executionError('CRM_OCR_PROVIDER_FAILED', 502);
    const choice = payload.choices?.[0];
    if (payload.choices?.length !== 1 || choice?.finish_reason !== 'stop' || choice.message?.refusal) {
        throw executionError('CRM_OCR_PROVIDER_INCOMPLETE', 422);
    }
    const text = choice.message?.content;
    if (typeof text !== 'string') throw executionError('CRM_OCR_ROWS_INVALID', 422);
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw executionError('CRM_OCR_ROWS_INVALID', 422); }
    if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.rows) || parsed.rows.length > 100) {
        throw executionError('CRM_OCR_ROWS_INVALID', 422);
    }
    if (typeof onReceipt === 'function') {
        const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
        const credits = payload.credits_consumed;
        // Whitelisted accounting metadata only: no image, extracted text, key,
        // raw headers or provider error body reaches the optional pilot journal.
        await onReceipt({ provider: 'kie', model,
            requestId: typeof payload.id === 'string' && /^chatcmpl[-_][A-Za-z0-9_-]{1,110}$/.test(payload.id) ? payload.id : null,
            promptTokens: count(payload.usage?.prompt_tokens), completionTokens: count(payload.usage?.completion_tokens),
            reasoningTokens: count(payload.usage?.completion_tokens_details?.reasoning_tokens),
            creditsConsumed: Number.isFinite(credits) && credits >= 0 ? credits : null });
    }
    return parsed;
}

async function recognizeScheduleWithKie(input) {
    return require('./crmScheduleOcrDocument').plannedScheduleRows(await recognizeDocumentWithKie(input));
}

module.exports = { KIE_OCR_MODEL, KIE_OCR_ENDPOINT, assertKieOcrReady, recognizeScheduleWithKie, recognizeDocumentWithKie };
