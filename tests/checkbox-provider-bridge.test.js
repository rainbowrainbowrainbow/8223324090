const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const { CheckboxClientError, redactCheckboxDiagnostics } = require('../services/checkbox/errors');
const {
    createCheckboxProviderFactory,
    createProviderFromConfig,
    normalizeReceiptArtifacts,
    normalizeShiftResponse
} = require('../services/checkbox/provider');
const { loadCheckboxRuntimeConfig } = require('../services/checkbox/config');
const { classifyWorkerError, processPaymentOutboxJobs } = require('../services/payments/paymentOutboxWorker');

function listenMock(handler) {
    const calls = [];
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const call = {
                method: req.method,
                path: req.url,
                headers: req.headers,
                body: raw ? JSON.parse(raw) : null
            };
            calls.push(call);
            try {
                const response = await handler(call, calls);
                const status = response?.status || 200;
                const body = response?.body === undefined ? {} : response.body;
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(body));
            } catch (error) {
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, calls, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function providerConfig(baseUrl) {
    return {
        baseUrl,
        login: 'cashier-login',
        password: 'cashier-password',
        licenseKey: 'license-secret',
        accessKey: 'access-secret',
        deviceId: 'eventgenix-test-device',
        clientName: 'EventGenix Test',
        clientVersion: 'test',
        timeoutMs: 1000,
        expectedIsTest: false
    };
}

const PROVIDER_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_REGISTER_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_CASHIER_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_SHIFT_ID = '44444444-4444-4444-8444-444444444444';

function cashierProfile(overrides = {}) {
    return {
        id: PROVIDER_CASHIER_ID,
        full_name: 'Sandbox Cashier',
        nin: '0000000000',
        signature_type: 'CLOUD_SIGNATURE_3',
        created_at: new Date().toISOString(),
        blocked: null,
        is_test: false,
        permissions: { sales: true, cash_payment: true, card_payment: true },
        certificate_end: new Date(Date.now() + 86400000).toISOString(),
        organization: { id: PROVIDER_ORGANIZATION_ID, title: 'Test FOP', edrpou: '00000000', tax_number: '00000000' },
        ...overrides
    };
}

function openedShift(overrides = {}) {
    return {
        id: PROVIDER_SHIFT_ID,
        status: 'OPENED',
        serial: 1,
        taxes: [],
        cash_register: { id: PROVIDER_REGISTER_ID, fiscal_number: '4000000000', active: true },
        cashier: { id: PROVIDER_CASHIER_ID, full_name: 'Sandbox Cashier' },
        ...overrides
    };
}

function cashRegisterInfo(overrides = {}) {
    return {
        id: PROVIDER_REGISTER_ID,
        organization_id: PROVIDER_ORGANIZATION_ID,
        fiscal_number: '4000000000',
        is_test: false,
        created_at: new Date().toISOString(),
        offline_mode: false,
        stay_offline: false,
        documents_state: { last_receipt_code: null, last_report_code: null },
        ...overrides
    };
}

function signatureStatus(overrides = {}) {
    return {
        online: true,
        type: 'CLOUD_SIGNATURE_3',
        shift_open_possibility: true,
        ...overrides
    };
}

function cashierTaxes(overrides = {}) {
    return [
        {
            id: '7',
            code: 7,
            label: 'VAT 20',
            symbol: 'А',
            rate: 20,
            included: true,
            created_at: new Date().toISOString(),
            ...overrides
        }
    ];
}

function checkboxReceipt(receiptId, overrides = {}) {
    return {
        id: receiptId,
        status: 'DONE',
        type: 'SELL',
        fiscal_code: 'FC-1',
        total_sum: 12345,
        total_payment: 12345,
        total_rest: 0,
        serial: 2,
        cash_register_id: PROVIDER_REGISTER_ID,
        cashier_id: PROVIDER_CASHIER_ID,
        shift_id: PROVIDER_SHIFT_ID,
        payments: [{ type: 'CASHLESS', value: 12345, label: 'Картка' }],
        context: { eventgenix: true, fiscal_profile_id: 7, fiscal_operation_id: 501, payment_order_id: 301 },
        shift: openedShift(),
        ...overrides
    };
}

function saleInput(receiptId = crypto.randomUUID(), overrides = {}) {
    return {
        providerOperationId: receiptId,
        fiscalOperation: {
            id: 501,
            fiscal_operation_id: 501,
            fiscal_profile_id: 7,
            provider_organization_id: PROVIDER_ORGANIZATION_ID,
            provider_register_id: PROVIDER_REGISTER_ID,
            provider_cashier_id: PROVIDER_CASHIER_ID,
            provider_shift_id: PROVIDER_SHIFT_ID
        },
        paymentOrder: {
            id: 301,
            payment_order_id: 301,
            fiscal_profile_id: 7,
            total_amount_minor: '12345',
            payment_method: 'card_terminal_manual',
            provider_organization_id: PROVIDER_ORGANIZATION_ID,
            provider_register_id: PROVIDER_REGISTER_ID,
            provider_cashier_id: PROVIDER_CASHIER_ID,
            provider_shift_id: PROVIDER_SHIFT_ID,
            confirmation_snapshot: {}
        },
        items: [{
            line_number: 1,
            item_name: 'Park admission',
            item_code: 'park-admission',
            unit_price_minor: '12345',
            quantity_milli: 1000,
            provider_tax_id: '7'
        }],
        ...overrides
    };
}

test('runtime provider maps worker DTO to official auth, shift, validate, sell and lookup calls', async () => {
    const receiptId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1', token_type: 'bearer' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/validate') return { body: { valid: true } };
        if (call.path === '/api/v1/receipts/sell') return { status: 201, body: checkboxReceipt(receiptId) };
        if (call.path === `/api/v1/receipts/${receiptId}`) return { body: checkboxReceipt(receiptId) };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        await provider.validateSale(saleInput(receiptId));
        const receipt = await provider.createSaleReceipt(saleInput(receiptId));
        const input = saleInput(receiptId);
        const lookup = await provider.lookupReceipt({ providerOperationId: receiptId, fiscalOperation: input.fiscalOperation, paymentOrder: input.paymentOrder });

        assert.equal(receipt.providerReceiptId, receiptId);
        assert.equal(receipt.status, 'DONE');
        assert.equal(lookup.receipt.providerReceiptId, receiptId);
        assert.equal(calls[0].path, '/api/v1/cashier/signin');
        assert.equal(calls[0].headers.authorization, undefined);

        const validate = calls.find(call => call.path === '/api/v1/receipts/validate');
        const sell = calls.find(call => call.path === '/api/v1/receipts/sell');
        assert.ok(calls.find(call => call.path === '/api/v1/cashier/me'));
        assert.equal(validate.headers.authorization, 'Bearer token-1');
        assert.equal(validate.headers['x-device-id'], 'eventgenix-test-device');
        assert.equal(sell.headers['x-access-key'], 'access-secret');
        assert.equal(sell.body.id, receiptId);
        assert.equal(sell.body.goods[0].good.name, 'Park admission');
        assert.deepEqual(sell.body.goods[0].good.tax, ['7']);
        assert.equal(sell.body.goods[0].quantity, 1000);
        assert.equal(sell.body.payments[0].type, 'CASHLESS');
        assert.equal(sell.body.payments[0].value, 12345);
        assert.equal(sell.body.context.fiscal_operation_id, 501);
        assert.equal(sell.body.context.payment_order_id, 301);
    } finally {
        await close(server);
    }
});

