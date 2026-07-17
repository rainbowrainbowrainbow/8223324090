const { pool } = require('../db');

const PAYROLL_EVENT_TYPES = new Set(['lock', 'unlock', 'commit', 'reverse']);
const PAYROLL_EVENT_LABELS = {
    lock: 'Період закрито',
    unlock: 'Період відкрито',
    commit: 'Зарплату нараховано',
    reverse: 'Сторно зарплати'
};

function requirePayrollMonth(value) {
    const month = String(value || '').trim();
    return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

function normalizePayrollDate(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
    return text;
}

function payrollMonthRange(month) {
    const year = Number(String(month).slice(0, 4));
    const monthNumber = Number(String(month).slice(5, 7));
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
        from: `${month}-01`,
        to: `${month}-${String(lastDay).padStart(2, '0')}`
    };
}

function payrollPeriodRange(month, fromValue, toValue) {
    const defaultRange = payrollMonthRange(month);
    const from = normalizePayrollDate(fromValue) || defaultRange.from;
    const to = normalizePayrollDate(toValue) || defaultRange.to;
    if (from > to) {
        const err = new Error('Некоректний період: дата початку пізніше дати завершення');
        err.statusCode = 400;
        throw err;
    }
    return {
        from,
        to,
        month_from: from.slice(0, 7),
        month_to: to.slice(0, 7),
        mode: from === defaultRange.from && to === defaultRange.to ? 'month' : 'range'
    };
}

function buildPayrollSourceReconciliation(sourceDays = []) {
    const byDate = new Map();
    const warnings = [];
    for (const source of Array.isArray(sourceDays) ? sourceDays : []) {
        const date = normalizePayrollDate(source?.date || source?.record_date);
        if (!date) continue;
        if (!byDate.has(date)) {
            byDate.set(date, {
                date,
                planned_shift_ref: source.plannedShiftRef ?? source.planned_shift_ref ?? null,
                segment_refs: [],
                planned_minutes: Math.max(0, Number(source.plannedMinutes ?? source.planned_minutes ?? 0) || 0),
                planned_hours: 0,
                attendance_ref: source.attendanceRef ?? source.attendance_ref ?? null,
                allocation_source: source.allocationSource || source.allocation_source || 'none',
                physical_minutes: 0,
                base_profession_minutes: 0,
                additional_profession_minutes: 0,
                role_minutes: 0,
                role_minutes_exceed_physical: false
            });
        }
        const target = byDate.get(date);
        const plannedShiftRef = source.plannedShiftRef ?? source.planned_shift_ref ?? null;
        const attendanceRef = source.attendanceRef ?? source.attendance_ref ?? null;
        if (target.planned_shift_ref !== null && plannedShiftRef !== null && String(target.planned_shift_ref) !== String(plannedShiftRef)) {
            warnings.push({
                code: 'MULTIPLE_PLANNED_SHIFT_REFS',
                date,
                message: 'Для одного payroll-дня знайдено більше одного planned shift reference'
            });
        } else if (target.planned_shift_ref === null && plannedShiftRef !== null) {
            target.planned_shift_ref = plannedShiftRef;
        }
        if (target.attendance_ref !== null && attendanceRef !== null && String(target.attendance_ref) !== String(attendanceRef)) {
            warnings.push({
                code: 'MULTIPLE_ATTENDANCE_REFS',
                date,
                message: 'Для одного payroll-дня знайдено більше одного attendance reference'
            });
        } else if (target.attendance_ref === null && attendanceRef !== null) {
            target.attendance_ref = attendanceRef;
        }
        const refs = source.segmentRefs || source.segment_refs || [];
        target.segment_refs = [...new Set([...target.segment_refs, ...refs]
            .filter(ref => ref !== null && ref !== undefined)
            .map(ref => Number(ref))
            .filter(Number.isFinite))];
        target.planned_minutes = Math.max(
            target.planned_minutes,
            Math.max(0, Number(source.plannedMinutes ?? source.planned_minutes ?? 0) || 0)
        );
        target.physical_minutes = Math.max(
            target.physical_minutes,
            Math.max(0, Number(source.physicalMinutes ?? source.physical_minutes
                ?? source.actualMinutes ?? source.actual_minutes ?? 0) || 0)
        );
        target.base_profession_minutes = Math.max(
            target.base_profession_minutes,
            Math.max(0, Number(source.baseProfessionMinutes ?? source.base_profession_minutes
                ?? source.actualMinutes ?? source.actual_minutes ?? 0) || 0)
        );
        target.additional_profession_minutes += Math.max(
            0,
            Number(source.additionalProfessionMinutes ?? source.additional_profession_minutes ?? 0) || 0
        );
    }
    const days = [...byDate.values()]
        .sort((left, right) => left.date.localeCompare(right.date))
        .map(day => {
            const roleMinutes = day.base_profession_minutes + day.additional_profession_minutes;
            return {
                ...day,
                planned_hours: Math.round((day.planned_minutes / 60) * 100) / 100,
                role_minutes: roleMinutes,
                role_minutes_exceed_physical: roleMinutes > day.physical_minutes
            };
        });
    return { days, warnings };
}

