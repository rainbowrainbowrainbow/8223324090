/**
 * routes/svitlana.js — Svitlana Bot API (secret-based auth)
 *
 * GET  /api/svitlana/tasks?date=YYYY-MM-DD          — задачі на дату
 * POST /api/svitlana/tasks/:id/done                  — відмітити виконано
 * POST /api/svitlana/tasks/:id/inprogress            — відмітити "в роботі"
 * GET  /api/svitlana/shifts?date=YYYY-MM-DD          — зміни аніматорів на дату
 * POST /api/svitlana/tasks                           — додати ручну задачу для зміни
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('SvitlanaRoute');
function getKleshnya() { return require('../services/kleshnya'); }

// ── Auth via secret header ──────────────────────────────────────────────────
function requireSecret(req, res, next) {
    const SVITLANA_SECRET = process.env.SVITLANA_SECRET;
    if (!SVITLANA_SECRET) {
        log.warn('SVITLANA_SECRET not configured in env!');
        return res.status(503).json({ error: 'Svitlana integration not configured' });
    }
    const secret = req.headers['x-svitlana-secret'] || req.query.secret;
    if (secret !== SVITLANA_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// ── GET /api/svitlana/tasks?date=YYYY-MM-DD&status=todo ─────────────────────
router.get('/tasks', requireSecret, async (req, res) => {
    try {
        const { date, status } = req.query;
        const today = (date && /^\d{4}-\d{2}-\d{2}$/.test(date))
            ? date
            : new Date().toISOString().split('T')[0];

        const conditions = ['date = $1'];
        const params = [today];

        if (status && ['todo', 'in_progress', 'done'].includes(status)) {
            conditions.push(`status = $${params.length + 1}`);
            params.push(status);
        }

        const result = await pool.query(
            `SELECT id, title, description, status, priority, assigned_to, category
             FROM tasks
             WHERE ${conditions.join(' AND ')}
             ORDER BY
                CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
                CASE status   WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 END,
                created_at`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        log.error('GET /svitlana/tasks', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/svitlana/tasks — додати ручну задачу для зміни ────────────────
router.post('/tasks', requireSecret, async (req, res) => {
    try {
        const { title, description, priority, date, assigned_to } = req.body;
        if (!title) return res.status(400).json({ error: 'title required' });

        const today = date || new Date().toISOString().split('T')[0];
        const task = await getKleshnya().createTask({
            title,
            description: description || null,
            priority: priority || 'normal',
            date: today,
            assigned_to: assigned_to || null,
            category: 'operational',
            owner: 'svitlana-bot',
            task_type: 'human',
            source_type: 'svitlana',
            source_id: `${today}:${title}:${assigned_to || ''}`,
            created_by: 'svitlana-bot',
            duplicateMode: 'skip'
        });
        log.info(`Task created by svitlana-bot: "${title}" for ${today}`);
        res.json({ success: true, task, duplicateSkipped: !!task.duplicateSkipped });
    } catch (err) {
        log.error('POST /svitlana/tasks', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/svitlana/tasks/:id/done ───────────────────────────────────────
router.post('/tasks/:id/done', requireSecret, async (req, res) => {
    try {
        const { id } = req.params;
        const { done_by } = req.body;

        const result = await pool.query(
            `UPDATE tasks
             SET status = 'done', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING id, title, status`,
            [parseInt(id)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

        log.info(`Task ${id} marked done by ${done_by || 'svitlana-bot'}`);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('POST /svitlana/tasks/:id/done', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/svitlana/tasks/:id/inprogress ─────────────────────────────────
router.post('/tasks/:id/inprogress', requireSecret, async (req, res) => {
    try {
        const { id } = req.params;
        const { started_by } = req.body;

        const result = await pool.query(
            `UPDATE tasks
             SET status = 'in_progress', updated_at = NOW()
             WHERE id = $1
             RETURNING id, title, status`,
            [parseInt(id)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

        log.info(`Task ${id} set in_progress by ${started_by || 'svitlana-bot'}`);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('POST /svitlana/tasks/:id/inprogress', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/svitlana/shifts?date=YYYY-MM-DD ────────────────────────────────
router.get('/shifts', requireSecret, async (req, res) => {
    try {
        const { date } = req.query;
        const today = (date && /^\d{4}-\d{2}-\d{2}$/.test(date))
            ? date
            : new Date().toISOString().split('T')[0];

        const result = await pool.query(
            `SELECT
                hs.id, hs.staff_id, hs.shift_date,
                hs.planned_start, hs.planned_end, hs.shift_type,
                s.name  AS staff_name,
                s.telegram_id,
                s.role_type,
                s.position
             FROM hr_shifts hs
             JOIN staff s ON hs.staff_id = s.id
             WHERE hs.shift_date = $1
               AND s.role_type = 'animator'
             ORDER BY hs.planned_start`,
            [today]
        );
        res.json(result.rows);
    } catch (err) {
        log.error('GET /svitlana/shifts', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
