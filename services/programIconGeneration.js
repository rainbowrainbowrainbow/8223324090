/**
 * services/programIconGeneration.js — cheap-first program icon generation pipeline.
 */
const https = require('https');
const crypto = require('crypto');
const { uploadFromUrl, makeFilename } = require('./imageStorage');
const { openRouterChat } = require('./copilot');
const { createLogger } = require('../utils/logger');

const log = createLogger('ProgramIconGeneration');

const PROGRAM_ICON_SETTINGS_KEY = 'program_icon_generation';
const OPENROUTER_PROVIDER = 'openrouter';
const KIE_PROVIDER = 'kie.ai';
const AUTO_PROVIDER = 'auto';
const OPENROUTER_IMAGE_MODEL_DEFAULT = 'openai/gpt-5-image-mini';
const KIE_IMAGE_MODEL_DEFAULT = 'nano-banana-2';
const PROGRAM_ICON_IMAGE_PROVIDER = normalizeImageProvider(process.env.PROGRAM_ICON_IMAGE_PROVIDER || AUTO_PROVIDER);
const PROGRAM_ICON_PROVIDER = resolveDefaultImageProvider(PROGRAM_ICON_IMAGE_PROVIDER);
const PROGRAM_ICON_IMAGE_MODEL = process.env.PROGRAM_ICON_IMAGE_MODEL || defaultImageModelForProvider(PROGRAM_ICON_PROVIDER);
const PROGRAM_ICON_PROMPT_MODEL = process.env.PROGRAM_ICON_PROMPT_MODEL || 'openai/gpt-5.4-nano';
const MAX_SETTING_LENGTH = 2400;
const MAX_PROMPT_LENGTH = 1800;
const OPENROUTER_IMAGE_TIMEOUT_MS = Number(process.env.PROGRAM_ICON_OPENROUTER_TIMEOUT_MS || 120000);

const PROGRAM_ICON_PROVIDER_OPTIONS = [
    { value: AUTO_PROVIDER, label: 'Auto', description: 'Use Kie.ai for image media when KIE_API_KEY is configured; OpenRouter remains an explicit fallback.' },
    { value: KIE_PROVIDER, label: 'Kie.ai', description: 'Primary async nano-banana-2 image job provider.' },
    { value: OPENROUTER_PROVIDER, label: 'OpenRouter', description: 'Explicit fallback image generation through OpenRouter chat/completions image models.' }
];

const PROGRAM_ICON_IMAGE_MODEL_OPTIONS = [
    { provider: OPENROUTER_PROVIDER, value: OPENROUTER_IMAGE_MODEL_DEFAULT, label: 'OpenAI GPT-5 Image Mini', description: 'Cheap default OpenRouter image model for small icons.' },
    { provider: OPENROUTER_PROVIDER, value: 'google/gemini-3.1-flash-image-preview', label: 'Google Nano Banana 2', description: 'OpenRouter Gemini image preview model.' },
    { provider: OPENROUTER_PROVIDER, value: 'openai/gpt-5-image', label: 'OpenAI GPT-5 Image', description: 'Higher quality, higher cost OpenRouter image model.' },
    { provider: KIE_PROVIDER, value: KIE_IMAGE_MODEL_DEFAULT, label: 'Kie.ai nano-banana-2', description: 'Legacy Kie still-image task model.' }
];

const DEFAULT_PROGRAM_ICON_SETTINGS = {
    imageProvider: AUTO_PROVIDER,
    imageModel: '',
    promptModel: PROGRAM_ICON_PROMPT_MODEL,
    systemInstructions: 'Create concise still-image prompts for small CRM program icons. Keep the output suitable for one cheap 1:1 image generation request.',
    userTemplate: 'Program: {{name}}. Code: {{code}}. Category: {{category}}. Duration: {{duration}} minutes. Hosts: {{hosts}}. Age: {{ageRange}}. Children: {{kidsCapacity}}. Notes: {{description}}.',
    styleRules: 'Modern dark SaaS UI, rounded square icon, circular inner badge, soft neon glow, one clear central playful performance object or character silhouette. No text, no letters, no numbers, no watermark. Readable at 64x64 px.',
    fallbackTemplate: 'Create a clean custom CRM icon for a children\'s entertainment program named {{name}} in category {{category}}. Use a dark navy/purple rounded square, circular inner badge, soft neon glow, semi-3D vector illustration, one central object or character silhouette, no text, no letters, no numbers, readable at 64x64 px.'
};

