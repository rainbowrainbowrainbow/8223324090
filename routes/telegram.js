/**
 * routes/telegram.js — Telegram API endpoints + webhook handler
 */

const express = require('express');
const { pool } = require('../db');
const { validateDate, ensureDefaultLines, getKyivDateStr } = require('../services/booking');
const telegram = require('../services/telegram');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Get chats
router.get('/chats', asyncHandler(async (req, res) => {
    const chats = await telegram.getTelegramChatId();
    res.json({ chats });
}));

// Get threads
router.get('/threads', asyncHandler(async (req, res) => {
    const chatId = req.query.chat_id || await telegram.getConfiguredChatId();
    const result = await pool.query(
        'SELECT thread_id, title FROM telegram_known_threads WHERE chat_id = $1 ORDER BY thread_id',
        [chatId]
    );
    res.json({ threads: result.rows });
}));

// Send notification — uses soft failures (200 + success:false) since
// Telegram delivery issues are not HTTP errors
router.post('/notify', asyncHandler(async (req, res) => {
    const { text } = req.body;
    if (!text) {
        console.warn('[Telegram Notify] Empty text received');
        return res.json({ success: false, reason: 'no_text' });
    }
    const chatId = await telegram.getConfiguredChatId();
    if (!chatId) {
        console.warn('[Telegram Notify] No chat ID configured');
        return res.json({ success: false, reason: 'no_chat_id' });
    }
    const botToken = await telegram.getActiveBotToken();
    if (!botToken) {
        console.warn('[Telegram Notify] No bot token configured');
        return res.json({ success: false, reason: 'no_bot_token' });
    }
    console.log(`[Telegram Notify] Sending to chat ${chatId}, text length=${text.length}`);
    const result = await telegram.sendTelegramMessage(chatId, text);
    const ok = result?.ok || false;
    if (!ok) console.warn('[Telegram Notify] Send failed:', JSON.stringify(result));
    res.json({ success: ok, reason: ok ? undefined : 'send_failed', details: ok ? undefined : result });
}));

// Daily digest
async function buildAndSendDigest(date) {
    const chatId = await telegram.getConfiguredChatId();
    if (!chatId) {
        console.warn('[Digest] No chat ID configured');
        return { success: false, reason: 'no_chat_id' };
    }

    const bookingsResult = await pool.query('SELECT * FROM bookings WHERE date = $1 AND status != \'cancelled\' ORDER BY time', [date]);
    const bookings = bookingsResult.rows;

    if (bookings.length === 0) {
        const text = `📅 <b>${date}</b>\n\nНемає бронювань на цей день.`;
        const result = await telegram.sendTelegramMessage(chatId, text);
        return { success: result?.ok || false, count: 0 };
    }

    await ensureDefaultLines(date);
    const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]);
    const lines = linesResult.rows;

    let text = `📅 <b>Розклад на ${date}</b>\n`;
    text += `Всього бронювань: ${bookings.filter(b => !b.linked_to).length}\n\n`;

    for (const line of lines) {
        const lineBookings = bookings.filter(b => b.line_id === line.line_id && !b.linked_to);
        if (lineBookings.length === 0) continue;

        text += `👤 <b>${line.name}</b>\n`;
        for (const b of lineBookings) {
            const endMin = parseInt(b.time.split(':')[0]) * 60 + parseInt(b.time.split(':')[1]) + (b.duration || 0);
            const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
            const endM = String(endMin % 60).padStart(2, '0');
            const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
            text += `  ${statusIcon} ${b.time}-${endH}:${endM} ${b.label || b.program_code} (${b.room})`;
            if (b.kids_count) text += ` [${b.kids_count} діт]`;
            text += '\n';
        }
        text += '\n';
    }

    const result = await telegram.sendTelegramMessage(chatId, text, { silent: false });
    console.log(`[Digest] Sent for ${date}: ${result?.ok ? 'OK' : 'FAIL'}`);

    if (result?.ok && result.result?.message_id) {
        await telegram.scheduleAutoDelete(chatId, result.result.message_id);
    }

    return { success: result?.ok || false, count: bookings.length };
}

router.get('/digest/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    const result = await buildAndSendDigest(date);
    res.json(result);
}));

