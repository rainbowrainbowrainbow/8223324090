'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('migration 326 adds sanitized Checkbox readiness snapshots and operational incidents', () => {
    const sql = read('db/migrations/326_checkbox_readiness_and_phase1_close.sql');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS checkbox_readiness_snapshots/);
    for (const column of [
        'local_mapping_ready',
        'runtime_secrets_resolvable',
        'provider_identity_verified',
        'register_active',
        'cashier_ready',
        'signature_certificate_ready',
        'tax_mapping_ready',
        'provider_unavailable',
        'stale_readiness',
        'shift_state',
        'expires_at'
    ]) {
        assert.match(sql, new RegExp(`\\b${column}\\b`), `${column} must be persisted`);
    }
    assert.match(sql, /CREATE TABLE IF NOT EXISTS fiscal_operational_incidents/);
    for (const forbiddenColumn of ['login', 'password', 'access_key', 'license_key', 'token', 'pin_hash', 'raw_secret']) {
        assert.doesNotMatch(sql, new RegExp(`\\b${forbiddenColumn}\\b`, 'i'), `readiness migration must not store ${forbiddenColumn}`);
    }
});

test('payment create and confirm use the server-side provider readiness gate', () => {
    const service = read('services/payments/paymentService.js');
    assert.match(service, /const \{ PaymentReadinessError, assertPaymentReadiness \} = require\('\.\/paymentReadinessService'\)/);
    assert.match(service, /await assertPaymentReadiness\(\{\s*client,\s*user,\s*fiscalProfileId: mapping\.fiscal_profile_id,[\s\S]*?action: 'payments\.create'/);
    assert.match(service, /await assertPaymentReadiness\(\{\s*client,\s*user,\s*fiscalProfileId: order\.fiscal_profile_id,[\s\S]*?action: 'payments\.confirm_received'/);
    assert.match(service, /error instanceof PaymentReadinessError/);
});

test('payment readiness service keeps provider HTTP outside DB transactions and blocks stale states', () => {
    const service = read('services/payments/paymentReadinessService.js');
    assert.match(service, /async function prepareReadinessScope/);
    assert.match(service, /result = await probeProvider\(scope, \{ fetchImpl, now \}\)/);
    assert.match(service, /readiness_stale/);
    assert.match(service, /provider_unavailable/);
    assert.match(service, /shift_opening/);
    assert.match(service, /\['OPENING', 'CREATED'\]\.includes\(current\.status\)/);
    assert.match(service, /verifyReadiness\(expected, \{ expectedTaxIds: scope\.tax\?\.providerTaxIds \|\| \[\] \}\)/);
    assert.match(service, /checkbox_expected_is_test_mismatch/);
    assert.match(service, /fiscal_context_incomplete/);
    assert.match(service, /tax_mode = 'untaxed'/);
    assert.match(service, /tax_mode = 'taxed'/);
    assert.match(service, /deriveIntegrationReady/);
    assert.match(service, /syncPortalClosedShift/);
    assert.match(service, /READINESS_PROBE_IN_FLIGHT/);
    assert.match(service, /serializedLatest && serializedLatest\.staleReadiness !== true/);
    assert.match(service, /force = false/);
});

test('Checkbox provider readiness uses official read-only endpoints before payments', () => {
    const client = read('services/checkbox/client.js');
    const provider = read('services/checkbox/provider.js');
    assert.match(client, /getCashRegisterInfo\(\)[\s\S]*\/api\/v1\/cash-registers\/info/);
    assert.match(client, /checkSignature\(\)[\s\S]*\/api\/v1\/cashier\/check-signature/);
    assert.match(client, /getCashierTaxes\(\)[\s\S]*\/api\/v1\/cashier\/tax/);
    assert.match(provider, /validateCashierPermissions/);
    assert.match(provider, /validateSignatureStatus/);
    assert.match(provider, /validateCashRegisterInfo/);
    assert.match(provider, /validateProviderTaxes/);
    const verifyBlock = provider.slice(provider.indexOf('async verifyReadiness'), provider.indexOf('async loadDetailedShift'));
    assert.doesNotMatch(verifyBlock, /createSaleReceipt|openShift|closeShift/);
});

test('routes expose thin readiness, unresolved, health, incidents, and Phase-1 close without Cashier PRO', () => {
    const routes = read('routes/payments.js');
    assert.match(routes, /router\.post\('\/readiness\/probe', requireAction\('payments\.view'\)/);
    assert.match(routes, /router\.get\('\/unresolved-orders', requireAction\('payments\.view'\)/);
    assert.match(routes, /router\.get\('\/checkbox-sales-report', requireAction\('payments\.view'\)/);
    assert.match(routes, /router\.get\('\/operational-health', requireAction\('fiscal\.audit\.view'\)/);
    assert.match(routes, /router\.get\('\/incidents', requireAction\('fiscal\.audit\.view'\)/);
    assert.match(routes, /router\.post\('\/incidents\/:incidentId\/acknowledge', requireAction\('fiscal\.incident\.manage'\)/);
    assert.match(routes, /router\.post\('\/incidents\/:incidentId\/resolve', requireAction\('fiscal\.incident\.manage'\)/);
    assert.match(routes, /router\.post\('\/shifts\/:shiftId\/phase1-close', requireAction\('fiscal\.shift\.close'\)/);
    assert.doesNotMatch(
        routes.slice(routes.indexOf("router.post('/shifts/:shiftId/phase1-close'"), routes.indexOf("router.post('/service-in'")),
        /requireCashierProEnabled/,
        'Phase-1 close must not require Cashier PRO'
    );
});

test('worker treats failed payment jobs as incidents and allows only thin MVP shift close when PRO is disabled', () => {
    const worker = read('services/payments/paymentOutboxWorker.js');
    const client = read('services/checkbox/client.js');
    const provider = read('services/checkbox/provider.js');
    const recovery = read('scripts/checkbox-outbox-recovery.js');
    assert.match(worker, /fiscal_operational_incidents/);
    assert.match(worker, /payment_outbox_degraded/);
    assert.match(worker, /job\.payload->>'phase' = 'thin_mvp_shift_close'/);
    assert.match(worker, /CASHIER_PRO_JOB_TYPES = new Set\(\['receipt_return', 'service_receipt'\]\)/);
    assert.match(worker, /getCurrentShiftStatus/);
    assert.match(worker, /COALESCE\(job\.heartbeat_at, job\.locked_at\)/);
    assert.match(worker, /shift_request_maybe_submitted/);
    assert.match(worker, /NOT EXISTS \(\s*SELECT 1\s*FROM payment_outbox_jobs active_job/);
    assert.match(worker, /while \(results\.length < maxJobs\)/);
    assert.match(worker, /recordStage\?\.\('shift_lookup'\)/);
    assert.match(worker, /recordStage\?\.\('receipt_lookup'\)/);
    assert.match(worker, /checkbox_shift_open_pending/);
    assert.match(worker, /checkbox_shift_close_pending/);
    assert.match(provider, /checkbox_shift_explicit_sync_required/);
    assert.match(provider, /expectedShiftId: expected\.expectedShiftId \|\| expected\.providerOperationId/);
    assert.match(client, /async closeShift\(\)[\s\S]*body: \{\}/);
    assert.match(recovery, /PRE_SELL_STAGES = new Set\(\['auth', 'readiness', 'shift_request', 'shift_request_maybe_submitted', 'shift_lookup', 'receipt_validation'\]\)/);
    assert.match(recovery, /Date\.parse\(row\.heartbeat_at \|\| row\.locked_at\)/);
    assert.match(recovery, /targetStage: stage \|\| 'auth'/);
    assert.doesNotMatch(recovery, /request_snapshot = COALESCE\(request_snapshot/);
    assert.match(recovery, /max_attempts = CASE WHEN status = 'dead' THEN max_attempts \+ 1 ELSE max_attempts END/);
});

test('scheduler surface documents readiness probe and degraded outbox wrapper', () => {
    const server = read('server.js');
    const surface = read('config/schedulerSurface.js');
    const docs = read('docs/SCHEDULER_SURFACE.md');
    assert.match(server, /runCheckboxReadinessProbeScheduler/);
    assert.match(server, /processPaymentOutboxJobsBase\(\{ throwOnDegraded: true \}\)/);
    assert.match(server, /processPaymentOutboxJobs', processPaymentOutboxJobs, \{ dedup: null, autoPause: false \}/);
    assert.match(surface, /runCheckboxReadinessProbeScheduler/);
    assert.match(surface, /tests\/payment-readiness\.test\.js/);
    assert.match(docs, /runCheckboxReadinessProbeScheduler/);
});

test('permission registry covers readiness, unresolved queue, incidents, and Phase-1 close APIs', () => {
    const registry = read('config/permissionRegistry.js');
    for (const route of [
        '/api/payments/pilot-register-state',
        '/api/payments/readiness/probe',
        '/api/payments/unresolved-orders',
        '/api/payments/checkbox-sales-report',
        '/api/payments/orders/:orderId/cancel',
        '/api/payments/operational-health',
        '/api/payments/incidents',
        '/api/payments/incidents/:incidentId/acknowledge',
        '/api/payments/incidents/:incidentId/resolve',
        '/api/payments/shifts/:shiftId/phase1-close'
    ]) {
        assert.match(registry, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${route} must be registered`);
    }
    assert.match(registry, /key: 'fiscal\.incident\.manage'/);
    assert.match(registry, /defaultRoles: \['creator', 'director'\]/);
    assert.doesNotMatch(registry.slice(registry.indexOf("key: 'fiscal.incident.manage'"), registry.indexOf("key: 'fiscal.configure'")), /art_director|cashier/);
});

test('Checkbox regression gates are wired into CI and local scripts', () => {
    const packageJson = JSON.parse(read('package.json'));
    const ci = read('.github/workflows/ci.yml');
    const runner = read('scripts/run-isolated-postgres-tests.js');
    assert.equal(packageJson.scripts['check:checkbox-openapi'], 'node scripts/check-checkbox-openapi-compatibility.js');
    assert.equal(packageJson.scripts['check:checkbox-safety'], 'node scripts/check-checkbox-source-safety.js');
    assert.match(ci, /npm run check:checkbox-openapi/);
    assert.match(ci, /npm run check:checkbox-safety/);
    assert.match(ci, /npm run test:integration:checkbox-park-config:isolated/);
    assert.match(ci, /npm run test:integration:checkbox-park-cashier-smoke:isolated/);
    assert.match(ci, /npm run test:integration:checkbox-ui-real:isolated/);
    assert.match(runner, /checkbox-ui-real/);
});

test('Checkbox operations docs contain activation, rollback, and source-of-truth guardrails', () => {
    const status = read('docs/integrations/checkbox/IMPLEMENTATION_STATUS.md');
    const contract = read('docs/integrations/checkbox/PILOT_CONTRACT.md');
    const envTemplate = read('docs/integrations/checkbox/ACTIVATION_ENV_TEMPLATE.md');
    const runbook = read('docs/integrations/checkbox/OPERATIONS_RUNBOOK.md');
    const currentVersion = JSON.parse(read('package.json')).version;
    assert.match(status, new RegExp(currentVersion.replaceAll('.', '\\.')));
    assert.match(status, /not any long-lived `\.codex-temp` worktree/i);
    assert.match(status, /migrations `316` through `331`/);
    assert.match(contract, /not from stale chat history, stale docs, or a dirty `\.codex-temp` branch/);
    assert.match(envTemplate, /CHECKBOX_WEBHOOK_SIGNING_SECRET=/);
    assert.match(runbook, /Stop new payments/);
    assert.match(runbook, /Drain already-paid queue|Drain already-paid/i);
    assert.match(runbook, /lookup-only recovery/);
    assert.match(runbook, /Full emergency stop/);
});

test('cashier UI fails closed when unresolved queue is unavailable and refreshes readiness without reload', () => {
    const html = read('cashier-payments.html');
    const js = read('js/cashier-payments-page.js');
    assert.match(html, /id="refreshReadinessBtn"/);
    assert.match(js, /unresolvedQueueState: 'unknown'/);
    assert.match(js, /data-queue-state="queue_unavailable"/);
    assert.match(js, /data-queue-state="empty"/);
    assert.match(js, /state\.unresolvedQueueState === 'available'/);
    assert.match(js, /\/api\/payments\/readiness\/probe/);
    assert.match(js, /await loadPilotRegisterState\(\{ silent: true \}\)/);
    assert.match(js, /JSON\.stringify\(\{ crmProfileKey: PILOT_SCOPE\.crmProfileKey, registerAlias: PILOT_SCOPE\.registerAlias, force \}\)/);
    assert.match(js, /READINESS_REFRESH_MIN_MS/);
    assert.match(js, /READINESS_REFRESH_MAX_MS/);
    assert.match(js, /READINESS_REQUEST_TIMEOUT_MS/);
    assert.match(js, /Черга незавершених чеків недоступна/);
    assert.match(js, /startNextOrder[\s\S]*state\.unresolvedQueueState !== 'available'/);
});

test('unresolved queue is register-wide with latest-job dedupe and mine markers', () => {
    const service = read('services/payments/paymentReadinessService.js');
    const js = read('js/cashier-payments-page.js');
    const listBlock = service.slice(service.indexOf('async function listUnresolvedPaymentOrders'), service.indexOf('async function loadCheckboxSalesReport'));
    assert.match(listBlock, /WITH latest_job AS \(/);
    assert.doesNotMatch(listBlock, /po\.cashier_user_id = \$3/);
    assert.match(listBlock, /po\.fiscal_profile_id = \$1/);
    assert.match(listBlock, /po\.fiscal_register_id = \$2/);
    assert.match(listBlock, /isMine:/);
    assert.match(listBlock, /cashierIdentity:/);
    assert.match(service, /async function countCloseBlockers[\s\S]*po\.fiscal_register_id = \$2/);
    assert.match(js, /Мої чеки/);
    assert.match(js, /Вся каса/);
    assert.match(js, /Мій чек/);
});

test('Checkbox sales report is filterable, paginated, and totals are not limited to the current page', () => {
    const html = read('cashier-payments.html');
    const service = read('services/payments/paymentReadinessService.js');
    const js = read('js/cashier-payments-page.js');
    for (const id of ['checkboxReportDateFrom', 'checkboxReportDateTo', 'checkboxReportShiftId', 'checkboxReportCashierUserId', 'checkboxReportPage']) {
        assert.match(html, new RegExp(`id="${id}"`), `${id} filter must exist`);
    }
    assert.match(service, /dateFrom = null/);
    assert.match(service, /dateTo = null/);
    assert.match(service, /shiftId = null/);
    assert.match(service, /cashierUserId = null/);
    assert.match(service, /pageSize = 50/);
    assert.match(service, /LIMIT \$7 OFFSET \$8/);
    assert.match(service, /\(\$6::bigint IS NULL OR po\.cashier_user_id = \$6::bigint\)/);
    assert.match(service, /totalCount: Number\(totalsRow\.total_count \|\| 0\)/);
    assert.match(js, /params\.set\('cashierUserId', cashierUserId\)/);
    assert.match(js, /params\.set\('pageSize', '50'\)/);
    assert.match(js, /Суми пораховані по всьому фільтру/);
    assert.doesNotMatch(js, /Z-звіт[^.]*офіційний/, 'Internal report must not be presented as an official Z-report');
});

test('readiness scheduler reports degraded probes and manages operational incident lifecycle', () => {
    const service = read('services/payments/paymentReadinessService.js');
    const routes = read('routes/payments.js');
    assert.match(service, /async function upsertOperationalIncident/);
    assert.match(service, /async function resolveOperationalIncidents/);
    assert.match(service, /async function updateOperationalIncidentStatus/);
    assert.match(service, /action: 'fiscal\.incident\.manage'/);
    assert.match(service, /assertIntegrationOwner\(scope\.mapping, user\)/);
    assert.match(service, /incident_reason_required/);
    assert.match(service, /INSERT INTO fiscal_audit_events/);
    assert.match(routes, /router\.get\('\/incidents', requireAction\('fiscal\.audit\.view'\)/);
    assert.match(routes, /router\.post\('\/incidents\/:incidentId\/acknowledge', requireAction\('fiscal\.incident\.manage'\)/);
    assert.match(service, /checkbox\.readiness_probe_failed/);
    assert.match(service, /checkbox\.provider_unavailable/);
    assert.match(service, /checkbox_readiness_probe_degraded/);
    assert.match(service, /throw new PaymentReadinessError\('checkbox_readiness_probe_degraded'/);
    assert.match(service, /\['acknowledged', 'resolved'\]\.includes\(nextStatus\)/);
    assert.match(service, /SET status = \$4/);
    assert.match(service, /jsonb_build_object/);
});

test('migration 331 hardens fiscal receipt, shift, incident capability, and credential prefix immutability', () => {
    const sql = read('db/migrations/331_checkbox_ledger_immutability_authorization.sql');
    assert.match(sql, /fiscal\.incident\.manage/);
    assert.match(sql, /prevent_fiscal_receipt_provider_artifact_drift_v331/);
    assert.match(sql, /provider fiscal code is immutable once assigned/);
    assert.match(sql, /trusted Checkbox tax URL is fill-only/);
    assert.match(sql, /trusted Checkbox PDF URL is fill-only/);
    assert.match(sql, /trusted Checkbox QR URL is fill-only/);
    assert.match(sql, /prevent_fiscal_shift_provider_identity_drift_v331/);
    assert.match(sql, /fk_fiscal_shifts_open_operation_scope_v331/);
    assert.match(sql, /fk_fiscal_shifts_close_operation_scope_v331/);
    assert.match(sql, /checkbox_credential_env_prefix_v331/);
    assert.match(sql, /foo-bar\/foo_bar\/foo:bar collisions|environment prefix/i);
    assert.match(sql, /trg_fiscal_register_credential_prefix_collision_v331/);
    assert.match(sql, /trg_fiscal_cashier_binding_credential_prefix_collision_v331/);
});

test('worker records provider receipt observations append-only and refuses receipt mismatches', () => {
    const worker = read('services/payments/paymentOutboxWorker.js');
    assert.match(worker, /async function recordReceiptObservation/);
    assert.match(worker, /fiscal_provider_receipt_observed/);
    assert.match(worker, /fiscal_receipt_mismatch_observed/);
    assert.match(worker, /async function recordReceiptMismatchIncident/);
    assert.match(worker, /fiscal\.receipt_mismatch/);
    assert.match(worker, /collectReceiptMismatches/);
    assert.match(worker, /throw new PaymentOutboxWorkerError\('fiscal_receipt_identity_mismatch'/);
    assert.match(worker, /provider_tax_url = COALESCE\(fiscal_receipts\.provider_tax_url, EXCLUDED\.provider_tax_url\)/);
    assert.match(worker, /provider_snapshot = CASE[\s\S]*fiscal_receipts\.provider_snapshot = '\{\}'::jsonb/);
});

test('configuration CLI authorizes mutating actor inside transaction and fails closed on credential prefix collisions', () => {
    const cli = read('scripts/configure-checkbox-park-pilot.js');
    assert.match(cli, /async function assertNoStoredCredentialRefCollisions/);
    assert.match(cli, /SELECT provider_license_ref AS credential_ref[\s\S]*UNION ALL[\s\S]*provider_cashier_login_ref AS credential_ref/);
    assert.match(cli, /await client\.query\('BEGIN'\);\s*await assertMutationActorAuthorized\(client, plan\)/);
    assert.match(cli, /FOR UPDATE/);
    assert.match(cli, /resolveCapability\(actor, 'fiscal\.configure'\)/);
});

test('confirmed payment idempotent replay re-authorizes but does not require new provider readiness', () => {
    const service = read('services/payments/paymentService.js');
    const replayBlock = service.match(/if \(existingAttempt\) \{[\s\S]*?\r?\n        \}\r?\n\r?\n        if \(requireCheckboxIntegrationReady && !isCheckboxIntegrationEnabled/)?.[0] || '';
    assert.match(replayBlock, /await authorizeOrderReplay/);
    assert.match(replayBlock, /idempotency_key_conflict/);
    assert.match(replayBlock, /replayed: true/);
    assert.doesNotMatch(replayBlock, /assertPaymentReadiness/);
    assert.doesNotMatch(replayBlock, /assertCheckboxIntegrationReady/);
    const confirmFunction = service.slice(
        service.indexOf('async function confirmPaymentOrder'),
        service.indexOf('async function cancelDraftPaymentOrder')
    );
    assert.ok(
        confirmFunction.indexOf('if (existingAttempt)') < confirmFunction.indexOf("throw new PaymentServiceError('checkbox_integration_disabled'"),
        'idempotent replay must be evaluated before global integration-disabled checks'
    );
});
