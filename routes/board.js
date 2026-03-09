/**
 * routes/board.js — Floating Command Panel API (v20.2.0)
 * KPI stats + quick notes CRUD
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireMinRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const { getKyivDateStr } = require('../services/booking');

const log = createLogger('Board');

// GET /api/board/stats — today's KPI for command panel
router.get('/stats', async (req, res) => {
    try {
        const today = getKyivDateStr();
        const role = req.user.role;
        const REVENUE_ROLES = ['creator', 'director', 'vice_director', 'senior_manager'];

        const results = await Promise.allSettled([
            // 0: Bookings today
            pool.query(
                `SELECT COUNT(*)::int as total,
                    COUNT(*) FILTER (WHERE status = 'confirmed')::int as confirmed,
                    COUNT(*) FILTER (WHERE status = 'preliminary')::int as preliminary
                 FROM bookings WHERE date = $1 AND status != 'cancelled'`, [today]
            ),
            // 1: Staff on shift today
            pool.query(
                `SELECT COUNT(DISTINCT staff_id)::int as count FROM staff_schedule
                 WHERE date = $1 AND status = 'working'`, [today]
            ),
            // 2: Tasks progress
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'done' AND completed_at::date = CURRENT_DATE)::int as done_today,
                    COUNT(*) FILTER (WHERE status != 'done')::int as remaining,
                    COUNT(*)::int as total
                 FROM tasks WHERE date = $1 OR (deadline IS NOT NULL AND deadline::date = CURRENT_DATE) OR date IS NULL`, [today]
            ),
            // 3: Revenue today (only for senior_manager+)
            REVENUE_ROLES.includes(role) ?
                pool.query(
                    `SELECT COALESCE(SUM(price), 0)::int as revenue FROM bookings
                     WHERE date = $1 AND status != 'cancelled'`, [today]
                ) : Promise.resolve({ rows: [{ revenue: null }] })
        ]);

        const get = (idx) => results[idx].status === 'fulfilled' ? results[idx].value.rows[0] : {};

        const bk = get(0);
        const staff = get(1);
        const tasks = get(2);
        const rev = get(3);

        res.json({
            bookings: bk.total || 0,
            confirmed: bk.confirmed || 0,
            preliminary: bk.preliminary || 0,
            staffOnShift: staff.count || 0,
            tasksDone: tasks.done_today || 0,
            tasksRemaining: tasks.remaining || 0,
            tasksTotal: tasks.total || 0,
            revenue: rev.revenue,
            date: today
        });
    } catch (err) {
        log.error('Board stats error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/board/notes — user's notes + shared notes
router.get('/notes', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT qn.id, qn.text, qn.is_shared, qn.created_at, u.name as author
             FROM quick_notes qn LEFT JOIN users u ON qn.user_id = u.id
             WHERE qn.user_id = $1 OR qn.is_shared = true
             ORDER BY qn.created_at DESC LIMIT 20`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get notes error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/board/notes — create note
router.post('/notes', async (req, res) => {
    try {
        const { text, isShared } = req.body;
        if (!text || text.length > 200) {
            return res.status(400).json({ error: 'Текст замітки (макс. 200 символів)' });
        }

        // Shared notes only for manager+
        const SHARED_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
        const canShare = SHARED_ROLES.includes(req.user.role);

        const result = await pool.query(
            'INSERT INTO quick_notes (user_id, text, is_shared) VALUES ($1, $2, $3) RETURNING id, text, is_shared, created_at',
            [req.user.id, text.trim(), canShare ? !!isShared : false]
        );
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Create note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/board/notes/:id — delete own note
router.delete('/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const note = await pool.query('SELECT user_id FROM quick_notes WHERE id = $1', [parseInt(id)]);
        if (note.rows.length === 0) return res.status(404).json({ error: 'Замітку не знайдено' });

        // Only note owner or creator/director can delete
        const ADMIN_ROLES = ['creator', 'director'];
        if (note.rows[0].user_id !== req.user.id && !ADMIN_ROLES.includes(req.user.role)) {
            return res.status(403).json({ error: 'Можна видаляти тільки свої замітки' });
        }

        await pool.query('DELETE FROM quick_notes WHERE id = $1', [parseInt(id)]);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/board/notes/:id — update note text
router.patch('/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { text } = req.body;
        if (!text || text.length > 200) {
            return res.status(400).json({ error: 'Текст замітки (макс. 200 символів)' });
        }

        const note = await pool.query('SELECT user_id FROM quick_notes WHERE id = $1', [parseInt(id)]);
        if (note.rows.length === 0) return res.status(404).json({ error: 'Замітку не знайдено' });
        if (note.rows[0].user_id !== req.user.id) {
            return res.status(403).json({ error: 'Можна редагувати тільки свої замітки' });
        }

        const result = await pool.query(
            'UPDATE quick_notes SET text = $1 WHERE id = $2 RETURNING id, text, is_shared, created_at',
            [text.trim(), parseInt(id)]
        );
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Update note error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
