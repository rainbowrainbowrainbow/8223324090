/**
 * services/ai-config.js — shared AI provider/key resolver.
 *
 * Chat summary and Guardian use the same CRM AI key source. Shared text/token
 * rails are intentionally OpenRouter-only; the CRM assistant rail keeps its
 * separate direct OpenAI boundary in services/dashboardAssistant*.js.
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

const PROVIDERS = ['auto', 'openrouter'];

const DEFAULT_MODELS = {
    openrouter: process.env.SUMMARY_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-5.4-mini'
};

const DEFAULT_AI_SETTINGS = {
    enabled: true,
    provider: 'openrouter',
    model: DEFAULT_MODELS.openrouter,
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
    provider: 'openrouter',
    model: DEFAULT_MODELS.openrouter,
    keySource: KEY_SOURCE
};

const BASE_MODEL_OPTIONS = {
    auto: [
        { value: '', label: 'Автоматично за provider', description: 'CRM сама вибере дефолтну модель для доступного provider.' }
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
    if (value === 'openai' || value === 'anthropic') return 'openrouter';
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
    return '';
}

function getAvailableProviders() {
    return ['openrouter'].filter(provider => Boolean(getProviderKey(provider)));
}

function hasAnySharedAIKey() {
    return getAvailableProviders().length > 0;
}

function pickProvider(requestedProvider) {
    const requested = normalizeProvider(requestedProvider);
    if (requested !== 'auto' && getProviderKey(requested)) return requested;
    const available = getAvailableProviders();
    return available[0] || 'openrouter';
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
        model: normalizeModelForProvider(settings.model, settings.provider),
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

function providerStatus(configured, extraStatus) {
    if (extraStatus) return extraStatus;
    return configured ? 'ready' : 'missing_key';
}

function secretState(envNames, configured, extra = {}) {
    return {
        env: envNames,
        configured: Boolean(configured),
        status: providerStatus(Boolean(configured), extra.status),
        ...extra
    };
}

function hasKieSunoCallback() {
    if (process.env.KIE_SUNO_CALLBACK_URL) return true;
    return Boolean((process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL) && process.env.KIE_CALLBACK_SECRET);
}

async function getAIProviderDiagnostics() {
    const [chatConfig, guardianConfig] = await Promise.all([
        getUnifiedAIConfig({ scope: 'chat_ai' }),
        getUnifiedAIConfig({ scope: 'guardian_ai' })
    ]);
    const openRouterConfigured = Boolean(getProviderKey('openrouter'));
    const openAIConfigured = Boolean(process.env.OPENAI_API_KEY);
    const kieConfigured = Boolean(process.env.KIE_API_KEY);
    const kieSunoCallbackConfigured = hasKieSunoCallback();

    return {
        generatedAt: new Date().toISOString(),
        policy: {
            crmAssistantRail: 'openai_direct',
            sharedTextRails: 'openrouter',
            mediaGeneration: 'kie',
            note: 'Chat/Guardian/Copilot/summary token rails use OpenRouter. CRM assistant rail and menu AI review remain direct OpenAI by product decision.'
        },
        providers: {
            openrouter: secretState(['OPENROUTER_API_KEY', 'OPENROUTER_KEY'], openRouterConfigured, {
                role: 'shared_text_tokens',
                defaultModel: DEFAULT_MODELS.openrouter
            }),
            openaiAssistant: secretState(['OPENAI_API_KEY'], openAIConfigured, {
                role: 'crm_assistant_and_menu_review',
                model: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini',
                menuModel: process.env.OPENAI_MENU_AI_MODEL || process.env.OPENAI_ASSISTANT_MODEL || 'gpt-5.4-mini'
            }),
            kie: secretState(['KIE_API_KEY'], kieConfigured, {
                role: 'media_generation',
                imageModel: process.env.PROGRAM_ICON_IMAGE_MODEL || 'nano-banana-2',
                soundModel: process.env.KIE_SUNO_MODEL || 'V4_5'
            }),
            kieSunoCallback: secretState(['KIE_SUNO_CALLBACK_URL', 'PUBLIC_BASE_URL', 'APP_BASE_URL', 'KIE_CALLBACK_SECRET'], kieSunoCallbackConfigured, {
                role: 'suno_callback',
                status: kieSunoCallbackConfigured ? 'ready' : 'missing_callback'
            })
        },
        surfaces: [
            {
                id: 'crm_assistant_rail',
                provider: 'openai',
                status: openAIConfigured ? 'ready' : 'missing_key',
                model: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini',
                keyEnv: 'OPENAI_API_KEY',
                boundary: 'kept_direct_openai'
            },
            {
                id: 'menu_ai_review',
                provider: 'openai',
                status: openAIConfigured ? 'ready' : 'missing_key',
                model: process.env.OPENAI_MENU_AI_MODEL || process.env.OPENAI_ASSISTANT_MODEL || 'gpt-5.4-mini',
                keyEnv: 'OPENAI_API_KEY',
                boundary: 'booking_menu_review_only'
            },
            {
                id: 'chat_ai',
                provider: chatConfig.provider,
                status: chatConfig.status,
                model: chatConfig.model,
                keyEnv: 'OPENROUTER_API_KEY'
            },
            {
                id: 'guardian_ai',
                provider: guardianConfig.provider,
                status: guardianConfig.status,
                model: guardianConfig.model,
                keyEnv: 'OPENROUTER_API_KEY'
            },
            {
                id: 'chat_translate',
                provider: 'openrouter',
                status: openRouterConfigured ? 'ready' : 'missing_key',
                model: chatConfig.model || DEFAULT_MODELS.openrouter,
                keyEnv: 'OPENROUTER_API_KEY'
            },
            {
                id: 'manager_copilot',
                provider: 'openrouter',
                status: openRouterConfigured ? 'ready' : 'missing_key',
                model: process.env.COPILOT_MODEL || chatConfig.model || DEFAULT_MODELS.openrouter,
                keyEnv: 'OPENROUTER_API_KEY'
            },
            {
                id: 'kleshnya_chat',
                provider: 'openrouter',
                status: openRouterConfigured ? 'ready' : 'missing_key',
                model: chatConfig.model || DEFAULT_MODELS.openrouter,
                keyEnv: 'OPENROUTER_API_KEY'
            },
            {
                id: 'agent_tracker_summary',
                provider: 'openrouter',
                status: openRouterConfigured ? 'ready' : 'missing_key',
                model: chatConfig.model || DEFAULT_MODELS.openrouter,
                keyEnv: 'OPENROUTER_API_KEY'
            },
            {
                id: 'catalog_trend_analysis',
                provider: 'openrouter',
                status: openRouterConfigured ? 'ready' : 'missing_key',
                model: process.env.CATALOG_TREND_MODEL || 'google/gemini-flash-1.5',
                keyEnv: 'OPENROUTER_API_KEY'
            },
            {
                id: 'omni_lead_assistant',
                provider: 'openrouter',
                status: openRouterConfigured ? 'ready' : 'missing_key',
                model: process.env.OMNI_LEAD_AI_MODEL || DEFAULT_MODELS.openrouter,
                keyEnv: 'OPENROUTER_API_KEY',
                boundary: 'shared_text_rail'
            },
            {
                id: 'program_icon_prompt',
                provider: 'openrouter',
                status: openRouterConfigured ? 'ready' : 'missing_key',
                model: process.env.PROGRAM_ICON_PROMPT_MODEL || 'openai/gpt-5.4-nano',
                keyEnv: 'OPENROUTER_API_KEY'
            },
            {
                id: 'my_day_classification',
                provider: 'openrouter',
                status: openRouterConfigured ? 'ready' : 'missing_key',
                model: process.env.MY_DAY_CLASSIFICATION_MODEL || 'openai/gpt-5.4-nano',
                keyEnv: 'OPENROUTER_API_KEY',
                boundary: 'shared_text_rail'
            },
            {
                id: 'program_icon_image',
                provider: 'kie.ai',
                status: kieConfigured ? 'ready' : 'missing_key',
                model: process.env.PROGRAM_ICON_IMAGE_MODEL || 'nano-banana-2',
                keyEnv: 'KIE_API_KEY'
            },
            {
                id: 'sound_tts',
                provider: 'kie.ai',
                status: kieConfigured ? 'ready' : 'missing_key',
                model: 'elevenlabs/text-to-speech-multilingual-v2',
                keyEnv: 'KIE_API_KEY'
            },
            {
                id: 'sound_music',
                provider: 'kie.ai',
                status: kieConfigured && kieSunoCallbackConfigured ? 'ready' : (kieConfigured ? 'missing_callback' : 'missing_key'),
                model: process.env.KIE_SUNO_MODEL || 'V4_5',
                keyEnv: 'KIE_API_KEY'
            },
            {
                id: 'warehouse_photo_intake',
                provider: 'openai',
                status: openAIConfigured ? 'legacy_direct_exception' : 'missing_key',
                model: process.env.WAREHOUSE_VISION_MODEL || process.env.OPENAI_VISION_MODEL || process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini',
                keyEnv: 'OPENAI_API_KEY',
                migration: 'openrouter_vision_followup'
            }
        ]
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

async function callOpenRouter(config, systemPrompt, userMessage, maxTokens, title, temperature) {
    const numericTemperature = Number(temperature);
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
            ...(Number.isFinite(numericTemperature) ? { temperature: numericTemperature } : {}),
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

async function callUnifiedChatCompletion(options = {}) {
    const config = await getUnifiedAIConfig({ scope: options.scope });
    if (options.model) {
        const overrideModel = normalizeModelForProvider(options.model, config.provider);
        if (overrideModel) config.model = overrideModel;
    }
    if (!config.enabled) {
        return { ok: false, reason: 'disabled', ...publicAIConfig(config) };
    }
    if (!config.keyConfigured) {
        return { ok: false, reason: 'missing_key', ...publicAIConfig(config) };
    }

    const maxTokens = options.maxTokens || 800;
    try {
        const result = await callOpenRouter(config, options.systemPrompt, options.userMessage, maxTokens, options.title, options.temperature);
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
    const [chatConfig, guardianConfig, integrations, providerDiagnostics] = await Promise.all([
        getUnifiedAIConfig({ scope: 'chat_ai' }),
        getUnifiedAIConfig({ scope: 'guardian_ai' }),
        getStoredIntegrationsSettings(),
        getAIProviderDiagnostics()
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
        defaultModels: DEFAULT_MODELS,
        providerDiagnostics
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
    getAIProviderDiagnostics,
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
