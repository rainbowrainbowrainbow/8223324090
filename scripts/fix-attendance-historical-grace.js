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

const SCRIPT_VERSION = 1;
const DEFAULT_BUSINESS_CONTEXT = 'event_genix';
const MAX_APPLY_DAYS = 31;
const CATEGORY_LATE_GRACE = 'late-grace';
const CATEGORY_OVERTIME_GRACE = 'overtime-grace';
const SUPPORTED_CATEGORIES = new Set([CATEGORY_LATE_GRACE, CATEGORY_OVERTIME_GRACE]);
const UNSUPPORTED_WRITE_CATEGORIES = new Set(['missing-plan-source', 'inferred-profession-card']);
const CLOSED_PAYROLL_STATUSES = new Set(['reviewed', 'approved', 'paid']);

function usage() {
    return [
        'Usage:',
        '  node scripts/fix-attendance-historical-grace.js --from YYYY-MM-DD --to YYYY-MM-DD --business-context event_genix --owner "Director / Serhii" --reason "reports only" --categories "late-grace,overtime-grace" [--format json|markdown]',
        '',
        'Dry-run is default and uses BEGIN READ ONLY.',
        '',
        'Apply, only after owner review of the current dry-run output:',
        '  node scripts/fix-attendance-historical-grace.js --apply --from YYYY-MM-DD --to YYYY-MM-DD --business-context event_genix --owner "Director / Serhii" --reason "reports only" --categories "late-grace,overtime-grace" --review-token <dry-run-plan-hash> --backup-dir <dir> --confirm <exact-confirmation>',
        '',
        'Connection:',
        '  Dry-run: ATTENDANCE_AUDIT_DATABASE_URL, PRODUCTION_READONLY_DATABASE_URL, ATTENDANCE_DATA_FIX_DATABASE_URL, DATABASE_URL, or PG*.',
        '  Apply: ATTENDANCE_DATA_FIX_DATABASE_URL only.',
        '',
        'Supported categories:',
        '  late-grace      status=late with late_minutes<=5 => late_minutes=0 and legacy status recalculated',
        '  overtime-grace  overtime_minutes 1..15 => overtime_minutes=0',
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
    return text;
}

function normalizeCategory(value) {
    const text = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (['late', 'late-grace-mismatch', 'late-status-within-grace'].includes(text)) return CATEGORY_LATE_GRACE;
    if (['overtime', 'overtime-grace-mismatch', 'overtime-within-grace'].includes(text)) return CATEGORY_OVERTIME_GRACE;
    if (['missing-audit-plan-source', 'missing-plan-source', 'plan-source'].includes(text)) return 'missing-plan-source';
    if (['inferred-profession-card', 'profession-card-inference'].includes(text)) return 'inferred-profession-card';
    return text;
}

function normalizeCategories(values) {
    const raw = values.flatMap(value => String(value || '').split(',')).map(normalizeCategory).filter(Boolean);
    const categories = [...new Set(raw)];
    if (!categories.length) throw new Error('At least one --category or --categories value is required');
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
        owner: '',
        reason: '',
        categories: [],
        categoryInputs: [],
        reviewToken: '',
        confirm: '',
        backupDir: '',
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
        else if (arg === '--dry-run') {
            options.apply = false;
            options.dryRun = true;
        } else if (arg === '--apply') {
            options.apply = true;
            options.dryRun = false;
        } else if (arg === '--from') options.from = readValue(arg);
        else if (arg === '--to') options.to = readValue(arg);
        else if (arg === '--business-context') options.businessContext = readValue(arg);
        else if (arg === '--owner') options.owner = readValue(arg);
        else if (arg === '--reason' || arg === '--business-reason') options.reason = readValue(arg);
        else if (arg === '--category') options.categoryInputs.push(...readValues(arg));
        else if (arg === '--categories') options.categoryInputs.push(...readValues(arg));
        else if (arg === '--review-token') options.reviewToken = readValue(arg);
        else if (arg === '--confirm') options.confirm = readValue(arg);
        else if (arg === '--backup-dir') options.backupDir = readValue(arg);
        else if (arg === '--format') options.format = readValue(arg).toLowerCase();
        else if (arg === '--output') options.output = readValue(arg);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.help) return options;
    options.from = normalizeDate(options.from, '--from');
    options.to = normalizeDate(options.to, '--to');
    if (options.from > options.to) throw new Error('--from must be before or equal to --to');
    options.businessContext = normalizeBusinessContext(options.businessContext);
    options.owner = String(options.owner || '').trim();
    if (!options.owner) throw new Error('--owner is required');
    options.reason = String(options.reason || '').trim();
    if (!options.reason) throw new Error('--reason is required');
    options.categories = normalizeCategories(options.categoryInputs);
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
            || process.env.ATTENDANCE_DATA_FIX_DATABASE_URL
            || process.env.DATABASE_URL
            || ''
        );
    if (connectionString) {
        return {
            connectionString,
            ssl: { rejectUnauthorized: false },
            application_name: options.apply
                ? 'attendance_historical_grace_data_fix_apply'
                : 'attendance_historical_grace_data_fix_dry_run'
        };
    }
    if (options.apply) {
        throw new Error('Set ATTENDANCE_DATA_FIX_DATABASE_URL before --apply');
    }
    if (!process.env.PGDATABASE) {
        throw new Error('Set ATTENDANCE_AUDIT_DATABASE_URL, PRODUCTION_READONLY_DATABASE_URL, ATTENDANCE_DATA_FIX_DATABASE_URL, DATABASE_URL, or PGDATABASE/PG*');
    }
    return {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        application_name: 'attendance_historical_grace_data_fix_dry_run'
    };
}

