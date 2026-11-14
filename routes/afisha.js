/**
 * routes/afisha.js — Events CRUD
 */
const path = require('path');
const multer = require('multer');
const router = require('express').Router();
const { pool } = require('../db');
const { validateDate, validateTime, timeToMinutes, minutesToTime, getKyivDateStr, getKyivDate } = require('../services/booking');
const { generateTasksForEvent } = require('../services/taskTemplates');
const { ensureRecurringAfishaForDate } = require('../services/scheduler');
const { assertAfishaLinesFree } = require('../services/afishaConflicts');
const { createLogger } = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');
const { pushDefaultTimelineBusinessContext } = require('../services/timelineBusinessScope');
const { insertHistory } = require('../services/historyLog');
const { moveAfishaSchedule } = require('../services/afishaSchedule');
const { parseAfishaImport, importAfishaEvents } = require('../services/afishaImport');
const { createTimelineAfisha, updateTimelineAfisha } = require('../services/afishaTimeline');
const { birthdaySlotsForEvents, isGreetingEvent, setBirthdaySlot, isAfishaSubstitutionConflict } = require('../services/afishaBirthdaySlots');
const { DEFAULT_TIMELINE_CONTEXT, timelineContextFromRequest, requireTimelineAction } = require('../services/timelineContext');
const { resolveCapability } = require('../services/accountAccessPolicy');
const { businessScopeWriteGuard } = require('../middleware/businessScopeGuard');

function getKleshnya() { return require('../services/kleshnya'); }

// All afisha routes require authentication
router.use(authenticateToken);

function requireAfishaTimelineEdit(req, res) {
    const context = timelineContextFromRequest(req);
    if (context !== DEFAULT_TIMELINE_CONTEXT) {
        res.status(403).json({ error: 'Афіша недоступна в цьому бізнесі' });
        return false;
    }
    if (!requireTimelineAction(req, res, context, 'edit')) return false;
    if (!resolveCapability(req.user, 'edit_booking', { type: 'action' }).allowed) {
        res.status(403).json({ error: 'Немає права змінювати розклад' });
        return false;
    }
    return true;
}

router.post('/timeline', businessScopeWriteGuard, async (req, res) => {
    if (!requireAfishaTimelineEdit(req, res)) return;
    try {
        const item = await createTimelineAfisha(pool, req.body || {}, req.user.username);
        res.status(201).json({ success: true, item });
    } catch (error) {
        if (isAfishaSubstitutionConflict(error)) return res.status(409).json({ code:'AFISHA_SUBSTITUTION_CONFLICT',error:error.message });
        if (!error.statusCode) log.error('Timeline Afisha create error', error);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Не вдалося створити захід' });
    }
});

router.patch('/:id/timeline', businessScopeWriteGuard, async (req, res) => {
    if (!requireAfishaTimelineEdit(req, res)) return;
    try {
        const item = await updateTimelineAfisha(pool, req.params.id, req.body || {}, req.user.username);
        res.json({ success: true, item });
    } catch (error) {
        if (isAfishaSubstitutionConflict(error)) return res.status(409).json({ code:'AFISHA_SUBSTITUTION_CONFLICT',error:error.message });
        if (!error.statusCode) log.error('Timeline Afisha update error', error);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Не вдалося змінити захід' });
    }
});

router.patch('/:id/birthday-slots/:slotKey', businessScopeWriteGuard, async (req, res) => {
    if (!requireAfishaTimelineEdit(req, res)) return;
    try {
        const slots = await setBirthdaySlot(pool, req.params.id, req.params.slotKey, req.body || {}, req.user.username);
        res.json({ success: true, slots });
    } catch (error) {
        if (isAfishaSubstitutionConflict(error)) return res.status(409).json({ code:'AFISHA_SUBSTITUTION_CONFLICT',error:error.message });
        if (!error.statusCode) log.error('Birthday slot update error', error);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Не вдалося змінити час вітання' });
    }
});