function getOpenRouterKey() {
    return process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '';
}

function normalizeImageProvider(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === OPENROUTER_PROVIDER || text === 'open-router') return OPENROUTER_PROVIDER;
    if (text === KIE_PROVIDER || text === 'kie' || text === 'kieai') return KIE_PROVIDER;
    return AUTO_PROVIDER;
}

function resolveDefaultImageProvider(provider = AUTO_PROVIDER) {
    const normalized = normalizeImageProvider(provider);
    if (normalized !== AUTO_PROVIDER) return normalized;
    if (getKieKey()) return KIE_PROVIDER;
    return getOpenRouterKey() ? OPENROUTER_PROVIDER : KIE_PROVIDER;
}

function defaultImageModelForProvider(provider) {
    return normalizeImageProvider(provider) === OPENROUTER_PROVIDER
        ? OPENROUTER_IMAGE_MODEL_DEFAULT
        : KIE_IMAGE_MODEL_DEFAULT;
}

function hasProgramIconProviderKey(provider) {
    return normalizeImageProvider(provider) === OPENROUTER_PROVIDER
        ? Boolean(getOpenRouterKey())
        : Boolean(getKieKey());
}

function cleanSettingString(value, maxLength = MAX_SETTING_LENGTH) {
    return String(value || '').trim().slice(0, maxLength);
}

function safeJsonObject(value, fallback = {}) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
        } catch {
            return fallback;
        }
    }
    return fallback;
}

function sanitizeProgramIconSettings(input = {}, fallback = DEFAULT_PROGRAM_ICON_SETTINGS) {
    const source = safeJsonObject(input, {});
    const settings = {
        imageProvider: normalizeImageProvider(source.imageProvider ?? fallback.imageProvider),
        imageModel: cleanSettingString(source.imageModel ?? fallback.imageModel, 160),
        promptModel: cleanSettingString(source.promptModel ?? fallback.promptModel, 160),
        systemInstructions: cleanSettingString(source.systemInstructions ?? fallback.systemInstructions),
        userTemplate: cleanSettingString(source.userTemplate ?? fallback.userTemplate),
        styleRules: cleanSettingString(source.styleRules ?? fallback.styleRules),
        fallbackTemplate: cleanSettingString(source.fallbackTemplate ?? fallback.fallbackTemplate)
    };
    const errors = [];

    for (const [key, label] of [
        ['systemInstructions', 'systemInstructions'],
        ['userTemplate', 'userTemplate'],
        ['styleRules', 'styleRules'],
        ['fallbackTemplate', 'fallbackTemplate']
    ]) {
        if (!settings[key]) errors.push(`${label} is required`);
        if (String(source[key] || '').length > MAX_SETTING_LENGTH) errors.push(`${label} is too long`);
    }
    if (!settings.promptModel) errors.push('promptModel is required');
    if (String(source.imageModel || '').length > 160) errors.push('imageModel is too long');
    if (String(source.promptModel || '').length > 160) errors.push('promptModel is too long');

    if (!settings.userTemplate.includes('{{name}}') && !settings.fallbackTemplate.includes('{{name}}')) {
        errors.push('At least one template must include {{name}}');
    }

    return { settings, errors };
}

