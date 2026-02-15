/**
 * routes/points.js — Points system API (v10.0)
 *
 * Endpoints:
 *   GET /api/points          — leaderboard (all users)
 *   GET /api/points/:username — user's current points
 *   GET /api/points/:username/history — point transactions history
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { getUserPoints, getAllPoints } = require('../services/kleshnya');
const { createLogger } = require('../utils/logger');

const log = createLogger('Points');

// GET /api/points — leaderboard (admin/user only)
router.get('/', requireRole('admin', 'user'), async (req, res) => {
    try {
        const points = await getAllPoints();
        res.json(points);
    } catch (err) {
        log.error('Get all points error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/points/:username — user's current points (own or admin)
router.get('/:username', async (req, res) => {
    try {
        const { username } = req.params;
        // Users can only see their own points, admins can see anyone's
        if (req.user.role !== 'admin' && req.user.username !== username) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const points = await getUserPoints(username);
        res.json(points);
    } catch (err) {
        log.error('Get user points error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/points/:username/history — transaction history (own or admin)
router.get('/:username/history', async (req, res) => {
    try {
        const { username } = req.params;
        if (req.user.role !== 'admin' && req.user.username !== username) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const { limit = 50, offset = 0 } = req.query;

        const result = await pool.query(
            `SELECT pt.*, t.title as task_title
             FROM point_transactions pt
             LEFT JOIN tasks t ON pt.task_id = t.id
             WHERE pt.username = $1
             ORDER BY pt.created_at DESC
             LIMIT $2 OFFSET $3`,
            [username, Math.min(parseInt(limit) || 50, 100), Math.min(parseInt(offset) || 0, 10000)]
        );

        const countResult = await pool.query(
            'SELECT COUNT(*) FROM point_transactions WHERE username = $1',
            [username]
        );

        res.json({
            transactions: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        log.error('Get points history error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
