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

// --- Timeout constants ---
const TELEGRAM_SOCKET_TIMEOUT = 15000;   // 15s for TCP/TLS connection
const TELEGRAM_RESPONSE_TIMEOUT = 15000; // 15s for full response

// --- In-flight request tracking (for graceful shutdown) ---
let inFlightCount = 0;
let drainResolvers = [];

// --- Circuit breaker state ---
const CIRCUIT_BREAKER_THRESHOLD = 5;   // consecutive failures to trip
const CIRCUIT_BREAKER_RESET_MS = 60000; // 60s cooldown before retry
let consecutiveFailures = 0;
let circuitOpenUntil = 0; // timestamp when circuit can close again

/**
 * Check if circuit breaker is open (should block requests).
 * Automatically resets to half-open after cooldown period.
 */
function isCircuitOpen() {
    if (consecutiveFailures < CIRCUIT_BREAKER_THRESHOLD) return false;
    if (Date.now() >= circuitOpenUntil) {
        // Cooldown elapsed — allow a single probe request (half-open)
        log.info('Circuit breaker half-open, allowing probe request');
        return false;
    }
    return true;
}

/** Record a successful Telegram request — resets circuit breaker. */
function recordSuccess() {
    if (consecutiveFailures > 0) {
        log.info(`Circuit breaker reset after ${consecutiveFailures} consecutive failures`);
    }
    consecutiveFailures = 0;
}

/** Record a failed Telegram request — may trip circuit breaker. */
function recordFailure() {
    consecutiveFailures++;
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
        log.warn(`Circuit breaker OPEN after ${consecutiveFailures} consecutive failures. Blocking requests for ${CIRCUIT_BREAKER_RESET_MS / 1000}s`);
    }
}

/**
 * Check if an error is retryable (network-level).
 * API-level 4xx errors are NOT retryable.
 */
function isRetryableError(err) {
    if (!err) return false;
    const code = err.code || '';
    return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH'].includes(code)
        || err.message?.includes('timeout')
        || err.message?.includes('socket hang up');
}

let webhookSet = false;
let cachedBotUsername = null;

