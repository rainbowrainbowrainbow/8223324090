'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    applyPaymentAcceptanceGate,
    canProbeProviderReadiness,
    finalizeFreshReadiness,
    freshShiftContextMatches,
    loadPaymentOrderTaxContext,
    normalizeUnresolvedPagination,
    readinessErrorResponse,
    resolveProviderShiftReadiness,
    resolveUnreportedPaymentPermissionPolicy,
    sanitizePersistedReadinessDetails
} = require('../services/payments/paymentReadinessService');
const {
    isCashierProEnabled,
    isCheckboxIntegrationEnabled,
    isCheckboxPaymentAcceptanceEnabled,
    isCheckboxWebhookEnabled
} = require('../services/checkbox/config');
const { CheckboxClientError } = require('../services/checkbox/errors');
const { requestPaymentOutboxWakeup } = require('../services/payments/paymentOutboxWakeup');
const { isScannableFile, scanContent } = require('../scripts/check-checkbox-source-safety');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('production Checkbox gates accept only explicit true or 1 and never sandbox aliases', () => {
    const gates = [
        ['CHECKBOX_INTEGRATION_ENABLED', isCheckboxIntegrationEnabled],
        ['CHECKBOX_ACCEPT_PAYMENTS_ENABLED', isCheckboxPaymentAcceptanceEnabled],
        ['CHECKBOX_WEBHOOK_ENABLED', isCheckboxWebhookEnabled],
        ['EVENTGENIX_CASHIER_PRO_ENABLED', isCashierProEnabled]
    ];
    for (const [name, enabled] of gates) {
        for (const value of ['true', 'TRUE', '1', ' true ']) {
            assert.equal(enabled({ [name]: value }), true, `${name} must accept ${JSON.stringify(value)}`);
        }
        for (const value of [undefined, '', 'false', '0', 'yes', 'on', 'sandbox', 'test', 'garbage']) {
            assert.equal(enabled({ [name]: value }), false, `${name} must reject ${JSON.stringify(value)}`);
        }
    }
});

test('Checkbox source safety scan covers templates and structured config without broad test-name exemptions', () => {
    for (const file of ['manifest.env.example', 'runtime.env', 'runtime.ps1', 'workflow.yml', 'workflow.yaml', 'config.json']) {
        assert.equal(isScannableFile(file), true, `${file} must be scanned`);
    }
    const credential = ['sandbox', 'cashier', 'credential', crypto.randomUUID()].join('-');
    const unsafeEnv = ['CHECKBOX_SANDBOX_', 'PASSWORD', '=', credential].join('');
    const unsafeJson = ['{"log', 'in":"', credential, '"}'].join('');
    const unsafeYaml = ['access', '_key', ': ', credential].join('');
    const unsafeGate = ['CHECKBOX_INTEGRATION_ENABLED', 'sandbox'].join('=');
    const unsafeJsonGate = JSON.stringify({ CHECKBOX_INTEGRATION_ENABLED: 'sandbox' });
    assert.ok(scanContent('docs/integrations/checkbox/runtime.env.example', unsafeEnv).length > 0);
    assert.ok(scanContent('docs/integrations/checkbox/runtime.json', unsafeJson).length > 0);
    assert.ok(scanContent('docs/integrations/checkbox/runtime.yml', unsafeYaml).length > 0);
    assert.ok(scanContent('docs/integrations/checkbox/runtime.env.example', unsafeGate).length > 0);
    assert.ok(scanContent('docs/integrations/checkbox/runtime.json', unsafeJsonGate).length > 0);
    assert.deepEqual(scanContent(
        'docs/integrations/checkbox/runtime.env.example',
        ['CHECKBOX_INTEGRATION_ENABLED=false', ['CHECKBOX_SANDBOX_', 'PASSWORD', '='].join('')].join('\n')
    ), []);
    assert.deepEqual(scanContent('tests/mock.test.js', "const auth = { password: 'mock-password' };"), []);
    assert.ok(scanContent('services/checkbox/runtime.js', "const auth = { password: 'mock-password' };").length > 0);
});

