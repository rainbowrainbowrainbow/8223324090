/**
 * routes/telegram.js — Telegram bot endpoints & webhook
 */
const router = require('express').Router();
const { pool } = require('../db');
const {
    TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET,
    telegramRequest, sendTelegramMessage,
    getConfiguredChatId, getConfiguredThreadId,
    getTelegramChatId, ensureWebhook
} = require('../services/telegram');
const { ensureDefaultLines, validateDate } = require('../services/booking');
const { buildAndSendDigest, sendTomorrowReminder } = require('../services/scheduler');
const { handleBotCommand, handleCertUse, resolveActorName } = require('../services/bot');
const { handleContractorCallback } = require('../services/bookingAutomation');
const { createLogger } = require('../utils/logger');
const { notifyNewLead } = require('../services/leadNotifier');
const { authenticateToken } = require('../middleware/auth');
const warehousePhotoIntake = require('../services/warehousePhotoIntake');
const {
    DEFAULT_TIMELINE_CONTEXT,
    pushDefaultTimelineBusinessContext
} = require('../services/timelineBusinessScope');
const { DEFAULT_BUSINESS_CONTEXT } = require('../services/businessContext');

const log = createLogger('TelegramRoute');

function classifyTelegramAskFailure(result, err) {
    const description = String(result?.description || err?.message || result?.error || '').toLowerCase();
    if (description.includes('no bot token') || description.includes('token')) return 'no_bot_token';
    if (description.includes('chat not found') || description.includes('chat_id') || description.includes('chat id')) return 'no_chat_id';
    if (description.includes('webhook')) return 'webhook_unavailable';
    if (description.includes('circuit breaker')) return 'telegram_circuit_open';
    if (description.includes('timeout') || description.includes('econn') || description.includes('network')) return 'telegram_unavailable';
    return 'telegram_send_failed';
}

function publicTelegramTarget(target = {}) {
    return {
        chatId: target.chatId ? String(target.chatId) : null,
        threadId: target.threadId || null,
        source: target.source || 'unknown'
    };
}

async function getSettingValue(key) {
    try {
        const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
        return result.rows[0]?.value || null;
    } catch (err) {
        log.warn(`Telegram setting lookup failed for ${key}`, { message: err.message });
        return null;
    }
}

async function findKnownTelegramChatId() {
    try {
        const result = await pool.query(
            `SELECT chat_id, title, type
               FROM telegram_known_chats
              WHERE type IN ('group', 'supergroup', 'channel')
              ORDER BY
                CASE
                    WHEN LOWER(COALESCE(title, '')) LIKE '%anim%' THEN 0
                    WHEN LOWER(COALESCE(title, '')) LIKE '%анім%' THEN 0
                    WHEN LOWER(COALESCE(title, '')) LIKE '%аним%' THEN 0
                    WHEN LOWER(COALESCE(title, '')) LIKE '%сповіщ%' THEN 1
                    WHEN LOWER(COALESCE(title, '')) LIKE '%event%' THEN 2
                    ELSE 3
                END,
                updated_at DESC
              LIMIT 1`
        );
        return result.rows[0]?.chat_id ? String(result.rows[0].chat_id) : null;
    } catch (err) {
        log.warn('Known Telegram chat lookup failed', { message: err.message });
        return null;
    }
}

async function findKnownTelegramThreadId(chatId) {
    if (!chatId) return null;
    try {
        const result = await pool.query(
            `SELECT thread_id, title
               FROM telegram_known_threads
              WHERE chat_id = $1
              ORDER BY
                CASE
                    WHEN LOWER(COALESCE(title, '')) LIKE '%anim%' THEN 0
                    WHEN LOWER(COALESCE(title, '')) LIKE '%анім%' THEN 0
                    WHEN LOWER(COALESCE(title, '')) LIKE '%аним%' THEN 0
                    WHEN LOWER(COALESCE(title, '')) LIKE '%сповіщ%' THEN 1
                    WHEN LOWER(COALESCE(title, '')) LIKE '%notification%' THEN 1
                    WHEN LOWER(COALESCE(title, '')) LIKE '%alert%' THEN 1
                    ELSE 3
                END,
                updated_at DESC
              LIMIT 1`,
            [chatId]
        );
        return result.rows[0]?.thread_id ? parseInt(result.rows[0].thread_id) || null : null;
    } catch (err) {
        log.warn('Known Telegram thread lookup failed', { message: err.message });
        return null;
    }
}

async function resolveAnimatorAskTelegramTarget() {
    const explicitChatId =
        await getSettingValue('telegram_animator_chat_id')
        || process.env.TELEGRAM_ANIMATOR_CHAT_ID
        || await getSettingValue('telegram_notifications_chat_id')
        || process.env.TELEGRAM_NOTIFICATIONS_CHAT_ID;
    const chatId = explicitChatId || await getConfiguredChatId() || await findKnownTelegramChatId();
    if (!chatId) return { chatId: null, threadId: null, source: 'missing' };

    const threadId =
        await getConfiguredThreadId(['telegram_animator_thread_id', 'telegram_notifications_thread_id', 'telegram_thread_id'])
        || await findKnownTelegramThreadId(chatId);

    return {
        chatId,
        threadId: threadId || null,
        source: explicitChatId ? 'animator_config' : 'telegram_config'
    };
}

