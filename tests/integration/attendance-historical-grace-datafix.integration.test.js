'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const dataFix = require('../../scripts/fix-attendance-historical-grace');
const rollback = require('../../scripts/rollback-attendance-historical-grace');

const enabled = process.env.RUN_ATTENDANCE_DATAFIX_INTEGRATION === 'true';
const ROOT = path.resolve(__dirname, '..', '..');
const OWNER = 'Director / Serhii';
const EXECUTED_BY = 'Codex DB Test';
const REASON = 'reports_only; isolated PostgreSQL integration';
const BUSINESS_CONTEXT = 'event_genix';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_ATTENDANCE_DATAFIX_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createPool(testDb) {
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 10_000
    });
}

function backupDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-datafix-pg-'));
}

function buildDataFixArgs({ from, to = from, categories = 'late-grace,overtime-grace', maxRecords = 500, extra = [] }) {
    return [
        '--from', from,
        '--to', to,
        '--business-context', BUSINESS_CONTEXT,
        '--approved-by', OWNER,
        '--executed-by', EXECUTED_BY,
        '--reason', REASON,
        '--categories', categories,
        '--max-records', String(maxRecords),
        ...extra
    ];
}

async function runDryRun(scope) {
    const options = dataFix.parseArgs(buildDataFixArgs(scope));
    const report = await dataFix.runDataFix(options);
    return { options, report };
}

async function runApply(scope, dryRun, extra = []) {
    const options = dataFix.parseArgs(buildDataFixArgs({
        ...scope,
        extra: [
            '--apply',
            '--backup-dir', backupDir(),
            '--review-token', dryRun.report.planHash,
            '--confirm', dataFix.expectedApplyConfirmation(dryRun.options),
            ...extra
        ]
    }));
    return dataFix.runDataFix(options);
}

async function createStaff(client, label) {
    const result = await client.query(
        `INSERT INTO staff (name, department, position, is_active)
         VALUES ($1, 'qa', 'Historical attendance data-fix fixture', true)
         RETURNING id`,
        [`Fictional Historical Datafix ${label} ${process.pid} ${Date.now()} ${Math.random()}`]
    );
    return Number(result.rows[0].id);
}

async function createTimeRecord(client, {
    label,
    date,
    status = 'present',
    lateMinutes = 0,
    earlyLeaveMinutes = 0,
    overtimeMinutes = 0,
    totalWorkedMinutes = 480
}) {
    const staffId = await createStaff(client, label);
    const result = await client.query(
        `INSERT INTO hr_time_records (
            staff_id, record_date, clock_in, clock_out, planned_start, planned_end,
            late_minutes, early_leave_minutes, overtime_minutes, total_worked_minutes,
            status, business_context
         )
         VALUES (
            $1, $2::date, ($2::date + time '09:00') AT TIME ZONE 'UTC',
            ($2::date + time '18:00') AT TIME ZONE 'UTC', '09:00', '18:00',
            $3, $4, $5, $6, $7, $8
         )
         RETURNING id`,
        [
            staffId,
            date,
            lateMinutes,
            earlyLeaveMinutes,
            overtimeMinutes,
            totalWorkedMinutes,
            status,
            BUSINESS_CONTEXT
        ]
    );
    return { id: Number(result.rows[0].id), staffId, date };
}

async function loadRecord(client, id) {
    const result = await client.query(
        `SELECT id, staff_id, record_date::text AS record_date, status,
                late_minutes::int AS late_minutes,
                early_leave_minutes::int AS early_leave_minutes,
                overtime_minutes::int AS overtime_minutes,
                total_worked_minutes::int AS total_worked_minutes,
                planned_start::text AS planned_start,
                planned_end::text AS planned_end,
                clock_in::text AS clock_in,
                clock_out::text AS clock_out
           FROM hr_time_records
          WHERE id = $1`,
        [id]
    );
    assert.equal(result.rowCount, 1, `expected time record ${id}`);
    return result.rows[0];
}

