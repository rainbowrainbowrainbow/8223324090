'use strict';

const { pool } = require('../db');
const {
    normalizeProfessionKey,
    staffProfessionKeys
} = require('./professions');
const {
    OVERTIME_MULTIPLIER,
    calculateProfessionPay,
    loadActivePayrollSchemeMap,
    loadPayrollAttendanceMetrics,
    loadPayrollProfileContext,
    loadProfessionRateMap,
    resolveEffectivePayrollProfile
} = require('./payroll');
const {
    assertPayrollPeriodOpen,
    payrollMonthRange
} = require('./hrPayrollPeriod');

const PROFILE_KINDS = new Set(['shared', 'personal']);
const PROFILE_STATUSES = new Set(['draft', 'active', 'archived']);
const RATE_UNITS = new Set(['hour', 'day', 'month']);
const ASSIGNMENT_KINDS = new Set(['explicit', 'temporary']);
const WEEKDAY_ALIASES = new Map([
    ['mon', 1], ['monday', 1],
    ['tue', 2], ['tuesday', 2],
    ['wed', 3], ['wednesday', 3],
    ['thu', 4], ['thursday', 4],
    ['fri', 5], ['friday', 5],
    ['sat', 6], ['saturday', 6],
    ['sun', 7], ['sunday', 7]
]);
const PAYROLL_PROFILE_AUDIT_ACTIONS = [
    'payroll_profile_create',
    'payroll_profile_clone',
    'payroll_profile_version_create',
    'payroll_profile_sync_from_base',
    'payroll_profile_archive',
    'payroll_profile_bulk_apply',
    'staff_payroll_profile_assignments_update'
];

function payrollProfileError(message, statusCode = 400, code = 'PAYROLL_PROFILE_INVALID', details = null) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    if (details) error.details = details;
    return error;
}

function safeRows(result) {
    return Array.isArray(result?.rows) ? result.rows : [];
}

function cleanText(value, limit = 160) {
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/\u0000/g, '').trim();
    return text ? text.slice(0, limit) : null;
}

function numberId(value, field = 'id') {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw payrollProfileError(`${field} must be a positive integer`, 400, 'PAYROLL_PROFILE_ID_INVALID', { field });
    }
    return id;
}

function boolValue(value, fallback = false) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return fallback;
}

function positiveMoney(value, field) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw payrollProfileError(`${field} must be a positive number`, 400, 'PAYROLL_PROFILE_RATE_INVALID', { field });
    }
    return Math.round(amount * 100) / 100;
}

function dateParts(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() + 1 !== month
        || date.getUTCDate() !== day
    ) {
        return null;
    }
    return { year, month, day };
}

function normalizeDate(value, field, { required = false } = {}) {
    if (value === null || value === undefined || value === '') {
        if (!required) return null;
        throw payrollProfileError(`${field} is required`, 400, 'PAYROLL_PROFILE_DATE_REQUIRED', { field });
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const year = value.getUTCFullYear();
        const month = String(value.getUTCMonth() + 1).padStart(2, '0');
        const day = String(value.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    const raw = String(value).slice(0, 10);
    if (!dateParts(raw)) {
        throw payrollProfileError(`${field} must use YYYY-MM-DD`, 400, 'PAYROLL_PROFILE_DATE_INVALID', { field });
    }
    return raw;
}

function compareDates(left, right) {
    const a = normalizeDate(left, 'left', { required: true });
    const b = normalizeDate(right, 'right', { required: true });
    return a < b ? -1 : (a > b ? 1 : 0);
}

function addDays(dateValue, offset) {
    const normalized = normalizeDate(dateValue, 'date', { required: true });
    const { year, month, day } = dateParts(normalized);
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0')
    ].join('-');
}

function todayKyivDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateOnly(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function normalizeRateUnit(value, fallback = null) {
    const unit = cleanText(value, 16) || fallback;
    if (!RATE_UNITS.has(unit)) {
        throw payrollProfileError('rateUnit must be hour, day, or month', 400, 'PAYROLL_PROFILE_RATE_UNIT_INVALID');
    }
    return unit;
}

function normalizeProfileKind(value, fallback = 'shared') {
    const kind = cleanText(value, 16) || fallback;
    if (!PROFILE_KINDS.has(kind)) {
        throw payrollProfileError('profileKind must be shared or personal', 400, 'PAYROLL_PROFILE_KIND_INVALID');
    }
    return kind;
}

function normalizeProfileStatus(value, fallback = 'draft') {
    const status = cleanText(value, 16) || fallback;
    if (!PROFILE_STATUSES.has(status)) {
        throw payrollProfileError('status must be draft, active, or archived', 400, 'PAYROLL_PROFILE_STATUS_INVALID');
    }
    return status;
}

function normalizeAssignmentKind(value, fallback = 'explicit') {
    const kind = cleanText(value, 16) || fallback;
    if (!ASSIGNMENT_KINDS.has(kind)) {
        throw payrollProfileError('assignmentKind must be explicit or temporary', 400, 'PAYROLL_ASSIGNMENT_KIND_INVALID');
    }
    return kind;
}

function actorUsername(actor = null) {
    return cleanText(actor?.username || actor?.user?.username || actor, 50);
}

function actorIp(actor = null) {
    return cleanText(actor?.ipAddress || actor?.ip || null, 45);
}

function mutationReason(payload = {}, { required = false } = {}) {
    const reason = cleanText(
        payload.changeReason ?? payload.change_reason ?? payload.reason,
        1000
    );
    if (required && !reason) {
        throw payrollProfileError('change reason is required', 400, 'PAYROLL_PROFILE_CHANGE_REASON_REQUIRED');
    }
    return reason;
}

function parseJsonObject(value) {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function weekdayNumber(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    const text = cleanText(value, 20);
    if (!text) return null;
    if (/^[1-7]$/.test(text)) return Number(text);
    return WEEKDAY_ALIASES.get(text.toLowerCase()) || null;
}

function normalizeDayRates(value, rateUnit, defaultRate = null) {
    const source = value === undefined ? [] : value;
    const entries = [];
    if (Array.isArray(source)) {
        for (const item of source) {
            if (!item || typeof item !== 'object') continue;
            entries.push({
                isoWeekday: weekdayNumber(item.isoWeekday ?? item.iso_weekday ?? item.weekday ?? item.day),
                rate: item.rate
            });
        }
    } else if (source && typeof source === 'object') {
        for (const [key, rate] of Object.entries(source)) {
            entries.push({ isoWeekday: weekdayNumber(key), rate });
        }
    }

    if (rateUnit === 'month' && entries.length) {
        throw payrollProfileError(
            'month payroll profile cannot have weekday overrides',
            400,
            'PAYROLL_PROFILE_MONTH_DAY_RATES_FORBIDDEN'
        );
    }

    const byDay = new Map();
    for (const entry of entries) {
        const day = Number(entry.isoWeekday);
        if (!Number.isInteger(day) || day < 1 || day > 7) {
            throw payrollProfileError('isoWeekday must be 1-7', 400, 'PAYROLL_PROFILE_WEEKDAY_INVALID');
        }
        const rate = positiveMoney(entry.rate, `dayRates.${day}.rate`);
        if (defaultRate !== null && Number(rate) === Number(defaultRate)) continue;
        byDay.set(day, { isoWeekday: day, rate });
    }
    return [...byDay.values()].sort((a, b) => a.isoWeekday - b.isoWeekday);
}

function normalizeVersionPayload(payload = {}, fallback = {}, options = {}) {
    const rateUnit = normalizeRateUnit(
        payload.rateUnit ?? payload.rate_unit,
        fallback.rateUnit || fallback.rate_unit || null
    );
    const defaultRate = positiveMoney(
        payload.defaultRate ?? payload.default_rate ?? fallback.defaultRate ?? fallback.default_rate,
        'defaultRate'
    );
    const effectiveFrom = normalizeDate(
        payload.effectiveFrom ?? payload.effective_from ?? fallback.effectiveFrom ?? fallback.effective_from,
        'effectiveFrom',
        { required: true }
    );
    const effectiveTo = normalizeDate(
        payload.effectiveTo ?? payload.effective_to ?? fallback.effectiveTo ?? fallback.effective_to,
        'effectiveTo'
    );
    if (effectiveTo && effectiveTo < effectiveFrom) {
        throw payrollProfileError('effectiveTo must be on or after effectiveFrom', 400, 'PAYROLL_PROFILE_DATE_RANGE_INVALID');
    }
    const dayRateSource = payload.dayRates ?? payload.day_rates ?? fallback.dayRates ?? fallback.day_rates ?? [];
    return {
        rateUnit,
        defaultRate,
        effectiveFrom,
        effectiveTo,
        changeReason: mutationReason(payload, { required: options.reasonRequired === true }),
        dayRates: normalizeDayRates(dayRateSource, rateUnit, defaultRate)
    };
}

function versionHasPayload(payload = {}) {
    const source = payload.version && typeof payload.version === 'object' ? payload.version : payload;
    return [
        'rateUnit', 'rate_unit', 'defaultRate', 'default_rate', 'effectiveFrom', 'effective_from',
        'effectiveTo', 'effective_to', 'dayRates', 'day_rates'
    ].some(key => Object.prototype.hasOwnProperty.call(source, key));
}

function normalizeProfileVersion(row, dayRates = []) {
    if (!row) return null;
    const mappedDayRates = (dayRates || []).map(rate => ({
        id: rate.id == null ? null : Number(rate.id),
        profile_version_id: rate.profile_version_id == null ? null : Number(rate.profile_version_id),
        profileVersionId: rate.profile_version_id == null ? null : Number(rate.profile_version_id),
        iso_weekday: Number(rate.iso_weekday ?? rate.isoWeekday),
        isoWeekday: Number(rate.iso_weekday ?? rate.isoWeekday),
        rate: Number(rate.rate)
    })).sort((a, b) => a.isoWeekday - b.isoWeekday);
    return {
        id: Number(row.id),
        profile_id: Number(row.profile_id),
        profileId: Number(row.profile_id),
        version_number: Number(row.version_number),
        versionNumber: Number(row.version_number),
        rate_unit: row.rate_unit,
        rateUnit: row.rate_unit,
        default_rate: Number(row.default_rate),
        defaultRate: Number(row.default_rate),
        effective_from: dateOnly(row.effective_from),
        effectiveFrom: dateOnly(row.effective_from),
        effective_to: dateOnly(row.effective_to),
        effectiveTo: dateOnly(row.effective_to),
        change_reason: row.change_reason || null,
        changeReason: row.change_reason || null,
        created_by: row.created_by || null,
        createdBy: row.created_by || null,
        activated_by: row.activated_by || null,
        activatedBy: row.activated_by || null,
        created_at: row.created_at,
        createdAt: row.created_at,
        updated_at: row.updated_at,
        updatedAt: row.updated_at,
        activated_at: row.activated_at,
        activatedAt: row.activated_at,
        day_rates: mappedDayRates,
        dayRates: mappedDayRates
    };
}

function currentVersionForDate(versions = [], asOfDate = todayKyivDate()) {
    const asOf = normalizeDate(asOfDate, 'asOfDate', { required: true });
    return versions
        .filter(version => version.effectiveFrom <= asOf && (!version.effectiveTo || version.effectiveTo >= asOf))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.versionNumber - a.versionNumber)[0] || null;
}

function latestVersion(versions = []) {
    return [...versions].sort((a, b) => b.versionNumber - a.versionNumber || b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null;
}

function normalizeProfile(row, extras = {}) {
    if (!row) return null;
    const versions = extras.versions || [];
    const current = extras.currentVersion === undefined
        ? currentVersionForDate(versions, extras.asOfDate || todayKyivDate())
        : extras.currentVersion;
    const latest = extras.latestVersion === undefined ? latestVersion(versions) : extras.latestVersion;
    return {
        id: Number(row.id),
        title: row.title,
        profession_key: row.profession_key,
        professionKey: row.profession_key,
        profession_title: row.profession_title || null,
        professionTitle: row.profession_title || null,
        profile_kind: row.profile_kind,
        profileKind: row.profile_kind,
        owner_staff_id: row.owner_staff_id == null ? null : Number(row.owner_staff_id),
        ownerStaffId: row.owner_staff_id == null ? null : Number(row.owner_staff_id),
        owner_staff_name: row.owner_staff_name || null,
        ownerStaffName: row.owner_staff_name || null,
        is_default_for_profession: row.is_default_for_profession === true,
        isDefaultForProfession: row.is_default_for_profession === true,
        source_profile_id: row.source_profile_id == null ? null : Number(row.source_profile_id),
        sourceProfileId: row.source_profile_id == null ? null : Number(row.source_profile_id),
        source_profile_title: row.source_profile_title || null,
        sourceProfileTitle: row.source_profile_title || null,
        source_version_id: row.source_version_id == null ? null : Number(row.source_version_id),
        sourceVersionId: row.source_version_id == null ? null : Number(row.source_version_id),
        status: row.status,
        created_by: row.created_by || null,
        createdBy: row.created_by || null,
        updated_by: row.updated_by || null,
        updatedBy: row.updated_by || null,
        activated_by: row.activated_by || null,
        activatedBy: row.activated_by || null,
        archived_by: row.archived_by || null,
        archivedBy: row.archived_by || null,
        created_at: row.created_at,
        createdAt: row.created_at,
        updated_at: row.updated_at,
        updatedAt: row.updated_at,
        activated_at: row.activated_at,
        activatedAt: row.activated_at,
        archived_at: row.archived_at,
        archivedAt: row.archived_at,
        active_assignment_count: Number(row.active_assignment_count || extras.activeAssignmentCount || 0),
        activeAssignmentCount: Number(row.active_assignment_count || extras.activeAssignmentCount || 0),
        temporary_assignment_count: Number(row.temporary_assignment_count || extras.temporaryAssignmentCount || 0),
        temporaryAssignmentCount: Number(row.temporary_assignment_count || extras.temporaryAssignmentCount || 0),
        total_assignment_count: Number(row.total_assignment_count || extras.totalAssignmentCount || 0),
        totalAssignmentCount: Number(row.total_assignment_count || extras.totalAssignmentCount || 0),
        default_staff_count: Number(row.default_staff_count || extras.defaultStaffCount || 0),
        defaultStaffCount: Number(row.default_staff_count || extras.defaultStaffCount || 0),
        affected_staff_count: Number(row.affected_staff_count || extras.affectedStaffCount || 0),
        affectedStaffCount: Number(row.affected_staff_count || extras.affectedStaffCount || 0),
        current_version: current,
        currentVersion: current,
        latest_version: latest,
        latestVersion: latest,
        versions
    };
}

function mapAssignment(row) {
    return {
        id: Number(row.id),
        staff_id: Number(row.staff_id),
        staffId: Number(row.staff_id),
        profession_key: row.profession_key,
        professionKey: row.profession_key,
        profession_title: row.profession_title || null,
        professionTitle: row.profession_title || null,
        profile_id: Number(row.profile_id),
        profileId: Number(row.profile_id),
        profile_title: row.profile_title || null,
        profileTitle: row.profile_title || null,
        profile_kind: row.profile_kind || null,
        profileKind: row.profile_kind || null,
        profile_status: row.profile_status || null,
        profileStatus: row.profile_status || null,
        assignment_kind: row.assignment_kind,
        assignmentKind: row.assignment_kind,
        effective_from: dateOnly(row.effective_from),
        effectiveFrom: dateOnly(row.effective_from),
        effective_to: dateOnly(row.effective_to),
        effectiveTo: dateOnly(row.effective_to),
        created_by: row.created_by || null,
        createdBy: row.created_by || null,
        updated_by: row.updated_by || null,
        updatedBy: row.updated_by || null,
        created_at: row.created_at,
        createdAt: row.created_at,
        updated_at: row.updated_at,
        updatedAt: row.updated_at
    };
}

async function withTransaction(options, fn) {
    const source = options?.db || pool;
    const canConnect = typeof source.connect === 'function';
    const client = canConnect ? await source.connect() : source;
    const manageTransaction = options?.manageTransaction !== false;
    try {
        if (manageTransaction) await client.query('BEGIN');
        const result = await fn(client);
        if (manageTransaction) await client.query('COMMIT');
        return result;
    } catch (error) {
        if (manageTransaction) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Prefer the original mutation error.
            }
        }
        if (['23505', '23503', '23514', '23P01'].includes(error?.code) && !error.statusCode) {
            throw payrollProfileError(
                'payroll profile constraint violation',
                409,
                'PAYROLL_PROFILE_CONSTRAINT_VIOLATION',
                { pgCode: error.code }
            );
        }
        throw error;
    } finally {
        if (canConnect && typeof client.release === 'function') client.release();
    }
}

async function assertProfessionExists(db, professionKey, options = {}) {
    const result = await db.query(
        `SELECT key, title, is_active
         FROM hr_professions
         WHERE key = $1${options.forUpdate ? ' FOR UPDATE' : ''}`,
        [professionKey]
    );
    const profession = safeRows(result)[0];
    if (!profession) {
        throw payrollProfileError('profession not found', 404, 'PAYROLL_PROFILE_PROFESSION_NOT_FOUND');
    }
    return profession;
}

async function loadStaffOrThrow(db, staffId, options = {}) {
    const id = numberId(staffId, 'staffId');
    const result = await db.query(
        `SELECT id, name, role_type, COALESCE(secondary_professions, '[]'::jsonb) AS secondary_professions,
                COALESCE(is_active, true) AS is_active
         FROM staff
         WHERE id = $1${options.forUpdate ? ' FOR UPDATE' : ''}`,
        [id]
    );
    const staff = safeRows(result)[0];
    if (!staff) throw payrollProfileError('staff member not found', 404, 'PAYROLL_PROFILE_STAFF_NOT_FOUND');
    return staff;
}

async function staffHasProfession(db, staffId, professionKey) {
    const staff = await loadStaffOrThrow(db, staffId);
    const assignmentResult = await db.query(
        `SELECT 1
         FROM staff_role_assignments
         WHERE staff_id = $1
           AND profession_key = $2
           AND status <> 'inactive'
         LIMIT 1`,
        [staffId, professionKey]
    ).catch(() => ({ rows: [] }));
    if (safeRows(assignmentResult).length) return true;
    return staffProfessionKeys(staff).includes(professionKey);
}

async function insertHrAudit(db, action, staffId, actor, details = {}) {
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
            action,
            staffId == null ? null : Number(staffId),
            actorUsername(actor),
            JSON.stringify(details),
            actorIp(actor)
        ]
    );
}

