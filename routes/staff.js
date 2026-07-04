/**
 * routes/staff.js — Staff & schedule management API (v39.1)
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
const bcrypt = require('bcryptjs');
const { recordAccountSecurityEvent } = require('../services/accountSecurity');
const { broadcast } = require('../services/websocket');
const { getKyivDate, getKyivDateStr } = require('../services/booking');
const { DEFAULT_BUSINESS_CONTEXT } = require('../services/businessContext');
const { calculateHrClockOutPayroll } = require('../services/hrAttendance');
const {
    normalizeProfessionKey,
    normalizeSecondaryProfessions,
    resolveStaffProfessionAssignment
} = require('../services/professions');
const {
    activeStaffWhere,
    scheduleableStaffErrorPayload,
    scheduleableStaffWhere,
    validateStaffScheduleableForDate
} = require('../services/staffOperationalFilters');
const {
    buildStaffDisplayGroupOptions,
    decorateStaffRowsWithDisplayGroups,
    listStaffDisplayGroups
} = require('../services/staffDisplayGroups');
const {
    cleanupFutureStaffOperationalSchedule,
    syncLinkedStaffAccountDeactivation
} = require('../services/staffLifecycle');
const {
    linkUserToStaffProfile,
    unlinkStaffAccount,
    generateOneTimePassword,
    oneTimeCredential,
    suggestUsernameForStaff,
    uniqueUsername,
    verifyIssuedCredential
} = require('../services/accountLinking');

const { requireAction, requireRole, authenticateToken, ROLE_LEVEL } = require('../middleware/auth');
const log = createLogger('Staff');

// v39.8: Security — require authentication for all staff endpoints
router.use(authenticateToken);

const ACCOUNT_MANAGER_PRIMARY_ROLES = new Set(['creator', 'director']);
const STAFF_COPY_WEEK_RAW_DEPARTMENT_ALLOWLIST = new Set(['animators', 'trampoline', 'cafe', 'cleaning']);
const STAFF_COPY_WEEK_MAX_STAFF_IDS = 500;
const STAFF_ATTENDANCE_READ_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin', 'accountant'];
const STAFF_PAYROLL_READ_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'hr', 'accountant'];

function normalizeStaffRateUnit(value) {
    const unit = String(value || '').trim().toLowerCase();
    if (['day', 'daily', 'per_day', 'per-day'].includes(unit)) return 'day';
    if (['month', 'monthly', 'per_month', 'per-month'].includes(unit)) return 'month';
    return 'hour';
}

function roleLevel(role) {
    return ROLE_LEVEL[String(role || '').trim()] ?? -1;
}

function normalizeAccountRoleSet(...roleLists) {
    const roles = [];
    roleLists.flat().forEach(role => {
        if (typeof role !== 'string') return;
        const value = role.trim();
        if (value && !roles.includes(value)) roles.push(value);
    });
    return roles;
}

function accountMaxRoleLevel(account = {}) {
    return normalizeAccountRoleSet([account.role], account.extra_roles, account.extraRoles)
        .reduce((max, role) => Math.max(max, roleLevel(role)), -1);
}

function canActorManageAccountRoleSet(actor, primaryRole, extraRoles = []) {
    if (!actor || !ACCOUNT_MANAGER_PRIMARY_ROLES.has(actor.role)) return false;
    if (actor.role === 'creator') return true;
    const maxTargetLevel = normalizeAccountRoleSet([primaryRole], extraRoles)
        .reduce((max, role) => Math.max(max, roleLevel(role)), -1);
    return maxTargetLevel >= 0 && maxTargetLevel < roleLevel('director');
}

function canActorManageAccount(actor, account) {
    if (!actor || !account || !ACCOUNT_MANAGER_PRIMARY_ROLES.has(actor.role)) return false;
    if (actor.role === 'creator') return true;
    return accountMaxRoleLevel(account) < roleLevel('director');
}

function accountManagementError(message, statusCode = 403) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

async function getAccountForManagement(client, userId) {
    const result = await client.query(
        'SELECT id, username, name, role, extra_roles FROM users WHERE id = $1 FOR UPDATE',
        [userId]
    );
    if (!result.rows.length) throw accountManagementError('Account not found', 404);
    return result.rows[0];
}

async function getLinkedAccountsForStaffManagement(client, staffId) {
    const result = await client.query(
        `SELECT u.id, u.username, u.name, u.role, u.extra_roles
         FROM employee_profiles ep
         JOIN users u ON u.id = ep.user_id
         WHERE ep.staff_id = $1
           AND ep.user_id IS NOT NULL
         ORDER BY ep.id
         FOR UPDATE OF ep, u`,
        [staffId]
    );
    return result.rows;
}

function ensureActorCanManageAccount(actor, account) {
    if (!canActorManageAccount(actor, account)) {
        throw accountManagementError('Insufficient account-management permissions for this account');
    }
}

function canDisableLinkedStaffAccount(actor, account) {
    return Number(account?.id) !== Number(actor?.id) && canActorManageAccount(actor, account);
}

function linkedStaffAccountBlockReason(actor, account = {}) {
    if (Number(account.id) === Number(actor?.id)) return 'current_user';
    if (!actor || !ACCOUNT_MANAGER_PRIMARY_ROLES.has(actor.role)) return 'requires_manage_accounts';
    if (!canActorManageAccount(actor, account)) return 'protected_role';
    return null;
}

function linkedStaffAccountMeta(row = {}, currentUserId = null) {
    const userId = Number(row.id);
    return {
        id: userId,
        username: row.username || '',
        name: row.name || '',
        role: row.role || '',
        profile_id: row.profile_id ? Number(row.profile_id) : null,
        is_current_user: Number.isFinite(Number(currentUserId)) && userId === Number(currentUserId)
    };
}

const STATUS_UK = { working: 'Робочий', dayoff: 'Вихідний', day_off: 'Вихідний', vacation: 'Відпустка', sick: 'Лікарняний', remote: 'Віддалено' };
const SCHEDULE_STATUS_VALUES = new Set(['working', 'remote', 'dayoff', 'vacation', 'sick']);

function activeOperationalStaffWhere(alias = 's', options = {}) {
    return activeStaffWhere(alias, {
        poolMode: 'not_blacklisted',
        includeFreelance: options.includeFreelance !== false,
        dateExpression: options.dateExpression
    });
}

function activeScheduleStaffWhere(alias = 's', dateExpression = 'CURRENT_DATE', options = {}) {
    return scheduleableStaffWhere(alias, {
        dateExpression,
        includeFreelance: options.includeFreelance === true
    });
}

function activeOperationalStaffForDateWhere(alias = 's') {
    return activeScheduleStaffWhere(alias, 'CURRENT_DATE');
}

async function rejectUnscheduleableStaff(res, client, validation, extra = {}) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(validation.status || 400).json(scheduleableStaffErrorPayload(validation, extra));
}

async function validateScheduleWriteStaff(client, staffId, date, options = {}) {
    return validateStaffScheduleableForDate(client, staffId, date, {
        ...options,
        forUpdate: options.forUpdate !== false
    });
}

function normalizeScheduleStatus(status, fallback = 'working') {
    const raw = String(status ?? fallback ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'day_off') return 'dayoff';
    return SCHEDULE_STATUS_VALUES.has(raw) ? raw : null;
}

function scheduleStatusNeedsProfession(status) {
    return ['working', 'remote'].includes(normalizeScheduleStatus(status, 'working'));
}

function scheduleProfessionFromPayload(payload = {}) {
    return normalizeProfessionKey(payload.profession_key ?? payload.professionKey ?? payload.role_type ?? payload.roleType);
}

async function resolveScheduleProfession(staffId, status, payload = {}, db = pool) {
    if (!scheduleStatusNeedsProfession(status)) return { ok: true, professionKey: null };
    return resolveStaffProfessionAssignment(db, staffId, scheduleProfessionFromPayload(payload));
}

function normalizeScheduleDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function normalizeCopyWeekStaffIds(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const ids = [];
    for (const item of value) {
        const id = Number(item);
        if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length > STAFF_COPY_WEEK_MAX_STAFF_IDS) break;
    }
    return ids;
}

function normalizeScheduleAuditEntry(entry = null) {
    if (!entry) return null;
    return {
        scheduleId: entry.id || null,
        staffId: Number(entry.staff_id ?? entry.staffId) || null,
        date: normalizeScheduleDate(entry.date),
        status: normalizeScheduleStatus(entry.status, null),
        shiftStart: entry.shift_start ? String(entry.shift_start).slice(0, 5) : null,
        shiftEnd: entry.shift_end ? String(entry.shift_end).slice(0, 5) : null,
        note: entry.note || null,
        professionKey: entry.profession_key || entry.professionKey || null,
        originalStaffId: entry.original_staff_id || null,
        replacementReason: entry.replacement_reason || null
    };
}

function scheduleAuditChanges(beforeEntry, afterEntry) {
    const before = beforeEntry || {};
    const after = afterEntry || {};
    const fields = ['status', 'shiftStart', 'shiftEnd', 'note', 'professionKey', 'originalStaffId', 'replacementReason'];
    return fields.reduce((changes, field) => {
        if ((before[field] ?? null) !== (after[field] ?? null)) {
            changes[field] = { from: before[field] ?? null, to: after[field] ?? null };
        }
        return changes;
    }, {});
}

async function insertHrAuditLog(client, action, staffId, performedBy, details, ipAddress) {
    await client.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [action, staffId || null, performedBy || null, details ? JSON.stringify(details) : null, ipAddress || null]
    );
}

async function recordScheduleAudit(client, action, staffId, date, beforeEntry, afterEntry, req, extraDetails = {}) {
    const before = normalizeScheduleAuditEntry(beforeEntry);
    const after = normalizeScheduleAuditEntry(afterEntry);
    const changes = scheduleAuditChanges(before, after);
    const force = Boolean(extraDetails.force);
    if (!force && Object.keys(changes).length === 0) return false;
    const details = {
        ...extraDetails,
        force: undefined,
        source: extraDetails.source || 'staff.schedule',
        date: normalizeScheduleDate(date),
        staffId: Number(staffId) || null,
        before,
        after,
        changes
    };
    await insertHrAuditLog(client, action, Number(staffId) || null, req?.user?.username || null, details, req?.ip || null);
    return true;
}

async function loadScheduleEntryForUpdate(client, staffId, date) {
    const result = await client.query(
        `SELECT *, date::text AS date
         FROM staff_schedule
         WHERE staff_id = $1 AND date = $2
         FOR UPDATE`,
        [staffId, date]
    );
    return result.rows[0] || null;
}

function timeToMinutes(value) {
    if (!value) return 0;
    const parts = String(value).split(':');
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
}

function minutesSinceKyivPlannedStart(plannedStart) {
    const now = getKyivDate();
    return (now.getHours() * 60 + now.getMinutes()) - timeToMinutes(plannedStart);
}

async function syncHrClockInFromStaffCheckin(db, staffId, options = {}) {
    const today = options.today || getKyivDateStr();
    const method = options.method || 'face';
    const existing = await db.query(
        'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2',
        [staffId, today]
    );
    if (existing.rows[0]?.clock_in) return existing.rows[0];

    const shift = await db.query(
        'SELECT * FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2',
        [staffId, today]
    );
    const currentShift = shift.rows[0] || null;
    const plannedStart = currentShift?.planned_start || null;
    const plannedEnd = currentShift?.planned_end || null;
    const lateMinutes = currentShift ? Math.max(0, minutesSinceKyivPlannedStart(plannedStart)) : 0;
    const status = currentShift ? (lateMinutes > 5 ? 'late' : 'present') : 'unscheduled';
    const clockIn = new Date().toISOString();

    let result;
    if (existing.rows[0]) {
        result = await db.query(
            `UPDATE hr_time_records SET
                clock_in = $1, planned_start = $2, planned_end = $3,
                late_minutes = $4, status = $5, ip_address = $6, user_agent = $7,
                business_context = COALESCE(business_context, $8), updated_at = NOW()
             WHERE id = $9 RETURNING *`,
            [clockIn, plannedStart, plannedEnd, lateMinutes, status, options.ip || null, options.userAgent || null, DEFAULT_BUSINESS_CONTEXT, existing.rows[0].id]
        );
    } else {
        result = await db.query(
            `INSERT INTO hr_time_records (business_context, staff_id, record_date, clock_in, planned_start, planned_end, late_minutes, status, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [DEFAULT_BUSINESS_CONTEXT, staffId, today, clockIn, plannedStart, plannedEnd, lateMinutes, status, options.ip || null, options.userAgent || null]
        );
    }

    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('clock_in', $1, $2, $3, $4)`,
        [staffId, options.performedBy || method, JSON.stringify({ clock_in: clockIn, late_minutes: lateMinutes, status, method, source: 'staff_checkin' }), options.ip || null]
    );

    return result.rows[0] || null;
}

async function syncHrClockOutFromStaffCheckout(db, staffId, options = {}) {
    const today = options.today || getKyivDateStr();
    const record = await db.query(
        'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2',
        [staffId, today]
    );
    const rec = record.rows[0];
    if (!rec?.clock_in || rec.clock_out) return rec || null;

    const shift = await db.query(
        'SELECT planned_start, planned_end, break_minutes FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2',
        [staffId, today]
    );
    const shiftRow = shift.rows[0] || {};
    const clockOut = new Date().toISOString();
    const payroll = calculateHrClockOutPayroll(rec, {
        clockOut,
        breakMinutes: shiftRow.break_minutes || 0,
        plannedStart: rec.planned_start || shiftRow.planned_start,
        plannedEnd: rec.planned_end || shiftRow.planned_end,
        settlementMode: options.settlementMode,
        kyivNow: getKyivDate()
    });

    const result = await db.query(
        `UPDATE hr_time_records SET
            clock_out = $1, total_worked_minutes = $2, early_leave_minutes = $3,
            overtime_minutes = $4, status = $5, updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        [
            clockOut,
            payroll.totalWorkedMinutes,
            payroll.earlyLeaveMinutes,
            payroll.overtimeMinutes,
            payroll.status,
            rec.id
        ]
    );

    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('clock_out', $1, $2, $3, $4)`,
        [
            staffId,
            options.performedBy || options.method || 'face',
            JSON.stringify({
                clock_out: clockOut,
                total_worked_minutes: payroll.totalWorkedMinutes,
                actual_worked_minutes: payroll.actualWorkedMinutes,
                scheduled_worked_minutes: payroll.scheduledWorkedMinutes,
                settlement_mode: payroll.settlementMode,
                requested_settlement_mode: payroll.requestedSettlementMode,
                status: payroll.status,
                method: options.method || 'face',
                source: 'staff_checkin'
            }),
            options.ip || null
        ]
    );

    return result.rows[0] || null;
}

function staffScheduleStatusForShift(shiftType) {
    return shiftType === 'remote' ? 'remote' : 'working';
}

function shiftTypeForScheduleStatus(status) {
    return status === 'remote' ? 'remote' : 'regular';
}

function replacementNote(originalName, reason) {
    const safeName = String(originalName || '').trim() || 'працівника';
    const safeReason = String(reason || '').trim();
    return `Заміна за ${safeName}${safeReason ? `: ${safeReason}` : ''}`;
}

async function loadEnrichedScheduleEntry(client, scheduleId) {
    const result = await client.query(
        `SELECT ss.*, ss.date::text AS date,
                s.name, s.department, s.position, s.color, s.is_active,
                s.role_type, COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                hs.id AS hr_shift_id,
                hs.original_staff_id,
                original_staff.name AS original_staff_name,
                hs.replacement_reason,
                hs.replaced_by,
                hs.replaced_at
         FROM staff_schedule ss
         JOIN staff s ON s.id = ss.staff_id
         LEFT JOIN hr_shifts hs ON hs.staff_id = ss.staff_id AND hs.shift_date::text = LEFT(ss.date::text, 10)
         LEFT JOIN staff original_staff ON original_staff.id = hs.original_staff_id
         WHERE ss.id = $1`,
        [scheduleId]
    );
    return result.rows[0] || null;
}

async function removeScheduleMirror(client, staffId, date) {
    await client.query(
        `DELETE FROM staff_schedule
         WHERE staff_id = $1
           AND date = $2
           AND status IN ('working', 'remote')`,
        [staffId, date]
    );
}

async function upsertScheduleMirror(client, shift, note = null) {
    const date = normalizeScheduleDate(shift?.shift_date);
    if (!shift?.staff_id || !date) return null;
    const validation = await validateStaffScheduleableForDate(client, shift.staff_id, date, { forUpdate: false });
    if (!validation.ok) return null;
    const result = await client.query(
        `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note, profession_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (staff_id, date)
         DO UPDATE SET shift_start = EXCLUDED.shift_start,
                       shift_end = EXCLUDED.shift_end,
                       status = EXCLUDED.status,
                       note = EXCLUDED.note,
                       profession_key = EXCLUDED.profession_key
         RETURNING id`,
        [
            shift.staff_id,
            date,
            shift.planned_start || null,
            shift.planned_end || null,
            staffScheduleStatusForShift(shift.shift_type),
            note ?? shift.notes ?? null,
            shift.profession_key || null
        ]
    );
    return result.rows[0]?.id || null;
}

async function syncHrShiftFromScheduleEntry(client, entry, actor = null) {
    const staffId = Number(entry?.staffId ?? entry?.staff_id);
    const date = normalizeScheduleDate(entry?.date);
    const status = normalizeScheduleStatus(entry?.status, 'working') || 'working';
    if (!staffId || !date) return null;
    const validation = await validateScheduleWriteStaff(client, staffId, date, { forUpdate: false });
    if (!validation.ok) {
        return {
            ok: false,
            status: validation.status || 400,
            error: validation.error,
            code: validation.code,
            validation
        };
    }
    if (!scheduleStatusNeedsProfession(status)) {
        await client.query(
            'DELETE FROM hr_shifts WHERE staff_id = $1 AND shift_date = $2',
            [staffId, date]
        );
        return { ok: true, shift: null };
    }
    const shiftStart = entry?.shiftStart ?? entry?.shift_start ?? null;
    const shiftEnd = entry?.shiftEnd ?? entry?.shift_end ?? null;
    if (!shiftStart || !shiftEnd) {
        return { ok: false, status: 400, error: 'Для робочої зміни потрібен час початку та завершення' };
    }
    const professionKey = entry?.professionKey ?? entry?.profession_key ?? null;
    const result = await client.query(
        `INSERT INTO hr_shifts (
            staff_id, shift_date, planned_start, planned_end, shift_type,
            break_minutes, notes, created_by, profession_key
         )
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)
         ON CONFLICT (staff_id, shift_date) DO UPDATE SET
            planned_start = EXCLUDED.planned_start,
            planned_end = EXCLUDED.planned_end,
            shift_type = EXCLUDED.shift_type,
            notes = CASE
                WHEN hr_shifts.original_staff_id IS NULL THEN EXCLUDED.notes
                ELSE hr_shifts.notes
            END,
            profession_key = EXCLUDED.profession_key,
            updated_at = NOW()
         RETURNING *`,
        [
            staffId,
            date,
            shiftStart,
            shiftEnd,
            shiftTypeForScheduleStatus(status),
            entry?.note || null,
            actor || null,
            professionKey || null
        ]
    );
    return { ok: true, shift: result.rows[0] || null };
}

async function backfillStaffScheduleFromHrShifts(from, to, db = pool) {
    if (!from || !to) return;
    const result = await db.query(
        `SELECT hs.*
         FROM hr_shifts hs
         JOIN staff s ON s.id = hs.staff_id
         LEFT JOIN staff_schedule ss
           ON ss.staff_id = hs.staff_id
          AND LEFT(ss.date::text, 10) = hs.shift_date::text
         WHERE hs.shift_date >= $1
           AND hs.shift_date <= $2
           AND ${activeScheduleStaffWhere('s', 'hs.shift_date')}
           AND ss.id IS NULL`,
        [from, to]
    );
    for (const shift of result.rows) {
        await upsertScheduleMirror(db, shift);
    }
}

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
    trampoline: 'Батутисти',
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

// GET /api/staff/display-groups — canonical operational staff filter groups
router.get('/display-groups', async (req, res) => {
    res.json({ success: true, data: listStaffDisplayGroups() });
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
            `SELECT ss.*, ss.date::text AS date,
                    CASE WHEN ss.status = 'day_off' THEN 'dayoff' ELSE ss.status END AS status,
                    s.name, s.department, s.position, s.color, s.is_active,
                    s.role_type, COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                    hs.id AS hr_shift_id,
                    hs.original_staff_id,
                    original_staff.name AS original_staff_name,
                    hs.replacement_reason,
                    hs.replaced_by,
                    hs.replaced_at
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = ss.staff_id AND hs.shift_date::text = LEFT(ss.date::text, 10)
             LEFT JOIN staff original_staff ON original_staff.id = hs.original_staff_id
             WHERE ss.date >= $1 AND ss.date <= $2
               AND ${activeScheduleStaffWhere('s', 'ss.date')}
             ORDER BY s.department, s.name, ss.date`,
            [from, to]
        );
        const rows = decorateStaffRowsWithDisplayGroups(result.rows);
        res.json({ success: true, data: rows, displayGroups: listStaffDisplayGroups() });
    } catch (err) {
        log.error('GET /staff/schedule error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// PUT /api/staff/schedule — upsert a single schedule entry
router.put('/schedule', requireAction('manage_staff'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { staffId, date, shiftStart, shiftEnd, status, note } = req.body;
        if (!staffId || !date) {
            return res.status(400).json({ success: false, error: 'Потрібні staffId та date' });
        }
        const scheduleStatus = normalizeScheduleStatus(status, 'working');
        if (!scheduleStatus) {
            return res.status(400).json({ success: false, error: 'Невідомий статус графіка' });
        }
        if (scheduleStatusNeedsProfession(scheduleStatus) && (!shiftStart || !shiftEnd)) {
            return res.status(400).json({ success: false, error: 'Для робочої зміни потрібен час початку та завершення' });
        }
        await client.query('BEGIN');
        const scheduleValidation = await validateScheduleWriteStaff(client, staffId, date);
        if (!scheduleValidation.ok) {
            return rejectUnscheduleableStaff(res, client, scheduleValidation, {
                entry: { staffId, date }
            });
        }
        const profession = await resolveScheduleProfession(staffId, scheduleStatus, req.body, client);
        if (!profession.ok) {
            await client.query('ROLLBACK');
            return res.status(profession.status || 400).json({ success: false, error: profession.error });
        }
        const previous = await loadScheduleEntryForUpdate(client, staffId, date);
        const result = await client.query(
            `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note, profession_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (staff_id, date)
             DO UPDATE SET shift_start=$3, shift_end=$4, status=$5, note=$6, profession_key=$7
            RETURNING *`,
            [staffId, date, shiftStart || null, shiftEnd || null, scheduleStatus, note || null, profession.professionKey]
        );
        const hrSync = await syncHrShiftFromScheduleEntry(client, {
            staffId,
            date,
            shiftStart,
            shiftEnd,
            status: scheduleStatus,
            note,
            professionKey: profession.professionKey
        }, req.user?.username || null);
        if (hrSync?.ok === false) {
            await client.query('ROLLBACK');
            if (hrSync.validation) {
                return res.status(hrSync.status || 400).json(scheduleableStaffErrorPayload(hrSync.validation, {
                    entry: { staffId, date }
                }));
            }
            return res.status(hrSync.status || 400).json({ success: false, code: hrSync.code, error: hrSync.error });
        }
        const enriched = await loadEnrichedScheduleEntry(client, result.rows[0].id);
        await recordScheduleAudit(client, 'staff_schedule_update', staffId, date, previous, enriched || result.rows[0], req, {
            source: 'staff.schedule.put'
        });
        await client.query('COMMIT');
        // Fire-and-forget Telegram notification
        notifyScheduleChange(staffId, date, scheduleStatus, shiftStart, shiftEnd);
        res.json({ success: true, data: enriched || result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /staff/schedule error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// GET /api/staff/schedule/history/:staffId/:date — explicit audit trail for one schedule cell
router.get('/schedule/history/:staffId/:date', async (req, res) => {
    try {
        const staffId = Number(req.params.staffId);
        const date = normalizeScheduleDate(req.params.date);
        const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
        if (!Number.isFinite(staffId) || staffId <= 0 || !date) {
            return res.status(400).json({ success: false, error: 'Потрібні staffId та date' });
        }
        const result = await pool.query(
            `SELECT id, action, staff_id, performed_by, details, ip_address, created_at
             FROM hr_audit_log
             WHERE staff_id = $1
               AND action LIKE 'staff_schedule%'
               AND (
                    details->>'date' = $2
                    OR details#>>'{before,date}' = $2
                    OR details#>>'{after,date}' = $2
               )
             ORDER BY created_at DESC, id DESC
             LIMIT $3`,
            [staffId, date, limit]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /staff/schedule/history error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

/**
 * POST /api/staff/schedule/bulk — upsert multiple schedule entries at once
 * LLM HINT: Send array of entries. Each entry: { staffId, date, shiftStart, shiftEnd, status, note }
 * Example: set a whole week for one person, or one day for all animators.
 * Returns count of upserted entries.
 */
