/**
 * services/bot.js — Clawd Bot command handlers (v7.2)
 *
 * Telegram bot commands for park management:
 *   /menu     — show command menu
 *   /today    — today's bookings summary
 *   /tomorrow — tomorrow's bookings summary
 *   /programs — list active programs by category
 *   /price <code> <new_price> — update product price
 *   /find <query> — search products by name/code
 */
const { pool } = require('../db');
const { sendTelegramMessage, telegramRequest } = require('./telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('ClawdBot');

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
        + `/today — бронювання на сьогодні\n`
        + `/tomorrow — бронювання на завтра\n`
        + `/programs — каталог програм\n`
        + `/find <запит> — пошук програми\n`
        + `/price <код> <ціна> — змінити ціну\n`
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
            ? new Date(cert.valid_until).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
        const issuedDate = cert.issued_at
            ? new Date(cert.issued_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';

        let text = `📄 <b>Сертифікат ${cert.cert_code}</b>\n\n`;
        text += `${statusMap[cert.status] || cert.status}\n\n`;
        text += `👤 ${escapeHtml(cert.display_value)}\n`;
        text += `📋 ${escapeHtml(cert.type_text || 'на одноразовий вхід')}\n`;
        text += `📅 Видано: ${issuedDate}\n`;
        text += `⏳ Дійсний до: ${validDate}\n`;

        if (cert.status === 'used' && cert.used_at) {
            const usedDate = new Date(cert.used_at).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
            text += `\n✅ Використано: ${usedDate}`;
        }
        if (cert.status === 'revoked' || cert.status === 'blocked') {
            if (cert.invalid_reason) {
                text += `\n📝 Причина: ${escapeHtml(cert.invalid_reason)}`;
            }
        }

        text += `\n\n🏢 Парк Закревського Періоду`;

        return sendBotMessage(chatId, threadId, text);
    } catch (err) {
        log.error('handleCertVerify error', err);
        return sendBotMessage(chatId, threadId, '❌ Помилка перевірки сертифікату');
    }
}

// /today or /tomorrow — bookings summary for a date
async function handleDaySummary(chatId, threadId, date, label) {
    try {
        const bookings = await pool.query(
            `SELECT b.*, l.name as line_name FROM bookings b
             LEFT JOIN lines_by_date l ON b.line_id = l.line_id AND b.date = l.date
             WHERE b.date = $1 ORDER BY b.time`,
            [date]
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
            'SELECT * FROM products WHERE is_active = true ORDER BY category, sort_order'
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
 */
async function handleBotCommand(chatId, threadId, text) {
    const trimmed = text.trim();
    const command = trimmed.split(/\s+/)[0].toLowerCase().replace(/@.*$/, ''); // remove @botname
    const args = trimmed.slice(command.length).trim();

    log.info(`Bot command: ${command} from chat ${chatId}`);

    switch (command) {
        case '/menu':
        case '/help':
            return handleMenu(chatId, threadId);

        case '/start':
            // Deep link: /start cert_CERT-2026-00001
            if (args && args.startsWith('cert_')) {
                return handleCertVerify(chatId, threadId, args.slice(5));
            }
            return handleMenu(chatId, threadId);

        case '/today':
            return handleDaySummary(chatId, threadId, formatDate(getKyivNow()), 'Сьогодні');

        case '/tomorrow': {
            const tomorrow = getKyivNow();
            tomorrow.setDate(tomorrow.getDate() + 1);
            return handleDaySummary(chatId, threadId, formatDate(tomorrow), 'Завтра');
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

        default:
            return null; // Not a known command — ignore
    }
}

module.exports = { handleBotCommand };
