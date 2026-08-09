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
    assert.match(service, /deriveIntegrationReady/);
    assert.match(service, /syncPortalClosedShift/);
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
    assert.match(routes, /router\.post\('\/incidents\/:incidentId\/acknowledge', requireAction\('fiscal\.audit\.view'\)/);
    assert.match(routes, /router\.post\('\/incidents\/:incidentId\/resolve', requireAction\('fiscal\.audit\.view'\)/);
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
    assert.match(worker, /recordStage\?\.\(context\.job\.job_type === 'shift_open' \? 'shift_request' : 'shift_close_request'\)/);
    assert.match(worker, /recordStage\?\.\('shift_lookup'\)/);
    assert.match(worker, /recordStage\?\.\('receipt_lookup'\)/);
    assert.match(worker, /checkbox_shift_open_pending/);
    assert.match(worker, /checkbox_shift_close_pending/);
    assert.match(provider, /checkbox_shift_explicit_sync_required/);
    assert.match(provider, /expectedShiftId: expected\.expectedShiftId \|\| expected\.providerOperationId/);
    assert.match(client, /async closeShift\(\)[\s\S]*body: \{\}/);
    assert.match(recovery, /PRE_SELL_STAGES = new Set\(\['auth', 'readiness', 'shift_request', 'shift_lookup', 'receipt_validation'\]\)/);
    assert.match(recovery, /Date\.parse\(row\.heartbeat_at \|\| row\.locked_at\)/);
    assert.match(recovery, /targetStage: stage \|\| 'auth'/);
});

test('scheduler surface documents readiness probe and degraded outbox wrapper', () => {
    const server = read('server.js');
    const surface = read('config/schedulerSurface.js');
    const docs = read('docs/SCHEDULER_SURFACE.md');
    assert.match(server, /runCheckboxReadinessProbeScheduler/);
    assert.match(server, /processPaymentOutboxJobsBase\(\{ throwOnDegraded: true \}\)/);
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
        '/api/payments/operational-health',
        '/api/payments/incidents',
        '/api/payments/incidents/:incidentId/acknowledge',
        '/api/payments/incidents/:incidentId/resolve',
        '/api/payments/shifts/:shiftId/phase1-close'
    ]) {
        assert.match(registry, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${route} must be registered`);
    }
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
    assert.match(js, /READINESS_REFRESH_MIN_MS/);
    assert.match(js, /READINESS_REFRESH_MAX_MS/);
    assert.match(js, /READINESS_REQUEST_TIMEOUT_MS/);
    assert.match(js, /Черга незавершених чеків недоступна/);
    assert.match(js, /startNextOrder[\s\S]*state\.unresolvedQueueState !== 'available'/);
});

test('Checkbox sales report is filterable, paginated, and totals are not limited to the current page', () => {
    const html = read('cashier-payments.html');
    const service = read('services/payments/paymentReadinessService.js');
    const js = read('js/cashier-payments-page.js');
    for (const id of ['checkboxReportDateFrom', 'checkboxReportDateTo', 'checkboxReportShiftId', 'checkboxReportPage']) {
        assert.match(html, new RegExp(`id="${id}"`), `${id} filter must exist`);
    }
    assert.match(service, /dateFrom = null/);
    assert.match(service, /dateTo = null/);
    assert.match(service, /shiftId = null/);
    assert.match(service, /pageSize = 50/);
    assert.match(service, /LIMIT \$7 OFFSET \$8/);
    assert.match(service, /totalCount: Number\(totalsRow\.total_count \|\| 0\)/);
    assert.match(js, /params\.set\('pageSize', '50'\)/);
    assert.match(js, /Суми пораховані по всьому фільтру/);
    assert.doesNotMatch(js, /Z-звіт[^.]*офіційний/, 'Internal report must not be presented as an official Z-report');
});

test('readiness scheduler reports degraded probes and manages operational incident lifecycle', () => {
    const service = read('services/payments/paymentReadinessService.js');
    assert.match(service, /async function upsertOperationalIncident/);
    assert.match(service, /async function resolveOperationalIncidents/);
    assert.match(service, /async function updateOperationalIncidentStatus/);
    assert.match(service, /checkbox\.readiness_probe_failed/);
    assert.match(service, /checkbox\.provider_unavailable/);
    assert.match(service, /checkbox_readiness_probe_degraded/);
    assert.match(service, /throw new PaymentReadinessError\('checkbox_readiness_probe_degraded'/);
    assert.match(service, /\['acknowledged', 'resolved'\]\.includes\(nextStatus\)/);
    assert.match(service, /SET status = \$4/);
    assert.match(service, /jsonb_build_object/);
});
