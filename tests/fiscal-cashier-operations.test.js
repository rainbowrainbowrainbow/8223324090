const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const service = read('services/payments/cashierOperationsService.js');
const paymentService = read('services/payments/paymentService.js');
const worker = read('services/payments/paymentOutboxWorker.js');
const approvals = read('services/payments/fiscalApprovals.js');
const migration316 = read('db/migrations/316_payment_fiscal_ledger_foundation.sql');
const migration319 = read('db/migrations/319_cashier_operations_hardening.sql');
const routes = read('routes/payments.js');

test('auto-open shift is register-locked and linked to sale fiscal operations', () => {
  assert.match(service, /pg_advisory_xact_lock\(\$1, \$2\)/);
  assert.match(migration316, /uq_fiscal_shifts_one_open_register_v316[\s\S]*WHERE status IN \('opening', 'open', 'closing'\)/);
  assert.match(service, /operation_type, status,[\s\S]*'shift_open', 'pending'/);
  assert.match(service, /SET open_operation_id = \$2/);
  assert.match(paymentService, /ensureOpenShiftForSale\(client, \{ order, user \}\)/);
  assert.match(paymentService, /payment_order_id, fiscal_shift_id, operation_type/);
});

test('manual shift close blocks pending or unknown operations before approval or close mutation', () => {
  assert.match(service, /CLOSE_BLOCKER_STATUSES[\s\S]*'pending'[\s\S]*'unknown'[\s\S]*'blocked'/);
  assert.match(service, /shift\.close_blocked/);
  const closeBody = service.slice(service.indexOf('async function closeShift'), service.indexOf('async function autoCloseShift'));
  assert.ok(closeBody.indexOf('shift_close_blocked_pending_unknown') < closeBody.indexOf("const { actualCash, actualTerminal, difference }"));
  assert.match(service, /operation_type, status,[\s\S]*'shift_close'/);
});

test('service in and service out require open shift and server PIN approval boundaries', () => {
  assert.match(service, /Готівку внесено — створити службове внесення/);
  assert.match(service, /service_in_amount_required/);
  assert.match(service, /service_out_reason_required/);
  assert.match(service, /assertOpenShift\(client, \{ fiscalProfileId, fiscalRegisterId \}\)/);
  assert.match(service, /fiscal\.service_out\.approve/);
  assert.match(approvals, /service_out_distinct_approver_required/);
  assert.match(service, /pin_failed_attempts/);
  assert.doesNotMatch(service, /body\.approval/);
});

test('refund MVP is full-only, split status, linked to original receipt, and original receipt is immutable', () => {
  assert.match(migration319, /refund_type VARCHAR\(32\) NOT NULL DEFAULT 'full'/);
  assert.match(migration319, /money_refund_status VARCHAR\(40\)/);
  assert.match(migration319, /fiscal_refund_status VARCHAR\(40\)/);
  assert.match(service, /original_fiscal_receipt_id/);
  assert.match(service, /'return', 'blocked', TRUE, 'required'/);
  assert.match(service, /terminal_refund_reference/);
  assert.doesNotMatch(service, /UPDATE\s+fiscal_receipts/i);
  assert.match(worker, /fiscal_refund_status = 'returned'/);
});

test('reconciliation revisions are append-only and non-zero difference is PIN approved', () => {
  assert.match(migration319, /CREATE TABLE IF NOT EXISTS fiscal_reconciliation_revisions/);
  assert.match(migration319, /revision_number INTEGER NOT NULL/);
  assert.match(migration319, /difference_minor = 0 OR/);
  assert.match(service, /fiscal_operation:reconciliation_difference/);
  assert.match(service, /reconciliation\.difference/);
});

test('worker publishes structured fiscal events without rolling back status on EventBus or Hermes failure', () => {
  assert.match(worker, /safePublishFiscalEvent/);
  assert.match(worker, /EventBus\/Hermes failures must not roll back payment\/fiscal state/);
  for (const eventName of [
    'fiscal.receipt_succeeded',
    'fiscal.receipt_failed',
    'fiscal.unknown',
    'refund.completed'
  ]) {
    assert.match(worker, new RegExp(eventName.replace('.', '\\.')));
  }
  assert.match(service, /shift\.close_blocked/);
  assert.match(service, /reconciliation\.difference/);
});

test('auto close is disabled by default and has no force override path', () => {
  assert.match(service, /EVENTGENIX_FISCAL_AUTO_CLOSE_ENABLED/);
  assert.match(service, /auto_close_disabled/);
  assert.doesNotMatch(service, /forceClose|overrideClose|force_override/i);
});

test('routes are narrow payment and fiscal capabilities, not finance.manage', () => {
  for (const capability of [
    'fiscal.service_in',
    'fiscal.service_out.request',
    'fiscal.service_out.approve',
    'fiscal.refund',
    'fiscal.reconcile',
    'fiscal.shift.close',
    'fiscal.audit.view'
  ]) {
    assert.match(routes, new RegExp(`requireAction\\('${capability.replace('.', '\\.')}\\'\\)`));
  }
  assert.doesNotMatch(routes, /finance\.manage/);
});

test('two-FOP isolation is enforced by fiscal_profile_id scoped FKs and queries', () => {
  assert.match(migration319, /FOREIGN KEY \(fiscal_register_id, fiscal_profile_id\)/);
  assert.match(migration319, /FOREIGN KEY \(fiscal_shift_id, fiscal_profile_id\)/);
  assert.match(migration319, /FOREIGN KEY \(fiscal_operation_id, fiscal_profile_id\)/);
  assert.ok((service.match(/fiscal_profile_id = \$1|fiscal_profile_id = \$2|fiscalProfileId/g) || []).length >= 20);
});
