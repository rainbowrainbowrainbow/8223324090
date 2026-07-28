'use strict';

const { pool } = require('../db');

const PAYROLL_SETTLEMENT_MODELS = Object.freeze({
    LEGACY: 'legacy_v1',
    INSTALLMENTS: 'installments_v1'
});

const LEGACY_PAYROLL_ACCOUNTED_STATUS = 'legacy_accounted';
const LEGACY_MANUAL_SALARY_FINANCE_STATUS = 'legacy_manual_salary_finance';
const LEGACY_ZRS_VOIDED_STATUS = 'legacy_zrs_voided';
const LEGACY_PAYROLL_ACCOUNTED_MESSAGE = 'Історично враховано; факт виплати користувачем не підтверджено';
const LEGACY_MANUAL_SALARY_FINANCE_MESSAGE = 'Історична ручна фінансова операція; не підтверджена payroll movement';
const LEGACY_ZRS_VOIDED_MESSAGE = 'Історичний запис ЗРС скасовано';
const PAYROLL_HISTORICAL_CLASSIFICATION_MESSAGES = Object.freeze({
    [LEGACY_PAYROLL_ACCOUNTED_STATUS]: LEGACY_PAYROLL_ACCOUNTED_MESSAGE,
    [LEGACY_MANUAL_SALARY_FINANCE_STATUS]: LEGACY_MANUAL_SALARY_FINANCE_MESSAGE,
    [LEGACY_ZRS_VOIDED_STATUS]: LEGACY_ZRS_VOIDED_MESSAGE
});
const PAYROLL_INSTALLMENT_KINDS = Object.freeze(['advance', 'final']);
const PAYROLL_INSTALLMENTS_ACTIVATION_ENV = 'PAYROLL_INSTALLMENTS_ACTIVATION_MONTH';

function normalizePayrollMonth(value) {
    const month = String(value || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        const error = new Error('valid payroll month is required (YYYY-MM)');
        error.code = 'PAYROLL_MONTH_INVALID';
        error.statusCode = 400;
        throw error;
    }
    return month;
}

function configuredPayrollInstallmentsActivationMonth(env = process.env) {
    const raw = String(env?.[PAYROLL_INSTALLMENTS_ACTIVATION_ENV] || '').trim();
    if (!raw) return null;
    return normalizePayrollMonth(raw);
}

function isPayrollInstallmentsActivationMonth(month, env = process.env) {
    const normalizedMonth = normalizePayrollMonth(month);
    const activationMonth = configuredPayrollInstallmentsActivationMonth(env);
    return Boolean(activationMonth && normalizedMonth >= activationMonth);
}

function money(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function nullableMoney(value) {
    if (value === null || value === undefined || value === '') return null;
    return money(value, null);
}

function isoDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
}

