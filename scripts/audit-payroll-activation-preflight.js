#!/usr/bin/env node
'use strict';

/**
 * Read-only payroll activation preflight.
 *
 * This script intentionally has no write/apply mode. It classifies historical
 * paid payroll reports as legacy_accounted evidence, not as user-confirmed
 * payment facts.
 */

const { Pool } = require('pg');

const BLOCKED_FLAGS = new Set(['--apply', '--fix', '--write', '--execute', '--update', '--backfill', '--delete']);
const READ_ONLY_CONNECTION_ENV_KEYS = ['PAYROLL_AUDIT_DATABASE_URL', 'PRODUCTION_READONLY_DATABASE_URL'];
const LEGACY_MANUAL_SALARY_FINANCE_STATUS = 'legacy_manual_salary_finance';
const LEGACY_ZRS_VOIDED_STATUS = 'legacy_zrs_voided';

function usage() {
    return [
        'Usage:',
        '  node scripts/audit-payroll-activation-preflight.js [--month YYYY-MM] [--from YYYY-MM] [--to YYYY-MM] [--format json|markdown]',
        '',
        'Connection:',
        '  PAYROLL_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL.',
        '',
        'Safety:',
        '  Read-only only. Historical paid reports are reported as legacy_accounted, never as verified payment facts.'
    ].join('\n');
}

function normalizeMonth(value, name = 'month') {
    const month = String(value || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error(`${name} must be YYYY-MM`);
    }
    return month;
}

function parseArgs(argv) {
    const options = { month: '', from: '', to: '', format: 'json' };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (BLOCKED_FLAGS.has(arg)) {
            throw new Error(`${arg} is not supported: this preflight is read-only only`);
        }
        const readValue = name => {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
            index += 1;
            return value;
        };
        if (arg === '--month') options.month = normalizeMonth(readValue(arg), arg);
        else if (arg === '--from') options.from = normalizeMonth(readValue(arg), arg);
        else if (arg === '--to') options.to = normalizeMonth(readValue(arg), arg);
        else if (arg === '--format') options.format = readValue(arg);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be json or markdown');
    if (options.month) {
        options.from = options.month;
        options.to = options.month;
    }
    if (options.from && options.to && options.from > options.to) throw new Error('--from cannot be after --to');
    return options;
}

function resolveReadOnlyConnectionString(env = process.env) {
    for (const key of READ_ONLY_CONNECTION_ENV_KEYS) {
        const value = String(env[key] || '').trim();
        if (value) return { key, connectionString: value };
    }
    const err = new Error('Set PAYROLL_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL for payroll activation preflight');
    err.code = 'PAYROLL_PREFLIGHT_READ_ONLY_DATABASE_REQUIRED';
    throw err;
}

function poolConfig(env = process.env) {
    const { connectionString } = resolveReadOnlyConnectionString(env);
    return {
        connectionString,
        ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    };
}

async function tableExists(client, tableName) {
    const result = await client.query('SELECT to_regclass($1) AS rel', [`public.${tableName}`]);
    return Boolean(result.rows[0]?.rel);
}

async function columnExists(client, tableName, columnName) {
    const result = await client.query(
        `SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2
         ) AS present`,
        [tableName, columnName]
    );
    return result.rows[0]?.present === true;
}

