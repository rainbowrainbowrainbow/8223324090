'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const audit = require('../scripts/audit-attendance-historical-impact');

test('anomaly audit parses the documented categories and aliases', () => {
    const options = audit.parseArgs([
        '--from', '2026-07-01',
        '--to', '2026-07-31',
        '--business-context', 'event_genix',
        '--categories', 'late,overtime,status-conflict,null-late,missing-plan-source',
        '--format', 'markdown'
    ]);

    assert.deepEqual(options.categories, [
        'late-grace',
        'legacy-status-conflict',
        'missing-plan-source',
        'null-zero-negative-late',
        'overtime-grace'
    ]);
    assert.equal(options.format, 'markdown');
});

test('anomaly audit blocks write flags including assignment syntax', () => {
    for (const flag of ['--apply', '--fix=true', '--write=1', '--execute', '--update=yes']) {
        assert.throws(
            () => audit.parseArgs([flag]),
            /read-only only/
        );
    }
});

test('anomaly audit accepts exactly one dedicated read-only connection variable', () => {
    const config = audit.poolConfig({
        ATTENDANCE_AUDIT_DATABASE_URL: 'postgres://readonly.example/audit'
    });

    assert.equal(config.connectionString, 'postgres://readonly.example/audit');
    assert.equal(config.application_name, 'attendance_historical_readonly_audit');
    assert.throws(() => audit.poolConfig({}), /Set exactly one/);
    assert.throws(
        () => audit.poolConfig({
            ATTENDANCE_AUDIT_DATABASE_URL: 'postgres://readonly.example/audit',
            PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly.example/other'
        }),
        /Set exactly one/
    );

    const localConfig = audit.poolConfig({
        PRODUCTION_READONLY_DATABASE_URL: 'postgres://readonly:secret@127.0.0.1:5432/audit'
    });
    assert.equal(localConfig.ssl, false);
});

test('anomaly audit fails closed when generic or write-capable database variables exist', () => {
    const unsafeEnvironments = [
        { DATABASE_URL: 'postgres://write.example/main' },
        { ATTENDANCE_DATA_FIX_DATABASE_URL: 'postgres://write.example/main' },
        { PGHOST: 'production.example', PGDATABASE: 'event_genix' },
        {
            ATTENDANCE_AUDIT_DATABASE_URL: 'postgres://readonly.example/audit',
            DATABASE_URL: 'postgres://write.example/main'
        }
    ];

    for (const environment of unsafeEnvironments) {
        assert.throws(() => audit.poolConfig(environment), /Unsafe database environment variables/);
    }
});

test('legacy status conflicts only flag stale legacy labels', () => {
    const sql = audit.LEGACY_STATUS_CONFLICT_SQL;

    assert.match(sql, /status = 'late'.*late_minutes IS NULL OR late_minutes <= 5/s);
    assert.match(sql, /status = 'early_leave'.*late_minutes, 0\) > 5.*early_leave_minutes, 0\) <= 0/s);
    assert.match(sql, /status IN \('present', 'unscheduled', 'clocked_in'\).*late_minutes, 0\) > 5/s);
    assert.match(sql, /late_minutes, 0\) <= 5.*early_leave_minutes, 0\) > 0/s);
    assert.doesNotMatch(sql, /overtime_minutes/);
    assert.doesNotMatch(sql, /status\s*<>\s*'late'/);
});

test('plan source statistics do not become attendance anomaly or payroll candidates', () => {
    assert.deepEqual(
        audit.anomalyCategories([
            audit.CATEGORY_MISSING_PLAN_SOURCE,
            'inferred-profession-card'
        ]),
        []
    );
    assert.deepEqual(
        audit.anomalyCategories([
            audit.CATEGORY_LATE_GRACE,
            audit.CATEGORY_MISSING_PLAN_SOURCE,
            audit.CATEGORY_OVERTIME_GRACE
        ]),
        [audit.CATEGORY_LATE_GRACE, audit.CATEGORY_OVERTIME_GRACE]
    );
});

test('severity distinguishes zero, anomaly, and protected payroll overlap scenarios', () => {
    assert.equal(
        audit.severityFromAudit({ uniqueRecords: 0 }, { periods: [] }),
        'none_detected'
    );
    assert.equal(
        audit.severityFromAudit({ uniqueRecords: 2 }, { periods: [] }),
        'warning'
    );
    assert.equal(
        audit.severityFromAudit(
            { uniqueRecords: 2 },
            { periods: [{ payrollPeriodLocked: true, payrollReports: 1, closedPayrollReports: 1, paidPayrollReports: 0 }] }
        ),
        'high'
    );
    assert.equal(
        audit.severityFromAudit(
            { uniqueRecords: 1 },
            { periods: [{ payrollPeriodLocked: false, payrollReports: 1, closedPayrollReports: 0, paidPayrollReports: 0 }] }
        ),
        'warning'
    );
});

test('read-only connection guard rejects writable roles', () => {
    assert.doesNotThrow(() => audit.assertReadOnlyConnectionState({
        transactionReadOnly: 'on',
        defaultTransactionReadOnly: 'on',
        writePrivileges: [{ table_name: 'hr_time_records', can_insert: false, can_update: false, can_delete: false, can_truncate: false }]
    }));
    assert.throws(
        () => audit.assertReadOnlyConnectionState({
            transactionReadOnly: 'on',
            defaultTransactionReadOnly: 'off',
            writePrivileges: []
        }),
        /does not default to read-only/
    );
    assert.throws(
        () => audit.assertReadOnlyConnectionState({
            transactionReadOnly: 'on',
            defaultTransactionReadOnly: 'on',
            writePrivileges: [{ table_name: 'hr_time_records', can_update: true }]
        }),
        /write privileges/
    );
});

test('markdown output is aggregate-only and includes severity', () => {
    const report = {
        generatedAt: '2026-07-19T00:00:00.000Z',
        mode: 'read_only',
        severity: 'warning',
        filters: {
            from: '2026-07-01',
            to: '2026-07-31',
            businessContext: 'event_genix',
            categories: ['late-grace']
        },
        overview: {
            totalRows: 10,
            rowsWithClockIn: 9,
            rowsWithClockOut: 8,
            distinctStaff: 3,
            minDate: '2026-07-01',
            maxDate: '2026-07-31'
        },
        anomalySummary: {
            uniqueRecords: 2,
            distinctStaff: 1,
            minDate: '2026-07-02',
            maxDate: '2026-07-03'
        },
        metrics: [{
            key: 'late_status_within_grace',
            rows: 2,
            distinctStaff: 1,
            minDate: '2026-07-02',
            maxDate: '2026-07-03'
        }],
        payrollImpact: {
            risk: 'low',
            periods: [{
                month: '2026-07',
                candidateRecords: 2,
                candidateStaff: 1,
                payrollPeriodLocked: false,
                payrollReports: 1,
                closedPayrollReports: 0,
                paidPayrollReports: 0
            }]
        }
    };

    const markdown = audit.renderMarkdown(report);
    assert.match(markdown, /Severity: warning/);
    assert.match(markdown, /Unique records: 2/);
    assert.doesNotMatch(markdown, /staff_id|record_id|staff name/i);
});