test('runtime provider readiness verifies official cashier, register, signature, permissions, tax and test identity', async () => {
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1', token_type: 'bearer' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
        if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus() };
        if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const readiness = await provider.verifyReadiness({
            expectedCashierId: PROVIDER_CASHIER_ID,
            expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
            expectedRegisterId: PROVIDER_REGISTER_ID,
            expectedIsTest: false
        }, { expectedTaxIds: ['7'] });

        assert.equal(readiness.cashier.cashierId, PROVIDER_CASHIER_ID);
        assert.equal(readiness.register.registerId, PROVIDER_REGISTER_ID);
        assert.equal(readiness.signature.online, true);
        assert.equal(readiness.permissions.cashPayment, true);
        assert.deepEqual(readiness.taxes.expected, ['7']);
        assert.equal(calls.find(call => call.path === '/api/v1/cash-registers/info').headers['x-license-key'], 'license-secret');
        assert.equal(calls.every(call => call.path !== '/api/v1/receipts/sell' && call.path !== '/api/v1/shifts'), true);
    } finally {
        await close(server);
    }
});

test('runtime provider readiness fails closed on missing signature, permissions, tax or test identity mismatch', async () => {
    async function expectReadinessError(overrides, expectedCode) {
        const { server, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') return { body: cashierProfile(overrides.cashier || {}) };
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo(overrides.register || {}) };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus(overrides.signature || {}) };
            if (call.path === '/api/v1/cashier/tax') return { body: overrides.taxes || cashierTaxes() };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig(providerConfig(baseUrl));
            await assert.rejects(
                () => provider.verifyReadiness({
                    expectedCashierId: PROVIDER_CASHIER_ID,
                    expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                    expectedRegisterId: PROVIDER_REGISTER_ID,
                    expectedIsTest: false
                }, { expectedTaxIds: ['7'] }),
                error => error instanceof CheckboxClientError && error.code === expectedCode
            );
        } finally {
            await close(server);
        }
    }

    await expectReadinessError({ cashier: { is_test: true } }, 'checkbox_cashier_test_mode_mismatch');
    await expectReadinessError({ cashier: { permissions: { sales: true, cash_payment: true, card_payment: false } } }, 'checkbox_cashier_permissions_missing');
    await expectReadinessError({ signature: { online: false } }, 'checkbox_signature_offline');
    await expectReadinessError({ register: { is_test: true } }, 'checkbox_register_test_mode_mismatch');
    await expectReadinessError({ register: { offline_mode: true } }, 'checkbox_register_offline');
    await expectReadinessError({ register: { organization_id: 'wrong-org' } }, 'checkbox_register_organization_mismatch');
    await expectReadinessError({ taxes: cashierTaxes({ id: '9', code: 9 }) }, 'checkbox_provider_tax_ids_unavailable');
});

