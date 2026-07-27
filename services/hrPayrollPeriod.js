const { pool } = require('../db');
const { loadPayrollSettlementReadModels, PAYROLL_SETTLEMENT_MODELS } = require('./payrollSettlement');

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

function payrollPeriodMutationLockKey(month) {
    const normalizedMonth = requirePayrollMonth(month);
    if (!normalizedMonth) {
        const err = new Error('month required (YYYY-MM)');
        err.statusCode = 400;
        throw err;
    }
    return `eventgenix:payroll-period:${normalizedMonth}`;
}

async function acquirePayrollPeriodMutationLock(db, month) {
    const lockKey = payrollPeriodMutationLockKey(month);
    await db.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [lockKey]
    );
    return lockKey;
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
    await acquirePayrollPeriodMutationLock(db, month);
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

async function lockPayrollPeriodMutation(month, db = pool) {
    const normalizedMonth = requirePayrollMonth(month);
    if (!normalizedMonth) {
        const err = new Error('valid payroll month is required (YYYY-MM)');
        err.statusCode = 400;
        err.code = 'PAYROLL_MONTH_INVALID';
        throw err;
    }
    await db.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`eventgenix-payroll-period:${normalizedMonth}`]
    );
    return normalizedMonth;
}

function summarizeInstallmentSettlementExposure(settlement = {}) {
    const summary = {
        outstandingInstallmentCount: 0,
        outstandingAmount: 0,
        overpaymentCount: 0,
        overpaymentAmount: 0,
        mixedSettlementModelCount: 0
    };
    const models = new Set();
    for (const report of settlement.reports || []) {
        if (report.settlementModel) models.add(report.settlementModel);
        for (const installment of report.installments || []) {
            const outstandingAmount = Number(installment.outstandingAmount || 0);
            const overpaidAmount = Number(installment.overpaidAmount || 0);
            if (outstandingAmount > 0) {
                summary.outstandingInstallmentCount += 1;
                summary.outstandingAmount += outstandingAmount;
            }
            if (overpaidAmount > 0) {
                summary.overpaymentCount += 1;
                summary.overpaymentAmount += overpaidAmount;
            }
        }
    }
    summary.outstandingAmount = Math.round((summary.outstandingAmount + Number.EPSILON) * 100) / 100;
    summary.overpaymentAmount = Math.round((summary.overpaymentAmount + Number.EPSILON) * 100) / 100;
    summary.mixedSettlementModelCount = models.size > 1 ? models.size : 0;
    return summary;
}

