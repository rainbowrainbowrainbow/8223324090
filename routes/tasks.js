/**
 * routes/tasks.js — Tasks CRUD + Kleshnya integration (v10.0)
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Tasks');

// Lazy require to avoid circular dependency
function getKleshnya() {
    return require('../services/kleshnya');
}

const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'normal', 'high'];
const VALID_CATEGORIES = ['event', 'purchase', 'admin', 'trampoline', 'personal', 'improvement'];
const VALID_TASK_TYPES = ['human', 'bot'];

// GET /api/tasks — list with optional filters
router.get('/', async (req, res) => {
    try {
        const { status, date, assigned_to, owner, afisha_id, type, task_type, category, date_from, date_to } = req.query;
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
        // v10.0: Owner filter
        if (owner) {
            conditions.push(`owner = $${idx++}`);
            params.push(owner);
        }
        if (afisha_id && /^\d+$/.test(afisha_id)) {
            conditions.push(`afisha_id = $${idx++}`);
            params.push(parseInt(afisha_id));
        }
        if (type && ['recurring', 'afisha', 'manual', 'template'].includes(type)) {
            conditions.push(`type = $${idx++}`);
            params.push(type);
        }
        // v10.0: Task type filter (human/bot)
        if (task_type && VALID_TASK_TYPES.includes(task_type)) {
            conditions.push(`task_type = $${idx++}`);
            params.push(task_type);
        }
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
        if (id === 'logs') return res.status(400).json({ error: 'Use /api/tasks/:id/logs' });
        const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Get by id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v10.0: GET /api/tasks/:id/logs — task change history
router.get('/:id/logs', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM task_logs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 100',
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get task logs error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks — create (via Kleshnya) — admin/user only
router.post('/', requireRole('admin', 'user'), async (req, res) => {
    try {
        const { title, description, date, priority, assigned_to, owner, type, template_id,
                afisha_id, category, task_type, deadline, time_window_start, time_window_end,
                dependency_ids, control_policy, source_type } = req.body;

        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });

        const username = req.user?.username || 'system';
        const kleshnya = getKleshnya();

        const task = await kleshnya.createTask({
            title, description, date,
            priority: VALID_PRIORITIES.includes(priority) ? priority : 'normal',
            assigned_to: assigned_to || null,
            owner: owner || null,
            task_type: VALID_TASK_TYPES.includes(task_type) ? task_type : 'human',
            deadline: deadline || null,
            time_window_start: time_window_start || null,
            time_window_end: time_window_end || null,
            dependency_ids: dependency_ids || [],
            control_policy: control_policy || undefined,
            source_type: source_type || 'manual',
            category: VALID_CATEGORIES.includes(category) ? category : 'admin',
            template_id: template_id || null,
            afisha_id: afisha_id || null,
            created_by: username
        });

        res.json({ success: true, task });
    } catch (err) {
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/tasks/:id — full update — admin/user only
router.put('/:id', requireRole('admin', 'user'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, date, status, priority, assigned_to, owner, category,
                task_type, deadline, time_window_start, time_window_end } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });

        const taskStatus = VALID_STATUSES.includes(status) ? status : 'todo';
        const taskPriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';
        const taskCategory = VALID_CATEGORIES.includes(category) ? category : undefined;
        const completedAt = taskStatus === 'done' ? 'NOW()' : 'NULL';

        const setClauses = ['title=$1', 'description=$2', 'date=$3', 'status=$4', 'priority=$5',
            'assigned_to=$6', 'owner=$7', `updated_at=NOW()`, `completed_at=${completedAt}`];
        const values = [title.trim(), description || null, date || null, taskStatus, taskPriority,
                        assigned_to || null, owner || null];
        let paramIdx = 8;

        if (taskCategory) {
            setClauses.push(`category=$${paramIdx++}`);
            values.push(taskCategory);
        }
        if (task_type && VALID_TASK_TYPES.includes(task_type)) {
            setClauses.push(`task_type=$${paramIdx++}`);
            values.push(task_type);
        }
        if (deadline !== undefined) {
            setClauses.push(`deadline=$${paramIdx++}`);
            values.push(deadline || null);
        }
        if (time_window_start !== undefined) {
            setClauses.push(`time_window_start=$${paramIdx++}`);
            values.push(time_window_start || null);
        }
        if (time_window_end !== undefined) {
            setClauses.push(`time_window_end=$${paramIdx++}`);
            values.push(time_window_end || null);
        }

        values.push(id);
        await pool.query(
            `UPDATE tasks SET ${setClauses.join(', ')} WHERE id=$${paramIdx}`,
            values
        );

        const updated = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (updated.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

        // Log update via Kleshnya
        const kleshnya = getKleshnya();
        const actor = req.user?.username || 'system';
        await kleshnya.logTaskAction(parseInt(id), 'updated', null, title, actor);

        res.json({ success: true, task: updated.rows[0] });
    } catch (err) {
        log.error('Update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/tasks/:id/status — quick status change (via Kleshnya) — admin/user only
router.patch('/:id/status', requireRole('admin', 'user'), async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

        const actor = req.user?.username || 'system';
        const kleshnya = getKleshnya();
        const task = await kleshnya.updateTaskStatus(parseInt(id), status, actor);

        res.json({ success: true, task });
    } catch (err) {
        if (err.message === 'Task not found') {
            return res.status(404).json({ error: 'Task not found' });
        }
        log.error('Status change error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/tasks/:id — admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

        // Log deletion
        const kleshnya = getKleshnya();
        const actor = req.user?.username || 'system';
        await kleshnya.logTaskAction(parseInt(id), 'deleted', null, null, actor);

        res.json({ success: true });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
