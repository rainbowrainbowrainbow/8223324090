'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    applyPaymentAcceptanceGate,
    buildFiscalConfigurationSnapshot,
    canProbeProviderReadiness,
    finalizeFreshReadiness,
    freshShiftContextMatches,
    loadCheckboxSalesReport,
    loadPaymentOrderTaxContext,
    normalizeUnresolvedPagination,
    reconcileCachedShiftReadiness,
    readinessErrorResponse,
    resolveProviderShiftReadiness,
    resolveUnreportedPaymentPermissionPolicy,
    runCheckboxReadinessProbeScheduler,
    sanitizePersistedReadinessDetails,
    __readinessProbeTest
} = require('../services/payments/paymentReadinessService');
const { assertCheckboxIntegrationReady } = require('../services/payments/paymentService');
const {
    isCashierProEnabled,
    isCheckboxIntegrationEnabled,
    isCheckboxPaymentAcceptanceEnabled,
    isCheckboxWebhookEnabled
} = require('../services/checkbox/config');
const { CheckboxClientError } = require('../services/checkbox/errors');
const { requestPaymentOutboxWakeup } = require('../services/payments/paymentOutboxWakeup');
const { SCOPES: CHECKBOX_SAFETY_SCOPES, isScannableFile, scanContent } = require('../scripts/check-checkbox-source-safety');
const { __cashierProjectionTest: cashierProjection } = require('../routes/payments');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('fiscal snapshots require independently present cashier and register credential refs', async () => {
    const mapping = {
        fiscal_profile_id: 1,
        fiscal_location_id: 2,
        fiscal_register_id: 3,
        provider_license_ref: 'shared-runtime-ref'
    };
    const complete = buildFiscalConfigurationSnapshot({
        mapping,
        binding: {
            provider_cashier_id: 'cashier-one',
            provider_cashier_login_ref: 'shared-runtime-ref'
        },
        runtimeConfig: { expectedIsTest: true }
    });
    assert.equal(complete.snapshot.register_credential_ref, 'shared-runtime-ref');
    assert.equal(complete.snapshot.cashier_credential_ref, 'shared-runtime-ref');

    assert.throws(
        () => buildFiscalConfigurationSnapshot({
            mapping,
            binding: { provider_cashier_id: 'cashier-one', provider_cashier_login_ref: '   ' },
            runtimeConfig: { expectedIsTest: true }
        }),
        error => error?.code === 'fiscal_context_incomplete'
            && error?.details?.missing?.includes('cashier_credential_ref')
    );

    const client = {
        async query() {
            return {
                rows: [{
                    provider_cashier_id: 'cashier-one',
                    provider_cashier_login_ref: null
                }]
            };
        }
    };
    await assert.rejects(
        assertCheckboxIntegrationReady(client, {
            env: { CHECKBOX_INTEGRATION_ENABLED: 'true' },
            user: { id: 9 },
            fiscalProfileId: 1,
            fiscalRegisterId: 3,
            registerStatus: 'active',
            registerFeatureEnabled: true,
            provider: 'checkbox',
            providerLicenseRef: 'shared-runtime-ref'
        }),
        error => error?.code === 'fiscal_provider_context_incomplete'
            && error?.details?.missing?.includes('cashier_credential_ref')
    );
});

