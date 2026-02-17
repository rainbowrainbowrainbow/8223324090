/**
 * routes/contractors.js — Contractor CRUD endpoints (v12.6)
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { sendTelegramMessage } = require('../services/telegram');
const { createLogger } = require('../utils/logger');

const log = createLogger('Contractors');

// GET /api/contractors — list all contractors
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM contractors ORDER BY is_active DESC, name'
        );
        res.json(result.rows);
    } catch (err) {
        log.error('List contractors error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contractors/:id — single contractor
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contractors WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Підрядника не знайдено' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Get contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contractors — create contractor
router.post('/', async (req, res) => {
    try {
        const { name, specialty, telegram_chat_id, telegram_username, phone, notes } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Ім'я підрядника обов'язкове" });
        }

        const inviteToken = 'ctr_' + crypto.randomBytes(8).toString('hex');

        const result = await pool.query(
            `INSERT INTO contractors (name, specialty, telegram_chat_id, telegram_username, invite_token, phone, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [
                name.trim(),
                JSON.stringify(specialty || []),
                telegram_chat_id || null,
                telegram_username || null,
                inviteToken,
                phone || null,
                notes || null
            ]
        );

        log.info(`Contractor created: ${name} (id: ${result.rows[0].id})`);
        res.json({ success: true, contractor: result.rows[0] });
    } catch (err) {
        log.error('Create contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/contractors/:id — update contractor
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, specialty, telegram_chat_id, telegram_username, phone, notes, is_active } = req.body;

        const result = await pool.query(
            `UPDATE contractors SET name=$1, specialty=$2, telegram_chat_id=$3, telegram_username=$4,
             phone=$5, notes=$6, is_active=$7 WHERE id=$8 RETURNING *`,
            [
                name, JSON.stringify(specialty || []),
                telegram_chat_id || null, telegram_username || null,
                phone || null, notes || null,
                is_active !== false, id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Підрядника не знайдено' });
        }

        log.info(`Contractor updated: ${name} (id: ${id})`);
        res.json({ success: true, contractor: result.rows[0] });
    } catch (err) {
        log.error('Update contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/contractors/:id — delete contractor
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM contractors WHERE id = $1', [req.params.id]);
        log.info(`Contractor deleted: id=${req.params.id}`);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contractors/:id/regenerate-invite — regenerate invite token
router.post('/:id/regenerate-invite', async (req, res) => {
    try {
        const newToken = 'ctr_' + crypto.randomBytes(8).toString('hex');
        const result = await pool.query(
            'UPDATE contractors SET invite_token = $1 WHERE id = $2 RETURNING invite_token',
            [newToken, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Підрядника не знайдено' });
        }
        res.json({ success: true, invite_token: newToken });
    } catch (err) {
        log.error('Regenerate invite error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contractors/:id/test-message — send test message to contractor
router.post('/:id/test-message', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contractors WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Підрядника не знайдено' });
        }
        const contractor = result.rows[0];
        if (!contractor.telegram_chat_id) {
            return res.status(400).json({ error: 'Telegram не підключено' });
        }

        const text = `🔔 <b>Тестове повідомлення</b>\n\n`
            + `Привіт, ${contractor.name}! Це тестове повідомлення від Парку Закревського Періоду.\n`
            + `Ваш зв'язок працює коректно ✅`;

        const tgResult = await sendTelegramMessage(contractor.telegram_chat_id, text, { parse_mode: 'HTML' });
        if (tgResult && tgResult.ok) {
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Помилка відправки повідомлення' });
        }
    } catch (err) {
        log.error('Test message error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contractors/notifications/recent — recent contractor notifications
router.get('/notifications/recent', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT cn.*, c.name as contractor_name
             FROM contractor_notifications cn
             JOIN contractors c ON cn.contractor_id = c.id
             ORDER BY cn.created_at DESC LIMIT 50`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Recent notifications error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
