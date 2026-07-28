/**
 * Production-like payroll settlement coverage on disposable PostgreSQL.
 *
 * This suite is excluded from the fast baseline. Run it only through:
 *   npm run test:integration:payroll-fullstack:isolated
 * or the payroll isolated suite.
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { BASE_URL, getToken, request } = require('../helpers');

const enabled = process.env.RUN_PAYROLL_FULLSTACK_SETTLEMENT_INTEGRATION === 'true';
const MONTH = '2026-08';
const MARKER = 'CODEX_QA_PAYROLL_202608';
const BUSINESS_CONTEXT = 'event_genix';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_PAYROLL_FULLSTACK_SETTLEMENT_INTEGRATION=true');
    assert.equal(
        process.env.REQUIRE_ISOLATED_TEST_TARGET,
        'true',
        'payroll full-stack settlement integration requires the isolated local test runner'
    );
    assert.equal(
        process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,
        'true',
        'payroll full-stack settlement integration requires verified disposable database setup'
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
        max: 8,
        connectionTimeoutMillis: 10_000
    });
}

function jsonValue(value) {
    if (!value) return {};
    return typeof value === 'string' ? JSON.parse(value) : value;
}

async function authJson(method, path, body, headers = {}) {
    const token = await getToken();
    const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
}

async function authDownload(path) {
    const token = await getToken();
    const response = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        buffer,
        text: () => buffer.toString('utf8')
    };
}

async function login(username, password) {
    const response = await request('POST', '/api/auth/login', { username, password });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.ok(response.data.token);
    return response.data.token;
}

async function forbiddenJson(token, method, path, body) {
    const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
}

async function insertAttendance(pool, staffId, date, startTime, endTime) {
    const timestamps = await pool.query(
        `SELECT (($1::date + $2::time) AT TIME ZONE 'Europe/Kyiv') AS clock_in,
                (($1::date + $3::time) AT TIME ZONE 'Europe/Kyiv') AS clock_out`,
        [date, startTime, endTime]
    );
    const clockIn = timestamps.rows[0].clock_in;
    const clockOut = timestamps.rows[0].clock_out;
    const minutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000);
    const segmentId = `codex-qa-${date}`;
    const compensationSnapshot = {
        schemaVersion: 1,
        state: 'final',
        manualReview: false,
        planSource: 'test_fixture',
        plan: {
            primaryProfessionKey: 'codex_qa_payroll_202608',
            plannedStart: startTime,
            plannedEnd: endTime,
            segments: [{
                id: segmentId,
                professionKey: 'codex_qa_payroll_202608',
                shiftStart: startTime,
                shiftEnd: endTime,
                breakMinutes: 0
            }]
        },
        physicalAllocation: {
            segmentAllocations: [{
                segmentId,
                segmentIndex: 0,
                professionKey: 'codex_qa_payroll_202608',
                plannedMinutes: minutes,
                actualMinutes: minutes
            }],
            plannedMinutes: minutes,
            actualMinutes: minutes,
            allocatedMinutes: minutes,
            overtimeMinutes: 0,
            allocationSource: 'test_fixture',
            allocationIssues: [],
            breakPolicy: 'test_fixture'
        },
        totals: {
            physicalMinutes: minutes,
            physicalAllocationMinutes: minutes,
            baseMinutes: minutes,
            simultaneousAdditionalMinutes: 0,
            compensationMinutes: minutes
        },
        compensationAllocations: [{
            allocationType: 'base',
            segmentId,
            segmentIndex: 0,
            professionKey: 'codex_qa_payroll_202608',
            plannedMinutes: minutes,
            actualMinutes: minutes
        }],
        issues: []
    };
    const result = await pool.query(
        `INSERT INTO hr_time_records
            (staff_id, record_date, clock_in, clock_out, planned_start, planned_end,
             total_worked_minutes, status, business_context, compensation_snapshot)
         VALUES ($1, $2, $3, $4, $5::time, $6::time, $7, 'present', $8, $9::jsonb)
         RETURNING id`,
        [staffId, date, clockIn, clockOut, startTime, endTime, minutes, BUSINESS_CONTEXT, JSON.stringify(compensationSnapshot)]
    );
    return Number(result.rows[0].id);
}

function findInstallment(settlement, reportId, kind) {
    const report = settlement.reports.find(row => Number(row.reportId ?? row.report_id) === Number(reportId));
    assert.ok(report, `payroll settlement report ${reportId} is present`);
    const installment = (report.installments || []).find(row => row.kind === kind);
    assert.ok(installment, `${kind} installment is present`);
    return installment;
}

describe('payroll full-stack settlement on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;
    let staffId;
    let firstHalfRecordId;
    let categoryId;
    let reversalCategoryId;
    let accountId;
    let forbiddenToken;
    let suffix;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = createPool(testDb);
        suffix = `${process.pid}_${Date.now()}`;

        await pool.query(
            `UPDATE staff
             SET is_active = false,
                 hr_pool_status = 'blacklisted',
                 termination_date = DATE '2026-07-31'
             WHERE name <> $1`,
            [MARKER]
        );

        await pool.query(
            `INSERT INTO hr_professions (key, title, department)
             VALUES ('codex_qa_payroll_202608', $1, 'QA')`,
            [MARKER]
        );

        const staff = await pool.query(
            `INSERT INTO staff
                (name, department, position, role_type, hourly_rate, rate_unit,
                 hire_date, is_active, is_freelance, hr_pool_status)
             VALUES
                ($1, 'qa', 'Full-stack payroll QA', 'codex_qa_payroll_202608',
                 100, 'hour', DATE '2026-08-01', true, false, 'core')
             RETURNING id`,
            [MARKER]
        );
        staffId = Number(staff.rows[0].id);

        await pool.query(
            `INSERT INTO staff_role_assignments
                (staff_id, profession_key, is_primary, status, admission_status,
                 internship_status, hourly_rate, created_by, updated_by)
             VALUES
                ($1, 'codex_qa_payroll_202608', true, 'active', 'approved',
                 'none', 100, 'integration_test', 'integration_test')`,
            [staffId]
        );
        await pool.query(
            `INSERT INTO staff_profession_rates (staff_id, profession_key, hourly_rate)
             VALUES ($1, 'codex_qa_payroll_202608', 100)
             ON CONFLICT (staff_id, profession_key)
             DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate, updated_at = NOW()`,
            [staffId]
        );

        await pool.query(
            `INSERT INTO payroll_schemes
                (staff_id, scheme_type, title, is_active, config_json,
                 effective_from, created_by, updated_by)
             VALUES
                ($1, 'hourly', 'CODEX_QA_ONLY hourly payroll', true,
                 '{"hourlyRate":100}'::jsonb, DATE '2026-08-01',
                 'integration_test', 'integration_test')`,
            [staffId]
        );

        const profile = await pool.query(
            `INSERT INTO payroll_profiles
                (title, profession_key, profile_kind, is_default_for_profession, status, created_by)
             VALUES
                ('CODEX_QA_ONLY hourly profile', 'codex_qa_payroll_202608',
                 'shared', true, 'active', 'integration_test')
             RETURNING id`
        );
        await pool.query(
            `INSERT INTO payroll_profile_versions
                (profile_id, version_number, rate_unit, default_rate,
                 effective_from, change_reason, created_by)
             VALUES
                ($1, 1, 'hour', 100, DATE '2026-08-01',
                 'CODEX_QA payroll full-stack fixture', 'integration_test')`,
            [Number(profile.rows[0].id)]
        );
        await pool.query(
            `INSERT INTO staff_payroll_profile_assignments
                (staff_id, profession_key, profile_id, assignment_kind, effective_from, created_by)
             VALUES
                ($1, 'codex_qa_payroll_202608', $2, 'explicit',
                 DATE '2026-08-01', 'integration_test')`,
            [staffId, Number(profile.rows[0].id)]
        );

        firstHalfRecordId = await insertAttendance(pool, staffId, '2026-08-05', '10:00', '18:00');
        await insertAttendance(pool, staffId, '2026-08-20', '10:00', '18:00');

        const category = await authJson(
            'POST',
            `/api/finance/categories?businessContext=${BUSINESS_CONTEXT}`,
            { name: `CODEX_QA_ONLY_PAYROLL_CATEGORY ${suffix}`, type: 'expense', icon: 'QA', color: '#16a34a' }
        );
        assert.equal(category.status, 201, JSON.stringify(category.data));
        categoryId = Number(category.data.id);

        const reversalCategory = await authJson(
            'POST',
            `/api/finance/categories?businessContext=${BUSINESS_CONTEXT}`,
            { name: `CODEX_QA_ONLY_PAYROLL_REVERSAL_CATEGORY ${suffix}`, type: 'income', icon: 'QA', color: '#2563eb' }
        );
        assert.equal(reversalCategory.status, 201, JSON.stringify(reversalCategory.data));
        reversalCategoryId = Number(reversalCategory.data.id);

        const account = await authJson(
            'POST',
            `/api/finance/accounts?businessContext=${BUSINESS_CONTEXT}`,
            { name: `CODEX_QA_ONLY_PAYROLL_ACCOUNT ${suffix}`, type: 'bank', emoji: 'QA', sortOrder: 990 }
        );
        assert.equal(account.status, 200, JSON.stringify(account.data));
        accountId = Number(account.data.account.id);

        const forbiddenPassword = `NoPayroll-${suffix}-pass`;
        const hash = await bcrypt.hash(forbiddenPassword, 4);
        const forbiddenUsername = `no_payroll_${suffix}`.slice(0, 50);
        await pool.query(
            `INSERT INTO users (username, password_hash, role, name, business_contexts, default_business_context)
             VALUES ($1, $2, 'senior_manager', 'No Payroll QA', ARRAY['event_genix']::text[], 'event_genix')`,
            [forbiddenUsername, hash]
        );
        forbiddenToken = await login(forbiddenUsername, forbiddenPassword);
    });

    after(async () => {
        if (pool) await pool.end();
    });

    test('marker-bound payroll workflow settles through routes with atomic payments, reversal, exports, and permissions', async () => {
        const initialFinance = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM finance_transactions
             WHERE source = 'payroll'`
        );
        assert.equal(initialFinance.rows[0].count, 0);

        const calculation = await authJson('POST', `/api/payroll/installments/calculate?month=${MONTH}`, { month: MONTH });
        assert.equal(calculation.status, 200, JSON.stringify(calculation.data));
        assert.equal(calculation.data.operation, 'calculate_draft');
        assert.equal(calculation.data.financeChanged, false);
        assert.equal(calculation.data.generated, 1, JSON.stringify(calculation.data));
        assert.equal(
            calculation.data.reports.some(row => Number(row.staff_id ?? row.staffId) === Number(staffId)),
            true,
            JSON.stringify(calculation.data.reports)
        );
        const reportId = Number(
            calculation.data.reports.find(row => Number(row.staff_id ?? row.staffId) === Number(staffId)).id
        );

        const touchedNonMarker = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_reports pr
             JOIN staff s ON s.id = pr.staff_id
             WHERE pr.period_month = $1
               AND s.name <> $2`,
            [MONTH, MARKER]
        );
        assert.equal(touchedNonMarker.rows[0].count, 0, 'payroll workflow must not touch non-marker staff');

        let settlement = calculation.data.settlement;
        let advance = findInstallment(settlement, reportId, 'advance');
        let final = findInstallment(settlement, reportId, 'final');
        assert.equal(advance.earningFrom, '2026-08-01');
        assert.equal(advance.earningTo, '2026-08-15');
        assert.equal(final.earningFrom, '2026-08-16');
        assert.equal(final.earningTo, '2026-08-31');
        assert.equal(advance.calculatedAmount, 800, JSON.stringify({
            advance,
            final,
            report: calculation.data.reports.find(row => Number(row.staff_id ?? row.staffId) === Number(staffId))
        }));
        assert.equal(final.calculatedAmount, 800);

        const forbiddenApproval = await forbiddenJson(
            forbiddenToken,
            'POST',
            `/api/payroll/installments/${advance.id}/approve?businessContext=${BUSINESS_CONTEXT}`,
            {}
        );
        assert.equal(forbiddenApproval.status, 403, JSON.stringify(forbiddenApproval.data));

        const approval = await authJson(
            'POST',
            `/api/payroll/installments/${advance.id}/approve?businessContext=${BUSINESS_CONTEXT}`,
            {}
        );
        assert.equal(approval.status, 200, JSON.stringify(approval.data));
        assert.equal(approval.data.operation, 'approve_installment');
        assert.equal(approval.data.financeChanged, false);
        assert.equal(approval.data.installment.workflowStatus, 'approved');
        assert.equal(approval.data.installment.lockedAmount, 800);

        const afterApprovalFinance = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM finance_transactions
             WHERE source = 'payroll'`
        );
        assert.equal(afterApprovalFinance.rows[0].count, 0, 'approval must not create Finance transaction');

        const correction = await authJson(
            'PUT',
            `/api/hr/records/${firstHalfRecordId}/correct`,
            {
                clock_in_time: '10:00',
                clock_out_time: '19:00',
                notes: 'CODEX_QA first-half correction after approved advance'
            }
        );
        assert.equal(correction.status, 200, JSON.stringify(correction.data));

        const recalculation = await authJson('POST', `/api/payroll/installments/calculate?month=${MONTH}`, { month: MONTH });
        assert.equal(recalculation.status, 200, JSON.stringify(recalculation.data));
        settlement = recalculation.data.settlement;
        advance = findInstallment(settlement, reportId, 'advance');
        final = findInstallment(settlement, reportId, 'final');
        assert.equal(advance.workflowStatus, 'approved');
        assert.equal(advance.lockedAmount, 800, 'approved advance locked amount must not be rewritten');
        assert.equal(final.calculatedAmount, 950);
        assert.equal(final.calculationSnapshot.calculation.advanceCorrectionDeltaAmount, 150);

        const firstAdvancePayment = await authJson(
            'POST',
            `/api/payroll/installments/${advance.id}/payments/confirm?businessContext=${BUSINESS_CONTEXT}`,
            {
                actualPaymentDate: '2026-08-20',
                paymentMethod: 'bank',
                categoryId,
                accountId,
                amount: 300,
                reason: 'CODEX_QA partial advance payment',
                description: 'CODEX_QA advance payment part one',
                idempotencyKey: `CODEX_QA_ADVANCE_PART_ONE_${suffix}`
            }
        );
        assert.equal(firstAdvancePayment.status, 201, JSON.stringify(firstAdvancePayment.data));
        assert.equal(firstAdvancePayment.data.operation, 'confirm_payment');
        assert.equal(firstAdvancePayment.data.movement.amount, 300);

        const replayedAdvancePayment = await authJson(
            'POST',
            `/api/payroll/installments/${advance.id}/payments/confirm?businessContext=${BUSINESS_CONTEXT}`,
            {
                actualPaymentDate: '2026-08-20',
                paymentMethod: 'bank',
                categoryId,
                accountId,
                amount: 300,
                reason: 'CODEX_QA partial advance payment',
                description: 'CODEX_QA advance payment part one',
                idempotencyKey: `CODEX_QA_ADVANCE_PART_ONE_${suffix}`
            }
        );
        assert.equal(replayedAdvancePayment.status, 200, JSON.stringify(replayedAdvancePayment.data));
        assert.equal(replayedAdvancePayment.data.idempotent, true);
        assert.equal(replayedAdvancePayment.data.movement.id, firstAdvancePayment.data.movement.id);

        const secondAdvancePayment = await authJson(
            'POST',
            `/api/payroll/installments/${advance.id}/payments/confirm?businessContext=${BUSINESS_CONTEXT}`,
            {
                actualPaymentDate: '2026-08-21',
                paymentMethod: 'bank',
                categoryId,
                accountId,
                amount: 500,
                reason: 'CODEX_QA remaining advance payment',
                description: 'CODEX_QA advance payment part two',
                idempotencyKey: `CODEX_QA_ADVANCE_PART_TWO_${suffix}`
            }
        );
        assert.equal(secondAdvancePayment.status, 201, JSON.stringify(secondAdvancePayment.data));

        const finalApproval = await authJson(
            'POST',
            `/api/payroll/installments/${final.id}/approve?businessContext=${BUSINESS_CONTEXT}`,
            {}
        );
        assert.equal(finalApproval.status, 200, JSON.stringify(finalApproval.data));
        assert.equal(finalApproval.data.installment.workflowStatus, 'approved');
        assert.equal(finalApproval.data.installment.lockedAmount, 950);

        const finalPayload = {
            actualPaymentDate: '2026-09-10',
            paymentMethod: 'bank',
            categoryId,
            accountId,
            amount: 950,
            reason: 'CODEX_QA final payroll payment',
            description: 'CODEX_QA final payroll payment',
            idempotencyKey: `CODEX_QA_FINAL_${suffix}`
        };
        const finalPayments = await Promise.all([
            authJson('POST', `/api/payroll/installments/${final.id}/payments/confirm?businessContext=${BUSINESS_CONTEXT}`, finalPayload),
            authJson('POST', `/api/payroll/installments/${final.id}/payments/confirm?businessContext=${BUSINESS_CONTEXT}`, finalPayload)
        ]);
        assert.deepEqual(finalPayments.map(item => item.status).sort(), [200, 201]);
        assert.equal(finalPayments[0].data.movement.id, finalPayments[1].data.movement.id);

        const movementCount = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_payment_movements
             WHERE idempotency_key = $1`,
            [finalPayload.idempotencyKey]
        );
        assert.equal(movementCount.rows[0].count, 1, 'concurrent confirm must not create duplicate movement');

        const reversal = await authJson(
            'POST',
            `/api/payroll/payments/${firstAdvancePayment.data.movement.id}/reverse?businessContext=${BUSINESS_CONTEXT}`,
            {
                actualPaymentDate: '2026-08-22',
                paymentMethod: 'bank',
                categoryId: reversalCategoryId,
                accountId,
                amount: 100,
                reason: 'CODEX_QA append-only reversal',
                description: 'CODEX_QA advance reversal',
                idempotencyKey: `CODEX_QA_REVERSAL_${suffix}`
            }
        );
        assert.equal(reversal.status, 201, JSON.stringify(reversal.data));
        assert.equal(reversal.data.operation, 'reverse_payment');
        assert.equal(reversal.data.movement.movementType, 'reversal');
        assert.equal(reversal.data.movement.reversesMovementId, firstAdvancePayment.data.movement.id);

        const financeMutation = await authJson(
            'PUT',
            `/api/finance/transactions/${firstAdvancePayment.data.financeTransaction.id}?businessContext=${BUSINESS_CONTEXT}`,
            { description: 'must be blocked' }
        );
        assert.equal(financeMutation.status, 409, JSON.stringify(financeMutation.data));
        assert.equal(financeMutation.data.code, 'PAYROLL_PAYMENT_MANAGED');
        const financeDelete = await authJson(
            'DELETE',
            `/api/finance/transactions/${firstAdvancePayment.data.financeTransaction.id}?businessContext=${BUSINESS_CONTEXT}`
        );
        assert.equal(financeDelete.status, 409, JSON.stringify(financeDelete.data));
        assert.equal(financeDelete.data.code, 'PAYROLL_PAYMENT_MANAGED');

        const financeRows = await pool.query(
            `SELECT id, type, amount::int AS amount, date::text AS date,
                    recognition_date::text AS recognition_date, source
             FROM finance_transactions
             WHERE source = 'payroll'
             ORDER BY id`
        );
        assert.equal(financeRows.rowCount, 4);
        assert.equal(financeRows.rows.every(row => row.source === 'payroll'), true);
        assert.deepEqual(financeRows.rows.map(row => row.amount).sort((a, b) => a - b), [100, 300, 500, 950]);
        assert.ok(financeRows.rows.some(row => row.type === 'expense' && row.date.slice(0, 10) === '2026-09-10' && row.recognition_date.slice(0, 10) === '2026-08-31'));
        assert.ok(financeRows.rows.some(row => row.type === 'income' && row.date.slice(0, 10) === '2026-08-22'));

        const finalSettlement = await authJson('GET', `/api/payroll/settlement?month=${MONTH}`);
        assert.equal(finalSettlement.status, 200, JSON.stringify(finalSettlement.data));
        const settledAdvance = findInstallment(finalSettlement.data.settlement, reportId, 'advance');
        const settledFinal = findInstallment(finalSettlement.data.settlement, reportId, 'final');
        assert.equal(settledAdvance.paymentTotal, 800);
        assert.equal(settledAdvance.reversalTotal, 100);
        assert.equal(settledAdvance.paidAmount, 700);
        assert.equal(settledAdvance.balanceAmount, 100);
        assert.equal(settledFinal.paymentTotal, 950);
        assert.equal(settledFinal.balanceAmount, 0);

        const csv = await authDownload(`/api/payroll/export?month=${MONTH}`);
        assert.equal(csv.status, 200);
        const csvText = csv.text();
        for (const token of [
            MARKER,
            'installment_kind',
            'earning_range',
            'actual_payment_dates',
            'paid_amount',
            'balance_amount',
            'finance_transaction_ids',
            'reversal_transaction_ids',
            'advance',
            'final',
            '2026-08-01',
            '2026-09-10'
        ]) {
            assert.ok(csvText.includes(token), `CSV export includes ${token}`);
        }

        const xlsx = await authDownload(`/api/payroll/export-xlsx?month=${MONTH}`);
        assert.equal(xlsx.status, 200);
        assert.match(xlsx.contentType, /spreadsheetml/);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(xlsx.buffer);
        const paymentsSheet = workbook.getWorksheet('Payments');
        assert.ok(paymentsSheet, 'XLSX has Payments sheet');
        const paymentHeaders = paymentsSheet.getRow(1).values.filter(Boolean);
        assert.ok(paymentHeaders.includes('movement_type'));
        assert.ok(paymentHeaders.includes('finance_transaction_id'));
        assert.ok(paymentsSheet.rowCount >= 5, 'Payments sheet contains payment and reversal rows');

        const afterAllTouchedNonMarker = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_reports pr
             JOIN staff s ON s.id = pr.staff_id
             WHERE s.name <> $1`,
            [MARKER]
        );
        assert.equal(afterAllTouchedNonMarker.rows[0].count, 0);

        const deletes = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM payroll_payment_movements
             WHERE installment_id IN (
                 SELECT pi.id
                 FROM payroll_installments pi
                 JOIN payroll_reports pr ON pr.id = pi.payroll_report_id
                 WHERE pr.staff_id = $1
             )
               AND movement_type = 'reversal'`,
            [staffId]
        );
        assert.equal(deletes.rows[0].count, 1, 'history is preserved through append-only reversal');
    });
});