function resolveProgramIconRuntime(settings = DEFAULT_PROGRAM_ICON_SETTINGS) {
    const { settings: safeSettings } = sanitizeProgramIconSettings(settings);
    const requestedProvider = normalizeImageProvider(safeSettings.imageProvider);
    const provider = requestedProvider === AUTO_PROVIDER ? resolveDefaultImageProvider(requestedProvider) : requestedProvider;
    const modelWasExplicit = Boolean(safeSettings.imageModel)
        && safeSettings.imageModel !== OPENROUTER_IMAGE_MODEL_DEFAULT
        && safeSettings.imageModel !== KIE_IMAGE_MODEL_DEFAULT;
    const imageModel = modelWasExplicit || requestedProvider !== AUTO_PROVIDER
        ? (safeSettings.imageModel || defaultImageModelForProvider(provider))
        : defaultImageModelForProvider(provider);
    return {
        requestedProvider,
        provider,
        imageModel,
        promptModel: safeSettings.promptModel || PROGRAM_ICON_PROMPT_MODEL,
        providerReady: hasProgramIconProviderKey(provider),
        keys: {
            openrouter: hasProgramIconProviderKey(OPENROUTER_PROVIDER),
            kie: hasProgramIconProviderKey(KIE_PROVIDER)
        }
    };
}

function buildProgramIconSourceSnapshot(product = {}) {
    return {
        id: product.id || null,
        businessContext: product.business_context || product.businessContext || null,
        code: product.code || '',
        name: product.name || product.label || '',
        label: product.label || '',
        category: product.category || '',
        duration: product.duration || 0,
        price: product.price || 0,
        hosts: product.hosts || 0,
        ageRange: product.age_range || product.ageRange || '',
        kidsCapacity: product.kids_capacity || product.kidsCapacity || '',
        description: product.description || '',
        shortDescription: product.short_description || product.shortDescription || ''
    };
}

function renderTemplate(template, data = {}) {
    return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        const value = data[key];
        return value === undefined || value === null ? '' : String(value);
    }).replace(/\s+/g, ' ').trim();
}

