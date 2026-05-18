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
const ASSISTANT_PROVIDER_SCOPE = 'crm_assistant_rail_openai';

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

function getAssistantProviderBoundary() {
    return {
        scope: ASSISTANT_PROVIDER_SCOPE,
        provider: 'openai',
        keyEnv: 'OPENAI_API_KEY',
        apiBase: OPENAI_API_BASE,
        replyModel: process.env.OPENAI_ASSISTANT_MODEL || 'gpt-4.1-mini',
        note: 'Rail assistant provider path is intentionally separate from Kleshnya and Copilot surfaces.'
    };
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

function compactRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
        if (raw === null || raw === undefined) continue;
        if (['string', 'number', 'boolean'].includes(typeof raw)) {
            out[key] = compactString(raw, 240);
        }
    }
    return Object.keys(out).length ? out : null;
}

function compactRecordList(value, limit = 12) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => {
            if (typeof item === 'string') return { label: compactString(item, 180) };
            return compactRecord(item);
        })
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
        adapterId: compactString(input.adapterId, 80),
        contextSummary: compactRecord(input.contextSummary),
        signals: compactRecordList(input.signals, 16),
        evidence: compactRecordList(input.evidence, 12),
        actions: compactRecordList(input.actions, 16),
        teachingTargets: compactRecordList(input.teachingTargets, 16),
        actionProposal: compactRecord(input.actionProposal),
        teachingTarget: compactRecord(input.teachingTarget),
        fallbackReason: compactString(input.fallbackReason, 240),
        roleSnapshot: compactRecord(input.roleSnapshot),
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

function inferRiskLevel(context = {}) {
    const signals = Array.isArray(context.signals) && context.signals.length ? context.signals : context.evidence || [];
    const severities = signals.map(item => String(item?.severity || '').toLowerCase());
    if (severities.includes('critical')) return 'critical';
    if (severities.includes('danger')) return 'high';
    if (severities.includes('warning')) return 'medium';
    return context.fallbackReason ? 'low' : 'none';
}

function rankSignal(signal = {}) {
    const severity = String(signal.severity || '').toLowerCase();
    if (severity === 'critical') return 5;
    if (severity === 'danger') return 4;
    if (severity === 'warning') return 3;
    if (severity === 'info') return 2;
    return 1;
}

function roleStrategicFrame(role = '') {
    const key = String(role || '').toLowerCase();
    if (key === 'director') return 'Для директора це контроль P&L, ризику і відповідальності';
    if (key === 'manager') return 'Для менеджера це фокус на лідах, задачах і командному тиску';
    if (key === 'hr') return 'Для HR це контроль людей, графіка і конфліктів';
    if (key === 'art_director') return 'Для артдиректора це контроль контенту і production pipeline';
    if (key === 'creator') return 'Для creator це перевірка цілісності CRM-сценарію';
    return 'Операційний висновок';
}

function buildStrategicRecommendation(context = {}, summary = '') {
    const signals = Array.isArray(context.signals) && context.signals.length ? context.signals : context.evidence || [];
    const strongest = signals.slice().sort((a, b) => rankSignal(b) - rankSignal(a))[0] || null;
    const action = context.actionProposal || (Array.isArray(context.actions) ? context.actions[0] : null);
    const role = context.roleSnapshot?.permissionRole || context.role || '';
    const frame = roleStrategicFrame(role);
    const signalText = compactString(strongest?.evidence || strongest?.label || summary, 220);
    if (action?.label && signalText) return `${frame}: ${signalText}. Наступний крок — ${action.label}.`;
    if (signalText) return `${frame}: ${signalText}. Обери один контрольний крок і доведи його до результату.`;
    return summary || 'Почни з найсильнішого видимого CRM-сигналу і однієї безпечної дії.';
}

function normalizeAssistantReply(reply, context = {}, extra = {}) {
    const source = reply && typeof reply === 'object' ? reply : { text: reply };
    const summary = compactString(source.summary || source.subtitle || source.text || source.recommendation, 900)
        || 'Поки що не можу сформулювати підказку. Спробуй переформулювати запит.';
    const evidence = compactRecordList(source.evidence?.length ? source.evidence : (context.evidence?.length ? context.evidence : context.signals), 8);
    const actionProposal = source.actionProposal || context.actionProposal || (Array.isArray(context.actions) ? context.actions[0] : null) || null;
    const teachingTarget = source.teachingTarget || context.teachingTarget || (Array.isArray(context.teachingTargets) ? context.teachingTargets.find(target => target.available !== false) : null) || null;
    return {
        mode: extra.mode || source.mode || 'speaking',
        summary,
        text: summary,
        subtitle: summary,
        evidence,
        riskLevel: extra.riskLevel || source.riskLevel || inferRiskLevel(context),
        confidence: source.confidence || (evidence.length ? 'medium' : 'low'),
        recommendation: compactString(source.recommendation || buildStrategicRecommendation(context, summary), 900),
        actionProposal,
        teachingTarget,
        fallbackReason: source.fallbackReason || context.fallbackReason || '',
        model: extra.model || source.model || ''
    };
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
                        'Формат думки: що бачу → чому це важливо → одна найкраща наступна дія. Не розширюй відповідь, якщо даних мало.',
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
    return normalizeAssistantReply(text, context, { model, mode: 'speaking' });
}

module.exports = {
    getDashboardAssistantReply,
    loadDashboardAssistantInstructions,
    buildAssistantContext,
    normalizeAssistantReply,
    getAssistantProviderBoundary,
    dashboardAssistantError
};
