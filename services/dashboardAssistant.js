/**
 * services/dashboardAssistant.js — CRM rail OpenAI guidance service
 *
 * Server-side only: never expose OPENAI_API_KEY to frontend bundles.
 */
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const featureRegistry = require('../js/crm-feature-registry');
const {
    normalizePageContext,
    buildPageKnowledgePrompt,
    buildPageKnowledgeDebug,
    buildPageKnowledgeAnswer
} = require('../config/assistant-page-knowledge');
const {
    selectAIProductContext,
    buildAIProductContextPrompt
} = require('./aiProductContext');

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

const ASSISTANT_UI_TEXT_REPLACEMENTS = [
    [/\bShow overdue tasks\b/gi, 'Показати прострочені задачі'],
    [/\bFocus work queue\b/gi, 'Відкрити робочу чергу'],
    [/\bShow reply backlog\b/gi, 'Показати чергу відповідей'],
    [/\bRefresh work queue\b/gi, 'Оновити робочу чергу'],
    [/\bDashboard widget grid\b/gi, 'Сітка віджетів дашборда'],
    [/\bWork queue\b/gi, 'Робоча черга'],
    [/\bwork queue\b/gi, 'робоча черга'],
    [/\bOverdue task pressure\b/gi, 'Тиск прострочених задач'],
    [/\bWaiting reply pressure\b/gi, 'Тиск очікуваних відповідей'],
    [/\bOpen waiting tasks\b/gi, 'Відкрити задачі в очікуванні'],
    [/\bFocus first overdue task\b/gi, 'Показати першу прострочену задачу'],
    [/\bdashboard\.focus-work-queue\b/gi, 'фокус на робочу чергу'],
    [/\bdashboard\.show-overdue-tasks\b/gi, 'фільтр прострочених задач'],
    [/\bdashboard\.show-reply-backlog\b/gi, 'черга відповідей'],
    [/\btasks\.focus-overdue\b/gi, 'прострочені задачі'],
    [/\bfinance\.open-debts\b/gi, 'борги'],
    [/\bleads\.focus-hot\b/gi, 'гарячі ліди'],
    [/\bchat\.filter-unread\b/gi, 'непрочитані чати'],
    [/\bFILTER\b/g, 'фільтр'],
    [/\bFOCUS\b/g, 'фокус'],
    [/\bteam_online\b/g, 'Команда онлайн'],
    [/\bstaff_today\b/g, 'Хто на зміні'],
    [/\bdashboard\b/gi, 'дашборд'],
    [/\bcreator\b/gi, 'роль творця']
];

function localizeAssistantText(value) {
    let text = compactString(value, 2000);
    if (!text) return '';
    ASSISTANT_UI_TEXT_REPLACEMENTS.forEach(([pattern, replacement]) => {
        text = text.replace(pattern, replacement);
    });
    return text;
}

function shouldLocalizeRecordKey(key = '') {
    return /label|title|text|evidence|reason|message|summary|recommendation|description|fallback/i.test(String(key));
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
            out[key] = typeof raw === 'string'
                ? compactString(shouldLocalizeRecordKey(key) ? localizeAssistantText(raw) : raw, 240)
                : compactString(raw, 240);
        }
    }
    return Object.keys(out).length ? out : null;
}

function compactRecordList(value, limit = 12) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => {
            if (typeof item === 'string') return { label: compactString(localizeAssistantText(item), 180) };
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

function isTaskSummaryQuestion(message = '') {
    const text = String(message || '').toLowerCase();
    if (!text) return false;
    return [
        /задач/,
        /task/,
        /tasks/,
        /нотатку/,
        /нотатк/,
        /зведенн/,
        /сводк/,
        /summary/,
        /brief/,
        /останні/,
        /останні\s+додані/,
        /нові/,
        /мої/,
        /поставив/,
        /поставлен/
    ].some(pattern => pattern.test(text));
}

function isTaskContextQuestion(context = {}) {
    if (isTaskDetailQuestion(context.userMessage) || isTaskSummaryQuestion(context.userMessage)) return true;
    return String(context.page || '').toLowerCase() === 'tasks';
}

function isDirectTaskAnswerQuestion(context = {}) {
    return isTaskDetailQuestion(context.userMessage) || isTaskSummaryQuestion(context.userMessage);
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
    const createdBy = compactString(row.created_by_name || row.created_by_username || row.created_by, 80);
    return {
        id: row.id,
        title: compactString(row.title || 'Задача', 180),
        status: compactString(row.status || 'todo', 40),
        priority: compactString(row.priority || 'normal', 40),
        category: compactString(row.category || '', 60),
        owner,
        ownerUserId: row.owner_user_id || null,
        createdBy,
        createdByUserId: row.created_by_user_id || null,
        createdAt: row.created_at || null,
        dueLabel: formatTaskDue(row),
        sourceType: compactString(row.source_type || '', 60),
        sourceId: compactString(row.source_id || '', 80)
    };
}

function actorFromContext(context = {}) {
    return {
        id: context.userId || context.actor?.id || context.roleSnapshot?.userId || null,
        userId: context.userId || context.actor?.userId || context.roleSnapshot?.userId || null,
        username: context.username || context.actor?.username || context.roleSnapshot?.username || '',
        name: context.name || context.displayName || context.actor?.name || context.roleSnapshot?.name || '',
        role: context.role || ''
    };
}

function actorIdSet(actor = {}) {
    return new Set([actor.id, actor.userId].map(value => Number(value || 0)).filter(value => Number.isInteger(value) && value > 0));
}

function actorTokenSet(actor = {}) {
    return new Set([actor.username, actor.name, actor.id, actor.userId]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean));
}