function categorySql(categories, alias = 'tr') {
    const clauses = [];
    if (categories.includes(CATEGORY_LATE_GRACE)) {
        clauses.push(`(${alias}.status = 'late' AND COALESCE(${alias}.late_minutes, 0) <= 5)`);
    }
    if (categories.includes(CATEGORY_OVERTIME_GRACE)) {
        clauses.push(`(COALESCE(${alias}.overtime_minutes, 0) BETWEEN 1 AND 15)`);
    }
    return clauses.join(' OR ') || 'false';
}

function candidateSelectSql(options, { forUpdate = false } = {}) {
    const lateFlag = options.categories.includes(CATEGORY_LATE_GRACE)
        ? `(tr.status = 'late' AND COALESCE(tr.late_minutes, 0) <= 5)`
        : 'false';
    const overtimeFlag = options.categories.includes(CATEGORY_OVERTIME_GRACE)
        ? `(COALESCE(tr.overtime_minutes, 0) BETWEEN 1 AND 15)`
        : 'false';
    return `
        SELECT tr.id,
               tr.staff_id,
               tr.record_date::text AS record_date,
               COALESCE(tr.business_context, 'event_genix') AS business_context,
               tr.clock_in,
               tr.clock_out,
               tr.planned_start,
               tr.planned_end,
               tr.status,
               COALESCE(tr.late_minutes, 0)::int AS late_minutes,
               COALESCE(tr.early_leave_minutes, 0)::int AS early_leave_minutes,
               COALESCE(tr.overtime_minutes, 0)::int AS overtime_minutes,
               COALESCE(tr.total_worked_minutes, 0)::int AS total_worked_minutes,
               tr.updated_at,
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

function closedStatus(status) {
    return CLOSED_PAYROLL_STATUSES.has(String(status || '').trim());
}

function planChange(row) {
    const before = {
        status: row.status || 'present',
        late_minutes: Number(row.late_minutes || 0),
        early_leave_minutes: Number(row.early_leave_minutes || 0),
        overtime_minutes: Number(row.overtime_minutes || 0)
    };
    const categories = [];
    if (row.fix_late_grace === true) categories.push(CATEGORY_LATE_GRACE);
    if (row.fix_overtime_grace === true) categories.push(CATEGORY_OVERTIME_GRACE);
    let nextStatus = before.status;
    const nextLate = row.fix_late_grace === true ? 0 : before.late_minutes;
    const nextOvertime = row.fix_overtime_grace === true ? 0 : before.overtime_minutes;
    if (row.fix_late_grace === true || (row.fix_overtime_grace === true && nextStatus === 'overtime')) {
        if (nextLate > 5) nextStatus = 'late';
        else if (before.early_leave_minutes > 0) nextStatus = 'early_leave';
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

async function loadCandidateChanges(client, options, flags = {}) {
    const result = await client.query(
        candidateSelectSql(options, flags),
        [options.from, options.to, options.businessContext]
    );
    return result.rows.map(planChange).filter(change => change.changed);
}

async function loadPayrollImpact(client, changes) {
    const hasReports = await tableExists(client, 'payroll_reports');
    const hasLocks = await tableExists(client, 'payroll_period_locks');
    if (!changes.length) {
        return {
            payrollReportsTablePresent: hasReports,
            payrollPeriodLocksTablePresent: hasLocks,
            risk: hasReports && hasLocks ? 'none_detected' : 'unknown_schema',
            periods: []
        };
    }
    const ids = changes.map(change => change.id);
    if (!hasReports) {
        return {
            payrollReportsTablePresent: false,
            payrollPeriodLocksTablePresent: hasLocks,
            risk: 'unknown_schema',
            periods: []
        };
    }
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
                   COUNT(DISTINCT pr.id)::int AS payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE pr.voided_at IS NULL
                          AND pr.status IN ('reviewed', 'approved', 'paid')
                   )::int AS closed_payroll_reports,
                   COUNT(DISTINCT pr.id) FILTER (
                        WHERE pr.voided_at IS NULL
                          AND pr.status = 'paid'
                   )::int AS paid_payroll_reports
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
                COALESCE(rs.closed_payroll_reports, 0)::int AS closed_payroll_reports,
                COALESCE(rs.paid_payroll_reports, 0)::int AS paid_payroll_reports
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
        closedPayrollReports: Number(row.closed_payroll_reports || 0),
        paidPayrollReports: Number(row.paid_payroll_reports || 0)
    }));
    return {
        payrollReportsTablePresent: true,
        payrollPeriodLocksTablePresent: hasLocks,
        risk: hasLocks ? riskFromPayrollImpact(periods) : 'unknown_schema',
        periods
    };
}

function riskFromPayrollImpact(periods) {
    if (periods.some(period => period.payrollPeriodLocked || period.hasLockTimestamp || period.paidPayrollReports > 0)) return 'high';
    if (periods.some(period => period.closedPayrollReports > 0)) return 'medium';
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
        || period.closedPayrollReports > 0
        || period.paidPayrollReports > 0
    ));
    if (blocked.length) {
        const months = blocked.map(period => period.month).join(', ');
        throw new Error(`Refusing --apply: locked/closed/paid payroll impact exists for ${months}`);
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

function buildPlanHash(options, changes, payrollImpact) {
    const payload = {
        script: 'fix-attendance-historical-grace',
        scriptVersion: SCRIPT_VERSION,
        from: options.from,
        to: options.to,
        businessContext: options.businessContext,
        owner: options.owner,
        reason: options.reason,
        categories: options.categories,
        changes: changes.map(change => ({
            id: change.id,
            staff_id: change.staff_id,
            record_date: change.record_date,
            categories: change.categories,
            before: change.before,
            after: change.after
        })),
        payrollImpact: {
            payrollReportsTablePresent: payrollImpact.payrollReportsTablePresent,
            payrollPeriodLocksTablePresent: payrollImpact.payrollPeriodLocksTablePresent,
            risk: payrollImpact.risk,
            periods: payrollImpact.periods
        }
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function loadBackupPayload(client, options, changes, payrollImpact, planHash) {
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
    return {
        format: 'eventgenix.attendance_historical_grace_backup',
        version: 1,
        generatedAt: new Date().toISOString(),
        planHash,
        approval: {
            owner: options.owner,
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
            payroll_period_locks: payrollLocks.rows
        }
    };
}

function writeBackupFile(options, payload) {
    const dir = path.resolve(options.backupDir);
    fs.mkdirSync(dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `attendance-historical-grace-backup-${options.from}-${options.to}-${payload.planHash.slice(0, 12)}-${timestamp}.json`;
    const fullPath = path.join(dir, filename);
    fs.writeFileSync(fullPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return fullPath;
}

async function applyChanges(client, options, changes, backupFile, planHash) {
    if (!changes.length) return { updatedRows: 0, auditRows: 0 };
    const updatePayload = changes.map(change => ({
        id: change.id,
        new_late_minutes: change.after.late_minutes,
        new_overtime_minutes: change.after.overtime_minutes,
        new_status: change.after.status
    }));
    const updated = await client.query(
        `WITH changes AS (
            SELECT *
              FROM jsonb_to_recordset($1::jsonb)
                   AS x(id int, new_late_minutes int, new_overtime_minutes int, new_status text)
         )
         UPDATE hr_time_records tr
            SET late_minutes = changes.new_late_minutes,
                overtime_minutes = changes.new_overtime_minutes,
                status = changes.new_status,
                updated_at = NOW()
           FROM changes
          WHERE tr.id = changes.id
          RETURNING tr.id`,
        [JSON.stringify(updatePayload)]
    );
    const auditPayload = changes.map(change => ({
        staff_id: change.staff_id,
        details: {
            script: 'fix-attendance-historical-grace',
            script_version: SCRIPT_VERSION,
            plan_hash: planHash,
            backup_file: backupFile,
            owner: options.owner,
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
        [JSON.stringify(auditPayload), options.owner]
    );
    if (updated.rowCount !== changes.length) {
        throw new Error(`Updated ${updated.rowCount} rows, expected ${changes.length}`);
    }
    if (audit.rowCount !== changes.length) {
        throw new Error(`Inserted ${audit.rowCount} audit rows, expected ${changes.length}`);
    }
    return { updatedRows: updated.rowCount, auditRows: audit.rowCount };
}

function buildReport(options, changes, payrollImpact, planHash, extra = {}) {
    return {
        generatedAt: new Date().toISOString(),
        mode: options.apply ? 'apply' : 'dry_run',
        scriptVersion: SCRIPT_VERSION,
        approval: {
            owner: options.owner,
            reason: options.reason,
            scope: {
                from: options.from,
                to: options.to,
                businessContext: options.businessContext,
                categories: options.categories,
                lockedPaidClosedPayrollCanChange: false
            }
        },
        summary: summarizeChanges(changes),
        payrollImpact,
        planHash,
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
            await client.query('BEGIN');
            await client.query(`SET LOCAL statement_timeout = '45s'`);
            await client.query(`SET LOCAL idle_in_transaction_session_timeout = '45s'`);
            const readonly = await client.query('SHOW transaction_read_only');
            if (readonly.rows[0]?.transaction_read_only === 'on') {
                throw new Error('PostgreSQL transaction is read-only; cannot apply data-fix');
            }
            const changes = await loadCandidateChanges(client, options, { forUpdate: true });
            const payrollImpact = await loadPayrollImpact(client, changes);
            assertPayrollWriteAllowed(payrollImpact);
            const planHash = buildPlanHash(options, changes, payrollImpact);
            if (options.reviewToken !== planHash) {
                throw new Error(`--review-token does not match current dry-run planHash. Current planHash: ${planHash}`);
            }
            const backupPayload = await loadBackupPayload(client, options, changes, payrollImpact, planHash);
            const backupFile = writeBackupFile(options, backupPayload);
            const applyResult = await applyChanges(client, options, changes, backupFile, planHash);
            await client.query('COMMIT');
            return buildReport(options, changes, payrollImpact, planHash, {
                applied: true,
                backupFile,
                applyResult
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
        const planHash = buildPlanHash(options, changes, payrollImpact);
        await client.query('ROLLBACK');
        return buildReport(options, changes, payrollImpact, planHash, { applied: false });
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
        `Owner: ${report.approval.owner}`,
        `Reason: ${report.approval.reason}`,
        `Scope: ${report.approval.scope.from} to ${report.approval.scope.to}, businessContext=${report.approval.scope.businessContext}`,
        `Categories: ${report.approval.scope.categories.join(', ')}`,
        `Plan hash: ${report.planHash}`,
        '',
        '## Summary',
        '',
        `- Rows: ${report.summary.totalRows}`,
        `- Distinct staff: ${report.summary.distinctStaff}`,
        `- By category: ${JSON.stringify(report.summary.byCategory)}`,
        `- By month: ${JSON.stringify(report.summary.byMonth)}`,
        '',
        '## Payroll impact',
        '',
        `Risk: ${report.payrollImpact.risk}`,
        '',
        '| Month | Candidate records | Staff | Locked | Payroll reports | Closed reports | Paid reports |',
        '| --- | ---: | ---: | --- | ---: | ---: | ---: |',
        ...(report.payrollImpact.periods || []).map(period => (
            `| ${period.month} | ${period.candidateRecords} | ${period.candidateStaff} | ${period.payrollPeriodLocked || period.hasLockTimestamp ? 'yes' : 'no'} | ${period.payrollReports} | ${period.closedPayrollReports} | ${period.paidPayrollReports} |`
        )),
        '',
        report.mode === 'dry_run'
            ? `Apply gate: review this output, then rerun with --review-token ${report.planHash} and --confirm "${report.applyGate.requiredConfirm}".`
            : `Applied: ${report.applied === true}; backup: ${report.backupFile || 'n/a'}`
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
    CATEGORY_OVERTIME_GRACE,
    assertPayrollWriteAllowed,
    buildPlanHash,
    buildReport,
    expectedApplyConfirmation,
    parseArgs,
    planChange,
    renderMarkdown,
    runDataFix,
    summarizeChanges
};
