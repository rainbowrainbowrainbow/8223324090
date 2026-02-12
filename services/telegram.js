/**
 * services/telegram.js — Telegram Bot API wrapper
 */
const https = require('https');
const crypto = require('crypto');
const { pool } = require('../db');
const { formatBookingNotification } = require('./templates');
const { createLogger } = require('../utils/logger');

const log = createLogger('Telegram');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8068946683:AAFz0osjzV2DxlPP65DoAZNJ9NjI5LMHrhM';
const TELEGRAM_DEFAULT_CHAT_ID = process.env.TELEGRAM_DEFAULT_CHAT_ID || '-1001805304620';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');

let webhookSet = false;

function telegramRequest(method, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
        };
        const req = https.request(options, (res) => {
            let result = '';
            res.on('data', (chunk) => result += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(result)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        if (body) req.write(data);
        req.end();
    });
}

async function getConfiguredChatId() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'telegram_chat_id'");
        if (result.rows.length > 0 && result.rows[0].value) {
            return result.rows[0].value;
        }
    } catch (e) {
        log.warn(`DB error getting telegram_chat_id: ${e.message}, using default`);
    }
    return TELEGRAM_DEFAULT_CHAT_ID;
}

async function getConfiguredThreadId() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'telegram_thread_id'");
        if (result.rows.length > 0 && result.rows[0].value) {
            return parseInt(result.rows[0].value) || null;
        }
    } catch (e) {
        log.warn(`DB error getting telegram_thread_id: ${e.message}`);
    }
    return null;
}

async function sendTelegramMessage(chatId, text, options = {}) {
    const retries = options.retries || 3;
    const threadId = await getConfiguredThreadId();
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const payload = {
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML',
                disable_notification: options.silent !== false
            };
            if (threadId) payload.message_thread_id = threadId;
            const result = await telegramRequest('sendMessage', payload);
            if (result && result.ok) {
                log.info(`Message sent to ${chatId}${threadId ? ' thread=' + threadId : ''} (attempt ${attempt})`);
            } else {
                log.warn(`API returned error on attempt ${attempt}`, result);
            }
            return result;
        } catch (err) {
            log.error(`Send error (attempt ${attempt}/${retries}): ${err.message}`);
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
    log.error(`All ${retries} attempts failed for chat ${chatId}`);
    return null;
}

async function editTelegramMessage(chatId, messageId, text) {
    try {
        const threadId = await getConfiguredThreadId();
        const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
        if (threadId) payload.message_thread_id = threadId;
        const result = await telegramRequest('editMessageText', payload);
        if (result && result.ok) {
            log.info(`Message ${messageId} edited in ${chatId}`);
            return result;
        }
        log.warn('Edit failed', result);
        return null;
    } catch (err) {
        log.error(`Edit error: ${err.message}`);
        return null;
    }
}

async function deleteTelegramMessage(chatId, messageId) {
    try {
        const result = await telegramRequest('deleteMessage', { chat_id: chatId, message_id: messageId });
        if (result && result.ok) {
            log.info(`Message ${messageId} deleted from ${chatId}`);
        }
        return result;
    } catch (err) {
        log.error(`Delete error: ${err.message}`);
        return null;
    }
}

async function notifyTelegram(type, booking, extra = {}) {
    try {
        const text = formatBookingNotification(type, booking, extra);
        if (!text) {
            log.warn(`Notification skipped: formatBookingNotification returned empty for type="${type}"`);
            return;
        }
        const chatId = await getConfiguredChatId();
        if (!chatId) {
            log.warn(`Notification skipped: no chat ID configured (type="${type}")`);
            return;
        }
        const bookingId = booking.id || extra.bookingId;

        if ((type === 'edit' || type === 'status_change') && bookingId) {
            const existing = await pool.query('SELECT telegram_message_id FROM bookings WHERE id = $1', [bookingId]);
            const existingMsgId = existing.rows[0]?.telegram_message_id;

            if (existingMsgId) {
                const edited = await editTelegramMessage(chatId, existingMsgId, text);
                if (edited && edited.ok) return;
                await deleteTelegramMessage(chatId, existingMsgId);
            }
        }

        if (type === 'delete' && bookingId) {
            const existing = await pool.query('SELECT telegram_message_id FROM bookings WHERE id = $1', [bookingId]);
            const existingMsgId = existing.rows[0]?.telegram_message_id;
            if (existingMsgId) {
                await deleteTelegramMessage(chatId, existingMsgId);
            }
            await sendTelegramMessage(chatId, text);
            return;
        }

        const result = await sendTelegramMessage(chatId, text);
        if (result && result.ok && result.result && bookingId) {
            await pool.query('UPDATE bookings SET telegram_message_id = $1 WHERE id = $2', [result.result.message_id, bookingId]);
        }
    } catch (err) {
        log.error(`Notify error: ${err.message}`);
    }
}

