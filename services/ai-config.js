/**
 * services/ai-config.js — shared AI provider/key resolver.
 *
 * Chat summary and Guardian use the same CRM AI key source. Per-scope settings
 * may choose provider/model/enabled state, but secrets stay server-side env
 * values and are never returned to the frontend.
 */

const { pool } = require('../db');
const { settingsCache } = require('./cache');
const { createLogger } = require('../utils/logger');

const log = createLogger('AIConfig');

const KEY_SOURCE = 'crm_ai_default';
const SETTINGS_KEYS = {
    chat_ai: 'chat_ai_config',
    guardian_ai: 'chat_guardian_config',
    chat_integrations: 'chat_integrations_config'
};

const PROVIDERS = ['auto', 'openrouter', 'anthropic', 'openai'];

const DEFAULT_MODELS = {
    openrouter: process.env.SUMMARY_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-5.4-mini',
    anthropic: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    openai: process.env.OPENAI_MODEL || 'gpt-5.4-mini'
};

const DEFAULT_AI_SETTINGS = {
    enabled: true,
    provider: 'openai',
    model: DEFAULT_MODELS.openai,
    keySource: KEY_SOURCE
};

const DEFAULT_INTEGRATIONS = {
    channels: true,
    summary: true,
    guardian: true,
    notifications: true
};

const DEFAULT_GUARDIAN_SETTINGS = {
    enabled: true,
    digestEnabled: true,
    securityLogEnabled: true,
    analyticsEnabled: true,
    provider: 'openai',
    model: DEFAULT_MODELS.openai,
    keySource: KEY_SOURCE
};

