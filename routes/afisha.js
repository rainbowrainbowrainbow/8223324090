/**
 * routes/afisha.js — Events CRUD
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime } = require('../services/booking');
const { generateTasksForEvent } = require('../services/taskTemplates');
const { createLogger } = require('../utils/logger');

const log = createLogger('Afisha');

router.get('/', async (req, res) => {
    try {
        const { type } = req.query;
        const validTypes = ['event', 'birthday', 'regular'];
        if (type && validTypes.includes(type)) {
            const result = await pool.query('SELECT * FROM afisha WHERE type = $1 ORDER BY date, time', [type]);
            return res.json(result.rows);
        }
        const result = await pool.query('SELECT * FROM afisha ORDER BY date, time');
        res.json(result.rows);
    } catch (err) {
        log.error('Get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        const result = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [date]);
        res.json(result.rows);
    } catch (err) {
        log.error('Get by date error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { date, time, title, duration, type } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const validTypes = ['event', 'birthday', 'regular'];
        const eventType = validTypes.includes(type) ? type : 'event';
        const eventDuration = eventType === 'birthday' ? 0 : (duration || 60);
        const result = await pool.query(
            'INSERT INTO afisha (date, time, title, duration, type) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [date, time, title, eventDuration, eventType]
        );
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, time, title, duration, type } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        const validTypes = ['event', 'birthday', 'regular'];
        const eventType = validTypes.includes(type) ? type : undefined;
        if (eventType) {
            await pool.query(
                'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4, type=$5 WHERE id=$6',
                [date, time, title, duration || 60, eventType, id]
            );
        } else {
            await pool.query(
                'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4 WHERE id=$5',
                [date, time, title, duration || 60, id]
            );
        }
        res.json({ success: true });
    } catch (err) {
        log.error('Update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v7.6: Generate tasks for afisha event
router.post('/:id/generate-tasks', async (req, res) => {
    try {
        const { id } = req.params;
        const event = await pool.query('SELECT * FROM afisha WHERE id = $1', [id]);
        if (event.rows.length === 0) return res.status(404).json({ error: 'Event not found' });

        // Check if tasks already exist for this event
        const existing = await pool.query('SELECT COUNT(*) FROM tasks WHERE afisha_id = $1', [id]);
        if (parseInt(existing.rows[0].count) > 0) {
            return res.status(409).json({ error: 'Tasks already generated', existing: parseInt(existing.rows[0].count) });
        }

        const username = req.user?.username || 'system';
        const tasks = generateTasksForEvent(event.rows[0], username);
        const created = [];

        for (const task of tasks) {
            const result = await pool.query(
                `INSERT INTO tasks (title, date, status, priority, afisha_id, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [task.title, task.date, task.status, task.priority, task.afisha_id, task.created_by]
            );
            created.push(result.rows[0]);
        }

        log.info(`Generated ${created.length} tasks for afisha #${id}`);
        res.json({ success: true, tasks: created, count: created.length });
    } catch (err) {
        log.error('Generate tasks error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // v7.6: Cascade — delete linked todo tasks (keep in_progress/done)
        const deleted = await pool.query(
            `DELETE FROM tasks WHERE afisha_id = $1 AND status = 'todo' RETURNING id`, [id]
        );
        if (deleted.rows.length > 0) {
            log.info(`Cascade-deleted ${deleted.rows.length} todo tasks for afisha #${id}`);
        }
        await pool.query('DELETE FROM afisha WHERE id = $1', [id]);
        res.json({ success: true, deletedTasks: deleted.rows.length });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