test('runtime provider readiness supports fully untaxed admission mappings without provider tax ids', async () => {
    const { server, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
        if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus() };
        if (call.path === '/api/v1/cashier/tax') return { body: [] };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const readiness = await provider.verifyReadiness({
            expectedCashierId: PROVIDER_CASHIER_ID,
            expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
            expectedRegisterId: PROVIDER_REGISTER_ID,
            expectedIsTest: false
        }, { expectedTaxIds: [] });
        assert.deepEqual(readiness.taxes.expected, []);
    } finally {
        await close(server);
    }
});

test('runtime provider validation fails closed on nested false validation result', async () => {
    const receiptId = crypto.randomUUID();
    const { server, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
        if (call.path === '/api/v1/receipts/validate') {
            return { body: { valid: true, goods: [{ valid: true }, { valid: false }] } };
        }
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        await assert.rejects(
            () => provider.validateSale({
                providerOperationId: receiptId,
                fiscalOperation: {
                    id: 501,
                    fiscal_profile_id: 7,
                    operation_type: 'sale',
                    provider_operation_id: receiptId,
                    provider_register_id: PROVIDER_REGISTER_ID,
                    provider_cashier_id: PROVIDER_CASHIER_ID,
                    provider_organization_id: PROVIDER_ORGANIZATION_ID,
                    provider_shift_id: PROVIDER_SHIFT_ID
                },
                paymentOrder: {
                    id: 301,
                    fiscal_profile_id: 7,
                    total_amount_minor: 10000,
                    payment_method: 'cash',
                    confirmation_snapshot: { received_amount_minor: 10000 }
                },
                items: [{ item_name: 'Ticket', item_code: 'ticket', unit_price_minor: 10000, quantity_milli: 1000, provider_tax_id: '7', tax_mode: 'taxed' }]
            }),
            error => error instanceof CheckboxClientError && error.code === 'checkbox_receipt_validation_failed'
        );
    } finally {
        await close(server);
    }
});

