/**
 * services/kleshnya-chat.js — Kleshnya Smart Chat Engine (v12.8)
 *
 * Hybrid chat system:
 *  1. Claude AI (Haiku) — understands natural language, uses DB context
 *  2. Skill engine fallback — keyword matching when AI unavailable
 *
 * AI mode requires ANTHROPIC_API_KEY env var.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { getVisibleBookingScope } = require('./bookingVisibility');
const {
    normalizePageContext,
    buildPageKnowledgePrompt,
    buildPageKnowledgeDebug,
    buildPageKnowledgeAnswer
} = require('../config/assistant-page-knowledge');
const Anthropic = require('@anthropic-ai/sdk');

const log = createLogger('KleshnyaChat');

// --- AI Engine (Claude Haiku) ---

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AI_ENABLED = !!ANTHROPIC_API_KEY;

let anthropic = null;
if (AI_ENABLED) {
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    log.info('Claude AI enabled for Kleshnya chat');
} else {
    log.info('Claude AI disabled (no ANTHROPIC_API_KEY). Using skill engine fallback.');
}

function actorForBookingScope(username, actor) {
    return actor || { username, name: username };
}

function scopedBookingVisibility(username, actor, params, alias = 'b') {
    return getVisibleBookingScope(actorForBookingScope(username, actor), params, alias);
}

/**
 * Gather extended context for AI system prompt
 */
async function gatherAIContext(username, dateStr, actor = null, pageContext = null) {
    const normalizedPageContext = normalizePageContext(pageContext || {});
    const ctx = {
        pageContext: normalizedPageContext,
        pageKnowledge: buildPageKnowledgeDebug(normalizedPageContext).knowledge,
        pageKnowledgePrompt: buildPageKnowledgePrompt(normalizedPageContext)
    };
    try {
        // Today's bookings
        const todayParams = [dateStr];
        const todayScope = scopedBookingVisibility(username, actor, todayParams, 'b');
        const bookRes = await pool.query(
            `SELECT COUNT(*) cnt, COALESCE(SUM(b.price),0) revenue,
                    COUNT(*) FILTER (WHERE b.status='confirmed') confirmed,
                    COUNT(*) FILTER (WHERE b.status='preliminary') preliminary
             FROM bookings b WHERE b.date = $1 AND (b.linked_to IS NULL OR b.linked_to = '') AND b.status != 'cancelled'
             ${todayScope.sql}`,
            todayParams
        );
        ctx.todayBookings = bookRes.rows[0];

        // Upcoming bookings (next 3 today)
        const upcomingParams = [dateStr];
        const upcomingScope = scopedBookingVisibility(username, actor, upcomingParams, 'b');
        const upcomingRes = await pool.query(
            `SELECT b.time, b.program_name, b.group_name, b.room, b.kids_count, b.price, b.status, b.hosts, b.second_animator
             FROM bookings b WHERE b.date = $1 AND (b.linked_to IS NULL OR b.linked_to = '') AND b.status != 'cancelled'
             ${upcomingScope.sql}
             ORDER BY b.time LIMIT 5`,
            upcomingParams
        );
        ctx.upcomingBookings = upcomingRes.rows;

        // User's tasks
        const tasksRes = await pool.query(
            `SELECT id, title, priority, status, deadline FROM tasks
             WHERE (assigned_to = $1 OR owner = $1) AND status NOT IN ('done')
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END
             LIMIT 10`,
            [username]
        );
        ctx.userTasks = tasksRes.rows;

        // Overdue tasks count
        const overdueRes = await pool.query(
            `SELECT COUNT(*) cnt FROM tasks WHERE status NOT IN ('done') AND deadline < NOW()`
        );
        ctx.overdueTasks = parseInt(overdueRes.rows[0].cnt);

        // Team today
        const teamRes = await pool.query(
            `SELECT s.name, s.department, ss.shift_start, ss.shift_end
             FROM staff s JOIN staff_schedule ss ON s.id = ss.staff_id AND ss.date = $1
             WHERE s.is_active = true AND ss.status = 'working'
             ORDER BY s.department, s.name`,
            [dateStr]
        );
        ctx.teamToday = teamRes.rows;

        // Week revenue
        const weekRange = getKyivWeekRange();
        const weekParams = [weekRange.from, weekRange.to];
        const weekScope = scopedBookingVisibility(username, actor, weekParams, 'b');
        const weekRes = await pool.query(
            `SELECT COUNT(*) cnt, COALESCE(SUM(b.price),0) revenue
             FROM bookings b WHERE b.date >= $1 AND b.date <= $2 AND (b.linked_to IS NULL OR b.linked_to = '') AND b.status = 'confirmed'
             ${weekScope.sql}`,
            weekParams
        );
        ctx.weekStats = weekRes.rows[0];

        // Streak
        const streakRes = await pool.query(
            'SELECT current_streak, longest_streak FROM user_streaks WHERE username = $1',
            [username]
        );
        ctx.streak = streakRes.rows[0] || { current_streak: 0, longest_streak: 0 };

        // Programs catalog summary
        const progsRes = await pool.query(
            `SELECT category, COUNT(*) cnt FROM products WHERE is_active = true GROUP BY category`
        );
        ctx.programCategories = progsRes.rows;

        // Active certificates
        const certsRes = await pool.query(
            `SELECT COUNT(*) cnt FROM certificates WHERE status = 'active'`
        );
        ctx.activeCertificates = parseInt(certsRes.rows[0].cnt);

    } catch (err) {
        log.error('Error gathering AI context', err);
    }
    return ctx;
}

function buildSystemPrompt(ctx, username, dateStr) {
    const dayName = new Date(dateStr + 'T12:00:00').toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'long' });

    return `Ти — Помічник, розумний помічник дитячого розважального парку "Парк Закревського Періоду" (Київ).
Ти відповідаєш ТІЛЬКИ українською мовою. Ти дружній, лаконічний, з легким гумором.
Використовуй емодзі помірно. Відповідай коротко (2-5 речень), якщо не просять деталей.

Сьогодні: ${dateStr} (${dayName})
Користувач: ${username}

=== КОНТЕКСТ (реальні дані з БД) ===

📊 Бронювання сьогодні: ${ctx.todayBookings?.cnt || 0} (підтв: ${ctx.todayBookings?.confirmed || 0}, непідтв: ${ctx.todayBookings?.preliminary || 0})
💰 Виручка сьогодні: ${ctx.todayBookings?.revenue || 0} ₴
${ctx.upcomingBookings?.length > 0 ? 'Найближчі бронювання:\n' + ctx.upcomingBookings.map(b =>
    `  - ${b.time || '?'} ${b.program_name || '?'} ${b.group_name ? '(' + b.group_name + ')' : ''} ${b.hosts > 1 ? '| ' + b.hosts + ' ведучих' : ''} ${b.room ? '| ' + b.room : ''} | ${b.price || 0} ₴`
).join('\n') : 'Бронювань на сьогодні немає.'}

📋 Задачі користувача (активні): ${ctx.userTasks?.length || 0}
${ctx.userTasks?.length > 0 ? ctx.userTasks.map(t =>
    `  - #${t.id} ${t.title} [${t.priority}] ${t.deadline && new Date(t.deadline) < new Date() ? '⏰ ПРОСТРОЧЕНА' : ''}`
).join('\n') : 'Немає активних задач.'}
🔴 Всього прострочених задач: ${ctx.overdueTasks || 0}

👥 Команда на зміні: ${ctx.teamToday?.length || 0}
${ctx.teamToday?.length > 0 ? ctx.teamToday.map(t =>
    `  - ${t.name} (${t.department}) ${t.shift_start || ''}–${t.shift_end || ''}`
).join('\n') : 'Ніхто не на зміні.'}

