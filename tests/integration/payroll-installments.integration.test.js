/**
 * Real PostgreSQL coverage for migration 302 payroll installment constraints.
 *
 * This suite is excluded from the fast baseline. Run it only through:
 *   npm run test:integration:payroll-profiles:isolated
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { pool: appPool } = require('../../db');
const { authRequest } = require('../helpers');
const { closePayrollPeriod } = require('../../services/hrPayrollPeriod');
const { loadPayrollSettlementReadModels } = require('../../services/payrollSettlement');
const {
    confirmPayrollInstallmentPayment,
    reversePayrollPaymentMovement
} = require('../../services/payroll');

const enabled = process.env.RUN_PAYROLL_INSTALLMENTS_INTEGRATION === 'true';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_PAYROLL_INSTALLMENTS_INTEGRATION=true');
    assert.equal(
        process.env.REQUIRE_ISOLATED_TEST_TARGET,
        'true',
        'payroll installments integration requires the isolated local test runner'
    );
    assert.equal(
        process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,
        'true',
        'payroll installments integration requires verified disposable database setup'
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

function isoDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return String(value).slice(0, 10);
}

async function expectPgError(promise, expectedCodes, message) {
    let caught = null;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.ok(caught, message);
    assert.ok(
        expectedCodes.includes(caught.code),
        `${message}: expected PostgreSQL code ${expectedCodes.join(' or ')}, received ${caught.code || 'none'} (${caught.message})`
    );
    return caught;
}

describe('payroll installment foundation on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;
    let actorUserId;
    let actorUsername;
    let staffId;
    let reportId;
    let constraintReportId;
    let legacyReportId;
    let advanceId;
    let finalId;
    let firstPaymentId;
    let firstFinanceId;
    let expenseCategoryId;
    let incomeCategoryId;
    let accountId;
    let accountName;
    let suffix;

    async function createFinanceTransaction(amount, date, type = 'expense', recognitionDate = null) {
        const result = await pool.query(
            `INSERT INTO finance_transactions
                (type, category_id, amount, description, date, payment_method, staff_id,
                 account_id, account_name, created_by, source, recognition_date, business_context)
             VALUES
                ($3, $4, $1, 'Payroll installment integration', $2, 'bank', $5,
                 $6, $7, 'integration_test', 'payroll', $8, 'event_genix')
             RETURNING id`,
            [
                amount,
                date,
                type,
                type === 'income' ? incomeCategoryId : expenseCategoryId,
                staffId,
                accountId,
                accountName,
                recognitionDate || date
            ]
        );
        return Number(result.rows[0].id);
    }

    async function createPaymentMovement({
        installmentId,
        movementType,
        amount,
        date,
        financeTransactionId,
        idempotencyKey,
        reversesMovementId = null,
        actorId = actorUserId,
        username = actorUsername,
        role = 'accountant'
    }, db = pool) {
        const result = await db.query(
            `INSERT INTO payroll_payment_movements
                (installment_id, movement_type, amount, actual_payment_date, actor_user_id,
                 actor_username, actor_role, reason, idempotency_key, finance_transaction_id, reverses_movement_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'Payroll installment integration', $8, $9, $10)
             RETURNING id`,
            [installmentId, movementType, amount, date, actorId, username, role,
                idempotencyKey, financeTransactionId, reversesMovementId]
        );
        return Number(result.rows[0].id);
    }
    async function waitForClientLock(pid, message) {
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const state = await pool.query(
                'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
                [pid]
            );
            if (state.rows[0]?.wait_event_type === 'Lock') return;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.fail(message);
    }

    async function createApprovedInstallmentFixture({
        month,
        kind = 'advance',
        amount = 100,
        businessContext = 'event_genix',
        calculationSnapshot = null,
        reportNetAmount = amount
    }) {
        const [year, monthNumber] = month.split('-').map(Number);
        const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
        const earningFrom = `${month}-${kind === 'advance' ? '01' : '16'}`;
        const earningTo = kind === 'advance' ? `${month}-15` : monthEnd;
        const scheduledPaymentDate = kind === 'advance' ? `${month}-20` : monthEnd;
        const report = await pool.query(
            `INSERT INTO payroll_reports
                (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount,
                 status, settlement_model, breakdown_json, created_by, updated_by)
             VALUES ($1, $2, $3, 0, 0, $3, 'approved', 'installments_v1',
                 '{}'::jsonb, 'integration_test', 'integration_test')
             RETURNING id`,
            [month, staffId, reportNetAmount]
        );
        const snapshot = calculationSnapshot || { schemaVersion: 1, kind };
        const installment = await pool.query(
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, locked_amount, calculation_snapshot, workflow_status,
                 allocation_status, business_context, approved_by_user_id, approved_by_username,
                 approved_by_role, approved_at)
             VALUES ($1, $2, $3::date, $4::date, $5::date,
                 $6::numeric, $6::integer, $7::jsonb, 'approved', 'single', $8, $9, $10, 'accountant', NOW())
             RETURNING id`,
            [
                Number(report.rows[0].id),
                kind,
                earningFrom,
                earningTo,
                scheduledPaymentDate,
                amount,
                JSON.stringify(snapshot),
                businessContext,
                actorUserId,
                actorUsername
            ]
        );
        return {
            reportId: Number(report.rows[0].id),
            installmentId: Number(installment.rows[0].id),
            earningFrom,
            earningTo
        };
    }


    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = createPool(testDb);
        suffix = `${process.pid}_${Date.now()}`;

        const actor = await pool.query(
            `INSERT INTO users (username, password_hash, role, name)
             VALUES ($1, 'not-a-real-login-hash', 'accountant', 'Payroll Installment QA')
             RETURNING id`,
            [`payroll_installment_actor_${suffix}`.slice(0, 50)]
        );
        actorUserId = Number(actor.rows[0].id);

        const staff = await pool.query(
            `INSERT INTO staff (name, department, position, is_active)
             VALUES ($1, 'qa', 'Payroll installment QA', true)
             RETURNING id`,
            [`Payroll Installment ${suffix}`]
        );
        staffId = Number(staff.rows[0].id);

        const categories = await pool.query(
            `INSERT INTO finance_categories (business_context, name, type, is_active, sort_order)
             VALUES
                ('event_genix', $1, 'expense', true, 910),
                ('event_genix', $2, 'income', true, 911)
             RETURNING id, type`,
            [`Payroll Expense ${suffix}`, `Payroll Reversal ${suffix}`]
        );
        expenseCategoryId = Number(categories.rows.find(row => row.type === 'expense').id);
        incomeCategoryId = Number(categories.rows.find(row => row.type === 'income').id);

        const account = await pool.query(
            `INSERT INTO finance_accounts (business_context, name, emoji, type, is_active, sort_order, created_by)
             VALUES ('event_genix', $1, '🏦', 'bank', true, 912, 'integration_test')
             RETURNING id, name`,
            [`Payroll Account ${suffix}`]
        );
        accountId = Number(account.rows[0].id);
        accountName = account.rows[0].name;

        const reports = await pool.query(
            `INSERT INTO payroll_reports
                (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount,
                 status, settlement_model, breakdown_json, created_by, updated_by)
             VALUES
                ('2099-07', $1, 3200, 0, 0, 3200, 'approved', 'installments_v1', '{}'::jsonb, 'integration_test', 'integration_test'),
                ('2099-08', $1, 1000, 0, 0, 1000, 'draft', 'installments_v1', '{}'::jsonb, 'integration_test', 'integration_test'),
                ('2099-09', $1, 1000, 0, 0, 1000, 'paid', 'legacy_v1', '{}'::jsonb, 'integration_test', 'integration_test')
             RETURNING id, period_month`,
            [staffId]
        );
        const reportByMonth = new Map(reports.rows.map(row => [row.period_month, Number(row.id)]));
        reportId = reportByMonth.get('2099-07');
        constraintReportId = reportByMonth.get('2099-08');
        legacyReportId = reportByMonth.get('2099-09');

        const installments = await pool.query(
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, locked_amount, calculation_snapshot, workflow_status,
                 allocation_status, business_context, approved_by_user_id, approved_by_username,
                 approved_by_role, approved_at, created_by, updated_by)
             VALUES
                ($1, 'advance', DATE '2099-07-01', DATE '2099-07-15', DATE '2099-07-20',
                 1000.50, 1000, '{"schemaVersion":1,"kind":"advance"}'::jsonb, 'approved',
                 'single', 'event_genix', $2, $3, 'accountant', NOW(), $3, $3),
                ($1, 'final', DATE '2099-07-16', DATE '2099-07-31', DATE '2099-08-10',
                 2200.00, 2200, '{"schemaVersion":1,"kind":"final"}'::jsonb, 'approved',
                 'single', 'event_genix', $2, $3, 'accountant', NOW(), $3, $3)
             RETURNING id, kind`,
            [reportId, actorUserId, `payroll_installment_actor_${suffix}`.slice(0, 50)]
        );
        const installmentByKind = new Map(installments.rows.map(row => [row.kind, Number(row.id)]));
        advanceId = installmentByKind.get('advance');
        finalId = installmentByKind.get('final');

        firstFinanceId = await createFinanceTransaction(600, '2099-07-20');
        const secondFinanceId = await createFinanceTransaction(400, '2099-07-21');
        const reversalFinanceId = await createFinanceTransaction(200, '2099-07-22', 'income');
        actorUsername = `payroll_installment_actor_${suffix}`.slice(0, 50);

        const firstPayment = await pool.query(
            `INSERT INTO payroll_payment_movements
                (installment_id, movement_type, amount, actual_payment_date, actor_user_id,
                 actor_username, actor_role, reason, idempotency_key, finance_transaction_id)
             VALUES
                ($1, 'payment', 600, DATE '2099-07-20', $2, $3, 'accountant',
                 'Advance part one', $4, $5)
             RETURNING id`,
            [advanceId, actorUserId, actorUsername, `payroll-payment-1-${suffix}`, firstFinanceId]
        );
        firstPaymentId = Number(firstPayment.rows[0].id);

        await pool.query(
            `INSERT INTO payroll_payment_movements
                (installment_id, movement_type, amount, actual_payment_date, actor_user_id,
                 actor_username, actor_role, reason, idempotency_key, finance_transaction_id, reverses_movement_id)
             VALUES
                ($1, 'payment', 400, DATE '2099-07-21', $2, $3, 'accountant',
                 'Advance part two', $4, $5, NULL),
                ($1, 'reversal', 200, DATE '2099-07-22', $2, $3, 'accountant',
                 'Partial correction', $6, $7, $8)`,
            [
                advanceId,
                actorUserId,
                actorUsername,
                `payroll-payment-2-${suffix}`,
                secondFinanceId,
                `payroll-reversal-1-${suffix}`,
                reversalFinanceId,
                firstPaymentId
            ]
        );
    });

    after(async () => {
        if (pool) await pool.end();
        await appPool.end().catch(() => {});
    });

    test('one report owns advance and final while paid and balance are derived', async () => {
        const summary = await loadPayrollSettlementReadModels('2099-07', pool);

        assert.equal(summary.mode, 'installments');
        assert.equal(summary.reports.length, 1);
        assert.equal(summary.reports[0].installments.length, 2);
        assert.equal(summary.totals.effectiveDueAmount, 3200);
        assert.equal(summary.totals.paidAmount, 800);
        assert.equal(summary.totals.balanceAmount, 2400);

        const advance = summary.reports[0].installments.find(row => row.kind === 'advance');
        const final = summary.reports[0].installments.find(row => row.kind === 'final');
        assert.equal(advance.paymentTotal, 1000);
        assert.equal(advance.reversalTotal, 200);
        assert.equal(advance.paidAmount, 800);
        assert.equal(advance.balanceAmount, 200);
        assert.equal(final.paidAmount, 0);
        assert.equal(final.balanceAmount, 2200);
    });

    test('legacy paid report remains legacy_accounted without invented payment facts', async () => {
        const summary = await loadPayrollSettlementReadModels('2099-09', pool);

        assert.equal(summary.mode, 'legacy');
        assert.equal(summary.legacyClassification.historicalStatus, 'legacy_accounted');
        assert.equal(summary.legacyClassification.paymentFactVerified, false);
        assert.equal(summary.reports[0].installments.length, 0);
        assert.equal(summary.reports[0].legacy.actualPaymentDate, null);
        assert.deepEqual(summary.reports[0].legacy.actualPaymentDates, []);
        assert.equal(summary.reports[0].legacy.confirmedBy, null);
        assert.equal(summary.reports[0].legacy.confirmedAt, null);

        const response = await authRequest('GET', '/api/payroll/settlement?month=2099-09');
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.equal(response.data.success, true);
        assert.equal(response.data.settlement.mode, 'legacy');
        assert.equal(response.data.settlement.legacyClassification.historicalStatus, 'legacy_accounted');
        assert.equal(response.data.settlement.legacyClassification.paymentFactVerified, false);
        const report = response.data.settlement.reports.find(row => Number(row.reportId) === legacyReportId);
        assert.ok(report);
        assert.deepEqual(report.installments, []);
        assert.equal(report.legacy.historicalStatus, 'legacy_accounted');
        assert.equal(report.legacy.actualPaymentDate, null);
        assert.deepEqual(report.legacy.actualPaymentDates, []);
        assert.equal(report.legacy.confirmedBy, null);
        assert.equal(report.legacy.confirmedAt, null);
    });

    test('duplicate installment kind is rejected', async () => {
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_installments
                    (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date, calculated_amount)
                 VALUES ($1, 'advance', DATE '2099-07-01', DATE '2099-07-15', DATE '2099-07-20', 10)`,
                [reportId]
            ),
            ['23505'],
            'duplicate report installment kind must be rejected'
        );
    });

    test('canonical ZRS and piece values are enforced by PostgreSQL constraints', async () => {
        const adjustment = await pool.query(
            `INSERT INTO salary_adjustments (staff_id, month, type, amount, reason, created_by)
             VALUES ($1, '2100-10', 'zrs', 25, 'Canonical ZRS integration', 'integration_test')
             RETURNING id`,
            [staffId]
        );
        const scheme = await pool.query(
            `INSERT INTO payroll_schemes
                (staff_id, scheme_type, title, config_json, effective_from, created_by, updated_by)
             VALUES ($1, 'piece', 'Piece integration', '{"pieceRate":15}'::jsonb,
                     DATE '2100-10-01', 'integration_test', 'integration_test')
             RETURNING id`,
            [staffId]
        );
        const entries = await pool.query(
            `INSERT INTO payroll_entries
                (staff_id, scheme_id, period_month, line_type, label, amount, quantity, rate, created_by)
             VALUES
                ($1, NULL, '2100-10', 'zrs', 'Canonical ZRS', -25, NULL, NULL, 'integration_test'),
                ($1, $2, '2100-10', 'piece', 'Piece units', 45, 3, 15, 'integration_test')
             RETURNING id, line_type`,
            [staffId, Number(scheme.rows[0].id)]
        );
        assert.deepEqual(entries.rows.map(row => row.line_type).sort(), ['piece', 'zrs']);

        await expectPgError(
            pool.query(
                `INSERT INTO salary_adjustments (staff_id, month, type, amount, created_by)
                 VALUES ($1, '2100-10', 'unknown_payroll_type', 1, 'integration_test')`,
                [staffId]
            ),
            ['23514'],
            'unknown salary adjustment type must be rejected'
        );
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_schemes
                    (staff_id, scheme_type, title, config_json, effective_from, created_by, updated_by)
                 VALUES ($1, 'unknown_piece_fallback', 'Invalid scheme', '{}'::jsonb,
                         DATE '2100-10-01', 'integration_test', 'integration_test')`,
                [staffId]
            ),
            ['23514'],
            'unknown payroll scheme must be rejected'
        );
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_entries
                    (staff_id, period_month, line_type, label, amount, created_by)
                 VALUES ($1, '2100-10', 'unknown_piece_fallback', 'Invalid entry', 1, 'integration_test')`,
                [staffId]
            ),
            ['23514'],
            'unknown payroll entry type must be rejected'
        );

        await pool.query('DELETE FROM payroll_entries WHERE id = ANY($1::bigint[])', [entries.rows.map(row => Number(row.id))]);
        await pool.query('DELETE FROM payroll_schemes WHERE id = $1', [Number(scheme.rows[0].id)]);
        await pool.query('DELETE FROM salary_adjustments WHERE id = $1', [Number(adjustment.rows[0].id)]);
    });

    test('legacy reports cannot receive installment rows and populated reports cannot downgrade', async () => {
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_installments
                    (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date, calculated_amount)
                 VALUES ($1, 'advance', DATE '2099-09-01', DATE '2099-09-15', DATE '2099-09-20', 10)`,
                [legacyReportId]
            ),
            ['23514'],
            'legacy report installment insert must fail closed'
        );
        await expectPgError(
            pool.query("UPDATE payroll_reports SET settlement_model = 'legacy_v1' WHERE id = $1", [reportId]),
            ['55000'],
            'installment report downgrade must be blocked'
        );
        await expectPgError(
            pool.query("UPDATE payroll_reports SET status = 'paid' WHERE id = $1", [reportId]),
            ['23514'],
            'installment report must not expose legacy paid status'
        );
        await expectPgError(
            pool.query("UPDATE payroll_reports SET period_month = '2099-06' WHERE id = $1", [reportId]),
            ['55000'],
            'installment report month must be immutable'
        );
    });

    test('invalid range, amount, snapshot, and unresolved allocation are rejected', async () => {
        const invalidStatements = [
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date, calculated_amount)
             VALUES ($1, 'advance', DATE '2099-08-02', DATE '2099-08-15', DATE '2099-08-20', 10)`,
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date, calculated_amount)
             VALUES ($1, 'advance', DATE '2099-08-01', DATE '2099-08-15', DATE '2099-08-20', -1)`,
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, calculation_snapshot)
             VALUES ($1, 'advance', DATE '2099-08-01', DATE '2099-08-15', DATE '2099-08-20', 10, '[]'::jsonb)`,
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, locked_amount, workflow_status, allocation_status,
                 approved_by_username, approved_by_role, approved_at)
             VALUES ($1, 'advance', DATE '2099-08-01', DATE '2099-08-15', DATE '2099-08-20',
                 10, 10, 'approved', 'unresolved', 'qa', 'accountant', NOW())`,
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, locked_amount, workflow_status, allocation_status, business_context,
                 approved_by_username, approved_by_role, approved_at)
             VALUES ($1, 'advance', DATE '2099-08-01', DATE '2099-08-15', DATE '2099-08-20',
                 10, 10, 'approved', 'single', 'event_genix', 'qa', 'accountant', NOW())`
        ];

        for (const statement of invalidStatements) {
            await expectPgError(
                pool.query(statement, [constraintReportId]),
                ['23514'],
                'invalid installment payload must be rejected'
            );
        }
    });

    test('draft installments, actor snapshots, and finance facts fail closed', async () => {
        const draft = await pool.query(
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, locked_amount, calculation_snapshot)
             VALUES ($1, 'advance', DATE '2099-08-01', DATE '2099-08-15', DATE '2099-08-20',
                 100, 100, '{"schemaVersion":1,"kind":"advance"}'::jsonb)
             RETURNING id`,
            [constraintReportId]
        );
        const draftInstallmentId = Number(draft.rows[0].id);
        const draftFinanceId = await createFinanceTransaction(10, '2099-08-20');

        await expectPgError(
            createPaymentMovement({
                installmentId: draftInstallmentId,
                movementType: 'payment',
                amount: 10,
                date: '2099-08-20',
                financeTransactionId: draftFinanceId,
                idempotencyKey: `payroll-draft-payment-${suffix}`
            }),
            ['23514'],
            'draft installment payment must be rejected'
        );
        await expectPgError(
            pool.query(
                `UPDATE payroll_installments
                 SET workflow_status = 'approved', allocation_status = 'single', business_context = 'event_genix',
                     approved_by_user_id = $2, approved_by_username = 'forged',
                     approved_by_role = 'accountant', approved_at = NOW()
                 WHERE id = $1`,
                [draftInstallmentId, actorUserId]
            ),
            ['23514'],
            'approver snapshot mismatch must be rejected'
        );

        await pool.query(
            `UPDATE payroll_installments
             SET workflow_status = 'approved', allocation_status = 'single', business_context = 'event_genix',
                 approved_by_user_id = $2, approved_by_username = $3,
                 approved_by_role = 'accountant', approved_at = NOW()
             WHERE id = $1`,
            [draftInstallmentId, actorUserId, actorUsername]
        );

        const wrongFinanceId = await createFinanceTransaction(11, '2099-08-20');
        await expectPgError(
            createPaymentMovement({
                installmentId: draftInstallmentId,
                movementType: 'payment',
                amount: 10,
                date: '2099-08-20',
                financeTransactionId: wrongFinanceId,
                idempotencyKey: `payroll-finance-mismatch-${suffix}`
            }),
            ['23514'],
            'movement and finance facts must match'
        );

        const missingActorFinanceId = await createFinanceTransaction(10, '2099-08-20');
        await expectPgError(
            createPaymentMovement({
                installmentId: draftInstallmentId,
                movementType: 'payment',
                amount: 10,
                date: '2099-08-20',
                financeTransactionId: missingActorFinanceId,
                idempotencyKey: `payroll-missing-actor-${suffix}`,
                actorId: null
            }),
            ['23514'],
            'movement actor user must be present'
        );
    });

    test('payroll movement recognition month must match its earning month', async () => {
        const financeId = await createFinanceTransaction(50, '2099-07-23', 'expense', '2099-08-01');
        try {
            await expectPgError(
                createPaymentMovement({
                    installmentId: advanceId,
                    movementType: 'payment',
                    amount: 50,
                    date: '2099-07-23',
                    financeTransactionId: financeId,
                    idempotencyKey: `payroll-recognition-mismatch-${suffix}`
                }),
                ['23514'],
                'payroll movement with a wrong recognition month must be rejected'
            );
        } finally {
            await pool.query('DELETE FROM finance_transactions WHERE id = $1', [financeId]);
        }
    });

    test('payments and reversals cannot exceed their remaining amounts', async () => {
        const overpaymentFinanceId = await createFinanceTransaction(201, '2099-07-23');
        await expectPgError(
            createPaymentMovement({
                installmentId: advanceId,
                movementType: 'payment',
                amount: 201,
                date: '2099-07-23',
                financeTransactionId: overpaymentFinanceId,
                idempotencyKey: `payroll-overpayment-${suffix}`
            }),
            ['23514'],
            'payment above the outstanding balance must be rejected'
        );

        const excessiveReversalFinanceId = await createFinanceTransaction(401, '2099-07-23', 'income');
        await expectPgError(
            createPaymentMovement({
                installmentId: advanceId,
                movementType: 'reversal',
                amount: 401,
                date: '2099-07-23',
                financeTransactionId: excessiveReversalFinanceId,
                idempotencyKey: `payroll-excessive-reversal-${suffix}`,
                reversesMovementId: firstPaymentId
            }),
            ['23514'],
            'reversal above the unreversed payment amount must be rejected'
        );

        const earlyReversalFinanceId = await createFinanceTransaction(1, '2099-07-19', 'income');
        await expectPgError(
            createPaymentMovement({
                installmentId: advanceId,
                movementType: 'reversal',
                amount: 1,
                date: '2099-07-19',
                financeTransactionId: earlyReversalFinanceId,
                idempotencyKey: `payroll-early-reversal-${suffix}`,
                reversesMovementId: firstPaymentId
            }),
            ['23514'],
            'reversal date before payment date must be rejected'
        );
    });

    test('idempotency and finance links are globally unique', async () => {
        const extraFinanceId = await createFinanceTransaction(50, '2099-08-20', 'expense', '2099-07-01');
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_payment_movements
                    (installment_id, movement_type, amount, actual_payment_date, actor_user_id, actor_username,
                     actor_role, reason, idempotency_key, finance_transaction_id)
                 VALUES ($1, 'payment', 50, DATE '2099-08-20', $4, $5, 'accountant',
                     'Duplicate idempotency', $2, $3)`,
                [finalId, `payroll-payment-1-${suffix}`, extraFinanceId, actorUserId, actorUsername]
            ),
            ['23505'],
            'duplicate idempotency key must be rejected'
        );
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_payment_movements
                    (installment_id, movement_type, amount, actual_payment_date, actor_user_id, actor_username,
                     actor_role, reason, idempotency_key, finance_transaction_id)
                 VALUES ($1, 'payment', 600, DATE '2099-07-20', $4, $5, 'accountant',
                     'Duplicate finance link', $2, $3)`,
                [finalId, `payroll-payment-extra-${suffix}`, firstFinanceId, actorUserId, actorUsername]
            ),
            ['23505'],
            'duplicate finance link must be rejected'
        );
    });
    test('finance links cannot cross legacy and installment settlement models', async () => {
        const legacyFinanceId = await createFinanceTransaction(50, '2099-08-10', 'expense', '2099-07-01');
        await pool.query(
            'UPDATE payroll_reports SET finance_transaction_id = $1 WHERE id = $2',
            [legacyFinanceId, legacyReportId]
        );

        await expectPgError(
            createPaymentMovement({
                installmentId: finalId,
                movementType: 'payment',
                amount: 50,
                date: '2099-08-10',
                financeTransactionId: legacyFinanceId,
                idempotencyKey: `payroll-legacy-collision-${suffix}`
            }),
            ['23505'],
            'movement must not reuse a legacy payroll finance link'
        );

        await expectPgError(
            pool.query(
                'UPDATE payroll_reports SET reversal_transaction_id = $1 WHERE id = $2',
                [firstFinanceId, legacyReportId]
            ),
            ['23505'],
            'legacy report must not reuse an installment movement finance link'
        );

        await expectPgError(
            pool.query(
                `INSERT INTO payroll_reports
                    (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount,
                     status, settlement_model, breakdown_json, created_by, updated_by, finance_transaction_id)
                 VALUES ('2099-11', $1, 50, 0, 0, 50, 'paid', 'legacy_v1',
                     '{}'::jsonb, 'integration_test', 'integration_test', $2)`,
                [staffId, legacyFinanceId]
            ),
            ['23505'],
            'legacy reports must not share a finance link on new writes'
        );
    });

    test('finance immutability and cross-model uniqueness survive overlapping transactions', async () => {
        const movementFinanceId = await createFinanceTransaction(25, '2099-08-10', 'expense', '2099-07-01');
        const movementClient = await pool.connect();
        const financeClient = await pool.connect();
        let movementCommitted = false;

        try {
            const financePid = Number((await financeClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
            await movementClient.query('BEGIN');
            await createPaymentMovement({
                installmentId: finalId,
                movementType: 'payment',
                amount: 25,
                date: '2099-08-10',
                financeTransactionId: movementFinanceId,
                idempotencyKey: `payroll-finance-update-race-${suffix}`
            }, movementClient);

            const updateResultPromise = financeClient.query(
                `UPDATE finance_transactions
                 SET description = 'Concurrent mutation'
                 WHERE id = $1`,
                [movementFinanceId]
            ).then(
                value => ({ status: 'fulfilled', value }),
                error => ({ status: 'rejected', error })
            );
            await waitForClientLock(
                financePid,
                'finance update must wait for the uncommitted payroll movement'
            );
            await movementClient.query('COMMIT');
            movementCommitted = true;

            const updateResult = await updateResultPromise;
            assert.equal(updateResult.status, 'rejected');
            assert.equal(updateResult.error.code, '55000');
        } finally {
            if (!movementCommitted) await movementClient.query('ROLLBACK').catch(() => {});
            movementClient.release();
            financeClient.release();
        }

        const legacyFinanceId = await createFinanceTransaction(30, '2099-08-10', 'expense', '2099-07-01');
        const legacyReport = await pool.query(
            `INSERT INTO payroll_reports
                (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount,
                 status, settlement_model, breakdown_json, created_by, updated_by)
             VALUES ('2100-01', $1, 30, 0, 0, 30, 'paid', 'legacy_v1',
                 '{}'::jsonb, 'integration_test', 'integration_test')
             RETURNING id`,
            [staffId]
        );
        const legacyClient = await pool.connect();
        const installmentClient = await pool.connect();
        let legacyCommitted = false;

        try {
            const installmentPid = Number(
                (await installmentClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
            );
            await legacyClient.query('BEGIN');
            await legacyClient.query(
                'UPDATE payroll_reports SET finance_transaction_id = $1 WHERE id = $2',
                [legacyFinanceId, Number(legacyReport.rows[0].id)]
            );
            await installmentClient.query('BEGIN');
            const movementResultPromise = createPaymentMovement({
                installmentId: finalId,
                movementType: 'payment',
                amount: 30,
                date: '2099-08-10',
                financeTransactionId: legacyFinanceId,
                idempotencyKey: `payroll-cross-model-race-${suffix}`
            }, installmentClient).then(
                value => ({ status: 'fulfilled', value }),
                error => ({ status: 'rejected', error })
            );
            await waitForClientLock(
                installmentPid,
                'movement insert must wait for the uncommitted legacy finance link'
            );
            await legacyClient.query('COMMIT');
            legacyCommitted = true;

            const movementResult = await movementResultPromise;
            assert.equal(movementResult.status, 'rejected');
            assert.equal(movementResult.error.code, '23505');
        } finally {
            if (!legacyCommitted) await legacyClient.query('ROLLBACK').catch(() => {});
            await installmentClient.query('ROLLBACK').catch(() => {});
            legacyClient.release();
            installmentClient.release();
        }
    });


    test('reversal must reference a payment from the same installment', async () => {
        const financeId = await createFinanceTransaction(50, '2099-08-10', 'income', '2099-07-01');
        await expectPgError(
            pool.query(
                `INSERT INTO payroll_payment_movements
                    (installment_id, movement_type, amount, actual_payment_date, actor_user_id, actor_username,
                     actor_role, reason, idempotency_key, finance_transaction_id, reverses_movement_id)
                 VALUES ($1, 'reversal', 50, DATE '2099-08-10', $5, $6, 'accountant',
                     'Wrong installment reversal', $2, $3, $4)`,
                [finalId, `payroll-reversal-wrong-${suffix}`, financeId, firstPaymentId, actorUserId, actorUsername]
            ),
            ['23514'],
            'cross-installment reversal must be rejected'
        );
    });

    test('movement rows are immutable and linked parents cannot be deleted', async () => {
        await expectPgError(
            pool.query('UPDATE payroll_payment_movements SET amount = 601 WHERE id = $1', [firstPaymentId]),
            ['55000'],
            'movement update must be blocked'
        );
        await expectPgError(
            pool.query('UPDATE payroll_payment_movements SET actor_user_id = NULL WHERE id = $1', [firstPaymentId]),
            ['55000'],
            'manual actor ID removal must be blocked'
        );
        await expectPgError(
            pool.query('UPDATE payroll_installments SET locked_amount = 999 WHERE id = $1', [advanceId]),
            ['55000'],
            'approved installment amount must be immutable'
        );
        await expectPgError(
            pool.query(
                `UPDATE payroll_installments
                 SET calculation_snapshot = jsonb_set(calculation_snapshot, '{kpiAuditSnapshot}', '{"mutated":true}'::jsonb)
                 WHERE id = $1`,
                [finalId]
            ),
            ['55000'],
            'approved installment KPI/calculation snapshot must be immutable'
        );
        await expectPgError(
            pool.query('DELETE FROM payroll_payment_movements WHERE id = $1', [firstPaymentId]),
            ['55000'],
            'movement delete must be blocked'
        );
        await expectPgError(
            pool.query(
                `UPDATE finance_transactions
                 SET description = 'Mutated payroll payment'
                 WHERE id = $1`,
                [firstFinanceId]
            ),
            ['55000'],
            'linked finance transaction update must be blocked'
        );
        await expectPgError(
            pool.query('DELETE FROM finance_transactions WHERE id = $1', [firstFinanceId]),
            ['55000'],
            'linked finance transaction delete must be blocked'
        );
        await expectPgError(
            pool.query('DELETE FROM payroll_installments WHERE id = $1', [advanceId]),
            ['55000'],
            'approved installment delete must be blocked'
        );
        await expectPgError(
            pool.query('DELETE FROM payroll_reports WHERE id = $1', [reportId]),
            ['23503'],
            'report with installments must be protected'
        );
    });

    test('concurrent payments and reversals serialize on the installment row', async () => {
        const report = await pool.query(
            `INSERT INTO payroll_reports
                (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount,
                 status, settlement_model, breakdown_json, created_by, updated_by)
             VALUES ('2099-10', $1, 100, 0, 0, 100, 'approved', 'installments_v1',
                 '{}'::jsonb, 'integration_test', 'integration_test')
             RETURNING id`,
            [staffId]
        );
        const installment = await pool.query(
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, locked_amount, calculation_snapshot, workflow_status,
                 allocation_status, business_context, approved_by_user_id, approved_by_username,
                 approved_by_role, approved_at)
             VALUES ($1, 'advance', DATE '2099-10-01', DATE '2099-10-15', DATE '2099-10-20',
                 100, 100, '{"schemaVersion":1,"kind":"advance"}'::jsonb, 'approved',
                 'single', 'event_genix', $2, $3, 'accountant', NOW())
             RETURNING id`,
            [Number(report.rows[0].id), actorUserId, actorUsername]
        );
        const concurrentInstallmentId = Number(installment.rows[0].id);
        const paymentFinanceIds = await Promise.all([
            createFinanceTransaction(60, '2099-10-20'),
            createFinanceTransaction(60, '2099-10-20')
        ]);
        const left = await pool.connect();
        const right = await pool.connect();

        try {
            await Promise.all([
                left.query("SET lock_timeout = '5s'"),
                right.query("SET lock_timeout = '5s'")
            ]);
            const payments = await Promise.allSettled([
                createPaymentMovement({
                    installmentId: concurrentInstallmentId,
                    movementType: 'payment',
                    amount: 60,
                    date: '2099-10-20',
                    financeTransactionId: paymentFinanceIds[0],
                    idempotencyKey: `payroll-concurrent-payment-left-${suffix}`
                }, left),
                createPaymentMovement({
                    installmentId: concurrentInstallmentId,
                    movementType: 'payment',
                    amount: 60,
                    date: '2099-10-20',
                    financeTransactionId: paymentFinanceIds[1],
                    idempotencyKey: `payroll-concurrent-payment-right-${suffix}`
                }, right)
            ]);
            const successfulPayments = payments.filter(result => result.status === 'fulfilled');
            const rejectedPayments = payments.filter(result => result.status === 'rejected');
            assert.equal(successfulPayments.length, 1);
            assert.equal(rejectedPayments.length, 1);
            assert.equal(rejectedPayments[0].reason.code, '23514');

            const paymentId = successfulPayments[0].value;
            const reversalFinanceIds = await Promise.all([
                createFinanceTransaction(40, '2099-10-21', 'income'),
                createFinanceTransaction(40, '2099-10-21', 'income')
            ]);
            const reversals = await Promise.allSettled([
                createPaymentMovement({
                    installmentId: concurrentInstallmentId,
                    movementType: 'reversal',
                    amount: 40,
                    date: '2099-10-21',
                    financeTransactionId: reversalFinanceIds[0],
                    idempotencyKey: `payroll-concurrent-reversal-left-${suffix}`,
                    reversesMovementId: paymentId
                }, left),
                createPaymentMovement({
                    installmentId: concurrentInstallmentId,
                    movementType: 'reversal',
                    amount: 40,
                    date: '2099-10-21',
                    financeTransactionId: reversalFinanceIds[1],
                    idempotencyKey: `payroll-concurrent-reversal-right-${suffix}`,
                    reversesMovementId: paymentId
                }, right)
            ]);
            const successfulReversals = reversals.filter(result => result.status === 'fulfilled');
            const rejectedReversals = reversals.filter(result => result.status === 'rejected');
            assert.equal(successfulReversals.length, 1);
            assert.equal(rejectedReversals.length, 1);
            assert.equal(rejectedReversals[0].reason.code, '23514');
        } finally {
            left.release();
            right.release();
        }
    });

    test('report activation and installment creation serialize without mixed ownership', async () => {
        const reports = await pool.query(
            `INSERT INTO payroll_reports
                (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount,
                 status, settlement_model, breakdown_json, created_by, updated_by)
             VALUES
                ('2099-11', $1, 100, 0, 0, 100, 'draft', 'installments_v1', '{}'::jsonb, 'integration_test', 'integration_test'),
                ('2099-12', $1, 100, 0, 0, 100, 'draft', 'installments_v1', '{}'::jsonb, 'integration_test', 'integration_test')
             RETURNING id, period_month`,
            [staffId]
        );
        const reportByMonth = new Map(reports.rows.map(row => [row.period_month, Number(row.id)]));
        const inserter = await pool.connect();
        const updater = await pool.connect();

        try {
            await Promise.all([
                inserter.query("SET lock_timeout = '5s'"),
                updater.query("SET lock_timeout = '5s'")
            ]);

            await inserter.query('BEGIN');
            await inserter.query(
                `INSERT INTO payroll_installments
                    (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date, calculated_amount)
                 VALUES ($1, 'advance', DATE '2099-11-01', DATE '2099-11-15', DATE '2099-11-20', 100)`,
                [reportByMonth.get('2099-11')]
            );
            const downgrade = updater.query(
                "UPDATE payroll_reports SET settlement_model = 'legacy_v1' WHERE id = $1",
                [reportByMonth.get('2099-11')]
            );
            downgrade.catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 25));
            await inserter.query('COMMIT');
            await expectPgError(downgrade, ['55000'], 'downgrade racing an installment insert must fail');

            await updater.query('BEGIN');
            await updater.query(
                "UPDATE payroll_reports SET settlement_model = 'legacy_v1' WHERE id = $1",
                [reportByMonth.get('2099-12')]
            );
            const installmentInsert = inserter.query(
                `INSERT INTO payroll_installments
                    (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date, calculated_amount)
                 VALUES ($1, 'advance', DATE '2099-12-01', DATE '2099-12-15', DATE '2099-12-20', 100)`,
                [reportByMonth.get('2099-12')]
            );
            installmentInsert.catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 25));
            await updater.query('COMMIT');
            await expectPgError(installmentInsert, ['23514'], 'insert racing a downgrade must fail');
        } finally {
            await inserter.query('ROLLBACK').catch(() => {});
            await updater.query('ROLLBACK').catch(() => {});
            inserter.release();
            updater.release();
        }
    });

    test('two simultaneous confirm requests with the same key return stable success and create one ledger pair', async () => {
        const report = await pool.query(
            `INSERT INTO payroll_reports
                (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount,
                 status, settlement_model, breakdown_json, created_by, updated_by)
             VALUES ('2100-02', $1, 100, 0, 0, 100, 'approved', 'installments_v1',
                 '{}'::jsonb, 'integration_test', 'integration_test')
             RETURNING id`,
            [staffId]
        );
        const installment = await pool.query(
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, locked_amount, calculation_snapshot, workflow_status,
                 allocation_status, business_context, approved_by_user_id, approved_by_username,
                 approved_by_role, approved_at)
             VALUES ($1, 'advance', DATE '2100-02-01', DATE '2100-02-15', DATE '2100-02-20',
                 100, 100, '{"schemaVersion":1,"kind":"advance"}'::jsonb, 'approved',
                 'single', 'event_genix', $2, $3, 'accountant', NOW())
             RETURNING id`,
            [Number(report.rows[0].id), actorUserId, actorUsername]
        );
        const installmentId = Number(installment.rows[0].id);
        const actor = { id: actorUserId, username: actorUsername, role: 'accountant' };
        const basePayload = {
            actualPaymentDate: '2100-02-20',
            paymentMethod: 'bank',
            categoryId: expenseCategoryId,
            accountId,
            businessContext: 'event_genix',
            amount: 100,
            reason: 'Concurrent payroll confirm integration',
            description: 'Concurrent payroll confirm integration',
            idempotencyKey: `payroll-service-confirm-same-key-${suffix}`
        };
        const results = await Promise.allSettled([
            confirmPayrollInstallmentPayment(installmentId, actor, basePayload),
            confirmPayrollInstallmentPayment(installmentId, actor, basePayload)
        ]);
        const fulfilled = results.filter(result => result.status === 'fulfilled');
        assert.equal(fulfilled.length, 2, JSON.stringify(results.map(result => (
            result.status === 'fulfilled'
                ? { status: result.status, idempotent: result.value?.idempotent }
                : { status: result.status, code: result.reason?.code, message: result.reason?.message }
        ))));
        assert.deepEqual(fulfilled.map(result => result.value.idempotent).sort(), [false, true]);
        assert.equal(fulfilled[0].value.movement.id, fulfilled[1].value.movement.id);

        const movementCount = await pool.query(
            `SELECT COUNT(*)::int AS movements,
                    COUNT(DISTINCT finance_transaction_id)::int AS finance_links,
                    COALESCE(SUM(amount), 0)::int AS paid
             FROM payroll_payment_movements
             WHERE installment_id = $1
               AND movement_type = 'payment'`,
            [installmentId]
        );
        assert.equal(movementCount.rows[0].movements, 1);
        assert.equal(movementCount.rows[0].finance_links, 1);
        assert.equal(movementCount.rows[0].paid, 100);
        const financeCount = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM finance_transactions
             WHERE source = 'payroll'
               AND staff_id = $1
               AND description = $2`,
            [staffId, basePayload.reason]
        );
        assert.equal(financeCount.rows[0].count, 1);
    });

    test('canonical service supports partial and multiple payments plus append-only partial reversal', async () => {
        const month = '2100-09';
        const fixture = await createApprovedInstallmentFixture({ month, amount: 300 });
        const actor = { id: actorUserId, username: actorUsername, role: 'accountant' };
        const paymentPayload = {
            actualPaymentDate: '2100-09-20',
            paymentMethod: 'bank',
            categoryId: expenseCategoryId,
            accountId,
            businessContext: 'event_genix',
            amount: 100,
            reason: 'Partial payroll installment integration'
        };
        const first = await confirmPayrollInstallmentPayment(fixture.installmentId, actor, {
            ...paymentPayload,
            idempotencyKey: `payroll-partial-first-${suffix}`
        });
        const second = await confirmPayrollInstallmentPayment(fixture.installmentId, actor, {
            ...paymentPayload,
            actualPaymentDate: '2100-09-21',
            idempotencyKey: `payroll-partial-second-${suffix}`
        });
        const reversalPayload = {
            actualPaymentDate: '2100-09-22',
            paymentMethod: 'bank',
            categoryId: incomeCategoryId,
            accountId,
            businessContext: 'event_genix',
            amount: 50,
            reason: 'Partial append-only reversal',
            description: `Partial append-only reversal ${suffix}`,
            idempotencyKey: `payroll-partial-reversal-same-key-${suffix}`
        };
        const reversalResults = await Promise.all([
            reversePayrollPaymentMovement(first.movement.id, actor, reversalPayload),
            reversePayrollPaymentMovement(first.movement.id, actor, reversalPayload)
        ]);
        assert.deepEqual(reversalResults.map(result => result.idempotent).sort(), [false, true]);
        assert.equal(reversalResults[0].movement.id, reversalResults[1].movement.id);
        const reversal = reversalResults[0];
        assert.equal(reversal.movement.reversesMovementId, first.movement.id);

        for (const [label, changedTarget, override] of [
            ['target', second.movement.id, {}],
            ['amount', first.movement.id, { amount: 49 }],
            ['date', first.movement.id, { actualPaymentDate: '2100-09-23' }],
            ['paymentMethod', first.movement.id, { paymentMethod: 'cash' }],
            ['category', first.movement.id, { categoryId: incomeCategoryId + 1000000 }],
            ['account', first.movement.id, { accountId: accountId + 1000000 }],
            ['reason', first.movement.id, { reason: 'Changed reversal reason' }],
            ['description', first.movement.id, { description: 'Changed reversal description' }]
        ]) {
            await assert.rejects(
                reversePayrollPaymentMovement(changedTarget, actor, { ...reversalPayload, ...override }),
                error => error.code === 'PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT',
                `changed reversal ${label} must conflict`
            );
        }
        await assert.rejects(
            reversePayrollPaymentMovement(
                first.movement.id,
                actor,
                { ...reversalPayload, businessContext: 'dar' }
            ),
            error => error.code === 'PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT',
            'changed reversal businessContext must conflict'
        );

        const settlement = await loadPayrollSettlementReadModels(month, pool);
        const installment = settlement.reports[0].installments[0];
        assert.equal(installment.paymentTotal, 200);
        assert.equal(installment.reversalTotal, 50);
        assert.equal(installment.paidAmount, 150);
        assert.equal(installment.balanceAmount, 150);

        await assert.rejects(
            confirmPayrollInstallmentPayment(fixture.installmentId, actor, {
                ...paymentPayload,
                amount: 200,
                idempotencyKey: `payroll-service-excess-payment-${suffix}`
            }),
            error => error.code === 'PAYROLL_PAYMENT_EXCEEDS_BALANCE'
        );
        await assert.rejects(
            reversePayrollPaymentMovement(first.movement.id, actor, {
                actualPaymentDate: '2100-09-23',
                paymentMethod: 'bank',
                categoryId: incomeCategoryId,
                accountId,
                businessContext: 'event_genix',
                amount: 60,
                reason: 'Excess reversal must fail',
                idempotencyKey: `payroll-service-excess-reversal-${suffix}`
            }),
            error => error.code === 'PAYROLL_REVERSAL_EXCEEDS_PAYMENT'
        );
    });

    test('repeated idempotency key returns the same payment without duplicates and keeps recognition separate from cash date', async () => {
        const fixture = await createApprovedInstallmentFixture({ month: '2100-03', amount: 100 });
        const actor = { id: actorUserId, username: actorUsername, role: 'accountant' };
        const idempotencyKey = `payroll-service-idempotent-${suffix}`;
        const description = `Payroll idempotency ${suffix}`;
        const payload = {
            actualPaymentDate: '2100-04-10',
            paymentMethod: 'bank',
            categoryId: expenseCategoryId,
            accountId,
            businessContext: 'event_genix',
            amount: 100,
            reason: 'Stable idempotent payroll payment',
            description,
            idempotencyKey
        };

        const first = await confirmPayrollInstallmentPayment(fixture.installmentId, actor, payload);
        const second = await confirmPayrollInstallmentPayment(fixture.installmentId, actor, payload);
        assert.equal(first.idempotent, false);
        assert.equal(second.idempotent, true);
        assert.equal(second.movement.id, first.movement.id);
        assert.equal(second.financeTransactionId, Number(first.financeTransaction.id));

        for (const [label, override] of [
            ['amount', { amount: 99 }],
            ['date', { actualPaymentDate: '2100-04-11' }],
            ['paymentMethod', { paymentMethod: 'cash' }],
            ['category', { categoryId: expenseCategoryId + 1000000 }],
            ['account', { accountId: accountId + 1000000 }],
            ['reason', { reason: 'Changed idempotent payroll payment' }],
            ['description', { description: 'Changed payroll description' }]
        ]) {
            await assert.rejects(
                confirmPayrollInstallmentPayment(fixture.installmentId, actor, { ...payload, ...override }),
                error => error.code === 'PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT',
                `changed payment ${label} must conflict`
            );
        }
        await assert.rejects(
            confirmPayrollInstallmentPayment(
                fixture.installmentId,
                actor,
                { ...payload, businessContext: 'dar' }
            ),
            error => error.code === 'PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT',
            'changed payment businessContext must conflict'
        );

        const stored = await pool.query(
            `SELECT ppm.id AS movement_id, ppm.finance_transaction_id,
                    ft.date, ft.recognition_date
             FROM payroll_payment_movements ppm
             JOIN finance_transactions ft ON ft.id = ppm.finance_transaction_id
             WHERE ppm.idempotency_key = $1`,
            [idempotencyKey]
        );
        assert.equal(stored.rowCount, 1);
        assert.equal(Number(stored.rows[0].movement_id), Number(first.movement.id));
        assert.equal(Number(stored.rows[0].finance_transaction_id), Number(first.financeTransaction.id));
        assert.equal(isoDate(stored.rows[0].date), '2100-04-10');
        assert.equal(isoDate(stored.rows[0].recognition_date), '2100-03-15');

        const marchPnl = await authRequest(
            'GET',
            '/api/finance/report/pnl?year=2100&month=3&businessContext=event_genix'
        );
        assert.equal(marchPnl.status, 200, JSON.stringify(marchPnl.data));
        assert.equal(marchPnl.data.summary.totalExpenses, 100);
        const aprilPnl = await authRequest(
            'GET',
            '/api/finance/report/pnl?year=2100&month=4&businessContext=event_genix'
        );
        assert.equal(aprilPnl.status, 200, JSON.stringify(aprilPnl.data));
        assert.equal(aprilPnl.data.summary.totalExpenses, 0);

        const aprilCash = await authRequest(
            'GET',
            '/api/finance/dashboard?from=2100-04-01&to=2100-04-30&businessContext=event_genix'
        );
        assert.equal(aprilCash.status, 200, JSON.stringify(aprilCash.data));
        assert.equal(aprilCash.data.totals.expense, 0, 'dashboard P&L total must use recognition date');
        assert.equal(
            aprilCash.data.daily.reduce((sum, row) => sum + Number(row.expense || 0), 0),
            100,
            'cash-flow daily breakdown must use actual payment date'
        );

        const other = await createApprovedInstallmentFixture({ month: '2100-04', amount: 100 });
        await assert.rejects(
            confirmPayrollInstallmentPayment(other.installmentId, actor, payload),
            error => error.code === 'PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT'
        );
    });

    test('Finance insert failure leaves no payment movement', async () => {
        const fixture = await createApprovedInstallmentFixture({ month: '2100-05', amount: 100 });
        const actor = { id: actorUserId, username: actorUsername, role: 'accountant' };
        const idempotencyKey = `payroll-finance-failure-${suffix}`;
        const description = `Payroll finance failure ${suffix}`;
        await pool.query(`
            CREATE OR REPLACE FUNCTION payroll_test_reject_finance_insert()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.description = '${description.replace(/'/g, "''")}' THEN
                    RAISE EXCEPTION 'injected payroll finance insert failure';
                END IF;
                RETURN NEW;
            END;
            $$
        `);
        await pool.query(`
            CREATE TRIGGER payroll_test_reject_finance_insert_trigger
            BEFORE INSERT ON finance_transactions
            FOR EACH ROW EXECUTE FUNCTION payroll_test_reject_finance_insert()
        `);
        try {
            await assert.rejects(
                confirmPayrollInstallmentPayment(fixture.installmentId, actor, {
                    actualPaymentDate: '2100-05-20',
                    paymentMethod: 'bank',
                    categoryId: expenseCategoryId,
                    accountId,
                    businessContext: 'event_genix',
                    amount: 100,
                    reason: 'Injected Finance failure',
                    description,
                    idempotencyKey
                }),
                error => error.code === 'P0001'
            );
        } finally {
            await pool.query('DROP TRIGGER IF EXISTS payroll_test_reject_finance_insert_trigger ON finance_transactions');
            await pool.query('DROP FUNCTION IF EXISTS payroll_test_reject_finance_insert()');
        }
        const [movement, finance] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS count FROM payroll_payment_movements WHERE idempotency_key = $1', [idempotencyKey]),
            pool.query('SELECT COUNT(*)::int AS count FROM finance_transactions WHERE description = $1', [description])
        ]);
        assert.equal(movement.rows[0].count, 0);
        assert.equal(finance.rows[0].count, 0);
    });

    test('movement insert failure rolls back the Finance transaction', async () => {
        const fixture = await createApprovedInstallmentFixture({ month: '2100-06', amount: 100 });
        const actor = { id: actorUserId, username: actorUsername, role: 'accountant' };
        const idempotencyKey = `payroll-movement-failure-${suffix}`;
        const description = `Payroll movement failure ${suffix}`;
        await pool.query(`
            CREATE OR REPLACE FUNCTION payroll_test_reject_movement_insert()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.idempotency_key = '${idempotencyKey.replace(/'/g, "''")}' THEN
                    RAISE EXCEPTION 'injected payroll movement insert failure';
                END IF;
                RETURN NEW;
            END;
            $$
        `);
        await pool.query(`
            CREATE TRIGGER payroll_test_reject_movement_insert_trigger
            BEFORE INSERT ON payroll_payment_movements
            FOR EACH ROW EXECUTE FUNCTION payroll_test_reject_movement_insert()
        `);
        try {
            await assert.rejects(
                confirmPayrollInstallmentPayment(fixture.installmentId, actor, {
                    actualPaymentDate: '2100-06-20',
                    paymentMethod: 'bank',
                    categoryId: expenseCategoryId,
                    accountId,
                    businessContext: 'event_genix',
                    amount: 100,
                    reason: 'Injected movement failure',
                    description,
                    idempotencyKey
                }),
                error => error.code === 'P0001'
            );
        } finally {
            await pool.query('DROP TRIGGER IF EXISTS payroll_test_reject_movement_insert_trigger ON payroll_payment_movements');
            await pool.query('DROP FUNCTION IF EXISTS payroll_test_reject_movement_insert()');
        }
        const [movement, finance] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS count FROM payroll_payment_movements WHERE idempotency_key = $1', [idempotencyKey]),
            pool.query('SELECT COUNT(*)::int AS count FROM finance_transactions WHERE description = $1', [description])
        ]);
        assert.equal(movement.rows[0].count, 0);
        assert.equal(finance.rows[0].count, 0);
    });

    test('payment confirmation fails closed when installment and request business contexts differ', async () => {
        const fixture = await createApprovedInstallmentFixture({
            month: '2100-07',
            amount: 100,
            businessContext: 'dar'
        });
        const actor = { id: actorUserId, username: actorUsername, role: 'accountant' };
        const idempotencyKey = `payroll-context-mismatch-${suffix}`;
        await assert.rejects(
            confirmPayrollInstallmentPayment(fixture.installmentId, actor, {
                actualPaymentDate: '2100-07-20',
                paymentMethod: 'bank',
                categoryId: expenseCategoryId,
                accountId,
                businessContext: 'event_genix',
                amount: 100,
                reason: 'Business context mismatch',
                idempotencyKey
            }),
            error => error.code === 'PAYROLL_BUSINESS_CONTEXT_MISMATCH'
        );
        const movement = await pool.query(
            'SELECT COUNT(*)::int AS count FROM payroll_payment_movements WHERE idempotency_key = $1',
            [idempotencyKey]
        );
        assert.equal(movement.rows[0].count, 0);
    });

    test('generic Finance PUT and DELETE return PAYROLL_PAYMENT_MANAGED for linked payroll transactions', async () => {
        const before = await pool.query('SELECT description FROM finance_transactions WHERE id = $1', [firstFinanceId]);
        const update = await authRequest(
            'PUT',
            `/api/finance/transactions/${firstFinanceId}?businessContext=event_genix`,
            { description: 'Forbidden payroll mutation' }
        );
        assert.equal(update.status, 409, JSON.stringify(update.data));
        assert.equal(update.data.code, 'PAYROLL_PAYMENT_MANAGED');
        const removal = await authRequest(
            'DELETE',
            `/api/finance/transactions/${firstFinanceId}?businessContext=event_genix`
        );
        assert.equal(removal.status, 409, JSON.stringify(removal.data));
        assert.equal(removal.data.code, 'PAYROLL_PAYMENT_MANAGED');
        const afterAttempt = await pool.query('SELECT description FROM finance_transactions WHERE id = $1', [firstFinanceId]);
        assert.equal(afterAttempt.rowCount, 1);
        assert.equal(afterAttempt.rows[0].description, before.rows[0].description);
    });

    test('period close rejects outstanding installments without persisting a lock', async () => {
        await assert.rejects(
            closePayrollPeriod('2099-07', actorUsername, 'Outstanding integration guard', pool),
            error => {
                assert.equal(error.code, 'PAYROLL_MONTH_CLOSE_BLOCKED');
                assert.ok(error.details.blockers.some(blocker => blocker.code === 'PAYROLL_INSTALLMENT_NOT_SETTLED'));
                return true;
            }
        );
        const lock = await pool.query('SELECT is_locked FROM payroll_period_locks WHERE period_month = $1', ['2099-07']);
        assert.equal(lock.rows[0]?.is_locked === true, false);
    });

    test('period close detects report-level overpayment stored in the immutable final snapshot', async () => {
        const month = '2100-08';
        const report = await pool.query(
            `INSERT INTO payroll_reports
                (period_month, staff_id, gross_amount, deductions_amount, advances_amount, net_amount,
                 status, settlement_model, breakdown_json, created_by, updated_by)
             VALUES ($1, $2, 80, 0, 0, 80, 'approved', 'installments_v1',
                 '{}'::jsonb, 'integration_test', 'integration_test')
             RETURNING id`,
            [month, staffId]
        );
        const installments = await pool.query(
            `INSERT INTO payroll_installments
                (payroll_report_id, kind, earning_from, earning_to, scheduled_payment_date,
                 calculated_amount, locked_amount, calculation_snapshot, workflow_status,
                 allocation_status, business_context, approved_by_user_id, approved_by_username,
                 approved_by_role, approved_at)
             VALUES
                ($1, 'advance', DATE '2100-08-01', DATE '2100-08-15', DATE '2100-08-20',
                 100, 100, '{"schemaVersion":1,"kind":"advance"}'::jsonb, 'approved',
                 'single', 'event_genix', $2, $3, 'accountant', NOW()),
                ($1, 'final', DATE '2100-08-16', DATE '2100-08-31', DATE '2100-09-10',
                 0, 0, '{"schemaVersion":1,"kind":"final","calculation":{"monthlyNetAmount":80,"overpaidAmount":20,"lockedAdvanceOverMonthlyNetAmount":20}}'::jsonb, 'approved',
                 'single', 'event_genix', $2, $3, 'accountant', NOW())
             RETURNING id, kind`,
            [Number(report.rows[0].id), actorUserId, actorUsername]
        );
        const advanceInstallmentId = Number(installments.rows.find(row => row.kind === 'advance').id);
        await confirmPayrollInstallmentPayment(
            advanceInstallmentId,
            { id: actorUserId, username: actorUsername, role: 'accountant' },
            {
                actualPaymentDate: '2100-08-20',
                paymentMethod: 'bank',
                categoryId: expenseCategoryId,
                accountId,
                businessContext: 'event_genix',
                amount: 100,
                reason: 'Report-level overpayment fixture',
                idempotencyKey: `payroll-report-overpayment-${suffix}`
            }
        );

        await assert.rejects(
            closePayrollPeriod(month, actorUsername, 'Overpayment integration guard', pool),
            error => {
                assert.equal(error.code, 'PAYROLL_MONTH_CLOSE_BLOCKED');
                const blocker = error.details.blockers.find(item => item.code === 'PAYROLL_OVERPAYMENT_UNRESOLVED');
                assert.ok(blocker);
                assert.equal(blocker.overpaidAmount, 20);
                assert.equal(blocker.lockedAdvanceOverMonthlyNetAmount, 20);
                return true;
            }
        );
        const lock = await pool.query('SELECT is_locked FROM payroll_period_locks WHERE period_month = $1', [month]);
        assert.equal(lock.rows[0]?.is_locked === true, false);
    });

    test('actor deletion clears only actor IDs and preserves immutable snapshots', async () => {
        await pool.query('DELETE FROM users WHERE id = $1', [actorUserId]);
        const movement = await pool.query(
            `SELECT actor_user_id, actor_username, actor_role, amount, finance_transaction_id
             FROM payroll_payment_movements
             WHERE id = $1`,
            [firstPaymentId]
        );
        const installment = await pool.query(
            `SELECT approved_by_user_id, approved_by_username, approved_by_role
             FROM payroll_installments
             WHERE id = $1`,
            [advanceId]
        );

        assert.equal(movement.rows[0].actor_user_id, null);
        assert.match(movement.rows[0].actor_username, /^payroll_installment_actor_/);
        assert.equal(movement.rows[0].actor_role, 'accountant');
        assert.equal(Number(movement.rows[0].amount), 600);
        assert.equal(Number(movement.rows[0].finance_transaction_id), firstFinanceId);
        assert.equal(installment.rows[0].approved_by_user_id, null);
        assert.match(installment.rows[0].approved_by_username, /^payroll_installment_actor_/);
        assert.equal(installment.rows[0].approved_by_role, 'accountant');
    });
});
