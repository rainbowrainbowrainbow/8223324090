/**
 * End-to-end payroll coverage for simultaneous additional profession pay.
 *
 * This suite is excluded from the fast baseline. Run it only through:
 *   npm run test:integration:payroll-profiles:isolated
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { authRequest } = require('../helpers');

const enabled = process.env.RUN_PAYROLL_SIMULTANEOUS_ADDITIONAL_INTEGRATION === 'true';
const MONTH = '2099-07';
const WORK_DATE = '2099-07-22';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_PAYROLL_SIMULTANEOUS_ADDITIONAL_INTEGRATION=true');
    assert.equal(
        process.env.REQUIRE_ISOLATED_TEST_TARGET,
        'true',
        'simultaneous additional payroll integration requires the isolated local test runner'
    );
    assert.equal(
        process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,
        'true',
        'simultaneous additional payroll integration requires verified disposable database setup'
    );
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

function jsonValue(value) {
    if (!value) return {};
    return typeof value === 'string' ? JSON.parse(value) : value;
}

describe('simultaneous additional payroll on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;
    let staffId;
    let shiftId;
    let firstSegmentId;
    let secondSegmentId;
    let paidRoleId;
    let primaryProfessionKey;
    let additionalProfessionKey;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = createPool(testDb);
        const suffix = `${process.pid}_${Date.now()}`;
        primaryProfessionKey = `pay_pri_${suffix}`.slice(0, 30);
        additionalProfessionKey = `pay_add_${suffix}`.slice(0, 30);

        await pool.query(
            `INSERT INTO hr_professions (key, title, department)
             VALUES ($1, 'Payroll Primary QA', 'QA'),
                    ($2, 'Payroll Additional QA', 'QA')`,
            [primaryProfessionKey, additionalProfessionKey]
        );

        const staff = await pool.query(
            `INSERT INTO staff
                (name, department, position, role_type, hourly_rate, rate_unit, is_active, is_freelance)
             VALUES
                ($1, 'qa', 'Simultaneous payroll QA', $2, 100, 'hour', true, false)
             RETURNING id`,
            [`Payroll Simultaneous ${suffix}`, primaryProfessionKey]
        );
        staffId = Number(staff.rows[0].id);

        await pool.query(
            `INSERT INTO staff_role_assignments
                (staff_id, profession_key, is_primary, status, admission_status, internship_status, hourly_rate, created_by, updated_by)
             VALUES
                ($1, $2, true, 'active', 'approved', 'none', 100, 'integration_test', 'integration_test'),
                ($1, $3, false, 'active', 'approved', 'none', 200, 'integration_test', 'integration_test')`,
            [staffId, primaryProfessionKey, additionalProfessionKey]
        );
        await pool.query(
            `INSERT INTO staff_profession_rates (staff_id, profession_key, hourly_rate)
             VALUES ($1, $2, 100), ($1, $3, 200)`,
            [staffId, primaryProfessionKey, additionalProfessionKey]
        );

        const shift = await pool.query(
            `INSERT INTO hr_shifts
                (staff_id, shift_date, planned_start, planned_end, break_minutes, shift_type, profession_key, created_by)
             VALUES
                ($1, $2, '11:00', '20:00', 0, 'regular', $3, 'integration_test')
             RETURNING id`,
            [staffId, WORK_DATE, primaryProfessionKey]
        );
        shiftId = Number(shift.rows[0].id);

        const segments = await pool.query(
            `INSERT INTO hr_shift_segments
                (hr_shift_id, profession_key, planned_start, planned_end, break_minutes, sort_order, created_by, updated_by)
             VALUES
                ($1, $2, '11:00', '11:30', 0, 0, 'integration_test', 'integration_test'),
                ($1, $2, '11:30', '20:00', 0, 1, 'integration_test', 'integration_test')
             RETURNING id, sort_order`,
            [shiftId, primaryProfessionKey]
        );
        const segmentByOrder = new Map(segments.rows.map(row => [Number(row.sort_order), Number(row.id)]));
        firstSegmentId = segmentByOrder.get(0);
        secondSegmentId = segmentByOrder.get(1);

        const paidRole = await pool.query(
            `INSERT INTO hr_shift_segment_roles
                (segment_id, profession_key, compensation_mode, pay_multiplier, policy_version)
             VALUES
                ($1, $2, 'paid_hourly', 1.0, 'simultaneous-profession-pay-v1')
             RETURNING id`,
            [secondSegmentId, additionalProfessionKey]
        );
        paidRoleId = Number(paidRole.rows[0].id);

        const compensationSnapshot = {
            schemaVersion: 1,
            state: 'final',
            manualReview: false,
            planSource: 'hr_shift',
            plan: {
                shiftId,
                primaryProfessionKey,
                plannedStart: '11:00',
                plannedEnd: '20:00',
                segments: [
                    {
                        id: firstSegmentId,
                        professionKey: primaryProfessionKey,
                        shiftStart: '11:00',
                        shiftEnd: '11:30',
                        breakMinutes: 0
                    },
                    {
                        id: secondSegmentId,
                        professionKey: primaryProfessionKey,
                        shiftStart: '11:30',
                        shiftEnd: '20:00',
                        breakMinutes: 0
                    }
                ]
            },
            physicalAllocation: {
                segmentAllocations: [
                    {
                        segmentId: firstSegmentId,
                        professionKey: primaryProfessionKey,
                        plannedMinutes: 30,
                        actualMinutes: 30
                    },
                    {
                        segmentId: secondSegmentId,
                        professionKey: primaryProfessionKey,
                        plannedMinutes: 510,
                        actualMinutes: 510
                    }
                ],
                plannedMinutes: 540,
                actualMinutes: 540,
                allocatedMinutes: 540,
                overtimeMinutes: 0,
                allocationSource: 'clock_interval',
                allocationIssues: [],
                breakPolicy: 'segment_minutes_mvp'
            },
            compensationAllocations: [
                {
                    allocationType: 'base',
                    segmentId: firstSegmentId,
                    professionKey: primaryProfessionKey,
                    plannedMinutes: 30,
                    actualMinutes: 30
                },
                {
                    allocationType: 'base',
                    segmentId: secondSegmentId,
                    professionKey: primaryProfessionKey,
                    plannedMinutes: 510,
                    actualMinutes: 510
                },
                {
                    allocationType: 'simultaneous_additional',
                    segmentId: secondSegmentId,
                    segmentIndex: 1,
                    roleId: paidRoleId,
                    professionKey: additionalProfessionKey,
                    plannedMinutes: 510,
                    actualMinutes: 510,
                    compensationMode: 'paid_hourly',
                    payMultiplier: 1,
                    rate: 200,
                    rateUnit: 'hour',
                    rateSource: 'staff_profession_rates.hourly_rate',
                    policyVersion: 'simultaneous-profession-pay-v1'
                }
            ],
            totals: {
                physicalMinutes: 540,
                baseMinutes: 540,
                simultaneousAdditionalMinutes: 510,
                compensationMinutes: 1050
            },
            issues: []
        };

        await pool.query(
            `INSERT INTO hr_time_records
                (staff_id, record_date, clock_in, clock_out, planned_start, planned_end,
                 late_minutes, early_leave_minutes, overtime_minutes, total_worked_minutes,
                 status, compensation_snapshot)
             VALUES
                ($1, $2, '2099-07-22T08:00:00.000Z', '2099-07-22T17:00:00.000Z',
                 '11:00', '20:00', 0, 0, 0, 540, 'present', $3::jsonb)`,
            [staffId, WORK_DATE, JSON.stringify(compensationSnapshot)]
        );
    });

    after(async () => {
        if (pool) await pool.end();
    });

    test('draft, approval, finance commit, reversal, and fail-closed review preserve payroll truth', async () => {
        const firstGeneration = await authRequest('POST', `/api/payroll/generate?month=${MONTH}`, { month: MONTH });
        assert.equal(firstGeneration.status, 200, JSON.stringify(firstGeneration.data));
        const firstReport = firstGeneration.data.reports.find(row => Number(row.staff_id) === staffId);
        assert.ok(firstReport, 'fixture payroll report was generated');

        const firstBreakdown = jsonValue(firstReport.breakdown_json);
        const firstAdditionalLine = firstBreakdown.lines.find(line => line.lineType === 'simultaneous_additional');
        assert.equal(firstBreakdown.metrics.physicalMinutes, 540);
        assert.equal(firstBreakdown.metrics.compensationMinutes, 1050);
        assert.equal(firstBreakdown.metrics.additionalProfessionAllocations[0].minutes, 510);
        assert.equal(firstBreakdown.transparency.physicalHours, 9);
        assert.equal(firstBreakdown.transparency.baseRoleHours, 9);
        assert.equal(firstBreakdown.transparency.additionalRoleHours, 8.5);
        assert.equal(firstBreakdown.transparency.additionalProfession, additionalProfessionKey);
        assert.equal(firstBreakdown.transparency.additionalAmount, 1700);
        assert.equal(firstBreakdown.summary.base, 900);
        assert.equal(firstBreakdown.summary.additional, 1700);
        assert.equal(firstBreakdown.summary.gross, 2600);
        assert.equal(Number(firstReport.net_amount), 2600);
        const generatedAudit = await pool.query(
            `SELECT details
             FROM hr_audit_log
             WHERE staff_id = $1
               AND action = 'payroll_additional_line_generated'
             ORDER BY created_at DESC
             LIMIT 1`,
            [staffId]
        );
        assert.equal(generatedAudit.rowCount, 1);
        assert.equal(jsonValue(generatedAudit.rows[0].details).additionalRoleMinutes, 510);
        assert.equal(jsonValue(generatedAudit.rows[0].details).additionalAmount, 1700);
        assert.deepEqual(
            {
                professionKey: firstAdditionalLine.professionKey,
                minutes: firstAdditionalLine.minutes,
                rate: firstAdditionalLine.rate,
                rateSource: firstAdditionalLine.rateSource,
                multiplier: firstAdditionalLine.multiplier,
                attendanceRef: firstAdditionalLine.attendanceRef,
                segmentRef: firstAdditionalLine.segmentRef,
                roleRef: firstAdditionalLine.roleRef,
                policyVersion: firstAdditionalLine.policyVersion,
                amount: firstAdditionalLine.amount
            },
            {
                professionKey: additionalProfessionKey,
                minutes: 510,
                rate: 200,
                rateSource: 'staff_profession_rates.hourly_rate',
                multiplier: 1,
                attendanceRef: firstBreakdown.metrics.additionalProfessionAllocations[0].attendanceRef,
                segmentRef: secondSegmentId,
                roleRef: paidRoleId,
                policyVersion: 'simultaneous-profession-pay-v1',
                amount: 1700
            }
        );

        await pool.query(
            `UPDATE staff_profession_rates
             SET hourly_rate = 999, updated_at = NOW()
             WHERE staff_id = $1 AND profession_key = $2`,
            [staffId, additionalProfessionKey]
        );

        const regeneration = await authRequest('POST', `/api/payroll/generate?month=${MONTH}`, { month: MONTH });
        assert.equal(regeneration.status, 200, JSON.stringify(regeneration.data));
        const regeneratedReport = regeneration.data.reports.find(row => Number(row.staff_id) === staffId);
        assert.equal(Number(regeneratedReport.id), Number(firstReport.id));
        assert.equal(Number(regeneratedReport.net_amount), 2600);
        assert.equal(
            jsonValue(regeneratedReport.breakdown_json).lines
                .find(line => line.lineType === 'simultaneous_additional').rate,
            200,
            'draft regeneration must use the immutable attendance rate snapshot'
        );
        const reportCount = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_reports
             WHERE period_month = $1 AND staff_id = $2`,
            [MONTH, staffId]
        );
        assert.equal(reportCount.rows[0].count, 1);

        const approval = await authRequest(
            'PATCH',
            `/api/payroll/report/${regeneratedReport.id}`,
            { status: 'approved' }
        );
        assert.equal(approval.status, 200, JSON.stringify(approval.data));
        assert.equal(approval.data.report.status, 'approved');

        const commit = await authRequest('POST', '/api/hr/salary/commit', { month: MONTH });
        assert.equal(commit.status, 200, JSON.stringify(commit.data));
        const committedFixture = commit.data.transactions.find(row => Number(row.staffId) === staffId);
        assert.equal(Number(committedFixture.amount), 2600);

        const paidReportResult = await pool.query(
            `SELECT status, gross_amount, net_amount, breakdown_json, finance_transaction_id
             FROM payroll_reports
             WHERE period_month = $1 AND staff_id = $2`,
            [MONTH, staffId]
        );
        const paidReport = paidReportResult.rows[0];
        const paidBreakdown = jsonValue(paidReport.breakdown_json);
        assert.equal(paidReport.status, 'paid');
        assert.equal(Number(paidReport.gross_amount), 2600);
        assert.equal(Number(paidReport.net_amount), 2600);
        assert.equal(paidBreakdown.metrics.physicalMinutes, 540);
        assert.equal(paidBreakdown.additional_pay, 1700);
        assert.equal(paidBreakdown.transparency.physicalHours, 9);
        assert.equal(paidBreakdown.transparency.baseRoleHours, 9);
        assert.equal(paidBreakdown.transparency.additionalRoleHours, 8.5);
        assert.equal(
            paidBreakdown.lines.find(line => line.lineType === 'simultaneous_additional').amount,
            1700
        );

        const financeExpense = await pool.query(
            `SELECT type, amount, payment_method
             FROM finance_transactions
             WHERE id = $1`,
            [paidReport.finance_transaction_id]
        );
        assert.deepEqual(
            {
                type: financeExpense.rows[0].type,
                amount: Number(financeExpense.rows[0].amount),
                paymentMethod: financeExpense.rows[0].payment_method
            },
            { type: 'expense', amount: 2600, paymentMethod: 'salary' }
        );

        const additionalEntry = await pool.query(
            `SELECT line_type, amount, meta_json
             FROM payroll_entries
             WHERE staff_id = $1
               AND period_month = $2
               AND meta_json->>'payrollLineType' = 'simultaneous_additional'`,
            [staffId, MONTH]
        );
        assert.equal(additionalEntry.rowCount, 1);
        assert.equal(additionalEntry.rows[0].line_type, 'adjustment');
        assert.equal(Number(additionalEntry.rows[0].amount), 1700);

        const reversal = await authRequest('POST', '/api/hr/salary/reverse', {
            month: MONTH,
            reason: 'isolated integration verification'
        });
        assert.equal(reversal.status, 200, JSON.stringify(reversal.data));
        const reversedFixture = reversal.data.reversed.find(row => Number(row.staffId) === staffId);
        assert.equal(Number(reversedFixture.amount), 2600);

        const reversalTransaction = await pool.query(
            `SELECT type, amount, payment_method
             FROM finance_transactions
             WHERE id = $1`,
            [reversedFixture.reversalTransactionId]
        );
        assert.deepEqual(
            {
                type: reversalTransaction.rows[0].type,
                amount: Number(reversalTransaction.rows[0].amount),
                paymentMethod: reversalTransaction.rows[0].payment_method
            },
            { type: 'income', amount: 2600, paymentMethod: 'salary_reversal' }
        );
        assert.ok(Number(reversal.data.removedPayrollEntries) > 0);

        const entriesAfterReverse = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_entries
             WHERE staff_id = $1 AND period_month = $2`,
            [staffId, MONTH]
        );
        assert.equal(entriesAfterReverse.rows[0].count, 0);

        const previewAfterReverse = await authRequest(
            'GET',
            `/api/payroll/preview?staffId=${staffId}&month=${MONTH}`
        );
        assert.equal(previewAfterReverse.status, 200, JSON.stringify(previewAfterReverse.data));
        assert.equal(Number(previewAfterReverse.data.preview.netAmount), 2600);
        assert.equal(Number(previewAfterReverse.data.preview.baseAmount), 900);
        assert.equal(Number(previewAfterReverse.data.preview.additionalAmount), 1700);
        assert.equal(
            previewAfterReverse.data.preview.lines.filter(line => line.source === 'payroll_entries').length,
            0
        );

        const generationAfterReverse = await authRequest(
            'POST',
            `/api/payroll/generate?month=${MONTH}`,
            { month: MONTH }
        );
        assert.equal(generationAfterReverse.status, 200, JSON.stringify(generationAfterReverse.data));
        const regeneratedAfterReverse = generationAfterReverse.data.reports
            .find(row => Number(row.staff_id) === staffId);
        assert.equal(Number(regeneratedAfterReverse.net_amount), 2600);
        assert.equal(
            jsonValue(regeneratedAfterReverse.breakdown_json).lines
                .filter(line => line.source === 'payroll_entries').length,
            0
        );
        const entriesAfterRegeneration = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_entries
             WHERE staff_id = $1 AND period_month = $2`,
            [staffId, MONTH]
        );
        assert.equal(entriesAfterRegeneration.rows[0].count, 0);

        const secondReversal = await authRequest('POST', '/api/hr/salary/reverse', {
            month: MONTH,
            reason: 'must not reverse twice'
        });
        assert.equal(secondReversal.status, 404);
        const reversalCount = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM finance_transactions
             WHERE staff_id = $1 AND payment_method = 'salary_reversal'`,
            [staffId]
        );
        assert.equal(reversalCount.rows[0].count, 1);

        await pool.query(
            `UPDATE hr_time_records
             SET compensation_snapshot = jsonb_set(compensation_snapshot, '{manualReview}', 'true'::jsonb, false)
             WHERE staff_id = $1 AND record_date = $2`,
            [staffId, WORK_DATE]
        );
        const blockedCommit = await authRequest('POST', '/api/hr/salary/commit', { month: MONTH });
        assert.equal(blockedCommit.status, 409, JSON.stringify(blockedCommit.data));
        assert.equal(blockedCommit.data.code, 'PAYROLL_COMPENSATION_SNAPSHOT_BLOCKED');
        assert.equal(
            blockedCommit.data.details.blockingIssues[0].code,
            'PAYROLL_COMPENSATION_SNAPSHOT_MANUAL_REVIEW'
        );
        const activePaidReports = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_reports
             WHERE period_month = $1
               AND staff_id = $2
               AND status = 'paid'
               AND voided_at IS NULL`,
            [MONTH, staffId]
        );
        assert.equal(activePaidReports.rows[0].count, 0);
    });

    test('hourly stays payable while per-shift, monthly-fixed, and hybrid fail closed across previews and generation', async () => {
        await pool.query(
            `UPDATE hr_time_records
             SET compensation_snapshot = jsonb_set(compensation_snapshot, '{manualReview}', 'false'::jsonb, false)
             WHERE staff_id = $1 AND record_date = $2`,
            [staffId, WORK_DATE]
        );
        await pool.query(
            'DELETE FROM payroll_reports WHERE period_month = $1 AND staff_id = $2',
            [MONTH, staffId]
        );
        await pool.query(
            `DELETE FROM finance_transactions
             WHERE staff_id = $1
               AND payment_method IN ('salary', 'salary_reversal')
               AND date::date >= $2::date
               AND date::date < ($2::date + INTERVAL '1 month')`,
            [staffId, `${MONTH}-01`]
        );

        const activateScheme = async (schemeType, config) => {
            await pool.query('DELETE FROM payroll_schemes WHERE staff_id = $1', [staffId]);
            await pool.query(
                `INSERT INTO payroll_schemes
                    (staff_id, scheme_type, title, is_active, config_json, effective_from, created_by, updated_by)
                 VALUES ($1, $2, $3, true, $4::jsonb, '2099-07-01', 'integration_test', 'integration_test')`,
                [staffId, schemeType, `${schemeType} integration`, JSON.stringify(config)]
            );
        };

        for (const scenario of [
            { schemeType: 'per_shift', config: { perShiftRate: 900 } },
            { schemeType: 'monthly_fixed', config: { monthlyAmount: 30000 } },
            { schemeType: 'hybrid', config: { hourlyRate: 100, perShiftRate: 900 } }
        ]) {
            await activateScheme(scenario.schemeType, scenario.config);

            const preview = await authRequest(
                'GET',
                `/api/payroll/preview?staffId=${staffId}&month=${MONTH}`
            );
            assert.equal(preview.status, 200, JSON.stringify(preview.data));
            assert.equal(preview.data.preview.additionalAmount, 0);
            assert.equal(preview.data.preview.additionalRoleHours, 8.5);
            const previewIssue = preview.data.preview.payrollBlockingIssues.find(
                issue => issue.code === 'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED'
            );
            assert.ok(previewIssue, JSON.stringify(preview.data.preview.payrollBlockingIssues));
            assert.equal(previewIssue.schemeType, scenario.schemeType);
            assert.equal(previewIssue.professionKey, additionalProfessionKey);
            assert.equal(previewIssue.paidRoleMinutes, 510);
            assert.equal(
                previewIssue.message,
                'Формула подвійної оплати для цієї схеми не налаштована'
            );

            const hrSalary = await authRequest('GET', `/api/hr/salary?month=${MONTH}`);
            assert.equal(hrSalary.status, 200, JSON.stringify(hrSalary.data));
            const salaryRow = hrSalary.data.data.find(row => Number(row.staff_id) === staffId);
            assert.ok(salaryRow, 'fixture HR salary row is present');
            assert.equal(salaryRow.additional_pay, 0);
            assert.equal(salaryRow.additional_role_hours, 8.5);
            assert.equal(
                salaryRow.payroll_blocking_issues[0].code,
                'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED'
            );

            const generation = await authRequest(
                'POST',
                `/api/payroll/generate?month=${MONTH}`,
                { month: MONTH }
            );
            assert.equal(generation.status, 409, JSON.stringify(generation.data));
            assert.equal(
                generation.data.code,
                'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED'
            );
            assert.equal(
                generation.data.details.blockingIssues[0].schemeType,
                scenario.schemeType
            );

            const financeCommit = await authRequest('POST', '/api/hr/salary/commit', { month: MONTH });
            assert.equal(financeCommit.status, 409, JSON.stringify(financeCommit.data));
            assert.equal(financeCommit.data.code, 'PAYROLL_COMPENSATION_SNAPSHOT_BLOCKED');
            assert.equal(
                financeCommit.data.details.blockingIssues[0].code,
                'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED'
            );

            const reports = await pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM payroll_reports
                 WHERE period_month = $1 AND staff_id = $2`,
                [MONTH, staffId]
            );
            assert.equal(reports.rows[0].count, 0);
        }

        await activateScheme('hourly', { hourlyRate: 100 });
        const hourlyPreview = await authRequest(
            'GET',
            `/api/payroll/preview?staffId=${staffId}&month=${MONTH}`
        );
        assert.equal(hourlyPreview.status, 200, JSON.stringify(hourlyPreview.data));
        assert.equal(hourlyPreview.data.preview.additionalAmount, 1700);
        assert.equal(hourlyPreview.data.preview.additionalRoleHours, 8.5);
        assert.equal(
            hourlyPreview.data.preview.payrollBlockingIssues.some(
                issue => issue.code === 'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED'
            ),
            false
        );
    });
});