// Afisha is a legacy Park-owned entity, without a business_context column.
// Never allow another cabinet to mutate these rows through the timeline bridge.
router.patch('/:id/schedule', businessScopeWriteGuard, async (req, res) => {
    const context = timelineContextFromRequest(req);
    if (context !== DEFAULT_TIMELINE_CONTEXT) {
        return res.status(403).json({ error: 'Афіша недоступна в цьому бізнесі' });
    }
    if (!requireTimelineAction(req, res, context, 'edit')) return;
    if (!resolveCapability(req.user, 'edit_booking', { type: 'action' }).allowed) {
        return res.status(403).json({ error: 'Немає права змінювати розклад' });
    }
    try {
        const item = await moveAfishaSchedule(pool, req.params.id, req.body || {}, req.user.username, context);
        res.json({ success: true, item });
    } catch (error) {
        if (isAfishaSubstitutionConflict(error)) return res.status(409).json({ code:'AFISHA_SUBSTITUTION_CONFLICT',error:error.message });
        if (!error.statusCode) log.error('Afisha schedule error', error);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Не вдалося зберегти розклад' });
    }
});

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

const AFISHA_MATERIAL_UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024;
const AFISHA_MATERIAL_ALLOWED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.txt', '.md', '.doc', '.docx',
    '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.zip'
]);
const AFISHA_MATERIAL_ALLOWED_KINDS = new Set(['note', 'link', 'file']);

function afishaMaterialKind(value) {
    const kind = String(value || '').trim().toLowerCase();
    return AFISHA_MATERIAL_ALLOWED_KINDS.has(kind) ? kind : 'note';
}

function materialFileExt(file) {
    return path.extname(file?.originalname || '').toLowerCase();
}

function validateMaterialUpload(file) {
    const ext = materialFileExt(file);
    if (!AFISHA_MATERIAL_ALLOWED_EXTENSIONS.has(ext)) {
        const err = new Error('Непідтримуваний формат матеріалу');
        err.statusCode = 400;
        throw err;
    }
}

const materialUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: AFISHA_MATERIAL_UPLOAD_LIMIT_BYTES,
        files: 1
    },
    fileFilter: (req, file, cb) => {
        try {
            validateMaterialUpload(file);
            cb(null, true);
        } catch (err) {
            cb(err);
        }
    }
});

function handleMaterialUpload(req, res, next) {
    materialUpload.single('file')(req, res, err => {
        if (!err) return next();
        const status = err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'Матеріал завеликий. Максимум 8 МБ'
            : (err.message || 'Не вдалося завантажити матеріал');
        return res.status(status).json({ error: message });
    });
}

function safeDownloadName(value) {
    return String(value || 'afisha-material')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180) || 'afisha-material';
}

function materialMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        event_id: row.event_id,
        kind: row.kind,
        title: row.title,
        description: row.description || '',
        url: row.url || '',
        original_name: row.original_name || '',
        mime_type: row.mime_type || '',
        file_size: row.file_size || 0,
        uploaded_by: row.uploaded_by || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        download_url: row.kind === 'file' ? `/api/afisha/${row.event_id}/materials/${row.id}/download` : null
    };
}

async function loadAfishaEvent(id) {
    const eventId = parseInt(id, 10);
    if (!Number.isFinite(eventId)) return null;
    const event = await pool.query('SELECT * FROM afisha WHERE id = $1 LIMIT 1', [eventId]);
    return event.rows[0] || null;
}

const afishaReadColumns = `a.*, p.title AS promotion_title, p.is_active AS promotion_active,
    (SELECT l.name FROM lines_by_date l WHERE l.date = a.date AND l.line_id = a.line_id
        AND COALESCE(l.business_context, 'event_genix') = 'event_genix' ORDER BY l.id DESC LIMIT 1) AS line_name,
    (SELECT l.name FROM lines_by_date l WHERE l.date = a.date AND l.line_id = a.second_line_id
        AND COALESCE(l.business_context, 'event_genix') = 'event_genix' ORDER BY l.id DESC LIMIT 1) AS second_line_name`;