function telegramRequest(method, body) {
    // Circuit breaker check
    if (isCircuitOpen()) {
        const err = new Error(`Telegram circuit breaker is OPEN (${consecutiveFailures} consecutive failures). Request blocked.`);
        err.code = 'ECIRCUITOPEN';
        return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
        inFlightCount++;
        const data = body ? JSON.stringify(body) : '';
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/${method}`,
            method: body ? 'POST' : 'GET',
            headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
            timeout: TELEGRAM_SOCKET_TIMEOUT
        };

        let settled = false;
        function settle(fn, value) {
            if (settled) return;
            settled = true;
            inFlightCount--;
            if (inFlightCount === 0) {
                drainResolvers.forEach(r => r());
                drainResolvers = [];
            }
            fn(value);
        }

        // Response-level timeout (covers slow body delivery)
        const responseTimer = setTimeout(() => {
            req.destroy(new Error(`Telegram API response timeout (${TELEGRAM_RESPONSE_TIMEOUT}ms) for ${method}`));
        }, TELEGRAM_RESPONSE_TIMEOUT);

        const req = https.request(options, (res) => {
            let result = '';
            res.on('data', (chunk) => result += chunk);
            res.on('end', () => {
                clearTimeout(responseTimer);
                try {
                    const parsed = JSON.parse(result);
                    recordSuccess();
                    settle(resolve, parsed);
                } catch (e) {
                    recordFailure();
                    settle(reject, e);
                }
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error(`Telegram API socket timeout (${TELEGRAM_SOCKET_TIMEOUT}ms) for ${method}`));
        });

        req.on('error', (err) => {
            clearTimeout(responseTimer);
            recordFailure();
            // Enhance error message for common network errors
            if (err.code === 'ETIMEDOUT') {
                err.message = `Telegram API connection timed out (ETIMEDOUT) for ${method}: ${err.message}`;
            } else if (err.code === 'ECONNRESET') {
                err.message = `Telegram API connection reset (ECONNRESET) for ${method}: ${err.message}`;
            } else if (err.code === 'ECONNREFUSED') {
                err.message = `Telegram API connection refused (ECONNREFUSED) for ${method}: ${err.message}`;
            }
            settle(reject, err);
        });

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
    const maxRetries = options.retries || 3;
    const threadId = await getConfiguredThreadId();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
                // API-level client errors (4xx) — retrying won't help
                if (result?.error_code >= 400 && result?.error_code < 500) {
                    return result;
                }
            }
            return result;
        } catch (err) {
            log.error(`Send error (attempt ${attempt}/${maxRetries}): ${err.message}`);
            // Only retry on retryable (network/timeout) errors
            if (attempt < maxRetries && isRetryableError(err)) {
                const backoff = 2000 * Math.pow(2, attempt - 1); // 2s, 4s
                log.info(`Retrying in ${backoff}ms...`);
                await new Promise(r => setTimeout(r, backoff));
            } else if (!isRetryableError(err)) {
                // Non-retryable error — bail out immediately
                log.error(`Non-retryable error, giving up: ${err.message}`);
                return null;
            }
        }
    }
    log.error(`All ${maxRetries} attempts failed for chat ${chatId}`);
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

async function getBotUsername() {
    if (cachedBotUsername) return cachedBotUsername;
    try {
        // Check settings first
        const result = await pool.query("SELECT value FROM settings WHERE key = 'bot_username'");
        if (result.rows.length > 0 && result.rows[0].value) {
            cachedBotUsername = result.rows[0].value;
            return cachedBotUsername;
        }
    } catch (e) { /* fallback to API */ }
    try {
        const me = await telegramRequest('getMe');
        if (me && me.ok && me.result && me.result.username) {
            cachedBotUsername = me.result.username;
            log.info(`Bot username resolved: @${cachedBotUsername}`);
            return cachedBotUsername;
        }
    } catch (err) {
        log.error(`getBotUsername error: ${err.message}`);
    }
    return null;
}

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
/**
 * Send a photo (Buffer) to Telegram chat via multipart/form-data.
 * Used for certificate image notifications.
 */
async function sendTelegramPhoto(chatId, photoBuffer, caption, options = {}) {
    // Circuit breaker check
    if (isCircuitOpen()) {
        const err = new Error(`Telegram circuit breaker is OPEN. sendPhoto blocked.`);
        err.code = 'ECIRCUITOPEN';
        throw err;
    }

    const threadId = await getConfiguredThreadId();
    const boundary = '----TgBoundary' + Date.now().toString(16);

    const parts = [];
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}`);
    if (caption) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`);
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML`);
    }
    if (threadId) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="message_thread_id"\r\n\r\n${threadId}`);
    }
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="disable_notification"\r\n\r\n${options.silent !== false}`);

    const head = Buffer.from(parts.join('\r\n') + '\r\n');
    const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="certificate.png"\r\nContent-Type: image/png\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, fileHeader, photoBuffer, tail]);

    return new Promise((resolve, reject) => {
        inFlightCount++;
        let settled = false;
        function settle(fn, value) {
            if (settled) return;
            settled = true;
            inFlightCount--;
            if (inFlightCount === 0) {
                drainResolvers.forEach(r => r());
                drainResolvers = [];
            }
            fn(value);
        }

        const responseTimer = setTimeout(() => {
            req.destroy(new Error(`Telegram sendPhoto response timeout (${TELEGRAM_RESPONSE_TIMEOUT}ms)`));
        }, TELEGRAM_RESPONSE_TIMEOUT);

        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            },
            timeout: TELEGRAM_SOCKET_TIMEOUT
        }, (res) => {
            let result = '';
            res.on('data', (chunk) => result += chunk);
            res.on('end', () => {
                clearTimeout(responseTimer);
                try {
                    const parsed = JSON.parse(result);
                    if (parsed.ok) log.info(`Photo sent to ${chatId}`);
                    else log.warn('sendPhoto API error', parsed);
                    recordSuccess();
                    settle(resolve, parsed);
                } catch (e) {
                    recordFailure();
                    settle(reject, e);
                }
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error(`Telegram sendPhoto socket timeout (${TELEGRAM_SOCKET_TIMEOUT}ms)`));
        });

        req.on('error', (err) => {
            clearTimeout(responseTimer);
            recordFailure();
            settle(reject, err);
        });

        req.write(body);
        req.end();
    });
}

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
    telegramRequest, sendTelegramMessage, sendTelegramPhoto, editTelegramMessage, deleteTelegramMessage,
    getConfiguredChatId, getConfiguredThreadId,
    notifyTelegram, ensureWebhook, getTelegramChatId, scheduleAutoDelete,
    setWebhookFlag, getWebhookFlag, getBotUsername
};