test('runtime provider maps official service in/out receipts and verifies service receipt type', async () => {
    const serviceInId = crypto.randomUUID();
    const serviceOutId = crypto.randomUUID();
    const serviceReceipt = (id, type) => checkboxReceipt(id, {
        type,
        total_sum: 5000,
        total_payment: 5000,
        payments: [],
        context: { eventgenix: true, fiscal_profile_id: 7, fiscal_operation_id: type === 'SERVICE_IN' ? 701 : 702 }
    });
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1', token_type: 'bearer' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/service') {
            return { status: 201, body: serviceReceipt(call.body.id, call.body.payment.operation_type === 'COLLECTION' ? 'SERVICE_OUT' : 'SERVICE_IN') };
        }
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        await provider.createServiceReceipt({
            providerOperationId: serviceInId,
            fiscalOperation: {
                id: 701,
                fiscal_operation_id: 701,
                fiscal_profile_id: 7,
                operation_type: 'service_in',
                amount_minor: '5000',
                provider_organization_id: PROVIDER_ORGANIZATION_ID,
                provider_register_id: PROVIDER_REGISTER_ID,
                provider_cashier_id: PROVIDER_CASHIER_ID,
                provider_shift_id: PROVIDER_SHIFT_ID
            }
        });
        await provider.createServiceReceipt({
            providerOperationId: serviceOutId,
            fiscalOperation: {
                id: 702,
                fiscal_operation_id: 702,
                fiscal_profile_id: 7,
                operation_type: 'service_out',
                amount_minor: '5000',
                provider_organization_id: PROVIDER_ORGANIZATION_ID,
                provider_register_id: PROVIDER_REGISTER_ID,
                provider_cashier_id: PROVIDER_CASHIER_ID,
                provider_shift_id: PROVIDER_SHIFT_ID
            }
        });
        const serviceCalls = calls.filter(call => call.path === '/api/v1/receipts/service');
        assert.equal(serviceCalls.length, 2);
        assert.equal(serviceCalls[0].body.payment.operation_type, 'REINFORCEMENT');
        assert.equal(serviceCalls[1].body.payment.operation_type, 'COLLECTION');
        assert.equal(serviceCalls[0].body.payment.label, 'Готівка');
    } finally {
        await close(server);
    }
});

test('runtime provider maps a full return to the original sale receipt and verifies RETURN type', async () => {
    const returnId = crypto.randomUUID();
    const originalReceiptId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1', token_type: 'bearer' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') {
            return { status: 201, body: checkboxReceipt(returnId, {
                type: 'RETURN',
                context: { eventgenix: true, fiscal_profile_id: 7, fiscal_operation_id: 801, payment_order_id: 301 }
            }) };
        }
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const input = saleInput(returnId, {
            fiscalOperation: {
                id: 801,
                fiscal_operation_id: 801,
                fiscal_profile_id: 7,
                operation_type: 'return',
                amount_minor: '12345',
                provider_organization_id: PROVIDER_ORGANIZATION_ID,
                provider_register_id: PROVIDER_REGISTER_ID,
                provider_cashier_id: PROVIDER_CASHIER_ID,
                request_snapshot: { original_provider_receipt_id: originalReceiptId }
            }
        });
        const receipt = await provider.createReturnReceipt(input);
        assert.equal(receipt.receiptType, 'RETURN');
        const sell = calls.find(call => call.path === '/api/v1/receipts/sell');
        assert.equal(sell.body.related_receipt_id, originalReceiptId);
        assert.equal(sell.body.goods[0].is_return, true);
        assert.equal(sell.body.payments[0].label, 'Картка');
    } finally {
        await close(server);
    }
});

