'use strict';

/**
 * routes/personal-accounts.js — Personal accounts API
 *
 * Auth: bot (x-api-key) OR JWT (authenticateToken from global middleware).
 * All :id endpoints verify ownership or access permission.
 *
 * Endpoints:
 *   POST /api/personal-accounts/sync              — Bot syncs new personal account
 *   GET  /api/personal-accounts/my                 — Get user's personal accounts
 *   POST /api/personal-accounts/:id/grant          — Grant access (owner only)
 *   DELETE /api/personal-accounts/:id/access/:tg_id — Revoke access (owner only)
 *   POST /api/personal-accounts/:id/transactions   — Add transaction (owner or writer)
 *   GET  /api/personal-accounts/:id/transactions    — List transactions (owner or viewer)
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

const log = createLogger('PersonalAccounts');

const BOT_KEY = process.env.REPORT_BOT_API_KEY || '';

// Bot auth check helper
function isBotAuth(req) {
    return BOT_KEY && req.headers['x-api-key'] === BOT_KEY;
}

// Middleware: try JWT if not bot-authenticated (sets req.user)
function optionalJwt(req, res, next) {
    if (isBotAuth(req)) return next();
    if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' });
    // Use global authenticateToken to properly verify JWT
    authenticateToken(req, res, next);
}

// Get telegram_id from authenticated user (JWT sets req.user via global middleware)
function getUserTgId(req) {
    return req.user?.telegram_chat_id || req.user?.telegramChatId || null;
}

// Verify ownership of account. Returns account row or null.
async function verifyOwnership(accId, req) {
    const acc = await pool.query(
        'SELECT id, owner_telegram_id FROM finance_accounts WHERE id = $1 AND is_personal = true',
        [accId]
    );
    if (!acc.rows.length) return null;

    // Bot always has access
    if (isBotAuth(req)) return acc.rows[0];

    const userTgId = getUserTgId(req);
    if (!userTgId) return null;

    // Only owner can manage access
    if (String(acc.rows[0].owner_telegram_id) === String(userTgId)) return acc.rows[0];

    return null; // not owner
}

// Verify read or write access (owner always has both)
async function verifyAccess(accId, req, mode = 'view') {
    const acc = await pool.query(
        'SELECT id, owner_telegram_id FROM finance_accounts WHERE id = $1 AND is_personal = true AND is_active = true',
        [accId]
    );
    if (!acc.rows.length) return { acc: null, allowed: false };

    if (isBotAuth(req)) return { acc: acc.rows[0], allowed: true };

    const userTgId = getUserTgId(req);
    if (!userTgId) return { acc: acc.rows[0], allowed: false };

    // Owner always has access
    if (String(acc.rows[0].owner_telegram_id) === String(userTgId)) {
        return { acc: acc.rows[0], allowed: true };
    }

    // Check finance_account_access
    const col = mode === 'write' ? 'can_write' : 'can_view';
    const access = await pool.query(
        `SELECT ${col} FROM finance_account_access WHERE account_id = $1 AND telegram_id = $2`,
        [accId, parseInt(userTgId, 10)]
    );
    const allowed = access.rows.length > 0 && access.rows[0][col] === true;
    return { acc: acc.rows[0], allowed };
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/personal-accounts/sync — Bot syncs a new personal account
// Bot-only: requires x-api-key (no JWT needed)
// ──────────────────────────────────────────────────────────────────────
router.post('/sync', async (req, res) => {
    if (!isBotAuth(req)) return res.status(403).json({ error: 'Bot API key required' });

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
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/personal-accounts/my
// Bot: ?telegram_id=XXX. JWT: uses req.user.telegram_chat_id
// ──────────────────────────────────────────────────────────────────────
router.get('/my', optionalJwt, async (req, res) => {
    let tgId;

    if (isBotAuth(req)) {
        tgId = parseInt(req.query.telegram_id, 10);
        if (!tgId) return res.status(400).json({ error: 'telegram_id required' });
    } else if (req.user) {
        tgId = getUserTgId(req);
        if (!tgId) {
            return res.json({ accounts: [], message: 'Telegram not linked' });
        }
        tgId = parseInt(tgId, 10);
    } else {
        return res.status(401).json({ error: 'Unauthorized' });
    }

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
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/personal-accounts/:id/grant — Grant access (owner or bot only)
// ──────────────────────────────────────────────────────────────────────
router.post('/:id/grant', optionalJwt, async (req, res) => {
    const accId = parseInt(req.params.id, 10);
    const { telegram_id, can_view, can_write } = req.body;

    if (!telegram_id) return res.status(400).json({ error: 'telegram_id required' });

    try {
        const acc = await verifyOwnership(accId, req);
        if (!acc) return res.status(403).json({ error: 'Only account owner can grant access' });

        await pool.query(`
            INSERT INTO finance_account_access (account_id, telegram_id, can_view, can_write)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (account_id, telegram_id) DO UPDATE SET can_view = $3, can_write = $4
        `, [accId, parseInt(telegram_id, 10), can_view === true, can_write === true]);

        res.json({ ok: true });
    } catch (err) {
        log.error('POST /personal-accounts/:id/grant', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ──────────────────────────────────────────────────────────────────────
// DELETE /api/personal-accounts/:id/access/:tg_id — Revoke access (owner or bot only)
// ──────────────────────────────────────────────────────────────────────
router.delete('/:id/access/:tg_id', optionalJwt, async (req, res) => {
    const accId = parseInt(req.params.id, 10);

    try {
        const acc = await verifyOwnership(accId, req);
        if (!acc) return res.status(403).json({ error: 'Only account owner can revoke access' });

        await pool.query(
            'DELETE FROM finance_account_access WHERE account_id = $1 AND telegram_id = $2',
            [accId, parseInt(req.params.tg_id, 10)]
        );
        res.json({ ok: true });
    } catch (err) {
        log.error('DELETE /personal-accounts/:id/access/:tg_id', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/personal-accounts/:id/transactions — Add transaction (owner or writer)
// ──────────────────────────────────────────────────────────────────────
router.post('/:id/transactions', optionalJwt, async (req, res) => {
    const { type, amount, description, category, date, submitted_by_telegram } = req.body;

    if (!type || !['income', 'expense'].includes(type)) {
        return res.status(400).json({ error: 'type (income|expense) required' });
    }
    if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'amount must be positive' });
    }

    const accId = parseInt(req.params.id, 10);

    try {
        const { acc, allowed } = await verifyAccess(accId, req, 'write');
        if (!acc) return res.status(404).json({ error: 'Account not found' });
        if (!allowed) return res.status(403).json({ error: 'Access denied' });

        const r = await pool.query(`
            INSERT INTO personal_account_transactions
                (account_id, type, amount, description, category, date,
                 source, submitted_by_telegram)
            VALUES ($1, $2, $3, $4, $5, $6, 'report_bot', $7)
            RETURNING id
        `, [accId, type, Math.round(parseFloat(amount)),
            description || null, category || null,
            date || new Date().toISOString().slice(0, 10),
            submitted_by_telegram ? parseInt(submitted_by_telegram, 10) : null]);

        res.json({ ok: true, id: r.rows[0].id });
    } catch (err) {
        log.error('POST /personal-accounts/:id/transactions', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/personal-accounts/:id/transactions — List transactions (owner or viewer)
// ──────────────────────────────────────────────────────────────────────
router.get('/:id/transactions', optionalJwt, async (req, res) => {
    const accId = parseInt(req.params.id, 10);

    try {
        const { acc, allowed } = await verifyAccess(accId, req, 'view');
        if (!acc) return res.status(404).json({ error: 'Account not found' });
        if (!allowed) return res.status(403).json({ error: 'Access denied' });

        const { from, to, limit = 100 } = req.query;
        const params = [accId];
        let q = 'SELECT * FROM personal_account_transactions WHERE account_id = $1';
        let i = 2;

        if (from) { q += ` AND date >= $${i++}`; params.push(from); }
        if (to)   { q += ` AND date <= $${i++}`; params.push(to); }
        q += ` ORDER BY created_at DESC LIMIT $${i}`;
        params.push(Math.min(parseInt(limit, 10) || 100, 500));

        const r = await pool.query(q, params);
        res.json({ transactions: r.rows });
    } catch (err) {
        log.error('GET /personal-accounts/:id/transactions', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
