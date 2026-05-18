/**
 * services/bot.js — Clawd Bot command handlers (v11.1)
 *
 * Telegram bot commands for park management:
 *   /menu     — show command menu
 *   /today    — today's bookings summary
 *   /tomorrow — tomorrow's bookings summary
 *   /programs — list active programs by category
 *   /price <code> <new_price> — update product price
 *   /find <query> — search products by name/code
 *   /stats    — monthly statistics
 *   /cert <code> — verify certificate
 *   /tasks    — my tasks for today
 *   /done <id> — complete a task
 *   /alltasks — all team tasks for today
 *   /points   — personal rating + team leaderboard
 *   /streak   — current streak info
 */
const { pool } = require('../db');
const { sendTelegramMessage, telegramRequest } = require('./telegram');
const { createLogger } = require('../utils/logger');
const { getVisibleBookingScope } = require('./bookingVisibility');

const log = createLogger('ClawdBot');

/**
 * Resolve real actor name from Telegram username/chatId.
 * Checks users table first, then staff table, falls back to fromName or 'telegram'.
 */
async function resolveActorName(fromUsername, fromChatId, fromName) {
    if (fromUsername) {
        const userRes = await pool.query(
            'SELECT username FROM users WHERE telegram_username = $1 OR telegram_chat_id = $2 LIMIT 1',
            [fromUsername, fromChatId]
        );
        if (userRes.rows.length > 0) return userRes.rows[0].username;

        const staffRes = await pool.query(
            'SELECT name FROM staff WHERE telegram_username = $1 LIMIT 1',
            [fromUsername]
        );
        if (staffRes.rows.length > 0) return staffRes.rows[0].name;
    }
    return fromName || 'telegram';
}

async function resolveTelegramBookingActor(fromUsername, fromChatId, fromName) {
    if (fromUsername || fromChatId) {
        const userRes = await pool.query(
            `SELECT u.id, u.username, u.name, u.role,
                    ARRAY_REMOVE(ARRAY_AGG(ep.staff_id), NULL) AS staff_ids
             FROM users u
             LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_active = true
             WHERE u.telegram_username = $1 OR u.telegram_chat_id = $2
             GROUP BY u.id, u.username, u.name, u.role
             LIMIT 1`,
            [fromUsername, fromChatId]
        );
        if (userRes.rows.length > 0) {
            const row = userRes.rows[0];
            return {
                id: row.id,
                username: row.username,
                name: row.name,
                role: row.role,
                staffIds: row.staff_ids || []
            };
        }

        if (fromUsername) {
            const staffRes = await pool.query(
                'SELECT id, name FROM staff WHERE telegram_username = $1 LIMIT 1',
                [fromUsername]
            );
            if (staffRes.rows.length > 0) {
                return {
                    username: staffRes.rows[0].name,
                    name: staffRes.rows[0].name,
                    role: 'animator',
                    staffIds: [staffRes.rows[0].id]
                };
            }
        }
    }

    return { username: fromName || fromUsername || 'telegram', role: 'telegram_unknown' };
}

const CATEGORY_NAMES = {
    quest: 'Квести', animation: 'Анімація', show: 'Шоу',
    photo: 'Фото', masterclass: 'Майстер-класи', pinata: 'Піньяти', custom: 'Інше'
};

// Format price Ukrainian style
function fmtPrice(amount) {
    return Number(amount).toLocaleString('uk-UA') + ' ₴';
}

// /menu — show available commands
async function handleMenu(chatId, threadId) {
    const text = `🐾 <b>Clawd Bot — Парк Закревського Періоду</b>\n\n`
        + `Доступні команди:\n\n`
        + `📅 <b>Бронювання</b>\n`
        + `/today — бронювання на сьогодні\n`
        + `/tomorrow — бронювання на завтра\n\n`
        + `📋 <b>Каталог</b>\n`
        + `/programs — каталог програм\n`
        + `/find <запит> — пошук програми\n`
        + `/price <код> <ціна> — змінити ціну\n\n`
        + `🤖 <b>Tasker (Помічник)</b>\n`
        + `/tasks — мої задачі на сьогодні\n`
        + `/done <id> — завершити задачу\n`
        + `/alltasks — всі задачі команди\n`
        + `/points — рейтинг та бали\n`
        + `/streak — мій стрік\n\n`
        + `📊 <b>Інше</b>\n`
        + `/stats — статистика за місяць\n`
        + `/cert <код> — перевірити сертифікат\n`
        + `/menu — це меню`;

    return sendBotMessage(chatId, threadId, text);
}