📈 Статистика тижня: ${ctx.weekStats?.cnt || 0} бронювань, ${ctx.weekStats?.revenue || 0} ₴
🔥 Стрік: ${ctx.streak?.current_streak || 0} днів (рекорд: ${ctx.streak?.longest_streak || 0})
🎭 Програм в каталозі: ${ctx.programCategories?.map(c => c.category + ': ' + c.cnt).join(', ') || 'немає'}
🎫 Активних сертифікатів: ${ctx.activeCertificates || 0}

${ctx.pageKnowledgePrompt || ''}

=== ПРАВИЛА ===
1. Відповідай ТІЛЬКИ на основі наданого контексту. Не вигадуй дані.
2. Якщо даних недостатньо — скажи чесно.
3. Ціни в гривнях (₴), формат "1 000 ₴".
4. Можеш використовувати HTML теги <b>, <i> для форматування.
5. Не пиши код, SQL, JSON — тільки людська відповідь.
6. Якщо питають про щось не повʼязане з парком — ввічливо поверни до теми.
7. Ти можеш рекомендувати дії: "Раджу підтвердити бронювання", "Варто перевірити прострочені задачі".`;
}

function extractSuggestions(responseText) {
    const suggestions = [];
    const lower = responseText.toLowerCase();

    if (lower.includes('бронюван')) suggestions.push('Бронювання на завтра');
    if (lower.includes('задач')) suggestions.push('Мої задачі');
    if (lower.includes('виручк') || lower.includes('фінанс') || lower.includes('₴')) suggestions.push('Виручка за тиждень');
    if (lower.includes('команд') || lower.includes('аніматор') || lower.includes('зміні')) suggestions.push('Хто працює?');
    if (lower.includes('стрік') || lower.includes('бал')) suggestions.push('Мій стрік');
    if (lower.includes('програм') || lower.includes('квест')) suggestions.push('Програми');

    // Always have at least 3 suggestions
    const defaults = ['Бронювання сьогодні', 'Мої задачі', 'Виручка', 'Хто працює?'];
    for (const d of defaults) {
        if (suggestions.length >= 4) break;
        if (!suggestions.includes(d)) suggestions.push(d);
    }

    return suggestions.slice(0, 4);
}

/**
 * Generate AI response via Claude Haiku
 */
async function generateAIResponse(userMessage, username, chatHistory, actor = null, options = {}) {
    if (!AI_ENABLED || !anthropic) return null;

    try {
        const dateStr = getKyivDate(0);
        const ctx = await gatherAIContext(username, dateStr, actor, options.pageContext);
        const systemPrompt = buildSystemPrompt(ctx, username, dateStr);

        // Build messages array from chat history (last 10 messages)
        const messages = [];
        if (chatHistory && chatHistory.length > 0) {
            const recent = chatHistory.slice(-10);
            for (const msg of recent) {
                messages.push({
                    role: msg.role === 'assistant' ? 'assistant' : 'user',
                    content: msg.message
                });
            }
        }
        // Add current user message
        messages.push({ role: 'user', content: userMessage });

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 800,
            system: systemPrompt,
            messages
        });

        const text = response.content[0]?.text;
        if (!text) return null;

        const suggestions = extractSuggestions(text);

        log.info(`AI response for ${username}: ${text.length} chars, ${response.usage?.input_tokens || '?'}+${response.usage?.output_tokens || '?'} tokens`);

        return { message: text, suggestions, source: 'ai' };
    } catch (err) {
        log.error('Claude AI error, falling back to skills', err.message || err);
        return null;
    }
}

// --- Helpers ---

function formatPrice(amount) {
    return (amount || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₴';
}

function getKyivDate(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' }); // YYYY-MM-DD
}

function getKyivWeekRange() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
        from: mon.toISOString().split('T')[0],
        to: sun.toISOString().split('T')[0]
    };
}

function getMonthRange() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return { from: `${y}-${m}-01`, to: `${y}-${m}-31` };
}

function getPrevMonthRange() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
    now.setMonth(now.getMonth() - 1);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return { from: `${y}-${m}-01`, to: `${y}-${m}-31` };
}

const DAY_NAMES = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'п\'ятниця', 'субота'];

function formatDateUkr(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDate();
    const months = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
        'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
    return `${day} ${months[d.getMonth()]}`;
}

/**
 * Parse date intent from message
 */
function parseDateIntent(lower) {
    if (lower.includes('завтра')) return { date: getKyivDate(1), label: 'завтра' };
    if (lower.includes('вчора')) return { date: getKyivDate(-1), label: 'вчора' };
    if (lower.includes('тиждень') || lower.includes('тижн')) {
        const range = getKyivWeekRange();
        return { from: range.from, to: range.to, label: 'цей тиждень' };
    }
    if (lower.includes('місяц') || lower.includes('місяч')) {
        const range = getMonthRange();
        return { from: range.from, to: range.to, label: 'цей місяць' };
    }
    if (lower.includes('вихідн') || lower.includes('вікенд')) {
        const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
        const day = now.getDay();
        const daysToSat = day === 0 ? 6 : (6 - day);
        const sat = new Date(now);
        sat.setDate(now.getDate() + daysToSat);
        const sun = new Date(sat);
        sun.setDate(sat.getDate() + 1);
        return { from: sat.toISOString().split('T')[0], to: sun.toISOString().split('T')[0], label: 'вихідні' };
    }
    // Default: today
    return { date: getKyivDate(0), label: 'сьогодні' };
}

// --- Skills Definition ---

const SKILLS = [
    {
        id: 'help',
        name: 'Допомога',
        icon: '❓',
        description: 'Мої навички та можливості',
        keywords: ['допомог', 'help', 'що вмієш', 'що ти вмієш', 'навич', 'skills', 'уміння', 'можеш', 'функці', 'вмієш'],
        handler: handleHelp,
        examples: ['Що ти вмієш?', 'Допоможи']
    },
    {
        id: 'bookings',
        name: 'Бронювання',
        icon: '📊',
        description: 'Статистика, деталі, виручка по бронюваннях',
        keywords: ['бронюван', 'booking', 'замовлен'],
        handler: handleBookings,
        examples: ['Бронювання на сьогодні', 'Бронювання на завтра']
    },
    {
        id: 'tasks',
        name: 'Задачі',
        icon: '📋',
        description: 'Список задач, прострочені, статуси',
        keywords: ['задач', 'task', 'місі', 'todo'],
        handler: handleTasks,
        examples: ['Мої задачі', 'Що прострочено?']
    },
    {
        id: 'create_task',
        name: 'Створити задачу',
        icon: '✏️',
        description: 'Створити нову задачу з чату',
        keywords: ['створи задач', 'нова задач', 'додай задач', 'create task'],
        handler: handleCreateTask,
        examples: ['Створи задачу купити серветки', 'Нова задача: прибрати кімнату']
    },
    {
        id: 'streak',
        name: 'Стрік і бали',
        icon: '🔥',
        description: 'Стрік, бали, лідерборд',
        keywords: ['стрік', 'streak', 'бал', 'point', 'лідер', 'leader', 'рейтинг', 'очк'],
        handler: handleStreak,
        examples: ['Мій стрік', 'Лідерборд', 'Скільки балів?']
    },
    {
        id: 'team',
        name: 'Команда',
        icon: '👥',
        description: 'Хто працює, графік, аніматори',
        keywords: ['аніматор', 'animator', 'команд', 'team', 'хто працю', 'графік', 'зміна', 'персонал', 'staff'],
        handler: handleTeam,
        examples: ['Хто працює сьогодні?', 'Аніматори на суботу']
    },
    {
        id: 'revenue',
        name: 'Фінанси',
        icon: '💰',
        description: 'Виручка, середній чек, порівняння',
        keywords: ['виручк', 'revenue', 'дохід', 'фінанс', 'гроші', 'середній чек', 'чек', 'каса', 'оборот'],
        handler: handleRevenue,
        examples: ['Виручка за тиждень', 'Середній чек']
    },
    {
        id: 'afisha',
        name: 'Афіша',
        icon: '🎪',
        description: 'Заплановані події, свята, розклад',
        keywords: ['афіш', 'подія', 'event', 'свято', 'birthday', 'заход', 'захід'],
        handler: handleAfisha,
        examples: ['Які події сьогодні?', 'Афіша на тиждень']
    },
    {
        id: 'programs',
        name: 'Програми',
        icon: '🎭',
        description: 'Каталог програм, ціни, рекомендації',
        keywords: ['програм', 'program', 'квест', 'quest', 'шоу', 'show', 'майстер', 'master', 'каталог', 'catalog', 'прайс', 'ціна', 'ціни'],
        handler: handlePrograms,
        examples: ['Покажи програми', 'Які квести є?', 'Ціни на шоу']
    },
    {
        id: 'certificates',
        name: 'Сертифікати',
        icon: '🎫',
        description: 'Активні сертифікати, термін дії',
        keywords: ['сертифікат', 'certificate', 'cert'],
        handler: handleCertificates,
        examples: ['Активні сертифікати', 'Сертифікати що скоро спливуть']
    },
    {
        id: 'rooms',
        name: 'Кімнати',
        icon: '🏠',
        description: 'Завантаженість кімнат, вільні слоти',
        keywords: ['кімнат', 'room', 'зал', 'слот', 'вільн'],
        handler: handleRooms,
        examples: ['Які кімнати вільні?', 'Завантаженість кімнат']
    },
    {
        id: 'analytics',
        name: 'Аналітика',
        icon: '📈',
        description: 'Тренди, порівняння, топ програм',
        keywords: ['аналітик', 'analytic', 'тренд', 'trend', 'порівня', 'compar', 'топ програм', 'статистик'],
        handler: handleAnalytics,
        examples: ['Топ програм', 'Порівняй з минулим місяцем']
    },
    // --- Contour 2: Dev skills ---
    {
        id: 'agents',
        name: 'Агенти',
        icon: '🤖',
        description: 'Статус LLM-агентів, активність, саммарі',
        keywords: ['агент', 'agent', 'клод', 'claude', 'помічник бот', 'anthropic', 'хто робив', 'що зробив', 'що зробила', 'коміти', 'commit'],
        handler: handleAgents,
        examples: ['Статус агентів', 'Що зробив Клод?', 'Коміти за сьогодні']
    },
    {
        id: 'guard',
        name: 'Охоронець',
        icon: '🛡️',
        description: 'Статус, звіти, правила Охоронця',
        keywords: ['охоронець', 'guardian', 'guard', 'охорон', 'модераці', 'правил guardian', 'безпек'],
        handler: handleGuard,
        examples: ['Статус Охоронця', 'Звіт Охоронця', 'Правила Охоронця']
    },
    {
        id: 'summary',
        name: 'Саммарі',
        icon: '📝',
        description: 'Саммарі роботи агентів за період',
        keywords: ['саммарі', 'summary', 'підсумок', 'підсумки', 'що нового', 'огляд'],
        handler: handleSummary,
        examples: ['Саммарі за сьогодні', 'Що нового?']
    }
];

// --- Category filter for "скільки піньят/квестів/шоу за тиждень?" ---

const CATEGORY_MAP = {
    'піньят': { db: 'pinata', icon: '🪅', name: 'Піньяти' },
    'квест':  { db: 'quest', icon: '🎭', name: 'Квести' },
    'шоу':    { db: 'show', icon: '🎪', name: 'Шоу' },
    'анімац': { db: 'animation', icon: '🎨', name: 'Анімації' },
    'майстер': { db: 'masterclass', icon: '🍬', name: 'Майстер-класи' },
    'фото':   { db: 'photo', icon: '📸', name: 'Фото' },
};

const STATS_TRIGGER_WORDS = ['скільки', 'за тижд', 'за місяц', 'за день', 'тижд', 'місяц', 'вихідн', 'виручк', 'кількість', 'порахуй', 'підрахуй', 'статистик'];

/**
 * Try to handle category stats query (e.g., "скільки піньят за тиждень?")
 * Returns response or null if not a category query.
 */
async function tryHandleCategoryStats(lower, username, actor = null) {
    // Find matching category
    let matchedCat = null;
    for (const [keyword, cat] of Object.entries(CATEGORY_MAP)) {
        if (lower.includes(keyword)) {
            matchedCat = cat;
            break;
        }
    }
    if (!matchedCat) return null;

    // Must also contain a stats/time trigger word
    const hasTimeTrigger = STATS_TRIGGER_WORDS.some(w => lower.includes(w));
    if (!hasTimeTrigger) return null; // Let the programs skill handle "покажи квести"

    const dateIntent = parseDateIntent(lower);
    let from, to, label;
    if (dateIntent.from) {
        from = dateIntent.from;
        to = dateIntent.to;
        label = dateIntent.label;
    } else {
        from = dateIntent.date;
        to = dateIntent.date;
        label = dateIntent.label;
    }

    // Query bookings filtered by category
    const params = [from, to, matchedCat.db];
    const visibility = scopedBookingVisibility(username, actor, params, 'b');
    const res = await pool.query(
        `SELECT b.id, b.date, b.time, b.program_name, b.price, b.status, b.group_name, b.kids_count, b.hosts
         FROM bookings b
         WHERE b.date >= $1 AND b.date <= $2 AND b.category = $3
           AND b.status != 'cancelled' AND (b.linked_to IS NULL OR b.linked_to = '')
           ${visibility.sql}
         ORDER BY b.date, b.time`,
        params
    );

    const total = res.rows.length;
    const revenue = res.rows.reduce((s, b) => s + (b.price || 0), 0);

    let msg = `${matchedCat.icon} <b>${matchedCat.name} за ${label}</b>`;
    msg += ` (${formatDateUkr(from)}`;
    if (from !== to) msg += ` — ${formatDateUkr(to)}`;
    msg += '):\n\n';

    if (total === 0) {
        msg += `Бронювань немає.`;
        return {
            message: msg,
            suggestions: [`${matchedCat.name} за місяць`, 'Бронювання', 'Програми', 'Виручка']
        };
    }

    msg += `📦 Кількість: <b>${total}</b>\n`;
    msg += `💰 Виручка: <b>${formatPrice(revenue)}</b>\n\n`;

    // Show individual bookings (up to 10)
    const shown = res.rows.slice(0, 10);
    for (const b of shown) {
        const dateLabel = from !== to ? `${formatDateUkr(b.date)} ` : '';
        msg += `• ${dateLabel}${b.time || '—'} — ${b.program_name || matchedCat.name}`;
        if (b.group_name) msg += ` (${b.group_name})`;
        if (b.hosts > 1) msg += ` | ${b.hosts} вед.`;
        msg += ` | ${formatPrice(b.price)}\n`;
    }
    if (total > 10) {
        msg += `\n...і ще ${total - 10}`;
    }

    const otherCategories = Object.values(CATEGORY_MAP)
        .filter(c => c.db !== matchedCat.db)
        .slice(0, 2)
        .map(c => `${c.name} за ${label}`);

    return {
        message: msg,
        suggestions: [`${matchedCat.name} за місяць`, ...otherCategories, 'Бронювання']
    };
}

// --- Greeting/Hello handler ---
const HELLO_KEYWORDS = ['привіт', 'здоров', 'hi', 'hello', 'йо', 'хай', 'вітаю', 'салют', 'добрий день', 'доброго ранку', 'добрий вечір'];

// --- Main Chat Engine ---

async function generateChatResponse(userMessage, username, chatHistory, actor = null, options = {}) {
    const lower = userMessage.toLowerCase().trim();
    const pageContext = normalizePageContext(options.pageContext || {});

    try {
        // 1. Check for greetings (fast path, no AI needed)
        if (HELLO_KEYWORDS.some(k => lower.includes(k)) && lower.length < 30) {
            return {
                message: `🤖 Привіт! Я Помічник — твій AI-помічник у парку. Питай що хочеш — бронювання, задачі, фінанси, команду. Або скажи "що ти вмієш?" для повного списку!`,
                suggestions: ['Що ти вмієш?', 'Бронювання сьогодні', 'Мої задачі', 'Хто працює?']
            };
        }

        // 2. Check for thanks (fast path)
        if (['дякую', 'спасибі', 'thanks', 'дяк', 'thank'].some(k => lower.includes(k))) {
            return {
                message: '🤖 Завжди радий допомогти! Що ще цікавить?',
                suggestions: ['Бронювання', 'Задачі', 'Виручка', 'Команда']
            };
        }

        const pageKnowledgeResult = buildPageKnowledgeAnswer(userMessage, pageContext);
        if (pageKnowledgeResult) return pageKnowledgeResult;

        // 2.5. Check for category stats query (e.g., "скільки піньят за тиждень?")
        const categoryResult = await tryHandleCategoryStats(lower, username, actor);
        if (categoryResult) return categoryResult;

        // 3. Try AI first (if enabled)
        if (AI_ENABLED) {
            const aiResult = await generateAIResponse(userMessage, username, chatHistory, actor, { pageContext });
            if (aiResult) return aiResult;
        }

        // 4. Fallback: skill engine (keyword matching)
        const sortedSkills = [...SKILLS].sort((a, b) => {
            const maxA = Math.max(...a.keywords.map(k => k.length));
            const maxB = Math.max(...b.keywords.map(k => k.length));
            return maxB - maxA;
        });

        for (const skill of sortedSkills) {
            if (skill.keywords.some(k => lower.includes(k))) {
                return await skill.handler(lower, username, actor);
            }
        }

        // 5. Default
        return {
            message: '🤖 Цікаве питання! Ось що я вмію — обирай тему:',
            suggestions: ['Що ти вмієш?', 'Бронювання', 'Задачі', 'Виручка']
        };
    } catch (err) {
        log.error('Chat response error', err);
        return {
            message: '🤖 Ой, щось пішло не так. Спробуй ще раз!',
            suggestions: ['Бронювання', 'Задачі', 'Команда', 'Допомога']
        };
    }
}

// --- Skill Handlers ---

async function handleHelp() {
    const lines = ['🤖 <b>Мої навички:</b>\n'];
    for (const s of SKILLS) {
        if (s.id === 'help') continue;
        lines.push(`${s.icon} <b>${s.name}</b> — ${s.description}`);
        lines.push(`   💬 <i>${s.examples.join(', ')}</i>`);
    }
    lines.push(`\n🎯 <b>Фільтр по категоріях</b> — статистика по типу послуги`);
    lines.push(`   💬 <i>Скільки піньят за тиждень?, Квести за місяць</i>`);
    lines.push('\n🤖 Просто пиши — я зрозумію!');
    return {
        message: lines.join('\n'),
        suggestions: ['Бронювання сьогодні', 'Піньяти за тиждень', 'Квести за місяць', 'Хто працює?']
    };
}

async function handleBookings(lower, username, actor = null) {
    const dateIntent = parseDateIntent(lower);
    const suggestions = ['Бронювання на завтра', 'Виручка за тиждень', 'Які кімнати вільні?', 'Афіша'];

    if (dateIntent.from && dateIntent.to) {
        // Range query
        const params = [dateIntent.from, dateIntent.to];
        const visibility = scopedBookingVisibility(username, actor, params, 'b');
        const res = await pool.query(
            `SELECT COUNT(*) cnt, COALESCE(SUM(b.price),0) revenue,
                    COUNT(*) FILTER (WHERE b.status='confirmed') confirmed,
                    COUNT(*) FILTER (WHERE b.status='preliminary') preliminary,
                    COUNT(*) FILTER (WHERE b.status='cancelled') cancelled
             FROM bookings b WHERE b.date >= $1 AND b.date <= $2 AND (b.linked_to IS NULL OR b.linked_to = '')
             ${visibility.sql}`,
            params
        );
        const r = res.rows[0];
        let msg = `📊 <b>Бронювання за ${dateIntent.label}</b> (${formatDateUkr(dateIntent.from)} — ${formatDateUkr(dateIntent.to)}):\n\n`;
        msg += `📦 Всього: <b>${r.cnt}</b>\n`;
        msg += `✅ Підтверджених: ${r.confirmed}\n`;
        if (parseInt(r.preliminary) > 0) msg += `⚠️ Непідтверджених: ${r.preliminary}\n`;
        if (parseInt(r.cancelled) > 0) msg += `❌ Скасованих: ${r.cancelled}\n`;
        msg += `💰 Виручка: <b>${formatPrice(r.revenue)}</b>`;
        return { message: msg, suggestions };
    }

    // Single date
    const date = dateIntent.date;
    const params = [date];
    const visibility = scopedBookingVisibility(username, actor, params, 'b');
    const res = await pool.query(
        `SELECT b.id, b.time, b.program_name, b.group_name, b.room, b.price, b.status, b.kids_count, b.duration, b.hosts
         FROM bookings b WHERE b.date = $1 AND (b.linked_to IS NULL OR b.linked_to = '')
         ${visibility.sql}
         ORDER BY b.time`,
        params
    );

    if (res.rows.length === 0) {
        return {
            message: `📊 Бронювань на <b>${dateIntent.label}</b> (${formatDateUkr(date)}) немає. Поки тихо!`,
            suggestions: ['Бронювання на завтра', 'Афіша', 'Програми', 'Задачі']
        };
    }

    const total = res.rows.length;
    const revenue = res.rows.reduce((s, b) => s + (b.price || 0), 0);
    const confirmed = res.rows.filter(b => b.status === 'confirmed').length;
    const preliminary = res.rows.filter(b => b.status === 'preliminary').length;

    let msg = `📊 <b>Бронювання на ${dateIntent.label}</b> (${formatDateUkr(date)}): <b>${total}</b>\n`;
    msg += `💰 Виручка: <b>${formatPrice(revenue)}</b>`;
    if (preliminary > 0) msg += ` | ⚠️ ${preliminary} непідтв.`;
    msg += '\n\n';

    // Show up to 8 bookings
    const shown = res.rows.slice(0, 8);
    for (const b of shown) {
        const statusIcon = b.status === 'confirmed' ? '✅' : b.status === 'preliminary' ? '⏳' : '❌';
        msg += `${statusIcon} <b>${b.time || '—'}</b> ${b.program_name || '?'}`;
        if (b.group_name) msg += ` — ${b.group_name}`;
        if (b.kids_count) msg += ` (${b.kids_count} діт.)`;
        if (b.hosts > 1) msg += ` | ${b.hosts} вед.`;
        if (b.room) msg += ` | ${b.room}`;
        msg += ` | ${formatPrice(b.price)}`;
        msg += '\n';
    }
    if (res.rows.length > 8) {
        msg += `\n...і ще ${res.rows.length - 8} бронювань`;
    }

    return { message: msg, suggestions };
}

async function handleTasks(lower, username) {
    const isOverdue = lower.includes('простроч') || lower.includes('overdue') || lower.includes('протермінов');
    const isAll = lower.includes('всі задач') || lower.includes('all task');

    let query, params;
    if (isOverdue) {
        query = `SELECT id, title, assigned_to, deadline, priority, status FROM tasks
                 WHERE status NOT IN ('done') AND deadline < NOW() ORDER BY deadline`;
        params = [];
    } else if (isAll) {
        query = `SELECT id, title, assigned_to, deadline, priority, status FROM tasks
                 WHERE status NOT IN ('done') ORDER BY
                    CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
                    created_at DESC LIMIT 15`;
        params = [];
    } else {
        // User's tasks
        query = `SELECT id, title, assigned_to, owner, deadline, priority, status, category FROM tasks
                 WHERE (assigned_to = $1 OR owner = $1) AND status NOT IN ('done')
                 ORDER BY
                    CASE WHEN deadline < NOW() THEN 0 ELSE 1 END,
                    CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
                    created_at DESC LIMIT 15`;
        params = [username];
    }

    const res = await pool.query(query, params);

    if (res.rows.length === 0) {
        const msg = isOverdue
            ? '✅ Прострочених задач немає — все під контролем!'
            : '✅ Активних задач немає — можна відпочити!';
        return {
            message: msg,
            suggestions: ['Створи задачу', 'Всі задачі', 'Бронювання', 'Стрік']
        };
    }

    const priorityIcon = { high: '🔴', normal: '🟡', low: '🔵' };
    const statusIcon = { todo: '⬜', in_progress: '🔄', done: '✅' };
    const title = isOverdue ? 'Прострочені задачі' : isAll ? 'Всі активні задачі' : 'Твої задачі';

    let msg = `📋 <b>${title}</b> (${res.rows.length}):\n\n`;
    for (const t of res.rows) {
        const pi = priorityIcon[t.priority] || '';
        const si = statusIcon[t.status] || '';
        const overdue = t.deadline && new Date(t.deadline) < new Date() ? ' ⏰' : '';
        msg += `${si}${pi} <b>#${t.id}</b> ${t.title}`;
        if (t.assigned_to) msg += ` → ${t.assigned_to}`;
        msg += `${overdue}\n`;
    }

    return {
        message: msg,
        suggestions: ['Що прострочено?', 'Створи задачу', 'Всі задачі', 'Бронювання']
    };
}

