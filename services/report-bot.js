/**
 * services/report-bot.js — Report Bot (Telegram) for financial report submission
 *
 * Separate Telegram bot for accountants and staff to submit reports:
 *   /start     — welcome + instructions
 *   /report    — start new report (interactive)
 *   /income    — quick income report: /income 5000 Оплата за свято
 *   /expense   — quick expense report: /expense 1200 Кульки
 *   /summary   — today's summary (income/expense/profit)
 *   /status    — pending reports count
 *   /help      — command list
 *
 * Also handles:
 *   - Photo messages → expense report with receipt photo
 *   - Voice messages → placeholder for voice transcript
 *   - Text (non-command) → interprets as report if session active
 */

const https = require('https');
const crypto = require('crypto');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('ReportBot');

const REPORT_BOT_TOKEN = process.env.REPORT_BOT_TOKEN || '';
const REPORT_WEBHOOK_SECRET = process.env.REPORT_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');

if (!REPORT_BOT_TOKEN) {
    log.warn('REPORT_BOT_TOKEN not set. Report bot disabled.');
}

// ==========================================
// TELEGRAM API (separate bot token)
// ==========================================

const SOCKET_TIMEOUT = 15000;
const RESPONSE_TIMEOUT = 15000;

let consecutiveFailures = 0;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 60000;
let circuitOpenUntil = 0;

function isCircuitOpen() {
    if (consecutiveFailures < CIRCUIT_THRESHOLD) return false;
    if (Date.now() >= circuitOpenUntil) return false;
    return true;
}

