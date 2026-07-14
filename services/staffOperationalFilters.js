function normalizeAlias(alias) {
    const value = String(alias || '').trim();
    return value || 's';
}

function terminationDateWhere(alias, dateExpression) {
    const safeAlias = normalizeAlias(alias);
    const dateSql = String(dateExpression || 'CURRENT_DATE').trim() || 'CURRENT_DATE';
    return `(${safeAlias}.termination_date IS NULL OR ${safeAlias}.termination_date::date > ${dateSql}::date)`;
}

function activeStaffWhere(alias = 's', options = {}) {
    const safeAlias = normalizeAlias(alias);
    const poolMode = options.poolMode || options.pool || 'not_blacklisted';
    const includeFreelance = options.includeFreelance === true;
    const clauses = [
        `${safeAlias}.is_active = true`,
        poolMode === 'core'
            ? `COALESCE(${safeAlias}.hr_pool_status, 'core') = 'core'`
            : `COALESCE(${safeAlias}.hr_pool_status, 'core') <> 'blacklisted'`,
        terminationDateWhere(safeAlias, options.dateExpression)
    ];
    if (!includeFreelance) {
        clauses.push(`COALESCE(${safeAlias}.is_freelance, false) = false`);
    }
    return clauses.join('\n        AND ');
}

function scheduleableStaffWhere(alias = 's', options = {}) {
    return activeStaffWhere(alias, {
        ...options,
        poolMode: 'core',
        includeFreelance: options.includeFreelance === true
    });
}

function normalizeScheduleDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const raw = String(value).trim();
    if (!raw) return null;
    const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
}

function scheduleabilityFailure(code, error, status = 400, details = {}) {
    return {
        ok: false,
        code,
        error,
        status,
        ...details
    };
}

function staffScheduleabilityFailure(row, date, options = {}) {
    const includeFreelance = options.includeFreelance === true;
    if (!row) {
        return scheduleabilityFailure('STAFF_NOT_FOUND', 'Staff not found', 404, { date });
    }
    const staff = {
        id: Number(row.id),
        name: row.name || null,
        is_active: row.is_active === true,
        hr_pool_status: row.hr_pool_status || 'core',
        is_freelance: row.is_freelance === true,
        termination_date: normalizeScheduleDateValue(row.termination_date)
    };
    const details = { staff, staff_id: staff.id, date };
    if (!staff.is_active) {
        return scheduleabilityFailure('STAFF_INACTIVE', 'Staff is inactive', 400, details);
    }
    if (staff.hr_pool_status === 'blacklisted') {
        return scheduleabilityFailure('STAFF_BLACKLISTED', 'Staff is blacklisted', 400, details);
    }
    if (staff.hr_pool_status !== 'core') {
        return scheduleabilityFailure('STAFF_NOT_CORE_POOL', 'Staff is not in the core pool', 400, details);
    }
    if (!includeFreelance && staff.is_freelance) {
        return scheduleabilityFailure('STAFF_FREELANCE_NOT_ALLOWED', 'Freelance staff is not allowed in active schedule mode', 400, details);
    }
    if (staff.termination_date && date && staff.termination_date <= date) {
        return scheduleabilityFailure('STAFF_TERMINATED', 'Staff is terminated for this date', 400, details);
    }
    return scheduleabilityFailure('STAFF_NOT_SCHEDULEABLE', 'Staff is not scheduleable for this date', 400, details);
}