function buildPayrollRateUnitWarnings(rateSummary = []) {
    const seen = new Set();
    const warnings = [];
    for (const item of Array.isArray(rateSummary) ? rateSummary : []) {
        const rateSource = String(item?.rate_source || item?.rateSource || '').trim();
        const rateUnit = String(item?.rate_unit || item?.rateUnit || '').trim().toLowerCase();
        if (!rateSource.startsWith('staff_profession_rates') || rateUnit === 'hour') continue;
        const professionKey = item?.profession_key || item?.professionKey || item?.profession || null;
        const key = `${professionKey || ''}:${rateUnit}:${rateSource}`;
        if (seen.has(key)) continue;
        seen.add(key);
        warnings.push({
            code: 'PAYROLL_RATE_UNIT_MISMATCH',
            professionKey,
            rateUnit: rateUnit || null,
            rateSource,
            message: 'Погодинну ставку професії заборонено використовувати як денну або місячну'
        });
    }
    return warnings;
}

function payrollDefaultLock(month) {
    return {
        period_month: month,
        is_locked: false,
        locked_at: null,
        locked_by: null,
        unlocked_at: null,
        unlocked_by: null,
        note: null,
        meta_json: {}
    };
}

async function loadPayrollPeriodLock(month, db = pool) {
    const result = await db.query(
        `SELECT period_month, is_locked, locked_at, locked_by, unlocked_at, unlocked_by, note, meta_json
         FROM payroll_period_locks
         WHERE period_month = $1`,
        [month]
    );
    const row = result.rows[0];
    if (!row) return payrollDefaultLock(month);
    return {
        period_month: row.period_month,
        is_locked: row.is_locked === true,
        locked_at: row.locked_at || null,
        locked_by: row.locked_by || null,
        unlocked_at: row.unlocked_at || null,
        unlocked_by: row.unlocked_by || null,
        note: row.note || null,
        meta_json: row.meta_json && typeof row.meta_json === 'object' ? row.meta_json : {}
    };
}

async function assertPayrollPeriodOpen(month, db = pool) {
    const lock = await loadPayrollPeriodLock(month, db);
    if (lock.is_locked) {
        const err = new Error(`Зарплатний період ${month} закрито. Відкрийте період або зробіть сторно перед змінами.`);
        err.statusCode = 423;
        err.payrollLock = lock;
        throw err;
    }
    return lock;
}

function normalizePayrollPeriodEvent(row = {}) {
    const type = row.event_type || '';
    return {
        id: Number(row.id || 0),
        period_month: row.period_month || null,
        event_type: type,
        event_label: PAYROLL_EVENT_LABELS[type] || type,
        actor: row.actor || null,
        note: row.note || null,
        amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
        items_count: row.items_count === null || row.items_count === undefined ? null : Number(row.items_count),
        meta_json: row.meta_json && typeof row.meta_json === 'object' ? row.meta_json : {},
        created_at: row.created_at || null
    };
}