function reportBotRequest(method, body) {
    if (!REPORT_BOT_TOKEN) {
        return Promise.resolve({ ok: false, description: 'No report bot token' });
    }
    if (isCircuitOpen()) {
        return Promise.reject(new Error('Report bot circuit breaker OPEN'));
    }

    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${REPORT_BOT_TOKEN}/${method}`,
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
            timeout: SOCKET_TIMEOUT
        };

        const responseTimer = setTimeout(() => {
            req.destroy(new Error(`Report bot API timeout for ${method}`));
        }, RESPONSE_TIMEOUT);

        const req = https.request(options, (res) => {
            let result = '';
            res.on('data', (chunk) => result += chunk);
            res.on('end', () => {
                clearTimeout(responseTimer);
                try {
                    const parsed = JSON.parse(result);
                    consecutiveFailures = 0;
                    resolve(parsed);
                } catch (e) {
                    consecutiveFailures++;
                    if (consecutiveFailures >= CIRCUIT_THRESHOLD) circuitOpenUntil = Date.now() + CIRCUIT_RESET_MS;
                    reject(e);
                }
            });
        });

        req.on('timeout', () => req.destroy(new Error('Report bot socket timeout')));
        req.on('error', (err) => {
            clearTimeout(responseTimer);
            consecutiveFailures++;
            if (consecutiveFailures >= CIRCUIT_THRESHOLD) circuitOpenUntil = Date.now() + CIRCUIT_RESET_MS;
            reject(err);
        });

        if (body) req.write(data);
        req.end();
    });
}

async function sendMessage(chatId, text, options = {}) {
    const payload = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_notification: options.silent || false
    };
    if (options.reply_markup) payload.reply_markup = options.reply_markup;
    try {
        const result = await reportBotRequest('sendMessage', payload);
        if (result && result.ok) {
            log.info(`Report bot message sent to ${chatId}`);
        } else {
            log.warn('Report bot sendMessage failed', result);
        }
        return result;
    } catch (err) {
        log.error(`Report bot sendMessage error: ${err.message}`);
        return null;
    }
}

async function answerCallback(callbackQueryId, text) {
    return reportBotRequest('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}

async function clearInlineKeyboard(chatId, messageId) {
    if (!chatId || !messageId) return null;
    try {
        return await reportBotRequest('editMessageReplyMarkup', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] }
        });
    } catch (err) {
        log.warn(`Report bot editMessageReplyMarkup failed: ${err.message}`);
        return null;
    }
}

function isCallbackForStep(session, step, messageIdKey, messageId) {
    if (!session || session.step !== step) return false;
    return String(session[messageIdKey]) === String(messageId);
}

// ==========================================
// SESSION STATE (in-memory, per chat)
// ==========================================

// Sessions for multi-step report creation
// Key: chatId, Value: { step, type, amount, description, category, photoFileId }
const sessions = new Map();
const SESSION_TTL = 600000; // 10 min

function getSession(chatId) {
    const s = sessions.get(chatId);
    if (s && Date.now() - s.createdAt > SESSION_TTL) {
        sessions.delete(chatId);
        return null;
    }
    return s || null;
}

function setSession(chatId, data) {
    sessions.set(chatId, { ...data, createdAt: Date.now() });
}

function clearSession(chatId) {
    sessions.delete(chatId);
}

// ==========================================
// CATEGORIES
// ==========================================

const EXPENSE_CATEGORIES = [
    'Декор', 'Їжа/Напої', 'Канцелярія', 'Кульки', 'Реквізит',
    'Транспорт', 'Оренда', 'Зарплата', 'Маркетинг', 'Інше'
];

const INCOME_CATEGORIES = [
    'Свято', 'Квест', 'Анімація', 'Шоу', 'Майстер-клас',
    'Фотозона', 'Сертифікат', 'Товари', 'Інше'
];

// ==========================================
// HELPERS
// ==========================================

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatMoney(amount) {
    return Number(amount).toLocaleString('uk-UA') + ' ₴';
}

function getKyivNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
}

function todayDateStr() {
    const d = getKyivNow();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Resolve username → staff name
async function resolveUser(fromUsername, fromChatId, fromName) {
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
    return fromName || fromUsername || 'Невідомий';
}

// ==========================================
// REPORT CREATION (DB)
// ==========================================

async function createReport({ type, amount, description, category, submittedBy, submittedVia, photoFileId, voiceTranscript }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Build photo URL from file_id if present
        let photoUrl = null;
        if (photoFileId) {
            photoUrl = `tg:file_id:${photoFileId}`;
        }

        const result = await client.query(`
            INSERT INTO reports (type, amount, description, category, submitted_by, submitted_via, photo_url, voice_transcript, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new')
            RETURNING id
        `, [type, amount || 0, description || '', category || 'Інше', submittedBy, submittedVia || 'bot', photoUrl, voiceTranscript || null]);

        const reportId = result.rows[0].id;

        // Auto-assign to on-duty accountant
        const accountant = await client.query('SELECT id, chat_id, name FROM accountants WHERE is_on_duty = true LIMIT 1');
        if (accountant.rows.length > 0) {
            await client.query('UPDATE reports SET assigned_to = $1, assigned_at = NOW() WHERE id = $2', [accountant.rows[0].id, reportId]);
        }

        await client.query('COMMIT');

        // Notify accountant (fire-and-forget)
        if (accountant.rows.length > 0 && accountant.rows[0].chat_id) {
            const typeEmoji = type === 'income' ? '💰' : '💸';
            const notifText = `${typeEmoji} <b>Новий звіт #${reportId}</b>\n`
                + `Тип: ${type === 'income' ? 'Дохід' : 'Витрата'}\n`
                + `Сума: <b>${formatMoney(amount)}</b>\n`
                + `Категорія: ${escapeHtml(category || 'Інше')}\n`
                + `Опис: ${escapeHtml(description || '—')}\n`
                + `Від: ${escapeHtml(submittedBy)}\n`
                + (photoFileId ? '📸 Фото чеку додано\n' : '')
                + `\nПризначено: ${escapeHtml(accountant.rows[0].name)}`;

            // Notify via MAIN bot (accountant is subscribed to main bot)
            try {
                const { sendTelegramMessage } = require('./telegram');
                sendTelegramMessage(accountant.rows[0].chat_id, notifText).catch(() => {});
            } catch { /* main bot not available */ }
        }

        return reportId;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ==========================================
// COMMAND HANDLERS
// ==========================================

async function handleStart(chatId) {
    const text = `📊 <b>Бот Звітів — Парк Закревського Періоду</b>\n\n`
        + `Я допомагаю вести облік доходів та витрат.\n\n`
        + `<b>Швидкі команди:</b>\n`
        + `/income 5000 Оплата за свято — дохід\n`
        + `/expense 1200 Кульки — витрата\n`
        + `/report — інтерактивне створення\n`
        + `/summary — зведення за сьогодні\n`
        + `/status — необроблені звіти\n\n`
        + `📸 Надішліть <b>фото чеку</b> — створю витрату\n`
        + `🎤 Надішліть <b>голосове</b> — запишу звіт\n\n`
        + `Введіть /help для повного списку команд.`;
    return sendMessage(chatId, text);
}

async function handleHelp(chatId) {
    const text = `📋 <b>Команди бота звітів</b>\n\n`
        + `/report — інтерактивне створення звіту\n`
        + `/income [сума] [опис] — швидкий дохід\n`
        + `/expense [сума] [опис] — швидка витрата\n`
        + `/summary — зведення за сьогодні\n`
        + `/week — зведення за тиждень\n`
        + `/status — кількість необроблених\n`
        + `/cancel — скасувати поточну дію\n\n`
        + `📸 Фото → автоматично витрата з чеком\n`
        + `🎤 Голосове → звіт з транскриптом`;
    return sendMessage(chatId, text);
}

async function handleQuickReport(chatId, type, args, fromUsername, fromChatId, fromName) {
    const parts = (args || '').trim().split(/\s+/);
    const amountStr = parts[0];
    const amount = parseFloat(amountStr);

    if (!amountStr || isNaN(amount) || amount <= 0) {
        const example = type === 'income'
            ? '/income 5000 Оплата за день народження'
            : '/expense 1200 Кульки для свята';
        return sendMessage(chatId, `❌ Вкажіть суму та опис.\n\nПриклад: <code>${example}</code>`);
    }

    const description = parts.slice(1).join(' ') || '';
    const submittedBy = await resolveUser(fromUsername, fromChatId, fromName);

    try {
        const reportId = await createReport({
            type,
            amount,
            description,
            category: 'Інше',
            submittedBy,
            submittedVia: 'bot'
        });

        const emoji = type === 'income' ? '💰' : '💸';
        const typeLabel = type === 'income' ? 'Дохід' : 'Витрата';
        return sendMessage(chatId,
            `${emoji} <b>${typeLabel} #${reportId} збережено!</b>\n\n`
            + `Сума: <b>${formatMoney(amount)}</b>\n`
            + `Опис: ${escapeHtml(description) || '—'}\n`
            + `Від: ${escapeHtml(submittedBy)}`
        );
    } catch (err) {
        log.error('Quick report error', err);
        return sendMessage(chatId, '❌ Помилка збереження звіту. Спробуйте ще раз.');
    }
}

async function handleInteractiveReport(chatId) {
    setSession(chatId, { step: 'type' });

    const sent = await sendMessage(chatId, '📝 <b>Новий звіт</b>\n\nОберіть тип:', {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '💰 Дохід', callback_data: 'rtype:income' },
                    { text: '💸 Витрата', callback_data: 'rtype:expense' }
                ],
                [
                    { text: '❌ Скасувати', callback_data: 'rtype:cancel' }
                ]
            ]
        }
    });
    const messageId = sent?.result?.message_id;
    if (messageId) {
        setSession(chatId, { step: 'type', typeMessageId: messageId });
    }
    return sent;
}

