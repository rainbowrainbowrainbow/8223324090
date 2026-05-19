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

function compactChatHistory(value, limit = 14) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => {
            const role = String(item?.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
            const text = compactString(item?.text || item?.content, 500);
            if (!text) return null;
            return {
                role,
                text,
                at: compactString(item?.at || item?.createdAt, 80)
            };
        })
        .filter(Boolean)
        .slice(-limit);
}

function isTaskDetailQuestion(message = '') {
    const text = String(message || '').toLowerCase();
    if (!text) return false;
    return [
        /які\s+саме\s+задач/,
        /які\s+задач/,
        /що\s+за\s+задач/,
        /список\s+задач/,
        /переліч(и|ити).*задач/,
        /конкретн.*задач/,
        /какие\s+задач/,
        /какие\s+именно\s+задач/,
        /which\s+tasks/,
        /what\s+tasks/,
        /list\s+tasks/,
        /show\s+tasks/
    ].some(pattern => pattern.test(text));
}

function getDbPool() {
    return require('../db').pool;
}

function getTaskVisibilityScope(user, params, alias = 't') {
    return require('./taskPolicy').buildTaskVisibilityScope(user, params, alias);
}

function formatTaskDue(row = {}) {
    const raw = row.deadline || row.date || '';
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return String(raw).slice(0, 16);
    try {
        return date.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kyiv',
            day: '2-digit',
            month: '2-digit',
            hour: row.deadline ? '2-digit' : undefined,
            minute: row.deadline ? '2-digit' : undefined
        }).replace(',', '');
    } catch {
        return String(raw).slice(0, 16);
    }
}

function normalizeTaskDetailRow(row = {}) {
    const owner = compactString(row.owner_name || row.owner_username || row.assigned_to || row.owner, 80);
    return {
        id: row.id,
        title: compactString(row.title || 'Задача', 180),
        status: compactString(row.status || 'todo', 40),
        priority: compactString(row.priority || 'normal', 40),
        category: compactString(row.category || '', 60),
        owner,
        dueLabel: formatTaskDue(row),
        sourceType: compactString(row.source_type || '', 60),
        sourceId: compactString(row.source_id || '', 80)
    };
}

async function loadVisibleTaskDetails(context = {}) {
    if (!isTaskDetailQuestion(context.userMessage)) return null;
    const params = [];
    const actor = {
        id: context.userId || context.actor?.id || context.roleSnapshot?.userId || null,
        userId: context.userId || context.actor?.userId || context.roleSnapshot?.userId || null,
        username: context.username || context.actor?.username || context.roleSnapshot?.username || '',
        name: context.name || context.displayName || context.actor?.name || context.roleSnapshot?.name || '',
        role: context.role || ''
    };
    const visibility = getTaskVisibilityScope(actor, params, 't');
    const query = `
        SELECT t.id, t.title, t.status, t.priority, t.deadline, t.date, t.category,
               t.assigned_to, t.owner, t.owner_user_id, t.source_type, t.source_id,
               u.name AS owner_name, u.username AS owner_username
        FROM tasks t
        LEFT JOIN users u ON u.id = t.owner_user_id
        WHERE COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
          ${visibility}
        ORDER BY
          CASE
            WHEN (t.deadline IS NOT NULL AND t.deadline < NOW())
              OR (t.deadline IS NULL AND LEFT(COALESCE(t.date, ''), 10) < TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'))
            THEN 0 ELSE 1
          END,
          COALESCE(
            t.deadline,
            CASE WHEN COALESCE(t.date, '') ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(t.date, 10)::timestamp ELSE NULL END,
            t.created_at
          ) ASC NULLS LAST,
          CASE COALESCE(t.priority, 'normal')
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
            ELSE 4
          END,
          t.created_at DESC
        LIMIT 12
    `;
    const result = await getDbPool().query(query, params);
    return {
        requested: true,
        source: 'api:/api/tasks',
        items: result.rows.map(normalizeTaskDetailRow)
    };
}

function mergeTaskDetailsIntoContext(context = {}, taskDetails = null) {
    if (!taskDetails) return context;
    const details = Array.isArray(context.contextSummary?.details) ? context.contextSummary.details.slice(0, 12) : [];
    if (taskDetails.items.length) {
        details.push(`visibleTaskTitles=${taskDetails.items.map(item => item.title).join(' | ')}`);
    } else {
        details.push('visibleTaskTitles=none');
    }
    context.contextSummary = {
        ...(context.contextSummary || {}),
        headline: context.contextSummary?.headline || 'Assistant requested task details',
        details,
        source: context.contextSummary?.source || taskDetails.source
    };
    context.taskDetails = taskDetails;
    context.signals = Array.isArray(context.signals) ? context.signals.slice(0, 16) : [];
    context.signals.push({
        signalId: 'assistant.requested_task_details',
        label: 'User asked for exact visible tasks',
        value: taskDetails.items.length,
        severity: taskDetails.items.length ? 'info' : 'warning',
        evidence: taskDetails.items.length
            ? `Користувач питає конкретні задачі; видно ${taskDetails.items.length}.`
            : 'Користувач питає конкретні задачі, але видимий список порожній.',
        source: taskDetails.source
    });
    return context;
}

