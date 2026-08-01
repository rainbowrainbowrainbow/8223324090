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
 * BULK OPERATIONS: POST /schedule/bulk accepts at most 500 unique staff/date rows,
 * 500 staff members and 31 distinct dates. Copy-week is fixed to 7 dates and 500 staff.
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
const { createLogger } = require('../utils/logger');
const bcrypt = require('bcryptjs');
const { recordAccountSecurityEvent } = require('../services/accountSecurity');
const { broadcast, broadcastLineEvent } = require('../services/websocket');
const {
    getKyivDate,
    getKyivDateStr,
    getScheduledAnimatorLines
} = require('../services/booking');
const { DEFAULT_BUSINESS_CONTEXT } = require('../services/businessContext');
const { lockAttendanceWriteTarget } = require('../services/attendanceWriteLock');
const {
    attendanceFactMinutes,
    hydrateAttendanceRecords,
    recordAttendanceClockIn,
    recordAttendanceClockOut
} = require('../services/hrAttendance');
const {
    normalizeProfessionKey,
    normalizeSecondaryProfessions,
    staffProfessionKeys,
    loadAssignedStaffProfessionKeys
} = require('../services/professions');
const {
    loadHrShiftDayPlan,
    loadHrShiftDayPlansForStaffDates,
    loadPaidRoleValidationContext,
    hydrateHrShiftDayPlans,
    normalizeHrShiftDayPlan,
    validateHrShiftDayPlanProfessions,
    isHrShiftPlanError,
    hrShiftPlanErrorPayload,
    professionCardFromStaff
} = require('../services/hrShiftSegments');
const {
    activeStaffWhere,
    loadStaffScheduleabilityCards,
    scheduleableStaffErrorPayload,
    scheduleableStaffWhere,
    validateStaffScheduleabilityCardForDate,
    validateStaffScheduleableForDate
} = require('../services/staffOperationalFilters');
const { getPayrollRangePreview } = require('../services/payroll');
const { loadStaffOutstandingPayrollInstallments } = require('../services/payrollSettlement');
const {
    loadEnrichedScheduleEntry,
    loadScheduleEntriesForUpdate,
    loadScheduleEntryForUpdate,
    lockScheduleStaffRows,
    mutateStaffScheduleEntry,
    normalizeScheduleDate,
    normalizeScheduleStatus,
    reconcileAnimatorRosterDates,
    recordScheduleAudit,
    recordScheduleStaleRejection,
    rosterMutationDates,
    scheduleDateSequence,
    scheduleStatusNeedsProfession,
    syncHrShiftFromScheduleEntry,
    upsertScheduleMirrorFromPlan,
    validateScheduleBulkEntries,
    validateScheduleWriteStaff
} = require('../services/staffScheduleMutations');
const {
    buildStaffDisplayGroupOptions,
    decorateStaffRowsWithDisplayGroups,
    loadStaffDisplayGroupContext,
    listStaffDisplayGroups,
    listStaffScheduleCategoryContract
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
const {
    professionToAccountRole,
    isProtectedSystemAccount
} = require('../services/accountOnboarding');
const { buildStaffScheduleWorkbookBuffer } = require('../services/staffScheduleWorkbook');

const { requireAction, requireRole, authenticateToken, ROLE_LEVEL, canUseAction } = require('../middleware/auth');
const log = createLogger('Staff');

// v39.8: Security — require authentication for all staff endpoints
router.use(authenticateToken);

const ACCOUNT_MANAGER_PRIMARY_ROLES = new Set(['creator', 'director']);
const STAFF_COPY_WEEK_RAW_DEPARTMENT_ALLOWLIST = new Set(['animators', 'trampoline', 'cafe', 'cleaning']);
const STAFF_COPY_WEEK_MAX_STAFF_IDS = 500;
// Product/API caps: keep batch memory, locks and audit payloads bounded and deterministic.
const STAFF_SCHEDULE_BULK_MAX_ENTRIES = 500;
const STAFF_SCHEDULE_BULK_MAX_DATES = 31;
const STAFF_SCHEDULE_BULK_MAX_STAFF = 500;
const STAFF_COPY_WEEK_DATE_COUNT = 7;
const STAFF_ATTENDANCE_READ_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin', 'accountant'];

function staffPayrollOutstandingBlockerPayload(outstandingInstallments = {}) {
    return {
        success: false,
        code: 'PAYROLL_INSTALLMENTS_OUTSTANDING',
        error: 'Працівника не можна архівувати: є неврегульовані payroll installments',
        blocker: {
            key: 'payroll_installments_outstanding',
            label: 'неврегульовані payroll installments',
            count: Number(outstandingInstallments.count || 0),
            amount: Number(outstandingInstallments.amount || 0)
        },
        outstanding_payroll_installment_count: Number(outstandingInstallments.count || 0),
        outstanding_payroll_installment_amount: Number(outstandingInstallments.amount || 0)
    };
}

function broadcastAnimatorRosterDates(values = [], userId = null) {
    rosterMutationDates(values).forEach(date => {
        broadcastLineEvent('timeline:roster-updated', {
            date,
            businessContext: DEFAULT_BUSINESS_CONTEXT
        }, null);
    });
}

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
    if (!actor || !canUseAction(actor, 'manage_accounts') || !ACCOUNT_MANAGER_PRIMARY_ROLES.has(actor.role)) return false;
    if (roleLevel(primaryRole) < 0 || normalizeAccountRoleSet(extraRoles).some(role => roleLevel(role) < 0)) return false;
    if (actor.role === 'creator') return true;
    const maxTargetLevel = normalizeAccountRoleSet([primaryRole], extraRoles)
        .reduce((max, role) => Math.max(max, roleLevel(role)), -1);
    return maxTargetLevel >= 0 && maxTargetLevel < roleLevel('director');
}

function canActorManageAccount(actor, account) {
    if (!actor || !account || !canUseAction(actor, 'manage_accounts') || !ACCOUNT_MANAGER_PRIMARY_ROLES.has(actor.role)) return false;
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
    if (isProtectedSystemAccount(account)) {
        throw accountManagementError('Protected system account cannot be linked or unlinked');
    }
    if (!canActorManageAccount(actor, account)) {
        throw accountManagementError('Insufficient account-management permissions for this account');
    }
}

function canDisableLinkedStaffAccount(actor, account) {
    return !isProtectedSystemAccount(account)
        && Number(account?.id) !== Number(actor?.id)
        && canActorManageAccount(actor, account);
}