async function loadPayrollInstallmentReconciliation(month, settlement, db = pool) {
    const range = payrollMonthRange(month);
    const reportIds = new Set((settlement.reports || []).map(report => Number(report.reportId)).filter(Boolean));
    const installmentIds = new Set();
    let invalidLedgerCount = 0;
    for (const report of settlement.reports || []) {
        for (const installment of report.installments || []) {
            installmentIds.add(Number(installment.id));
            if (installment.ledgerIntegrity !== 'valid') invalidLedgerCount += 1;
        }
    }
    const linkResult = await db.query(
        `WITH month_installments AS (
            SELECT pi.id AS installment_id,
                   pi.business_context AS installment_business_context,
                   pr.staff_id AS payroll_staff_id,
                   pr.period_month
            FROM payroll_installments pi
            JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
            WHERE pr.period_month = $1
              AND pr.settlement_model = $4
        ),
        movements AS (
            SELECT ppm.id,
                   ppm.installment_id,
                   ppm.movement_type,
                   ppm.amount,
                   ppm.actual_payment_date,
                   ppm.finance_transaction_id,
                   ppm.reverses_movement_id,
                   mi.installment_business_context,
                   mi.payroll_staff_id,
                   mi.period_month
            FROM payroll_payment_movements ppm
            JOIN month_installments mi ON mi.installment_id = ppm.installment_id
        ),
        finance_links AS (
            SELECT m.*,
                   ft.id AS linked_finance_id,
                   ft.amount AS finance_amount,
                   ft.type AS finance_type,
                   ft.source AS finance_source,
                   ft.date::date AS finance_date,
                   ft.recognition_date,
                   ft.staff_id AS finance_staff_id,
                   COALESCE(NULLIF(BTRIM(ft.business_context), ''), 'event_genix') AS finance_business_context
            FROM movements m
            LEFT JOIN finance_transactions ft ON ft.id = m.finance_transaction_id
        ),
        missing_finance AS (
            SELECT m.id
            FROM finance_links m
            WHERE m.linked_finance_id IS NULL
        ),
        finance_without_payroll_source AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND COALESCE(finance_source, '') <> 'payroll'
        ),
        amount_mismatch AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND ABS(COALESCE(amount, 0) - COALESCE(finance_amount, 0)) > 0.01
        ),
        finance_type_mismatch AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND (
                (movement_type = 'payment' AND finance_type <> 'expense')
                OR (movement_type = 'reversal' AND finance_type <> 'income')
              )
        ),
        payment_date_mismatch AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND actual_payment_date IS DISTINCT FROM finance_date
        ),
        ownership_mismatch AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND (
                finance_staff_id IS DISTINCT FROM payroll_staff_id
                OR finance_business_context IS DISTINCT FROM installment_business_context
              )
        ),
        recognition_month_mismatch AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND TO_CHAR(COALESCE(recognition_date, finance_date), 'YYYY-MM') IS DISTINCT FROM period_month
        ),
        reversal_mismatch AS (
            SELECT r.id
            FROM finance_links r
            LEFT JOIN movements target
              ON target.id = r.reverses_movement_id
             AND target.movement_type = 'payment'
            WHERE r.movement_type = 'reversal'
              AND (
                r.reverses_movement_id IS NULL
                OR target.id IS NULL
                OR target.installment_id <> r.installment_id
                OR r.linked_finance_id IS NULL
                OR r.finance_type <> 'income'
                OR COALESCE(r.finance_source, '') <> 'payroll'
              )
        ),
        orphan_payroll_finance AS (
            SELECT ft.id
            FROM finance_transactions ft
            LEFT JOIN payroll_payment_movements ppm ON ppm.finance_transaction_id = ft.id
            WHERE ft.source = 'payroll'
              AND ppm.id IS NULL
              AND COALESCE(ft.recognition_date, ft.date::date) >= $2::date
              AND COALESCE(ft.recognition_date, ft.date::date) <= $3::date
        ),
        duplicate_finance AS (
            SELECT finance_transaction_id
            FROM movements
            WHERE finance_transaction_id IS NOT NULL
            GROUP BY finance_transaction_id
            HAVING COUNT(*) > 1
        ),
        movement_totals AS (
            SELECT
                COUNT(*) FILTER (WHERE movement_type = 'payment')::int AS payment_count,
                COALESCE(SUM(amount) FILTER (WHERE movement_type = 'payment'), 0)::numeric AS payment_total,
                COUNT(*) FILTER (WHERE movement_type = 'reversal')::int AS reversal_count,
                COALESCE(SUM(amount) FILTER (WHERE movement_type = 'reversal'), 0)::numeric AS reversal_total
            FROM movements
        )
        SELECT
            COALESCE((SELECT payment_count FROM movement_totals), 0)::int AS payment_count,
            COALESCE((SELECT payment_total FROM movement_totals), 0)::numeric AS payment_total,
            COALESCE((SELECT reversal_count FROM movement_totals), 0)::int AS reversal_count,
            COALESCE((SELECT reversal_total FROM movement_totals), 0)::numeric AS reversal_total,
            COALESCE((SELECT COUNT(*) FROM missing_finance), 0)::int AS missing_finance_count,
            COALESCE((SELECT COUNT(*) FROM orphan_payroll_finance), 0)::int AS orphan_salary_count,
            COALESCE((SELECT COUNT(*) FROM duplicate_finance), 0)::int AS duplicate_finance_count,
            COALESCE((SELECT COUNT(*) FROM amount_mismatch), 0)::int AS amount_mismatch_count,
            COALESCE((SELECT COUNT(*) FROM finance_type_mismatch), 0)::int AS finance_type_mismatch_count,
            COALESCE((SELECT COUNT(*) FROM payment_date_mismatch), 0)::int AS payment_date_mismatch_count,
            COALESCE((SELECT COUNT(*) FROM ownership_mismatch), 0)::int AS ownership_mismatch_count,
            COALESCE((SELECT COUNT(*) FROM recognition_month_mismatch), 0)::int AS recognition_month_mismatch_count,
            COALESCE((SELECT COUNT(*) FROM reversal_mismatch), 0)::int AS reversal_mismatch_count,
            COALESCE((SELECT COUNT(*) FROM finance_without_payroll_source), 0)::int AS finance_without_payroll_source_count`,
        [month, range.from, range.to, PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS]
    );
    const row = linkResult.rows[0] || {};
    const warnings = [...(settlement.warnings || [])];
    if (Number(row.missing_finance_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_LINK_MISSING',
            count: Number(row.missing_finance_count || 0),
            message: 'Payroll movement has no linked Finance transaction'
        });
    }
    if (Number(row.orphan_salary_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_ORPHAN',
            count: Number(row.orphan_salary_count || 0),
            message: 'Payroll Finance transaction has no payment movement'
        });
    }
    if (Number(row.duplicate_finance_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_LINK_DUPLICATE',
            count: Number(row.duplicate_finance_count || 0),
            message: 'Payroll finance transaction is linked by multiple movements'
        });
    }
    if (Number(row.amount_mismatch_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_AMOUNT_MISMATCH',
            count: Number(row.amount_mismatch_count || 0),
            message: 'Payroll movement amount differs from linked Finance transaction amount'
        });
    }
    if (Number(row.finance_type_mismatch_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_TYPE_MISMATCH',
            count: Number(row.finance_type_mismatch_count || 0),
            message: 'Payroll payment/reversal is linked to an unexpected Finance transaction type'
        });
    }
    if (Number(row.payment_date_mismatch_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_DATE_MISMATCH',
            count: Number(row.payment_date_mismatch_count || 0),
            message: 'Payroll movement actual date differs from the linked Finance cash date'
        });
    }
    if (Number(row.ownership_mismatch_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_OWNERSHIP_MISMATCH',
            count: Number(row.ownership_mismatch_count || 0),
            message: 'Payroll and Finance staff/business-context ownership differs'
        });
    }
    if (Number(row.recognition_month_mismatch_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_RECOGNITION_MISMATCH',
            count: Number(row.recognition_month_mismatch_count || 0),
            message: 'Payroll Finance recognition month differs from the earning month'
        });
    }
    if (Number(row.reversal_mismatch_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_REVERSAL_MISMATCH',
            count: Number(row.reversal_mismatch_count || 0),
            message: 'Payroll reversal movement is missing its original payment or valid reversal finance link'
        });
    }
    if (Number(row.finance_without_payroll_source_count || 0) > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_SOURCE_MISSING',
            count: Number(row.finance_without_payroll_source_count || 0),
            message: 'Payroll movement is linked to a Finance transaction without source=payroll'
        });
    }
    if (invalidLedgerCount > 0) {
        warnings.push({
            code: 'PAYROLL_LEDGER_INVALID',
            count: invalidLedgerCount,
            message: 'Payroll movement ledger contains invalid reversal totals'
        });
    }
    const exposure = summarizeInstallmentSettlementExposure(settlement);
    if (exposure.outstandingInstallmentCount > 0) {
        warnings.push({
            code: 'PAYROLL_INSTALLMENT_OUTSTANDING',
            count: exposure.outstandingInstallmentCount,
            amount: exposure.outstandingAmount,
            message: 'Payroll installment has an outstanding balance'
        });
    }
    if (exposure.overpaymentCount > 0) {
        warnings.push({
            code: 'PAYROLL_INSTALLMENT_OVERPAID',
            count: exposure.overpaymentCount,
            amount: exposure.overpaymentAmount,
            message: 'Payroll installment has unresolved overpayment'
        });
    }
    const totals = settlement.totals || {};
    const accrued = Number(totals.effectiveDueAmount || 0);
    const paymentTotal = Number(row.payment_total || 0);
    const reversalTotal = Number(row.reversal_total || 0);
    const paid = Number(totals.paidAmount || 0);
    const balance = Number(totals.balanceAmount || 0);
    const missingFinanceCount = Number(row.missing_finance_count || 0);
    const orphanSalaryCount = Number(row.orphan_salary_count || 0);
    const duplicateFinanceCount = Number(row.duplicate_finance_count || 0);
    const amountMismatchCount = Number(row.amount_mismatch_count || 0);
    const financeTypeMismatchCount = Number(row.finance_type_mismatch_count || 0);
    const paymentDateMismatchCount = Number(row.payment_date_mismatch_count || 0);
    const ownershipMismatchCount = Number(row.ownership_mismatch_count || 0);
    const recognitionMonthMismatchCount = Number(row.recognition_month_mismatch_count || 0);
    const reversalMismatchCount = Number(row.reversal_mismatch_count || 0);
    const financeWithoutPayrollSourceCount = Number(row.finance_without_payroll_source_count || 0);
    const installmentTotalMismatchCount = warnings.filter(warning => (
        warning.code === 'PAYROLL_INSTALLMENT_TOTAL_MISMATCH'
    )).length;
    const status = settlement.mode === 'installments'
        && warnings.length === 0
        && missingFinanceCount === 0
        && orphanSalaryCount === 0
        && duplicateFinanceCount === 0
        && amountMismatchCount === 0
        && financeTypeMismatchCount === 0
        && paymentDateMismatchCount === 0
        && ownershipMismatchCount === 0
        && recognitionMonthMismatchCount === 0
        && reversalMismatchCount === 0
        && financeWithoutPayrollSourceCount === 0
        && installmentTotalMismatchCount === 0
        && exposure.outstandingInstallmentCount === 0
        && exposure.overpaymentCount === 0
        && invalidLedgerCount === 0
        ? 'ok'
        : 'attention';
    return {
        month,
        settlement_model: PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS,
        payroll_count: reportIds.size,
        payroll_total: accrued,
        accrued_total: accrued,
        voided_count: 0,
        finance_salary_count: Number(row.payment_count || 0),
        finance_salary_total: paymentTotal,
        finance_reversal_count: Number(row.reversal_count || 0),
        finance_reversal_total: reversalTotal,
        finance_net_total: paid,
        paid_total: paid,
        reversed_total: reversalTotal,
        balance_total: balance,
        installment_count: installmentIds.size,
        missing_finance_count: missingFinanceCount,
        orphan_salary_count: orphanSalaryCount,
        duplicate_finance_count: duplicateFinanceCount,
        amount_mismatch_count: amountMismatchCount,
        finance_type_mismatch_count: financeTypeMismatchCount,
        payment_date_mismatch_count: paymentDateMismatchCount,
        ownership_mismatch_count: ownershipMismatchCount,
        recognition_month_mismatch_count: recognitionMonthMismatchCount,
        reversal_mismatch_count: reversalMismatchCount,
        finance_without_payroll_source_count: financeWithoutPayrollSourceCount,
        installment_total_mismatch_count: installmentTotalMismatchCount,
        outstanding_installment_count: exposure.outstandingInstallmentCount,
        outstanding_amount: exposure.outstandingAmount,
        overpayment_count: exposure.overpaymentCount,
        overpayment_amount: exposure.overpaymentAmount,
        mixed_settlement_model_count: exposure.mixedSettlementModelCount,
        source_warning_count: warnings.length,
        stored_report_count: reportIds.size,
        stored_draft_count: 0,
        regular_draft_count: 0,
        freelance_draft_count: 0,
        missing_staff_draft_count: 0,
        classified_draft_count: 0,
        unclassified_draft_count: 0,
        warnings,
        variance: balance,
        status
    };
}