test('readiness error responses redact login, license, access, device, token and PIN material centrally', () => {
    const values = {
        cashierIdentity: `cashier-${crypto.randomUUID()}`,
        licenseValue: `license-${crypto.randomUUID()}`,
        accessValue: `access-${crypto.randomUUID()}`,
        deviceValue: `device-${crypto.randomUUID()}`,
        bearerValue: `token-${crypto.randomUUID()}`,
        actionCode: String(crypto.randomInt(100000, 1000000))
    };
    const sensitiveMessage = [
        ['login', values.cashierIdentity].join('='),
        ['license_key', values.licenseValue].join('='),
        ['access_key', values.accessValue].join('='),
        ['device_id', values.deviceValue].join('='),
        ['token', values.bearerValue].join('='),
        ['pin_code', values.actionCode].join('=')
    ].join(' ');
    const error = new CheckboxClientError(
        'checkbox_readiness_probe_failed',
        sensitiveMessage,
        {
            status: 503,
            details: {
                login: values.cashierIdentity,
                license_key: values.licenseValue,
                nestedAccess: { accessKey: values.accessValue },
                descriptor: { field: 'device_id', actual: values.deviceValue, expected: values.deviceValue },
                authorization: `Bearer ${values.bearerValue}`,
                pinCode: values.actionCode
            }
        }
    );
    const response = readinessErrorResponse(error);
    const serialized = JSON.stringify(response);
    assert.equal(response.status, 503);
    assert.equal(response.body.code, 'checkbox_readiness_probe_failed');
    for (const secret of Object.values(values)) assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(serialized, /\[redacted\]/);
});

test('unresolved queue pagination validates positive page values and caps pageSize at 100', () => {
    assert.deepEqual(normalizeUnresolvedPagination({}), { page: 1, pageSize: 50 });
    assert.deepEqual(normalizeUnresolvedPagination({ page: '2', pageSize: '100' }), { page: 2, pageSize: 100 });
    for (const value of ['0', '-1', '1.5', 'abc']) {
        assert.throws(
            () => normalizeUnresolvedPagination({ page: value }),
            error => error?.code === 'unresolved_page_invalid' && error?.status === 422
        );
    }
    assert.throws(
        () => normalizeUnresolvedPagination({ pageSize: '101' }),
        error => error?.code === 'unresolved_page_size_invalid' && error?.status === 422
    );
});

