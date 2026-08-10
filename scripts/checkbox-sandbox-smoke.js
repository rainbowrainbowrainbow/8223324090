#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { CheckboxClient } = require('../services/checkbox/client');
const { loadCheckboxSandboxConfig, publicConfigSummary } = require('../services/checkbox/config');
const { CheckboxClientError, redactCheckboxDiagnostics } = require('../services/checkbox/errors');
const { mapFullReturnReceipt, mapSaleReceipt, mapServiceReceipt } = require('../services/checkbox/mapper');
const { createProviderFromConfig } = require('../services/checkbox/provider');
const { WebhookReplayGuard, signCheckboxWebhookBody, verifyCheckboxWebhookSignature } = require('../services/checkbox/signature');

const REQUIRED_OPENAPI_PATHS = Object.freeze({
    '/api/v1/cashier/signin': ['post'],
    '/api/v1/cashier/signinPinCode': ['post'],
    '/api/v1/cashier/me': ['get'],
    '/api/v1/cash-registers/info': ['get'],
    '/api/v1/cashier/check-signature': ['get'],
    '/api/v1/cashier/tax': ['get'],
    '/api/v1/cashier/shift': ['get'],
    '/api/v1/shifts': ['get', 'post'],
    '/api/v1/shifts/close': ['post'],
    '/api/v1/receipts/validate': ['post'],
    '/api/v1/receipts/sell': ['post'],
    '/api/v1/receipts/service': ['post'],
    '/api/v1/receipts/{receipt_id}': ['get'],
    '/api/v1/receipts/{receipt_id}/pdf': ['get'],
    '/api/v1/receipts/{receipt_id}/qrcode': ['get']
});

function logStep(name, details = {}) {
    console.log(JSON.stringify({ step: name, ...redactCheckboxDiagnostics(details) }));
}

function fail(error) {
    const status = error instanceof CheckboxClientError ? error.status || 1 : 1;
    console.error(JSON.stringify({
        ok: false,
        code: error?.code || error?.name || 'checkbox_sandbox_smoke_failed',
        message: redactCheckboxDiagnostics(error?.message || 'Checkbox sandbox smoke failed'),
        details: redactCheckboxDiagnostics(error?.details || {})
    }));
    process.exit(status === 2 ? 2 : 1);
}

async function fetchOfficialOpenApi(openApiUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(openApiUrl, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new CheckboxClientError('checkbox_openapi_fetch_failed', `OpenAPI fetch failed with HTTP ${response.status}`, { status: 1 });
        const contract = await response.json();
        if (!contract.paths || !contract.info) throw new CheckboxClientError('checkbox_openapi_invalid', 'OpenAPI response is missing paths/info', { status: 1 });
        for (const [path, methods] of Object.entries(REQUIRED_OPENAPI_PATHS)) {
            const pathSpec = contract.paths[path];
            if (!pathSpec) throw new CheckboxClientError('checkbox_openapi_required_path_missing', `OpenAPI missing ${path}`, { status: 1, details: { path } });
            for (const method of methods) {
                if (!pathSpec[method]) throw new CheckboxClientError('checkbox_openapi_required_method_missing', `OpenAPI missing ${method.toUpperCase()} ${path}`, { status: 1, details: { path, method } });
                assertOpenApiOperationContract(contract, path, method, pathSpec[method]);
            }
        }
        assertOpenApiGlobalContract(contract);
        return { title: contract.info.title, version: contract.info.version, openapi: contract.openapi };
    } finally {
        clearTimeout(timer);
    }
}