// v10.0.1: Safe parseInt for callback data — returns null if invalid
function safeParseInt(str) {
    const n = parseInt(str);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function callbackMessageTarget(message) {
    if (!message?.chat?.id || !message?.message_id) return null;
    return { chat_id: message.chat.id, message_id: message.message_id };
}

async function answerCallback(callbackQueryId, text, options = {}) {
    return telegramRequest('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        text,
        ...options
    });
}

async function clearInlineKeyboard(message, context = 'callback') {
    const target = callbackMessageTarget(message);
    if (!target) return;

    try {
        await telegramRequest('editMessageReplyMarkup', {
            ...target,
            reply_markup: { inline_keyboard: [] }
        });
    } catch (err) {
        log.warn(`${context} keyboard cleanup failed: ${err.message}`);
    }
}

async function editCallbackMessageFinal(message, finalText, context = 'callback') {
    const target = callbackMessageTarget(message);
    if (!target) return;

    const baseText = message.text || message.caption || '';
    const text = baseText ? `${baseText}\n\n${finalText}` : finalText;

    try {
        await telegramRequest('editMessageText', {
            ...target,
            text,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }
        });
    } catch (err) {
        log.warn(`${context} final message edit failed: ${err.message}`);
        await clearInlineKeyboard(message, context);
    }
}

async function answerStaleCallback(callbackQueryId, message, text = 'Вже оброблено') {
    await answerCallback(callbackQueryId, text);
    await clearInlineKeyboard(message, 'stale callback');
}

function getPublicAppUrl(req) {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    const isHttps = req.get('x-forwarded-proto') === 'https' || req.protocol === 'https';
    return `${isHttps ? 'https' : 'http'}://${req.get('host')}`;
}

async function sendWarehouseIntakeReply(req, message, intake) {
    const chatId = message.chat.id;
    const payload = {
        chat_id: chatId,
        text: warehousePhotoIntake.buildTelegramSummary(intake),
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Підтвердити', callback_data: `wh_intake_confirm:${intake.id}` },
                    { text: '✏️ Редагувати в CRM', url: `${getPublicAppUrl(req)}/warehouse` }
                ],
                [
                    { text: '❌ Скасувати', callback_data: `wh_intake_cancel:${intake.id}` }
                ]
            ]
        }
    };
    if (message.message_thread_id) payload.message_thread_id = message.message_thread_id;
    return telegramRequest('sendMessage', payload);
}

function hasWarehousePhotoInput(message) {
    if (!message) return false;
    if (Array.isArray(message.photo) && message.photo.length) return true;
    return Boolean(message.document?.file_id && String(message.document.mime_type || '').startsWith('image/'));
}

function parseTaskCallback(data) {
    const parts = data.split(':');
    return {
        action: parts[0],
        taskId: safeParseInt(parts[1]),
        expectedStatus: parts[2] || null
    };
}

async function ensureTaskCallbackStatus(taskId, allowedStatuses, expectedStatus, callbackQueryId, message) {
    const allowed = expectedStatus ? [expectedStatus] : allowedStatuses;
    const statusResult = await pool.query('SELECT status FROM tasks WHERE id = $1', [taskId]);
    if (statusResult.rows.length === 0) {
        await answerCallback(callbackQueryId, 'Задачу не знайдено', { show_alert: true });
        await clearInlineKeyboard(message, 'task callback');
        return false;
    }

    const currentStatus = statusResult.rows[0].status;
    if (!allowed.includes(currentStatus)) {
        await answerStaleCallback(callbackQueryId, message, 'Задачу вже оброблено');
        return false;
    }

    return true;
}

