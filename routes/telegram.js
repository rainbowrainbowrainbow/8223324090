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
const { ensureDefaultLines } = require('../services/booking');
const { buildAndSendDigest, sendTomorrowReminder } = require('../services/scheduler');
const { createLogger } = require('../utils/logger');

const log = createLogger('TelegramRoute');

router.get('/chats', async (req, res) => {
    try {
        const chats = await getTelegramChatId();
        res.json({ chats });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/threads', async (req, res) => {
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

router.post('/notify', async (req, res) => {
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

router.get('/digest/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await buildAndSendDigest(date);
        res.json(result);
    } catch (err) {
        log.error('Digest error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/reminder/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await sendTomorrowReminder(date);
        res.json(result);
    } catch (err) {
        log.error('Reminder error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/ask-animator', async (req, res) => {
    try {
        const { date, note } = req.body;
        const chatId = await getConfiguredChatId();

        const appUrl = `${req.protocol === 'http' && req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol}://${req.get('host')}`;
        await ensureWebhook(appUrl);

        await ensureDefaultLines(date);

        const pendingResult = await pool.query(
            'INSERT INTO pending_animators (date, note) VALUES ($1, $2) RETURNING id',
            [date, note || null]
        );
        const requestId = pendingResult.rows[0].id;

        const linesResult = await pool.query(
            'SELECT name FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]
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

        const threadId = await getConfiguredThreadId();
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
        const result = await telegramRequest('sendMessage', askPayload);

        res.json({ success: result?.ok || false, requestId });
    } catch (err) {
        log.error('Ask animator error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/animator-status/:id', async (req, res) => {
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

        if (update.callback_query) {
            const { id, data, message } = update.callback_query;
            const chatId = message.chat.id;

            if (data.startsWith('add_anim:')) {
                const requestId = parseInt(data.split(':')[1]);

                const pending = await pool.query(
                    'UPDATE pending_animators SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
                    ['approved', requestId, 'pending']
                );
                if (pending.rows.length === 0) {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Запит вже оброблено' });
                    return res.sendStatus(200);
                }

                const date = pending.rows[0].date;
                await ensureDefaultLines(date);

                const linesResult = await pool.query(
                    'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]
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
                    'INSERT INTO lines_by_date (date, line_id, name, color) VALUES ($1, $2, $3, $4)',
                    [date, newLineId, newName, colors[linesResult.rows.length % colors.length]]
                );

                await telegramRequest('answerCallbackQuery', {
                    callback_query_id: id,
                    text: 'Аніматора додано!'
                });

                await telegramRequest('editMessageText', {
                    chat_id: chatId,
                    message_id: message.message_id,
                    text: message.text + `\n\n✅ <b>Додано: ${newName}</b>`,
                    parse_mode: 'HTML'
                });

            } else if (data.startsWith('no_anim:')) {
                const requestId = parseInt(data.split(':')[1]);

                const rejected = await pool.query(
                    'UPDATE pending_animators SET status = $1 WHERE id = $2 AND status = $3 RETURNING *',
                    ['rejected', requestId, 'pending']
                );
                if (rejected.rows.length === 0) {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Запит вже оброблено' });
                    return res.sendStatus(200);
                }

                await telegramRequest('answerCallbackQuery', {
                    callback_query_id: id,
                    text: 'Відхилено'
                });

                await telegramRequest('editMessageText', {
                    chat_id: chatId,
                    message_id: message.message_id,
                    text: message.text + '\n\n❌ <b>Відхилено</b>',
                    parse_mode: 'HTML'
                });
            }
        }

        res.sendStatus(200);
    } catch (err) {
        log.error('Webhook error', err);
        res.sendStatus(200);
    }
});

module.exports = router;