// /cert or /start cert_CODE — verify certificate by code
async function handleCertVerify(chatId, threadId, code) {
    if (!code || code.trim().length < 3) {
        return sendBotMessage(chatId, threadId, '📄 Використання: /cert <код сертифікату>\nПриклад: /cert CERT-2026-00001');
    }

    const certCode = code.trim().toUpperCase();

    try {
        const result = await pool.query('SELECT * FROM certificates WHERE cert_code = $1', [certCode]);

        if (result.rows.length === 0) {
            return sendBotMessage(chatId, threadId,
                `❌ <b>Сертифікат не знайдено</b>\n\nКод: <code>${escapeHtml(certCode)}</code>\nМожливо, код введено невірно.`
            );
        }

        const cert = result.rows[0];
        const statusMap = {
            active: '🟢 Активний',
            used: '🔵 Використаний',
            expired: '🟠 Прострочений',
            revoked: '🔴 Скасований',
            blocked: '⚫ Заблокований'
        };

        const validDate = cert.valid_until
            ? new Date(cert.valid_until).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Kyiv' })
            : '—';
        const issuedDate = cert.issued_at
            ? new Date(cert.issued_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Kyiv' })
            : '—';

        let text = `📄 <b>Сертифікат ${cert.cert_code}</b>\n\n`;
        text += `${statusMap[cert.status] || cert.status}\n\n`;
        text += `👤 ${escapeHtml(cert.display_value)}\n`;
        text += `📋 ${escapeHtml(cert.type_text || 'на одноразовий вхід')}\n`;
        text += `📅 Видано: ${issuedDate}\n`;
        text += `⏳ Дійсний до: ${validDate}\n`;

        if (cert.status === 'used' && cert.used_at) {
            const usedDate = new Date(cert.used_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Kyiv' });
            text += `\n✅ Використано: ${usedDate}`;
        }
        if (cert.status === 'revoked' || cert.status === 'blocked') {
            if (cert.invalid_reason) {
                text += `\n📝 Причина: ${escapeHtml(cert.invalid_reason)}`;
            }
        }

        text += `\n\n🏢 Парк Закревського Періоду`;

        // If certificate is active — show inline button to mark as used
        if (cert.status === 'active') {
            const payload = {
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                disable_notification: true,
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Використати сертифікат', callback_data: `cert_use:${cert.id}` }
                    ]]
                }
            };
            if (threadId) payload.message_thread_id = threadId;
            return telegramRequest('sendMessage', payload);
        }

        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handleCertVerify error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка перевірки сертифікату');
    }
}