async function loadPayrollReconciliation(month, db = pool) {
    const settlement = await loadPayrollSettlementReadModels(month, db);
    if (settlement.mode === 'installments' || settlement.mode === 'incomplete' || settlement.mode === 'mixed') {
        return loadPayrollInstallmentReconciliation(month, settlement, db);
    }
    const range = payrollMonthRange(month);
    const result = await db.query(
        `WITH stored_reports AS (
            SELECT pr.id,
                   pr.status,
                   (s.id IS NOT NULL) AS staff_exists,
                   COALESCE(s.is_freelance, false) AS is_freelance
            FROM payroll_reports pr
            LEFT JOIN staff s ON s.id = pr.staff_id
            WHERE pr.period_month = $1
              AND pr.voided_at IS NULL
        ),
        stored_report_coverage AS (
            SELECT COUNT(*)::int AS stored_report_count,
                   COUNT(*) FILTER (WHERE status = 'draft')::int AS stored_draft_count,
                   COUNT(*) FILTER (WHERE status <> 'paid')::int AS stored_unsettled_count,
                   COUNT(*) FILTER (
                       WHERE status = 'draft'
                         AND staff_exists
                         AND NOT is_freelance
                   )::int AS regular_draft_count,
                   COUNT(*) FILTER (
                       WHERE status = 'draft'
                         AND staff_exists
                         AND is_freelance
                   )::int AS freelance_draft_count,
                   COUNT(*) FILTER (
                       WHERE status = 'draft'
                         AND NOT staff_exists
                   )::int AS missing_staff_draft_count
            FROM stored_reports
        ),
        active_reports AS (
            SELECT id, staff_id, net_amount, finance_transaction_id, reversal_transaction_id, breakdown_json
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
        amount_mismatch AS (
            SELECT ar.id
            FROM active_reports ar
            JOIN finance_transactions ft ON ft.id = ar.finance_transaction_id
            WHERE ABS(COALESCE(ar.net_amount, 0) - COALESCE(ft.amount, 0)) > 0.01
        ),
        duplicate_finance AS (
            SELECT finance_transaction_id
            FROM active_reports
            WHERE finance_transaction_id IS NOT NULL
            GROUP BY finance_transaction_id
            HAVING COUNT(*) > 1
        ),
        orphan_salary AS (
            SELECT sf.id
            FROM salary_finance sf
            LEFT JOIN payroll_reports pr ON pr.finance_transaction_id = sf.id AND pr.period_month = $1
            WHERE pr.id IS NULL
        ),
        orphan_reversal AS (
            SELECT rf.id
            FROM reversal_finance rf
            LEFT JOIN payroll_reports pr ON pr.reversal_transaction_id = rf.id AND pr.period_month = $1
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
            COALESCE((SELECT COUNT(*) FROM duplicate_finance), 0)::int AS duplicate_finance_count,
            COALESCE((SELECT COUNT(*) FROM amount_mismatch), 0)::int AS amount_mismatch_count,
            COALESCE((SELECT COUNT(*) FROM orphan_reversal), 0)::int AS reversal_mismatch_count,
            COALESCE((SELECT warning_count FROM source_warnings), 0)::int AS source_warning_count,
            COALESCE((SELECT stored_report_count FROM stored_report_coverage), 0)::int AS stored_report_count,
            COALESCE((SELECT stored_draft_count FROM stored_report_coverage), 0)::int AS stored_draft_count,
            COALESCE((SELECT stored_unsettled_count FROM stored_report_coverage), 0)::int AS stored_unsettled_count,
            COALESCE((SELECT regular_draft_count FROM stored_report_coverage), 0)::int AS regular_draft_count,
            COALESCE((SELECT freelance_draft_count FROM stored_report_coverage), 0)::int AS freelance_draft_count,
            COALESCE((SELECT missing_staff_draft_count FROM stored_report_coverage), 0)::int AS missing_staff_draft_count`,
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
    const duplicateFinanceCount = Number(row.duplicate_finance_count || 0);
    const amountMismatchCount = Number(row.amount_mismatch_count || 0);
    const reversalMismatchCount = Number(row.reversal_mismatch_count || 0);
    const sourceWarningCount = Number(row.source_warning_count || 0);
    const storedReportCount = Number(row.stored_report_count || 0);
    const storedDraftCount = Number(row.stored_draft_count || 0);
    const storedUnsettledCount = Number(row.stored_unsettled_count || 0);
    const regularDraftCount = Number(row.regular_draft_count || 0);
    const freelanceDraftCount = Number(row.freelance_draft_count || 0);
    const missingStaffDraftCount = Number(row.missing_staff_draft_count || 0);
    const classifiedDraftCount = regularDraftCount + freelanceDraftCount + missingStaffDraftCount;
    const unclassifiedDraftCount = Math.max(0, storedDraftCount - classifiedDraftCount);
    const warnings = [];
    if (storedUnsettledCount > 0) {
        warnings.push({
            code: 'PAYROLL_LEGACY_UNSETTLED_REPORTS',
            count: storedUnsettledCount,
            message: 'Legacy payroll month contains draft, reviewed, or approved reports that are not historically accounted'
        });
    }
    if (freelanceDraftCount > 0) {
        warnings.push({
            code: 'PAYROLL_FREELANCE_DRAFTS_EXCLUDED_FROM_ACTIVE_STAFF',
            count: freelanceDraftCount,
            message: `${freelanceDraftCount} чернеток зарплати фрилансерів збережено окремо від активного списку працівників`
        });
    }
    if (missingStaffDraftCount > 0) {
        warnings.push({
            code: 'PAYROLL_STORED_DRAFT_STAFF_MISSING',
            count: missingStaffDraftCount,
            message: `${missingStaffDraftCount} чернеток зарплати не мають пов'язаної картки працівника`
        });
    }
    if (unclassifiedDraftCount > 0) {
        warnings.push({
            code: 'PAYROLL_STORED_DRAFT_UNCLASSIFIED',
            count: unclassifiedDraftCount,
            message: `${unclassifiedDraftCount} чернеток зарплати не вдалося класифікувати`
        });
    }
    if (duplicateFinanceCount > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_LINK_DUPLICATE',
            count: duplicateFinanceCount,
            message: 'Legacy payroll finance transaction is linked by multiple paid reports'
        });
    }
    if (amountMismatchCount > 0) {
        warnings.push({
            code: 'PAYROLL_FINANCE_AMOUNT_MISMATCH',
            count: amountMismatchCount,
            message: 'Legacy paid report amount differs from linked Finance transaction amount'
        });
    }
    if (reversalMismatchCount > 0) {
        warnings.push({
            code: 'PAYROLL_REVERSAL_MISMATCH',
            count: reversalMismatchCount,
            message: 'Legacy reversal Finance transaction is not linked to a payroll report reversal'
        });
    }
    return {
        month,
        settlement_model: PAYROLL_SETTLEMENT_MODELS.LEGACY,
        historical_status: settlement.legacyClassification?.historicalStatus || 'legacy_workflow',
        historical_status_message: settlement.legacyClassification?.historicalStatusMessage || null,
        payment_fact_verified: false,
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
        duplicate_finance_count: duplicateFinanceCount,
        amount_mismatch_count: amountMismatchCount,
        reversal_mismatch_count: reversalMismatchCount,
        finance_without_payroll_source_count: 0,
        outstanding_installment_count: 0,
        outstanding_amount: 0,
        overpayment_count: 0,
        overpayment_amount: 0,
        mixed_settlement_model_count: 0,
        source_warning_count: sourceWarningCount,
        stored_report_count: storedReportCount,
        stored_draft_count: storedDraftCount,
        stored_unsettled_count: storedUnsettledCount,
        regular_draft_count: regularDraftCount,
        freelance_draft_count: freelanceDraftCount,
        missing_staff_draft_count: missingStaffDraftCount,
        classified_draft_count: classifiedDraftCount,
        unclassified_draft_count: unclassifiedDraftCount,
        warnings,
        variance,
        status: variance === 0
            && missingFinanceCount === 0
            && orphanSalaryCount === 0
            && duplicateFinanceCount === 0
            && amountMismatchCount === 0
            && reversalMismatchCount === 0
            && sourceWarningCount === 0
            && storedUnsettledCount === 0
            && warnings.length === 0
            ? 'ok'
            : 'attention'
    };
}