function linkedStaffAccountBlockReason(actor, account = {}) {
    if (isProtectedSystemAccount(account)) return 'protected_system_account';
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

const STAFF_SHIFT_PREFERENCE_DAY_TYPE_KEYS = ['weekday', 'weekend'];
const STAFF_SHIFT_PREFERENCE_DAY_TYPES = new Set(STAFF_SHIFT_PREFERENCE_DAY_TYPE_KEYS);
const STAFF_SHIFT_PREFERENCE_MAX_ITEMS = 100;

function normalizeShiftPreferenceDayType(value) {
    const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
    if (['weekday', 'weekdays', 'workday', 'workdays'].includes(raw)) return 'weekday';
    if (['weekend', 'weekends'].includes(raw)) return 'weekend';
    return null;
}

function normalizeShiftPreferenceTime(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function formatShiftPreferenceTime(value) {
    if (!value) return null;
    return String(value).slice(0, 5);
}

function mapStaffShiftPreferenceRow(row = {}) {
    const startTime = formatShiftPreferenceTime(row.start_time);
    const endTime = formatShiftPreferenceTime(row.end_time);
    return {
        id: Number(row.id) || null,
        staff_id: Number(row.staff_id) || null,
        staffId: Number(row.staff_id) || null,
        profession_key: row.profession_key || '',
        professionKey: row.profession_key || '',
        day_type: row.day_type || '',
        dayType: row.day_type || '',
        start_time: startTime,
        startTime,
        end_time: endTime,
        endTime,
        is_active: row.is_active !== false,
        isActive: row.is_active !== false,
        created_at: row.created_at || null,
        createdAt: row.created_at || null,
        updated_at: row.updated_at || null,
        updatedAt: row.updated_at || null
    };
}

function shiftPreferenceItemsFromBody(body = {}) {
    const items = body.preferences ?? body.shiftPreferences ?? body.data;
    return Array.isArray(items) ? items : null;
}

function validateStaffShiftPreferencePayload(staff = {}, items = [], options = {}) {
    if (!Array.isArray(items)) {
        return { ok: false, status: 400, error: 'preferences must be an array' };
    }
    if (items.length > STAFF_SHIFT_PREFERENCE_MAX_ITEMS) {
        return { ok: false, status: 400, error: `maximum ${STAFF_SHIFT_PREFERENCE_MAX_ITEMS} preferences per request` };
    }
    const allowedProfessions = Array.isArray(options.allowedProfessions)
        ? options.allowedProfessions
        : staffProfessionKeys(staff);
    const allowedProfessionSet = new Set(allowedProfessions);
    const seen = new Set();
    const preferences = [];

    for (const item of items) {
        const professionKey = normalizeProfessionKey(item?.profession_key ?? item?.professionKey ?? item?.role_type ?? item?.roleType);
        const dayType = normalizeShiftPreferenceDayType(item?.day_type ?? item?.dayType);
        const startTime = normalizeShiftPreferenceTime(item?.start_time ?? item?.startTime ?? item?.shiftStart ?? item?.planned_start);
        const endTime = normalizeShiftPreferenceTime(item?.end_time ?? item?.endTime ?? item?.shiftEnd ?? item?.planned_end);
        const key = `${professionKey}:${dayType}`;
        const isActive = item?.is_active === false || item?.isActive === false ? false : true;

        if (!professionKey) {
            return { ok: false, status: 400, error: 'professionKey is required' };
        }
        if (!allowedProfessionSet.has(professionKey)) {
            return {
                ok: false,
                status: 400,
                error: `profession "${professionKey}" is not available for this staff member`,
                allowedProfessions
            };
        }
        if (!STAFF_SHIFT_PREFERENCE_DAY_TYPES.has(dayType)) {
            return { ok: false, status: 400, error: 'dayType must be weekday or weekend' };
        }
        if (!startTime || !endTime) {
            return { ok: false, status: 400, error: 'startTime and endTime must be valid HH:MM values' };
        }
        if (startTime === endTime) {
            return { ok: false, status: 400, error: 'startTime and endTime must be different' };
        }
        if (seen.has(key)) {
            return { ok: false, status: 400, error: `duplicate preference for ${key}` };
        }
        seen.add(key);
        preferences.push({ professionKey, dayType, startTime, endTime, isActive });
    }

    return { ok: true, allowedProfessions, preferences };
}

async function loadStaffForShiftPreferences(db, staffId, options = {}) {
    const id = Number(staffId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const result = await db.query(
        `SELECT id, name, role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions, is_active
         FROM staff
         WHERE id = $1
         ${options.forUpdate ? 'FOR UPDATE' : ''}`,
        [id]
    );
    return result.rows[0] || null;
}

async function loadStaffShiftPreferences(db, staffId, options = {}) {
    const params = [staffId];
    let professionFilter = '';
    if (Array.isArray(options.professionKeys) && options.professionKeys.length === 0) {
        return [];
    }
    if (Array.isArray(options.professionKeys) && options.professionKeys.length) {
        params.push(options.professionKeys);
        professionFilter = ` AND profession_key = ANY($${params.length}::text[])`;
    }
    const result = await db.query(
        `SELECT id, staff_id, profession_key, day_type, start_time, end_time, is_active, created_at, updated_at
         FROM staff_shift_preferences
         WHERE staff_id = $1
         ${professionFilter}
         ORDER BY profession_key,
                  CASE day_type WHEN 'weekday' THEN 1 WHEN 'weekend' THEN 2 ELSE 3 END`,
        params
    );
    return result.rows.map(mapStaffShiftPreferenceRow);
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

async function insertHrAuditLog(client, action, staffId, performedBy, details, ipAddress) {
    await client.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [action, staffId || null, performedBy || null, details ? JSON.stringify(details) : null, ipAddress || null]
    );
}

function staffScheduleStatusForShift(shiftType) {
    return shiftType === 'remote' ? 'remote' : 'working';
}

function replacementNote(originalName, reason) {
    const safeName = String(originalName || '').trim() || 'працівника';
    const safeReason = String(reason || '').trim();
    return `Заміна за ${safeName}${safeReason ? `: ${safeReason}` : ''}`;
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

function sendHrShiftSyncError(res, result, extra = {}) {
    if (result?.validation) {
        return res.status(result.status || 400).json(scheduleableStaffErrorPayload(result.validation, extra));
    }
    return res.status(result?.status || 400).json({
        success: false,
        code: result?.code || 'HR_SHIFT_PLAN_INVALID',
        error: result?.error || 'Некоректний денний план зміни',
        details: result?.details,
        ...extra
    });
}

function copyableDayPlanPayload(loadedPlan) {
    if (!loadedPlan?.plan) return null;
    return {
        primaryProfessionKey: loadedPlan.plan.primaryProfessionKey,
        segments: loadedPlan.plan.segments.map(segment => ({
            professionKey: segment.professionKey,
            shiftStart: segment.shiftStart,
            shiftEnd: segment.shiftEnd,
            breakMinutes: segment.breakMinutes,
            note: segment.note,
            additionalRoles: (segment.additionalRoles || []).map(role => ({ ...role })),
            additionalProfessionKeys: [...(segment.additionalProfessionKeys || [])],
            paidAdditionalProfessionKeys: [...(segment.paidAdditionalProfessionKeys || [])]
        }))
    };
}

function dayPlanHasPaidAdditionalRoles(plan = null) {
    return (plan?.segments || []).some(segment =>
        (segment.paidAdditionalProfessionKeys || segment.paid_additional_profession_keys || []).length > 0
        ||
        (segment.additionalRoles || segment.additional_roles || [])
            .some(role => (role.compensationMode || role.compensation_mode) === 'paid_hourly'));
}

function scheduleEntryWithDayPlan(entry, plan = null) {
    const publicEntry = { ...(entry || {}) };
    const planUpdatedAt = publicEntry.hr_plan_updated_at
        || publicEntry.plan_updated_at_token
        || null;
    const hrShiftUpdatedAt = publicEntry.hr_shift_updated_at || null;
    delete publicEntry.hr_profession_key;
    delete publicEntry.hr_planned_start;
    delete publicEntry.hr_planned_end;
    delete publicEntry.hr_break_minutes;
    delete publicEntry.hr_shift_type;
    delete publicEntry.hr_segments;
    delete publicEntry.hr_plan_updated_at;
    delete publicEntry.plan_updated_at_token;
    delete publicEntry.hr_shift_updated_at;
    const primaryProfessionKey = plan?.primaryProfessionKey || null;
    const professionKeys = plan?.professionKeys || [];
    const plannedMinutes = plan?.plannedMinutes || 0;
    const plannedStart = plan?.plannedStart || publicEntry.shift_start || null;
    const plannedEnd = plan?.plannedEnd || publicEntry.shift_end || null;
    return {
        ...publicEntry,
        shift_start: plannedStart,
        shift_end: plannedEnd,
        primaryProfessionKey,
        primary_profession_key: primaryProfessionKey,
        segments: plan?.segments?.map(segment => ({
            id: segment.id ?? null,
            professionKey: segment.professionKey,
            shiftStart: segment.shiftStart,
            shiftEnd: segment.shiftEnd,
            breakMinutes: segment.breakMinutes,
            note: segment.note,
            additionalRoles: (segment.additionalRoles || []).map(role => ({
                ...role,
                countsAsPhysicalTime: false
            })),
            additionalProfessionKeys: [...(segment.additionalProfessionKeys || [])],
            paidAdditionalProfessionKeys: [...(segment.paidAdditionalProfessionKeys || [])],
            countsAsPhysicalTime: true,
            physicalTimeSource: 'segment'
        })) || [],
        professionKeys,
        profession_keys: professionKeys,
        plannedMinutes,
        planned_minutes: plannedMinutes,
        gapMinutes: plan?.gapMinutes || 0,
        planUpdatedAt,
        plan_updated_at: planUpdatedAt,
        hrShiftUpdatedAt,
        hr_shift_updated_at: hrShiftUpdatedAt
    };
}

function parseScheduleAggregatedSegments(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function planFromAggregatedScheduleRow(row = {}) {
    if (!Object.prototype.hasOwnProperty.call(row, 'hr_segments') || !row.hr_shift_id) return null;
    const segments = parseScheduleAggregatedSegments(row.hr_segments);
    const status = normalizeScheduleStatus(row.status, 'working') || 'working';
    const payload = segments.length
        ? {
            primaryProfessionKey: row.hr_profession_key || row.profession_key,
            segments
        }
        : {
            professionKey: row.hr_profession_key || row.profession_key,
            shiftStart: row.hr_planned_start || row.shift_start,
            shiftEnd: row.hr_planned_end || row.shift_end,
            breakMinutes: row.hr_break_minutes ?? 0
        };
    return normalizeHrShiftDayPlan(payload, { status, strictProfessionKeys: false });
}

async function attachScheduleDayPlans(rows = [], db = pool) {
    const parentRows = rows
        .filter(row => row.hr_shift_id && !Object.prototype.hasOwnProperty.call(row, 'hr_segments'))
        .map(row => ({
            id: row.hr_shift_id,
            staff_id: row.staff_id,
            shift_date: row.date,
            profession_key: row.hr_profession_key || row.profession_key,
            planned_start: row.hr_planned_start || row.shift_start,
            planned_end: row.hr_planned_end || row.shift_end,
            break_minutes: row.hr_break_minutes ?? 0,
            shift_type: row.hr_shift_type || (row.status === 'remote' ? 'remote' : 'regular')
        }));
    const hydrated = await hydrateHrShiftDayPlans(db, parentRows);
    const planByShiftId = new Map(hydrated.map(item => [Number(item.shift.id), item.plan]));

    return rows.map(row => {
        let plan = planFromAggregatedScheduleRow(row)
            || planByShiftId.get(Number(row.hr_shift_id))
            || null;
        if (!plan && scheduleStatusNeedsProfession(row.status)
            && row.profession_key && row.shift_start && row.shift_end) {
            try {
                plan = normalizeHrShiftDayPlan({
                    professionKey: row.profession_key,
                    shiftStart: row.shift_start,
                    shiftEnd: row.shift_end,
                    breakMinutes: 0
                }, { status: row.status });
            } catch (error) {
                if (!isHrShiftPlanError(error)) throw error;
            }
        }
        return scheduleEntryWithDayPlan(row, plan);
    });
}

/**
 * Send Telegram notification when schedule changes.
 * Mentions employee by @telegram_username if set.
 * Fire-and-forget — does not block API response.
 */
function scheduleNotificationBlocks(plan, status, shiftStart, shiftEnd) {
    const segments = Array.isArray(plan?.segments) ? plan.segments : [];
    if (segments.length) {
        return segments.map(segment => {
            const additional = (segment.additionalProfessionKeys || []).length
                ? ` + ${segment.additionalProfessionKeys.join(', ')}`
                : '';
            const breakInfo = Number(segment.breakMinutes || 0) > 0
                ? `, перерва ${Number(segment.breakMinutes)} хв`
                : '';
            return `${segment.shiftStart}–${segment.shiftEnd} · ${segment.professionKey}${additional}${breakInfo}`;
        });
    }
    if (['working', 'remote'].includes(status) && shiftStart && shiftEnd) {
        return [`${String(shiftStart).slice(0, 5)}–${String(shiftEnd).slice(0, 5)}`];
    }
    return [];
}

async function notifyScheduleChange(staffId, date, status, shiftStart, shiftEnd, plan = null) {
    try {
        const staff = await pool.query('SELECT name, telegram_username FROM staff WHERE id = $1', [staffId]);
        if (staff.rows.length === 0) return;
        const { name, telegram_username } = staff.rows[0];

        const mention = telegram_username ? `@${telegram_username}` : `<b>${name}</b>`;
        const statusLabel = STATUS_UK[status] || status;
        const blocks = scheduleNotificationBlocks(plan, status, shiftStart, shiftEnd);
        const timeInfo = blocks.length ? `\n⏱ ${blocks.join('\n⏱ ')}` : '';

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
async function notifyBulkScheduleChange(staffIdSet, count, changes = []) {
    try {
        if (staffIdSet.size === 0) return;
        const ids = Array.from(staffIdSet);
        const result = await pool.query(
            'SELECT id, name, telegram_username FROM staff WHERE id = ANY($1)',
            [ids]
        );
        const allMentions = result.rows.map(r =>
            r.telegram_username ? `@${r.telegram_username}` : r.name
        );
        const mentionLimit = 30;
        const mentions = allMentions.slice(0, mentionLimit);
        if (allMentions.length > mentionLimit) mentions.push(`… +${allMentions.length - mentionLimit}`);
        const staffById = new Map(result.rows.map(row => [Number(row.id), row]));
        const detailLimit = 20;
        const details = changes.slice(0, detailLimit).map(change => {
            const staffRow = staffById.get(Number(change.staffId));
            const staffLabel = staffRow?.telegram_username ? `@${staffRow.telegram_username}` : (staffRow?.name || `#${change.staffId}`);
            const blocks = scheduleNotificationBlocks(
                change.plan,
                change.plan?.status,
                change.plan?.plannedStart,
                change.plan?.plannedEnd
            );
            return `• ${change.date} · ${staffLabel}${blocks.length ? ` · ${blocks.join('; ')}` : ''}`;
        });
        if (changes.length > detailLimit) details.push(`… ще ${changes.length - detailLimit} записів`);
        const text = `📅 Графік оновлено (${count} записів)\n👥 ${mentions.join(', ')}`
            + (details.length ? `\n${details.join('\n')}` : '');
        const telegramText = text.length > 3900 ? `${text.slice(0, 3870)}\n…` : text;
        const chatId = await getConfiguredChatId();
        if (chatId) {
            sendTelegramMessage(chatId, telegramText).catch(err => log.error('Bulk schedule notify error', err));
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
    res.json({
        success: true,
        data: listStaffDisplayGroups(),
        scheduleCategoryContract: listStaffScheduleCategoryContract()
    });
});

// ==========================================
// SCHEDULE ROUTES (must be before /:id to avoid param capture)
// ==========================================

// GET /api/staff/schedule — get schedule for date range
router.get('/schedule', requireAction('hr.schedule.view'), async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            return res.status(400).json({ success: false, error: 'Потрібні параметри from та to' });
        }
        const result = await pool.query(
            `SELECT ss.*, ss.date::text AS date,
                    CASE WHEN ss.status = 'day_off' THEN 'dayoff' ELSE ss.status END AS status,
                    s.name, s.department, s.position, s.color, s.is_active,
                    s.role_type, s.company_structure_node_id,
                    COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                    hs.id AS hr_shift_id,
                    hs.profession_key AS hr_profession_key,
                    hs.planned_start AS hr_planned_start,
                    hs.planned_end AS hr_planned_end,
                    hs.break_minutes AS hr_break_minutes,
                    hs.shift_type AS hr_shift_type,
                    hs.updated_at AS hr_shift_updated_at,
                    to_char(
                        COALESCE(hs.updated_at, hs.created_at) AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                    ) AS hr_plan_updated_at,
                    hs.original_staff_id,
                    original_staff.name AS original_staff_name,
                    hs.replacement_reason,
                    hs.replaced_by,
                    hs.replaced_at,
                    COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', hss.id,
                                'professionKey', hss.profession_key,
                                'shiftStart', LEFT(hss.planned_start::text, 5),
                                'shiftEnd', LEFT(hss.planned_end::text, 5),
                                'breakMinutes', hss.break_minutes,
                                'note', hss.notes,
                                'additionalRoles', COALESCE((
                                    SELECT jsonb_agg(
                                        jsonb_build_object(
                                            'professionKey', hssr.profession_key,
                                            'compensationMode', hssr.compensation_mode,
                                            'payMultiplier', hssr.pay_multiplier,
                                            'policyVersion', hssr.policy_version
                                        )
                                        ORDER BY hssr.profession_key
                                    )
                                    FROM hr_shift_segment_roles hssr
                                    WHERE hssr.segment_id = hss.id
                                ), '[]'::jsonb),
                                'additionalProfessionKeys', COALESCE((
                                    SELECT jsonb_agg(hssr.profession_key ORDER BY hssr.profession_key)
                                    FROM hr_shift_segment_roles hssr
                                    WHERE hssr.segment_id = hss.id
                                ), '[]'::jsonb)
                            )
                            ORDER BY hss.sort_order, hss.id
                        )
                        FROM hr_shift_segments hss
                        WHERE hss.hr_shift_id = hs.id
                    ), '[]'::jsonb) AS hr_segments
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             LEFT JOIN hr_shifts hs ON hs.staff_id = ss.staff_id AND hs.shift_date::text = LEFT(ss.date::text, 10)
             LEFT JOIN staff original_staff ON original_staff.id = hs.original_staff_id
             WHERE ss.date >= $1 AND ss.date <= $2
               AND ${activeScheduleStaffWhere('s', 'ss.date')}
             ORDER BY s.department, s.name, ss.date`,
            [from, to]
        );
        const displayGroupContext = await loadStaffDisplayGroupContext(pool);
        const rowsWithPlans = await attachScheduleDayPlans(result.rows);
        const rows = decorateStaffRowsWithDisplayGroups(rowsWithPlans, { displayGroupContext });
        res.json({
            success: true,
            data: rows,
            displayGroups: listStaffDisplayGroups(),
            scheduleCategoryContract: listStaffScheduleCategoryContract()
        });
    } catch (err) {
        log.error('GET /staff/schedule error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/staff/schedule/export-xlsx — render the current visible schedule as a real multi-sheet workbook
router.post('/schedule/export-xlsx', requireAction('hr.schedule.view'), async (req, res) => {
    try {
        const { buffer, filename } = await buildStaffScheduleWorkbookBuffer(req.body || {});
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(buffer);
    } catch (err) {
        const status = err.statusCode === 400 ? 400 : 500;
        if (status === 500) log.error('POST /staff/schedule/export-xlsx error', err);
        res.status(status).json({
            success: false,
            error: status === 400 ? err.message : 'Не вдалося сформувати Excel-файл'
        });
    }
});

// PUT /api/staff/schedule — upsert a single schedule entry
router.put('/schedule', requireAction('hr.schedule.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { staffId, date, status, note } = req.body;
        if (!staffId || !date) {
            return res.status(400).json({ success: false, error: 'Потрібні staffId та date' });
        }
        const scheduleStatus = normalizeScheduleStatus(status, 'working');
        if (!scheduleStatus) {
            return res.status(400).json({ success: false, error: 'Невідомий статус графіка' });
        }
        await client.query('BEGIN');
        const mutation = await mutateStaffScheduleEntry(client, {
            ...req.body,
            staffId,
            date,
            status: scheduleStatus,
            note
        }, {
            actor: { user: req.user, ip: req.ip },
            source: 'staff.schedule.put',
            auditAction: 'staff_schedule_update',
            requireExpectedUpdatedAt: true
        });
        if (!mutation.ok) {
            await client.query('ROLLBACK');
            if (mutation.code === 'HR_SHIFT_PLAN_STALE') {
                await recordScheduleStaleRejection(
                    pool,
                    staffId,
                    date,
                    { user: req.user, ip: req.ip },
                    { ...mutation.details, source: 'staff.schedule.put' }
                ).catch(auditError => log.error('Staff schedule stale rejection audit error', auditError));
            }
            return sendHrShiftSyncError(res, mutation, { entry: { staffId, date } });
        }
        await reconcileAnimatorRosterDates(client, [date]);
        await client.query('COMMIT');
        // Fire-and-forget Telegram notification
        notifyScheduleChange(staffId, date, mutation.plan.status, mutation.plan.plannedStart, mutation.plan.plannedEnd, mutation.plan);
        broadcastAnimatorRosterDates([date], req.user?.id);
        res.json({
            success: true,
            data: scheduleEntryWithDayPlan({
                ...mutation.entry,
                hr_plan_updated_at: mutation.shift?.plan_updated_at_token,
                hr_shift_updated_at: mutation.shift?.updated_at
            }, mutation.plan)
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isHrShiftPlanError(err)) {
            return res.status(err.statusCode || err.status || 400).json(hrShiftPlanErrorPayload(err));
        }
        log.error('PUT /staff/schedule error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// GET /api/staff/schedule/history/:staffId/:date — explicit audit trail for one schedule cell
router.get('/schedule/history/:staffId/:date', requireAction('hr.schedule.view'), async (req, res) => {
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
router.post('/schedule/:id/replace', requireAction('hr.schedule.manage'), async (req, res) => {
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
             WHERE ss.id = $1`,
            [scheduleId]
        );
        if (!scheduleResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Слот графіка не знайдено' });
        }
        let schedule = scheduleResult.rows[0];
        let date = normalizeScheduleDate(schedule.date);
        let status = schedule.status || 'working';
        if (!['working', 'remote'].includes(status) || !schedule.shift_start || !schedule.shift_end) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміну можна виставити тільки для робочого слота з часом' });
        }
        if (Number(schedule.staff_id) === replacementStaffId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміна на того самого працівника не потрібна' });
        }

        await lockScheduleStaffRows(client, [schedule.staff_id, replacementStaffId]);
        const freshScheduleResult = await client.query(
            `SELECT ss.*, ss.date::text AS date, s.name AS staff_name, s.role_type
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             WHERE ss.id = $1`,
            [scheduleId]
        );
        if (!freshScheduleResult.rows.length
            || Number(freshScheduleResult.rows[0].staff_id) !== Number(schedule.staff_id)
            || normalizeScheduleDate(freshScheduleResult.rows[0].date) !== date) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Слот графіка був оновлений паралельно; повторіть запит'
            });
        }
        schedule = freshScheduleResult.rows[0];
        date = normalizeScheduleDate(schedule.date);
        status = schedule.status || 'working';
        if (!['working', 'remote'].includes(status) || !schedule.shift_start || !schedule.shift_end) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміну можна виставити тільки для робочого слота з часом' });
        }
        if (Number(schedule.staff_id) === replacementStaffId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'Підміна на того самого працівника не потрібна' });
        }
        const replacementValidation = await validateScheduleWriteStaff(client, replacementStaffId, date, {
            forUpdate: false
        });
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

        let sourcePlan = await loadHrShiftDayPlan(client, {
            staffId: schedule.staff_id,
            shiftDate: date
        }, { forUpdate: true });
        if (!sourcePlan) {
            const legacySync = await syncHrShiftFromScheduleEntry(client, {
                staffId: schedule.staff_id,
                date,
                shiftStart: schedule.shift_start,
                shiftEnd: schedule.shift_end,
                status,
                note: schedule.note || null,
                professionKey: schedule.profession_key || schedule.role_type
            }, req.user?.username || null);
            if (legacySync?.ok === false) {
                await client.query('ROLLBACK');
                return sendHrShiftSyncError(res, legacySync, {
                    entry: { staffId: schedule.staff_id, date, scheduleId }
                });
            }
            sourcePlan = { shift: legacySync.shift, plan: legacySync.plan };
        }
        const lockedScheduleResult = await client.query(
            `SELECT id, staff_id, date::text AS date
             FROM staff_schedule
             WHERE id = $1
             FOR UPDATE`,
            [scheduleId]
        );
        if (!lockedScheduleResult.rows.length
            || Number(lockedScheduleResult.rows[0].staff_id) !== Number(schedule.staff_id)
            || normalizeScheduleDate(lockedScheduleResult.rows[0].date) !== date) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Слот графіка був оновлений паралельно; повторіть запит'
            });
        }
        await validateHrShiftDayPlanProfessions(client, replacementStaffId, sourcePlan.plan);
        const currentShift = sourcePlan.shift;

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
                updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [
                replacementStaffId,
                reason,
                req.user?.username || null,
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
            beforePlan: sourcePlan.plan,
            afterPlan: null,
            force: true
        });
        await recordScheduleAudit(client, 'staff_schedule_replacement_set', replacementStaffId, date, replacementPrevious, enriched, req, {
            source: 'staff.schedule.replace',
            originalStaffId,
            reason,
            beforePlan: null,
            afterPlan: sourcePlan.plan,
            force: true
        });
        await reconcileAnimatorRosterDates(client, [date]);
        await client.query('COMMIT');

        notifyScheduleChange(
            replacementStaffId,
            date,
            staffScheduleStatusForShift(updatedShift.rows[0].shift_type),
            updatedShift.rows[0].planned_start,
            updatedShift.rows[0].planned_end,
            sourcePlan.plan
        );
        broadcastAnimatorRosterDates([date], req.user?.id);
        res.json({
            success: true,
            data: scheduleEntryWithDayPlan(enriched, sourcePlan.plan),
            replacement: replacement.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isHrShiftPlanError(err)) {
            return res.status(err.statusCode || err.status || 400).json(hrShiftPlanErrorPayload(err));
        }
        log.error('POST /staff/schedule/:id/replace error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

// POST /api/staff/schedule/:id/replacement-clear — return a replacement slot to the original worker
router.post('/schedule/:id/replacement-clear', requireAction('hr.schedule.manage'), async (req, res) => {
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
             WHERE ss.id = $1`,
            [scheduleId]
        );
        if (!scheduleResult.rows.length || !scheduleResult.rows[0].original_staff_id) {
            await client.query('ROLLBACK');
            return res.status(409).json({ success: false, error: 'У цьому слоті немає активної підміни' });
        }
        let schedule = scheduleResult.rows[0];
        let date = normalizeScheduleDate(schedule.date);
        let originalStaffId = Number(schedule.original_staff_id);

        await lockScheduleStaffRows(client, [schedule.staff_id, originalStaffId]);
        const freshScheduleResult = await client.query(
            `SELECT ss.*, ss.date::text AS date, hs.id AS hr_shift_id, hs.original_staff_id,
                    hs.planned_start, hs.planned_end, hs.shift_type, hs.notes, hs.profession_key
             FROM staff_schedule ss
             JOIN hr_shifts hs ON hs.staff_id = ss.staff_id AND hs.shift_date::text = LEFT(ss.date::text, 10)
             WHERE ss.id = $1`,
            [scheduleId]
        );
        const freshSchedule = freshScheduleResult.rows[0];
        if (!freshSchedule
            || !freshSchedule.original_staff_id
            || Number(freshSchedule.staff_id) !== Number(schedule.staff_id)
            || normalizeScheduleDate(freshSchedule.date) !== date
            || Number(freshSchedule.hr_shift_id) !== Number(schedule.hr_shift_id)
            || Number(freshSchedule.original_staff_id) !== originalStaffId) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Підміна була оновлена паралельно; повторіть запит'
            });
        }
        schedule = freshSchedule;
        date = normalizeScheduleDate(schedule.date);
        originalStaffId = Number(schedule.original_staff_id);
        const originalValidation = await validateScheduleWriteStaff(client, originalStaffId, date, {
            forUpdate: false
        });
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
        const currentPlan = await loadHrShiftDayPlan(client, {
            hrShiftId: schedule.hr_shift_id
        }, { forUpdate: true });
        if (!currentPlan) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'HR-зміну для підміни не знайдено' });
        }
        if (Number(currentPlan.shift.staff_id) !== Number(schedule.staff_id)
            || Number(currentPlan.shift.original_staff_id) !== originalStaffId
            || normalizeScheduleDate(currentPlan.shift.shift_date) !== date) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Підміна була оновлена паралельно; повторіть запит'
            });
        }
        const lockedScheduleResult = await client.query(
            `SELECT id, staff_id, date::text AS date
             FROM staff_schedule
             WHERE id = $1
             FOR UPDATE`,
            [scheduleId]
        );
        if (!lockedScheduleResult.rows.length
            || Number(lockedScheduleResult.rows[0].staff_id) !== Number(schedule.staff_id)
            || normalizeScheduleDate(lockedScheduleResult.rows[0].date) !== date) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Підміна була оновлена паралельно; повторіть запит'
            });
        }
        await validateHrShiftDayPlanProfessions(client, originalStaffId, currentPlan.plan);

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
            beforePlan: currentPlan.plan,
            afterPlan: null,
            force: true
        });
        await recordScheduleAudit(client, 'staff_schedule_replacement_restored', originalStaffId, date, originalPrevious, enriched, req, {
            source: 'staff.schedule.replacement_clear',
            replacementStaffId: schedule.staff_id,
            beforePlan: null,
            afterPlan: currentPlan.plan,
            force: true
        });
        await reconcileAnimatorRosterDates(client, [date]);
        await client.query('COMMIT');

        notifyScheduleChange(
            originalStaffId,
            date,
            staffScheduleStatusForShift(restoredShift.rows[0].shift_type),
            restoredShift.rows[0].planned_start,
            restoredShift.rows[0].planned_end,
            currentPlan.plan
        );
        broadcastAnimatorRosterDates([date], req.user?.id);
        res.json({
            success: true,
            data: scheduleEntryWithDayPlan(enriched, currentPlan.plan),
            original: original.rows[0]
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (isHrShiftPlanError(err)) {
            return res.status(err.statusCode || err.status || 400).json(hrShiftPlanErrorPayload(err));
        }
        log.error('POST /staff/schedule/:id/replacement-clear error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    } finally {
        client.release();
    }
});

router.post('/schedule/bulk', requireAction('hr.schedule.manage'), async (req, res) => {
    try {
        const { entries } = req.body;
        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ success: false, error: 'Потрібен масив entries' });
        }
        if (entries.length > STAFF_SCHEDULE_BULK_MAX_ENTRIES) {
            return res.status(400).json({ success: false, error: `Максимум ${STAFF_SCHEDULE_BULK_MAX_ENTRIES} записів за раз` });
        }
        const validatedEntries = validateScheduleBulkEntries(entries);
        if (!validatedEntries.ok) {
            return res.status(validatedEntries.status || 400).json({
                success: false,
                error: validatedEntries.error,
                code: validatedEntries.code,
                details: validatedEntries.details
            });
        }
        const bulkStaffIds = [...new Set(validatedEntries.entries.map(entry => entry.staffId))];
        const bulkDates = [...new Set(validatedEntries.entries.map(entry => entry.date))];
        if (bulkStaffIds.length > STAFF_SCHEDULE_BULK_MAX_STAFF || bulkDates.length > STAFF_SCHEDULE_BULK_MAX_DATES) {
            return res.status(400).json({
                success: false,
                code: 'SCHEDULE_BULK_CAP_EXCEEDED',
                error: `Bulk підтримує максимум ${STAFF_SCHEDULE_BULK_MAX_STAFF} працівників і ${STAFF_SCHEDULE_BULK_MAX_DATES} дат`
            });
        }
        let count = 0;
        const affectedStaff = new Set();
        const affectedDates = new Set();
        const notificationChanges = [];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const orderedEntries = [...validatedEntries.entries].sort((left, right) =>
                Number(left.staffId) - Number(right.staffId)
                || String(left.date || '').localeCompare(String(right.date || '')));
            await lockScheduleStaffRows(client, orderedEntries.map(entry => entry.staffId));
            const staffCards = await loadStaffScheduleabilityCards(client, bulkStaffIds);
            const previousPlans = await loadHrShiftDayPlansForStaffDates(client, orderedEntries);
            const previousScheduleEntries = await loadScheduleEntriesForUpdate(client, orderedEntries);
            const paidRoleValidationContext = orderedEntries.some(dayPlanHasPaidAdditionalRoles)
                ? await loadPaidRoleValidationContext(client, bulkStaffIds)
                : undefined;
            for (const e of orderedEntries) {
                const staffRow = staffCards.get(Number(e.staffId)) || null;
                const staffValidation = validateStaffScheduleabilityCardForDate(staffRow, e.date);
                const mutation = await mutateStaffScheduleEntry(client, {
                    ...e,
                    staffId: e.staffId,
                    date: e.date,
                    note: e.note || null
                }, {
                    actor: { user: req.user, ip: req.ip },
                    source: 'staff.schedule.bulk',
                    auditAction: 'staff_schedule_bulk_update',
                    sourceMetadata: { batchSize: entries.length },
                    loadEnriched: false,
                    auditWithEnriched: false,
                    forUpdate: false,
                    // Bulk owns ordered locks and reads each target inside this transaction.
                    requireExpectedUpdatedAt: false,
                    ignoreExpectedUpdatedAt: true,
                    staffValidation,
                    professionCard: professionCardFromStaff(staffRow),
                    paidRoleValidationContext,
                    previousPlan: previousPlans.get(`${e.staffId}:${e.date}`) || null,
                    previousScheduleEntry: previousScheduleEntries.get(`${e.staffId}:${e.date}`) || null
                });
                if (!mutation.ok) {
                    await client.query('ROLLBACK');
                    return sendHrShiftSyncError(res, mutation, {
                        entry: { staffId: e.staffId, date: e.date }
                    });
                }
                affectedStaff.add(e.staffId);
                affectedDates.add(mutation.date);
                notificationChanges.push({
                    staffId: e.staffId,
                    date: mutation.date,
                    plan: mutation.plan
                });
                count++;
            }
            await reconcileAnimatorRosterDates(client, [...affectedDates]);
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        // Fire-and-forget: bulk notification summary
        notifyBulkScheduleChange(affectedStaff, count, notificationChanges);
        broadcastAnimatorRosterDates([...affectedDates], req.user?.id);
        res.json({ success: true, count });
    } catch (err) {
        if (isHrShiftPlanError(err)) {
            return res.status(err.statusCode || err.status || 400).json(hrShiftPlanErrorPayload(err));
        }
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
router.post('/schedule/copy-week', requireAction('hr.schedule.manage'), async (req, res) => {
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
        const normalizedFromMonday = normalizeScheduleDate(fromMonday);
        const normalizedToMonday = normalizeScheduleDate(toMonday);
        if (!normalizedFromMonday || String(fromMonday).trim() !== normalizedFromMonday
            || !normalizedToMonday || String(toMonday).trim() !== normalizedToMonday) {
            return res.status(400).json({
                success: false,
                error: 'fromMonday та toMonday мають бути валідними календарними датами YYYY-MM-DD',
                code: 'SCHEDULE_COPY_WEEK_DATE_INVALID'
            });
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
        const fromDates = scheduleDateSequence(normalizedFromMonday, STAFF_COPY_WEEK_DATE_COUNT);
        const toDates = scheduleDateSequence(normalizedToMonday, STAFF_COPY_WEEK_DATE_COUNT);

        // Fetch source week schedule
        let sql = `SELECT ss.*, ss.date::text AS date FROM staff_schedule ss JOIN staff s ON s.id = ss.staff_id
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
            const sourceDate = normalizeScheduleDate(row.date);
            return fromDates.includes(sourceDate);
        }).sort((left, right) =>
            Number(left.staff_id) - Number(right.staff_id)
            || normalizeScheduleDate(left.date).localeCompare(normalizeScheduleDate(right.date)));
        const sourceStaffIds = [...new Set(sourceRows.map(row => Number(row.staff_id)).filter(Number.isFinite))]
            .sort((a, b) => a - b);
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
        const affectedDates = new Set();
        const notificationChanges = [];
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await lockScheduleStaffRows(client, sourceStaffIds);
            const freshSource = await client.query(
                `${sql}
                 ORDER BY ss.staff_id, ss.date, ss.id`,
                params
            );
            const lockedStaffIds = new Set(sourceStaffIds);
            if (freshSource.rows.some(row => !lockedStaffIds.has(Number(row.staff_id)))) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    error: 'Тиждень-джерело змінився паралельно; повторіть копіювання'
                });
            }
            const freshSourceRows = freshSource.rows.filter(row => {
                const sourceDate = normalizeScheduleDate(row.date);
                return fromDates.includes(sourceDate);
            });
            if (sourceStaffIds.length) {
                const conflictResult = await client.query(
                    `SELECT COUNT(*)::int AS count
                     FROM staff_schedule
                     WHERE date >= $1 AND date <= $2
                       AND staff_id = ANY($3::int[])`,
                    [toDates[0], toDates[6], sourceStaffIds]
                );
                conflicts = Number(conflictResult.rows[0]?.count || 0);
            }
            const sourcePlans = await loadHrShiftDayPlansForStaffDates(client, freshSourceRows);
            const paidRoleValidationContext = [...sourcePlans.values()]
                .some(loaded => dayPlanHasPaidAdditionalRoles(loaded.plan))
                ? await loadPaidRoleValidationContext(client, sourceStaffIds)
                : undefined;
            const targetEntries = freshSourceRows.map(row => {
                const sourceDate = normalizeScheduleDate(row.date);
                const dayIndex = fromDates.indexOf(sourceDate);
                return { staffId: Number(row.staff_id), date: dayIndex === -1 ? null : toDates[dayIndex] };
            }).filter(entry => entry.date);
            const staffCards = await loadStaffScheduleabilityCards(client, sourceStaffIds);
            const previousPlans = await loadHrShiftDayPlansForStaffDates(client, targetEntries);
            const previousScheduleEntries = await loadScheduleEntriesForUpdate(client, targetEntries);
            for (const row of freshSourceRows) {
                const sourceDate = normalizeScheduleDate(row.date);
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
                const loadedSourcePlan = sourcePlans.get(`${row.staff_id}:${sourceDate}`) || null;
                const sourcePlanPayload = copyableDayPlanPayload(loadedSourcePlan) || {
                    shiftStart: row.shift_start,
                    shiftEnd: row.shift_end,
                    professionKey: row.profession_key
                };
                const targetStatus = loadedSourcePlan?.plan?.status || rowStatus;
                const staffRow = staffCards.get(Number(row.staff_id)) || null;
                const scheduleValidation = validateStaffScheduleabilityCardForDate(staffRow, targetDate);
                if (!scheduleValidation.ok) {
                    return rejectUnscheduleableStaff(res, client, scheduleValidation, {
                        entry: { staffId: row.staff_id, date: targetDate, sourceDate }
                    });
                }
                const targetKey = `${Number(row.staff_id)}:${targetDate}`;
                const previousPlan = previousPlans.get(targetKey) || null;
                const hrSync = await syncHrShiftFromScheduleEntry(client, {
                    ...sourcePlanPayload,
                    staffId: row.staff_id,
                    date: targetDate,
                    status: targetStatus,
                    note: row.note
                }, req.user?.username || null, {
                    // Copy-week uses the freshly locked target state, not a browser snapshot.
                    requireExpectedUpdatedAt: false,
                    ignoreExpectedUpdatedAt: true,
                    professionCard: professionCardFromStaff(staffRow),
                    paidRoleValidationContext
                });
                if (hrSync?.ok === false) {
                    await client.query('ROLLBACK');
                    return sendHrShiftSyncError(res, hrSync, {
                        entry: { staffId: row.staff_id, date: targetDate, sourceDate }
                    });
                }
                const previous = previousScheduleEntries.get(targetKey) || null;
                const upserted = await upsertScheduleMirrorFromPlan(client, {
                    staffId: row.staff_id,
                    date: targetDate,
                    note: row.note
                }, hrSync.plan);
                await recordScheduleAudit(client, 'staff_schedule_copy_week', row.staff_id, targetDate, previous, upserted, req, {
                    source: 'staff.schedule.copy_week',
                    fromDate: sourceDate,
                    fromMonday: normalizedFromMonday,
                    toMonday: normalizedToMonday,
                    department: department || null,
                    displayGroup,
                    copyMode,
                    staffCount: sourceStaffIds.length,
                    staffIds: copyMode === 'explicit_staff_ids' ? sourceStaffIds : undefined,
                    conflictCount: conflicts,
                    beforePlan: previousPlan?.plan || null,
                    afterPlan: hrSync.plan
                });
                affectedStaff.add(row.staff_id);
                affectedDates.add(targetDate);
                notificationChanges.push({ staffId: row.staff_id, date: targetDate, plan: hrSync.plan });
                count++;
            }
            await reconcileAnimatorRosterDates(client, [...affectedDates]);
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        // Fire-and-forget notification
        if (count > 0) notifyBulkScheduleChange(affectedStaff, count, notificationChanges);
        broadcastAnimatorRosterDates([...affectedDates], req.user?.id);
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
        if (isHrShiftPlanError(err)) {
            return res.status(err.statusCode || err.status || 400).json(hrShiftPlanErrorPayload(err));
        }
        log.error('POST /staff/schedule/copy-week error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

/**
 * GET /api/staff/schedule/hours — calculate worked hours for a date range
 * LLM HINT: ?from=2026-02-01&to=2026-02-28 → returns { staffId: { name, hours, days } }
 */
router.get('/schedule/hours', requireAction('hr.schedule.view'), async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            return res.status(400).json({ success: false, error: 'Потрібні параметри from та to' });
        }
        const result = await pool.query(
            `SELECT ss.staff_id, ss.date::text AS date, ss.profession_key,
                    s.name, s.department, s.position,
                    ss.shift_start, ss.shift_end,
                    CASE WHEN ss.status = 'day_off' THEN 'dayoff' ELSE ss.status END AS status,
                    hs.id AS hr_shift_id,
                    hs.profession_key AS hr_profession_key,
                    hs.planned_start AS hr_planned_start,
                    hs.planned_end AS hr_planned_end,
                    hs.break_minutes AS hr_break_minutes,
                    hs.shift_type AS hr_shift_type
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             LEFT JOIN hr_shifts hs
               ON hs.staff_id = ss.staff_id
              AND hs.shift_date::text = LEFT(ss.date::text, 10)
             WHERE ss.date >= $1 AND ss.date <= $2
               AND ${activeScheduleStaffWhere('s', 'ss.date')}
             ORDER BY s.department, s.name`,
            [from, to]
        );
        const rowsWithPlans = await attachScheduleDayPlans(result.rows);

        const stats = {};
        for (const row of rowsWithPlans) {
            if (!stats[row.staff_id]) {
                stats[row.staff_id] = {
                    name: row.name, department: row.department, position: row.position,
                    totalHours: 0, workingDays: 0, dayoffs: 0, vacationDays: 0, sickDays: 0, remoteDays: 0
                };
            }
            const s = stats[row.staff_id];
            if ((row.status === 'working' || row.status === 'remote') && row.shift_start && row.shift_end) {
                s.totalHours += Number(row.plannedMinutes || 0) / 60;
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
router.get('/schedule/check/:date', requireAction('hr.schedule.view'), async (req, res) => {
    try {
        const { date } = req.params;
        const [availableLines, result] = await Promise.all([
            getScheduledAnimatorLines(date, pool),
            pool.query(
                `SELECT ss.staff_id,
                    CASE WHEN ss.status = 'day_off' THEN 'dayoff' ELSE ss.status END AS status,
                    ss.shift_start, ss.shift_end, s.name, s.department, s.role_type,
                    COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions
             FROM staff_schedule ss
             JOIN staff s ON s.id = ss.staff_id
             WHERE ss.date = $1
               AND ${activeScheduleStaffWhere('s', 'ss.date')}`,
                [date]
            )
        ]);
        const available = availableLines.map(line => ({
            id: Number(line.staffId || line.id),
            name: line.name,
            shiftStart: line.shiftStart || null,
            shiftEnd: line.shiftEnd || null,
            availabilityWindows: line.availabilityWindows || [],
            availability_windows: line.availabilityWindows || [],
            remote: line.shiftStatus === 'remote',
            needsReview: line.needsReview === true,
            unavailableAssignments: line.unavailableAssignments || []
        }));
        const availableIds = new Set(available.map(line => Number(line.id)));
        const unavailable = [];
        for (const row of result.rows) {
            const animatorQualified = staffProfessionKeys(row).includes('animator');
            if (animatorQualified && !availableIds.has(Number(row.staff_id))) {
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
                tr.compensation_snapshot,
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

        const attendanceRows = await hydrateAttendanceRecords(pool, result.rows);
        const summary = attendanceRows.reduce((acc, row) => {
            const status = String(row.time_status || '').trim() || (row.checkin_at ? 'present' : 'planned');
            const facts = attendanceFactMinutes(row);
            acc.total += 1;
            if (row.clock_in || row.checkin_at) acc.checked_in += 1;
            if (facts.lateMinutes > 0) acc.late += 1;
            if (['absent', 'no_show'].includes(status)) acc.absent += 1;
            if (facts.earlyLeaveMinutes > 0) acc.left_early += 1;
            if (facts.overtimeMinutes > 0) acc.overtime += 1;
            if (row.clock_in && row.clock_out) acc.completed += 1;
            if (['sick', 'vacation', 'day_off', 'excused'].includes(status)) acc.excused += 1;
            return acc;
        }, { total: 0, checked_in: 0, late: 0, absent: 0, left_early: 0, overtime: 0, completed: 0, excused: 0 });

        res.json({ success: true, from, to, data: attendanceRows, summary, source: 'hr_time_records+staff_checkins' });
    } catch (err) {
        if (err.message.includes('does not exist')) {
            return res.json({ success: true, data: [], summary: { total: 0, checked_in: 0, late: 0, absent: 0, left_early: 0, overtime: 0, completed: 0, excused: 0 }, source: 'missing_attendance_tables' });
        }
        log.error('GET /staff/attendance error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/staff/:id/shift-preferences - staff-level default shift times by profession and day type
router.get('/:id/shift-preferences', requireAction('hr.schedule.view'), async (req, res) => {
    try {
        const staffId = Number(req.params.id);
        if (!Number.isInteger(staffId) || staffId <= 0) {
            return res.status(400).json({ success: false, error: 'valid staff id is required' });
        }
        const staff = await loadStaffForShiftPreferences(pool, staffId);
        if (!staff) {
            return res.status(404).json({ success: false, error: 'staff member not found' });
        }
        const allowedProfessions = await loadAssignedStaffProfessionKeys(pool, staff);
        const data = await loadStaffShiftPreferences(pool, staffId, { professionKeys: allowedProfessions });
        res.json({
            success: true,
            staffId,
            allowedProfessions,
            data
        });
    } catch (err) {
        log.error('GET /staff/:id/shift-preferences error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /api/staff/:id/shift-preferences - upsert staff-level defaults without touching actual schedule rows
router.put('/:id/shift-preferences', requireAction('hr.schedule.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const staffId = Number(req.params.id);
        if (!Number.isInteger(staffId) || staffId <= 0) {
            return res.status(400).json({ success: false, error: 'valid staff id is required' });
        }
        const items = shiftPreferenceItemsFromBody(req.body);
        if (!items) {
            return res.status(400).json({ success: false, error: 'preferences must be an array' });
        }

        await client.query('BEGIN');
        const staff = await loadStaffForShiftPreferences(client, staffId, { forUpdate: true });
        if (!staff) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'staff member not found' });
        }

        const allowedProfessions = await loadAssignedStaffProfessionKeys(client, staff);
        const validation = validateStaffShiftPreferencePayload(staff, items, { allowedProfessions });
        if (!validation.ok) {
            await client.query('ROLLBACK');
            return res.status(validation.status || 400).json({
                success: false,
                error: validation.error,
                allowedProfessions: validation.allowedProfessions
            });
        }

        const actor = req.user?.username || null;
        for (const preference of validation.preferences) {
            await client.query(
                `INSERT INTO staff_shift_preferences
                    (staff_id, profession_key, day_type, start_time, end_time, is_active, created_by, updated_by)
                 VALUES ($1, $2, $3, $4::time, $5::time, $6, $7, $7)
                 ON CONFLICT (staff_id, profession_key, day_type)
                 DO UPDATE SET
                    start_time = EXCLUDED.start_time,
                    end_time = EXCLUDED.end_time,
                    is_active = EXCLUDED.is_active,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = NOW()`,
                [
                    staffId,
                    preference.professionKey,
                    preference.dayType,
                    preference.startTime,
                    preference.endTime,
                    preference.isActive,
                    actor
                ]
            );
        }

        if (validation.preferences.length) {
            await insertHrAuditLog(client, 'staff_shift_preferences_update', staffId, actor, {
                source: 'staff.shift_preferences.put',
                count: validation.preferences.length,
                preferences: validation.preferences.map(item => ({
                    professionKey: item.professionKey,
                    dayType: item.dayType,
                    startTime: item.startTime,
                    endTime: item.endTime,
                    isActive: item.isActive
                }))
            }, req.ip || null);
        }

        const data = await loadStaffShiftPreferences(client, staffId, { professionKeys: validation.allowedProfessions });
        await client.query('COMMIT');
        res.json({
            success: true,
            staffId,
            allowedProfessions: validation.allowedProfessions,
            count: validation.preferences.length,
            ensuredFallbackCount: 0,
            data
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('PUT /staff/:id/shift-preferences error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
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
            staff.company_structure_node_id,
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
        const displayGroupContext = await loadStaffDisplayGroupContext(pool);
        const rows = decorateStaffRowsWithDisplayGroups(result.rows, { displayGroupContext });
        res.json({
            success: true,
            data: rows,
            departments: DEPARTMENTS,
            displayGroups: listStaffDisplayGroups(),
            displayGroupOptions: buildStaffDisplayGroupOptions(result.rows, { displayGroupContext }),
            scheduleCategoryContract: listStaffScheduleCategoryContract()
        });
    } catch (err) {
        log.error('GET /staff error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// POST /api/staff — create new employee
// LLM HINT: telegramUsername is optional — used for @-mentions in schedule notifications
router.post('/', requireAction('hr.staff.manage'), async (req, res) => {
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
router.put('/:id', requireAction('hr.staff.manage'), async (req, res) => {
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
        const existing = await client.query('SELECT id FROM staff WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!existing.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'РќРµ Р·РЅР°Р№РґРµРЅРѕ' });
        }
        const outstandingInstallments = await loadStaffOutstandingPayrollInstallments(req.params.id, client);
        if (outstandingInstallments.count > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json(staffPayrollOutstandingBlockerPayload(outstandingInstallments));
        }
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
router.post('/:id/face-descriptor', requireAction('hr.staff.manage'), async (req, res) => {
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
        const staffId = Number(req.body?.staffId);
        const { method } = req.body || {};
        if (!Number.isSafeInteger(staffId) || staffId <= 0 || staffId > 2147483647) {
            return res.status(400).json({ error: 'valid staffId required' });
        }

        const today = getKyivDateStr();
        let result;
        let hrTimeRecord = null;
        let clockInResult = null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await lockAttendanceWriteTarget(client, { staffId, date: today });
            clockInResult = await recordAttendanceClockIn(client, {
                staffId,
                recordDate: today,
                businessContext: DEFAULT_BUSINESS_CONTEXT,
                performedBy: req.user?.username || method || 'face',
                method: method || 'face',
                source: 'staff_checkin',
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            hrTimeRecord = clockInResult.record;
            result = await client.query(
                `INSERT INTO staff_checkins (staff_id, date, check_in, method)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (staff_id, date) DO UPDATE SET check_in = COALESCE(staff_checkins.check_in, EXCLUDED.check_in)
                 RETURNING *`,
                [staffId, today, hrTimeRecord.clock_in, method || 'face']
            );
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
        if (!clockInResult.alreadyClockedIn) {
            broadcast('hr:attendance-updated', {
                date: today,
                staffId: Number(staffId),
                action: 'clock_in',
                source: method || 'face',
                staffName: name,
                hrTimeRecord
            }, null, today);
        }
        res.json({
            success: true,
            checkin: result.rows[0],
            staffName: name,
            hrTimeRecord,
            alreadyClockedIn: clockInResult.alreadyClockedIn,
            planSource: clockInResult.planSource
        });
        // Send check-in notification to chat channel (fire-and-forget after response)
        if (!clockInResult.alreadyClockedIn) try {
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
        const staffId = Number(req.body?.staffId);
        if (!Number.isSafeInteger(staffId) || staffId <= 0 || staffId > 2147483647) {
            return res.status(400).json({ error: 'valid staffId required' });
        }

        const today = getKyivDateStr();
        let result;
        let hrTimeRecord = null;
        let clockOutResult = null;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await lockAttendanceWriteTarget(client, { staffId, date: today });
            clockOutResult = await recordAttendanceClockOut(client, {
                staffId,
                recordDate: today,
                settlementMode: 'actual_time',
                performedBy: req.user?.username || 'face',
                method: 'face',
                source: 'staff_checkin',
                ip: req.ip
            });
            hrTimeRecord = clockOutResult.record;
            result = await client.query(
                `UPDATE staff_checkins SET check_out = COALESCE(check_out, $1)
                 WHERE staff_id = $2 AND date = $3
                 RETURNING *`,
                [hrTimeRecord.clock_out, staffId, today]
            );
            if (result.rows.length === 0) {
                const error = new Error('No check-in found for today');
                error.code = 'STAFF_CHECKIN_REQUIRED';
                throw error;
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            throw txErr;
        } finally {
            client.release();
        }
        const staffRes = await pool.query('SELECT name FROM staff WHERE id = $1', [staffId]);
        const name = staffRes.rows[0]?.name || 'Unknown';
        if (!clockOutResult.alreadyClockedOut) {
            broadcast('hr:attendance-updated', {
                date: today,
                staffId: Number(staffId),
                action: 'clock_out',
                source: 'face',
                staffName: name,
                hrTimeRecord
            }, null, today);
        }
        res.json({
            success: true,
            checkin: result.rows[0],
            hrTimeRecord,
            alreadyClockedOut: clockOutResult.alreadyClockedOut,
            planSource: clockOutResult.planSource
        });
        // Send checkout notification to chat channel (fire-and-forget after response)
        if (!clockOutResult.alreadyClockedOut) try {
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
        if (err?.code === 'ATTENDANCE_CLOCK_IN_REQUIRED') {
            return res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
        }
        if (err?.code === 'STAFF_CHECKIN_REQUIRED') {
            return res.status(404).json({ error: err.message, code: err.code });
        }
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
    'Мийка біла та чорна': { dept: 'cafe', role: 'dishwasher' },
    'Офіціанти': { dept: 'cafe', role: 'waiter' },
    'Охорона': { dept: 'security', role: 'security' },
    'Тех-директор': { dept: 'tech', role: 'maintenance' },
    'Хозяюшки залу': { dept: 'cleaning', role: 'cleaner' }
};

function staffRoleToAccountRole(roleType) {
    return professionToAccountRole(roleType);
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
            WHERE ${activeOperationalStaffWhere('s')}
              AND s.is_freelance = false
              AND NOT EXISTS (
                  SELECT 1
                  FROM employee_profiles ep
                  WHERE ep.staff_id = s.id
                    AND ep.user_id IS NOT NULL
              )
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
            if (!role) {
                skipped.push({
                    staffId: staff.id,
                    name: staff.name,
                    profession: staff.role_type || null,
                    reason: 'unmapped_profession_role',
                    label: 'Для професії не налаштовано безпечне відображення на CRM-роль'
                });
                continue;
            }
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

            const suggestedUsername = suggestUsernameForStaff(staff);
            if (isProtectedSystemAccount({ username: suggestedUsername, name: staff.name })) {
                skipped.push({
                    staffId: staff.id,
                    name: staff.name,
                    reason: 'reserved_system_identity',
                    label: 'Логін або імʼя зарезервовано для захищеного системного акаунта'
                });
                continue;
            }
            const username = await uniqueUsername(client, suggestedUsername);
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
router.get('/payroll', requireAction('hr.payroll.view'), async (req, res) => {
    try {
        const month = req.query.month || new Date().toISOString().slice(0, 7);
        const mFrom = req.query.from || `${month}-01`;
        const monthMatch = String(month).match(/^(\d{4})-(\d{2})$/);
        const defaultMonthEnd = monthMatch
            ? new Date(Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]), 0)).toISOString().slice(0, 10)
            : `${month}-31`;
        const mTo = req.query.to || defaultMonthEnd;
        const preview = await getPayrollRangePreview({ month, from: mFrom, to: mTo }, pool);
        const payroll = (preview.staff || []).map(row => ({
            staffId: row.staffId,
            name: row.name,
            department: row.department,
            position: row.position,
            eventsCount: row.daysWorked,
            hoursWorked: row.hoursWorked,
            hourlyRate: row.hourlyRate,
            rateUnit: row.rateUnit,
            salary: row.netAmount,
            zrs: row.zrsAmount,
            avgRating: Number(row.avgRating || 0)
        }));
        const totalFOP = payroll.reduce((sum, p) => sum + Number(p.salary || 0), 0);
        res.json({
            month,
            from: mFrom,
            to: mTo,
            payroll,
            totalFOP,
            source: 'canonical_payroll_service',
            deprecatedAdapter: true,
            previewMode: true,
            confirmable: preview.confirmable,
            confirmationBlockedReason: preview.confirmationBlockedReason
        });
    } catch (err) {
        log.error('GET /staff/payroll error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