// /today or /tomorrow — bookings summary for a date
async function handleDaySummary(chatId, threadId, date, label, actor = null) {
    try {
        const params = [date];
        const visibility = getVisibleBookingScope(actor, params, 'b');
        const bookings = await pool.query(
            `SELECT b.*, l.name as line_name FROM bookings b
             LEFT JOIN lines_by_date l ON b.line_id = l.line_id AND b.date = l.date
             WHERE b.date = $1
               ${visibility.sql}
             ORDER BY b.time`,
            params
        );

        if (bookings.rows.length === 0) {
            return sendBotMessage(chatId, threadId, `📅 <b>${label} (${date})</b>\n\nБронювань немає`);
        }

        const lines = await pool.query(
            'SELECT name FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]
        );

        let text = `📅 <b>${label} (${date})</b>\n`;
        text += `👥 Аніматори: ${lines.rows.map(l => l.name).join(', ') || 'не призначені'}\n`;
        text += `📊 Бронювань: ${bookings.rows.length}\n\n`;

        const confirmed = bookings.rows.filter(b => b.status !== 'preliminary');
        const preliminary = bookings.rows.filter(b => b.status === 'preliminary');

        if (confirmed.length > 0) {
            text += `✅ <b>Підтверджені (${confirmed.length}):</b>\n`;
            for (const b of confirmed) {
                text += `  ${b.time} ${b.label || b.program_code} — ${b.room}`;
                if (b.line_name) text += ` (${b.line_name})`;
                text += `\n`;
            }
        }

        if (preliminary.length > 0) {
            text += `\n⏳ <b>Попередні (${preliminary.length}):</b>\n`;
            for (const b of preliminary) {
                text += `  ${b.time} ${b.label || b.program_code} — ${b.room}`;
                if (b.line_name) text += ` (${b.line_name})`;
                text += `\n`;
            }
        }

        // Total revenue
        const total = bookings.rows.reduce((sum, b) => sum + (b.price || 0), 0);
        if (total > 0) {
            text += `\n💰 Загалом: ${fmtPrice(total)}`;
        }

        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handleDaySummary error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка завантаження бронювань');
    }
}

// /programs — list active programs grouped by category
async function handlePrograms(chatId, threadId) {
    try {
        const result = await pool.query(
            'SELECT * FROM products WHERE is_active = true ORDER BY category, sort_order LIMIT 500'
        );

        if (result.rows.length === 0) {
            return sendBotMessage(chatId, threadId, '📋 Каталог порожній');
        }

        let text = `📋 <b>Каталог програм (${result.rows.length})</b>\n\n`;

        const byCategory = {};
        for (const p of result.rows) {
            if (!byCategory[p.category]) byCategory[p.category] = [];
            byCategory[p.category].push(p);
        }

        for (const [cat, products] of Object.entries(byCategory)) {
            text += `<b>${CATEGORY_NAMES[cat] || cat}</b>\n`;
            for (const p of products) {
                const priceStr = p.is_per_child ? `${fmtPrice(p.price)}/дит` : fmtPrice(p.price);
                const dur = p.duration > 0 ? ` ${p.duration}хв` : '';
                text += `  ${p.icon || ''} ${p.code} — ${p.name}${dur} (${priceStr})\n`;
            }
            text += '\n';
        }

        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handlePrograms error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка завантаження каталогу');
    }
}

// /find <query> — search products
async function handleFind(chatId, threadId, query) {
    if (!query || query.trim().length < 2) {
        return sendBotMessage(chatId, threadId, '🔍 Використання: /find <назва або код>\nПриклад: /find квест');
    }

    try {
        const q = `%${query.trim().toLowerCase()}%`;
        const result = await pool.query(
            `SELECT * FROM products WHERE is_active = true AND (LOWER(name) LIKE $1 OR LOWER(code) LIKE $1 OR LOWER(label) LIKE $1) ORDER BY category, sort_order`,
            [q]
        );

        if (result.rows.length === 0) {
            return sendBotMessage(chatId, threadId, `🔍 Нічого не знайдено за запитом "<b>${escapeHtml(query)}</b>"`);
        }

        let text = `🔍 Знайдено ${result.rows.length} програм:\n\n`;
        for (const p of result.rows) {
            const priceStr = p.is_per_child ? `${fmtPrice(p.price)}/дит` : fmtPrice(p.price);
            const dur = p.duration > 0 ? ` | ${p.duration}хв` : '';
            text += `${p.icon || ''} <b>${p.code}</b> — ${p.name}\n`;
            text += `   ${priceStr}${dur} | ${p.hosts} вед. | ${CATEGORY_NAMES[p.category] || p.category}\n\n`;
        }

        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handleFind error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка пошуку');
    }
}

