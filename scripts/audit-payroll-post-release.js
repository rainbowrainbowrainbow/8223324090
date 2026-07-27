#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');

const READ_ONLY_CONNECTION_ENV_KEYS = Object.freeze([
    'PAYROLL_AUDIT_DATABASE_URL',
    'PRODUCTION_READONLY_DATABASE_URL'
]);

const FORBIDDEN_FLAGS = Object.freeze([
    '--apply',
    '--fix',
    '--write',
    '--backfill',
    '--execute',
    '--update',
    '--delete'
]);

const HOLD_COUNTERS = Object.freeze([
    'duplicatePaymentMovements',
    'duplicateFinanceLinks',
    'movementWithoutFinance',
    'financePayrollTransactionWithoutMovement',
    'paymentReversalAmountMismatch',
    'reversalWithoutOriginalPayment',
    'unresolvedOverpayment',
    'mixedSettlementModels',
    'legacyWriteInActivationMonth',
    'recognitionMonthMismatch',
    'cashFlowActualDateMismatch'
]);

const WARNING_COUNTERS = Object.freeze([
    'outstandingAfterDueDate'
]);

const COUNTER_KEYS = Object.freeze([
    'duplicatePaymentMovements',
    'duplicateFinanceLinks',
    'movementWithoutFinance',
    'financePayrollTransactionWithoutMovement',
    'paymentReversalAmountMismatch',
    'reversalWithoutOriginalPayment',
    'unresolvedOverpayment',
    'outstandingAfterDueDate',
    'mixedSettlementModels',
    'legacyWriteInActivationMonth',
    'recognitionMonthMismatch',
    'cashFlowActualDateMismatch',
    'legacyAccountedReports'
]);

function controlledError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function normalizeActivationMonth(value) {
    const month = String(value || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw controlledError('--activation-month must use YYYY-MM format', 'PAYROLL_POST_RELEASE_ACTIVATION_MONTH_INVALID');
    }
    return month;
}

function normalizeDate(value, optionName) {
    const date = String(value || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) {
        throw controlledError(`${optionName} must use YYYY-MM-DD format`, 'PAYROLL_POST_RELEASE_DATE_INVALID');
    }
    return date;
}

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        format: 'json',
        aggregateOnly: true
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (FORBIDDEN_FLAGS.includes(arg)) {
            throw controlledError(
                `payroll post-release audit is read-only only; refused ${arg}`,
                'PAYROLL_POST_RELEASE_READ_ONLY'
            );
        }
        if (arg === '--activation-month') {
            options.activationMonth = normalizeActivationMonth(argv[index + 1]);
            index += 1;
            continue;
        }
        if (arg === '--format') {
            const format = String(argv[index + 1] || '').trim();
            if (!['json', 'markdown'].includes(format)) {
                throw controlledError('--format must be json or markdown', 'PAYROLL_POST_RELEASE_FORMAT_INVALID');
            }
            options.format = format;
            index += 1;
            continue;
        }
        if (arg === '--aggregate-only') {
            options.aggregateOnly = true;
            continue;
        }
        if (arg === '--as-of') {
            options.asOfDate = normalizeDate(argv[index + 1], '--as-of');
            index += 1;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        throw controlledError(`unknown option: ${arg}`, 'PAYROLL_POST_RELEASE_ARG_UNKNOWN');
    }

    if (!options.help && !options.activationMonth) {
        throw controlledError('--activation-month YYYY-MM is required', 'PAYROLL_POST_RELEASE_ACTIVATION_MONTH_REQUIRED');
    }
    return options;
}

function resolveReadOnlyConnectionString(env = process.env) {
    for (const key of READ_ONLY_CONNECTION_ENV_KEYS) {
        const value = String(env?.[key] || '').trim();
        if (value) return { key, connectionString: value };
    }
    throw controlledError(
        'PAYROLL_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL is required for payroll post-release audit',
        'PAYROLL_POST_RELEASE_READ_ONLY_DATABASE_REQUIRED'
    );
}

function poolConfig(env = process.env) {
    const { connectionString } = resolveReadOnlyConnectionString(env);
    return {
        connectionString,
        ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        application_name: 'payroll_post_release_readonly_audit'
    };
}

