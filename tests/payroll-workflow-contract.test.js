const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const hrRoute = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const payrollRoute = fs.readFileSync(path.join(ROOT, 'routes', 'payroll.js'), 'utf8');
const payrollService = fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8');
const payrollPeriodService = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollPeriod.js'), 'utf8');
const settlementService = fs.readFileSync(path.join(ROOT, 'services', 'payrollSettlement.js'), 'utf8');

const {
    calculateFinalInstallment
} = require('../services/payroll');
const {
    derivePayrollInstallmentAmounts
} = require('../services/payrollSettlement');

test('legacy HR salary commit is a fail-closed compatibility endpoint', () => {
    const commitBlock = hrRoute.match(/router\.post\('\/salary\/commit'[\s\S]*?\n\}\);/);
    assert.ok(commitBlock, 'salary commit route must exist');
    assert.match(commitBlock[0], /PAYROLL_LEGACY_COMMIT_DISABLED/);
    assert.match(commitBlock[0], /Historical payroll months are read-only/);
    assert.match(commitBlock[0], /financeChanged: false/);
    assert.doesNotMatch(commitBlock[0], /generatePayrollReports/);
    assert.doesNotMatch(commitBlock[0], /INSERT INTO finance_transactions/i);
    assert.doesNotMatch(commitBlock[0], /status\s*=\s*'paid'/i);
    assert.doesNotMatch(commitBlock[0], /setPayrollPeriodLock\(month,\s*true/i);
});

test('legacy HR salary reverse is disabled without Finance or entry deletion code', () => {
    const reverseBlock = hrRoute.match(/router\.post\('\/salary\/reverse'[\s\S]*?\n\}\);/);
    assert.ok(reverseBlock, 'salary reverse route must exist');
    assert.match(reverseBlock[0], /PAYROLL_LEGACY_REVERSE_DISABLED/);
    assert.doesNotMatch(reverseBlock[0], /INSERT INTO finance_transactions/i);
    assert.doesNotMatch(reverseBlock[0], /DELETE FROM payroll_entries/i);
    assert.doesNotMatch(reverseBlock[0], /await client\.query\('BEGIN'\)/);
});