const BASE_MODEL_OPTIONS = {
    auto: [
        { value: '', label: 'Автоматично за provider', description: 'CRM сама вибере дефолтну модель для доступного provider.' }
    ],
    openai: [
        { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini', description: 'Рекомендовано: швидка і дешевша mini-модель для чату, summary та Guardian.' },
        { value: 'gpt-5.5', label: 'GPT-5.5', description: 'Flagship-модель для складного reasoning і coding, дорожча за mini.' },
        { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Сильніша модель для складних відповідей, дорожча за mini.' },
        { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano', description: 'Найшвидший і найдешевший варіант для простих задач.' },
        { value: 'gpt-5-mini', label: 'GPT-5 mini', description: 'Попередня mini-модель для сумісності.' },
        { value: 'gpt-5-nano', label: 'GPT-5 nano', description: 'Попередня nano-модель для простих сценаріїв.' },
        { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini', description: 'Сумісний нерозмірковий fallback.' }
    ],
    anthropic: [
        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Швидкий Anthropic fallback для коротких задач.' },
        { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'Сильніший Anthropic fallback для складніших задач.' }
    ],
    openrouter: [
        { value: 'openai/gpt-5.4-mini', label: 'OpenAI GPT-5.4 mini', description: 'Рекомендований OpenAI mini через OpenRouter.' },
        { value: 'openai/gpt-5.5', label: 'OpenAI GPT-5.5', description: 'Flagship OpenAI через OpenRouter для складніших задач.' },
        { value: 'openai/gpt-5.4-nano', label: 'OpenAI GPT-5.4 nano', description: 'Дешевший OpenAI nano через OpenRouter.' },
        { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', description: 'Швидкий Anthropic fallback через OpenRouter.' },
        { value: 'google/gemini-flash-1.5', label: 'Gemini Flash 1.5', description: 'Швидкий універсальний fallback через OpenRouter.' }
    ]
};

function normalizeScope(scope) {
    if (scope === 'guardian' || scope === 'guardian_ai') return 'guardian_ai';
    return 'chat_ai';
}

function normalizeProvider(provider) {
    const value = String(provider || 'auto').toLowerCase();
    return PROVIDERS.includes(value) ? value : 'auto';
}

function normalizeModel(model) {
    return String(model || '').trim().slice(0, 128);
}

function modelOptionsForProvider(provider) {
    const normalized = normalizeProvider(provider);
    const base = (BASE_MODEL_OPTIONS[normalized] || BASE_MODEL_OPTIONS.auto).map(option => ({ ...option }));
    const defaultModel = DEFAULT_MODELS[normalized];
    if (defaultModel && !base.some(option => option.value === defaultModel)) {
        base.unshift({
            value: defaultModel,
            label: `${defaultModel} (env default)`,
            description: 'Модель задана через backend env.'
        });
    }
    return base;
}

function getAIModelOptions() {
    return PROVIDERS.reduce((acc, provider) => {
        acc[provider] = modelOptionsForProvider(provider);
        return acc;
    }, {});
}

function normalizeModelForProvider(model, provider) {
    const normalizedProvider = normalizeProvider(provider);
    const value = normalizeModel(model);
    if (normalizedProvider === 'auto') return '';
    const allowed = modelOptionsForProvider(normalizedProvider).map(option => option.value).filter(Boolean);
    if (!value) return DEFAULT_MODELS[normalizedProvider] || '';
    return allowed.includes(value) ? value : (DEFAULT_MODELS[normalizedProvider] || allowed[0] || '');
}

function getProviderKey(provider) {
    if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '';
    if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
    if (provider === 'openai') return process.env.OPENAI_API_KEY || '';
    return '';
}

function getAvailableProviders() {
    return ['openrouter', 'anthropic', 'openai'].filter(provider => Boolean(getProviderKey(provider)));
}

function hasAnySharedAIKey() {
    return getAvailableProviders().length > 0;
}

function pickProvider(requestedProvider) {
    const requested = normalizeProvider(requestedProvider);
    if (requested !== 'auto' && getProviderKey(requested)) return requested;
    const available = getAvailableProviders();
    return available[0] || (requested === 'auto' ? 'openrouter' : requested);
}

function safeParseJson(value, fallback) {
    if (!value || typeof value !== 'string') return { ...fallback };
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : { ...fallback };
    } catch {
        return { ...fallback };
    }
}

async function readSettingJson(key, fallback) {
    const cached = settingsCache.get(key);
    if (cached !== null) return safeParseJson(cached, fallback);

    const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    const value = rows[0]?.value || null;
    settingsCache.set(key, value);
    return safeParseJson(value, fallback);
}

async function writeSettingJson(key, value) {
    const stringValue = JSON.stringify(value || {});
    await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, stringValue]
    );
    settingsCache.invalidate(key);
    return stringValue;
}

function sanitizeAISettings(input, fallback) {
    const base = { ...fallback, ...(input || {}) };
    const provider = normalizeProvider(base.provider);
    return {
        enabled: base.enabled !== false,
        provider,
        model: normalizeModelForProvider(base.model, provider),
        keySource: KEY_SOURCE
    };
}

function sanitizeIntegrations(input) {
    const base = { ...DEFAULT_INTEGRATIONS, ...(input || {}) };
    return {
        channels: base.channels !== false,
        summary: base.summary !== false,
        guardian: base.guardian !== false,
        notifications: base.notifications !== false
    };
}

async function getStoredChatAISettings() {
    const raw = await readSettingJson(SETTINGS_KEYS.chat_ai, DEFAULT_AI_SETTINGS);
    return sanitizeAISettings(raw, DEFAULT_AI_SETTINGS);
}

async function saveChatAISettings(input) {
    const settings = sanitizeAISettings(input, DEFAULT_AI_SETTINGS);
    await writeSettingJson(SETTINGS_KEYS.chat_ai, settings);
    return settings;
}

async function getStoredGuardianSettings() {
    const raw = await readSettingJson(SETTINGS_KEYS.guardian_ai, DEFAULT_GUARDIAN_SETTINGS);
    const ai = sanitizeAISettings(raw, DEFAULT_GUARDIAN_SETTINGS);
    return {
        enabled: raw.enabled !== false,
        digestEnabled: raw.digestEnabled !== false,
        securityLogEnabled: raw.securityLogEnabled !== false,
        analyticsEnabled: raw.analyticsEnabled !== false,
        provider: ai.provider,
        model: ai.model,
        keySource: KEY_SOURCE
    };
}

async function saveGuardianSettings(input) {
    const current = await getStoredGuardianSettings();
    const settings = {
        ...current,
        ...(input || {})
    };
    const normalized = {
        enabled: settings.enabled !== false,
        digestEnabled: settings.digestEnabled !== false,
        securityLogEnabled: settings.securityLogEnabled !== false,
        analyticsEnabled: settings.analyticsEnabled !== false,
        provider: normalizeProvider(settings.provider),
        model: normalizeModel(settings.model),
        keySource: KEY_SOURCE
    };
    await writeSettingJson(SETTINGS_KEYS.guardian_ai, normalized);
    return normalized;
}

async function getStoredIntegrationsSettings() {
    const raw = await readSettingJson(SETTINGS_KEYS.chat_integrations, DEFAULT_INTEGRATIONS);
    return sanitizeIntegrations(raw);
}

async function saveIntegrationsSettings(input) {
    const settings = sanitizeIntegrations(input);
    await writeSettingJson(SETTINGS_KEYS.chat_integrations, settings);
    return settings;
}

async function getUnifiedAIConfig(options = {}) {
    const scope = normalizeScope(options.scope);
    const stored = scope === 'guardian_ai'
        ? await getStoredGuardianSettings()
        : await getStoredChatAISettings();
    const requestedProvider = normalizeProvider(stored.provider);
    const provider = pickProvider(requestedProvider);
    const keyConfigured = Boolean(getProviderKey(provider));
    const model = stored.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.openrouter;
    const status = stored.enabled === false
        ? 'disabled'
        : (keyConfigured ? 'ok' : 'missing_key');

    return {
        scope,
        enabled: stored.enabled !== false,
        provider,
        requestedProvider,
        model,
        keySource: KEY_SOURCE,
        keyConfigured,
        status,
        availableProviders: getAvailableProviders()
    };
}

function publicAIConfig(config) {
    return {
        enabled: config.enabled,
        provider: config.provider,
        requestedProvider: config.requestedProvider,
        model: config.model,
        keySource: config.keySource,
        keyConfigured: config.keyConfigured,
        status: config.status,
        availableProviders: config.availableProviders,
        defaultModels: DEFAULT_MODELS
    };
}

async function fetchWithTimeout(url, options, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function callOpenRouter(config, systemPrompt, userMessage, maxTokens, title) {
    const resp = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + getProviderKey('openrouter'),
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.PUBLIC_BASE_URL || 'https://park-zp.railway.app',
            'X-Title': title || 'Event Genix AI'
        },
        body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ]
        })
    });

    if (!resp.ok) {
        const body = await resp.text();
        const err = new Error('OpenRouter API error');
        err.status = resp.status;
        err.body = body.slice(0, 500);
        throw err;
    }
    const data = await resp.json();
    return {
        text: data.choices?.[0]?.message?.content?.trim() || '',
        usage: data.usage || {}
    };
}