test('runtime provider re-authenticates once on 401 and does not leak secrets in diagnostics', async () => {
    const receiptId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock((call, allCalls) => {
        if (call.path === '/api/v1/cashier/signin') {
            const count = allCalls.filter(item => item.path === '/api/v1/cashier/signin').length;
            return { body: { access_token: `token-${count}`, token_type: 'bearer' } };
        }
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') {
            const sellCount = allCalls.filter(item => item.path === '/api/v1/receipts/sell').length;
            if (sellCount === 1) return { status: 401, body: { detail: 'expired token access-secret cashier-password' } };
            return { status: 201, body: checkboxReceipt(receiptId) };
        }
        return { body: { valid: true } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const receipt = await provider.createSaleReceipt(saleInput(receiptId));
        assert.equal(receipt.providerReceiptId, receiptId);
        assert.equal(calls.filter(call => call.path === '/api/v1/cashier/signin').length, 2);
        assert.equal(calls.filter(call => call.path === '/api/v1/receipts/sell').length, 2);
        const diagnostics = JSON.stringify(redactCheckboxDiagnostics({ password: 'cashier-password', access_key: 'access-secret' }));
        assert.doesNotMatch(diagnostics, /cashier-password|access-secret/);
    } finally {
        await close(server);
    }
});

test('runtime provider fails closed on cashier, register, UUID, type or amount mismatch', async () => {
    const receiptId = crypto.randomUUID();
    async function expectProviderError(handler, code) {
        const { server, baseUrl } = await listenMock(handler);
        try {
            const provider = createProviderFromConfig(providerConfig(baseUrl));
            await assert.rejects(
                () => provider.createSaleReceipt(saleInput(receiptId)),
                error => error instanceof CheckboxClientError && error.code === code
            );
        } finally {
            await close(server);
        }
    }

    await expectProviderError(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile({ id: crypto.randomUUID() }) };
        return { body: {} };
    }, 'checkbox_cashier_identity_mismatch');

    await expectProviderError(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift({ cash_register: { id: crypto.randomUUID() } }) };
        return { body: {} };
    }, 'checkbox_shift_register_mismatch');

    await expectProviderError(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') return { status: 201, body: checkboxReceipt(crypto.randomUUID()) };
        return { body: { valid: true } };
    }, 'checkbox_receipt_uuid_mismatch');

    await expectProviderError(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') return { status: 201, body: checkboxReceipt(receiptId, { type: 'RETURN' }) };
        return { body: { valid: true } };
    }, 'checkbox_receipt_type_mismatch');

    await expectProviderError(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') return { status: 201, body: checkboxReceipt(receiptId, { total_sum: 999 }) };
        return { body: { valid: true } };
    }, 'checkbox_receipt_total_sum_mismatch');
});

test('runtime provider blocks HTTP 200 validation responses with false result', async () => {
    const receiptId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
        if (call.path === '/api/v1/receipts/validate') return { body: { valid: false, errors: [{ code: 'bad_tax' }] } };
        return { status: 500, body: { error: 'sell must not run' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        await assert.rejects(
            () => provider.validateSale(saleInput(receiptId)),
            error => error instanceof CheckboxClientError && error.code === 'checkbox_receipt_validation_failed' && error.retryable === false
        );
        assert.equal(calls.some(call => call.path === '/api/v1/receipts/sell'), false);
    } finally {
        await close(server);
    }
});

test('runtime provider maps and verifies cash received amount and official change', async () => {
    const receiptId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') {
            return {
                status: 201,
                body: checkboxReceipt(receiptId, {
                    total_sum: 12345,
                    total_payment: 13000,
                    total_rest: 655,
                    payments: [{ type: 'CASH', value: 13000, label: 'Готівка' }]
                })
            };
        }
        return { body: { valid: true } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const input = saleInput(receiptId, {
            paymentOrder: {
                id: 301,
                payment_order_id: 301,
                fiscal_profile_id: 7,
                total_amount_minor: '12345',
                payment_method: 'cash',
                provider_organization_id: PROVIDER_ORGANIZATION_ID,
                provider_register_id: PROVIDER_REGISTER_ID,
                provider_cashier_id: PROVIDER_CASHIER_ID,
                confirmation_snapshot: { received_amount_minor: '13000', change_amount_minor: '655' }
            }
        });
        const receipt = await provider.createSaleReceipt(input);
        const sell = calls.find(call => call.path === '/api/v1/receipts/sell');
        assert.equal(sell.body.payments[0].type, 'CASH');
        assert.equal(sell.body.payments[0].value, 13000);
        assert.equal(receipt.totalRestMinor, '655');
    } finally {
        await close(server);
    }
});

