/**
 * services/dashboardAssistant.js — CRM rail OpenAI guidance service
 *
 * Server-side only: never expose OPENAI_API_KEY to frontend bundles.
 */
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('DashboardAssistant');
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const SYSTEM_PROMPT_PATH = path.join(process.cwd(), 'prompts', 'crm-assistant-system.md');

function dashboardAssistantError(code, status = 500, message = code) {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    return err;
}

function requireOpenAIKey() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
        throw dashboardAssistantError('openai_not_configured', 503, 'OPENAI_API_KEY is not configured');
    }
    return key;
}

function loadDashboardAssistantInstructions() {
    try {
        return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
    } catch (err) {
        log.warn('Instruction pack missing; using fallback prompt', { path: SYSTEM_PROMPT_PATH, error: err.message });
        return [
            'Ти — CRM-провідник Event Genix.',
            'Пояснюй коротко, по суті, без води.',
            'Працюй як in-product assistant для глобального CRM rail.',
            'Давай guidance з урахуванням ролі, сторінки і поточного контексту.'
        ].join('\n');
    }
}

function compactString(value, limit = 1600) {
    return String(value || '').trim().slice(0, limit);
}

function compactList(value, limit = 30) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => compactString(item, 80))
        .filter(Boolean)
        .slice(0, limit);
}

function buildAssistantContext(input = {}) {
    const recentState = input.recentState && typeof input.recentState === 'object' ? input.recentState : {};
    return {
        role: compactString(input.role, 80) || 'unknown',
        displayRole: compactString(input.displayRole, 120),
        page: compactString(input.page, 80) || 'dashboard',
        title: compactString(input.title, 160),
        view: compactString(input.view, 120),
        intent: compactString(input.intent, 700),
        proactive: input.proactive === true,
        activeTab: compactString(input.activeTab, 120),
        badges: compactList(input.badges, 12),
        widgets: compactList(input.widgets),
        scenePreset: compactString(input.scenePreset, 120),
        sceneTitle: compactString(input.sceneTitle, 160),
        voiceMode: input.voiceMode === true,
        recentState: {
            mode: compactString(recentState.mode, 40),
            voiceEnabled: recentState.voiceEnabled === true,
            previewRole: compactString(recentState.previewRole, 80)
        },
        userMessage: compactString(input.userMessage, 1800) || compactString(input.intent, 700) || 'Поясни, що зараз найважливіше на цій CRM-сторінці.'
    };
}

function extractResponseText(response) {
    if (response && typeof response.output_text === 'string' && response.output_text.trim()) {
        return response.output_text.trim();
    }

    const chunks = [];
    for (const item of response?.output || []) {
        for (const content of item?.content || []) {
            if (typeof content?.text === 'string') chunks.push(content.text);
            if (typeof content?.output_text === 'string') chunks.push(content.output_text);
        }
    }
    return chunks.join('\n').trim();
}

async function getDashboardAssistantReply(input = {}) {
    const apiKey = requireOpenAIKey();
    const instructions = loadDashboardAssistantInstructions();
    const context = buildAssistantContext(input);
    const model = process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini';

    const response = await fetch(`${OPENAI_API_BASE}/responses`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            input: [
                { role: 'system', content: instructions },
                {
                    role: 'user',
                    content: [
                        'Контекст CRM assistant rail. Дай коротку in-product підказку українською.',
                        JSON.stringify(context, null, 2)
                    ].join('\n\n')
                }
            ],
            temperature: 0.45,
            max_output_tokens: 220
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        log.warn('OpenAI reply request failed', {
            status: response.status,
            error: payload?.error?.message || payload?.error || 'unknown'
        });
        throw dashboardAssistantError('assistant_reply_failed', response.status >= 500 ? 502 : response.status, 'OpenAI reply request failed');
    }

    const text = extractResponseText(payload) || 'Поки що не можу сформулювати підказку. Спробуй переформулювати запит.';
    return {
        text,
        subtitle: text,
        mode: 'speaking',
        model
    };
}

module.exports = {
    getDashboardAssistantReply,
    loadDashboardAssistantInstructions,
    buildAssistantContext,
    dashboardAssistantError
};
