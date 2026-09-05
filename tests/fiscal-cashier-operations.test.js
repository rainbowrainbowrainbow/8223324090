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
const migration326 = read('db/migrations/328_cashier_pro_isolation_hardening.sql');
const migration345 = read('db/migrations/345_checkbox_service_receipt_recovery_stages.sql');
const routes = read('routes/payments.js');
const {
  applyPhase1CloseReadiness,
  resolvePhase1CloseAvailability
} = require('../services/payments/cashierOperationsService');

test('Phase-1 close is visible only to the exact owner and stays eligible when payment acceptance is disabled', () => {
  const user = { id: 4, role: 'creator', business_contexts: ['event_genix'] };
  const local = resolvePhase1CloseAvailability({
    user,
    binding: { capability_scope: ['payments.view', 'fiscal.shift.close'] },
    registerMetadata: { integration_owner: 4 },
    shift: { id: 9, status: 'open', lifecycle_stage: 'OPENED', provider_shift_id: 'provider-shift' },
    blockerCount: 0,
    checkboxIntegrationEnabled: true,
    registerFeatureEnabled: true,
    runtimeConfigResolvable: true
  });
  const ready = applyPhase1CloseReadiness(local, {
    checkboxIntegrationEnabled: true,
    paymentAcceptanceEnabled: false,
    providerReady: true,
    readinessCode: 'payment_acceptance_disabled',
    shiftState: 'open'
  });
  assert.deepEqual(ready, { visible: true, allowed: true, reasonCode: 'ready', shiftId: 9, status: 'OPENED' });
  assert.deepEqual(Object.keys(ready).sort(), ['allowed', 'reasonCode', 'shiftId', 'status', 'visible']);
  assert.deepEqual(applyPhase1CloseReadiness(local, {
    checkboxIntegrationEnabled: true,
    paymentAcceptanceEnabled: true,
    providerReady: true,
    readinessCode: 'ready',
    shiftState: 'open'
  }), {
    visible: true,
    allowed: false,
    reasonCode: 'phase1_close_requires_payment_drain',
    shiftId: 9,
    status: 'OPENED'
  });
  const otherUser = resolvePhase1CloseAvailability({
    user: { ...user, id: 3 },
    binding: { capability_scope: ['payments.view', 'fiscal.shift.close'] },
    registerMetadata: { integration_owner: 4 },
    shift: { id: 9, status: 'open', lifecycle_stage: 'OPENED', provider_shift_id: 'provider-shift' },
    checkboxIntegrationEnabled: true,
    registerFeatureEnabled: true,
    runtimeConfigResolvable: true
  });
  assert.equal(otherUser.visible, false);
  assert.equal(otherUser.allowed, false);
  assert.equal(otherUser.reasonCode, 'integration_owner_only');
});

