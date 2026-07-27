#!/usr/bin/env node
'use strict';

/**
 * Read-only impact audit for historical HR attendance records.
 *
 * This script intentionally has no write/apply mode. It opens a PostgreSQL
 * READ ONLY transaction and only runs SELECT queries.
 */

const { Pool } = require('pg');

const VALID_PLAN_SOURCES = new Set(['hr_shift', 'profession_card', 'unscheduled', 'attendance_snapshot']);
const BLOCKED_FLAGS = new Set(['--apply', '--fix', '--write', '--execute', '--update', '--backfill']);
const CATEGORY_LATE_GRACE = 'late-grace';
const CATEGORY_OVERTIME_GRACE = 'overtime-grace';
const CATEGORY_MISSING_PLAN_SOURCE = 'missing-plan-source';
const CATEGORY_INFERRED_PROFESSION_CARD = 'inferred-profession-card';
const CATEGORY_NULL_ZERO_NEGATIVE_LATE = 'null-zero-negative-late';
const READONLY_CATEGORIES = new Set([
    CATEGORY_LATE_GRACE,
    CATEGORY_OVERTIME_GRACE,
    CATEGORY_MISSING_PLAN_SOURCE,
    CATEGORY_INFERRED_PROFESSION_CARD,
    CATEGORY_NULL_ZERO_NEGATIVE_LATE
]);

function usage() {
    return [
        'Usage:',
        '  node scripts/audit-attendance-historical-impact.js [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--business-context key] [--categories late-grace,overtime-grace] [--format json|markdown]',
        '',
        'Connection:',
        '  ATTENDANCE_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL.',
        '',
        'Categories:',
        '  late-grace, overtime-grace, missing-plan-source, inferred-profession-card, null-zero-negative-late',
        '',
        'Safety:',
        '  Read-only only. --apply/--fix/--write/--execute/--update/--backfill are refused.'
    ].join('\n');
}

function normalizeCategory(value) {
    const text = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (['late', 'late-grace-mismatch', 'late-status-within-grace'].includes(text)) return CATEGORY_LATE_GRACE;
    if (['overtime', 'overtime-grace-mismatch', 'overtime-within-grace'].includes(text)) return CATEGORY_OVERTIME_GRACE;
    if (['missing-audit-plan-source', 'missing-plan-source', 'plan-source'].includes(text)) return CATEGORY_MISSING_PLAN_SOURCE;
    if (['inferred-profession-card', 'profession-card-inference'].includes(text)) return CATEGORY_INFERRED_PROFESSION_CARD;
    if (['null-zero-negative-late', 'null-late', 'zero-late', 'negative-late'].includes(text)) return CATEGORY_NULL_ZERO_NEGATIVE_LATE;
    return text;
}

function normalizeCategories(values = []) {
    const raw = values.flatMap(value => String(value || '').split(',')).map(normalizeCategory).filter(Boolean);
    const categories = raw.length ? [...new Set(raw)] : [...READONLY_CATEGORIES];
    const unknown = categories.filter(category => !READONLY_CATEGORIES.has(category));
    if (unknown.length) throw new Error(`Unsupported --categories value: ${unknown.join(', ')}`);
    return categories.sort();
}

function parseArgs(argv) {
    const options = {
        from: '',
        to: '',
        businessContext: '',
        categoryInputs: [],
        categories: [],
        format: 'json'
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (BLOCKED_FLAGS.has(arg)) {
            throw new Error(`${arg} is not supported: this audit is read-only only`);
        }
        const readValue = name => {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
            index += 1;
            return value.trim();
        };
        if (arg === '--from') options.from = readValue(arg);
        else if (arg === '--to') options.to = readValue(arg);
        else if (arg === '--business-context') options.businessContext = readValue(arg);
        else if (arg === '--category' || arg === '--categories') options.categoryInputs.push(readValue(arg));
        else if (arg === '--format') options.format = readValue(arg).toLowerCase();
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.format && !['json', 'markdown'].includes(options.format)) {
        throw new Error('--format must be json or markdown');
    }
    for (const [key, value] of [['from', options.from], ['to', options.to]]) {
        if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new Error(`--${key} must be YYYY-MM-DD`);
        }
    }
    if (options.from && options.to && options.from > options.to) {
        throw new Error('--from must be before or equal to --to');
    }
    options.categories = normalizeCategories(options.categoryInputs);
    return options;
}