router.get('/', async (req, res) => {
    try {
        const { type } = req.query;
        const validTypes = ['event', 'birthday', 'greeting', 'regular'];
        if (type && validTypes.includes(type)) {
            const result = await pool.query(`SELECT ${afishaReadColumns}
                FROM afisha a LEFT JOIN timeline_promotions p ON p.id = a.promotion_id
                WHERE a.type = $1 ORDER BY a.date, a.time LIMIT 1000`, [type]);
            const dates = [...new Set(result.rows.filter(isGreetingEvent).map(row => row.date))];
            if (!dates.length) return res.json(result.rows);
            const day = await pool.query(`SELECT id, date, time, original_time, duration, title, type, line_id, second_line_id
                FROM afisha WHERE date = ANY($1::text[])`, [dates]);
            const projected = await birthdaySlotsForEvents(pool, day.rows);
            const byId = new Map(projected.map(row => [Number(row.id), row.birthday_slots]));
            return res.json(result.rows.map(row => byId.has(Number(row.id))
                ? { ...row, birthday_slots: byId.get(Number(row.id)) } : row));
        }
        const result = await pool.query(`SELECT ${afishaReadColumns}
            FROM afisha a LEFT JOIN timeline_promotions p ON p.id = a.promotion_id
            ORDER BY a.date, a.time LIMIT 1000`);
        res.json(await birthdaySlotsForEvents(pool, result.rows));
    } catch (err) {
        log.error('Get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v8.0: Recurring afisha templates CRUD (MUST be before /:date to avoid param capture)
router.get('/templates/list', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM afisha_templates ORDER BY created_at DESC LIMIT 500');
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
        if (type === 'greeting' && Number(duration) !== 15) return res.status(400).json({ error: 'Вітання триває 15 хвилин' });
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
        if (type === 'greeting' && Number(duration) !== 15) return res.status(400).json({ error: 'Вітання триває 15 хвилин' });
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
            "SELECT * FROM afisha WHERE date = $1 AND type != 'birthday' AND line_id IS NULL AND second_line_id IS NULL ORDER BY time",
            [date]
        );
        // Get lines (animators) for the date
        const lineParams = [date];
        const lineScope = pushDefaultTimelineBusinessContext(lineParams);
        const lines = await pool.query(
            `SELECT * FROM lines_by_date WHERE date = $1 AND ${lineScope} ORDER BY id`,
            lineParams
        );
        // Get existing bookings to check conflicts
        const bookingParams = [date];
        const bookingScope = pushDefaultTimelineBusinessContext(bookingParams);
        const bookings = await pool.query(
            `SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled' AND ${bookingScope}`,
            bookingParams
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
            "SELECT * FROM afisha WHERE date = $1 AND type != 'birthday' AND line_id IS NULL AND second_line_id IS NULL ORDER BY time", [date]
        )).rows;
        const lineParams = [date];
        const lineScope = pushDefaultTimelineBusinessContext(lineParams);
        const animators = (await client.query(
            `SELECT * FROM lines_by_date WHERE date = $1 AND ${lineScope} ORDER BY id`,
            lineParams
        )).rows.map(l => ({ id: l.line_id, name: l.name }));
        const bookingParams = [date];
        const bookingScope = pushDefaultTimelineBusinessContext(bookingParams);
        const bookings = (await client.query(
            `SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled' AND ${bookingScope}`,
            bookingParams
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
        const assigned = (await client.query(
            `SELECT line_id, second_line_id, time, duration FROM afisha
             WHERE date = $1 AND (line_id IS NOT NULL OR second_line_id IS NOT NULL)`, [date]
        )).rows;
        assigned.forEach(ev => {
            for (const id of [ev.line_id, ev.second_line_id]) {
                if (!id || !occupiedSlots[id]) continue;
                occupiedSlots[id].push({ start: timeToMinutes(ev.time), end: timeToMinutes(ev.time) + (ev.duration || 60) });
                loadMap[id]++;
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
        let unassigned = 0;
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
                unassigned++;
                continue;
            }

            const newTime = minutesToTime(assignedMin);
            const updated = await client.query(
                `UPDATE afisha SET line_id = $1, time = $2 WHERE id = $3
                 AND date = $4 AND time = $5 AND line_id IS NULL AND second_line_id IS NULL
                 RETURNING id`,
                [assignedAnim.id, newTime, ev.id, date, ev.time]
            );
            if (!updated.rowCount) continue;

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
        return { success: true, distribution, unassigned };
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
            `UPDATE afisha SET line_id = NULL, second_line_id = NULL, time = COALESCE(original_time, time)
             WHERE date = $1 AND (line_id IS NOT NULL OR second_line_id IS NOT NULL) RETURNING id`,
            [date]
        );

        res.json({ success: true, reset: result.rowCount });
    } catch (err) {
        log.error('Undistribute error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v0.63.45: Event-scoped Afisha materials workspace.
router.get('/:id/materials', async (req, res) => {
    try {
        const event = await loadAfishaEvent(req.params.id);
        if (!event) return res.status(404).json({ error: 'Event not found' });

        const materials = await pool.query(
            `SELECT id, event_id, kind, title, description, url, original_name, mime_type,
                    file_size, uploaded_by, created_at, updated_at
             FROM afisha_event_materials
             WHERE event_id = $1
             ORDER BY created_at DESC, id DESC`,
            [event.id]
        );
        res.json({ success: true, event, materials: materials.rows.map(materialMeta) });
    } catch (err) {
        if (err.message?.includes('does not exist')) return res.json({ success: true, materials: [] });
        log.error('List materials error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:id/materials', async (req, res) => {
    try {
        const event = await loadAfishaEvent(req.params.id);
        if (!event) return res.status(404).json({ error: 'Event not found' });

        const kind = afishaMaterialKind(req.body.kind);
        if (kind === 'file') return res.status(400).json({ error: 'Для файлу використайте завантаження матеріалу' });

        const title = String(req.body.title || '').trim();
        const description = String(req.body.description || '').trim();
        const url = String(req.body.url || '').trim();
        if (!title) return res.status(400).json({ error: 'Назва матеріалу обовʼязкова' });
        if (kind === 'link' && !url) return res.status(400).json({ error: 'Для посилання потрібен URL' });

        const inserted = await pool.query(
            `INSERT INTO afisha_event_materials
                (event_id, kind, title, description, url, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, event_id, kind, title, description, url, original_name, mime_type,
                       file_size, uploaded_by, created_at, updated_at`,
            [event.id, kind, title, description || null, kind === 'link' ? url : null, req.user?.username || null]
        );

        await insertHistory(pool, {
            action: 'afisha_material_create',
            username: req.user?.username || 'system',
            data: { afisha_id: event.id, material_id: inserted.rows[0].id, kind, title }
        }).catch(err => log.error('History log error', err));

        res.json({ success: true, material: materialMeta(inserted.rows[0]) });
    } catch (err) {
        log.error('Create material error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:id/materials/upload', handleMaterialUpload, async (req, res) => {
    try {
        const event = await loadAfishaEvent(req.params.id);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        if (!req.file) return res.status(400).json({ error: 'Додайте файл матеріалу' });
        if (!req.file.buffer?.length) return res.status(400).json({ error: 'Файл матеріалу порожній' });

        const title = String(req.body.title || req.file.originalname || '').trim();
        const description = String(req.body.description || '').trim();
        if (!title) return res.status(400).json({ error: 'Назва матеріалу обовʼязкова' });

        const inserted = await pool.query(
            `INSERT INTO afisha_event_materials
                (event_id, kind, title, description, original_name, mime_type, file_size, file_data, uploaded_by)
             VALUES ($1, 'file', $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, event_id, kind, title, description, url, original_name, mime_type,
                       file_size, uploaded_by, created_at, updated_at`,
            [
                event.id,
                title,
                description || null,
                req.file.originalname || title,
                req.file.mimetype || 'application/octet-stream',
                req.file.size || req.file.buffer.length,
                req.file.buffer,
                req.user?.username || null
            ]
        );

        await insertHistory(pool, {
            action: 'afisha_material_upload',
            username: req.user?.username || 'system',
            data: { afisha_id: event.id, material_id: inserted.rows[0].id, title, file: req.file.originalname }
        }).catch(err => log.error('History log error', err));

        res.json({ success: true, material: materialMeta(inserted.rows[0]) });
    } catch (err) {
        log.error('Upload material error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id/materials/:materialId/download', async (req, res) => {
    try {
        const eventId = parseInt(req.params.id, 10);
        const materialId = parseInt(req.params.materialId, 10);
        if (!Number.isFinite(eventId) || !Number.isFinite(materialId)) return res.status(400).json({ error: 'Invalid id' });

        const result = await pool.query(
            `SELECT id, event_id, title, original_name, mime_type, file_size, file_data
             FROM afisha_event_materials
             WHERE id = $1 AND event_id = $2 AND kind = 'file'`,
            [materialId, eventId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Not found' });

        const file = result.rows[0];
        const filename = safeDownloadName(file.original_name || file.title);
        const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
        res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
        res.setHeader('Content-Length', file.file_size || file.file_data.length);
        res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.send(file.file_data);
    } catch (err) {
        log.error('Download material error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/:id/materials/:materialId', async (req, res) => {
    try {
        const eventId = parseInt(req.params.id, 10);
        const materialId = parseInt(req.params.materialId, 10);
        if (!Number.isFinite(eventId) || !Number.isFinite(materialId)) return res.status(400).json({ error: 'Invalid id' });

        const deleted = await pool.query(
            `DELETE FROM afisha_event_materials
             WHERE id = $1 AND event_id = $2
             RETURNING id, event_id, kind, title`,
            [materialId, eventId]
        );
        if (!deleted.rows.length) return res.status(404).json({ error: 'Not found' });

        await insertHistory(pool, {
            action: 'afisha_material_delete',
            username: req.user?.username || 'system',
            data: deleted.rows[0]
        }).catch(err => log.error('History log error', err));

        res.json({ success: true });
    } catch (err) {
        log.error('Delete material error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:date', async (req, res) => {
    try {
        const { date } = req.params;
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        // v8.3: Ensure recurring templates are applied before returning results
        try { await ensureRecurringAfishaForDate(date); } catch (e) { log.warn(`Recurring afisha setup failed for ${date}`, e.message); }
        const result = await pool.query(`SELECT ${afishaReadColumns}
            FROM afisha a LEFT JOIN timeline_promotions p ON p.id = a.promotion_id
            WHERE a.date = $1 ORDER BY a.time`, [date]);
        res.json(await birthdaySlotsForEvents(pool, result.rows));
    } catch (err) {
        log.error('Get by date error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function handleAfishaImport(req, res) {
    try {
        const input = req.body || {};
        const batch = parseAfishaImport(input);
        if (input.commit !== true) return res.json(batch);
        const result = await importAfishaEvents(pool, batch, req.user.username);
        res.json(result);
    } catch (error) {
        if (!error.statusCode) log.error('Afisha import error', error);
        res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Не вдалося імпортувати розклад' });
    }
}

router.post('/import', businessScopeWriteGuard, (req, res) => {
    if (timelineContextFromRequest(req) !== DEFAULT_TIMELINE_CONTEXT) {
        return res.status(403).json({ error: 'Афіша недоступна в цьому бізнесі' });
    }
    return handleAfishaImport(req, res);
});

router.post('/timeline/import', businessScopeWriteGuard, (req, res) => {
    if (requireAfishaTimelineEdit(req, res)) return handleAfishaImport(req, res);
});

router.post('/', async (req, res) => {
    try {
        const { date, time, title, duration, type, description } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        if (!validateDate(date) || !validateTime(time)) return res.status(400).json({ error: 'Invalid date or time' });
        if (!validateDate(date)) return res.status(400).json({ error: 'Invalid date' });
        if (!validateTime(time)) return res.status(400).json({ error: 'Invalid time' });
        const validTypes = ['event', 'birthday', 'greeting', 'regular'];
        const eventType = validTypes.includes(type) ? type : 'event';
        const eventDuration = eventType === 'birthday' || eventType === 'greeting' ? 15 : (duration || 60);
        const result = await pool.query(
            'INSERT INTO afisha (date, time, title, duration, type, description, original_time) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [date, time, title, eventDuration, eventType, description || null, time]
        );
        const item = result.rows[0];
        // v8.1: Log to history
        const username = req.user?.username || 'system';
        await insertHistory(pool, {
            action: 'afisha_create',
            username,
            data: { id: item.id, title, date, time, type: eventType, duration: eventDuration }
        }).catch(err => log.error('History log error', err));
        res.json({ success: true, item });
    } catch (err) {
        if (isAfishaSubstitutionConflict(err)) return res.status(409).json({ code:'AFISHA_SUBSTITUTION_CONFLICT',error:err.message });
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/:id', async (req, res) => {
    let client;
    try {
        const { id } = req.params;
        const { date, time, title, duration, type, description } = req.body;
        if (!date || !time || !title) return res.status(400).json({ error: 'date, time, title required' });
        client = await pool.connect();
        await client.query('BEGIN');
        const existing = await client.query('SELECT promotion_id, date, time, duration, type, line_id, second_line_id FROM afisha WHERE id = $1 FOR UPDATE', [id]);
        if (!existing.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Not found' });
        }
        if (existing.rows[0].promotion_id != null) {
            const linked = await client.query(
                `SELECT to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
                    to_char(ends_on, 'YYYY-MM-DD') AS ends_on
                 FROM timeline_promotions WHERE id = $1 FOR SHARE`, [existing.rows[0].promotion_id]
            );
            const promotion = linked.rows[0];
            if (promotion && (date < promotion.starts_on || date > promotion.ends_on)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Спочатку відв’яжіть захід від акції або змініть дати акції' });
            }
        }
        const current = existing.rows[0];
        if ((current.type === 'greeting' || type === 'greeting') && (date !== current.date || time !== current.time)) {
            throw Object.assign(new Error('Час вітання змінюється окремо на таймлайні'), { statusCode: 400 });
        }
        if ((current.type === 'greeting' || type === 'greeting') && Number(duration) !== 15) {
            throw Object.assign(new Error('Вітання триває 15 хвилин'), { statusCode: 400 });
        }
        if (date === current.date && (time !== current.time || Number(duration || 60) !== Number(current.duration || 60))) {
            await assertAfishaLinesFree(client, { date, time, duration: Number(duration || 60),
                lineIds: [current.line_id, current.second_line_id].filter(Boolean), excludeId: Number(id) });
        }
        const validTypes = ['event', 'birthday', 'greeting', 'regular'];
        const eventType = validTypes.includes(type) ? type : undefined;
        if (eventType) {
            await client.query(
                `UPDATE afisha SET date=$1::text, time=$2, title=$3, duration=$4, type=$5, description=$6,
                    line_id=CASE WHEN date::text <> $1::text THEN NULL ELSE line_id END,
                    second_line_id=CASE WHEN date::text <> $1::text THEN NULL ELSE second_line_id END WHERE id=$7`,
                [date, time, title, duration || 60, eventType, description !== undefined ? description : null, id]
            );
        } else {
            await client.query(
                `UPDATE afisha SET date=$1::text, time=$2, title=$3, duration=$4, description=$5,
                    line_id=CASE WHEN date::text <> $1::text THEN NULL ELSE line_id END,
                    second_line_id=CASE WHEN date::text <> $1::text THEN NULL ELSE second_line_id END WHERE id=$6`,
                [date, time, title, duration || 60, description !== undefined ? description : null, id]
            );
        }
        // v8.1: Log to history
        const username = req.user?.username || 'system';
        await insertHistory(client, {
            action: 'afisha_edit',
            username,
            data: { id, title, date, time, type: eventType, duration: duration || 60 }
        });
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        if (isAfishaSubstitutionConflict(err)) return res.status(409).json({ code:'AFISHA_SUBSTITUTION_CONFLICT',error:err.message });
        if (!err.statusCode) log.error('Update error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally { client?.release(); }
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
            const createdTask = await getKleshnya().createTask({
                title: task.title,
                date: task.date,
                priority: task.priority,
                afisha_id: task.afisha_id,
                created_by: task.created_by,
                source_type: 'afisha',
                source_id: String(task.afisha_id),
                category: task.category || 'event',
                duplicateMode: 'skip'
            });
            created.push(createdTask);
        }

        log.info(`Generated ${created.length} tasks for afisha #${id}`);
        // v8.3: Log to history
        await insertHistory(pool, {
            action: 'tasks_generated',
            username,
            data: { afisha_id: id, title: event.rows[0].title, count: created.length }
        }).catch(err => log.error('History log error', err));
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
        if (ev.type !== 'birthday') {
            try {
                await moveAfishaSchedule(pool, id, { date: ev.date, time,
                    expectedDate: ev.date, expectedTime: ev.time }, req.user?.username || 'system', DEFAULT_TIMELINE_CONTEXT);
                return res.json({ success: true, time, originalTime });
            } catch (error) {
                if (!error.statusCode) log.error('Move error', error);
                return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' });
            }
        }
        const maxDelta = ev.template_id ? 90 : 120;

        const newMin = timeToMinutes(time);
        const origMin = timeToMinutes(originalTime);
        if (Math.abs(newMin - origMin) > maxDelta) {
            return res.status(400).json({ error: 'Time exceeds allowed range' });
        }

        await pool.query('UPDATE afisha SET time = $1 WHERE id = $2', [time, id]);

        const username = req.user?.username || 'system';
        await insertHistory(pool, {
            action: 'afisha_move',
            username,
            data: { id: ev.id, title: ev.title, from: ev.time, to: time }
        }).catch(err => log.error('History log error', err));

        res.json({ success: true, time, originalTime });
    } catch (err) {
        log.error('Move error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v20.8.0: Move afisha to a different animator line
router.patch('/:id/line', async (req, res) => {
    try {
        const { id } = req.params;
        const { line_id } = req.body;

        const event = await pool.query('SELECT * FROM afisha WHERE id = $1', [id]);
        if (event.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        const ev = event.rows[0];

        // Allow null to unassign from line
        const newLineId = line_id != null ? parseInt(line_id) : null;
        if (line_id != null && (!Number.isSafeInteger(newLineId) || String(newLineId) !== String(line_id))) {
            return res.status(400).json({ error: 'Некоректна лінія' });
        }
        if (ev.type !== 'birthday') {
            const current = [ev.line_id, ev.second_line_id].filter(Boolean).map(String);
            const next = newLineId == null ? [] : [String(newLineId), ...current.filter(id => id !== String(ev.line_id) && id !== String(newLineId))];
            try {
                const item = await updateTimelineAfisha(pool, id, {
                    expectedLineIds: current, lineIds: next,
                    expectedPromotionId: ev.promotion_id ?? null, promotionId: ev.promotion_id ?? null
                }, req.user?.username || 'system');
                return res.json({ success: true, lineId: item.line_id, lineIds: [item.line_id, item.second_line_id].filter(Boolean) });
            } catch (error) {
                if (!error.statusCode) log.error('Move line error', error);
                return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Не вдалося змінити лінію' });
            }
        }

        await pool.query(`UPDATE afisha SET line_id = $1,
            second_line_id = CASE WHEN $1::text IS NULL OR second_line_id = $1::text THEN NULL ELSE second_line_id END
            WHERE id = $2`, [newLineId, id]);

        const username = req.user?.username || 'system';
        await insertHistory(pool, {
            action: 'afisha_move_line',
            username,
            data: { id: ev.id, title: ev.title, from_line: ev.line_id, to_line: newLineId }
        }).catch(err => log.error('History log error', err));

        res.json({ success: true, lineId: newLineId });
    } catch (err) {
        log.error('Move line error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // v8.1: Fetch before delete for history logging
        const original = await pool.query('SELECT * FROM afisha WHERE id = $1', [id]);
        // Cascade — delete non-done tasks (done tasks survive for history)
        const deleted = await pool.query(
            `DELETE FROM tasks WHERE afisha_id = $1 AND status != 'done' RETURNING id`, [id]
        );
        if (deleted.rows.length > 0) {
            log.info(`Cascade-deleted ${deleted.rows.length} tasks for afisha #${id}`);
        }
        await pool.query('DELETE FROM afisha WHERE id = $1', [id]);
        // v8.1: Log to history
        if (original.rows.length > 0) {
            const username = req.user?.username || 'system';
            const ev = original.rows[0];
            await insertHistory(pool, {
                action: 'afisha_delete',
                username,
                data: { id: ev.id, title: ev.title, date: ev.date, time: ev.time, type: ev.type }
            }).catch(err => log.error('History log error', err));
        }
        res.json({ success: true, deletedTasks: deleted.rows.length });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.distributeAfishaForDate = distributeAfishaForDate;
module.exports = router;