// /price <code> <new_price> — update product price
async function handlePrice(chatId, threadId, args) {
    const parts = (args || '').trim().split(/\s+/);

    if (parts.length < 2) {
        return sendBotMessage(chatId, threadId, '💰 Використання: /price <код> <нова ціна>\nПриклад: /price КВ1 2500');
    }

    const code = parts[0];
    const newPrice = parseInt(parts[1]);

    if (isNaN(newPrice) || newPrice < 0) {
        return sendBotMessage(chatId, threadId, '❌ Ціна має бути невід\'ємним числом');
    }

    try {
        // Find product by code (case-insensitive)
        const result = await pool.query(
            `SELECT * FROM products WHERE LOWER(code) = LOWER($1) AND is_active = true`,
            [code]
        );

        if (result.rows.length === 0) {
            return sendBotMessage(chatId, threadId, `❌ Програму з кодом "<b>${escapeHtml(code)}</b>" не знайдено`);
        }

        if (result.rows.length > 1) {
            // Multiple products with same code — ask to be more specific
            let text = `⚠️ Знайдено ${result.rows.length} програм з кодом "${escapeHtml(code)}":\n\n`;
            for (const p of result.rows) {
                text += `  ${p.icon || ''} ${p.label} — ${p.name} (${fmtPrice(p.price)})\n`;
            }
            text += `\nВкажіть мітку замість коду: /price ${result.rows[0].label} ${newPrice}`;
            return sendBotMessage(chatId, threadId, text);
        }

        const product = result.rows[0];
        const oldPrice = product.price;

        await pool.query(
            `UPDATE products SET price = $1, updated_at = NOW(), updated_by = 'clawd_bot' WHERE id = $2`,
            [newPrice, product.id]
        );

        const text = `💰 <b>Ціну оновлено</b>\n\n`
            + `${product.icon || ''} ${product.code} — ${product.name}\n`
            + `Було: ${fmtPrice(oldPrice)}\n`
            + `Стало: <b>${fmtPrice(newPrice)}</b>`;

        log.info(`Price updated via bot: ${product.id} ${oldPrice} -> ${newPrice}`);
        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handlePrice error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка оновлення ціни');
    }
}

// /stats — monthly statistics
async function handleStats(chatId, threadId) {
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const dateFrom = `${year}-${month}-01`;
        const dateTo = `${year}-${month}-31`;

        const result = await pool.query(
            `SELECT COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
                    COUNT(*) FILTER (WHERE status = 'preliminary') as preliminary,
                    SUM(price) as revenue
             FROM bookings WHERE date >= $1 AND date <= $2`,
            [dateFrom, dateTo]
        );

        const row = result.rows[0];
        const months = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
            'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

        let text = `📊 <b>Статистика за ${months[now.getMonth()]} ${year}</b>\n\n`;
        text += `📌 Бронювань: ${row.total}\n`;
        text += `  ✅ Підтверджених: ${row.confirmed}\n`;
        text += `  ⏳ Попередніх: ${row.preliminary}\n`;
        text += `💰 Дохід: ${fmtPrice(row.revenue || 0)}`;

        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handleStats error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка завантаження статистики');
    }
}