function monthWhere(alias, options, values) {
    const clauses = [];
    if (options.from) {
        values.push(options.from);
        clauses.push(`${alias}.period_month >= $${values.length}`);
    }
    if (options.to) {
        values.push(options.to);
        clauses.push(`${alias}.period_month <= $${values.length}`);
    }
    return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

async function loadLegacyPayrollReportAudit(client, options) {
    const hasSettlementModel = await columnExists(client, 'payroll_reports', 'settlement_model');
    const settlementModelExpression = hasSettlementModel
        ? "COALESCE(pr.settlement_model, 'legacy_v1')"
        : "'legacy_v1'::text";
    const values = [];
    const where = monthWhere('pr', options, values);
    const result = await client.query(
        `WITH paid_reports AS (
            SELECT pr.id, pr.period_month, pr.staff_id, pr.net_amount, pr.finance_transaction_id,
                   ${settlementModelExpression} AS settlement_model
            FROM payroll_reports pr
            ${where}
            ${where ? 'AND' : 'WHERE'} pr.status = 'paid'
              AND pr.voided_at IS NULL
        ),
        duplicate_links AS (
            SELECT finance_transaction_id, COUNT(*)::int AS reports
            FROM paid_reports
            WHERE finance_transaction_id IS NOT NULL
            GROUP BY finance_transaction_id
            HAVING COUNT(*) > 1
        )
        SELECT
            COUNT(*)::int AS paid_reports,
            COUNT(*) FILTER (WHERE settlement_model = 'legacy_v1')::int AS legacy_accounted_reports,
            COUNT(*) FILTER (WHERE finance_transaction_id IS NULL)::int AS paid_without_finance,
            COUNT(*) FILTER (WHERE finance_transaction_id IS NOT NULL AND ft.id IS NULL)::int AS paid_with_missing_finance,
            COUNT(*) FILTER (WHERE ft.id IS NOT NULL AND ABS(COALESCE(net_amount, 0) - COALESCE(ft.amount, 0)) > 0.01)::int AS amount_mismatch,
            COALESCE((SELECT COUNT(*) FROM duplicate_links), 0)::int AS duplicate_finance_links,
            COALESCE(SUM(net_amount), 0)::numeric AS paid_report_amount,
            COALESCE(SUM(ft.amount) FILTER (WHERE ft.id IS NOT NULL), 0)::numeric AS linked_finance_amount
        FROM paid_reports pr
        LEFT JOIN finance_transactions ft ON ft.id = pr.finance_transaction_id`,
        values
    );
    const row = result.rows[0] || {};
    return {
        paidReports: Number(row.paid_reports || 0),
        legacyAccountedReports: Number(row.legacy_accounted_reports || 0),
        paidWithoutFinance: Number(row.paid_without_finance || 0),
        paidWithMissingFinance: Number(row.paid_with_missing_finance || 0),
        amountMismatch: Number(row.amount_mismatch || 0),
        duplicateFinanceLinks: Number(row.duplicate_finance_links || 0),
        paidReportAmount: Number(row.paid_report_amount || 0),
        linkedFinanceAmount: Number(row.linked_finance_amount || 0),
        amountVariance: Number(row.paid_report_amount || 0) - Number(row.linked_finance_amount || 0),
        historicalClassification: 'legacy_accounted',
        paymentFactVerified: false
    };
}

async function loadFinanceOrphanAudit(client, options) {
    const hasMovements = await tableExists(client, 'payroll_payment_movements');
    const hasSource = await columnExists(client, 'finance_transactions', 'source');
    const hasRecognitionDate = await columnExists(client, 'finance_transactions', 'recognition_date');
    const values = [];
    const monthExpression = `TO_CHAR(${hasRecognitionDate ? 'COALESCE(ft.recognition_date, ft.date::date)' : 'ft.date::date'}, 'YYYY-MM')`;
    const monthClauses = [];
    if (options.from) {
        values.push(options.from);
        monthClauses.push(`${monthExpression} >= $${values.length}`);
    }
    if (options.to) {
        values.push(options.to);
        monthClauses.push(`${monthExpression} <= $${values.length}`);
    }
    const scopeWhere = monthClauses.length ? `AND ${monthClauses.join(' AND ')}` : '';
    const sourceExpression = hasSource ? `COALESCE(ft.source, '')` : `''`;
    const payrollSourcePredicate = hasSource ? `OR ft.source = 'payroll'` : '';
    const movementJoin = hasMovements
        ? 'LEFT JOIN payroll_payment_movements ppm ON ppm.finance_transaction_id = sf.id'
        : '';
    const orphanPredicate = hasMovements ? 'pr.id IS NULL AND ppm.id IS NULL' : 'pr.id IS NULL';
    const result = await client.query(
        `WITH salary_finance AS (
            SELECT ft.id, ft.amount, ft.payment_method,
                   ${sourceExpression} AS source,
                   ft.date::date AS tx_date,
                   ${monthExpression} AS recognition_month
            FROM finance_transactions ft
            WHERE (ft.payment_method IN ('salary', 'salary_reversal') ${payrollSourcePredicate})
              ${scopeWhere}
         )
         SELECT
            COUNT(*) FILTER (WHERE sf.payment_method = 'salary_reversal')::int AS legacy_reversals,
            COUNT(*) FILTER (WHERE sf.payment_method = 'salary')::int AS legacy_salary_finance,
            COUNT(*) FILTER (WHERE COALESCE(sf.source, '') <> 'payroll')::int AS finance_without_payroll_source,
            COUNT(*) FILTER (WHERE ${orphanPredicate} AND COALESCE(sf.source, '') = 'payroll')::int AS orphan_finance,
            COUNT(*) FILTER (WHERE ${orphanPredicate} AND COALESCE(sf.source, '') <> 'payroll')::int AS legacy_unlinked_finance,
            COUNT(*) FILTER (WHERE ${orphanPredicate} AND COALESCE(sf.source, '') <> 'payroll' AND sf.payment_method = 'salary')::int AS legacy_manual_salary_finance
          FROM salary_finance sf
          LEFT JOIN payroll_reports pr ON pr.finance_transaction_id = sf.id OR pr.reversal_transaction_id = sf.id
          ${movementJoin}`,
        values
    );
    const row = result.rows[0] || {};
    return {
        legacySalaryFinance: Number(row.legacy_salary_finance || 0),
        legacyReversals: Number(row.legacy_reversals || 0),
        financeWithoutPayrollSource: Number(row.finance_without_payroll_source || 0),
        orphanFinance: Number(row.orphan_finance || 0),
        legacyUnlinkedFinance: Number(row.legacy_unlinked_finance || 0),
        legacyManualSalaryFinance: Number(row.legacy_manual_salary_finance || 0),
        legacyManualSalaryFinanceClassification: LEGACY_MANUAL_SALARY_FINANCE_STATUS
    };
}

async function loadLegacyAdvanceAudit(client, options) {
    const hasVoidReason = await columnExists(client, 'salary_adjustments', 'void_reason');
    const zrsReasonExpression = hasVoidReason
        ? "(COALESCE(reason, '') || ' ' || COALESCE(void_reason, ''))"
        : "COALESCE(reason, '')";
    const values = [];
    const adjustmentClauses = [];
    const entryClauses = [];
    if (options.from) {
        values.push(options.from);
        adjustmentClauses.push(`month >= $${values.length}`);
        entryClauses.push(`period_month >= $${values.length}`);
    }
    if (options.to) {
        values.push(options.to);
        adjustmentClauses.push(`month <= $${values.length}`);
        entryClauses.push(`period_month <= $${values.length}`);
    }
    const adjustmentWhere = adjustmentClauses.length ? `AND ${adjustmentClauses.join(' AND ')}` : '';
    const entryWhere = entryClauses.length ? `AND ${entryClauses.join(' AND ')}` : '';
    const result = await client.query(
        `SELECT
            (SELECT COUNT(*)::int FROM salary_adjustments WHERE type = 'advance' ${adjustmentWhere}) AS salary_adjustment_legacy_advance,
            (SELECT COUNT(*)::int FROM salary_adjustments WHERE type = 'advance' AND ${zrsReasonExpression} ~* '(зрс|zrs)' ${adjustmentWhere}) AS salary_adjustment_legacy_zrs_classified,
            (SELECT COUNT(*)::int FROM salary_adjustments WHERE type = 'advance' AND ${zrsReasonExpression} !~* '(зрс|zrs)' ${adjustmentWhere}) AS salary_adjustment_legacy_advance_unclassified,
            (SELECT COUNT(*)::int FROM salary_adjustments WHERE type = 'advance' AND COALESCE(status, 'applied') = 'voided' AND ${zrsReasonExpression} ~* '(зрс|zrs)' ${adjustmentWhere}) AS salary_adjustment_legacy_zrs_voided,
            (SELECT COUNT(*)::int FROM salary_adjustments WHERE type = 'zrs' ${adjustmentWhere}) AS salary_adjustment_zrs,
            (SELECT COUNT(*)::int FROM payroll_entries WHERE line_type = 'advance' ${entryWhere}) AS payroll_entry_legacy_advance,
            (SELECT COUNT(*)::int FROM payroll_entries WHERE line_type = 'zrs' ${entryWhere}) AS payroll_entry_zrs`,
        values
    );
    const row = result.rows[0] || {};
    return {
        salaryAdjustmentLegacyAdvance: Number(row.salary_adjustment_legacy_advance || 0),
        salaryAdjustmentLegacyZrsClassified: Number(row.salary_adjustment_legacy_zrs_classified || 0),
        salaryAdjustmentLegacyAdvanceUnclassified: Number(row.salary_adjustment_legacy_advance_unclassified || 0),
        salaryAdjustmentLegacyZrsVoided: Number(row.salary_adjustment_legacy_zrs_voided || 0),
        salaryAdjustmentLegacyZrsVoidedClassification: LEGACY_ZRS_VOIDED_STATUS,
        salaryAdjustmentZrs: Number(row.salary_adjustment_zrs || 0),
        payrollEntryLegacyAdvance: Number(row.payroll_entry_legacy_advance || 0),
        payrollEntryZrs: Number(row.payroll_entry_zrs || 0)
    };
}

async function loadInstallmentAudit(client, options) {
    const hasInstallments = await tableExists(client, 'payroll_installments');
    const hasMovements = await tableExists(client, 'payroll_payment_movements');
    if (!hasInstallments || !hasMovements) {
        return {
            schemaPresent: false,
            outstandingInstallments: 0,
            outstandingAmount: 0,
            overpaymentInstallments: 0,
            overpaymentAmount: 0,
            duplicateFinanceLinks: 0,
            missingFinanceLinks: 0,
            amountMismatch: 0,
            reversalMismatch: 0,
            financeWithoutPayrollSource: 0,
            financeTypeMismatch: 0,
            paymentDateMismatch: 0,
            ownershipMismatch: 0,
            recognitionMonthMismatch: 0
        };
    }
    const values = [];
    const where = monthWhere('pr', options, values);
    const result = await client.query(
        `WITH installments AS (
            SELECT pi.id,
                   pr.staff_id,
                   pr.period_month,
                   pi.business_context,
                   pi.earning_to,
                   GREATEST(COALESCE(pi.locked_amount, 0), 0)::numeric AS due_amount
            FROM payroll_installments pi
            JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
            ${where}
            ${where ? 'AND' : 'WHERE'} pr.settlement_model = 'installments_v1'
              AND pr.voided_at IS NULL
              AND pi.workflow_status = 'approved'
        ),
        movements AS (
            SELECT ppm.*
            FROM payroll_payment_movements ppm
            JOIN installments i ON i.id = ppm.installment_id
        ),
        movement_totals AS (
            SELECT installment_id,
                   COALESCE(SUM(amount) FILTER (WHERE movement_type = 'payment'), 0)::numeric AS payments,
                   COALESCE(SUM(amount) FILTER (WHERE movement_type = 'reversal'), 0)::numeric AS reversals
            FROM movements
            GROUP BY installment_id
        ),
        balances AS (
            SELECT i.id,
                   GREATEST(i.due_amount - GREATEST(COALESCE(mt.payments, 0) - COALESCE(mt.reversals, 0), 0), 0)::numeric AS outstanding_amount,
                   GREATEST(GREATEST(COALESCE(mt.payments, 0) - COALESCE(mt.reversals, 0), 0) - i.due_amount, 0)::numeric AS overpayment_amount
            FROM installments i
            LEFT JOIN movement_totals mt ON mt.installment_id = i.id
        ),
        finance_links AS (
            SELECT m.*,
                   ft.id AS linked_finance_id,
                   ft.amount AS finance_amount,
                   ft.type AS finance_type,
                   ft.source AS finance_source,
                   ft.staff_id AS finance_staff_id,
                   ft.business_context AS finance_business_context,
                   ft.date::date AS finance_date,
                   ft.recognition_date::date AS finance_recognition_date,
                   i.staff_id AS expected_staff_id,
                   i.period_month AS expected_period_month,
                   i.business_context AS expected_business_context,
                   i.earning_to AS expected_recognition_date
            FROM movements m
            JOIN installments i ON i.id = m.installment_id
            LEFT JOIN finance_transactions ft ON ft.id = m.finance_transaction_id
        ),
        duplicate_links AS (
            SELECT finance_transaction_id
            FROM movements
            WHERE finance_transaction_id IS NOT NULL
            GROUP BY finance_transaction_id
            HAVING COUNT(*) > 1
        )
        SELECT
            COUNT(*) FILTER (WHERE b.outstanding_amount > 0)::int AS outstanding_installments,
            COALESCE(SUM(b.outstanding_amount) FILTER (WHERE b.outstanding_amount > 0), 0)::numeric AS outstanding_amount,
            COUNT(*) FILTER (WHERE b.overpayment_amount > 0)::int AS overpayment_installments,
            COALESCE(SUM(b.overpayment_amount) FILTER (WHERE b.overpayment_amount > 0), 0)::numeric AS overpayment_amount,
            COALESCE((SELECT COUNT(*) FROM duplicate_links), 0)::int AS duplicate_finance_links,
            COALESCE((SELECT COUNT(*) FROM finance_links WHERE linked_finance_id IS NULL), 0)::int AS missing_finance_links,
            COALESCE((SELECT COUNT(*) FROM finance_links WHERE linked_finance_id IS NOT NULL AND ABS(COALESCE(amount, 0) - COALESCE(finance_amount, 0)) > 0.01), 0)::int AS amount_mismatch,
            COALESCE((SELECT COUNT(*)
                      FROM finance_links r
                      LEFT JOIN movements target ON target.id = r.reverses_movement_id AND target.movement_type = 'payment'
                      WHERE r.movement_type = 'reversal'
                        AND (
                          r.reverses_movement_id IS NULL
                          OR target.id IS NULL
                          OR target.installment_id <> r.installment_id
                          OR r.linked_finance_id IS NULL
                          OR r.finance_type <> 'income'
                          OR COALESCE(r.finance_source, '') <> 'payroll'
                        )), 0)::int AS reversal_mismatch,
            COALESCE((SELECT COUNT(*) FROM finance_links WHERE linked_finance_id IS NOT NULL AND COALESCE(finance_source, '') <> 'payroll'), 0)::int AS finance_without_payroll_source,
            COALESCE((SELECT COUNT(*) FROM finance_links
                      WHERE linked_finance_id IS NOT NULL
                        AND finance_type <> CASE WHEN movement_type = 'payment' THEN 'expense' ELSE 'income' END), 0)::int AS finance_type_mismatch,
            COALESCE((SELECT COUNT(*) FROM finance_links
                      WHERE linked_finance_id IS NOT NULL
                        AND finance_date IS DISTINCT FROM actual_payment_date), 0)::int AS payment_date_mismatch,
            COALESCE((SELECT COUNT(*) FROM finance_links
                      WHERE linked_finance_id IS NOT NULL
                        AND (
                            finance_staff_id IS DISTINCT FROM expected_staff_id
                            OR COALESCE(NULLIF(BTRIM(finance_business_context), ''), '')
                               IS DISTINCT FROM COALESCE(NULLIF(BTRIM(expected_business_context), ''), '')
                        )), 0)::int AS ownership_mismatch,
            COALESCE((SELECT COUNT(*) FROM finance_links
                      WHERE linked_finance_id IS NOT NULL
                        AND TO_CHAR(finance_recognition_date, 'YYYY-MM')
                            IS DISTINCT FROM expected_period_month), 0)::int AS recognition_month_mismatch
        FROM balances b`,
        values
    );
    const row = result.rows[0] || {};
    return {
        schemaPresent: true,
        outstandingInstallments: Number(row.outstanding_installments || 0),
        outstandingAmount: Number(row.outstanding_amount || 0),
        overpaymentInstallments: Number(row.overpayment_installments || 0),
        overpaymentAmount: Number(row.overpayment_amount || 0),
        duplicateFinanceLinks: Number(row.duplicate_finance_links || 0),
        missingFinanceLinks: Number(row.missing_finance_links || 0),
        amountMismatch: Number(row.amount_mismatch || 0),
        reversalMismatch: Number(row.reversal_mismatch || 0),
        financeWithoutPayrollSource: Number(row.finance_without_payroll_source || 0),
        financeTypeMismatch: Number(row.finance_type_mismatch || 0),
        paymentDateMismatch: Number(row.payment_date_mismatch || 0),
        ownershipMismatch: Number(row.ownership_mismatch || 0),
        recognitionMonthMismatch: Number(row.recognition_month_mismatch || 0)
    };
}

async function loadSettlementModelAudit(client, options) {
    const hasInstallments = await tableExists(client, 'payroll_installments');
    const hasSettlementModel = await columnExists(client, 'payroll_reports', 'settlement_model');
    if (!hasInstallments || !hasSettlementModel) {
        return { schemaPresent: false, mixedSettlementMonths: 0, mixedOwnershipReports: 0 };
    }
    const values = [];
    const where = monthWhere('pr', options, values);
    const result = await client.query(
        `WITH scoped_reports AS (
            SELECT pr.id,
                   pr.period_month,
                   COALESCE(pr.settlement_model, 'legacy_v1') AS settlement_model,
                   EXISTS (
                       SELECT 1 FROM payroll_installments pi WHERE pi.payroll_report_id = pr.id
                   ) AS has_installments
            FROM payroll_reports pr
            ${where}
            ${where ? 'AND' : 'WHERE'} pr.voided_at IS NULL
         ),
         mixed_months AS (
            SELECT period_month
            FROM scoped_reports
            GROUP BY period_month
            HAVING COUNT(DISTINCT settlement_model) > 1
         )
         SELECT
            COALESCE((SELECT COUNT(*) FROM mixed_months), 0)::int AS mixed_settlement_months,
            COUNT(*) FILTER (
                WHERE (settlement_model = 'installments_v1' AND NOT has_installments)
                   OR (settlement_model = 'legacy_v1' AND has_installments)
            )::int AS mixed_ownership_reports
         FROM scoped_reports`,
        values
    );
    return {
        schemaPresent: true,
        mixedSettlementMonths: Number(result.rows[0]?.mixed_settlement_months || 0),
        mixedOwnershipReports: Number(result.rows[0]?.mixed_ownership_reports || 0)
    };
}

function payrollActivationBlockers(report = {}) {
    const blockers = [];
    const add = (condition, code, count) => {
        if (condition) blockers.push({ code, count: Number(count || 0) });
    };
    add(
        Number(
            report.legacyAdvance?.salaryAdjustmentLegacyAdvanceUnclassified
            ?? report.legacyAdvance?.salaryAdjustmentLegacyAdvance
            ?? 0
        ) > 0,
        'LEGACY_ADVANCE_ADJUSTMENTS_UNCLASSIFIED',
        report.legacyAdvance?.salaryAdjustmentLegacyAdvanceUnclassified
            ?? report.legacyAdvance?.salaryAdjustmentLegacyAdvance
    );
    add(
        report.legacyAdvance?.payrollEntryLegacyAdvance > 0,
        'LEGACY_ADVANCE_PAYROLL_ENTRIES_UNCLASSIFIED',
        report.legacyAdvance?.payrollEntryLegacyAdvance
    );
    add(report.financeOrphans?.orphanFinance > 0, 'UNSAFE_PAYROLL_FINANCE_ORPHAN', report.financeOrphans?.orphanFinance);
    add(report.legacyReports?.paidWithMissingFinance > 0, 'LEGACY_FINANCE_LINK_MISSING', report.legacyReports?.paidWithMissingFinance);
    add(report.legacyReports?.duplicateFinanceLinks > 0, 'DUPLICATE_LEGACY_FINANCE_LINK', report.legacyReports?.duplicateFinanceLinks);
    add(report.legacyReports?.amountMismatch > 0, 'LEGACY_AMOUNT_MISMATCH', report.legacyReports?.amountMismatch);
    add(report.installments?.duplicateFinanceLinks > 0, 'DUPLICATE_INSTALLMENT_FINANCE_LINK', report.installments?.duplicateFinanceLinks);
    add(report.installments?.missingFinanceLinks > 0, 'INSTALLMENT_FINANCE_LINK_MISSING', report.installments?.missingFinanceLinks);
    add(report.installments?.amountMismatch > 0, 'INSTALLMENT_AMOUNT_MISMATCH', report.installments?.amountMismatch);
    add(report.installments?.reversalMismatch > 0, 'INSTALLMENT_REVERSAL_MISMATCH', report.installments?.reversalMismatch);
    add(report.installments?.financeWithoutPayrollSource > 0, 'INSTALLMENT_FINANCE_SOURCE_MISMATCH', report.installments?.financeWithoutPayrollSource);
    add(report.installments?.financeTypeMismatch > 0, 'INSTALLMENT_FINANCE_TYPE_MISMATCH', report.installments?.financeTypeMismatch);
    add(report.installments?.paymentDateMismatch > 0, 'INSTALLMENT_PAYMENT_DATE_MISMATCH', report.installments?.paymentDateMismatch);
    add(report.installments?.ownershipMismatch > 0, 'INSTALLMENT_FINANCE_OWNERSHIP_MISMATCH', report.installments?.ownershipMismatch);
    add(report.installments?.recognitionMonthMismatch > 0, 'INSTALLMENT_RECOGNITION_MONTH_MISMATCH', report.installments?.recognitionMonthMismatch);
    add(report.installments?.overpaymentInstallments > 0, 'UNRESOLVED_INSTALLMENT_OVERPAYMENT', report.installments?.overpaymentInstallments);
    add(report.settlementModels?.mixedSettlementMonths > 0, 'MIXED_SETTLEMENT_MONTHS', report.settlementModels?.mixedSettlementMonths);
    add(report.settlementModels?.mixedOwnershipReports > 0, 'MIXED_SETTLEMENT_OWNERSHIP', report.settlementModels?.mixedOwnershipReports);
    return blockers;
}

async function runPreflight(options) {
    const pool = new Pool(poolConfig());
    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = '30s'`);
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = '30s'`);
        const readonly = await client.query('SHOW transaction_read_only');
        if (readonly.rows[0]?.transaction_read_only !== 'on') {
            throw new Error('PostgreSQL transaction is not read-only; aborting');
        }
        // A pg Client supports one in-flight query at a time. Keep these reads
        // sequential so the audit remains compatible with pg 9 and preserves
        // one explicit read-only transaction snapshot.
        const legacyReports = await loadLegacyPayrollReportAudit(client, options);
        const financeOrphans = await loadFinanceOrphanAudit(client, options);
        const legacyAdvance = await loadLegacyAdvanceAudit(client, options);
        const installments = await loadInstallmentAudit(client, options);
        const settlementModels = await loadSettlementModelAudit(client, options);
        await client.query('COMMIT');
        const report = {
            generatedAt: new Date().toISOString(),
            scope: { month: options.month || null, from: options.from || null, to: options.to || null },
            legacyReports,
            financeOrphans,
            legacyAdvance,
            installments,
            settlementModels
        };
        const blockers = payrollActivationBlockers(report);
        report.activationDecision = {
            releaseAllowed: blockers.length === 0,
            releaseBlocked: blockers.length > 0,
            blockers,
            safeToAutoBackfill: false,
            historicalPaidMeaning: 'legacy_accounted',
            paymentFactVerified: false
        };
        return report;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
        await pool.end().catch(() => {});
    }
}

