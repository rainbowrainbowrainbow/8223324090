/**
 * routes/tasks.js — Tasks CRUD (v7.5)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Tasks');

const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'normal', 'high'];
const VALID_CATEGORIES = ['event', 'purchase', 'admin', 'trampoline', 'personal', 'improvement'];

// GET /api/tasks — list with optional filters
router.get('/', async (req, res) => {
    try {
        const { status, date, assigned_to, afisha_id, type, category, date_from, date_to } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status && VALID_STATUSES.includes(status)) {
            conditions.push(`status = $${idx++}`);
            params.push(status);
        }
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            conditions.push(`date = $${idx++}`);
            params.push(date);
        }
        // v7.9: Date range filter for week view
        if (date_from && /^\d{4}-\d{2}-\d{2}$/.test(date_from)) {
            conditions.push(`date >= $${idx++}`);
            params.push(date_from);
        }
        if (date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
            conditions.push(`date <= $${idx++}`);
            params.push(date_to);
        }
        if (assigned_to) {
            conditions.push(`assigned_to = $${idx++}`);
            params.push(assigned_to);
        }
        if (afisha_id && /^\d+$/.test(afisha_id)) {
            conditions.push(`afisha_id = $${idx++}`);
            params.push(parseInt(afisha_id));
        }
        if (type) {
            conditions.push(`type = $${idx++}`);
            params.push(type);
        }
        // v7.9: Category filter
        if (category && VALID_CATEGORIES.includes(category)) {
            conditions.push(`category = $${idx++}`);
            params.push(category);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT * FROM tasks ${where} ORDER BY
                CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END,
                CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 END,
                created_at DESC`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/:id — single task
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Get by id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks — create
router.post('/', async (req, res) => {
    try {
        const { title, description, date, priority, assigned_to, type, template_id, afisha_id, category } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });

        const taskPriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';
        const taskType = ['manual', 'recurring', 'afisha', 'auto_complete'].includes(type) ? type : 'manual';
        const taskCategory = VALID_CATEGORIES.includes(category) ? category : 'admin';
        const username = req.user?.username || 'system';

        const result = await pool.query(
            `INSERT INTO tasks (title, description, date, priority, assigned_to, created_by, type, template_id, afisha_id, category)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [title.trim(), description || null, date || null, taskPriority, assigned_to || null, username,
             taskType, template_id || null, afisha_id || null, taskCategory]
        );
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/tasks/:id — full update
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, date, status, priority, assigned_to, category } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });

        const taskStatus = VALID_STATUSES.includes(status) ? status : 'todo';
        const taskPriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';
        const taskCategory = VALID_CATEGORIES.includes(category) ? category : undefined;
        const completedAt = taskStatus === 'done' ? 'NOW()' : 'NULL';

        const setClauses = ['title=$1', 'description=$2', 'date=$3', 'status=$4', 'priority=$5',
            'assigned_to=$6', `updated_at=NOW()`, `completed_at=${completedAt}`];
        const values = [title.trim(), description || null, date || null, taskStatus, taskPriority, assigned_to || null];
        let paramIdx = 7;
        if (taskCategory) {
            setClauses.push(`category=$${paramIdx++}`);
            values.push(taskCategory);
        }
        values.push(id);
        await pool.query(
            `UPDATE tasks SET ${setClauses.join(', ')} WHERE id=$${paramIdx}`,
            values
        );
        const updated = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (updated.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json({ success: true, task: updated.rows[0] });
    } catch (err) {
        log.error('Update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/tasks/:id/status — quick status change
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

        const completedAt = status === 'done' ? 'NOW()' : 'NULL';
        await pool.query(
            `UPDATE tasks SET status=$1, updated_at=NOW(), completed_at=${completedAt} WHERE id=$2`,
            [status, id]
        );
        const updated = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (updated.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json({ success: true, task: updated.rows[0] });
    } catch (err) {
        log.error('Status change error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json({ success: true });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
