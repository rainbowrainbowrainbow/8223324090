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
const BLOCKED_FLAGS = new Set(['--apply', '--fix', '--write', '--execute', '--update']);

function usage() {
    return [
        'Usage:',
        '  node scripts/audit-attendance-historical-impact.js [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--business-context key] [--format json|markdown]',
        '',
        'Connection:',
        '  ATTENDANCE_AUDIT_DATABASE_URL, PRODUCTION_READONLY_DATABASE_URL, DATABASE_URL, or PG* environment variables.',
        '',
        'Safety:',
        '  Read-only only. --apply/--fix/--write/--execute/--update are refused.'
    ].join('\n');
}

function parseArgs(argv) {
    const options = {
        from: '',
        to: '',
        businessContext: '',
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
    return options;
}

function poolConfig() {
    const connectionString = process.env.ATTENDANCE_AUDIT_DATABASE_URL
        || process.env.PRODUCTION_READONLY_DATABASE_URL
        || process.env.DATABASE_URL
        || '';
    if (connectionString) {
        return {
            connectionString,
            ssl: { rejectUnauthorized: false },
            application_name: 'attendance_historical_readonly_audit'
        };
    }
    if (!process.env.PGDATABASE) {
        throw new Error('Set ATTENDANCE_AUDIT_DATABASE_URL, PRODUCTION_READONLY_DATABASE_URL, DATABASE_URL, or PGDATABASE/PG* before running the audit');
    }
    return {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
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

function candidateCte(where) {
    return `${baseScopedCte(where)},
        candidates AS (
            SELECT id, staff_id, record_date, period_month, 'late_status_within_grace' AS issue
            FROM audited
            WHERE status = 'late' AND COALESCE(late_minutes, 0) <= 5
            UNION ALL
            SELECT id, staff_id, record_date, period_month, 'overtime_within_grace' AS issue
            FROM audited
            WHERE COALESCE(overtime_minutes, 0) BETWEEN 1 AND 15
            UNION ALL
            SELECT id, staff_id, record_date, period_month, 'missing_audit_plan_source' AS issue
            FROM audited
            WHERE clock_in IS NOT NULL
              AND (
                    audit_plan_source IS NULL
                    OR audit_plan_source NOT IN ('hr_shift', 'profession_card', 'unscheduled', 'attendance_snapshot')
              )
            UNION ALL
            SELECT id, staff_id, record_date, period_month, 'inferred_profession_card' AS issue
            FROM audited
            WHERE hr_shift_id IS NULL
              AND planned_start IS NOT NULL
              AND planned_end IS NOT NULL
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
        `${candidateCte(where)}
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
    const hasLocks = await tableExists(client, 'payroll_period_locks');
    if (!hasReports) {
        return {
            payrollReportsTablePresent: false,
            payrollPeriodLocksTablePresent: hasLocks,
            periods: []
        };
    }
    const where = scopeWhere(options);
    const lockJoin = hasLocks
        ? 'LEFT JOIN payroll_period_locks pl ON pl.period_month = ps.period_month'
        : 'LEFT JOIN (SELECT NULL::varchar AS period_month, false::boolean AS is_locked, NULL::timestamptz AS locked_at) pl ON false';
    const result = await client.query(
        `${candidateCte(where)},
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
        `${candidateCte(where)},
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
    return {
        payrollReportsTablePresent: true,
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
            payrollReportStatuses: statusesByMonth.get(row.period_month) || {}
        }))
    };
}

function riskFromPayrollImpact(payrollImpact) {
    const periods = payrollImpact.periods || [];
    if (periods.some(period => period.payrollPeriodLocked || period.paidPayrollReports > 0)) return 'high';
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
        const metrics = [
            await loadMetric(client, options, 'late_status_within_grace', "status = 'late' AND COALESCE(late_minutes, 0) <= 5"),
            await loadMetric(client, options, 'overtime_within_grace', 'COALESCE(overtime_minutes, 0) BETWEEN 1 AND 15'),
            await loadMetric(
                client,
                options,
                'missing_or_invalid_audit_plan_source',
                "clock_in IS NOT NULL AND (audit_plan_source IS NULL OR audit_plan_source NOT IN ('hr_shift', 'profession_card', 'unscheduled', 'attendance_snapshot'))"
            ),
            await loadMetric(
                client,
                options,
                'inferred_profession_card',
                'hr_shift_id IS NULL AND planned_start IS NOT NULL AND planned_end IS NOT NULL'
            )
        ];
        const payrollImpact = await loadPayrollImpact(client, options);
        const report = {
            generatedAt: new Date().toISOString(),
            mode: 'read_only',
            filters: {
                from: options.from || null,
                to: options.to || null,
                businessContext: options.businessContext || null
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
        `Filters: from=${report.filters.from || 'all'}, to=${report.filters.to || 'all'}, businessContext=${report.filters.businessContext || 'all'}`,
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
    parseArgs,
    runAudit,
    renderMarkdown
};
