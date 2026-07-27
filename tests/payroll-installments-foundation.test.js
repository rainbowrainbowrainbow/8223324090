'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
    path.join(ROOT, 'db', 'migrations', '302_payroll_installments_foundation.sql'),
    'utf8'
);
const migrationSql = migration
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ');
const {
    buildPayrollSettlementReadModel,
    derivePayrollInstallmentAmounts,
    loadPayrollSettlementReadModels,
    mapPayrollInstallment,
    normalizePayrollMonth,
    summarizePayrollSettlementMonth
} = require('../services/payrollSettlement');

test('migration 302 is governed, additive, and does not invent payment history', () => {
    assert.match(migration, /-- MIGRATION_KIND:\s*schema/i);
    assert.match(migration, /-- SAFETY:/i);
    assert.match(migration, /-- ROLLBACK:/i);
    assert.match(migration, /-- OPERATOR_APPROVAL:\s*required/i);

    assert.doesNotMatch(migrationSql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(migrationSql, /\bUPDATE\s+[a-z_][a-z0-9_]*\s+SET\b/i);
    assert.doesNotMatch(migrationSql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(migrationSql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migrationSql, /ALTER\s+TABLE\s+(?:staff|finance_transactions)\b/i);
    assert.doesNotMatch(migrationSql, /ALTER\s+COLUMN\s+finance_transaction_id/i);
});

test('migration 302 makes settlement ownership explicit and fail-closed', () => {
    assert.match(
        migration,
        /ADD COLUMN IF NOT EXISTS settlement_model VARCHAR\(32\) NOT NULL DEFAULT 'legacy_v1'/
    );
    assert.match(migration, /settlement_model IN \('legacy_v1', 'installments_v1'\)/);
    assert.match(
        migration,
        /settlement_model = 'legacy_v1'[\s\S]*finance_transaction_id IS NULL[\s\S]*reversal_transaction_id IS NULL/
    );
    assert.match(migration, /payroll report must use installments_v1 before installments are created/);
    assert.match(migration, /payroll report with installments cannot return to legacy_v1/);
    assert.match(migration, /status NOT IN \('paid', 'reversed'\)/);
    assert.match(migration, /FROM payroll_reports[\s\S]*FOR UPDATE/);
    assert.match(migration, /payroll report identity is immutable after installments are created/);
});

test('migration 302 creates one advance and final obligation per report with strict ranges', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_installments/);
    assert.match(migration, /payroll_report_id BIGINT NOT NULL REFERENCES payroll_reports\(id\) ON DELETE RESTRICT/);
    assert.match(migration, /UNIQUE \(payroll_report_id, kind\)/);
    assert.match(migration, /kind IN \('advance', 'final'\)/);
    assert.match(migration, /earning_from = date_trunc\('month', earning_from\)::date/);
    assert.match(migration, /earning_to = date_trunc\('month', earning_from\)::date \+ 14/);
    assert.match(migration, /earning_from = date_trunc\('month', earning_from\)::date \+ 15/);
    assert.match(migration, /INTERVAL '1 month - 1 day'/);
    assert.match(migration, /scheduled_payment_date >= earning_to/);
    assert.match(migration, /calculated_amount NUMERIC\(12,2\) NOT NULL DEFAULT 0/);
    assert.match(migration, /locked_amount INTEGER/);
    assert.match(migration, /workflow_status IN \('draft', 'approved', 'cancelled'\)/);
    assert.doesNotMatch(migration, /workflow_status[^\n]+paid/i);
    assert.match(migration, /payroll installment approver snapshot must match the approver user/);
    assert.match(migration, /approved or cancelled payroll installments are immutable/);
    assert.match(migration, /pg_trigger_depth\(\) > 1/);
});

