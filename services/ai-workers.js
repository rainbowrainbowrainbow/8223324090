/**
 * services/ai-workers.js — AI Workers (Digital Employees) service
 *
 * Handles task dispatch to external bots via Telegram or webhook.
 * Tymur uses a dedicated FastAPI endpoint (POST /order/create).
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('AIWorkers');

const TYMUR_API_URL = process.env.TYMUR_API_URL || 'https://tymur-bot-production.up.railway.app';
const TYMUR_SECRET = process.env.TYMUR_SECRET || 'kleshnya-tymur-secret-2026';
const PINATA_VENDOR_CHAT_ID = process.env.PINATA_VENDOR_CHAT_ID || null;

/**
 * Send a task to an AI worker's external bot.
 * Routes to the appropriate transport based on worker config.
 */
async function sendTaskToWorker(worker, taskText, username) {
    // Tymur special case: use his FastAPI order endpoint
    if (worker.id === 'tymur' && worker.webhook_url) {
        return sendToTymurAPI(worker, taskText, username);
    }

    // Generic webhook
    if (worker.webhook_url) {
        return sendViaWebhook(worker, taskText, username);
    }

    // Raw Telegram bot
    if (worker.bot_token && worker.bot_chat_id) {
        return sendViaTelegram(worker, taskText, username);
    }

    log.warn(`Worker ${worker.id}: no transport configured (no webhook_url, no bot_token+bot_chat_id)`);
    return { sent: false, error: 'Бот не підключений — немає webhook або bot_token' };
}

/**
 * Send task to Tymur's FastAPI /order/create
 */
async function sendToTymurAPI(worker, taskText, username) {
    const orderId = `crm-${Date.now()}`;
    const body = {
        order_id: orderId,
        pinata_sku_or_number: taskText,
        print_size: 'A4',
        qty: 4,
        color_mode: 'Color',
        need_file: false,
        reference: null,
        notes: `Від ${username} через CRM AI Команда`,
        vendor_chat_id: PINATA_VENDOR_CHAT_ID || worker.bot_chat_id || ''
    };

    try {
        const resp = await fetch(worker.webhook_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Secret': worker.webhook_secret || TYMUR_SECRET
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000)
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => 'unknown');
            log.error(`Tymur API error ${resp.status}: ${errText}`);
            return { sent: false, error: `Tymur API ${resp.status}: ${errText}` };
        }

        const data = await resp.json();
        log.info(`Tymur order sent: ${orderId} → ${data.status || 'ok'}`);
        return { sent: true, orderId, data };
    } catch (err) {
        log.error(`Tymur API request failed: ${err.message}`);
        return { sent: false, error: err.message };
    }
}

/**
 * Send task via generic webhook POST
 */
async function sendViaWebhook(worker, taskText, username) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (worker.webhook_secret) {
            headers['X-Secret'] = worker.webhook_secret;
        }

        const resp = await fetch(worker.webhook_url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ task: taskText, username, worker_id: worker.id }),
            signal: AbortSignal.timeout(15000)
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => 'unknown');
            return { sent: false, error: `Webhook ${resp.status}: ${errText}` };
        }

        return { sent: true };
    } catch (err) {
        log.error(`Webhook request failed for ${worker.id}: ${err.message}`);
        return { sent: false, error: err.message };
    }
}

/**
 * Send task via raw Telegram Bot API sendMessage
 */
async function sendViaTelegram(worker, taskText, username) {
    const text = `📋 Нове завдання від <b>${escapeHtml(username)}</b>:\n\n${escapeHtml(taskText)}`;

    try {
        const resp = await fetch(
            `https://api.telegram.org/bot${worker.bot_token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: worker.bot_chat_id,
                    text,
                    parse_mode: 'HTML'
                }),
                signal: AbortSignal.timeout(15000)
            }
        );

        if (!resp.ok) {
            const errText = await resp.text().catch(() => 'unknown');
            return { sent: false, error: `Telegram API ${resp.status}: ${errText}` };
        }

        return { sent: true };
    } catch (err) {
        log.error(`Telegram send failed for ${worker.id}: ${err.message}`);
        return { sent: false, error: err.message };
    }
}

/**
 * Send pinata order to Tymur directly (called from booking flow).
 * @param {string} bookingId - CRM booking ID (e.g., BK-2026-0042)
 * @param {string} pinataSku - pinata name/number
 * @param {string} username - who initiated
 */
async function sendPinataToTymur(bookingId, pinataSku, username) {
    const orderId = `pinata-${Date.now()}`;
    const body = {
        order_id: orderId,
        pinata_sku_or_number: pinataSku || 'Піньята (без назви)',
        print_size: 'A4',
        qty: 4,
        color_mode: 'Color',
        need_file: false,
        reference: null,
        notes: `Booking #${bookingId}`,
        vendor_chat_id: PINATA_VENDOR_CHAT_ID || ''
    };

    try {
        const resp = await fetch(`${TYMUR_API_URL}/order/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Secret': TYMUR_SECRET
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000)
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => 'unknown');
            log.error(`Tymur pinata order error ${resp.status}: ${errText}`);
            return { sent: false, error: `${resp.status}: ${errText}` };
        }

        const data = await resp.json();
        log.info(`Pinata order sent to Tymur: ${orderId} for booking ${bookingId}`);
        return { sent: true, orderId, data };
    } catch (err) {
        log.error(`Tymur pinata request failed: ${err.message}`);
        return { sent: false, error: err.message };
    }
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
    sendTaskToWorker,
    sendPinataToTymur,
    TYMUR_API_URL,
    TYMUR_SECRET,
    PINATA_VENDOR_CHAT_ID
};
