#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { CheckboxClient } = require('../services/checkbox/client');
const { loadCheckboxSandboxConfig, publicConfigSummary } = require('../services/checkbox/config');
const { CheckboxClientError, redactCheckboxDiagnostics } = require('../services/checkbox/errors');
const { mapFullReturnReceipt, mapSaleReceipt, mapServiceReceipt } = require('../services/checkbox/mapper');
const { createProviderFromConfig, normalizeReceiptArtifacts } = require('../services/checkbox/provider');
const { WebhookReplayGuard, signCheckboxWebhookBody, verifyCheckboxWebhookSignature } = require('../services/checkbox/signature');

const REQUIRED_OPENAPI_PATHS = Object.freeze({
    '/api/v1/cashier/signin': ['post'],
    '/api/v1/cashier/signinPinCode': ['post'],
    '/api/v1/cashier/signout': ['post'],
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

function isProviderIdentityKey(key) {
    return /^(?:id|receipt_?id|shift_?id|register_?id|cashier_?id|organization_?id|provider_?(?:receipt|shift|register|cashier|organization)_?id|expected_?(?:receipt|shift|register|cashier|organization)_?id)$/i.test(String(key || '').replace(/-/g, '_'));
}

function publicSandboxEvidence(value) {
    const redacted = redactCheckboxDiagnostics(value);
    if (redacted == null || typeof redacted !== 'object') return redacted;
    if (Array.isArray(redacted)) return redacted.map(publicSandboxEvidence);
    const output = {};
    const identityMismatch = /(?:id|register|cashier|organization|shift|receipt)/i.test(String(redacted.field || ''));
    for (const [key, item] of Object.entries(redacted)) {
        if (isProviderIdentityKey(key)) continue;
        if (identityMismatch && /^(?:expected|actual)$/i.test(key)) continue;
        output[key] = publicSandboxEvidence(item);
    }
    return output;
}

function logStep(name, details = {}) {
    console.log(JSON.stringify({ step: name, ...publicSandboxEvidence(details) }));
}

function fail(error) {
    const status = error instanceof CheckboxClientError ? error.status || 1 : 1;
    console.error(JSON.stringify({
        ok: false,
        code: error?.code || error?.name || 'checkbox_sandbox_smoke_failed',
        message: redactCheckboxDiagnostics(error?.message || 'Checkbox sandbox smoke failed'),
        details: publicSandboxEvidence(error?.details || {})
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

function buildSandboxSalePayload(config, runId, tender = 'cash', context = {}) {
    const amountMinor = config.amountMinor;
    const paymentType = tender === 'cash' ? 'cash' : 'cashless';
    return mapSaleReceipt({
        providerRequestUuid: crypto.randomUUID(),
        amountMinor,
        tender,
        items: [{
            code: `eventgenix-sandbox-${paymentType}-${runId}`,
            name: `EventGenix sandbox park ${paymentType} ${runId}`,
            priceMinor: amountMinor,
            quantityMillis: 1000,
            tax: config.taxCode ? [config.taxCode] : undefined
        }],
        context: { run_id: runId, payment_type: paymentType, source: 'eventgenix_checkbox_sandbox_smoke', ...context }
    });
}

async function waitReceiptDone(client, receiptId) {
    let latest = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        latest = await client.lookupReceipt({ receiptId });
        const status = String(latest?.status || '').toUpperCase();
        if (status === 'DONE') {
            if (String(latest?.id || '') !== String(receiptId)) {
                throw new CheckboxClientError('checkbox_sandbox_receipt_uuid_mismatch', 'Sandbox receipt lookup returned a different UUID', {
                    status: 1,
                    retryable: false,
                    details: { expectedReceiptId: receiptId, receiptIdSeen: Boolean(latest?.id) }
                });
            }
            return latest;
        }
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

function publicReadinessDiagnostics(diagnostics = {}) {
    const checks = Array.isArray(diagnostics.checks) ? diagnostics.checks.map(check => {
        const item = {
            code: check.code,
            label: check.label,
            status: check.status,
            ready: check.ready === true,
            recommendation: check.recommendation || null
        };
        if (['sales_permission', 'cash_permission', 'card_permission'].includes(check.code)) {
            const value = check?.details?.value;
            const state = check?.details?.state || (value === true ? 'allowed' : value === false ? 'denied' : value === null ? 'unreported' : 'malformed');
            item.permission = {
                reported: value === true || value === false,
                allowed: value === true ? true : value === false ? false : null,
                state
            };
        } else if (check.code === 'is_test') {
            item.testIdentityMatched = check.ready === true;
        } else if (check.code === 'current_shift') {
            item.shiftStatus = firstText(check?.details?.status, check?.details?.shiftStatus) || null;
        }
        return item;
    }) : [];
    return redactCheckboxDiagnostics({
        ready: diagnostics.ready === true,
        status: diagnostics.status || 'blocked',
        mutations: false,
        authMode: diagnostics.authMode || null,
        checks,
        summary: diagnostics.summary || null
    });
}

function assertSandboxProofMutationGuard(config, diagnostics = {}) {
    if (!config.confirmMutations) {
        throw new CheckboxClientError('checkbox_sandbox_mutation_confirmation_required', 'Set CHECKBOX_SANDBOX_CONFIRM_MUTATIONS=sandbox to run real sandbox fiscal operations', { status: 2, retryable: false });
    }
    assertExpectedSandboxIdentityConfig(config);
    if (config.expectedIsTestExplicit !== true || config.expectedIsTest !== true) {
        throw new CheckboxClientError('checkbox_sandbox_test_identity_must_be_explicit', 'Mutation proof requires CHECKBOX_SANDBOX_EXPECT_IS_TEST=true explicitly', { status: 2, retryable: false });
    }
    if (config.closeShift !== true) {
        throw new CheckboxClientError(
            'checkbox_sandbox_shift_cleanup_required',
            'Controlled sandbox mutation proof requires CHECKBOX_SANDBOX_CLOSE_SHIFT=true',
            { status: 2, retryable: false }
        );
    }
    const checks = new Map((Array.isArray(diagnostics.checks) ? diagnostics.checks : []).map(check => [check.code, check]));
    const requiredReadyCodes = [
        'auth',
        'cashier_identity',
        'organization_identity',
        'register_identity',
        'register_online',
        'is_test',
        'signature',
        'certificate',
        'sales_permission',
        'provider_taxes'
    ];
    const blocked = [];
    for (const code of requiredReadyCodes) {
        const check = checks.get(code);
        if (!check || check.status !== 'ready' || check.ready !== true) blocked.push(code);
    }

    const currentShift = checks.get('current_shift');
    const currentShiftStatus = String(firstText(currentShift?.details?.status, currentShift?.details?.shiftStatus) || '').toUpperCase();
    const currentShiftRecoverable = currentShift
        && (currentShift.status === 'ready'
            || currentShift.status === 'not_applicable'
            || (currentShift.status === 'blocked' && ['CREATED', 'OPENING'].includes(currentShiftStatus)));
    if (!currentShiftRecoverable) blocked.push('current_shift');

    const requestedTenders = Array.isArray(config.tenders) && config.tenders.length
        ? config.tenders
        : ['cash', 'card_terminal_manual'];
    const requestedPermissions = requestedTenders.includes('cash')
        ? [['cash_permission', 'cash_payment']]
        : [];
    if (requestedTenders.includes('card_terminal_manual')) {
        requestedPermissions.push(['card_permission', 'card_payment']);
    }
    const unreported = [];
    for (const [code, permission] of requestedPermissions) {
        const check = checks.get(code);
        if (!check || check.status === 'unavailable') {
            blocked.push(code);
            continue;
        }
        const value = check?.details?.permission === permission ? check.details.value : undefined;
        const state = check?.details?.state
            || (value === true ? 'allowed' : value === false ? 'denied' : value === null ? 'unreported' : 'malformed');
        if (state === 'allowed' && value === true && check.status === 'ready' && check.ready === true) continue;
        if (state === 'denied' || value === false) {
            throw new CheckboxClientError('checkbox_sandbox_payment_permission_denied', `Checkbox explicitly denied ${permission}; test proof bypass is forbidden`, {
                status: 2,
                retryable: false,
                details: { permission, explicitlyDenied: true }
            });
        }
        if (state === 'malformed') {
            throw new CheckboxClientError('checkbox_sandbox_payment_permission_malformed', `Checkbox returned malformed ${permission}; test proof bypass is forbidden`, {
                status: 2,
                retryable: false,
                details: { permission, malformed: true }
            });
        }
        if (state === 'unreported' && value === null && config.allowUnreportedPaymentPermissions === true) {
            unreported.push(permission);
            continue;
        }
        blocked.push(code);
    }
    if (blocked.length) {
        throw new CheckboxClientError('checkbox_sandbox_proof_readiness_blocked', 'Sandbox proof is blocked by provider readiness checks', {
            status: 2,
            retryable: false,
            details: { blocked: [...new Set(blocked)] }
        });
    }
    return {
        allowed: true,
        expectedTestIdentity: true,
        organizationVerified: checks.get('organization_identity')?.ready === true,
        registerVerified: checks.get('register_identity')?.ready === true,
        cashierVerified: checks.get('cashier_identity')?.ready === true,
        unreportedPaymentPermissions: unreported,
        permissionOverrideEnabled: config.allowUnreportedPaymentPermissions === true
    };
}

function shiftIdentity(shift = {}) {
    return {
        shiftId: firstText(shift.id, shift.shift_id),
        status: String(shift.status || '').toUpperCase(),
        registerId: firstText(shift.cash_register_id, shift.register_id, shift.cash_register?.id, shift.cash_register?.register_id),
        cashierId: firstText(shift.cashier_id, shift.cashier?.id, shift.cashier?.cashier_id)
    };
}

function assertShiftIdentity(shift, config, { requireCashier = true } = {}) {
    const identity = shiftIdentity(shift);
    assertSame(identity.registerId, config.expectedRegisterId, 'checkbox_sandbox_shift_register_mismatch', 'shift.cash_register.id');
    if (requireCashier || identity.cashierId) {
        assertSame(identity.cashierId, config.expectedCashierId, 'checkbox_sandbox_shift_cashier_mismatch', 'shift.cashier.id');
    }
    return identity;
}

function assertNoPreexistingSandboxShift(shift) {
    if (!shift) return;
    const identity = shiftIdentity(shift);
    if (['CLOSED', 'ERROR', 'CANCELLED'].includes(identity.status)) return;
    throw new CheckboxClientError(
        'checkbox_sandbox_preexisting_shift_requires_manual_resolution',
        'Sandbox mutations are blocked because Checkbox already has a shift that was not created by this smoke run',
        {
            status: 2,
            retryable: false,
            details: { providerStatus: identity.status || 'UNKNOWN' }
        }
    );
}

async function waitShiftOpened(client, shift, config) {
    let current = shift;
    const expectedShiftId = shiftIdentity(shift).shiftId;
    if (!expectedShiftId) {
        throw new CheckboxClientError('checkbox_sandbox_shift_id_missing', 'Cannot poll sandbox shift open without its durable UUID', { status: 1, retryable: false });
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const identity = assertShiftIdentity(current, config);
        assertSame(identity.shiftId, expectedShiftId, 'checkbox_sandbox_shift_open_uuid_mismatch', 'shift.id');
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

async function waitShiftClosed(client, closeResponse, openedShift, config) {
    const expectedShiftId = shiftIdentity(openedShift).shiftId;
    if (!expectedShiftId) {
        throw new CheckboxClientError('checkbox_sandbox_shift_id_missing', 'Cannot poll sandbox shift close without the opened shift UUID', { status: 1, retryable: false });
    }
    let current = closeResponse || null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const observedId = firstText(current?.id, current?.shift_id);
        if (observedId && observedId !== expectedShiftId) {
            throw new CheckboxClientError('checkbox_sandbox_shift_close_uuid_mismatch', 'Sandbox shift close returned a different shift UUID', {
                status: 1,
                retryable: false,
                details: { expectedShiftId, shiftIdSeen: true }
            });
        }
        const status = String(current?.status || '').toUpperCase();
        if (status === 'CLOSED') {
            assertShiftIdentity(current, config);
            return current;
        }
        if (status === 'ERROR' || status === 'CANCELLED') {
            throw new CheckboxClientError('checkbox_sandbox_shift_close_terminal_failure', `Sandbox shift close ended with ${status}`, {
                status: 1,
                details: { expectedShiftId, providerStatus: status }
            });
        }
        current = await client.getShiftById({ shiftId: expectedShiftId });
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    throw new CheckboxClientError('checkbox_sandbox_shift_close_timeout', 'Sandbox shift did not reach CLOSED in time', {
        status: 1,
        details: { expectedShiftId, lastStatus: current?.status || null }
    });
}

function verifySandboxReceiptProof({ client, config, openedShift, payload, receipt, tender, identityProof }) {
    if (identityProof?.organizationVerified !== true) {
        throw new CheckboxClientError('checkbox_sandbox_organization_proof_missing', 'Sandbox receipt proof requires a verified provider organization identity', {
            status: 2,
            retryable: false
        });
    }
    const shift = assertShiftIdentity(openedShift, config);
    if (shift.status !== 'OPENED' || !shift.shiftId) {
        throw new CheckboxClientError('checkbox_sandbox_shift_not_opened', 'Sandbox receipt proof requires the exact OPENED provider shift', {
            status: 2,
            retryable: false,
            details: { providerStatus: shift.status || null }
        });
    }
    const providerPayments = Array.isArray(receipt?.payments) ? receipt.payments : [];
    const expectedPaymentType = tender === 'cash' ? 'CASH' : 'CASHLESS';
    if (providerPayments.length !== 1 || String(providerPayments[0]?.type || '').toUpperCase() !== expectedPaymentType) {
        throw new CheckboxClientError('checkbox_sandbox_receipt_tender_mismatch', 'Sandbox receipt must contain exactly the selected Phase-1 payment tender', {
            status: 2,
            retryable: false,
            details: { expectedPaymentType, paymentCount: providerPayments.length }
        });
    }
    const context = payload?.context || {};
    return normalizeReceiptArtifacts(receipt, client, {
        providerOperationId: payload?.id,
        amountMinor: config.amountMinor,
        receivedAmountMinor: tender === 'cash' ? config.amountMinor : null,
        changeAmountMinor: '0',
        tender,
        expectedReceiptType: 'SELL',
        expectedOrganizationId: config.expectedOrganizationId,
        expectedRegisterId: config.expectedRegisterId,
        expectedCashierId: config.expectedCashierId,
        expectedShiftId: shift.shiftId,
        fiscalOperationId: context.fiscal_operation_id,
        paymentOrderId: context.payment_order_id,
        fiscalProfileId: context.fiscal_profile_id
    });
}

async function runSandboxSaleProof(client, config, runId, tender, { openedShift, identityProof } = {}) {
    const paymentType = tender === 'cash' ? 'cash' : 'cashless';
    const proofKey = `${runId}-${paymentType}`;
    const salePayload = buildSandboxSalePayload(config, runId, tender, {
        fiscal_profile_id: `sandbox-${runId}`,
        fiscal_operation_id: `sandbox-operation-${proofKey}`,
        payment_order_id: `sandbox-payment-${proofKey}`
    });
    await client.validateSale(salePayload);
    logStep(`${paymentType}-sale-validation-ok`);
    const sale = await client.createSaleReceipt(salePayload);
    const saleReceiptId = sale?.id || salePayload.id;
    if (sale?.id && String(sale.id) !== String(salePayload.id)) {
        throw new CheckboxClientError('checkbox_sandbox_receipt_uuid_mismatch', 'Checkbox sale response returned a different receipt UUID', {
            status: 1,
            retryable: false,
            details: { expectedReceiptId: salePayload.id, receiptIdSeen: true }
        });
    }
    logStep(`${paymentType}-sale-created`, { status: sale?.status || null });
    const saleStatus = await waitReceiptDone(client, saleReceiptId);
    const verified = verifySandboxReceiptProof({
        client,
        config,
        openedShift,
        payload: salePayload,
        receipt: saleStatus,
        tender,
        identityProof
    });
    logStep(`${paymentType}-sale-status-lookup-ok`, { status: verified.status, verified: verified.verified === true });
    const pdf = await client.getReceiptDocument({ receiptId: saleReceiptId, format: 'pdf' });
    logStep(`${paymentType}-sale-document-ok`, { documentAvailable: Buffer.isBuffer(pdf) && pdf.length > 0 });
    return { payload: salePayload, receiptId: saleReceiptId, status: saleStatus, verified };
}

async function closeOwnedSandboxShift({
    client,
    config,
    shift,
    openedBySmoke,
    force = false,
    pollAttempts = 12,
    pollDelayMs = 1200
}) {
    if (!openedBySmoke) return { attempted: false, closed: false, reason: 'preexisting_shift' };
    if (!force && config.closeShift !== true) return { attempted: false, closed: false, reason: 'close_disabled' };
    const expectedShiftId = shiftIdentity(shift).shiftId;
    if (!expectedShiftId) return { attempted: false, closed: false, reason: 'owned_shift_id_missing' };

    let lastStatus = null;
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        let ownedShift;
        try {
            ownedShift = await client.getShiftById({ shiftId: expectedShiftId });
        } catch (error) {
            if (error?.status === 404 || error?.status === 422) {
                lastStatus = 'NOT_FOUND';
                if (attempt + 1 < pollAttempts) {
                    await new Promise(resolve => setTimeout(resolve, pollDelayMs));
                    continue;
                }
                break;
            }
            throw error;
        }
        const identity = assertShiftIdentity(ownedShift, config);
        assertSame(identity.shiftId, expectedShiftId, 'checkbox_sandbox_shift_cleanup_uuid_mismatch', 'shift.id');
        lastStatus = identity.status;
        if (identity.status === 'CLOSED') return { attempted: false, closed: true, reason: 'already_closed' };
        if (identity.status === 'ERROR' || identity.status === 'CANCELLED') {
            return { attempted: false, closed: false, reason: 'owned_shift_not_closeable', status: identity.status };
        }
        if (identity.status === 'CLOSING') {
            const closedShift = await waitShiftClosed(client, ownedShift, ownedShift, config);
            return { attempted: false, closed: true, reason: 'already_closing', status: shiftIdentity(closedShift).status };
        }
        if (identity.status === 'CREATED' || identity.status === 'OPENING') {
            if (attempt + 1 < pollAttempts) {
                await new Promise(resolve => setTimeout(resolve, pollDelayMs));
                continue;
            }
            break;
        }
        if (identity.status !== 'OPENED') {
            return { attempted: false, closed: false, reason: 'owned_shift_not_closeable', status: identity.status };
        }

        const currentShift = await client.getCurrentShift();
        const currentIdentity = assertShiftIdentity(currentShift, config, { requireCashier: false });
        assertSame(currentIdentity.shiftId, expectedShiftId, 'checkbox_sandbox_current_shift_uuid_mismatch', 'current_shift.id');
        if (currentIdentity.status !== 'OPENED') {
            throw new CheckboxClientError('checkbox_sandbox_current_shift_not_opened', 'Sandbox cleanup will close only the exact currently OPENED smoke-owned shift', {
                status: 2,
                retryable: false,
                details: { providerStatus: currentIdentity.status || 'UNKNOWN' }
            });
        }
        const closeResponse = await client.closeShift();
        const closedShift = await waitShiftClosed(client, closeResponse, ownedShift, config);
        return { attempted: true, closed: true, status: shiftIdentity(closedShift).status };
    }

    throw new CheckboxClientError('checkbox_sandbox_owned_shift_cleanup_timeout', 'Sandbox cleanup could not prove the smoke-owned shift OPENED before the bounded deadline', {
        status: 2,
        retryable: false,
        details: { providerStatus: lastStatus || 'UNKNOWN' }
    });
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

    assertExpectedSandboxIdentityConfig(config);

    const provider = createProviderFromConfig(config);
    const expectedIdentity = {
        expectedOrganizationId: config.expectedOrganizationId,
        expectedRegisterId: config.expectedRegisterId,
        expectedCashierId: config.expectedCashierId,
        expectedIsTest: true
    };
    const readinessOptions = {
        expectedTaxIds: config.taxCode ? [config.taxCode] : [],
        allowUnreportedPaymentPermissions: config.allowUnreportedPaymentPermissions === true
    };

    if (config.readinessOnly) {
        const diagnostics = await provider.collectReadinessDiagnostics(expectedIdentity, readinessOptions);
        const publicDiagnostics = publicReadinessDiagnostics(diagnostics);
        logStep('cashier-readiness-checklist', publicDiagnostics);
        console.log(JSON.stringify({ ok: diagnostics.ready, smoke: 'checkbox:sandbox:readiness', mutations: false, readiness: publicDiagnostics }));
        if (!diagnostics.ready) process.exit(2);
        return;
    }

    const diagnostics = await provider.collectReadinessDiagnostics(expectedIdentity, readinessOptions);
    const proofGuard = assertSandboxProofMutationGuard(config, diagnostics);
    const client = provider.client;
    logStep('cashier-readiness-ok', {
        expectedIdentityMatched: true,
        expectedIsTest: true,
        authMode: config.authMode,
        permissionProof: proofGuard
    });

    let shift = null;
    let openedBySmoke = false;
    let shiftClosed = false;
    try {
        shift = await client.getCurrentShift().catch(error => {
            if (error.status === 404 || error.status === 422) return null;
            throw error;
        });
        assertNoPreexistingSandboxShift(shift);
        const providerShiftUuid = crypto.randomUUID();
        openedBySmoke = true;
        shift = { id: providerShiftUuid, status: 'CREATED' };
        const opened = await client.openShift({ providerRequestUuid: providerShiftUuid });
        assertSame(shiftIdentity(opened).shiftId, providerShiftUuid, 'checkbox_sandbox_shift_open_uuid_mismatch', 'shift.id');
        shift = opened;
        logStep('shift-open-requested', { status: shift?.status || null, openedBySmoke: true });
        shift = await waitShiftOpened(client, shift, config);
        logStep('shift-opened-ok', { status: shiftIdentity(shift).status, openedBySmoke });

        const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const proofOptions = { openedShift: shift, identityProof: proofGuard };
        const sales = [];
        for (const tender of config.tenders) {
            sales.push(await runSandboxSaleProof(client, config, runId, tender, proofOptions));
        }
        const cashSale = sales.find(sale => sale.payload?.payments?.[0]?.type === 'CASH') || null;

        if (config.includeProOperations) {
            if (!cashSale) {
                throw new CheckboxClientError(
                    'checkbox_sandbox_pro_requires_cash_sale',
                    'Phase 2 sandbox proof requires the cash tender to create a linked return',
                    { status: 2, retryable: false }
                );
            }
            const serviceIn = await client.createServiceReceipt(mapServiceReceipt({ providerRequestUuid: crypto.randomUUID(), operationType: 'service_in', amountMinor: config.amountMinor, context: { run_id: runId } }));
            logStep('service-in-created', { status: serviceIn?.status || null });
            const serviceOut = await client.createServiceReceipt(mapServiceReceipt({ providerRequestUuid: crypto.randomUUID(), operationType: 'service_out', amountMinor: config.amountMinor, context: { run_id: runId } }));
            logStep('service-out-created', { status: serviceOut?.status || null });

            const returnPayload = mapFullReturnReceipt({ providerRequestUuid: crypto.randomUUID(), originalReceiptId: cashSale.receiptId, originalSalePayload: cashSale.payload, context: { run_id: runId } });
            const returned = await client.createReturnReceipt(returnPayload);
            logStep('full-return-created', { status: returned?.status || null });
            await waitReceiptDone(client, returned?.id || returnPayload.id);
            logStep('full-return-status-lookup-ok', { status: 'DONE' });
        } else {
            logStep('phase2-operations-skipped', { reason: 'CHECKBOX_SANDBOX_INCLUDE_PRO is not enabled' });
        }

        runWebhookSignatureReplayCheck(config);
        await runTimeoutLookupRecoveryCheck(config);

        const closeResult = await closeOwnedSandboxShift({ client, config, shift, openedBySmoke });
        shiftClosed = closeResult.closed === true;
        logStep(closeResult.attempted ? 'shift-closed-ok' : 'shift-close-skipped', closeResult);
        await client.signOut();
        logStep('cashier-signout-ok');
        console.log(JSON.stringify({
            ok: true,
            smoke: 'checkbox:sandbox',
            receiptCount: sales.length,
            receipts: sales.map(sale => ({
                tender: sale.verified.paymentType,
                status: sale.verified.status,
                verified: sale.verified.verified === true
            })),
            openedBySmoke,
            shiftClosed
        }));
    } catch (error) {
        if (openedBySmoke && !shiftClosed && shift) {
            try {
                const cleanup = await closeOwnedSandboxShift({ client, config, shift, openedBySmoke, force: true });
                logStep(cleanup.closed ? 'shift-cleanup-after-failure-ok' : 'shift-cleanup-after-failure-skipped', cleanup);
            } catch (cleanupError) {
                logStep('shift-cleanup-after-failure-blocked', {
                    code: cleanupError?.code || cleanupError?.name || 'checkbox_sandbox_cleanup_failed'
                });
            }
        }
        if (shiftClosed || !openedBySmoke) {
            try {
                await client.signOut();
                logStep('cashier-signout-after-failure-ok');
            } catch (signOutError) {
                logStep('cashier-signout-after-failure-blocked', {
                    code: signOutError?.code || signOutError?.name || 'checkbox_sandbox_signout_failed'
                });
            }
        }
        throw error;
    }
}

if (require.main === module) runSandboxSmoke().catch(fail);

module.exports = {
    assertOpenApiOperationContract,
    assertNoPreexistingSandboxShift,
    assertSandboxProofMutationGuard,
    closeOwnedSandboxShift,
    fetchOfficialOpenApi,
    publicSandboxEvidence,
    publicReadinessDiagnostics,
    resolveLocalOpenApiRef,
    runSandboxSaleProof,
    runSandboxSmoke,
    schemaContainsProperty,
    verifySandboxReceiptProof
};