function payrollCloseBlockedError(month, blockers = []) {
    const err = new Error(`Payroll month ${month} cannot be closed until settlement is complete`);
    err.statusCode = 409;
    err.code = 'PAYROLL_MONTH_CLOSE_BLOCKED';
    err.details = { blockers };
    return err;
}

function payrollInstallmentCloseBlockers(settlement = {}) {
    const blockers = [];
    if (settlement.mode !== 'installments') {
        blockers.push({
            code: 'PAYROLL_SETTLEMENT_MODEL_INCOMPLETE',
            mode: settlement.mode,
            message: 'Payroll settlement model is incomplete or mixed'
        });
        return blockers;
    }
    for (const report of settlement.reports || []) {
        for (const warning of report.warnings || []) {
            blockers.push({
                code: warning.code || 'PAYROLL_SETTLEMENT_WARNING',
                reportId: report.reportId,
                message: warning.message || 'Payroll settlement warning must be resolved before close'
            });
        }
        for (const installment of report.installments || []) {
            const status = installment.settlementStatus;
            const workflowStatus = installment.workflowStatus || installment.workflow_status;
            const calculation = installment.calculationSnapshot?.calculation
                || installment.calculation_snapshot?.calculation
                || {};
            const reportLevelOverpaidAmount = Number(calculation.overpaidAmount || 0);
            const lockedAdvanceOverMonthlyNetAmount = Number(
                calculation.lockedAdvanceOverMonthlyNetAmount || 0
            );
            const approvedSettlement = workflowStatus === 'approved'
                && (status === 'paid' || status === 'not_due');
            const explicitlySettled = approvedSettlement
                || (status === 'cancelled' && installment.outstandingAmount === 0 && installment.overpaidAmount === 0);
            if (!explicitlySettled) {
                blockers.push({
                    code: 'PAYROLL_INSTALLMENT_NOT_SETTLED',
                    reportId: report.reportId,
                    installmentId: installment.id,
                    kind: installment.kind,
                    settlementStatus: status,
                    outstandingAmount: installment.outstandingAmount,
                    overpaidAmount: installment.overpaidAmount,
                    message: 'Installment must be paid, not due, or explicitly settled before month close'
                });
            }
            if (installment.ledgerIntegrity !== 'valid') {
                blockers.push({
                    code: 'PAYROLL_INSTALLMENT_LEDGER_INVALID',
                    reportId: report.reportId,
                    installmentId: installment.id,
                    kind: installment.kind,
                    ledgerIntegrity: installment.ledgerIntegrity,
                    message: 'Installment ledger integrity must be valid before month close'
                });
            }
            if (
                installment.kind === 'final'
                && (reportLevelOverpaidAmount > 0 || lockedAdvanceOverMonthlyNetAmount > 0)
            ) {
                blockers.push({
                    code: 'PAYROLL_OVERPAYMENT_UNRESOLVED',
                    reportId: report.reportId,
                    installmentId: installment.id,
                    kind: installment.kind,
                    overpaidAmount: reportLevelOverpaidAmount,
                    lockedAdvanceOverMonthlyNetAmount,
                    message: 'Advance exceeds the final monthly payroll result and requires an explicit correction or resolution before close'
                });
            }
        }
    }
    if (settlement.totals?.overpaidAmount > 0) {
        blockers.push({
            code: 'PAYROLL_OVERPAYMENT_UNRESOLVED',
            overpaidAmount: settlement.totals.overpaidAmount,
            message: 'Resolve overpayment before month close'
        });
    }
    return blockers;
}