function objectValue(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function arrayValue(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function derivePayrollInstallmentAmounts(row = {}) {
    const workflowStatus = String(row.workflow_status || row.workflowStatus || 'draft');
    const calculatedAmount = money(row.calculated_amount ?? row.calculatedAmount);
    const lockedAmount = nullableMoney(row.locked_amount ?? row.lockedAmount);
    const paymentTotal = money(row.payment_total ?? row.paymentTotal);
    const reversalTotal = money(row.reversal_total ?? row.reversalTotal);
    const scheduledPaymentDate = isoDate(row.scheduled_payment_date ?? row.scheduledPaymentDate);
    const asOfDate = isoDate(row.as_of_date ?? row.asOfDate ?? new Date());
    const effectiveDueAmount = workflowStatus === 'cancelled'
        ? 0
        : (lockedAmount === null ? calculatedAmount : lockedAmount);
    const rawPaidAmount = money(paymentTotal - reversalTotal);
    const unappliedReversalAmount = Math.max(-rawPaidAmount, 0);
    const ledgerIntegrity = unappliedReversalAmount > 0 ? 'invalid_reversal_total' : 'valid';
    const paidAmount = Math.max(rawPaidAmount, 0);
    const balanceAmount = money(effectiveDueAmount - paidAmount);
    const outstandingAmount = Math.max(balanceAmount, 0);
    const overpaidAmount = Math.max(-balanceAmount, 0);
    const fullyReversed = paymentTotal > 0 && reversalTotal >= paymentTotal && paidAmount === 0;

    let settlementStatus = workflowStatus;
    if (ledgerIntegrity !== 'valid') {
        settlementStatus = 'invalid_ledger';
    } else if (workflowStatus !== 'cancelled') {
        if (fullyReversed) settlementStatus = 'reversed';
        else if (overpaidAmount > 0) settlementStatus = 'overpaid';
        else if (effectiveDueAmount === 0 && paidAmount === 0) settlementStatus = 'not_due';
        else if (paidAmount === effectiveDueAmount && effectiveDueAmount > 0) settlementStatus = 'paid';
        else if (paidAmount > 0) settlementStatus = 'partially_paid';
        else if (
            workflowStatus === 'approved'
            && outstandingAmount > 0
            && scheduledPaymentDate
            && asOfDate
            && scheduledPaymentDate < asOfDate
        ) settlementStatus = 'overdue';
    }

    return {
        calculatedAmount,
        lockedAmount,
        effectiveDueAmount,
        paymentTotal,
        reversalTotal,
        paidAmount,
        unappliedReversalAmount,
        ledgerIntegrity,
        balanceAmount,
        outstandingAmount,
        overpaidAmount,
        settlementStatus
    };
}

function mapPayrollInstallment(row = {}) {
    const amounts = derivePayrollInstallmentAmounts(row);
    const movements = arrayValue(row.movements ?? row.payment_movements ?? row.paymentMovements)
        .map(mapPayrollPaymentMovement)
        .filter(movement => Number.isInteger(movement.id) && movement.id > 0);
    return {
        id: Number(row.installment_id ?? row.id),
        reportId: Number(row.report_id ?? row.payroll_report_id ?? row.reportId),
        kind: row.kind,
        earningFrom: isoDate(row.earning_from ?? row.earningFrom),
        earningTo: isoDate(row.earning_to ?? row.earningTo),
        scheduledPaymentDate: isoDate(row.scheduled_payment_date ?? row.scheduledPaymentDate),
        workflowStatus: row.workflow_status ?? row.workflowStatus ?? 'draft',
        calculationSnapshot: objectValue(row.calculation_snapshot ?? row.calculationSnapshot),
        allocationStatus: row.allocation_status ?? row.allocationStatus ?? 'unresolved',
        businessContext: row.business_context ?? row.businessContext ?? null,
        approvedByUserId: (row.approved_by_user_id ?? row.approvedByUserId) === null
            || (row.approved_by_user_id ?? row.approvedByUserId) === undefined
            ? null
            : Number(row.approved_by_user_id ?? row.approvedByUserId),
        approvedByUsername: row.approved_by_username ?? row.approvedByUsername ?? null,
        approvedByRole: row.approved_by_role ?? row.approvedByRole ?? null,
        approvedAt: row.approved_at ?? row.approvedAt ?? null,
        movements,
        paymentMovements: movements,
        actualPaymentDates: [...new Set(movements
            .filter(movement => movement.movementType === 'payment')
            .map(movement => movement.actualPaymentDate)
            .filter(Boolean))],
        financeTransactionIds: movements
            .filter(movement => movement.movementType === 'payment')
            .map(movement => movement.financeTransactionId)
            .filter(Boolean),
        reversalFinanceTransactionIds: movements
            .filter(movement => movement.movementType === 'reversal')
            .map(movement => movement.financeTransactionId)
            .filter(Boolean),
        ...amounts
    };
}

function mapPayrollPaymentMovement(row = {}) {
    return {
        id: Number(row.id ?? row.movement_id),
        installmentId: Number(row.installmentId ?? row.installment_id),
        movementType: row.movementType ?? row.movement_type ?? null,
        amount: money(row.amount),
        actualPaymentDate: isoDate(row.actualPaymentDate ?? row.actual_payment_date),
        actorUserId: (row.actorUserId ?? row.actor_user_id) === null
            || (row.actorUserId ?? row.actor_user_id) === undefined
            ? null
            : Number(row.actorUserId ?? row.actor_user_id),
        actorUsername: row.actorUsername ?? row.actor_username ?? null,
        actorRole: row.actorRole ?? row.actor_role ?? null,
        reason: row.reason || '',
        idempotencyKey: row.idempotencyKey ?? row.idempotency_key ?? null,
        financeTransactionId: (row.financeTransactionId ?? row.finance_transaction_id) === null
            || (row.financeTransactionId ?? row.finance_transaction_id) === undefined
            ? null
            : Number(row.financeTransactionId ?? row.finance_transaction_id),
        reversesMovementId: (row.reversesMovementId ?? row.reverses_movement_id) === null
            || (row.reversesMovementId ?? row.reverses_movement_id) === undefined
            ? null
            : Number(row.reversesMovementId ?? row.reverses_movement_id),
        createdAt: row.createdAt ?? row.created_at ?? null
    };
}

function emptySettlementTotals() {
    return {
        calculatedAmount: 0,
        lockedAmount: 0,
        effectiveDueAmount: 0,
        paidAmount: 0,
        balanceAmount: 0,
        outstandingAmount: 0,
        overpaidAmount: 0
    };
}

function sumInstallmentTotals(installments = []) {
    const totals = emptySettlementTotals();
    let lockedAmount = 0;
    let allInstallmentsLocked = installments.length > 0;

    for (const installment of installments) {
        totals.calculatedAmount = money(totals.calculatedAmount + installment.calculatedAmount);
        if (installment.lockedAmount === null) {
            allInstallmentsLocked = false;
        } else {
            lockedAmount = money(lockedAmount + installment.lockedAmount);
        }
        totals.effectiveDueAmount = money(totals.effectiveDueAmount + installment.effectiveDueAmount);
        totals.paidAmount = money(totals.paidAmount + installment.paidAmount);
        totals.balanceAmount = money(totals.balanceAmount + installment.balanceAmount);
        totals.outstandingAmount = money(totals.outstandingAmount + installment.outstandingAmount);
        totals.overpaidAmount = money(totals.overpaidAmount + installment.overpaidAmount);
    }

    totals.lockedAmount = allInstallmentsLocked ? lockedAmount : null;
    return totals;
}

function reportValue(report, snake, camel, fallback = null) {
    if (Object.prototype.hasOwnProperty.call(report, snake)) return report[snake];
    if (Object.prototype.hasOwnProperty.call(report, camel)) return report[camel];
    return fallback;
}

function classifyLegacyManualSalaryFinance(row = {}) {
    const paymentMethod = String(row.payment_method ?? row.paymentMethod ?? '').trim();
    const source = String(row.source ?? '').trim();
    if (paymentMethod !== 'salary' || source === 'payroll') return null;
    return {
        classification: LEGACY_MANUAL_SALARY_FINANCE_STATUS,
        historicalStatus: LEGACY_MANUAL_SALARY_FINANCE_STATUS,
        message: LEGACY_MANUAL_SALARY_FINANCE_MESSAGE,
        paymentFactVerified: false,
        canonicalPaymentMovement: false,
        payrollMovementId: null,
        actualPaymentDate: null,
        actualPaymentDates: [],
        confirmedBy: null,
        confirmedAt: null
    };
}

function classifyLegacyZrsAdjustment(row = {}) {
    const type = String(row.type || '').trim().toLowerCase();
    const status = String(row.status || 'applied').trim().toLowerCase();
    const reason = String(row.reason || '').trim();
    const voidReason = String(row.void_reason ?? row.voidReason ?? '').trim();
    const hasExplicitZrsReason = /зрс|zrs/iu.test(`${reason} ${voidReason}`);
    if (type !== 'advance' || status !== 'voided' || !hasExplicitZrsReason) return null;
    return {
        classification: LEGACY_ZRS_VOIDED_STATUS,
        historicalStatus: LEGACY_ZRS_VOIDED_STATUS,
        displayType: 'zrs',
        displayLabel: 'ЗРС',
        message: LEGACY_ZRS_VOIDED_MESSAGE,
        affectsPayroll: false,
        paymentFactVerified: false,
        canonicalPaymentMovement: false
    };
}

function buildPayrollSettlementReadModel(report = {}, installmentRows = []) {
    const reportId = Number(reportValue(report, 'report_id', 'reportId', report.id));
    const settlementModel = reportValue(
        report,
        'settlement_model',
        'settlementModel',
        PAYROLL_SETTLEMENT_MODELS.LEGACY
    );
    const warnings = [];
    const installments = (Array.isArray(installmentRows) ? installmentRows : [])
        .filter(row => row && (row.installment_id ?? row.id) !== null && (row.installment_id ?? row.id) !== undefined)
        .map(mapPayrollInstallment)
        .sort((left, right) => PAYROLL_INSTALLMENT_KINDS.indexOf(left.kind) - PAYROLL_INSTALLMENT_KINDS.indexOf(right.kind));

    if (settlementModel === PAYROLL_SETTLEMENT_MODELS.LEGACY) {
        const reportStatus = String(reportValue(report, 'report_status', 'reportStatus', report.status) || 'draft');
        const voidedAt = reportValue(report, 'voided_at', 'voidedAt');
        const isVoided = Boolean(voidedAt || reportStatus === 'voided');
        const isLegacyAccounted = reportStatus === 'paid' && !isVoided;
        const historicalStatus = isLegacyAccounted
            ? LEGACY_PAYROLL_ACCOUNTED_STATUS
            : (isVoided ? 'voided' : reportStatus);
        if (installments.length) {
            warnings.push({
                code: 'PAYROLL_LEGACY_REPORT_HAS_INSTALLMENTS',
                reportId,
                message: 'Legacy payroll report unexpectedly contains installment rows'
            });
        }
        return {
            mode: 'legacy',
            reportId,
            periodMonth: reportValue(report, 'period_month', 'periodMonth'),
            reportNetAmount: nullableMoney(reportValue(report, 'report_net_amount', 'reportNetAmount')),
            settlementModel,
            installments: [],
            totals: null,
            warnings,
            legacy: {
                historicalStatus,
                status: historicalStatus,
                message: isLegacyAccounted ? LEGACY_PAYROLL_ACCOUNTED_MESSAGE : null,
                reportStatus,
                voidedAt: isoDate(voidedAt),
                legacyAccounted: isLegacyAccounted,
                financeTransactionId: reportValue(report, 'finance_transaction_id', 'financeTransactionId'),
                reversalTransactionId: reportValue(report, 'reversal_transaction_id', 'reversalTransactionId'),
                committedAt: reportValue(report, 'committed_at', 'committedAt'),
                committedBy: reportValue(report, 'committed_by', 'committedBy'),
                paymentFactVerified: false,
                actualPaymentDate: null,
                actualPaymentDates: [],
                confirmedBy: null,
                confirmedAt: null
            }
        };
    }

    const presentKinds = new Set(installments.map(installment => installment.kind));
    const missingKinds = PAYROLL_INSTALLMENT_KINDS.filter(kind => !presentKinds.has(kind));
    const mode = missingKinds.length ? 'incomplete' : 'installments';
    if (missingKinds.length) {
        warnings.push({
            code: 'PAYROLL_INSTALLMENTS_INCOMPLETE',
            reportId,
            missingKinds,
            message: `Payroll report is missing installment kinds: ${missingKinds.join(', ')}`
        });
    }

    const totals = sumInstallmentTotals(installments);
    const reportNetAmount = nullableMoney(reportValue(report, 'report_net_amount', 'reportNetAmount'));
    const installmentDueDelta = reportNetAmount === null
        ? null
        : money(totals.effectiveDueAmount - reportNetAmount);
    if (reportNetAmount === null || Math.abs(installmentDueDelta) > 0.01) {
        warnings.push({
            code: 'PAYROLL_INSTALLMENT_TOTAL_MISMATCH',
            reportId,
            reportNetAmount,
            installmentDueAmount: totals.effectiveDueAmount,
            delta: installmentDueDelta,
            message: reportNetAmount === null
                ? 'Payroll report net amount is missing for installment reconciliation'
                : 'Payroll installment amounts do not equal the monthly payroll report net amount'
        });
    }

    return {
        mode,
        reportId,
        periodMonth: reportValue(report, 'period_month', 'periodMonth'),
        reportNetAmount,
        installmentDueDelta,
        settlementModel,
        installments,
        totals,
        warnings,
        legacy: null
    };
}

function summarizePayrollSettlementMonth(month, reports = []) {
    const normalizedMonth = normalizePayrollMonth(month);
    if (!reports.length) {
        return {
            month: normalizedMonth,
            mode: 'none',
            reports: [],
            totals: emptySettlementTotals(),
            totalsCoverage: 'empty',
            warnings: []
        };
    }

    const ownershipModels = new Set(reports.map(report => report.settlementModel));
    const hasMixedOwnership = ownershipModels.size > 1;
    const hasIncompleteInstallments = reports.some(report => report.mode === 'incomplete');
    let mode = 'legacy';
    if (hasMixedOwnership) {
        mode = 'mixed';
    } else if (ownershipModels.has(PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS)) {
        mode = hasIncompleteInstallments ? 'incomplete' : 'installments';
    }

    const warnings = reports.flatMap(report => report.warnings || []);
    if (hasMixedOwnership) {
        warnings.push({
            code: 'PAYROLL_SETTLEMENT_MONTH_MIXED',
            month: normalizedMonth,
            settlementModels: [...ownershipModels].sort(),
            message: 'Payroll month contains reports owned by different settlement models'
        });
    }

    let totals = null;
    let totalsCoverage = 'unavailable';
    if (!hasMixedOwnership && ownershipModels.has(PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS)) {
        totals = emptySettlementTotals();
        let allInstallmentsLocked = true;
        for (const report of reports) {
            totals.calculatedAmount = money(
                totals.calculatedAmount + report.totals.calculatedAmount
            );
            totals.effectiveDueAmount = money(
                totals.effectiveDueAmount + report.totals.effectiveDueAmount
            );
            totals.paidAmount = money(totals.paidAmount + report.totals.paidAmount);
            totals.balanceAmount = money(totals.balanceAmount + report.totals.balanceAmount);
            totals.outstandingAmount = money(
                totals.outstandingAmount + report.totals.outstandingAmount
            );
            totals.overpaidAmount = money(
                totals.overpaidAmount + report.totals.overpaidAmount
            );
            if (report.totals.lockedAmount === null) {
                allInstallmentsLocked = false;
            } else {
                totals.lockedAmount = money(
                    totals.lockedAmount + report.totals.lockedAmount
                );
            }
        }
        if (!allInstallmentsLocked) totals.lockedAmount = null;
        totalsCoverage = hasIncompleteInstallments ? 'incomplete' : 'complete';
    }

    const legacyReports = mode === 'legacy' ? reports : [];
    const allLegacyAccounted = legacyReports.length > 0
        && legacyReports.every(report => report.legacy?.legacyAccounted === true);
    const legacyClassification = mode === 'legacy' ? {
        historicalStatus: allLegacyAccounted ? LEGACY_PAYROLL_ACCOUNTED_STATUS : 'legacy_workflow',
        historicalStatusMessage: allLegacyAccounted ? LEGACY_PAYROLL_ACCOUNTED_MESSAGE : null,
        paymentFactVerified: false,
        legacyAccountedCount: legacyReports.filter(report => report.legacy?.legacyAccounted === true).length,
        legacyReportCount: legacyReports.length
    } : null;

    return {
        month: normalizedMonth,
        mode,
        reports,
        totals,
        totalsCoverage,
        legacyClassification,
        warnings
    };
}

async function loadPayrollSettlementReadModels(month, db = pool) {
    const normalizedMonth = normalizePayrollMonth(month);
    const result = await db.query(
        `WITH report_installments AS (
            SELECT pr.id AS report_id,
                   pr.period_month,
                   pr.status AS report_status,
                   pr.net_amount AS report_net_amount,
                   pr.settlement_model,
                   pr.finance_transaction_id,
                   pr.reversal_transaction_id,
                   pr.committed_at,
                   pr.committed_by,
                   pr.voided_at,
                   pi.id AS installment_id,
                   pi.kind,
                   pi.earning_from,
                   pi.earning_to,
                   pi.scheduled_payment_date,
                   pi.calculated_amount,
                   pi.locked_amount,
                   pi.calculation_snapshot,
                   pi.workflow_status,
                   pi.allocation_status,
                   pi.business_context,
                   pi.approved_by_user_id,
                   pi.approved_by_username,
                   pi.approved_by_role,
                   pi.approved_at
            FROM payroll_reports pr
            LEFT JOIN payroll_installments pi ON pi.payroll_report_id = pr.id
            WHERE pr.period_month = $1
        ),
        movement_totals AS (
            SELECT ppm.installment_id,
                   COALESCE(SUM(ppm.amount) FILTER (WHERE ppm.movement_type = 'payment'), 0)::numeric AS payment_total,
                   COALESCE(SUM(ppm.amount) FILTER (WHERE ppm.movement_type = 'reversal'), 0)::numeric AS reversal_total
            FROM payroll_payment_movements ppm
            JOIN report_installments ri ON ri.installment_id = ppm.installment_id
            GROUP BY ppm.installment_id
        ),
        movement_rows AS (
            SELECT ppm.installment_id,
                   jsonb_agg(jsonb_build_object(
                       'id', ppm.id,
                       'installmentId', ppm.installment_id,
                       'movementType', ppm.movement_type,
                       'amount', ppm.amount,
                       'actualPaymentDate', ppm.actual_payment_date,
                       'actorUserId', ppm.actor_user_id,
                       'actorUsername', ppm.actor_username,
                       'actorRole', ppm.actor_role,
                       'reason', ppm.reason,
                       'idempotencyKey', ppm.idempotency_key,
                       'financeTransactionId', ppm.finance_transaction_id,
                       'reversesMovementId', ppm.reverses_movement_id,
                       'createdAt', ppm.created_at
                   ) ORDER BY ppm.created_at, ppm.id) AS movements
            FROM payroll_payment_movements ppm
            JOIN report_installments ri ON ri.installment_id = ppm.installment_id
            GROUP BY ppm.installment_id
        )
        SELECT ri.*,
               COALESCE(mt.payment_total, 0)::numeric AS payment_total,
               COALESCE(mt.reversal_total, 0)::numeric AS reversal_total,
               COALESCE(mr.movements, '[]'::jsonb) AS movements
        FROM report_installments ri
        LEFT JOIN movement_totals mt ON mt.installment_id = ri.installment_id
        LEFT JOIN movement_rows mr ON mr.installment_id = ri.installment_id
        ORDER BY ri.report_id,
                 CASE ri.kind WHEN 'advance' THEN 1 WHEN 'final' THEN 2 ELSE 3 END,
                 ri.installment_id`,
        [normalizedMonth]
    );

    const grouped = new Map();
    for (const row of result.rows) {
        const reportId = Number(row.report_id);
        if (!grouped.has(reportId)) grouped.set(reportId, { report: row, installments: [] });
        if (row.installment_id !== null && row.installment_id !== undefined) {
            grouped.get(reportId).installments.push(row);
        }
    }

    const reports = [...grouped.values()].map(({ report, installments }) =>
        buildPayrollSettlementReadModel(report, installments)
    );
    return summarizePayrollSettlementMonth(normalizedMonth, reports);
}

async function loadStaffOutstandingPayrollInstallments(staffId, db = pool) {
    const id = Number(staffId);
    if (!Number.isInteger(id) || id <= 0) {
        return { count: 0, amount: 0, missing_table: false };
    }
    const tables = await db.query(
        `SELECT
            to_regclass('public.payroll_reports') AS reports_rel,
            to_regclass('public.payroll_installments') AS installments_rel,
            to_regclass('public.payroll_payment_movements') AS movements_rel`
    );
    const hasSchema = Boolean(
        tables.rows[0]?.reports_rel
        && tables.rows[0]?.installments_rel
        && tables.rows[0]?.movements_rel
    );
    if (!hasSchema) return { count: 0, amount: 0, missing_table: true };

    const result = await db.query(
        `WITH staff_installments AS (
            SELECT pi.id,
                   pi.kind,
                   pi.workflow_status,
                   GREATEST(COALESCE(pi.locked_amount, 0), 0)::numeric AS due_amount
            FROM payroll_installments pi
            JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
            WHERE pr.staff_id = $1
              AND pr.voided_at IS NULL
              AND pr.settlement_model = $2
              AND pi.workflow_status = 'approved'
        ),
        movement_totals AS (
            SELECT ppm.installment_id,
                   COALESCE(SUM(ppm.amount) FILTER (WHERE ppm.movement_type = 'payment'), 0)::numeric AS payments,
                   COALESCE(SUM(ppm.amount) FILTER (WHERE ppm.movement_type = 'reversal'), 0)::numeric AS reversals
            FROM payroll_payment_movements ppm
            JOIN staff_installments si ON si.id = ppm.installment_id
            GROUP BY ppm.installment_id
        ),
        balances AS (
            SELECT si.id,
                   si.kind,
                   si.workflow_status,
                   GREATEST(si.due_amount - GREATEST(COALESCE(mt.payments, 0) - COALESCE(mt.reversals, 0), 0), 0)::numeric AS outstanding_amount
            FROM staff_installments si
            LEFT JOIN movement_totals mt ON mt.installment_id = si.id
        )
        SELECT COUNT(*) FILTER (WHERE outstanding_amount > 0)::int AS outstanding_count,
               COALESCE(SUM(outstanding_amount) FILTER (WHERE outstanding_amount > 0), 0)::numeric AS outstanding_amount
        FROM balances`,
        [id, PAYROLL_SETTLEMENT_MODELS.INSTALLMENTS]
    );
    return {
        count: Number(result.rows[0]?.outstanding_count || 0),
        amount: Number(result.rows[0]?.outstanding_amount || 0),
        missing_table: false
    };
}

module.exports = {
    LEGACY_MANUAL_SALARY_FINANCE_MESSAGE,
    LEGACY_MANUAL_SALARY_FINANCE_STATUS,
    LEGACY_PAYROLL_ACCOUNTED_MESSAGE,
    LEGACY_PAYROLL_ACCOUNTED_STATUS,
    LEGACY_ZRS_VOIDED_MESSAGE,
    LEGACY_ZRS_VOIDED_STATUS,
    PAYROLL_HISTORICAL_CLASSIFICATION_MESSAGES,
    PAYROLL_INSTALLMENTS_ACTIVATION_ENV,
    PAYROLL_INSTALLMENT_KINDS,
    PAYROLL_SETTLEMENT_MODELS,
    buildPayrollSettlementReadModel,
    classifyLegacyManualSalaryFinance,
    classifyLegacyZrsAdjustment,
    configuredPayrollInstallmentsActivationMonth,
    derivePayrollInstallmentAmounts,
    isPayrollInstallmentsActivationMonth,
    loadPayrollSettlementReadModels,
    loadStaffOutstandingPayrollInstallments,
    mapPayrollInstallment,
    mapPayrollPaymentMovement,
    normalizePayrollMonth,
    summarizePayrollSettlementMonth
};