test('post-commit outbox wake-up is single-flight and Phase-1 close drains one job', async () => {
    const previous = process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    delete process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    let releaseWorker;
    const calls = [];
    const workerDone = new Promise(resolve => { releaseWorker = resolve; });
    const workerRunner = async options => {
        calls.push(options);
        await workerDone;
        return { claimed: 0, succeeded: 0, failed: 0 };
    };
    try {
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 1, reason: 'phase1-test', workerRunner }), true);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 1, reason: 'phase1-test-duplicate', workerRunner }), false);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(calls.length, 1);
        assert.equal(calls[0].batchSize, 1);
        assert.equal(calls[0].throwOnDegraded, false);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 1, reason: 'phase1-test-running', workerRunner }), false);
        releaseWorker();
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        if (previous === undefined) delete process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
        else process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED = previous;
    }
});

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
    assert.match(service, /PaymentReadinessError,[\s\S]*assertFreshPaymentReadiness,[\s\S]*assertPaymentReadiness[\s\S]*require\('\.\/paymentReadinessService'\)/);
    assert.match(service, /await assertPaymentReadiness\(\{\s*client,\s*user,\s*fiscalProfileId: mapping\.fiscal_profile_id,[\s\S]*?action: 'payments\.create'/);
    assert.match(service, /fiscalProfileId: mapping\.fiscal_profile_id,[\s\S]*?action: 'payments\.create',\s*tender/);
    assert.match(service, /await assertPaymentReadiness\(\{\s*client,\s*user,\s*fiscalProfileId: order\.fiscal_profile_id,[\s\S]*?action: 'payments\.confirm_received'/);
    assert.match(service, /await assertFreshPaymentReadiness\(\{[\s\S]*?tender: immutableTender,[\s\S]*?fetchImpl: checkboxFetchImpl/);
    assert.ok(
        service.indexOf('await assertFreshPaymentReadiness({') < service.indexOf('const result = await withTransaction(dbPool, async client => {', service.indexOf('async function confirmPaymentOrder')),
        'Tender-scoped provider HTTP readiness must complete before the locking confirmation transaction'
    );
    assert.match(service, /error instanceof PaymentReadinessError/);
});

test('unreported payment permission override is explicit and test-only', () => {
    assert.deepEqual(resolveUnreportedPaymentPermissionPolicy({ env: {}, expectedIsTest: true }), {
        requested: false,
        allowed: false
    });
    assert.deepEqual(resolveUnreportedPaymentPermissionPolicy({
        env: { CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS: 'true' },
        expectedIsTest: true
    }), {
        requested: true,
        allowed: true
    });
    assert.deepEqual(resolveUnreportedPaymentPermissionPolicy({
        env: { CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS: 'true' },
        expectedIsTest: false
    }), {
        requested: true,
        allowed: false
    });
    assert.deepEqual(resolveUnreportedPaymentPermissionPolicy({
        env: { CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS: 'yes-please' },
        expectedIsTest: true
    }), {
        requested: false,
        allowed: false
    });
});

test('provider readiness remains probeable while payment acceptance stays fail-closed', () => {
    assert.equal(canProbeProviderReadiness({ readinessCode: 'ready' }), true);
    assert.equal(canProbeProviderReadiness({ readinessCode: 'payment_acceptance_disabled' }), true);
    assert.equal(canProbeProviderReadiness({ readinessCode: 'credentials_missing' }), false);

    const providerState = {
        checkboxIntegrationEnabled: true,
        paymentAcceptanceEnabled: false,
        localMappingReady: true,
        runtimeSecretsResolvable: true,
        providerIdentityVerified: true,
        registerActive: true,
        cashierReady: true,
        signatureCertificateReady: true,
        taxMappingReady: true,
        providerUnavailable: false,
        staleReadiness: false,
        shiftState: 'closed',
        readinessCode: 'ready'
    };
    assert.deepEqual(applyPaymentAcceptanceGate(providerState), {
        ...providerState,
        providerReady: true,
        readinessCode: 'payment_acceptance_disabled',
        integrationReady: false
    });
    assert.equal(applyPaymentAcceptanceGate({ ...providerState, paymentAcceptanceEnabled: true }).integrationReady, true);
    assert.deepEqual(finalizeFreshReadiness({ ...providerState, paymentAcceptanceEnabled: true }), {
        ...providerState,
        paymentAcceptanceEnabled: true,
        providerReady: true,
        integrationReady: true
    });
    assert.deepEqual(finalizeFreshReadiness(providerState), {
        ...providerState,
        providerReady: true,
        readinessCode: 'payment_acceptance_disabled',
        integrationReady: false
    });
});

test('provider OPENED shift requires the exact durable local provider shift id', () => {
    const matched = resolveProviderShiftReadiness({
        providerShift: { id: 'shift-one', status: 'OPENED' },
        localShift: { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'OPENED' }
    });
    assert.equal(matched.shiftState, 'open');
    assert.equal(matched.readinessCode, 'ready');
    assert.equal(matched.localShiftMatched, true);

    for (const localShift of [null, {}, { provider_shift_id: 'shift-other', status: 'open', lifecycle_stage: 'OPENED' }]) {
        const blocked = resolveProviderShiftReadiness({
            providerShift: { id: 'shift-one', status: 'OPENED' },
            localShift
        });
        assert.equal(blocked.shiftState, 'external_open');
        assert.equal(blocked.readinessCode, 'external_shift_requires_sync');
        assert.equal(blocked.localShiftMatched, false);
    }

    for (const localShift of [
        { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'OPENED' },
        { provider_shift_id: 'shift-one', status: 'opening', lifecycle_stage: 'OPENING' },
        { provider_shift_id: 'shift-one', status: 'closing', lifecycle_stage: 'CLOSING' }
    ]) {
        const blocked = resolveProviderShiftReadiness({ providerShift: null, localShift });
        assert.equal(blocked.shiftState, 'local_stale');
        assert.equal(blocked.readinessCode, 'local_shift_requires_reconciliation');
        assert.equal(blocked.localShiftMatched, false);
    }
    const portalClosed = resolveProviderShiftReadiness({
        providerShift: { id: 'shift-one', status: 'CLOSED' },
        localShift: { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'OPENED' }
    });
    assert.equal(portalClosed.shiftState, 'closed');
    assert.equal(portalClosed.readinessCode, 'ready');
    assert.equal(portalClosed.localShiftMatched, true);
    const wrongClosedShift = resolveProviderShiftReadiness({
        providerShift: { id: 'shift-other', status: 'CLOSED' },
        localShift: { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'OPENED' }
    });
    assert.equal(wrongClosedShift.shiftState, 'local_stale');
    assert.equal(wrongClosedShift.localShiftMatched, false);
    assert.equal(freshShiftContextMatches(
        { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'OPENED' },
        { providerShiftId: 'shift-one', shiftState: 'open' }
    ), true);
    assert.equal(freshShiftContextMatches(
        { provider_shift_id: 'shift-other', status: 'open', lifecycle_stage: 'OPENED' },
        { providerShiftId: 'shift-one', shiftState: 'open' }
    ), false);
});

test('provider OPENED shift requires detailed cashier identity and never trusts a sparse current-shift fallback', () => {
    const readiness = read('services/payments/paymentReadinessService.js');
    assert.match(readiness, /normalizeShiftResponse\(currentShiftObservation\.payload, expected, \{ requireCashier: false \}\)/);
    assert.match(readiness, /getShiftById\(\{ shiftId: current\.id \}\)[\s\S]*requireOpened: true, requireCashier: true/);
});

test('current-shift absence requires official register has_shift=false and malformed responses fail closed', () => {
    const readiness = read('services/payments/paymentReadinessService.js');
    assert.match(
        readiness,
        /getCurrentShiftWithAbsenceProof\([\s\S]*providerReadiness\.register[\s\S]*currentShiftObservation\.absent/
    );
    const provider = read('services/checkbox/provider.js');
    assert.match(provider, /error\.status === 404 \|\| error\.status === 422/);
    assert.match(provider, /register\.hasShift !== false[\s\S]*checkbox_current_shift_unknown/);
    assert.match(provider, /checkbox_current_shift_response_malformed/);
    assert.match(
        readiness,
        /if \(localShiftId && \['open', 'opening', 'closing'\]\.includes\(localState\)\)[\s\S]*getShiftById\(\{ shiftId: localShiftId \}\)[\s\S]*expectedShiftId: localShiftId/
    );
});

test('fresh payment tax context uses immutable order items and rejects active mapping drift', async () => {
    const immutableRows = [
        { line_number: 1, item_code: 'regular_child', tax_mode: 'taxed', provider_tax_id: 'tax-7' },
        { line_number: 2, item_code: 'adult_companion', tax_mode: 'untaxed', provider_tax_id: null }
    ];
    function clientFor(currentRows) {
        return {
            async query(sql) {
                if (sql.includes('FROM payment_order_items')) return { rows: immutableRows };
                if (sql.includes('FROM fiscal_item_mappings')) return { rows: currentRows };
                throw new Error(`Unexpected query: ${sql}`);
            }
        };
    }
    const exact = await loadPaymentOrderTaxContext(clientFor([
        { item_code: 'regular_child', tax_mode: 'taxed', provider_tax_id: 'tax-7' },
        { item_code: 'adult_companion', tax_mode: 'untaxed', provider_tax_id: null }
    ]), {
        paymentOrderId: 77,
        fiscalProfileId: 1,
        fiscalRegisterId: 2,
        crmProfileKey: 'event_genix',
        lockConfiguration: true
    });
    assert.deepEqual(exact.providerTaxIds, ['tax-7']);
    assert.match(exact.fingerprint, /^[a-f0-9]{64}$/);

    await assert.rejects(
        () => loadPaymentOrderTaxContext(clientFor([
            { item_code: 'regular_child', tax_mode: 'taxed', provider_tax_id: 'tax-9' },
            { item_code: 'adult_companion', tax_mode: 'untaxed', provider_tax_id: null }
        ]), {
            paymentOrderId: 77,
            fiscalProfileId: 1,
            fiscalRegisterId: 2,
            crmProfileKey: 'event_genix'
        }),
        error => error.code === 'payment_fiscal_tax_mapping_changed'
    );
});

test('public readiness details never expose provider identity ids', () => {
    const sanitized = sanitizePersistedReadinessDetails({
        cashier: { id: 'cashier-secret-id', identityVerified: true, organizationVerified: true, isTest: true },
        register: { registerId: 'register-secret-id', organizationId: 'org-secret-id', identityVerified: true, organizationVerified: true, online: true },
        shift: { id: 'shift-secret-id', state: 'open', status: 'OPENED', localShiftMatched: true, providerShiftPresent: true },
        expected: { expectedCashierId: 'cashier-secret-id', expectedRegisterId: 'register-secret-id' },
        permissions: { sales: 'allowed', cash: 'allowed', card: 'unreported', unreported: ['card_payment'] },
        taxes: { expected: ['tax-secret-id'], expectedCount: 1, availableCount: 1, exactPaymentTaxSnapshot: true }
    });
    const serialized = JSON.stringify(sanitized);
    assert.doesNotMatch(serialized, /cashier-secret-id|register-secret-id|org-secret-id|shift-secret-id|tax-secret-id/);
    assert.equal(sanitized.cashier.identityVerified, true);
    assert.equal(sanitized.register.online, true);
    assert.equal(sanitized.shift.localShiftMatched, true);
    assert.equal(sanitized.taxes.expectedCount, 1);
});

test('payment readiness service keeps provider HTTP outside DB transactions and blocks stale states', () => {
    const service = read('services/payments/paymentReadinessService.js');
    assert.match(service, /async function prepareReadinessScope/);
    assert.match(service, /result = await probeProvider\(scope, \{ fetchImpl, now, env \}\)/);
    assert.match(service, /providerResult = await probeProvider\(scope, \{ fetchImpl, now, env, requiredTender \}\)/);
    assert.match(service, /readiness_stale/);
    assert.match(service, /provider_unavailable/);
    assert.match(service, /shift_opening/);
    assert.match(service, /resolveProviderShiftReadiness\(\{ providerShift: current, localShift: scope\.shift \}\)/);
    assert.match(service, /external_shift_requires_sync/);
    assert.match(service, /local_shift_requires_reconciliation/);
    assert.match(service, /verifyReadiness\(expected, \{[\s\S]*expectedTaxIds: scope\.paymentTaxContext\?\.providerTaxIds \|\| scope\.tax\?\.providerTaxIds \|\| \[\],[\s\S]*requiredTender: normalizedTender,[\s\S]*allowUnreportedPaymentPermissions: unreportedPermissionPolicy\.allowed/);
    assert.match(service, /CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS/);
    assert.match(service, /expectedIsTest: expected\.expectedIsTest/);
    assert.match(service, /paymentPermissionWarning/);
    assert.match(service, /checkbox_expected_is_test_mismatch/);
    assert.match(service, /fiscal_context_incomplete/);
    assert.match(service, /tax_mode = 'untaxed'/);
    assert.match(service, /tax_mode = 'taxed'/);
    assert.match(service, /deriveIntegrationReady/);
    assert.match(service, /providerReady: false/);
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
    assert.match(worker, /provider\.lookupShift/);
    assert.match(worker, /checkbox_shift_lookup_unavailable/);
    assert.match(worker, /COALESCE\(job\.heartbeat_at, job\.locked_at\)/);
    assert.match(worker, /shift_request_maybe_submitted/);
    assert.match(worker, /NOT EXISTS \(\s*SELECT 1\s*FROM payment_outbox_jobs active_job/);
    assert.match(worker, /while \(results\.length < maxJobs\)/);
    assert.match(worker, /recordStage\?\.\('shift_lookup'\)/);
    assert.match(worker, /recordStage\?\.\('receipt_lookup'\)/);
    assert.match(worker, /checkbox_shift_open_pending/);
    assert.match(worker, /checkbox_shift_close_pending/);
    assert.match(worker, /SHIFT_OPEN_LOOKUP_STAGES\.has\(stage\)/);
    assert.match(worker, /shift_lookup_not_found/);
    assert.match(worker, /shift_request_retry_same_uuid/);
    assert.match(worker, /two_exact_lookup_404_then_same_uuid_only/);
    assert.match(worker, /shift_close_request_maybe_submitted/);
    assert.match(worker, /shift_close_lookup_still_open/);
    assert.match(worker, /two_exact_lookup_opened_then_close_exact_shift_only/);
    assert.match(worker, /recordStage\(externalStage\(context\.job\)\)/);
    assert.match(worker, /assertMutationOwnership = \(\) => recordExternalStage/);
    assert.doesNotMatch(worker, /recordStage\('auth'\)/, 'Worker must preserve durable recovery stages across restart');
    assert.match(worker, /SHIFT_CLOSE_LOOKUP_STAGES\.has\(stage\)/);
    assert.match(worker, /checkbox_shift_close_identity_mismatch/);
    assert.match(worker, /assertLifecycleTransition/);
    assert.match(worker, /current_expected_is_test/);
    assert.match(worker, /expected_is_test/);
    const shiftJobBlock = worker.slice(worker.indexOf('async function runShiftJob'), worker.indexOf('async function runReceiptSaleJob'));
    assert.doesNotMatch(shiftJobBlock, /attempts\s*\|\|\s*0/, 'Shift recovery must not infer provider mutation from attempts count');
    assert.match(provider, /checkbox_shift_explicit_sync_required/);
    assert.match(provider, /expectedShiftId: expected\.expectedShiftId \|\| expected\.providerOperationId/);
    assert.match(provider, /notFound: true/);
    assert.match(provider, /beforeExternalMutation\?\.\(\{ operation: 'shift_close' \}\)/);
    assert.doesNotMatch(provider, /id: expected\.expectedShiftId \|\| null, status: CLOSED_SHIFT_STATUS/);
    assert.match(client, /async closeShift\(\)[\s\S]*body: \{\}/);
    assert.match(recovery, /shift_lookup_not_found/);
    assert.match(recovery, /shift_request_retry_same_uuid/);
    assert.match(recovery, /shift_close_request_maybe_submitted/);
    assert.match(recovery, /shift_close_lookup_still_open/);
    assert.match(recovery, /Date\.parse\(row\.heartbeat_at \|\| row\.locked_at\)/);
    assert.match(recovery, /targetStage: stage \|\| 'auth'/);
    assert.doesNotMatch(recovery, /request_snapshot = COALESCE\(request_snapshot/);
    assert.match(recovery, /max_attempts = CASE WHEN status = 'dead' THEN max_attempts \+ 1 ELSE max_attempts END/);
    const paymentService = read('services/payments/paymentService.js');
    const cashierOps = read('services/payments/cashierOperationsService.js');
    assert.match(paymentService, /fr\.metadata->>'expected_is_test' AS register_expected_is_test/);
    assert.match(cashierOps, /ensureOpenShiftForSale\(client, \{ order, user, fiscalConfig = null \}\)/);
    assert.match(cashierOps, /expected_is_test: normalizeBoolean\(fiscalSnapshot\.expected_is_test \?\? order\.register_expected_is_test\)/);
    assert.match(cashierOps, /register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash/);
    const phaseOneClose = read('services/payments/paymentReadinessService.js').slice(
        read('services/payments/paymentReadinessService.js').indexOf('async function requestPhase1ShiftClose'),
        read('services/payments/paymentReadinessService.js').indexOf('async function runCheckboxReadinessProbeScheduler')
    );
    assert.match(phaseOneClose, /external_stage: 'auth'/);
    assert.match(phaseOneClose, /action: 'fiscal\.shift\.close'/);
    assert.match(phaseOneClose, /requirePaymentAcceptance: false/);
    assert.match(phaseOneClose, /loadAndAuthorizePhase1CloseShift/);
    assert.match(read('services/payments/paymentReadinessService.js'), /assertPhase1CloseIntegrationOwner\(shift, user\)/);
    assert.match(phaseOneClose, /phase1CloseOperationIdempotencyKey/);
    assert.match(phaseOneClose, /loadPhase1CloseReplay/);
    assert.match(read('services/payments/paymentReadinessService.js'), /async function loadPhase1CloseReplay[\s\S]*replayed: true/);
    assert.match(phaseOneClose, /requestPaymentOutboxWakeup\(\{ batchSize: 1, reason: 'phase1_shift_close_requested' \}\)/);
    assert.doesNotMatch(phaseOneClose, /shift_close_already_requested/);
    assert.match(phaseOneClose, /const freshProviderReadiness = await probeCheckboxReadiness\([\s\S]*force: true/);
    assert.match(phaseOneClose, /freshProviderReadiness,[\s\S]*requirePaymentAcceptance: false|requirePaymentAcceptance: false,[\s\S]*freshProviderReadiness/);
    assert.ok(
        phaseOneClose.indexOf('loadAndAuthorizePhase1CloseShift') < phaseOneClose.indexOf('await probeCheckboxReadiness'),
        'Phase-1 close must authorize the exact target shift before provider readiness HTTP'
    );
    assert.ok(
        phaseOneClose.indexOf('await probeCheckboxReadiness') < phaseOneClose.lastIndexOf('await withTransaction'),
        'Phase-1 close provider refresh must happen outside the DB transaction'
    );
    assert.match(read('services/payments/paymentReadinessService.js'), /const contextualState = \{[\s\S]*fiscalConfigurationHash: scope\.configHash[\s\S]*expectedIsTest/);
    assert.doesNotMatch(phaseOneClose, /VALUES[\s\S]*'shift_close_lookup'\)/, 'A new Phase-1 close job must submit close before entering lookup recovery');
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
    assert.match(ci, /tests\/checkbox-fullstack-testmode-harness\.test\.js/);
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
    assert.match(status, /migrations `316` through `337`/);
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
    assert.match(html, /id="loadMoreUnresolvedOrdersBtn"[^>]*aria-describedby="unresolvedOrdersHelp"/);
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
    assert.match(js, /params\.set\('pageSize', String\(UNRESOLVED_PAGE_SIZE\)\)/);
    assert.match(js, /state\.unresolvedRegisterCount/);
    assert.match(js, /loadUnresolvedOrders\(\{ silent: false, append: true \}\)/);
});

test('cashier UI fails closed synchronously while the unresolved queue is checking', () => {
    const js = read('js/cashier-payments-page.js');
    const loadBlock = js.slice(js.indexOf('async function loadUnresolvedOrders'), js.indexOf('function renderCheckboxSalesReport'));
    const checkingIndex = loadBlock.indexOf("state.unresolvedQueueState = 'checking'");
    const requestIndex = loadBlock.indexOf('await apiRequest(`/api/payments/unresolved-orders');
    assert.ok(checkingIndex >= 0, 'load should enter checking state');
    assert.ok(requestIndex > checkingIndex, 'checking must be set before the unresolved request starts');
    assert.match(loadBlock, /renderUnresolvedOrders\(\);[\s\S]*renderReadinessState\(\);[\s\S]*try \{/);
    assert.match(js, /const isChecking = state\.unresolvedQueueState === 'checking'/);
    assert.match(js, /data-queue-state="checking"/);
    assert.match(js, /body\.setAttribute\('aria-busy', isChecking \? 'true' : 'false'\)/);
    assert.match(js, /Останній відомий список збережено нижче, але під час перевірки він може змінитися/);
    assert.match(js, /state\.unresolvedLastKnownOrders/);
    assert.match(js, /state\.unresolvedQueueState === 'checking'[\s\S]*Дочекайтеся завершення перевірки/);
});

test('cashier thin UI exposes Phase-1 shift close without loading Cashier PRO controls', () => {
    const html = read('cashier-payments.html');
    const js = read('js/cashier-payments-page.js');
    assert.match(html, /id="phase1ShiftPanel"/);
    assert.match(html, /id="phase1ShiftStatus"/);
    assert.match(html, /id="phase1ShiftCloseNotice"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(html, /id="phase1CloseShiftBtn"[^>]*aria-describedby="phase1ShiftCloseNotice"/);
    assert.doesNotMatch(html, /id="closeShiftBtn"/);
    assert.doesNotMatch(html, /id="operationalContourPanel"/);
    assert.match(js, /const raw = state\.registerState\?\.phase1Close/);
    assert.match(js, /raw\.visible === true/);
    assert.match(js, /raw\.allowed === true/);
    assert.match(js, /state\.unresolvedQueueState === 'available'/);
    assert.match(js, /const unresolvedCount = Number\(state\.unresolvedRegisterCount \|\| 0\)/);
    assert.match(js, /context\.status !== 'opened'/);
    assert.match(js, /hasAction\('fiscal\.shift\.close'\)/);
    assert.match(js, /typeof window\.confirmModal === 'function'/);
    assert.match(js, /Закрити поточну зміну в Checkbox\?/);
    assert.match(js, /нові чеки потребуватимуть відкриття нової зміни/);
    assert.match(js, /if \(!confirmed\)[\s\S]*Запит до Checkbox не надіслано/);
    assert.doesNotMatch(js, /window\.confirm\(/);
    assert.match(js, /getOperationIdempotencyKey\('phase1-close', shiftId\)/);
    assert.match(js, /\/api\/payments\/shifts\/\$\{encodeURIComponent\(shiftId\)\}\/phase1-close/);
    assert.match(js, /phase1CloseReachedClosed/);
    assert.match(js, /context\.status === 'closed'/);
    assert.match(js, /Не повторюйте запит/);
});

test('unresolved queue is register-wide with latest-job dedupe and mine markers', () => {
    const service = read('services/payments/paymentReadinessService.js');
    const routes = read('routes/payments.js');
    const js = read('js/cashier-payments-page.js');
    const listBlock = service.slice(service.indexOf('async function listUnresolvedPaymentOrders'), service.indexOf('async function loadCheckboxSalesReport'));
    assert.match(listBlock, /WITH latest_job AS \(/);
    assert.doesNotMatch(listBlock, /po\.cashier_user_id = \$3/);
    assert.match(listBlock, /po\.fiscal_profile_id = \$1/);
    assert.match(listBlock, /po\.fiscal_register_id = \$2/);
    assert.match(listBlock, /isMine:/);
    assert.match(listBlock, /cashierIdentity:/);
    assert.match(listBlock, /COUNT\(\*\)::integer AS register_count/);
    assert.match(listBlock, /COUNT\(\*\) FILTER \(WHERE cashier_user_id = \$4\)::integer AS my_count/);
    assert.match(listBlock, /LIMIT \$4 OFFSET \$5/);
    assert.doesNotMatch(listBlock, /LIMIT 100/);
    assert.match(listBlock, /hasMore: offset \+ result\.rows\.length < registerCount/);
    assert.match(routes, /normalizeUnresolvedPagination\(\{[\s\S]*page: req\.query\.page,[\s\S]*pageSize: req\.query\.pageSize \?\? req\.query\.page_size/);
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
    const preflightStart = service.indexOf('const preflight = await withTransaction', service.indexOf('async function confirmPaymentOrder'));
    const replayStart = service.indexOf('if (existingAttempt)', preflightStart);
    const replayEnd = service.indexOf('if (!requireCheckboxIntegrationReady)', replayStart);
    const replayBlock = service.slice(replayStart, replayEnd);
    assert.match(replayBlock, /await authorizeOrderReplay/);
    assert.match(replayBlock, /idempotency_key_conflict/);
    assert.match(replayBlock, /replayed: true/);
    assert.doesNotMatch(replayBlock, /assertPaymentReadiness/);
    assert.doesNotMatch(replayBlock, /assertCheckboxIntegrationReady/);
    assert.doesNotMatch(replayBlock, /assertFreshPaymentReadiness/);
    const confirmFunction = service.slice(
        service.indexOf('async function confirmPaymentOrder'),
        service.indexOf('async function cancelDraftPaymentOrder')
    );
    assert.ok(
        confirmFunction.indexOf('if (existingAttempt)') < confirmFunction.indexOf('await assertFreshPaymentReadiness({'),
        'idempotent replay must be evaluated before global integration-disabled checks'
    );
});