function rowMatchesActorOwner(row = {}, actor = {}) {
    const ids = actorIdSet(actor);
    const ownerId = Number(row.owner_user_id || 0);
    if (ownerId > 0) return ids.has(ownerId);
    const tokens = actorTokenSet(actor);
    return [row.assigned_to, row.owner, row.owner_name, row.owner_username]
        .map(value => String(value || '').trim().toLowerCase())
        .some(value => value && tokens.has(value));
}

function rowMatchesActorCreator(row = {}, actor = {}) {
    const ids = actorIdSet(actor);
    const creatorId = Number(row.created_by_user_id || 0);
    if (creatorId > 0 && ids.has(creatorId)) return true;
    const tokens = actorTokenSet(actor);
    return [row.created_by, row.created_by_name, row.created_by_username]
        .map(value => String(value || '').trim().toLowerCase())
        .some(value => value && tokens.has(value));
}

function newestTaskTime(task = {}) {
    const parsed = new Date(task.createdAt || task.created_at || task.updated_at || task.deadline || task.date || 0).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
}

function operationalTaskTime(task = {}) {
    const parsed = new Date(task.deadline || task.date || task.createdAt || task.created_at || 0).getTime();
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function taskPriorityRank(priority = '') {
    const key = String(priority || '').toLowerCase();
    if (key === 'critical') return 0;
    if (key === 'high') return 1;
    if (key === 'normal' || key === 'medium') return 2;
    if (key === 'low') return 3;
    return 4;
}

function sortNewestTasks(tasks = []) {
    return tasks.slice().sort((a, b) => newestTaskTime(b) - newestTaskTime(a));
}

function sortOperationalTasks(tasks = []) {
    return tasks.slice().sort((a, b) => {
        const aOverdue = a.dueLabel && operationalTaskTime(a) < Date.now() ? 0 : 1;
        const bOverdue = b.dueLabel && operationalTaskTime(b) < Date.now() ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
        const priority = taskPriorityRank(a.priority) - taskPriorityRank(b.priority);
        if (priority) return priority;
        return operationalTaskTime(a) - operationalTaskTime(b);
    });
}

function uniqueTasks(lists = [], limit = 12) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        for (const task of list || []) {
            const key = String(task.id || task.title || '');
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(task);
            if (out.length >= limit) return out;
        }
    }
    return out;
}

async function loadVisibleTaskDetails(context = {}) {
    if (!isTaskContextQuestion(context)) return null;
    const params = [];
    const actor = actorFromContext(context);
    const visibility = getTaskVisibilityScope(actor, params, 't');
    const query = `
        SELECT t.id, t.title, t.status, t.priority, t.deadline, t.date, t.category,
               t.created_at, t.created_by, t.created_by_user_id,
               t.assigned_to, t.owner, t.owner_user_id, t.source_type, t.source_id,
               u.name AS owner_name, u.username AS owner_username,
               creator.name AS created_by_name, creator.username AS created_by_username
        FROM tasks t
        LEFT JOIN users u ON u.id = t.owner_user_id
        LEFT JOIN users creator ON creator.id = t.created_by_user_id
        WHERE COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')
          ${visibility}
        ORDER BY
          t.created_at DESC NULLS LAST,
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
        LIMIT 80
    `;
    const result = await getDbPool().query(query, params);
    const rows = result.rows || [];
    const normalizedRows = rows.map(normalizeTaskDetailRow);
    const recent = sortNewestTasks(normalizedRows).slice(0, 6);
    const mine = sortOperationalTasks(normalizedRows.filter((task, index) => rowMatchesActorOwner(rows[index], actor))).slice(0, 6);
    const delegatedByMe = sortNewestTasks(normalizedRows.filter((task, index) =>
        rowMatchesActorCreator(rows[index], actor) && !rowMatchesActorOwner(rows[index], actor)
    )).slice(0, 6);
    return {
        requested: true,
        intent: isTaskDetailQuestion(context.userMessage) ? 'details' : 'summary',
        source: 'api:/api/tasks',
        items: uniqueTasks([mine, delegatedByMe, recent], 18),
        recent,
        mine,
        delegatedByMe,
        counts: {
            visibleActive: normalizedRows.length,
            recent: recent.length,
            mine: mine.length,
            delegatedByMe: delegatedByMe.length
        }
    };
}