async function countAudit(client, action, planHash) {
    const result = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM hr_audit_log
          WHERE action = $1
            AND details->>'plan_hash' = $2`,
        [action, planHash]
    );
    return Number(result.rows[0].count || 0);
}

async function createPayrollReport(client, staffId, month, fields = {}) {
    const result = await client.query(
        `INSERT INTO payroll_reports (
            period_month, staff_id, gross_amount, deductions_amount, advances_amount,
            net_amount, status, committed_at, finance_transaction_id
         )
         VALUES ($1, $2, 100, 0, 0, 100, $3, $4, $5)
         RETURNING id`,
        [
            month,
            staffId,
            fields.status || 'draft',
            fields.committedAt || null,
            fields.financeTransactionId || null
        ]
    );
    return Number(result.rows[0].id);
}

describe('historical attendance grace data-fix on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;
    let client;
    let dbUrl;
    let savedEnv;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        dbUrl = testDb.url.toString();
        pool = createPool(testDb);
        client = await pool.connect();
        savedEnv = {
            ATTENDANCE_AUDIT_DATABASE_URL: process.env.ATTENDANCE_AUDIT_DATABASE_URL,
            PRODUCTION_READONLY_DATABASE_URL: process.env.PRODUCTION_READONLY_DATABASE_URL,
            ATTENDANCE_DATA_FIX_DATABASE_URL: process.env.ATTENDANCE_DATA_FIX_DATABASE_URL
        };
        process.env.ATTENDANCE_AUDIT_DATABASE_URL = dbUrl;
        delete process.env.PRODUCTION_READONLY_DATABASE_URL;
        process.env.ATTENDANCE_DATA_FIX_DATABASE_URL = dbUrl;
    });

    after(async () => {
        for (const [key, value] of Object.entries(savedEnv || {})) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        client?.release();
        await pool?.end();
    });

    test('dry-run, apply and rollback change only approved grace facts', async () => {
        const fixtures = {
            late1: await createTimeRecord(client, { label: 'late1', date: '2026-07-01', status: 'late', lateMinutes: 1 }),
            late5Early: await createTimeRecord(client, { label: 'late5Early', date: '2026-07-02', status: 'late', lateMinutes: 5, earlyLeaveMinutes: 20 }),
            lateNull: await createTimeRecord(client, { label: 'lateNull', date: '2026-07-03', status: 'late', lateMinutes: null }),
            lateZero: await createTimeRecord(client, { label: 'lateZero', date: '2026-07-04', status: 'late', lateMinutes: 0 }),
            lateNegative: await createTimeRecord(client, { label: 'lateNegative', date: '2026-07-05', status: 'late', lateMinutes: -1 }),
            overtime1: await createTimeRecord(client, { label: 'overtime1', date: '2026-07-06', status: 'present', overtimeMinutes: 1 }),
            overtime15: await createTimeRecord(client, { label: 'overtime15', date: '2026-07-07', status: 'present', overtimeMinutes: 15 }),
            overtime16: await createTimeRecord(client, { label: 'overtime16', date: '2026-07-08', status: 'present', overtimeMinutes: 16 }),
            overlap: await createTimeRecord(client, { label: 'overlap', date: '2026-07-09', status: 'late', lateMinutes: 5, overtimeMinutes: 15 }),
            overtimeOnlyLate: await createTimeRecord(client, { label: 'overtimeOnlyLate', date: '2026-07-10', status: 'late', lateMinutes: 12, overtimeMinutes: 15 })
        };

        const scope = { from: '2026-07-01', to: '2026-07-10' };
        const dryRun = await runDryRun(scope);
        assert.equal(dryRun.report.mode, 'dry_run');
        assert.equal(dryRun.report.summary.totalRows, 6);
        assert.equal(dryRun.report.summary.byCategory['late-grace'], 3);
        assert.equal(dryRun.report.summary.byCategory['overtime-grace'], 4);
        assert.equal(dryRun.report.readOnlyAuditCounts['null-zero-negative-late'].totalRows, 3);
        assert.match(dryRun.report.approvalManifest.scriptSha256, /^[a-f0-9]{64}$/);
        assert.match(dryRun.report.approvalManifest.dbFingerprint, /^[a-f0-9]{64}$/);

        const beforeLate1 = await loadRecord(client, fixtures.late1.id);
        const applyReport = await runApply(scope, dryRun);
        assert.equal(applyReport.applied, true);
        assert.equal(applyReport.applyResult.updatedRows, 6);
        assert.equal(applyReport.applyResult.auditRows, 6);
        assert.equal(applyReport.applyResult.operationAuditRows, 1);
        assert.equal(applyReport.readBack.recordsVerified, 6);
        assert.ok(fs.existsSync(applyReport.backupFile));
        assert.equal(applyReport.backupArtifact.rowCounts.hr_time_records, 6);

        assert.deepEqual(
            await client.query(
                `SELECT COUNT(*)::int AS count
                   FROM hr_audit_log
                  WHERE action = 'attendance_historical_grace_data_fix'
                    AND details ? 'backup_file'`
            ).then(result => result.rows[0].count),
            0
        );

        assert.equal((await loadRecord(client, fixtures.late1.id)).late_minutes, 0);
        assert.equal((await loadRecord(client, fixtures.late1.id)).status, 'present');
        assert.equal((await loadRecord(client, fixtures.late5Early.id)).status, 'early_leave');
        assert.equal((await loadRecord(client, fixtures.late5Early.id)).early_leave_minutes, 20);
        assert.equal((await loadRecord(client, fixtures.lateNull.id)).late_minutes, null);
        assert.equal((await loadRecord(client, fixtures.lateZero.id)).late_minutes, 0);
        assert.equal((await loadRecord(client, fixtures.lateNegative.id)).late_minutes, -1);
        assert.equal((await loadRecord(client, fixtures.overtime1.id)).overtime_minutes, 0);
        assert.equal((await loadRecord(client, fixtures.overtime15.id)).overtime_minutes, 0);
        assert.equal((await loadRecord(client, fixtures.overtime16.id)).overtime_minutes, 16);
        assert.equal((await loadRecord(client, fixtures.overlap.id)).late_minutes, 0);
        assert.equal((await loadRecord(client, fixtures.overlap.id)).overtime_minutes, 0);
        assert.equal((await loadRecord(client, fixtures.overtimeOnlyLate.id)).late_minutes, 12);
        assert.equal((await loadRecord(client, fixtures.overtimeOnlyLate.id)).status, 'late');
        assert.equal((await loadRecord(client, fixtures.overtimeOnlyLate.id)).overtime_minutes, 0);
        assert.equal((await loadRecord(client, fixtures.late1.id)).total_worked_minutes, beforeLate1.total_worked_minutes);

        const recovery = await dataFix.recoverApplyOutcome(
            { connectionString: dbUrl, ssl: false },
            applyReport.approvalManifest.operationId,
            applyReport.planHash
        );
        assert.equal(recovery.state, 'committed');

        const rollbackDryOptions = rollback.parseArgs([
            '--backup-file', applyReport.backupFile,
            '--plan-hash', applyReport.planHash,
            '--executed-by', EXECUTED_BY,
            '--reason', 'isolated rollback dry-run'
        ]);
        const rollbackDry = await rollback.runRollback(rollbackDryOptions);
        assert.equal(rollbackDry.mode, 'dry_run');

        const rollbackApplyOptions = rollback.parseArgs([
            '--apply',
            '--backup-file', applyReport.backupFile,
            '--plan-hash', applyReport.planHash,
            '--executed-by', EXECUTED_BY,
            '--reason', 'isolated rollback apply',
            '--confirm', rollback.expectedRollbackConfirmation(applyReport.planHash)
        ]);
        const rollbackApply = await rollback.runRollback(rollbackApplyOptions);
        assert.equal(rollbackApply.applied, true);
        assert.equal((await loadRecord(client, fixtures.late1.id)).late_minutes, 1);
        assert.equal((await loadRecord(client, fixtures.overtime15.id)).overtime_minutes, 15);
        assert.equal(await countAudit(client, 'attendance_historical_grace_data_fix_rollback', applyReport.planHash), 6);

        await assert.rejects(
            () => rollback.runRollback(rollbackDryOptions),
            /Rollback drift detected/
        );
    });

    test('planHash drift, max-record guard and zero-candidate apply fail closed', async () => {
        const drift = await createTimeRecord(client, { label: 'drift', date: '2026-08-01', status: 'late', lateMinutes: 5 });
        const driftScope = { from: '2026-08-01' };
        const dryRun = await runDryRun(driftScope);
        await client.query('UPDATE hr_time_records SET late_minutes = 4 WHERE id = $1', [drift.id]);
        await assert.rejects(
            () => runApply(driftScope, dryRun),
            /--review-token does not match current dry-run planHash/
        );

        await createTimeRecord(client, { label: 'max1', date: '2026-08-02', status: 'late', lateMinutes: 5 });
        await createTimeRecord(client, { label: 'max2', date: '2026-08-02', status: 'late', lateMinutes: 4 });
        await assert.rejects(
            () => runDryRun({ from: '2026-08-02', maxRecords: 1 }),
            /exceeds --max-records 1/
        );

        const zeroDryRun = await runDryRun({ from: '2026-08-03' });
        assert.equal(zeroDryRun.report.summary.totalRows, 0);
        await assert.rejects(
            () => runApply({ from: '2026-08-03' }, zeroDryRun),
            /0 candidate records/
        );
    });

    test('backup, audit and read-back failures leave attendance rows unchanged', async () => {
        const backupFailure = await createTimeRecord(client, {
            label: 'backupFailure',
            date: '2026-08-04',
            status: 'late',
            lateMinutes: 5
        });
        const backupScope = { from: '2026-08-04' };
        const backupDryRun = await runDryRun(backupScope);
        const badBackupOptions = dataFix.parseArgs(buildDataFixArgs({
            ...backupScope,
            extra: [
                '--apply',
                '--backup-dir', path.join(ROOT, 'tmp-datafix-backups'),
                '--review-token', backupDryRun.report.planHash,
                '--confirm', dataFix.expectedApplyConfirmation(backupDryRun.options)
            ]
        }));
        await assert.rejects(
            () => dataFix.runDataFix(badBackupOptions),
            /outside the repository/
        );
        assert.equal((await loadRecord(client, backupFailure.id)).late_minutes, 5);

        const auditFailure = await createTimeRecord(client, {
            label: 'auditFailure',
            date: '2026-08-05',
            status: 'late',
            lateMinutes: 5
        });
        await client.query(`
            CREATE OR REPLACE FUNCTION fail_attendance_datafix_audit()
            RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.action = 'attendance_historical_grace_data_fix' THEN
                    RAISE EXCEPTION 'forced attendance data-fix audit failure';
                END IF;
                RETURN NEW;
            END;
            $fn$;
            CREATE TRIGGER fail_attendance_datafix_audit
            BEFORE INSERT ON hr_audit_log
            FOR EACH ROW EXECUTE FUNCTION fail_attendance_datafix_audit();
        `);
        try {
            const auditScope = { from: '2026-08-05' };
            const auditDryRun = await runDryRun(auditScope);
            await assert.rejects(
                () => runApply(auditScope, auditDryRun),
                /forced attendance data-fix audit failure/
            );
            assert.equal((await loadRecord(client, auditFailure.id)).late_minutes, 5);
        } finally {
            await client.query('DROP TRIGGER IF EXISTS fail_attendance_datafix_audit ON hr_audit_log');
            await client.query('DROP FUNCTION IF EXISTS fail_attendance_datafix_audit()');
        }

        const readBackFailure = await createTimeRecord(client, {
            label: 'readBackFailure',
            date: '2026-08-06',
            status: 'late',
            lateMinutes: 5,
            totalWorkedMinutes: 480
        });
        await client.query(`
            CREATE OR REPLACE FUNCTION mutate_attendance_datafix_immutable()
            RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.late_minutes IS DISTINCT FROM NEW.late_minutes THEN
                    NEW.total_worked_minutes := COALESCE(OLD.total_worked_minutes, 0) + 1;
                END IF;
                RETURN NEW;
            END;
            $fn$;
            CREATE TRIGGER mutate_attendance_datafix_immutable
            BEFORE UPDATE ON hr_time_records
            FOR EACH ROW EXECUTE FUNCTION mutate_attendance_datafix_immutable();
        `);
        try {
            const readBackScope = { from: '2026-08-06' };
            const readBackDryRun = await runDryRun(readBackScope);
            await assert.rejects(
                () => runApply(readBackScope, readBackDryRun),
                /Read-back failed/
            );
            const row = await loadRecord(client, readBackFailure.id);
            assert.equal(row.late_minutes, 5);
            assert.equal(row.total_worked_minutes, 480);
        } finally {
            await client.query('DROP TRIGGER IF EXISTS mutate_attendance_datafix_immutable ON hr_time_records');
            await client.query('DROP FUNCTION IF EXISTS mutate_attendance_datafix_immutable()');
        }
    });

    test('payroll gate blocks protected and open payroll overlap before apply', async () => {
        const scenarios = [
            {
                label: 'draft',
                date: '2026-09-01',
                setup: async fixture => createPayrollReport(client, fixture.staffId, '2026-09', { status: 'draft' })
            },
            {
                label: 'reviewed',
                date: '2026-10-01',
                setup: async fixture => createPayrollReport(client, fixture.staffId, '2026-10', { status: 'reviewed' })
            },
            {
                label: 'approved',
                date: '2026-11-01',
                setup: async fixture => createPayrollReport(client, fixture.staffId, '2026-11', { status: 'approved' })
            },
            {
                label: 'paid',
                date: '2026-12-01',
                setup: async fixture => createPayrollReport(client, fixture.staffId, '2026-12', { status: 'paid' })
            },
            {
                label: 'committed',
                date: '2027-01-01',
                setup: async fixture => createPayrollReport(client, fixture.staffId, '2027-01', { status: 'draft', committedAt: '2027-01-15T10:00:00Z' })
            },
            {
                label: 'finance-linked',
                date: '2027-02-01',
                setup: async fixture => {
                    const finance = await client.query(
                        `INSERT INTO finance_transactions (type, amount, description, date, payment_method, staff_id, created_by)
                         VALUES ('expense', 100, 'isolated salary transaction', '2027-02-15', 'salary', $1, 'isolated_test')
                         RETURNING id`,
                        [fixture.staffId]
                    );
                    await createPayrollReport(client, fixture.staffId, '2027-02', {
                        status: 'draft',
                        financeTransactionId: Number(finance.rows[0].id)
                    });
                }
            },
            {
                label: 'period-lock',
                date: '2027-03-01',
                setup: async () => client.query(
                    `INSERT INTO payroll_period_locks (period_month, is_locked, locked_at, locked_by)
                     VALUES ('2027-03', true, NOW(), 'isolated_test')`
                )
            },
            {
                label: 'payroll-entry',
                date: '2027-04-01',
                setup: async fixture => client.query(
                    `INSERT INTO payroll_entries (staff_id, period_month, line_type, label, amount, created_by)
                     VALUES ($1, '2027-04', 'base', 'isolated payroll entry', 100, 'isolated_test')`,
                    [fixture.staffId]
                )
            },
            {
                label: 'salary-adjustment',
                date: '2027-05-01',
                setup: async fixture => client.query(
                    `INSERT INTO salary_adjustments (staff_id, month, type, amount, reason, created_by)
                     VALUES ($1, '2027-05', 'bonus', 100, 'isolated salary adjustment', 'isolated_test')`,
                    [fixture.staffId]
                )
            }
        ];

        for (const scenario of scenarios) {
            const fixture = await createTimeRecord(client, {
                label: `payroll-${scenario.label}`,
                date: scenario.date,
                status: 'late',
                lateMinutes: 5
            });
            await scenario.setup(fixture);
            const scope = { from: scenario.date };
            const dryRun = await runDryRun(scope);
            await assert.rejects(
                () => runApply(scope, dryRun),
                /protected or open payroll impact/,
                scenario.label
            );
            assert.equal((await loadRecord(client, fixture.id)).late_minutes, 5, scenario.label);
        }
    });

    test('payroll state race after dry-run blocks apply', async () => {
        const fixture = await createTimeRecord(client, {
            label: 'payroll-race',
            date: '2027-06-01',
            status: 'late',
            lateMinutes: 5
        });
        const scope = { from: '2027-06-01' };
        const dryRun = await runDryRun(scope);
        await createPayrollReport(client, fixture.staffId, '2027-06', { status: 'draft' });
        await assert.rejects(
            () => runApply(scope, dryRun),
            /protected or open payroll impact/
        );
        assert.equal((await loadRecord(client, fixture.id)).late_minutes, 5);
    });

    test('rollback blocks wrong checksum, drift and repeated rollback', async () => {
        const fixture = await createTimeRecord(client, {
            label: 'rollback-drift',
            date: '2027-07-01',
            status: 'late',
            lateMinutes: 5,
            overtimeMinutes: 15
        });
        const scope = { from: '2027-07-01' };
        const dryRun = await runDryRun(scope);
        const applyReport = await runApply(scope, dryRun);
        const tamperedPath = path.join(backupDir(), 'tampered.json');
        const tampered = JSON.parse(fs.readFileSync(applyReport.backupFile, 'utf8'));
        tampered.payload.plannedChanges[0].before.late_minutes = 99;
        fs.writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
        await assert.throws(
            () => rollback.loadVerifiedBackup(rollback.parseArgs([
                '--backup-file', tamperedPath,
                '--plan-hash', applyReport.planHash,
                '--executed-by', EXECUTED_BY,
                '--reason', 'checksum test'
            ])),
            /checksum mismatch/
        );

        await client.query('UPDATE hr_time_records SET overtime_minutes = 16 WHERE id = $1', [fixture.id]);
        await assert.rejects(
            () => rollback.runRollback(rollback.parseArgs([
                '--backup-file', applyReport.backupFile,
                '--plan-hash', applyReport.planHash,
                '--executed-by', EXECUTED_BY,
                '--reason', 'drift test'
            ])),
            /Rollback drift detected/
        );
        await client.query('UPDATE hr_time_records SET overtime_minutes = 0 WHERE id = $1', [fixture.id]);

        const rollbackApply = await rollback.runRollback(rollback.parseArgs([
            '--apply',
            '--backup-file', applyReport.backupFile,
            '--plan-hash', applyReport.planHash,
            '--executed-by', EXECUTED_BY,
            '--reason', 'restore after drift test',
            '--confirm', rollback.expectedRollbackConfirmation(applyReport.planHash)
        ]));
        assert.equal(rollbackApply.applied, true);
        assert.equal((await loadRecord(client, fixture.id)).late_minutes, 5);
        assert.equal((await loadRecord(client, fixture.id)).overtime_minutes, 15);
        await assert.rejects(
            () => rollback.runRollback(rollback.parseArgs([
                '--backup-file', applyReport.backupFile,
                '--plan-hash', applyReport.planHash,
                '--executed-by', EXECUTED_BY,
                '--reason', 'repeated rollback test'
            ])),
            /Rollback drift detected/
        );
    });

    test('ambiguous commit recovery classifies missing operation as not committed', async () => {
        const result = await dataFix.recoverApplyOutcome(
            { connectionString: dbUrl, ssl: false },
            'attendance-grace-missing-operation',
            'c'.repeat(64)
        );
        assert.equal(result.state, 'rolled_back_or_not_committed');
    });
});
