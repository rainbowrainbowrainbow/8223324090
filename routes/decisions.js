'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const logger = createLogger('Decisions');

const DIRECTOR_ROLES = ['creator', 'director', 'vice_director'];

// GET /api/decisions/pending
router.get('/pending', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM decisions
            WHERE status = 'pending'
            ORDER BY
                CASE priority
                    WHEN 'critical'  THEN 0
                    WHEN 'important' THEN 1
                    ELSE 2
                END,
                created_at ASC
            LIMIT 200
        `);
        res.json({ decisions: result.rows, count: result.rows.length });
    } catch (err) {
        logger.error('Get pending error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/decisions — створити рішення (будь-хто авторизований, або Клешня/бот)
router.post('/', async (req, res) => {
    const {
        title, description,
        priority = 'normal',
        created_by, created_by_id,
        source = 'manual',
        expires_at, context_url
    } = req.body;

    if (!title?.trim()) {
        return res.status(400).json({ error: 'title required' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO decisions
                (title, description, priority, created_by, created_by_id,
                 source, expires_at, context_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `, [
            title.trim(), description || null,
            priority, created_by || req.user?.name || null,
            created_by_id || req.user?.id || null,
            source, expires_at || null, context_url || null
        ]);
        res.json({ id: result.rows[0].id, ok: true });
    } catch (err) {
        logger.error('Create decision error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/decisions/:id/:action (approve/reject/defer)
router.put('/:id/:action', async (req, res) => {
    const { id, action } = req.params;
    const { note } = req.body || {};
    const statusMap = { approve: 'approved', reject: 'rejected', defer: 'deferred' };
    const status = statusMap[action];

    if (!status) return res.status(400).json({ error: `Invalid action: ${action}` });

    try {
        const result = await pool.query(`
            UPDATE decisions
            SET status = $1, decided_by = $2, decided_by_id = $3,
                decided_at = NOW(), decision_note = $4
            WHERE id = $5 AND status = 'pending'
            RETURNING id
        `, [
            status,
            req.user?.name || req.user?.username || null,
            req.user?.id || null,
            note?.trim() || null,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Not found or already decided' });
        }
        res.json({ ok: true, id: Number(id), status });
    } catch (err) {
        logger.error('Decide error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/decisions/history
router.get('/history', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM decisions WHERE status != 'pending'
            ORDER BY decided_at DESC LIMIT 200
        `);
        res.json({ decisions: result.rows });
    } catch (err) {
        logger.error('History error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
