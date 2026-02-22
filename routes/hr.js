/**
 * routes/hr.js — HR module API (v15.0)
 *
 * Endpoints: staff HR data, shifts, clock-in/out, time records, reports, templates
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { getKyivDate, getKyivDateStr } = require('../services/booking');

const log = createLogger('HR');

// Helper: get today's date in Kyiv timezone as YYYY-MM-DD
function todayKyiv() {
    return getKyivDateStr();
}

// Helper: get current Kyiv time as Date object
function nowKyiv() {
    return getKyivDate();
}

// Helper: time string "HH:MM" to minutes since midnight
function timeToMin(t) {
    if (!t) return 0;
    const s = typeof t === 'string' ? t : t.toString();
    const parts = s.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// Helper: minutes diff between now (Kyiv) and a TIME value on today
function minutesSincePlannedStart(plannedStart) {
    const now = nowKyiv();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return nowMin - timeToMin(plannedStart);
}

// Helper: audit log entry
async function auditLog(action, staffId, performedBy, details, ipAddress) {
    try {
        await pool.query(
            `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
             VALUES ($1, $2, $3, $4, $5)`,
            [action, staffId, performedBy, details ? JSON.stringify(details) : null, ipAddress]
        );
    } catch (err) {
        log.error('Audit log error', err);
    }
}

// ==========================================
// STAFF HR DATA
// ==========================================

// GET /api/hr/staff — list all staff with HR fields
router.get('/staff', async (req, res) => {
    try {
        const { active, role_type } = req.query;
        let sql = `SELECT id, name, department, position, phone, emergency_contact, emergency_phone,
                    role_type, hire_date, birth_date, is_active, hourly_rate, photo_url, notes,
                    telegram_id, telegram_username, color
                    FROM staff`;
        const params = [];
        const conds = [];
        if (active !== undefined) {
            params.push(active === 'true');
            conds.push(`is_active = $${params.length}`);
        }
        if (role_type) {
            params.push(role_type);
            conds.push(`role_type = $${params.length}`);
        }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ' ORDER BY name';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/staff/:id — full profile
router.get('/staff/:id', async (req, res) => {
    try {
        const staff = await pool.query(
            `SELECT id, name, department, position, phone, emergency_contact, emergency_phone,
                    role_type, hire_date, birth_date, is_active, hourly_rate, photo_url, notes,
                    telegram_id, telegram_username, color
             FROM staff WHERE id = $1`, [req.params.id]
        );
        if (staff.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        res.json({ success: true, data: staff.rows[0] });
    } catch (err) {
        log.error('GET /hr/staff/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/staff/:id — update HR fields
router.put('/staff/:id', async (req, res) => {
    try {
        const { phone, emergency_contact, emergency_phone, role_type, hourly_rate, birth_date, notes, telegram_id } = req.body;
        const result = await pool.query(
            `UPDATE staff SET
                phone = COALESCE($1, phone),
                emergency_contact = COALESCE($2, emergency_contact),
                emergency_phone = COALESCE($3, emergency_phone),
                role_type = COALESCE($4, role_type),
                hourly_rate = COALESCE($5, hourly_rate),
                birth_date = COALESCE($6, birth_date),
                notes = COALESCE($7, notes),
                telegram_id = COALESCE($8, telegram_id)
             WHERE id = $9 RETURNING *`,
            [phone, emergency_contact, emergency_phone, role_type, hourly_rate, birth_date, notes, telegram_id, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('staff_update', parseInt(req.params.id), req.user?.username, req.body, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/staff/:id/status — activate/deactivate
router.put('/staff/:id/status', async (req, res) => {
    try {
        const { is_active } = req.body;
        const result = await pool.query(
            'UPDATE staff SET is_active = $1 WHERE id = $2 RETURNING *',
            [is_active, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('status_change', parseInt(req.params.id), req.user?.username, { is_active }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/staff/:id/status error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// SHIFT TEMPLATES
// ==========================================

router.get('/shift-templates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hr_shift_templates ORDER BY is_default DESC, name');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.post('/shift-templates', async (req, res) => {
    try {
        const { name, planned_start, planned_end, break_minutes, shift_type } = req.body;
        if (!name || !planned_start || !planned_end) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: name, planned_start, planned_end' });
        }
        const result = await pool.query(
            `INSERT INTO hr_shift_templates (name, planned_start, planned_end, break_minutes, shift_type)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name, planned_start, planned_end, break_minutes || 0, shift_type || 'regular']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

router.delete('/shift-templates/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM hr_shift_templates WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/shift-templates error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// SHIFTS (SCHEDULE)
// ==========================================

// GET /api/hr/shifts — query by week/month/range
router.get('/shifts', async (req, res) => {
    try {
        const { week, month, from, to, staff_id } = req.query;
        let dateFrom, dateTo;

        if (week) {
            const d = new Date(week);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            dateFrom = new Date(d.setDate(diff)).toISOString().split('T')[0];
            dateTo = new Date(new Date(dateFrom).setDate(new Date(dateFrom).getDate() + 6)).toISOString().split('T')[0];
        } else if (month) {
            dateFrom = `${month}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        } else if (from && to) {
            dateFrom = from;
            dateTo = to;
        } else {
            // Default: current week
            const now = nowKyiv();
            const day = now.getDay();
            const diff = now.getDate() - day + (day === 0 ? -6 : 1);
            const mon = new Date(now);
            mon.setDate(diff);
            dateFrom = mon.toISOString().split('T')[0];
            dateTo = new Date(mon.setDate(mon.getDate() + 6)).toISOString().split('T')[0];
        }

        let sql = `SELECT hs.*, s.name AS staff_name, s.color AS staff_color, s.role_type
                    FROM hr_shifts hs
                    JOIN staff s ON s.id = hs.staff_id
                    WHERE hs.shift_date >= $1 AND hs.shift_date <= $2`;
        const params = [dateFrom, dateTo];

        if (staff_id) {
            params.push(parseInt(staff_id));
            sql += ` AND hs.staff_id = $${params.length}`;
        }

        sql += ' ORDER BY s.name, hs.shift_date';
        const result = await pool.query(sql, params);
        res.json({ success: true, data: result.rows, dateFrom, dateTo });
    } catch (err) {
        log.error('GET /hr/shifts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts — create single shift
router.post('/shifts', async (req, res) => {
    try {
        const { staff_id, shift_date, planned_start, planned_end, shift_type, break_minutes, notes } = req.body;
        if (!staff_id || !shift_date || !planned_start || !planned_end) {
            return res.status(400).json({ success: false, error: 'Обовʼязкові: staff_id, shift_date, planned_start, planned_end' });
        }
        const result = await pool.query(
            `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, shift_type, break_minutes, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                shift_type = EXCLUDED.shift_type, break_minutes = EXCLUDED.break_minutes,
                notes = EXCLUDED.notes, updated_at = NOW()
             RETURNING *`,
            [staff_id, shift_date, planned_start, planned_end, shift_type || 'regular', break_minutes || 0, notes, req.user?.username]
        );
        await auditLog('shift_create', staff_id, req.user?.username, { shift_date, planned_start, planned_end }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/shifts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/hr/shifts/:id — update shift
router.put('/shifts/:id', async (req, res) => {
    try {
        const { planned_start, planned_end, shift_type, break_minutes, notes } = req.body;
        const result = await pool.query(
            `UPDATE hr_shifts SET
                planned_start = COALESCE($1, planned_start),
                planned_end = COALESCE($2, planned_end),
                shift_type = COALESCE($3, shift_type),
                break_minutes = COALESCE($4, break_minutes),
                notes = COALESCE($5, notes),
                updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [planned_start, planned_end, shift_type, break_minutes, notes, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await auditLog('shift_update', result.rows[0].staff_id, req.user?.username, req.body, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/shifts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// DELETE /api/hr/shifts/:id
router.delete('/shifts/:id', async (req, res) => {
    try {
        const existing = await pool.query('SELECT * FROM hr_shifts WHERE id = $1', [req.params.id]);
        if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });
        await pool.query('DELETE FROM hr_shifts WHERE id = $1', [req.params.id]);
        await auditLog('shift_delete', existing.rows[0].staff_id, req.user?.username,
            { shift_date: existing.rows[0].shift_date }, req.ip);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /hr/shifts/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts/bulk — mass create from template
router.post('/shifts/bulk', async (req, res) => {
    try {
        const { staff_ids, dates, template_id, planned_start, planned_end, break_minutes, shift_type } = req.body;
        if (!staff_ids || !dates || (!template_id && !planned_start)) {
            return res.status(400).json({ success: false, error: 'Потрібні staff_ids, dates та template_id або planned_start/planned_end' });
        }

        let start = planned_start, end = planned_end, brk = break_minutes || 0, stype = shift_type || 'regular';
        if (template_id) {
            const tpl = await pool.query('SELECT * FROM hr_shift_templates WHERE id = $1', [template_id]);
            if (tpl.rows.length === 0) return res.status(404).json({ success: false, error: 'Шаблон не знайдено' });
            start = tpl.rows[0].planned_start;
            end = tpl.rows[0].planned_end;
            brk = tpl.rows[0].break_minutes;
            stype = tpl.rows[0].shift_type;
        }

        let count = 0;
        for (const sid of staff_ids) {
            for (const d of dates) {
                await pool.query(
                    `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, break_minutes, shift_type, created_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                        planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                        break_minutes = EXCLUDED.break_minutes, shift_type = EXCLUDED.shift_type, updated_at = NOW()`,
                    [sid, d, start, end, brk, stype, req.user?.username]
                );
                count++;
            }
        }
        await auditLog('shift_bulk', null, req.user?.username, { staff_ids, dates, count }, req.ip);
        res.json({ success: true, count });
    } catch (err) {
        log.error('POST /hr/shifts/bulk error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/shifts/copy-week
router.post('/shifts/copy-week', async (req, res) => {
    try {
        const { source_week, target_week } = req.body;
        if (!source_week || !target_week) {
            return res.status(400).json({ success: false, error: 'Потрібні source_week і target_week' });
        }

        const srcMon = new Date(source_week);
        const tgtMon = new Date(target_week);
        const srcDates = [];
        const tgtDates = [];
        for (let i = 0; i < 7; i++) {
            const s = new Date(srcMon); s.setDate(srcMon.getDate() + i);
            const t = new Date(tgtMon); t.setDate(tgtMon.getDate() + i);
            srcDates.push(s.toISOString().split('T')[0]);
            tgtDates.push(t.toISOString().split('T')[0]);
        }

        const source = await pool.query(
            `SELECT hs.* FROM hr_shifts hs
             JOIN staff s ON s.id = hs.staff_id
             WHERE hs.shift_date >= $1 AND hs.shift_date <= $2 AND s.is_active = true`,
            [srcDates[0], srcDates[6]]
        );

        let count = 0;
        for (const row of source.rows) {
            const dayIndex = srcDates.indexOf(row.shift_date instanceof Date ? row.shift_date.toISOString().split('T')[0] : row.shift_date);
            if (dayIndex === -1) continue;
            await pool.query(
                `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, break_minutes, shift_type, notes, created_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                    planned_start = EXCLUDED.planned_start, planned_end = EXCLUDED.planned_end,
                    break_minutes = EXCLUDED.break_minutes, shift_type = EXCLUDED.shift_type, updated_at = NOW()`,
                [row.staff_id, tgtDates[dayIndex], row.planned_start, row.planned_end, row.break_minutes, row.shift_type, row.notes, req.user?.username]
            );
            count++;
        }
        await auditLog('shift_copy_week', null, req.user?.username, { source_week, target_week, count }, req.ip);
        res.json({ success: true, count });
    } catch (err) {
        log.error('POST /hr/shifts/copy-week error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CLOCK IN / CLOCK OUT
// ==========================================

// GET /api/hr/today — dashboard
router.get('/today', async (req, res) => {
    try {
        const today = todayKyiv();
        const staff = await pool.query(
            `SELECT id, name, color, role_type, photo_url FROM staff WHERE is_active = true ORDER BY name`
        );

        const shifts = await pool.query(
            'SELECT * FROM hr_shifts WHERE shift_date = $1', [today]
        );
        const shiftMap = {};
        for (const s of shifts.rows) shiftMap[s.staff_id] = s;

        const records = await pool.query(
            'SELECT * FROM hr_time_records WHERE record_date = $1', [today]
        );
        const recordMap = {};
        for (const r of records.rows) recordMap[r.staff_id] = r;

        let present = 0, late = 0, absent = 0, onVacation = 0, sick = 0;
        const data = staff.rows.map(s => {
            const shift = shiftMap[s.id] || null;
            const record = recordMap[s.id] || null;

            if (record) {
                if (record.status === 'late' || record.status === 'present' || record.status === 'clocked_in') present++;
                else if (record.status === 'vacation') onVacation++;
                else if (record.status === 'sick') sick++;
                else if (record.status === 'early_leave' || record.status === 'auto_closed') present++;
                if (record.status === 'late') late++;
            } else if (shift) {
                absent++;
            }

            return {
                staff_id: s.id,
                staff_name: s.name,
                staff_color: s.color,
                role_type: s.role_type,
                photo_url: s.photo_url,
                shift: shift ? { planned_start: shift.planned_start, planned_end: shift.planned_end, shift_type: shift.shift_type } : null,
                record: record ? {
                    id: record.id,
                    clock_in: record.clock_in,
                    clock_out: record.clock_out,
                    status: record.status,
                    late_minutes: record.late_minutes,
                    early_leave_minutes: record.early_leave_minutes,
                    overtime_minutes: record.overtime_minutes,
                    total_worked_minutes: record.total_worked_minutes,
                    auto_closed: record.auto_closed
                } : null
            };
        });

        res.json({
            success: true,
            date: today,
            data,
            summary: { total_staff: staff.rows.length, present, late, absent, on_vacation: onVacation, sick }
        });
    } catch (err) {
        log.error('GET /hr/today error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/clock-in
router.post('/clock-in', async (req, res) => {
    try {
        const { staff_id } = req.body;
        if (!staff_id) return res.status(400).json({ success: false, error: 'Потрібен staff_id' });

        const today = todayKyiv();
        const now = nowKyiv();

        // Check existing
        const existing = await pool.query(
            'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2', [staff_id, today]
        );
        if (existing.rows.length > 0 && existing.rows[0].clock_in) {
            return res.status(409).json({ success: false, error: 'Вже відмічений сьогодні' });
        }

        // Find planned shift
        const shift = await pool.query(
            'SELECT * FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2', [staff_id, today]
        );
        const hasShift = shift.rows.length > 0;
        let plannedStart = null, plannedEnd = null, lateMin = 0, status = 'unscheduled';

        if (hasShift) {
            plannedStart = shift.rows[0].planned_start;
            plannedEnd = shift.rows[0].planned_end;
            const diff = minutesSincePlannedStart(plannedStart);
            lateMin = Math.max(0, diff);
            status = lateMin > 5 ? 'late' : 'present';
        }

        const clockIn = new Date().toISOString();

        let result;
        if (existing.rows.length > 0) {
            // Update existing absent record
            result = await pool.query(
                `UPDATE hr_time_records SET
                    clock_in = $1, planned_start = $2, planned_end = $3,
                    late_minutes = $4, status = $5, ip_address = $6, user_agent = $7, updated_at = NOW()
                 WHERE id = $8 RETURNING *`,
                [clockIn, plannedStart, plannedEnd, lateMin, status, req.ip, req.headers['user-agent'], existing.rows[0].id]
            );
        } else {
            result = await pool.query(
                `INSERT INTO hr_time_records (staff_id, record_date, clock_in, planned_start, planned_end, late_minutes, status, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [staff_id, today, clockIn, plannedStart, plannedEnd, lateMin, status, req.ip, req.headers['user-agent']]
            );
        }

        await auditLog('clock_in', staff_id, req.user?.username, { clock_in: clockIn, late_minutes: lateMin, status }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/clock-in error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/clock-out
router.post('/clock-out', async (req, res) => {
    try {
        const { staff_id } = req.body;
        if (!staff_id) return res.status(400).json({ success: false, error: 'Потрібен staff_id' });

        const today = todayKyiv();
        const record = await pool.query(
            'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2', [staff_id, today]
        );
        if (record.rows.length === 0 || !record.rows[0].clock_in) {
            return res.status(400).json({ success: false, error: 'Спочатку відмітьте прихід' });
        }
        if (record.rows[0].clock_out) {
            return res.status(409).json({ success: false, error: 'Вже завершено' });
        }

        const rec = record.rows[0];
        const clockOut = new Date().toISOString();
        const clockInDate = new Date(rec.clock_in);
        const clockOutDate = new Date(clockOut);

        // Get break from shift
        let breakMin = 0;
        const shift = await pool.query(
            'SELECT break_minutes FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2', [staff_id, today]
        );
        if (shift.rows.length > 0) breakMin = shift.rows[0].break_minutes || 0;

        const totalWorked = Math.round((clockOutDate - clockInDate) / 60000) - breakMin;
        let earlyLeave = 0, overtime = 0;
        let status = rec.status;

        if (rec.planned_end) {
            const now = nowKyiv();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const plannedEndMin = timeToMin(rec.planned_end);
            const diff = plannedEndMin - nowMin;

            if (diff > 15) {
                earlyLeave = diff;
                status = 'early_leave';
            } else if (diff < -15) {
                overtime = Math.abs(diff);
            }
        }

        // Keep 'late' if was late
        if (rec.status === 'late' && status !== 'early_leave') status = 'late';
        if (status === 'present' || status === 'unscheduled' || status === 'clocked_in') status = 'present';

        const result = await pool.query(
            `UPDATE hr_time_records SET
                clock_out = $1, total_worked_minutes = $2, early_leave_minutes = $3,
                overtime_minutes = $4, status = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [clockOut, Math.max(0, totalWorked), earlyLeave, overtime, status, rec.id]
        );

        await auditLog('clock_out', staff_id, req.user?.username,
            { clock_out: clockOut, total_worked_minutes: totalWorked, status }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/clock-out error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/hr/mark-absent — mark sick/vacation/day_off
router.post('/mark-absent', async (req, res) => {
    try {
        const { staff_id, status, notes } = req.body;
        if (!staff_id || !status) {
            return res.status(400).json({ success: false, error: 'Потрібні staff_id та status' });
        }
        const validStatuses = ['sick', 'vacation', 'day_off'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: 'Невалідний статус' });
        }

        const today = todayKyiv();
        const result = await pool.query(
            `INSERT INTO hr_time_records (staff_id, record_date, status, notes)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (staff_id, record_date) DO UPDATE SET status = $3, notes = $4, updated_at = NOW()
             RETURNING *`,
            [staff_id, today, status, notes]
        );

        await auditLog('mark_absent', staff_id, req.user?.username, { status, notes }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /hr/mark-absent error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// CORRECTION (admin only)
// ==========================================

router.put('/records/:id/correct', async (req, res) => {
    try {
        const { clock_in, clock_out, notes } = req.body;
        const rec = await pool.query('SELECT * FROM hr_time_records WHERE id = $1', [req.params.id]);
        if (rec.rows.length === 0) return res.status(404).json({ success: false, error: 'Не знайдено' });

        const original = rec.rows[0];
        const newClockIn = clock_in ? new Date(clock_in).toISOString() : original.clock_in;
        const newClockOut = clock_out ? new Date(clock_out).toISOString() : original.clock_out;

        // Recalculate
        let totalWorked = 0, lateMin = 0, earlyLeave = 0, overtime = 0;
        if (newClockIn && newClockOut) {
            let breakMin = 0;
            const shift = await pool.query(
                'SELECT break_minutes FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2',
                [original.staff_id, original.record_date]
            );
            if (shift.rows.length > 0) breakMin = shift.rows[0].break_minutes || 0;
            totalWorked = Math.max(0, Math.round((new Date(newClockOut) - new Date(newClockIn)) / 60000) - breakMin);
        }

        if (original.planned_start && newClockIn) {
            const ciDate = new Date(newClockIn);
            const ciMin = ciDate.getHours() * 60 + ciDate.getMinutes();
            lateMin = Math.max(0, ciMin - timeToMin(original.planned_start));
        }

        if (original.planned_end && newClockOut) {
            const coDate = new Date(newClockOut);
            const coMin = coDate.getHours() * 60 + coDate.getMinutes();
            const plannedEndMin = timeToMin(original.planned_end);
            if (plannedEndMin - coMin > 15) earlyLeave = plannedEndMin - coMin;
            if (coMin - plannedEndMin > 15) overtime = coMin - plannedEndMin;
        }

        let status = lateMin > 5 ? 'late' : 'present';
        if (earlyLeave > 0) status = 'early_leave';

        const result = await pool.query(
            `UPDATE hr_time_records SET
                clock_in = $1, clock_out = $2,
                total_worked_minutes = $3, late_minutes = $4, early_leave_minutes = $5, overtime_minutes = $6,
                status = $7,
                original_clock_in = COALESCE(original_clock_in, $8),
                original_clock_out = COALESCE(original_clock_out, $9),
                corrected_by = $10, corrected_at = NOW(), correction_reason = $11,
                updated_at = NOW()
             WHERE id = $12 RETURNING *`,
            [newClockIn, newClockOut, totalWorked, lateMin, earlyLeave, overtime, status,
             original.clock_in, original.clock_out, req.user?.username, notes, req.params.id]
        );

        await auditLog('correction', original.staff_id, req.user?.username,
            { old_clock_in: original.clock_in, old_clock_out: original.clock_out, new_clock_in: newClockIn, new_clock_out: newClockOut, notes }, req.ip);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /hr/records/:id/correct error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ==========================================
// REPORTS
// ==========================================

// GET /api/hr/report/monthly
router.get('/report/monthly', async (req, res) => {
    try {
        const { month, from, to } = req.query;
        let dateFrom, dateTo;

        if (month) {
            dateFrom = `${month}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        } else if (from && to) {
            dateFrom = from;
            dateTo = to;
        } else {
            // Default: current month
            const now = nowKyiv();
            const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
            dateFrom = `${y}-${m}-01`;
            const d = new Date(dateFrom);
            d.setMonth(d.getMonth() + 1);
            d.setDate(0);
            dateTo = d.toISOString().split('T')[0];
        }

        const staffList = await pool.query(
            'SELECT id, name, role_type, hourly_rate FROM staff WHERE is_active = true ORDER BY name'
        );

        const shifts = await pool.query(
            'SELECT staff_id, COUNT(*) AS cnt FROM hr_shifts WHERE shift_date >= $1 AND shift_date <= $2 GROUP BY staff_id',
            [dateFrom, dateTo]
        );
        const shiftCounts = {};
        for (const r of shifts.rows) shiftCounts[r.staff_id] = parseInt(r.cnt);

        const records = await pool.query(
            `SELECT staff_id, status, late_minutes, early_leave_minutes, overtime_minutes, total_worked_minutes
             FROM hr_time_records WHERE record_date >= $1 AND record_date <= $2`,
            [dateFrom, dateTo]
        );

        const statsMap = {};
        for (const r of records.rows) {
            if (!statsMap[r.staff_id]) {
                statsMap[r.staff_id] = {
                    days_worked: 0, days_late: 0, days_early_leave: 0, days_absent: 0,
                    days_sick: 0, days_vacation: 0,
                    total_worked_minutes: 0, total_overtime_minutes: 0,
                    late_count: 0, total_late_minutes: 0
                };
            }
            const s = statsMap[r.staff_id];
            if (['present', 'late', 'early_leave', 'auto_closed', 'unscheduled'].includes(r.status)) {
                s.days_worked++;
                s.total_worked_minutes += r.total_worked_minutes || 0;
                s.total_overtime_minutes += r.overtime_minutes || 0;
            }
            if (r.status === 'late') { s.days_late++; s.late_count++; s.total_late_minutes += r.late_minutes || 0; }
            if (r.status === 'early_leave') s.days_early_leave++;
            if (r.status === 'absent' || r.status === 'no_show') s.days_absent++;
            if (r.status === 'sick') s.days_sick++;
            if (r.status === 'vacation') s.days_vacation++;
        }

        const data = staffList.rows.map(st => {
            const s = statsMap[st.id] || {
                days_worked: 0, days_late: 0, days_early_leave: 0, days_absent: 0,
                days_sick: 0, days_vacation: 0, total_worked_minutes: 0, total_overtime_minutes: 0,
                late_count: 0, total_late_minutes: 0
            };
            const daysScheduled = shiftCounts[st.id] || 0;
            const totalWorkedHours = Math.round(s.total_worked_minutes / 60 * 10) / 10;
            const totalOvertimeHours = Math.round(s.total_overtime_minutes / 60 * 10) / 10;
            const rate = parseFloat(st.hourly_rate) || 0;

            return {
                staff_id: st.id,
                staff_name: st.name,
                role_type: st.role_type,
                hourly_rate: rate,
                days_scheduled: daysScheduled,
                days_worked: s.days_worked,
                days_late: s.days_late,
                days_early_leave: s.days_early_leave,
                days_absent: s.days_absent,
                days_sick: s.days_sick,
                days_vacation: s.days_vacation,
                total_worked_hours: totalWorkedHours,
                total_overtime_hours: totalOvertimeHours,
                estimated_salary: Math.round(totalWorkedHours * rate),
                late_count: s.late_count,
                avg_late_minutes: s.late_count > 0 ? Math.round(s.total_late_minutes / s.late_count) : 0,
                attendance_rate: daysScheduled > 0 ? Math.round(s.days_worked / daysScheduled * 100) : 0
            };
        });

        res.json({ success: true, data, dateFrom, dateTo });
    } catch (err) {
        log.error('GET /hr/report/monthly error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/report/daily
router.get('/report/daily', async (req, res) => {
    try {
        const date = req.query.date || todayKyiv();
        const result = await pool.query(
            `SELECT tr.*, s.name AS staff_name, s.role_type, s.color,
                    hs.planned_start AS shift_start, hs.planned_end AS shift_end
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date
             WHERE tr.record_date = $1 ORDER BY s.name`, [date]
        );
        res.json({ success: true, data: result.rows, date });
    } catch (err) {
        log.error('GET /hr/report/daily error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// GET /api/hr/report/export — CSV export
router.get('/report/export', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ success: false, error: 'Потрібні from та to' });

        const result = await pool.query(
            `SELECT s.name, tr.record_date, tr.clock_in, tr.clock_out,
                    tr.planned_start, tr.planned_end,
                    tr.total_worked_minutes, tr.late_minutes, tr.early_leave_minutes, tr.overtime_minutes,
                    s.hourly_rate
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             WHERE tr.record_date >= $1 AND tr.record_date <= $2
             ORDER BY s.name, tr.record_date`,
            [from, to]
        );

        const header = 'ПІБ;Дата;Прихід;Відхід;Заплановано початок;Заплановано кінець;Відпрацьовано хв;Запізнення хв;Рано пішов хв;Переробка хв;Ставка;Сума\n';
        const rows = result.rows.map(r => {
            const ci = r.clock_in ? new Date(r.clock_in).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
            const co = r.clock_out ? new Date(r.clock_out).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }) : '';
            const workedH = ((r.total_worked_minutes || 0) / 60).toFixed(1);
            const rate = parseFloat(r.hourly_rate) || 0;
            const salary = (parseFloat(workedH) * rate).toFixed(0);
            return `${r.name};${r.record_date};${ci};${co};${r.planned_start || ''};${r.planned_end || ''};${r.total_worked_minutes || 0};${r.late_minutes || 0};${r.early_leave_minutes || 0};${r.overtime_minutes || 0};${rate};${salary}`;
        }).join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="hr_report_${from}_${to}.csv"`);
        res.send('\uFEFF' + header + rows);
    } catch (err) {
        log.error('GET /hr/report/export error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

module.exports = router;