async function handleCreateTask(lower, username) {
    // Extract task title from message
    let title = lower
        .replace(/створи задач[уі]?\s*/i, '')
        .replace(/нова задач[аі]?\s*:?\s*/i, '')
        .replace(/додай задач[уі]?\s*/i, '')
        .replace(/create task\s*/i, '')
        .trim();

    if (!title || title.length < 3) {
        return {
            message: '✏️ Напиши назву задачі. Наприклад:\n<i>"Створи задачу купити серветки"</i>',
            suggestions: ['Створи задачу перевірити кімнату', 'Мої задачі', 'Допомога']
        };
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    try {
        const kleshnya = require('./kleshnya');
        const task = await kleshnya.createTask({
            title,
            assigned_to: username,
            owner: username,
            created_by: username,
            source_type: 'kleshnya',
            category: 'admin',
            date: getKyivDate(0)
        });

        return {
            message: `✅ Задачу створено!\n\n📋 <b>#${task.id}</b> ${task.title}\n👤 Виконавець: ${username}\n📅 Дата: ${formatDateUkr(task.date)}`,
            suggestions: ['Мої задачі', 'Що прострочено?', 'Бронювання', 'Стрік']
        };
    } catch (err) {
        log.error('Create task from chat error', err);
        return {
            message: '❌ Не вдалося створити задачу. Спробуй ще раз.',
            suggestions: ['Мої задачі', 'Допомога']
        };
    }
}

async function handleStreak(lower, username) {
    const isLeaderboard = lower.includes('лідер') || lower.includes('leader') || lower.includes('рейтинг') || lower.includes('топ');

    if (isLeaderboard) {
        const kleshnya = require('./kleshnya');
        const allPoints = await kleshnya.getAllPoints();

        if (allPoints.length === 0) {
            return {
                message: '🏆 Лідерборд поки порожній. Виконуй задачі — і будеш першим!',
                suggestions: ['Мій стрік', 'Задачі', 'Бронювання']
            };
        }

        let msg = '🏆 <b>Лідерборд:</b>\n\n';
        const medals = ['🥇', '🥈', '🥉'];
        for (let i = 0; i < Math.min(allPoints.length, 10); i++) {
            const p = allPoints[i];
            const medal = medals[i] || `${i + 1}.`;
            const total = (p.permanent_points || 0) + (p.monthly_points || 0);
            msg += `${medal} <b>${p.username}</b> — ${total} балів`;
            if (p.monthly_points > 0) msg += ` (📅 +${p.monthly_points} цей місяць)`;
            msg += '\n';
        }

        return {
            message: msg,
            suggestions: ['Мій стрік', 'Задачі', 'Бронювання', 'Команда']
        };
    }

    // Personal streak & points
    const kleshnya = require('./kleshnya');
    const points = await kleshnya.getUserPoints(username);

    // Get streak
    const streakRes = await pool.query(
        'SELECT current_streak, longest_streak FROM user_streaks WHERE username = $1',
        [username]
    );
    const streak = streakRes.rows[0]?.current_streak || 0;
    const longest = streakRes.rows[0]?.longest_streak || 0;

    let msg = `🔥 <b>Твій профіль:</b>\n\n`;
    msg += `🔥 Стрік: <b>${streak} днів</b>`;
    if (longest > streak) msg += ` (рекорд: ${longest})`;
    msg += '\n';

    if (points) {
        const total = (points.permanent_points || 0) + (points.monthly_points || 0);
        msg += `⭐ Бали: <b>${total}</b>`;
        if (points.monthly_points) msg += ` (📅 ${points.monthly_points} цей місяць)`;
        msg += '\n';
    }

    // Motivation
    if (streak >= 14) msg += '\n💎 Легенда! Ти машина!';
    else if (streak >= 7) msg += '\n🏆 Тиждень поспіль — красунчик!';
    else if (streak >= 3) msg += '\n💪 Хороший темп, не зупиняйся!';
    else if (streak > 0) msg += '\n🌱 Початок покладено, продовжуй!';
    else msg += '\n🤖 Виконуй задачі щодня — стрік почне рости!';

    return {
        message: msg,
        suggestions: ['Лідерборд', 'Мої задачі', 'Бронювання', 'Команда']
    };
}

async function handleTeam(lower, username) {
    const dateIntent = parseDateIntent(lower);
    const date = dateIntent.date || dateIntent.from || getKyivDate(0);

    const res = await pool.query(
        `SELECT s.name, s.department, ss.shift_start, ss.shift_end, ss.status, ss.note
         FROM staff s
         LEFT JOIN staff_schedule ss ON s.id = ss.staff_id AND ss.date = $1
         WHERE s.is_active = true
         ORDER BY s.department, s.name`,
        [date]
    );

    if (res.rows.length === 0) {
        return {
            message: '👥 Інформація про персонал недоступна.',
            suggestions: ['Бронювання', 'Задачі', 'Допомога']
        };
    }

    // Group by department
    const departments = {};
    const deptNames = {
        animators: '🎭 Аніматори',
        admin: '💼 Адмін',
        cafe: '☕ Кафе',
        tech: '🔧 Технік',
        cleaning: '🧹 Прибирання',
        security: '🛡 Охорона'
    };

    for (const row of res.rows) {
        const dept = row.department || 'other';
        if (!departments[dept]) departments[dept] = [];
        departments[dept].push(row);
    }

    let msg = `👥 <b>Команда на ${dateIntent.label}</b> (${formatDateUkr(date)}):\n\n`;
    let workingTotal = 0;

    for (const [dept, staff] of Object.entries(departments)) {
        const deptLabel = deptNames[dept] || dept;
        const working = staff.filter(s => s.status === 'working');
        workingTotal += working.length;

        if (working.length > 0) {
            msg += `${deptLabel}:\n`;
            for (const s of working) {
                msg += `  ✅ ${s.name}`;
                if (s.shift_start && s.shift_end) msg += ` (${s.shift_start}–${s.shift_end})`;
                if (s.note) msg += ` — ${s.note}`;
                msg += '\n';
            }
        }
    }

    if (workingTotal === 0) {
        msg += '🔇 Ніхто не на зміні.';
    } else {
        msg += `\n📊 Всього на зміні: <b>${workingTotal}</b>`;
    }

    // Show who's off/sick/vacation
    const absent = res.rows.filter(s => s.status && s.status !== 'working' && s.status !== 'dayoff');
    if (absent.length > 0) {
        const statusIcons = { vacation: '🏖', sick: '🤒', remote: '🏠' };
        msg += '\n';
        for (const s of absent) {
            msg += `\n${statusIcons[s.status] || '📍'} ${s.name} — ${s.status}`;
        }
    }

    return {
        message: msg,
        suggestions: ['Команда на завтра', 'Бронювання', 'Задачі', 'Аналітика']
    };
}

async function handleRevenue(lower, username, actor = null) {
    const isAvgCheck = lower.includes('середній чек') || lower.includes('середній') || lower.includes('чек');
    const dateIntent = parseDateIntent(lower);

    // Determine date range
    let from, to, label;
    if (dateIntent.from) {
        from = dateIntent.from;
        to = dateIntent.to;
        label = dateIntent.label;
    } else {
        // Default to this week for revenue
        const range = getKyivWeekRange();
        from = range.from;
        to = range.to;
        label = 'цей тиждень';
    }

    const params = [from, to];
    const visibility = scopedBookingVisibility(username, actor, params, 'b');
    const res = await pool.query(
        `SELECT COUNT(*) cnt,
                COALESCE(SUM(b.price), 0) revenue,
                COALESCE(ROUND(AVG(b.price)), 0) avg_price,
                COUNT(*) FILTER (WHERE b.status='confirmed') confirmed,
                COUNT(*) FILTER (WHERE b.status='preliminary') preliminary
         FROM bookings b WHERE b.date >= $1 AND b.date <= $2 AND (b.linked_to IS NULL OR b.linked_to = '') AND b.status != 'cancelled'
         ${visibility.sql}`,
        params
    );

    const r = res.rows[0];

    if (isAvgCheck) {
        let msg = `💰 <b>Середній чек за ${label}:</b>\n\n`;
        msg += `📊 Бронювань: ${r.cnt}\n`;
        msg += `💵 Середній чек: <b>${formatPrice(r.avg_price)}</b>\n`;
        msg += `💰 Видима виручка: ${formatPrice(r.revenue)}`;
        return {
            message: msg,
            suggestions: ['Виручка за місяць', 'Топ програм', 'Бронювання', 'Аналітика']
        };
    }

    // Comparison with previous period
    const prevFrom = dateIntent.from ? getPrevMonthRange().from : (() => {
        const r = getKyivWeekRange();
        const pf = new Date(r.from);
        pf.setDate(pf.getDate() - 7);
        const pt = new Date(r.to);
        pt.setDate(pt.getDate() - 7);
        return pf.toISOString().split('T')[0];
    })();
    const prevTo = dateIntent.from ? getPrevMonthRange().to : (() => {
        const r = getKyivWeekRange();
        const pt = new Date(r.to);
        pt.setDate(pt.getDate() - 7);
        return pt.toISOString().split('T')[0];
    })();

    const prevParams = [prevFrom, prevTo];
    const prevVisibility = scopedBookingVisibility(username, actor, prevParams, 'b');
    const prevRes = await pool.query(
        `SELECT COALESCE(SUM(b.price), 0) revenue, COUNT(*) cnt
         FROM bookings b WHERE b.date >= $1 AND b.date <= $2 AND (b.linked_to IS NULL OR b.linked_to = '') AND b.status != 'cancelled'
         ${prevVisibility.sql}`,
        prevParams
    );

    const prev = prevRes.rows[0];
    const growth = prev.revenue > 0 ? Math.round(((r.revenue - prev.revenue) / prev.revenue) * 100) : 0;
    const growthIcon = growth > 0 ? '📈' : growth < 0 ? '📉' : '➡️';

    let msg = `💰 <b>Фінанси за ${label}:</b>\n\n`;
    msg += `💵 Виручка: <b>${formatPrice(r.revenue)}</b>\n`;
    msg += `📦 Бронювань: ${r.cnt} (✅ ${r.confirmed}`;
    if (parseInt(r.preliminary) > 0) msg += `, ⏳ ${r.preliminary}`;
    msg += ')\n';
    msg += `📊 Середній чек: ${formatPrice(r.avg_price)}\n`;
    if (growth !== 0) {
        msg += `${growthIcon} ${growth > 0 ? '+' : ''}${growth}% від попереднього періоду`;
    }

    return {
        message: msg,
        suggestions: ['Виручка за місяць', 'Середній чек', 'Топ програм', 'Бронювання']
    };
}

async function handleAfisha(lower, username) {
    const dateIntent = parseDateIntent(lower);
    let from, to, label;

    if (dateIntent.from) {
        from = dateIntent.from;
        to = dateIntent.to;
        label = dateIntent.label;
    } else {
        from = dateIntent.date;
        to = dateIntent.date;
        label = dateIntent.label;
    }

    const res = await pool.query(
        `SELECT date, time, title, type, duration FROM afisha
         WHERE date >= $1 AND date <= $2 ORDER BY date, time`,
        [from, to]
    );

    if (res.rows.length === 0) {
        return {
            message: `🎪 Подій на <b>${label}</b> не заплановано.`,
            suggestions: ['Афіша на тиждень', 'Бронювання', 'Задачі', 'Програми']
        };
    }

    const typeIcons = { event: '🎪', birthday: '🎂', regular: '📅' };

    let msg = `🎪 <b>Афіша на ${label}:</b>\n\n`;
    let prevDate = '';
    for (const e of res.rows) {
        if (e.date !== prevDate && from !== to) {
            msg += `\n📅 <b>${formatDateUkr(e.date)}</b>\n`;
            prevDate = e.date;
        }
        const icon = typeIcons[e.type] || '📌';
        msg += `${icon} ${e.time || '—'} <b>${e.title}</b>`;
        if (e.duration) msg += ` (${e.duration} хв)`;
        msg += '\n';
    }

    return {
        message: msg,
        suggestions: ['Афіша на тиждень', 'Бронювання', 'Програми', 'Команда']
    };
}

async function handlePrograms(lower, username) {
    // Determine category filter
    let categoryFilter = null;
    if (lower.includes('квест') || lower.includes('quest')) categoryFilter = 'quest';
    else if (lower.includes('шоу') || lower.includes('show')) categoryFilter = 'show';
    else if (lower.includes('анімац') || lower.includes('anim')) categoryFilter = 'animation';
    else if (lower.includes('майстер') || lower.includes('master')) categoryFilter = 'masterclass';
    else if (lower.includes('фото') || lower.includes('photo')) categoryFilter = 'photo';
    else if (lower.includes('піньят') || lower.includes('pinat')) categoryFilter = 'pinata';

    let query, params;
    if (categoryFilter) {
        query = `SELECT name, icon, category, duration, price, age_range, kids_capacity, is_per_child
                 FROM products WHERE is_active = true AND category = $1 ORDER BY sort_order, name`;
        params = [categoryFilter];
    } else {
        query = `SELECT category, COUNT(*) cnt, MIN(price) min_price, MAX(price) max_price
                 FROM products WHERE is_active = true GROUP BY category ORDER BY category`;
        params = [];
    }

    const res = await pool.query(query, params);

    if (categoryFilter) {
        const catNames = {
            quest: '🎭 Квести', show: '🎪 Шоу', animation: '🎨 Анімація',
            masterclass: '🍬 Майстер-класи', photo: '📸 Фото', pinata: '🪅 Піньяти'
        };

        let msg = `${catNames[categoryFilter] || categoryFilter}:\n\n`;
        for (const p of res.rows) {
            msg += `${p.icon || '•'} <b>${p.name}</b>\n`;
            msg += `   ⏱ ${p.duration} хв | 💰 ${formatPrice(p.price)}`;
            if (p.is_per_child) msg += '/дит.';
            if (p.age_range) msg += ` | 👶 ${p.age_range}`;
            if (p.kids_capacity) msg += ` | 👥 ${p.kids_capacity}`;
            msg += '\n';
        }
        return {
            message: msg,
            suggestions: ['Всі програми', 'Квести', 'Шоу', 'Бронювання']
        };
    }

    // Show categories overview
    const catIcons = {
        quest: '🎭', show: '🎪', animation: '🎨',
        masterclass: '🍬', photo: '📸', pinata: '🪅', custom: '⚙️'
    };
    const catNames = {
        quest: 'Квести', show: 'Шоу', animation: 'Анімація',
        masterclass: 'Майстер-класи', photo: 'Фото', pinata: 'Піньяти', custom: 'Своя програма'
    };

    let msg = '🎭 <b>Каталог програм:</b>\n\n';
    for (const c of res.rows) {
        const icon = catIcons[c.category] || '•';
        const name = catNames[c.category] || c.category;
        msg += `${icon} <b>${name}</b> — ${c.cnt} програм`;
        msg += ` (${formatPrice(c.min_price)}`;
        if (c.min_price !== c.max_price) msg += ` — ${formatPrice(c.max_price)}`;
        msg += ')\n';
    }
    msg += '\n💬 Уточни категорію для деталей!';

    return {
        message: msg,
        suggestions: ['Квести', 'Шоу', 'Майстер-класи', 'Бронювання']
    };
}

async function handleCertificates(lower, username) {
    const isExpiring = lower.includes('сплив') || lower.includes('закінч') || lower.includes('expir');

    let res;
    if (isExpiring) {
        res = await pool.query(
            `SELECT cert_code, display_value, type_text, valid_until, status
             FROM certificates WHERE status = 'active' AND valid_until <= (CURRENT_DATE + INTERVAL '14 days')
             ORDER BY valid_until`
        );
    } else {
        res = await pool.query(
            `SELECT status, COUNT(*) cnt FROM certificates GROUP BY status ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'used' THEN 1 WHEN 'expired' THEN 2 ELSE 3 END`
        );
    }

    if (isExpiring) {
        if (res.rows.length === 0) {
            return {
                message: '🎫 Сертифікатів що скоро спливуть — немає. Все ок!',
                suggestions: ['Активні сертифікати', 'Бронювання', 'Задачі']
            };
        }
        let msg = `🎫 <b>Сертифікати що спливають (14 днів):</b>\n\n`;
        for (const c of res.rows) {
            msg += `⚠️ <b>${c.cert_code}</b> — ${c.display_value || '?'}`;
            if (c.valid_until) msg += ` | до ${formatDateUkr(c.valid_until)}`;
            msg += '\n';
        }
        return {
            message: msg,
            suggestions: ['Активні сертифікати', 'Бронювання', 'Задачі']
        };
    }

    let msg = '🎫 <b>Сертифікати:</b>\n\n';
    const statusNames = { active: '✅ Активні', used: '📋 Використані', expired: '⏰ Прострочені', revoked: '❌ Скасовані', blocked: '🚫 Заблоковані' };
    for (const r of res.rows) {
        msg += `${statusNames[r.status] || r.status}: <b>${r.cnt}</b>\n`;
    }

    return {
        message: msg,
        suggestions: ['Сертифікати що спливуть', 'Бронювання', 'Задачі', 'Виручка']
    };
}

async function handleRooms(lower, username, actor = null) {
    const dateIntent = parseDateIntent(lower);
    const date = dateIntent.date || getKyivDate(0);

    const params = [date];
    const visibility = scopedBookingVisibility(username, actor, params, 'b');
    const res = await pool.query(
        `SELECT b.room, COUNT(*) cnt, SUM(b.duration) total_mins, MIN(b.time) first_time, MAX(b.time) last_time
         FROM bookings b WHERE b.date = $1 AND b.status != 'cancelled' AND b.room IS NOT NULL AND (b.linked_to IS NULL OR b.linked_to = '')
         ${visibility.sql}
         GROUP BY b.room ORDER BY cnt DESC`,
        params
    );

    if (res.rows.length === 0) {
        return {
            message: `🏠 Кімнати на <b>${dateIntent.label}</b> (${formatDateUkr(date)}) — всі вільні!`,
            suggestions: ['Бронювання', 'Програми', 'Афіша', 'Задачі']
        };
    }

    let msg = `🏠 <b>Кімнати на ${dateIntent.label}</b> (${formatDateUkr(date)}):\n\n`;
    for (const r of res.rows) {
        const hours = r.total_mins ? Math.round(r.total_mins / 60 * 10) / 10 : 0;
        msg += `🚪 <b>${r.room}</b> — ${r.cnt} бронювань`;
        if (hours) msg += ` (${hours} год)`;
        if (r.first_time && r.last_time) msg += ` | ${r.first_time}–${r.last_time}`;
        msg += '\n';
    }

    return {
        message: msg,
        suggestions: ['Бронювання', 'Команда', 'Виручка', 'Афіша']
    };
}

async function handleAnalytics(lower, username, actor = null) {
    const isTopPrograms = lower.includes('топ програм') || lower.includes('top program') || lower.includes('популярн');
    const isComparison = lower.includes('порівня') || lower.includes('compar');

    if (isTopPrograms) {
        const range = getMonthRange();
        const params = [range.from, range.to];
        const visibility = scopedBookingVisibility(username, actor, params, 'b');
        const res = await pool.query(
            `SELECT b.program_name, COUNT(*) cnt, SUM(b.price) revenue
             FROM bookings b WHERE b.date >= $1 AND b.date <= $2 AND b.status = 'confirmed' AND (b.linked_to IS NULL OR b.linked_to = '')
             ${visibility.sql}
             GROUP BY b.program_name ORDER BY cnt DESC LIMIT 10`,
            params
        );

        if (res.rows.length === 0) {
            return {
                message: '📈 Даних за цей місяць ще немає.',
                suggestions: ['Бронювання', 'Програми', 'Виручка']
            };
        }

        let msg = '📈 <b>Топ програм за місяць:</b>\n\n';
        const medals = ['🥇', '🥈', '🥉'];
        for (let i = 0; i < res.rows.length; i++) {
            const p = res.rows[i];
            const medal = medals[i] || `${i + 1}.`;
            msg += `${medal} <b>${p.program_name || '?'}</b> — ${p.cnt} бронювань`;
            msg += ` (${formatPrice(p.revenue)})\n`;
        }

        return {
            message: msg,
            suggestions: ['Виручка за місяць', 'Бронювання', 'Середній чек', 'Програми']
        };
    }

    // General analytics / comparison
    const curr = getMonthRange();
    const prev = getPrevMonthRange();
    const currParams = [curr.from, curr.to];
    const currVisibility = scopedBookingVisibility(username, actor, currParams, 'b');
    const prevParams = [prev.from, prev.to];
    const prevVisibility = scopedBookingVisibility(username, actor, prevParams, 'b');

    const [currRes, prevRes] = await Promise.all([
        pool.query(
            `SELECT COUNT(*) cnt, COALESCE(SUM(b.price),0) revenue, COALESCE(ROUND(AVG(b.price)),0) avg_price
             FROM bookings b WHERE b.date >= $1 AND b.date <= $2 AND b.status='confirmed' AND (b.linked_to IS NULL OR b.linked_to = '')
             ${currVisibility.sql}`,
            currParams
        ),
        pool.query(
            `SELECT COUNT(*) cnt, COALESCE(SUM(b.price),0) revenue, COALESCE(ROUND(AVG(b.price)),0) avg_price
             FROM bookings b WHERE b.date >= $1 AND b.date <= $2 AND b.status='confirmed' AND (b.linked_to IS NULL OR b.linked_to = '')
             ${prevVisibility.sql}`,
            prevParams
        )
    ]);

    const c = currRes.rows[0];
    const p = prevRes.rows[0];
    const revGrowth = p.revenue > 0 ? Math.round(((c.revenue - p.revenue) / p.revenue) * 100) : 0;
    const cntGrowth = p.cnt > 0 ? Math.round(((c.cnt - p.cnt) / p.cnt) * 100) : 0;

    let msg = '📈 <b>Аналітика: цей місяць vs минулий</b>\n\n';
    msg += `💰 Виручка: <b>${formatPrice(c.revenue)}</b> (мин.: ${formatPrice(p.revenue)})`;
    if (revGrowth !== 0) msg += ` ${revGrowth > 0 ? '📈' : '📉'} ${revGrowth > 0 ? '+' : ''}${revGrowth}%`;
    msg += '\n';
    msg += `📦 Бронювань: <b>${c.cnt}</b> (мин.: ${p.cnt})`;
    if (cntGrowth !== 0) msg += ` ${cntGrowth > 0 ? '📈' : '📉'} ${cntGrowth > 0 ? '+' : ''}${cntGrowth}%`;
    msg += '\n';
    msg += `📊 Середній чек: <b>${formatPrice(c.avg_price)}</b> (мин.: ${formatPrice(p.avg_price)})\n`;

    return {
        message: msg,
        suggestions: ['Топ програм', 'Виручка за тиждень', 'Бронювання', 'Команда']
    };
}

// --- Contour 2: Dev Skill Handlers ---

async function handleAgents(lower) {
    try {
        const { getActivityFeed, getAgentStatus } = require('./agentTracker');
        const status = await getAgentStatus();

        if (lower.includes('активн') || lower.includes('коміт') || lower.includes('commit') || lower.includes('стрічк')) {
            // Activity feed
            const feed = await getActivityFeed({ limit: 10 });
            if (feed.length === 0) {
                return { message: '🤖 Стрічка активності порожня. Спробуй синхронізувати git.', suggestions: ['Статус агентів', 'Саммарі'] };
            }
            let msg = '🤖 <b>Остання активність:</b>\n\n';
            for (const a of feed) {
                const time = new Date(a.createdAt).toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
                const tag = a.agentTag === 'claude-code' ? '🤖' : a.agentTag === 'kleshnya' ? '🤖' : a.agentTag === 'anthropic' ? '🧠' : '👤';
                msg += `${time} ${tag} [${a.agentTag}] ${a.summary}\n`;
                if (a.details?.diff_stat) msg += `   ↳ ${a.details.diff_stat}\n`;
            }
            return { message: msg, suggestions: ['Статус агентів', 'Саммарі за сьогодні', 'Що зробив Клод?'] };
        }

        // Default: status
        if (status.length === 0) {
            return { message: '🤖 Немає даних про агентів. Потрібна синхронізація git.', suggestions: ['Бронювання', 'Задачі'] };
        }
        let msg = '🤖 <b>Статус агентів:</b>\n\n';
        for (const s of status) {
            const tag = s.agentTag === 'claude-code' ? '🤖' : s.agentTag === 'kleshnya' ? '🤖' : s.agentTag === 'anthropic' ? '🧠' : '👤';
            const state = s.isOnline ? '🟢 працює' : '⚪ offline';
            const time = new Date(s.lastActive).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
            msg += `${tag} <b>${s.agentTag}</b> — ${state}\n`;
            msg += `   Останнє: ${s.lastSummary?.substring(0, 60) || '—'}\n`;
            msg += `   🕐 ${time}\n\n`;
        }
        return { message: msg, suggestions: ['Коміти за сьогодні', 'Саммарі', 'Звіт Охоронця'] };
    } catch (err) {
        log.error('handleAgents error', err);
        return { message: '🤖 Помилка при отриманні статусу агентів.', suggestions: ['Задачі', 'Бронювання'] };
    }
}

async function handleGuard(lower) {
    try {
        const { getMood, getGuardianState } = require('./guardian');

        if (lower.includes('правил') || lower.includes('rule')) {
            // Rules list
            const result = await pool.query('SELECT * FROM guardian_rules WHERE is_active = true ORDER BY severity DESC');
            if (result.rows.length === 0) {
                return { message: '🛡️ Активних правил немає.', suggestions: ['Статус Охоронця', 'Агенти'] };
            }
            let msg = '🛡️ <b>Правила Охоронця:</b>\n\n';
            for (const r of result.rows) {
                const sev = r.severity === 'critical' ? '🔴' : r.severity === 'high' ? '🟠' : r.severity === 'medium' ? '🟡' : '🟢';
                msg += `${sev} <b>${r.name}</b> — ${r.action} (${r.rule_type})\n`;
            }
            msg += `\nВсього: ${result.rows.length} правил`;
            return { message: msg, suggestions: ['Статус Охоронця', 'Звіт Охоронця', 'Агенти'] };
        }

        if (lower.includes('звіт') || lower.includes('report') || lower.includes('дайджест')) {
            // Last report
            const result = await pool.query(`
                SELECT gr.*, cc.name AS channel_name
                FROM guardian_reports gr
                LEFT JOIN chat_channels cc ON cc.id = gr.channel_id
                ORDER BY gr.created_at DESC LIMIT 3
            `);
            if (result.rows.length === 0) {
                return { message: '🛡️ Звітів поки немає. Вони генеруються щовечора о 21:00.', suggestions: ['Статус Охоронця', 'Агенти'] };
            }
            let msg = '🛡️ <b>Останні звіти Охоронця:</b>\n\n';
            for (const r of result.rows) {
                msg += `📅 <b>${r.report_date}</b> | #${r.channel_name || '?'}\n`;
                msg += `${r.summary?.substring(0, 200) || 'Без саммарі'}...\n\n`;
            }
            return { message: msg, suggestions: ['Правила Охоронця', 'Статус Охоронця', 'Агенти'] };
        }

        // Default: status
        const mood = getMood();
        const state = getGuardianState();
        const todayResult = await pool.query(`
            SELECT action_type, COUNT(*) cnt FROM guardian_actions
            WHERE created_at::date = CURRENT_DATE GROUP BY action_type
        `);
        const todayStats = {};
        todayResult.rows.forEach(r => { todayStats[r.action_type] = parseInt(r.cnt); });

        let msg = `🛡️ <b>Охоронець</b> ${mood.emoji} ${mood.label}\n\n`;
        msg += `<b>Сьогодні:</b>\n`;
        msg += `🚫 Блокувань: ${todayStats.mute || 0}\n`;
        msg += `🔒 Замасковано: ${todayStats.mask || 0}\n`;
        msg += `🗑️ Видалено: ${todayStats.delete || 0}\n`;
        msg += `🔍 Перевірено: ${todayStats.scan || 0}\n`;
        const memoryChannels = Object.keys(state.memory || {}).length;
        msg += `\n📊 Каналів під наглядом: ${memoryChannels}`;
        return { message: msg, suggestions: ['Правила Охоронця', 'Звіт Охоронця', 'Агенти', 'Саммарі'] };
    } catch (err) {
        log.error('handleGuard error', err);
        return { message: '🛡️ Помилка при отриманні статусу Охоронця.', suggestions: ['Задачі', 'Бронювання'] };
    }
}

async function handleSummary(lower) {
    try {
        const { generateSummary } = require('./agentTracker');

        let period = 'today';
        if (lower.includes('тижд') || lower.includes('week')) period = 'week';
        else if (lower.includes('сесі') || lower.includes('session')) period = 'session';

        const result = await generateSummary(period);
        if (!result || !result.summary) {
            return { message: '📝 Немає даних для саммарі. Потрібна синхронізація git.', suggestions: ['Статус агентів', 'Задачі'] };
        }

        let msg = `📝 <b>Саммарі за ${period === 'today' ? 'сьогодні' : period === 'week' ? 'тиждень' : 'сесію'}:</b>\n\n`;
        msg += result.summary + '\n';
        if (result.stats && Object.keys(result.stats).length > 0) {
            msg += '\n<b>Статистика:</b>\n';
            for (const [tag, s] of Object.entries(result.stats)) {
                const parts = [];
                if (s.features) parts.push(`${s.features} фіч`);
                if (s.fixes) parts.push(`${s.fixes} фіксів`);
                if (s.commits) parts.push(`${s.commits} комітів`);
                msg += `  ${tag}: ${parts.join(', ') || 'без деталей'}\n`;
            }
        }
        return { message: msg, suggestions: ['Саммарі за тиждень', 'Статус агентів', 'Коміти'] };
    } catch (err) {
        log.error('handleSummary error', err);
        return { message: '📝 Помилка при генерації саммарі.', suggestions: ['Статус агентів', 'Задачі'] };
    }
}

// --- Exports ---
module.exports = {
    generateChatResponse,
    SKILLS,
    AI_ENABLED
};