function assertOpenApiOperationContract(contract, path, method, operation = {}) {
    if (!operation.responses || !Object.keys(operation.responses).length) {
        throw new CheckboxClientError('checkbox_openapi_responses_missing', `OpenAPI ${method.toUpperCase()} ${path} is missing response codes`, { status: 1, details: { path, method } });
    }
    if (['post', 'put', 'patch'].includes(method) && !operation.requestBody && !operation.parameters) {
        throw new CheckboxClientError('checkbox_openapi_request_contract_missing', `OpenAPI ${method.toUpperCase()} ${path} is missing request contract`, { status: 1, details: { path, method } });
    }
    const receiptSellPaths = new Set(['/api/v1/receipts/validate', '/api/v1/receipts/sell']);
    const requestSchema = operation.requestBody?.content?.['application/json']?.schema;
    if (receiptSellPaths.has(path) && method === 'post' && (!schemaContainsProperty(contract, requestSchema, 'goods') || !schemaContainsProperty(contract, requestSchema, 'payments'))) {
        throw new CheckboxClientError('checkbox_openapi_receipt_payload_incomplete', `OpenAPI ${method.toUpperCase()} ${path} does not expose goods/payments contract`, { status: 1, details: { path, method } });
    }
    if ((path.includes('/shifts') || path.includes('/receipts')) && !/(security|authorization|x-license-key|x-access-key|x-device-id)/i.test(JSON.stringify(operation))) {
        const globalSecurity = JSON.stringify(contract.security || contract.components?.securitySchemes || {});
        if (!/(authorization|bearer|x-license-key|x-access-key|x-device-id)/i.test(globalSecurity)) {
            throw new CheckboxClientError('checkbox_openapi_auth_contract_missing', `OpenAPI ${method.toUpperCase()} ${path} does not expose auth/header contract`, { status: 1, details: { path, method } });
        }
    }
}

function resolveLocalOpenApiRef(contract, ref) {
    if (!String(ref || '').startsWith('#/')) return null;
    return String(ref).slice(2).split('/').reduce((value, segment) => {
        if (!value || typeof value !== 'object') return null;
        return value[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
    }, contract);
}

function schemaContainsProperty(contract, schema, propertyName, seen = new Set()) {
    if (!schema || typeof schema !== 'object') return false;
    if (schema.$ref) {
        if (seen.has(schema.$ref)) return false;
        seen.add(schema.$ref);
        return schemaContainsProperty(contract, resolveLocalOpenApiRef(contract, schema.$ref), propertyName, seen);
    }
    if (schema.properties && Object.hasOwn(schema.properties, propertyName)) return true;
    for (const branchKey of ['allOf', 'anyOf', 'oneOf']) {
        if (Array.isArray(schema[branchKey]) && schema[branchKey].some(branch => schemaContainsProperty(contract, branch, propertyName, new Set(seen)))) return true;
    }
    return false;
}

function assertOpenApiGlobalContract(contract) {
    const encoded = JSON.stringify(contract);
    const missing = [];
    for (const marker of ['OPENED', 'DONE', 'ERROR', 'CANCELLED']) {
        if (!encoded.includes(marker)) missing.push(marker);
    }
    if (!/x-request-signature/i.test(encoded)) missing.push('x-request-signature');
    if (!/(quantity|price|sum|payments)/i.test(encoded)) missing.push('money_quantity_units');
    if (missing.length) {
        throw new CheckboxClientError('checkbox_openapi_contract_marker_missing', 'OpenAPI contract is missing required status/header/unit markers', { status: 1, details: { missing } });
    }
}

function buildSandboxSalePayload(config, runId) {
    const amountMinor = config.amountMinor;
    return mapSaleReceipt({
        providerRequestUuid: crypto.randomUUID(),
        amountMinor,
        tender: 'cash',
        items: [{
            code: `eventgenix-sandbox-ticket-${runId}`,
            name: `EventGenix sandbox park ticket ${runId}`,
            priceMinor: amountMinor,
            quantityMillis: 1000,
            tax: config.taxCode ? [config.taxCode] : undefined
        }],
        context: { run_id: runId, source: 'eventgenix_checkbox_sandbox_smoke' }
    });
}

async function waitReceiptDone(client, receiptId) {
    let latest = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        latest = await client.lookupReceipt({ receiptId });
        const status = String(latest?.status || '').toUpperCase();
        if (status === 'DONE') return latest;
        if (status === 'ERROR' || status === 'CANCELLED') {
            throw new CheckboxClientError('checkbox_sandbox_receipt_terminal_failure', `Sandbox receipt ended with ${status}`, { status: 1, details: { receiptId, providerStatus: status } });
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    throw new CheckboxClientError('checkbox_sandbox_receipt_done_timeout', 'Sandbox receipt did not reach DONE in time', { status: 1, details: { receiptId, lastStatus: latest?.status || null } });
}

function firstText(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) return text;
    }
    return null;
}