async function loadDayRatesForVersionIds(db, versionIds = []) {
    const ids = [...new Set((versionIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    const grouped = new Map(ids.map(id => [id, []]));
    if (!ids.length) return grouped;
    const result = await db.query(
        `SELECT id, profile_version_id, iso_weekday, rate
         FROM payroll_profile_day_rates
         WHERE profile_version_id = ANY($1::bigint[])
         ORDER BY profile_version_id, iso_weekday`,
        [ids]
    );
    for (const row of safeRows(result)) {
        const versionId = Number(row.profile_version_id);
        if (!grouped.has(versionId)) grouped.set(versionId, []);
        grouped.get(versionId).push(row);
    }
    return grouped;
}

async function loadVersionsForProfiles(db, profileIds = [], options = {}) {
    const ids = [...new Set((profileIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    const grouped = new Map(ids.map(id => [id, []]));
    if (!ids.length) return grouped;
    const result = await db.query(
        `SELECT *
         FROM payroll_profile_versions
         WHERE profile_id = ANY($1::bigint[])
         ORDER BY profile_id, version_number ASC, effective_from ASC${options.forUpdate ? ' FOR UPDATE' : ''}`,
        [ids]
    );
    const rows = safeRows(result);
    const dayRates = await loadDayRatesForVersionIds(db, rows.map(row => row.id));
    for (const row of rows) {
        const profileId = Number(row.profile_id);
        if (!grouped.has(profileId)) grouped.set(profileId, []);
        grouped.get(profileId).push(normalizeProfileVersion(row, dayRates.get(Number(row.id)) || []));
    }
    return grouped;
}

async function loadProfileRow(db, profileId, options = {}) {
    const id = numberId(profileId, 'profileId');
    const result = await db.query(
        `SELECT profile.*,
                profession.title AS profession_title,
                owner.name AS owner_staff_name,
                source.title AS source_profile_title
         FROM payroll_profiles profile
         JOIN hr_professions profession ON profession.key = profile.profession_key
         LEFT JOIN staff owner ON owner.id = profile.owner_staff_id
         LEFT JOIN payroll_profiles source ON source.id = profile.source_profile_id
         WHERE profile.id = $1${options.forUpdate ? ' FOR UPDATE OF profile' : ''}`,
        [id]
    );
    const row = safeRows(result)[0];
    if (!row) throw payrollProfileError('payroll profile not found', 404, 'PAYROLL_PROFILE_NOT_FOUND');
    return row;
}

async function loadProfile(db, profileId, options = {}) {
    const row = await loadProfileRow(db, profileId, options);
    const versions = await loadVersionsForProfiles(db, [row.id], { forUpdate: options.forUpdateVersions === true });
    return normalizeProfile(row, {
        versions: versions.get(Number(row.id)) || [],
        asOfDate: options.asOfDate || todayKyivDate()
    });
}

async function listPayrollProfiles(filters = {}, options = {}) {
    const db = options.db || pool;
    const clauses = [];
    const params = [];
    const asOfDate = normalizeDate(filters.asOfDate || filters.as_of_date || todayKyivDate(), 'asOfDate', { required: true });
    params.push(asOfDate);
    const asOfDateParam = `$${params.length}`;
    const professionKey = normalizeProfessionKey(filters.professionKey ?? filters.profession_key);
    if (professionKey) {
        params.push(professionKey);
        clauses.push(`profile.profession_key = $${params.length}`);
    }
    const profileKind = filters.profileKind ?? filters.profile_kind;
    if (profileKind) {
        params.push(normalizeProfileKind(profileKind));
        clauses.push(`profile.profile_kind = $${params.length}`);
    }
    const status = filters.status ? normalizeProfileStatus(filters.status) : null;
    if (status) {
        params.push(status);
        clauses.push(`profile.status = $${params.length}`);
    } else if (!boolValue(filters.includeArchived ?? filters.include_archived, false)) {
        clauses.push(`profile.status <> 'archived'`);
    }
    const ownerStaffId = filters.ownerStaffId ?? filters.owner_staff_id;
    if (ownerStaffId !== undefined && ownerStaffId !== null && ownerStaffId !== '') {
        params.push(numberId(ownerStaffId, 'ownerStaffId'));
        clauses.push(`profile.owner_staff_id = $${params.length}`);
    }
    const result = await db.query(
        `WITH profession_staff AS (
             SELECT DISTINCT
                    s.id AS staff_id,
                    lower(regexp_replace(BTRIM(assignments.profession_key), '[^a-zA-Z0-9_:-]+', '_', 'g')) AS profession_key
             FROM staff s
             CROSS JOIN LATERAL (
                 SELECT NULLIF(BTRIM(s.role_type), '') AS profession_key
                 UNION ALL
                 SELECT NULLIF(BTRIM(secondary.value), '') AS profession_key
                 FROM jsonb_array_elements_text(COALESCE(s.secondary_professions, '[]'::jsonb)) AS secondary(value)
                 UNION ALL
                 SELECT NULLIF(BTRIM(sra.profession_key), '') AS profession_key
                 FROM staff_role_assignments sra
                 WHERE sra.staff_id = s.id
                   AND COALESCE(sra.status, 'active') = 'active'
             ) assignments
             WHERE COALESCE(s.is_active, true) = true
               AND NULLIF(BTRIM(assignments.profession_key), '') IS NOT NULL
         ),
         active_assignments AS (
             SELECT assignment.profile_id,
                    assignment.profession_key,
                    assignment.staff_id,
                    assignment.assignment_kind
             FROM staff_payroll_profile_assignments assignment
             WHERE assignment.effective_from <= ${asOfDateParam}::date
               AND (assignment.effective_to IS NULL OR assignment.effective_to >= ${asOfDateParam}::date)
         ),
         active_assignment_counts AS (
             SELECT profile_id,
                    COUNT(DISTINCT staff_id)::int AS active_assignment_count,
                    COUNT(DISTINCT staff_id) FILTER (WHERE assignment_kind = 'temporary')::int AS temporary_assignment_count
             FROM active_assignments
             GROUP BY profile_id
         ),
         total_assignment_counts AS (
             SELECT profile_id,
                    COUNT(DISTINCT staff_id)::int AS total_assignment_count
             FROM staff_payroll_profile_assignments
             GROUP BY profile_id
         ),
         default_profile_usage AS (
             SELECT p.id AS profile_id,
                    COUNT(DISTINCT ps.staff_id) FILTER (WHERE aa.staff_id IS NULL)::int AS default_staff_count
             FROM payroll_profiles p
             LEFT JOIN profession_staff ps
                    ON ps.profession_key = p.profession_key
             LEFT JOIN active_assignments aa
                    ON aa.profession_key = p.profession_key
                   AND aa.staff_id = ps.staff_id
             WHERE p.status = 'active'
               AND p.profile_kind = 'shared'
               AND p.is_default_for_profession = true
             GROUP BY p.id
         )
         SELECT profile.*,
                profession.title AS profession_title,
                owner.name AS owner_staff_name,
                source.title AS source_profile_title,
                COALESCE(active_counts.active_assignment_count, 0)::int AS active_assignment_count,
                COALESCE(active_counts.temporary_assignment_count, 0)::int AS temporary_assignment_count,
                COALESCE(total_counts.total_assignment_count, 0)::int AS total_assignment_count,
                COALESCE(default_usage.default_staff_count, 0)::int AS default_staff_count,
                (COALESCE(active_counts.active_assignment_count, 0) + COALESCE(default_usage.default_staff_count, 0))::int AS affected_staff_count
         FROM payroll_profiles profile
         JOIN hr_professions profession ON profession.key = profile.profession_key
         LEFT JOIN staff owner ON owner.id = profile.owner_staff_id
         LEFT JOIN payroll_profiles source ON source.id = profile.source_profile_id
         LEFT JOIN active_assignment_counts active_counts ON active_counts.profile_id = profile.id
         LEFT JOIN total_assignment_counts total_counts ON total_counts.profile_id = profile.id
         LEFT JOIN default_profile_usage default_usage ON default_usage.profile_id = profile.id
         ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY profile.profession_key, profile.is_default_for_profession DESC, profile.profile_kind, profile.title, profile.id`,
        params
    );
    const rows = safeRows(result);
    const versionsByProfile = await loadVersionsForProfiles(db, rows.map(row => row.id));
    return rows.map(row => normalizeProfile(row, {
        versions: versionsByProfile.get(Number(row.id)) || [],
        asOfDate
    }));
}

async function getPayrollProfile(profileId, options = {}) {
    return loadProfile(options.db || pool, profileId, {
        asOfDate: options.asOfDate || options.as_of_date || todayKyivDate()
    });
}

async function insertVersion(db, profile, payload, actor, options = {}) {
    if (profile.status === 'archived') {
        throw payrollProfileError('archived profile cannot receive new versions', 409, 'PAYROLL_PROFILE_ARCHIVED');
    }
    const normalized = normalizeVersionPayload(payload, options.fallback || {}, {
        reasonRequired: options.reasonRequired === true
    });
    const existingResult = await db.query(
        `SELECT *
         FROM payroll_profile_versions
         WHERE profile_id = $1
         ORDER BY version_number DESC, effective_from DESC
         FOR UPDATE`,
        [profile.id]
    );
    const existingRows = safeRows(existingResult);
    const latestRow = existingRows[0] || null;
    if (latestRow && compareDates(normalized.effectiveFrom, latestRow.effective_from) <= 0) {
        throw payrollProfileError(
            'new version must start after the latest profile version',
            409,
            'PAYROLL_PROFILE_VERSION_NOT_APPEND_ONLY'
        );
    }

    if (latestRow && (!latestRow.effective_to || dateOnly(latestRow.effective_to) >= normalized.effectiveFrom)) {
        await db.query(
            `UPDATE payroll_profile_versions
             SET effective_to = $2::date,
                 updated_at = NOW()
             WHERE id = $1`,
            [latestRow.id, addDays(normalized.effectiveFrom, -1)]
        );
    }

    const nextVersionNumber = latestRow ? Number(latestRow.version_number) + 1 : 1;
    const createdBy = actorUsername(actor);
    const inserted = await db.query(
        `INSERT INTO payroll_profile_versions
            (profile_id, version_number, rate_unit, default_rate, effective_from, effective_to,
             change_reason, created_by, activated_by, activated_at)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $8, NOW())
         RETURNING *`,
        [
            profile.id,
            nextVersionNumber,
            normalized.rateUnit,
            normalized.defaultRate,
            normalized.effectiveFrom,
            normalized.effectiveTo,
            normalized.changeReason,
            createdBy
        ]
    );
    const version = safeRows(inserted)[0];
    for (const dayRate of normalized.dayRates) {
        await db.query(
            `INSERT INTO payroll_profile_day_rates
                (profile_version_id, rate_unit, iso_weekday, rate, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $5)`,
            [version.id, normalized.rateUnit, dayRate.isoWeekday, dayRate.rate, createdBy]
        );
    }
    if (profile.status === 'draft') {
        await db.query(
            `UPDATE payroll_profiles
             SET status = 'active',
                 activated_by = COALESCE(activated_by, $2),
                 activated_at = COALESCE(activated_at, NOW()),
                 updated_by = $2,
                 updated_at = NOW()
             WHERE id = $1`,
            [profile.id, createdBy]
        );
    }
    const dayRates = await loadDayRatesForVersionIds(db, [version.id]);
    return normalizeProfileVersion(version, dayRates.get(Number(version.id)) || []);
}

async function createPayrollProfile(payload = {}, actor = null, options = {}) {
    return withTransaction(options, async db => {
        const body = payload || {};
        const professionKey = normalizeProfessionKey(body.professionKey ?? body.profession_key);
        if (!professionKey) throw payrollProfileError('professionKey is required', 400, 'PAYROLL_PROFILE_PROFESSION_REQUIRED');
        await assertProfessionExists(db, professionKey);

        const title = cleanText(body.title, 160);
        if (!title) throw payrollProfileError('title is required', 400, 'PAYROLL_PROFILE_TITLE_REQUIRED');

        const profileKind = normalizeProfileKind(body.profileKind ?? body.profile_kind, 'shared');
        const ownerStaffId = profileKind === 'personal'
            ? numberId(body.ownerStaffId ?? body.owner_staff_id, 'ownerStaffId')
            : null;
        if (ownerStaffId) await loadStaffOrThrow(db, ownerStaffId);

        const initialVersion = body.version && typeof body.version === 'object' ? body.version : body;
        const hasVersion = versionHasPayload(body);
        const isDefaultForProfession = boolValue(
            body.isDefaultForProfession ?? body.is_default_for_profession,
            false
        );
        const requestedStatus = body.status ? normalizeProfileStatus(body.status) : null;
        const status = requestedStatus || (hasVersion ? 'active' : 'draft');
        if (status === 'active' && !hasVersion) {
            throw payrollProfileError('active profile requires an initial version', 400, 'PAYROLL_PROFILE_ACTIVE_VERSION_REQUIRED');
        }
        if (isDefaultForProfession && (profileKind !== 'shared' || status !== 'active')) {
            throw payrollProfileError(
                'default profession profile must be active and shared',
                400,
                'PAYROLL_PROFILE_DEFAULT_SHAPE_INVALID'
            );
        }

        const actorName = actorUsername(actor);
        const inserted = await db.query(
            `INSERT INTO payroll_profiles
                (title, profession_key, profile_kind, owner_staff_id, is_default_for_profession,
                 status, created_by, updated_by, activated_by, activated_at)
             VALUES ($1, $2, $3, $4, $5::boolean, $6::varchar, $7, $7, $8, CASE WHEN $6::varchar = 'active' THEN NOW() ELSE NULL END)
             RETURNING *`,
            [
                title,
                professionKey,
                profileKind,
                ownerStaffId,
                isDefaultForProfession,
                status,
                actorName,
                status === 'active' ? actorName : null
            ]
        );
        const profileRow = safeRows(inserted)[0];
        if (hasVersion) await insertVersion(db, normalizeProfile(profileRow), initialVersion, actor, { reasonRequired: false });
        const after = await loadProfile(db, profileRow.id);
        await insertHrAudit(db, 'payroll_profile_create', ownerStaffId, actor, {
            reason: mutationReason(body),
            before: null,
            after
        });
        return after;
    });
}

async function resolveProfileVersion(db, profileId, payload = {}, options = {}) {
    const explicitVersionId = payload.sourceVersionId ?? payload.source_version_id ?? payload.versionId ?? payload.version_id;
    if (explicitVersionId) {
        const result = await db.query(
            `SELECT *
             FROM payroll_profile_versions
             WHERE id = $1 AND profile_id = $2${options.forShare ? ' FOR SHARE' : ''}`,
            [numberId(explicitVersionId, 'versionId'), profileId]
        );
        const row = safeRows(result)[0];
        if (!row) throw payrollProfileError('profile version not found', 404, 'PAYROLL_PROFILE_VERSION_NOT_FOUND');
        const dayRates = await loadDayRatesForVersionIds(db, [row.id]);
        return normalizeProfileVersion(row, dayRates.get(Number(row.id)) || []);
    }
    const asOfDate = normalizeDate(
        payload.sourceDate ?? payload.source_date ?? payload.asOfDate ?? payload.as_of_date ?? todayKyivDate(),
        'asOfDate',
        { required: true }
    );
    const profile = await loadProfile(db, profileId, { asOfDate });
    const version = currentVersionForDate(profile.versions, asOfDate) || latestVersion(profile.versions);
    if (!version) throw payrollProfileError('profile has no version to copy', 409, 'PAYROLL_PROFILE_VERSION_MISSING');
    return version;
}

async function createPayrollProfileClone(sourceProfileId, payload = {}, actor = null, options = {}) {
    return withTransaction(options, async db => {
        const source = await loadProfile(db, sourceProfileId, { asOfDate: payload.asOfDate || payload.as_of_date || todayKyivDate() });
        if (source.status === 'archived') {
            throw payrollProfileError('archived profile cannot be cloned', 409, 'PAYROLL_PROFILE_ARCHIVED');
        }
        const sourceVersion = await resolveProfileVersion(db, source.id, payload, { forShare: true });
        const profileKind = normalizeProfileKind(payload.profileKind ?? payload.profile_kind, 'personal');
        const ownerStaffId = profileKind === 'personal'
            ? numberId(payload.ownerStaffId ?? payload.owner_staff_id ?? payload.staffId ?? payload.staff_id, 'ownerStaffId')
            : null;
        const owner = ownerStaffId ? await loadStaffOrThrow(db, ownerStaffId) : null;
        const ownerName = cleanText(owner?.name, 80);
        const title = cleanText(payload.title, 160)
            || (ownerName ? `${source.title} · ${ownerName}` : `${source.title} clone`);
        const effectiveFrom = normalizeDate(
            payload.effectiveFrom ?? payload.effective_from ?? todayKyivDate(),
            'effectiveFrom',
            { required: true }
        );
        const actorName = actorUsername(actor);
        const inserted = await db.query(
            `INSERT INTO payroll_profiles
                (title, profession_key, profile_kind, owner_staff_id, is_default_for_profession,
                 source_profile_id, source_version_id, status, created_by, updated_by, activated_by, activated_at)
             VALUES ($1, $2, $3, $4, false, $5, $6, 'active', $7, $7, $7, NOW())
             RETURNING *`,
            [
                title,
                source.professionKey,
                profileKind,
                ownerStaffId,
                source.id,
                sourceVersion.id,
                actorName
            ]
        );
        const profileRow = safeRows(inserted)[0];
        await insertVersion(db, normalizeProfile(profileRow), {
            rateUnit: sourceVersion.rateUnit,
            defaultRate: sourceVersion.defaultRate,
            effectiveFrom,
            effectiveTo: payload.effectiveTo ?? payload.effective_to ?? null,
            changeReason: mutationReason(payload) || `Cloned from payroll profile #${source.id}`,
            dayRates: sourceVersion.dayRates
        }, actor);

        let assignment = null;
        if (boolValue(payload.assign, false) && ownerStaffId) {
            await assertStaffCanUseProfile(db, ownerStaffId, source.professionKey, Number(profileRow.id));
            const assignmentResult = await db.query(
                `INSERT INTO staff_payroll_profile_assignments
                    (staff_id, profession_key, profile_id, assignment_kind, effective_from, effective_to, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $7)
                 RETURNING *`,
                [
                    ownerStaffId,
                    source.professionKey,
                    profileRow.id,
                    normalizeAssignmentKind(payload.assignmentKind ?? payload.assignment_kind, 'explicit'),
                    effectiveFrom,
                    normalizeDate(payload.assignmentEffectiveTo ?? payload.assignment_effective_to, 'assignmentEffectiveTo'),
                    actorName
                ]
            );
            assignment = mapAssignment({
                ...safeRows(assignmentResult)[0],
                profile_title: title,
                profile_kind: profileKind,
                profile_status: 'active'
            });
        }

        const after = await loadProfile(db, profileRow.id);
        await insertHrAudit(db, 'payroll_profile_clone', ownerStaffId, actor, {
            reason: mutationReason(payload),
            sourceProfile: source,
            sourceVersion,
            before: null,
            after,
            assignment
        });
        return { profile: after, sourceProfile: source, sourceVersion, assignment };
    });
}

async function createPayrollProfileVersion(profileId, payload = {}, actor = null, options = {}) {
    return withTransaction(options, async db => {
        const before = await loadProfile(db, profileId, { forUpdate: true, forUpdateVersions: true });
        const version = await insertVersion(db, before, payload, actor, { reasonRequired: true });
        const after = await loadProfile(db, profileId);
        await insertHrAudit(db, 'payroll_profile_version_create', before.ownerStaffId, actor, {
            reason: mutationReason(payload, { required: true }),
            before,
            after,
            version
        });
        return { profile: after, version };
    });
}

function dayRateMap(version = {}) {
    return new Map((version.dayRates || []).map(rate => [Number(rate.isoWeekday), Number(rate.rate)]));
}

function buildPayrollProfileVersionDiff(personalVersion, baseVersion) {
    if (!personalVersion || !baseVersion) {
        return { hasChanges: false, fields: [] };
    }
    const fields = [];
    if (personalVersion.rateUnit !== baseVersion.rateUnit) {
        fields.push({ field: 'rate_unit', from: personalVersion.rateUnit, to: baseVersion.rateUnit });
    }
    if (Number(personalVersion.defaultRate) !== Number(baseVersion.defaultRate)) {
        fields.push({ field: 'default_rate', from: Number(personalVersion.defaultRate), to: Number(baseVersion.defaultRate) });
    }
    const personalRates = dayRateMap(personalVersion);
    const baseRates = dayRateMap(baseVersion);
    const weekdays = [...new Set([...personalRates.keys(), ...baseRates.keys()])].sort((a, b) => a - b);
    for (const day of weekdays) {
        const from = personalRates.has(day) ? personalRates.get(day) : null;
        const to = baseRates.has(day) ? baseRates.get(day) : null;
        if (from !== to) fields.push({ field: `day_rates.${day}`, isoWeekday: day, from, to });
    }
    return { hasChanges: fields.length > 0, fields };
}

function selectedSyncFields(payload = {}) {
    const raw = payload.selectedChanges ?? payload.selected_changes ?? payload.fields ?? payload.applyFields ?? payload.apply_fields;
    if (raw === undefined || raw === null) return new Set();
    if (Array.isArray(raw)) return new Set(raw.map(item => String(item).trim()).filter(Boolean));
    if (raw && typeof raw === 'object') {
        return new Set(Object.entries(raw).filter(([, enabled]) => enabled === true).map(([field]) => field));
    }
    return new Set(String(raw).split(/[,\s]+/).map(item => item.trim()).filter(Boolean));
}

function fieldSelected(selected, field) {
    if (selected.has('*') || selected.has('all')) return true;
    if (selected.has(field)) return true;
    if (field.startsWith('day_rates.') && selected.has('day_rates')) return true;
    return false;
}

function mergePayrollProfileSyncVersion(personalVersion, baseVersion, selected) {
    const selectedSet = selected instanceof Set ? selected : selectedSyncFields({ selectedChanges: selected });
    const nextRateUnit = fieldSelected(selectedSet, 'rate_unit') ? baseVersion.rateUnit : personalVersion.rateUnit;
    const nextDefaultRate = fieldSelected(selectedSet, 'default_rate') ? baseVersion.defaultRate : personalVersion.defaultRate;
    const baseDayRates = dayRateMap(baseVersion);
    const nextDayRates = new Map((personalVersion.dayRates || []).map(rate => [Number(rate.isoWeekday), Number(rate.rate)]));
    const weekdays = [...new Set([...nextDayRates.keys(), ...baseDayRates.keys()])].sort((a, b) => a - b);
    for (const day of weekdays) {
        if (!fieldSelected(selectedSet, `day_rates.${day}`)) continue;
        if (baseDayRates.has(day)) nextDayRates.set(day, baseDayRates.get(day));
        else nextDayRates.delete(day);
    }
    return {
        rateUnit: nextRateUnit,
        defaultRate: nextDefaultRate,
        dayRates: nextRateUnit === 'month'
            ? []
            : [...nextDayRates.entries()].map(([isoWeekday, rate]) => ({ isoWeekday, rate }))
                .filter(rate => Number(rate.rate) !== Number(nextDefaultRate))
                .sort((a, b) => a.isoWeekday - b.isoWeekday)
    };
}

async function syncPayrollProfileFromBase(profileId, payload = {}, actor = null, options = {}) {
    return withTransaction(options, async db => {
        const personal = await loadProfile(db, profileId, { forUpdate: true, forUpdateVersions: boolValue(payload.apply, false) });
        if (personal.profileKind !== 'personal' || !personal.sourceProfileId) {
            throw payrollProfileError('only personal cloned profiles can sync from base', 409, 'PAYROLL_PROFILE_SYNC_NOT_PERSONAL');
        }
        const source = await loadProfile(db, personal.sourceProfileId, {
            asOfDate: payload.sourceDate ?? payload.source_date ?? payload.asOfDate ?? payload.as_of_date ?? todayKyivDate()
        });
        const personalVersion = currentVersionForDate(personal.versions, payload.personalDate ?? payload.personal_date ?? todayKyivDate())
            || latestVersion(personal.versions);
        const baseVersion = await resolveProfileVersion(db, source.id, payload);
        if (!personalVersion) {
            throw payrollProfileError('personal profile has no version to sync', 409, 'PAYROLL_PROFILE_VERSION_MISSING');
        }
        const diff = buildPayrollProfileVersionDiff(personalVersion, baseVersion);
        if (!boolValue(payload.apply, false)) {
            return {
                applied: false,
                profile: personal,
                sourceProfile: source,
                personalVersion,
                baseVersion,
                diff
            };
        }
        const selected = selectedSyncFields(payload);
        if (!selected.size) {
            throw payrollProfileError('selectedChanges is required for sync apply', 400, 'PAYROLL_PROFILE_SYNC_FIELDS_REQUIRED');
        }
        const merged = mergePayrollProfileSyncVersion(personalVersion, baseVersion, selected);
        const version = await insertVersion(db, personal, {
            ...merged,
            effectiveFrom: payload.effectiveFrom ?? payload.effective_from,
            effectiveTo: payload.effectiveTo ?? payload.effective_to ?? null,
            changeReason: mutationReason(payload, { required: true })
        }, actor, { reasonRequired: true });
        const after = await loadProfile(db, personal.id);
        await insertHrAudit(db, 'payroll_profile_sync_from_base', personal.ownerStaffId, actor, {
            reason: mutationReason(payload, { required: true }),
            selectedChanges: [...selected],
            sourceProfile: source,
            baseVersion,
            personalVersion,
            diff,
            before: personal,
            after
        });
        return {
            applied: true,
            profile: after,
            sourceProfile: source,
            personalVersion,
            baseVersion,
            diff,
            version
        };
    });
}

async function archivePayrollProfile(profileId, payload = {}, actor = null, options = {}) {
    return withTransaction(options, async db => {
        const before = await loadProfile(db, profileId, { forUpdate: true });
        if (before.status === 'archived') return { profile: before, archived: false };
        const today = normalizeDate(payload.today || todayKyivDate(), 'today', { required: true });
        const assignmentResult = await db.query(
            `SELECT COUNT(*)::int AS count
             FROM staff_payroll_profile_assignments
             WHERE profile_id = $1
               AND (effective_to IS NULL OR effective_to >= $2::date)`,
            [before.id, today]
        );
        const activeAssignments = Number(safeRows(assignmentResult)[0]?.count || 0);
        if (activeAssignments > 0) {
            throw payrollProfileError(
                'profile has active or future assignments',
                409,
                'PAYROLL_PROFILE_ACTIVE_ASSIGNMENTS_BLOCK_ARCHIVE',
                { activeAssignments }
            );
        }
        await db.query(
            `UPDATE payroll_profiles
             SET status = 'archived',
                 is_default_for_profession = false,
                 archived_by = $2,
                 archived_at = NOW(),
                 updated_by = $2,
                 updated_at = NOW()
             WHERE id = $1`,
            [before.id, actorUsername(actor)]
        );
        const after = await loadProfile(db, before.id);
        await insertHrAudit(db, 'payroll_profile_archive', before.ownerStaffId, actor, {
            reason: mutationReason(payload, { required: true }),
            before,
            after
        });
        return { profile: after, archived: true };
    });
}

async function assertStaffCanUseProfile(db, staffId, professionKey, profileId) {
    const profileResult = await db.query(
        `SELECT id, profession_key, profile_kind, owner_staff_id, status
         FROM payroll_profiles
         WHERE id = $1 AND profession_key = $2
         FOR SHARE`,
        [profileId, professionKey]
    );
    const profile = safeRows(profileResult)[0];
    if (!profile) throw payrollProfileError('profile does not match assignment profession', 404, 'PAYROLL_ASSIGNMENT_PROFILE_NOT_FOUND');
    if (profile.status !== 'active') {
        throw payrollProfileError('only active payroll profiles can be assigned', 409, 'PAYROLL_ASSIGNMENT_PROFILE_INACTIVE');
    }
    if (profile.profile_kind === 'personal' && Number(profile.owner_staff_id) !== Number(staffId)) {
        throw payrollProfileError('personal payroll profile can only be assigned to its owner', 409, 'PAYROLL_ASSIGNMENT_PERSONAL_OWNER_MISMATCH');
    }
    const hasProfession = await staffHasProfession(db, staffId, professionKey);
    if (!hasProfession) {
        throw payrollProfileError('staff member is not assigned to this profession', 409, 'PAYROLL_ASSIGNMENT_STAFF_PROFESSION_MISMATCH');
    }
    return profile;
}

function normalizeAssignmentPayload(item = {}) {
    const professionKey = normalizeProfessionKey(item.professionKey ?? item.profession_key);
    if (!professionKey) throw payrollProfileError('assignment professionKey is required', 400, 'PAYROLL_ASSIGNMENT_PROFESSION_REQUIRED');
    const profileId = numberId(item.profileId ?? item.profile_id, 'profileId');
    const assignmentKind = normalizeAssignmentKind(item.assignmentKind ?? item.assignment_kind, 'explicit');
    const effectiveFrom = normalizeDate(item.effectiveFrom ?? item.effective_from, 'effectiveFrom', { required: true });
    const effectiveTo = normalizeDate(item.effectiveTo ?? item.effective_to, 'effectiveTo');
    if (effectiveTo && effectiveTo < effectiveFrom) {
        throw payrollProfileError('assignment effectiveTo must be on or after effectiveFrom', 400, 'PAYROLL_ASSIGNMENT_DATE_RANGE_INVALID');
    }
    if (assignmentKind === 'temporary' && !effectiveTo) {
        throw payrollProfileError('temporary assignment requires effectiveTo', 400, 'PAYROLL_ASSIGNMENT_TEMPORARY_END_REQUIRED');
    }
    return {
        id: item.id == null || item.id === '' ? null : numberId(item.id, 'assignmentId'),
        professionKey,
        profileId,
        assignmentKind,
        effectiveFrom,
        effectiveTo
    };
}

function assertNoAssignmentOverlap(assignments = []) {
    const byProfession = new Map();
    for (const assignment of assignments) {
        if (!byProfession.has(assignment.professionKey)) byProfession.set(assignment.professionKey, []);
        byProfession.get(assignment.professionKey).push(assignment);
    }
    for (const [professionKey, rows] of byProfession.entries()) {
        const sorted = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
        for (let index = 1; index < sorted.length; index += 1) {
            const previous = sorted[index - 1];
            const current = sorted[index];
            const previousEnd = previous.effectiveTo || '9999-12-31';
            if (previousEnd >= current.effectiveFrom) {
                throw payrollProfileError(
                    'assignment periods overlap',
                    409,
                    'PAYROLL_ASSIGNMENT_PERIOD_OVERLAP',
                    { professionKey }
                );
            }
        }
    }
}

async function queryStaffAssignments(db, staffId, filters = {}) {
    const clauses = ['assignment.staff_id = $1'];
    const params = [numberId(staffId, 'staffId')];
    if (!boolValue(filters.includePast ?? filters.include_past, true)) {
        params.push(normalizeDate(filters.today || todayKyivDate(), 'today', { required: true }));
        clauses.push(`(assignment.effective_to IS NULL OR assignment.effective_to >= $${params.length}::date)`);
    }
    const result = await db.query(
        `SELECT assignment.*,
                profession.title AS profession_title,
                profile.title AS profile_title,
                profile.profile_kind,
                profile.status AS profile_status
         FROM staff_payroll_profile_assignments assignment
         JOIN payroll_profiles profile ON profile.id = assignment.profile_id
         JOIN hr_professions profession ON profession.key = assignment.profession_key
         WHERE ${clauses.join(' AND ')}
         ORDER BY assignment.effective_from DESC, assignment.profession_key, assignment.id DESC`,
        params
    );
    return safeRows(result).map(mapAssignment);
}

async function listStaffPayrollProfileAssignments(staffId, options = {}) {
    const db = options.db || pool;
    const staff = await loadStaffOrThrow(db, staffId);
    return {
        staff: { id: Number(staff.id), name: staff.name },
        assignments: await queryStaffAssignments(db, staffId, options)
    };
}

async function saveStaffPayrollProfileAssignments(staffId, payload = {}, actor = null, options = {}) {
    return withTransaction(options, async db => {
        const staff = await loadStaffOrThrow(db, staffId, { forUpdate: true });
        const before = await queryStaffAssignments(db, staff.id, { includePast: true });
        const inputAssignments = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload.assignments) ? payload.assignments : []);
        const assignments = inputAssignments.map(normalizeAssignmentPayload);
        assertNoAssignmentOverlap(assignments);
        for (const assignment of assignments) {
            await assertStaffCanUseProfile(db, staff.id, assignment.professionKey, assignment.profileId);
        }

        const actorName = actorUsername(actor);
        const mode = cleanText(payload.mode, 20) === 'patch' ? 'patch' : 'replace';
        if (mode === 'replace') {
            const replaceFrom = normalizeDate(
                payload.replaceFrom ?? payload.replace_from ?? assignments.map(item => item.effectiveFrom).sort()[0] ?? todayKyivDate(),
                'replaceFrom',
                { required: true }
            );
            await db.query(
                `DELETE FROM staff_payroll_profile_assignments
                 WHERE staff_id = $1
                   AND (effective_to IS NULL OR effective_to >= $2::date)`,
                [staff.id, replaceFrom]
            );
        } else {
            const removeIds = (payload.removeAssignmentIds ?? payload.remove_assignment_ids ?? [])
                .map(id => numberId(id, 'assignmentId'));
            if (removeIds.length) {
                await db.query(
                    `DELETE FROM staff_payroll_profile_assignments
                     WHERE staff_id = $1 AND id = ANY($2::bigint[])`,
                    [staff.id, removeIds]
                );
            }
        }

        for (const assignment of assignments) {
            if (mode === 'patch' && assignment.id) {
                await db.query(
                    `UPDATE staff_payroll_profile_assignments
                     SET profession_key = $3,
                         profile_id = $4,
                         assignment_kind = $5,
                         effective_from = $6::date,
                         effective_to = $7::date,
                         updated_by = $8,
                         updated_at = NOW()
                     WHERE id = $2 AND staff_id = $1`,
                    [
                        staff.id,
                        assignment.id,
                        assignment.professionKey,
                        assignment.profileId,
                        assignment.assignmentKind,
                        assignment.effectiveFrom,
                        assignment.effectiveTo,
                        actorName
                    ]
                );
                continue;
            }
            await db.query(
                `INSERT INTO staff_payroll_profile_assignments
                    (staff_id, profession_key, profile_id, assignment_kind, effective_from, effective_to, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $7)`,
                [
                    staff.id,
                    assignment.professionKey,
                    assignment.profileId,
                    assignment.assignmentKind,
                    assignment.effectiveFrom,
                    assignment.effectiveTo,
                    actorName
                ]
            );
        }

        const after = await queryStaffAssignments(db, staff.id, { includePast: true });
        await insertHrAudit(db, 'staff_payroll_profile_assignments_update', staff.id, actor, {
            reason: mutationReason(payload, { required: true }),
            mode,
            before,
            after
        });
        return {
            staff: { id: Number(staff.id), name: staff.name },
            assignments: after
        };
    });
}

async function listStaffPayrollProfileHistory(staffId, options = {}) {
    const db = options.db || pool;
    const staff = await loadStaffOrThrow(db, staffId);
    const assignments = await queryStaffAssignments(db, staff.id, { includePast: true });
    const auditResult = await db.query(
        `SELECT id, action, staff_id, performed_by, details, ip_address, created_at
         FROM hr_audit_log
         WHERE staff_id = $1
           AND action = ANY($2::varchar[])
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [staff.id, PAYROLL_PROFILE_AUDIT_ACTIONS, Math.min(200, Math.max(1, Number(options.limit || 100)))]
    );
    return {
        staff: { id: Number(staff.id), name: staff.name },
        assignments,
        audit: safeRows(auditResult).map(row => ({
            id: Number(row.id),
            action: row.action,
            staff_id: row.staff_id == null ? null : Number(row.staff_id),
            staffId: row.staff_id == null ? null : Number(row.staff_id),
            performed_by: row.performed_by || null,
            performedBy: row.performed_by || null,
            details: parseJsonObject(row.details) || row.details || null,
            ip_address: row.ip_address || null,
            ipAddress: row.ip_address || null,
            created_at: row.created_at,
            createdAt: row.created_at
        }))
    };
}

function monthFromDate(dateValue) {
    return normalizeDate(dateValue, 'date', { required: true }).slice(0, 7);
}

function uniquePositiveIds(values = [], field = 'id') {
    return [...new Set((Array.isArray(values) ? values : [values])
        .map(value => Number(value))
        .filter(value => Number.isInteger(value) && value > 0))]
        .map(value => numberId(value, field));
}

function normalizeSimulationPeriod(payload = {}) {
    const month = cleanText(payload.month, 7);
    const fallback = month && /^\d{4}-\d{2}$/.test(month) ? payrollMonthRange(month) : {
        from: todayKyivDate(),
        to: addDays(todayKyivDate(), 6)
    };
    const from = normalizeDate(payload.from ?? payload.dateFrom ?? payload.date_from ?? fallback.from, 'from', { required: true });
    const to = normalizeDate(payload.to ?? payload.dateTo ?? payload.date_to ?? fallback.to, 'to', { required: true });
    if (to < from) throw payrollProfileError('period to must be on or after from', 400, 'PAYROLL_PROFILE_PERIOD_INVALID');
    return { from, to, month: from.slice(0, 7) };
}

function datesInRange(from, to) {
    const start = normalizeDate(from, 'from', { required: true });
    const end = normalizeDate(to, 'to', { required: true });
    const dates = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) dates.push(cursor);
    return dates;
}

function timeToMinutes(value) {
    const match = String(value || '').slice(0, 5).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return 0;
    return Math.max(0, Math.min(24 * 60, Number(match[1]) * 60 + Number(match[2])));
}

function plannedMinutesFromTimes(start, end, breakMinutes = 0) {
    const startMinutes = timeToMinutes(start);
    let endMinutes = timeToMinutes(end);
    if (endMinutes < startMinutes) endMinutes += 24 * 60;
    return Math.max(0, endMinutes - startMinutes - Math.max(0, Number(breakMinutes || 0)));
}

function resolverVersionFromProfileVersion(version = {}) {
    const dayRates = new Map();
    (version.dayRates || version.day_rates || []).forEach(rate => {
        const weekday = Number(rate.isoWeekday ?? rate.iso_weekday);
        const amount = Number(rate.rate);
        if (weekday >= 1 && weekday <= 7 && Number.isFinite(amount)) dayRates.set(weekday, amount);
    });
    return {
        id: Number(version.id || version.version_id || -1),
        profileId: Number(version.profileId || version.profile_id || 0),
        versionNumber: Number(version.versionNumber || version.version_number || 1),
        rateUnit: normalizeRateUnit(version.rateUnit || version.rate_unit || 'hour', 'hour'),
        defaultRate: Number(version.defaultRate ?? version.default_rate ?? 0),
        effectiveFrom: normalizeDate(version.effectiveFrom || version.effective_from || todayKyivDate(), 'effectiveFrom', { required: true }),
        effectiveTo: normalizeDate(version.effectiveTo || version.effective_to, 'effectiveTo'),
        changeReason: version.changeReason || version.change_reason || null,
        dayRates
    };
}

function resolverProfileFromPayrollProfile(profile = {}, fallbackProfessionKey = '') {
    const versions = [];
    const sourceVersions = Array.isArray(profile.versions) && profile.versions.length
        ? profile.versions
        : [profile.currentVersion || profile.current_version, profile.latestVersion || profile.latest_version].filter(Boolean);
    for (const version of sourceVersions) {
        if (!version) continue;
        versions.push(resolverVersionFromProfileVersion(version));
    }
    return {
        id: Number(profile.id || 0),
        title: profile.title || '',
        professionKey: normalizeProfessionKey(profile.professionKey || profile.profession_key || fallbackProfessionKey),
        profileKind: profile.profileKind || profile.profile_kind || 'shared',
        ownerStaffId: profile.ownerStaffId ?? profile.owner_staff_id ?? null,
        isDefaultForProfession: profile.isDefaultForProfession ?? profile.is_default_for_profession ?? false,
        sourceProfileId: profile.sourceProfileId ?? profile.source_profile_id ?? null,
        sourceVersionId: profile.sourceVersionId ?? profile.source_version_id ?? null,
        status: profile.status || 'active',
        versions
    };
}

function resolverContextWithDefaultProfile(profile, { staffId = 1, professionKey = '', from = null, to = null } = {}) {
    const resolverProfile = resolverProfileFromPayrollProfile(profile, professionKey);
    const key = normalizeProfessionKey(professionKey || resolverProfile.professionKey);
    return {
        enabled: true,
        from,
        to,
        profilesById: new Map([[resolverProfile.id, resolverProfile]]),
        assignmentsByStaffProfession: new Map(),
        defaultProfilesByProfession: new Map([[key, resolverProfile]]),
        warnings: [],
        staffId
    };
}

function buildSimulationDays(payload = {}, period = normalizeSimulationPeriod(payload)) {
    const explicitDays = Array.isArray(payload.days) ? payload.days : [];
    if (explicitDays.length) {
        return explicitDays.map(day => {
            const date = normalizeDate(day.date || day.workDate || day.work_date, 'day.date', { required: true });
            const minutes = Math.max(0, Number(day.minutes ?? day.actualMinutes ?? day.actual_minutes ?? (Number(day.hours || 0) * 60)) || 0);
            const overtimeMinutes = Math.max(0, Number(day.overtimeMinutes ?? day.overtime_minutes ?? (Number(day.overtimeHours || 0) * 60)) || 0);
            return { date, minutes, overtimeMinutes };
        }).filter(day => day.minutes > 0 || day.overtimeMinutes > 0);
    }
    const hoursPerDay = Math.max(0, Number(payload.hoursPerDay ?? payload.hours_per_day ?? payload.hours ?? 0) || 0);
    const exits = Math.max(0, Number(payload.exits ?? payload.daysCount ?? payload.days_count ?? 0) || 0);
    const weekdaySet = new Set((payload.weekdays || payload.isoWeekdays || payload.iso_weekdays || [])
        .map(Number)
        .filter(day => day >= 1 && day <= 7));
    const allDates = datesInRange(period.from, period.to);
    const selected = allDates.filter(date => {
        const iso = weekdayNumber(new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7);
        return !weekdaySet.size || weekdaySet.has(iso);
    });
    const limit = exits > 0 ? Math.min(exits, selected.length) : selected.length;
    return selected.slice(0, limit).map(date => ({ date, minutes: Math.round(hoursPerDay * 60), overtimeMinutes: 0 }));
}

function simulateProfileAmount(profile, payload = {}) {
    const period = normalizeSimulationPeriod(payload);
    const professionKey = normalizeProfessionKey(payload.professionKey || payload.profession_key || profile.professionKey || profile.profession_key);
    if (!professionKey) throw payrollProfileError('professionKey is required for simulation', 400, 'PAYROLL_SIM_PROFESSION_REQUIRED');
    const staffId = Number(payload.staffId || payload.staff_id || 1);
    const staff = {
        id: Number.isInteger(staffId) && staffId > 0 ? staffId : 1,
        roleType: professionKey,
        hourlyRate: 0,
        rateUnit: 'hour'
    };
    const context = resolverContextWithDefaultProfile(profile, { staffId: staff.id, professionKey, from: period.from, to: period.to });
    const days = buildSimulationDays(payload, period);
    let monthPaid = false;
    const breakdown = days.map(day => {
        const resolution = resolveEffectivePayrollProfile(staff, professionKey, day.date, { payrollProfileContext: context, preferredRateUnit: 'hour' });
        const hours = Math.round((day.minutes / 60) * 100) / 100;
        const overtimeHours = Math.round((day.overtimeMinutes / 60) * 100) / 100;
        let baseAmount = 0;
        let overtimeAmount = 0;
        let formula = '';
        if (resolution.rateUnit === 'month') {
            const shouldPayMonth = !monthPaid;
            baseAmount = shouldPayMonth ? Math.round(Number(resolution.rate || 0)) : 0;
            formula = shouldPayMonth ? `1 × ${resolution.rate}` : 'already paid this period';
            monthPaid = true;
        } else if (resolution.rateUnit === 'day') {
            baseAmount = day.minutes > 0 ? Math.round(Number(resolution.rate || 0)) : 0;
            formula = day.minutes > 0 ? `1 вихід × ${resolution.rate}` : '0 виходів';
        } else {
            baseAmount = Math.round(hours * Number(resolution.rate || 0));
            overtimeAmount = Math.round(overtimeHours * Number(resolution.rate || 0) * OVERTIME_MULTIPLIER);
            formula = `${hours} год × ${resolution.rate}${overtimeHours ? ` + ${overtimeHours} overtime × ${resolution.rate} × ${OVERTIME_MULTIPLIER}` : ''}`;
        }
        return {
            date: day.date,
            hours,
            overtimeHours,
            rate: resolution.rate,
            rateUnit: resolution.rateUnit,
            amount: baseAmount + overtimeAmount,
            baseAmount,
            overtimeAmount,
            profileId: resolution.profileId,
            profileVersionId: resolution.profileVersionId,
            appliedRule: resolution.appliedRule,
            rateSource: resolution.rateSource,
            formula
        };
    });
    const total = breakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { profile: { id: profile.id, title: profile.title }, period, professionKey, total, breakdown };
}

async function simulatePayrollProfiles(payload = {}, options = {}) {
    const db = options.db || pool;
    const profileAId = payload.profileAId ?? payload.profile_a_id ?? payload.profileId ?? payload.profile_id;
    const profileBId = payload.profileBId ?? payload.profile_b_id ?? payload.compareProfileId ?? payload.compare_profile_id;
    const profileA = await loadProfile(db, profileAId, { asOfDate: payload.from || todayKyivDate() });
    const result = { primary: simulateProfileAmount(profileA, payload) };
    if (profileBId) {
        const profileB = await loadProfile(db, profileBId, { asOfDate: payload.from || todayKyivDate() });
        result.compare = simulateProfileAmount(profileB, payload);
        result.delta = Math.round(result.compare.total - result.primary.total);
    }
    return result;
}

function emptyForecastMetrics(staffId) {
    return {
        staffId,
        totalMinutes: 0,
        allocatedMinutes: 0,
        plannedMinutes: 0,
        overtimeMinutes: 0,
        hoursWorked: 0,
        overtimeHours: 0,
        daysWorked: 0,
        professionAllocations: [],
        overtimeAllocations: [],
        primaryDays: [],
        attendanceDays: [],
        allocationIssues: [],
        reconciliation: { days: [], warnings: [] }
    };
}

function addForecastShiftToMetrics(metrics, shift) {
    const date = normalizeDate(shift.shift_date || shift.date, 'shiftDate', { required: true });
    const professionKey = normalizeProfessionKey(shift.profession_key || shift.professionKey || shift.role_type);
    const minutes = Math.max(0, Number(shift.planned_minutes || 0));
    if (!date || !professionKey || minutes <= 0) return;
    metrics.totalMinutes += minutes;
    metrics.allocatedMinutes += minutes;
    metrics.plannedMinutes += minutes;
    metrics.primaryDays.push({ date, professionKey });
    metrics.attendanceDays.push({
        date,
        attendanceRef: null,
        plannedShiftRef: Number(shift.id || 0) || null,
        segmentRefs: [],
        plannedMinutes: minutes,
        actualMinutes: minutes,
        overtimeMinutes: 0,
        allocationSource: 'hr_shifts_forecast',
        primaryProfessionKey: professionKey,
        segmentAllocations: [{
            professionKey,
            actualMinutes: minutes
        }]
    });
}

async function loadForecastShiftRows(db, period, filters = {}) {
    const params = [period.from, period.to];
    const clauses = ['hs.shift_date >= $1::date', 'hs.shift_date <= $2::date'];
    const staffIds = uniquePositiveIds(filters.staffIds || filters.staff_ids || [], 'staffId');
    if (staffIds.length) {
        params.push(staffIds);
        clauses.push(`hs.staff_id = ANY($${params.length}::int[])`);
    }
    const professionKey = normalizeProfessionKey(filters.professionKey || filters.profession_key);
    if (professionKey) {
        params.push(professionKey);
        clauses.push(`COALESCE(hs.profession_key, s.role_type) = $${params.length}`);
    }
    const result = await db.query(
        `SELECT hs.id,
                hs.staff_id,
                hs.shift_date::text AS shift_date,
                hs.planned_start::text AS planned_start,
                hs.planned_end::text AS planned_end,
                COALESCE(hs.break_minutes, 0)::int AS break_minutes,
                COALESCE(hs.profession_key, s.role_type) AS profession_key,
                s.name AS staff_name,
                s.role_type,
                s.department,
                COALESCE(s.hourly_rate, 0)::numeric AS hourly_rate,
                COALESCE(s.rate_unit, 'hour') AS rate_unit
         FROM hr_shifts hs
         JOIN staff s ON s.id = hs.staff_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY hs.shift_date, s.name, hs.id`,
        params
    );
    return safeRows(result).map(row => ({
        ...row,
        planned_minutes: plannedMinutesFromTimes(row.planned_start, row.planned_end, row.break_minutes)
    }));
}

function applyProfileOverrideToContext(context, profile, draftVersion = null) {
    if (!profile || !context?.enabled) return context;
    const override = resolverProfileFromPayrollProfile(profile, profile.professionKey || profile.profession_key);
    if (draftVersion) {
        const version = resolverVersionFromProfileVersion({
            ...draftVersion,
            id: draftVersion.id || -Number(profile.id || 1),
            profile_id: profile.id,
            profileId: profile.id,
            version_number: draftVersion.versionNumber || draftVersion.version_number || ((profile.latestVersion?.versionNumber || profile.latest_version?.version_number || 0) + 1)
        });
        override.versions.push(version);
        override.versions.sort((left, right) => (
            String(left.effectiveFrom || '').localeCompare(String(right.effectiveFrom || ''))
            || Number(left.versionNumber || 0) - Number(right.versionNumber || 0)
            || Number(left.id || 0) - Number(right.id || 0)
        ));
    }
    context.profilesById.set(Number(override.id), override);
    for (const [key, assignments] of context.assignmentsByStaffProfession.entries()) {
        context.assignmentsByStaffProfession.set(key, assignments.map(assignment => (
            Number(assignment.profileId) === Number(override.id)
                ? { ...assignment, profile: override }
                : assignment
        )));
    }
    const defaultKey = normalizeProfessionKey(override.professionKey);
    if (context.defaultProfilesByProfession.get(defaultKey)?.id === override.id || override.isDefaultForProfession) {
        context.defaultProfilesByProfession.set(defaultKey, override);
    }
    return context;
}

async function forecastPayrollProfiles(options = {}, serviceOptions = {}) {
    const db = serviceOptions.db || pool;
    const period = normalizeSimulationPeriod(options);
    const shifts = await loadForecastShiftRows(db, period, options);
    const staffIds = [...new Set(shifts.map(row => Number(row.staff_id)).filter(Number.isInteger))];
    const metricsByStaff = new Map(staffIds.map(id => [id, emptyForecastMetrics(id)]));
    const staffById = new Map();
    for (const row of shifts) {
        const staffId = Number(row.staff_id);
        if (!staffById.has(staffId)) {
            staffById.set(staffId, {
                id: staffId,
                name: row.staff_name,
                roleType: row.role_type,
                role_type: row.role_type,
                department: row.department,
                hourlyRate: Number(row.hourly_rate || 0),
                hourly_rate: Number(row.hourly_rate || 0),
                rateUnit: normalizeRateUnit(row.rate_unit || 'hour', 'hour'),
                rate_unit: normalizeRateUnit(row.rate_unit || 'hour', 'hour')
            });
        }
        addForecastShiftToMetrics(metricsByStaff.get(staffId), row);
    }
    for (const metrics of metricsByStaff.values()) {
        const workedDates = new Set(metrics.attendanceDays.map(day => day.date).filter(Boolean));
        metrics.daysWorked = workedDates.size;
        metrics.hoursWorked = Math.round((metrics.totalMinutes / 60) * 10) / 10;
        metrics.reconciliation = { days: metrics.attendanceDays, warnings: [] };
    }
    const [schemeMap, professionRateMap, profileContext] = await Promise.all([
        loadActivePayrollSchemeMap(staffIds, period.month, db),
        loadProfessionRateMap(staffIds, db),
        loadPayrollProfileContext(staffIds, period, db)
    ]);
    if (options.profileOverride) {
        applyProfileOverrideToContext(profileContext, options.profileOverride.profile, options.profileOverride.version);
    }
    const rows = staffIds.map(staffId => {
        const staff = staffById.get(staffId);
        const metrics = metricsByStaff.get(staffId) || emptyForecastMetrics(staffId);
        const scheme = schemeMap.get(staffId) || {
            schemeType: staff.rateUnit === 'month' ? 'monthly_fixed' : (staff.rateUnit === 'day' ? 'per_shift' : 'hourly'),
            config: {},
            isFallback: true
        };
        const pay = calculateProfessionPay(staff, scheme, metrics, professionRateMap, profileContext);
        return {
            staff_id: staffId,
            staffId,
            staff_name: staff.name,
            staffName: staff.name,
            role_type: staff.roleType,
            department: staff.department,
            planned_days: metrics.daysWorked,
            planned_hours: metrics.hoursWorked,
            base_salary: Math.round(pay.baseAmount || 0),
            overtime_pay: Math.round(pay.overtimeAmount || 0),
            total_salary: Math.round(pay.totalAmount || 0),
            profession_rate_summary: pay.professionRateSummary || [],
            allocation_issues: pay.allocationIssues || [],
            reconciliation: pay.reconciliation || metrics.reconciliation
        };
    });
    const totals = rows.reduce((acc, row) => {
        acc.staff += 1;
        acc.planned_days += Number(row.planned_days || 0);
        acc.planned_hours += Number(row.planned_hours || 0);
        acc.base_salary += Number(row.base_salary || 0);
        acc.overtime_pay += Number(row.overtime_pay || 0);
        acc.total_salary += Number(row.total_salary || 0);
        return acc;
    }, { staff: 0, planned_days: 0, planned_hours: 0, base_salary: 0, overtime_pay: 0, total_salary: 0 });
    totals.planned_hours = Math.round(totals.planned_hours * 10) / 10;

    let actual = null;
    if (boolValue(options.includeActual ?? options.include_actual, false) && staffIds.length) {
        const actualMetrics = await loadPayrollAttendanceMetrics({
            from: period.from,
            to: period.to,
            staffIds
        }, db);
        const actualRows = staffIds.map(staffId => {
            const staff = staffById.get(staffId);
            const metrics = actualMetrics.get(staffId) || emptyForecastMetrics(staffId);
            const scheme = schemeMap.get(staffId) || {
                schemeType: staff.rateUnit === 'month' ? 'monthly_fixed' : (staff.rateUnit === 'day' ? 'per_shift' : 'hourly'),
                config: {},
                isFallback: true
            };
            const pay = calculateProfessionPay(staff, scheme, metrics, professionRateMap, profileContext);
            return {
                staff_id: staffId,
                staffId,
                staff_name: staff.name,
                staffName: staff.name,
                actual_days: Number(metrics.daysWorked || 0),
                actual_hours: Number(metrics.hoursWorked || 0),
                actual_salary: Math.round(pay.totalAmount || 0),
                profession_rate_summary: pay.professionRateSummary || [],
                allocation_issues: pay.allocationIssues || [],
                reconciliation: pay.reconciliation || metrics.reconciliation
            };
        });
        const actualTotals = actualRows.reduce((acc, row) => {
            acc.staff += 1;
            acc.actual_days += Number(row.actual_days || 0);
            acc.actual_hours += Number(row.actual_hours || 0);
            acc.actual_salary += Number(row.actual_salary || 0);
            return acc;
        }, { staff: 0, actual_days: 0, actual_hours: 0, actual_salary: 0 });
        actualTotals.actual_hours = Math.round(actualTotals.actual_hours * 10) / 10;
        actual = {
            rows: actualRows,
            totals: actualTotals,
            planVsActual: {
                plannedSalary: totals.total_salary,
                actualSalary: actualTotals.actual_salary,
                delta: Math.round(actualTotals.actual_salary - totals.total_salary),
                plannedHours: totals.planned_hours,
                actualHours: actualTotals.actual_hours,
                hoursDelta: Math.round((actualTotals.actual_hours - totals.planned_hours) * 10) / 10
            }
        };
    }

    const byProfession = new Map();
    const byDate = new Map();
    for (const row of rows) {
        for (const segment of row.profession_rate_summary || []) {
            const professionKey = normalizeProfessionKey(segment.profession_key || segment.professionKey);
            const date = dateOnly(segment.work_date || segment.workDate) || period.from;
            const amount = Number(segment.amount || 0);
            if (professionKey) {
                if (!byProfession.has(professionKey)) byProfession.set(professionKey, { profession_key: professionKey, amount: 0, hours: 0, days: 0 });
                const target = byProfession.get(professionKey);
                target.amount += amount;
                target.hours += Number(segment.hours || 0);
                target.days += Number(segment.days || 0);
            }
            if (date) {
                if (!byDate.has(date)) byDate.set(date, { date, amount: 0 });
                byDate.get(date).amount += amount;
            }
        }
    }
    return {
        period,
        source: 'hr_shifts',
        rows,
        totals,
        byProfession: [...byProfession.values()].sort((a, b) => b.amount - a.amount),
        expensiveDays: [...byDate.values()].sort((a, b) => b.amount - a.amount).slice(0, 14),
        actual,
        profileContextWarnings: profileContext.warnings || []
    };
}

function activeStaffProfessionCte() {
    return `profession_staff AS (
        SELECT DISTINCT
               s.id AS staff_id,
               s.name AS staff_name,
               s.role_type,
               s.department,
               lower(regexp_replace(BTRIM(assignments.profession_key), '[^a-zA-Z0-9_:-]+', '_', 'g')) AS profession_key
        FROM staff s
        CROSS JOIN LATERAL (
            SELECT NULLIF(BTRIM(s.role_type), '') AS profession_key
            UNION ALL
            SELECT NULLIF(BTRIM(secondary.value), '') AS profession_key
            FROM jsonb_array_elements_text(COALESCE(s.secondary_professions, '[]'::jsonb)) AS secondary(value)
            UNION ALL
            SELECT NULLIF(BTRIM(sra.profession_key), '') AS profession_key
            FROM staff_role_assignments sra
            WHERE sra.staff_id = s.id
              AND COALESCE(sra.status, 'active') = 'active'
        ) assignments
        WHERE COALESCE(s.is_active, true) = true
          AND NULLIF(BTRIM(assignments.profession_key), '') IS NOT NULL
    )`;
}

async function loadActiveStaffProfessionRows(db) {
    const result = await db.query(
        `WITH ${activeStaffProfessionCte()}
         SELECT staff_id, staff_name, role_type, department, profession_key
         FROM profession_staff
         ORDER BY staff_name, staff_id, profession_key`
    );
    return safeRows(result).map(row => ({
        staff_id: Number(row.staff_id),
        staffId: Number(row.staff_id),
        staff_name: row.staff_name,
        staffName: row.staff_name,
        role_type: row.role_type,
        roleType: row.role_type,
        department: row.department,
        profession_key: normalizeProfessionKey(row.profession_key),
        professionKey: normalizeProfessionKey(row.profession_key)
    })).filter(row => row.staffId > 0 && row.professionKey);
}

function payrollIssue(type, severity, message, details = {}) {
    return {
        type,
        severity,
        message,
        ...details
    };
}

function summarizePayrollIssues(issues = []) {
    const byType = {};
    const bySeverity = {};
    for (const issue of issues) {
        byType[issue.type] = (byType[issue.type] || 0) + 1;
        bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }
    return {
        total: issues.length,
        byType,
        bySeverity,
        blocking: issues.filter(issue => issue.severity === 'error').length
    };
}

async function diagnosePayrollProfiles(options = {}, serviceOptions = {}) {
    const db = serviceOptions.db || pool;
    const asOfDate = normalizeDate(options.asOfDate || options.as_of_date || todayKyivDate(), 'asOfDate', { required: true });
    const issues = [];
    const staffProfessionRows = await loadActiveStaffProfessionRows(db);
    const staffIds = [...new Set(staffProfessionRows.map(row => row.staffId))];
    const [profileContext, professionRateMap, schemeMap] = await Promise.all([
        loadPayrollProfileContext(staffIds, { from: asOfDate, to: asOfDate }, db),
        loadProfessionRateMap(staffIds, db),
        loadActivePayrollSchemeMap(staffIds, asOfDate.slice(0, 7), db)
    ]);

    for (const row of staffProfessionRows) {
        const staff = {
            id: row.staffId,
            name: row.staffName,
            roleType: row.roleType,
            role_type: row.role_type,
            department: row.department,
            hourlyRate: 0,
            hourly_rate: 0,
            rateUnit: 'hour',
            rate_unit: 'hour'
        };
        const scheme = schemeMap.get(row.staffId) || null;
        const resolved = resolveEffectivePayrollProfile(staff, row.professionKey, asOfDate, {
            payrollProfileContext: profileContext,
            scheme,
            professionRateMap,
            preferredRateUnit: 'hour'
        });
        if (!resolved.profileId && String(resolved.rateSource || '').startsWith('legacy')) {
            issues.push(payrollIssue('legacy_fallback', 'warning', 'Оплата йде через legacy fallback, а не через зарплатний профіль.', {
                staffId: row.staffId,
                staffName: row.staffName,
                professionKey: row.professionKey,
                rateSource: resolved.rateSource,
                rate: resolved.rate,
                rateUnit: resolved.rateUnit
            }));
        } else if (!resolved.profileId || resolved.rate <= 0 || resolved.sourceOrder === 'unresolved') {
            issues.push(payrollIssue('staff_without_profile', 'error', 'Для staff/profession не знайдено активний зарплатний профіль зі ставкою.', {
                staffId: row.staffId,
                staffName: row.staffName,
                professionKey: row.professionKey,
                rateSource: resolved.rateSource,
                rate: resolved.rate,
                rateUnit: resolved.rateUnit
            }));
        }
    }

    const mismatchResult = await db.query(
        `SELECT assignment.id,
                assignment.staff_id,
                staff.name AS staff_name,
                assignment.profession_key AS assignment_profession_key,
                profile.profession_key AS profile_profession_key,
                assignment.profile_id,
                profile.title AS profile_title
         FROM staff_payroll_profile_assignments assignment
         JOIN payroll_profiles profile ON profile.id = assignment.profile_id
         JOIN staff ON staff.id = assignment.staff_id
         WHERE assignment.profession_key <> profile.profession_key
         ORDER BY assignment.staff_id, assignment.id`
    );
    for (const row of safeRows(mismatchResult)) {
        issues.push(payrollIssue('profile_profession_mismatch', 'error', 'Призначений профіль не відповідає професії призначення.', {
            assignmentId: Number(row.id),
            staffId: Number(row.staff_id),
            staffName: row.staff_name,
            profileId: Number(row.profile_id),
            profileTitle: row.profile_title,
            assignmentProfessionKey: row.assignment_profession_key,
            profileProfessionKey: row.profile_profession_key
        }));
    }

    const overlapResult = await db.query(
        `SELECT a1.staff_id,
                staff.name AS staff_name,
                a1.profession_key,
                a1.id AS left_assignment_id,
                a2.id AS right_assignment_id,
                a1.effective_from::text AS left_from,
                a1.effective_to::text AS left_to,
                a2.effective_from::text AS right_from,
                a2.effective_to::text AS right_to
         FROM staff_payroll_profile_assignments a1
         JOIN staff_payroll_profile_assignments a2
           ON a1.staff_id = a2.staff_id
          AND a1.profession_key = a2.profession_key
          AND a1.id < a2.id
          AND daterange(a1.effective_from, COALESCE(a1.effective_to, '9999-12-31'::date), '[]')
              && daterange(a2.effective_from, COALESCE(a2.effective_to, '9999-12-31'::date), '[]')
         JOIN staff ON staff.id = a1.staff_id
         ORDER BY a1.staff_id, a1.profession_key, a1.effective_from`
    );
    for (const row of safeRows(overlapResult)) {
        issues.push(payrollIssue('assignment_overlap', 'error', 'У staff є перетин payroll profile assignments по одній професії.', {
            staffId: Number(row.staff_id),
            staffName: row.staff_name,
            professionKey: row.profession_key,
            leftAssignmentId: Number(row.left_assignment_id),
            rightAssignmentId: Number(row.right_assignment_id),
            leftRange: { from: row.left_from, to: row.left_to },
            rightRange: { from: row.right_from, to: row.right_to }
        }));
    }

    const missingRateResult = await db.query(
        `SELECT profile.id,
                profile.title,
                profile.profession_key,
                version.id AS version_id,
                version.default_rate
         FROM payroll_profiles profile
         LEFT JOIN LATERAL (
             SELECT id, default_rate
             FROM payroll_profile_versions version
             WHERE version.profile_id = profile.id
               AND version.effective_from <= $1::date
               AND (version.effective_to IS NULL OR version.effective_to >= $1::date)
             ORDER BY version.effective_from DESC, version.version_number DESC
             LIMIT 1
         ) version ON true
         WHERE profile.status = 'active'
           AND (version.id IS NULL OR COALESCE(version.default_rate, 0) <= 0)
         ORDER BY profile.profession_key, profile.title`,
        [asOfDate]
    );
    for (const row of safeRows(missingRateResult)) {
        issues.push(payrollIssue('profile_without_rate', 'error', 'Активний профіль не має активної версії зі ставкою на дату перевірки.', {
            profileId: Number(row.id),
            profileTitle: row.title,
            professionKey: row.profession_key,
            profileVersionId: row.version_id == null ? null : Number(row.version_id),
            defaultRate: row.default_rate == null ? null : Number(row.default_rate)
        }));
    }

    const expiredTemporaryResult = await db.query(
        `SELECT assignment.id,
                assignment.staff_id,
                staff.name AS staff_name,
                assignment.profession_key,
                assignment.profile_id,
                profile.title AS profile_title,
                assignment.effective_to::text AS effective_to
         FROM staff_payroll_profile_assignments assignment
         JOIN staff ON staff.id = assignment.staff_id
         JOIN payroll_profiles profile ON profile.id = assignment.profile_id
         WHERE assignment.assignment_kind = 'temporary'
           AND assignment.effective_to < $1::date
         ORDER BY assignment.effective_to DESC, assignment.id DESC
         LIMIT 200`,
        [asOfDate]
    );
    for (const row of safeRows(expiredTemporaryResult)) {
        issues.push(payrollIssue('expired_temporary_assignment', 'info', 'Тимчасове призначення вже завершилось і залишилось в історії.', {
            assignmentId: Number(row.id),
            staffId: Number(row.staff_id),
            staffName: row.staff_name,
            professionKey: row.profession_key,
            profileId: Number(row.profile_id),
            profileTitle: row.profile_title,
            effectiveTo: row.effective_to
        }));
    }

    const multipleDefaultResult = await db.query(
        `SELECT profession_key,
                COUNT(*)::int AS count,
                jsonb_agg(jsonb_build_object('id', id, 'title', title) ORDER BY id) AS profiles
         FROM payroll_profiles
         WHERE status = 'active'
           AND profile_kind = 'shared'
           AND is_default_for_profession = true
         GROUP BY profession_key
         HAVING COUNT(*) > 1
         ORDER BY profession_key`
    );
    for (const row of safeRows(multipleDefaultResult)) {
        issues.push(payrollIssue('multiple_default_profiles', 'error', 'Для професії знайдено кілька active default-профілів.', {
            professionKey: row.profession_key,
            count: Number(row.count || 0),
            profiles: Array.isArray(row.profiles) ? row.profiles : []
        }));
    }

    return {
        asOfDate,
        summary: summarizePayrollIssues(issues),
        issues: issues.sort((left, right) => (
            String(left.severity).localeCompare(String(right.severity))
            || String(left.type).localeCompare(String(right.type))
        )),
        profileContextWarnings: profileContext.warnings || []
    };
}

async function loadAffectedStaffForProfile(db, profile, asOfDate) {
    const professionKey = normalizeProfessionKey(profile.professionKey || profile.profession_key);
    const isDefault = Boolean(profile.isDefaultForProfession || profile.is_default_for_profession);
    const result = await db.query(
        `WITH ${activeStaffProfessionCte()},
         active_assignments AS (
             SELECT staff_id, profession_key, profile_id, assignment_kind
             FROM staff_payroll_profile_assignments
             WHERE effective_from <= $2::date
               AND (effective_to IS NULL OR effective_to >= $2::date)
         )
         SELECT ps.staff_id,
                ps.staff_name,
                ps.profession_key,
                CASE
                    WHEN target.profile_id = $1 THEN target.assignment_kind
                    WHEN $3::boolean = true AND any_assignment.staff_id IS NULL THEN 'default'
                    ELSE NULL
                END AS source
         FROM profession_staff ps
         LEFT JOIN active_assignments target
           ON target.staff_id = ps.staff_id
          AND target.profession_key = ps.profession_key
          AND target.profile_id = $1
         LEFT JOIN active_assignments any_assignment
           ON any_assignment.staff_id = ps.staff_id
          AND any_assignment.profession_key = ps.profession_key
         WHERE ps.profession_key = $4
           AND (
                target.profile_id = $1
                OR ($3::boolean = true AND any_assignment.staff_id IS NULL)
           )
         ORDER BY ps.staff_name, ps.staff_id`,
        [Number(profile.id), asOfDate, isDefault, professionKey]
    );
    return safeRows(result).map(row => ({
        staffId: Number(row.staff_id),
        staff_id: Number(row.staff_id),
        staffName: row.staff_name,
        staff_name: row.staff_name,
        professionKey: row.profession_key,
        profession_key: row.profession_key,
        source: row.source || 'assignment'
    }));
}

function buildDraftVersionForImpact(profile, payload = {}, period = normalizeSimulationPeriod(payload)) {
    const current = currentVersionForDate(profile.versions || [], period.from) || latestVersion(profile.versions || []);
    if (!current) throw payrollProfileError('profile has no version to preview', 409, 'PAYROLL_PROFILE_VERSION_MISSING');
    return normalizeVersionPayload({
        ...payload,
        effectiveFrom: payload.effectiveFrom ?? payload.effective_from ?? period.from,
        changeReason: payload.changeReason ?? payload.change_reason ?? payload.reason ?? 'Impact preview'
    }, current, { reasonRequired: false });
}

async function impactPayrollProfilePreview(profileId, payload = {}, options = {}) {
    const db = options.db || pool;
    const period = normalizeSimulationPeriod(payload);
    const profile = await loadProfile(db, profileId, { asOfDate: period.from });
    const draftVersion = buildDraftVersionForImpact(profile, payload, period);
    const affectedStaff = await loadAffectedStaffForProfile(db, profile, period.from);
    const staffIds = affectedStaff.map(row => row.staffId);
    const [current, projected, personalExceptionsResult] = await Promise.all([
        forecastPayrollProfiles({ from: period.from, to: period.to, staffIds }, { db }),
        forecastPayrollProfiles({
            from: period.from,
            to: period.to,
            staffIds,
            profileOverride: { profile, version: draftVersion }
        }, { db }),
        db.query(
            `SELECT id, title, owner_staff_id, status
             FROM payroll_profiles
             WHERE source_profile_id = $1
               AND profile_kind = 'personal'
               AND status <> 'archived'
             ORDER BY title, id`,
            [Number(profile.id)]
        )
    ]);
    const currentFund = Number(current.totals?.total_salary || 0);
    const projectedFund = Number(projected.totals?.total_salary || 0);
    return {
        profile: {
            id: Number(profile.id),
            title: profile.title,
            professionKey: profile.professionKey,
            profileKind: profile.profileKind
        },
        period,
        draftVersion,
        affectedStaff,
        affectedStaffCount: affectedStaff.length,
        currentFund,
        projectedFund,
        delta: Math.round(projectedFund - currentFund),
        current,
        projected,
        personalExceptions: safeRows(personalExceptionsResult).map(row => ({
            id: Number(row.id),
            title: row.title,
            ownerStaffId: row.owner_staff_id == null ? null : Number(row.owner_staff_id),
            status: row.status
        }))
    };
}

async function loadLegacyConversionRows(db, payload = {}) {
    const staffIds = uniquePositiveIds(payload.staffIds || payload.staff_ids || [], 'staffId');
    const professionKey = normalizeProfessionKey(payload.professionKey || payload.profession_key);
    if (!staffIds.length) throw payrollProfileError('staffIds are required for legacy conversion preview', 400, 'PAYROLL_BULK_STAFF_REQUIRED');
    if (!professionKey) throw payrollProfileError('professionKey is required for legacy conversion preview', 400, 'PAYROLL_BULK_PROFESSION_REQUIRED');
    const result = await db.query(
        `SELECT s.id AS staff_id,
                s.name AS staff_name,
                s.role_type,
                COALESCE(s.rate_unit, 'hour') AS staff_rate_unit,
                COALESCE(s.hourly_rate, 0)::numeric AS staff_hourly_rate,
                spr.hourly_rate::numeric AS profession_hourly_rate
         FROM staff s
         LEFT JOIN staff_profession_rates spr
           ON spr.staff_id = s.id
          AND spr.profession_key = $2
         WHERE s.id = ANY($1::int[])
         ORDER BY s.name, s.id`,
        [staffIds, professionKey]
    );
    return safeRows(result).map(row => {
        const professionRate = row.profession_hourly_rate == null ? 0 : Number(row.profession_hourly_rate);
        const staffRate = Number(row.staff_hourly_rate || 0);
        return {
            staffId: Number(row.staff_id),
            staffName: row.staff_name,
            professionKey,
            rateUnit: 'hour',
            defaultRate: professionRate > 0 ? professionRate : staffRate,
            rateSource: professionRate > 0 ? 'staff_profession_rates' : 'staff.hourly_rate',
            legacyRateUnit: row.staff_rate_unit || 'hour'
        };
    }).filter(row => row.defaultRate > 0);
}

async function previewPayrollProfileBulk(payload = {}, options = {}) {
    const db = options.db || pool;
    const operation = cleanText(payload.operation, 40);
    if (!operation) throw payrollProfileError('bulk operation is required', 400, 'PAYROLL_BULK_OPERATION_REQUIRED');
    const effectiveFrom = normalizeDate(payload.effectiveFrom ?? payload.effective_from ?? todayKyivDate(), 'effectiveFrom', { required: true });
    if (operation === 'assign_profile') {
        const profile = await loadProfile(db, payload.profileId ?? payload.profile_id, { asOfDate: effectiveFrom });
        const staffIds = uniquePositiveIds(payload.staffIds || payload.staff_ids || [], 'staffId');
        if (!staffIds.length) throw payrollProfileError('staffIds are required', 400, 'PAYROLL_BULK_STAFF_REQUIRED');
        const professionKey = normalizeProfessionKey(payload.professionKey || payload.profession_key || profile.professionKey);
        const effectiveTo = normalizeDate(payload.effectiveTo ?? payload.effective_to, 'effectiveTo');
        const assignmentKind = normalizeAssignmentKind(payload.assignmentKind ?? payload.assignment_kind, effectiveTo ? 'temporary' : 'explicit');
        const items = [];
        for (const staffId of staffIds) {
            await assertStaffCanUseProfile(db, staffId, professionKey, profile.id);
            const staff = await loadStaffOrThrow(db, staffId);
            items.push({
                staffId,
                staffName: staff.name,
                professionKey,
                profileId: profile.id,
                profileTitle: profile.title,
                assignmentKind,
                effectiveFrom,
                effectiveTo
            });
        }
        return {
            operation,
            requiresConfirmation: true,
            confirmationText: 'ЗАСТОСУВАТИ',
            preview: { profile, affectedStaffCount: items.length, items }
        };
    }
    if (operation === 'percent_version') {
        const profile = await loadProfile(db, payload.profileId ?? payload.profile_id, { asOfDate: effectiveFrom });
        const current = currentVersionForDate(profile.versions || [], effectiveFrom) || latestVersion(profile.versions || []);
        if (!current) throw payrollProfileError('profile has no version to update', 409, 'PAYROLL_PROFILE_VERSION_MISSING');
        const percent = Number(payload.percentChange ?? payload.percent_change);
        if (!Number.isFinite(percent) || percent === 0) throw payrollProfileError('percentChange is required', 400, 'PAYROLL_BULK_PERCENT_REQUIRED');
        const multiplier = 1 + (percent / 100);
        const draftVersion = {
            rateUnit: current.rateUnit,
            defaultRate: Math.round(Number(current.defaultRate || 0) * multiplier * 100) / 100,
            effectiveFrom,
            changeReason: mutationReason(payload) || `Bulk ${percent}% payroll profile change`,
            dayRates: (current.dayRates || []).map(rate => ({
                isoWeekday: Number(rate.isoWeekday),
                rate: Math.round(Number(rate.rate || 0) * multiplier * 100) / 100
            }))
        };
        const impact = await impactPayrollProfilePreview(profile.id, {
            ...draftVersion,
            from: payload.from || effectiveFrom,
            to: payload.to || addDays(effectiveFrom, 30)
        }, { db });
        return {
            operation,
            requiresConfirmation: true,
            confirmationText: 'ЗАСТОСУВАТИ',
            preview: { profile, currentVersion: current, draftVersion, percentChange: percent, impact }
        };
    }
    if (operation === 'convert_legacy') {
        const rows = await loadLegacyConversionRows(db, payload);
        return {
            operation,
            requiresConfirmation: true,
            confirmationText: 'ЗАСТОСУВАТИ',
            preview: {
                professionKey: normalizeProfessionKey(payload.professionKey || payload.profession_key),
                effectiveFrom,
                affectedStaffCount: rows.length,
                items: rows
            }
        };
    }
    throw payrollProfileError('unsupported bulk operation', 400, 'PAYROLL_BULK_OPERATION_UNSUPPORTED', { operation });
}

function requireBulkConfirmation(payload = {}) {
    const confirmed = payload.confirm === true
        || payload.confirmed === true
        || cleanText(payload.confirmText ?? payload.confirm_text, 40) === 'ЗАСТОСУВАТИ'
        || cleanText(payload.confirmText ?? payload.confirm_text, 40) === 'APPLY';
    if (!confirmed) {
        throw payrollProfileError('bulk operation requires explicit confirmation', 400, 'PAYROLL_BULK_CONFIRMATION_REQUIRED');
    }
}

async function buildAssignmentPatchForEffectiveFrom(db, staffId, professionKey, newAssignment) {
    const existing = await queryStaffAssignments(db, staffId, { includePast: true });
    const newStart = newAssignment.effectiveFrom;
    const newEnd = newAssignment.effectiveTo || '9999-12-31';
    const hasFiniteNewEnd = Boolean(newAssignment.effectiveTo);
    const removeAssignmentIds = [];
    const assignments = [];
    for (const assignment of existing.filter(row => normalizeProfessionKey(row.professionKey) === professionKey)) {
        const assignmentStart = assignment.effectiveFrom;
        const assignmentEnd = assignment.effectiveTo || '9999-12-31';
        if (assignmentEnd < newStart || assignmentStart > newEnd) continue;
        if (assignmentStart < newStart) {
            const beforeEnd = addDays(newStart, -1);
            if (beforeEnd >= assignmentStart) {
                assignments.push({
                    id: assignment.id,
                    professionKey,
                    profileId: assignment.profileId,
                    assignmentKind: assignment.assignmentKind,
                    effectiveFrom: assignment.effectiveFrom,
                    effectiveTo: beforeEnd
                });
            } else if (assignment.id) {
                removeAssignmentIds.push(assignment.id);
            }
        } else if (assignment.id) {
            removeAssignmentIds.push(assignment.id);
        }
        if (hasFiniteNewEnd && assignmentEnd > newEnd) {
            const afterStart = addDays(newEnd, 1);
            if (afterStart <= assignmentEnd) {
                assignments.push({
                    professionKey,
                    profileId: assignment.profileId,
                    assignmentKind: assignment.assignmentKind,
                    effectiveFrom: afterStart,
                    effectiveTo: assignment.effectiveTo || null
                });
            }
        }
    }
    assignments.push(newAssignment);
    return { removeAssignmentIds, assignments };
}

async function applyPayrollProfileBulk(payload = {}, actor = null, options = {}) {
    requireBulkConfirmation(payload);
    const operation = cleanText(payload.operation, 40);
    const reason = mutationReason(payload, { required: true });
    const effectiveFrom = normalizeDate(payload.effectiveFrom ?? payload.effective_from ?? todayKyivDate(), 'effectiveFrom', { required: true });
    return withTransaction(options, async db => {
        await assertPayrollPeriodOpen(monthFromDate(effectiveFrom), db);
        const beforePreview = await previewPayrollProfileBulk({ ...payload, effectiveFrom }, { db });
        const applied = [];
        if (operation === 'assign_profile') {
            const profile = await loadProfile(db, payload.profileId ?? payload.profile_id, { asOfDate: effectiveFrom });
            const professionKey = normalizeProfessionKey(payload.professionKey || payload.profession_key || profile.professionKey);
            const effectiveTo = normalizeDate(payload.effectiveTo ?? payload.effective_to, 'effectiveTo');
            const assignmentKind = normalizeAssignmentKind(payload.assignmentKind ?? payload.assignment_kind, effectiveTo ? 'temporary' : 'explicit');
            const staffIds = uniquePositiveIds(payload.staffIds || payload.staff_ids || [], 'staffId');
            for (const staffId of staffIds) {
                const patch = await buildAssignmentPatchForEffectiveFrom(db, staffId, professionKey, {
                    professionKey,
                    profileId: profile.id,
                    assignmentKind,
                    effectiveFrom,
                    effectiveTo
                });
                const result = await saveStaffPayrollProfileAssignments(staffId, {
                    mode: 'patch',
                    removeAssignmentIds: patch.removeAssignmentIds,
                    assignments: patch.assignments,
                    reason
                }, actor, { db, manageTransaction: false });
                applied.push({ staffId, assignments: result.assignments });
            }
        } else if (operation === 'percent_version') {
            const draft = beforePreview.preview?.draftVersion;
            const result = await createPayrollProfileVersion(payload.profileId ?? payload.profile_id, {
                ...draft,
                changeReason: reason
            }, actor, { db, manageTransaction: false });
            applied.push(result);
        } else if (operation === 'convert_legacy') {
            const rows = await loadLegacyConversionRows(db, payload);
            for (const row of rows) {
                const created = await createPayrollProfile({
                    title: cleanText(payload.titlePrefix || payload.title_prefix, 80)
                        ? `${cleanText(payload.titlePrefix || payload.title_prefix, 80)} · ${row.staffName}`
                        : `${row.professionKey} · ${row.staffName}`,
                    professionKey: row.professionKey,
                    profileKind: 'personal',
                    ownerStaffId: row.staffId,
                    status: 'active',
                    rateUnit: row.rateUnit,
                    defaultRate: row.defaultRate,
                    effectiveFrom,
                    changeReason: reason
                }, actor, { db, manageTransaction: false });
                const patch = await buildAssignmentPatchForEffectiveFrom(db, row.staffId, row.professionKey, {
                    professionKey: row.professionKey,
                    profileId: created.id,
                    assignmentKind: 'explicit',
                    effectiveFrom,
                    effectiveTo: null
                });
                await saveStaffPayrollProfileAssignments(row.staffId, {
                    mode: 'patch',
                    removeAssignmentIds: patch.removeAssignmentIds,
                    assignments: patch.assignments,
                    reason
                }, actor, { db, manageTransaction: false });
                applied.push({ staffId: row.staffId, profile: created });
            }
        } else {
            throw payrollProfileError('unsupported bulk operation', 400, 'PAYROLL_BULK_OPERATION_UNSUPPORTED', { operation });
        }
        await insertHrAudit(db, 'payroll_profile_bulk_apply', null, actor, {
            operation,
            reason,
            effectiveFrom,
            beforePreview,
            appliedCount: applied.length
        });
        return {
            operation,
            effectiveFrom,
            appliedCount: applied.length,
            applied,
            preview: beforePreview.preview
        };
    });
}

module.exports = {
    PAYROLL_PROFILE_AUDIT_ACTIONS,
    applyPayrollProfileBulk,
    archivePayrollProfile,
    buildPayrollProfileVersionDiff,
    createPayrollProfile,
    createPayrollProfileClone,
    createPayrollProfileVersion,
    diagnosePayrollProfiles,
    forecastPayrollProfiles,
    getPayrollProfile,
    impactPayrollProfilePreview,
    listPayrollProfiles,
    listStaffPayrollProfileAssignments,
    listStaffPayrollProfileHistory,
    mergePayrollProfileSyncVersion,
    previewPayrollProfileBulk,
    saveStaffPayrollProfileAssignments,
    simulatePayrollProfiles,
    syncPayrollProfileFromBase
};