async function handleSummary(chatId, period = 'today') {
    try {
        let fromDate, periodLabel;
        const today = todayDateStr();

        if (period === 'week') {
            const d = getKyivNow();
            d.setDate(d.getDate() - 7);
            fromDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            periodLabel = 'за тиждень';
        } else {
            fromDate = today;
            periodLabel = 'за сьогодні';
        }

        const result = await pool.query(`
            SELECT type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
            GROUP BY type
        `, [fromDate, today]);

        const income = result.rows.find(r => r.type === 'income');
        const expense = result.rows.find(r => r.type === 'expense');
        const incomeTotal = parseFloat(income?.total || 0);
        const expenseTotal = parseFloat(expense?.total || 0);
        const profit = incomeTotal - expenseTotal;
        const profitEmoji = profit >= 0 ? '📈' : '📉';

        const text = `📊 <b>Зведення ${periodLabel}</b>\n\n`
            + `💰 Доходи: <b>${formatMoney(incomeTotal)}</b> (${income?.count || 0} шт)\n`
            + `💸 Витрати: <b>${formatMoney(expenseTotal)}</b> (${expense?.count || 0} шт)\n`
            + `${profitEmoji} Прибуток: <b>${formatMoney(profit)}</b>\n\n`
            + `📋 Всього звітів: ${(parseInt(income?.count || 0) + parseInt(expense?.count || 0))}`;

        return sendMessage(chatId, text);
    } catch (err) {
        log.error('Summary error', err);
        return sendMessage(chatId, '❌ Помилка отримання зведення.');
    }
}