test('migration 302 keeps allocation unresolved until a business context is explicit', () => {
    assert.match(migration, /allocation_status VARCHAR\(16\) NOT NULL DEFAULT 'unresolved'/);
    assert.match(
        migration,
        /allocation_status = 'unresolved'[\s\S]*business_context IS NULL[\s\S]*allocation_status = 'single'[\s\S]*NULLIF\(BTRIM\(business_context\), ''\) IS NOT NULL/
    );
    assert.match(migration, /workflow_status <> 'approved'[\s\S]*allocation_status = 'single'/);
    assert.doesNotMatch(migration, /business_context VARCHAR\(64\)[^\n]*DEFAULT 'event_genix'/);
});

test('migration 302 creates an append-only movement ledger with durable finance links', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_payment_movements/);
    assert.match(migration, /installment_id BIGINT NOT NULL REFERENCES payroll_installments\(id\) ON DELETE RESTRICT/);
    assert.match(migration, /movement_type IN \('payment', 'reversal'\)/);
    assert.match(migration, /amount INTEGER NOT NULL/);
    assert.match(migration, /CHECK \(amount > 0\)/);
    assert.match(migration, /UNIQUE \(idempotency_key\)/);
    assert.match(migration, /UNIQUE \(finance_transaction_id\)/);
    assert.match(
        migration,
        /finance_transaction_id INTEGER NOT NULL REFERENCES finance_transactions\(id\) ON DELETE RESTRICT/
    );
    assert.match(migration, /FOREIGN KEY \(reverses_movement_id, installment_id\)/);
    assert.match(migration, /payroll reversal must reference a payment from the same installment/);
    assert.match(migration, /payroll payments require an approved locked installment/);
    assert.match(migration, /payroll payment exceeds the installment outstanding balance/);
    assert.match(migration, /payroll reversal exceeds the remaining payment amount/);
    assert.match(migration, /payroll payment actor snapshot must match the actor user/);
    assert.match(migration, /payroll movement must match its finance transaction facts/);
    assert.match(migration, /finance transaction is already linked to a legacy payroll report/);
    assert.match(migration, /finance transaction is already linked to a payroll movement/);
    assert.match(
        migration,
        /BEFORE UPDATE[\s\S]*ON finance_transactions[\s\S]*prevent_linked_payroll_finance_update_v302/
    );
    assert.match(
        migration,
        /finance transactions linked to payroll history are immutable; create a payroll reversal instead/
    );

    assert.match(migration, /BEFORE UPDATE OR DELETE[\s\S]*prevent_payroll_payment_movement_mutation_v302/);
    assert.match(migration, /payroll payment movements are append-only; create a reversal instead/);
    assert.doesNotMatch(migration, /\bpaid_amount\b/i);
    assert.doesNotMatch(migration, /\bbalance_amount\b/i);
});

test('installment amounts derive paid and balance from payments minus reversals', () => {
    assert.deepEqual(
        derivePayrollInstallmentAmounts({
            workflow_status: 'approved',
            calculated_amount: '1000.50',
            locked_amount: 1000,
            payment_total: 1000,
            reversal_total: 200
        }),
        {
            calculatedAmount: 1000.5,
            lockedAmount: 1000,
            effectiveDueAmount: 1000,
            paymentTotal: 1000,
            reversalTotal: 200,
            paidAmount: 800,
            unappliedReversalAmount: 0,
            ledgerIntegrity: 'valid',
            balanceAmount: 200,
            outstandingAmount: 200,
            overpaidAmount: 0,
            settlementStatus: 'partially_paid'
        }
    );
});

test('read model fails closed when legacy corruption reverses more than was paid', () => {
    const amounts = derivePayrollInstallmentAmounts({
        workflow_status: 'approved',
        calculated_amount: 100,
        locked_amount: 100,
        payment_total: 50,
        reversal_total: 80
    });

    assert.equal(amounts.paidAmount, 0);
    assert.equal(amounts.unappliedReversalAmount, 30);
    assert.equal(amounts.ledgerIntegrity, 'invalid_reversal_total');
    assert.equal(amounts.settlementStatus, 'invalid_ledger');
});

test('installment mapper keeps camel-case approver identity', () => {
    const installment = mapPayrollInstallment({
        id: 9,
        payroll_report_id: 3,
        kind: 'advance',
        approvedByUserId: 17
    });

    assert.equal(installment.approvedByUserId, 17);
});