router.get('/chats', authenticateToken, async (req, res) => {
    try {
        const chats = await getTelegramChatId();
        res.json({ chats });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/threads', authenticateToken, async (req, res) => {
    try {
        const chatId = req.query.chat_id || await getConfiguredChatId();
        const result = await pool.query(
            'SELECT thread_id, title FROM telegram_known_threads WHERE chat_id = $1 ORDER BY thread_id',
            [chatId]
        );
        res.json({ threads: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/notify', authenticateToken, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            log.warn('Empty text received');
            return res.json({ success: false, reason: 'no_text' });
        }
        const chatId = await getConfiguredChatId();
        if (!chatId) {
            log.warn('No chat ID configured — cannot send');
            return res.json({ success: false, reason: 'no_chat_id' });
        }
        if (!TELEGRAM_BOT_TOKEN) {
            log.warn('No bot token configured');
            return res.json({ success: false, reason: 'no_bot_token' });
        }
        log.info(`Sending to chat ${chatId}, text length=${text.length}`);
        const result = await sendTelegramMessage(chatId, text);
        const ok = result?.ok || false;
        if (!ok) {
            log.warn('Send failed', result);
        }
        res.json({ success: ok, reason: ok ? undefined : 'send_failed', details: ok ? undefined : result });
    } catch (err) {
        log.error('Notify error', err);
        res.status(500).json({ success: false, reason: 'server_error', error: err.message });
    }
});

router.get('/digest/:date', authenticateToken, async (req, res) => {
    try {
        const { date } = req.params;
        const result = await buildAndSendDigest(date, req.user);
        res.json(result);
    } catch (err) {
        log.error('Digest error', err);
        res.status(500).json({
            success: false,
            code: 'DIGEST_INTERNAL_ERROR',
            reason: 'digest_internal_error',
            message: 'Не вдалося сформувати або відправити дайджест',
            error: 'Internal server error'
        });
    }
});

router.get('/reminder/:date', authenticateToken, async (req, res) => {
    try {
        const { date } = req.params;
        const result = await sendTomorrowReminder(date, req.user);
        res.json(result);
    } catch (err) {
        log.error('Reminder error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/ask-animator', authenticateToken, async (req, res) => {
    try {
        const { date, note } = req.body;
        if (!validateDate(date)) {
            return res.status(400).json({ success: false, reason: 'invalid_date', error: 'Invalid date format' });
        }

        const target = await resolveAnimatorAskTelegramTarget();
        const chatId = target.chatId;
        if (!chatId) {
            return res.json({ success: false, reason: 'no_chat_id', fallback: 'manual_line' });
        }
        const publicTarget = publicTelegramTarget(target);
        log.info('Ask animator target resolved', publicTarget);

        const isHttps = req.get('x-forwarded-proto') === 'https' || req.protocol === 'https';
        const appUrl = `${isHttps ? 'https' : 'http'}://${req.get('host')}`;
        const webhookResult = await ensureWebhook(appUrl);
        if (webhookResult?.ok === false) {
            log.warn('Ask animator blocked because Telegram webhook is not ready', {
                ...publicTarget,
                webhookReason: webhookResult.reason || webhookResult.description || 'unknown'
            });
            return res.json({
                success: false,
                reason: 'webhook_unavailable',
                webhookReason: webhookResult.reason || webhookResult.description || null,
                fallback: 'manual_line',
                target: { threadId: publicTarget.threadId, source: publicTarget.source }
            });
        }

        await ensureDefaultLines(date);

        const pendingResult = await pool.query(
            'INSERT INTO pending_animators (date, note) VALUES ($1, $2) RETURNING id',
            [date, note || null]
        );
        const requestId = pendingResult.rows[0].id;

        const lineParams = [date];
        const lineScope = pushDefaultTimelineBusinessContext(lineParams);
        const linesResult = await pool.query(
            `SELECT name FROM lines_by_date WHERE date = $1 AND ${lineScope} ORDER BY line_id`,
            lineParams
        );
        const animatorNames = linesResult.rows.map(r => r.name);

        const parts = date.split('-');
        const dateFormatted = `${parts[2]}.${parts[1]}.${parts[0]}`;

        let text = `🎭 <b>Запит на додавання аніматора</b>\n\n`;
        text += `📅 Дата: <b>${dateFormatted}</b>\n`;
        text += `👥 Зараз на зміні:\n`;
        if (animatorNames.length > 0) {
            animatorNames.forEach(name => { text += `  • ${name}\n`; });
        } else {
            text += `  — нікого\n`;
        }
        if (note) {
            text += `\n📝 Примітка: ${note}\n`;
        }
        text += `\nДодати ще одного аніматора?`;

        const threadId = target.threadId;
        const askPayload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Так', callback_data: `add_anim:${requestId}` },
                    { text: '❌ Ні', callback_data: `no_anim:${requestId}` }
                ]]
            }
        };
        if (threadId) askPayload.message_thread_id = threadId;
        let result;
        try {
            result = await telegramRequest('sendMessage', askPayload);
        } catch (sendErr) {
            log.warn('Ask animator Telegram send failed', { requestId, message: sendErr.message });
            await pool.query('UPDATE pending_animators SET status = $1 WHERE id = $2', ['failed', requestId]).catch(() => {});
            return res.json({
                success: false,
                requestId,
                reason: classifyTelegramAskFailure(null, sendErr),
                fallback: 'manual_line'
            });
        }

        if (!result?.ok) {
            await pool.query('UPDATE pending_animators SET status = $1 WHERE id = $2', ['failed', requestId]).catch(() => {});
            return res.json({
                success: false,
                requestId,
                reason: classifyTelegramAskFailure(result),
                description: result?.description || null,
                fallback: 'manual_line'
            });
        }

        log.info('Ask animator Telegram message sent', {
            requestId,
            ...publicTarget,
            messageId: result?.result?.message_id || null
        });

        res.json({ success: true, requestId, target: { threadId: threadId || null, source: target.source } });
    } catch (err) {
        log.error('Ask animator error', err);
        res.status(500).json({ success: false, reason: 'server_error', error: 'Internal server error' });
    }
});

router.get('/animator-status/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT status FROM pending_animators WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.json({ status: 'not_found' });
        }
        res.json({ status: result.rows[0].status });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Webhook handler
router.post('/webhook', async (req, res) => {
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (secretHeader !== WEBHOOK_SECRET) {
        return res.sendStatus(403);
    }

    try {
        const update = req.body;

        const incomingChat = update.message?.chat || update.callback_query?.message?.chat || update.my_chat_member?.chat;
        if (incomingChat && incomingChat.id) {
            pool.query(
                `INSERT INTO telegram_known_chats (chat_id, title, type, updated_at) VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (chat_id) DO UPDATE SET title = $2, type = $3, updated_at = NOW()`,
                [incomingChat.id, incomingChat.title || incomingChat.first_name || 'Chat', incomingChat.type || 'unknown']
            ).catch(e => log.error(`Failed to save chat info: ${e.message}`));
        }

        const msg = update.message || update.callback_query?.message;
        if (msg && msg.message_thread_id && msg.chat?.id) {
            const threadTitle = msg.reply_to_message?.forum_topic_created?.name
                || msg.forum_topic_created?.name
                || null;
            pool.query(
                `INSERT INTO telegram_known_threads (thread_id, chat_id, title, updated_at) VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (chat_id, thread_id) DO UPDATE SET title = COALESCE(NULLIF($3, ''), telegram_known_threads.title), updated_at = NOW()`,
                [msg.message_thread_id, msg.chat.id, threadTitle]
            ).catch(e => log.error(`Failed to save thread info: ${e.message}`));
        }

        // v7.2: Clawd Bot — handle text commands
        if (update.message && update.message.text && update.message.text.startsWith('/')) {
            const botChatId = update.message.chat.id;
            const botThreadId = update.message.message_thread_id || null;
            const fromUsername = update.message.from?.username || null;

            // v10.0: Auto-register telegram chat_id for personal notifications (/start link)
            if (update.message.chat.type === 'private' && fromUsername) {
                // Try to link by telegram_username
                pool.query(
                    'UPDATE users SET telegram_chat_id = $1 WHERE telegram_username = $2 AND telegram_chat_id IS NULL',
                    [botChatId, fromUsername]
                ).catch(e => log.warn('Chat ID reg failed', e.message));
            }

            // v12.6: Handle contractor deep link /start ctr_XXXXX
            if (update.message.text.startsWith('/start ctr_') && update.message.chat.type === 'private') {
                const token = update.message.text.slice(7).trim(); // "ctr_XXXXX"
                try {
                    const ctrResult = await pool.query(
                        'UPDATE contractors SET telegram_chat_id = $1, telegram_username = $2 WHERE invite_token = $3 RETURNING name',
                        [botChatId, fromUsername, token]
                    );
                    if (ctrResult.rows.length > 0) {
                        const name = ctrResult.rows[0].name;
                        await sendTelegramMessage(botChatId,
                            `🤝 <b>Вітаємо, ${name}!</b>\n\n`
                            + `Ви підключені як підрядник Парку Закревського Періоду.\n`
                            + `Тепер ви будете отримувати замовлення напряму в цей чат.\n\n`
                            + `✅ Telegram підключено`, { parse_mode: 'HTML' });
                        log.info(`Contractor "${name}" linked via invite token ${token} (chat_id: ${botChatId})`);
                    } else {
                        await sendTelegramMessage(botChatId,
                            '❌ Посилання недійсне або вже використане.', { parse_mode: 'HTML' });
                    }
                } catch (err) {
                    log.error('Contractor invite link error', err);
                }
                return res.sendStatus(200);
            }

            await handleBotCommand(botChatId, botThreadId, update.message.text, fromUsername);
        }

        if (update.message && hasWarehousePhotoInput(update.message)) {
            try {
                const result = await warehousePhotoIntake.createTelegramPhotoIntake(update.message);
                if (result.ok && result.intake) {
                    await sendWarehouseIntakeReply(req, update.message, result.intake);
                } else {
                    await sendTelegramMessage(
                        update.message.chat.id,
                        '📦 <b>Склад</b>\nФото отримано, але не вдалося створити чернетку. Спробуйте ще раз або додайте позицію у CRM вручну.',
                        { parse_mode: 'HTML' }
                    );
                }
            } catch (err) {
                log.error('Warehouse photo intake webhook error', err);
                await sendTelegramMessage(
                    update.message.chat.id,
                    '📦 <b>Склад</b>\nФото не записано у склад. Я залишив запис без blind write; перевірте налаштування бота/vision у CRM.',
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
            return res.sendStatus(200);
        }

        if (update.callback_query) {
            const { id, data, message } = update.callback_query;
            const chatId = message.chat.id;

            if (data.startsWith('wh_intake_confirm:')) {
                const intakeId = safeParseInt(data.split(':')[1]);
                if (!intakeId) { await answerCallback(id, 'Невалідний запит'); return res.sendStatus(200); }
                const cbFrom = update.callback_query.from || {};
                const actor = await resolveActorName(
                    cbFrom.username || null,
                    cbFrom.id || null,
                    cbFrom.first_name || null
                );
                const result = await warehousePhotoIntake.confirmIntake(intakeId, { actor });
                if (!result.success) {
                    const needsCrm = result.error === 'ambiguous_match_requires_manual_choice'
                        || result.error === 'draft_requires_name_quantity_unit_category';
                    await answerCallback(
                        id,
                        needsCrm ? 'Потрібне редагування в CRM перед записом' : 'Не вдалося підтвердити',
                        { show_alert: true }
                    );
                    return res.sendStatus(200);
                }
                await answerCallback(id, 'Записано у склад');
                await editCallbackMessageFinal(
                    message,
                    `✅ <b>Записано у склад</b> (${actor}). Stock #${result.stockId}, intake #${intakeId}`,
                    'warehouse intake confirm'
                );
                return res.sendStatus(200);

            } else if (data.startsWith('wh_intake_cancel:')) {
                const intakeId = safeParseInt(data.split(':')[1]);
                if (!intakeId) { await answerCallback(id, 'Невалідний запит'); return res.sendStatus(200); }
                const cbFrom = update.callback_query.from || {};
                const actor = await resolveActorName(
                    cbFrom.username || null,
                    cbFrom.id || null,
                    cbFrom.first_name || null
                );
                const result = await warehousePhotoIntake.cancelIntake(intakeId, { actor, notes: 'cancelled from Telegram' });
                if (!result.success) {
                    await answerStaleCallback(id, message, 'Intake вже оброблено');
                    return res.sendStatus(200);
                }
                await answerCallback(id, 'Скасовано');
                await editCallbackMessageFinal(message, `❌ <b>Скасовано</b> (${actor})`, 'warehouse intake cancel');
                return res.sendStatus(200);

            } else if (data.startsWith('add_anim:')) {
                const requestId = safeParseInt(data.split(':')[1]);
                if (!requestId) { await answerCallback(id, 'Невалідний запит'); return res.sendStatus(200); }
                log.info('Animator approval callback received', {
                    requestId,
                    chatId: String(chatId),
                    messageId: message?.message_id || null
                });

                const pending = await pool.query(
                    'UPDATE pending_animators SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
                    ['approved', requestId, 'pending']
                );
                if (pending.rows.length === 0) {
                    await answerStaleCallback(id, message, 'Запит вже оброблено');
                    return res.sendStatus(200);
                }

                const date = pending.rows[0].date;
                await ensureDefaultLines(date);

                const lineParams = [date];
                const lineScope = pushDefaultTimelineBusinessContext(lineParams);
                const linesResult = await pool.query(
                    `SELECT * FROM lines_by_date WHERE date = $1 AND ${lineScope} ORDER BY id`,
                    lineParams
                );
                const existingNumbers = linesResult.rows
                    .map(row => { const m = row.name.match(/^Аніматор (\d+)$/); return m ? parseInt(m[1]) : 0; })
                    .filter(n => n > 0);
                let nextNum = 1;
                while (existingNumbers.includes(nextNum)) nextNum++;

                const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#E91E63', '#00BCD4'];
                const newLineId = `line${Date.now()}_${date}`;
                const newName = `Аніматор ${nextNum}`;

                await pool.query(
                    `INSERT INTO lines_by_date (business_context, date, line_id, name, color)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (business_context, date, line_id) DO NOTHING`,
                    [DEFAULT_TIMELINE_CONTEXT, date, newLineId, newName, colors[linesResult.rows.length % colors.length]]
                );

                await answerCallback(id, 'Аніматора додано!');
                await editCallbackMessageFinal(message, `✅ <b>Додано: ${newName}</b>`, 'add_anim');
                log.info('Animator request approved and line added', { requestId, date, lineId: newLineId, lineName: newName });

            } else if (data.startsWith('cert_use:')) {
                const certId = safeParseInt(data.split(':')[1]);
                if (!certId) { await answerCallback(id, 'Невалідний запит'); return res.sendStatus(200); }
                const threadId = message.message_thread_id || null;
                await handleCertUse(certId, id, chatId, threadId);
                await clearInlineKeyboard(message, 'cert_use');
                return res.sendStatus(200);

            } else if (data.startsWith('task_confirm:')) {
                // v10.0: Kleshnya task confirmation
                const { taskId, expectedStatus } = parseTaskCallback(data);
                if (!taskId) { await answerCallback(id, 'Невалідний запит'); return res.sendStatus(200); }
                const { updateTaskStatus } = require('../services/kleshnya');
                try {
                    const canProcess = await ensureTaskCallbackStatus(taskId, ['todo'], expectedStatus, id, message);
                    if (!canProcess) return res.sendStatus(200);

                    await updateTaskStatus(taskId, 'in_progress', 'telegram');
                    await answerCallback(id, 'Задачу підтверджено!');
                    await editCallbackMessageFinal(message, '✅ <b>Підтверджено</b>', 'task_confirm');
                } catch (err) {
                    log.error('task_confirm error', err);
                    if (err.message?.startsWith('Conflict:')) {
                        await answerStaleCallback(id, message, 'Задачу вже оброблено');
                    } else {
                        await answerCallback(id, 'Помилка підтвердження', { show_alert: true });
                    }
                }

            } else if (data.startsWith('task_done:')) {
                // v11.1: Kleshnya task completion via inline button
                const { taskId, expectedStatus } = parseTaskCallback(data);
                if (!taskId) { await answerCallback(id, 'Невалідний запит'); return res.sendStatus(200); }
                const { updateTaskStatus } = require('../services/kleshnya');
                try {
                    const canProcess = await ensureTaskCallbackStatus(taskId, ['todo', 'in_progress'], expectedStatus, id, message);
                    if (!canProcess) return res.sendStatus(200);

                    const cbFrom = update.callback_query.from;
                    const actor = await resolveActorName(
                        cbFrom?.username || null,
                        cbFrom?.id || null,
                        cbFrom?.first_name || null
                    );
                    await updateTaskStatus(taskId, 'done', actor);
                    await answerCallback(id, 'Задачу завершено!');
                    await editCallbackMessageFinal(message, `✅ <b>Виконано</b> (${actor})`, 'task_done');
                } catch (err) {
                    log.error('task_done error', err);
                    if (err.message?.startsWith('Conflict:')) {
                        await answerStaleCallback(id, message, 'Задачу вже оброблено');
                    } else {
                        await answerCallback(id, err.message === 'Task not found' ? 'Задачу не знайдено' : 'Помилка завершення', { show_alert: true });
                    }
                }

            } else if (data.startsWith('task_reject:')) {
                // v10.0: Kleshnya task rejection (fixed: cancelled instead of done)
                const { taskId, expectedStatus } = parseTaskCallback(data);
                if (!taskId) { await answerCallback(id, 'Невалідний запит'); return res.sendStatus(200); }
                try {
                    const params = expectedStatus ? [taskId, expectedStatus] : [taskId];
                    const whereStatus = expectedStatus ? 'status = $2' : "status IN ('todo', 'in_progress')";
                    const cancelled = await pool.query(
                        `UPDATE tasks
                            SET status = 'cancelled', updated_at = NOW()
                          WHERE id = $1 AND ${whereStatus}
                          RETURNING id`,
                        params
                    );
                    if (cancelled.rows.length === 0) {
                        await answerStaleCallback(id, message, 'Задачу вже оброблено');
                        return res.sendStatus(200);
                    }

                    await answerCallback(id, 'Задачу скасовано');
                    await editCallbackMessageFinal(message, '❌ <b>Скасовано</b>', 'task_reject');
                } catch (err) {
                    log.error('task_reject error', err);
                    await answerCallback(id, 'Помилка', { show_alert: true });
                }

            } else if (data.startsWith('ctr_accept:') || data.startsWith('ctr_reject:')) {
                // v12.6: Contractor accept/reject callback
                const parts = data.split(':');
                const action = parts[0]; // 'ctr_accept' or 'ctr_reject'
                const bookingId = parts[1] || null;
                const contractorId = safeParseInt(parts[2]);
                if (!bookingId || !contractorId) {
                    await answerCallback(id, 'Невалідний запит');
                    return res.sendStatus(200);
                }
                await handleContractorCallback(action, bookingId, contractorId, id, chatId, message.message_id);
                return res.sendStatus(200);

            } else if (data.startsWith('no_anim:')) {
                const requestId = safeParseInt(data.split(':')[1]);
                if (!requestId) { await answerCallback(id, 'Невалідний запит'); return res.sendStatus(200); }
                log.info('Animator reject callback received', {
                    requestId,
                    chatId: String(chatId),
                    messageId: message?.message_id || null
                });

                const rejected = await pool.query(
                    'UPDATE pending_animators SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
                    ['rejected', requestId, 'pending']
                );
                if (rejected.rows.length === 0) {
                    await answerStaleCallback(id, message, 'Запит вже оброблено');
                    return res.sendStatus(200);
                }

                await answerCallback(id, 'Відхилено');
                await editCallbackMessageFinal(message, '❌ <b>Відхилено</b>', 'no_anim');
                log.info('Animator request rejected', { requestId });
            // v20.4.0: Training approve/reject callbacks
            } else if (data.startsWith('training_approve_') || data.startsWith('training_reject_')) {
                try {
                    const inputId = safeParseInt(data.split('_')[2]);
                    if (!inputId) {
                        await answerCallback(id, 'Невалідний ID');
                        return res.sendStatus(200);
                    }
                    const isApprove = data.startsWith('training_approve_');
                    const { categorizeContent } = require('../services/training');
                    const newStatus = isApprove ? 'approved' : 'rejected';

                    const inputRes = await pool.query(
                        `UPDATE staff_training_inputs
                            SET status = $1,
                                approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
                                rejected_at = CASE WHEN $1 = 'rejected' THEN NOW() ELSE rejected_at END
                          WHERE id = $2 AND status = 'pending'
                          RETURNING *`,
                        [newStatus, inputId]
                    );
                    if (inputRes.rows.length === 0) {
                        await answerStaleCallback(id, message, 'Вже оброблено');
                        return res.sendStatus(200);
                    }

                    const input = inputRes.rows[0];
                    if (isApprove) {
                        const category = categorizeContent(input.content);
                        const title = input.content.substring(0, 100);

                        await pool.query(
                            `INSERT INTO training_materials (category, title, content, source_input_id, source_staff_id, source_staff_name, week_number, year, approved_by_telegram_id)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                            [category, title, input.content, input.id, input.staff_id, input.staff_name, input.week_number, input.year, update.callback_query.from?.id]
                        );
                        await answerCallback(id, '✅ Підтверджено');
                    } else {
                        await answerCallback(id, '❌ Відхилено');
                    }

                    const statusEmoji = isApprove ? '✅' : '❌';
                    await editCallbackMessageFinal(message, `${statusEmoji} <b>${isApprove ? 'Підтверджено' : 'Відхилено'}</b>`, 'training callback');
                } catch (err) {
                    log.error('training callback error', err);
                    await answerCallback(id, 'Помилка', { show_alert: true });
                }

            // v22.18: Review rating callback
            } else if (data.startsWith('review:')) {
                const parts = data.split(':');
                const bookingId = String(parts[1] || '').trim();
                const rating = safeParseInt(parts[2]);
                if (!bookingId || !rating || rating < 1 || rating > 5) {
                    await answerCallback(id, 'Невалідний запит');
                    return res.sendStatus(200);
                }
                try {
                    const fromName = update.callback_query.from?.first_name || '';
                    const review = await pool.query(
                        `INSERT INTO event_reviews (business_context, booking_id, customer_name, telegram_chat_id, rating)
                         SELECT COALESCE(b.business_context, $5), $1::text, $2, $3, $4
                         FROM bookings b
                         WHERE b.id = $1::text
                           AND COALESCE(b.business_context, 'event_genix') = $5
                           AND NOT EXISTS (
                             SELECT 1 FROM event_reviews
                              WHERE booking_id = $1::text
                                AND telegram_chat_id = $3
                                AND COALESCE(business_context, 'event_genix') = $5
                         )
                         RETURNING id`,
                        [bookingId, fromName, update.callback_query.from?.id, rating, DEFAULT_TIMELINE_CONTEXT]
                    );
                    if (review.rows.length === 0) {
                        await answerStaleCallback(id, message, 'Оцінку вже збережено');
                        return res.sendStatus(200);
                    }
                    const stars = '⭐'.repeat(rating);
                    await answerCallback(id, `Дякуємо за оцінку! ${stars}`);
                    await editCallbackMessageFinal(message, `✅ <b>Оцінено: ${stars}</b>\nДякуємо за відгук!`, 'review callback');
                } catch (err) {
                    log.error('review callback error', err);
                    await answerCallback(id, 'Помилка', { show_alert: true });
                }

            // v22.18: Team pulse callback (anonymous)
            } else if (data.startsWith('pulse:')) {
                const score = safeParseInt(data.split(':')[1]);
                if (!score || score < 1 || score > 5) {
                    await answerCallback(id, 'Невалідний запит');
                    return res.sendStatus(200);
                }
                try {
                    await pool.query(
                        'INSERT INTO team_pulse (business_context, date, score) VALUES ($1, CURRENT_DATE, $2)',
                        [DEFAULT_BUSINESS_CONTEXT, score]
                    );
                    const moods = ['', '😫', '😕', '😐', '🙂', '🤩'];
                    await answerCallback(id, `Записано! ${moods[score]} Дякуємо!`);
                } catch (err) {
                    log.error('pulse callback error', err);
                    await answerCallback(id, 'Помилка', { show_alert: true });
                }

            // v22.18: Auto-order approve/reject
            } else if (data.startsWith('order_approve:') || data.startsWith('order_reject:')) {
                const parts = data.split(':');
                const action = parts[0];
                const requestId = safeParseInt(parts[1]);
                if (!requestId) {
                    await answerCallback(id, 'Невалідний запит');
                    return res.sendStatus(200);
                }
                try {
                    const isApprove = action === 'order_approve';
                    const newStatus = isApprove ? 'approved' : 'rejected';
                    const actorName = update.callback_query.from?.first_name || 'manager';

                    const updated = await pool.query(
                        `UPDATE auto_order_requests
                            SET status = $1, approved_by = $2, updated_at = NOW()
                          WHERE id = $3
                            AND status = $4
                            AND COALESCE(business_context, 'event_genix') = $5
                          RETURNING *`,
                        [newStatus, actorName, requestId, 'pending', DEFAULT_BUSINESS_CONTEXT]
                    );
                    if (updated.rows.length === 0) {
                        await answerStaleCallback(id, message, 'Замовлення вже оброблено');
                        return res.sendStatus(200);
                    }

                    if (isApprove) {
                        // Send order to contractor if configured
                        const orderInfo = await pool.query(`
                            SELECT aor.*, ws.name AS stock_name, ws.unit, c.telegram_chat_id, c.name AS contractor_name
                            FROM auto_order_requests aor
                            JOIN warehouse_stock ws ON ws.id = aor.stock_id
                             AND COALESCE(ws.business_context, 'event_genix') = COALESCE(aor.business_context, 'event_genix')
                            LEFT JOIN contractors c ON c.id = aor.contractor_id
                            WHERE aor.id = $1
                              AND COALESCE(aor.business_context, 'event_genix') = $2
                        `, [requestId, DEFAULT_BUSINESS_CONTEXT]);

                        if (orderInfo.rows.length > 0) {
                            const order = orderInfo.rows[0];
                            if (order.telegram_chat_id) {
                                const orderText = `📦 <b>Нове замовлення</b>\n\n`
                                    + `${order.stock_name}: ${order.quantity} ${order.unit}\n`
                                    + `Від: Event Genix Park\n`
                                    + `Затверджено: ${actorName}`;
                                await sendTelegramMessage(order.telegram_chat_id, orderText).catch(e => log.warn('Order notify failed', e.message));
                            }
                            await pool.query(
                                `UPDATE auto_order_requests
                                    SET status = 'ordered'
                                  WHERE id = $1
                                    AND COALESCE(business_context, 'event_genix') = $2`,
                                [requestId, DEFAULT_BUSINESS_CONTEXT]
                            );
                        }

                        await answerCallback(id, '✅ Замовлення підтверджено та відправлено!');
                    } else {
                        await answerCallback(id, '❌ Замовлення відхилено');
                    }

                    const emoji = isApprove ? '✅' : '❌';
                    const label = isApprove ? 'Підтверджено та замовлено' : 'Відхилено';
                    await editCallbackMessageFinal(message, `${emoji} <b>${label}</b> (${actorName})`, 'order callback');
                } catch (err) {
                    log.error('order callback error', err);
                    await answerCallback(id, 'Помилка', { show_alert: true });
                }
            }
        }

        // v20.4.0: Handle non-command private messages as potential training responses
        if (update.message && update.message.text && !update.message.text.startsWith('/') && update.message.chat?.type === 'private') {
            try {
                const { handleTrainingResponse } = require('../services/training');
                const fromId = update.message.from?.id;
                if (fromId) {
                    const handled = await handleTrainingResponse(fromId, update.message.text);
                    if (handled) {
                        await sendTelegramMessage(update.message.chat.id,
                            '✅ <b>Дякую!</b> Твою відповідь збережено. Сергій розгляне її на цьому тижні.',
                            { parse_mode: 'HTML' });
                    } else {
                        // v23.4.0: Lead capture — if not a training response, capture as lead
                        handleLeadCapture(update).catch(e => log.error('Lead capture failed', e));
                    }
                }
            } catch (err) {
                log.error('training response handler error', err);
            }
        }

        res.sendStatus(200);
    } catch (err) {
        log.error('Webhook error', err);
        res.sendStatus(200);
    }
});

/**
 * v23.4.0: Capture new lead from Telegram private chat
 * Fires for private messages that are NOT commands and NOT training responses
 */
async function handleLeadCapture(update) {
    const msg = update.message;
    if (!msg || msg.chat?.type !== 'private') return;
    if (msg.text?.startsWith('/')) return;

    const user = msg.from;
    const telegramId = user?.id;
    if (!telegramId) return;

    const text = msg.text || msg.caption || '';

    try {
        // If open lead already exists for this telegram_id — append message, don't duplicate
        const existing = await pool.query(
            `SELECT id FROM leads
             WHERE telegram_id = $1
               AND status NOT IN ('booked', 'closed', 'lost')
             LIMIT 1`,
            [telegramId]
        );

        if (existing.rows.length > 0) {
            if (text) {
                await pool.query(
                    `UPDATE leads
                       SET notes = COALESCE(notes,'') || E'\n[TG] ' || $1,
                           last_contact_at = NOW()
                     WHERE id = $2`,
                    [text.slice(0, 500), existing.rows[0].id]
                );
            }
            return;
        }

        const externalId  = `tg_${telegramId}`;
        const clientName  = [user.first_name, user.last_name].filter(Boolean).join(' ')
                            || `TG_${telegramId}`;

        const result = await pool.query(
            `INSERT INTO leads
               (client_name, telegram_id, source, source_channel, external_id, notes, raw_payload, status)
             VALUES ($1, $2, 'telegram', 'telegram', $3, $4, $5, 'new')
             ON CONFLICT (source_channel, external_id)
               WHERE external_id IS NOT NULL DO NOTHING
             RETURNING *`,
            [
                clientName,
                telegramId,
                externalId,
                text.slice(0, 1000) || null,
                JSON.stringify({ from: user, message_id: msg.message_id, text }),
            ]
        );

        if (result.rows.length > 0) {
            log.info(`New TG lead: ${clientName} (tg_id: ${telegramId})`);
            notifyNewLead(result.rows[0]).catch(e => log.warn('Lead notify failed', e.message));

            await sendTelegramMessage(
                msg.chat.id,
                '👋 Дякуємо за звернення!\nНаш менеджер зв\'яжеться з вами найближчим часом.\n\n🎉 <b>Парк Закревського Періоду</b>',
                { parse_mode: 'HTML' }
            );
        }
    } catch (err) {
        log.error('handleLeadCapture error', err);
    }
}

module.exports = router;