function poolConfig(env = process.env) {
    const connectionString = String(
        env.ATTENDANCE_AUDIT_DATABASE_URL
        || env.PRODUCTION_READONLY_DATABASE_URL
        || ''
    ).trim();
    if (!connectionString) {
        const error = new Error(
            'Set ATTENDANCE_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL before running the read-only attendance audit'
        );
        error.code = 'ATTENDANCE_AUDIT_READ_ONLY_DATABASE_REQUIRED';
        throw error;
    }
    return {
        connectionString,
        ssl: env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        application_name: 'attendance_historical_readonly_audit'
    };
}

function scopeWhere(options, alias = 'tr', startIndex = 1) {
    const clauses = [];
    const values = [];
    const add = (sql, value) => {
        values.push(value);
        clauses.push(sql.replace('?', `$${startIndex + values.length - 1}`));
    };
    if (options.from) add(`${alias}.record_date >= ?::date`, options.from);
    if (options.to) add(`${alias}.record_date <= ?::date`, options.to);
    if (options.businessContext) {
        add(`COALESCE(${alias}.business_context, 'event_genix') = ?`, options.businessContext);
    }
    return {
        sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
        values
    };
}

function auditPlanSourceJoin(recordAlias = 'tr') {
    return `
        LEFT JOIN LATERAL (
            SELECT NULLIF(al.details->>'plan_source', '') AS plan_source
            FROM hr_audit_log al
            WHERE al.action = 'clock_in'
              AND al.staff_id = ${recordAlias}.staff_id
              AND (
                    al.details->>'record_id' = ${recordAlias}.id::text
                    OR al.details->>'record_date' = ${recordAlias}.record_date::text
                    OR al.details->>'date' = ${recordAlias}.record_date::text
                    OR (
                        ${recordAlias}.clock_in IS NOT NULL
                        AND al.details->>'clock_in' = to_char(${recordAlias}.clock_in AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                    )
              )
            ORDER BY al.created_at ASC, al.id ASC
            LIMIT 1
        ) audit ON true
    `;
}

function baseScopedCte(where) {
    return `
        WITH scoped AS (
            SELECT tr.*, to_char(tr.record_date, 'YYYY-MM') AS period_month
            FROM hr_time_records tr
            ${where.sql}
        ),
        audited AS (
            SELECT tr.*,
                   audit.plan_source AS audit_plan_source,
                   hs.id AS hr_shift_id
            FROM scoped tr
            LEFT JOIN hr_shifts hs
                   ON hs.staff_id = tr.staff_id
                  AND hs.shift_date = tr.record_date
            ${auditPlanSourceJoin('tr')}
        )
    `;
}

function issueSelects(categories = []) {
    const selected = new Set(categories);
    const selects = [];
    if (selected.has(CATEGORY_LATE_GRACE)) {
        selects.push(`
            SELECT id, staff_id, record_date, period_month, 'late_status_within_grace' AS issue
            FROM audited
            WHERE status = 'late' AND late_minutes BETWEEN 1 AND 5`);
    }
    if (selected.has(CATEGORY_OVERTIME_GRACE)) {
        selects.push(`
            SELECT id, staff_id, record_date, period_month, 'overtime_within_grace' AS issue
            FROM audited
            WHERE COALESCE(overtime_minutes, 0) BETWEEN 1 AND 15`);
    }
    if (selected.has(CATEGORY_NULL_ZERO_NEGATIVE_LATE)) {
        selects.push(`
            SELECT id, staff_id, record_date, period_month, 'null_zero_negative_late' AS issue
            FROM audited
            WHERE status = 'late'
              AND (late_minutes IS NULL OR late_minutes = 0 OR late_minutes < 0)`);
    }
    if (selected.has(CATEGORY_MISSING_PLAN_SOURCE)) {
        selects.push(`
            SELECT id, staff_id, record_date, period_month, 'missing_audit_plan_source' AS issue
            FROM audited
            WHERE clock_in IS NOT NULL
              AND (
                    audit_plan_source IS NULL
                    OR audit_plan_source NOT IN ('hr_shift', 'profession_card', 'unscheduled', 'attendance_snapshot')
              )`);
    }
    if (selected.has(CATEGORY_INFERRED_PROFESSION_CARD)) {
        selects.push(`
            SELECT id, staff_id, record_date, period_month, 'inferred_profession_card' AS issue
            FROM audited
            WHERE hr_shift_id IS NULL
              AND planned_start IS NOT NULL
              AND planned_end IS NOT NULL`);
    }
    return selects.length ? selects.join('\nUNION ALL\n') : `
            SELECT id, staff_id, record_date, period_month, 'none' AS issue
            FROM audited
            WHERE false`;
}

