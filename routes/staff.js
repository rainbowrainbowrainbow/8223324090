/**
 * routes/staff.js — Staff & schedule management API (v7.10)
 *
 * LLM HINT FOR SCHEDULE MANAGEMENT:
 * This API manages employee schedules for a children's entertainment park.
 * The Клавбот (main AI bot) and other LLMs will frequently use these endpoints
 * to set/modify staff schedules.
 *
 * TABLES:
 *   staff (id, name, department, position, phone, hire_date, is_active, color)
 *   staff_schedule (id, staff_id, date, shift_start, shift_end, status, note)
 *     - UNIQUE(staff_id, date) — one entry per person per day
 *
 * SCHEDULE STATUSES:
 *   working  — робочий день (shift_start/shift_end required, e.g. "09:00"/"18:00")
 *   remote   — віддалено (shift_start/shift_end optional, e.g. "09:00"/"18:00")
 *   dayoff   — вихідний (shift_start/shift_end = null)
 *   vacation — відпустка (shift_start/shift_end = null)
 *   sick     — лікарняний (shift_start/shift_end = null)
 *
 * DEPARTMENTS: animators, admin, cafe, tech, cleaning, security
 *
 * TYPICAL LLM USAGE:
 *   1. GET /api/staff?active=true — list all active employees
 *   2. GET /api/staff/schedule?from=2026-02-09&to=2026-02-15 — get week schedule
 *   3. PUT /api/staff/schedule — set/update a single day for an employee:
 *      { staffId: 5, date: "2026-02-12", shiftStart: "10:00", shiftEnd: "20:00", status: "working" }
 *   4. PUT /api/staff/schedule — mark vacation:
 *      { staffId: 5, date: "2026-02-12", status: "vacation", note: "Відпустка до 20.02" }
 *
 * BULK OPERATIONS: Loop over dates/staff and call PUT /api/staff/schedule for each.
 * Each PUT is an UPSERT (ON CONFLICT DO UPDATE), so safe to call multiple times.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
const { createLogger } = require('../utils/logger');

const { requireRole } = require('../middleware/auth');
const log = createLogger('Staff');

const STATUS_UK = { working: 'Робочий', dayoff: 'Вихідний', vacation: 'Відпустка', sick: 'Лікарняний', remote: 'Віддалено' };

/**
 * Send Telegram notification when schedule changes.
 * Mentions employee by @telegram_username if set.
 * Fire-and-forget — does not block API response.
 */
async function notifyScheduleChange(staffId, date, status, shiftStart, shiftEnd) {
    try {
        const staff = await pool.query('SELECT name, telegram_username FROM staff WHERE id = $1', [staffId]);
        if (staff.rows.length === 0) return;
        const { name, telegram_username } = staff.rows[0];

        const mention = telegram_username ? `@${telegram_username}` : `<b>${name}</b>`;
        const statusLabel = STATUS_UK[status] || status;
        let timeInfo = '';
        if (status === 'working' && shiftStart && shiftEnd) {
            timeInfo = ` (${shiftStart}–${shiftEnd})`;
        }

        const text = `📅 Графік: ${mention} — ${date} → ${statusLabel}${timeInfo}`;
        const chatId = await getConfiguredChatId();
        if (chatId) {
            sendTelegramMessage(chatId, text).catch(err => log.error('Schedule notify error', err));
        }
    } catch (err) {
        log.error('notifyScheduleChange error', err);
    }
}

/**
 * Send summary notification for bulk schedule changes.
 * Lists @-mentions of all affected employees.
 */
async function notifyBulkScheduleChange(staffIdSet, count) {
    try {
        if (staffIdSet.size === 0) return;
        const ids = Array.from(staffIdSet);
        const result = await pool.query(
            'SELECT id, name, telegram_username FROM staff WHERE id = ANY($1)',
            [ids]
        );
        const mentions = result.rows.map(r =>
            r.telegram_username ? `@${r.telegram_username}` : r.name
        );
        const text = `📅 Графік оновлено (${count} записів)\n👥 ${mentions.join(', ')}`;
        const chatId = await getConfiguredChatId();
        if (chatId) {
            sendTelegramMessage(chatId, text).catch(err => log.error('Bulk schedule notify error', err));
        }
    } catch (err) {
        log.error('notifyBulkScheduleChange error', err);
    }
}

const DEPARTMENTS = {
    animators: 'Аніматори',
    admin: 'Адміністрація',
    cafe: 'Кафе',
    tech: 'Технічний відділ',
    cleaning: 'Прибирання',
    security: 'Охорона'
};