test('installment mapper preserves the local calendar date returned for PostgreSQL DATE values', () => {
    const databaseDate = new Date(2100, 3, 10);
    const installment = mapPayrollInstallment({
        id: 10,
        payroll_report_id: 3,
        kind: 'final',
        earning_from: databaseDate,
        earning_to: databaseDate,
        scheduled_payment_date: databaseDate,
        movements: [{
            id: 101,
            installment_id: 10,
            movement_type: 'payment',
            amount: 1,
            actual_payment_date: databaseDate,
            finance_transaction_id: 201
        }]
    });

    assert.equal(installment.earningFrom, '2100-04-10');
    assert.equal(installment.earningTo, '2100-04-10');
    assert.equal(installment.scheduledPaymentDate, '2100-04-10');
    assert.deepEqual(installment.actualPaymentDates, ['2100-04-10']);
});

test('draft uses calculated amount, approved uses locked amount, and overpayment remains visible', () => {
    const draft = derivePayrollInstallmentAmounts({
        workflow_status: 'draft',
        calculated_amount: '750.25'
    });
    const approved = derivePayrollInstallmentAmounts({
        workflow_status: 'approved',
        calculated_amount: '750.25',
        locked_amount: 750,
        payment_total: 800
    });

    assert.equal(draft.effectiveDueAmount, 750.25);
    assert.equal(draft.balanceAmount, 750.25);
    assert.equal(approved.effectiveDueAmount, 750);
    assert.equal(approved.balanceAmount, -50);
    assert.equal(approved.outstandingAmount, 0);
    assert.equal(approved.overpaidAmount, 50);
    assert.equal(approved.settlementStatus, 'overpaid');
});

test('legacy paid report never claims a verified payment fact', () => {
    const model = buildPayrollSettlementReadModel({
        id: 42,
        period_month: '2026-07',
        status: 'paid',
        settlement_model: 'legacy_v1',
        finance_transaction_id: 17,
        committed_at: '2026-07-31T12:00:00.000Z',
        committed_by: 'legacy_director'
    });

    assert.equal(model.mode, 'legacy');
    assert.equal(model.totals, null);
    assert.equal(model.legacy.reportStatus, 'paid');
    assert.equal(model.legacy.financeTransactionId, 17);
    assert.equal(model.legacy.paymentFactVerified, false);
});

test('installment report is incomplete until both advance and final exist', () => {
    const report = {
        id: 7,
        period_month: '2026-07',
        settlement_model: 'installments_v1'
    };
    const advance = {
        installment_id: 71,
        report_id: 7,
        kind: 'advance',
        earning_from: '2026-07-01',
        earning_to: '2026-07-15',
        scheduled_payment_date: '2026-07-20',
        calculated_amount: '1000.00',
        locked_amount: 1000,
        workflow_status: 'approved',
        allocation_status: 'single',
        business_context: 'event_genix',
        payment_total: 600,
        reversal_total: 0
    };

    const incomplete = buildPayrollSettlementReadModel(report, [advance]);
    const complete = buildPayrollSettlementReadModel(report, [
        advance,
        {
            ...advance,
            installment_id: 72,
            kind: 'final',
            earning_from: '2026-07-16',
            earning_to: '2026-07-31',
            scheduled_payment_date: '2026-08-10',
            calculated_amount: 2000,
            locked_amount: 2000,
            payment_total: 0
        }
    ]);

    assert.equal(incomplete.mode, 'incomplete');
    assert.deepEqual(incomplete.warnings[0].missingKinds, ['final']);
    assert.equal(incomplete.totals.paidAmount, 600);
    assert.equal(incomplete.totals.balanceAmount, 400);
    assert.equal(complete.mode, 'installments');
    assert.equal(complete.totals.effectiveDueAmount, 3000);
    assert.equal(complete.totals.paidAmount, 600);
    assert.equal(complete.totals.balanceAmount, 2400);
});