function assertSame(actual, expected, code, field) {
    if (!expected) return;
    if (String(actual || '') !== String(expected)) {
        throw new CheckboxClientError(code, `Sandbox ${field} identity mismatch`, { status: 2, retryable: false, details: { field, expected, actual: actual || null } });
    }
}

function assertExpectedSandboxIdentityConfig(config) {
    const missing = [];
    if (!config.expectedOrganizationId) missing.push('CHECKBOX_SANDBOX_EXPECT_ORGANIZATION_ID');
    if (!config.expectedRegisterId) missing.push('CHECKBOX_SANDBOX_EXPECT_REGISTER_ID');
    if (!config.expectedCashierId) missing.push('CHECKBOX_SANDBOX_EXPECT_CASHIER_ID');
    if (missing.length) {
        throw new CheckboxClientError('checkbox_sandbox_expected_identity_missing', 'Exact expected Checkbox test identity env is required before mutations', { status: 2, retryable: false, details: { missing } });
    }
}

function shiftIdentity(shift = {}) {
    return {
        shiftId: firstText(shift.id, shift.shift_id),
        status: String(shift.status || '').toUpperCase(),
        registerId: firstText(shift.cash_register_id, shift.register_id, shift.cash_register?.id, shift.cash_register?.register_id),
        cashierId: firstText(shift.cashier_id, shift.cashier?.id, shift.cashier?.cashier_id),
        organizationId: firstText(shift.organization_id, shift.organization?.id, shift.cash_register?.organization_id, shift.cash_register?.organization?.id)
    };
}

function assertShiftIdentity(shift, config) {
    const identity = shiftIdentity(shift);
    assertSame(identity.registerId, config.expectedRegisterId, 'checkbox_sandbox_shift_register_mismatch', 'shift.cash_register.id');
    assertSame(identity.cashierId, config.expectedCashierId, 'checkbox_sandbox_shift_cashier_mismatch', 'shift.cashier.id');
    assertSame(identity.organizationId, config.expectedOrganizationId, 'checkbox_sandbox_shift_organization_mismatch', 'shift.organization.id');
    return identity;
}

async function waitShiftOpened(client, shift, config) {
    let current = shift;
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const identity = assertShiftIdentity(current, config);
        if (identity.status === 'OPENED') return current;
        if (identity.status === 'ERROR' || identity.status === 'CANCELLED' || identity.status === 'CLOSED') {
            throw new CheckboxClientError('checkbox_sandbox_shift_terminal_failure', `Sandbox shift ended with ${identity.status}`, { status: 1, details: identity });
        }
        if (identity.shiftId && client.getShiftById) current = await client.getShiftById({ shiftId: identity.shiftId });
        else current = await client.getCurrentShift();
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    throw new CheckboxClientError('checkbox_sandbox_shift_open_timeout', 'Sandbox shift did not reach OPENED in time', { status: 1, details: shiftIdentity(current) });
}

