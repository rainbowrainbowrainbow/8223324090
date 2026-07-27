'use strict';

const { Pool } = require('pg');
const {
    buildCanonicalPayrollInstallmentPreview
} = require('../services/payroll');

const FORBIDDEN_FLAGS = new Set(['--apply', '--fix', '--write', '--backfill', '--execute', '--update']);
const READ_ONLY_CONNECTION_ENV_KEYS = ['PAYROLL_AUDIT_DATABASE_URL', 'PRODUCTION_READONLY_DATABASE_URL'];
const BLOCKING_CATEGORIES = new Set([
    'unknown_delta',
    'missing_source_data',
    'leave_policy',
    'business_allocation'
]);
const KNOWN_DELTA_SIGNALS = [
    'employment_overlap',
    'rate_version',
    'leave_policy',
    'legacy_zrs',
    'attendance_correction',
    'business_allocation',
    'missing_source_data'
];

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value) {
    return Math.round(toNumber(value, 0));
}

function assertPayrollMonth(value, field = 'month') {
    const month = String(value || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        const err = new Error(`${field} must be YYYY-MM`);
        err.code = 'PAYROLL_SHADOW_MONTH_INVALID';
        throw err;
    }
    return month;
}

function previousPayrollMonth(month) {
    const normalized = assertPayrollMonth(month);
    const [year, monthNumber] = normalized.split('-').map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 2, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parsePositiveInteger(value, fallback, field) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        const err = new Error(`${field} must be a positive integer`);
        err.code = 'PAYROLL_SHADOW_OPTION_INVALID';
        throw err;
    }
    return parsed;
}

function parseArgs(argv = process.argv.slice(2)) {
    const options = { format: 'json', closedMonths: 3, aggregateOnly: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index] || '').trim();
        if (!arg) continue;
        if (FORBIDDEN_FLAGS.has(arg)) {
            const err = new Error(`${arg} is forbidden: payroll shadow comparison is read-only`);
            err.code = 'PAYROLL_SHADOW_READ_ONLY';
            throw err;
        }
        if (arg === '--activation-month') options.activationMonth = assertPayrollMonth(argv[++index], 'activationMonth');
        else if (arg === '--closed-months') options.closedMonths = parsePositiveInteger(argv[++index], 3, 'closedMonths');
        else if (arg === '--aggregate-only') options.aggregateOnly = true;
        else if (arg === '--month') options.month = assertPayrollMonth(argv[++index], 'month');
        else if (arg === '--from') options.from = assertPayrollMonth(argv[++index], 'from');
        else if (arg === '--to') options.to = assertPayrollMonth(argv[++index], 'to');
        else if (arg === '--staff-id') options.staffId = Number(argv[++index]);
        else if (arg === '--format') options.format = String(argv[++index] || '').trim();
        else if (arg === '--json') options.format = 'json';
        else if (arg === '--markdown') options.format = 'markdown';
        else if (arg === '--help') options.help = true;
        else {
            const err = new Error(`Unknown option: ${arg}`);
            err.code = 'PAYROLL_SHADOW_OPTION_UNKNOWN';
            throw err;
        }
    }
    if (!['json', 'markdown'].includes(options.format)) {
        const err = new Error('format must be json or markdown');
        err.code = 'PAYROLL_SHADOW_FORMAT_INVALID';
        throw err;
    }
    if (options.staffId !== undefined && (!Number.isInteger(options.staffId) || options.staffId <= 0)) {
        const err = new Error('staffId must be a positive integer');
        err.code = 'PAYROLL_SHADOW_STAFF_ID_INVALID';
        throw err;
    }
    return options;
}

function resolveReadOnlyConnectionString(env = process.env) {
    for (const key of READ_ONLY_CONNECTION_ENV_KEYS) {
        const value = String(env[key] || '').trim();
        if (value) return { key, connectionString: value };
    }
    const err = new Error('Set PAYROLL_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL for payroll shadow comparison');
    err.code = 'PAYROLL_SHADOW_READ_ONLY_DATABASE_REQUIRED';
    throw err;
}

