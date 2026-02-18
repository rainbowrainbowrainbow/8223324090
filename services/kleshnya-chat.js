/**
 * services/kleshnya-chat.js — Kleshnya Smart Chat Engine (v12.6)
 *
 * Skill-based chat system with real DB queries.
 * Each skill matches keywords, runs queries, returns message + suggestions.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('KleshnyaChat');

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
async function tryHandleCategoryStats(lower, username) {
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
    const res = await pool.query(
        `SELECT id, date, time, program_name, price, status, group_name, kids_count
         FROM bookings
         WHERE date >= $1 AND date <= $2 AND category = $3
           AND status != 'cancelled' AND linked_to IS NULL
         ORDER BY date, time`,
        [from, to, matchedCat.db]
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

async function generateChatResponse(userMessage, username) {
    const lower = userMessage.toLowerCase().trim();

    try {
        // 1. Check for greetings
        if (HELLO_KEYWORDS.some(k => lower.includes(k)) && lower.length < 30) {
            return {
                message: `🦀 Привіт! Я Клешня — твій помічник у парку. Питай що хочеш — бронювання, задачі, фінанси, команду. Або скажи "що ти вмієш?" для повного списку!`,
                suggestions: ['Що ти вмієш?', 'Бронювання сьогодні', 'Мої задачі', 'Хто працює?']
            };
        }

        // 2. Check for thanks
        if (['дякую', 'спасибі', 'thanks', 'дяк', 'thank'].some(k => lower.includes(k))) {
            return {
                message: '🦀 Завжди радий допомогти! Що ще цікавить?',
                suggestions: ['Бронювання', 'Задачі', 'Виручка', 'Команда']
            };
        }

        // 2.5. Check for category stats query (e.g., "скільки піньят за тиждень?")
        const categoryResult = await tryHandleCategoryStats(lower, username);
        if (categoryResult) return categoryResult;

        // 3. Find matching skill (check longer keywords first to match "створи задачу" before "задач")
        const sortedSkills = [...SKILLS].sort((a, b) => {
            const maxA = Math.max(...a.keywords.map(k => k.length));
            const maxB = Math.max(...b.keywords.map(k => k.length));
            return maxB - maxA;
        });

        for (const skill of sortedSkills) {
            if (skill.keywords.some(k => lower.includes(k))) {
                return await skill.handler(lower, username);
            }
        }

        // 4. Default
        return {
            message: '🦀 Цікаве питання! Ось що я вмію — обирай тему:',
            suggestions: ['Що ти вмієш?', 'Бронювання', 'Задачі', 'Виручка']
        };
    } catch (err) {
        log.error('Chat response error', err);
        return {
            message: '🦀 Ой, щось пішло не так. Спробуй ще раз!',
            suggestions: ['Бронювання', 'Задачі', 'Команда', 'Допомога']
        };
    }
}

// --- Skill Handlers ---

async function handleHelp() {
    const lines = ['🦀 <b>Мої навички:</b>\n'];
    for (const s of SKILLS) {
        if (s.id === 'help') continue;
        lines.push(`${s.icon} <b>${s.name}</b> — ${s.description}`);
        lines.push(`   💬 <i>${s.examples.join(', ')}</i>`);
    }
    lines.push(`\n🎯 <b>Фільтр по категоріях</b> — статистика по типу послуги`);
    lines.push(`   💬 <i>Скільки піньят за тиждень?, Квести за місяць</i>`);
    lines.push('\n🦀 Просто пиши — я зрозумію!');
    return {
        message: lines.join('\n'),
        suggestions: ['Бронювання сьогодні', 'Піньяти за тиждень', 'Квести за місяць', 'Хто працює?']
    };
}

async function handleBookings(lower, username) {
    const dateIntent = parseDateIntent(lower);
    const suggestions = ['Бронювання на завтра', 'Виручка за тиждень', 'Які кімнати вільні?', 'Афіша'];

    if (dateIntent.from && dateIntent.to) {
        // Range query
        const res = await pool.query(
            `SELECT COUNT(*) cnt, COALESCE(SUM(price),0) revenue,
                    COUNT(*) FILTER (WHERE status='confirmed') confirmed,
                    COUNT(*) FILTER (WHERE status='preliminary') preliminary,
                    COUNT(*) FILTER (WHERE status='cancelled') cancelled
             FROM bookings WHERE date >= $1 AND date <= $2 AND linked_to IS NULL`,
            [dateIntent.from, dateIntent.to]
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
    const res = await pool.query(
        `SELECT id, time, program_name, group_name, room, price, status, kids_count, duration
         FROM bookings WHERE date = $1 AND linked_to IS NULL ORDER BY time`,
        [date]
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
    else msg += '\n🦀 Виконуй задачі щодня — стрік почне рости!';

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

async function handleRevenue(lower, username) {
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

    const res = await pool.query(
        `SELECT COUNT(*) cnt,
                COALESCE(SUM(price), 0) revenue,
                COALESCE(ROUND(AVG(price)), 0) avg_price,
                COUNT(*) FILTER (WHERE status='confirmed') confirmed,
                COUNT(*) FILTER (WHERE status='preliminary') preliminary
         FROM bookings WHERE date >= $1 AND date <= $2 AND linked_to IS NULL AND status != 'cancelled'`,
        [from, to]
    );

    const r = res.rows[0];

    if (isAvgCheck) {
        let msg = `💰 <b>Середній чек за ${label}:</b>\n\n`;
        msg += `📊 Бронювань: ${r.cnt}\n`;
        msg += `💵 Середній чек: <b>${formatPrice(r.avg_price)}</b>\n`;
        msg += `💰 Загальна виручка: ${formatPrice(r.revenue)}`;
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

    const prevRes = await pool.query(
        `SELECT COALESCE(SUM(price), 0) revenue, COUNT(*) cnt
         FROM bookings WHERE date >= $1 AND date <= $2 AND linked_to IS NULL AND status != 'cancelled'`,
        [prevFrom, prevTo]
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

async function handleRooms(lower, username) {
    const dateIntent = parseDateIntent(lower);
    const date = dateIntent.date || getKyivDate(0);

    const res = await pool.query(
        `SELECT room, COUNT(*) cnt, SUM(duration) total_mins, MIN(time) first_time, MAX(time) last_time
         FROM bookings WHERE date = $1 AND status != 'cancelled' AND room IS NOT NULL AND linked_to IS NULL
         GROUP BY room ORDER BY cnt DESC`,
        [date]
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

async function handleAnalytics(lower, username) {
    const isTopPrograms = lower.includes('топ програм') || lower.includes('top program') || lower.includes('популярн');
    const isComparison = lower.includes('порівня') || lower.includes('compar');

    if (isTopPrograms) {
        const range = getMonthRange();
        const res = await pool.query(
            `SELECT program_name, COUNT(*) cnt, SUM(price) revenue
             FROM bookings WHERE date >= $1 AND date <= $2 AND status = 'confirmed' AND linked_to IS NULL
             GROUP BY program_name ORDER BY cnt DESC LIMIT 10`,
            [range.from, range.to]
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

    const [currRes, prevRes] = await Promise.all([
        pool.query(
            `SELECT COUNT(*) cnt, COALESCE(SUM(price),0) revenue, COALESCE(ROUND(AVG(price)),0) avg_price
             FROM bookings WHERE date >= $1 AND date <= $2 AND status='confirmed' AND linked_to IS NULL`,
            [curr.from, curr.to]
        ),
        pool.query(
            `SELECT COUNT(*) cnt, COALESCE(SUM(price),0) revenue, COALESCE(ROUND(AVG(price)),0) avg_price
             FROM bookings WHERE date >= $1 AND date <= $2 AND status='confirmed' AND linked_to IS NULL`,
            [prev.from, prev.to]
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

// --- Exports ---
module.exports = {
    generateChatResponse,
    SKILLS // Export for potential API listing
};