async function ensureWebhook(appUrl) {
    if (webhookSet) return;
    try {
        const webhookUrl = `${appUrl}/api/telegram/webhook`;
        const result = await telegramRequest('setWebhook', { url: webhookUrl, secret_token: WEBHOOK_SECRET });
        if (result && result.ok) {
            webhookSet = true;
            log.info(`Webhook set: ${webhookUrl}`);
        }
    } catch (err) {
        log.error('Webhook setup error', err);
    }
}

function setWebhookFlag(val) { webhookSet = val; }
function getWebhookFlag() { return webhookSet; }

async function getTelegramChatId() {
    const chatMap = new Map();

    try {
        const dbResult = await pool.query('SELECT chat_id, title, type FROM telegram_known_chats ORDER BY updated_at DESC');
        for (const row of dbResult.rows) {
            chatMap.set(String(row.chat_id), { id: row.chat_id, title: row.title, type: row.type });
        }
    } catch (e) {
        log.error(`DB known chats error: ${e.message}`);
    }

    try {
        if (webhookSet) {
            await telegramRequest('deleteWebhook');
            log.info('Webhook temporarily removed for getUpdates');
        }

        const result = await telegramRequest('getUpdates');

        const appUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : null;
        if (appUrl) {
            const webhookUrl = `${appUrl}/api/telegram/webhook`;
            await telegramRequest('setWebhook', { url: webhookUrl, secret_token: WEBHOOK_SECRET });
            webhookSet = true;
            log.info('Webhook restored after getUpdates');
        }

        if (result.ok && result.result.length > 0) {
            for (const update of result.result) {
                const chat = update.message?.chat || update.my_chat_member?.chat;
                if (chat && !chatMap.has(String(chat.id))) {
                    chatMap.set(String(chat.id), { id: chat.id, title: chat.title || chat.first_name, type: chat.type });
                }
            }
        }
    } catch (err) {
        log.error(`getUpdates error: ${err.message}`);
    }

    return Array.from(chatMap.values());
}

/**
 * Schedule a Telegram message for auto-deletion after configured hours.
 * LLM HINT: Stores deletion job in `scheduled_deletions` table (DB-persistent).
 * Actual deletion is handled by checkScheduledDeletions() in scheduler.js (every 60s).
 * Settings: auto_delete_enabled (true/false), auto_delete_hours (default 10).
 */
async function scheduleAutoDelete(chatId, messageId) {
    try {
        const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('auto_delete_enabled', 'auto_delete_hours')");
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = r.value; });
        if (settings.auto_delete_enabled !== 'true') return;

        const hours = parseInt(settings.auto_delete_hours) || 10;
        const deleteAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

        await pool.query(
            "INSERT INTO scheduled_deletions (chat_id, message_id, delete_at) VALUES ($1, $2, $3)",
            [chatId, messageId, deleteAt]
        );
        log.info(`AutoDelete scheduled: message ${messageId} in ${hours}h (DB-persistent)`);
    } catch (err) {
        log.error(`AutoDelete schedule error: ${err.message}`);
    }
}

module.exports = {
    TELEGRAM_BOT_TOKEN, TELEGRAM_DEFAULT_CHAT_ID, WEBHOOK_SECRET,
    telegramRequest, sendTelegramMessage, editTelegramMessage, deleteTelegramMessage,
    getConfiguredChatId, getConfiguredThreadId,
    notifyTelegram, ensureWebhook, getTelegramChatId, scheduleAutoDelete,
    setWebhookFlag, getWebhookFlag
};