test('month summary exposes mixed settlement ownership instead of silently switching', () => {
    const legacy = buildPayrollSettlementReadModel({
        id: 1,
        period_month: '2026-07',
        settlement_model: 'legacy_v1',
        status: 'paid'
    });
    const incomplete = buildPayrollSettlementReadModel({
        id: 2,
        period_month: '2026-07',
        settlement_model: 'installments_v1',
        status: 'draft'
    });
    const summary = summarizePayrollSettlementMonth('2026-07', [legacy, incomplete]);

    assert.equal(summary.mode, 'mixed');
    assert.equal(summary.totals, null);
    assert.equal(summary.totalsCoverage, 'unavailable');
    assert.ok(summary.warnings.some(warning => warning.code === 'PAYROLL_SETTLEMENT_MONTH_MIXED'));
    assert.ok(summary.warnings.some(warning => warning.code === 'PAYROLL_INSTALLMENTS_INCOMPLETE'));
});

test('month summary separates installment completeness from settlement ownership', () => {
    const incomplete = buildPayrollSettlementReadModel({
        id: 2,
        period_month: '2026-07',
        settlement_model: 'installments_v1'
    });
    const complete = buildPayrollSettlementReadModel({
        id: 3,
        period_month: '2026-07',
        settlement_model: 'installments_v1'
    }, [
        {
            installment_id: 31,
            report_id: 3,
            kind: 'advance',
            calculated_amount: 100,
            locked_amount: 100,
            workflow_status: 'approved'
        },
        {
            installment_id: 32,
            report_id: 3,
            kind: 'final',
            calculated_amount: 200,
            locked_amount: 200,
            workflow_status: 'approved'
        }
    ]);

    const summary = summarizePayrollSettlementMonth('2026-07', [incomplete, complete]);
    assert.equal(summary.mode, 'incomplete');
    assert.equal(summary.totalsCoverage, 'incomplete');
    assert.equal(summary.totals.lockedAmount, null);
    assert.ok(!summary.warnings.some(warning => warning.code === 'PAYROLL_SETTLEMENT_MONTH_MIXED'));
});

test('batch read model uses one query and keeps legacy and installment totals separate', async () => {
    let calls = 0;
    const summary = await loadPayrollSettlementReadModels('2026-07', {
        async query(sql, params) {
            calls += 1;
            assert.match(sql, /WITH report_installments AS/);
            assert.match(sql, /JOIN report_installments ri ON ri\.installment_id = ppm\.installment_id/);
            assert.match(sql, /SUM\(ppm\.amount\) FILTER \(WHERE ppm\.movement_type = 'payment'\)/);
            assert.deepEqual(params, ['2026-07']);
            return {
                rows: [
                    {
                        report_id: 1,
                        period_month: '2026-07',
                        report_status: 'paid',
                        settlement_model: 'legacy_v1',
                        finance_transaction_id: 9,
                        installment_id: null
                    },
                    {
                        report_id: 2,
                        period_month: '2026-07',
                        report_status: 'approved',
                        settlement_model: 'installments_v1',
                        installment_id: 21,
                        kind: 'advance',
                        earning_from: '2026-07-01',
                        earning_to: '2026-07-15',
                        scheduled_payment_date: '2026-07-20',
                        calculated_amount: 500,
                        locked_amount: 500,
                        workflow_status: 'approved',
                        allocation_status: 'single',
                        business_context: 'event_genix',
                        payment_total: 500,
                        reversal_total: 0
                    }
                ]
            };
        }
    });

    assert.equal(calls, 1);
    assert.equal(summary.mode, 'mixed');
    assert.equal(summary.totals, null);
    assert.equal(summary.reports[0].legacy.paymentFactVerified, false);
    assert.equal(summary.reports[1].totals.paidAmount, 500);
});

test('payroll month validation rejects invalid calendar months', () => {
    assert.equal(normalizePayrollMonth('2026-07'), '2026-07');
    assert.throws(() => normalizePayrollMonth('2026-13'), error => error.code === 'PAYROLL_MONTH_INVALID');
    assert.throws(() => normalizePayrollMonth('07-2026'), error => error.code === 'PAYROLL_MONTH_INVALID');
});
