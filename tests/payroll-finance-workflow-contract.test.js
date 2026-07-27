'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const payrollRoute = fs.readFileSync(path.join(ROOT, 'routes', 'payroll.js'), 'utf8');
const financeRoute = fs.readFileSync(path.join(ROOT, 'routes', 'finance.js'), 'utf8');
const payrollService = fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8');
const payrollSettlementService = fs.readFileSync(path.join(ROOT, 'services', 'payrollSettlement.js'), 'utf8');
const payrollPeriodService = fs.readFileSync(path.join(ROOT, 'services', 'hrPayrollPeriod.js'), 'utf8');
const hrRoute = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const hrPage = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const hrHtml = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
const financePage = fs.readFileSync(path.join(ROOT, 'js', 'finance-page.js'), 'utf8');
const financeHtml = fs.readFileSync(path.join(ROOT, 'finance.html'), 'utf8');
const financeCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-finance.css'), 'utf8');
const migration304 = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '304_payroll_finance_movements_workflow.sql'), 'utf8');

function block(source, startNeedle) {
    const start = source.indexOf(startNeedle);
    assert.ok(start >= 0, `Missing source block: ${startNeedle}`);
    const next = source.indexOf('\nasync function ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

test('payroll payment endpoints are explicit and idempotency-key driven', () => {
    assert.match(payrollRoute, /router\.post\('\/installments\/:id\/payments\/confirm'/);
    assert.match(payrollRoute, /confirmPayrollInstallmentPayment\(req\.params\.id, req\.user/);
    assert.match(payrollRoute, /router\.post\('\/payments\/:id\/reverse'/);
    assert.match(payrollRoute, /reversePayrollPaymentMovement\(req\.params\.id, req\.user/);
    assert.match(payrollRoute, /req\.get\('Idempotency-Key'\)/);
    assert.match(payrollRoute, /financeChanged: !result\.idempotent/);
});

test('confirm payment is one DB transaction with row lock, Finance insert, and movement insert', () => {
    const confirmBlock = block(payrollService, 'async function confirmPayrollInstallmentPayment');
    assert.match(confirmBlock, /await client\.query\('BEGIN'\)/);
    assert.match(payrollService, /FOR UPDATE OF pi, pr/);
    assert.match(confirmBlock, /INSERT INTO finance_transactions/);
    assert.match(confirmBlock, /source, recognition_date, created_by/);
    assert.match(confirmBlock, /'payroll'/);
    assert.match(confirmBlock, /INSERT INTO payroll_payment_movements/);
    assert.match(confirmBlock, /movement_type, amount, actual_payment_date/);
    assert.match(confirmBlock, /await client\.query\('COMMIT'\)/);
    assert.match(confirmBlock, /await client\.query\('ROLLBACK'\)/);
    assert.match(confirmBlock, /PAYROLL_PAYMENT_EXCEEDS_BALANCE/);
});

test('payment workflow requires real account/category/method and blocks payroll-as-method', () => {
    assert.match(payrollService, /PAYROLL_FINANCE_CATEGORY_REQUIRED/);
    assert.match(payrollService, /PAYROLL_FINANCE_ACCOUNT_REQUIRED/);
    assert.match(payrollService, /PAYROLL_PAYMENT_METHOD_REQUIRED/);
    assert.match(payrollService, /PAYROLL_PAYMENT_METHOD_SOURCE_INVALID/);
    assert.match(payrollService, /method === 'salary' \|\| method === 'salary_reversal'/);
    assert.match(payrollService, /'payroll', \$11, \$12/);
    assert.match(payrollService, /PAYROLL_ALLOCATION_UNRESOLVED/);
    assert.match(payrollService, /PAYROLL_BUSINESS_CONTEXT_MISMATCH/);
});

test('reversal is append-only with its own income finance transaction and mandatory reason', () => {
    const reverseBlock = block(payrollService, 'async function reversePayrollPaymentMovement');
    assert.match(reverseBlock, /only payment movements can be reversed/);
    assert.match(reverseBlock, /PAYROLL_REVERSAL_REASON_REQUIRED/);
    assert.match(reverseBlock, /INSERT INTO finance_transactions/);
    assert.match(reverseBlock, /VALUES \(\$1, 'income'/);
    assert.match(reverseBlock, /INSERT INTO payroll_payment_movements/);
    assert.match(reverseBlock, /'reversal'/);
    assert.match(reverseBlock, /reverses_movement_id/);
    assert.match(reverseBlock, /PAYROLL_REVERSAL_DATE_BEFORE_PAYMENT/);
    assert.doesNotMatch(reverseBlock, /DELETE FROM payroll_payment_movements/i);
});

test('generic Finance PUT and DELETE return 409 for payroll-managed transactions', () => {
    assert.match(financeRoute, /async function assertFinanceTransactionNotPayrollManaged/);
    assert.match(financeRoute, /PAYROLL_PAYMENT_MANAGED/);
    assert.match(financeRoute, /LEFT JOIN payroll_payment_movements ppm ON ppm\.finance_transaction_id = ft\.id/);
    assert.match(financeRoute, /LEFT JOIN payroll_reports pr/);
    assert.match(financeRoute, /row\.payroll_movement_id \|\| row\.legacy_payroll_report_id \|\| row\.source === 'payroll'/);

    const putBlock = financeRoute.match(/router\.put\('\/transactions\/:id'[\s\S]*?router\.delete\('\/transactions\/:id'/)?.[0] || '';
    assert.match(putBlock, /assertFinanceTransactionNotPayrollManaged\(id, businessContext\)/);
    const deleteBlock = financeRoute.match(/router\.delete\('\/transactions\/:id'[\s\S]*?\/\/ ==========================================/)?.[0] || '';
    assert.match(deleteBlock, /assertFinanceTransactionNotPayrollManaged\(id, businessContext\)/);
});

test('P&L uses recognition date while cash-flow keeps actual transaction date', () => {
    assert.match(financeRoute, /function financeRecognitionDateSql/);
    assert.match(financeRoute, /EXTRACT\(MONTH FROM \$\{financeRecognitionDateSql\('finance_transactions'\)\}\)/);
    assert.match(financeRoute, /WHERE ft\.type = 'expense'\s+AND \$\{financeRecognitionDateSql\('ft'\)\} >= \$1::date/);
    assert.match(financeRoute, /SELECT DATE_TRUNC\('week', date::date\)::date AS week/);
    assert.match(payrollService, /COALESCE\(recognition_date, date::date\) >= \$1::date/);
    assert.doesNotMatch(payrollService, /COALESCE\(recognition_date, date\)::date/);
    assert.match(payrollService, /function payrollRecognitionDate\(row = \{\}\) \{\s*return normalizeDateValue\(row\.earning_to \|\| row\.earningTo\);/);
});

test('installment reconciliation is based on direct movement-finance links', () => {
    assert.match(payrollPeriodService, /async function loadPayrollInstallmentReconciliation/);
    assert.match(payrollPeriodService, /JOIN payroll_payment_movements ppm/);
    assert.match(payrollPeriodService, /LEFT JOIN finance_transactions ft ON ft\.id = m\.finance_transaction_id/);
    assert.match(payrollPeriodService, /orphan_payroll_finance/);
    assert.match(payrollPeriodService, /duplicate_finance/);
    assert.match(payrollPeriodService, /amount_mismatch/);
    assert.match(payrollPeriodService, /reversal_mismatch/);
    assert.match(payrollPeriodService, /finance_without_payroll_source/);
    assert.match(payrollPeriodService, /PAYROLL_FINANCE_AMOUNT_MISMATCH/);
    assert.match(payrollPeriodService, /PAYROLL_REVERSAL_MISMATCH/);
    assert.match(payrollPeriodService, /PAYROLL_FINANCE_SOURCE_MISSING/);
    assert.match(payrollPeriodService, /PAYROLL_INSTALLMENT_OUTSTANDING/);
    assert.match(payrollPeriodService, /PAYROLL_INSTALLMENT_OVERPAID/);
    assert.match(payrollPeriodService, /accrued_total/);
    assert.match(payrollPeriodService, /paid_total/);
    assert.match(payrollPeriodService, /reversed_total/);
    assert.match(payrollPeriodService, /balance_total/);
    assert.match(payrollPeriodService, /outstanding_installment_count/);
    assert.match(payrollPeriodService, /overpayment_count/);
    assert.match(payrollPeriodService, /mixed_settlement_model_count/);
});

test('salary read model and exports expose installment payment facts for HR and Finance UI', () => {
    assert.match(payrollSettlementService, /movement_rows AS \(/);
    assert.match(payrollSettlementService, /jsonb_agg\(jsonb_build_object/);
    assert.match(payrollSettlementService, /actualPaymentDates/);
    assert.match(payrollSettlementService, /financeTransactionIds/);
    assert.match(payrollSettlementService, /reversalFinanceTransactionIds/);

    assert.match(payrollService, /loadPayrollSettlementReadModels\(context\.month, db\)/);
    assert.match(payrollService, /paidAmount: hasVerifiedMovementTotals \? settlementTotals\.paidAmount : null/);
    assert.match(payrollService, /balanceAmount: hasVerifiedMovementTotals \? settlementTotals\.balanceAmount : null/);
    assert.match(payrollService, /overpaidAmount: hasVerifiedMovementTotals \? settlementTotals\.overpaidAmount : null/);
    assert.match(payrollService, /settlement\s*\n\s*};/);

    assert.match(hrRoute, /installments: row\.installments/);
    assert.match(hrRoute, /paid_amount: nullablePayrollAmount\(row\.paidAmount/);
    assert.match(hrRoute, /balance_amount: nullablePayrollAmount\(row\.balanceAmount/);

    assert.match(payrollRoute, /router\.get\('\/payment-options'/);
    assert.match(payrollRoute, /requireAction\('confirm_payroll_payment'\)/);
    assert.match(payrollRoute, /router\.patch\('\/installments\/:id\/schedule'/);
    assert.match(payrollRoute, /installment_kind/);
    assert.match(payrollRoute, /actual_payment_dates/);
    assert.match(payrollRoute, /finance_transaction_ids/);
    assert.match(payrollRoute, /reversal_transaction_ids/);
    assert.match(payrollRoute, /addWorksheet\('Payments'\)/);

    assert.match(hrPage, /renderSalaryInstallments/);
    assert.match(hrPage, /data-payroll-installment-action="confirm"/);
    assert.match(hrPage, /data-payroll-installment-action="reverse"/);
    assert.match(hrPage, /function payrollInstallmentBlockers/);
    assert.match(hrPage, /renderPayrollInstallmentBlockers\(installment\)/);
    assert.match(hrPage, /PAYROLL_LEAVE_POLICY_UNDEFINED/);
    assert.match(hrPage, /Погодження заблоковано без правила оплати/);
    assert.match(hrPage, /aria-disabled="true"/);
    assert.match(hrPage, /paid_amount/);
    assert.match(hrPage, /balance_amount/);
    assert.match(hrPage, /ЗРС/);

    assert.match(financePage, /renderFinancePayrollInstallments/);
    assert.match(financePage, /payrollApiRequest/);
    assert.match(financePage, /\/api\/payroll\/payment-options/);
    assert.match(financePage, /Idempotency-Key/);
    assert.match(financePage, /payrollRowPaidAmount/);
    assert.match(financePage, /payrollRowBalanceAmount/);
    assert.match(financePage, /function payrollDisplayDateTime/);
    assert.match(financePage, /function payrollInstallmentBlockers/);
    assert.match(financePage, /renderPayrollInstallmentBlockers\(installment\)/);
    assert.match(financePage, /PAYROLL_LEAVE_POLICY_UNDEFINED/);
    assert.match(financePage, /Погодження заблоковано без правила оплати/);
    assert.match(financePage, /aria-disabled="true"/);
    assert.match(financePage, /movement\.createdAt \|\| movement\.created_at/);
    assert.match(financePage, /payrollDisplayDateTime\(lastConfirmation\)/);
    assert.match(financePage, /SALARY_SCHEME_DISPLAY_LABELS/);
    assert.match(financePage, /piece: 'За одиницю'/);
    assert.match(financePage, /ЗРС/);
    assert.match(financeHtml, /css\/pages-finance\.css/);
    assert.match(financeCss, /\.salary-payroll-installment/);
    assert.match(financeCss, /\.salary-payroll-action/);
    assert.doesNotMatch(hrHtml, /<label>Аванс<\/label>\s*<input[^>]+id="editPayrollAdvanceLabel"/);
    assert.doesNotMatch(hrPage, /помилково доданий аванс/);
    assert.doesNotMatch(financePage, /утриманнях і авансах/);
});

test('Finance scheme builder displays canonical server results without duplicating payroll formulas', () => {
    assert.match(financePage, /function canonicalSalaryBuilderPreview\(\)/);
    assert.match(financePage, /Показано останній серверний розрахунок/);
    assert.doesNotMatch(financePage, /function calcSalaryDraftPreview\(\)/);
    assert.doesNotMatch(financePage, /function payrollSummaryFromLines\(lines\)/);
    assert.doesNotMatch(financePage, /cfg\.hourlyRate \* cfg\.hours/);
    assert.doesNotMatch(financePage, /cfg\.percentBase \* cfg\.percentRate \/ 100/);
});

test('migration 304 is additive and fail-closed for future payroll finance rows', () => {
    assert.match(migration304, /-- MIGRATION_KIND: schema/);
    assert.match(migration304, /ADD COLUMN IF NOT EXISTS recognition_date DATE/);
    assert.match(migration304, /source, 'manual'\) <> 'payroll'/);
    assert.match(migration304, /payment_method NOT IN \('salary', 'salary_reversal'\)/);
    assert.match(migration304, /recognition_date IS NOT NULL/);
    assert.match(migration304, /validate_payroll_movement_recognition_month_v304/);
    assert.match(migration304, /TO_CHAR\(finance_recognition_date, 'YYYY-MM'\) IS DISTINCT FROM earning_month/);
    assert.match(migration304, /NOT VALID/);
    assert.match(migration304, /BEFORE DELETE/);
    assert.match(migration304, /prevent_linked_payroll_finance_delete_v304/);
    assert.match(migration304, /FROM payroll_reports/);
    assert.match(migration304, /reversal_transaction_id = OLD\.id/);
});