async function closePayrollPeriodWithinTransaction(month, actor, note = '', db = pool) {
    await lockPayrollPeriodMutation(month, db);
    const settlement = await loadPayrollSettlementReadModels(month, db);
    if (settlement.mode === 'legacy' || settlement.mode === PAYROLL_SETTLEMENT_MODELS.LEGACY) {
        const reconciliation = await loadPayrollReconciliation(month, db);
        const blockers = [];
        if (reconciliation.payroll_count <= 0) {
            blockers.push({
                code: 'PAYROLL_LEGACY_NO_PAID_REPORTS',
                message: 'Legacy month has no paid payroll reports to close'
            });
        }
        if (reconciliation.stored_unsettled_count > 0) {
            blockers.push({
                code: 'PAYROLL_LEGACY_UNSETTLED_REPORTS',
                count: reconciliation.stored_unsettled_count,
                message: 'Legacy month contains payroll reports that are not historically accounted'
            });
        }
        if (reconciliation.status !== 'ok') {
            blockers.push({
                code: 'PAYROLL_LEGACY_RECONCILIATION_NOT_CLEAN',
                reconciliationStatus: reconciliation.status,
                variance: reconciliation.variance,
                missingFinanceCount: reconciliation.missing_finance_count,
                orphanSalaryCount: reconciliation.orphan_salary_count,
                sourceWarningCount: reconciliation.source_warning_count,
                message: 'Legacy payroll reconciliation must be clean before close'
            });
        }
        if (blockers.length) throw payrollCloseBlockedError(month, blockers);
        const periodLock = await setPayrollPeriodLock(month, true, actor, note || 'Legacy payroll month closed', db);
        return { periodLock, reconciliation, settlement };
    }

    const reconciliation = await loadPayrollReconciliation(month, db);
    const blockers = payrollInstallmentCloseBlockers(settlement);
    if (reconciliation.status !== 'ok') {
        blockers.push({
            code: 'PAYROLL_INSTALLMENT_RECONCILIATION_NOT_CLEAN',
            reconciliationStatus: reconciliation.status,
            message: 'Installment payroll reconciliation must be clean before close'
        });
    }
    if (blockers.length) throw payrollCloseBlockedError(month, blockers);
    const periodLock = await setPayrollPeriodLock(month, true, actor, note || 'Installment payroll month closed', db);
    return { periodLock, reconciliation, settlement };
}

async function closePayrollPeriod(month, actor, note = '', db = pool) {
    if (!db || typeof db.connect !== 'function') {
        return closePayrollPeriodWithinTransaction(month, actor, note, db);
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await closePayrollPeriodWithinTransaction(month, actor, note, client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    PAYROLL_EVENT_LABELS,
    PAYROLL_EVENT_TYPES,
    acquirePayrollPeriodMutationLock,
    assertPayrollPeriodOpen,
    buildPayrollRateUnitWarnings,
    buildPayrollSourceReconciliation,
    closePayrollPeriod,
    loadPayrollPeriodEvents,
    loadPayrollPeriodLock,
    loadPayrollReconciliation,
    lockPayrollPeriodMutation,
    normalizePayrollDate,
    normalizePayrollPeriodEvent,
    payrollMonthRange,
    payrollPeriodRange,
    recordPayrollPeriodEvent,
    requirePayrollMonth,
    setPayrollPeriodLock
};
