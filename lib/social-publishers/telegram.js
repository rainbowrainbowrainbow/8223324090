/**
 * lib/social-publishers/telegram.js — Telegram channel publisher (v42.3)
 */
const BasePublisher = require('./base');
const { createLogger } = require('../../utils/logger');
const log = createLogger('TelegramPublisher');

class TelegramPublisher extends BasePublisher {
    constructor() { super('telegram'); }

    format(post) {
        let text = post.body || '';
        if (text.length > 4096) text = text.substring(0, 4090) + '...';
        return { text, photo: post.media_urls?.[0] || null };
    }

    async send(formatted, account) {
        const botToken = account.config?.bot_token || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = account.account_id;
        if (!botToken) throw new Error('Telegram bot token не налаштований');
        if (!chatId) throw new Error('Telegram channel ID не вказаний');

        const baseUrl = `https://api.telegram.org/bot${botToken}`;

        if (formatted.photo) {
            const res = await fetch(`${baseUrl}/sendPhoto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    photo: formatted.photo,
                    caption: formatted.text,
                    parse_mode: 'Markdown'
                })
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.description || 'Telegram API error');
            log.info(`Published to Telegram: msg ${data.result?.message_id}`);
            return { id: String(data.result?.message_id), url: null };
        }

        const res = await fetch(`${baseUrl}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: formatted.text,
                parse_mode: 'Markdown'
            })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'Telegram API error');
        log.info(`Published to Telegram: msg ${data.result?.message_id}`);
        return { id: String(data.result?.message_id), url: null };
    }
}

module.exports = TelegramPublisher;