function candidateCte(where, categories = []) {
    return `${baseScopedCte(where)},
        candidates AS (
            ${issueSelects(categories)}
        )`;
}

function normalizeSummaryRow(row = {}) {
    return {
        rows: Number(row.rows || row.affected_rows || 0),
        distinctStaff: Number(row.distinct_staff || 0),
        minDate: row.min_date || null,
        maxDate: row.max_date || null
    };
}

async function loadMetric(client, options, key, predicateSql) {
    const where = scopeWhere(options);
    const base = baseScopedCte(where);
    const summary = await client.query(
        `${base}
         SELECT COUNT(*)::int AS affected_rows,
                COUNT(DISTINCT staff_id)::int AS distinct_staff,
                MIN(record_date)::text AS min_date,
                MAX(record_date)::text AS max_date
         FROM audited
         WHERE ${predicateSql}`,
        where.values
    );
    const byMonth = await client.query(
        `${base}
         SELECT period_month, COUNT(*)::int AS rows
         FROM audited
         WHERE ${predicateSql}
         GROUP BY period_month
         ORDER BY period_month`,
        where.values
    );
    return {
        key,
        ...normalizeSummaryRow(summary.rows[0]),
        byMonth: byMonth.rows.map(row => ({
            month: row.period_month,
            rows: Number(row.rows || 0)
        }))
    };
}

async function tableExists(client, tableName) {
    const result = await client.query('SELECT to_regclass($1) AS relation', [`public.${tableName}`]);
    return Boolean(result.rows[0]?.relation);
}

async function loadOverview(client, options) {
    const where = scopeWhere(options);
    const result = await client.query(
        `SELECT COUNT(*)::int AS total_rows,
                COUNT(*) FILTER (WHERE clock_in IS NOT NULL)::int AS rows_with_clock_in,
                COUNT(*) FILTER (WHERE clock_out IS NOT NULL)::int AS rows_with_clock_out,
                COUNT(DISTINCT staff_id)::int AS distinct_staff,
                MIN(record_date)::text AS min_date,
                MAX(record_date)::text AS max_date
         FROM hr_time_records tr
         ${where.sql}`,
        where.values
    );
    const row = result.rows[0] || {};
    return {
        totalRows: Number(row.total_rows || 0),
        rowsWithClockIn: Number(row.rows_with_clock_in || 0),
        rowsWithClockOut: Number(row.rows_with_clock_out || 0),
        distinctStaff: Number(row.distinct_staff || 0),
        minDate: row.min_date || null,
        maxDate: row.max_date || null
    };
}

async function loadAuditSourceBreakdown(client, options) {
    const where = scopeWhere(options);
    const result = await client.query(
        `${baseScopedCte(where)}
         SELECT COALESCE(NULLIF(audit_plan_source, ''), 'missing') AS audit_plan_source,
                COUNT(*)::int AS rows
         FROM audited
         WHERE clock_in IS NOT NULL
         GROUP BY COALESCE(NULLIF(audit_plan_source, ''), 'missing')
         ORDER BY rows DESC, audit_plan_source`,
        where.values
    );
    return result.rows.map(row => ({
        planSource: VALID_PLAN_SOURCES.has(row.audit_plan_source) ? row.audit_plan_source : row.audit_plan_source,
        rows: Number(row.rows || 0)
    }));
}

async function loadInferredProfessionBreakdown(client, options) {
    const where = scopeWhere(options);
    const result = await client.query(
        `${baseScopedCte(where)}
         SELECT COALESCE(NULLIF(audit_plan_source, ''), 'missing') AS audit_plan_source,
                COUNT(*)::int AS rows
         FROM audited
         WHERE hr_shift_id IS NULL
           AND planned_start IS NOT NULL
           AND planned_end IS NOT NULL
         GROUP BY COALESCE(NULLIF(audit_plan_source, ''), 'missing')
         ORDER BY rows DESC, audit_plan_source`,
        where.values
    );
    return result.rows.map(row => ({
        auditPlanSource: row.audit_plan_source,
        rows: Number(row.rows || 0)
    }));
}