function helpText() {
    return [
        'Usage: node scripts/audit-payroll-post-release.js --activation-month YYYY-MM [--format json|markdown]',
        '',
        'Read-only connection source:',
        '  PAYROLL_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL',
        '',
        'This command emits aggregate counters only and refuses write-like flags.'
    ].join('\n');
}

async function tableExists(client, tableName) {
    const result = await client.query('SELECT to_regclass($1) AS rel', [`public.${tableName}`]);
    return Boolean(result.rows[0]?.rel);
}

async function columnExists(client, tableName, columnName) {
    const result = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
         LIMIT 1`,
        [tableName, columnName]
    );
    return result.rowCount > 0;
}

async function loadSchemaSnapshot(client) {
    const schema = {
        payrollReports: await tableExists(client, 'payroll_reports'),
        payrollInstallments: await tableExists(client, 'payroll_installments'),
        payrollPaymentMovements: await tableExists(client, 'payroll_payment_movements'),
        financeTransactions: await tableExists(client, 'finance_transactions')
    };
    schema.payrollReportsSettlementModel = schema.payrollReports
        ? await columnExists(client, 'payroll_reports', 'settlement_model')
        : false;
    schema.financeRecognitionDate = schema.financeTransactions
        ? await columnExists(client, 'finance_transactions', 'recognition_date')
        : false;
    return schema;
}

function missingSchemaIssues(schema) {
    const issues = [];
    if (!schema.payrollReports) issues.push('payroll_reports_missing');
    if (!schema.payrollInstallments) issues.push('payroll_installments_missing');
    if (!schema.payrollPaymentMovements) issues.push('payroll_payment_movements_missing');
    if (!schema.financeTransactions) issues.push('finance_transactions_missing');
    if (!schema.payrollReportsSettlementModel) issues.push('payroll_reports_settlement_model_missing');
    if (!schema.financeRecognitionDate) issues.push('finance_transactions_recognition_date_missing');
    return issues;
}

function zeroCounters() {
    return Object.fromEntries(COUNTER_KEYS.map(key => [key, 0]));
}

function numberValue(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function mapCounterRow(row = {}) {
    const counters = zeroCounters();
    counters.duplicatePaymentMovements = numberValue(row.duplicate_payment_movements);
    counters.duplicateFinanceLinks = numberValue(row.duplicate_finance_links);
    counters.movementWithoutFinance = numberValue(row.movement_without_finance);
    counters.financePayrollTransactionWithoutMovement = numberValue(row.finance_payroll_without_movement);
    counters.paymentReversalAmountMismatch = numberValue(row.amount_mismatch);
    counters.reversalWithoutOriginalPayment = numberValue(row.reversal_without_original_payment);
    counters.unresolvedOverpayment = numberValue(row.unresolved_overpayment);
    counters.outstandingAfterDueDate = numberValue(row.outstanding_after_due_date);
    counters.mixedSettlementModels = numberValue(row.mixed_settlement_models);
    counters.legacyWriteInActivationMonth = numberValue(row.legacy_write_in_activation_month);
    counters.recognitionMonthMismatch = numberValue(row.recognition_month_mismatch);
    counters.cashFlowActualDateMismatch = numberValue(row.cash_flow_actual_date_mismatch);
    counters.legacyAccountedReports = numberValue(row.legacy_accounted_reports);
    return counters;
}

async function loadPostReleaseCounters(client, { activationMonth, asOfDate = null }) {
    const result = await client.query(
        `WITH activation_reports AS (
            SELECT id,
                   period_month,
                   staff_id,
                   status,
                   finance_transaction_id,
                   reversal_transaction_id,
                   settlement_model,
                   voided_at
            FROM payroll_reports
            WHERE period_month = $1
              AND voided_at IS NULL
        ),
        month_installments AS (
            SELECT pi.id AS installment_id,
                   pi.payroll_report_id,
                   pi.kind,
                   pi.workflow_status,
                   pi.scheduled_payment_date::date AS scheduled_payment_date,
                   COALESCE(pi.locked_amount, pi.calculated_amount, 0)::numeric AS due_amount,
                   pi.business_context AS installment_business_context,
                   ar.staff_id AS payroll_staff_id,
                   ar.period_month
            FROM payroll_installments pi
            JOIN activation_reports ar ON ar.id = pi.payroll_report_id
            WHERE ar.settlement_model = 'installments_v1'
        ),
        movements AS (
            SELECT ppm.id,
                   ppm.installment_id,
                   ppm.movement_type,
                   ppm.amount::numeric AS amount,
                   ppm.actual_payment_date::date AS actual_payment_date,
                   ppm.finance_transaction_id,
                   ppm.reverses_movement_id,
                   mi.installment_business_context,
                   mi.payroll_staff_id,
                   mi.period_month
            FROM payroll_payment_movements ppm
            JOIN month_installments mi ON mi.installment_id = ppm.installment_id
        ),
        movement_totals AS (
            SELECT installment_id,
                   COALESCE(SUM(amount) FILTER (WHERE movement_type = 'payment'), 0)::numeric AS payment_total,
                   COALESCE(SUM(amount) FILTER (WHERE movement_type = 'reversal'), 0)::numeric AS reversal_total
            FROM movements
            GROUP BY installment_id
        ),
        installment_balances AS (
            SELECT mi.installment_id,
                   mi.scheduled_payment_date,
                   mi.due_amount,
                   GREATEST(COALESCE(mt.payment_total, 0) - COALESCE(mt.reversal_total, 0), 0)::numeric AS net_paid,
                   GREATEST(mi.due_amount - GREATEST(COALESCE(mt.payment_total, 0) - COALESCE(mt.reversal_total, 0), 0), 0)::numeric AS outstanding_amount,
                   GREATEST(GREATEST(COALESCE(mt.payment_total, 0) - COALESCE(mt.reversal_total, 0), 0) - mi.due_amount, 0)::numeric AS overpayment_amount
            FROM month_installments mi
            LEFT JOIN movement_totals mt ON mt.installment_id = mi.installment_id
            WHERE mi.workflow_status = 'approved'
        ),
        finance_links AS (
            SELECT m.*,
                   ft.id AS linked_finance_id,
                   ft.amount::numeric AS finance_amount,
                   ft.type AS finance_type,
                   ft.source AS finance_source,
                   ft.date::date AS finance_date,
                   ft.recognition_date::date AS finance_recognition_date,
                   ft.staff_id AS finance_staff_id,
                   COALESCE(NULLIF(BTRIM(ft.business_context), ''), 'event_genix') AS finance_business_context
            FROM movements m
            LEFT JOIN finance_transactions ft ON ft.id = m.finance_transaction_id
        ),
        duplicate_payment_movements AS (
            SELECT installment_id, actual_payment_date, amount, finance_transaction_id, COUNT(*) AS duplicate_count
            FROM movements
            WHERE movement_type = 'payment'
            GROUP BY installment_id, actual_payment_date, amount, finance_transaction_id
            HAVING COUNT(*) > 1
        ),
        duplicate_finance_links AS (
            SELECT finance_transaction_id, COUNT(*) AS duplicate_count
            FROM movements
            WHERE finance_transaction_id IS NOT NULL
            GROUP BY finance_transaction_id
            HAVING COUNT(*) > 1
        ),
        movement_without_finance AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NULL
        ),
        finance_payroll_without_movement AS (
            SELECT ft.id
            FROM finance_transactions ft
            LEFT JOIN payroll_payment_movements ppm ON ppm.finance_transaction_id = ft.id
            WHERE ft.source = 'payroll'
              AND TO_CHAR(COALESCE(ft.recognition_date, ft.date::date), 'YYYY-MM') = $1
              AND ppm.id IS NULL
        ),
        amount_mismatch AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND ABS(COALESCE(amount, 0) - COALESCE(finance_amount, 0)) > 0.01
        ),
        reversal_without_original_payment AS (
            SELECT reversal.id
            FROM finance_links reversal
            LEFT JOIN movements original
              ON original.id = reversal.reverses_movement_id
             AND original.installment_id = reversal.installment_id
             AND original.movement_type = 'payment'
            WHERE reversal.movement_type = 'reversal'
              AND original.id IS NULL
        ),
        mixed_settlement_models AS (
            SELECT period_month
            FROM activation_reports
            GROUP BY period_month
            HAVING COUNT(DISTINCT settlement_model) > 1
        ),
        legacy_writes AS (
            SELECT id
            FROM activation_reports
            WHERE settlement_model <> 'installments_v1'
               OR status IN ('paid', 'reversed')
               OR finance_transaction_id IS NOT NULL
               OR reversal_transaction_id IS NOT NULL
        ),
        recognition_month_mismatch AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND (
                finance_recognition_date IS NULL
                OR TO_CHAR(finance_recognition_date, 'YYYY-MM') IS DISTINCT FROM period_month
              )
        ),
        cash_flow_actual_date_mismatch AS (
            SELECT id
            FROM finance_links
            WHERE linked_finance_id IS NOT NULL
              AND finance_date IS DISTINCT FROM actual_payment_date
        ),
        legacy_accounted_reports AS (
            SELECT id
            FROM activation_reports
            WHERE settlement_model = 'legacy_v1'
              AND status = 'paid'
        )
        SELECT
            COALESCE((SELECT SUM(duplicate_count - 1) FROM duplicate_payment_movements), 0)::int AS duplicate_payment_movements,
            COALESCE((SELECT COUNT(*) FROM duplicate_finance_links), 0)::int AS duplicate_finance_links,
            COALESCE((SELECT COUNT(*) FROM movement_without_finance), 0)::int AS movement_without_finance,
            COALESCE((SELECT COUNT(*) FROM finance_payroll_without_movement), 0)::int AS finance_payroll_without_movement,
            COALESCE((SELECT COUNT(*) FROM amount_mismatch), 0)::int AS amount_mismatch,
            COALESCE((SELECT COUNT(*) FROM reversal_without_original_payment), 0)::int AS reversal_without_original_payment,
            COALESCE((SELECT COUNT(*) FROM installment_balances WHERE overpayment_amount > 0), 0)::int AS unresolved_overpayment,
            COALESCE((SELECT COUNT(*) FROM installment_balances WHERE outstanding_amount > 0 AND scheduled_payment_date < COALESCE($2::date, CURRENT_DATE)), 0)::int AS outstanding_after_due_date,
            COALESCE((SELECT COUNT(*) FROM mixed_settlement_models), 0)::int AS mixed_settlement_models,
            COALESCE((SELECT COUNT(*) FROM legacy_writes), 0)::int AS legacy_write_in_activation_month,
            COALESCE((SELECT COUNT(*) FROM recognition_month_mismatch), 0)::int AS recognition_month_mismatch,
            COALESCE((SELECT COUNT(*) FROM cash_flow_actual_date_mismatch), 0)::int AS cash_flow_actual_date_mismatch,
            COALESCE((SELECT COUNT(*) FROM legacy_accounted_reports), 0)::int AS legacy_accounted_reports`,
        [activationMonth, asOfDate]
    );
    return mapCounterRow(result.rows[0] || {});
}

function classifyPostReleaseAudit(report = {}) {
    const counters = { ...zeroCounters(), ...(report.counters || {}) };
    const schemaIssues = Array.isArray(report.schemaIssues) ? report.schemaIssues : [];
    const blockers = [];
    const warnings = [];

    for (const issue of schemaIssues) {
        blockers.push({
            code: 'PAYROLL_POST_RELEASE_SCHEMA_INCOMPLETE',
            key: issue,
            count: 1
        });
    }

    for (const key of HOLD_COUNTERS) {
        const count = numberValue(counters[key]);
        if (count > 0) {
            blockers.push({
                code: `PAYROLL_POST_RELEASE_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`,
                key,
                count
            });
        }
    }

    for (const key of WARNING_COUNTERS) {
        const count = numberValue(counters[key]);
        if (count > 0) {
            warnings.push({
                code: `PAYROLL_POST_RELEASE_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`,
                key,
                count
            });
        }
    }

    const status = blockers.length > 0 ? 'hold' : (warnings.length > 0 ? 'warning' : 'stable');
    return { status, blockers, warnings };
}

async function runPostReleaseAudit(options, env = process.env) {
    const normalizedOptions = {
        ...options,
        activationMonth: normalizeActivationMonth(options.activationMonth)
    };
    const connection = resolveReadOnlyConnectionString(env);
    const pool = new Pool(poolConfig(env));
    const client = await pool.connect();

    try {
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '30s'");
        await client.query("SET LOCAL lock_timeout = '5s'");
        const readOnly = await client.query('SHOW transaction_read_only');
        if (readOnly.rows[0]?.transaction_read_only !== 'on') {
            throw controlledError(
                'database transaction is not read-only; refusing payroll post-release audit',
                'PAYROLL_POST_RELEASE_TRANSACTION_NOT_READ_ONLY'
            );
        }

        const schema = await loadSchemaSnapshot(client);
        const schemaIssues = missingSchemaIssues(schema);
        const counters = schemaIssues.length > 0
            ? zeroCounters()
            : await loadPostReleaseCounters(client, normalizedOptions);
        const report = {
            generatedAt: new Date().toISOString(),
            connection: { envKey: connection.key },
            scope: {
                activationMonth: normalizedOptions.activationMonth,
                aggregateOnly: true
            },
            schema,
            schemaIssues,
            counters,
            legacySemantics: {
                legacyStatus: 'legacy_accounted',
                paymentFactVerifiedFromLegacyPaid: false,
                message: 'Історично враховано; факт виплати користувачем не підтверджено'
            }
        };
        report.decision = classifyPostReleaseAudit(report);

        await client.query('COMMIT');
        return report;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Ignore rollback failure after connection-level errors.
        }
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

function renderMarkdown(report = {}) {
    const counters = { ...zeroCounters(), ...(report.counters || {}) };
    const decision = report.decision || classifyPostReleaseAudit(report);
    const lines = [
        '# Payroll post-release audit',
        '',
        `Generated: ${report.generatedAt || ''}`,
        `Activation month: ${report.scope?.activationMonth || ''}`,
        `Decision: ${decision.status}`,
        '',
        '## Aggregate counters',
        ''
    ];

    for (const key of COUNTER_KEYS) {
        lines.push(`- ${key}: ${numberValue(counters[key])}`);
    }

    lines.push(
        '',
        '## Legacy paid semantics',
        '',
        `- status: ${report.legacySemantics?.legacyStatus || 'legacy_accounted'}`,
        `- payment fact verified from legacy paid: ${report.legacySemantics?.paymentFactVerifiedFromLegacyPaid === true ? 'true' : 'false'}`,
        `- message: ${report.legacySemantics?.message || 'Історично враховано; факт виплати користувачем не підтверджено'}`,
        '',
        '## Blockers',
        ''
    );

    if (decision.blockers?.length) {
        for (const blocker of decision.blockers) {
            lines.push(`- ${blocker.code}: ${blocker.count} (${blocker.key})`);
        }
    } else {
        lines.push('- none');
    }

    lines.push('', '## Warnings', '');
    if (decision.warnings?.length) {
        for (const warning of decision.warnings) {
            lines.push(`- ${warning.code}: ${warning.count} (${warning.key})`);
        }
    } else {
        lines.push('- none');
    }

    return lines.join('\n');
}

async function main() {
    try {
        const options = parseArgs();
        if (options.help) {
            console.log(helpText());
            return;
        }
        const report = await runPostReleaseAudit(options);
        if (options.format === 'markdown') {
            console.log(renderMarkdown(report));
        } else {
            console.log(JSON.stringify(report, null, 2));
        }
        if (report.decision.status === 'hold') {
            process.exitCode = 2;
        }
    } catch (error) {
        console.error(JSON.stringify({
            error: error.code || 'PAYROLL_POST_RELEASE_AUDIT_FAILED',
            message: error.message
        }));
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    COUNTER_KEYS,
    FORBIDDEN_FLAGS,
    HOLD_COUNTERS,
    READ_ONLY_CONNECTION_ENV_KEYS,
    WARNING_COUNTERS,
    classifyPostReleaseAudit,
    helpText,
    loadPostReleaseCounters,
    mapCounterRow,
    parseArgs,
    poolConfig,
    renderMarkdown,
    resolveReadOnlyConnectionString,
    runPostReleaseAudit,
    zeroCounters
};