function validateStaffScheduleabilityCardForDate(row, date, options = {}) {
    const safeDate = normalizeScheduleDateValue(date);
    if (!safeDate) {
        return scheduleabilityFailure('INVALID_SCHEDULE_DATE', 'Invalid schedule date', 400, {
            staff_id: Number(row?.id) || null,
            date: null
        });
    }
    if (!row) return staffScheduleabilityFailure(null, safeDate, options);
    const isScheduleable = row.is_active === true
        && String(row.hr_pool_status || 'core') === 'core'
        && (options.includeFreelance === true || row.is_freelance !== true)
        && (!normalizeScheduleDateValue(row.termination_date)
            || normalizeScheduleDateValue(row.termination_date) > safeDate);
    if (isScheduleable) {
        return {
            ok: true,
            code: 'STAFF_SCHEDULEABLE',
            status: 200,
            staff: row,
            staff_id: Number(row.id),
            date: safeDate
        };
    }
    return staffScheduleabilityFailure(row, safeDate, options);
}

async function loadStaffScheduleabilityCards(db, staffIds = [], options = {}) {
    const ids = [...new Set(staffIds
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0))]
        .sort((left, right) => left - right);
    if (!ids.length) return new Map();
    const result = await db.query(
        `SELECT s.id, s.name, s.role_type,
                COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                s.is_active,
                COALESCE(s.hr_pool_status, 'core') AS hr_pool_status,
                COALESCE(s.is_freelance, false) AS is_freelance,
                s.termination_date,
                s.hourly_rate,
                s.rate_unit
         FROM staff s
         WHERE s.id = ANY($1::int[])
         ORDER BY s.id
         ${options.forUpdate === true ? 'FOR UPDATE OF s' : ''}`,
        [ids]
    );
    return new Map(result.rows.map(row => [Number(row.id), row]));
}

async function validateStaffScheduleableForDate(db, staffId, date, options = {}) {
    const id = Number(staffId);
    const safeDate = normalizeScheduleDateValue(date);
    if (!Number.isInteger(id) || id <= 0) {
        return scheduleabilityFailure('STAFF_NOT_FOUND', 'Staff not found', 404, { staff_id: staffId || null, date: safeDate });
    }
    if (!safeDate) {
        return scheduleabilityFailure('INVALID_SCHEDULE_DATE', 'Invalid schedule date', 400, { staff_id: id, date: null });
    }
    const result = await db.query(
        `SELECT s.id, s.name, s.role_type, s.is_active,
                COALESCE(s.hr_pool_status, 'core') AS hr_pool_status,
                COALESCE(s.is_freelance, false) AS is_freelance,
                s.termination_date,
                (${scheduleableStaffWhere('s', { dateExpression: '$2', includeFreelance: options.includeFreelance === true })}) AS is_scheduleable
         FROM staff s
         WHERE s.id = $1
         ${options.forUpdate === false ? '' : 'FOR UPDATE OF s'}`,
        [id, safeDate]
    );
    const row = result.rows[0] || null;
    if (row?.is_scheduleable === true) {
        return {
            ok: true,
            code: 'STAFF_SCHEDULEABLE',
            status: 200,
            staff: row,
            staff_id: id,
            date: safeDate
        };
    }
    return staffScheduleabilityFailure(row, safeDate, options);
}

async function assertStaffScheduleableForDate(db, staffId, date, options = {}) {
    const validation = await validateStaffScheduleableForDate(db, staffId, date, options);
    if (validation.ok) return validation.staff;
    const err = new Error(validation.error);
    err.code = validation.code || 'STAFF_NOT_SCHEDULEABLE';
    err.status = validation.status || 400;
    err.validation = validation;
    throw err;
}

function scheduleableStaffErrorPayload(validation = {}, extra = {}) {
    return {
        success: false,
        code: validation.code || 'STAFF_NOT_SCHEDULEABLE',
        error: validation.error || 'Staff is not scheduleable for this date',
        staff_id: validation.staff_id ?? validation.staff?.id ?? null,
        date: validation.date || null,
        ...extra
    };
}

module.exports = {
    activeStaffWhere,
    assertStaffScheduleableForDate,
    loadStaffScheduleabilityCards,
    scheduleableStaffErrorPayload,
    scheduleableStaffWhere,
    terminationDateWhere,
    validateStaffScheduleabilityCardForDate,
    validateStaffScheduleableForDate
};
