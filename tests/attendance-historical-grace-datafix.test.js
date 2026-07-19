'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'fix-attendance-historical-grace.js');
const AUDIT_SCRIPT_PATH = path.join(ROOT, 'scripts', 'audit-attendance-historical-impact.js');
const {
    assertPayrollWriteAllowed,
    buildApprovalManifest,
    buildPlanHash,
    buildReport,
    candidateSelectSql,
    categorySql,
    countOverlappingChanges,
    expectedApplyConfirmation,
    parseArgs,
    planChange,
    poolConfig,
    summarizeChanges
} = require(SCRIPT_PATH);
const auditScript = require(AUDIT_SCRIPT_PATH);

function baseArgs(extra = []) {
    return [
        '--from', '2026-07-01',
        '--to', '2026-07-18',
        '--business-context', 'event_genix',
        '--owner', 'Director / Сергій',
        '--executed-by', 'Codex QA',
        '--reason', 'reports only; no payroll period changes',
        '--categories', 'late-grace,overtime-grace',
        ...extra
    ];
}

test('historical grace data-fix requires explicit narrow scope', () => {
    assert.throws(
        () => parseArgs(['--from', '2026-07-01', '--to', '2026-07-18']),
        /--approved-by\/--owner is required/
    );
    assert.throws(
        () => parseArgs(baseArgs(['--categories', 'missing-plan-source'])),
        /Write-mode is not implemented/
    );
    assert.throws(
        () => parseArgs(baseArgs(['--from', '2026-08-01', '--to', '2026-07-01'])),
        /--from must be before/
    );
    assert.throws(
        () => parseArgs(baseArgs(['--business-context', 'reports_only'])),
        /business-context reports_only is invalid/
    );
    assert.throws(
        () => parseArgs(baseArgs(['--categories', 'null-zero-negative-late'])),
        /read-only audit only/
    );
    assert.throws(
        () => parseArgs(baseArgs(['--write'])),
        /--write is not supported/
    );
    assert.equal(parseArgs(baseArgs()).maxRecords, 500);
    assert.equal(parseArgs(baseArgs(['--max-records', '25'])).maxRecords, 25);
    assert.throws(
        () => parseArgs(baseArgs(['--max-records', '0'])),
        /--max-records/
    );
});

test('candidate SQL matches approved categories and preserves NULL before-values', () => {
    const options = parseArgs(baseArgs());
    const sql = candidateSelectSql(options);

    assert.match(categorySql(options.categories, 'tr'), /tr\.status = 'late' AND tr\.late_minutes BETWEEN 1 AND 5/);
    assert.doesNotMatch(categorySql(options.categories, 'tr'), /COALESCE\(tr\.late_minutes, 0\) <= 5/);
    assert.match(sql, /tr\.late_minutes::int AS late_minutes/);
    assert.match(sql, /tr\.early_leave_minutes::int AS early_leave_minutes/);
    assert.match(sql, /tr\.overtime_minutes::int AS overtime_minutes/);
    assert.doesNotMatch(sql, /COALESCE\(tr\.late_minutes, 0\)::int AS late_minutes/);
});