function renderMarkdown(report) {
    const settlementModels = report.settlementModels || {};
    const blockers = report.activationDecision?.blockers || payrollActivationBlockers(report);
    const activationDecision = report.activationDecision || {
        releaseAllowed: blockers.length === 0,
        releaseBlocked: blockers.length > 0,
        blockers
    };
    return [
        '# Payroll activation preflight',
        '',
        `Generated: ${report.generatedAt}`,
        `Scope: ${report.scope.month || `${report.scope.from || 'all'}..${report.scope.to || 'all'}`}`,
        '',
        `- Legacy paid reports: ${report.legacyReports.paidReports}`,
        `- Legacy accounted reports: ${report.legacyReports.legacyAccountedReports}`,
        `- Paid without finance link: ${report.legacyReports.paidWithoutFinance}`,
        `- Legacy amount mismatches: ${report.legacyReports.amountMismatch || 0}`,
        `- Orphan payroll finance transactions: ${report.financeOrphans.orphanFinance}`,
        `- Legacy manual salary Finance rows (${LEGACY_MANUAL_SALARY_FINANCE_STATUS}): ${report.financeOrphans.legacyManualSalaryFinance || 0}`,
        `- Historical unlinked non-payroll finance rows: ${report.financeOrphans.legacyUnlinkedFinance || 0}`,
        `- Finance rows without payroll source: ${report.financeOrphans.financeWithoutPayrollSource || 0}`,
        `- Legacy advance rows: raw=${report.legacyAdvance.salaryAdjustmentLegacyAdvance}, classified_zrs=${report.legacyAdvance.salaryAdjustmentLegacyZrsClassified || 0}, voided_zrs=${report.legacyAdvance.salaryAdjustmentLegacyZrsVoided || 0} (${LEGACY_ZRS_VOIDED_STATUS}), unclassified=${report.legacyAdvance.salaryAdjustmentLegacyAdvanceUnclassified || 0}, canonical_zrs=${report.legacyAdvance.salaryAdjustmentZrs}`,
        `- Outstanding installments: ${report.installments.outstandingInstallments} (${report.installments.outstandingAmount})`,
        `- Overpaid installments: ${report.installments.overpaymentInstallments || 0} (${report.installments.overpaymentAmount || 0})`,
        `- Installment finance link mismatches: duplicates=${report.installments.duplicateFinanceLinks || 0}, missing=${report.installments.missingFinanceLinks || 0}, amount=${report.installments.amountMismatch || 0}, reversal=${report.installments.reversalMismatch || 0}, source=${report.installments.financeWithoutPayrollSource || 0}`,
        `- Installment finance fact mismatches: type=${report.installments.financeTypeMismatch || 0}, payment_date=${report.installments.paymentDateMismatch || 0}, ownership=${report.installments.ownershipMismatch || 0}, recognition_month=${report.installments.recognitionMonthMismatch || 0}`,
        `- Mixed settlement months/ownership: ${settlementModels.mixedSettlementMonths || 0}/${settlementModels.mixedOwnershipReports || 0}`,
        `- Release decision: ${activationDecision.releaseAllowed ? 'allowed' : 'blocked'}`,
        `- Blockers: ${activationDecision.blockers.map(item => `${item.code}:${item.count}`).join(', ') || 'none'}`,
        '',
        'Historical paid reports are legacy_accounted only; no payment confirmer/date is inferred.'
    ].join('\n');
}

async function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) {
            console.log(usage());
            return;
        }
        const report = await runPreflight(options);
        console.log(options.format === 'markdown' ? renderMarkdown(report) : JSON.stringify(report, null, 2));
        if (report.activationDecision.releaseBlocked) process.exitCode = 2;
    } catch (err) {
        console.error(err.message);
        console.error(usage());
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    BLOCKED_FLAGS,
    LEGACY_MANUAL_SALARY_FINANCE_STATUS,
    LEGACY_ZRS_VOIDED_STATUS,
    READ_ONLY_CONNECTION_ENV_KEYS,
    loadLegacyAdvanceAudit,
    parseArgs,
    payrollActivationBlockers,
    poolConfig,
    renderMarkdown,
    resolveReadOnlyConnectionString,
    runPreflight
};