async function handleStatus(chatId) {
    try {
        const result = await pool.query(`
            SELECT status, COUNT(*) as count
            FROM reports
            WHERE created_at >= (NOW() - interval '30 days')
            GROUP BY status
        `);

        const statusMap = {};
        for (const r of result.rows) statusMap[r.status] = parseInt(r.count);

        const text = `📋 <b>Статус звітів (30 днів)</b>\n\n`
            + `🆕 Нові: ${statusMap.new || 0}\n`
            + `⏳ В обробці: ${statusMap.processing || 0}\n`
            + `✅ Опрацьовані: ${statusMap.done || 0}\n`
            + `❌ Відхилені: ${statusMap.rejected || 0}`;

        return sendMessage(chatId, text);
    } catch (err) {
        log.error('Status error', err);
        return sendMessage(chatId, '❌ Помилка отримання статусу.');
    }
}

async function handleCancel(chatId) {
    const session = getSession(chatId);
    if (session) {
        clearSession(chatId);
        return sendMessage(chatId, '❌ Створення звіту скасовано.');
    }
    return sendMessage(chatId, 'Немає активних дій для скасування.');
}

// ==========================================
// PHOTO / VOICE HANDLERS
// ==========================================

async function handlePhoto(chatId, message) {
    const fromUsername = message.from?.username || null;
    const fromName = message.from?.first_name || null;
    const submittedBy = await resolveUser(fromUsername, chatId, fromName);

    // Get largest photo
    const photos = message.photo || [];
    const photo = photos[photos.length - 1];
    if (!photo) return;

    const fileId = photo.file_id;
    const caption = message.caption || '';

    // Parse amount from caption if present (e.g. "1500 кульки")
    const amountMatch = caption.match(/^(\d+[\d\s]*[\d.,]*)/);
    let amount = 0;
    let description = caption;
    if (amountMatch) {
        amount = parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.'));
        description = caption.slice(amountMatch[0].length).trim();
    }

    try {
        const reportId = await createReport({
            type: 'expense',
            amount,
            description: description || 'Фото чеку',
            category: 'Інше',
            submittedBy,
            submittedVia: 'bot',
            photoFileId: fileId
        });

        let text = `📸 <b>Витрата #${reportId} з фото збережена!</b>\n\n`;
        if (amount > 0) {
            text += `Сума: <b>${formatMoney(amount)}</b>\n`;
        } else {
            text += `⚠️ Сума не вказана — додайте підпис з сумою до фото\n`;
        }
        text += `Опис: ${escapeHtml(description) || 'Фото чеку'}\n`;
        text += `Від: ${escapeHtml(submittedBy)}`;

        if (amount === 0) {
            text += `\n\n💡 <i>Підказка: надішліть фото з підписом "1500 Кульки" щоб одразу вказати суму</i>`;
        }

        return sendMessage(chatId, text);
    } catch (err) {
        log.error('Photo report error', err);
        return sendMessage(chatId, '❌ Помилка збереження фото-звіту.');
    }
}

async function handleVoice(chatId, message) {
    const fromUsername = message.from?.username || null;
    const fromName = message.from?.first_name || null;
    const submittedBy = await resolveUser(fromUsername, chatId, fromName);

    const voice = message.voice;
    if (!voice) return;

    const fileId = voice.file_id;
    const duration = voice.duration || 0;

    try {
        const reportId = await createReport({
            type: 'expense',
            amount: 0,
            description: `Голосовий звіт (${duration}с)`,
            category: 'Інше',
            submittedBy,
            submittedVia: 'bot',
            voiceTranscript: `[voice:${fileId}:${duration}s]`
        });

        return sendMessage(chatId,
            `🎤 <b>Голосовий звіт #${reportId} збережено!</b>\n\n`
            + `Тривалість: ${duration}с\n`
            + `Від: ${escapeHtml(submittedBy)}\n\n`
            + `⚠️ Суму та категорію потрібно вказати вручну в веб-інтерфейсі або командою:\n`
            + `<code>/income ${reportId} 5000</code> чи <code>/expense ${reportId} 1200</code>`
        );
    } catch (err) {
        log.error('Voice report error', err);
        return sendMessage(chatId, '❌ Помилка збереження голосового звіту.');
    }
}

