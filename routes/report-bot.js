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
// Routes: object_name === 'Особисте' → personal_account_transactions
//         otherwise → finance_transactions + reports (legacy)
// ==========================================
router.post('/submit', requireBotApiKey, async (req, res) => {
    try {
        const {
            type, amount, description, category,
            submitted_by, submitted_by_id, submitted_via = 'bot',
            photo_url, ocr_text, voice_transcript, raw_data, status = 'new',
            account_id, account_name, object_name
        } = req.body;

        if (!type || !['income', 'expense'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type (income/expense)' });
        }
        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: 'Amount must be > 0' });
        }

        const amountInt = Math.round(parseFloat(amount));
        const today = new Date().toISOString().slice(0, 10);
        const tgId = submitted_by_id ? parseInt(submitted_by_id, 10) : null;

        // 1. Save to submissions queue
        const sub = await pool.query(`
            INSERT INTO report_bot_submissions
                (raw_type, amount, description, category, account_name, object_name,
                 submitted_by, submitted_by_id, photo_url, ocr_text, voice_transcript)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING id
        `, [type, amountInt, description || null, category || null,
            account_name || null, object_name || null,
            submitted_by || null, tgId,
            photo_url || null, ocr_text || null, voice_transcript || null]);
        const subId = sub.rows[0].id;

        // 2. Personal → personal_account_transactions (isolated from company P&L)
        if (object_name === 'Особисте') {
            const accRow = await pool.query(`
                SELECT id FROM finance_accounts
                WHERE owner_telegram_id = $1
                AND (name = $2 OR $2 IS NULL)
                AND is_personal = true AND is_active = true
                ORDER BY created_at DESC LIMIT 1
            `, [tgId, account_name || null]);

            let personalTxId = null;
            if (accRow.rows.length) {
                const r = await pool.query(`
                    INSERT INTO personal_account_transactions
                        (account_id, type, amount, description, category,
                         date, source, submitted_by_telegram)
                    VALUES ($1,$2,$3,$4,$5,$6,'report_bot',$7)
                    RETURNING id
                `, [accRow.rows[0].id, type, amountInt, description || null,
                    category || null, today, tgId]);
                personalTxId = r.rows[0].id;
            }

            await pool.query(
                `UPDATE report_bot_submissions SET status='personal', personal_tx_id=$1 WHERE id=$2`,
                [personalTxId, subId]
            );

            log.info(`Bot report #${subId} → personal (txId: ${personalTxId})`);
            return res.status(201).json({
                ok: true, id: subId, routed: 'personal', personalTxId
            });
        }

        // 3. Corporate → finance_transactions
        // Map category via report_bot_category_map
        let categoryId = null;
        if (category) {
            const map = await pool.query(
                'SELECT finance_category_id FROM report_bot_category_map WHERE bot_category = $1',
                [category.toLowerCase()]
            );
            categoryId = map.rows[0]?.finance_category_id || null;
        }

        const payMethod = (account_name || '').toLowerCase().includes('готівка')
            || (account_name || '').toLowerCase().includes('каса') ? 'cash' : 'card';

        const ft = await pool.query(`
            INSERT INTO finance_transactions
                (type, category_id, amount, description, date, payment_method,
                 object_name, account_name, source, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'report_bot',$9)
            RETURNING id
        `, [type, categoryId, amountInt, description || null, today, payMethod,
            object_name || null, account_name || null, submitted_by || null]);

        await pool.query(
            `UPDATE report_bot_submissions SET status='processed', finance_transaction_id=$1 WHERE id=$2`,
            [ft.rows[0].id, subId]
        );

        // Also save to reports table (legacy compatibility)
        const accountIdInt = account_id ? parseInt(account_id, 10) : null;
        const botRawData = raw_data || {};
        if (submitted_by_id) botRawData.telegram_chat_id = submitted_by_id;

        const reportResult = await pool.query(`
            INSERT INTO reports (type, amount, description, category, submitted_by,
                submitted_via, photo_url, ocr_text, voice_transcript, raw_data, status,
                account_id, account_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
        `, [type, parseFloat(amount), description || null, category || null,
            submitted_by || 'Bot', submitted_via,
            photo_url || null, ocr_text || null, voice_transcript || null,
            JSON.stringify(botRawData), status,
            accountIdInt, account_name || null]);

        log.info(`Bot report #${subId} → finance_transactions #${ft.rows[0].id}`);
        res.status(201).json({
            ok: true, id: subId,
            transactionId: ft.rows[0].id,
            reportId: reportResult.rows[0].id,
            routed: 'finance'
        });
    } catch (err) {
        log.error('POST /report-bot/submit error', err);
        res.status(500).json({ error: 'Internal server error' });
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
        const [todayStats, pendingCount, weekByObject] = await Promise.all([
            pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income_total,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense_total,
                    COALESCE(SUM(CASE WHEN type='income'  THEN amount
                                      WHEN type='expense' THEN -amount ELSE 0 END),0) AS profit
                FROM finance_transactions
                WHERE date = $1 AND source = 'report_bot'
            `, [today]),
            pool.query(`SELECT COUNT(*) AS count FROM report_bot_submissions WHERE status='new'`),
            pool.query(`
                SELECT object_name,
                    COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS income,
                    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
                FROM finance_transactions
                WHERE date::date >= CURRENT_DATE - INTERVAL '7 days'
                AND source = 'report_bot' AND object_name IS NOT NULL
                GROUP BY object_name ORDER BY (
                    SUM(CASE WHEN type='income' THEN amount ELSE 0 END) -
                    SUM(CASE WHEN type='expense' THEN amount ELSE 0 END)
                ) DESC
            `)
        ]);

        res.json({
            today: {
                income_total:  parseInt(todayStats.rows[0].income_total),
                expense_total: parseInt(todayStats.rows[0].expense_total),
                profit:        parseInt(todayStats.rows[0].profit)
            },
            pending_count: parseInt(pendingCount.rows[0].count),
            week_by_object: weekByObject.rows
        });
    } catch (err) {
        log.error('GET /report-bot/summary error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GET /api/report-bot/accounts — Finance accounts for bot sync (x-api-key)
// ==========================================
router.get('/accounts', requireBotApiKey, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, emoji, description, type, sort_order FROM finance_accounts WHERE is_active = true AND is_personal = false ORDER BY sort_order'
        );
        res.json({ success: true, accounts: result.rows });
    } catch (err) {
        log.error('GET /report-bot/accounts error', err);
        // Fallback if columns not yet migrated
        res.json({ success: true, accounts: [
            { id: 1, name: 'Каса (готівка)',     emoji: '💵', type: 'cash' },
            { id: 2, name: 'Privat (безготівка)', emoji: '💳', type: 'card' },
            { id: 3, name: 'Mono (безготівка)',   emoji: '🖤', type: 'card' },
            { id: 4, name: 'Інший рахунок',       emoji: '🏦', type: 'bank' }
        ]});
    }
});

// ==========================================
// GET /api/report-bot/submissions — Submission queue for UI or bot
// ==========================================
router.get('/submissions', requireBotApiKey, async (req, res) => {
    try {
        const { object, status, from, to } = req.query;
        let q = 'SELECT * FROM report_bot_submissions WHERE 1=1';
        const params = [];
        let i = 1;
        if (object) { q += ` AND object_name = $${i++}`; params.push(object); }
        if (status) { q += ` AND status = $${i++}`; params.push(status); }
        if (from)   { q += ` AND created_at >= $${i++}`; params.push(from); }
        if (to)     { q += ` AND created_at < $${i++}::date + INTERVAL '1 day'`; params.push(to); }
        q += ` ORDER BY created_at DESC LIMIT 100`;
        const result = await pool.query(q, params);
        res.json({ submissions: result.rows, count: result.rowCount });
    } catch (err) {
        log.error('GET /report-bot/submissions error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
