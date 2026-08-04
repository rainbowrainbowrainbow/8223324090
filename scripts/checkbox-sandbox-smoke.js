#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { CheckboxClient } = require('../services/checkbox/client');
const { loadCheckboxSandboxConfig, publicConfigSummary } = require('../services/checkbox/config');
const { CheckboxClientError, redactCheckboxDiagnostics } = require('../services/checkbox/errors');
const { mapFullReturnReceipt, mapSaleReceipt, mapServiceReceipt } = require('../services/checkbox/mapper');
const { WebhookReplayGuard, signCheckboxWebhookBody, verifyCheckboxWebhookSignature } = require('../services/checkbox/signature');

const REQUIRED_OPENAPI_PATHS = Object.freeze({
    '/api/v1/cashier/signin': ['post'],
    '/api/v1/cashier/me': ['get'],
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
            }
        }
        return { title: contract.info.title, version: contract.info.version, openapi: contract.openapi };
    } finally {
        clearTimeout(timer);
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
            taxReference: config.taxCode || undefined
        }],
        context: { run_id: runId, source: 'eventgenix_checkbox_sandbox_smoke' }
    });
}

async function waitReceiptDone(client, receiptId) {
    let latest = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        latest = await client.lookupReceipt({ receiptId });
        const status = String(latest?.status || '').toUpperCase();
        if (status === 'DONE' || status === 'ERROR' || status === 'CANCELLED') return latest;
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    return latest;
}

function runWebhookSignatureReplayCheck(config) {
    if (!config.webhookSecret) {
        logStep('webhook-signature-skipped', { reason: 'CHECKBOX_SANDBOX_WEBHOOK_SECRET is not configured' });
        return;
    }
    const rawBody = Buffer.from(JSON.stringify({ event: 'receipt.done', id: crypto.randomUUID() }));
    const signature = `sha256=${signCheckboxWebhookBody(rawBody, config.webhookSecret)}`;
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

    if (!config.confirmMutations) {
        throw new CheckboxClientError('checkbox_sandbox_mutation_confirmation_required', 'Set CHECKBOX_SANDBOX_CONFIRM_MUTATIONS=sandbox to run real sandbox fiscal operations', { status: 2 });
    }

    const client = new CheckboxClient(config);
    await client.signIn({ login: config.login, password: config.password });
    logStep('cashier-auth-ok');
    const cashier = await client.getCashierProfile();
    logStep('cashier-readiness-ok', { cashierId: cashier?.id || null, fullName: cashier?.full_name || cashier?.name || null });

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

    const serviceIn = await client.createServiceReceipt(mapServiceReceipt({ providerRequestUuid: crypto.randomUUID(), operationType: 'service_in', amountMinor: config.amountMinor, context: { run_id: runId } }));
    logStep('service-in-created', { receiptId: serviceIn?.id || null, status: serviceIn?.status || null });
    const serviceOut = await client.createServiceReceipt(mapServiceReceipt({ providerRequestUuid: crypto.randomUUID(), operationType: 'service_out', amountMinor: config.amountMinor, context: { run_id: runId } }));
    logStep('service-out-created', { receiptId: serviceOut?.id || null, status: serviceOut?.status || null });

    const returnPayload = mapFullReturnReceipt({ providerRequestUuid: crypto.randomUUID(), originalReceiptId: saleReceiptId, originalSalePayload: salePayload, context: { run_id: runId } });
    const returned = await client.createReturnReceipt(returnPayload);
    logStep('full-return-created', { receiptId: returned?.id || returnPayload.id, originalReceiptId: saleReceiptId, status: returned?.status || null });
    await waitReceiptDone(client, returned?.id || returnPayload.id);
    logStep('full-return-status-lookup-ok', { receiptId: returned?.id || returnPayload.id });

    runWebhookSignatureReplayCheck(config);
    await runTimeoutLookupRecoveryCheck(config);

    if (config.closeShift) {
        const closed = await client.closeShift({ providerRequestUuid: crypto.randomUUID() });
        logStep('shift-close-requested', { shiftId: closed?.id || shift?.id || null, status: closed?.status || null });
    }
    console.log(JSON.stringify({ ok: true, smoke: 'checkbox:sandbox' }));
}

runSandboxSmoke().catch(fail);
