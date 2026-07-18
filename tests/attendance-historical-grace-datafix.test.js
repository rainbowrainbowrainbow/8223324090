'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'fix-attendance-historical-grace.js');
const {
    assertPayrollWriteAllowed,
    buildPlanHash,
    buildReport,
    expectedApplyConfirmation,
    parseArgs,
    planChange,
    summarizeChanges
} = require(SCRIPT_PATH);

function baseArgs(extra = []) {
    return [
        '--from', '2026-07-01',
        '--to', '2026-07-18',
        '--business-context', 'event_genix',
        '--owner', 'Director / Сергій',
        '--reason', 'reports only; no payroll period changes',
        '--categories', 'late-grace,overtime-grace',
        ...extra
    ];
}

test('historical grace data-fix requires explicit narrow scope', () => {
    assert.throws(
        () => parseArgs(['--from', '2026-07-01', '--to', '2026-07-18']),
        /--owner is required/
    );
    assert.throws(
        () => parseArgs(baseArgs(['--categories', 'missing-plan-source'])),
        /Write-mode is not implemented/
    );
    assert.throws(
        () => parseArgs(baseArgs(['--from', '2026-08-01', '--to', '2026-07-01'])),
        /--from must be before/
    );
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
    const reviewedHash = buildPlanHash(options, changes, payrollImpact);
    assert.notEqual(
        reviewedHash,
        buildPlanHash({ ...options, owner: 'Different owner' }, changes, payrollImpact)
    );
    assert.notEqual(
        reviewedHash,
        buildPlanHash({ ...options, reason: 'Different reason' }, changes, payrollImpact)
    );
    assert.notEqual(
        reviewedHash,
        buildPlanHash(options, changes, {
            ...payrollImpact,
            payrollPeriodLocksTablePresent: false,
            risk: 'unknown_schema'
        })
    );
    assert.notEqual(
        reviewedHash,
        buildPlanHash(options, changes, { ...payrollImpact, risk: 'low' })
    );
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
    assert.match(source, /attendance_historical_grace_data_fix/);
    assert.match(source, /hr_audit_log/);
    assert.match(source, /payroll_period_locks/);
    assert.match(source, /closed_payroll_reports/);
    assert.doesNotMatch(source, /UPDATE\s+payroll_reports/i);
    assert.doesNotMatch(source, /UPDATE\s+payroll_period_locks/i);
});
