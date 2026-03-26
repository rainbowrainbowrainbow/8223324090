'use strict';
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const logger = createLogger('SoundLibrary');

router.use(authenticateToken);

// GET /api/sound-library — all sounds
router.get('/', async (req, res) => {
    try {
        const { category } = req.query;
        let result;
        if (category) {
            result = await pool.query('SELECT * FROM sounds WHERE category = $1 ORDER BY created_at DESC LIMIT 500', [category]);
        } else {
            result = await pool.query('SELECT * FROM sounds ORDER BY created_at DESC LIMIT 500');
        }
        res.json({ sounds: result.rows });
    } catch (err) {
        logger.error('Get sounds error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/sound-library — add sound
router.post('/', async (req, res) => {
    const { name, filename, file_path, category = 'general', duration, file_size } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    try {
        const result = await pool.query(
            `INSERT INTO sounds (name, filename, file_path, category, duration, file_size, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [name.trim(), filename || '', file_path || '', category, duration || null, file_size || null, req.user?.name || null]
        );
        res.json({ id: result.rows[0].id, ok: true });
    } catch (err) {
        logger.error('Create sound error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/sound-library/:id
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM sounds WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (err) {
        logger.error('Delete sound error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/sound-library/projects
router.get('/projects', async (req, res) => {
    try {
        const projects = await pool.query('SELECT * FROM sound_projects ORDER BY created_at DESC');
        const result = [];
        for (const p of projects.rows) {
            const tracks = await pool.query(
                `SELECT s.* FROM sounds s
                 JOIN sound_project_tracks t ON t.sound_id = s.id
                 WHERE t.project_id = $1 ORDER BY t.sort_order`, [p.id]);
            result.push({ ...p, tracks: tracks.rows });
        }
        res.json({ projects: result });
    } catch (err) {
        logger.error('Get projects error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