// v10.0: /tasks — show my tasks for today
async function handleTasks(chatId, threadId, fromUsername) {
    try {
        const today = formatDate(getKyivNow());

        // Try to find user by telegram username or chat_id
        const userResult = await pool.query(
            'SELECT username FROM users WHERE telegram_username = $1 OR telegram_chat_id = $2 LIMIT 1',
            [fromUsername, chatId]
        );

        let tasks;
        if (userResult.rows.length > 0) {
            const username = userResult.rows[0].username;
            tasks = await pool.query(
                `SELECT * FROM tasks WHERE assigned_to = $1 AND (date = $2 OR (date IS NULL AND status != 'done')) LIMIT 200
                 AND status != 'done'
                 ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END, created_at`,
                [username, today]
            );
        } else {
            // Fallback: show all undone tasks for today
            tasks = await pool.query(
                `SELECT * FROM tasks WHERE date = $1 AND status != 'done' LIMIT 200
                 ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END, created_at`,
                [today]
            );
        }

        if (tasks.rows.length === 0) {
            return sendBotMessage(chatId, threadId, `🤖 <b>Задачі на сьогодні</b>\n\n✅ Немає відкритих задач. Все чисто!`);
        }

        let text = `🤖 <b>Задачі на сьогодні (${today})</b>\n`;
        text += `📋 Відкритих: ${tasks.rows.length}\n\n`;

        const priorityIcon = { high: '🔴', normal: '', low: '🔵' };
        const statusIcon = { todo: '⬜', in_progress: '🔄' };
        const typeIcon = { human: '👤', bot: '🤖' };

        for (let i = 0; i < tasks.rows.length; i++) {
            const t = tasks.rows[i];
            const isLast = i === tasks.rows.length - 1;
            const prefix = isLast ? '└' : '├';
            const pIcon = priorityIcon[t.priority] || '';
            const sIcon = statusIcon[t.status] || '?';
            const tIcon = typeIcon[t.task_type] || '';

            text += `${prefix} ${sIcon}${pIcon}${tIcon} <b>#${t.id}</b> ${escapeHtml(t.title)}`;
            if (t.deadline) {
                const dl = new Date(t.deadline);
                text += ` ⏰${dl.toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })}`;
            }
            text += '\n';
        }

        text += `\n💡 /done <id> — завершити задачу`;
        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handleTasks error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка завантаження задач');
    }
}

// v10.0: /done <id> — complete a task
async function handleDone(chatId, threadId, args, fromUsername) {
    const taskId = parseInt((args || '').trim());
    if (!taskId || isNaN(taskId)) {
        return sendBotMessage(chatId, threadId, '📋 Використання: /done <номер задачі>\nПриклад: /done 42');
    }

    try {
        const { updateTaskStatus } = require('./kleshnya');

        const actor = await resolveActorName(fromUsername, chatId, null);

        const task = await updateTaskStatus(taskId, 'done', actor);

        const text = `✅ <b>Задачу завершено</b>\n\n`
            + `📋 #${task.id} ${escapeHtml(task.title)}\n`
            + `👤 Виконав: ${actor}\n`
            + `\n🤖 Помічник зафіксував`;

        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        if (err.message === 'Task not found') {
            return sendBotMessage(chatId, threadId, `❌ Задачу #${taskId} не знайдено`);
        }
        log.error('handleDone error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка завершення задачі');
    }
}

// v10.0: /alltasks — all team tasks for today
async function handleAllTasks(chatId, threadId) {
    try {
        const today = formatDate(getKyivNow());
        const tasks = await pool.query(
            `SELECT * FROM tasks WHERE (date = $1 OR (date IS NULL AND status != 'done')) LIMIT 200
             AND status != 'done'
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
                      assigned_to NULLS LAST, created_at`,
            [today]
        );

        if (tasks.rows.length === 0) {
            return sendBotMessage(chatId, threadId, `🤖 <b>Задачі команди (${today})</b>\n\n✅ Усі задачі виконані!`);
        }

        let text = `🤖 <b>Задачі команди (${today})</b>\n`;
        text += `📋 Відкритих: ${tasks.rows.length}\n\n`;

        const priorityIcon = { high: '🔴', normal: '', low: '🔵' };
        const statusIcon = { todo: '⬜', in_progress: '🔄' };

        // Group by assignee
        const groups = {};
        for (const t of tasks.rows) {
            const key = t.assigned_to || 'Не призначено';
            if (!groups[key]) groups[key] = [];
            groups[key].push(t);
        }

        for (const [assignee, assigneeTasks] of Object.entries(groups)) {
            text += `👤 <b>${escapeHtml(assignee)}</b> (${assigneeTasks.length})\n`;
            for (let i = 0; i < assigneeTasks.length; i++) {
                const t = assigneeTasks[i];
                const isLast = i === assigneeTasks.length - 1;
                const prefix = isLast ? '  └' : '  ├';
                const pIcon = priorityIcon[t.priority] || '';
                const sIcon = statusIcon[t.status] || '?';
                text += `${prefix} ${sIcon}${pIcon} <b>#${t.id}</b> ${escapeHtml(t.title)}\n`;
            }
            text += '\n';
        }

        text += `💡 /done <id> — завершити задачу`;
        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handleAllTasks error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка завантаження задач');
    }
}