async function loadIssueMatrix(client, options) {
    const where = scopeWhere(options);
    const result = await client.query(
        `${candidateCte(where, options.categories)}
         SELECT issue,
                COUNT(*)::int AS issue_rows,
                COUNT(DISTINCT id)::int AS distinct_records,
                COUNT(DISTINCT staff_id)::int AS distinct_staff,
                MIN(record_date)::text AS min_date,
                MAX(record_date)::text AS max_date
         FROM candidates
         GROUP BY issue
         ORDER BY issue`,
        where.values
    );
    return result.rows.map(row => ({
        issue: row.issue,
        issueRows: Number(row.issue_rows || 0),
        distinctRecords: Number(row.distinct_records || 0),
        distinctStaff: Number(row.distinct_staff || 0),
        minDate: row.min_date || null,
        maxDate: row.max_date || null
    }));
}

async function loadPayrollImpact(client, options) {
    const hasReports = await tableExists(client, 'payroll_reports');
    const hasInstallments = await tableExists(client, 'payroll_installments');
    const hasMovements = await tableExists(client, 'payroll_payment_movements');
    const hasLocks = await tableExists(client, 'payroll_period_locks');
    if (!hasReports) {
        return {
            payrollReportsTablePresent: false,
            payrollInstallmentsTablePresent: hasInstallments,
            payrollPaymentMovementsTablePresent: hasMovements,
            payrollPeriodLocksTablePresent: hasLocks,
            periods: []
        };
    }
    const where = scopeWhere(options);
    const lockJoin = hasLocks
        ? 'LEFT JOIN payroll_period_locks pl ON pl.period_month = ps.period_month'
        : 'LEFT JOIN (SELECT NULL::varchar AS period_month, false::boolean AS is_locked, NULL::timestamptz AS locked_at) pl ON false';
    const result = await client.query(
        `${candidateCte(where, options.categories)},
         dedup AS (
            SELECT DISTINCT id, staff_id, period_month
            FROM candidates
         ),
         period_stats AS (
            SELECT period_month,
                   COUNT(DISTINCT id)::int AS candidate_records,
                   COUNT(DISTINCT staff_id)::int AS candidate_staff
            FROM dedup
            GROUP BY period_month
         ),
         report_stats AS (
            SELECT d.period_month,
                   COUNT(DISTINCT pr.id)::int AS payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE pr.voided_at IS NULL
                          AND pr.status IN ('reviewed', 'approved', 'paid')
                   )::int AS closed_payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE pr.voided_at IS NULL
                          AND pr.status = 'paid'
                   )::int AS paid_payroll_reports
            FROM dedup d
            LEFT JOIN payroll_reports pr
                   ON pr.period_month = d.period_month
                  AND pr.staff_id = d.staff_id
            GROUP BY d.period_month
         )
         SELECT ps.period_month,
                ps.candidate_records,
                ps.candidate_staff,
                COALESCE(pl.is_locked, false) AS payroll_period_locked,
                (pl.locked_at IS NOT NULL) AS has_lock_timestamp,
                COALESCE(rs.payroll_reports, 0)::int AS payroll_reports,
                COALESCE(rs.closed_payroll_reports, 0)::int AS closed_payroll_reports,
                COALESCE(rs.paid_payroll_reports, 0)::int AS paid_payroll_reports
         FROM period_stats ps
         ${lockJoin}
         LEFT JOIN report_stats rs ON rs.period_month = ps.period_month
         ORDER BY ps.period_month`,
        where.values
    );
    const statusRows = await client.query(
        `${candidateCte(where, options.categories)},
         dedup AS (
            SELECT DISTINCT staff_id, period_month
            FROM candidates
         )
         SELECT pr.period_month,
                COALESCE(pr.status, 'missing') AS status,
                COUNT(DISTINCT pr.id)::int AS reports
         FROM dedup d
         JOIN payroll_reports pr
              ON pr.period_month = d.period_month
             AND pr.staff_id = d.staff_id
         WHERE pr.voided_at IS NULL
         GROUP BY pr.period_month, COALESCE(pr.status, 'missing')
         ORDER BY pr.period_month, status`,
        where.values
    );
    const statusesByMonth = new Map();
    for (const row of statusRows.rows) {
        const month = row.period_month;
        if (!statusesByMonth.has(month)) statusesByMonth.set(month, {});
        statusesByMonth.get(month)[row.status] = Number(row.reports || 0);
    }
    const outstandingByMonth = new Map();
    if (hasInstallments && hasMovements) {
        const outstandingRows = await client.query(
            `${candidateCte(where, options.categories)},
             dedup AS (
                SELECT DISTINCT staff_id, period_month
                FROM candidates
             ),
             installments AS (
                SELECT pr.period_month,
                       pi.id,
                       GREATEST(COALESCE(pi.locked_amount, 0), 0)::numeric AS due_amount
                FROM dedup d
                JOIN payroll_reports pr
                     ON pr.period_month = d.period_month
                    AND pr.staff_id = d.staff_id
                JOIN payroll_installments pi ON pi.payroll_report_id = pr.id
                WHERE pr.voided_at IS NULL
                  AND COALESCE(pr.settlement_model, 'legacy_v1') = 'installments_v1'
                  AND pi.workflow_status = 'approved'
             ),
             movement_totals AS (
                SELECT ppm.installment_id,
                       COALESCE(SUM(ppm.amount) FILTER (WHERE ppm.movement_type = 'payment'), 0)::numeric AS payments,
                       COALESCE(SUM(ppm.amount) FILTER (WHERE ppm.movement_type = 'reversal'), 0)::numeric AS reversals
                FROM payroll_payment_movements ppm
                JOIN installments i ON i.id = ppm.installment_id
                GROUP BY ppm.installment_id
             ),
             balances AS (
                SELECT i.period_month,
                       GREATEST(i.due_amount - GREATEST(COALESCE(mt.payments, 0) - COALESCE(mt.reversals, 0), 0), 0)::numeric AS outstanding_amount
                FROM installments i
                LEFT JOIN movement_totals mt ON mt.installment_id = i.id
             )
             SELECT period_month,
                    COUNT(*) FILTER (WHERE outstanding_amount > 0)::int AS outstanding_installments,
                    COALESCE(SUM(outstanding_amount) FILTER (WHERE outstanding_amount > 0), 0)::numeric AS outstanding_amount
             FROM balances
             GROUP BY period_month`,
            where.values
        );
        for (const row of outstandingRows.rows) {
            outstandingByMonth.set(row.period_month, {
                outstandingInstallments: Number(row.outstanding_installments || 0),
                outstandingInstallmentAmount: Number(row.outstanding_amount || 0)
            });
        }
    }
    return {
        payrollReportsTablePresent: true,
        payrollInstallmentsTablePresent: hasInstallments,
        payrollPaymentMovementsTablePresent: hasMovements,
        payrollPeriodLocksTablePresent: hasLocks,
        periods: result.rows.map(row => ({
            month: row.period_month,
            candidateRecords: Number(row.candidate_records || 0),
            candidateStaff: Number(row.candidate_staff || 0),
            payrollPeriodLocked: row.payroll_period_locked === true,
            hasLockTimestamp: row.has_lock_timestamp === true,
            payrollReports: Number(row.payroll_reports || 0),
            closedPayrollReports: Number(row.closed_payroll_reports || 0),
            paidPayrollReports: Number(row.paid_payroll_reports || 0),
            outstandingInstallments: outstandingByMonth.get(row.period_month)?.outstandingInstallments || 0,
            outstandingInstallmentAmount: outstandingByMonth.get(row.period_month)?.outstandingInstallmentAmount || 0,
            payrollReportStatuses: statusesByMonth.get(row.period_month) || {}
        }))
    };
}