function runWebhookSignatureReplayCheck(config) {
    if (!config.webhookSecret) {
        logStep('webhook-signature-skipped', { reason: 'CHECKBOX_SANDBOX_WEBHOOK_SECRET is not configured' });
        return;
    }
    const rawBody = Buffer.from(JSON.stringify({ event: 'receipt.done', id: crypto.randomUUID() }));
    const signature = signCheckboxWebhookBody(rawBody, config.webhookSecret);
    verifyCheckboxWebhookSignature({ rawBody, signatureHeader: signature, signingSecret: config.webhookSecret });
    const guard = new WebhookReplayGuard();
    const eventId = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const first = guard.remember(eventId, hash);
    const replay = guard.remember(eventId, hash);
    const conflict = guard.remember(eventId, crypto.randomUUID().replace(/-/g, ''));
    if (!first.accepted || !replay.replay || !conflict.conflict) {
        throw new CheckboxClientError('checkbox_webhook_replay_guard_failed', 'Webhook replay guard did not detect replay/conflict', { status: 1 });
    }
    logStep('webhook-signature-replay-ok');
}

async function runTimeoutLookupRecoveryCheck(config) {
    const receiptId = crypto.randomUUID();
    let saleCalls = 0;
    const fakeFetch = async (url, request = {}) => {
        if (String(url).includes('/api/v1/receipts/sell')) {
            saleCalls += 1;
            const error = new Error('sandbox timeout after provider accepted receipt');
            error.name = 'AbortError';
            throw error;
        }
        if (String(url).includes(`/api/v1/receipts/${receiptId}`)) {
            return new Response(JSON.stringify({ id: receiptId, status: 'DONE' }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: true, request }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new CheckboxClient({ ...config, fetchImpl: fakeFetch, timeoutMs: 1000 });
    client.setAccessToken('sandbox-local-token');
    try {
        await client.createSaleReceipt(mapSaleReceipt({
            providerRequestUuid: receiptId,
            amountMinor: config.amountMinor,
            items: [{ code: 'timeout-lookup', name: 'Timeout lookup check', priceMinor: config.amountMinor, quantityMillis: 1000 }]
        }));
    } catch (error) {
        if (!error.unknown) throw error;
    }
    const lookup = await client.lookupReceipt({ receiptId });
    if (saleCalls !== 1 || lookup?.status !== 'DONE') {
        throw new CheckboxClientError('checkbox_timeout_lookup_recovery_failed', 'Timeout recovery must lookup existing receipt without a second sale call', { status: 1 });
    }
    logStep('timeout-lookup-recovery-ok', { saleCalls });
}

async function runSandboxSmoke() {
    const config = loadCheckboxSandboxConfig(process.env);
    logStep('sandbox-config', publicConfigSummary(config));
    const contract = await fetchOfficialOpenApi(config.openApiUrl);
    logStep('openapi-contract-ok', contract);

    if (!config.readinessOnly && !config.confirmMutations) {
        throw new CheckboxClientError('checkbox_sandbox_mutation_confirmation_required', 'Set CHECKBOX_SANDBOX_CONFIRM_MUTATIONS=sandbox to run real sandbox fiscal operations', { status: 2 });
    }
    assertExpectedSandboxIdentityConfig(config);

    const provider = createProviderFromConfig(config);
    const expectedIdentity = {
        expectedOrganizationId: config.expectedOrganizationId,
        expectedRegisterId: config.expectedRegisterId,
        expectedCashierId: config.expectedCashierId,
        expectedIsTest: true
    };
    const expectedTaxes = { expectedTaxIds: config.taxCode ? [config.taxCode] : [] };

    if (config.readinessOnly) {
        const diagnostics = await provider.collectReadinessDiagnostics(expectedIdentity, expectedTaxes);
        logStep('cashier-readiness-checklist', diagnostics);
        console.log(JSON.stringify({ ok: diagnostics.ready, smoke: 'checkbox:sandbox:readiness', mutations: false, readiness: diagnostics }));
        if (!diagnostics.ready) process.exit(2);
        return;
    }

    const readiness = await provider.verifyReadiness(expectedIdentity, expectedTaxes);
    const client = provider.client;
    logStep('cashier-readiness-ok', {
        cashierId: readiness.cashier?.cashierId || null,
        organizationId: readiness.cashier?.organizationId || null,
        registerId: readiness.register?.registerId || null,
        isTest: readiness.register?.isTest === true,
        signatureAvailable: readiness.signature?.online === true,
        taxCount: readiness.taxes?.availableCount || 0,
        authMode: config.authMode
    });

    let shift = await client.getCurrentShift().catch(error => {
        if (error.status === 404 || error.status === 422) return null;
        throw error;
    });
    if (!shift || !['OPENED', 'OPENING'].includes(String(shift.status || '').toUpperCase())) {
        shift = await client.openShift({ providerRequestUuid: crypto.randomUUID() });
        logStep('shift-open-requested', { shiftId: shift?.id || null, status: shift?.status || null });
    } else {
        logStep('shift-already-open', { shiftId: shift?.id || null, status: shift?.status || null });
    }
    shift = await waitShiftOpened(client, shift, config);
    logStep('shift-opened-ok', shiftIdentity(shift));

    const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const salePayload = buildSandboxSalePayload(config, runId);
    await client.validateSale(salePayload);
    logStep('sale-validation-ok', { receiptId: salePayload.id });
    const sale = await client.createSaleReceipt(salePayload);
    const saleReceiptId = sale?.id || salePayload.id;
    logStep('sale-created', { receiptId: saleReceiptId, status: sale?.status || null });
    const saleStatus = await waitReceiptDone(client, saleReceiptId);
    logStep('sale-status-lookup-ok', { receiptId: saleReceiptId, status: saleStatus?.status || null });
    const pdf = await client.getReceiptDocument({ receiptId: saleReceiptId, format: 'pdf' });
    logStep('sale-document-ok', { receiptId: saleReceiptId, pdfBytes: Buffer.isBuffer(pdf) ? pdf.length : 0 });

    if (config.includeProOperations) {
        const serviceIn = await client.createServiceReceipt(mapServiceReceipt({ providerRequestUuid: crypto.randomUUID(), operationType: 'service_in', amountMinor: config.amountMinor, context: { run_id: runId } }));
        logStep('service-in-created', { receiptId: serviceIn?.id || null, status: serviceIn?.status || null });
        const serviceOut = await client.createServiceReceipt(mapServiceReceipt({ providerRequestUuid: crypto.randomUUID(), operationType: 'service_out', amountMinor: config.amountMinor, context: { run_id: runId } }));
        logStep('service-out-created', { receiptId: serviceOut?.id || null, status: serviceOut?.status || null });

        const returnPayload = mapFullReturnReceipt({ providerRequestUuid: crypto.randomUUID(), originalReceiptId: saleReceiptId, originalSalePayload: salePayload, context: { run_id: runId } });
        const returned = await client.createReturnReceipt(returnPayload);
        logStep('full-return-created', { receiptId: returned?.id || returnPayload.id, originalReceiptId: saleReceiptId, status: returned?.status || null });
        await waitReceiptDone(client, returned?.id || returnPayload.id);
        logStep('full-return-status-lookup-ok', { receiptId: returned?.id || returnPayload.id });
    } else {
        logStep('phase2-operations-skipped', { reason: 'CHECKBOX_SANDBOX_INCLUDE_PRO is not enabled' });
    }

    runWebhookSignatureReplayCheck(config);
    await runTimeoutLookupRecoveryCheck(config);

    if (config.closeShift) {
        const closed = await client.closeShift({ providerRequestUuid: crypto.randomUUID() });
        logStep('shift-close-requested', { shiftId: closed?.id || shift?.id || null, status: closed?.status || null });
    }
    console.log(JSON.stringify({ ok: true, smoke: 'checkbox:sandbox' }));
}

if (require.main === module) runSandboxSmoke().catch(fail);

module.exports = {
    assertOpenApiOperationContract,
    fetchOfficialOpenApi,
    resolveLocalOpenApiRef,
    runSandboxSmoke,
    schemaContainsProperty
};