// GET /api/staff/departments — list department names
router.get('/departments', async (req, res) => {
    res.json({ success: true, data: DEPARTMENTS });
});

// ==========================================
// SCHEDULE ROUTES (must be before /:id to avoid param capture)
// ==========================================

// GET /api/staff/schedule — get schedule for date range
router.get('/schedule', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            return res.status(400).json({ success: false, error: 'Потрібні параметри from та to' });
        }
        const result = await pool.query(
            `SELECT ss.*, s.name, s.department, s.position, s.color, s.is_active
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             WHERE ss.date >= $1 AND ss.date <= $2 AND s.is_active = true
             ORDER BY s.department, s.name, ss.date`,
            [from, to]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /staff/schedule error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/staff/schedule — upsert a single schedule entry
router.put('/schedule', requireRole('creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin'), async (req, res) => {
    try {
        const { staffId, date, shiftStart, shiftEnd, status, note } = req.body;
        if (!staffId || !date) {
            return res.status(400).json({ success: false, error: 'Потрібні staffId та date' });
        }
        const result = await pool.query(
            `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (staff_id, date)
             DO UPDATE SET shift_start=$3, shift_end=$4, status=$5, note=$6
             RETURNING *`,
            [staffId, date, shiftStart || null, shiftEnd || null, status || 'working', note || null]
        );
        // Fire-and-forget Telegram notification
        notifyScheduleChange(staffId, date, status || 'working', shiftStart, shiftEnd);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /staff/schedule error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

/**
 * POST /api/staff/schedule/bulk — upsert multiple schedule entries at once
 * LLM HINT: Send array of entries. Each entry: { staffId, date, shiftStart, shiftEnd, status, note }
 * Example: set a whole week for one person, or one day for all animators.
 * Returns count of upserted entries.
 */
router.post('/schedule/bulk', requireRole('creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin'), async (req, res) => {
    try {
        const { entries } = req.body;
        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ success: false, error: 'Потрібен масив entries' });
        }
        if (entries.length > 500) {
            return res.status(400).json({ success: false, error: 'Максимум 500 записів за раз' });
        }
        let count = 0;
        const affectedStaff = new Set();
        for (const e of entries) {
            if (!e.staffId || !e.date) continue;
            await pool.query(
                `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (staff_id, date)
                 DO UPDATE SET shift_start=$3, shift_end=$4, status=$5, note=$6`,
                [e.staffId, e.date, e.shiftStart || null, e.shiftEnd || null, e.status || 'working', e.note || null]
            );
            affectedStaff.add(e.staffId);
            count++;
        }
        // Fire-and-forget: bulk notification summary
        notifyBulkScheduleChange(affectedStaff, count);
        res.json({ success: true, count });
    } catch (err) {
        log.error('POST /staff/schedule/bulk error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

/**
 * POST /api/staff/schedule/copy-week — copy schedule from one week to another
 * LLM HINT: { fromMonday: "2026-02-09", toMonday: "2026-02-16", department?: "animators" }
 * Copies 7 days of schedule. Optional department filter.
 * Existing entries in target week are overwritten.
 */
router.post('/schedule/copy-week', requireRole('creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin'), async (req, res) => {
    try {
        const { fromMonday, toMonday, department } = req.body;
        if (!fromMonday || !toMonday) {
            return res.status(400).json({ success: false, error: 'Потрібні fromMonday та toMonday' });
        }

        // Build date pairs (Mon→Mon, Tue→Tue, etc.)
        const fromDates = [];
        const toDates = [];
        for (let i = 0; i < 7; i++) {
            const fd = new Date(fromMonday);
            fd.setDate(fd.getDate() + i);
            fromDates.push(fd.toISOString().split('T')[0]);
            const td = new Date(toMonday);
            td.setDate(td.getDate() + i);
            toDates.push(td.toISOString().split('T')[0]);
        }

        // Fetch source week schedule
        let sql = `SELECT ss.* FROM staff_schedule ss JOIN staff s ON s.id = ss.staff_id
                    WHERE ss.date >= $1 AND ss.date <= $2 AND s.is_active = true`;
        const params = [fromDates[0], fromDates[6]];
        if (department) {
            params.push(department);
            sql += ` AND s.department = $${params.length}`;
        }
        const source = await pool.query(sql, params);

        let count = 0;
        const affectedStaff = new Set();
        for (const row of source.rows) {
            const dayIndex = fromDates.indexOf(row.date);
            if (dayIndex === -1) continue;
            const targetDate = toDates[dayIndex];
            await pool.query(
                `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (staff_id, date)
                 DO UPDATE SET shift_start=$3, shift_end=$4, status=$5, note=$6`,
                [row.staff_id, targetDate, row.shift_start, row.shift_end, row.status, row.note]
            );
            affectedStaff.add(row.staff_id);
            count++;
        }
        // Fire-and-forget notification
        if (count > 0) notifyBulkScheduleChange(affectedStaff, count);
        res.json({ success: true, count });
    } catch (err) {
        log.error('POST /staff/schedule/copy-week error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

/**
 * GET /api/staff/schedule/hours — calculate worked hours for a date range
 * LLM HINT: ?from=2026-02-01&to=2026-02-28 → returns { staffId: { name, hours, days } }
 */
router.get('/schedule/hours', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            return res.status(400).json({ success: false, error: 'Потрібні параметри from та to' });
        }
        const result = await pool.query(
            `SELECT ss.staff_id, s.name, s.department, s.position,
                    ss.shift_start, ss.shift_end, ss.status
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             WHERE ss.date >= $1 AND ss.date <= $2 AND s.is_active = true
             ORDER BY s.department, s.name`,
            [from, to]
        );

        const stats = {};
        for (const row of result.rows) {
            if (!stats[row.staff_id]) {
                stats[row.staff_id] = {
                    name: row.name, department: row.department, position: row.position,
                    totalHours: 0, workingDays: 0, dayoffs: 0, vacationDays: 0, sickDays: 0, remoteDays: 0
                };
            }
            const s = stats[row.staff_id];
            if ((row.status === 'working' || row.status === 'remote') && row.shift_start && row.shift_end) {
                const [sh, sm] = row.shift_start.split(':').map(Number);
                const [eh, em] = row.shift_end.split(':').map(Number);
                let hours = (eh * 60 + em - sh * 60 - sm) / 60;
                if (hours < 0) hours += 24; // night shift
                s.totalHours += hours;
                if (row.status === 'remote') s.remoteDays++;
                else s.workingDays++;
            } else if (row.status === 'dayoff') s.dayoffs++;
            else if (row.status === 'vacation') s.vacationDays++;
            else if (row.status === 'sick') s.sickDays++;
            else if (row.status === 'remote') s.remoteDays++;
        }

        // Round hours
        for (const id of Object.keys(stats)) {
            stats[id].totalHours = Math.round(stats[id].totalHours * 10) / 10;
        }

        res.json({ success: true, data: stats });
    } catch (err) {
        log.error('GET /staff/schedule/hours error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

/**
 * GET /api/staff/schedule/check/:date — check which animators are available on a date
 * LLM HINT: Used by timeline to warn if an animator is off/sick/vacation.
 * Returns { available: [...staffIds], unavailable: [{id, name, status}] }
 */
router.get('/schedule/check/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const result = await pool.query(
            `SELECT ss.staff_id, ss.status, ss.shift_start, ss.shift_end, s.name, s.department
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             WHERE ss.date = $1 AND s.department = 'animators' AND s.is_active = true`,
            [date]
        );
        const available = [];
        const unavailable = [];
        for (const row of result.rows) {
            if (row.status === 'working') {
                available.push({ id: row.staff_id, name: row.name, shiftStart: row.shift_start, shiftEnd: row.shift_end });
            } else if (row.status === 'remote') {
                available.push({ id: row.staff_id, name: row.name, shiftStart: row.shift_start, shiftEnd: row.shift_end, remote: true });
            } else {
                unavailable.push({ id: row.staff_id, name: row.name, status: row.status });
            }
        }
        res.json({ success: true, available, unavailable });
    } catch (err) {
        log.error('GET /staff/schedule/check error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// STAFF CRUD (/:id routes AFTER /schedule to avoid param capture)
// ==========================================

// GET /api/staff — list all staff (optionally filter by department)
router.get('/', async (req, res) => {
    try {
        const { department, active } = req.query;
        let sql = 'SELECT * FROM staff';
        const params = [];
        const conditions = [];

        if (department) {
            params.push(department);
            conditions.push(`department = $${params.length}`);
        }
        if (active !== undefined) {
            params.push(active === 'true');
            conditions.push(`is_active = $${params.length}`);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY department, name';

        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows, departments: DEPARTMENTS });
    } catch (err) {
        log.error('GET /staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/staff — create new employee
// LLM HINT: telegramUsername is optional — used for @-mentions in schedule notifications
router.post('/', requireRole('creator', 'director', 'vice_director', 'senior_manager', 'hr'), async (req, res) => {
    try {
        const { name, department, position, phone, hireDate, color, telegramUsername } = req.body;
        if (!name || !department || !position) {
            return res.status(400).json({ success: false, error: 'Обов\'язкові поля: ім\'я, відділ, посада' });
        }
        const result = await pool.query(
            `INSERT INTO staff (name, department, position, phone, hire_date, color, telegram_username)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, department, position, phone || null, hireDate || null, color || null, telegramUsername || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/staff/:id — update employee
// LLM HINT: telegramUsername — set to Telegram @username (without @) for schedule notifications
router.put('/:id', requireRole('creator', 'director', 'vice_director', 'senior_manager', 'hr'), async (req, res) => {
    try {
        const { name, department, position, phone, hireDate, color, isActive, telegramUsername } = req.body;
        // Only update telegram_username if explicitly passed (even empty string clears it)
        const tgUser = telegramUsername !== undefined ? (telegramUsername || null) : undefined;
        const result = await pool.query(
            `UPDATE staff SET name=COALESCE($1,name), department=COALESCE($2,department),
             position=COALESCE($3,position), phone=$4, hire_date=$5, color=$6,
             is_active=COALESCE($7,is_active),
             telegram_username = CASE WHEN $9::boolean THEN $10 ELSE telegram_username END
             WHERE id=$8 RETURNING *`,
            [name, department, position, phone || null, hireDate || null, color || null, isActive, req.params.id,
             telegramUsername !== undefined, tgUser]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/staff/:id — remove employee
router.delete('/:id', requireRole('creator', 'director'), async (req, res) => {
    try {
        await pool.query('DELETE FROM staff WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// FACE RECOGNITION CHECK-IN (v22.18)
// ==========================================

// GET /api/staff/face-descriptors — all registered face descriptors
router.get('/face-descriptors', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT sfd.staff_id, s.name, sfd.descriptor
            FROM staff_face_descriptors sfd
            JOIN staff s ON s.id = sfd.staff_id
            WHERE s.is_active = true
        `);
        res.json(result.rows.map(r => ({
            staffId: r.staff_id,
            name: r.name,
            descriptor: r.descriptor
        })));
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json([]);
        log.error('GET /face-descriptors error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/staff/:id/face-descriptor — register face descriptor for staff
router.post('/:id/face-descriptor', async (req, res) => {
    try {
        const staffId = parseInt(req.params.id);
        const { descriptor } = req.body;
        if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
            return res.status(400).json({ error: 'Invalid descriptor (expected 128-float array)' });
        }
        await pool.query(
            `INSERT INTO staff_face_descriptors (staff_id, descriptor)
             VALUES ($1, $2)
             ON CONFLICT (staff_id) DO UPDATE SET descriptor = $2`,
            [staffId, JSON.stringify(descriptor)]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('POST /face-descriptor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/staff/checkin — record face-based check-in
router.post('/checkin', async (req, res) => {
    try {
        const { staffId, method } = req.body;
        if (!staffId) return res.status(400).json({ error: 'staffId required' });

        const result = await pool.query(
            `INSERT INTO staff_checkins (staff_id, date, check_in, method)
             VALUES ($1, CURRENT_DATE, NOW(), $2)
             ON CONFLICT (staff_id, date) DO UPDATE SET check_in = COALESCE(staff_checkins.check_in, NOW())
             RETURNING *`,
            [staffId, method || 'face']
        );
        const staff = await pool.query('SELECT name FROM staff WHERE id = $1', [staffId]);
        const name = staff.rows[0]?.name || 'Unknown';
        log.info(`Check-in: ${name} (staff #${staffId}) via ${method || 'face'}`);
        res.json({ success: true, checkin: result.rows[0], staffName: name });
    } catch (err) {
        log.error('POST /checkin error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/staff/checkout — record check-out
router.post('/checkout', async (req, res) => {
    try {
        const { staffId } = req.body;
        if (!staffId) return res.status(400).json({ error: 'staffId required' });

        const result = await pool.query(
            `UPDATE staff_checkins SET check_out = NOW()
             WHERE staff_id = $1 AND date = CURRENT_DATE
             RETURNING *`,
            [staffId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No check-in found for today' });
        }
        res.json({ success: true, checkin: result.rows[0] });
    } catch (err) {
        log.error('POST /checkout error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/staff/checkins — today's check-ins
router.get('/checkins', async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const result = await pool.query(`
            SELECT sc.*, s.name AS staff_name
            FROM staff_checkins sc
            JOIN staff s ON s.id = sc.staff_id
            WHERE sc.date = $1
            ORDER BY sc.check_in
        `, [date]);
        res.json(result.rows);
    } catch (err) {
        if (err.message.includes('does not exist')) return res.json([]);
        log.error('GET /checkins error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
