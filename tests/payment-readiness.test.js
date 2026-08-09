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
    assert.match(service, /deriveIntegrationReady/);
    assert.match(service, /syncPortalClosedShift/);
});

test('routes expose thin readiness, unresolved, health, incidents, and Phase-1 close without Cashier PRO', () => {
    const routes = read('routes/payments.js');
    assert.match(routes, /router\.post\('\/readiness\/probe', requireAction\('payments\.view'\)/);
    assert.match(routes, /router\.get\('\/unresolved-orders', requireAction\('payments\.view'\)/);
    assert.match(routes, /router\.get\('\/operational-health', requireAction\('fiscal\.audit\.view'\)/);
    assert.match(routes, /router\.get\('\/incidents', requireAction\('fiscal\.audit\.view'\)/);
    assert.match(routes, /router\.post\('\/shifts\/:shiftId\/phase1-close', requireAction\('fiscal\.shift\.close'\)/);
    assert.doesNotMatch(
        routes.slice(routes.indexOf("router.post('/shifts/:shiftId/phase1-close'"), routes.indexOf("router.post('/service-in'")),
        /requireCashierProEnabled/,
        'Phase-1 close must not require Cashier PRO'
    );
});

test('worker treats failed payment jobs as incidents and allows only thin MVP shift close when PRO is disabled', () => {
    const worker = read('services/payments/paymentOutboxWorker.js');
    assert.match(worker, /fiscal_operational_incidents/);
    assert.match(worker, /payment_outbox_degraded/);
    assert.match(worker, /job\.payload->>'phase' = 'thin_mvp_shift_close'/);
    assert.match(worker, /CASHIER_PRO_JOB_TYPES = new Set\(\['receipt_return', 'service_receipt'\]\)/);
    assert.match(worker, /getCurrentShiftStatus/);
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
