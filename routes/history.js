/**
 * routes/history.js — Action history with filters
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const {
    DEFAULT_BUSINESS_CONTEXT,
    requireBusinessScope,
    requireWritableBusinessScope,
    resolveBusinessScope,
    pushBusinessScopeCondition
} = require('../services/businessContext');

const log = createLogger('History');

// All history routes require authentication
router.use(authenticateToken);

function normalizeHistoryAction(action) {
    const value = String(action || '').trim();
    if (!value || value.length > 64) return null;
    return value;
}

function historyActor(req) {
    return req.user?.username || req.user?.name || `user:${req.user?.id || 'unknown'}`;
}

function normalizeHistoryData(data, businessContext) {
    const base = data && typeof data === 'object' && !Array.isArray(data)
        ? { ...data }
        : { value: data ?? null };
    base.business_context = businessContext || DEFAULT_BUSINESS_CONTEXT;
    return base;
}

router.get('/', async (req, res) => {
    try {
        const { action, user, from, to, limit, offset, search } = req.query;
        const scope = resolveBusinessScope(req);
        if (!requireBusinessScope(req, res, scope)) return;
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        conditions.push(pushBusinessScopeCondition(params, scope, 'h'));
        paramIdx = params.length + 1;

        if (action) {
            conditions.push(`h.action = $${paramIdx++}`);
            params.push(action);
        }
        if (user) {
            conditions.push(`h.username = $${paramIdx++}`);
            params.push(user);
        }
        if (from) {
            conditions.push(`h.created_at >= $${paramIdx++}`);
            params.push(from);
        }
        if (to) {
            conditions.push(`h.created_at < ($${paramIdx++})::date + 1`);
            params.push(to);
        }
        if (search) {
            conditions.push(`(h.data::text ILIKE $${paramIdx++} OR h.username ILIKE $${paramIdx++})`);
            params.push(`%${search}%`, `%${search}%`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const lim = Math.min(parseInt(limit) || 200, 500);
        const off = Math.max(parseInt(offset) || 0, 0);

        const countResult = await pool.query(`SELECT COUNT(*) FROM history h ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const queryParams = [...params, lim, off];
        const result = await pool.query(
            `SELECT h.* FROM history h ${where} ORDER BY h.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            queryParams
        );
        const history = result.rows.map(row => ({
            id: row.id,
            businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
            action: row.action,
            user: row.username,
            data: row.data,
            timestamp: row.created_at
        }));
        res.json({ items: history, total, limit: lim, offset: off });
    } catch (err) {
        log.error('Error fetching history', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const scope = resolveBusinessScope(req);
        if (!requireWritableBusinessScope(req, res, scope)) return;
        const action = normalizeHistoryAction(req.body?.action);
        if (!action) return res.status(400).json({ success: false, error: 'Invalid history action' });
        const businessContext = scope.activeContext || DEFAULT_BUSINESS_CONTEXT;
        await pool.query(
            'INSERT INTO history (business_context, action, username, data) VALUES ($1, $2, $3, $4)',
            [businessContext, action, historyActor(req), JSON.stringify(normalizeHistoryData(req.body?.data, businessContext))]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Error adding history', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