test('runtime provider keeps official 202 shift OPENING recoverable without forcing immediate OPENED', async () => {
    const receiptId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock((call, allCalls) => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/shifts') return { status: 202, body: openedShift({ id: receiptId, status: 'OPENING' }) };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift({ status: 'OPENED' }) };
        return { body: { valid: true } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const response = await provider.openShift({
            providerOperationId: receiptId,
            fiscalOperation: {
                provider_operation_id: receiptId,
                provider_register_id: PROVIDER_REGISTER_ID,
                provider_cashier_id: PROVIDER_CASHIER_ID,
                provider_organization_id: PROVIDER_ORGANIZATION_ID
            }
        });
        assert.equal(response.id, receiptId);
        assert.equal(response.status, 'OPENING');
        assert.equal(calls.filter(call => call.path === '/api/v1/shifts').length, 1);
        assert.equal(calls.some(call => call.path === '/api/v1/cashier/shift'), false);
    } finally {
        await close(server);
    }
});

test('runtime provider closes shift with provider generated report payload and waits for CLOSED externally', async () => {
    const operationId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/shifts/close') return { status: 202, body: openedShift({ id: PROVIDER_SHIFT_ID, status: 'CLOSING' }) };
        return { body: {} };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const response = await provider.closeShift({
            providerOperationId: operationId,
            fiscalOperation: {
                operation_type: 'shift_close',
                provider_operation_id: operationId,
                provider_shift_id: PROVIDER_SHIFT_ID,
                provider_register_id: PROVIDER_REGISTER_ID,
                provider_cashier_id: PROVIDER_CASHIER_ID,
                provider_organization_id: PROVIDER_ORGANIZATION_ID
            }
        });
        const closeCall = calls.find(call => call.path === '/api/v1/shifts/close');
        assert.deepEqual(closeCall.body, {});
        assert.equal(response.status, 'CLOSING');
    } finally {
        await close(server);
    }
});

test('runtime provider does not inline-open shift on sale validation', async () => {
    const receiptId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift({ status: 'CREATED' }) };
        if (call.path === '/api/v1/shifts') return { status: 500, body: { error: 'sale path must not open shift' } };
        return { body: { valid: true } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        await assert.rejects(
            () => provider.validateSale(saleInput(receiptId)),
            error => error instanceof CheckboxClientError && error.code === 'checkbox_shift_not_opened'
        );
        assert.equal(calls.some(call => call.path === '/api/v1/shifts'), false);
        assert.equal(calls.some(call => call.path === '/api/v1/receipts/validate'), false);
    } finally {
        await close(server);
    }
});

