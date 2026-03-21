/**
 * routes/report-bot.js — Webhook + API for Report Bot (separate Telegram bot)
 *
 * Endpoints:
 *   POST /api/report-bot/webhook  — Telegram updates (secret token auth)
 *   POST /api/report-bot/submit   — Bot submits report to CRM (API key auth, snake_case)
 *   GET  /api/report-bot/on-duty  — Who is on duty (API key auth)
 *   GET  /api/report-bot/summary  — Quick summary for bot (API key auth)
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('ReportBotRoute');

const REPORT_BOT_API_KEY = process.env.REPORT_BOT_API_KEY || '';

const {
    handleCommand,
    handleCallback,
    handleTextMessage,
    handlePhoto,
    handleVoice,
    REPORT_WEBHOOK_SECRET
} = require('../services/report-bot');

// ==========================================
// API Key middleware for bot-to-CRM endpoints
// ==========================================
function requireBotApiKey(req, res, next) {
    if (!REPORT_BOT_API_KEY) {
        log.warn('REPORT_BOT_API_KEY not configured');
        return res.status(503).json({ error: 'Bot API not configured' });
    }
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (key !== REPORT_BOT_API_KEY) {
        return res.status(403).json({ error: 'Invalid API key' });
    }
    next();
}

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

// ==========================================
// POST /api/report-bot/submit — Bot sends report to CRM (snake_case)
// ==========================================
router.post('/submit', requireBotApiKey, async (req, res) => {
    try {
        const {
            type, amount, description, category,
            submitted_by, submitted_by_id, submitted_via = 'bot',
            photo_url, ocr_text, voice_transcript, raw_data, status = 'new',
            account_id, account_name
        } = req.body;

        if (!type || !['income', 'expense'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type (income/expense)' });
        }
        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Amount must be > 0' });
        }

        // Validate account_id if provided
        const accountIdInt = account_id ? parseInt(account_id, 10) : null;
        if (account_id && isNaN(accountIdInt)) {
            return res.status(400).json({ error: 'Invalid account_id (must be integer)' });
        }
        const accName = account_name ? String(account_name).slice(0, 100) : null;

        // submitted_by_id from bot is Telegram chat_id, not staff.id
        // Store chat_id in raw_data, leave submitted_by_id null to avoid FK violation
        const botRawData = raw_data || {};
        if (submitted_by_id) {
            botRawData.telegram_chat_id = submitted_by_id;
        }

        const result = await pool.query(`
            INSERT INTO reports (type, amount, description, category, submitted_by,
                submitted_via, photo_url, ocr_text, voice_transcript, raw_data, status,
                account_id, account_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `, [
            type,
            parseFloat(amount),
            description || null,
            category || null,
            submitted_by || 'Bot',
            submitted_via,
            photo_url || null,
            ocr_text || null,
            voice_transcript || null,
            JSON.stringify(botRawData),
            status,
            accountIdInt,
            accName
        ]);

        const report = result.rows[0];

        // Auto-assign to on-duty accountant
        const duty = await pool.query(
            'SELECT id, name FROM accountants WHERE is_on_duty = true LIMIT 1'
        );
        if (duty.rows.length > 0) {
            await pool.query(
                'UPDATE reports SET assigned_to = $1, assigned_at = NOW() WHERE id = $2',
                [duty.rows[0].id, report.id]
            );
            report.assigned_to = duty.rows[0].id;
            report.accountant_name = duty.rows[0].name;
        }

        log.info(`Bot report #${report.id}: ${type} ${amount} by ${submitted_by}`);
        res.status(201).json({
            id: report.id,
            type: report.type,
            amount: parseFloat(report.amount),
            status: report.status,
            assigned_to: report.assigned_to || null,
            accountant_name: report.accountant_name || null,
            created_at: report.created_at
        });
    } catch (err) {
        log.error('POST /report-bot/submit error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/report-bot/on-duty — Who is on duty
// ==========================================
router.get('/on-duty', requireBotApiKey, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, chat_id, phone FROM accountants WHERE is_on_duty = true ORDER BY name'
        );
        res.json({
            accountants: result.rows.map(r => ({
                id: r.id,
                name: r.name,
                chat_id: r.chat_id,
                phone: r.phone
            }))
        });
    } catch (err) {
        log.error('GET /report-bot/on-duty error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/report-bot/summary — Quick summary for bot
// ==========================================
router.get('/summary', requireBotApiKey, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const result = await pool.query(`
            SELECT
                type,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total
            FROM reports
            WHERE created_at::date = $1
            GROUP BY type
        `, [today]);

        const income = result.rows.find(r => r.type === 'income');
        const expense = result.rows.find(r => r.type === 'expense');

        const pending = await pool.query(
            "SELECT COUNT(*) FROM reports WHERE status = 'new'"
        );

        res.json({
            today: {
                income_total: parseFloat(income?.total || 0),
                income_count: parseInt(income?.count || 0),
                expense_total: parseFloat(expense?.total || 0),
                expense_count: parseInt(expense?.count || 0),
                profit: parseFloat(income?.total || 0) - parseFloat(expense?.total || 0)
            },
            pending_count: parseInt(pending.rows[0].count)
        });
    } catch (err) {
        log.error('GET /report-bot/summary error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ==========================================
// GET /api/report-bot/accounts — Finance accounts for bot sync (x-api-key)
// ==========================================
router.get('/accounts', requireBotApiKey, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, emoji, description, type, sort_order FROM finance_accounts WHERE is_active = true ORDER BY sort_order'
        );
        res.json({ success: true, accounts: result.rows });
    } catch (err) {
        log.error('GET /report-bot/accounts error', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
