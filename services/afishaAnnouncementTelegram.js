'use strict';

const { animatorTelegramRequest: operationalTelegramRequest } = require('./animator-telegram-approval');

const CONNECT_FAILURES = new Set(['ECIRCUITOPEN', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

async function deliverTelegramAnnouncement(recipient, text, options = {}) {
    const request = typeof options === 'function' ? options : options.request || operationalTelegramRequest;
    const payload = {
        chat_id: recipient.chatId,
        text,
        link_preview_options: { is_disabled: true }
    };
    if (recipient.threadId != null) payload.message_thread_id = recipient.threadId;

    try {
        const response = options.isPhoto
            ? await (options.sendPhoto || sendOperationalPhoto)(recipient, options.layout)
            : await request('sendMessage', payload, { businessContext: recipient.businessContext });
        if (response?.ok === true) {
            return { status: 'sent', messageId: response.result?.message_id ?? null };
        }
        const code = response?.error_code;
        if (response?.ok === false && code === 429) {
            const seconds = response.parameters?.retry_after;
            return { status: 'retry', code: 'rate_limited', retryAfterSeconds: Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null };
        }
        if (response?.ok === false && ((code >= 400 && code < 500 && code !== 408) || response.description === 'No bot token configured')) {
            return { status: 'failed', code: 'telegram_rejected' };
        }
        return { status: 'uncertain', code: 'telegram_unconfirmed' };
    } catch (error) {
        if (CONNECT_FAILURES.has(error?.code)) {
            return { status: 'retry', code: 'telegram_unavailable', retryAfterSeconds: null };
        }
        return { status: 'uncertain', code: 'telegram_unconfirmed' };
    }
}

function sendOperationalPhoto(recipient, layout) {
    const { TELEGRAM_BOT_TOKEN, sendTelegramPhoto } = require('./telegram');
    if (!TELEGRAM_BOT_TOKEN) return { ok: false, description: 'No bot token configured' };
    return sendTelegramPhoto(recipient.chatId, layout.content, null, {
        ownedToken: TELEGRAM_BOT_TOKEN, threadId: recipient.threadId,
        contentType: layout.content_type, silent: false
    });
}

module.exports = { deliverTelegramAnnouncement };
