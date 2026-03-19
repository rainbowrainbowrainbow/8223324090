/**
 * routes/report-bot.js — Webhook handler for Report Bot (separate Telegram bot)
 *
 * Receives Telegram updates for the report bot and routes them to handlers.
 * Endpoint: POST /api/report-bot/webhook
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('ReportBotRoute');

const {
    handleCommand,
    handleCallback,
    handleTextMessage,
    handlePhoto,
    handleVoice,
    REPORT_WEBHOOK_SECRET
} = require('../services/report-bot');

// ==========================================
// POST /api/report-bot/webhook — Telegram updates
// ==========================================

router.post('/webhook', async (req, res) => {
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (secretHeader !== REPORT_WEBHOOK_SECRET) {
        return res.sendStatus(403);
    }

    try {
        const update = req.body;

        // Handle text messages
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;

            // Commands (text starting with /)
            if (msg.text && msg.text.startsWith('/')) {
                await handleCommand(chatId, msg.text, msg);
                return res.sendStatus(200);
            }

            // Photo (receipt/invoice)
            if (msg.photo && msg.photo.length > 0) {
                await handlePhoto(chatId, msg);
                return res.sendStatus(200);
            }

            // Voice message
            if (msg.voice) {
                await handleVoice(chatId, msg);
                return res.sendStatus(200);
            }

            // Document (could be photo sent as file)
            if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
                // Treat image documents same as photos
                msg.photo = [{ file_id: msg.document.file_id }];
                await handlePhoto(chatId, msg);
                return res.sendStatus(200);
            }

            // Plain text (session-based input: amount, description)
            if (msg.text) {
                await handleTextMessage(chatId, msg.text, msg);
                return res.sendStatus(200);
            }
        }

        // Handle callback queries (inline button presses)
        if (update.callback_query) {
            await handleCallback(update.callback_query);
            return res.sendStatus(200);
        }

        res.sendStatus(200);
    } catch (err) {
        log.error('Report bot webhook error', err);
        res.sendStatus(200); // Always 200 to avoid Telegram retries
    }
});

module.exports = router;
