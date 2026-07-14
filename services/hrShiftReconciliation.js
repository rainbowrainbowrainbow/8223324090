'use strict';

const { normalizeProfessionKey, staffProfessionKeys } = require('./professions');
const { normalizeShiftTime, saveHrShiftDayPlan } = require('./hrShiftSegments');

const HR_SHIFT_RECONCILIATION_ACTION = 'hr_shift_reconciliation';
const PREVIEW_LIMIT = 50;

function normalizeDateOnly(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        return null;
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
}

function validateReconciliationRange(from, to) {
    const dateFrom = normalizeDateOnly(from);
    const dateTo = normalizeDateOnly(to);
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
        const error = new Error('Reconciliation requires a valid YYYY-MM-DD range');
        error.code = 'HR_SHIFT_RECONCILIATION_RANGE_INVALID';
        error.statusCode = 400;
        throw error;
    }
    return { dateFrom, dateTo };
}

function reconciliationRowError(row, code, error) {
    return {
        scheduleId: Number(row.schedule_id) || null,
        staffId: Number(row.staff_id) || null,
        shiftDate: normalizeDateOnly(row.shift_date),
        code,
        error
    };
}

function classifyHrShiftReconciliationRows(rows = []) {
    const candidates = [];
    const errors = [];
    for (const row of rows) {
        const shiftDate = normalizeDateOnly(row.shift_date);
        const shiftStart = normalizeShiftTime(row.shift_start);
        const shiftEnd = normalizeShiftTime(row.shift_end);
        const professionKey = normalizeProfessionKey(row.profession_key);
        if (!shiftDate) {
            errors.push(reconciliationRowError(row, 'SCHEDULE_DATE_INVALID', 'Некоректна календарна дата'));
            continue;
        }
        if (!shiftStart || !shiftEnd || shiftStart === shiftEnd) {
            errors.push(reconciliationRowError(row, 'SCHEDULE_TIME_INVALID', 'Некоректний або нульовий часовий інтервал'));
            continue;
        }
        if (!professionKey) {
            errors.push(reconciliationRowError(row, 'SCHEDULE_PROFESSION_MISSING', 'Не задано profession_key'));
            continue;
        }
        if (row.is_active === false) {
            errors.push(reconciliationRowError(row, 'STAFF_INACTIVE', 'Працівник неактивний'));
            continue;
        }
        if (String(row.hr_pool_status || 'core') !== 'core') {
            errors.push(reconciliationRowError(row, 'STAFF_NOT_CORE_POOL', 'Працівник не входить до core HR pool'));
            continue;
        }
        if (row.is_freelance === true) {
            errors.push(reconciliationRowError(row, 'STAFF_FREELANCE_NOT_ALLOWED', 'Freelance-працівник не належить active schedule'));
            continue;
        }
        const terminationDate = normalizeDateOnly(row.termination_date);
        if (terminationDate && terminationDate <= shiftDate) {
            errors.push(reconciliationRowError(row, 'STAFF_TERMINATED', 'Працівника звільнено на цю дату'));
            continue;
        }
        const allowedProfessionKeys = new Set(staffProfessionKeys({
            role_type: row.role_type,
            secondary_professions: row.secondary_professions
        }));
        if (!allowedProfessionKeys.has(professionKey)) {
            errors.push(reconciliationRowError(
                row,
                'SCHEDULE_PROFESSION_NOT_ON_STAFF_CARD',
                `Професії ${professionKey} немає в HR-картці`
            ));
            continue;
        }
        candidates.push({
            scheduleId: Number(row.schedule_id),
            staffId: Number(row.staff_id),
            shiftDate,
            shiftStart,
            shiftEnd,
            shiftType: String(row.status || '').toLowerCase() === 'remote' ? 'remote' : 'regular',
            professionKey,
            notes: row.notes || null
        });
    }
    return { candidates, errors };
}

async function loadHrShiftReconciliationRows(db, dateFrom, dateTo) {
    const result = await db.query(
        `SELECT ss.id AS schedule_id,
                ss.staff_id,
                ss.date::text AS shift_date,
                ss.shift_start::text AS shift_start,
                ss.shift_end::text AS shift_end,
                ss.status,
                ss.note AS notes,
                COALESCE(NULLIF(BTRIM(ss.profession_key), ''), NULLIF(BTRIM(s.role_type), '')) AS profession_key,
                s.role_type,
                COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                s.is_active,
                COALESCE(s.hr_pool_status, 'core') AS hr_pool_status,
                COALESCE(s.is_freelance, false) AS is_freelance,
                s.termination_date::text AS termination_date
         FROM staff_schedule ss
         JOIN staff s ON s.id = ss.staff_id
         LEFT JOIN hr_shifts hs
           ON hs.staff_id = ss.staff_id
          AND hs.shift_date = ss.date
         WHERE ss.date >= $1
           AND ss.date <= $2
           AND ss.status IN ('working', 'remote')
           AND hs.id IS NULL
         ORDER BY ss.staff_id, ss.date, ss.id`,
        [dateFrom, dateTo]
    );
    return result.rows;
}