// ==========================================
// CALLBACK QUERY HANDLER
// ==========================================

async function handleCallback(callbackQuery) {
    const { id, data, message } = callbackQuery;
    const chatId = message.chat.id;
    const messageId = message.message_id;

    // Type selection: rtype:income / rtype:expense / rtype:cancel
    if (data.startsWith('rtype:')) {
        const type = data.split(':')[1];
        const session = getSession(chatId);
        if (!isCallbackForStep(session, 'type', 'typeMessageId', messageId)) {
            await answerCallback(id, 'Вибір уже неактивний');
            await clearInlineKeyboard(chatId, messageId);
            return null;
        }

        if (type === 'cancel') {
            clearSession(chatId);
            await answerCallback(id, 'Скасовано');
            await clearInlineKeyboard(chatId, messageId);
            return sendMessage(chatId, '❌ Скасовано.');
        }

        setSession(chatId, { ...session, step: 'amount', type });
        await answerCallback(id, type === 'income' ? 'Дохід' : 'Витрата');
        await clearInlineKeyboard(chatId, messageId);
        return sendMessage(chatId, `${type === 'income' ? '💰' : '💸'} Тип: <b>${type === 'income' ? 'Дохід' : 'Витрата'}</b>\n\nВведіть суму (число):`);
    }

    // Category selection: rcat:Декор
    if (data.startsWith('rcat:')) {
        const category = data.split(':')[1];
        const session = getSession(chatId);
        if (!isCallbackForStep(session, 'category', 'categoryMessageId', messageId)) {
            await answerCallback(id, 'Вибір уже неактивний');
            await clearInlineKeyboard(chatId, messageId);
            return null;
        }

        setSession(chatId, { ...session, step: 'saving', category });
        await answerCallback(id, category);

        const fromUsername = message.chat?.username || null;
        const fromName = message.chat?.first_name || null;
        const submittedBy = await resolveUser(fromUsername, chatId, fromName);

        try {
            const reportId = await createReport({
                type: session.type,
                amount: session.amount,
                description: session.description,
                category,
                submittedBy,
                submittedVia: 'bot',
                photoFileId: session.photoFileId || null
            });

            clearSession(chatId);
            await clearInlineKeyboard(chatId, messageId);

            const emoji = session.type === 'income' ? '💰' : '💸';
            const typeLabel = session.type === 'income' ? 'Дохід' : 'Витрата';
            return sendMessage(chatId,
                `✅ <b>${typeLabel} #${reportId} збережено!</b>\n\n`
                + `Сума: <b>${formatMoney(session.amount)}</b>\n`
                + `Категорія: ${escapeHtml(category)}\n`
                + `Опис: ${escapeHtml(session.description) || '—'}\n`
                + `Від: ${escapeHtml(submittedBy)}`
            );
        } catch (err) {
            log.error('Interactive report save error', err);
            clearSession(chatId);
            await clearInlineKeyboard(chatId, messageId);
            return sendMessage(chatId, '❌ Помилка збереження. Спробуйте ще.');
        }
    }

    await answerCallback(id, '?');
}

// ==========================================
// TEXT MESSAGE HANDLER (session-based)
// ==========================================