test('pilot register state sanitizes shift provider identity and reports the just-closed local shift', () => {
  const body = service.slice(service.indexOf('async function loadPilotRegisterState'), service.indexOf('async function createServiceIn'));
  assert.match(body, /status IN \('opening', 'open', 'closing', 'closed'\)/);
  assert.match(body, /authorizationCrmProfileKey = null/);
  assert.match(body, /cashierBindingId = null/);
  assert.match(body, /authorizeFiscalActorAction\(client/);
  assert.match(body, /id = \$1[\s\S]*fiscal_profile_id = \$2[\s\S]*fiscal_register_id = \$3/);
  assert.match(body, /phase1Close/);
  assert.match(body, /candidate\.provider_cashier_login_ref = open_operation\.cashier_credential_ref/);
  assert.match(body, /binding: phase1CloseBinding/);
  assert.match(body, /runtimeConfigResolvable: phase1CloseRuntimeConfigResolvable/);
  assert.doesNotMatch(body, /providerShiftId:/);
  assert.doesNotMatch(body, /providerSnapshot:/);
});

test('auto-open shift is register-locked and linked to sale fiscal operations', () => {
  const autoOpen = service.slice(
    service.indexOf('async function ensureOpenShiftForSale'),
    service.indexOf('async function countPhase1CloseBlockers')
  );
  assert.match(service, /pg_advisory_xact_lock\(\$1, \$2\)/);
  assert.match(migration316, /uq_fiscal_shifts_one_open_register_v316[\s\S]*WHERE status IN \('opening', 'open', 'closing'\)/);
  assert.match(service, /operation_type, status,[\s\S]*'shift_open', 'pending'/);
  assert.match(service, /SET open_operation_id = \$2/);
  assert.match(paymentService, /ensureOpenShiftForSale\(client, \{ order, user, fiscalConfig \}\)/);
  assert.match(paymentService, /payment_order_id, fiscal_shift_id, operation_type/);
  assert.match(autoOpen, /assertCompleteFiscalCredentialRefs/);
  assert.match(autoOpen, /const routeScoped = Boolean/);
  assert.match(autoOpen, /authorizeFiscalActorAction\(client,[\s\S]*crmProfileKey: sourceBusinessContext/);
  assert.match(autoOpen, /loadFiscalCashierBinding\(client,[\s\S]*userId: order\.cashier_user_id \|\| user\?\.id,[\s\S]*bindingId: order\.selected_fiscal_cashier_binding_id \|\| null/);
  assert.match(autoOpen, /assertFiscalCashierBindingCapability\(binding, 'fiscal\.shift\.open'\)/);
  assert.ok(
    autoOpen.indexOf('loadFiscalCashierBinding(client') < autoOpen.indexOf('const existing = await loadOpenShift'),
    'the selected binding must be resolved before reusing an open shift'
  );
  assert.match(autoOpen, /open_shift_cashier_binding_mismatch/);
  assert.match(autoOpen, /open_cashier_credential_ref/);
  assert.match(autoOpen, /open_provider_cashier_id/);
  assert.match(autoOpen, /cashier_binding_id: Number\(binding\.id\)/);
  assert.ok(
    autoOpen.indexOf('assertCompleteFiscalCredentialRefs') < autoOpen.indexOf('INSERT INTO fiscal_shifts'),
    'missing cashier credentials must fail before creating shift or outbox state'
  );
  assert.doesNotMatch(autoOpen, /provider_cashier_login_ref\s*\|\|\s*order\.provider_license_ref/);
});

test('manual shift close blocks pending or unknown operations before approval or close mutation', () => {
  assert.match(service, /CLOSE_BLOCKER_STATUSES[\s\S]*'pending'[\s\S]*'unknown'[\s\S]*'blocked'/);
  assert.match(service, /shift\.close_blocked/);
  const closeBody = service.slice(service.indexOf('async function closeShift'), service.indexOf('async function autoCloseShift'));
  assert.match(closeBody, /const registerBlockerCount = await countPhase1CloseBlockers/);
  assert.match(closeBody, /if \(registerBlockerCount > 0\)/);
  assert.ok(closeBody.indexOf('return { blocked: true, checklist') < closeBody.indexOf("const { actualCash, actualTerminal, difference }"));
  assert.ok(closeBody.indexOf('await safePublishFiscalEvent(') < closeBody.indexOf('return { blocked: true, checklist'));
  assert.ok(closeBody.indexOf("eventType: 'shift_close_blocked'") < closeBody.indexOf('return { blocked: true, checklist'));
  assert.ok(closeBody.indexOf('if (result?.blocked)') > closeBody.indexOf('const result = await withTransaction'));
  assert.match(closeBody, /if \(result\?\.blocked\)[\s\S]*shift_close_blocked_pending_unknown/);
  assert.match(service, /operation_type, status,[\s\S]*'shift_close'/);
  assert.match(closeBody, /SET status = 'closing',[\s\S]*lifecycle_stage = 'CLOSING'/);
});

test('service in and service out require open shift and server PIN approval boundaries', () => {
  assert.match(service, /Готівку внесено — створити службове внесення/);
  assert.match(service, /service_in_amount_required/);
  assert.match(service, /service_out_reason_required/);
  assert.match(service, /assertOpenShift\(client, \{ fiscalProfileId, fiscalRegisterId \}\)/);
  assert.match(service, /fiscal\.service_out\.approve/);
  assert.match(approvals, /service_out_distinct_approver_required/);
  assert.match(approvals, /consumeFiscalApprovalInTransaction/);
  assert.match(service, /pin_failed_attempts/);
  assert.doesNotMatch(service, /persistApprovalPinFailureDurably/);
  assert.match(service, /FOR UPDATE/);
  assert.doesNotMatch(service, /body\.approval/);
});

test('service-out and refund evaluate and persist PIN state while holding the cashier binding row lock', () => {
  const serviceOutApproval = service.slice(
    service.indexOf('async function approveServiceOut'),
    service.indexOf('async function persistApprovalPinResult')
  );
  const refundApproval = service.slice(
    service.indexOf('async function createFullRefund'),
    service.indexOf('async function enrollFiscalActionPin')
  );

  assert.match(serviceOutApproval, /loadFiscalCashierBinding\(client,[\s\S]*forUpdate: true[\s\S]*approveFiscalAction/);
  assert.match(serviceOutApproval, /if \(!approvalResult\.ok\)[\s\S]*persistApprovalPinResult\(client,[\s\S]*return \{ pinFailureCode: approvalResult\.code \}/);
  assert.match(serviceOutApproval, /if \(transactionResult\.pinFailureCode\)[\s\S]*throw new FiscalApprovalError/);
  assert.match(refundApproval, /assertOpenShift\(client,[\s\S]*loadFiscalCashierBinding\(client,[\s\S]*forUpdate: true/);
  assert.match(refundApproval, /SAVEPOINT fiscal_refund_before_mutation/);
  assert.match(refundApproval, /ROLLBACK TO SAVEPOINT fiscal_refund_before_mutation[\s\S]*persistApprovalPinResult\(client,[\s\S]*return \{ pinFailureCode: approvalResult\.code \}/);
});

test('reconciliation and non-zero close preserve failed PIN state while rolling back approval drafts', () => {
  const reconciliation = service.slice(
    service.indexOf('async function createReconciliationRevision'),
    service.indexOf('async function closeShift')
  );
  const close = service.slice(
    service.indexOf('async function closeShift'),
    service.indexOf('async function autoCloseShift')
  );

  assert.match(reconciliation, /loadShiftForUserAction\(client,[\s\S]*loadFiscalCashierBinding\(client,[\s\S]*forUpdate: true/);
  assert.match(reconciliation, /SAVEPOINT fiscal_reconciliation_before_approval/);
  assert.match(reconciliation, /ROLLBACK TO SAVEPOINT fiscal_reconciliation_before_approval[\s\S]*persistApprovalPinResult\(client,[\s\S]*return \{ pinFailureCode: approvalResult\.code \}/);
  assert.match(reconciliation, /if \(transactionResult\.pinFailureCode\)[\s\S]*throw new FiscalApprovalError/);
  assert.match(close, /loadShiftForUserAction\(client,[\s\S]*loadFiscalCashierBinding\(client,[\s\S]*forUpdate: true/);
  assert.match(close, /SAVEPOINT fiscal_shift_close_before_approval/);
  assert.match(close, /ROLLBACK TO SAVEPOINT fiscal_shift_close_before_approval[\s\S]*persistApprovalPinResult\(client,[\s\S]*return \{ pinFailureCode: approvalResult\.code \}/);
  assert.ok(close.indexOf('if (result?.pinFailureCode)') < close.indexOf('if (result?.blocked)'));
});

test('every provider-mutating Cashier PRO operation is created with a complete immutable provider snapshot', () => {
  const providerConfig = service.slice(
    service.indexOf('async function loadImmutableProviderConfiguration'),
    service.indexOf('async function ensureOpenShiftForSale')
  );
  assert.match(providerConfig, /isCheckboxIntegrationEnabled\(env\)/);
  assert.match(providerConfig, /FOR SHARE OF fp, fl, fr, binding/);
  assert.match(providerConfig, /provider_organization_id/);
  assert.match(providerConfig, /provider_register_id/);
  assert.match(providerConfig, /provider_cashier_id/);
  assert.match(providerConfig, /register_credential_ref/);
  assert.match(providerConfig, /cashier_credential_ref/);
  assert.match(providerConfig, /checkbox_expected_is_test_mismatch/);
  assert.match(providerConfig, /buildFiscalConfigurationSnapshot/);

  for (const [start, end] of [
    ['async function createServiceIn', 'async function createServiceOutRequest'],
    ['async function createServiceOutRequest', 'async function approveServiceOut'],
    ['async function closeShift', 'async function autoCloseShift'],
    ['async function createFullRefund', 'async function enrollFiscalActionPin']
  ]) {
    const body = service.slice(service.indexOf(start), service.indexOf(end));
    assert.match(body, /loadImmutableProviderConfiguration/);
    assert.match(body, /provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id/);
    assert.match(body, /register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash/);
    assert.match(body, /fiscal_location_id, external_stage/);
    assert.match(body, /fiscal_configuration_hash: fiscalConfig\.hash/);
    assert.match(body, /provider_context: fiscalConfig\.snapshot/);
  }
});

test('service-out approval consumes approval with CAS and never mutates its sealed provider UUID or request snapshot', () => {
  const request = service.slice(service.indexOf('async function createServiceOutRequest'), service.indexOf('async function approveServiceOut'));
  const approval = service.slice(service.indexOf('async function approveServiceOut'), service.indexOf('async function persistApprovalPinResult'));
  assert.match(request, /const providerRequestUuid = crypto\.randomUUID\(\)/);
  assert.match(request, /provider_operation_id/);
  assert.match(request, /provider_request_uuid: providerRequestUuid/);
  assert.match(approval, /const providerRequestUuid = String\(operation\.provider_operation_id/);
  assert.doesNotMatch(approval, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(approval, /SET status = 'pending',[\s\S]*?provider_operation_id\s*=\s*\$2,/);
  assert.doesNotMatch(approval, /request_snapshot\s*=\s*request_snapshot/);
  assert.match(approval, /AND status = 'blocked'/);
  assert.match(approval, /AND server_approval_status = 'required'/);
  assert.match(approval, /AND approval_id IS NULL/);
  assert.match(approval, /AND provider_operation_id = \$4/);
  assert.match(approval, /RETURNING id/);
  assert.match(approval, /service_out_approval_conflict/);
});

test('refund MVP is full-only, split status, linked to original receipt, and original receipt is immutable', () => {
  assert.match(migration319, /refund_type VARCHAR\(32\) NOT NULL DEFAULT 'full'/);
  assert.match(migration319, /money_refund_status VARCHAR\(40\)/);
  assert.match(migration319, /fiscal_refund_status VARCHAR\(40\)/);
  assert.match(service, /original_fiscal_receipt_id/);
  assert.match(service, /'return', 'blocked', TRUE, 'required'/);
  assert.match(service, /terminal_refund_reference/);
  assert.match(service, /terminal_refund_confirmation_required/);
  assert.doesNotMatch(service, /UPDATE\s+fiscal_receipts/i);
  assert.match(worker, /fiscal_refund_status = 'returned'/);
  assert.match(migration326, /uq_payment_refunds_one_full_return_per_original_v326/);
  assert.match(migration326, /uq_fiscal_operations_one_return_per_refund_v326/);
});

test('reconciliation revisions are append-only and non-zero difference is PIN approved', () => {
  assert.match(migration319, /CREATE TABLE IF NOT EXISTS fiscal_reconciliation_revisions/);
  assert.match(migration319, /revision_number INTEGER NOT NULL/);
  assert.match(migration319, /difference_minor = 0 OR/);
  assert.match(service, /fiscal_operation:reconciliation_difference/);
  assert.match(service, /reconciliation\.difference/);
});

test('reconciliation adds actual totals as bigint values before computing the difference', () => {
  const nullableAmountSource = service.slice(
    service.indexOf('function nullableAmountMinor'),
    service.indexOf('function normalizeBoolean')
  );
  const computeDifferenceSource = service.slice(
    service.indexOf('function computeDifference'),
    service.indexOf('async function createReconciliationRevision')
  );
  const computeDifference = Function(
    'toPostgresBigint',
    'CashierOperationsError',
    `'use strict';\n${nullableAmountSource}\n${computeDifferenceSource}\nreturn computeDifference;`
  )(
    value => BigInt(value).toString(),
    class CashierOperationsError extends Error {}
  );

  const result = computeDifference({
    checklist: { cashExpectedMinor: '125', terminalExpectedMinor: '75' },
    body: { cashActualMinor: '140', terminalReportTotalMinor: '80' }
  });

  assert.deepEqual(result, {
    actualCash: 140n,
    actualTerminal: 80n,
    difference: 20n
  });
});

test('worker publishes structured fiscal events without rolling back status on EventBus or Hermes failure', async () => {
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
  const safePublish = service.slice(
    service.indexOf('async function safePublishFiscalEvent'),
    service.indexOf('function sanitizeOperatorReference')
  );
  const reconciliation = service.slice(
    service.indexOf('async function createReconciliationRevision'),
    service.indexOf('async function closeShift')
  );
  const close = service.slice(
    service.indexOf('async function closeShift'),
    service.indexOf('async function autoCloseShift')
  );
  assert.match(safePublish, /SAVEPOINT \$\{savepoint\}/);
  assert.match(safePublish, /ROLLBACK TO SAVEPOINT \$\{savepoint\}/);
  assert.match(safePublish, /RELEASE SAVEPOINT \$\{savepoint\}/);
  assert.match(reconciliation, /await safePublishFiscalEvent\([\s\S]*'reconciliation\.difference'/);
  assert.doesNotMatch(reconciliation, /await publishInTransaction\(/);
  assert.match(close, /await safePublishFiscalEvent\([\s\S]*'shift\.close_blocked'/);
  assert.doesNotMatch(close, /await publishInTransaction\(/);

  const safePublishFiscalEvent = Function(
    'publishInTransaction',
    `'use strict';\n${safePublish}\nreturn safePublishFiscalEvent;`
  )(async () => {});
  const queries = [];
  await safePublishFiscalEvent(
    { query: async sql => queries.push(sql) },
    'reconciliation.difference',
    {},
    'fiscal_reconciliation_revision',
    '12',
    'reconciliation-difference:12',
    async () => { throw new Error('hermes unavailable'); }
  );
  assert.deepEqual(queries, [
    'SAVEPOINT cashier_operations_event_publish',
    'ROLLBACK TO SAVEPOINT cashier_operations_event_publish',
    'RELEASE SAVEPOINT cashier_operations_event_publish'
  ]);
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
  assert.match(migration326, /fk_fiscal_cashier_bindings_register_profile_location_v326/);
  assert.ok((service.match(/fiscal_profile_id = \$1|fiscal_profile_id = \$2|fiscalProfileId/g) || []).length >= 20);
});

test('PIN enrollment is a configure-only server flow and never stores raw PIN in responses', () => {
  assert.match(routes, /\/fiscal-bindings\/:bindingId\/action-pin/);
  assert.match(routes, /requireAction\('fiscal\.configure'\)/);
  assert.match(service, /async function enrollFiscalActionPin/);
  assert.match(service, /action_pin_self_enrollment_denied/);
  assert.match(service, /createActionPinHash\(rawPin\)/);
  assert.match(service, /action_pin_hash = \$2/);
  assert.doesNotMatch(service, /pinEnrolled:[\s\S]*rawPin/);
});

test('worker keeps Cashier PRO jobs disabled unless PRO flag is explicitly enabled', () => {
  assert.match(worker, /CASHIER_PRO_JOB_TYPES = new Set\(\['receipt_return', 'service_receipt'\]\)/);
  assert.match(worker, /const claimableJobTypes = cashierProEnabled/);
  assert.match(worker, /claimableJobTypes,/);
  assert.match(worker, /job\.payload->>'phase' = 'thin_mvp_shift_close'/);
});

test('outbox shift jobs resolve only the immutable shift-operation cashier identity', () => {
  const shiftJoinGuards = worker.match(/job\.job_type NOT IN \('shift_open', 'shift_close'\)/g) || [];
  assert.equal(shiftJoinGuards.length, 2, 'both claim and reload queries must exclude shifts from legacy actor fallback');
  assert.equal(
    (worker.match(/job\.job_type IN \('shift_open', 'shift_close'\)[\s\S]{0,180}fcb\.provider_cashier_id IS NOT DISTINCT FROM fo\.provider_cashier_id/g) || []).length,
    2
  );
});

test('service and return receipt durable submit/lookup stages are constrained in both ledger tables', () => {
  assert.match(migration345, /chk_payment_outbox_jobs_stage_v345/);
  assert.match(migration345, /chk_fiscal_operations_stage_v345/);
  assert.equal((migration345.match(/'service_submit'/g) || []).length, 2);
  assert.equal((migration345.match(/'service_lookup'/g) || []).length, 2);
  assert.equal((migration345.match(/'return_submit'/g) || []).length, 2);
  assert.equal((migration345.match(/'return_lookup'/g) || []).length, 2);
  assert.match(worker, /SERVICE_POST_SUBMIT_STAGES = new Set\(\['service_submit', 'service_lookup', 'complete'\]\)/);
  assert.match(worker, /RETURN_POST_SUBMIT_STAGES = new Set\(\['return_submit', 'return_lookup', 'complete'\]\)/);
  assert.match(worker, /createExternalMutationBoundary\(context, 'service_submit'\)/);
  assert.match(worker, /createExternalMutationBoundary\(context, 'return_submit'\)/);
  assert.match(worker, /service_receipt_lookup_pending/);
  assert.match(worker, /return_lookup_required_before_retry/);
});
