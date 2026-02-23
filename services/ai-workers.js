/**
 * services/ai-workers.js — AI Workers (Digital Employees) service
 *
 * Handles task dispatch to external bots via Telegram or webhook.
 * Лєо uses FastAPI /order/create (v2.0 schema).
 */
const { createLogger } = require('../utils/logger');

const log = createLogger('AIWorkers');

// Лєо bot (Railway service URL; env vars override)
const LEO_API_URL = process.env.LEO_API_URL || process.env.TYMUR_API_URL || 'https://tymur-bot-production.up.railway.app';
const LEO_SECRET  = process.env.LEO_SECRET  || process.env.TYMUR_SECRET  || 'kleshnya-tymur-secret-2026';
const DEFAULT_VENDOR_CHAT_ID = process.env.PINATA_VENDOR_CHAT_ID || '';

/**
 * Detect order type from free-text task description.
 * Fallback: "custom".
 */
function detectOrderType(taskText) {
    const t = taskText.toLowerCase();
    if (t.includes('піньят') || t.includes('pinata') || t.includes('друк') || t.includes('print')) return 'pinata_print';
    if (t.includes('торт') || t.includes('cake') || t.includes('кондитер')) return 'cake_order';
    if (t.includes('куль') || t.includes('декор') || t.includes('balloon') || t.includes('decoration')) return 'decoration';
    if (t.includes('закупівл') || t.includes('supply') || t.includes('supplies') || t.includes('запас')) return 'supply_order';
    return 'custom';
}

/**
 * Route task to the right transport based on worker config.
 */
async function sendTaskToWorker(worker, taskText, username) {
    // Лєо special case — use FastAPI /order/create
    if (worker.id === 'leo') {
        const url = worker.webhook_url || `${LEO_API_URL}/order/create`;
        const secret = worker.webhook_secret || LEO_SECRET;
        return sendToLeoAPI(url, secret, taskText, username, worker.bot_chat_id);
    }

    // Generic webhook
    if (worker.webhook_url) {
        return sendViaWebhook(worker, taskText, username);
    }

    // Raw Telegram bot
    if (worker.bot_token && worker.bot_chat_id) {
        return sendViaTelegram(worker, taskText, username);
    }

    log.warn(`Worker ${worker.id}: no transport configured`);
    return { sent: false, error: 'Бот не підключений — немає webhook або bot_token' };
}

/**
 * Send to Лєо API (v2.0 schema).
 * order_type auto-detected from taskText.
 * vendor_chat_id: from worker.bot_chat_id → env → empty (Лєо picks from queue).
 */
async function sendToLeoAPI(apiUrl, secret, taskText, username, vendorChatId) {
    const orderId   = `crm-${Date.now()}`;
    const orderType = detectOrderType(taskText);
    const body = {
        order_id:      orderId,
        order_type:    orderType,
        title:         taskText,
        description:   '',
        qty:           1,
        notes:         `Від ${username} через CRM AI Команда`,
        vendor_chat_id: vendorChatId || DEFAULT_VENDOR_CHAT_ID || ''
    };

    // Add pinata-specific fields if needed
    if (orderType === 'pinata_print') {
        body.print_size  = 'A4';
        body.color_mode  = 'Color';
        body.need_file   = false;
    }

    try {
        const resp = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Secret': secret },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000)
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => 'unknown');
            log.error(`Лєо API error ${resp.status}: ${errText}`);
            return { sent: false, error: `Лєо API ${resp.status}: ${errText}` };
        }

        const data = await resp.json();
        log.info(`Лєо order sent: ${orderId} (${orderType}) → ${data.status || 'ok'}`);
        return { sent: true, orderId, data };
    } catch (err) {
        log.error(`Лєо API request failed: ${err.message}`);
        return { sent: false, error: err.message };
    }
}

/**
 * Send pinata order to Лєо from booking flow (v2.0).
 */
async function sendPinataToLeo(bookingId, pinataSku, username) {
    const orderId = `pinata-${Date.now()}`;
    const body = {
        order_id:       orderId,
        order_type:     'pinata_print',
        title:          pinataSku || 'Піньята (без назви)',
        print_size:     'A4',
        color_mode:     'Color',
        qty:            4,
        need_file:      false,
        notes:          `Booking #${bookingId}`,
        vendor_chat_id: DEFAULT_VENDOR_CHAT_ID
    };

    try {
        const resp = await fetch(`${LEO_API_URL}/order/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Secret': LEO_SECRET },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000)
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => 'unknown');
            log.error(`Лєо pinata error ${resp.status}: ${errText}`);
            return { sent: false, error: `${resp.status}: ${errText}` };
        }

        const data = await resp.json();
        log.info(`Pinata order sent to Лєо: ${orderId} for booking ${bookingId}`);
        return { sent: true, orderId, data };
    } catch (err) {
        log.error(`Лєо pinata request failed: ${err.message}`);
        return { sent: false, error: err.message };
    }
}

/**
 * Generic webhook POST
 */
async function sendViaWebhook(worker, taskText, username) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (worker.webhook_secret) headers['X-Secret'] = worker.webhook_secret;

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
        return { sent: false, error: err.message };
    }
}

/**
 * Raw Telegram Bot API sendMessage
 */
async function sendViaTelegram(worker, taskText, username) {
    const text = `📋 Нове завдання від <b>${escapeHtml(username)}</b>:\n\n${escapeHtml(taskText)}`;

    try {
        const resp = await fetch(
            `https://api.telegram.org/bot${worker.bot_token}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: worker.bot_chat_id, text, parse_mode: 'HTML' }),
                signal: AbortSignal.timeout(15000)
            }
        );

        if (!resp.ok) {
            const errText = await resp.text().catch(() => 'unknown');
            return { sent: false, error: `Telegram API ${resp.status}: ${errText}` };
        }

        return { sent: true };
    } catch (err) {
        return { sent: false, error: err.message };
    }
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { sendTaskToWorker, sendPinataToLeo, LEO_API_URL, LEO_SECRET, DEFAULT_VENDOR_CHAT_ID };