// POST /api/staff/schedule/:id/replace — assign a live schedule slot to a replacement worker through HR shift truth
router.post('/schedule/:id/replace', requireAction('manage_staff'), async (req, res) => {
    const client = await pool.connect();
    try {
        const scheduleId = parseInt(req.params.id, 10);
        const replacementStaffId = parseInt(req.body.replacement_staff_id ?? req.body.replacementStaffId, 10);
        const reason = String(req.body.reason || '').trim() || null;
        if (!scheduleId || !replacementStaffId) {
            return res.status(400).json({ success: false, error: 'Потрібні schedule id та replacement_staff_id' });
        }

        await client.query('BEGIN');
        const scheduleResult = await client.query(
            `SELECT ss.*, ss.date::text AS date, s.name AS staff_name, s.role_type
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             WHERE ss.id = $1
             FOR UPDATE OF ss`,
            [scheduleId]
        );
        if (!scheduleResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Слот графіка не знайдено' });
        }
        const schedule = scheduleResult.rows[0];
        const date = normalizeScheduleDate(schedule.date);
        const status = schedule.status || 'working';
        if (!['working', 'remote'].includes(status) || !schedule.shift_start || !schedule.shift_end) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміну можна виставити тільки для робочого слота з часом' });
        }
        if (Number(schedule.staff_id) === replacementStaffId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміна на того самого працівника не потрібна' });
        }

        const replacementValidation = await validateScheduleWriteStaff(client, replacementStaffId, date);
        if (!replacementValidation.ok) {
            return rejectUnscheduleableStaff(res, client, replacementValidation, {
                entry: { staffId: replacementStaffId, date, scheduleId }
            });
        }
        const replacement = { rows: [replacementValidation.staff] };
        if (!replacement.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Працівник для заміни неактивний або не існує' });
        }

        const sourceProfession = await resolveScheduleProfession(schedule.staff_id, status, {
            profession_key: schedule.profession_key || schedule.role_type
        }, client);
        if (!sourceProfession.ok) {
            await client.query('ROLLBACK');
            return res.status(sourceProfession.status || 400).json({ success: false, error: sourceProfession.error });
        }
        const replacementProfession = await resolveStaffProfessionAssignment(client, replacementStaffId, sourceProfession.professionKey);
        if (!replacementProfession.ok) {
            await client.query('ROLLBACK');
            return res.status(replacementProfession.status || 400).json({ success: false, error: replacementProfession.error });
        }

        const hrShift = await client.query(
            `INSERT INTO hr_shifts (staff_id, shift_date, planned_start, planned_end, shift_type, break_minutes, notes, created_by, profession_key)
             VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)
             ON CONFLICT (staff_id, shift_date) DO UPDATE SET
                planned_start = EXCLUDED.planned_start,
                planned_end = EXCLUDED.planned_end,
                shift_type = EXCLUDED.shift_type,
                notes = CASE
                    WHEN hr_shifts.original_staff_id IS NULL THEN EXCLUDED.notes
                    ELSE hr_shifts.notes
                END,
                profession_key = EXCLUDED.profession_key,
                updated_at = NOW()
             RETURNING *`,
            [
                schedule.staff_id,
                date,
                schedule.shift_start,
                schedule.shift_end,
                shiftTypeForScheduleStatus(status),
                schedule.note || null,
                req.user?.username || null,
                sourceProfession.professionKey
            ]
        );
        const currentShift = hrShift.rows[0];

        const shiftConflict = await client.query(
            `SELECT id FROM hr_shifts
             WHERE staff_id = $1 AND shift_date = $2 AND id <> $3
             LIMIT 1`,
            [replacementStaffId, date, currentShift.id]
        );
        if (shiftConflict.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'У працівника для заміни вже є HR-зміна на цю дату' });
        }

        const scheduleConflict = await client.query(
            `SELECT id, status FROM staff_schedule
             WHERE staff_id = $1 AND date = $2 AND id <> $3
               AND status IN ('working', 'remote', 'vacation', 'sick')
             LIMIT 1`,
            [replacementStaffId, date, scheduleId]
        );
        if (scheduleConflict.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'У працівника для заміни вже є активний слот графіка на цю дату' });
        }

        const originalStaffId = currentShift.original_staff_id || currentShift.staff_id;
        const original = await client.query('SELECT id, name FROM staff WHERE id = $1', [originalStaffId]);
        const updatedShift = await client.query(
            `UPDATE hr_shifts SET
                original_staff_id = COALESCE(original_staff_id, staff_id),
                staff_id = $1,
                replacement_reason = $2,
                replaced_by = $3,
                replaced_at = NOW(),
                planned_start = $4,
                planned_end = $5,
                shift_type = $6,
                profession_key = $7,
                updated_at = NOW()
             WHERE id = $8
             RETURNING *`,
            [
                replacementStaffId,
                reason,
                req.user?.username || null,
                schedule.shift_start,
                schedule.shift_end,
                shiftTypeForScheduleStatus(status),
                replacementProfession.professionKey,
                currentShift.id
            ]
        );

        const replacementPrevious = await loadScheduleEntryForUpdate(client, replacementStaffId, date);
        await client.query('DELETE FROM staff_schedule WHERE id = $1', [scheduleId]);
        const replacementScheduleId = await upsertScheduleMirror(
            client,
            updatedShift.rows[0],
            replacementNote(original.rows[0]?.name, reason)
        );
        const enriched = replacementScheduleId ? await loadEnrichedScheduleEntry(client, replacementScheduleId) : null;
        await recordScheduleAudit(client, 'staff_schedule_replacement_removed', schedule.staff_id, date, schedule, null, req, {
            source: 'staff.schedule.replace',
            replacementStaffId,
            reason,
            force: true
        });
        await recordScheduleAudit(client, 'staff_schedule_replacement_set', replacementStaffId, date, replacementPrevious, enriched, req, {
            source: 'staff.schedule.replace',
            originalStaffId,
            reason,
            force: true
        });
        await client.query('COMMIT');

        notifyScheduleChange(replacementStaffId, date, status, schedule.shift_start, schedule.shift_end);
        res.json({ success: true, data: enriched, replacement: replacement.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /staff/schedule/:id/replace error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/staff/schedule/:id/replacement-clear — return a replacement slot to the original worker
router.post('/schedule/:id/replacement-clear', requireAction('manage_staff'), async (req, res) => {
    const client = await pool.connect();
    try {
        const scheduleId = parseInt(req.params.id, 10);
        if (!scheduleId) {
            return res.status(400).json({ success: false, error: 'Потрібен schedule id' });
        }

        await client.query('BEGIN');
        const scheduleResult = await client.query(
            `SELECT ss.*, ss.date::text AS date, hs.id AS hr_shift_id, hs.original_staff_id,
                    hs.planned_start, hs.planned_end, hs.shift_type, hs.notes, hs.profession_key
             FROM staff_schedule ss
             JOIN hr_shifts hs ON hs.staff_id = ss.staff_id AND hs.shift_date::text = LEFT(ss.date::text, 10)
             WHERE ss.id = $1
             FOR UPDATE OF ss, hs`,
            [scheduleId]
        );
        if (!scheduleResult.rows.length || !scheduleResult.rows[0].original_staff_id) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'У цьому слоті немає активної підміни' });
        }
        const schedule = scheduleResult.rows[0];
        const date = normalizeScheduleDate(schedule.date);
        const originalStaffId = Number(schedule.original_staff_id);

        const originalValidation = await validateScheduleWriteStaff(client, originalStaffId, date);
        if (!originalValidation.ok) {
            return rejectUnscheduleableStaff(res, client, originalValidation, {
                entry: { staffId: originalStaffId, date, scheduleId }
            });
        }
        const original = { rows: [originalValidation.staff] };
        if (!original.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Оригінальний працівник неактивний або не існує' });
        }

        const shiftConflict = await client.query(
            `SELECT id FROM hr_shifts
             WHERE staff_id = $1 AND shift_date = $2 AND id <> $3
             LIMIT 1`,
            [originalStaffId, date, schedule.hr_shift_id]
        );
        if (shiftConflict.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Оригінальний працівник вже має HR-зміну на цю дату' });
        }

        const scheduleConflict = await client.query(
            `SELECT id, status FROM staff_schedule
             WHERE staff_id = $1 AND date = $2 AND id <> $3
               AND status IN ('working', 'remote', 'vacation', 'sick')
             LIMIT 1`,
            [originalStaffId, date, scheduleId]
        );
        if (scheduleConflict.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Оригінальний працівник вже має активний слот графіка на цю дату' });
        }

        const restoredShift = await client.query(
            `UPDATE hr_shifts SET
                staff_id = original_staff_id,
                original_staff_id = NULL,
                replacement_reason = NULL,
                replaced_by = NULL,
                replaced_at = NULL,
                updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [schedule.hr_shift_id]
        );

        const originalPrevious = await loadScheduleEntryForUpdate(client, originalStaffId, date);
        await client.query('DELETE FROM staff_schedule WHERE id = $1', [scheduleId]);
        const restoredScheduleId = await upsertScheduleMirror(client, restoredShift.rows[0], restoredShift.rows[0].notes || null);
        const enriched = restoredScheduleId ? await loadEnrichedScheduleEntry(client, restoredScheduleId) : null;
        await recordScheduleAudit(client, 'staff_schedule_replacement_clear_removed', schedule.staff_id, date, schedule, null, req, {
            source: 'staff.schedule.replacement_clear',
            originalStaffId,
            force: true
        });
        await recordScheduleAudit(client, 'staff_schedule_replacement_restored', originalStaffId, date, originalPrevious, enriched, req, {
            source: 'staff.schedule.replacement_clear',
            replacementStaffId: schedule.staff_id,
            force: true
        });
        await client.query('COMMIT');

        notifyScheduleChange(originalStaffId, date, staffScheduleStatusForShift(restoredShift.rows[0].shift_type), restoredShift.rows[0].planned_start, restoredShift.rows[0].planned_end);
        res.json({ success: true, data: enriched, original: original.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('POST /staff/schedule/:id/replacement-clear error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

router.post('/schedule/bulk', requireAction('manage_staff'), async (req, res) => {
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
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const e of entries) {
                if (!e.staffId || !e.date) continue;
                const entryStatus = normalizeScheduleStatus(e.status, 'working');
                if (!entryStatus) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Невідомий статус графіка',
                        entry: { staffId: e.staffId, date: e.date }
                    });
                }
                const scheduleValidation = await validateScheduleWriteStaff(client, e.staffId, e.date);
                if (!scheduleValidation.ok) {
                    return rejectUnscheduleableStaff(res, client, scheduleValidation, {
                        entry: { staffId: e.staffId, date: e.date }
                    });
                }
                const profession = await resolveScheduleProfession(e.staffId, entryStatus, e, client);
                if (!profession.ok) {
                    await client.query('ROLLBACK');
                    return res.status(profession.status || 400).json({
                        success: false,
                        error: profession.error,
                        entry: { staffId: e.staffId, date: e.date }
                    });
                }
                const previous = await loadScheduleEntryForUpdate(client, e.staffId, e.date);
                const upserted = await client.query(
                    `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note, profession_key)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (staff_id, date)
                     DO UPDATE SET shift_start=$3, shift_end=$4, status=$5, note=$6, profession_key=$7
                     RETURNING *`,
                    [e.staffId, e.date, e.shiftStart || null, e.shiftEnd || null, entryStatus, e.note || null, profession.professionKey]
                );
                const hrSync = await syncHrShiftFromScheduleEntry(client, {
                    staffId: e.staffId,
                    date: e.date,
                    shiftStart: e.shiftStart || null,
                    shiftEnd: e.shiftEnd || null,
                    status: entryStatus,
                    note: e.note || null,
                    professionKey: profession.professionKey
                }, req.user?.username || null);
                if (hrSync?.ok === false) {
                    await client.query('ROLLBACK');
                    if (hrSync.validation) {
                        return res.status(hrSync.status || 400).json(scheduleableStaffErrorPayload(hrSync.validation, {
                            entry: { staffId: e.staffId, date: e.date }
                        }));
                    }
                    return res.status(hrSync.status || 400).json({
                        success: false,
                        code: hrSync.code,
                        error: hrSync.error,
                        entry: { staffId: e.staffId, date: e.date }
                    });
                }
                await recordScheduleAudit(client, 'staff_schedule_bulk_update', e.staffId, e.date, previous, upserted.rows[0], req, {
                    source: 'staff.schedule.bulk',
                    batchSize: entries.length
                });
                affectedStaff.add(e.staffId);
                count++;
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
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
 * LLM HINT: { fromMonday: "2026-02-09", toMonday: "2026-02-16", department?: "animators", staffIds?: [1,2], dryRun?: true }
 * Copies 7 days of schedule. Optional raw department filter or explicit staffIds filter.
 * Existing entries in target week are overwritten.
 */
router.post('/schedule/copy-week', requireAction('manage_staff'), async (req, res) => {
    try {
        const { fromMonday, toMonday } = req.body;
        const requestedDepartment = String(req.body.department || '').trim();
        const department = requestedDepartment === 'all' ? '' : requestedDepartment;
        const displayGroup = String(req.body.displayGroup || req.body.display_group || department || 'all').trim();
        const dryRun = req.body.dryRun === true || req.body.dry_run === true;
        const staffIds = normalizeCopyWeekStaffIds(req.body.staffIds || req.body.staff_ids);
        if (!fromMonday || !toMonday) {
            return res.status(400).json({ success: false, error: 'Потрібні fromMonday та toMonday' });
        }
        if (Array.isArray(req.body.staffIds || req.body.staff_ids) && !staffIds.length) {
            return res.status(400).json({ success: false, error: 'staffIds[] має містити хоча б один валідний staff id' });
        }
        if (staffIds.length > STAFF_COPY_WEEK_MAX_STAFF_IDS) {
            return res.status(400).json({ success: false, error: `Максимум ${STAFF_COPY_WEEK_MAX_STAFF_IDS} staffIds за раз` });
        }
        if (staffIds.length && department) {
            return res.status(400).json({ success: false, error: 'staffIds[] не можна комбінувати з raw department filter' });
        }
        if (department && !STAFF_COPY_WEEK_RAW_DEPARTMENT_ALLOWLIST.has(department)) {
            return res.status(400).json({
                success: false,
                error: 'Ця категорія є virtual/display group. Передайте explicit staffIds[], щоб copy-week не зачепив неправильний raw department.'
            });
        }
        const copyMode = staffIds.length ? 'explicit_staff_ids' : (department ? 'raw_department' : 'all');

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
                    WHERE ss.date >= $1 AND ss.date <= $2
                      AND ${activeScheduleStaffWhere('s', 'ss.date')}`;
        const params = [fromDates[0], fromDates[6]];
        if (staffIds.length) {
            params.push(staffIds);
            sql += ` AND ss.staff_id = ANY($${params.length}::int[])`;
        } else if (department) {
            params.push(department);
            sql += ` AND s.department = $${params.length}`;
        }
        const source = await pool.query(sql, params);
        const sourceRows = source.rows.filter(row => {
            const sourceDate = typeof row.date === 'string' ? row.date : row.date?.toISOString?.().slice(0, 10);
            return fromDates.includes(sourceDate);
        });
        const sourceStaffIds = [...new Set(sourceRows.map(row => Number(row.staff_id)).filter(Number.isFinite))];
        let conflicts = 0;
        if (sourceStaffIds.length) {
            const conflictResult = await pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM staff_schedule
                 WHERE date >= $1 AND date <= $2
                   AND staff_id = ANY($3::int[])`,
                [toDates[0], toDates[6], sourceStaffIds]
            );
            conflicts = Number(conflictResult.rows[0]?.count || 0);
        }
        if (dryRun) {
            return res.json({
                success: true,
                dryRun: true,
                count: sourceRows.length,
                conflicts,
                staffCount: sourceStaffIds.length,
                copyMode,
                department: department || null,
                displayGroup,
                staffIds: copyMode === 'explicit_staff_ids' ? sourceStaffIds : undefined
            });
        }

        let count = 0;
        const affectedStaff = new Set();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (const row of sourceRows) {
                const sourceDate = typeof row.date === 'string' ? row.date : row.date?.toISOString?.().slice(0, 10);
                const dayIndex = fromDates.indexOf(sourceDate);
                if (dayIndex === -1) continue;
                const targetDate = toDates[dayIndex];
                const rowStatus = normalizeScheduleStatus(row.status, null);
                if (!rowStatus) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: 'Невідомий статус графіка у тижні-джерелі',
                        entry: { staffId: row.staff_id, date: sourceDate }
                    });
                }
                const scheduleValidation = await validateScheduleWriteStaff(client, row.staff_id, targetDate);
                if (!scheduleValidation.ok) {
                    return rejectUnscheduleableStaff(res, client, scheduleValidation, {
                        entry: { staffId: row.staff_id, date: targetDate, sourceDate }
                    });
                }
                const profession = await resolveScheduleProfession(row.staff_id, rowStatus, { profession_key: row.profession_key }, client);
                if (!profession.ok) {
                    await client.query('ROLLBACK');
                    return res.status(profession.status || 400).json({
                        success: false,
                        error: profession.error,
                        entry: { staffId: row.staff_id, date: targetDate }
                    });
                }
                const previous = await loadScheduleEntryForUpdate(client, row.staff_id, targetDate);
                const upserted = await client.query(
                    `INSERT INTO staff_schedule (staff_id, date, shift_start, shift_end, status, note, profession_key)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (staff_id, date)
                     DO UPDATE SET shift_start=$3, shift_end=$4, status=$5, note=$6, profession_key=$7
                     RETURNING *`,
                    [row.staff_id, targetDate, row.shift_start, row.shift_end, rowStatus, row.note, profession.professionKey]
                );
                const hrSync = await syncHrShiftFromScheduleEntry(client, {
                    staffId: row.staff_id,
                    date: targetDate,
                    shiftStart: row.shift_start,
                    shiftEnd: row.shift_end,
                    status: rowStatus,
                    note: row.note,
                    professionKey: profession.professionKey
                }, req.user?.username || null);
                if (hrSync?.ok === false) {
                    await client.query('ROLLBACK');
                    if (hrSync.validation) {
                        return res.status(hrSync.status || 400).json(scheduleableStaffErrorPayload(hrSync.validation, {
                            entry: { staffId: row.staff_id, date: targetDate, sourceDate }
                        }));
                    }
                    return res.status(hrSync.status || 400).json({
                        success: false,
                        code: hrSync.code,
                        error: hrSync.error,
                        entry: { staffId: row.staff_id, date: targetDate }
                    });
                }
                await recordScheduleAudit(client, 'staff_schedule_copy_week', row.staff_id, targetDate, previous, upserted.rows[0], req, {
                    source: 'staff.schedule.copy_week',
                    fromDate: sourceDate,
                    fromMonday,
                    toMonday,
                    department: department || null,
                    displayGroup,
                    copyMode,
                    staffCount: sourceStaffIds.length,
                    staffIds: copyMode === 'explicit_staff_ids' ? sourceStaffIds : undefined,
                    conflictCount: conflicts
                });
                affectedStaff.add(row.staff_id);
                count++;
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        // Fire-and-forget notification
        if (count > 0) notifyBulkScheduleChange(affectedStaff, count);
        res.json({
            success: true,
            count,
            conflicts,
            staffCount: affectedStaff.size,
            copyMode,
            department: department || null,
            displayGroup
        });
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
                    ss.shift_start, ss.shift_end,
                    CASE WHEN ss.status = 'day_off' THEN 'dayoff' ELSE ss.status END AS status
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             WHERE ss.date >= $1 AND ss.date <= $2
               AND ${activeScheduleStaffWhere('s', 'ss.date')}
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
            `SELECT ss.staff_id,
                    CASE WHEN ss.status = 'day_off' THEN 'dayoff' ELSE ss.status END AS status,
                    ss.shift_start, ss.shift_end, s.name, s.department
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             WHERE ss.date = $1
               AND s.department = 'animators'
               AND ${activeScheduleStaffWhere('s', 'ss.date')}`,
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

// GET /api/staff/attendance — payroll-ready actual attendance for schedule range
router.get('/attendance', requireRole(...STAFF_ATTENDANCE_READ_ROLES), async (req, res) => {
    try {
        const from = normalizeScheduleDate(req.query.from);
        const to = normalizeScheduleDate(req.query.to);
        if (!from || !to) {
            return res.status(400).json({ success: false, error: 'from/to required (YYYY-MM-DD)' });
        }

        const result = await pool.query(`
            SELECT
                COALESCE(tr.staff_id, sc.staff_id) AS staff_id,
                COALESCE(tr.record_date, sc.date)::text AS date,
                tr.id AS time_record_id,
                tr.clock_in,
                tr.clock_out,
                tr.planned_start,
                tr.planned_end,
                COALESCE(tr.late_minutes, 0) AS late_minutes,
                COALESCE(tr.early_leave_minutes, 0) AS early_leave_minutes,
                COALESCE(tr.overtime_minutes, 0) AS overtime_minutes,
                COALESCE(tr.total_worked_minutes, 0) AS total_worked_minutes,
                tr.status AS time_status,
                COALESCE(tr.auto_closed, false) AS auto_closed,
                tr.corrected_by,
                tr.corrected_at,
                tr.correction_reason,
                tr.notes,
                sc.id AS checkin_id,
                sc.check_in AS checkin_at,
                sc.check_out AS checkout_at,
                sc.method AS checkin_method,
                CASE
                    WHEN tr.id IS NOT NULL THEN 'hr_time_records'
                    WHEN sc.id IS NOT NULL THEN 'staff_checkins'
                    ELSE 'none'
                END AS attendance_source
            FROM hr_time_records tr
            FULL OUTER JOIN staff_checkins sc
              ON sc.staff_id = tr.staff_id
             AND sc.date = tr.record_date
            WHERE COALESCE(tr.record_date, sc.date) BETWEEN $1::date AND $2::date
            ORDER BY date, staff_id
        `, [from, to]);

        const summary = result.rows.reduce((acc, row) => {
            const status = String(row.time_status || '').trim() || (row.checkin_at ? 'present' : 'planned');
            acc.total += 1;
            if (row.clock_in || row.checkin_at) acc.checked_in += 1;
            if (status === 'late' || Number(row.late_minutes || 0) > 0) acc.late += 1;
            if (['absent', 'no_show'].includes(status)) acc.absent += 1;
            if (status === 'early_leave' || Number(row.early_leave_minutes || 0) > 0) acc.left_early += 1;
            if (row.clock_in && row.clock_out) acc.completed += 1;
            if (['sick', 'vacation', 'day_off', 'excused'].includes(status)) acc.excused += 1;
            return acc;
        }, { total: 0, checked_in: 0, late: 0, absent: 0, left_early: 0, completed: 0, excused: 0 });

        res.json({ success: true, from, to, data: result.rows, summary, source: 'hr_time_records+staff_checkins' });
    } catch (err) {
        if (err.message.includes('does not exist')) {
            return res.json({ success: true, data: [], summary: { total: 0, checked_in: 0, late: 0, absent: 0, left_early: 0, completed: 0, excused: 0 }, source: 'missing_attendance_tables' });
        }
        log.error('GET /staff/attendance error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ==========================================
// STAFF CRUD (/:id routes AFTER /schedule to avoid param capture)
// ==========================================

// GET /api/staff — list all staff (optionally filter by department)
router.get('/', async (req, res) => {
    try {
        const { department, active, include_freelance, includeFreelance } = req.query;
        let sql = `SELECT staff.id,
            staff.name,
            COALESCE(NULLIF(staff.display_name, ''), staff.name) AS display_name,
            staff.department,
            staff.position,
            staff.position AS role,
            staff.role_type,
            COALESCE(staff.secondary_professions, '[]'::jsonb) AS secondary_professions,
            COALESCE((
                SELECT jsonb_agg(profession_key)
                FROM (
                    SELECT NULLIF(staff.role_type, '') AS profession_key
                    UNION ALL
                    SELECT NULLIF(secondary.value, '') AS profession_key
                    FROM jsonb_array_elements_text(COALESCE(staff.secondary_professions, '[]'::jsonb)) AS secondary(value)
                ) staff_professions
                WHERE profession_key IS NOT NULL
            ), '[]'::jsonb) AS professions,
            staff.photo_url,
            staff.color,
            staff.is_active,
            staff.is_freelance,
            COALESCE(staff.hr_pool_status, 'core') AS hr_pool_status,
            (EXISTS(SELECT 1 FROM staff_face_descriptors sfd WHERE sfd.staff_id = staff.id)) AS has_face_descriptor,
            (EXISTS(SELECT 1 FROM employee_profiles ep WHERE ep.staff_id = staff.id AND ep.is_active = true)) AS has_account,
            (SELECT ep.user_id
             FROM employee_profiles ep
             WHERE ep.staff_id = staff.id AND ep.is_active = true AND ep.user_id IS NOT NULL
             ORDER BY ep.id DESC
             LIMIT 1) AS account_user_id,
            (SELECT u.username
             FROM employee_profiles ep
             JOIN users u ON u.id = ep.user_id
             WHERE ep.staff_id = staff.id AND ep.is_active = true AND ep.user_id IS NOT NULL
             ORDER BY ep.id DESC
             LIMIT 1) AS account_username,
            'hr_staff_card_light' AS card_source
            FROM staff`;
        const params = [];
        const conditions = [];
        const shouldIncludeFreelance = include_freelance === 'true' || includeFreelance === 'true';

        if (department) {
            params.push(department);
            conditions.push(`department = $${params.length}`);
        }
        if (active !== undefined) {
            const activeRequested = active === 'true';
            if (activeRequested) {
                conditions.push(activeScheduleStaffWhere('staff', 'CURRENT_DATE', { includeFreelance: shouldIncludeFreelance }));
            } else {
                params.push(false);
                conditions.push(`is_active = $${params.length}`);
            }
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY department, name';

        const result = await pool.query(sql, params);
        const rows = decorateStaffRowsWithDisplayGroups(result.rows);
        res.json({
            success: true,
            data: rows,
            departments: DEPARTMENTS,
            displayGroups: listStaffDisplayGroups(),
            displayGroupOptions: buildStaffDisplayGroupOptions(rows)
        });
    } catch (err) {
        log.error('GET /staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/staff — create new employee
// LLM HINT: telegramUsername is optional — used for @-mentions in schedule notifications
router.post('/', requireRole('creator', 'director', 'vice_director', 'senior_manager', 'hr'), async (req, res) => {
    try {
        const { name, department, position, phone, hireDate, color, telegramUsername, role_type, roleType, address, secondary_professions, secondaryProfessions } = req.body;
        if (!name || !department || !position) {
            return res.status(400).json({ success: false, error: 'Обов\'язкові поля: ім\'я, відділ, посада' });
        }
        const primaryRole = role_type || roleType || null;
        const secondaryRoles = normalizeSecondaryProfessions(secondary_professions ?? secondaryProfessions, primaryRole);
        const result = await pool.query(
            `INSERT INTO staff (name, department, position, phone, hire_date, color, telegram_username, role_type, address, secondary_professions)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING *`,
            [name, department, position, phone || null, hireDate || null, color || null, telegramUsername || null, primaryRole, address || null, JSON.stringify(secondaryRoles)]
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
    const client = await pool.connect();
    try {
        const { name, department, position, phone, hireDate, color, isActive, telegramUsername, role_type, roleType, address, secondary_professions, secondaryProfessions } = req.body;
        // Only update telegram_username if explicitly passed (even empty string clears it)
        const tgUser = telegramUsername !== undefined ? (telegramUsername || null) : undefined;
        const primaryRole = role_type || roleType || null;
        const hasSecondaryProfessions = Object.prototype.hasOwnProperty.call(req.body || {}, 'secondary_professions')
            || Object.prototype.hasOwnProperty.call(req.body || {}, 'secondaryProfessions');
        let effectivePrimaryRole = primaryRole;
        if (hasSecondaryProfessions && !effectivePrimaryRole) {
            const currentStaff = await client.query('SELECT role_type FROM staff WHERE id = $1', [req.params.id]);
            effectivePrimaryRole = currentStaff.rows[0]?.role_type || null;
        }
        const secondaryRoles = normalizeSecondaryProfessions(secondary_professions ?? secondaryProfessions, effectivePrimaryRole);
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE staff SET name=COALESCE($1,name), department=COALESCE($2,department),
             position=COALESCE($3,position), phone=$4, hire_date=$5, color=$6,
             is_active=COALESCE($7,is_active),
             telegram_username = CASE WHEN $9::boolean THEN $10 ELSE telegram_username END,
             role_type=COALESCE($11,role_type),
             address=COALESCE($12,address),
             secondary_professions = CASE WHEN $13::boolean THEN $14::jsonb ELSE secondary_professions END
             WHERE id=$8 RETURNING *`,
            [name, department, position, phone || null, hireDate || null, color || null, isActive, req.params.id,
             telegramUsername !== undefined, tgUser, primaryRole, address || null, hasSecondaryProfessions, JSON.stringify(secondaryRoles)]
        );
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        let scheduleCleanup = null;
        let accountDeactivation = null;
        if (isActive === false) {
            scheduleCleanup = await cleanupFutureStaffOperationalSchedule(client, req.params.id, getKyivDateStr());
            accountDeactivation = await syncLinkedStaffAccountDeactivation(client, req.params.id, {
                actor: req.user,
                req,
                reason: 'staff_deactivation',
                source: 'staff_update',
                canDisableAccount: account => canDisableLinkedStaffAccount(req.user, account),
                blockReason: account => linkedStaffAccountBlockReason(req.user, account),
                accountMeta: account => linkedStaffAccountMeta(account, req.user?.id),
                logger: log
            });
        }
        await client.query('COMMIT');
        res.json({ success: true, data: result.rows[0], schedule_cleanup: scheduleCleanup, account_deactivation: accountDeactivation });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// DELETE /api/staff/:id — legacy soft archive. Do not physically delete staff history.
router.delete('/:id', requireRole('creator', 'director'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE staff
             SET is_active = false,
                 hr_pool_status = CASE WHEN hr_pool_status = 'blacklisted' THEN 'blacklisted' ELSE 'reserve' END,
                 termination_recorded_at = COALESCE(termination_recorded_at, NOW()),
                 termination_recorded_by = COALESCE(termination_recorded_by, $2),
                 termination_reason = COALESCE(termination_reason, 'Legacy archive через /api/staff')
             WHERE id = $1
             RETURNING id, name, is_active, hr_pool_status`,
            [req.params.id, req.user?.username || null]
        );
        if (!result.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Не знайдено' });
        }
        const scheduleCleanup = await cleanupFutureStaffOperationalSchedule(client, req.params.id, getKyivDateStr());
        const accountDeactivation = await syncLinkedStaffAccountDeactivation(client, req.params.id, {
            actor: req.user,
            req,
            reason: 'staff_archive',
            source: 'staff_delete_legacy',
            canDisableAccount: account => canDisableLinkedStaffAccount(req.user, account),
            blockReason: account => linkedStaffAccountBlockReason(req.user, account),
            accountMeta: account => linkedStaffAccountMeta(account, req.user?.id),
            logger: log
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            archived: true,
            data: result.rows[0],
            schedule_cleanup: scheduleCleanup,
            account_deactivation: accountDeactivation
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('DELETE /staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// ==========================================
// FACE RECOGNITION CHECK-IN (v22.18)
// ==========================================

// GET /api/staff/face-descriptors — all registered face descriptors
router.get('/face-descriptors', async (req, res) => {
    try {
        const today = getKyivDateStr();
        const result = await pool.query(`
            SELECT sfd.staff_id, s.name, sfd.descriptor
            FROM staff_face_descriptors sfd
            JOIN staff s ON s.id = sfd.staff_id
            LEFT JOIN hr_shifts hs ON hs.staff_id = s.id AND hs.shift_date = $1
            LEFT JOIN hr_time_records tr ON tr.staff_id = s.id AND tr.record_date = $1
            WHERE ${activeOperationalStaffForDateWhere('s', 'hs', 'tr')}
        `, [today]);
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
router.post('/:id/face-descriptor', requireAction('manage_staff'), async (req, res) => {
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

        const today = getKyivDateStr();
        let result;
        let hrTimeRecord = null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            result = await client.query(
                `INSERT INTO staff_checkins (staff_id, date, check_in, method)
                 VALUES ($1, $2, NOW(), $3)
                 ON CONFLICT (staff_id, date) DO UPDATE SET check_in = COALESCE(staff_checkins.check_in, NOW())
                 RETURNING *`,
                [staffId, today, method || 'face']
            );
            hrTimeRecord = await syncHrClockInFromStaffCheckin(client, staffId, {
                today,
                method: method || 'face',
                performedBy: req.user?.username || method || 'face',
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        const staff = await pool.query('SELECT name FROM staff WHERE id = $1', [staffId]);
        const name = staff.rows[0]?.name || 'Unknown';
        log.info(`Check-in: ${name} (staff #${staffId}) via ${method || 'face'}`);
        broadcast('hr:attendance-updated', {
            date: today,
            staffId: Number(staffId),
            action: 'clock_in',
            source: method || 'face',
            staffName: name,
            hrTimeRecord
        }, null, today);
        res.json({ success: true, checkin: result.rows[0], staffName: name, hrTimeRecord });
        // Send check-in notification to chat channel (fire-and-forget after response)
        try {
            const { sendBotMessage } = require('../services/chatService');
            const { broadcastToChannel } = require('../services/websocket');
            const ch = await pool.query("SELECT id FROM chat_channels WHERE slug = 'checkin-log' LIMIT 1");
            if (ch.rows[0]) {
                const channelId = ch.rows[0].id;
                const timeStr = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
                const msg = await sendBotMessage(channelId, `✅ ${name} — прихід ${timeStr}`);
                broadcastToChannel(channelId, 'chat:message', { channelId, message: msg });
            }
        } catch (chatErr) { log.warn('Check-in chat notify failed', chatErr.message); }
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

        const today = getKyivDateStr();
        let result;
        let hrTimeRecord = null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            result = await client.query(
                `UPDATE staff_checkins SET check_out = NOW()
                 WHERE staff_id = $1 AND date = $2
                 RETURNING *`,
                [staffId, today]
            );
            if (result.rows.length > 0) {
                hrTimeRecord = await syncHrClockOutFromStaffCheckout(client, staffId, {
                    today,
                    method: 'face',
                    performedBy: req.user?.username || 'face',
                    ip: req.ip
                });
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No check-in found for today' });
        }
        const staffRes = await pool.query('SELECT name FROM staff WHERE id = $1', [staffId]);
        const name = staffRes.rows[0]?.name || 'Unknown';
        broadcast('hr:attendance-updated', {
            date: today,
            staffId: Number(staffId),
            action: 'clock_out',
            source: 'face',
            staffName: name,
            hrTimeRecord
        }, null, today);
        res.json({ success: true, checkin: result.rows[0], hrTimeRecord });
        // Send checkout notification to chat channel (fire-and-forget after response)
        try {
            const { sendBotMessage } = require('../services/chatService');
            const { broadcastToChannel } = require('../services/websocket');
            const ch = await pool.query("SELECT id FROM chat_channels WHERE slug = 'checkin-log' LIMIT 1");
            if (ch.rows[0]) {
                const channelId = ch.rows[0].id;
                const timeStr = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
                const msg = await sendBotMessage(channelId, `🚪 ${name} — вихід ${timeStr}`);
                broadcastToChannel(channelId, 'chat:message', { channelId, message: msg });
            }
        } catch (chatErr) { log.warn('Checkout chat notify failed', chatErr.message); }
    } catch (err) {
        log.error('POST /checkout error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/staff/checkins — today's check-ins
router.get('/checkins', async (req, res) => {
    try {
        const date = req.query.date || getKyivDateStr();
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

// ==========================================
// ACCOUNT LINKING (v39.1)
// ==========================================

const EXCEL_TO_CRM_ROLE = {
    'Адміністратор': { dept: 'admin', role: 'admin' },
    'Аніматори': { dept: 'animators', role: 'animator' },
    'Арт отдел': { dept: 'admin', role: 'art_director' },
    'Бармени': { dept: 'cafe', role: 'barista' },
    'Батутисти': { dept: 'trampoline', role: 'trampoline_instructor' },
    'Бухгалтер': { dept: 'admin', role: 'accountant' },
    'Гардеробщиці': { dept: 'cleaning', role: 'wardrobe' },
    'Ейчар': { dept: 'admin', role: 'hr' },
    'Керівник': { dept: 'admin', role: 'vice_director' },
    'Кухня повара': { dept: 'cafe', role: 'cook' },
    'Менеджер з продажу': { dept: 'admin', role: 'manager' },
    'Мийка біла та чорна': { dept: 'cleaning', role: 'dishwasher' },
    'Офіціанти': { dept: 'cafe', role: 'waiter' },
    'Охорона': { dept: 'security', role: 'maintenance' },
    'Тех-директор': { dept: 'tech', role: 'it_specialist' },
    'Хозяюшки залу': { dept: 'cleaning', role: 'cleaner' }
};

function staffRoleToAccountRole(roleType) {
    const role = String(roleType || '').trim();
    const aliases = {
        trampoline_instructor: 'animator',
        senior_instructor: 'manager',
        cleaner: 'cleaning',
        pizzaiolo: 'cook',
        technician: 'maintenance',
        head_cook: 'head_chef',
        bartender: 'barista',
        hr_manager: 'hr',
        host: 'animator',
        intern: 'animator'
    };
    const mapped = aliases[role] || role;
    return [
        'waiter', 'dishwasher', 'maintenance', 'cleaning', 'wardrobe', 'barista',
        'security', 'reception', 'animator', 'pastry_chef', 'head_pastry', 'cook',
        'head_chef', 'instructor', 'senior_instructor', 'admin', 'hr', 'it_specialist',
        'marketer', 'art_director', 'accountant', 'manager', 'senior_manager',
        'vice_director', 'director'
    ].includes(mapped) ? mapped : 'animator';
}

// GET /api/staff/link-status — account linking status for all active staff
router.get('/link-status', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id, s.name, s.department, s.position, s.role_type,
                   s.is_freelance, s.excel_department, s.unique_person_key,
                   ep.user_id, ep.id as profile_id,
                   u.username, u.role as user_role, u.name as user_name
            FROM staff s
            LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
            LEFT JOIN users u ON u.id = ep.user_id
            WHERE ${activeOperationalStaffWhere('s')}
            ORDER BY s.department, s.is_freelance, s.name
        `);
        const stats = {
            total: result.rows.length,
            linked: result.rows.filter(r => r.user_id).length,
            unlinked: result.rows.filter(r => !r.user_id && !r.is_freelance).length,
            freelance: result.rows.filter(r => r.is_freelance).length
        };
        res.json({ success: true, data: result.rows, stats });
    } catch (err) {
        log.error('GET /staff/link-status error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/staff/:id/link — thin adapter over canonical employee_profiles bridge
router.post('/:id/link', requireAction('manage_accounts'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const targetAccount = await getAccountForManagement(client, req.body.userId);
        ensureActorCanManageAccount(req.user, targetAccount);
        const link = await linkUserToStaffProfile(client, {
            staffId: req.params.id,
            userId: req.body.userId,
            actor: req.user,
            req,
            eventType: 'staff_overlay_account_linked',
            details: { source: 'staff_schedule_overlay' }
        });
        await client.query('COMMIT');

        log.info(`Staff #${link.staff.id} (${link.staff.name}) linked to user #${link.user.id}`);
        res.json({ success: true, link });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('POST /staff/:id/link error', err);
        const status = err.statusCode || 500;
        res.status(status).json({
            success: false,
            warning: status === 409,
            error: err.statusCode ? err.message : 'Помилка сервера',
            conflict: err.details || null
        });
    } finally {
        client.release();
    }
});

// POST /api/staff/:id/unlink — unlink staff from user account
router.post('/:id/unlink', requireAction('manage_accounts'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const targetAccounts = await getLinkedAccountsForStaffManagement(client, req.params.id);
        targetAccounts.forEach(account => ensureActorCanManageAccount(req.user, account));
        const result = await unlinkStaffAccount(client, {
            staffId: req.params.id,
            actor: req.user,
            req,
            eventType: 'staff_overlay_account_unlinked',
            details: { source: 'staff_schedule_overlay' }
        });
        await client.query('COMMIT');
        res.json({ success: true, result });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('POST /staff/:id/unlink error', err);
        res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/staff/bulk-create-accounts — create one-time credential packets for unlinked staff
router.post('/bulk-create-accounts', requireAction('manage_accounts'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Find all active non-freelance staff without user accounts
        const unlinked = await client.query(`
            SELECT s.id, s.name, s.department, s.role_type, s.unique_person_key
            FROM staff s
            LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true AND ep.user_id IS NOT NULL
            WHERE ${activeOperationalStaffWhere('s')}
              AND s.is_freelance = false
              AND ep.id IS NULL
            ORDER BY s.department, s.name
        `);

        const created = [];
        const skipped = [];
        const seenPersonKeys = new Set();

        for (const staff of unlinked.rows) {
            // Skip duplicates (same person in multiple departments)
            const personKey = staff.unique_person_key?.replace(/\.\w+$/, ''); // strip .mgr suffix
            if (personKey && seenPersonKeys.has(personKey)) {
                skipped.push({ staffId: staff.id, name: staff.name, reason: 'duplicate_person_key', label: 'Дубль: акаунт створюється тільки для основного staff-профілю' });
                continue;
            }
            if (personKey) seenPersonKeys.add(personKey);

            const role = staffRoleToAccountRole(staff.role_type);
            if (!canActorManageAccountRoleSet(req.user, role)) {
                skipped.push({
                    staffId: staff.id,
                    name: staff.name,
                    role,
                    reason: 'protected_account_role',
                    label: 'Account role is protected by account-management policy'
                });
                continue;
            }

            const username = await uniqueUsername(client, suggestUsernameForStaff(staff));
            const password = generateOneTimePassword();
            const passwordHash = await bcrypt.hash(password, 10);
            const hashVerified = await bcrypt.compare(password, passwordHash);
            if (!hashVerified) {
                throw new Error('bulk_account_password_hash_verification_failed');
            }

            const userResult = await client.query(
                'INSERT INTO users (username, password_hash, role, name, password_changed_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, username, name, role',
                [username, passwordHash, role, staff.name]
            );
            const loginCheck = await verifyIssuedCredential({
                client,
                username: userResult.rows[0].username,
                password
            });
            if (!loginCheck.loginReady) {
                throw new Error(`bulk_account_login_ready_check_failed:${loginCheck.reason}`);
            }

            await linkUserToStaffProfile(client, {
                userId: userResult.rows[0].id,
                staffId: staff.id,
                actor: req.user,
                req,
                eventType: 'bulk_account_created_with_staff_link',
                details: { source: 'staff_bulk_create', oneTimeIssued: true }
            });
            await recordAccountSecurityEvent({
                actor: req.user,
                target: userResult.rows[0],
                eventType: 'account_created',
                reason: 'staff_bulk_create',
                details: { role, staffId: staff.id, oneTimeIssued: true, loginReady: loginCheck.loginReady },
                req,
                client
            });

            created.push({
                staffId: staff.id,
                name: staff.name,
                username,
                role,
                department: staff.department,
                loginReady: loginCheck.loginReady,
                loginReadyReason: loginCheck.reason,
                credential: oneTimeCredential(username, password, 'staff_bulk_create')
            });
        }

        await client.query('COMMIT');
        log.info(`Bulk create: ${created.length} accounts created, ${skipped.length} skipped`);
        res.json({
            success: true,
            created,
            skipped,
            credentialsPolicy: {
                oneTimeVisible: true,
                oldPasswordsReadable: false,
                csvExport: false,
                pdfExport: false
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('POST /staff/bulk-create-accounts error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/staff/bulk-pdf — generate PDF with credentials
router.post('/bulk-pdf', requireAction('manage_accounts'), async (req, res) => {
    res.status(410).json({
        success: false,
        error: 'PDF/CSV експорт одноразових паролів вимкнено. Скопіюйте one-time credentials із захищеного результату створення.'
    });
});

// POST /api/staff/import-excel — import staff from Excel file
const multer = require('multer');
const ExcelJS = require('exceljs');
const STAFF_IMPORT_ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xlsm']);
const STAFF_IMPORT_BLOCKED_MIME_TYPES = new Set([
    'application/json',
    'application/pdf',
    'application/x-msdownload',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/svg+xml',
    'text/csv',
    'text/html',
    'text/plain'
]);

function normalizeStaffImportMimeType(value) {
    return String(value || '').toLowerCase().split(';')[0].trim();
}

function validateStaffImportFile(file) {
    const name = String(file?.originalname || '').toLowerCase();
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot) : '';
    const mime = normalizeStaffImportMimeType(file?.mimetype);
    if (!STAFF_IMPORT_ALLOWED_EXTENSIONS.has(ext)) {
        const err = new Error('Підтримуються тільки .xlsx або .xlsm файли');
        err.statusCode = 400;
        throw err;
    }
    if (mime && (STAFF_IMPORT_BLOCKED_MIME_TYPES.has(mime) || mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/'))) {
        const err = new Error('Непідтримуваний MIME-тип Excel файлу');
        err.statusCode = 400;
        throw err;
    }
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        try {
            validateStaffImportFile(file);
            cb(null, true);
        } catch (err) {
            cb(err);
        }
    }
});

function handleStaffImportUpload(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 400);
        res.status(status).json({ success: false, error: err.message || 'Не вдалося завантажити Excel файл' });
    });
}

router.post('/import-excel', requireRole('creator', 'director'), handleStaffImportUpload, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Файл не завантажено' });

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) return res.status(400).json({ success: false, error: 'Порожній Excel файл' });

        const results = { created: 0, updated: 0, skipped: 0, errors: [], entries: [] };
        let currentDept = null;

        sheet.eachRow((row, rowNum) => {
            const cellA = row.getCell(1).text?.trim();
            if (!cellA) return;

            // Check if this is a department header
            const deptMatch = Object.keys(EXCEL_TO_CRM_ROLE).find(d =>
                cellA.toLowerCase().includes(d.toLowerCase())
            );
            if (deptMatch) {
                currentDept = deptMatch;
                return;
            }

            // Skip "Фріланс" rows and headers
            if (cellA.toLowerCase().includes('фріланс') || cellA.toLowerCase().includes('прізвище')) return;

            if (currentDept) {
                const mapping = EXCEL_TO_CRM_ROLE[currentDept];
                results.entries.push({
                    name: cellA,
                    excelDept: currentDept,
                    department: mapping.dept,
                    role: mapping.role,
                    position: currentDept
                });
            }
        });

        // Insert into DB
        for (const entry of results.entries) {
            try {
                const existing = await pool.query(
                    `SELECT id
                     FROM staff
                     WHERE name = $1
                       AND department = $2
                       AND ${activeOperationalStaffWhere('staff')}`,
                    [entry.name, entry.department]
                );
                if (existing.rows.length > 0) {
                    results.updated++;
                } else {
                    const uKey = transliterate(entry.name);
                    await pool.query(
                        `INSERT INTO staff (name, department, position, role_type, excel_department, unique_person_key, is_active)
                         VALUES ($1, $2, $3, $4, $5, $6, true)`,
                        [entry.name, entry.department, entry.position, entry.role, entry.excelDept, uKey]
                    );
                    results.created++;
                }
            } catch (err) {
                results.errors.push(`${entry.name}: ${err.message}`);
                results.skipped++;
            }
        }

        res.json({ success: true, ...results });
    } catch (err) {
        log.error('POST /staff/import-excel error', err);
        res.status(500).json({ success: false, error: 'Помилка парсингу Excel' });
    }
});

// GET /api/staff/account-stats — dashboard widget data
router.get('/account-stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE ${activeOperationalStaffWhere('s')} AND NOT s.is_freelance) as total_staff,
                COUNT(*) FILTER (WHERE ${activeOperationalStaffWhere('s')} AND NOT s.is_freelance AND ep.user_id IS NOT NULL) as with_account,
                COUNT(*) FILTER (WHERE ${activeOperationalStaffWhere('s')} AND NOT s.is_freelance AND ep.user_id IS NULL) as without_account,
                COUNT(*) FILTER (WHERE ${activeOperationalStaffWhere('s')} AND s.is_freelance) as freelance_slots
            FROM staff s
            LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
        `);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('GET /staff/account-stats error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// v33.3: GET /api/staff/payroll — Monthly payroll aggregation
router.get('/payroll', requireRole(...STAFF_PAYROLL_READ_ROLES), async (req, res) => {
    try {
        const month = req.query.month || new Date().toISOString().slice(0, 7);
        const mFrom = req.query.from || `${month}-01`;
        const mTo = req.query.to || `${month}-31`;

        const staff = await pool.query('SELECT * FROM staff WHERE is_active = true ORDER BY department, name LIMIT 1000');
        const payroll = [];

        for (const s of staff.rows) {
            // Count bookings where staff is assigned by real timeline line or second animator.
            // bookings.hosts is the product host count, not a staff id.
            const events = await pool.query(`
                SELECT COUNT(*)::int AS count, COALESCE(SUM(duration), 0)::int AS total_minutes
                FROM bookings
                WHERE (
                    line_id = $1::text
                    OR second_animator = $1::text
                    OR LOWER(BTRIM(COALESCE(second_animator, ''))) = LOWER(BTRIM($4::text))
                )
                  AND date >= $2 AND date <= $3
                  AND status != 'cancelled'
            `, [s.id, mFrom, mTo, s.name]);

            const e = events.rows[0];
            const hoursWorked = Math.round(e.total_minutes / 60 * 10) / 10;
            const hourlyRate = parseFloat(s.hourly_rate) || 0;
            const rateUnit = normalizeStaffRateUnit(s.rate_unit);
            const salary = Math.round(
                rateUnit === 'month'
                    ? (Number(e.count || 0) > 0 || hoursWorked > 0 ? hourlyRate : 0)
                    : rateUnit === 'day'
                        ? (Number(e.count || 0) * hourlyRate)
                        : (hoursWorked * hourlyRate)
            );

            payroll.push({
                staffId: s.id,
                name: s.name,
                department: s.department,
                position: s.position,
                eventsCount: e.count,
                hoursWorked,
                hourlyRate,
                rateUnit,
                salary,
                avgRating: parseFloat(s.avg_rating) || 0
            });
        }

        const totalFOP = payroll.reduce((sum, p) => sum + p.salary, 0);
        res.json({ month, from: mFrom, to: mTo, payroll, totalFOP });
    } catch (err) {
        log.error('GET /staff/payroll error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