async function recordPayrollPeriodEvent(month, eventType, actor, note = '', meta = {}, db = pool) {
    if (!PAYROLL_EVENT_TYPES.has(eventType)) return null;
    const payload = meta && typeof meta === 'object' ? meta : {};
    const amount = Number.isFinite(Number(payload.amount)) ? Number(payload.amount) : null;
    const count = Number.isFinite(Number(payload.count)) ? Math.trunc(Number(payload.count)) : null;
    const result = await db.query(
        `INSERT INTO payroll_period_events
            (period_month, event_type, actor, note, amount, items_count, meta_json)
         VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7::jsonb)
         RETURNING id, period_month, event_type, actor, note, amount, items_count, meta_json, created_at`,
        [month, eventType, actor || null, String(note || '').trim(), amount, count, JSON.stringify(payload)]
    );
    return normalizePayrollPeriodEvent(result.rows[0]);
}

async function loadPayrollPeriodEvents(month, db = pool, limit = 12) {
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 12, 50));
    const result = await db.query(
        `SELECT id, period_month, event_type, actor, note, amount, items_count, meta_json, created_at
         FROM payroll_period_events
         WHERE period_month = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [month, safeLimit]
    );
    return result.rows.map(normalizePayrollPeriodEvent);
}

async function setPayrollPeriodLock(month, locked, actor, note = '', db = pool) {
    const result = await db.query(
        `INSERT INTO payroll_period_locks
            (period_month, is_locked, locked_at, locked_by, unlocked_at, unlocked_by, note, updated_at)
         VALUES (
            $1, $2,
            CASE WHEN $2 THEN NOW() ELSE NULL END,
            CASE WHEN $2 THEN $3 ELSE NULL END,
            CASE WHEN $2 THEN NULL ELSE NOW() END,
            CASE WHEN $2 THEN NULL ELSE $3 END,
            NULLIF($4, ''), NOW()
         )
         ON CONFLICT (period_month) DO UPDATE SET
            is_locked = EXCLUDED.is_locked,
            locked_at = CASE WHEN EXCLUDED.is_locked THEN NOW() ELSE payroll_period_locks.locked_at END,
            locked_by = CASE WHEN EXCLUDED.is_locked THEN EXCLUDED.locked_by ELSE payroll_period_locks.locked_by END,
            unlocked_at = CASE WHEN EXCLUDED.is_locked THEN payroll_period_locks.unlocked_at ELSE NOW() END,
            unlocked_by = CASE WHEN EXCLUDED.is_locked THEN payroll_period_locks.unlocked_by ELSE EXCLUDED.unlocked_by END,
            note = EXCLUDED.note,
            updated_at = NOW()
         RETURNING period_month, is_locked, locked_at, locked_by, unlocked_at, unlocked_by, note, meta_json`,
        [month, locked === true, actor, String(note || '').trim()]
    );
    await recordPayrollPeriodEvent(
        result.rows[0].period_month,
        locked === true ? 'lock' : 'unlock',
        actor,
        note,
        { locked: locked === true },
        db
    );
    return loadPayrollPeriodLock(result.rows[0].period_month, db);
}

async function loadPayrollReconciliation(month, db = pool) {
    const range = payrollMonthRange(month);
    const result = await db.query(
        `WITH active_reports AS (
            SELECT id, staff_id, net_amount, finance_transaction_id, breakdown_json
            FROM payroll_reports
            WHERE period_month = $1
              AND status = 'paid'
              AND voided_at IS NULL
        ),
        voided_reports AS (
            SELECT id
            FROM payroll_reports
            WHERE period_month = $1
              AND voided_at IS NOT NULL
        ),
        salary_finance AS (
            SELECT ft.id, ft.amount, ft.staff_id
            FROM finance_transactions ft
            WHERE ft.payment_method = 'salary'
              AND ft.date::date >= $2::date
              AND ft.date::date <= $3::date
        ),
        reversal_finance AS (
            SELECT ft.id, ft.amount
            FROM finance_transactions ft
            WHERE ft.payment_method = 'salary_reversal'
              AND ft.date::date >= $2::date
              AND ft.date::date <= $3::date
        ),
        missing_finance AS (
            SELECT ar.id
            FROM active_reports ar
            LEFT JOIN finance_transactions ft ON ft.id = ar.finance_transaction_id
            WHERE ar.finance_transaction_id IS NULL OR ft.id IS NULL
        ),
        orphan_salary AS (
            SELECT sf.id
            FROM salary_finance sf
            LEFT JOIN payroll_reports pr ON pr.finance_transaction_id = sf.id AND pr.period_month = $1
            WHERE pr.id IS NULL
        ),
        source_warnings AS (
            SELECT COALESCE(SUM(
                CASE
                    WHEN jsonb_typeof(breakdown_json->'reconciliation'->'warnings') = 'array'
                    THEN jsonb_array_length(breakdown_json->'reconciliation'->'warnings')
                    ELSE 0
                END
            ), 0)::int AS warning_count
            FROM active_reports
        )
        SELECT
            COALESCE((SELECT COUNT(*) FROM active_reports), 0)::int AS payroll_count,
            COALESCE((SELECT SUM(net_amount) FROM active_reports), 0)::numeric AS payroll_total,
            COALESCE((SELECT COUNT(*) FROM voided_reports), 0)::int AS voided_count,
            COALESCE((SELECT COUNT(*) FROM salary_finance), 0)::int AS finance_salary_count,
            COALESCE((SELECT SUM(amount) FROM salary_finance), 0)::numeric AS finance_salary_total,
            COALESCE((SELECT COUNT(*) FROM reversal_finance), 0)::int AS finance_reversal_count,
            COALESCE((SELECT SUM(amount) FROM reversal_finance), 0)::numeric AS finance_reversal_total,
            COALESCE((SELECT COUNT(*) FROM missing_finance), 0)::int AS missing_finance_count,
            COALESCE((SELECT COUNT(*) FROM orphan_salary), 0)::int AS orphan_salary_count,
            COALESCE((SELECT warning_count FROM source_warnings), 0)::int AS source_warning_count`,
        [month, range.from, range.to]
    );
    const row = result.rows[0] || {};
    const payrollTotal = Number(row.payroll_total || 0);
    const financeSalaryTotal = Number(row.finance_salary_total || 0);
    const financeReversalTotal = Number(row.finance_reversal_total || 0);
    const financeNetTotal = financeSalaryTotal - financeReversalTotal;
    const variance = payrollTotal - financeNetTotal;
    const missingFinanceCount = Number(row.missing_finance_count || 0);
    const orphanSalaryCount = Number(row.orphan_salary_count || 0);
    const sourceWarningCount = Number(row.source_warning_count || 0);
    return {
        month,
        payroll_count: Number(row.payroll_count || 0),
        payroll_total: payrollTotal,
        voided_count: Number(row.voided_count || 0),
        finance_salary_count: Number(row.finance_salary_count || 0),
        finance_salary_total: financeSalaryTotal,
        finance_reversal_count: Number(row.finance_reversal_count || 0),
        finance_reversal_total: financeReversalTotal,
        finance_net_total: financeNetTotal,
        missing_finance_count: missingFinanceCount,
        orphan_salary_count: orphanSalaryCount,
        source_warning_count: sourceWarningCount,
        variance,
        status: variance === 0 && missingFinanceCount === 0 && orphanSalaryCount === 0 && sourceWarningCount === 0
            ? 'ok'
            : 'attention'
    };
}

module.exports = {
    PAYROLL_EVENT_LABELS,
    PAYROLL_EVENT_TYPES,
    assertPayrollPeriodOpen,
    buildPayrollRateUnitWarnings,
    buildPayrollSourceReconciliation,
    loadPayrollPeriodEvents,
    loadPayrollPeriodLock,
    loadPayrollReconciliation,
    normalizePayrollDate,
    normalizePayrollPeriodEvent,
    payrollMonthRange,
    payrollPeriodRange,
    recordPayrollPeriodEvent,
    requirePayrollMonth,
    setPayrollPeriodLock
};