async function callAnthropic(config, systemPrompt, userMessage, maxTokens) {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: getProviderKey('anthropic') });
    const response = await anthropic.messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
    });
    return {
        text: response.content?.[0]?.text?.trim() || '',
        usage: {
            prompt_tokens: response.usage?.input_tokens || 0,
            completion_tokens: response.usage?.output_tokens || 0
        }
    };
}

function extractOpenAIResponseText(payload) {
    if (payload && typeof payload.output_text === 'string' && payload.output_text.trim()) {
        return payload.output_text.trim();
    }

    const chunks = [];
    for (const item of payload?.output || []) {
        for (const content of item?.content || []) {
            if (typeof content?.text === 'string') chunks.push(content.text);
            if (typeof content?.output_text === 'string') chunks.push(content.output_text);
        }
    }
    return chunks.join('\n').trim();
}

async function callOpenAI(config, systemPrompt, userMessage, maxTokens) {
    const resp = await fetchWithTimeout('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + getProviderKey('openai'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: config.model,
            instructions: systemPrompt || '',
            input: userMessage || '',
            store: false,
            max_output_tokens: maxTokens
        })
    });

    if (!resp.ok) {
        const body = await resp.text();
        const err = new Error('OpenAI API error');
        err.status = resp.status;
        err.body = body.slice(0, 500);
        throw err;
    }
    const data = await resp.json();
    return {
        text: extractOpenAIResponseText(data),
        usage: data.usage || {}
    };
}

