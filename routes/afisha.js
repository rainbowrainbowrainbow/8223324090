/**
 * routes/afisha.js — Events CRUD
 */
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime, timeToMinutes, minutesToTime, getKyivDateStr, getKyivDate } = require('../services/booking');
const { generateTasksForEvent } = require('../services/taskTemplates');
const { ensureRecurringAfishaForDate } = require('../services/scheduler');
const { createLogger } = require('../utils/logger');

/**
 * Check if a recurring template should create an event for a given date.
 * Extracted from scheduler logic to reuse in eager-apply on template creation.
 */
function shouldTemplateRunOnDate(tpl, dateStr, dateObj) {
    if (tpl.date_from && dateStr < tpl.date_from) return false;
    if (tpl.date_to && dateStr > tpl.date_to) return false;
    const dayOfWeek = dateObj.getDay() || 7; // 1=Mon...7=Sun
    switch (tpl.recurrence_pattern) {
        case 'daily': return true;
        case 'weekdays': return dayOfWeek <= 5;
        case 'weekends': return dayOfWeek >= 6;
        case 'weekly': return dayOfWeek === 6;
        case 'custom':
            if (!tpl.recurrence_days) return false;
            return tpl.recurrence_days.split(',').map(d => parseInt(d.trim())).includes(dayOfWeek);
        default: return false;
    }
}

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
        const tpl = result.rows[0];

        // v8.1: Eager-apply — if template matches today, create afisha event immediately
        let todayCreated = false;
        try {
            const todayStr = getKyivDateStr();
            const kyiv = getKyivDate();
            if (shouldTemplateRunOnDate(tpl, todayStr, kyiv)) {
                const exists = await pool.query(
                    'SELECT id FROM afisha WHERE template_id = $1 AND date = $2', [tpl.id, todayStr]
                );
                if (exists.rows.length === 0) {
                    await pool.query(
                        `INSERT INTO afisha (date, time, title, duration, type, description, template_id, original_time)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [todayStr, tpl.time, tpl.title, tpl.duration, tpl.type, tpl.description, tpl.id, tpl.time]
                    );
                    todayCreated = true;
                    log.info(`Eager-apply: created afisha "${tpl.title}" for today ${todayStr}`);
                }
            }
        } catch (eagerErr) {
            log.error('Eager-apply error (non-blocking)', eagerErr);
        }

        res.json({ success: true, template: tpl, todayCreated });
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

// Core distribute logic — callable from scheduler and HTTP handler
async function distributeAfishaForDate(date) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const events = (await client.query(
            "SELECT * FROM afisha WHERE date = $1 AND type != 'birthday' ORDER BY time", [date]
        )).rows;
        const animators = (await client.query(
            'SELECT * FROM lines_by_date WHERE date = $1 ORDER BY id', [date]
        )).rows.map(l => ({ id: l.line_id, name: l.name }));
        const bookings = (await client.query(
            "SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled'", [date]
        )).rows;

        if (animators.length === 0) {
            await client.query('ROLLBACK');
            return { distribution: [], reason: 'no_animators' };
        }
        if (events.length === 0) {
            await client.query('ROLLBACK');
            return { distribution: [], reason: 'no_events' };
        }

        // Build occupied slots per animator: bookings + already-assigned afisha
        const loadMap = {};
        const occupiedSlots = {};
        animators.forEach(a => { loadMap[a.id] = 0; occupiedSlots[a.id] = []; });

        bookings.forEach(bk => {
            if (occupiedSlots[bk.line_id]) {
                occupiedSlots[bk.line_id].push({ start: timeToMinutes(bk.time), end: timeToMinutes(bk.time) + (bk.duration || 0) });
                loadMap[bk.line_id]++;
            }
        });

        // Determine working hours from date
        const dateObj = new Date(date + 'T12:00:00');
        const dow = dateObj.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const dayStartMin = isWeekend ? 10 * 60 : 12 * 60;
        const dayEndMin = 20 * 60;

        // Find nearest free slot for an animator
        function findFreeSlot(animId, baseMin, duration) {
            const slots = occupiedSlots[animId] || [];
            function isFree(startMin) {
                if (startMin < dayStartMin || startMin + duration > dayEndMin) return false;
                const endMin = startMin + duration;
                return !slots.some(s => startMin < s.end && endMin > s.start);
            }
            if (isFree(baseMin)) return baseMin;
            for (let delta = 15; delta <= 90; delta += 15) {
                if (isFree(baseMin - delta)) return baseMin - delta;
                if (isFree(baseMin + delta)) return baseMin + delta;
            }
            return null;
        }

        const distribution = [];
        for (const ev of events) {
            const baseMin = timeToMinutes(ev.original_time || ev.time);
            const dur = ev.duration || 60;

            const sorted = [...animators].sort((a, b) => (loadMap[a.id] || 0) - (loadMap[b.id] || 0));

            let assignedAnim = null;
            let assignedMin = null;

            for (const anim of sorted) {
                const freeMin = findFreeSlot(anim.id, baseMin, dur);
                if (freeMin !== null) {
                    assignedAnim = anim;
                    assignedMin = freeMin;
                    break;
                }
            }

            if (!assignedAnim) {
                assignedAnim = sorted[0];
                assignedMin = baseMin;
            }

            const newTime = minutesToTime(assignedMin);
            await client.query(
                'UPDATE afisha SET line_id = $1, time = $2 WHERE id = $3',
                [assignedAnim.id, newTime, ev.id]
            );

            occupiedSlots[assignedAnim.id].push({ start: assignedMin, end: assignedMin + dur });
            loadMap[assignedAnim.id]++;

            distribution.push({
                eventId: ev.id,
                title: ev.title,
                originalTime: ev.original_time || ev.time,
                assignedTime: newTime,
                animatorId: assignedAnim.id,
                animatorName: assignedAnim.name,
                shifted: newTime !== (ev.original_time || ev.time)
            });
        }

        await client.query('COMMIT');
        return { success: true, distribution };
    } catch (err) {
        await client.query('ROLLBACK').catch(rbErr => log.error('Rollback failed in distributeAfisha', rbErr));
        throw err;
    } finally {
        client.release();
    }
}

// v8.6: Auto-distribute afisha events to animator lines (persist assignments)
router.post('/distribute/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        const result = await distributeAfishaForDate(date);
        res.json(result);
    } catch (err) {
        log.error('Auto-distribute error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v8.6: Reset distribution — clear line_id, restore original times
router.post('/undistribute/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });

        const result = await pool.query(
            `UPDATE afisha SET line_id = NULL, time = COALESCE(original_time, time)
             WHERE date = $1 AND line_id IS NOT NULL RETURNING id`,
            [date]
        );

        res.json({ success: true, reset: result.rowCount });
    } catch (err) {
        log.error('Undistribute error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        // v8.3: Ensure recurring templates are applied before returning results
        try { await ensureRecurringAfishaForDate(date); } catch (e) { log.warn(`Recurring afisha setup failed for ${date}`, e.message); }
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
            'INSERT INTO afisha (date, time, title, duration, type, description, original_time) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [date, time, title, eventDuration, eventType, description || null, time]
        );
        const item = result.rows[0];
        // v8.1: Log to history
        const username = req.user?.username || 'system';
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['afisha_create', username, JSON.stringify({ id: item.id, title, date, time, type: eventType, duration: eventDuration })]
        ).catch(err => log.error('History log error', err));
        res.json({ success: true, item });
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
        // v8.1: Log to history
        const username = req.user?.username || 'system';
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['afisha_edit', username, JSON.stringify({ id, title, date, time, type: eventType, duration: duration || 60 })]
        ).catch(err => log.error('History log error', err));
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
        // v8.3: Log to history
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['tasks_generated', username, JSON.stringify({ afisha_id: id, title: event.rows[0].title, count: created.length })]
        ).catch(err => log.error('History log error', err));
        res.json({ success: true, tasks: created, count: created.length });
    } catch (err) {
        log.error('Generate tasks error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v8.3: Quick time update for drag-to-move
router.patch('/:id/time', async (req, res) => {
    try {
        const { id } = req.params;
        const { time } = req.body;
        if (!time || !validateTime(time)) return res.status(400).json({ error: 'Valid time required' });

        const event = await pool.query('SELECT * FROM afisha WHERE id = $1', [id]);
        if (event.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        const ev = event.rows[0];
        const originalTime = ev.original_time || ev.time;
        const maxDelta = ev.template_id ? 90 : 120;

        const newMin = timeToMinutes(time);
        const origMin = timeToMinutes(originalTime);
        if (Math.abs(newMin - origMin) > maxDelta) {
            return res.status(400).json({ error: 'Time exceeds allowed range' });
        }

        await pool.query('UPDATE afisha SET time = $1 WHERE id = $2', [time, id]);

        const username = req.user?.username || 'system';
        await pool.query(
            'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
            ['afisha_move', username, JSON.stringify({ id: ev.id, title: ev.title, from: ev.time, to: time })]
        ).catch(err => log.error('History log error', err));

        res.json({ success: true, time, originalTime });
    } catch (err) {
        log.error('Move error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // v8.1: Fetch before delete for history logging
        const original = await pool.query('SELECT * FROM afisha WHERE id = $1', [id]);
        // v7.6: Cascade — delete linked todo tasks (keep in_progress/done)
        const deleted = await pool.query(
            `DELETE FROM tasks WHERE afisha_id = $1 AND status = 'todo' RETURNING id`, [id]
        );
        if (deleted.rows.length > 0) {
            log.info(`Cascade-deleted ${deleted.rows.length} todo tasks for afisha #${id}`);
        }
        await pool.query('DELETE FROM afisha WHERE id = $1', [id]);
        // v8.1: Log to history
        if (original.rows.length > 0) {
            const username = req.user?.username || 'system';
            const ev = original.rows[0];
            await pool.query(
                'INSERT INTO history (action, username, data) VALUES ($1, $2, $3)',
                ['afisha_delete', username, JSON.stringify({ id: ev.id, title: ev.title, date: ev.date, time: ev.time, type: ev.type })]
            ).catch(err => log.error('History log error', err));
        }
        res.json({ success: true, deletedTasks: deleted.rows.length });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.distributeAfishaForDate = distributeAfishaForDate;
module.exports = router;
