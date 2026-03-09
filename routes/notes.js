/**
 * routes/notes.js — User notes (sticky notes) API
 * v22.4.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Notes');

const ANY_ROLE = ['admin', 'user', 'animator', 'instructor', 'waiter', 'senior_instructor', 'manager', 'senior_manager', 'vice_director', 'director', 'creator'];

// GET /api/notes
router.get('/', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM user_notes WHERE user_id = $1 ORDER BY pinned DESC, updated_at DESC',
            [req.user.id]
        );
        res.json(result.rows.map(n => ({
            id: n.id, title: n.title, content: n.content, color: n.color,
            pinned: n.pinned, createdAt: n.created_at, updatedAt: n.updated_at
        })));
    } catch (err) {
        log.error('Get notes error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/notes
router.post('/', requireRole(...ANY_ROLE), async (req, res) => {
    const { title, content, color } = req.body;
    if (!content && !title) return res.status(400).json({ error: 'title або content обов\'язкові' });
    try {
        const result = await pool.query(
            'INSERT INTO user_notes (user_id, title, content, color) VALUES ($1, $2, $3, $4) RETURNING *',
            [req.user.id, title || '', content || '', color || '#fef3c7']
        );
        const n = result.rows[0];
        res.json({ id: n.id, title: n.title, content: n.content, color: n.color, pinned: n.pinned, createdAt: n.created_at });
    } catch (err) {
        log.error('Create note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/notes/:id
router.put('/:id', requireRole(...ANY_ROLE), async (req, res) => {
    const { title, content, color } = req.body;
    try {
        const result = await pool.query(
            `UPDATE user_notes SET title = COALESCE($1, title), content = COALESCE($2, content),
             color = COALESCE($3, color), updated_at = NOW()
             WHERE id = $4 AND user_id = $5 RETURNING *`,
            [title, content, color, req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true });
    } catch (err) {
        log.error('Update note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/notes/:id
router.delete('/:id', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM user_notes WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true });
    } catch (err) {
        log.error('Delete note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/notes/:id/pin
router.put('/:id/pin', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE user_notes SET pinned = NOT pinned, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING pinned',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Не знайдено' });
        res.json({ success: true, pinned: result.rows[0].pinned });
    } catch (err) {
        log.error('Pin note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