function riskFromPayrollImpact(payrollImpact) {
    const periods = payrollImpact.periods || [];
    if (periods.some(period => period.payrollPeriodLocked || period.paidPayrollReports > 0 || period.outstandingInstallments > 0)) return 'high';
    if (periods.some(period => period.closedPayrollReports > 0)) return 'medium';
    if (periods.some(period => period.payrollReports > 0)) return 'low';
    return 'none_detected';
}

async function runAudit(options) {
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

        const overview = await loadOverview(client, options);
        const metricLoaders = {
            [CATEGORY_LATE_GRACE]: () => loadMetric(client, options, 'late_status_within_grace', "status = 'late' AND late_minutes BETWEEN 1 AND 5"),
            [CATEGORY_OVERTIME_GRACE]: () => loadMetric(client, options, 'overtime_within_grace', 'COALESCE(overtime_minutes, 0) BETWEEN 1 AND 15'),
            [CATEGORY_NULL_ZERO_NEGATIVE_LATE]: () => loadMetric(client, options, 'null_zero_negative_late', "status = 'late' AND (late_minutes IS NULL OR late_minutes = 0 OR late_minutes < 0)"),
            [CATEGORY_MISSING_PLAN_SOURCE]: () => loadMetric(
                client,
                options,
                'missing_or_invalid_audit_plan_source',
                "clock_in IS NOT NULL AND (audit_plan_source IS NULL OR audit_plan_source NOT IN ('hr_shift', 'profession_card', 'unscheduled', 'attendance_snapshot'))"
            ),
            [CATEGORY_INFERRED_PROFESSION_CARD]: () => loadMetric(
                client,
                options,
                'inferred_profession_card',
                'hr_shift_id IS NULL AND planned_start IS NOT NULL AND planned_end IS NOT NULL'
            )
        };
        const metrics = [];
        for (const category of options.categories) {
            metrics.push(await metricLoaders[category]());
        }
        const payrollImpact = await loadPayrollImpact(client, options);
        const report = {
            generatedAt: new Date().toISOString(),
            mode: 'read_only',
            filters: {
                from: options.from || null,
                to: options.to || null,
                businessContext: options.businessContext || null,
                categories: options.categories
            },
            overview,
            metrics,
            auditPlanSourceBreakdown: await loadAuditSourceBreakdown(client, options),
            inferredProfessionCardAuditBreakdown: await loadInferredProfessionBreakdown(client, options),
            issueMatrix: await loadIssueMatrix(client, options),
            payrollImpact: {
                ...payrollImpact,
                risk: riskFromPayrollImpact(payrollImpact)
            },
            writeMode: {
                supported: false,
                note: 'This script never updates attendance, audit, payroll, or any other table.'
            }
        };
        await client.query('ROLLBACK');
        return report;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

function markdownMetric(metric) {
    return `| ${metric.key} | ${metric.rows} | ${metric.distinctStaff} | ${metric.minDate || '—'} | ${metric.maxDate || '—'} |`;
}

function renderMarkdown(report) {
    const lines = [
        '# Historical attendance read-only impact audit',
        '',
        `Generated: ${report.generatedAt}`,
        `Mode: ${report.mode}`,
        `Filters: from=${report.filters.from || 'all'}, to=${report.filters.to || 'all'}, businessContext=${report.filters.businessContext || 'all'}, categories=${(report.filters.categories || []).join(', ') || 'all'}`,
        '',
        '## Overview',
        '',
        `- Total attendance rows: ${report.overview.totalRows}`,
        `- Rows with clock-in: ${report.overview.rowsWithClockIn}`,
        `- Rows with clock-out: ${report.overview.rowsWithClockOut}`,
        `- Distinct staff: ${report.overview.distinctStaff}`,
        `- Date range: ${report.overview.minDate || '—'} to ${report.overview.maxDate || '—'}`,
        '',
        '## Metrics',
        '',
        '| Metric | Rows | Staff | Min date | Max date |',
        '| --- | ---: | ---: | --- | --- |',
        ...report.metrics.map(markdownMetric),
        '',
        '## Payroll impact',
        '',
        `Risk: ${report.payrollImpact.risk}`,
        '',
        '| Month | Candidate records | Staff | Period locked | Payroll reports | Closed reports | Paid reports |',
        '| --- | ---: | ---: | --- | ---: | ---: | ---: |',
        ...report.payrollImpact.periods.map(period => (
            `| ${period.month} | ${period.candidateRecords} | ${period.candidateStaff} | ${period.payrollPeriodLocked ? 'yes' : 'no'} | ${period.payrollReports} | ${period.closedPayrollReports} | ${period.paidPayrollReports} |`
        )),
        '',
        'Write mode: unsupported. This is a read-only audit only.'
    ];
    return lines.join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    const report = await runAudit(options);
    if (options.format === 'markdown') console.log(renderMarkdown(report));
    else console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(`attendance historical audit failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    CATEGORY_LATE_GRACE,
    CATEGORY_NULL_ZERO_NEGATIVE_LATE,
    CATEGORY_OVERTIME_GRACE,
    candidateCte,
    normalizeCategories,
    parseArgs,
    poolConfig,
    runAudit,
    renderMarkdown
};