// v11.1: /points — personal rating + team leaderboard
async function handlePoints(chatId, threadId, fromUsername) {
    try {
        const { getUserPoints, getAllPoints } = require('./kleshnya');

        // Resolve username
        let myUsername = null;
        if (fromUsername) {
            const userResult = await pool.query(
                'SELECT username FROM users WHERE telegram_username = $1 OR telegram_chat_id = $2 LIMIT 1',
                [fromUsername, chatId]
            );
            if (userResult.rows.length > 0) myUsername = userResult.rows[0].username;
        }

        // Get leaderboard
        const allPoints = await getAllPoints();

        let text = `🏆 <b>Рейтинг команди</b>\n\n`;

        if (allPoints.length === 0) {
            text += `Поки немає даних.\nВиконуй задачі — набирай бали!\n`;
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            for (let i = 0; i < allPoints.length; i++) {
                const p = allPoints[i];
                const medal = medals[i] || `${i + 1}.`;
                const isMe = myUsername && p.username === myUsername;
                const name = isMe ? `<b>${escapeHtml(p.username)}</b> ← ти` : escapeHtml(p.username);
                text += `${medal} ${name}\n`;
                text += `   💎 ${p.permanent_total || 0} загальних · 📊 ${p.monthly_current || 0} за місяць\n`;
            }
        }

        // Show personal summary if identified
        if (myUsername) {
            const my = await getUserPoints(myUsername);
            text += `\n━━━━━━━━━━━━━━━\n`;
            text += `👤 <b>Твої бали (${my.month})</b>\n`;
            text += `📊 Місячних: <b>${my.monthly_points}</b>\n`;
            text += `💎 Загальних: <b>${my.permanent_points}</b>\n`;
        }

        text += `\n🤖 Помічник рахує все`;
        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handlePoints error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка завантаження рейтингу');
    }
}

// v11.1: /streak — current streak info
async function handleStreak(chatId, threadId, fromUsername) {
    try {
        // Resolve username
        let myUsername = null;
        if (fromUsername) {
            const userResult = await pool.query(
                'SELECT username FROM users WHERE telegram_username = $1 OR telegram_chat_id = $2 LIMIT 1',
                [fromUsername, chatId]
            );
            if (userResult.rows.length > 0) myUsername = userResult.rows[0].username;
        }

        if (!myUsername) {
            return sendBotMessage(chatId, threadId,
                '🔥 Стрік відстежується автоматично.\n\nНапишіть боту /start у приватному чаті щоб з\'єднати акаунт.');
        }

        const streakResult = await pool.query(
            'SELECT current_streak, longest_streak, last_active_date FROM user_streaks WHERE username = $1',
            [myUsername]
        );

        if (streakResult.rows.length === 0 || !streakResult.rows[0].current_streak) {
            return sendBotMessage(chatId, threadId,
                `🔥 <b>Стрік: ${myUsername}</b>\n\nПоки 0 днів. Заходь щодня — Помічник рахує!`);
        }

        const s = streakResult.rows[0];
        let text = `🔥 <b>Стрік: ${escapeHtml(myUsername)}</b>\n\n`;
        text += `📅 Поточний: <b>${s.current_streak}</b> днів\n`;
        text += `🏆 Найдовший: <b>${s.longest_streak}</b> днів\n`;
        if (s.last_active_date) text += `⏰ Останній вхід: ${s.last_active_date}\n`;

        if (s.current_streak >= 30) text += `\n🌟 Легенда! Місяць без перерви!`;
        else if (s.current_streak >= 14) text += `\n💪 Два тижні поспіль — красунчик!`;
        else if (s.current_streak >= 7) text += `\n🔥 Тижневий стрік — тримай так!`;
        else if (s.current_streak >= 3) text += `\n👍 Добрий початок, не зупиняйся!`;

        text += `\n\n🤖 Помічник рахує все`;
        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handleStreak error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка завантаження стріку');
    }
}