test('payroll report PATCH cannot manually set paid or approve installment-owned reports', () => {
    assert.match(payrollRoute, /router\.patch\('\/report\/:id'/);
    assert.match(payrollService, /PAYROLL_REPORT_PAID_STATUS_MANUAL_BLOCKED/);
    assert.match(payrollService, /Payroll report paid status can only be derived from payment movements/);
    assert.match(payrollService, /PAYROLL_REPORT_INSTALLMENT_STATUS_MANUAL_BLOCKED/);
    assert.match(payrollService, /Installment payroll report status is derived from installment and movement transitions/);
});

test('calculate and approve workflow endpoints exist before Finance payment workflow', () => {
    assert.match(payrollRoute, /router\.post\('\/installments\/calculate'/);
    assert.match(payrollRoute, /router\.post\('\/installments\/:id\/approve'/);
    assert.match(hrRoute, /router\.post\('\/salary\/installments\/calculate'/);
    assert.match(hrRoute, /router\.post\('\/salary\/installments\/:id\/approve'/);
    assert.match(payrollRoute, /router\.post\('\/installments\/:id\/payments\/confirm'/);
    assert.match(payrollRoute, /router\.post\('\/payments\/:id\/reverse'/);
});

test('draft calculation writes installment settlement model and draft installments only', () => {
    assert.match(payrollService, /settlement_model = \$9/);
    assert.match(payrollService, /PAYROLL_SETTLEMENT_MODELS\.INSTALLMENTS/);
    assert.match(payrollService, /INSERT INTO payroll_installments/);
    assert.match(payrollService, /workflow_status = 'draft'/);
    assert.match(payrollService, /WHERE payroll_installments\.workflow_status = 'draft'/);
    assert.doesNotMatch(payrollService, /workflow_status = 'paid'/);
});

test('approval transition locks amount once and does not create Finance transaction', () => {
    assert.match(payrollService, /only draft payroll installments can be approved/);
    assert.match(payrollService, /locked_amount = ROUND\(calculated_amount\)::int/);
    assert.match(payrollService, /approved_by_user_id = \$2/);
    assert.match(payrollService, /business context is required to approve payroll installment/);
    const approveBlock = payrollService.match(/async function approvePayrollInstallment[\s\S]*?\n\}/);
    assert.ok(approveBlock);
    assert.doesNotMatch(approveBlock[0], /INSERT INTO finance_transactions/i);
    assert.doesNotMatch(approveBlock[0], /finance_transaction_id/i);
    assert.doesNotMatch(approveBlock[0], /setPayrollPeriodLock/i);
});

test('period close validates installment settlement instead of closing after advance approval', () => {
    assert.match(payrollPeriodService, /async function closePayrollPeriod/);
    assert.match(payrollPeriodService, /PAYROLL_INSTALLMENT_NOT_SETTLED/);
    assert.match(payrollPeriodService, /PAYROLL_OVERPAYMENT_UNRESOLVED/);
    assert.match(payrollPeriodService, /loadPayrollSettlementReadModels/);
    const periodLockBlock = hrRoute.match(/router\.post\('\/salary\/period-lock'[\s\S]*?\n\}\);/);
    assert.ok(periodLockBlock);
    assert.match(periodLockBlock[0], /closePayrollPeriod\(month, actor/);
});

test('derived settlement states include partial, paid, not_due, overpaid, reversed and overdue', () => {
    assert.equal(derivePayrollInstallmentAmounts({
        workflow_status: 'approved',
        locked_amount: 1000,
        payment_total: 300,
        reversal_total: 0,
        scheduled_payment_date: '2099-01-20',
        as_of_date: '2099-01-19'
    }).settlementStatus, 'partially_paid');
    assert.equal(derivePayrollInstallmentAmounts({
        workflow_status: 'approved',
        locked_amount: 1000,
        payment_total: 1000,
        reversal_total: 0
    }).settlementStatus, 'paid');
    assert.equal(derivePayrollInstallmentAmounts({
        workflow_status: 'approved',
        locked_amount: 0,
        payment_total: 0,
        reversal_total: 0
    }).settlementStatus, 'not_due');
    assert.equal(derivePayrollInstallmentAmounts({
        workflow_status: 'approved',
        locked_amount: 1000,
        payment_total: 1100,
        reversal_total: 0
    }).settlementStatus, 'overpaid');
    assert.equal(derivePayrollInstallmentAmounts({
        workflow_status: 'approved',
        locked_amount: 1000,
        payment_total: 1000,
        reversal_total: 1000
    }).settlementStatus, 'reversed');
    assert.equal(derivePayrollInstallmentAmounts({
        workflow_status: 'approved',
        locked_amount: 1000,
        payment_total: 0,
        reversal_total: 0,
        scheduled_payment_date: '2026-01-20',
        as_of_date: '2026-01-21'
    }).settlementStatus, 'overdue');
    assert.match(settlementService, /settlementStatus = 'overdue'/);
});

test('final installment exposes advance correction delta without rewriting locked advance', () => {
    const final = calculateFinalInstallment({
        monthlyPayroll: { summary: { net: 12000 } },
        advanceInstallment: {
            workflowStatus: 'approved',
            lockedAmount: 5000,
            paidAmount: 5000
        },
        currentAdvanceInstallment: {
            calculatedAmount: 5500
        }
    });
    assert.equal(final.amount, 7000);
    assert.equal(final.lockedAdvanceAmount, 5000);
    assert.equal(final.advanceCorrectionDeltaAmount, 500);
    assert.equal(final.corrections[0].type, 'advance_recalculation_delta');
});