// Tomorrow reminder
async function sendTomorrowReminder(todayStr) {
    try {
        const [y, m, d] = todayStr.split('-').map(Number);
        const tomorrow = new Date(y, m - 1, d + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        const bookingsResult = await pool.query(
            'SELECT * FROM bookings WHERE date = $1 AND linked_to IS NULL AND status != \'cancelled\' ORDER BY time',
            [tomorrowStr]
        );
        if (bookingsResult.rows.length === 0) {
            return { success: true, count: 0, reason: 'no_bookings_tomorrow' };
        }

        const chatId = await telegram.getConfiguredChatId();
        if (!chatId) return { success: false, reason: 'no_chat_id' };

        await ensureDefaultLines(tomorrowStr);
        const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [tomorrowStr]);

        let text = `⏰ <b>Нагадування: завтра ${tomorrowStr}</b>\n`;
        text += `📋 ${bookingsResult.rows.length} бронювань\n\n`;

        for (const line of linesResult.rows) {
            const lineBookings = bookingsResult.rows.filter(b => b.line_id === line.line_id);
            if (lineBookings.length === 0) continue;

            text += `👤 <b>${line.name}</b>\n`;
            for (const b of lineBookings) {
                const endMin = parseInt(b.time.split(':')[0]) * 60 + parseInt(b.time.split(':')[1]) + (b.duration || 0);
                const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                const endM = String(endMin % 60).padStart(2, '0');
                const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
                text += `  ${statusIcon} ${b.time}-${endH}:${endM} ${b.label || b.program_code} (${b.room})`;
                if (b.kids_count) text += ` [${b.kids_count} діт]`;
                text += '\n';
            }
            text += '\n';
        }

        const sendResult = await telegram.sendTelegramMessage(chatId, text, { silent: false });
        console.log(`[Reminder] Tomorrow reminder sent for ${tomorrowStr}`);

        if (sendResult?.ok && sendResult.result?.message_id) {
            await telegram.scheduleAutoDelete(chatId, sendResult.result.message_id);
        }

        return { success: sendResult?.ok || false, count: bookingsResult.rows.length };
    } catch (err) {
        console.error('[Reminder] Error:', err.message);
        return { success: false, error: err.message };
    }
}

router.get('/reminder/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    const result = await sendTomorrowReminder(date);
    res.json(result);
}));

// Ask animator (inline keyboard)
router.post('/ask-animator', asyncHandler(async (req, res) => {
    const { date, note } = req.body;
    const chatId = await telegram.getConfiguredChatId();

    const appUrl = `${req.protocol === 'http' && req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol}://${req.get('host')}`;
    await telegram.ensureWebhook(appUrl);

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

    const threadId = await telegram.getConfiguredThreadId();
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
    const result = await telegram.telegramRequest('sendMessage', askPayload);

    res.json({ success: result?.ok || false, requestId });
}));

// Animator status polling
router.get('/animator-status/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await pool.query('SELECT status FROM pending_animators WHERE id = $1', [id]);
    if (result.rows.length === 0) {
        return res.json({ status: 'not_found' });
    }
    res.json({ status: result.rows[0].status });
}));

// Webhook handler — ALWAYS returns 200 (Telegram requirement)
router.post('/webhook', async (req, res) => {
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (secretHeader !== telegram.WEBHOOK_SECRET) {
        return res.sendStatus(403);
    }

    try {
        const update = req.body;

        // Save chat info
        const incomingChat = update.message?.chat || update.callback_query?.message?.chat || update.my_chat_member?.chat;
        if (incomingChat && incomingChat.id) {
            pool.query(
                `INSERT INTO telegram_known_chats (chat_id, title, type, updated_at) VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (chat_id) DO UPDATE SET title = $2, type = $3, updated_at = NOW()`,
                [incomingChat.id, incomingChat.title || incomingChat.first_name || 'Chat', incomingChat.type || 'unknown']
            ).catch(e => console.error('[Telegram] Failed to save chat info:', e.message));
        }

        // Save thread info
        const msg = update.message || update.callback_query?.message;
        if (msg && msg.message_thread_id && msg.chat?.id) {
            const threadTitle = msg.reply_to_message?.forum_topic_created?.name
                || msg.forum_topic_created?.name
                || null;
            pool.query(
                `INSERT INTO telegram_known_threads (thread_id, chat_id, title, updated_at) VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (chat_id, thread_id) DO UPDATE SET title = COALESCE(NULLIF($3, ''), telegram_known_threads.title), updated_at = NOW()`,
                [msg.message_thread_id, msg.chat.id, threadTitle]
            ).catch(e => console.error('[Telegram] Failed to save thread info:', e.message));
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
                    await telegram.telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Запит вже оброблено' });
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

                await telegram.telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Аніматора додано!' });
                await telegram.telegramRequest('editMessageText', {
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
                    await telegram.telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Запит вже оброблено' });
                    return res.sendStatus(200);
                }

                await telegram.telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Відхилено' });
                await telegram.telegramRequest('editMessageText', {
                    chat_id: chatId,
                    message_id: message.message_id,
                    text: message.text + '\n\n❌ <b>Відхилено</b>',
                    parse_mode: 'HTML'
                });
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.error('Webhook error:', err);
        res.sendStatus(200);
    }
});

module.exports = router;
module.exports.buildAndSendDigest = buildAndSendDigest;
module.exports.sendTomorrowReminder = sendTomorrowReminder;
