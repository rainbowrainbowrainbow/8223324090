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
const MONTH = '2026-03';
const WORK_DATE = '2026-03-12';

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

async function deleteDraftPayrollArtifacts(db, month, staffId) {
    const reports = await db.query(
        `SELECT id
         FROM payroll_reports
         WHERE period_month = $1 AND staff_id = $2`,
        [month, staffId]
    );
    const reportIds = reports.rows.map(row => Number(row.id));
    if (!reportIds.length) return;
    await db.query(
        `DELETE FROM payroll_installments
         WHERE payroll_report_id = ANY($1::bigint[])
           AND workflow_status = 'draft'`,
        [reportIds]
    );
    await db.query(
        'DELETE FROM payroll_reports WHERE period_month = $1 AND staff_id = $2',
        [month, staffId]
    );
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
                ($1, $2, '2026-03-12T08:00:00.000Z', '2026-03-12T17:00:00.000Z',
                 '11:00', '20:00', 0, 0, 0, 540, 'present', $3::jsonb)`,
            [staffId, WORK_DATE, JSON.stringify(compensationSnapshot)]
        );
    });

    after(async () => {
        if (pool) await pool.end();
    });

    test('draft calculation, immutable installment ownership, and legacy write guards preserve payroll truth', async () => {
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
        const generatedInstallments = await pool.query(
            `SELECT kind, calculated_amount, workflow_status
             FROM payroll_installments
             WHERE payroll_report_id = $1
             ORDER BY kind`,
            [Number(regeneratedReport.id)]
        );
        assert.deepEqual(generatedInstallments.rows.map(row => row.kind).sort(), ['advance', 'final']);
        assert.equal(generatedInstallments.rows.every(row => row.workflow_status === 'draft'), true);

        const manualReportApproval = await authRequest(
            'PATCH',
            `/api/payroll/report/${regeneratedReport.id}`,
            { status: 'approved' }
        );
        assert.equal(manualReportApproval.status, 409, JSON.stringify(manualReportApproval.data));
        assert.equal(manualReportApproval.data.code, 'PAYROLL_REPORT_INSTALLMENT_STATUS_MANUAL_BLOCKED');
        const manualPaidStatus = await authRequest(
            'PATCH',
            `/api/payroll/report/${regeneratedReport.id}`,
            { status: 'paid' }
        );
        assert.equal(manualPaidStatus.status, 409, JSON.stringify(manualPaidStatus.data));
        assert.equal(manualPaidStatus.data.code, 'PAYROLL_REPORT_PAID_STATUS_MANUAL_BLOCKED');

        const commitAdapter = await authRequest('POST', '/api/hr/salary/commit', { month: MONTH });
        assert.equal(commitAdapter.status, 409, JSON.stringify(commitAdapter.data));
        assert.equal(commitAdapter.data.code, 'PAYROLL_LEGACY_COMMIT_DISABLED');
        assert.equal(commitAdapter.data.financeChanged, false);

        const storedDraftReport = await pool.query(
            `SELECT status, settlement_model, gross_amount, net_amount, breakdown_json,
                    finance_transaction_id
             FROM payroll_reports
             WHERE period_month = $1 AND staff_id = $2`,
            [MONTH, staffId]
        );
        assert.equal(storedDraftReport.rows[0].status, 'draft');
        assert.equal(storedDraftReport.rows[0].settlement_model, 'installments_v1');
        assert.equal(storedDraftReport.rows[0].finance_transaction_id, null);
        assert.equal(Number(storedDraftReport.rows[0].gross_amount), 2600);
        assert.equal(Number(storedDraftReport.rows[0].net_amount), 2600);
        assert.equal(
            jsonValue(storedDraftReport.rows[0].breakdown_json).transparency.additionalAmount,
            1700
        );

        const draftRegeneration = await authRequest(
            'POST',
            `/api/payroll/generate?month=${MONTH}`,
            { month: MONTH }
        );
        assert.equal(draftRegeneration.status, 200, JSON.stringify(draftRegeneration.data));
        const regeneratedDraft = draftRegeneration.data.reports.find(row => Number(row.staff_id) === staffId);
        assert.equal(Number(regeneratedDraft.id), Number(regeneratedReport.id));
        assert.equal(Number(regeneratedDraft.net_amount), 2600);
        assert.equal(
            jsonValue(regeneratedDraft.breakdown_json).transparency.additionalAmount,
            1700
        );

        const financeExpense = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM finance_transactions
             WHERE staff_id = $1 AND source = 'payroll'`,
            [staffId]
        );
        assert.equal(financeExpense.rows[0].count, 0);

        const additionalEntry = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_entries
             WHERE staff_id = $1
               AND period_month = $2
               AND meta_json->>'payrollLineType' = 'simultaneous_additional'`,
            [staffId, MONTH]
        );
        assert.equal(additionalEntry.rows[0].count, 0);

        const reversal = await authRequest('POST', '/api/hr/salary/reverse', {
            month: MONTH,
            reason: 'must not reverse an unpaid installment draft'
        });
        assert.equal(reversal.status, 409, JSON.stringify(reversal.data));
        assert.equal(reversal.data.code, 'PAYROLL_LEGACY_REVERSE_DISABLED');

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

        const reversalCount = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_payment_movements
             WHERE installment_id IN (
                SELECT pi.id
                FROM payroll_installments pi
                JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
                WHERE pr.staff_id = $1 AND pr.period_month = $2
             ) AND movement_type = 'reversal'`,
            [staffId, MONTH]
        );
        assert.equal(reversalCount.rows[0].count, 0);

        await pool.query(
            `UPDATE hr_time_records
             SET compensation_snapshot = jsonb_set(compensation_snapshot, '{manualReview}', 'true'::jsonb, false)
             WHERE staff_id = $1 AND record_date = $2`,
            [staffId, WORK_DATE]
        );
        const blockedGeneration = await authRequest('POST', `/api/payroll/generate?month=${MONTH}`, { month: MONTH });
        assert.equal(blockedGeneration.status, 200, JSON.stringify(blockedGeneration.data));
        const blockedAdvance = await pool.query(
            `SELECT pi.id
             FROM payroll_installments pi
             JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
             WHERE pr.period_month = $1 AND pr.staff_id = $2 AND pi.kind = 'advance'`,
            [MONTH, staffId]
        );
        const blockedApproval = await authRequest(
            'POST',
            `/api/payroll/installments/${blockedAdvance.rows[0].id}/approve?businessContext=event_genix`,
            {}
        );
        assert.equal(blockedApproval.status, 409, JSON.stringify(blockedApproval.data));
        assert.equal(blockedApproval.data.code, 'PAYROLL_INSTALLMENT_APPROVAL_BLOCKED');
        assert.equal(
            blockedApproval.data.details.blockers[0].code,
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

    test('supported and unsupported schemes create reviewable drafts while approval fails closed on blockers', async () => {
        await pool.query(
            `UPDATE hr_time_records
             SET compensation_snapshot = jsonb_set(compensation_snapshot, '{manualReview}', 'false'::jsonb, false)
             WHERE staff_id = $1 AND record_date = $2`,
            [staffId, WORK_DATE]
        );
        await deleteDraftPayrollArtifacts(pool, MONTH, staffId);

        const activateScheme = async (schemeType, config) => {
            await pool.query('DELETE FROM payroll_schemes WHERE staff_id = $1', [staffId]);
            await pool.query(
                `INSERT INTO payroll_schemes
                    (staff_id, scheme_type, title, is_active, config_json, effective_from, created_by, updated_by)
                 VALUES ($1, $2, $3, true, $4::jsonb, '2026-03-01', 'integration_test', 'integration_test')`,
                [staffId, schemeType, `${schemeType} integration`, JSON.stringify(config)]
            );
        };

        for (const scenario of [
            { schemeType: 'per_shift', config: { perShiftRate: 900 }, baseAmount: 900, totalAmount: 2600 },
            {
                schemeType: 'monthly_fixed',
                config: {
                    monthlyAmount: 30000,
                    monthlyNormMinutes: 540,
                    monthlyNormMonth: MONTH,
                    monthlyNormSource: 'integration_full_month_schedule',
                    monthlyNormConfirmed: true
                },
                baseAmount: 30000,
                totalAmount: 31700
            }
        ]) {
            await deleteDraftPayrollArtifacts(pool, MONTH, staffId);
            await activateScheme(scenario.schemeType, scenario.config);

            const preview = await authRequest(
                'GET',
                `/api/payroll/preview?staffId=${staffId}&month=${MONTH}`
            );
            assert.equal(preview.status, 200, JSON.stringify(preview.data));
            assert.equal(preview.data.preview.physicalHours, 9);
            assert.equal(preview.data.preview.baseAmount, scenario.baseAmount);
            assert.equal(preview.data.preview.additionalAmount, 1700);
            assert.equal(preview.data.preview.netAmount, scenario.totalAmount);
            assert.equal(preview.data.preview.additionalRoleHours, 8.5);
            assert.equal(
                preview.data.preview.payrollBlockingIssues.some(
                    issue => issue.code === 'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED'
                ),
                false
            );
            const previewLine = preview.data.preview.lines.find(
                line => line.lineType === 'simultaneous_additional'
            );
            assert.ok(previewLine);
            assert.equal(previewLine.rate, 200);
            assert.equal(previewLine.rateSource, 'staff_profession_rates.hourly_rate');
            assert.equal(previewLine.amount, 1700);
            assert.equal(previewLine.formula, '510 / 60 * 200 * 1');

            const hrSalary = await authRequest('GET', `/api/hr/salary?month=${MONTH}`);
            assert.equal(hrSalary.status, 200, JSON.stringify(hrSalary.data));
            const salaryRow = hrSalary.data.data.find(row => Number(row.staff_id) === staffId);
            assert.ok(salaryRow, 'fixture HR salary row is present');
            assert.equal(salaryRow.additional_pay, 1700);
            assert.equal(salaryRow.additional_role_hours, 8.5);
            assert.equal(salaryRow.physical_hours, 9);
            assert.deepEqual(salaryRow.payroll_blocking_issues, []);

            const firstGeneration = await authRequest(
                'POST',
                `/api/payroll/generate?month=${MONTH}`,
                { month: MONTH }
            );
            assert.equal(firstGeneration.status, 200, JSON.stringify(firstGeneration.data));
            const firstReport = firstGeneration.data.reports.find(row => Number(row.staff_id) === staffId);
            assert.ok(firstReport);
            assert.equal(Number(firstReport.net_amount), scenario.totalAmount);
            const breakdown = jsonValue(firstReport.breakdown_json);
            assert.equal(breakdown.metrics.physicalMinutes, 540);
            assert.equal(breakdown.summary.base, scenario.baseAmount);
            assert.equal(breakdown.summary.additional, 1700);
            assert.equal(breakdown.summary.gross, scenario.totalAmount);
            assert.equal(
                breakdown.lines.find(line => line.lineType === 'simultaneous_additional').rateSource,
                'staff_profession_rates.hourly_rate'
            );

            const regeneration = await authRequest(
                'POST',
                `/api/payroll/generate?month=${MONTH}`,
                { month: MONTH }
            );
            assert.equal(regeneration.status, 200, JSON.stringify(regeneration.data));
            const regeneratedReport = regeneration.data.reports.find(row => Number(row.staff_id) === staffId);
            assert.equal(Number(regeneratedReport.id), Number(firstReport.id));
            assert.equal(Number(regeneratedReport.net_amount), scenario.totalAmount);

            const manualReportApproval = await authRequest(
                'PATCH',
                `/api/payroll/report/${regeneratedReport.id}`,
                { status: 'approved' }
            );
            assert.equal(manualReportApproval.status, 409, JSON.stringify(manualReportApproval.data));
            assert.equal(manualReportApproval.data.code, 'PAYROLL_REPORT_INSTALLMENT_STATUS_MANUAL_BLOCKED');

            const calculateAdapter = await authRequest('POST', '/api/hr/salary/commit', { month: MONTH });
            assert.equal(calculateAdapter.status, 409, JSON.stringify(calculateAdapter.data));
            assert.equal(calculateAdapter.data.code, 'PAYROLL_LEGACY_COMMIT_DISABLED');
            assert.equal(calculateAdapter.data.financeChanged, false);
            const stored = await pool.query(
                `SELECT status, settlement_model, net_amount, finance_transaction_id
                 FROM payroll_reports
                 WHERE period_month = $1 AND staff_id = $2`,
                [MONTH, staffId]
            );
            assert.equal(stored.rows[0].status, 'draft');
            assert.equal(stored.rows[0].settlement_model, 'installments_v1');
            assert.equal(Number(stored.rows[0].net_amount), scenario.totalAmount);
            assert.equal(stored.rows[0].finance_transaction_id, null);
        }

        for (const scenario of [
            { schemeType: 'hybrid', config: { hourlyRate: 100, perShiftRate: 900 } },
            { schemeType: 'percent', config: { percentRate: 10 } },
            { schemeType: 'manual', config: {} }
        ]) {
            await deleteDraftPayrollArtifacts(pool, MONTH, staffId);
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

            const generation = await authRequest(
                'POST',
                `/api/payroll/generate?month=${MONTH}`,
                { month: MONTH }
            );
            assert.equal(generation.status, 200, JSON.stringify(generation.data));
            const generatedReport = generation.data.reports.find(row => Number(row.staff_id) === staffId);
            assert.ok(generatedReport);
            const advanceInstallment = await pool.query(
                `SELECT pi.id, pi.calculation_snapshot
                 FROM payroll_installments pi
                 WHERE pi.payroll_report_id = $1 AND pi.kind = 'advance'`,
                [generatedReport.id]
            );
            const advanceSnapshot = jsonValue(advanceInstallment.rows[0].calculation_snapshot);
            assert.equal(
                advanceSnapshot.blockers[0].code,
                'PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED'
            );
            const blockedApproval = await authRequest(
                'POST',
                `/api/payroll/installments/${advanceInstallment.rows[0].id}/approve?businessContext=event_genix`,
                {}
            );
            assert.equal(blockedApproval.status, 409, JSON.stringify(blockedApproval.data));
            assert.equal(blockedApproval.data.code, 'PAYROLL_INSTALLMENT_APPROVAL_BLOCKED');

            const financeCommit = await authRequest('POST', '/api/hr/salary/commit', { month: MONTH });
            assert.equal(financeCommit.status, 409, JSON.stringify(financeCommit.data));
            assert.equal(financeCommit.data.code, 'PAYROLL_LEGACY_COMMIT_DISABLED');

            const reports = await pool.query(
                `SELECT COUNT(*)::int AS count
                 FROM payroll_reports
                 WHERE period_month = $1 AND staff_id = $2`,
                [MONTH, staffId]
            );
            assert.equal(reports.rows[0].count, 1);
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
        const hourlyGeneration = await authRequest(
            'POST',
            `/api/payroll/generate?month=${MONTH}`,
            { month: MONTH }
        );
        assert.equal(hourlyGeneration.status, 200, JSON.stringify(hourlyGeneration.data));
    });

    test('calculation with real attendance in two business contexts fails closed at approval', async () => {
        await deleteDraftPayrollArtifacts(pool, MONTH, staffId);
        const extraDate = '2026-03-13';
        let extraTimeRecordId = null;
        try {
            const extraRecord = await pool.query(
                `INSERT INTO hr_time_records
                    (staff_id, record_date, clock_in, clock_out, planned_start, planned_end,
                     late_minutes, early_leave_minutes, overtime_minutes, total_worked_minutes,
                     status, compensation_snapshot, business_context)
                 SELECT staff_id, $2::date,
                        '2026-03-13T08:00:00.000Z'::timestamptz,
                        '2026-03-13T17:00:00.000Z'::timestamptz,
                        planned_start, planned_end, late_minutes, early_leave_minutes,
                        overtime_minutes, total_worked_minutes, status, compensation_snapshot, 'dar'
                 FROM hr_time_records
                 WHERE staff_id = $1 AND record_date = $3::date
                 RETURNING id`,
                [staffId, extraDate, WORK_DATE]
            );
            extraTimeRecordId = Number(extraRecord.rows[0].id);

            const calculation = await authRequest(
                'POST',
                `/api/payroll/installments/calculate?month=${MONTH}`,
                { month: MONTH }
            );
            assert.equal(calculation.status, 200, JSON.stringify(calculation.data));
            const stored = await pool.query(
                `SELECT pi.id, pi.workflow_status, pi.allocation_status, pi.business_context,
                        pi.calculation_snapshot
                 FROM payroll_installments pi
                 JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
                 WHERE pr.period_month = $1 AND pr.staff_id = $2 AND pi.kind = 'advance'`,
                [MONTH, staffId]
            );
            assert.equal(stored.rowCount, 1);
            const snapshot = jsonValue(stored.rows[0].calculation_snapshot);
            assert.deepEqual([...snapshot.businessContexts].sort(), ['dar', 'event_genix']);
            assert.equal(stored.rows[0].workflow_status, 'draft');
            assert.equal(stored.rows[0].allocation_status, 'unresolved');
            assert.equal(stored.rows[0].business_context, null);

            const approval = await authRequest(
                'POST',
                `/api/payroll/installments/${stored.rows[0].id}/approve?businessContext=event_genix`,
                {}
            );
            assert.equal(approval.status, 409, JSON.stringify(approval.data));
            assert.equal(approval.data.code, 'PAYROLL_ALLOCATION_UNRESOLVED');
            assert.deepEqual([...approval.data.details.businessContexts].sort(), ['dar', 'event_genix']);

            const unchanged = await pool.query(
                'SELECT workflow_status, allocation_status, business_context FROM payroll_installments WHERE id = $1',
                [stored.rows[0].id]
            );
            assert.equal(unchanged.rows[0].workflow_status, 'draft');
            assert.equal(unchanged.rows[0].allocation_status, 'unresolved');
            assert.equal(unchanged.rows[0].business_context, null);
            const sideEffects = await pool.query(
                `SELECT
                    (SELECT COUNT(*)::int FROM payroll_payment_movements WHERE installment_id = $1) AS movements,
                    (SELECT COUNT(*)::int FROM finance_transactions WHERE staff_id = $2 AND source = 'payroll') AS finance`,
                [stored.rows[0].id, staffId]
            );
            assert.equal(sideEffects.rows[0].movements, 0);
            assert.equal(sideEffects.rows[0].finance, 0);
        } finally {
            await deleteDraftPayrollArtifacts(pool, MONTH, staffId);
            if (extraTimeRecordId) {
                await pool.query('DELETE FROM hr_time_records WHERE id = $1', [extraTimeRecordId]);
            }
        }
    });

    test('approved final keeps its KPI snapshot after source KPI data changes', async () => {
        await deleteDraftPayrollArtifacts(pool, MONTH, staffId);
        const onboarding = await pool.query(
            `INSERT INTO onboarding_progress
                (staff_id, items, completed_items, total_items, status, started_at)
             VALUES ($1, '[]'::jsonb, 1, 2, 'in_progress', '2026-03-01')
             RETURNING id`,
            [staffId]
        );
        const onboardingId = Number(onboarding.rows[0].id);
        const adjustment = await authRequest('POST', '/api/hr/salary/adjustment', {
            staff_id: staffId,
            month: MONTH,
            type: 'kpi_bonus',
            amount: 500,
            reason: 'KPI immutable snapshot integration fixture'
        });
        assert.equal(adjustment.status, 200, JSON.stringify(adjustment.data));

        const calculation = await authRequest(
            'POST',
            `/api/payroll/installments/calculate?month=${MONTH}`,
            { month: MONTH }
        );
        assert.equal(calculation.status, 200, JSON.stringify(calculation.data));
        const installments = await pool.query(
            `SELECT pi.id, pi.kind
             FROM payroll_installments pi
             JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
             WHERE pr.period_month = $1 AND pr.staff_id = $2
             ORDER BY pi.kind`,
            [MONTH, staffId]
        );
        const advanceId = Number(installments.rows.find(row => row.kind === 'advance').id);
        const finalId = Number(installments.rows.find(row => row.kind === 'final').id);

        const cancelled = await authRequest(
            'POST',
            `/api/payroll/installments/${advanceId}/cancel`,
            { reason: 'KPI immutable snapshot fixture uses final-only settlement' }
        );
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
        const approval = await authRequest(
            'POST',
            `/api/payroll/installments/${finalId}/approve?businessContext=event_genix`,
            {}
        );
        assert.equal(approval.status, 200, JSON.stringify(approval.data));
        const approvedFinal = approval.data.installment;
        assert.equal(approvedFinal.workflowStatus, 'approved');
        const lockedAmount = approvedFinal.lockedAmount;
        const approvedSnapshot = approvedFinal.calculationSnapshot.kpiAuditSnapshot;
        assert.equal(approvedSnapshot.kpiMonth, MONTH);
        assert.equal(approvedSnapshot.ruleVersion, 'manual_kpi_bonus_v1');
        assert.equal(approvedSnapshot.metrics.onboarding.completedItems, 1);
        assert.equal(approvedSnapshot.approvedBonusAmount, 500);

        await pool.query(
            `UPDATE onboarding_progress
             SET completed_items = 2,
                 total_items = 2,
                 status = 'completed',
                 completed_at = '2026-03-20'
             WHERE id = $1`,
            [onboardingId]
        );
        const liveKpi = await authRequest('GET', `/api/hr/kpi?month=${MONTH}`);
        assert.equal(liveKpi.status, 200, JSON.stringify(liveKpi.data));
        const liveKpiRow = liveKpi.data.data.find(row => Number(row.staff_id) === staffId);
        assert.equal(liveKpiRow.development_kpi.completed_items, 2);

        const settlement = await authRequest('GET', `/api/payroll/settlement?month=${MONTH}`);
        assert.equal(settlement.status, 200, JSON.stringify(settlement.data));
        const storedFinal = settlement.data.settlement.reports
            .flatMap(report => report.installments || [])
            .find(installment => Number(installment.id) === finalId);
        assert.ok(storedFinal);
        assert.equal(storedFinal.workflowStatus, 'approved');
        assert.equal(storedFinal.lockedAmount, lockedAmount);
        assert.deepEqual(storedFinal.calculationSnapshot.kpiAuditSnapshot, approvedSnapshot);
    });
});