function mergeTaskDetailsIntoContext(context = {}, taskDetails = null) {
    if (!taskDetails) return context;
    const details = Array.isArray(context.contextSummary?.details) ? context.contextSummary.details.slice(0, 12) : [];
    const recentTitles = (taskDetails.recent || []).map(item => item.title).join(' | ') || 'none';
    const mineTitles = (taskDetails.mine || []).map(item => item.title).join(' | ') || 'none';
    const delegatedTitles = (taskDetails.delegatedByMe || []).map(item => item.title).join(' | ') || 'none';
    details.push(`recentTaskTitles=${recentTitles}`);
    details.push(`myTaskTitles=${mineTitles}`);
    details.push(`delegatedByMeTaskTitles=${delegatedTitles}`);
    context.contextSummary = {
        ...(context.contextSummary || {}),
        headline: context.contextSummary?.headline || 'Assistant task summary scope',
        details,
        source: context.contextSummary?.source || taskDetails.source
    };
    context.taskDetails = taskDetails;
    context.signals = Array.isArray(context.signals) ? context.signals.slice(0, 16) : [];
    context.signals.push({
        signalId: 'assistant.requested_task_details',
        label: 'User asked for task context',
        value: taskDetails.counts?.visibleActive || taskDetails.items.length,
        severity: taskDetails.items.length ? 'info' : 'warning',
        evidence: taskDetails.items.length
            ? `Користувач питає задачі; бачу ${taskDetails.counts?.visibleActive || taskDetails.items.length} активних, ${taskDetails.mine?.length || 0} моїх і ${taskDetails.delegatedByMe?.length || 0} поставлених ним.`
            : 'Користувач питає задачі, але видимий список порожній.',
        source: taskDetails.source
    });
    return context;
}

async function enrichAssistantContext(context = {}) {
    if (!isTaskContextQuestion(context)) return context;
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
    if (!taskDetails?.requested || !isDirectTaskAnswerQuestion(context)) return null;
    const recent = Array.isArray(taskDetails.recent) ? taskDetails.recent.slice(0, 5) : [];
    const mine = Array.isArray(taskDetails.mine) ? taskDetails.mine.slice(0, 5) : [];
    const delegatedByMe = Array.isArray(taskDetails.delegatedByMe) ? taskDetails.delegatedByMe.slice(0, 5) : [];
    const items = Array.isArray(taskDetails.items) ? taskDetails.items.slice(0, 8) : [];
    if (!items.length && !recent.length && !mine.length && !delegatedByMe.length) {
        return {
            summary: taskDetails.unavailableReason
                ? 'Я бачу твій запит по конкретних задачах, але зараз не можу підтягнути список задач із API. Краще відкрити вкладку «Задачі» і перевірити активний зріз напряму.'
                : 'Зараз у видимому для тебе зрізі не бачу активних задач: немає нових активних, моїх або поставлених тобою задач.',
            evidence: context.signals || [],
            recommendation: 'Наступний крок — відкрити сторінку «Задачі» або уточнити потрібний зріз: нові, мої чи поставлені мною.'
        };
    }
    const formatLines = (list = []) => list.map((task, index) => {
        const meta = [
            task.owner ? `відповідальний: ${task.owner}` : '',
            task.createdBy ? `поставив: ${task.createdBy}` : '',
            task.dueLabel ? `термін: ${task.dueLabel}` : '',
            task.priority && task.priority !== 'normal' ? `пріоритет: ${task.priority}` : ''
        ].filter(Boolean).join(', ');
        return `${index + 1}. ${task.title}${meta ? ` — ${meta}` : ''}`;
    });
    const sections = [];
    if (recent.length) sections.push(`Останні додані:\n${formatLines(recent).join('\n')}`);
    if (mine.length) sections.push(`Мої активні:\n${formatLines(mine).join('\n')}`);
    if (delegatedByMe.length) sections.push(`Поставлені мною:\n${formatLines(delegatedByMe).join('\n')}`);
    if (!sections.length && items.length) sections.push(`Активні задачі:\n${formatLines(items).join('\n')}`);
    const more = (taskDetails.counts?.visibleActive || taskDetails.items.length) > items.length
        ? `\nБачу ще активні задачі поза цією короткою нотаткою; можу деталізувати конкретний зріз.`
        : '';
    const firstFocus = mine[0] || delegatedByMe[0] || recent[0] || items[0];
    return {
        summary: `Коротка нотатка по задачах:\n${sections.join('\n\n')}${more}`,
        evidence: context.signals || [],
        recommendation: `Для наступного кроку почни з найближчої твоєї або поставленої тобою задачі: ${firstFocus.title}.`
    };
}