// v11.1: /start — personal greeting for private chats
async function handleStart(chatId, threadId, fromUsername) {
    // Register chat_id for personal notifications
    if (fromUsername) {
        try {
            await pool.query(
                'UPDATE users SET telegram_chat_id = $1 WHERE telegram_username = $2',
                [chatId, fromUsername]
            );
        } catch (e) { /* ignore */ }
    }

    const name = fromUsername ? `@${fromUsername}` : 'друже';
    const text = `🤖 <b>Привіт, ${escapeHtml(name)}!</b>\n\n`
        + `Я Помічник — бот Парку Закревського Періоду.\n`
        + `Тепер ти будеш отримувати персональні сповіщення прямо сюди.\n\n`
        + `✅ Акаунт з'єднано\n\n`
        + `Напиши /menu щоб побачити всі команди.`;

    return sendBotMessage(chatId, threadId, text);
}

// v11.1: Register bot commands in Telegram menu
async function registerBotCommands() {
    try {
        const commands = [
            { command: 'today', description: 'Бронювання на сьогодні' },
            { command: 'tomorrow', description: 'Бронювання на завтра' },
            { command: 'tasks', description: 'Мої задачі на сьогодні' },
            { command: 'done', description: 'Завершити задачу (+ номер)' },
            { command: 'alltasks', description: 'Задачі всієї команди' },
            { command: 'points', description: 'Рейтинг та бали' },
            { command: 'streak', description: 'Мій стрік' },
            { command: 'programs', description: 'Каталог програм' },
            { command: 'find', description: 'Пошук програми' },
            { command: 'stats', description: 'Статистика за місяць' },
            { command: 'cert', description: 'Перевірити сертифікат' },
            { command: 'menu', description: 'Всі команди' },
        ];

        const result = await telegramRequest('setMyCommands', { commands });
        if (result && result.ok) {
            log.info(`Bot menu registered: ${commands.length} commands`);
        } else {
            log.warn('setMyCommands failed', result);
        }
        return result;
    } catch (err) {
        log.error('registerBotCommands error', err);
        return null;
    }
}

// Helper: send message respecting thread
async function sendBotMessage(chatId, threadId, text) {
    const payload = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_notification: true
    };
    if (threadId) payload.message_thread_id = threadId;
    return telegramRequest('sendMessage', payload);
}

// Helper: escape HTML for Telegram
function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Get current date in Kyiv timezone
function getKyivNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
}

// Format date as YYYY-MM-DD
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Main command router — called from webhook handler
 * @param {string|number} fromUsername — Telegram username of sender (for /tasks)
 */
async function handleBotCommand(chatId, threadId, text, fromUsername) {
    const trimmed = text.trim();
    const command = trimmed.split(/\s+/)[0].toLowerCase().replace(/@.*$/, ''); // remove @botname
    const args = trimmed.slice(command.length).trim();

    log.info(`Bot command: ${command} from chat ${chatId} (user: ${fromUsername || '?'})`);

    switch (command) {
        case '/menu':
        case '/help':
            return handleMenu(chatId, threadId);

        case '/start':
            // Deep link: /start cert_CERT-2026-00001
            if (args && args.startsWith('cert_')) {
                return handleCertVerify(chatId, threadId, args.slice(5));
            }
            return handleStart(chatId, threadId, fromUsername);

        case '/today':
            return handleDaySummary(
                chatId,
                threadId,
                formatDate(getKyivNow()),
                'Сьогодні',
                await resolveTelegramBookingActor(fromUsername, chatId, null)
            );

        case '/tomorrow': {
            const tomorrow = getKyivNow();
            tomorrow.setDate(tomorrow.getDate() + 1);
            return handleDaySummary(
                chatId,
                threadId,
                formatDate(tomorrow),
                'Завтра',
                await resolveTelegramBookingActor(fromUsername, chatId, null)
            );
        }

        case '/programs':
            return handlePrograms(chatId, threadId);

        case '/find':
            return handleFind(chatId, threadId, args);

        case '/price':
            return handlePrice(chatId, threadId, args);

        case '/stats':
            return handleStats(chatId, threadId);

        case '/cert':
            return handleCertVerify(chatId, threadId, args);

        case '/tasks':
            return handleTasks(chatId, threadId, fromUsername);

        case '/done':
            return handleDone(chatId, threadId, args, fromUsername);

        case '/alltasks':
            return handleAllTasks(chatId, threadId);

        case '/points':
        case '/rating':
            return handlePoints(chatId, threadId, fromUsername);

        case '/streak':
            return handleStreak(chatId, threadId, fromUsername);

        default:
            return null; // Not a known command — ignore
    }
}