async function enrichAssistantContext(context = {}) {
    if (!isTaskDetailQuestion(context.userMessage)) return context;
    try {
        return mergeTaskDetailsIntoContext(context, await loadVisibleTaskDetails(context));
    } catch (err) {
        log.warn('Unable to load task details for assistant answer', { error: err.message });
        context.taskDetails = {
            requested: true,
            source: 'api:/api/tasks',
            items: [],
            unavailableReason: compactString(err.message || err, 180)
        };
        context.fallbackReason = compactString(context.fallbackReason || 'task_details_unavailable', 240);
        return context;
    }
}

function buildDirectTaskDetailsReply(context = {}) {
    const taskDetails = context.taskDetails;
    if (!taskDetails?.requested || !isTaskDetailQuestion(context.userMessage)) return null;
    const items = Array.isArray(taskDetails.items) ? taskDetails.items.slice(0, 8) : [];
    if (!items.length) {
        return {
            summary: taskDetails.unavailableReason
                ? 'Я бачу твій запит по конкретних задачах, але зараз не можу підтягнути список задач із API. Краще відкрити вкладку «Задачі» і перевірити активний зріз напряму.'
                : 'Зараз у видимому для тебе зрізі не бачу активних задач. Якщо очікуєш список, відкрий «Задачі» або уточни фільтр: мої, команда, сьогодні чи прострочені.',
            evidence: context.signals || [],
            recommendation: 'Наступний крок — відкрити сторінку «Задачі» або уточнити потрібний зріз.'
        };
    }
    const lines = items.map((task, index) => {
        const meta = [
            task.owner ? `відповідальний: ${task.owner}` : '',
            task.dueLabel ? `термін: ${task.dueLabel}` : '',
            task.priority && task.priority !== 'normal' ? `пріоритет: ${task.priority}` : ''
        ].filter(Boolean).join(', ');
        return `${index + 1}. ${task.title}${meta ? ` — ${meta}` : ''}`;
    });
    const more = taskDetails.items.length > items.length ? `\nЩе ${taskDetails.items.length - items.length} задач(і) не показую, щоб не забити панель.` : '';
    return {
        summary: `Ось конкретні активні задачі, які зараз бачу:\n${lines.join('\n')}${more}`,
        evidence: context.signals || [],
        recommendation: `Почни з першої простроченої або найстарішої задачі: ${items[0].title}.`
    };
}

function pageStrategicAngle(page = '') {
    const key = String(page || '').toLowerCase();
    if (key === 'dashboard') return 'bottlenecks, пріоритети і контроль операційної черги';
    if (key === 'tasks') return 'прострочки, власник, дедлайн і одна наступна дія';
    if (key === 'finance') return 'борги, cashflow, P&L і контроль оплат';
    if (key === 'chat') return 'розмови, що чекають відповіді або рішення';
    if (key === 'leads' || key === 'sales-funnel') return 'follow-up, гарячі ліди і наступна комунікація';
    if (key === 'staff' || key === 'hr') return 'люди, графік, зміни і конфлікти';
    if (key === 'warehouse') return 'залишки, низький сток і рух товарів';
    return 'найсильніший видимий CRM-сигнал і безпечна дія';
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

function buildStrategicFrame(context = {}) {
    const role = context.roleSnapshot?.permissionRole || context.role || '';
    const page = context.page || 'dashboard';
    return `${roleStrategicFrame(role)}; фокус сторінки — ${pageStrategicAngle(page)}.`;
}

function buildAssistantContext(input = {}) {
    const recentState = input.recentState && typeof input.recentState === 'object' ? input.recentState : {};
    const context = {
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
        sourceSurface: compactString(input.sourceSurface, 80),
        assistantConversationId: compactString(input.conversationId || input.assistantConversationId, 120),
        userId: input.userId || input.actor?.id || null,
        username: compactString(input.username || input.actor?.username, 120),
        name: compactString(input.name || input.displayName || input.actor?.name, 160),
        chatHistory: compactChatHistory(input.chatHistory || recentState.chatHistory || recentState.assistantChatHistory),
        recentState: {
            mode: compactString(recentState.mode, 40),
            voiceEnabled: recentState.voiceEnabled === true,
            previewRole: compactString(recentState.previewRole, 80)
        },
        userMessage: compactString(input.userMessage, 1800) || compactString(input.intent, 700) || 'Поясни, що зараз найважливіше на цій CRM-сторінці.'
    };
    context.strategicFrame = buildStrategicFrame(context);
    context.pagePriority = pageStrategicAngle(context.page);
    return context;
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

function buildStrategicRecommendation(context = {}, summary = '') {
    const signals = Array.isArray(context.signals) && context.signals.length ? context.signals : context.evidence || [];
    const strongest = signals.slice().sort((a, b) => rankSignal(b) - rankSignal(a))[0] || null;
    const action = context.actionProposal || (Array.isArray(context.actions) ? context.actions[0] : null);
    const role = context.roleSnapshot?.permissionRole || context.role || '';
    const frame = buildStrategicFrame({ ...context, role });
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
    const context = await enrichAssistantContext(buildAssistantContext(input));
    const directReply = buildDirectTaskDetailsReply(context);
    if (directReply) {
        return normalizeAssistantReply(directReply, context, { model: 'local-task-context', mode: 'speaking' });
    }
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
                        `Поточне повідомлення користувача: ${context.userMessage}`,
                        'Відповідай саме на це повідомлення. Якщо користувач просить конкретику або список, не повторюй загальний briefing: використовуй taskDetails, chatHistory, contextSummary та evidence з JSON нижче.',
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