async function handleTextMessage(chatId, text, message) {
    const session = getSession(chatId);
    if (!session) return; // No active session — ignore non-command text

    if (session.step === 'amount') {
        const amount = parseFloat(text.replace(/\s/g, '').replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
            return sendMessage(chatId, '❌ Введіть коректну суму (число більше 0).\n\nНаприклад: <code>1500</code> або <code>2500.50</code>');
        }
        setSession(chatId, { ...session, step: 'description', amount });
        return sendMessage(chatId, `Сума: <b>${formatMoney(amount)}</b>\n\nВведіть опис (або надішліть "-" щоб пропустити):`);
    }

    if (session.step === 'description') {
        const description = text.trim() === '-' ? '' : text.trim();
        setSession(chatId, { ...session, step: 'category', description });

        const categories = session.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
        const buttons = [];
        for (let i = 0; i < categories.length; i += 2) {
            const row = [{ text: categories[i], callback_data: `rcat:${categories[i]}` }];
            if (categories[i + 1]) {
                row.push({ text: categories[i + 1], callback_data: `rcat:${categories[i + 1]}` });
            }
            buttons.push(row);
        }

        const sent = await sendMessage(chatId, `Опис: ${escapeHtml(description) || '—'}\n\nОберіть категорію:`, {
            reply_markup: { inline_keyboard: buttons }
        });
        const messageId = sent?.result?.message_id;
        if (messageId) {
            const latestSession = getSession(chatId);
            if (latestSession && latestSession.step === 'category') {
                setSession(chatId, { ...latestSession, categoryMessageId: messageId });
            }
        }
        return sent;
    }
}

// ==========================================
// MAIN COMMAND ROUTER
// ==========================================

async function handleCommand(chatId, text, message) {
    const trimmed = text.trim();
    const command = trimmed.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
    const args = trimmed.slice(command.length).trim();

    const fromUsername = message.from?.username || null;
    const fromName = message.from?.first_name || null;

    log.info(`Report bot command: ${command} from chat ${chatId} (user: ${fromUsername || '?'})`);

    switch (command) {
        case '/start':
            return handleStart(chatId);

        case '/help':
            return handleHelp(chatId);

        case '/report':
        case '/zvit':
            return handleInteractiveReport(chatId);

        case '/income':
            return handleQuickReport(chatId, 'income', args, fromUsername, chatId, fromName);

        case '/expense':
        case '/витрата':
            return handleQuickReport(chatId, 'expense', args, fromUsername, chatId, fromName);

        case '/summary':
        case '/звіт':
            return handleSummary(chatId, 'today');

        case '/week':
        case '/тиждень':
            return handleSummary(chatId, 'week');

        case '/status':
            return handleStatus(chatId);

        case '/cancel':
            return handleCancel(chatId);

        default:
            return null;
    }
}

// ==========================================
// WEBHOOK SETUP
// ==========================================

let webhookSet = false;

async function ensureReportBotWebhook(appUrl) {
    if (!REPORT_BOT_TOKEN || webhookSet) return;
    try {
        const webhookUrl = `${appUrl}/api/report-bot/webhook`;
        const result = await reportBotRequest('setWebhook', {
            url: webhookUrl,
            secret_token: REPORT_WEBHOOK_SECRET
        });
        if (result && result.ok) {
            webhookSet = true;
            log.info(`Report bot webhook set: ${webhookUrl}`);
        } else {
            log.warn('Report bot webhook setup failed', result);
        }
    } catch (err) {
        log.error('Report bot webhook error', err);
    }
}

async function registerReportBotCommands() {
    if (!REPORT_BOT_TOKEN) return;
    try {
        await reportBotRequest('setMyCommands', {
            commands: [
                { command: 'start', description: 'Привітання та інструкція' },
                { command: 'report', description: 'Створити звіт (інтерактивно)' },
                { command: 'income', description: 'Швидкий дохід: /income 5000 опис' },
                { command: 'expense', description: 'Швидка витрата: /expense 1200 опис' },
                { command: 'summary', description: 'Зведення за сьогодні' },
                { command: 'week', description: 'Зведення за тиждень' },
                { command: 'status', description: 'Статус звітів' },
                { command: 'cancel', description: 'Скасувати поточну дію' },
                { command: 'help', description: 'Список команд' }
            ]
        });
        log.info('Report bot commands registered');
    } catch (err) {
        log.error('Report bot commands registration error', err);
    }
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    handleCommand,
    handleCallback,
    handleTextMessage,
    handlePhoto,
    handleVoice,
    sendMessage,
    ensureReportBotWebhook,
    registerReportBotCommands,
    REPORT_BOT_TOKEN,
    REPORT_WEBHOOK_SECRET
};
