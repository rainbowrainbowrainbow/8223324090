'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const audit = require('../scripts/audit-attendance-snapshot-writers');

function aggregateRow(overrides = {}) {
    return {
        cohort: 'post_fix',
        writer_category: 'clock_in_out',
        total: 1,
        planned_snapshots: 0,
        final_snapshots: 0,
        explicit_base_only_final_snapshots: 0,
        missing_snapshots: 0,
        invalid_or_manual_review_snapshots: 0,
        paid_allocation_without_valid_final_snapshot: 0,
        unknown_writers: 0,
        ...overrides
    };
}

function config(overrides = {}) {
    return {
        effectiveDate: '2026-07-18',
        deploymentCutoffIso: '2026-07-18T13:45:00.000Z',
        deploymentEvidence: 'CI/Railway deploy completed timestamp verified',
        releaseGate: true,
        ...overrides
    };
}

test('attendance snapshot audit requires exact deployed-at timestamp with timezone and evidence', () => {
    assert.throws(
        () => audit.requireConfiguration({
            confirmation: audit.CONFIRMATION,
            databaseUrl: 'postgres://disposable/test',
            effectiveDate: '2026-07-18',
            deploymentCutoff: null,
            deploymentEvidence: 'Railway deploy completed'
        }),
        /DEPLOYED_AT is required/
    );
    assert.throws(
        () => audit.requireConfiguration({
            confirmation: audit.CONFIRMATION,
            databaseUrl: 'postgres://disposable/test',
            effectiveDate: '2026-07-18',
            deploymentCutoff: '2026-07-18T13:45:00',
            deploymentEvidence: 'Railway deploy completed'
        }),
        /explicit timezone/
    );
    assert.throws(
        () => audit.requireConfiguration({
            confirmation: audit.CONFIRMATION,
            databaseUrl: 'postgres://disposable/test',
            effectiveDate: '2026-07-18',
            deploymentCutoff: '2026-07-18T13:45:00+03:00',
            deploymentEvidence: ''
        }),
        /DEPLOYMENT_EVIDENCE is required/
    );
    const parsed = audit.requireConfiguration({
        confirmation: audit.CONFIRMATION,
        databaseUrl: 'postgres://disposable/test',
        effectiveDate: '2026-07-18',
        deploymentCutoff: '2026-07-18T13:45:00+03:00',
        deploymentEvidence: 'Railway deploy completed'
    });
    assert.equal(parsed.deploymentCutoffIso, '2026-07-18T10:45:00.000Z');
});

test('attendance snapshot audit classifies all expected writer categories', () => {
    assert.equal(audit.classifyWriter({
        notes: 'Hermes arrival-sheet import import-public-id / row-1',
        audit_events: [{ action: 'attendance_hermes_apply', source: 'hermes_attendance_import' }]
    }), 'hermes_import');
    assert.equal(audit.classifyWriter({
        auditEvents: [{ action: 'live_multi_segment_qa_attendance_create' }]
    }), 'qa_helper');
    assert.equal(audit.classifyWriter({
        audit_events: [{ action: 'leave_request_review', trigger: 'leave_request' }]
    }), 'leave_approval');
    assert.equal(audit.classifyWriter({ status: 'no_show' }), 'no_show_scheduler');
    assert.equal(audit.classifyWriter({ auto_closed: true }), 'auto_close');
    assert.equal(audit.classifyWriter({ corrected_at: '2026-07-18T12:00:00.000Z' }), 'correction');
    assert.equal(audit.classifyWriter({ status: 'vacation', clock_in: null, clock_out: null }), 'terminal_status');
    assert.equal(audit.classifyWriter({ clock_in: '2026-07-18T08:00:00.000Z' }), 'clock_in_out');
    assert.equal(audit.classifyWriter({ status: 'present' }), 'unknown');
});

test('attendance snapshot audit separates historical Hermes exceptions from post-fix cohort', () => {
    const report = audit.summarizeAuditRows([
        aggregateRow({
            cohort: 'historical_exceptions',
            writer_category: 'hermes_import',
            total: 14,
            missing_snapshots: 14
        }),
        aggregateRow({
            cohort: 'post_fix',
            writer_category: 'clock_in_out',
            total: 3,
            planned_snapshots: 1,
            final_snapshots: 2,
            explicit_base_only_final_snapshots: 1
        }),
        aggregateRow({
            cohort: 'post_fix',
            writer_category: 'terminal_status',
            total: 1,
            final_snapshots: 1,
            explicit_base_only_final_snapshots: 1
        })
    ], config(), { queryComplete: true, missingRequirements: [] });

    assert.equal(report.cohorts.historicalExceptions.total, 14);
    assert.equal(report.cohorts.historicalExceptions.missingSnapshots, 14);
    assert.equal(report.cohorts.historicalExceptions.writerCategories.hermes_import, 14);
    assert.equal(report.coverage.policyRecords, 0);
    assert.equal(report.cohorts.postFix.total, 4);
    assert.equal(report.cohorts.postFix.plannedSnapshots, 1);
    assert.equal(report.cohorts.postFix.finalSnapshots, 3);
    assert.equal(report.cohorts.postFix.explicitBaseOnlyFinalSnapshots, 2);
    assert.equal(report.releaseGate.status, 'passed');
});

