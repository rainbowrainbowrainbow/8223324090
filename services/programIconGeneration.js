/**
 * services/programIconGeneration.js — cheap-first program icon generation pipeline.
 */
const https = require('https');
const { uploadFromUrl, makeFilename } = require('./imageStorage');
const { openRouterChat } = require('./copilot');
const { createLogger } = require('../utils/logger');

const log = createLogger('ProgramIconGeneration');

const PROGRAM_ICON_SETTINGS_KEY = 'program_icon_generation';
const PROGRAM_ICON_PROVIDER = 'kie.ai';
const PROGRAM_ICON_IMAGE_MODEL = process.env.PROGRAM_ICON_IMAGE_MODEL || 'nano-banana-2';
const PROGRAM_ICON_PROMPT_MODEL = process.env.PROGRAM_ICON_PROMPT_MODEL || 'anthropic/claude-haiku-3';
const MAX_SETTING_LENGTH = 2400;
const MAX_PROMPT_LENGTH = 1800;

const DEFAULT_PROGRAM_ICON_SETTINGS = {
    systemInstructions: 'Create concise still-image prompts for small CRM program icons. Keep the output suitable for one cheap 1:1 image generation request.',
    userTemplate: 'Program: {{name}}. Code: {{code}}. Category: {{category}}. Duration: {{duration}} minutes. Hosts: {{hosts}}. Age: {{ageRange}}. Children: {{kidsCapacity}}. Notes: {{description}}.',
    styleRules: 'Modern dark SaaS UI, rounded square icon, circular inner badge, soft neon glow, one clear central playful performance object or character silhouette. No text, no letters, no numbers, no watermark. Readable at 64x64 px.',
    fallbackTemplate: 'Create a clean custom CRM icon for a children\'s entertainment program named {{name}} in category {{category}}. Use a dark navy/purple rounded square, circular inner badge, soft neon glow, semi-3D vector illustration, one central object or character silhouette, no text, no letters, no numbers, readable at 64x64 px.'
};

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

    if (!settings.userTemplate.includes('{{name}}') && !settings.fallbackTemplate.includes('{{name}}')) {
        errors.push('At least one template must include {{name}}');
    }

    return { settings, errors };
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
    const data = buildProgramIconSourceSnapshot(product);
    const fallbackPrompt = buildDeterministicProgramIconPrompt(product, safeSettings);
    const userPrompt = [
        renderTemplate(safeSettings.userTemplate, data),
        renderTemplate(safeSettings.styleRules, data),
        'Return exactly one final English still-image prompt. No markdown. No explanations.'
    ].filter(Boolean).join('\n');

    try {
        const raw = await openRouterChat({
            model: PROGRAM_ICON_PROMPT_MODEL,
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

async function startProgramIconGeneration(product = {}, settings = DEFAULT_PROGRAM_ICON_SETTINGS) {
    const promptResult = await refineProgramIconPrompt(product, settings);
    const sourceSnapshot = buildProgramIconSourceSnapshot(product);
    const response = await kieRequest('POST', '/api/v1/jobs/createTask', {
        model: PROGRAM_ICON_IMAGE_MODEL,
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
        provider: PROGRAM_ICON_PROVIDER,
        model: PROGRAM_ICON_IMAGE_MODEL,
        promptModel: PROGRAM_ICON_PROMPT_MODEL
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

async function persistProgramIconImage(product = {}, imageUrl) {
    if (!imageUrl) return null;
    const filename = makeFilename('program-icons', product.name || product.label || product.id || 'program', 'png');
    return await uploadFromUrl(imageUrl, filename);
}

module.exports = {
    PROGRAM_ICON_SETTINGS_KEY,
    PROGRAM_ICON_PROVIDER,
    PROGRAM_ICON_IMAGE_MODEL,
    PROGRAM_ICON_PROMPT_MODEL,
    DEFAULT_PROGRAM_ICON_SETTINGS,
    sanitizeProgramIconSettings,
    buildProgramIconSourceSnapshot,
    buildDeterministicProgramIconPrompt,
    refineProgramIconPrompt,
    startProgramIconGeneration,
    pollProgramIconJob,
    persistProgramIconImage,
    parseKieImageUrl
};