test('runtime provider reuses cached token per credential ref within bounded cache', async () => {
    const receiptId = crypto.randomUUID();
    const tokenCache = new Map();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') return { status: 201, body: checkboxReceipt(receiptId) };
        if (call.path === `/api/v1/receipts/${receiptId}`) return { body: checkboxReceipt(receiptId) };
        return { body: { valid: true } };
    });
    try {
        const config = { ...providerConfig(baseUrl), credentialRef: 'park-middle', licenseRef: 'park-middle' };
        const first = createProviderFromConfig(config, { tokenCache });
        const second = createProviderFromConfig(config, { tokenCache });
        await first.createSaleReceipt(saleInput(receiptId));
        await second.lookupReceipt({ providerOperationId: receiptId, fiscalOperation: saleInput(receiptId).fiscalOperation, paymentOrder: saleInput(receiptId).paymentOrder });
        assert.equal(calls.filter(call => call.path === '/api/v1/cashier/signin').length, 1);
    } finally {
        await close(server);
    }
});

test('runtime provider treats CREATED receipt and non-OPENED shift as non-terminal states', async () => {
    assert.throws(
        () => normalizeReceiptArtifacts({ id: crypto.randomUUID(), status: 'CREATED' }, { baseUrl: 'https://checkbox.example' }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_receipt_pending' && error.unknown === true
    );
    assert.throws(
        () => normalizeReceiptArtifacts({ id: crypto.randomUUID(), status: 'ERROR' }, { baseUrl: 'https://checkbox.example' }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_receipt_failed' && error.retryable === false
    );
    assert.throws(
        () => normalizeShiftResponse({ id: crypto.randomUUID(), status: '' }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_shift_response_malformed'
    );
});

test('worker classifies Checkbox 4xx as non-retryable and 5xx/network as retryable unknown', () => {
    const validation = classifyWorkerError(new CheckboxClientError('checkbox_validation_error', 'bad payload', { status: 422, retryable: false }));
    assert.equal(validation.retryable, false);
    assert.equal(validation.unknown, false);

    const provider = classifyWorkerError(new CheckboxClientError('checkbox_provider_error', 'server failed', { status: 500, retryable: true, unknown: true }));
    assert.equal(provider.retryable, true);
    assert.equal(provider.unknown, true);
});

test('default payment outbox worker skips without claiming when Checkbox integration is disabled', async () => {
    const dbPool = {
        connected: false,
        async connect() {
            this.connected = true;
            throw new Error('disabled worker must not connect');
        }
    };
    const result = await processPaymentOutboxJobs({ dbPool, batchSize: 1, lockedBy: 'disabled-test' });
    assert.equal(result.claimed, 0);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'checkbox_integration_disabled');
    assert.equal(dbPool.connected, false);
});

test('provider factory resolves only logical refs through environment values', () => {
    const factory = createCheckboxProviderFactory({
        env: {
            CHECKBOX_INTEGRATION_ENABLED: 'true',
            CHECKBOX_EXPECT_IS_TEST: 'false',
            CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://api.checkbox.in.ua',
            CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
            CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
            CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret',
            CHECKBOX_PARK_MIDDLE_ACCESS_KEY: 'access-secret'
        }
    });
    assert.equal(factory.canResolveRefs({ credentialRef: 'park-middle', licenseRef: 'park-middle' }), true);
    assert.equal(factory.canResolveRefs({ credentialRef: 'missing', licenseRef: 'missing' }), false);
});

test('provider factory eligibility is scoped by fiscal profile and register without payment_outbox_jobs.provider', async () => {
    const queries = [];
    const dbPool = {
        async connect() {
            return {
                async query(sql) {
                    queries.push(sql);
                    return {
                        rows: [
                            {
                                fiscal_profile_id: 20,
                                fiscal_register_id: 40,
                                provider_license_ref: 'park-middle',
                                provider_cashier_login_ref: 'park-middle'
                            },
                            {
                                fiscal_profile_id: 20,
                                fiscal_register_id: 41,
                                provider_license_ref: 'park-other',
                                provider_cashier_login_ref: 'park-other'
                            }
                        ]
                    };
                },
                release() {}
            };
        }
    };
    const factory = createCheckboxProviderFactory({
        env: {
            CHECKBOX_INTEGRATION_ENABLED: 'true',
            CHECKBOX_EXPECT_IS_TEST: 'false',
            CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://api.checkbox.in.ua',
            CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
            CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
            CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret'
        }
    });

    const contexts = await factory.getEligibleRuntimeContexts(dbPool);
    assert.deepEqual(contexts, [{ fiscalProfileId: 20, fiscalRegisterId: 40 }]);
    assert.doesNotMatch(queries.join('\n'), /\bjob\.provider\b|\bpayment_outbox_jobs\.provider\b/);
});

test('runtime config does not fall back to global Checkbox secrets for logical refs', () => {
    const factory = createCheckboxProviderFactory({
        env: {
            CHECKBOX_INTEGRATION_ENABLED: 'true',
            CHECKBOX_EXPECT_IS_TEST: 'false',
            CHECKBOX_BASE_URL: 'https://api.checkbox.in.ua',
            CHECKBOX_LOGIN: 'global-cashier',
            CHECKBOX_PASSWORD: 'global-password',
            CHECKBOX_LICENSE_KEY: 'global-license'
        }
    });
    assert.equal(factory.canResolveRefs({ credentialRef: 'park-middle', licenseRef: 'park-middle' }), false);
});

test('runtime config requires explicit CHECKBOX_EXPECT_IS_TEST before enabling provider calls', () => {
    const env = {
        CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://api.checkbox.in.ua',
        CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
        CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
        CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret'
    };
    assert.throws(
        () => loadCheckboxRuntimeConfig({ credentialRef: 'park-middle', licenseRef: 'park-middle', env }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_expected_is_test_required'
    );
    assert.throws(
        () => loadCheckboxRuntimeConfig({ credentialRef: 'park-middle', licenseRef: 'park-middle', env: { ...env, CHECKBOX_EXPECT_IS_TEST: 'sandbox' } }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_expected_is_test_invalid'
    );
    assert.equal(loadCheckboxRuntimeConfig({ credentialRef: 'park-middle', licenseRef: 'park-middle', env: { ...env, CHECKBOX_EXPECT_IS_TEST: 'true' } }).expectedIsTest, true);
    assert.equal(loadCheckboxRuntimeConfig({ credentialRef: 'park-middle', licenseRef: 'park-middle', env: { ...env, CHECKBOX_EXPECT_IS_TEST: 'false' } }).expectedIsTest, false);
});

test('runtime config fails closed for credential ref collisions and non-allowlisted URLs', () => {
    assert.throws(
        () => loadCheckboxRuntimeConfig({
            credentialRef: 'park-middle',
            licenseRef: 'park_middle',
            env: {
                CHECKBOX_EXPECT_IS_TEST: 'false',
                CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://api.checkbox.in.ua',
                CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
                CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
                CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret'
            }
        }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_credential_ref_collision'
    );

    assert.throws(
        () => loadCheckboxRuntimeConfig({
            credentialRef: 'park-middle',
            licenseRef: 'park-middle',
            env: {
                CHECKBOX_EXPECT_IS_TEST: 'false',
                CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://evil.example',
                CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
                CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
                CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret'
            }
        }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_runtime_base_url_not_allowed'
    );

    assert.throws(
        () => loadCheckboxRuntimeConfig({
            credentialRef: 'park-middle',
            licenseRef: 'park-middle',
            env: {
                CHECKBOX_EXPECT_IS_TEST: 'false',
                CHECKBOX_PARK_MIDDLE_BASE_URL: 'http://127.0.0.1:18080',
                CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
                CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
                CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret'
            }
        }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_runtime_base_url_not_allowed'
    );

    const config = loadCheckboxRuntimeConfig({
        credentialRef: 'park-middle',
        licenseRef: 'park-middle',
        env: {
            CHECKBOX_ALLOW_LOCAL_MOCK_HOST: 'true',
            CHECKBOX_EXPECT_IS_TEST: 'false',
            CHECKBOX_PARK_MIDDLE_BASE_URL: 'http://127.0.0.1:18080',
            CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
            CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
            CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret'
        }
    });
    assert.equal(config.baseUrl, 'http://127.0.0.1:18080');
});
