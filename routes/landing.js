/**
 * routes/landing.js — Landing page demo request API
 *
 * POST /api/landing/demo-request — sends lead notification to Telegram
 */
const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/logger');
const log = createLogger('Landing');

router.post('/demo-request', async (req, res) => {
    const { name, contact, package: pkg } = req.body;
    if (!name || !contact) {
        return res.status(400).json({ error: 'name and contact required' });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = '674972415'; // Serhiy

    const text = `\u{1F195} *Нова заявка на демо Event Genix!*\n\n` +
        `\u{1F464} Ім'я: ${name}\n` +
        `\u{1F4DE} Контакт: ${contact}\n` +
        `\u{1F4E6} Пакет: ${pkg || 'не вказано'}\n\n` +
        `_Заявка з лендінгу_`;

    try {
        if (botToken) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
            });
        }
    } catch (err) {
        log.error('Telegram notification failed', err);
    }

    res.json({ ok: true });
});

module.exports = router;