/**
 * Handle cert_use callback — mark certificate as used
 */
async function handleCertUse(certId, callbackQueryId, chatId, threadId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lock row and check status
        const result = await client.query(
            'SELECT * FROM certificates WHERE id = $1 FOR UPDATE',
            [certId]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            await telegramRequest('answerCallbackQuery', {
                callback_query_id: callbackQueryId,
                text: 'Сертифікат не знайдено',
                show_alert: true
            });
            return;
        }

        const cert = result.rows[0];

        if (cert.status !== 'active') {
            await client.query('ROLLBACK');
            const statusNames = {
                used: 'вже використаний',
                expired: 'прострочений',
                revoked: 'скасований',
                blocked: 'заблокований'
            };
            await telegramRequest('answerCallbackQuery', {
                callback_query_id: callbackQueryId,
                text: `Сертифікат ${statusNames[cert.status] || cert.status}`,
                show_alert: true
            });
            return;
        }

        // Mark as used
        await client.query(
            `UPDATE certificates SET status = 'used', used_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [certId]
        );

        await client.query('COMMIT');

        // Answer callback
        await telegramRequest('answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text: '✅ Сертифікат активовано!'
        });

        // Update the message — remove button, show new status
        const usedDate = new Date().toLocaleDateString('uk-UA', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Europe/Kyiv'
        });

        let text = `📄 <b>Сертифікат ${cert.cert_code}</b>\n\n`;
        text += `✅ <b>ВИКОРИСТАНО</b> — ${usedDate}\n\n`;
        text += `👤 ${escapeHtml(cert.display_value)}\n`;
        text += `📋 ${escapeHtml(cert.type_text || 'на одноразовий вхід')}\n\n`;
        text += `🏢 Парк Закревського Періоду`;

        await sendBotMessage(chatId, threadId, text);

        // Fire-and-forget: alert director
        try {
            const directorResult = await pool.query(
                "SELECT value FROM settings WHERE key = 'cert_director_chat_id'"
            );
            if (directorResult.rows.length > 0 && directorResult.rows[0].value) {
                const dirChatId = directorResult.rows[0].value;
                const alertText = `🔔 <b>Сертифікат використано</b>\n\n`
                    + `📄 ${cert.cert_code}\n`
                    + `👤 ${escapeHtml(cert.display_value)}\n`
                    + `📋 ${escapeHtml(cert.type_text || 'на одноразовий вхід')}\n`
                    + `⏰ ${usedDate}`;
                sendBotMessage(dirChatId, null, alertText).catch(() => {});
            }
        } catch (e) {
            log.error('Failed to send director cert alert', e);
        }

        log.info(`Certificate ${cert.cert_code} marked as used via bot`);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('handleCertUse error', err);
        await telegramRequest('answerCallbackQuery', {
            callback_query_id: callbackQueryId,
            text: 'Помилка активації сертифікату',
            show_alert: true
        });
    } finally {
        client.release();
    }
}

module.exports = { handleBotCommand, handleCertUse, registerBotCommands, resolveActorName };
