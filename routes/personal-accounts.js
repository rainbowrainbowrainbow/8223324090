'use strict';

/**
 * routes/personal-accounts.js — Personal accounts API
 *
 * Endpoints:
 *   POST /api/personal-accounts/sync          — Bot syncs new personal account
 *   GET  /api/personal-accounts/my             — Get user's personal accounts by telegram_id
 *   POST /api/personal-accounts/:id/grant      — Grant access to account
 *   DELETE /api/personal-accounts/:id/access/:tg_id — Revoke access
 *   POST /api/personal-accounts/:id/transactions   — Add transaction
 *   GET  /api/personal-accounts/:id/transactions    — List transactions
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('PersonalAccounts');

const BOT_KEY = process.env.REPORT_BOT_API_KEY || '';

// Dual auth: x-api-key (bot) OR Authorization header (JWT, verified by global middleware)
function dualAuth(req, res, next) {
    if (BOT_KEY && req.headers['x-api-key'] === BOT_KEY) return next();
    if (req.headers.authorization) return next();
    return res.status(401).json({ error: 'Unauthorized' });
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/personal-accounts/sync — Bot syncs a new personal account
// ──────────────────────────────────────────────────────────────────────
router.post('/sync', dualAuth, async (req, res) => {
    const { bot_account_id, name, emoji, owner_telegram_id, owner_name } = req.body;

    if (!name || !owner_telegram_id) {
        return res.status(400).json({ error: 'name and owner_telegram_id required' });
    }

    try {
        const tgId = parseInt(owner_telegram_id, 10);

        // If bot_account_id provided, check for existing sync
        if (bot_account_id) {
            const existing = await pool.query(
                'SELECT id FROM finance_accounts WHERE bot_account_id = $1',
                [bot_account_id]
            );
            if (existing.rows.length) {
                const id = existing.rows[0].id;
                await pool.query(
                    'UPDATE finance_accounts SET name = $1, emoji = $2 WHERE id = $3',
                    [name, emoji || '💳', id]
                );
                return res.json({ ok: true, id, updated: true });
            }
        }

        // Create new personal account
        const r = await pool.query(`
            INSERT INTO finance_accounts
                (name, emoji, type, is_personal, bot_account_id,
                 owner_telegram_id, owner_username, sort_order)
            VALUES ($1, $2, 'personal', true, $3, $4, $5, 99)
            RETURNING id
        `, [name, emoji || '💳', bot_account_id || null, tgId, owner_name || null]);

        const id = r.rows[0].id;

        // Auto-grant owner access
        await pool.query(`
            INSERT INTO finance_account_access (account_id, telegram_id, can_view, can_write)
            VALUES ($1, $2, true, true) ON CONFLICT DO NOTHING
        `, [id, tgId]);

        log.info(`Personal account synced: #${id} "${name}" for tg:${tgId}`);
        res.json({ ok: true, id });
    } catch (err) {
        log.error('POST /personal-accounts/sync', err);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/personal-accounts/my?telegram_id=XXX
// ──────────────────────────────────────────────────────────────────────
router.get('/my', dualAuth, async (req, res) => {
    const tgId = parseInt(req.query.telegram_id, 10);
    if (!tgId) return res.status(400).json({ error: 'telegram_id required' });

    try {
        const r = await pool.query(`
            SELECT a.*, 'owner' AS role
            FROM finance_accounts a
            WHERE a.owner_telegram_id = $1 AND a.is_active = true AND a.is_personal = true
            UNION ALL
            SELECT a.*, 'member' AS role
            FROM finance_accounts a
            JOIN finance_account_access m ON m.account_id = a.id
            WHERE m.telegram_id = $1
            AND a.owner_telegram_id IS DISTINCT FROM $1
            AND a.is_active = true AND a.is_personal = true
            ORDER BY sort_order
        `, [tgId]);
        res.json({ accounts: r.rows });
    } catch (err) {
        log.error('GET /personal-accounts/my', err);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/personal-accounts/:id/grant — Grant access
// ──────────────────────────────────────────────────────────────────────
router.post('/:id/grant', dualAuth, async (req, res) => {
    const accId = parseInt(req.params.id, 10);
    const { telegram_id, can_view = true, can_write = true } = req.body;

    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

    try {
        const acc = await pool.query(
            'SELECT id FROM finance_accounts WHERE id = $1 AND is_personal = true',
            [accId]
        );
        if (!acc.rows.length) return res.status(404).json({ error: 'Personal account not found' });

        await pool.query(`
            INSERT INTO finance_account_access (account_id, telegram_id, can_view, can_write)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (account_id, telegram_id) DO UPDATE SET can_view = $3, can_write = $4
        `, [accId, parseInt(telegram_id, 10), can_view, can_write]);

        res.json({ ok: true });
    } catch (err) {
        log.error('POST /personal-accounts/:id/grant', err);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// DELETE /api/personal-accounts/:id/access/:tg_id — Revoke access
// ──────────────────────────────────────────────────────────────────────
router.delete('/:id/access/:tg_id', dualAuth, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM finance_account_access WHERE account_id = $1 AND telegram_id = $2',
            [parseInt(req.params.id, 10), parseInt(req.params.tg_id, 10)]
        );
        res.json({ ok: true });
    } catch (err) {
        log.error('DELETE /personal-accounts/:id/access/:tg_id', err);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/personal-accounts/:id/transactions — Add transaction
// ──────────────────────────────────────────────────────────────────────
router.post('/:id/transactions', dualAuth, async (req, res) => {
    const { type, amount, description, category, date, submitted_by_telegram } = req.body;

    if (!type || !['income', 'expense'].includes(type)) {
        return res.status(400).json({ error: 'type (income|expense) required' });
    }
    if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'amount must be positive' });
    }

    try {
        const acc = await pool.query(
            'SELECT id, is_personal FROM finance_accounts WHERE id = $1 AND is_active = true',
            [parseInt(req.params.id, 10)]
        );
        if (!acc.rows.length) return res.status(404).json({ error: 'Account not found' });
        if (!acc.rows[0].is_personal) return res.status(403).json({ error: 'Not a personal account' });

        const r = await pool.query(`
            INSERT INTO personal_account_transactions
                (account_id, type, amount, description, category, date,
                 source, submitted_by_telegram)
            VALUES ($1, $2, $3, $4, $5, $6, 'report_bot', $7)
            RETURNING id
        `, [parseInt(req.params.id, 10), type, Math.round(parseFloat(amount)),
            description || null, category || null,
            date || new Date().toISOString().slice(0, 10),
            submitted_by_telegram ? parseInt(submitted_by_telegram, 10) : null]);

        res.json({ ok: true, id: r.rows[0].id });
    } catch (err) {
        log.error('POST /personal-accounts/:id/transactions', err);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/personal-accounts/:id/transactions — List transactions
// ──────────────────────────────────────────────────────────────────────
router.get('/:id/transactions', dualAuth, async (req, res) => {
    const { from, to, limit = 100 } = req.query;
    const params = [parseInt(req.params.id, 10)];
    let q = 'SELECT * FROM personal_account_transactions WHERE account_id = $1';
    let i = 2;

    if (from) { q += ` AND date >= $${i++}`; params.push(from); }
    if (to)   { q += ` AND date <= $${i++}`; params.push(to); }
    q += ` ORDER BY created_at DESC LIMIT $${i}`;
    params.push(Math.min(parseInt(limit, 10) || 100, 500));

    try {
        const r = await pool.query(q, params);
        res.json({ transactions: r.rows });
    } catch (err) {
        log.error('GET /personal-accounts/:id/transactions', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
