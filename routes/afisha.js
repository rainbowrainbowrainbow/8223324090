/**
 * routes/afisha.js — Events CRUD
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime, timeToMinutes } = require('../services/booking');
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

// v8.0: Recurring afisha templates CRUD (MUST be before /:date to avoid param capture)
router.get('/templates/list', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM afisha_templates ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json([]);
        log.error('Templates list error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/templates', async (req, res) => {
    try {
        const { title, time, duration, type, description, recurrence_pattern, recurrence_days, date_from, date_to } = req.body;
        if (!title || !time) return res.status(400).json({ error: 'title and time required' });
        const validPatterns = ['daily', 'weekdays', 'weekends', 'weekly', 'custom'];
        const pattern = validPatterns.includes(recurrence_pattern) ? recurrence_pattern : 'weekly';
        const result = await pool.query(
            `INSERT INTO afisha_templates (title, time, duration, type, description, recurrence_pattern, recurrence_days, date_from, date_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [title, time, duration || 60, type || 'event', description || null, pattern, recurrence_days || null, date_from || null, date_to || null]
        );
        res.json({ success: true, template: result.rows[0] });
    } catch (err) {
        log.error('Template create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, time, duration, type, description, recurrence_pattern, recurrence_days, date_from, date_to, is_active } = req.body;
        await pool.query(
            `UPDATE afisha_templates SET title=$1, time=$2, duration=$3, type=$4, description=$5,
             recurrence_pattern=$6, recurrence_days=$7, date_from=$8, date_to=$9, is_active=$10 WHERE id=$11`,
            [title, time, duration || 60, type || 'event', description || null,
             recurrence_pattern || 'weekly', recurrence_days || null, date_from || null, date_to || null,
             is_active !== false, id]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Template update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/templates/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM afisha_templates WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('Template delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v8.0: Fair distribution — suggest which animator leads each afisha event
router.get('/distribute/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });

        // Get afisha events (non-birthday) for the date
        const events = await pool.query(
            "SELECT * FROM afisha WHERE date = $1 AND type != 'birthday' ORDER BY time",
            [date]
        );
        // Get lines (animators) for the date
        const lines = await pool.query(
            'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY id',
            [date]
        );
        // Get existing bookings to check conflicts
        const bookings = await pool.query(
            "SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled'",
            [date]
        );

        const animators = lines.rows.map(l => ({ id: l.line_id, name: l.name }));
        if (animators.length === 0 || events.rows.length === 0) {
            return res.json({ distribution: [], animators, events: events.rows, reason: animators.length === 0 ? 'no_animators' : 'no_events' });
        }

        // Count how many events each animator already has (from existing bookings)
        const loadMap = {};
        animators.forEach(a => { loadMap[a.id] = 0; });
        bookings.rows.forEach(b => {
            if (loadMap[b.line_id] !== undefined) loadMap[b.line_id]++;
        });

        // Round-robin distribution, preferring animator with least load
        const distribution = [];
        for (const ev of events.rows) {
            const evStart = timeToMinutes(ev.time);
            const evEnd = evStart + (ev.duration || 60);

            // Find animator with least load who has no time conflict
            const sorted = [...animators].sort((a, b) => (loadMap[a.id] || 0) - (loadMap[b.id] || 0));
            let assigned = null;
            for (const anim of sorted) {
                const hasConflict = bookings.rows.some(bk => {
                    if (bk.line_id !== anim.id) return false;
                    const bkStart = timeToMinutes(bk.time);
                    const bkEnd = bkStart + (bk.duration || 0);
                    return evStart < bkEnd && evEnd > bkStart;
                });
                if (!hasConflict) {
                    assigned = anim;
                    break;
                }
            }
            if (!assigned) assigned = sorted[0]; // fallback: least loaded even with conflict

            loadMap[assigned.id] = (loadMap[assigned.id] || 0) + 1;
            distribution.push({
                event: ev,
                animator: assigned,
                conflict: assigned === sorted[0] && bookings.rows.some(bk => bk.line_id === assigned.id)
            });
        }

        res.json({ distribution, animators, events: events.rows });
    } catch (err) {
        log.error('Distribution error', err);
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
        const { date, time, title, duration, type, description } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const validTypes = ['event', 'birthday', 'regular'];
        const eventType = validTypes.includes(type) ? type : 'event';
        const eventDuration = eventType === 'birthday' ? 15 : (duration || 60);
        const result = await pool.query(
            'INSERT INTO afisha (date, time, title, duration, type, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [date, time, title, eventDuration, eventType, description || null]
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
        const { date, time, title, duration, type, description } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        const validTypes = ['event', 'birthday', 'regular'];
        const eventType = validTypes.includes(type) ? type : undefined;
        if (eventType) {
            await pool.query(
                'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4, type=$5, description=$6 WHERE id=$7',
                [date, time, title, duration || 60, eventType, description !== undefined ? description : null, id]
            );
        } else {
            await pool.query(
                'UPDATE afisha SET date=$1, time=$2, title=$3, duration=$4, description=$5 WHERE id=$6',
                [date, time, title, duration || 60, description !== undefined ? description : null, id]
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
                `INSERT INTO tasks (title, date, status, priority, afisha_id, created_by, type, category)
                 VALUES ($1, $2, $3, $4, $5, $6, 'afisha', $7) RETURNING *`,
                [task.title, task.date, task.status, task.priority, task.afisha_id, task.created_by, task.category || 'event']
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