test('dry-run accepts only dedicated read-only database URLs', () => {
    const saved = {
        ATTENDANCE_AUDIT_DATABASE_URL: process.env.ATTENDANCE_AUDIT_DATABASE_URL,
        PRODUCTION_READONLY_DATABASE_URL: process.env.PRODUCTION_READONLY_DATABASE_URL,
        ATTENDANCE_DATA_FIX_DATABASE_URL: process.env.ATTENDANCE_DATA_FIX_DATABASE_URL,
        DATABASE_URL: process.env.DATABASE_URL,
        PGDATABASE: process.env.PGDATABASE
    };
    try {
        delete process.env.ATTENDANCE_AUDIT_DATABASE_URL;
        delete process.env.PRODUCTION_READONLY_DATABASE_URL;
        process.env.ATTENDANCE_DATA_FIX_DATABASE_URL = 'postgres://write.example/db';
        process.env.DATABASE_URL = 'postgres://generic.example/db';
        process.env.PGDATABASE = 'event_genix';
        assert.throws(
            () => poolConfig(parseArgs(baseArgs())),
            /ATTENDANCE_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL/
        );
        process.env.ATTENDANCE_AUDIT_DATABASE_URL = 'postgres://readonly.example/db';
        const config = poolConfig(parseArgs(baseArgs()));
        assert.equal(config.connectionString, 'postgres://readonly.example/db');
        assert.equal(config.application_name, 'attendance_historical_grace_data_fix_dry_run');
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test('general historical audit filters payroll candidates by selected categories', () => {
    const options = auditScript.parseArgs([
        '--from', '2026-07-01',
        '--to', '2026-07-18',
        '--business-context', 'event_genix',
        '--categories', 'late-grace,overtime-grace'
    ]);
    const cte = auditScript.candidateCte({ sql: '', values: [] }, options.categories);

    assert.deepEqual(options.categories, ['late-grace', 'overtime-grace']);
    assert.match(cte, /late_minutes BETWEEN 1 AND 5/);
    assert.match(cte, /overtime_within_grace/);
    assert.doesNotMatch(cte, /missing_audit_plan_source/);
    assert.doesNotMatch(cte, /inferred_profession_card/);
    assert.doesNotMatch(cte, /null_zero_negative_late/);
});

test('apply mode requires dry-run review token, backup directory and typed confirmation', () => {
    assert.throws(
        () => parseArgs(baseArgs(['--apply'])),
        /--backup-dir is required/
    );
    assert.throws(
        () => parseArgs(baseArgs(['--apply', '--backup-dir', 'C:\\tmp\\attendance-backups'])),
        /--review-token/
    );
    const dryRunOptions = parseArgs(baseArgs());
    const confirm = expectedApplyConfirmation(dryRunOptions);
    const applyOptions = parseArgs(baseArgs([
        '--apply',
        '--backup-dir', 'C:\\tmp\\attendance-backups',
        '--review-token', 'abc123',
        '--confirm', confirm
    ]));
    assert.equal(applyOptions.apply, true);
    assert.equal(applyOptions.dryRun, false);
});

test('late grace mismatch clears late minutes and recalculates legacy status', () => {
    const present = planChange({
        id: 1,
        staff_id: 10,
        record_date: '2026-07-03',
        business_context: 'event_genix',
        status: 'late',
        late_minutes: 5,
        early_leave_minutes: 0,
        overtime_minutes: 0,
        fix_late_grace: true,
        fix_overtime_grace: false
    });
    assert.deepEqual(present.categories, ['late-grace']);
    assert.deepEqual(present.after, {
        status: 'present',
        late_minutes: 0,
        early_leave_minutes: 0,
        overtime_minutes: 0
    });

    const earlyLeave = planChange({
        id: 2,
        staff_id: 10,
        record_date: '2026-07-04',
        business_context: 'event_genix',
        status: 'late',
        late_minutes: 4,
        early_leave_minutes: 20,
        overtime_minutes: 0,
        fix_late_grace: true,
        fix_overtime_grace: false
    });
    assert.equal(earlyLeave.after.status, 'early_leave');
    assert.equal(earlyLeave.after.late_minutes, 0);
});

test('overtime grace mismatch clears only 1-15 minute attendance overtime', () => {
    const overtimeOnly = planChange({
        id: 3,
        staff_id: 11,
        record_date: '2026-07-05',
        business_context: 'event_genix',
        status: 'present',
        late_minutes: 0,
        early_leave_minutes: 0,
        overtime_minutes: 15,
        fix_late_grace: false,
        fix_overtime_grace: true
    });
    assert.deepEqual(overtimeOnly.categories, ['overtime-grace']);
    assert.equal(overtimeOnly.after.overtime_minutes, 0);
    assert.equal(overtimeOnly.after.status, 'present');

    const stillLate = planChange({
        id: 4,
        staff_id: 11,
        record_date: '2026-07-06',
        business_context: 'event_genix',
        status: 'late',
        late_minutes: 12,
        early_leave_minutes: 0,
        overtime_minutes: 10,
        fix_late_grace: false,
        fix_overtime_grace: true
    });
    assert.equal(stillLate.after.late_minutes, 12);
    assert.equal(stillLate.after.overtime_minutes, 0);
    assert.equal(stillLate.after.status, 'late');
});

test('overtime-only plan preserves nullable late before-values and status', () => {
    const overtimeOnly = planChange({
        id: 40,
        staff_id: 11,
        record_date: '2026-07-06',
        business_context: 'event_genix',
        status: 'overtime',
        late_minutes: null,
        early_leave_minutes: null,
        overtime_minutes: 10,
        fix_late_grace: false,
        fix_overtime_grace: true
    });

    assert.deepEqual(overtimeOnly.before, {
        status: 'overtime',
        late_minutes: null,
        early_leave_minutes: null,
        overtime_minutes: 10
    });
    assert.deepEqual(overtimeOnly.after, {
        status: 'overtime',
        late_minutes: null,
        early_leave_minutes: null,
        overtime_minutes: 0
    });
});

test('summary is aggregate-only and counts rows once even when both categories apply', () => {
    const changes = [
        planChange({
            id: 5,
            staff_id: 12,
            record_date: '2026-07-07',
            business_context: 'event_genix',
            status: 'late',
            late_minutes: 5,
            early_leave_minutes: 0,
            overtime_minutes: 10,
            fix_late_grace: true,
            fix_overtime_grace: true
        })
    ];
    assert.equal(changes[0].categories.length, 2);
    assert.deepEqual(summarizeChanges(changes), {
        totalRows: 1,
        distinctStaff: 1,
        byCategory: {
            'late-grace': 1,
            'overtime-grace': 1
        },
        byMonth: {
            '2026-07': { rows: 1, distinctStaff: 1 }
        }
    });
});

test('plan hash binds the reviewed owner and reason', () => {
    const options = parseArgs(baseArgs());
    const changes = [{
        id: 6,
        staff_id: 13,
        record_date: '2026-07-08',
        categories: ['late-grace'],
        before: { status: 'late', late_minutes: 5, early_leave_minutes: 0, overtime_minutes: 0 },
        after: { status: 'present', late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0 }
    }];
    const payrollImpact = {
        payrollReportsTablePresent: true,
        payrollPeriodLocksTablePresent: true,
        risk: 'none_detected',
        periods: []
    };
    const runtimeMetadata = {
        gitSha: 'git-a',
        scriptSha256: 'script-a',
        scriptVersion: 2,
        dbFingerprint: 'db-a',
        dbRole: 'readonly_attendance_audit'
    };
    const reviewedHash = buildPlanHash(options, changes, payrollImpact, runtimeMetadata);
    assert.notEqual(
        reviewedHash,
        buildPlanHash({ ...options, approvedBy: 'Different owner', owner: 'Different owner' }, changes, payrollImpact, runtimeMetadata)
    );
    assert.notEqual(
        reviewedHash,
        buildPlanHash({ ...options, reason: 'Different reason' }, changes, payrollImpact, runtimeMetadata)
    );
    assert.notEqual(
        reviewedHash,
        buildPlanHash(options, changes, {
            ...payrollImpact,
            payrollPeriodLocksTablePresent: false,
            risk: 'unknown_schema'
        }, runtimeMetadata)
    );
    assert.notEqual(
        reviewedHash,
        buildPlanHash(options, changes, { ...payrollImpact, risk: 'low' }, runtimeMetadata)
    );
    assert.notEqual(
        reviewedHash,
        buildPlanHash(options, changes, payrollImpact, { ...runtimeMetadata, scriptSha256: 'script-b' })
    );
    assert.notEqual(
        reviewedHash,
        buildPlanHash(options, changes, payrollImpact, { ...runtimeMetadata, dbFingerprint: 'db-b' })
    );
    assert.equal(
        reviewedHash,
        buildPlanHash(options, changes, payrollImpact, { ...runtimeMetadata, dbRole: 'attendance_data_fix_writer' })
    );
});

test('approval manifest is aggregate-only and binds operation metadata', () => {
    const options = parseArgs(baseArgs(['--max-records', '25']));
    const changes = [
        planChange({
            id: 50,
            staff_id: 15,
            record_date: '2026-07-08',
            business_context: 'event_genix',
            status: 'late',
            late_minutes: 5,
            early_leave_minutes: 0,
            overtime_minutes: 10,
            fix_late_grace: true,
            fix_overtime_grace: true
        })
    ];
    const payrollImpact = {
        payrollReportsTablePresent: true,
        payrollPeriodLocksTablePresent: true,
        risk: 'none_detected',
        periods: []
    };
    const runtimeMetadata = {
        gitSha: 'git-a',
        scriptSha256: 'script-a',
        scriptVersion: 2,
        dbFingerprint: 'db-a',
        dbRole: 'readonly_attendance_audit'
    };
    const planHash = buildPlanHash(options, changes, payrollImpact, runtimeMetadata);
    const manifest = buildApprovalManifest(options, changes, payrollImpact, runtimeMetadata, planHash, new Date('2026-07-19T10:00:00.000Z'));

    assert.equal(manifest.operationId, `attendance-grace-2026-07-01-2026-07-18-${planHash.slice(0, 12)}`);
    assert.equal(manifest.gitSha, 'git-a');
    assert.equal(manifest.scriptSha256, 'script-a');
    assert.equal(manifest.dbFingerprint, 'db-a');
    assert.equal(manifest.dbRole, 'readonly_attendance_audit');
    assert.equal(manifest.scope.maxRecords, 25);
    assert.equal(manifest.categoryCounts['late-grace'], 1);
    assert.equal(manifest.categoryCounts['overtime-grace'], 1);
    assert.equal(manifest.overlap.lateAndOvertimeRecords, 1);
    assert.equal(countOverlappingChanges(changes), 1);
    assert.equal(JSON.stringify(manifest).includes('"staff_id"'), false);
    assert.equal(JSON.stringify(manifest).includes('"before"'), false);
});

test('payroll apply guard fails closed when control tables or protected periods are present', () => {
    assert.throws(
        () => assertPayrollWriteAllowed({
            payrollReportsTablePresent: false,
            payrollPeriodLocksTablePresent: true,
            periods: []
        }),
        /payroll_reports guard table is unavailable/
    );
    assert.throws(
        () => assertPayrollWriteAllowed({
            payrollReportsTablePresent: true,
            payrollPeriodLocksTablePresent: false,
            periods: []
        }),
        /payroll_period_locks guard table is unavailable/
    );
    assert.throws(
        () => assertPayrollWriteAllowed({
            payrollReportsTablePresent: true,
            payrollPeriodLocksTablePresent: true,
            periods: [{
                month: '2026-07',
                payrollPeriodLocked: false,
                hasLockTimestamp: false,
                closedPayrollReports: 1,
                paidPayrollReports: 0
            }]
        }),
        /locked\/closed\/paid payroll impact/
    );
    for (const protectedState of [
        { payrollPeriodLocked: true },
        { hasLockTimestamp: true },
        { paidPayrollReports: 1 }
    ]) {
        assert.throws(
            () => assertPayrollWriteAllowed({
                payrollReportsTablePresent: true,
                payrollPeriodLocksTablePresent: true,
                periods: [{
                    month: '2026-07',
                    payrollPeriodLocked: false,
                    hasLockTimestamp: false,
                    closedPayrollReports: 0,
                    paidPayrollReports: 0,
                    ...protectedState
                }]
            }),
            /locked\/closed\/paid payroll impact/
        );
    }
    assert.doesNotThrow(() => assertPayrollWriteAllowed({
        payrollReportsTablePresent: true,
        payrollPeriodLocksTablePresent: true,
        periods: [{
            month: '2026-07',
            payrollPeriodLocked: false,
            hasLockTimestamp: false,
            closedPayrollReports: 0,
            paidPayrollReports: 0
        }]
    }));
});

test('final dry-run report remains aggregate-only', () => {
    const options = parseArgs(baseArgs());
    const changes = [{
        id: 7,
        staff_id: 14,
        record_date: '2026-07-09',
        categories: ['overtime-grace'],
        before: { status: 'present', late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 10 },
        after: { status: 'present', late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0 }
    }];
    const payrollImpact = {
        payrollReportsTablePresent: true,
        payrollPeriodLocksTablePresent: true,
        risk: 'none_detected',
        periods: []
    };
    const report = buildReport(
        options,
        changes,
        payrollImpact,
        buildPlanHash(options, changes, payrollImpact),
        { applied: false }
    );
    assert.equal(Object.hasOwn(report, 'sampleChanges'), false);
    const serializedReport = JSON.stringify(report);
    for (const privateField of ['"id"', '"staff_id"', '"staffId"', '"before"', '"after"']) {
        assert.equal(serializedReport.includes(privateField), false);
    }
    assert.equal(report.summary.totalRows, 1);
});

test('script keeps production safety guardrails in source', () => {
    const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
    assert.match(source, /BEGIN READ ONLY/);
    assert.match(source, /FOR UPDATE/);
    assert.match(source, /ATTENDANCE_DATA_FIX_DATABASE_URL/);
    assert.match(source, /ATTENDANCE_AUDIT_DATABASE_URL or PRODUCTION_READONLY_DATABASE_URL/);
    assert.match(source, /late_minutes BETWEEN 1 AND 5/);
    assert.match(source, /IS NOT DISTINCT FROM changes\.before_late_minutes/);
    assert.match(source, /attendance_historical_grace_data_fix/);
    assert.match(source, /hr_audit_log/);
    assert.match(source, /payroll_period_locks/);
    assert.match(source, /closed_payroll_reports/);
    assert.doesNotMatch(source, /COALESCE\([^)]*late_minutes[^)]*, 0\) <= 5/);
    assert.doesNotMatch(source, /UPDATE\s+payroll_reports/i);
    assert.doesNotMatch(source, /UPDATE\s+payroll_period_locks/i);
});
