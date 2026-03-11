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
const { handleBotCommand, handleCertUse, resolveActorName } = require('../services/bot');
const { handleContractorCallback } = require('../services/bookingAutomation');
const { createLogger } = require('../utils/logger');
const { notifyNewLead } = require('../services/leadNotifier');

const log = createLogger('TelegramRoute');

// v10.0.1: Safe parseInt for callback data — returns null if invalid
function safeParseInt(str) {
    const n = parseInt(str);
    return Number.isFinite(n) && n > 0 ? n : null;
}

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

        const isHttps = req.get('x-forwarded-proto') === 'https' || req.protocol === 'https';
        const appUrl = `${isHttps ? 'https' : 'http'}://${req.get('host')}`;
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

        // v7.2: Clawd Bot — handle text commands
        if (update.message && update.message.text && update.message.text.startsWith('/')) {
            const botChatId = update.message.chat.id;
            const botThreadId = update.message.message_thread_id || null;
            const fromUsername = update.message.from?.username || null;

            // v10.0: Auto-register telegram chat_id for personal notifications (/start link)
            if (update.message.chat.type === 'private' && fromUsername) {
                const { registerTelegramChatId } = require('../services/kleshnya');
                // Try to link by telegram_username
                pool.query(
                    'UPDATE users SET telegram_chat_id = $1 WHERE telegram_username = $2 AND telegram_chat_id IS NULL',
                    [botChatId, fromUsername]
                ).catch(() => {});
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

        if (update.callback_query) {
            const { id, data, message } = update.callback_query;
            const chatId = message.chat.id;

            if (data.startsWith('add_anim:')) {
                const requestId = safeParseInt(data.split(':')[1]);
                if (!requestId) { await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' }); return res.sendStatus(200); }

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
                    'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY id', [date]
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

            } else if (data.startsWith('cert_use:')) {
                const certId = safeParseInt(data.split(':')[1]);
                if (!certId) { await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' }); return res.sendStatus(200); }
                const threadId = message.message_thread_id || null;
                await handleCertUse(certId, id, chatId, threadId);
                return res.sendStatus(200);

            } else if (data.startsWith('task_confirm:')) {
                // v10.0: Kleshnya task confirmation
                const taskId = safeParseInt(data.split(':')[1]);
                if (!taskId) { await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' }); return res.sendStatus(200); }
                const { updateTaskStatus } = require('../services/kleshnya');
                try {
                    await updateTaskStatus(taskId, 'in_progress', 'telegram');
                    await telegramRequest('answerCallbackQuery', {
                        callback_query_id: id,
                        text: 'Задачу підтверджено!'
                    });
                    await telegramRequest('editMessageText', {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: message.text + '\n\n✅ <b>Підтверджено</b>',
                        parse_mode: 'HTML'
                    });
                } catch (err) {
                    log.error('task_confirm error', err);
                    await telegramRequest('answerCallbackQuery', {
                        callback_query_id: id,
                        text: 'Помилка підтвердження',
                        show_alert: true
                    });
                }

            } else if (data.startsWith('task_done:')) {
                // v11.1: Kleshnya task completion via inline button
                const taskId = safeParseInt(data.split(':')[1]);
                if (!taskId) { await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' }); return res.sendStatus(200); }
                const { updateTaskStatus } = require('../services/kleshnya');
                try {
                    const cbFrom = update.callback_query.from;
                    const actor = await resolveActorName(
                        cbFrom?.username || null,
                        cbFrom?.id || null,
                        cbFrom?.first_name || null
                    );
                    await updateTaskStatus(taskId, 'done', actor);
                    await telegramRequest('answerCallbackQuery', {
                        callback_query_id: id,
                        text: 'Задачу завершено!'
                    });
                    await telegramRequest('editMessageText', {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: message.text + `\n\n✅ <b>Виконано</b> (${actor})`,
                        parse_mode: 'HTML'
                    });
                } catch (err) {
                    log.error('task_done error', err);
                    await telegramRequest('answerCallbackQuery', {
                        callback_query_id: id,
                        text: err.message === 'Task not found' ? 'Задачу не знайдено' : 'Помилка завершення',
                        show_alert: true
                    });
                }

            } else if (data.startsWith('task_reject:')) {
                // v10.0: Kleshnya task rejection (fixed: cancelled instead of done)
                const taskId = safeParseInt(data.split(':')[1]);
                if (!taskId) { await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' }); return res.sendStatus(200); }
                try {
                    await pool.query("UPDATE tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [taskId]);
                    await telegramRequest('answerCallbackQuery', {
                        callback_query_id: id,
                        text: 'Задачу скасовано'
                    });
                    await telegramRequest('editMessageText', {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: message.text + '\n\n❌ <b>Скасовано</b>',
                        parse_mode: 'HTML'
                    });
                } catch (err) {
                    log.error('task_reject error', err);
                    await telegramRequest('answerCallbackQuery', {
                        callback_query_id: id,
                        text: 'Помилка',
                        show_alert: true
                    });
                }

            } else if (data.startsWith('ctr_accept:') || data.startsWith('ctr_reject:')) {
                // v12.6: Contractor accept/reject callback
                const parts = data.split(':');
                const action = parts[0]; // 'ctr_accept' or 'ctr_reject'
                const bookingId = parts[1] || null;
                const contractorId = safeParseInt(parts[2]);
                if (!bookingId || !contractorId) {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' });
                    return res.sendStatus(200);
                }
                await handleContractorCallback(action, bookingId, contractorId, id, chatId, message.message_id);
                return res.sendStatus(200);

            } else if (data.startsWith('no_anim:')) {
                const requestId = safeParseInt(data.split(':')[1]);
                if (!requestId) { await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' }); return res.sendStatus(200); }

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
            // v20.4.0: Training approve/reject callbacks
            } else if (data.startsWith('training_approve_') || data.startsWith('training_reject_')) {
                try {
                    const inputId = safeParseInt(data.split('_')[2]);
                    if (!inputId) {
                        await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний ID' });
                        return res.sendStatus(200);
                    }
                    const isApprove = data.startsWith('training_approve_');
                    const { categorizeContent } = require('../services/training');

                    if (isApprove) {
                        const inputRes = await pool.query(
                            'SELECT * FROM staff_training_inputs WHERE id = $1 AND status = $2',
                            [inputId, 'pending']
                        );
                        if (inputRes.rows.length === 0) {
                            await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Вже оброблено' });
                            return res.sendStatus(200);
                        }
                        const input = inputRes.rows[0];
                        const category = categorizeContent(input.content);
                        const title = input.content.substring(0, 100);

                        await pool.query(
                            `INSERT INTO training_materials (category, title, content, source_input_id, source_staff_id, source_staff_name, week_number, year, approved_by_telegram_id)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                            [category, title, input.content, input.id, input.staff_id, input.staff_name, input.week_number, input.year, update.callback_query.from?.id]
                        );
                        await pool.query('UPDATE staff_training_inputs SET status = $1, approved_at = NOW() WHERE id = $2', ['approved', inputId]);
                        await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: '✅ Підтверджено' });
                    } else {
                        await pool.query('UPDATE staff_training_inputs SET status = $1, rejected_at = NOW() WHERE id = $2', ['rejected', inputId]);
                        await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: '❌ Відхилено' });
                    }

                    const statusEmoji = isApprove ? '✅' : '❌';
                    await telegramRequest('editMessageText', {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: message.text + `\n\n${statusEmoji} <b>${isApprove ? 'Підтверджено' : 'Відхилено'}</b>`,
                        parse_mode: 'HTML'
                    });
                } catch (err) {
                    log.error('training callback error', err);
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Помилка', show_alert: true });
                }

            // v22.18: Review rating callback
            } else if (data.startsWith('review:')) {
                const parts = data.split(':');
                const bookingId = safeParseInt(parts[1]);
                const rating = safeParseInt(parts[2]);
                if (!bookingId || !rating || rating < 1 || rating > 5) {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' });
                    return res.sendStatus(200);
                }
                try {
                    const fromName = update.callback_query.from?.first_name || '';
                    await pool.query(
                        `INSERT INTO event_reviews (booking_id, customer_name, telegram_chat_id, rating)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT DO NOTHING`,
                        [bookingId, fromName, update.callback_query.from?.id, rating]
                    );
                    const stars = '⭐'.repeat(rating);
                    await telegramRequest('answerCallbackQuery', {
                        callback_query_id: id,
                        text: `Дякуємо за оцінку! ${stars}`
                    });
                    await telegramRequest('editMessageText', {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: message.text + `\n\n✅ <b>Оцінено: ${stars}</b>\nДякуємо за відгук!`,
                        parse_mode: 'HTML'
                    });
                } catch (err) {
                    log.error('review callback error', err);
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Помилка', show_alert: true });
                }

            // v22.18: Team pulse callback (anonymous)
            } else if (data.startsWith('pulse:')) {
                const score = safeParseInt(data.split(':')[1]);
                if (!score || score < 1 || score > 5) {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' });
                    return res.sendStatus(200);
                }
                try {
                    await pool.query(
                        'INSERT INTO team_pulse (date, score) VALUES (CURRENT_DATE, $1)',
                        [score]
                    );
                    const moods = ['', '😫', '😕', '😐', '🙂', '🤩'];
                    await telegramRequest('answerCallbackQuery', {
                        callback_query_id: id,
                        text: `Записано! ${moods[score]} Дякуємо!`
                    });
                } catch (err) {
                    log.error('pulse callback error', err);
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Помилка', show_alert: true });
                }

            // v22.18: Auto-order approve/reject
            } else if (data.startsWith('order_approve:') || data.startsWith('order_reject:')) {
                const parts = data.split(':');
                const action = parts[0];
                const requestId = safeParseInt(parts[1]);
                if (!requestId) {
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Невалідний запит' });
                    return res.sendStatus(200);
                }
                try {
                    const isApprove = action === 'order_approve';
                    const newStatus = isApprove ? 'approved' : 'rejected';
                    const actorName = update.callback_query.from?.first_name || 'manager';

                    await pool.query(
                        'UPDATE auto_order_requests SET status = $1, approved_by = $2, updated_at = NOW() WHERE id = $3 AND status = $4',
                        [newStatus, actorName, requestId, 'pending']
                    );

                    if (isApprove) {
                        // Send order to contractor if configured
                        const orderInfo = await pool.query(`
                            SELECT aor.*, ws.name AS stock_name, ws.unit, c.telegram_chat_id, c.name AS contractor_name
                            FROM auto_order_requests aor
                            JOIN warehouse_stock ws ON ws.id = aor.stock_id
                            LEFT JOIN contractors c ON c.id = aor.contractor_id
                            WHERE aor.id = $1
                        `, [requestId]);

                        if (orderInfo.rows.length > 0) {
                            const order = orderInfo.rows[0];
                            if (order.telegram_chat_id) {
                                const orderText = `📦 <b>Нове замовлення</b>\n\n`
                                    + `${order.stock_name}: ${order.quantity} ${order.unit}\n`
                                    + `Від: Event Genix Park\n`
                                    + `Затверджено: ${actorName}`;
                                await sendTelegramMessage(order.telegram_chat_id, orderText).catch(() => {});
                            }
                            await pool.query(
                                "UPDATE auto_order_requests SET status = 'ordered' WHERE id = $1",
                                [requestId]
                            );
                        }

                        await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: '✅ Замовлення підтверджено та відправлено!' });
                    } else {
                        await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: '❌ Замовлення відхилено' });
                    }

                    const emoji = isApprove ? '✅' : '❌';
                    const label = isApprove ? 'Підтверджено та замовлено' : 'Відхилено';
                    await telegramRequest('editMessageText', {
                        chat_id: chatId,
                        message_id: message.message_id,
                        text: message.text + `\n\n${emoji} <b>${label}</b> (${actorName})`,
                        parse_mode: 'HTML'
                    });
                } catch (err) {
                    log.error('order callback error', err);
                    await telegramRequest('answerCallbackQuery', { callback_query_id: id, text: 'Помилка', show_alert: true });
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
            notifyNewLead(result.rows[0]).catch(() => {});

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