test('cashier credential refs never fall back to a register license ref', () => {
    const readiness = read('services/payments/paymentReadinessService.js');
    const payments = read('services/payments/paymentService.js');
    const operations = read('services/payments/cashierOperationsService.js');
    const provider = read('services/checkbox/provider.js');

    for (const source of [readiness, payments, operations]) {
        assert.doesNotMatch(
            source,
            /provider_cashier_login_ref\s*\|\|\s*(?:[\w?.]+\.)?provider_license_ref/,
            'cashier binding refs must not inherit register license refs'
        );
    }
    assert.doesNotMatch(
        readiness,
        /COALESCE\(\s*context\.provider_cashier_login_ref\s*,\s*context\.scheduler_register_credential_ref/,
        'readiness snapshots must match the explicit cashier credential ref'
    );
    assert.doesNotMatch(
        provider,
        /checkbox_cashier_ref\s*\|\|\s*licenseRef/,
        'provider resolution must require a cashier credential ref from cashier context'
    );
});

test('Phase-1 close blocker audit survives EventBus publish failure', async () => {
    const service = read('services/payments/paymentReadinessService.js');
    const safePublish = service.slice(
        service.indexOf('async function safePublishFiscalEvent'),
        service.indexOf('async function loadReadinessState')
    );
    const blocked = service.slice(
        service.indexOf('async function recordPhase1CloseBlocked'),
        service.indexOf('function phase1CloseBlockedError')
    );
    assert.match(safePublish, /SAVEPOINT \$\{savepoint\}/);
    assert.match(safePublish, /ROLLBACK TO SAVEPOINT \$\{savepoint\}/);
    assert.match(safePublish, /RELEASE SAVEPOINT \$\{savepoint\}/);
    assert.match(blocked, /await safePublishFiscalEvent\([\s\S]*'shift\.close_blocked'/);
    assert.doesNotMatch(blocked, /await publishInTransaction\(/);
    assert.ok(
        blocked.indexOf('INSERT INTO fiscal_audit_events') < blocked.indexOf('await safePublishFiscalEvent('),
        'durable close-blocked audit must be written before the best-effort event'
    );

    const safePublishFiscalEvent = Function(
        'publishInTransaction',
        `'use strict';\n${safePublish}\nreturn safePublishFiscalEvent;`
    )(async () => {});
    const queries = [];
    await safePublishFiscalEvent(
        { query: async sql => queries.push(sql) },
        'shift.close_blocked',
        {},
        'fiscal_shift',
        '7',
        'shift-close-blocked:7',
        async () => { throw new Error('event bus unavailable'); }
    );
    assert.deepEqual(queries, [
        'SAVEPOINT payment_readiness_event_publish',
        'ROLLBACK TO SAVEPOINT payment_readiness_event_publish',
        'RELEASE SAVEPOINT payment_readiness_event_publish'
    ]);
});

test('ordinary cashier payment read routes redact configuration diagnostics even for a creator with only a thin binding', () => {
    const cashier = { id: 3, role: 'cashier', extra_roles: [] };
    const creatorWithThinBinding = {
        id: 4,
        role: 'creator',
        extra_roles: [],
        fiscalBinding: {
            capability_scope: ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open']
        }
    };
    const readiness = {
        readinessCode: 'credentials_missing',
        integrationReady: false,
        providerReady: false,
        providerIdentityVerified: true,
        registerActive: true,
        cashierReady: true,
        signatureCertificateReady: true,
        taxMappingReady: true,
        providerUnavailable: false,
        staleReadiness: true,
        shiftState: 'closed',
        checkedAt: '2026-09-03T00:00:00.000Z',
        expiresAt: '2026-09-03T00:01:00.000Z',
        runtimeSecretsResolvable: false,
        missingFiscalContext: ['provider_cashier_id'],
        missingTaxItemCodes: ['regular_child'],
        readinessSnapshot: { result: { permissions: { cash: 'unreported' } } }
    };
    const localState = {
        checkboxIntegrationEnabled: true,
        cashierProEnabled: false,
        mappingExists: true,
        registerFeatureEnabled: true,
        runtimeConfigResolvable: false,
        fiscalProfileId: 1,
        fiscalLocationId: 2,
        fiscalRegisterId: 3,
        provider: 'checkbox',
        featureEnabled: true,
        crmProfileKey: 'event_genix',
        legalEntityKey: 'internal_fop_key',
        legalEntityName: 'ФОП Тест',
        locationAlias: 'park',
        registerAlias: 'middle',
        registerDisplayName: 'Середня каса',
        checklist: { cashExpectedMinor: '1000' }
    };

    const cashierReadiness = cashierProjection.projectReadinessForViewer(cashier, readiness);
    assert.equal(cashierReadiness.readinessCode, 'credentials_missing');
    assert.equal(cashierReadiness.providerIdentityVerified, true);
    assert.equal(cashierReadiness.signatureCertificateReady, true);
    assert.equal(cashierReadiness.taxMappingReady, true);
    assert.equal(cashierReadiness.runtimeSecretsResolvable, undefined);
    assert.equal(cashierReadiness.missingFiscalContext, undefined);
    assert.equal(cashierReadiness.readinessSnapshot, undefined);

    const cashierState = cashierProjection.projectPilotRegisterStateForViewer(cashier, localState, readiness, null);
    assert.equal(cashierState.legalEntityName, 'ФОП Тест');
    assert.equal(cashierState.fiscalProfileId, 1);
    assert.equal(cashierState.fiscalLocationId, 2);
    assert.equal(cashierState.fiscalRegisterId, 3);
    assert.equal(cashierState.runtimeConfigResolvable, undefined);
    assert.equal(cashierState.checklist, null);

    const creatorState = cashierProjection.projectPilotRegisterStateForViewer(creatorWithThinBinding, localState, readiness, null);
    assert.equal(creatorState.fiscalProfileId, 1);
    assert.equal(creatorState.runtimeConfigResolvable, undefined);
    assert.equal(creatorState.readiness.missingFiscalContext, undefined);

    const readinessError = {
        status: 503,
        body: {
            success: false,
            code: 'credentials_missing',
            error: 'Checkbox readiness is unavailable',
            details: { credentialRef: 'internal_ref', missing: ['password'] }
        }
    };
    assert.equal(
        cashierProjection.projectReadinessErrorForViewer(cashier, readinessError).body.details,
        undefined,
        'cashier readiness errors omit configuration diagnostics'
    );
    assert.equal(
        cashierProjection.projectReadinessErrorForViewer(creatorWithThinBinding, readinessError).body.details,
        undefined,
        'ordinary routes never expose administrative diagnostics from a role-level capability'
    );
});

test('cashier payment projection removes internal fiscal item mapping fields', () => {
    const cashier = { id: 3, role: 'cashier', extra_roles: [] };
    const creator = { id: 4, role: 'creator', extra_roles: [] };
    const details = {
        order: {
            id: 7,
            confirmationSnapshot: {
                tender: 'cash',
                fiscal_configuration_hash: 'internal-config-hash',
                provider_context: {
                    provider_register_id: 'internal-register-id',
                    register_credential_ref: 'internal-credential-ref'
                }
            }
        },
        items: [{
            id: 1,
            itemName: 'Дитячий квиток',
            itemCode: 'regular_child',
            totalAmountMinor: '10000',
            taxReference: 'admission_tariff:internal',
            taxCode: 0,
            taxRateBps: 0,
            providerTaxId: 'provider-tax-id',
            itemSnapshot: { internal: true }
        }],
        fiscalOperation: {
            id: 2,
            status: 'pending',
            provider: 'checkbox',
            providerOperationId: 'internal-provider-operation-id'
        },
        receipts: [{
            id: 3,
            status: 'fiscalized',
            provider: 'checkbox',
            providerReceiptId: 'internal-provider-receipt-id',
            providerFiscalCode: 'public-fiscal-code',
            providerSnapshot: { cashier_id: 'internal-provider-cashier-id' }
        }],
        outboxJob: {
            id: 4,
            jobType: 'receipt_status_lookup',
            externalStage: 'receipt_lookup',
            status: 'failed',
            attempts: 2,
            maxAttempts: 8,
            nextRunAt: '2026-09-03T00:05:00.000Z',
            lastErrorCode: 'provider_unavailable'
        }
    };
    const cashierDetails = cashierProjection.projectPaymentOrderDetailsForViewer(cashier, details);
    assert.equal(cashierDetails.items[0].itemName, 'Дитячий квиток');
    for (const field of ['taxReference', 'taxCode', 'taxRateBps', 'providerTaxId', 'itemSnapshot']) {
        assert.equal(cashierDetails.items[0][field], undefined, `${field} is not exposed to a cashier`);
    }
    assert.deepEqual(cashierDetails.order.confirmationSnapshot, { tender: 'cash' });
    assert.equal(cashierDetails.fiscalOperation.providerOperationId, undefined);
    assert.equal(cashierDetails.fiscalOperation.provider, undefined);
    assert.equal(cashierDetails.receipts[0].providerSnapshot, undefined);
    assert.equal(cashierDetails.receipts[0].providerReceiptId, undefined);
    assert.equal(cashierDetails.receipts[0].provider, undefined);
    assert.equal(cashierDetails.receipts[0].id, undefined);
    assert.equal(cashierDetails.receipts[0].providerFiscalCode, 'public-fiscal-code');
    assert.equal(cashierDetails.outboxJob.id, undefined);
    assert.equal(cashierDetails.outboxJob.jobType, undefined);
    assert.equal(cashierDetails.outboxJob.externalStage, undefined);
    assert.equal(cashierDetails.outboxJob.status, 'failed');
    assert.equal(cashierDetails.outboxJob.attempts, 2);
    const creatorDetails = cashierProjection.projectPaymentOrderDetailsForViewer(creator, details);
    assert.equal(creatorDetails.fiscalOperation.providerOperationId, undefined);
    assert.equal(creatorDetails.receipts[0].providerSnapshot, undefined);
});

test('cashier payment mutation projection removes durable provider and ledger identifiers', () => {
    const cashier = { id: 3, role: 'cashier', extra_roles: [] };
    const creator = { id: 4, role: 'creator', extra_roles: [] };
    const result = {
        replayed: false,
        attemptId: 10,
        fiscalOperationId: 11,
        outboxJobId: 12,
        providerRequestUuid: 'internal-provider-request-uuid',
        order: {
            id: 7,
            status: 'payment_recorded',
            confirmationSnapshot: {
                tender: 'cash',
                provider_context: { provider_register_id: 'internal-register-id' }
            }
        }
    };

    const projected = cashierProjection.projectPaymentMutationResultForViewer(cashier, result);
    assert.equal(projected.replayed, false);
    assert.equal(projected.order.id, 7);
    assert.deepEqual(projected.order.confirmationSnapshot, { tender: 'cash' });
    for (const field of ['attemptId', 'fiscalOperationId', 'outboxJobId', 'providerRequestUuid']) {
        assert.equal(projected[field], undefined, `${field} is not exposed to a cashier`);
    }
    const creatorResult = cashierProjection.projectPaymentMutationResultForViewer(creator, result);
    assert.equal(creatorResult.providerRequestUuid, undefined);
    assert.deepEqual(creatorResult.order.confirmationSnapshot, { tender: 'cash' });
});

test('cashier read models remove provider and ledger identities without hiding operational state or scope proof', () => {
    const cashier = { id: 3, role: 'cashier', extra_roles: [] };
    const unresolved = {
        fiscalProfileId: 1,
        fiscalLocationId: 2,
        fiscalRegisterId: 3,
        registerWide: true,
        registerCount: 1,
        orders: [{
            id: 41,
            orderKey: 'internal-order-key',
            fiscalOperationId: 42,
            providerOperationId: 'internal-provider-uuid',
            outboxJobId: 43,
            paymentStatus: 'confirmed',
            fiscalStatus: 'unknown',
            outboxStatus: 'failed',
            isMine: false,
            cashierIdentity: { displayName: 'Інший касир' }
        }]
    };
    const projectedQueue = cashierProjection.projectUnresolvedOrdersForViewer(cashier, unresolved);
    assert.equal(projectedQueue.fiscalProfileId, 1);
    assert.equal(projectedQueue.fiscalLocationId, 2);
    assert.equal(projectedQueue.fiscalRegisterId, 3);
    assert.equal(projectedQueue.registerWide, true);
    assert.equal(projectedQueue.orders[0].paymentStatus, 'confirmed');
    assert.equal(projectedQueue.orders[0].fiscalStatus, 'unknown');
    assert.equal(projectedQueue.orders[0].isMine, false);
    for (const field of ['orderKey', 'fiscalOperationId', 'providerOperationId', 'outboxJobId']) {
        assert.equal(projectedQueue.orders[0][field], undefined, `${field} is not exposed in the cashier queue`);
    }

    const report = {
        fiscalProfileId: 1,
        fiscalRegisterId: 3,
        totalCount: 1,
        totals: { paymentTotalMinor: '1000' },
        orders: [{
            id: 41,
            orderKey: 'internal-order-key',
            providerReceiptId: 'internal-provider-receipt-uuid',
            fiscalStatus: 'fiscalized',
            providerTaxUrl: 'https://check.checkbox.ua/public-receipt'
        }]
    };
    const projectedReport = cashierProjection.projectSalesReportForViewer(cashier, report);
    assert.equal(projectedReport.fiscalProfileId, undefined);
    assert.equal(projectedReport.fiscalRegisterId, undefined);
    assert.equal(projectedReport.totalCount, 1);
    assert.equal(projectedReport.orders[0].orderKey, undefined);
    assert.equal(projectedReport.orders[0].providerReceiptId, undefined);
    assert.equal(projectedReport.orders[0].providerTaxUrl, 'https://check.checkbox.ua/public-receipt');

    const health = cashierProjection.projectOperationalHealthForViewer(cashier, {
        fiscalProfileId: 1,
        fiscalRegisterId: 3,
        readinessCode: 'provider_unavailable',
        queueDepth: 2,
        unknownCount: 1,
        deadCount: 1
    });
    assert.deepEqual(health, {
        readinessCode: 'provider_unavailable',
        queueDepth: 2,
        unknownCount: 1,
        deadCount: 1
    });
});

test('cashier incident and Phase-1 close projections expose only actionable public fields', () => {
    const cashier = { id: 3, role: 'cashier', extra_roles: [] };
    const incidents = cashierProjection.projectIncidentsForViewer(cashier, {
        fiscalProfileId: 1,
        fiscalRegisterId: 3,
        incidents: [{
            id: 51,
            fiscalOperationId: 52,
            paymentOrderId: 53,
            severity: 'warning',
            incidentType: 'checkbox.provider_unavailable',
            status: 'open',
            details: {
                error_code: 'provider_unavailable',
                external_stage: 'receipt_lookup',
                provider_receipt_id: 'internal-provider-receipt-uuid',
                outbox_job_id: 54,
                secret: 'must-not-be-exposed'
            },
            createdAt: '2026-09-03T00:00:00.000Z'
        }]
    });
    assert.equal(incidents.fiscalProfileId, undefined);
    assert.equal(incidents.fiscalRegisterId, undefined);
    assert.equal(incidents.incidents[0].fiscalOperationId, undefined);
    assert.equal(incidents.incidents[0].details.error_code, 'provider_unavailable');
    assert.equal(incidents.incidents[0].details.external_stage, 'receipt_lookup');
    assert.equal(incidents.incidents[0].details.provider_receipt_id, undefined);
    assert.equal(incidents.incidents[0].details.outbox_job_id, undefined);
    assert.equal(incidents.incidents[0].details.secret, undefined);

    const incidentMutation = cashierProjection.projectIncidentsForViewer(cashier, {
        incident: {
            id: 51,
            status: 'acknowledged',
            resolvedAt: null,
            details: { acknowledged_by_user_id: 3, acknowledged_reason: 'checked' }
        }
    });
    assert.deepEqual(incidentMutation, {
        incident: { id: 51, status: 'acknowledged', resolvedAt: null }
    });

    const close = cashierProjection.projectPhase1CloseResultForViewer(cashier, {
        replayed: false,
        fiscalShiftId: 61,
        fiscalOperationId: 62,
        outboxJobId: 63,
        providerRequestUuid: 'internal-provider-request-uuid',
        status: 'closing'
    });
    assert.deepEqual(close, { replayed: false, fiscalShiftId: 61, status: 'closing' });
});

test('payment routes wire each read model to its matching sanitized projector', () => {
    const routes = read('routes/payments.js');
    const operationalHealth = routes.slice(
        routes.indexOf("router.get('/operational-health'"),
        routes.indexOf("router.get('/incidents'")
    );
    const incidentResolve = routes.slice(
        routes.indexOf("router.post('/incidents/:incidentId/resolve'"),
        routes.indexOf("router.post('/shifts/:shiftId/phase1-close'")
    );
    assert.match(operationalHealth, /projectOperationalHealthForViewer\(req\.user, result\)/);
    assert.doesNotMatch(operationalHealth, /projectIncidentsForViewer\(req\.user, result\)/);
    assert.match(incidentResolve, /projectIncidentsForViewer\(req\.user, result\)/);
    assert.match(routes, /projectReadinessErrorForViewer\(req\.user, readinessErrorResponse\(error\)\)/);
});

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
    const unsafeProviderId = `provider-${crypto.randomUUID()}`;
    const providerRegisterKey = ['provider', 'register', 'id'].join('_');
    assert.ok(scanContent(
        'tests/payment-outbox-future.test.js',
        `const fixture = { ${providerRegisterKey}: '${unsafeProviderId}' };`
    ).length > 0);
    assert.deepEqual(scanContent(
        'tests/payment-outbox-future.test.js',
        `const fixture = { ${providerRegisterKey}: 'register-test' };`
    ), []);
    assert.ok(scanContent(
        'services/payments/future-worker.js',
        `const fixture = { ${providerRegisterKey}: 'register-test' };`
    ).length > 0);
    for (const scopedFile of [
        'scripts/checkbox-release-db-preflight.js',
        'db/migrations/343_checkbox_shift_operation_invariants.sql',
        'db/migrations/344_checkbox_concurrent_immutability_guards.sql',
        'db/migrations/345_checkbox_service_receipt_recovery_stages.sql',
        'tests/checkbox-release-db-preflight.test.js',
        'tests/checkbox-shift-db-invariants.test.js',
        'tests/closed-shift-sale-guard.test.js',
        'tests/payment-outbox-mutation-boundary.test.js',
        'tests/payment-outbox-receipt-mismatch.test.js',
        'tests/payment-outbox-wakeup.test.js'
    ]) {
        assert.ok(CHECKBOX_SAFETY_SCOPES.includes(scopedFile), `${scopedFile} must remain safety-scanned`);
    }
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

test('unresolved queue pagination requires a validated cursor and snapshot revision after page one', () => {
    assert.deepEqual(normalizeUnresolvedPagination({}), { page: 1, pageSize: 50 });
    assert.deepEqual(
        normalizeUnresolvedPagination({
            page: '2',
            pageSize: '100',
            cursor: '9007199254740991',
            snapshotRevision: '0123456789abcdef0123456789abcdef'
        }),
        {
            page: 2,
            pageSize: 100,
            cursor: 9007199254740991,
            snapshotRevision: '0123456789abcdef0123456789abcdef'
        }
    );
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
    assert.throws(
        () => normalizeUnresolvedPagination({ page: '2' }),
        error => error?.code === 'unresolved_snapshot_context_required' && error?.status === 422
    );
    assert.throws(
        () => normalizeUnresolvedPagination({
            page: '2',
            cursor: '1',
            snapshotRevision: '0123456789ABCDEF0123456789ABCDEF'
        }),
        error => error?.code === 'unresolved_snapshot_revision_invalid' && error?.status === 422
    );
    assert.throws(
        () => normalizeUnresolvedPagination({
            page: '2',
            cursor: '0',
            snapshotRevision: '0123456789abcdef0123456789abcdef'
        }),
        error => error?.code === 'unresolved_cursor_invalid' && error?.status === 422
    );
    assert.throws(
        () => normalizeUnresolvedPagination({ page: '1', cursor: '2' }),
        error => error?.code === 'unresolved_snapshot_context_invalid' && error?.status === 422
    );
    assert.throws(
        () => normalizeUnresolvedPagination({
            page: '1',
            cursor: '2',
            snapshotRevision: '0123456789abcdef0123456789abcdef'
        }),
        error => error?.code === 'unresolved_snapshot_context_invalid' && error?.status === 422
    );
});

test('post-commit outbox wake-up is sequential and preserves the Phase-1 one-job batch', async () => {
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
    assert.equal(canProbeProviderReadiness({ readinessCode: 'shift_opening' }), true);
    assert.equal(canProbeProviderReadiness({ readinessCode: 'shift_closing' }), true);
    assert.equal(canProbeProviderReadiness({ readinessCode: 'local_shift_requires_reconciliation' }), true);
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
        { provider_shift_id: 'shift-one', status: 'closing', lifecycle_stage: 'CLOSING' },
        { provider_shift_id: 'shift-one', status: 'failed', lifecycle_stage: 'OPENING' },
        { provider_shift_id: 'shift-one', status: 'blocked', lifecycle_stage: 'CREATED' },
        { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'CLOSED' },
        { provider_shift_id: 'shift-one', status: 'failed', lifecycle_stage: 'OPENED' }
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
    for (const inconsistentLocalShift of [
        { provider_shift_id: 'shift-one', status: 'failed', lifecycle_stage: 'OPENED' },
        { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'CLOSED' }
    ]) {
        const blockedOpened = resolveProviderShiftReadiness({
            providerShift: { id: 'shift-one', status: 'OPENED' },
            localShift: inconsistentLocalShift
        });
        assert.equal(blockedOpened.shiftState, 'external_open');
        assert.equal(blockedOpened.readinessCode, 'external_shift_requires_sync');
        assert.equal(blockedOpened.localShiftMatched, false);

        const blockedClosed = resolveProviderShiftReadiness({
            providerShift: { id: 'shift-one', status: 'CLOSED' },
            localShift: inconsistentLocalShift
        });
        assert.equal(blockedClosed.shiftState, 'local_stale');
        assert.equal(blockedClosed.readinessCode, 'local_shift_requires_reconciliation');
        assert.equal(blockedClosed.localShiftMatched, false);
    }
    assert.equal(freshShiftContextMatches(
        { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'OPENED' },
        { providerShiftId: 'shift-one', shiftState: 'open' }
    ), true);
    assert.equal(freshShiftContextMatches(
        { provider_shift_id: 'shift-other', status: 'open', lifecycle_stage: 'OPENED' },
        { providerShiftId: 'shift-one', shiftState: 'open' }
    ), false);
});

test('cached readiness never overrides a newer local shift lifecycle', () => {
    const readyClosed = { shift_state: 'closed', provider_shift_id: null };
    assert.deepEqual(reconcileCachedShiftReadiness(readyClosed, null), {
        matches: true,
        shiftState: 'closed',
        readinessCode: null
    });
    assert.deepEqual(
        reconcileCachedShiftReadiness(readyClosed, { status: 'opening', lifecycle_stage: 'OPENING' }),
        { matches: false, shiftState: 'opening', readinessCode: 'shift_opening' }
    );
    assert.deepEqual(
        reconcileCachedShiftReadiness(readyClosed, { status: 'failed', lifecycle_stage: 'OPENING' }),
        { matches: false, shiftState: 'local_stale', readinessCode: 'local_shift_requires_reconciliation' }
    );

    const readyOpen = { shift_state: 'open', provider_shift_id: 'shift-one' };
    assert.equal(reconcileCachedShiftReadiness(readyOpen, {
        provider_shift_id: 'shift-one',
        status: 'open',
        lifecycle_stage: 'OPENED'
    }).matches, true);
    assert.deepEqual(
        reconcileCachedShiftReadiness(readyOpen, {
            provider_shift_id: 'shift-other',
            status: 'open',
            lifecycle_stage: 'OPENED'
        }),
        { matches: false, shiftState: 'open', readinessCode: 'readiness_context_changed' }
    );
    assert.deepEqual(
        reconcileCachedShiftReadiness(readyOpen, { status: 'open', lifecycle_stage: 'CLOSED' }),
        { matches: false, shiftState: 'local_stale', readinessCode: 'local_shift_requires_reconciliation' }
    );
});

test('unexpected provider shift statuses always fail closed', () => {
    for (const status of ['ERROR', 'CANCELLED', 'CLOSING_REQUESTED', 'provider_future_state', '']) {
        for (const localShift of [
            null,
            { provider_shift_id: 'shift-one', status: 'closed', lifecycle_stage: 'CLOSED' },
            { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'OPENED' }
        ]) {
            const blocked = resolveProviderShiftReadiness({
                providerShift: { id: 'shift-one', status },
                localShift
            });
            assert.equal(blocked.shiftState, 'unknown');
            assert.equal(blocked.readinessCode, 'checkbox_shift_status_unknown');
            assert.equal(blocked.localShiftMatched, false);
        }
    }

    const closing = resolveProviderShiftReadiness({
        providerShift: { id: 'shift-one', status: 'CLOSING' },
        localShift: { provider_shift_id: 'shift-one', status: 'open', lifecycle_stage: 'OPENED' }
    });
    assert.equal(closing.shiftState, 'closing');
    assert.equal(closing.readinessCode, 'shift_closing');
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
        /scope\.shift\?\.provider_shift_id[\s\S]*scope\.shift\?\.open_provider_operation_id[\s\S]*if \(localShiftId && \['CREATED', 'OPENING', 'OPENED', 'CLOSING'\]\.includes\(localLifecycle\)\)[\s\S]*getShiftById\(\{ shiftId: localShiftId \}\)[\s\S]*expectedShiftId: localShiftId/
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
    assert.match(service, /result = await probeProviderSingleFlight\(scope, \{ fetchImpl, now, env \}\)/);
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
    const portalCloseSync = service.slice(
        service.indexOf('async function syncPortalClosedShift'),
        service.indexOf('function resolveProviderShiftReadiness')
    );
    assert.match(portalCloseSync, /provider_shift_id = \$4/);
    assert.match(portalCloseSync, /external_stage = CASE[\s\S]*operation\.operation_type = 'shift_open' THEN 'shift_lookup'[\s\S]*ELSE 'shift_close_lookup'/);
    assert.match(portalCloseSync, /fiscal_shift_portal_close_synced/);
    assert.match(portalCloseSync, /\$1::bigint/);
    assert.match(portalCloseSync, /\$2::bigint/);
    assert.match(portalCloseSync, /\$3::text/);
    assert.match(service, /READINESS_PROBE_IN_FLIGHT/);
    assert.match(service, /serializedLatest && serializedLatest\.staleReadiness !== true/);
    assert.match(service, /force = false/);
    assert.match(service, /COALESCE\(register_credential_ref, ''\) = COALESCE\(\$3::text, ''\)/);
    assert.match(service, /COALESCE\(cashier_credential_ref, ''\) = COALESCE\(\$4::text, ''\)/);
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
    assert.match(worker, /candidate_registers AS MATERIALIZED/);
    assert.match(worker, /FOR UPDATE OF fr SKIP LOCKED/);
    assert.match(worker, /JOIN LATERAL[\s\S]*LIMIT 1/);
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
    assert.match(worker, /assertMutationOwnership = \(\) => assertPaymentOutboxJobOwnership/);
    assert.match(worker, /async function assertPaymentOutboxJobOwnership/);
    assert.doesNotMatch(
        worker.slice(worker.indexOf('async function assertPaymentOutboxJobOwnership'), worker.indexOf('async function recordExternalStageInTransaction')),
        /external_stage\s*=/,
        'Lease ownership heartbeats must not roll durable recovery stages backward'
    );
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
    const authoritativeConfirm = paymentService.slice(
        paymentService.indexOf('const result = await withTransaction(dbPool, async client =>', paymentService.indexOf('async function confirmPaymentOrder')),
        paymentService.indexOf('async function cancelDraftPaymentOrder')
    );
    const confirmIdempotencyLockIndex = authoritativeConfirm.indexOf('lockPaymentIdempotency(client, key)');
    const confirmAttemptReplayIndex = authoritativeConfirm.indexOf('findAttemptByIdempotency(client, key)');
    const confirmScopeReadIndex = authoritativeConfirm.indexOf('const scopedOrder = await loadOrderSnapshot');
    const confirmRegisterLockIndex = authoritativeConfirm.indexOf('SELECT pg_advisory_xact_lock($1, $2)');
    const confirmOrderRowLockIndex = authoritativeConfirm.indexOf('FOR UPDATE');
    const confirmFirstWriteIndex = authoritativeConfirm.indexOf('INSERT INTO payment_attempts');
    assert.ok(confirmIdempotencyLockIndex >= 0, 'confirmation must serialize its idempotency key');
    assert.ok(confirmIdempotencyLockIndex < confirmAttemptReplayIndex, 'idempotency lock must precede the authoritative attempt replay lookup');
    assert.ok(confirmAttemptReplayIndex < confirmScopeReadIndex, 'attempt replay must be resolved before acquiring the register scope');
    assert.ok(confirmScopeReadIndex >= 0, 'confirmation must establish its register scope before locking');
    assert.ok(confirmScopeReadIndex < confirmRegisterLockIndex, 'confirmation scope lookup must precede its register lock');
    assert.ok(confirmRegisterLockIndex < confirmOrderRowLockIndex, 'register lock must precede payment order FOR UPDATE');
    assert.ok(confirmRegisterLockIndex < confirmFirstWriteIndex, 'register lock must precede payment/fiscal ledger writes');
    assert.match(authoritativeConfirm, /payment_order_scope_changed/);
    assert.equal(
        (authoritativeConfirm.match(/isCheckboxPaymentAcceptanceEnabled\(env\)/g) || []).length,
        2,
        'payment acceptance must be rechecked after the register lock'
    );
    assert.match(paymentService, /fr\.metadata->>'expected_is_test' AS register_expected_is_test/);
    assert.match(cashierOps, /ensureOpenShiftForSale\(client, \{ order, user, fiscalConfig = null \}\)/);
    assert.match(cashierOps, /expected_is_test: normalizeBoolean\(fiscalSnapshot\.expected_is_test \?\? order\.register_expected_is_test\)/);
    assert.match(cashierOps, /register_credential_ref, cashier_credential_ref, expected_is_test, fiscal_configuration_hash/);
    const phaseOneClose = read('services/payments/paymentReadinessService.js').slice(
        read('services/payments/paymentReadinessService.js').indexOf('async function requestPhase1ShiftClose'),
        read('services/payments/paymentReadinessService.js').indexOf('async function runCheckboxReadinessProbeScheduler')
    );
    const closeLock = read('services/payments/paymentReadinessService.js').slice(
        read('services/payments/paymentReadinessService.js').indexOf('async function lockAndAuthorizePhase1CloseShift'),
        read('services/payments/paymentReadinessService.js').indexOf('function phase1CloseOperationIdempotencyKey')
    );
    assert.match(phaseOneClose, /external_stage: 'auth'/);
    assert.match(phaseOneClose, /action: 'fiscal\.shift\.close'/);
    assert.match(phaseOneClose, /requirePaymentAcceptance: false/);
    assert.match(phaseOneClose, /lockAndAuthorizePhase1CloseShift/);
    assert.match(read('services/payments/paymentReadinessService.js'), /assertPhase1CloseIntegrationOwner\(shift, user\)/);
    assert.match(phaseOneClose, /phase1CloseOperationIdempotencyKey/);
    assert.match(phaseOneClose, /loadPhase1CloseReplay/);
    assert.match(read('services/payments/paymentReadinessService.js'), /async function loadPhase1CloseReplay[\s\S]*replayed: true/);
    assert.match(phaseOneClose, /requestPaymentOutboxWakeup\(\{ batchSize: 1, reason: 'phase1_shift_close_requested' \}\)/);
    assert.match(phaseOneClose, /phase1_shift_close_requested/);
    assert.match(read('services/payments/paymentReadinessService.js'), /async function recordPhase1CloseBlocked/);
    assert.match(read('services/payments/paymentReadinessService.js'), /'phase1_shift_close_blocked'/);
    assert.match(read('services/payments/paymentReadinessService.js'), /'shift\.close_blocked'/);
    assert.match(phaseOneClose, /return \{ shift, replay: null, blocked: \{ blockerCount: blockers \} \}/);
    assert.match(phaseOneClose, /if \(preflight\.blocked\) throw phase1CloseBlockedError/);
    assert.equal((phaseOneClose.match(/assertPhase1ClosePaymentDrain\(env\)/g) || []).length, 2);
    assert.match(closeLock, /lock: false/);
    assert.match(closeLock, /SELECT pg_advisory_xact_lock\(\$1, \$2\)/);
    assert.match(closeLock, /lock: true/);
    assert.ok(closeLock.indexOf('lock: false') < closeLock.indexOf('SELECT pg_advisory_xact_lock'));
    assert.ok(closeLock.indexOf('SELECT pg_advisory_xact_lock') < closeLock.indexOf('lock: true'));
    assert.doesNotMatch(phaseOneClose, /shift_close_already_requested/);
    assert.match(phaseOneClose, /const freshProviderReadiness = await probeCheckboxReadiness\([\s\S]*force: true/);
    assert.match(phaseOneClose, /freshProviderReadiness,[\s\S]*requirePaymentAcceptance: false|requirePaymentAcceptance: false,[\s\S]*freshProviderReadiness/);
    assert.ok(
        phaseOneClose.indexOf('lockAndAuthorizePhase1CloseShift') < phaseOneClose.indexOf('await probeCheckboxReadiness'),
        'Phase-1 close must authorize the exact target shift before provider readiness HTTP'
    );
    assert.ok(
        phaseOneClose.indexOf('const blockers = await countCloseBlockers') < phaseOneClose.indexOf('await probeCheckboxReadiness'),
        'Known unresolved close blockers must fail before provider readiness HTTP'
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
    assert.match(packageJson.scripts['test:checkbox-thin'], /tests\/checkbox-fullstack-testmode-harness\.test\.js/);
    assert.match(packageJson.scripts['test:checkbox-thin'], /tests\/payment-outbox-wakeup\.test\.js/);
    assert.match(packageJson.scripts['test:checkbox-thin'], /tests\/checkbox-shift-db-invariants\.test\.js/);
    assert.match(packageJson.scripts['test:checkbox-thin'], /tests\/payment-outbox-receipt-mismatch\.test\.js/);
    assert.match(ci, /npm run check:checkbox-openapi/);
    assert.match(ci, /npm run check:checkbox-safety/);
    assert.match(ci, /npm run test:checkbox-thin/);
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
    assert.match(js, /JSON\.stringify\(\{ crmProfileKey: PILOT_SCOPE\.crmProfileKey, locationAlias: PILOT_SCOPE\.locationAlias, registerAlias: PILOT_SCOPE\.registerAlias, force \}\)/);
    assert.match(js, /READINESS_REFRESH_MIN_MS/);
    assert.match(js, /READINESS_REFRESH_MAX_MS/);
    assert.match(js, /READINESS_REQUEST_TIMEOUT_MS/);
    assert.match(js, /Черга незавершених чеків недоступна/);
    assert.match(js, /startNextOrder[\s\S]*!unresolvedQueueIsFresh\(\)/);
    assert.match(js, /params\.set\('pageSize', String\(UNRESOLVED_PAGE_SIZE\)\)/);
    assert.match(js, /state\.unresolvedRegisterCount/);
    assert.match(js, /loadUnresolvedOrders\(\{ silent: false, append: true \}\)/);
});

test('cashier UI strictly validates unresolved responses and fails closed while checking or stale', () => {
    const js = read('js/cashier-payments-page.js');
    const loadBlock = js.slice(js.indexOf('async function loadUnresolvedOrders'), js.indexOf('function renderCheckboxSalesReport'));
    const checkingIndex = loadBlock.indexOf("state.unresolvedQueueState = 'checking'");
    const requestIndex = loadBlock.indexOf('await apiRequest(`/api/payments/unresolved-orders');
    assert.ok(checkingIndex >= 0, 'load should enter checking state');
    assert.ok(requestIndex > checkingIndex, 'checking must be set before the unresolved request starts');
    assert.match(loadBlock, /renderUnresolvedOrders\(\);[\s\S]*renderReadinessState\(\);[\s\S]*try \{/);
    assert.match(js, /function normalizeUnresolvedQueuePayload/);
    assert.match(js, /result\.success !== true \|\| result\.registerWide !== true \|\| !Array\.isArray\(result\.orders\)/);
    assert.match(js, /function unresolvedQueueIsFresh/);
    assert.match(js, /const queueState = effectiveUnresolvedQueueState\(\);[\s\S]*const isChecking = queueState === 'checking'/);
    assert.match(js, /data-queue-state="stale"/);
    assert.match(js, /data-queue-state="checking"/);
    assert.match(js, /body\.setAttribute\('aria-busy', isChecking \? 'true' : 'false'\)/);
    assert.match(js, /Останній відомий список збережено нижче, але під час перевірки він може змінитися/);
    assert.match(js, /state\.unresolvedLastKnownOrders/);
    assert.match(js, /queueState === 'checking'[\s\S]*Дочекайтеся завершення перевірки/);
    assert.match(js, /queueState === 'stale'[\s\S]*Дані про незавершені чеки застаріли/);
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
    const closeBlockers = read('services/payments/shiftCloseBlockers.js');
    const routes = read('routes/payments.js');
    const js = read('js/cashier-payments-page.js');
    const listBlock = service.slice(service.indexOf('async function listUnresolvedPaymentOrders'), service.indexOf('async function loadCheckboxSalesReport'));
    assert.match(listBlock, /WITH latest_job AS \(/);
    assert.doesNotMatch(listBlock, /po\.cashier_user_id = \$3/);
    assert.match(listBlock, /po\.fiscal_profile_id = \$1/);
    assert.match(listBlock, /po\.fiscal_register_id = \$2/);
    assert.match(service, /fl\.location_alias = \$2/);
    assert.match(listBlock, /isMine:/);
    assert.match(listBlock, /cashierIdentity:/);
    assert.match(listBlock, /COUNT\(\*\)::integer AS register_count/);
    assert.match(listBlock, /COUNT\(\*\) FILTER \(WHERE cashier_user_id = \$4\)::integer AS my_count/);
    assert.match(listBlock, /md5\(CONCAT\([\s\S]*string_agg\([\s\S]*CONCAT_WS\([\s\S]*id::text[\s\S]*payment_status[\s\S]*fiscal_status[\s\S]*outbox_status[\s\S]*ORDER BY id DESC/);
    assert.match(listBlock, /ORDER BY id DESC[\s\S]*LIMIT \(\$6::integer \+ 1\)/);
    assert.match(listBlock, /WHERE \$5::bigint IS NULL OR id < \$5::bigint/);
    assert.doesNotMatch(listBlock, /\bOFFSET\b/);
    assert.match(listBlock, /pagination\.snapshotRevision !== currentSnapshotRevision/);
    assert.match(listBlock, /'unresolved_snapshot_changed'/);
    assert.match(listBlock, /status: 409/);
    assert.match(listBlock, /const hasMore = candidates\.length > pagination\.pageSize/);
    assert.match(listBlock, /snapshotRevision: currentSnapshotRevision/);
    assert.match(listBlock, /nextCursor/);
    assert.match(routes, /normalizeUnresolvedPagination\(\{[\s\S]*page: req\.query\.page,[\s\S]*pageSize: req\.query\.pageSize \?\? req\.query\.page_size,[\s\S]*cursor: req\.query\.cursor,[\s\S]*snapshotRevision: req\.query\.snapshotRevision \?\? req\.query\.snapshot_revision/);
    assert.match(service, /async function countCloseBlockers[\s\S]*countFiscalShiftCloseBlockers/);
    assert.match(closeBlockers, /po\.fiscal_register_id = \$2/);
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
    assert.match(service, /WHEN outbox_status = 'failed'[\s\S]*WHEN max_attempts > 0 AND attempts >= max_attempts THEN 'failed_terminal'/);
    assert.match(service, /WHEN outbox_status = 'queued' AND fiscal_status = 'failed' THEN 'failed_retryable'/);
    assert.doesNotMatch(service, /outbox_status IN \('failed', 'claimed', 'running'\)/, 'In-flight jobs must remain pending rather than appear retryable-failed');
    assert.match(service, /totalCount: Number\(totalsRow\.total_count \|\| 0\)/);
    assert.match(js, /params\.set\('cashierUserId', cashierUserId\)/);
    assert.match(js, /params\.set\('pageSize', '50'\)/);
    assert.match(js, /Суми пораховані по всьому фільтру/);
    assert.doesNotMatch(js, /Z-звіт[^.]*офіційний/, 'Internal report must not be presented as an official Z-report');
});

test('cashier payment routes require exact fiscal scope and do not default to park FOP', () => {
    const routes = read('routes/payments.js');
    const js = read('js/cashier-payments-page.js');
    const readiness = read('services/payments/paymentReadinessService.js');
    const paymentService = read('services/payments/paymentService.js');
    assert.match(routes, /function requirePaymentFiscalScope/);
    assert.match(routes, /locationAlias: fiscalScopeValueFromRequest\(req, 'locationAlias', 'location_alias'\)/);
    assert.match(routes, /throw new PaymentReadinessError\('fiscal_scope_required'/);
    assert.doesNotMatch(routes, /\|\| 'event_genix'/);
    assert.doesNotMatch(routes, /\|\| 'middle'/);
    assert.match(js, /locationAlias: 'park'/);
    assert.match(js, /X-Cashier-Pilot-Scope'\] = `\$\{PILOT_SCOPE\.crmProfileKey\}:\$\{PILOT_SCOPE\.locationAlias\}:\$\{PILOT_SCOPE\.registerAlias\}`/);
    assert.match(paymentService, /function normalizeRequiredPaymentScope/);
    assert.match(paymentService, /fiscal_location_alias_required/);
    assert.match(paymentService, /const fiscalScope = normalizeRequiredPaymentScope\(body\)/);
    assert.doesNotMatch(paymentService, /crm_profile_not_supported_for_pilot/);
    assert.doesNotMatch(paymentService, /crmProfileKey = PILOT_CRM_PROFILE_KEY/);
    assert.doesNotMatch(paymentService, /locationAlias = PILOT_LOCATION_ALIAS/);
    assert.doesNotMatch(paymentService, /registerAlias = PILOT_REGISTER_ALIAS/);
    assert.match(readiness, /function normalizeFiscalScope/);
    assert.match(readiness, /fiscal_location_alias_required/);
    assert.match(readiness, /fiscalLocationId: Number\(scope\.mapping\?\.fiscal_location_id/);
    assert.doesNotMatch(readiness, /crmProfileKey = PILOT_CRM_PROFILE_KEY/);
    assert.doesNotMatch(readiness, /locationAlias = PILOT_LOCATION_ALIAS/);
    assert.doesNotMatch(readiness, /registerAlias = PILOT_REGISTER_ALIAS/);
});

test('Checkbox sales report rejects fractional pagination and impossible date filters before PostgreSQL', async () => {
    const dbPool = {
        async connect() {
            throw new Error('database must not be reached for invalid report input');
        }
    };
    const cases = [
        [{ page: '1.5' }, 'checkbox_report_page_invalid'],
        [{ page: 'Infinity' }, 'checkbox_report_page_invalid'],
        [{ pageSize: '2.5' }, 'checkbox_report_page_size_invalid'],
        [{ pageSize: '101' }, 'checkbox_report_page_size_invalid'],
        [{ dateFrom: '2026-02-30' }, 'checkbox_report_date_from_invalid'],
        [{ dateTo: '2026-99-99' }, 'checkbox_report_date_to_invalid'],
        [{ dateFrom: '2026-09-04', dateTo: '2026-09-03' }, 'checkbox_report_date_range_invalid']
    ];
    for (const [input, expectedCode] of cases) {
        await assert.rejects(
            () => loadCheckboxSalesReport({ dbPool, user: { id: 1 }, ...input }),
            error => error?.code === expectedCode && error?.status === 422
        );
    }
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

test('provider-closed reconciliation revives one lookup-only recovery and scheduler deduplicates provider context', () => {
    const service = read('services/payments/paymentReadinessService.js');
    const syncBlock = service.slice(
        service.indexOf('async function syncPortalClosedShift'),
        service.indexOf('function resolveProviderShiftReadiness')
    );
    const schedulerBlock = service.slice(
        service.indexOf('async function runCheckboxReadinessProbeScheduler'),
        service.indexOf('module.exports')
    );
    const incidentMutation = service.slice(
        service.indexOf('async function updateOperationalIncidentStatus'),
        service.indexOf('async function loadPhase1CloseReplay')
    );
    assert.match(syncBlock, /open_operation\.provider_operation_id AS open_provider_operation_id/);
    assert.match(syncBlock, /recoveredFromOpenOperation/);
    assert.match(syncBlock, /portal_closed_dead_recovery_used/);
    assert.match(syncBlock, /max_attempts = CASE WHEN job\.status = 'dead' THEN job\.max_attempts \+ 1/);
    assert.match(syncBlock, /operation\.operation_type = 'shift_open' THEN 'shift_lookup'/);
    assert.match(syncBlock, /operation\.operation_type = 'shift_close' THEN 'shift_close_lookup'|ELSE 'shift_close_lookup'/);
    assert.match(syncBlock, /recoveryQueued: recoveryJobs\.rows\.length > 0/);
    assert.match(service, /reason: 'provider_closed_shift_recovery'/);
    assert.match(service, /reason: 'scheduler_provider_closed_shift_recovery'/);
    assert.match(schedulerBlock, /SELECT DISTINCT ON \(/);
    assert.match(schedulerBlock, /fcb\.provider_cashier_id/);
    assert.match(schedulerBlock, /fcb\.provider_cashier_login_ref/);
    assert.match(schedulerBlock, /fr\.provider_license_ref/);
    assert.match(service, /let READINESS_SCHEDULER_IN_FLIGHT = null/);
    assert.match(service, /if \(READINESS_SCHEDULER_IN_FLIGHT\) return READINESS_SCHEDULER_IN_FLIGHT/);
    assert.match(incidentMutation, /lockConfiguration: true/);
});

test('readiness scheduler fairly selects missing and oldest provider contexts before recent snapshots', () => {
    const service = read('services/payments/paymentReadinessService.js');
    const schedulerBlock = service.slice(
        service.indexOf('async function runCheckboxReadinessProbeSchedulerOnce'),
        service.indexOf('async function runCheckboxReadinessProbeScheduler(options')
    );
    assert.match(schedulerBlock, /WITH provider_contexts AS/);
    assert.match(schedulerBlock, /LEFT JOIN LATERAL \([\s\S]*FROM checkbox_readiness_snapshots snapshot/);
    assert.match(schedulerBlock, /snapshot\.fiscal_profile_id = context\.fiscal_profile_id/);
    assert.match(schedulerBlock, /snapshot\.fiscal_register_id = context\.fiscal_register_id/);
    assert.match(schedulerBlock, /snapshot\.provider_cashier_id[\s\S]*context\.provider_cashier_id/);
    assert.match(schedulerBlock, /snapshot\.register_credential_ref[\s\S]*context\.scheduler_register_credential_ref/);
    assert.match(schedulerBlock, /snapshot\.cashier_credential_ref[\s\S]*context\.provider_cashier_login_ref/);
    assert.match(schedulerBlock, /ORDER BY snapshot\.checked_at DESC, snapshot\.id DESC[\s\S]*LIMIT 1/);
    assert.match(schedulerBlock, /latest_readiness\.checked_at ASC NULLS FIRST/);
    assert.match(
        schedulerBlock,
        /latest_readiness\.checked_at ASC NULLS FIRST,[\s\S]*context\.fiscal_profile_id,[\s\S]*context\.fiscal_register_id,[\s\S]*context\.id[\s\S]*LIMIT 20/,
        'a successful batch refresh moves its contexts behind the 21st missing or older context on the next scheduler tick'
    );
});

test('manual refresh and scheduler share one provider read but persist independently', async () => {
    const service = read('services/payments/paymentReadinessService.js');
    const manualBlock = service.slice(
        service.indexOf('async function probeCheckboxReadiness'),
        service.indexOf('function readinessFailureStatus')
    );
    const schedulerBlock = service.slice(
        service.indexOf('async function runCheckboxReadinessProbeSchedulerOnce'),
        service.indexOf('async function runCheckboxReadinessProbeScheduler(options')
    );
    assert.match(manualBlock, /probeProviderSingleFlight\(scope/);
    assert.match(schedulerBlock, /probeProviderSingleFlight\(prepared\.scope/);
    assert.doesNotMatch(manualBlock, /await probeProvider\(scope/);
    assert.doesNotMatch(schedulerBlock, /await probeProvider\(prepared\.scope/);

    const scope = {
        mapping: {
            fiscal_profile_id: 17,
            fiscal_register_id: 29,
            provider_license_ref: 'park_middle_register'
        },
        binding: {
            provider_cashier_id: 'test-cashier',
            provider_cashier_login_ref: 'park_middle_cashier'
        },
        configHash: 'exact-config-hash',
        shift: {
            id: 41,
            status: 'open',
            lifecycle_stage: 'OPENED',
            provider_shift_id: 'test-shift'
        }
    };
    let providerReads = 0;
    let releaseProvider;
    const providerGate = new Promise(resolve => { releaseProvider = resolve; });
    const executeProbe = async () => {
        providerReads += 1;
        await providerGate;
        return { state: { readinessCode: 'ready' }, details: { sanitized: true } };
    };
    let persistedResults = 0;
    const persistOwnResult = async promise => {
        const result = await promise;
        persistedResults += 1;
        return result;
    };
    const manual = persistOwnResult(__readinessProbeTest.probeProviderSingleFlight(scope, {}, executeProbe));
    const scheduler = persistOwnResult(__readinessProbeTest.probeProviderSingleFlight(scope, {}, executeProbe));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(providerReads, 1, 'concurrent manual and scheduler paths must share one provider read sequence');
    releaseProvider();
    const [manualResult, schedulerResult] = await Promise.all([manual, scheduler]);
    assert.deepEqual(manualResult, schedulerResult);
    assert.equal(persistedResults, 2, 'each caller remains responsible for persisting its own safe observation');
});

test('overlapping readiness scheduler ticks share one in-process pass', async () => {
    let queryCalls = 0;
    let releaseCalls = 0;
    let releaseQuery;
    const queryGate = new Promise(resolve => { releaseQuery = resolve; });
    const dbPool = {
        async connect() {
            return {
                async query() {
                    queryCalls += 1;
                    await queryGate;
                    return { rows: [] };
                },
                release() {
                    releaseCalls += 1;
                }
            };
        }
    };
    const first = runCheckboxReadinessProbeScheduler({
        dbPool,
        env: { CHECKBOX_INTEGRATION_ENABLED: 'true' }
    });
    await new Promise(resolve => setImmediate(resolve));
    const second = runCheckboxReadinessProbeScheduler({
        dbPool,
        env: { CHECKBOX_INTEGRATION_ENABLED: 'true' }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queryCalls, 1, 'overlapping tick must not start a second scheduler query');
    releaseQuery();
    assert.deepEqual(await first, { ok: true, probed: 0, failed: 0 });
    assert.deepEqual(await second, { ok: true, probed: 0, failed: 0 });
    assert.equal(releaseCalls, 1);
});

test('shift-open worker accepts exact CLOSED observation only as lookup-only reconciliation', () => {
    const worker = read('services/payments/paymentOutboxWorker.js');
    const shiftFinalize = worker.slice(
        worker.indexOf('async function markShiftJobSucceeded'),
        worker.indexOf('async function runShiftJob')
    );
    assert.match(shiftFinalize, /\['OPENED', 'CLOSED'\]\.includes\(providerStatus\)/);
    assert.match(shiftFinalize, /actualShiftId !== expectedShiftId/);
    assert.match(shiftFinalize, /provider_shift_id = COALESCE\(provider_shift_id, \$3\)/);
    assert.match(shiftFinalize, /open_operation_id = \$6/);
    assert.match(shiftFinalize, /fiscal_shift_open_observed_closed/);
    assert.match(shiftFinalize, /recovery_policy: 'exact_open_uuid_lookup_only'/);
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
    assert.match(worker, /receiptMismatchEvidenceRecorded = true/);
    assert.match(worker, /async function finalizeReceiptJobInTransaction/);
    assert.match(worker, /await markJobFailed\(client, context, errorInfo\)/);
    assert.match(worker, /provider_tax_url = COALESCE\(fiscal_receipts\.provider_tax_url, EXCLUDED\.provider_tax_url\)/);
    assert.match(worker, /provider_snapshot = CASE[\s\S]*fiscal_receipts\.provider_snapshot = '\{\}'::jsonb/);
});

test('configuration CLI authorizes mutating actor inside transaction and fails closed on credential prefix collisions', () => {
    const cli = read('scripts/configure-checkbox-park-pilot.js');
    assert.match(cli, /async function assertNoStoredCredentialRefCollisions/);
    assert.match(cli, /SELECT provider_license_ref AS credential_ref[\s\S]*UNION ALL[\s\S]*provider_cashier_login_ref AS credential_ref/);
    const transactionStart = cli.indexOf("await client.query('BEGIN')");
    const targetLock = cli.indexOf('await acquirePilotConfigTargetLock(client, plan)', transactionStart);
    const actorAuthorization = cli.indexOf('await assertMutationActorAuthorized(client, plan)', targetLock);
    assert.ok(transactionStart >= 0, 'configuration mutation must start a database transaction');
    assert.ok(targetLock > transactionStart, 'configuration target lock must be acquired inside the transaction');
    assert.ok(actorAuthorization > targetLock, 'actor authorization must run after the target lock and inside the transaction');
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