async function callUnifiedChatCompletion(options = {}) {
    const config = await getUnifiedAIConfig({ scope: options.scope });
    if (!config.enabled) {
        return { ok: false, reason: 'disabled', ...publicAIConfig(config) };
    }
    if (!config.keyConfigured) {
        return { ok: false, reason: 'missing_key', ...publicAIConfig(config) };
    }

    const maxTokens = options.maxTokens || 800;
    try {
        let result;
        if (config.provider === 'anthropic') {
            result = await callAnthropic(config, options.systemPrompt, options.userMessage, maxTokens);
        } else if (config.provider === 'openai') {
            result = await callOpenAI(config, options.systemPrompt, options.userMessage, maxTokens);
        } else {
            result = await callOpenRouter(config, options.systemPrompt, options.userMessage, maxTokens, options.title);
        }
        return {
            ok: true,
            text: result.text,
            usage: result.usage || {},
            ...publicAIConfig(config)
        };
    } catch (err) {
        log.error('Unified AI completion failed', {
            scope: config.scope,
            provider: config.provider,
            status: err.status,
            message: err.message
        });
        return { ok: false, reason: 'provider_error', error: err.message, ...publicAIConfig(config) };
    }
}

async function testUnifiedAIConfig(options = {}) {
    const config = await getUnifiedAIConfig({ scope: options.scope || 'chat_ai' });
    if (!config.enabled || !config.keyConfigured) {
        return {
            ok: false,
            message: config.enabled ? 'AI key source is not configured.' : 'AI is disabled for this scope.',
            ...publicAIConfig(config)
        };
    }

    if (!options.live) {
        return {
            ok: true,
            message: 'Config resolved. Live provider call was not requested.',
            ...publicAIConfig(config)
        };
    }

    const result = await callUnifiedChatCompletion({
        scope: config.scope,
        title: 'Event Genix Chat AI Settings Test',
        systemPrompt: 'Ти перевіряєш підключення AI для Event Genix CRM. Відповідай дуже коротко.',
        userMessage: 'Відповідай одним словом: OK',
        maxTokens: 16
    });
    return {
        ok: result.ok,
        message: result.ok ? 'Provider responded successfully.' : (result.reason || 'Provider test failed.'),
        sample: result.ok ? result.text : undefined,
        ...publicAIConfig(result)
    };
}

async function getChatSettingsBundle() {
    const [chatConfig, guardianConfig, integrations] = await Promise.all([
        getUnifiedAIConfig({ scope: 'chat_ai' }),
        getUnifiedAIConfig({ scope: 'guardian_ai' }),
        getStoredIntegrationsSettings()
    ]);
    const guardianStored = await getStoredGuardianSettings();
    return {
        chatAi: publicAIConfig(chatConfig),
        guardian: {
            ...guardianStored,
            ai: publicAIConfig(guardianConfig)
        },
        integrations,
        keySource: KEY_SOURCE,
        modelOptions: getAIModelOptions(),
        defaultModels: DEFAULT_MODELS
    };
}

module.exports = {
    SETTINGS_KEYS,
    KEY_SOURCE,
    DEFAULT_MODELS,
    BASE_MODEL_OPTIONS,
    getAIModelOptions,
    normalizeModelForProvider,
    getAvailableProviders,
    hasAnySharedAIKey,
    getUnifiedAIConfig,
    publicAIConfig,
    callUnifiedChatCompletion,
    testUnifiedAIConfig,
    getChatSettingsBundle,
    getStoredChatAISettings,
    saveChatAISettings,
    getStoredGuardianSettings,
    saveGuardianSettings,
    getStoredIntegrationsSettings,
    saveIntegrationsSettings
};