test('attendance snapshot release gate ignores historical 14 but fails post-fix gaps', () => {
    const historicalOnly = audit.summarizeAuditRows([
        aggregateRow({
            cohort: 'historical_exceptions',
            writer_category: 'hermes_import',
            total: 14,
            missing_snapshots: 14
        })
    ], config(), { queryComplete: true, missingRequirements: [] });
    assert.equal(historicalOnly.releaseGate.status, 'passed');

    const postFixMissing = audit.summarizeAuditRows([
        aggregateRow({ cohort: 'post_fix', writer_category: 'clock_in_out', total: 1, missing_snapshots: 1 })
    ], config(), { queryComplete: true, missingRequirements: [] });
    assert.equal(postFixMissing.releaseGate.status, 'failed');
    assert.ok(postFixMissing.releaseGate.blockers.some(blocker =>
        blocker.code === audit.SNAPSHOT_AUDIT_RELEASE_BLOCKERS.POST_FIX_MISSING));

    const paidWithoutFinal = audit.summarizeAuditRows([
        aggregateRow({
            cohort: 'post_fix',
            writer_category: 'clock_in_out',
            total: 1,
            planned_snapshots: 1,
            paid_allocation_without_valid_final_snapshot: 1
        })
    ], config(), { queryComplete: true, missingRequirements: [] });
    assert.equal(paidWithoutFinal.releaseGate.status, 'failed');
    assert.ok(paidWithoutFinal.releaseGate.blockers.some(blocker =>
        blocker.code === audit.SNAPSHOT_AUDIT_RELEASE_BLOCKERS.PAID_WITHOUT_FINAL));

    const unknownWriter = audit.summarizeAuditRows([
        aggregateRow({ cohort: 'post_fix', writer_category: 'unknown', total: 1, final_snapshots: 1, unknown_writers: 1 })
    ], config(), { queryComplete: true, missingRequirements: [] });
    assert.equal(unknownWriter.releaseGate.status, 'failed');
    assert.ok(unknownWriter.releaseGate.blockers.some(blocker =>
        blocker.code === audit.SNAPSHOT_AUDIT_RELEASE_BLOCKERS.UNKNOWN_WRITER));

    const incomplete = audit.summarizeAuditRows([], config(), {
        queryComplete: false,
        missingRequirements: [{ table: 'hr_time_records', column: 'compensation_snapshot' }]
    });
    assert.equal(incomplete.releaseGate.status, 'failed');
    assert.ok(incomplete.releaseGate.blockers.some(blocker =>
        blocker.code === audit.SNAPSHOT_AUDIT_RELEASE_BLOCKERS.INCOMPLETE));
});

test('attendance snapshot audit output remains aggregate-only and omits sensitive fields', () => {
    const report = audit.summarizeAuditRows([
        aggregateRow({ cohort: 'post_fix', writer_category: 'clock_in_out', total: 1, final_snapshots: 1 })
    ], config({ deploymentEvidence: 'Sensitive deploy id should not be printed' }), {
        queryComplete: true,
        missingRequirements: []
    });
    const output = JSON.stringify(report);

    assert.doesNotMatch(output, /staffId|staff_id|attendanceId|attendance_id|recordId|record_id/i);
    assert.doesNotMatch(output, /notes|auditEvents|audit_events|payload/i);
    assert.doesNotMatch(output, /"(hourlyRate|rate|amount|salary|payrollAmount|baseAmount|additionalAmount)"/i);
    assert.doesNotMatch(output, /Sensitive deploy id/i);
    assert.equal(report.deploymentCutoff.evidenceProvided, true);
});

test('attendance snapshot audit SQL contract uses record_date policy axis and created_at deployment cutoff', () => {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/audit-attendance-snapshot-writers.js'), 'utf8');
    const sql = audit.buildAuditSql();

    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /ROLLBACK/);
    const coverageSql = audit.buildCoverageSql();

    assert.match(sql, /tr\.record_date >= \$1::date/);
    assert.match(sql, /created_at >= \$2::timestamptz/);
    assert.match(coverageSql, /record_date >= \$1::date/);
    assert.match(coverageSql, /created_at >= \$2::timestamptz/);
    assert.match(sql, /WHEN compensation_snapshot IS NULL THEN 'historical_exceptions'/);
    assert.match(sql, /GROUP BY cohort, writer_category/);
    assert.doesNotMatch(sql, /SELECT\s+tr\.staff_id\b/i);
});
