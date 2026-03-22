/**
 * routes/workers.js — Digital Worker Forge v1 CRUD
 * v17.10.0: Standardized worker role management (Purpose/Inputs/Actions/Limits/Escalations/Timers/Logs/Fallback/Monitoring).
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

const log = createLogger('Workers');

// All worker routes require authentication
router.use(authenticateToken);

// GET /api/workers — list all worker roles
router.get('/', async (req, res) => {
    try {
        const { active } = req.query;
        let query = 'SELECT * FROM worker_roles';
        const params = [];
        if (active === 'true' || active === 'false') {
            query += ' WHERE is_active = $1';
            params.push(active === 'true');
        }
        query += ' ORDER BY created_at';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json([]);
        log.error('Workers list error', err);
        res.status(500).json({ error: 'Failed to fetch workers' });
    }
});

// GET /api/workers/:id — get single worker role
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM worker_roles WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Worker not found' });
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Worker get error', err);
        res.status(500).json({ error: 'Failed to fetch worker' });
    }
});

// POST /api/workers — create new worker role (admin only)
router.post('/', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        const { name, display_name, type, purpose, inputs, actions, limits, escalations, timers, logs, fallback, monitoring, owner, version } = req.body;
        if (!name || !display_name || !purpose) {
            return res.status(400).json({ error: 'name, display_name, purpose required' });
        }
        const result = await pool.query(
            `INSERT INTO worker_roles (name, display_name, type, purpose, inputs, actions, limits, escalations, timers, logs, fallback, monitoring, owner, version)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [name, display_name, type || 'bot', purpose,
             JSON.stringify(inputs || []), JSON.stringify(actions || []),
             JSON.stringify(limits || []), JSON.stringify(escalations || []),
             JSON.stringify(timers || {}), JSON.stringify(logs || []),
             fallback || null, JSON.stringify(monitoring || {}),
             owner || null, version || '1.0']
        );
        log.info(`Worker created: ${name} by ${req.user.username}`);
        res.json({ success: true, worker: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Worker name already exists' });
        log.error('Worker create error', err);
        res.status(500).json({ error: 'Failed to create worker' });
    }
});

// PUT /api/workers/:id — update worker role (admin only)
router.put('/:id', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        const { display_name, type, purpose, inputs, actions, limits, escalations, timers, logs, fallback, monitoring, is_active, owner, version } = req.body;
        const result = await pool.query(
            `UPDATE worker_roles SET
                display_name = COALESCE($1, display_name),
                type = COALESCE($2, type),
                purpose = COALESCE($3, purpose),
                inputs = COALESCE($4, inputs),
                actions = COALESCE($5, actions),
                limits = COALESCE($6, limits),
                escalations = COALESCE($7, escalations),
                timers = COALESCE($8, timers),
                logs = COALESCE($9, logs),
                fallback = COALESCE($10, fallback),
                monitoring = COALESCE($11, monitoring),
                is_active = COALESCE($12, is_active),
                owner = COALESCE($13, owner),
                version = COALESCE($14, version),
                updated_at = NOW()
             WHERE id = $15 RETURNING *`,
            [display_name, type, purpose,
             inputs ? JSON.stringify(inputs) : null,
             actions ? JSON.stringify(actions) : null,
             limits ? JSON.stringify(limits) : null,
             escalations ? JSON.stringify(escalations) : null,
             timers ? JSON.stringify(timers) : null,
             logs ? JSON.stringify(logs) : null,
             fallback, monitoring ? JSON.stringify(monitoring) : null,
             is_active, owner, version, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Worker not found' });
        log.info(`Worker ${req.params.id} updated by ${req.user.username}`);
        res.json({ success: true, worker: result.rows[0] });
    } catch (err) {
        log.error('Worker update error', err);
        res.status(500).json({ error: 'Failed to update worker' });
    }
});

// DELETE /api/workers/:id — delete worker role (admin only)
router.delete('/:id', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        const result = await pool.query('DELETE FROM worker_roles WHERE id = $1 RETURNING name', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Worker not found' });
        log.info(`Worker ${result.rows[0].name} deleted by ${req.user.username}`);
        res.json({ success: true });
    } catch (err) {
        log.error('Worker delete error', err);
        res.status(500).json({ error: 'Failed to delete worker' });
    }
});

module.exports = router;