function clampPrompt(prompt) {
    return String(prompt || '')
        .replace(/\s+/g, ' ')
        .replace(/[`#*_]+/g, '')
        .trim()
        .slice(0, MAX_PROMPT_LENGTH);
}

function buildDeterministicProgramIconPrompt(product = {}, settings = DEFAULT_PROGRAM_ICON_SETTINGS) {
    const { settings: safeSettings } = sanitizeProgramIconSettings(settings);
    const data = buildProgramIconSourceSnapshot(product);
    const base = renderTemplate(safeSettings.fallbackTemplate, data);
    const style = renderTemplate(safeSettings.styleRules, data);
    const prompt = [
        base,
        style,
        'Static still image icon only. No text, no captions, no logo, no watermark.'
    ].filter(Boolean).join(' ');
    return clampPrompt(prompt);
}

function isUsablePrompt(value) {
    const text = String(value || '').trim();
    return text.length >= 80 && text.length <= MAX_PROMPT_LENGTH * 1.1;
}

async function refineProgramIconPrompt(product = {}, settings = DEFAULT_PROGRAM_ICON_SETTINGS) {
    const { settings: safeSettings } = sanitizeProgramIconSettings(settings);
    const runtime = resolveProgramIconRuntime(safeSettings);
    const data = buildProgramIconSourceSnapshot(product);
    const fallbackPrompt = buildDeterministicProgramIconPrompt(product, safeSettings);
    const userPrompt = [
        renderTemplate(safeSettings.userTemplate, data),
        renderTemplate(safeSettings.styleRules, data),
        'Return exactly one final English still-image prompt. No markdown. No explanations.'
    ].filter(Boolean).join('\n');

    try {
        const raw = await openRouterChat({
            model: runtime.promptModel,
            system: safeSettings.systemInstructions,
            messages: [{ role: 'user', content: userPrompt }],
            temperature: 0.25,
            max_tokens: 650
        });
        const refined = clampPrompt(raw);
        if (!isUsablePrompt(refined)) {
            return {
                finalPrompt: fallbackPrompt,
                llmPromptOutput: refined || null,
                source: 'fallback',
                reason: 'llm_output_unusable'
            };
        }
        return {
            finalPrompt: refined,
            llmPromptOutput: refined,
            source: 'llm',
            reason: null
        };
    } catch (err) {
        log.warn(`Prompt refinement fallback: ${err.message}`);
        return {
            finalPrompt: fallbackPrompt,
            llmPromptOutput: null,
            source: 'fallback',
            reason: err.message || 'llm_unavailable'
        };
    }
}

function getKieKey() {
    return process.env.KIE_API_KEY || '';
}

function kieRequest(method, requestPath, body) {
    const key = getKieKey();
    if (!key) {
        const error = new Error('KIE_API_KEY not configured');
        error.code = 'provider_not_configured';
        throw error;
    }
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : null;
        const req = https.request({
            hostname: 'api.kie.ai',
            path: requestPath,
            method,
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
            }
        }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data || '{}'));
                } catch {
                    reject(new Error('Invalid JSON from Kie.ai'));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Kie.ai timeout'));
        });
        if (postData) req.write(postData);
        req.end();
    });
}

function parseKieImageUrl(data) {
    if (!data) return null;
    const candidates = [
        data.imageUrl,
        data.image_url,
        data.url,
        data.resultUrl
    ].filter(Boolean);
    if (candidates[0]) return candidates[0];
    try {
        const resultJson = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : (data.resultJson || {});
        return resultJson?.resultUrls?.[0] || resultJson?.result_urls?.[0] || resultJson?.url || null;
    } catch {
        return null;
    }
}

function parseOpenRouterImageUrl(data) {
    const message = data?.choices?.[0]?.message || {};
    const candidates = [];
    const images = Array.isArray(message.images) ? message.images : [];
    images.forEach(image => {
        if (typeof image === 'string') candidates.push(image);
        if (image?.image_url?.url) candidates.push(image.image_url.url);
        if (image?.imageUrl?.url) candidates.push(image.imageUrl.url);
        if (image?.url) candidates.push(image.url);
    });
    if (Array.isArray(message.content)) {
        message.content.forEach(part => {
            if (part?.type === 'image_url' && part?.image_url?.url) candidates.push(part.image_url.url);
            if (part?.type === 'output_image' && part?.image_url) candidates.push(part.image_url);
            if (part?.type === 'image' && part?.url) candidates.push(part.url);
        });
    }
    if (typeof message.content === 'string') {
        const match = message.content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
        if (match) candidates.push(match[0]);
    }
    return candidates.find(url => /^data:image\//.test(String(url)) || /^https?:\/\//.test(String(url))) || null;
}

async function openRouterImageRequest(prompt, runtime = resolveProgramIconRuntime()) {
    const key = getOpenRouterKey();
    if (!key) {
        const error = new Error('OPENROUTER_API_KEY not configured');
        error.code = 'provider_not_configured';
        throw error;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_IMAGE_TIMEOUT_MS);
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://8223324090-production.up.railway.app',
                'X-OpenRouter-Title': 'Event Genix CRM — Program Icons'
            },
            body: JSON.stringify({
                model: runtime.imageModel,
                modalities: ['image', 'text'],
                stream: false,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt }
                        ]
                    }
                ]
            })
        });
        const text = await response.text();
        let data = {};
        try {
            data = JSON.parse(text || '{}');
        } catch {
            data = {};
        }
        if (!response.ok) {
            const error = new Error(data?.error?.message || data?.message || `OpenRouter image error ${response.status}`);
            error.code = response.status === 401 || response.status === 403 ? 'provider_not_configured' : 'provider_rejected';
            throw error;
        }
        const imageUrl = parseOpenRouterImageUrl(data);
        if (!imageUrl) {
            const error = new Error('OpenRouter did not return an image URL');
            error.code = 'provider_rejected';
            throw error;
        }
        return {
            imageUrl,
            generationId: data.id || null,
            usage: data.usage || null
        };
    } catch (err) {
        if (err.name === 'AbortError') {
            const error = new Error('OpenRouter image timeout');
            error.code = 'provider_timeout';
            throw error;
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

async function startProgramIconGeneration(product = {}, settings = DEFAULT_PROGRAM_ICON_SETTINGS) {
    const runtime = resolveProgramIconRuntime(settings);
    const promptResult = await refineProgramIconPrompt(product, settings);
    const sourceSnapshot = buildProgramIconSourceSnapshot(product);
    if (runtime.provider === OPENROUTER_PROVIDER) {
        const image = await openRouterImageRequest(promptResult.finalPrompt, runtime);
        return {
            taskId: image.generationId || `openrouter:${crypto.randomUUID()}`,
            imageUrl: image.imageUrl,
            sourceSnapshot,
            llmPromptOutput: promptResult.llmPromptOutput,
            finalPrompt: promptResult.finalPrompt,
            promptSource: promptResult.source,
            promptFallbackReason: promptResult.reason,
            provider: OPENROUTER_PROVIDER,
            model: runtime.imageModel,
            promptModel: runtime.promptModel,
            status: 'succeeded',
            done: true,
            usage: image.usage
        };
    }
    const response = await kieRequest('POST', '/api/v1/jobs/createTask', {
        model: runtime.imageModel,
        input: {
            prompt: promptResult.finalPrompt,
            aspect_ratio: '1:1',
            resolution: '1K',
            output_format: 'png'
        }
    });
    const taskId = response?.data?.taskId || response?.taskId;
    if (!taskId) {
        const error = new Error(response?.message || response?.error || 'Kie.ai did not create task');
        error.code = 'provider_rejected';
        throw error;
    }
    return {
        taskId,
        sourceSnapshot,
        llmPromptOutput: promptResult.llmPromptOutput,
        finalPrompt: promptResult.finalPrompt,
        promptSource: promptResult.source,
        promptFallbackReason: promptResult.reason,
        provider: KIE_PROVIDER,
        model: runtime.imageModel,
        promptModel: runtime.promptModel,
        status: 'pending',
        done: false
    };
}

async function pollProgramIconJob(taskId) {
    const response = await kieRequest('GET', `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    const data = response?.data || {};
    const state = data.state || data.status || null;
    const imageUrl = parseKieImageUrl(data);
    const failed = ['failed', 'error', 'cancelled'].includes(String(state || '').toLowerCase());
    const done = ['success', 'succeeded', 'completed'].includes(String(state || '').toLowerCase()) && Boolean(imageUrl);
    return {
        taskId,
        state,
        done,
        failed,
        imageUrl: done ? imageUrl : null,
        error: failed ? (data.failMsg || data.error || data.message || 'Image generation failed') : null
    };
}

async function persistProgramIconImage(product = {}, imageUrl, options = {}) {
    if (!imageUrl) return null;
    const filename = makeFilename('program-icons', product.name || product.label || product.id || 'program', 'png');
    return await uploadFromUrl(imageUrl, filename, options);
}

module.exports = {
    PROGRAM_ICON_SETTINGS_KEY,
    PROGRAM_ICON_PROVIDER,
    PROGRAM_ICON_IMAGE_MODEL,
    PROGRAM_ICON_PROMPT_MODEL,
    PROGRAM_ICON_PROVIDER_OPTIONS,
    PROGRAM_ICON_IMAGE_MODEL_OPTIONS,
    DEFAULT_PROGRAM_ICON_SETTINGS,
    sanitizeProgramIconSettings,
    resolveProgramIconRuntime,
    hasProgramIconProviderKey,
    buildProgramIconSourceSnapshot,
    buildDeterministicProgramIconPrompt,
    refineProgramIconPrompt,
    startProgramIconGeneration,
    pollProgramIconJob,
    persistProgramIconImage,
    parseKieImageUrl,
    parseOpenRouterImageUrl
};
