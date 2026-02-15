/**
 * services/kleshnya-greeting.js — Kleshnya greeting message generator (v11.0)
 *
 * Generates personalized daily greetings based on context:
 *  - bookings count, revenue, pending tasks
 *  - user streaks, achievements
 *  - day of week, time of day
 *
 * Messages are cached in DB (kleshnya_messages) for CACHE_HOURS
 * to avoid excessive AI calls when agent is connected.
 *
 * Source types:
 *  - 'template' — built-in template logic (default, free)
 *  - 'agent'    — AI-generated (future, costs tokens)
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('KleshnyaGreeting');

// Cache duration: 4 hours
const CACHE_HOURS = 4;

// --- Template-based greeting generator ---

function getTimeOfDay() {
    const hour = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour: 'numeric', hour12: false });
    const h = parseInt(hour);
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 22) return 'evening';
    return 'night';
}

function getDayName() {
    return new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'long' });
}

function isWeekend() {
    const day = new Date().getDay();
    return day === 0 || day === 6;
}

const GREETINGS = {
    morning: [
        '⚡ Системи активовано. Ранковий скан запущено.',
        '🔋 Клешня онлайн. Заряд 100%. Починаємо день.',
        '🛰️ Ранковий брифінг готовий. Ось дані.',
    ],
    afternoon: [
        '📡 Клешня на зв\'язку. Денний звіт сформовано.',
        '🖥️ Сканування завершено. Ось поточний статус.',
        '⚙️ Системи працюють стабільно. Звіт дня готовий.',
    ],
    evening: [
        '🌐 Вечірній моніторинг активний. Статус оновлено.',
        '🔮 Аналіз дня завершено. Підсумки нижче.',
        '📊 Вечірній скан. Все під контролем.',
    ],
    night: [
        '🌌 Нічний режим. Сенсори активні, моніторю парк.',
        '🛸 Нічна вахта Клешні. Системи в нормі.',
        '🔭 Нічне сканування. Рідко хто тут о цій порі.',
    ]
};

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function formatPrice(amount) {
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₴';
}

function generateTemplateMessage(ctx) {
    const time = getTimeOfDay();
    const greeting = pick(GREETINGS[time]);
    const dayName = getDayName();
    const weekend = isWeekend();

    const parts = [greeting];

    // Day context
    if (weekend) {
        parts.push(`[ ${dayName.toUpperCase()} · вихідний режим 🎢 ]`);
    } else {
        parts.push(`[ ${dayName.toUpperCase()} · робочий день ]`);
    }

    // Bookings summary
    if (ctx.bookingsCount > 0) {
        parts.push(`Бронювань: ${ctx.bookingsCount} → ${formatPrice(ctx.totalRevenue)}`);
        if (ctx.preliminaryCount > 0) {
            parts.push(`⚠️ Непідтверджених: ${ctx.preliminaryCount}. Потребують дії.`);
        }
    } else {
        parts.push('Бронювань: 0. Слот вільний.');
    }

    // Tasks
    if (ctx.overdueTasks > 0) {
        parts.push(`🔴 Критичних місій: ${ctx.overdueTasks}. Потрібна увага!`);
    } else if (ctx.pendingTasks > 0) {
        parts.push(`Активних місій: ${ctx.pendingTasks}. Виконання в процесі.`);
    } else {
        parts.push('Всі місії завершено. Статус: зелений. ✅');
    }

    // Streak
    if (ctx.streak >= 7) {
        parts.push(`🔥 Стрік: ${ctx.streak} днів. Рівень: легенда.`);
    } else if (ctx.streak >= 3) {
        parts.push(`🔥 Стрік: ${ctx.streak} днів. Утримуй позицію.`);
    }

    // Animators
    if (ctx.animatorsToday > 0) {
        parts.push(`Команда: ${ctx.animatorsToday} оперативників на зміні.`);
    }

    return parts.join(' ');
}

// --- Gather context from DB ---

async function gatherContext(username, dateStr) {
    const ctx = {
        bookingsCount: 0,
        totalRevenue: 0,
        preliminaryCount: 0,
        pendingTasks: 0,
        overdueTasks: 0,
        streak: 0,
        animatorsToday: 0
    };

    try {
        // Bookings for today
        const bookingsRes = await pool.query(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(price), 0) as revenue FROM bookings WHERE date = $1 AND status != 'cancelled' AND linked_to IS NULL",
            [dateStr]
        );
        ctx.bookingsCount = parseInt(bookingsRes.rows[0].cnt);
        ctx.totalRevenue = parseInt(bookingsRes.rows[0].revenue);

        // Preliminary bookings
        const prelimRes = await pool.query(
            "SELECT COUNT(*) as cnt FROM bookings WHERE date = $1 AND status = 'preliminary' AND linked_to IS NULL",
            [dateStr]
        );
        ctx.preliminaryCount = parseInt(prelimRes.rows[0].cnt);

        // Tasks for user
        if (username) {
            const tasksRes = await pool.query(
                "SELECT status, deadline FROM tasks WHERE (assigned_to = $1 OR owner = $1) AND status NOT IN ('done', 'cancelled')",
                [username]
            );
            const now = new Date();
            for (const t of tasksRes.rows) {
                ctx.pendingTasks++;
                if (t.deadline && new Date(t.deadline) < now) {
                    ctx.overdueTasks++;
                }
            }

            // Streak
            const streakRes = await pool.query(
                "SELECT current_streak FROM user_streaks WHERE username = $1",
                [username]
            );
            if (streakRes.rows.length > 0) {
                ctx.streak = streakRes.rows[0].current_streak || 0;
            }
        }

        // Animators working today
        const animRes = await pool.query(
            "SELECT COUNT(DISTINCT l.line_id) as cnt FROM lines_by_date l WHERE l.date = $1",
            [dateStr]
        );
        ctx.animatorsToday = parseInt(animRes.rows[0].cnt);

    } catch (err) {
        log.error('Error gathering context', err);
    }

    return ctx;
}

// --- Main: get or generate greeting ---

async function getGreeting(username, dateStr) {
    try {
        // 1. Check cache
        const cached = await pool.query(
            `SELECT message, context, source FROM kleshnya_messages
             WHERE scope = 'daily_greeting' AND target_date = $1
             AND (target_user = $2 OR target_user IS NULL)
             AND expires_at > NOW()
             ORDER BY target_user NULLS LAST, created_at DESC
             LIMIT 1`,
            [dateStr, username]
        );

        if (cached.rows.length > 0) {
            return {
                message: cached.rows[0].message,
                context: cached.rows[0].context,
                source: cached.rows[0].source,
                cached: true
            };
        }

        // 2. Gather context
        const ctx = await gatherContext(username, dateStr);

        // 3. Generate (template for now, agent hook later)
        const message = generateTemplateMessage(ctx);

        // 4. Cache it
        const expiresAt = new Date(Date.now() + CACHE_HOURS * 60 * 60 * 1000);
        await pool.query(
            `INSERT INTO kleshnya_messages (scope, target_date, target_user, message, context, source, expires_at)
             VALUES ('daily_greeting', $1, $2, $3, $4, 'template', $5)`,
            [dateStr, username, message, JSON.stringify(ctx), expiresAt]
        );

        return { message, context: ctx, source: 'template', cached: false };

    } catch (err) {
        log.error('Error getting greeting', err);
        return {
            message: '🦀 Привіт! Клешня на зв\'язку — готова допомогти!',
            context: {},
            source: 'fallback',
            cached: false
        };
    }
}

// --- Chat functions ---

async function getChatHistory(username, limit = 50) {
    const result = await pool.query(
        `SELECT id, role, message, created_at FROM kleshnya_chat
         WHERE username = $1 ORDER BY created_at ASC LIMIT $2`,
        [username, limit]
    );
    return result.rows;
}

async function addChatMessage(username, role, message) {
    const result = await pool.query(
        `INSERT INTO kleshnya_chat (username, role, message) VALUES ($1, $2, $3) RETURNING id, created_at`,
        [username, role, message]
    );
    return result.rows[0];
}

// Cleanup expired cached messages (called periodically)
async function cleanupExpired() {
    try {
        const result = await pool.query('DELETE FROM kleshnya_messages WHERE expires_at < NOW()');
        if (result.rowCount > 0) {
            log.info(`Cleaned up ${result.rowCount} expired kleshnya messages`);
        }
    } catch (err) {
        log.error('Error cleaning up expired messages', err);
    }
}

module.exports = { getGreeting, getChatHistory, addChatMessage, cleanupExpired, gatherContext };
