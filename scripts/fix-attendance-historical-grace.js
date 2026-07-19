#!/usr/bin/env node
'use strict';

/**
 * Historical attendance grace data-fix.
 *
 * Default mode is dry-run. Apply mode is intentionally hard to run:
 * - explicit date range is required;
 * - only late-grace and overtime-grace categories are supported;
 * - locked/closed/paid payroll periods fail closed;
 * - an apply run needs the current dry-run plan hash as --review-token;
 * - an exact typed --confirm string is required;
 * - a backup export is written before any UPDATE.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const SCRIPT_VERSION = 3;
const BACKUP_FORMAT_VERSION = 2;
const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const MAX_APPLY_DAYS = 31;
const DEFAULT_MAX_RECORDS = 500;
const DEFAULT_MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const MANIFEST_TTL_HOURS = 24;
const AUDIT_ACTOR_MAX_LENGTH = 50;
const APPLY_LOCK_TIMEOUT = '5s';
const APPLY_STATEMENT_TIMEOUT = '45s';
const CATEGORY_LATE_GRACE = 'late-grace';
const CATEGORY_OVERTIME_GRACE = 'overtime-grace';
const CATEGORY_NULL_ZERO_NEGATIVE_LATE = 'null-zero-negative-late';
const SUPPORTED_CATEGORIES = new Set([CATEGORY_LATE_GRACE, CATEGORY_OVERTIME_GRACE]);
const UNSUPPORTED_WRITE_CATEGORIES = new Set(['missing-plan-source', 'inferred-profession-card']);
const PROTECTED_PAYROLL_STATUSES = new Set(['reviewed', 'approved', 'paid']);
const PAYROLL_GATE_TABLES = Object.freeze([
    'payroll_reports',
    'payroll_period_locks',
    'payroll_entries',
    'salary_adjustments',
    'finance_transactions'
]);
const BLOCKED_WRITE_FLAGS = new Set(['--fix', '--write', '--execute', '--update']);
const ROOT = path.resolve(__dirname, '..');

function usage() {
    return [
        'Usage:',
        '  node scripts/fix-attendance-historical-grace.js --from YYYY-MM-DD --to YYYY-MM-DD --business-context event_genix --approved-by "Director / Serhii" --executed-by "operator" --reason "reports_only" --categories "late-grace,overtime-grace" [--max-records 500] [--max-backup-bytes 26214400] [--format json|markdown]',
        '',
        'Dry-run is default and uses BEGIN READ ONLY.',
        '',
        'Apply, only after owner review of the current dry-run output:',
        '  node scripts/fix-attendance-historical-grace.js --apply --from YYYY-MM-DD --to YYYY-MM-DD --business-context event_genix --approved-by "Director / Serhii" --executed-by "operator" --reason "reports_only" --categories "late-grace,overtime-grace" --review-token <dry-run-plan-hash> --backup-dir <absolute-dir-outside-repo> --confirm <exact-confirmation>',
        '',
        'Connection:',
        '  Dry-run: ATTENDANCE_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL only.',
        '  Apply: ATTENDANCE_DATA_FIX_DATABASE_URL only.',
        '',
        'Supported categories:',
        '  late-grace      status=late with late_minutes 1..5 => late_minutes=0 and legacy status recalculated',
        '  overtime-grace  overtime_minutes 1..15 => overtime_minutes=0',
        '',
        'Read-only audit bucket, never write-mode:',
        '  null-zero-negative-late  status=late with late_minutes NULL, 0, or negative',
        '',
        'Unsupported write categories:',
        '  missing-plan-source, inferred-profession-card'
    ].join('\n');
}

function normalizeDate(value, label) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be YYYY-MM-DD`);
    const date = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        throw new Error(`${label} must be a real calendar date`);
    }
    return text;
}

function dateRangeDays(from, to) {
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    return Math.floor((end - start) / 86400000) + 1;
}

function normalizeBusinessContext(value) {
    const text = String(value || '').trim() || DEFAULT_BUSINESS_CONTEXT;
    if (!/^[a-z0-9_-]{2,64}$/i.test(text)) throw new Error('--business-context must be a 2-64 char key');
    if (text.toLowerCase() === 'reports_only') {
        throw new Error('--business-context reports_only is invalid; use --business-context event_genix and put reports_only in --reason');
    }
    return text;
}

function defaultExecutedBy() {
    return String(process.env.USERNAME || process.env.USER || 'codex_operator').trim();
}

function normalizeActor(value, label) {
    const text = String(value || '').trim();
    if (!text) throw new Error(`${label} is required`);
    if (text.length > AUDIT_ACTOR_MAX_LENGTH) {
        throw new Error(`${label} must be ${AUDIT_ACTOR_MAX_LENGTH} characters or less`);
    }
    return text;
}

function normalizeMaxRecords(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_MAX_RECORDS;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 10000) {
        throw new Error('--max-records must be an integer from 1 to 10000');
    }
    return number;
}

function normalizeMaxBackupBytes(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_MAX_BACKUP_BYTES;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1024 || number > 512 * 1024 * 1024) {
        throw new Error('--max-backup-bytes must be an integer from 1024 to 536870912');
    }
    return number;
}

function normalizeCategory(value) {
    const text = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (['late', 'late-grace-mismatch', 'late-status-within-grace'].includes(text)) return CATEGORY_LATE_GRACE;
    if (['overtime', 'overtime-grace-mismatch', 'overtime-within-grace'].includes(text)) return CATEGORY_OVERTIME_GRACE;
    if (['null-zero-negative-late', 'null-late', 'zero-late', 'negative-late'].includes(text)) return CATEGORY_NULL_ZERO_NEGATIVE_LATE;
    if (['missing-audit-plan-source', 'missing-plan-source', 'plan-source'].includes(text)) return 'missing-plan-source';
    if (['inferred-profession-card', 'profession-card-inference'].includes(text)) return 'inferred-profession-card';
    return text;
}

function normalizeCategories(values) {
    const raw = values.flatMap(value => String(value || '').split(',')).map(normalizeCategory).filter(Boolean);
    const categories = [...new Set(raw)];
    if (!categories.length) throw new Error('At least one --category or --categories value is required');
    if (categories.includes(CATEGORY_NULL_ZERO_NEGATIVE_LATE)) {
        throw new Error('null-zero-negative-late is read-only audit only and requires separate owner approval before any write-mode tooling');
    }
    const unsupported = categories.filter(category => UNSUPPORTED_WRITE_CATEGORIES.has(category));
    if (unsupported.length) {
        throw new Error(`Write-mode is not implemented for: ${unsupported.join(', ')}. Run read-only audit/decision note instead.`);
    }
    const unknown = categories.filter(category => !SUPPORTED_CATEGORIES.has(category));
    if (unknown.length) throw new Error(`Unsupported category: ${unknown.join(', ')}`);
    return categories.sort();
}

function expectedApplyConfirmation(options) {
    return [
        'APPLY_ATTENDANCE_HISTORICAL_FIX',
        options.from,
        options.to,
        options.businessContext.toUpperCase(),
        options.categories.map(category => category.toUpperCase()).join('_')
    ].join('_');
}

function parseArgs(argv) {
    const options = {
        apply: false,
        dryRun: true,
        from: '',
        to: '',
        businessContext: '',
        approvedBy: '',
        executedBy: '',
        reason: '',
        categories: [],
        categoryInputs: [],
        reviewToken: '',
        confirm: '',
        backupDir: '',
        maxRecords: DEFAULT_MAX_RECORDS,
        maxBackupBytes: DEFAULT_MAX_BACKUP_BYTES,
        format: 'json',
        output: ''
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const readValue = name => {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
            index += 1;
            return value.trim();
        };
        const readValues = name => {
            const values = [];
            while (argv[index + 1] && !argv[index + 1].startsWith('--')) {
                index += 1;
                values.push(String(argv[index]).trim());
            }
            if (!values.length) throw new Error(`${name} requires a value`);
            return values;
        };
        if (arg === '--help' || arg === '-h') options.help = true;
        else if (BLOCKED_WRITE_FLAGS.has(arg)) {
            throw new Error(`${arg} is not supported. Use --apply only after reviewed dry-run approval.`);
        }
        else if (arg === '--dry-run') {
            options.apply = false;
            options.dryRun = true;
        } else if (arg === '--apply') {
            options.apply = true;
            options.dryRun = false;
        } else if (arg === '--from') options.from = readValue(arg);
        else if (arg === '--to') options.to = readValue(arg);
        else if (arg === '--business-context') options.businessContext = readValue(arg);
        else if (arg === '--owner' || arg === '--approved-by') options.approvedBy = readValue(arg);
        else if (arg === '--executed-by') options.executedBy = readValue(arg);
        else if (arg === '--reason' || arg === '--business-reason') options.reason = readValue(arg);
        else if (arg === '--category') options.categoryInputs.push(...readValues(arg));
        else if (arg === '--categories') options.categoryInputs.push(...readValues(arg));
        else if (arg === '--review-token') options.reviewToken = readValue(arg);
        else if (arg === '--confirm') options.confirm = readValue(arg);
        else if (arg === '--backup-dir') options.backupDir = readValue(arg);
        else if (arg === '--max-records') options.maxRecords = readValue(arg);
        else if (arg === '--max-backup-bytes') options.maxBackupBytes = readValue(arg);
        else if (arg === '--format') options.format = readValue(arg).toLowerCase();
        else if (arg === '--output') options.output = readValue(arg);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.help) return options;
    options.from = normalizeDate(options.from, '--from');
    options.to = normalizeDate(options.to, '--to');
    if (options.from > options.to) throw new Error('--from must be before or equal to --to');
    options.businessContext = normalizeBusinessContext(options.businessContext);
    options.approvedBy = normalizeActor(options.approvedBy, '--approved-by/--owner');
    options.executedBy = normalizeActor(options.executedBy || defaultExecutedBy(), '--executed-by');
    options.owner = options.approvedBy;
    options.reason = String(options.reason || '').trim();
    if (!options.reason) throw new Error('--reason is required');
    options.categories = normalizeCategories(options.categoryInputs);
    options.maxRecords = normalizeMaxRecords(options.maxRecords);
    options.maxBackupBytes = normalizeMaxBackupBytes(options.maxBackupBytes);
    if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be json or markdown');
    if (options.apply) {
        if (dateRangeDays(options.from, options.to) > MAX_APPLY_DAYS) {
            throw new Error(`--apply date range must be ${MAX_APPLY_DAYS} days or less`);
        }
        if (!options.backupDir) throw new Error('--backup-dir is required for --apply');
        if (!options.reviewToken) throw new Error('--review-token from the reviewed dry-run is required for --apply');
        const expected = expectedApplyConfirmation(options);
        if (options.confirm !== expected) {
            throw new Error(`--confirm must exactly equal: ${expected}`);
        }
    }
    return options;
}

function poolConfig(options) {
    const connectionString = options.apply
        ? process.env.ATTENDANCE_DATA_FIX_DATABASE_URL
        : (
            process.env.ATTENDANCE_AUDIT_DATABASE_URL
            || process.env.PRODUCTION_READONLY_DATABASE_URL
            || ''
        );
    if (connectionString) {
        return {
            connectionString,
            ssl: sslConfigForConnectionString(connectionString),
            application_name: options.apply
                ? 'attendance_historical_grace_data_fix_apply'
                : 'attendance_historical_grace_data_fix_dry_run'
        };
    }
    if (options.apply) {
        throw new Error('Set ATTENDANCE_DATA_FIX_DATABASE_URL before --apply');
    }
    throw new Error('Set ATTENDANCE_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL before dry-run. Generic DATABASE_URL, ATTENDANCE_DATA_FIX_DATABASE_URL, and PG* are refused for dry-run.');
}

function sslConfigForConnectionString(connectionString) {
    try {
        const parsed = new URL(connectionString);
        const hostname = parsed.hostname.toLowerCase();
        const sslMode = String(parsed.searchParams.get('sslmode') || '').toLowerCase();
        if (sslMode === 'disable') return false;
        if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return false;
    } catch (_) {
        // If parsing fails, keep the safer remote default and let pg report the connection error.
    }
    return { rejectUnauthorized: false };
}

function categorySql(categories, alias = 'tr') {
    const clauses = [];
    if (categories.includes(CATEGORY_LATE_GRACE)) {
        clauses.push(`(${alias}.status = 'late' AND ${alias}.late_minutes BETWEEN 1 AND 5)`);
    }
    if (categories.includes(CATEGORY_OVERTIME_GRACE)) {
        clauses.push(`(COALESCE(${alias}.overtime_minutes, 0) BETWEEN 1 AND 15)`);
    }
    return clauses.join(' OR ') || 'false';
}

function candidateSelectSql(options, { forUpdate = false } = {}) {
    const lateFlag = options.categories.includes(CATEGORY_LATE_GRACE)
        ? `(tr.status = 'late' AND tr.late_minutes BETWEEN 1 AND 5)`
        : 'false';
    const overtimeFlag = options.categories.includes(CATEGORY_OVERTIME_GRACE)
        ? `(COALESCE(tr.overtime_minutes, 0) BETWEEN 1 AND 15)`
        : 'false';
    return `
        SELECT tr.id,
               tr.staff_id,
               tr.record_date::text AS record_date,
               COALESCE(tr.business_context, 'event_genix') AS business_context,
               tr.clock_in::text AS clock_in,
               tr.clock_out::text AS clock_out,
               tr.planned_start::text AS planned_start,
               tr.planned_end::text AS planned_end,
               tr.status,
               tr.late_minutes::int AS late_minutes,
               tr.early_leave_minutes::int AS early_leave_minutes,
               tr.overtime_minutes::int AS overtime_minutes,
               COALESCE(tr.total_worked_minutes, 0)::int AS total_worked_minutes,
               tr.updated_at::text AS updated_at,
               (${lateFlag}) AS fix_late_grace,
               (${overtimeFlag}) AS fix_overtime_grace
          FROM hr_time_records tr
         WHERE tr.record_date >= $1::date
           AND tr.record_date <= $2::date
           AND COALESCE(tr.business_context, 'event_genix') = $3
           AND (${categorySql(options.categories, 'tr')})
         ORDER BY tr.record_date, tr.staff_id, tr.id
         ${forUpdate ? 'FOR UPDATE' : ''}
    `;
}

function nullableInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : null;
}

function nullableText(value) {
    if (value === null || value === undefined) return null;
    return String(value);
}

function planChange(row) {
    const before = {
        status: row.status ?? null,
        late_minutes: nullableInteger(row.late_minutes),
        early_leave_minutes: nullableInteger(row.early_leave_minutes),
        overtime_minutes: nullableInteger(row.overtime_minutes)
    };
    const categories = [];
    if (row.fix_late_grace === true) categories.push(CATEGORY_LATE_GRACE);
    if (row.fix_overtime_grace === true) categories.push(CATEGORY_OVERTIME_GRACE);
    let nextStatus = before.status;
    const nextLate = row.fix_late_grace === true ? 0 : before.late_minutes;
    const nextOvertime = row.fix_overtime_grace === true ? 0 : before.overtime_minutes;
    if (row.fix_late_grace === true) {
        if (Number(nextLate || 0) > 5) nextStatus = 'late';
        else if (Number(before.early_leave_minutes || 0) > 0) nextStatus = 'early_leave';
        else if (['late', 'early_leave', 'present', 'unscheduled', 'clocked_in', 'overtime'].includes(nextStatus)) {
            nextStatus = 'present';
        } else {
            nextStatus = nextStatus || 'present';
        }
    }
    const after = {
        status: nextStatus,
        late_minutes: nextLate,
        early_leave_minutes: before.early_leave_minutes,
        overtime_minutes: nextOvertime
    };
    return {
        id: Number(row.id),
        staff_id: Number(row.staff_id),
        record_date: row.record_date,
        business_context: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        immutable: {
            clock_in: nullableText(row.clock_in),
            clock_out: nullableText(row.clock_out),
            planned_start: nullableText(row.planned_start),
            planned_end: nullableText(row.planned_end),
            total_worked_minutes: nullableInteger(row.total_worked_minutes)
        },
        categories,
        before,
        after,
        changed: before.status !== after.status
            || before.late_minutes !== after.late_minutes
            || before.overtime_minutes !== after.overtime_minutes
    };
}

async function tableExists(client, tableName) {
    const result = await client.query('SELECT to_regclass($1) AS relation', [`public.${tableName}`]);
    return Boolean(result.rows[0]?.relation);
}

async function tableColumns(client, tableName) {
    const result = await client.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1`,
        [tableName]
    );
    return new Set(result.rows.map(row => row.column_name));
}

async function loadCandidateChanges(client, options, flags = {}) {
    const result = await client.query(
        candidateSelectSql(options, flags),
        [options.from, options.to, options.businessContext]
    );
    const changes = result.rows.map(planChange).filter(change => change.changed);
    if (changes.length > options.maxRecords) {
        throw new Error(`Refusing to continue: ${changes.length} candidate records exceeds --max-records ${options.maxRecords}`);
    }
    if (options.apply && changes.length === 0) {
        throw new Error('Refusing --apply: current plan has 0 candidate records');
    }
    return changes;
}

async function loadReadOnlyAuditCounts(client, options) {
    const result = await client.query(
        `SELECT COUNT(*) FILTER (WHERE tr.status = 'late' AND tr.late_minutes IS NULL)::int AS late_null_minutes,
                COUNT(*) FILTER (WHERE tr.status = 'late' AND tr.late_minutes = 0)::int AS late_zero_minutes,
                COUNT(*) FILTER (WHERE tr.status = 'late' AND tr.late_minutes < 0)::int AS late_negative_minutes
           FROM hr_time_records tr
          WHERE tr.record_date >= $1::date
            AND tr.record_date <= $2::date
            AND COALESCE(tr.business_context, 'event_genix') = $3`,
        [options.from, options.to, options.businessContext]
    );
    const row = result.rows[0] || {};
    const lateNull = Number(row.late_null_minutes || 0);
    const lateZero = Number(row.late_zero_minutes || 0);
    const lateNegative = Number(row.late_negative_minutes || 0);
    return {
        [CATEGORY_NULL_ZERO_NEGATIVE_LATE]: {
            writable: false,
            reason: 'Requires APPROVE ADDITIONAL HISTORICAL ATTENDANCE CATEGORY before any write-mode tooling',
            totalRows: lateNull + lateZero + lateNegative,
            lateNullMinutes: lateNull,
            lateZeroMinutes: lateZero,
            lateNegativeMinutes: lateNegative
        }
    };
}

async function loadPayrollImpact(client, changes) {
    const hasReports = await tableExists(client, 'payroll_reports');
    const hasLocks = await tableExists(client, 'payroll_period_locks');
    const hasEntries = await tableExists(client, 'payroll_entries');
    const hasSalaryAdjustments = await tableExists(client, 'salary_adjustments');
    const hasFinanceTransactions = await tableExists(client, 'finance_transactions');
    if (!changes.length) {
        return {
            payrollReportsTablePresent: hasReports,
            payrollPeriodLocksTablePresent: hasLocks,
            payrollEntriesTablePresent: hasEntries,
            salaryAdjustmentsTablePresent: hasSalaryAdjustments,
            financeTransactionsTablePresent: hasFinanceTransactions,
            risk: hasReports && hasLocks ? 'none_detected' : 'unknown_schema',
            periods: []
        };
    }
    const ids = changes.map(change => change.id);
    if (!hasReports) {
        return {
            payrollReportsTablePresent: false,
            payrollPeriodLocksTablePresent: hasLocks,
            payrollEntriesTablePresent: hasEntries,
            salaryAdjustmentsTablePresent: hasSalaryAdjustments,
            financeTransactionsTablePresent: hasFinanceTransactions,
            risk: 'unknown_schema',
            periods: []
        };
    }
    const reportColumns = await tableColumns(client, 'payroll_reports');
    const activeReportPredicate = [
        reportColumns.has('voided_at') ? 'pr.voided_at IS NULL' : 'true',
        "COALESCE(pr.status, 'draft') NOT IN ('voided', 'reversed')"
    ].join(' AND ');
    const committedPredicate = reportColumns.has('committed_at')
        ? 'pr.committed_at IS NOT NULL'
        : 'false';
    const financeLinkedParts = [];
    if (reportColumns.has('finance_transaction_id')) financeLinkedParts.push('pr.finance_transaction_id IS NOT NULL');
    if (reportColumns.has('reversal_transaction_id')) financeLinkedParts.push('pr.reversal_transaction_id IS NOT NULL');
    const financeLinkedPredicate = financeLinkedParts.length ? financeLinkedParts.join(' OR ') : 'false';
    const lockJoin = hasLocks
        ? 'LEFT JOIN payroll_period_locks pl ON pl.period_month = ps.period_month'
        : 'LEFT JOIN (SELECT NULL::varchar AS period_month, false::boolean AS is_locked, NULL::timestamptz AS locked_at) pl ON false';
    const result = await client.query(
        `WITH candidates AS (
            SELECT id, staff_id, to_char(record_date, 'YYYY-MM') AS period_month
              FROM hr_time_records
             WHERE id = ANY($1::int[])
         ),
         period_stats AS (
            SELECT period_month,
                   COUNT(DISTINCT id)::int AS candidate_records,
                   COUNT(DISTINCT staff_id)::int AS candidate_staff
              FROM candidates
             GROUP BY period_month
         ),
         report_stats AS (
            SELECT c.period_month,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE ${activeReportPredicate}
                   )::int AS payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE ${activeReportPredicate}
                          AND pr.status = 'draft'
                   )::int AS draft_payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE ${activeReportPredicate}
                          AND pr.status = 'reviewed'
                   )::int AS reviewed_payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE ${activeReportPredicate}
                          AND pr.status = 'approved'
                   )::int AS approved_payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE ${activeReportPredicate}
                          AND pr.status IN ('reviewed', 'approved', 'paid')
                   )::int AS closed_payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE ${activeReportPredicate}
                          AND pr.status = 'paid'
                   )::int AS paid_payroll_reports
                  ,COUNT(DISTINCT pr.id) FILTER (
                        WHERE ${activeReportPredicate}
                          AND (${committedPredicate})
                   )::int AS committed_payroll_reports
                  ,COUNT(DISTINCT pr.id) FILTER (
                        WHERE ${activeReportPredicate}
                          AND (${financeLinkedPredicate})
                   )::int AS finance_linked_payroll_reports
              FROM candidates c
              LEFT JOIN payroll_reports pr
                     ON pr.period_month = c.period_month
                    AND pr.staff_id = c.staff_id
             GROUP BY c.period_month
         )
         SELECT ps.period_month,
                ps.candidate_records,
                ps.candidate_staff,
                COALESCE(pl.is_locked, false) AS payroll_period_locked,
                (pl.locked_at IS NOT NULL) AS has_lock_timestamp,
                COALESCE(rs.payroll_reports, 0)::int AS payroll_reports,
                COALESCE(rs.draft_payroll_reports, 0)::int AS draft_payroll_reports,
                COALESCE(rs.reviewed_payroll_reports, 0)::int AS reviewed_payroll_reports,
                COALESCE(rs.approved_payroll_reports, 0)::int AS approved_payroll_reports,
                COALESCE(rs.closed_payroll_reports, 0)::int AS closed_payroll_reports,
                COALESCE(rs.paid_payroll_reports, 0)::int AS paid_payroll_reports,
                COALESCE(rs.committed_payroll_reports, 0)::int AS committed_payroll_reports,
                COALESCE(rs.finance_linked_payroll_reports, 0)::int AS finance_linked_payroll_reports
           FROM period_stats ps
           ${lockJoin}
           LEFT JOIN report_stats rs ON rs.period_month = ps.period_month
          ORDER BY ps.period_month`,
        [ids]
    );
    const periods = result.rows.map(row => ({
        month: row.period_month,
        candidateRecords: Number(row.candidate_records || 0),
        candidateStaff: Number(row.candidate_staff || 0),
        payrollPeriodLocked: row.payroll_period_locked === true,
        hasLockTimestamp: row.has_lock_timestamp === true,
        payrollReports: Number(row.payroll_reports || 0),
        draftPayrollReports: Number(row.draft_payroll_reports || 0),
        reviewedPayrollReports: Number(row.reviewed_payroll_reports || 0),
        approvedPayrollReports: Number(row.approved_payroll_reports || 0),
        closedPayrollReports: Number(row.closed_payroll_reports || 0),
        paidPayrollReports: Number(row.paid_payroll_reports || 0),
        committedPayrollReports: Number(row.committed_payroll_reports || 0),
        financeLinkedPayrollReports: Number(row.finance_linked_payroll_reports || 0),
        payrollEntries: 0,
        salaryAdjustments: 0,
        salaryFinanceTransactions: 0
    }));
    const periodMap = new Map(periods.map(period => [period.month, period]));

    async function mergeMonthlyCount(tableName, fieldName, sql) {
        if (!periods.length) return;
        const queryResult = await client.query(sql, [ids]);
        for (const row of queryResult.rows) {
            const period = periodMap.get(row.period_month);
            if (period) period[fieldName] = Number(row.row_count || 0);
        }
    }

    if (hasEntries) {
        await mergeMonthlyCount(
            'payroll_entries',
            'payrollEntries',
            `WITH candidates AS (
                SELECT id, staff_id, to_char(record_date, 'YYYY-MM') AS period_month
                  FROM hr_time_records
                 WHERE id = ANY($1::int[])
             )
             SELECT c.period_month, COUNT(DISTINCT pe.id)::int AS row_count
               FROM candidates c
               JOIN payroll_entries pe
                 ON pe.staff_id = c.staff_id
                AND pe.period_month = c.period_month
              GROUP BY c.period_month`
        );
    }
    if (hasSalaryAdjustments) {
        await mergeMonthlyCount(
            'salary_adjustments',
            'salaryAdjustments',
            `WITH candidates AS (
                SELECT id, staff_id, to_char(record_date, 'YYYY-MM') AS period_month
                  FROM hr_time_records
                 WHERE id = ANY($1::int[])
             )
             SELECT c.period_month, COUNT(DISTINCT sa.id)::int AS row_count
               FROM candidates c
               JOIN salary_adjustments sa
                 ON sa.staff_id = c.staff_id
                AND sa.month = c.period_month
              GROUP BY c.period_month`
        );
    }
    if (hasFinanceTransactions) {
        await mergeMonthlyCount(
            'finance_transactions',
            'salaryFinanceTransactions',
            `WITH candidates AS (
                SELECT id, staff_id, to_char(record_date, 'YYYY-MM') AS period_month
                  FROM hr_time_records
                 WHERE id = ANY($1::int[])
             )
             SELECT c.period_month, COUNT(DISTINCT ft.id)::int AS row_count
               FROM candidates c
               JOIN finance_transactions ft
                 ON ft.staff_id = c.staff_id
                AND LEFT(ft.date, 7) = c.period_month
                AND ft.payment_method IN ('salary', 'salary_reversal')
              GROUP BY c.period_month`
        );
    }
    return {
        payrollReportsTablePresent: true,
        payrollPeriodLocksTablePresent: hasLocks,
        payrollEntriesTablePresent: hasEntries,
        salaryAdjustmentsTablePresent: hasSalaryAdjustments,
        financeTransactionsTablePresent: hasFinanceTransactions,
        risk: hasLocks ? riskFromPayrollImpact(periods) : 'unknown_schema',
        periods
    };
}

function riskFromPayrollImpact(periods) {
    if (periods.some(period => (
        period.payrollPeriodLocked
        || period.hasLockTimestamp
        || period.paidPayrollReports > 0
        || period.approvedPayrollReports > 0
        || period.committedPayrollReports > 0
        || period.financeLinkedPayrollReports > 0
        || period.payrollEntries > 0
        || period.salaryFinanceTransactions > 0
    ))) return 'high';
    if (periods.some(period => period.closedPayrollReports > 0 || period.reviewedPayrollReports > 0 || period.salaryAdjustments > 0)) return 'medium';
    if (periods.some(period => period.payrollReports > 0)) return 'low';
    return 'none_detected';
}

function assertPayrollWriteAllowed(payrollImpact) {
    if (!payrollImpact.payrollReportsTablePresent) {
        throw new Error('Refusing --apply: payroll_reports guard table is unavailable');
    }
    if (!payrollImpact.payrollPeriodLocksTablePresent) {
        throw new Error('Refusing --apply: payroll_period_locks guard table is unavailable');
    }
    const blocked = (payrollImpact.periods || []).filter(period => (
        period.payrollPeriodLocked
        || period.hasLockTimestamp
        || period.payrollReports > 0
        || period.closedPayrollReports > 0
        || period.paidPayrollReports > 0
        || period.reviewedPayrollReports > 0
        || period.approvedPayrollReports > 0
        || period.committedPayrollReports > 0
        || period.financeLinkedPayrollReports > 0
        || period.payrollEntries > 0
        || period.salaryAdjustments > 0
        || period.salaryFinanceTransactions > 0
    ));
    if (blocked.length) {
        const months = blocked.map(period => period.month).join(', ');
        throw new Error(`Refusing --apply: protected or open payroll impact exists for ${months}`);
    }
}

function summarizeChanges(changes) {
    const byCategory = {};
    const byMonth = {};
    for (const change of changes) {
        const month = change.record_date.slice(0, 7);
        if (!byMonth[month]) byMonth[month] = { rows: 0, staff: new Set() };
        byMonth[month].rows += 1;
        byMonth[month].staff.add(change.staff_id);
        for (const category of change.categories) {
            byCategory[category] = (byCategory[category] || 0) + 1;
        }
    }
    return {
        totalRows: changes.length,
        distinctStaff: new Set(changes.map(change => change.staff_id)).size,
        byCategory,
        byMonth: Object.fromEntries(Object.entries(byMonth).map(([month, value]) => [
            month,
            { rows: value.rows, distinctStaff: value.staff.size }
        ]))
    };
}

function countOverlappingChanges(changes) {
    return changes.filter(change => (
        change.categories.includes(CATEGORY_LATE_GRACE)
        && change.categories.includes(CATEGORY_OVERTIME_GRACE)
    )).length;
}

function currentGitSha() {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch (_) {
        return null;
    }
}

function currentScriptSha256() {
    return crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
}

function dbFingerprint(identity = {}) {
    const payload = {
        databaseName: identity.databaseName || null,
        serverVersion: identity.serverVersion || null,
        serverAddress: identity.serverAddress || null,
        serverPort: identity.serverPort || null
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function loadRuntimeMetadata(client) {
    const result = await client.query(
        `SELECT current_database() AS database_name,
                current_user AS role_name,
                inet_server_addr()::text AS server_address,
                inet_server_port()::int AS server_port,
                version() AS server_version`
    );
    const row = result.rows[0] || {};
    const dbIdentity = {
        databaseName: row.database_name || null,
        roleName: row.role_name || null,
        serverAddress: row.server_address || null,
        serverPort: row.server_port === null || row.server_port === undefined ? null : Number(row.server_port),
        serverVersion: row.server_version || null
    };
    return {
        gitSha: currentGitSha(),
        scriptSha256: currentScriptSha256(),
        scriptVersion: SCRIPT_VERSION,
        dbFingerprint: dbFingerprint(dbIdentity),
        dbRole: dbIdentity.roleName
    };
}

function planHashMetadata(runtimeMetadata = {}) {
    return {
        gitSha: runtimeMetadata.gitSha || null,
        scriptSha256: runtimeMetadata.scriptSha256 || null,
        scriptVersion: runtimeMetadata.scriptVersion || SCRIPT_VERSION,
        dbFingerprint: runtimeMetadata.dbFingerprint || null
    };
}

function buildPlanHash(options, changes, payrollImpact, runtimeMetadata = {}) {
    const payload = {
        script: 'fix-attendance-historical-grace',
        scriptVersion: SCRIPT_VERSION,
        runtime: planHashMetadata(runtimeMetadata),
        from: options.from,
        to: options.to,
        businessContext: options.businessContext,
        approvedBy: options.approvedBy || options.owner,
        executedBy: options.executedBy || null,
        reason: options.reason,
        categories: options.categories,
        maxRecords: options.maxRecords,
        maxBackupBytes: options.maxBackupBytes,
        changes: changes.map(change => ({
            id: change.id,
            record_date: change.record_date,
            business_context: change.business_context,
            immutable: change.immutable,
            categories: change.categories,
            before: change.before,
            after: change.after
        })),
        payrollImpact: {
            payrollReportsTablePresent: payrollImpact.payrollReportsTablePresent,
            payrollPeriodLocksTablePresent: payrollImpact.payrollPeriodLocksTablePresent,
            payrollEntriesTablePresent: payrollImpact.payrollEntriesTablePresent,
            salaryAdjustmentsTablePresent: payrollImpact.salaryAdjustmentsTablePresent,
            financeTransactionsTablePresent: payrollImpact.financeTransactionsTablePresent,
            risk: payrollImpact.risk,
            periods: payrollImpact.periods
        }
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildApprovalManifest(options, changes, payrollImpact, runtimeMetadata, planHash, createdAt = new Date()) {
    const created = createdAt.toISOString();
    const expiresAt = new Date(createdAt.getTime() + MANIFEST_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const summary = summarizeChanges(changes);
    return {
        operationId: `attendance-grace-${options.from}-${options.to}-${planHash.slice(0, 12)}`,
        createdAt: created,
        expiresAt,
        script: 'fix-attendance-historical-grace',
        scriptVersion: SCRIPT_VERSION,
        gitSha: runtimeMetadata.gitSha || null,
        scriptSha256: runtimeMetadata.scriptSha256 || null,
        dbFingerprint: runtimeMetadata.dbFingerprint || null,
        dbRole: runtimeMetadata.dbRole || null,
        approvedBy: options.approvedBy || options.owner,
        executedBy: options.executedBy || null,
        scope: {
            from: options.from,
            to: options.to,
            businessContext: options.businessContext,
            reason: options.reason,
            categories: options.categories,
            maxRecords: options.maxRecords,
            maxBackupBytes: options.maxBackupBytes,
            lockedPaidClosedPayrollCanChange: false
        },
        categoryCounts: summary.byCategory,
        overlap: {
            lateAndOvertimeRecords: countOverlappingChanges(changes),
            protectedPayrollPeriods: (payrollImpact.periods || []).filter(period => (
                period.payrollPeriodLocked
                || period.hasLockTimestamp
                || period.payrollReports > 0
                || period.closedPayrollReports > 0
                || period.paidPayrollReports > 0
                || period.reviewedPayrollReports > 0
                || period.approvedPayrollReports > 0
                || period.committedPayrollReports > 0
                || period.financeLinkedPayrollReports > 0
                || period.payrollEntries > 0
                || period.salaryAdjustments > 0
                || period.salaryFinanceTransactions > 0
            )).length
        },
        payrollRisk: payrollImpact.risk,
        planHash
    };
}

async function loadBackupPayload(client, options, changes, payrollImpact, planHash, approvalManifest) {
    const ids = changes.map(change => change.id);
    const staffIds = [...new Set(changes.map(change => change.staff_id))];
    const dates = [...new Set(changes.map(change => change.record_date))];
    const periods = [...new Set(changes.map(change => change.record_date.slice(0, 7)))];
    const timeRecords = ids.length
        ? await client.query('SELECT * FROM hr_time_records WHERE id = ANY($1::int[]) ORDER BY record_date, staff_id, id', [ids])
        : { rows: [] };
    const auditLog = staffIds.length
        ? await client.query(
            `SELECT *
               FROM hr_audit_log
              WHERE staff_id = ANY($1::int[])
                AND (
                    details->>'record_id' = ANY($2::text[])
                    OR details->>'record_date' = ANY($3::text[])
                    OR details->>'date' = ANY($3::text[])
                )
              ORDER BY created_at, id`,
            [staffIds, ids.map(String), dates]
        )
        : { rows: [] };
    const payrollReports = await tableExists(client, 'payroll_reports') && staffIds.length
        ? await client.query(
            `SELECT *
               FROM payroll_reports
              WHERE staff_id = ANY($1::int[])
                AND period_month = ANY($2::text[])
              ORDER BY period_month, staff_id, id`,
            [staffIds, periods]
        )
        : { rows: [] };
    const payrollLocks = await tableExists(client, 'payroll_period_locks') && periods.length
        ? await client.query(
            `SELECT *
               FROM payroll_period_locks
              WHERE period_month = ANY($1::text[])
              ORDER BY period_month`,
            [periods]
        )
        : { rows: [] };
    const payrollEntries = await tableExists(client, 'payroll_entries') && staffIds.length
        ? await client.query(
            `SELECT *
               FROM payroll_entries
              WHERE staff_id = ANY($1::int[])
                AND period_month = ANY($2::text[])
              ORDER BY period_month, staff_id, id`,
            [staffIds, periods]
        )
        : { rows: [] };
    const salaryAdjustments = await tableExists(client, 'salary_adjustments') && staffIds.length
        ? await client.query(
            `SELECT *
               FROM salary_adjustments
              WHERE staff_id = ANY($1::int[])
                AND month = ANY($2::text[])
              ORDER BY month, staff_id, id`,
            [staffIds, periods]
        )
        : { rows: [] };
    const financeTransactions = await tableExists(client, 'finance_transactions') && staffIds.length
        ? await client.query(
            `SELECT *
               FROM finance_transactions
              WHERE staff_id = ANY($1::int[])
                AND LEFT(date, 7) = ANY($2::text[])
                AND payment_method IN ('salary', 'salary_reversal')
              ORDER BY date, staff_id, id`,
            [staffIds, periods]
        )
        : { rows: [] };
    return {
        format: 'eventgenix.attendance_historical_grace_backup',
        version: BACKUP_FORMAT_VERSION,
        generatedAt: new Date().toISOString(),
        planHash,
        approvalManifest,
        approval: {
            approvedBy: options.approvedBy,
            executedBy: options.executedBy,
            reason: options.reason,
            scope: {
                from: options.from,
                to: options.to,
                businessContext: options.businessContext,
                categories: options.categories
            }
        },
        payrollImpact,
        plannedChanges: changes,
        tables: {
            hr_time_records: timeRecords.rows,
            hr_audit_log: auditLog.rows,
            payroll_reports: payrollReports.rows,
            payroll_period_locks: payrollLocks.rows,
            payroll_entries: payrollEntries.rows,
            salary_adjustments: salaryAdjustments.rows,
            finance_transactions: financeTransactions.rows
        }
    };
}

function normalizePathForCompare(value) {
    return path.resolve(value).replace(/[\\\/]+$/, '').toLowerCase();
}

function isPathInside(child, parent) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertNoSymlinkPath(targetPath) {
    const resolved = path.resolve(targetPath);
    const root = path.parse(resolved).root;
    const relativeParts = path.relative(root, resolved).split(path.sep).filter(Boolean);
    let current = root;
    for (const part of relativeParts) {
        current = path.join(current, part);
        if (!fs.existsSync(current)) continue;
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            throw new Error(`Backup path must not contain symlink/reparse segments: ${current}`);
        }
    }
}

function ensureBackupDirectory(rawDir) {
    if (!path.isAbsolute(rawDir || '')) {
        throw new Error('--backup-dir must be an absolute path outside the repository');
    }
    const dir = path.resolve(rawDir);
    const repo = path.resolve(ROOT);
    if (isPathInside(normalizePathForCompare(dir), normalizePathForCompare(repo))) {
        throw new Error('--backup-dir must be outside the repository');
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    assertNoSymlinkPath(dir);
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory()) throw new Error('--backup-dir must resolve to a directory');
    try {
        fs.chmodSync(dir, 0o700);
    } catch (_) {
        // Best effort on Windows/OneDrive filesystems; the operator still controls ACL approval.
    }
    return dir;
}

function backupRowCounts(payload) {
    return Object.fromEntries(Object.entries(payload.tables || {}).map(([table, rows]) => [
        table,
        Array.isArray(rows) ? rows.length : 0
    ]));
}

function backupEnvelopeForChecksum(envelope) {
    return {
        ...envelope,
        manifest: {
            ...envelope.manifest,
            checksumSha256: null
        }
    };
}

function serializeBackupEnvelope(envelope) {
    return `${JSON.stringify(envelope, null, 2)}\n`;
}

function checksumBackupEnvelope(envelope) {
    return crypto
        .createHash('sha256')
        .update(serializeBackupEnvelope(backupEnvelopeForChecksum(envelope)))
        .digest('hex');
}

function verifyBackupEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object') throw new Error('Backup artifact is not a JSON object');
    if (envelope.format !== 'eventgenix.attendance_historical_grace_backup_artifact') {
        throw new Error('Unsupported backup artifact format');
    }
    if (!envelope.payload || envelope.payload.format !== 'eventgenix.attendance_historical_grace_backup') {
        throw new Error('Unsupported backup payload format');
    }
    const expected = envelope.manifest?.checksumSha256;
    if (!expected) throw new Error('Backup artifact is missing checksumSha256');
    const actual = checksumBackupEnvelope(envelope);
    if (actual !== expected) throw new Error('Backup artifact checksum mismatch');
    return true;
}

function loadBackupArtifact(filePath) {
    if (!path.isAbsolute(filePath || '')) throw new Error('--backup-file must be an absolute path');
    assertNoSymlinkPath(filePath);
    const envelope = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
    verifyBackupEnvelope(envelope);
    return envelope;
}

function fsyncDirectory(dir) {
    try {
        const fd = fs.openSync(dir, 'r');
        try {
            fs.fsyncSync(fd);
            return true;
        } finally {
            fs.closeSync(fd);
        }
    } catch (_) {
        return false;
    }
}

function writeBackupFile(options, payload) {
    const dir = ensureBackupDirectory(options.backupDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const artifactId = `attendance-historical-grace-${options.from}-${options.to}-${payload.planHash.slice(0, 12)}-${timestamp}`;
    const filename = `${artifactId}.json`;
    const fullPath = path.join(dir, filename);
    const envelope = {
        format: 'eventgenix.attendance_historical_grace_backup_artifact',
        manifest: {
            artifactId,
            createdAt: new Date().toISOString(),
            planHash: payload.planHash,
            operationId: payload.approvalManifest?.operationId || null,
            backupFormatVersion: BACKUP_FORMAT_VERSION,
            rowCounts: backupRowCounts(payload),
            plannedChanges: Array.isArray(payload.plannedChanges) ? payload.plannedChanges.length : 0,
            checksumSha256: null,
            checksumPayload: 'sha256 of canonical backup artifact JSON with manifest.checksumSha256 set to null'
        },
        payload
    };
    envelope.manifest.checksumSha256 = checksumBackupEnvelope(envelope);
    const bytes = Buffer.from(serializeBackupEnvelope(envelope), 'utf8');
    if (bytes.length > options.maxBackupBytes) {
        throw new Error(`Refusing --apply: backup artifact ${bytes.length} bytes exceeds --max-backup-bytes ${options.maxBackupBytes}`);
    }
    const tempPath = `${fullPath}.tmp-${process.pid}-${Date.now()}`;
    const fd = fs.openSync(tempPath, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    try {
        fs.chmodSync(tempPath, 0o600);
    } catch (_) {}
    fs.renameSync(tempPath, fullPath);
    const directoryFsync = fsyncDirectory(dir);
    verifyBackupEnvelope(JSON.parse(fs.readFileSync(fullPath, 'utf8')));
    return {
        artifactId,
        filePath: fullPath,
        checksumSha256: envelope.manifest.checksumSha256,
        byteLength: bytes.length,
        rowCounts: envelope.manifest.rowCounts,
        directoryFsync
    };
}

async function beginApplyTransaction(client) {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query(`SET LOCAL lock_timeout = '${APPLY_LOCK_TIMEOUT}'`);
    await client.query(`SET LOCAL statement_timeout = '${APPLY_STATEMENT_TIMEOUT}'`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${APPLY_STATEMENT_TIMEOUT}'`);
}

async function lockPayrollGateTables(client) {
    const lockedTables = [];
    for (const tableName of PAYROLL_GATE_TABLES) {
        if (await tableExists(client, tableName)) {
            await client.query(`LOCK TABLE ${tableName} IN SHARE ROW EXCLUSIVE MODE`);
            lockedTables.push(tableName);
        }
    }
    return lockedTables;
}

async function insertOperationAudit(client, options, changes, planHash, approvalManifest, backupArtifact, phase = 'apply') {
    const summary = summarizeChanges(changes);
    const details = {
        script: 'fix-attendance-historical-grace',
        script_version: SCRIPT_VERSION,
        operation_id: approvalManifest.operationId,
        operation_phase: phase,
        plan_hash: planHash,
        backup_artifact_id: backupArtifact.artifactId,
        backup_checksum_sha256: backupArtifact.checksumSha256,
        approved_by: options.approvedBy,
        executed_by: options.executedBy,
        reason: options.reason,
        summary,
        approved_scope: {
            from: options.from,
            to: options.to,
            business_context: options.businessContext,
            categories: options.categories,
            locked_paid_closed_payroll_can_change: false
        }
    };
    const result = await client.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('attendance_historical_grace_data_fix_operation', NULL, $1, $2::jsonb, NULL)
         RETURNING id`,
        [options.executedBy, JSON.stringify(details)]
    );
    return result.rowCount;
}

async function applyChanges(client, options, changes, backupArtifact, planHash, approvalManifest) {
    if (!changes.length) return { updatedRows: 0, auditRows: 0, operationAuditRows: 0 };
    const updatePayload = changes.map(change => ({
        id: change.id,
        record_date: change.record_date,
        business_context: change.business_context,
        before_status: change.before.status,
        before_late_minutes: change.before.late_minutes,
        before_early_leave_minutes: change.before.early_leave_minutes,
        before_overtime_minutes: change.before.overtime_minutes,
        apply_late_grace: change.categories.includes(CATEGORY_LATE_GRACE),
        apply_overtime_grace: change.categories.includes(CATEGORY_OVERTIME_GRACE),
        new_late_minutes: change.after.late_minutes,
        new_overtime_minutes: change.after.overtime_minutes,
        new_status: change.after.status
    }));
    const updated = await client.query(
        `WITH changes AS (
            SELECT *
              FROM jsonb_to_recordset($1::jsonb)
                   AS x(
                       id int,
                       record_date text,
                       business_context text,
                       before_status text,
                       before_late_minutes int,
                       before_early_leave_minutes int,
                       before_overtime_minutes int,
                       apply_late_grace boolean,
                       apply_overtime_grace boolean,
                       new_late_minutes int,
                       new_overtime_minutes int,
                       new_status text
                   )
         )
         UPDATE hr_time_records tr
             SET late_minutes = CASE WHEN changes.apply_late_grace THEN changes.new_late_minutes ELSE tr.late_minutes END,
                 overtime_minutes = CASE WHEN changes.apply_overtime_grace THEN changes.new_overtime_minutes ELSE tr.overtime_minutes END,
                 status = CASE WHEN changes.apply_late_grace THEN changes.new_status ELSE tr.status END,
                 updated_at = NOW()
            FROM changes
           WHERE tr.id = changes.id
             AND tr.record_date = changes.record_date::date
             AND COALESCE(tr.business_context, 'event_genix') = changes.business_context
             AND tr.status IS NOT DISTINCT FROM changes.before_status
             AND tr.late_minutes IS NOT DISTINCT FROM changes.before_late_minutes
             AND tr.early_leave_minutes IS NOT DISTINCT FROM changes.before_early_leave_minutes
             AND tr.overtime_minutes IS NOT DISTINCT FROM changes.before_overtime_minutes
           RETURNING tr.id`,
        [JSON.stringify(updatePayload)]
    );
    const auditPayload = changes.map(change => ({
        staff_id: change.staff_id,
        details: {
            script: 'fix-attendance-historical-grace',
            script_version: SCRIPT_VERSION,
            operation_id: approvalManifest.operationId,
            plan_hash: planHash,
            backup_artifact_id: backupArtifact.artifactId,
            backup_checksum_sha256: backupArtifact.checksumSha256,
            approved_by: options.approvedBy,
            executed_by: options.executedBy,
            reason: options.reason,
            record_id: change.id,
            record_date: change.record_date,
            business_context: change.business_context,
            categories: change.categories,
            before: change.before,
            after: change.after,
            approved_scope: {
                from: options.from,
                to: options.to,
                business_context: options.businessContext,
                categories: options.categories,
                locked_paid_closed_payroll_can_change: false
            }
        }
    }));
    const audit = await client.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         SELECT 'attendance_historical_grace_data_fix',
                 x.staff_id,
                 $2,
                x.details,
                NULL
           FROM jsonb_to_recordset($1::jsonb)
                AS x(staff_id int, details jsonb)
         RETURNING id`,
        [JSON.stringify(auditPayload), options.executedBy]
    );
    if (updated.rowCount !== changes.length) {
        throw new Error(`Updated ${updated.rowCount} rows, expected ${changes.length}`);
    }
    if (audit.rowCount !== changes.length) {
        throw new Error(`Inserted ${audit.rowCount} audit rows, expected ${changes.length}`);
    }
    const operationAuditRows = await insertOperationAudit(client, options, changes, planHash, approvalManifest, backupArtifact);
    if (operationAuditRows !== 1) {
        throw new Error(`Inserted ${operationAuditRows} operation audit rows, expected 1`);
    }
    return { updatedRows: updated.rowCount, auditRows: audit.rowCount, operationAuditRows };
}

function sameValue(actual, expected) {
    return (actual ?? null) === (expected ?? null);
}

async function verifyAppliedChanges(client, changes, planHash, backupArtifact, approvalManifest) {
    const ids = changes.map(change => change.id);
    const result = await client.query(
        `SELECT id,
                record_date::text AS record_date,
                COALESCE(business_context, 'event_genix') AS business_context,
                clock_in::text AS clock_in,
                clock_out::text AS clock_out,
                planned_start::text AS planned_start,
                planned_end::text AS planned_end,
                status,
                late_minutes::int AS late_minutes,
                early_leave_minutes::int AS early_leave_minutes,
                overtime_minutes::int AS overtime_minutes,
                COALESCE(total_worked_minutes, 0)::int AS total_worked_minutes
           FROM hr_time_records
          WHERE id = ANY($1::int[])`,
        [ids]
    );
    const rowsById = new Map(result.rows.map(row => [Number(row.id), row]));
    for (const change of changes) {
        const row = rowsById.get(change.id);
        if (!row) throw new Error(`Read-back failed: record ${change.id} is missing`);
        if (row.record_date !== change.record_date) throw new Error(`Read-back failed: record ${change.id} date drift`);
        if (row.business_context !== change.business_context) throw new Error(`Read-back failed: record ${change.id} business context drift`);
        for (const key of ['clock_in', 'clock_out', 'planned_start', 'planned_end']) {
            if (!sameValue(row[key], change.immutable?.[key])) {
                throw new Error(`Read-back failed: record ${change.id} immutable ${key} drift`);
            }
        }
        if (!sameValue(nullableInteger(row.total_worked_minutes), change.immutable?.total_worked_minutes)) {
            throw new Error(`Read-back failed: record ${change.id} total_worked_minutes drift`);
        }
        for (const [key, expected] of Object.entries(change.after)) {
            const actual = key.endsWith('_minutes') ? nullableInteger(row[key]) : (row[key] ?? null);
            if (!sameValue(actual, expected)) {
                throw new Error(`Read-back failed: record ${change.id} ${key} is ${actual}, expected ${expected}`);
            }
        }
    }
    const audit = await client.query(
        `SELECT
            COUNT(*) FILTER (
                WHERE action = 'attendance_historical_grace_data_fix'
            )::int AS row_audit_rows,
            COUNT(*) FILTER (
                WHERE action = 'attendance_historical_grace_data_fix_operation'
            )::int AS operation_audit_rows
           FROM hr_audit_log
          WHERE details->>'plan_hash' = $1
            AND details->>'operation_id' = $2
            AND details->>'backup_artifact_id' = $3`,
        [planHash, approvalManifest.operationId, backupArtifact.artifactId]
    );
    const row = audit.rows[0] || {};
    const rowAuditRows = Number(row.row_audit_rows || 0);
    const operationAuditRows = Number(row.operation_audit_rows || 0);
    if (rowAuditRows !== changes.length) {
        throw new Error(`Read-back failed: ${rowAuditRows} row audit entries, expected ${changes.length}`);
    }
    if (operationAuditRows !== 1) {
        throw new Error(`Read-back failed: ${operationAuditRows} operation audit entries, expected 1`);
    }
    return {
        recordsVerified: rowsById.size,
        rowAuditRows,
        operationAuditRows
    };
}

async function recoverApplyOutcome(config, operationId, planHash) {
    const { Pool } = require('pg');
    const pool = new Pool(config);
    try {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT
                    COUNT(*) FILTER (
                        WHERE action = 'attendance_historical_grace_data_fix_operation'
                    )::int AS operation_audit_rows,
                    COUNT(*) FILTER (
                        WHERE action = 'attendance_historical_grace_data_fix'
                    )::int AS row_audit_rows
                   FROM hr_audit_log
                  WHERE details->>'operation_id' = $1
                    AND details->>'plan_hash' = $2`,
                [operationId, planHash]
            );
            const row = result.rows[0] || {};
            const operationAuditRows = Number(row.operation_audit_rows || 0);
            const rowAuditRows = Number(row.row_audit_rows || 0);
            if (operationAuditRows > 0 || rowAuditRows > 0) {
                return { state: 'committed', operationAuditRows, rowAuditRows };
            }
            return { state: 'rolled_back_or_not_committed', operationAuditRows, rowAuditRows };
        } finally {
            client.release();
        }
    } catch (error) {
        return { state: 'unknown', error: error.message };
    } finally {
        await pool.end().catch(() => {});
    }
}

function buildReport(options, changes, payrollImpact, planHash, extra = {}) {
    return {
        generatedAt: new Date().toISOString(),
        mode: options.apply ? 'apply' : 'dry_run',
        scriptVersion: SCRIPT_VERSION,
        approval: {
            approvedBy: options.approvedBy || options.owner,
            executedBy: options.executedBy || null,
            reason: options.reason,
            scope: {
                from: options.from,
                to: options.to,
                businessContext: options.businessContext,
                categories: options.categories,
                maxRecords: options.maxRecords,
                maxBackupBytes: options.maxBackupBytes,
                lockedPaidClosedPayrollCanChange: false
            }
        },
        summary: summarizeChanges(changes),
        payrollImpact,
        planHash,
        approvalManifest: extra.approvalManifest || null,
        readOnlyAuditCounts: extra.readOnlyAuditCounts || {},
        applyGate: options.apply ? {
            reviewTokenAccepted: options.reviewToken === planHash,
            backupFile: extra.backupFile || null
        } : {
            nextStep: 'Review this dry-run output. Apply requires --review-token equal to planHash and the exact --confirm string.',
            requiredReviewToken: planHash,
            requiredConfirm: expectedApplyConfirmation(options)
        },
        ...extra
    };
}

async function runDataFix(options) {
    const config = poolConfig(options);
    const { Pool } = require('pg');
    const pool = new Pool(config);
    const client = await pool.connect();
    try {
        if (options.apply) {
            await beginApplyTransaction(client);
            const readonly = await client.query('SHOW transaction_read_only');
            if (readonly.rows[0]?.transaction_read_only === 'on') {
                throw new Error('PostgreSQL transaction is read-only; cannot apply data-fix');
            }
            const lockedTables = await lockPayrollGateTables(client);
            const changes = await loadCandidateChanges(client, options, { forUpdate: true });
            const payrollImpact = await loadPayrollImpact(client, changes);
            assertPayrollWriteAllowed(payrollImpact);
            const readOnlyAuditCounts = await loadReadOnlyAuditCounts(client, options);
            const runtimeMetadata = await loadRuntimeMetadata(client);
            const planHash = buildPlanHash(options, changes, payrollImpact, runtimeMetadata);
            const approvalManifest = buildApprovalManifest(options, changes, payrollImpact, runtimeMetadata, planHash);
            if (options.reviewToken !== planHash) {
                throw new Error(`--review-token does not match current dry-run planHash. Current planHash: ${planHash}`);
            }
            const backupPayload = await loadBackupPayload(client, options, changes, payrollImpact, planHash, approvalManifest);
            const backupArtifact = writeBackupFile(options, backupPayload);
            const applyResult = await applyChanges(client, options, changes, backupArtifact, planHash, approvalManifest);
            const readBack = await verifyAppliedChanges(client, changes, planHash, backupArtifact, approvalManifest);
            const payrollImpactBeforeCommit = await loadPayrollImpact(client, changes);
            assertPayrollWriteAllowed(payrollImpactBeforeCommit);
            try {
                await client.query('COMMIT');
            } catch (commitError) {
                const recovery = await recoverApplyOutcome(config, approvalManifest.operationId, planHash);
                throw new Error(`COMMIT result is ambiguous for ${approvalManifest.operationId}; recoveryState=${recovery.state}; do not rerun apply automatically. Original error: ${commitError.message}`);
            }
            return buildReport(options, changes, payrollImpact, planHash, {
                applied: true,
                backupFile: backupArtifact.filePath,
                backupArtifact,
                applyResult,
                approvalManifest,
                readOnlyAuditCounts,
                lockedTables,
                readBack,
                payrollImpactBeforeCommit
            });
        }

        await client.query('BEGIN READ ONLY');
        await client.query(`SET LOCAL statement_timeout = '45s'`);
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = '45s'`);
        const readonly = await client.query('SHOW transaction_read_only');
        if (readonly.rows[0]?.transaction_read_only !== 'on') {
            throw new Error('PostgreSQL transaction is not read-only; aborting dry-run');
        }
        const changes = await loadCandidateChanges(client, options, { forUpdate: false });
        const payrollImpact = await loadPayrollImpact(client, changes);
        const readOnlyAuditCounts = await loadReadOnlyAuditCounts(client, options);
        const runtimeMetadata = await loadRuntimeMetadata(client);
        const planHash = buildPlanHash(options, changes, payrollImpact, runtimeMetadata);
        const approvalManifest = buildApprovalManifest(options, changes, payrollImpact, runtimeMetadata, planHash);
        await client.query('ROLLBACK');
        return buildReport(options, changes, payrollImpact, planHash, {
            applied: false,
            approvalManifest,
            readOnlyAuditCounts
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

function renderMarkdown(report) {
    const lines = [
        '# Historical attendance grace data-fix',
        '',
        `Generated: ${report.generatedAt}`,
        `Mode: ${report.mode}`,
        `Approved by: ${report.approval.approvedBy}`,
        `Executed by: ${report.approval.executedBy}`,
        `Reason: ${report.approval.reason}`,
        `Scope: ${report.approval.scope.from} to ${report.approval.scope.to}, businessContext=${report.approval.scope.businessContext}`,
        `Categories: ${report.approval.scope.categories.join(', ')}`,
        `Max records: ${report.approval.scope.maxRecords}`,
        `Plan hash: ${report.planHash}`,
        report.approvalManifest
            ? `Operation ID: ${report.approvalManifest.operationId}`
            : null,
        report.approvalManifest
            ? `Manifest expires: ${report.approvalManifest.expiresAt}`
            : null,
        '',
        '## Summary',
        '',
        `- Rows: ${report.summary.totalRows}`,
        `- Distinct staff: ${report.summary.distinctStaff}`,
        `- By category: ${JSON.stringify(report.summary.byCategory)}`,
        `- By month: ${JSON.stringify(report.summary.byMonth)}`,
        `- Read-only late NULL/zero/negative audit: ${JSON.stringify(report.readOnlyAuditCounts?.[CATEGORY_NULL_ZERO_NEGATIVE_LATE] || {})}`,
        '',
        '## Payroll impact',
        '',
        `Risk: ${report.payrollImpact.risk}`,
        '',
        '| Month | Candidate records | Staff | Locked | Reports | Draft | Reviewed | Approved | Paid | Committed | Finance-linked | Entries | Adjustments | Salary finance |',
        '| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...(report.payrollImpact.periods || []).map(period => (
            `| ${period.month} | ${period.candidateRecords} | ${period.candidateStaff} | ${period.payrollPeriodLocked || period.hasLockTimestamp ? 'yes' : 'no'} | ${period.payrollReports} | ${period.draftPayrollReports || 0} | ${period.reviewedPayrollReports || 0} | ${period.approvedPayrollReports || 0} | ${period.paidPayrollReports || 0} | ${period.committedPayrollReports || 0} | ${period.financeLinkedPayrollReports || 0} | ${period.payrollEntries || 0} | ${period.salaryAdjustments || 0} | ${period.salaryFinanceTransactions || 0} |`
        )),
        '',
        report.mode === 'dry_run'
            ? `Apply gate: review this output, then rerun with --review-token ${report.planHash} and --confirm "${report.applyGate.requiredConfirm}".`
            : `Applied: ${report.applied === true}; backup artifact: ${report.backupArtifact?.artifactId || 'n/a'}; checksum: ${report.backupArtifact?.checksumSha256 || 'n/a'}`
    ];
    return lines.join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    const report = await runDataFix(options);
    const output = options.format === 'markdown' ? renderMarkdown(report) : JSON.stringify(report, null, 2);
    if (options.output) fs.writeFileSync(path.resolve(options.output), `${output}\n`, { encoding: 'utf8', flag: 'w' });
    else console.log(output);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`attendance historical grace data-fix failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    CATEGORY_LATE_GRACE,
    CATEGORY_NULL_ZERO_NEGATIVE_LATE,
    CATEGORY_OVERTIME_GRACE,
    assertPayrollWriteAllowed,
    beginApplyTransaction,
    buildApprovalManifest,
    buildPlanHash,
    buildReport,
    candidateSelectSql,
    categorySql,
    countOverlappingChanges,
    ensureBackupDirectory,
    expectedApplyConfirmation,
    loadBackupArtifact,
    loadPayrollImpact,
    loadReadOnlyAuditCounts,
    lockPayrollGateTables,
    parseArgs,
    planChange,
    poolConfig,
    recoverApplyOutcome,
    renderMarkdown,
    runDataFix,
    sslConfigForConnectionString,
    verifyAppliedChanges,
    verifyBackupEnvelope,
    writeBackupFile,
    summarizeChanges
};