function createReadOnlyPool(env = process.env) {
    const { connectionString } = resolveReadOnlyConnectionString(env);
    return new Pool({
        connectionString,
        ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    });
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

async function loadShadowSchema(client) {
    const hasReports = await tableExists(client, 'payroll_reports');
    const hasInstallments = await tableExists(client, 'payroll_installments');
    const hasMovements = await tableExists(client, 'payroll_payment_movements');
    return {
        hasReports,
        hasInstallments,
        hasMovements,
        reports: {
            netAmount: hasReports ? await columnExists(client, 'payroll_reports', 'net_amount') : false,
            status: hasReports ? await columnExists(client, 'payroll_reports', 'status') : false,
            voidedAt: hasReports ? await columnExists(client, 'payroll_reports', 'voided_at') : false,
            breakdownJson: hasReports ? await columnExists(client, 'payroll_reports', 'breakdown_json') : false
        }
    };
}

async function selectClosedPayrollMonths(client, activationMonth, closedMonths, schema) {
    const monthBeforeActivation = previousPayrollMonth(activationMonth);
    if (!schema.hasReports) return [];
    const where = ['period_month <= $1'];
    if (schema.reports.status) where.push("status IN ('reviewed', 'approved', 'paid')");
    if (schema.reports.voidedAt) where.push('voided_at IS NULL');
    const result = await client.query(
        `SELECT period_month
         FROM payroll_reports
         WHERE ${where.join(' AND ')}
         GROUP BY period_month
         ORDER BY period_month DESC
         LIMIT $2`,
        [monthBeforeActivation, closedMonths]
    );
    return result.rows.map(row => row.period_month).filter(Boolean).reverse();
}

function resolveRequestedMonths(options, selectedMonths = []) {
    if (options.month) return { from: options.month, to: options.month, months: [options.month] };
    if (options.from || options.to) {
        const from = assertPayrollMonth(options.from || options.to, 'from');
        const to = assertPayrollMonth(options.to || options.from, 'to');
        return { from, to, months: null };
    }
    if (options.activationMonth) {
        const months = selectedMonths.length ? selectedMonths : [previousPayrollMonth(options.activationMonth)];
        return { from: months[0], to: months[months.length - 1], months };
    }
    const err = new Error('Provide --activation-month YYYY-MM, --month YYYY-MM, or --from YYYY-MM --to YYYY-MM');
    err.code = 'PAYROLL_SHADOW_MONTH_REQUIRED';
    throw err;
}

async function loadLegacyPayrollRows(client, range, options, schema) {
    if (!schema.hasReports || !schema.reports.netAmount) {
        return [];
    }
    const where = ['period_month >= $1', 'period_month <= $2'];
    const params = [range.from, range.to];
    if (Array.isArray(range.months) && range.months.length) {
        where.push(`period_month = ANY($${params.length + 1}::text[])`);
        params.push(range.months);
    }
    if (options.staffId) {
        where.push(`staff_id = $${params.length + 1}`);
        params.push(options.staffId);
    }
    if (schema.reports.voidedAt) where.push('voided_at IS NULL');
    const breakdownColumn = schema.reports.breakdownJson ? 'breakdown_json' : 'NULL::jsonb AS breakdown_json';
    const result = await client.query(
        `SELECT id AS report_id,
                period_month,
                staff_id,
                net_amount AS old_monthly_total,
                ${breakdownColumn}
         FROM payroll_reports
         WHERE ${where.join(' AND ')}
         ORDER BY period_month, staff_id, id`,
        params
    );
    return result.rows;
}

async function loadInstallmentEvidence(client, range, options, schema) {
    if (!schema.hasReports || !schema.hasInstallments) return new Map();
    const where = ['pr.period_month >= $1', 'pr.period_month <= $2'];
    const params = [range.from, range.to];
    if (Array.isArray(range.months) && range.months.length) {
        where.push(`pr.period_month = ANY($${params.length + 1}::text[])`);
        params.push(range.months);
    }
    if (options.staffId) {
        where.push(`pr.staff_id = $${params.length + 1}`);
        params.push(options.staffId);
    }
    const result = await client.query(
        `SELECT pr.period_month,
                pr.staff_id,
                COUNT(pi.id)::int AS installment_count,
                SUM(pi.calculated_amount) FILTER (WHERE pi.kind = 'advance') AS advance_calculated_amount,
                SUM(pi.calculated_amount) FILTER (WHERE pi.kind = 'final') AS final_calculated_amount,
                MAX(pi.workflow_status) FILTER (WHERE pi.kind = 'advance') AS advance_workflow_status,
                MAX(pi.workflow_status) FILTER (WHERE pi.kind = 'final') AS final_workflow_status
         FROM payroll_reports pr
         JOIN payroll_installments pi ON pi.payroll_report_id = pr.id
         WHERE ${where.join(' AND ')}
         GROUP BY pr.period_month, pr.staff_id`,
        params
    );
    return new Map(result.rows.map(row => [
        `${row.period_month}:${Number(row.staff_id)}`,
        {
            installmentCount: Number(row.installment_count || 0),
            advanceCalculatedAmount: row.advance_calculated_amount === null ? null : roundMoney(row.advance_calculated_amount),
            finalCalculatedAmount: row.final_calculated_amount === null ? null : roundMoney(row.final_calculated_amount),
            advanceWorkflowStatus: row.advance_workflow_status || null,
            finalWorkflowStatus: row.final_workflow_status || null
        }
    ]));
}

function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function hasSignal(context = {}, name) {
    if (context[name] === true) return true;
    if (Array.isArray(context.signals) && context.signals.includes(name)) return true;
    if (Array.isArray(context.categories) && context.categories.includes(name)) return true;
    return false;
}

function extractSnapshotSignals(row = {}) {
    const snapshots = [
        row.breakdownJson,
        row.breakdown_json,
        row.canonicalPreview,
        row.advanceInstallment,
        row.finalInstallment
    ].filter(Boolean);
    const text = snapshots.map(value => {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch { return ''; }
    }).join('\n').toLowerCase();
    const signals = [];
    if (/round/.test(text)) signals.push('rounding');
    if (/employment|hire|termination/.test(text)) signals.push('employment_overlap');
    if (/rate[_ -]?version|effective|scheme_change/.test(text)) signals.push('rate_version');
    if (/leave|vacation|sick|day[_ -]?off|unpaid/.test(text)) signals.push('leave_policy');
    if (/\bzrs\b|legacy advance/.test(text)) signals.push('legacy_zrs');
    if (/correction|recalculation[_ -]?delta|attendance/.test(text)) signals.push('attendance_correction');
    if (/business[_ -]?allocation|allocation_status|business_context|unresolved/.test(text)) signals.push('business_allocation');
    return [...new Set(signals)];
}

function blockerCategory(issue = {}) {
    const code = String(issue.code || '').toUpperCase();
    const message = String(issue.message || '').toLowerCase();
    if (/LEAVE|VACATION|SICK|DAY_OFF|UNPAID/.test(code) || /leave|vacation|sick|day[_ -]?off|unpaid/.test(message)) return 'leave_policy';
    if (/BUSINESS_CONTEXT|ALLOCATION/.test(code) || /business[_ -]?context|allocation/.test(message)) return 'business_allocation';
    if (/SCHEME_CHANGE|RATE|EFFECTIVE/.test(code) || /rate|effective|scheme change/.test(message)) return 'rate_version';
    if (/EMPLOYMENT|HIRE|TERMINATION/.test(code) || /employment|hire|termination/.test(message)) return 'employment_overlap';
    if (/ZRS|ADVANCE/.test(code) || /\bzrs\b|legacy advance/.test(message)) return 'legacy_zrs';
    return 'missing_source_data';
}

function classifyPayrollShadowDelta(input = {}) {
    const oldMonthlyTotal = input.oldMonthlyTotal;
    const newAdvance = roundMoney(input.newAdvance);
    const newFinal = roundMoney(input.newFinal);
    const newCombinedTotal = roundMoney(input.newCombinedTotal ?? (newAdvance + newFinal));
    const delta = oldMonthlyTotal === null || oldMonthlyTotal === undefined
        ? null
        : roundMoney(newCombinedTotal - roundMoney(oldMonthlyTotal));
    const categories = [];
    const blockers = Array.isArray(input.blockers) ? input.blockers : [];

    if (delta === null) categories.push('missing_source_data');
    else if (delta === 0) categories.push('matched');
    else if (Math.abs(delta) <= 1 && hasSignal(input, 'rounding')) categories.push('rounding');

    for (const signal of KNOWN_DELTA_SIGNALS) {
        if ((delta !== 0 || BLOCKING_CATEGORIES.has(signal)) && hasSignal(input, signal)) {
            categories.push(signal);
        }
    }
    for (const issue of blockers) {
        categories.push(blockerCategory(issue));
    }
    const uniqueCategories = [...new Set(categories)];
    const knownDeltaCount = uniqueCategories.filter(category => category !== 'matched').length;
    if (delta !== 0 && delta !== null && knownDeltaCount === 0) {
        uniqueCategories.push('unknown_delta');
    }

    return {
        oldMonthlyTotal: oldMonthlyTotal === null || oldMonthlyTotal === undefined ? null : roundMoney(oldMonthlyTotal),
        newAdvance,
        newFinal,
        newCombinedTotal,
        delta,
        categories: uniqueCategories,
        activationBlocked: uniqueCategories.some(category => BLOCKING_CATEGORIES.has(category))
    };
}

async function buildPayrollShadowComparisonRow(row = {}, options = {}, evidence = null, dbClient = null) {
    const month = row.month ?? row.period_month ?? options.month ?? null;
    const staffId = Number(row.staffId ?? row.staff_id ?? options.staffId ?? 0);
    const oldMonthlyTotal = row.oldMonthlyTotal ?? row.old_monthly_total ?? row.legacyNetAmount ?? row.legacy_net_amount;
    const breakdown = parseJsonObject(row.breakdownJson ?? row.breakdown_json);
    let canonicalPreview = row.canonicalPreview || null;
    let canonicalError = null;

    if (!canonicalPreview && typeof options.previewBuilder === 'function') {
        try {
            canonicalPreview = await options.previewBuilder({ month, staffId, row, dbClient });
        } catch (error) {
            canonicalError = {
                code: error.code || 'PAYROLL_SHADOW_CANONICAL_PREVIEW_FAILED',
                message: error.message
            };
        }
    }
    if (!canonicalPreview && !canonicalError && dbClient) {
        try {
            canonicalPreview = await buildCanonicalPayrollInstallmentPreview({ month, staffId }, dbClient);
        } catch (error) {
            canonicalError = {
                code: error.code || 'PAYROLL_SHADOW_CANONICAL_PREVIEW_FAILED',
                message: error.message
            };
        }
    }

    const blockers = [
        ...(canonicalPreview?.blockers || []),
        ...(canonicalError ? [canonicalError] : [])
    ];
    const signals = [...new Set([
        ...(row.signals || []),
        ...extractSnapshotSignals({
            breakdownJson: breakdown,
            canonicalPreview,
            advanceInstallment: canonicalPreview?.advanceInstallment,
            finalInstallment: canonicalPreview?.finalInstallment
        })
    ])];
    const comparison = classifyPayrollShadowDelta({
        oldMonthlyTotal,
        newAdvance: row.newAdvance ?? row.new_advance ?? canonicalPreview?.advanceAmount ?? 0,
        newFinal: row.newFinal ?? row.new_final ?? canonicalPreview?.finalAmount ?? 0,
        newCombinedTotal: row.newCombinedTotal ?? row.new_combined_total ?? canonicalPreview?.combinedAmount,
        signals,
        blockers
    });
    return {
        month,
        staffId,
        reportId: row.reportId ?? row.report_id ?? null,
        ...comparison,
        categories: comparison.categories,
        signals,
        blockers: blockers.map(issue => ({
            code: issue.code || null,
            category: blockerCategory(issue)
        })),
        evidence: evidence || null
    };
}

function summarizeRows(rows = [], schema = {}) {
    const categoryCounts = {};
    const monthCounts = {};
    for (const row of rows) {
        monthCounts[row.month] = (monthCounts[row.month] || 0) + 1;
        for (const category of row.categories || []) {
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        }
    }
    return {
        rowCount: rows.length,
        months: monthCounts,
        categoryCounts,
        activationBlocked: rows.some(row => row.activationBlocked === true),
        schema: {
            payrollReports: schema.hasReports === true,
            payrollInstallments: schema.hasInstallments === true,
            payrollPaymentMovements: schema.hasMovements === true
        }
    };
}

function formatMarkdown(result = {}, aggregateOnly = false) {
    const lines = [
        `# Payroll shadow comparison`,
        '',
        `Range: ${result.from}..${result.to}`,
        `Rows: ${result.summary.rowCount}`,
        `Activation blocked: ${result.summary.activationBlocked ? 'yes' : 'no'}`,
        '',
        `## Categories`
    ];
    const categoryCounts = result.summary.categoryCounts || {};
    for (const [category, count] of Object.entries(categoryCounts).sort()) {
        lines.push(`- ${category}: ${count}`);
    }
    if (!aggregateOnly) {
        lines.push('', '## Rows', '| month | staffId | old | advance | final | combined | delta | categories |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
        for (const row of result.rows) {
            lines.push(`| ${row.month} | ${row.staffId} | ${row.oldMonthlyTotal ?? ''} | ${row.newAdvance} | ${row.newFinal} | ${row.newCombinedTotal} | ${row.delta ?? ''} | ${(row.categories || []).join(',')} |`);
        }
    }
    return lines.join('\n');
}

function printHelp() {
    console.log([
        'Usage: node scripts/shadow-payroll-installment-comparison.js --activation-month YYYY-MM [--closed-months 3] [--aggregate-only]',
        '       node scripts/shadow-payroll-installment-comparison.js --month YYYY-MM [--staff-id ID]',
        '       node scripts/shadow-payroll-installment-comparison.js --from YYYY-MM --to YYYY-MM [--staff-id ID]',
        '',
        'Read-only comparison of legacy payroll_reports.net_amount against canonical advance + final preview.',
        'Connection must use PAYROLL_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL.',
        'Refuses write-like flags.'
    ].join('\n'));
}

async function collectPayrollShadowComparison(client, options = {}) {
    const schema = await loadShadowSchema(client);
    const selectedMonths = options.activationMonth
        ? await selectClosedPayrollMonths(client, options.activationMonth, options.closedMonths || 3, schema)
        : [];
    const range = resolveRequestedMonths(options, selectedMonths);
    const legacyRows = await loadLegacyPayrollRows(client, range, options, schema);
    const evidenceMap = await loadInstallmentEvidence(client, range, options, schema);
    const rows = [];
    for (const row of legacyRows) {
        const key = `${row.period_month}:${Number(row.staff_id)}`;
        rows.push(await buildPayrollShadowComparisonRow(
            row,
            options,
            evidenceMap.get(key) || null,
            client
        ));
    }
    return {
        from: range.from,
        to: range.to,
        selectedMonths: range.months || null,
        rows,
        summary: summarizeRows(rows, schema)
    };
}

async function run(options = parseArgs()) {
    if (options.help) {
        printHelp();
        return { rows: [], summary: summarizeRows([]) };
    }
    const pool = createReadOnlyPool(options.env || process.env);
    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        const readonly = await client.query('SHOW transaction_read_only');
        if (String(readonly.rows[0]?.transaction_read_only || '').toLowerCase() !== 'on') {
            throw new Error('Database transaction is not read-only');
        }
        const result = await collectPayrollShadowComparison(client, options);
        await client.query('COMMIT');
        if (options.format === 'json') {
            const payload = options.aggregateOnly
                ? { from: result.from, to: result.to, selectedMonths: result.selectedMonths, summary: result.summary }
                : result;
            console.log(JSON.stringify(payload, null, 2));
        } else {
            console.log(formatMarkdown(result, options.aggregateOnly));
        }
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
        await pool.end().catch(() => {});
    }
}

if (require.main === module) {
    run().catch(err => {
        console.error(err.code ? `${err.code}: ${err.message}` : err.message);
        process.exitCode = 1;
    });
}

module.exports = {
    BLOCKING_CATEGORIES,
    FORBIDDEN_FLAGS,
    READ_ONLY_CONNECTION_ENV_KEYS,
    buildPayrollShadowComparisonRow,
    classifyPayrollShadowDelta,
    collectPayrollShadowComparison,
    createReadOnlyPool,
    parseArgs,
    resolveReadOnlyConnectionString,
    resolveRequestedMonths,
    run,
    selectClosedPayrollMonths,
    summarizeRows
};
