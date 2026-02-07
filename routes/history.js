/**
 * routes/history.js — Action history with filters
 */
const router = require('express').Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
    try {
        const { action, user, from, to, limit, offset, search } = req.query;
        const conditions = [];
        const params = [];
        let paramIdx = 1;

        if (action) {
            conditions.push(`action = $${paramIdx++}`);
            params.push(action);
        }
        if (user) {
            conditions.push(`username = $${paramIdx++}`);
            params.push(user);
        }
        if (from) {
            conditions.push(`created_at >= $${paramIdx++}`);
            params.push(from);
        }
        if (to) {
            conditions.push(`created_at < ($${paramIdx++})::date + 1`);
            params.push(to);
        }
        if (search) {
            conditions.push(`(data::text ILIKE $${paramIdx++} OR username ILIKE $${paramIdx++})`);
            params.push(`%${search}%`, `%${search}%`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const lim = Math.min(parseInt(limit) || 200, 500);
        const off = parseInt(offset) || 0;

        const countResult = await pool.query(`SELECT COUNT(*) FROM history ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT * FROM history ${where} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`,
            params
        );
        const history = result.rows.map(row => ({
            id: row.id,
            action: row.action,
            user: row.username,
            data: row.data,
            timestamp: row.created_at
        }));
        res.json({ items: history, total, limit: lim, offset: off });
    } catch (err) {
        console.error('Error fetching history:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { action, user, data } = req.body;
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            [action, user, JSON.stringify(data)]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error adding history:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