function reconciliationSummary(scan, extra = {}) {
    return {
        dryRun: extra.dryRun !== false,
        dateFrom: extra.dateFrom,
        dateTo: extra.dateTo,
        candidateCount: scan.candidates.length,
        errorCount: scan.errors.length,
        createdCount: Number(extra.createdCount || 0),
        skippedCount: Number(extra.skippedCount || 0),
        candidates: scan.candidates.slice(0, PREVIEW_LIMIT),
        errors: scan.errors.slice(0, PREVIEW_LIMIT),
        previewTruncated: scan.candidates.length > PREVIEW_LIMIT || scan.errors.length > PREVIEW_LIMIT
    };
}

async function scanHrShiftReconciliation(db, from, to) {
    const { dateFrom, dateTo } = validateReconciliationRange(from, to);
    const rows = await loadHrShiftReconciliationRows(db, dateFrom, dateTo);
    return {
        dateFrom,
        dateTo,
        ...classifyHrShiftReconciliationRows(rows)
    };
}

async function reconcileHrShiftsFromStaffSchedule(db, options = {}) {
    if (!db || typeof db.query !== 'function') throw new TypeError('A PostgreSQL pool/client is required');
    const initial = await scanHrShiftReconciliation(db, options.from, options.to);
    if (options.dryRun !== false) {
        return reconciliationSummary(initial, {
            dryRun: true,
            dateFrom: initial.dateFrom,
            dateTo: initial.dateTo
        });
    }
    if (typeof db.connect !== 'function') throw new TypeError('Apply mode requires a PostgreSQL pool');
    if (initial.errors.length) {
        const error = new Error('Reconciliation apply is blocked until candidate errors are fixed');
        error.code = 'HR_SHIFT_RECONCILIATION_HAS_ERRORS';
        error.statusCode = 409;
        error.summary = reconciliationSummary(initial, {
            dryRun: false,
            dateFrom: initial.dateFrom,
            dateTo: initial.dateTo
        });
        throw error;
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const initialStaffIds = [...new Set(initial.candidates.map(candidate => candidate.staffId))].sort((a, b) => a - b);
        if (initialStaffIds.length) {
            await client.query(
                'SELECT id FROM staff WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
                [initialStaffIds]
            );
        }
        const initialScheduleIds = initial.candidates.map(candidate => candidate.scheduleId).sort((a, b) => a - b);
        if (initialScheduleIds.length) {
            await client.query(
                'SELECT id FROM staff_schedule WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
                [initialScheduleIds]
            );
        }

        const fresh = await scanHrShiftReconciliation(client, initial.dateFrom, initial.dateTo);
        const lockedStaffIds = new Set(initialStaffIds);
        if (fresh.candidates.some(candidate => !lockedStaffIds.has(candidate.staffId))) {
            const error = new Error('Reconciliation source changed while locks were acquired');
            error.code = 'HR_SHIFT_RECONCILIATION_SOURCE_CHANGED';
            error.statusCode = 409;
            throw error;
        }
        if (fresh.errors.length) {
            const error = new Error('Reconciliation source contains invalid rows');
            error.code = 'HR_SHIFT_RECONCILIATION_HAS_ERRORS';
            error.statusCode = 409;
            error.summary = reconciliationSummary(fresh, {
                dryRun: false,
                dateFrom: fresh.dateFrom,
                dateTo: fresh.dateTo
            });
            throw error;
        }

        let createdCount = 0;
        for (const candidate of fresh.candidates) {
            await saveHrShiftDayPlan(client, {
                staffId: candidate.staffId,
                shiftDate: candidate.shiftDate,
                shiftType: candidate.shiftType,
                payload: {
                    professionKey: candidate.professionKey,
                    shiftStart: candidate.shiftStart,
                    shiftEnd: candidate.shiftEnd,
                    breakMinutes: 0,
                    shiftType: candidate.shiftType,
                    notes: candidate.notes
                }
            }, { actor: options.actor || 'hr_shift_reconciliation' });
            createdCount += 1;
        }

        const summary = reconciliationSummary(fresh, {
            dryRun: false,
            dateFrom: fresh.dateFrom,
            dateTo: fresh.dateTo,
            createdCount,
            skippedCount: Math.max(0, initial.candidates.length - fresh.candidates.length)
        });
        if (createdCount > 0) {
            await client.query(
                `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
                 VALUES ($1, NULL, $2, $3, NULL)`,
                [HR_SHIFT_RECONCILIATION_ACTION, options.actor || 'hr_shift_reconciliation', JSON.stringify(summary)]
            );
        }
        await client.query('COMMIT');
        return summary;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    HR_SHIFT_RECONCILIATION_ACTION,
    classifyHrShiftReconciliationRows,
    reconcileHrShiftsFromStaffSchedule,
    scanHrShiftReconciliation,
    validateReconciliationRange
};