function isFeatureLocatorQuestion(message = '') {
    const text = featureRegistry.normalizeFeatureText(message);
    if (!text) return false;
    const hasLocatorIntent = /(де|куди|знайти|підкажи|покажи|відкрити|відкрий|можливість|функц|where|find|open)/i.test(text);
    const matches = featureRegistry.searchCrmFeatures(message, { limit: 1, minScore: hasLocatorIntent ? 45 : 88 });
    return hasLocatorIntent && matches.length > 0;
}

function buildFeatureLocatorContext(message = '') {
    const matches = featureRegistry.searchCrmFeatures(message, { limit: 4, minScore: 45 });
    if (!matches.length) return null;
    return {
        source: 'crm-feature-registry',
        query: compactString(message, 180),
        matches: matches.map(feature => ({
            id: feature.id,
            title: feature.title,
            href: feature.href,
            breadcrumb: feature.breadcrumb,
            summary: feature.summary,
            primaryAction: feature.primaryAction,
            score: feature.score
        }))
    };
}

function buildDirectFeatureLocatorReply(context = {}) {
    if (!isFeatureLocatorQuestion(context.userMessage)) return null;
    const locator = context.featureLocator || buildFeatureLocatorContext(context.userMessage);
    const primary = locator?.matches?.[0];
    if (!primary) return null;
    const alternatives = (locator.matches || []).slice(1, 3)
        .map(item => `${item.breadcrumb || item.title} (${item.href})`)
        .join('; ');
    const altText = alternatives ? ` Якщо це не той сценарій, поруч є: ${alternatives}.` : '';
    return {
        summary: `${primary.title} знаходиться тут: ${primary.breadcrumb || primary.title}. Відкрий ${primary.href}.${altText}`,
        evidence: [{
            label: 'CRM feature registry',
            source: 'js/crm-feature-registry.js',
            evidence: `Запит зіставлено з ${primary.id}: ${primary.summary || primary.title}.`
        }],
        recommendation: primary.summary
            ? `${primary.summary} Найшвидший крок — ${primary.primaryAction || 'відкрити сторінку'}.`
            : `Найшвидший крок — відкрити ${primary.href}.`,
        actionProposal: {
            actionId: 'assistant.navigate',
            actionType: 'navigate',
            label: primary.primaryAction || `Відкрити ${primary.title}`,
            payload: { href: primary.href, pageId: primary.href.replace(/^\//, '').split(/[?#]/)[0] || 'timeline' },
            confirmationNeeded: false
        },
        confidence: 'high',
        riskLevel: 'none'
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
    const pageContext = normalizePageContext({
        ...(input.pageContext && typeof input.pageContext === 'object' ? input.pageContext : {}),
        pageKey: input.pageContext?.pageKey || input.page || input.pageKey,
        pathname: input.pageContext?.pathname || input.pathname || input.path,
        pageTitle: input.pageContext?.pageTitle || input.title,
        activeTab: input.pageContext?.activeTab || input.activeTab || input.view,
        selectedEntity: input.pageContext?.selectedEntity || input.selectedEntity,
        selectedEntityId: input.pageContext?.selectedEntityId || input.selectedEntityId,
        activeFilters: input.pageContext?.activeFilters || input.activeFilters || input.filters,
        relatedPageHints: input.pageContext?.relatedPageHints || input.relatedPageHints
    });
    const pageKnowledgeDebug = buildPageKnowledgeDebug(pageContext);
    const aiProductContext = selectAIProductContext({
        ...input,
        page: pageContext.pageKey,
        pageContext
    });
    const context = {
        role: compactString(input.role, 80) || 'unknown',
        displayRole: compactString(input.displayRole, 120),
        page: pageContext.pageKey,
        pageContext,
        pageKnowledge: pageKnowledgeDebug.knowledge,
        pageKnowledgePrompt: buildPageKnowledgePrompt(pageContext),
        aiProductContext,
        aiProductContextPrompt: buildAIProductContextPrompt(aiProductContext),
        title: compactString(input.title || pageContext.pageTitle, 160),
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
    context.featureLocator = buildFeatureLocatorContext(context.userMessage);
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
    const summary = compactString(localizeAssistantText(source.summary || source.subtitle || source.text || source.message || source.recommendation), 900)
        || 'Поки що не можу сформулювати підказку. Спробуй переформулювати запит.';
    const evidence = compactRecordList(source.evidence?.length ? source.evidence : (context.evidence?.length ? context.evidence : context.signals), 8);
    const actionProposal = source.actionProposal || context.actionProposal || (Array.isArray(context.actions) ? context.actions[0] : null) || null;
    const teachingTarget = source.teachingTarget || context.teachingTarget || (Array.isArray(context.teachingTargets) ? context.teachingTargets.find(target => target.available !== false) : null) || null;
    const normalizedActionProposal = actionProposal && typeof actionProposal === 'object'
        ? {
            ...actionProposal,
            label: localizeAssistantText(actionProposal.label || actionProposal.title || ''),
            failureMessage: localizeAssistantText(actionProposal.failureMessage || '')
        }
        : actionProposal;
    const normalizedTeachingTarget = teachingTarget && typeof teachingTarget === 'object'
        ? {
            ...teachingTarget,
            label: localizeAssistantText(teachingTarget.label || teachingTarget.title || ''),
            reason: localizeAssistantText(teachingTarget.reason || ''),
            fallbackText: localizeAssistantText(teachingTarget.fallbackText || '')
        }
        : teachingTarget;
    return {
        mode: extra.mode || source.mode || 'speaking',
        summary,
        text: summary,
        subtitle: summary,
        evidence,
        riskLevel: extra.riskLevel || source.riskLevel || inferRiskLevel(context),
        confidence: source.confidence || (evidence.length ? 'medium' : 'low'),
        recommendation: compactString(localizeAssistantText(source.recommendation || buildStrategicRecommendation(context, summary)), 900),
        actionProposal: normalizedActionProposal,
        teachingTarget: normalizedTeachingTarget,
        fallbackReason: localizeAssistantText(source.fallbackReason || context.fallbackReason || ''),
        model: extra.model || source.model || ''
    };
}

async function getDashboardAssistantReply(input = {}) {
    const instructions = loadDashboardAssistantInstructions();
    const context = await enrichAssistantContext(buildAssistantContext(input));
    if (process.env.NODE_ENV !== 'production') {
        log.debug('assistant_page_context', buildPageKnowledgeDebug(context.pageContext));
    }
    const directReply = buildDirectTaskDetailsReply(context);
    if (directReply) {
        return normalizeAssistantReply(directReply, context, { model: 'local-task-context', mode: 'speaking' });
    }
    const featureReply = buildDirectFeatureLocatorReply(context);
    if (featureReply) {
        return normalizeAssistantReply(featureReply, context, { model: 'local-feature-locator', mode: 'speaking' });
    }
    const pageKnowledgeReply = buildPageKnowledgeAnswer(context.userMessage, context.pageContext);
    if (pageKnowledgeReply) {
        return normalizeAssistantReply(pageKnowledgeReply, context, { model: 'local-page-knowledge', mode: 'speaking' });
    }
    const apiKey = requireOpenAIKey();
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
                        'Мова відповіді: відповідай українською або мовою користувача. Не показуй технічні id, enum, actionId чи widget keys на кшталт team_online, staff_today, dashboard.focus-work-queue, FILTER. Перекладай їх у людські назви: «Команда онлайн», «Хто на зміні», «робоча черга», «фільтр».',
                        `Поточне повідомлення користувача: ${context.userMessage}`,
                        context.pageKnowledgePrompt,
                        context.aiProductContextPrompt,
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
    buildPageKnowledgePrompt,
    buildPageKnowledgeDebug,
    buildDirectFeatureLocatorReply,
    normalizeAssistantReply,
    getAssistantProviderBoundary,
    selectAIProductContext,
    buildAIProductContextPrompt,
    dashboardAssistantError
};
