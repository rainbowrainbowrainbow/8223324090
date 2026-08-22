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
const { classifyWorkerError, processPaymentOutboxJobs, runShiftJob } = require('../services/payments/paymentOutboxWorker');

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
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
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
    await expectReadinessError({ cashier: { permissions: { sales: false, cash_payment: true, card_payment: true } } }, 'checkbox_cashier_permissions_missing');
    await expectReadinessError({ signature: { online: false } }, 'checkbox_signature_offline');
    await expectReadinessError({ register: { is_test: true } }, 'checkbox_register_test_mode_mismatch');
    await expectReadinessError({ register: { offline_mode: true } }, 'checkbox_register_offline');
    await expectReadinessError({ register: { organization_id: 'wrong-org' } }, 'checkbox_register_organization_mismatch');
    await expectReadinessError({ taxes: cashierTaxes({ id: '9', code: 9 }) }, 'checkbox_provider_tax_ids_unavailable');
});

test('mutation readiness requires a live certificate except for the exact test signature contract', async () => {
    async function expectCertificateResult({ profileOverrides = {}, signatureOverrides = {}, expectedIsTest = false, errorCode = null }) {
        const { server, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') return { body: cashierProfile(profileOverrides) };
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo({ is_test: expectedIsTest }) };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus(signatureOverrides) };
            if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig({ ...providerConfig(baseUrl), expectedIsTest });
            const call = () => provider.verifyReadiness({
                expectedCashierId: PROVIDER_CASHIER_ID,
                expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                expectedRegisterId: PROVIDER_REGISTER_ID,
                expectedIsTest
            }, { expectedTaxIds: ['7'], requiredTender: 'cash' });
            if (errorCode) {
                await assert.rejects(call, error => error instanceof CheckboxClientError && error.code === errorCode);
                return;
            }
            const result = await call();
            assert.equal(result.certificate.ready, true);
            assert.equal(result.certificate.testSignature, true);
        } finally {
            await close(server);
        }
    }

    await expectCertificateResult({
        profileOverrides: { certificate_end: null },
        errorCode: 'checkbox_cashier_certificate_required'
    });
    await expectCertificateResult({
        profileOverrides: { certificate_end: new Date(Date.now() - 60_000).toISOString() },
        errorCode: 'checkbox_cashier_certificate_expired'
    });
    await expectCertificateResult({
        profileOverrides: { is_test: true, signature_type: 'TEST', certificate_end: null },
        signatureOverrides: { type: 'CLOUD_SIGNATURE_3' },
        expectedIsTest: true,
        errorCode: 'checkbox_cashier_certificate_required'
    });
    await expectCertificateResult({
        profileOverrides: { is_test: true, signature_type: 'TEST', certificate_end: null },
        signatureOverrides: { type: 'TEST' },
        expectedIsTest: true
    });
});

test('runtime provider readiness requires only the permission for the selected tender', async () => {
    async function verifyFor({ permissions, requiredTender }) {
        const { server, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') return { body: cashierProfile({ permissions }) };
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus() };
            if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig(providerConfig(baseUrl));
            return await provider.verifyReadiness({
                expectedCashierId: PROVIDER_CASHIER_ID,
                expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                expectedRegisterId: PROVIDER_REGISTER_ID,
                expectedIsTest: false
            }, { expectedTaxIds: ['7'], requiredTender });
        } finally {
            await close(server);
        }
    }

    const cash = await verifyFor({
        permissions: { sales: true, cash_payment: true, card_payment: false },
        requiredTender: 'cash'
    });
    assert.deepEqual(cash.permissions.required, ['sales', 'cash_payment']);
    assert.equal(cash.permissions.cardPayment, false);

    const card = await verifyFor({
        permissions: { sales: true, cash_payment: false, card_payment: true },
        requiredTender: 'card_terminal_manual'
    });
    assert.deepEqual(card.permissions.required, ['sales', 'card_payment']);
    assert.equal(card.permissions.cashPayment, false);

    const providerCore = await verifyFor({
        permissions: { sales: true, cash_payment: true, card_payment: false },
        requiredTender: null
    });
    assert.deepEqual(providerCore.permissions.required, ['sales']);
    assert.equal(providerCore.permissions.cardPayment, false);
});

test('mutation readiness applies tender permissions only to sale operations', async () => {
    async function prepare(operationType, permissions) {
        const { server, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') return { body: cashierProfile({ permissions }) };
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus() };
            if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig(providerConfig(baseUrl));
            return await provider.prepareMutation({
                providerOperationId: crypto.randomUUID(),
                fiscalOperation: {
                    operation_type: operationType,
                    provider_register_id: PROVIDER_REGISTER_ID,
                    provider_cashier_id: PROVIDER_CASHIER_ID,
                    provider_organization_id: PROVIDER_ORGANIZATION_ID
                }
            });
        } finally {
            await close(server);
        }
    }

    const shiftOpen = await prepare('shift_open', { sales: true, cash_payment: false, card_payment: false });
    assert.deepEqual(shiftOpen.permissions.required, ['sales']);

    const shiftClose = await prepare('shift_close', { sales: false, cash_payment: false, card_payment: false });
    assert.deepEqual(shiftClose.permissions.required, []);
});

test('opened current shift cannot fall back to its sparse response when detailed lookup fails', async () => {
    const { server, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { status: 404, body: { detail: 'not found' } };
        return { status: 404, body: { detail: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        await assert.rejects(
            () => provider.getCurrentShiftStatus({
                providerOperationId: crypto.randomUUID(),
                fiscalOperation: {
                    provider_shift_id: PROVIDER_SHIFT_ID,
                    provider_register_id: PROVIDER_REGISTER_ID,
                    provider_cashier_id: PROVIDER_CASHIER_ID,
                    provider_organization_id: PROVIDER_ORGANIZATION_ID
                }
            }),
            error => error instanceof CheckboxClientError && error.status === 404
        );
    } finally {
        await close(server);
    }
});

test('runtime provider permits unreported payment permissions only for explicit test mode', async () => {
    async function createTestProvider(permissions, { expectedIsTest = true } = {}) {
        const { server, calls, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') {
                return {
                    body: cashierProfile({
                        is_test: expectedIsTest,
                        signature_type: expectedIsTest ? 'TEST' : 'CLOUD_SIGNATURE_3',
                        permissions
                    })
                };
            }
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo({ is_test: expectedIsTest }) };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus({ type: expectedIsTest ? 'TEST' : 'CLOUD_SIGNATURE_3' }) };
            if (call.path === '/api/v1/cashier/tax') return { body: [] };
            if (call.path === '/api/v1/cashier/shift') return { body: null };
            return { status: 404, body: { error: 'not found' } };
        });
        return {
            server,
            calls,
            provider: createProviderFromConfig({ ...providerConfig(baseUrl), expectedIsTest })
        };
    }

    const allowed = await createTestProvider({ sales: true, cash_payment: null });
    try {
        const expected = {
            expectedCashierId: PROVIDER_CASHIER_ID,
            expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
            expectedRegisterId: PROVIDER_REGISTER_ID,
            expectedIsTest: true
        };
        const readiness = await allowed.provider.verifyReadiness(expected, {
            expectedTaxIds: [],
            requiredTender: 'cash',
            allowUnreportedPaymentPermissions: true
        });
        assert.equal(readiness.permissions.cashPayment, null);
        assert.deepEqual(readiness.permissions.unreported, ['cash_payment']);
        assert.equal(readiness.permissions.unreportedAllowedForTest, true);
        assert.equal(readiness.permissions.warning, 'permission_unreported');
        assert.equal(Object.hasOwn(readiness, 'raw'), false);

        const diagnostics = await allowed.provider.collectReadinessDiagnostics(expected, {
            expectedTaxIds: [],
            requiredTender: 'cash',
            allowUnreportedPaymentPermissions: true
        });
        const byCode = new Map(diagnostics.checks.map(check => [check.code, check]));
        assert.equal(diagnostics.ready, true);
        assert.equal(byCode.get('cash_permission').status, 'ready');
        assert.equal(byCode.get('cash_permission').details.state, 'unreported');
        assert.equal(byCode.get('cash_permission').details.unreportedAllowedForTest, true);
        assert.equal(byCode.get('card_permission').status, 'not_applicable');
        assert.equal(Object.hasOwn(diagnostics, 'raw'), false);
        assert.doesNotMatch(JSON.stringify(diagnostics), /full_name|nin|organization.*title/i);
    } finally {
        await close(allowed.server);
    }

    const defaultClosed = await createTestProvider({ sales: true, cash_payment: null });
    try {
        await assert.rejects(
            () => defaultClosed.provider.verifyReadiness({
                expectedCashierId: PROVIDER_CASHIER_ID,
                expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                expectedRegisterId: PROVIDER_REGISTER_ID,
                expectedIsTest: true
            }, { expectedTaxIds: [], requiredTender: 'cash' }),
            error => error instanceof CheckboxClientError
                && error.code === 'checkbox_cashier_permissions_missing'
                && error.details?.unreported?.includes('cash_payment')
        );
    } finally {
        await close(defaultClosed.server);
    }

    const production = await createTestProvider({ sales: true, cash_payment: null }, { expectedIsTest: false });
    try {
        await assert.rejects(
            () => production.provider.verifyReadiness({ expectedIsTest: false }, {
                requiredTender: 'cash',
                allowUnreportedPaymentPermissions: true
            }),
            error => error instanceof CheckboxClientError && error.code === 'checkbox_unreported_permissions_test_mode_only'
        );
        assert.equal(production.calls.length, 0);
    } finally {
        await close(production.server);
    }
});

test('runtime provider never permits an explicit false permission in test mode', async () => {
    const { server, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') {
            return { body: cashierProfile({ is_test: true, signature_type: 'TEST', permissions: { sales: true, cash_payment: false, card_payment: true } }) };
        }
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo({ is_test: true }) };
        if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus({ type: 'TEST' }) };
        if (call.path === '/api/v1/cashier/tax') return { body: [] };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig({ ...providerConfig(baseUrl), expectedIsTest: true });
        await assert.rejects(
            () => provider.verifyReadiness({
                expectedCashierId: PROVIDER_CASHIER_ID,
                expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                expectedRegisterId: PROVIDER_REGISTER_ID,
                expectedIsTest: true
            }, {
                expectedTaxIds: [],
                requiredTender: 'cash',
                allowUnreportedPaymentPermissions: true
            }),
            error => error instanceof CheckboxClientError
                && error.code === 'checkbox_cashier_permissions_missing'
                && error.details?.denied?.includes('cash_payment')
        );
    } finally {
        await close(server);
    }
});

test('runtime provider requires sales permission to be true even when test payment permissions may be unreported', async () => {
    async function expectSalesBlocked(sales) {
        const { server, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') {
                return {
                    body: cashierProfile({
                        is_test: true,
                        signature_type: 'TEST',
                        permissions: { sales, cash_payment: null, card_payment: null }
                    })
                };
            }
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo({ is_test: true }) };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus({ type: 'TEST' }) };
            if (call.path === '/api/v1/cashier/tax') return { body: [] };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig({ ...providerConfig(baseUrl), expectedIsTest: true });
            await assert.rejects(
                () => provider.verifyReadiness({
                    expectedCashierId: PROVIDER_CASHIER_ID,
                    expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                    expectedRegisterId: PROVIDER_REGISTER_ID,
                    expectedIsTest: true
                }, {
                    expectedTaxIds: [],
                    requiredTender: 'cash',
                    allowUnreportedPaymentPermissions: true
                }),
                error => error instanceof CheckboxClientError
                    && error.code === 'checkbox_cashier_permissions_missing'
                    && (sales === false
                        ? error.details?.denied?.includes('sales')
                        : error.details?.unreportedSales?.includes('sales'))
            );
        } finally {
            await close(server);
        }
    }

    await expectSalesBlocked(null);
    await expectSalesBlocked(false);
});

test('runtime provider never treats malformed payment permissions as unreported test permissions', async () => {
    for (const malformedValue of ['false', 0, {}]) {
        const { server, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') {
                return {
                    body: cashierProfile({
                        is_test: true,
                        signature_type: 'TEST',
                        permissions: { sales: true, cash_payment: malformedValue, card_payment: null }
                    })
                };
            }
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo({ is_test: true }) };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus({ type: 'TEST' }) };
            if (call.path === '/api/v1/cashier/tax') return { body: [] };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig({ ...providerConfig(baseUrl), expectedIsTest: true });
            await assert.rejects(
                () => provider.verifyReadiness({
                    expectedCashierId: PROVIDER_CASHIER_ID,
                    expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                    expectedRegisterId: PROVIDER_REGISTER_ID,
                    expectedIsTest: true
                }, {
                    expectedTaxIds: [],
                    requiredTender: 'cash',
                    allowUnreportedPaymentPermissions: true
                }),
                error => error instanceof CheckboxClientError
                    && error.code === 'checkbox_cashier_permissions_malformed'
                    && error.details?.malformed?.includes('cash_payment')
            );
        } finally {
            await close(server);
        }
    }
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

test('runtime provider aggregate readiness reports all read-only blockers without fiscal mutations', async () => {
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') {
            return {
                body: cashierProfile({
                    permissions: { sales: true, cash_payment: null, card_payment: false },
                    certificate_end: null
                })
            };
        }
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo({ offline_mode: true }) };
        if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus({ online: false }) };
        if (call.path === '/api/v1/cashier/tax') return { body: [] };
        if (call.path === '/api/v1/cashier/shift') return { status: 404, body: { error: 'no shift' } };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const diagnostics = await provider.collectReadinessDiagnostics({
            expectedCashierId: PROVIDER_CASHIER_ID,
            expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
            expectedRegisterId: PROVIDER_REGISTER_ID,
            expectedIsTest: false
        }, { expectedTaxIds: ['7'] });
        const byCode = new Map(diagnostics.checks.map(check => [check.code, check]));
        assert.equal(diagnostics.ready, false);
        assert.equal(byCode.get('auth').status, 'ready');
        assert.equal(byCode.get('sales_permission').status, 'ready');
        assert.equal(byCode.get('cash_permission').status, 'blocked');
        assert.equal(byCode.get('card_permission').status, 'blocked');
        assert.equal(byCode.get('signature').status, 'blocked');
        assert.equal(byCode.get('certificate').status, 'blocked');
        assert.equal(byCode.get('provider_taxes').status, 'blocked');
        assert.equal(byCode.get('register_online').status, 'blocked');
        assert.equal(byCode.get('current_shift').status, 'not_applicable');
        assert.match(byCode.get('cash_permission').recommendation, /cash payment/);
        assert.match(byCode.get('card_permission').recommendation, /card\/cashless payment/);
        assert.equal(calls.some(call => ['/api/v1/shifts', '/api/v1/receipts/validate', '/api/v1/receipts/sell', '/api/v1/shifts/close'].includes(call.path)), false);
        assert.doesNotMatch(JSON.stringify(diagnostics), /cashier-password|license-secret|access-secret|token-1/i);
    } finally {
        await close(server);
    }
});

test('runtime provider aggregate readiness treats null current shift as no open shift', async () => {
    const { server, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
        if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus() };
        if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
        if (call.path === '/api/v1/cashier/shift') return { body: null };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const diagnostics = await provider.collectReadinessDiagnostics({
            expectedCashierId: PROVIDER_CASHIER_ID,
            expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
            expectedRegisterId: PROVIDER_REGISTER_ID,
            expectedIsTest: false
        }, { expectedTaxIds: ['7'] });
        const currentShift = diagnostics.checks.find(check => check.code === 'current_shift');
        assert.equal(currentShift.status, 'not_applicable');
        assert.equal(currentShift.ready, true);
        assert.equal(currentShift.details.shiftStatus, 'none');
    } finally {
        await close(server);
    }
});

test('runtime provider aggregate readiness accepts test signature without certificate end only in test mode', async () => {
    const { server, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') {
            return { body: cashierProfile({ is_test: true, signature_type: 'TEST', certificate_end: null }) };
        }
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo({ is_test: true }) };
        if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus({ type: 'TEST' }) };
        if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
        if (call.path === '/api/v1/cashier/shift') return { body: null };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig({ ...providerConfig(baseUrl), expectedIsTest: true });
        const diagnostics = await provider.collectReadinessDiagnostics({
            expectedCashierId: PROVIDER_CASHIER_ID,
            expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
            expectedRegisterId: PROVIDER_REGISTER_ID,
            expectedIsTest: true
        }, { expectedTaxIds: [] });
        const certificate = diagnostics.checks.find(check => check.code === 'certificate');
        assert.equal(certificate.status, 'ready');
        assert.equal(certificate.details.certificateEndConfigured, false);
        assert.equal(certificate.details.testSignature, true);
    } finally {
        await close(server);
    }
});

test('runtime provider aggregate readiness distinguishes cash/card permission true, false and null', async () => {
    async function runPermissions(permissions) {
        const { server, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') return { body: cashierProfile({ permissions }) };
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus() };
            if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
            if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig(providerConfig(baseUrl));
            const diagnostics = await provider.collectReadinessDiagnostics({
                expectedCashierId: PROVIDER_CASHIER_ID,
                expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                expectedRegisterId: PROVIDER_REGISTER_ID,
                expectedIsTest: false
            }, { expectedTaxIds: ['7'] });
            return new Map(diagnostics.checks.map(check => [check.code, check]));
        } finally {
            await close(server);
        }
    }

    let checks = await runPermissions({ sales: true, cash_payment: true, card_payment: true });
    assert.equal(checks.get('cash_permission').status, 'ready');
    assert.equal(checks.get('card_permission').status, 'ready');

    checks = await runPermissions({ sales: true, cash_payment: false, card_payment: false });
    assert.equal(checks.get('cash_permission').status, 'blocked');
    assert.equal(checks.get('cash_permission').details.value, false);
    assert.equal(checks.get('card_permission').details.value, false);

    checks = await runPermissions({ sales: true, cash_payment: null, card_payment: null });
    assert.equal(checks.get('cash_permission').status, 'blocked');
    assert.equal(checks.get('cash_permission').details.value, null);
    assert.equal(checks.get('card_permission').details.value, null);

    checks = await runPermissions({ sales: true, cash_payment: 'false', card_payment: {} });
    assert.equal(checks.get('cash_permission').status, 'blocked');
    assert.equal(checks.get('cash_permission').details.state, 'malformed');
    assert.equal(checks.get('card_permission').status, 'blocked');
    assert.equal(checks.get('card_permission').details.state, 'malformed');
});

test('runtime provider aggregate readiness supports password and PIN auth modes', async () => {
    async function runAuthMode(configOverrides, expectedPath) {
        const { server, calls, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin' || call.path === '/api/v1/cashier/signinPinCode') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
            if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
            if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus() };
            if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
            if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig({ ...providerConfig(baseUrl), ...configOverrides });
            const diagnostics = await provider.collectReadinessDiagnostics({
                expectedCashierId: PROVIDER_CASHIER_ID,
                expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
                expectedRegisterId: PROVIDER_REGISTER_ID,
                expectedIsTest: false
            }, { expectedTaxIds: ['7'] });
            assert.equal(diagnostics.checks.find(check => check.code === 'auth').status, 'ready');
            assert.ok(calls.find(call => call.path === expectedPath));
            return calls.find(call => call.path === expectedPath);
        } finally {
            await close(server);
        }
    }

    const passwordCall = await runAuthMode({ authMode: 'password' }, '/api/v1/cashier/signin');
    assert.deepEqual(passwordCall.body, { login: 'cashier-login', password: 'cashier-password' });

    const pinCode = crypto.randomUUID();
    const pinCall = await runAuthMode({ authMode: 'pin', login: '', password: '', pinCode }, '/api/v1/cashier/signinPinCode');
    assert.deepEqual(pinCall.body, { pin_code: pinCode });
    assert.equal(pinCall.headers['x-license-key'], 'license-secret');
});

test('runtime provider aggregate readiness reports identity and is_test mismatch without hiding other checks', async () => {
    const { server, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile({ id: 'wrong-cashier', is_test: true, organization: { id: 'wrong-org' } }) };
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo({ id: 'wrong-register', organization_id: 'wrong-org', is_test: true }) };
        if (call.path === '/api/v1/cashier/check-signature') return { body: signatureStatus() };
        if (call.path === '/api/v1/cashier/tax') return { body: cashierTaxes() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift({ cash_register: { id: 'wrong-register' } }) };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const diagnostics = await provider.collectReadinessDiagnostics({
            expectedCashierId: PROVIDER_CASHIER_ID,
            expectedOrganizationId: PROVIDER_ORGANIZATION_ID,
            expectedRegisterId: PROVIDER_REGISTER_ID,
            expectedIsTest: false
        }, { expectedTaxIds: ['7'] });
        const byCode = new Map(diagnostics.checks.map(check => [check.code, check]));
        assert.equal(byCode.get('cashier_identity').status, 'blocked');
        assert.equal(byCode.get('organization_identity').status, 'unavailable');
        assert.equal(byCode.get('is_test').status, 'unavailable');
        assert.equal(byCode.get('register_identity').status, 'blocked');
        assert.equal(byCode.get('signature').status, 'ready');
        assert.equal(byCode.get('provider_taxes').status, 'ready');
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
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
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
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
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
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
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
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') return { status: 201, body: checkboxReceipt(crypto.randomUUID()) };
        return { body: { valid: true } };
    }, 'checkbox_receipt_uuid_mismatch');

    await expectProviderError(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
        if (call.path === '/api/v1/receipts/sell') return { status: 201, body: checkboxReceipt(receiptId, { type: 'RETURN' }) };
        return { body: { valid: true } };
    }, 'checkbox_receipt_type_mismatch');

    await expectProviderError(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift() };
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
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
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
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

test('shift-open recovery requires two exact UUID 404 observations before retrying the same UUID', async () => {
    const shiftId = crypto.randomUUID();
    const calls = [];
    const stages = [];
    const provider = {
        async lookupShift(input) {
            calls.push({ method: 'lookupShift', input });
            throw new CheckboxClientError('checkbox_validation_error', 'Checkbox HTTP 404', {
                status: 404,
                retryable: false
            });
        },
        async openShift(input) {
            calls.push({ method: 'openShift', input });
            return { id: shiftId, status: 'OPENED' };
        }
    };

    await assert.rejects(
        () => runShiftJob(provider, {
            job: {
                job_type: 'shift_open',
                external_stage: 'shift_request_maybe_submitted',
                provider_operation_id: shiftId,
                payload: {}
            },
            async recordStage(stage) { stages.push(stage); }
        }),
        error => error?.code === 'checkbox_shift_open_lookup_not_found'
            && error.retryable === true
            && error.unknown === true
    );

    assert.deepEqual(stages, ['shift_lookup', 'shift_lookup_not_found']);
    assert.equal(calls.filter(call => call.method === 'lookupShift').length, 1);
    assert.equal(calls.filter(call => call.method === 'openShift').length, 0);
    assert.equal(calls[0].input.providerOperationId, shiftId);
    assert.equal(calls[0].input.providerRequestUuid, shiftId);
});

test('confirmed shift lookup 404 retries open with the same durable UUID only', async () => {
    const shiftId = crypto.randomUUID();
    const calls = [];
    const stages = [];
    const provider = {
        async lookupShift(input) {
            calls.push({ method: 'lookupShift', input });
            throw new CheckboxClientError('checkbox_validation_error', 'Checkbox HTTP 404', {
                status: 404,
                retryable: false
            });
        },
        async prepareMutation(input) {
            calls.push({ method: 'prepareMutation', input });
        },
        async openShift(input) {
            calls.push({ method: 'openShift', input });
            return { id: shiftId, status: 'OPENED' };
        }
    };

    const result = await runShiftJob(provider, {
        job: {
            job_type: 'shift_open',
            external_stage: 'shift_lookup_not_found',
            provider_operation_id: shiftId,
            payload: {}
        },
        async recordStage(stage) { stages.push(stage); }
    });

    assert.equal(result.source, 'shift_open_same_uuid_retry');
    assert.equal(result.response.id, shiftId);
    assert.deepEqual(stages, ['readiness', 'shift_request_retry_same_uuid', 'shift_request_maybe_submitted']);
    assert.deepEqual(calls.map(call => call.method), ['lookupShift', 'prepareMutation', 'openShift']);
    for (const call of calls) {
        assert.equal(call.input.providerOperationId, shiftId);
        assert.equal(call.input.providerRequestUuid, shiftId);
    }
});

test('same-UUID shift-open conflict returns to exact lookup instead of creating a new UUID', async () => {
    const shiftId = crypto.randomUUID();
    const calls = [];
    const stages = [];
    const provider = {
        async lookupShift(input) {
            calls.push({ method: 'lookupShift', input });
            throw new CheckboxClientError('checkbox_validation_error', 'Checkbox HTTP 404', {
                status: 404,
                retryable: false
            });
        },
        async prepareMutation(input) {
            calls.push({ method: 'prepareMutation', input });
        },
        async openShift(input) {
            calls.push({ method: 'openShift', input });
            throw new CheckboxClientError('checkbox_validation_error', 'Checkbox HTTP 409', {
                status: 409,
                retryable: false
            });
        }
    };

    await assert.rejects(
        () => runShiftJob(provider, {
            job: {
                job_type: 'shift_open',
                external_stage: 'shift_lookup_not_found',
                provider_operation_id: shiftId,
                payload: {}
            },
            async recordStage(stage) { stages.push(stage); }
        }),
        error => error?.code === 'checkbox_shift_open_conflict_lookup_required'
            && error.retryable === true
            && error.unknown === true
    );

    assert.deepEqual(stages, [
        'readiness',
        'shift_request_retry_same_uuid',
        'shift_request_maybe_submitted',
        'shift_lookup'
    ]);
    assert.equal(calls.filter(call => call.method === 'openShift').length, 1);
    assert.equal(calls.find(call => call.method === 'openShift').input.providerRequestUuid, shiftId);
});

test('runtime provider closes shift with provider generated report payload and waits for CLOSED externally', async () => {
    const operationId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
        if (call.path === '/api/v1/cashier/shift') {
            return { body: openedShift({ cashier: undefined }) };
        }
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
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
        assert.equal(response.id, PROVIDER_SHIFT_ID);
        assert.ok(calls.findIndex(call => call.path === '/api/v1/cashier/shift') < calls.findIndex(call => call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`));
        assert.ok(calls.findIndex(call => call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) < calls.findIndex(call => call.path === '/api/v1/shifts/close'));
    } finally {
        await close(server);
    }
});

test('runtime provider blocks shift close before mutation on wrong organization, current shift, or detailed cashier', async () => {
    const operationId = crypto.randomUUID();
    const input = {
        providerOperationId: operationId,
        fiscalOperation: {
            operation_type: 'shift_close',
            provider_operation_id: operationId,
            provider_shift_id: PROVIDER_SHIFT_ID,
            provider_register_id: PROVIDER_REGISTER_ID,
            provider_cashier_id: PROVIDER_CASHIER_ID,
            provider_organization_id: PROVIDER_ORGANIZATION_ID
        }
    };
    const scenarios = [
        {
            name: 'wrong organization',
            errorCode: 'checkbox_organization_identity_mismatch',
            profile: cashierProfile({ organization: { id: crypto.randomUUID() } }),
            current: openedShift(),
            detailed: openedShift()
        },
        {
            name: 'wrong register organization',
            errorCode: 'checkbox_register_organization_mismatch',
            profile: cashierProfile(),
            register: cashRegisterInfo({ organization_id: crypto.randomUUID() }),
            current: openedShift(),
            detailed: openedShift()
        },
        {
            name: 'wrong current shift',
            errorCode: 'checkbox_shift_id_mismatch',
            profile: cashierProfile(),
            current: openedShift({ id: crypto.randomUUID() }),
            detailed: openedShift()
        },
        {
            name: 'wrong detailed cashier',
            errorCode: 'checkbox_shift_cashier_mismatch',
            profile: cashierProfile(),
            current: openedShift({ cashier: undefined }),
            detailed: openedShift({ cashier: { id: crypto.randomUUID() } })
        }
    ];

    for (const scenario of scenarios) {
        const { server, calls, baseUrl } = await listenMock(call => {
            if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
            if (call.path === '/api/v1/cashier/me') return { body: scenario.profile };
            if (call.path === '/api/v1/cash-registers/info') return { body: scenario.register || cashRegisterInfo() };
            if (call.path === '/api/v1/cashier/shift') return { body: scenario.current };
            if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: scenario.detailed };
            if (call.path === '/api/v1/shifts/close') return { status: 500, body: { error: 'must not close' } };
            return { status: 404, body: { error: 'not found' } };
        });
        try {
            const provider = createProviderFromConfig(providerConfig(baseUrl));
            await assert.rejects(
                () => provider.closeShift(input),
                error => error instanceof CheckboxClientError && error.code === scenario.errorCode,
                scenario.name
            );
            assert.equal(calls.some(call => call.path === '/api/v1/shifts/close'), false, scenario.name);
        } finally {
            await close(server);
        }
    }
});

test('runtime provider requires complete immutable shift-close identity before any HTTP', async () => {
    const provider = createProviderFromConfig(providerConfig('http://127.0.0.1:9'));
    await assert.rejects(
        () => provider.closeShift({
            providerOperationId: crypto.randomUUID(),
            fiscalOperation: {
                operation_type: 'shift_close',
                provider_shift_id: PROVIDER_SHIFT_ID
            }
        }),
        error => error instanceof CheckboxClientError
            && error.code === 'checkbox_shift_close_identity_required'
            && error.details?.missing?.includes('provider_register_id')
            && error.details?.missing?.includes('provider_cashier_id')
            && error.details?.missing?.includes('provider_organization_id')
    );
});

test('runtime provider rejects a shift-close response that does not match the immutable shift', async () => {
    const operationId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift({ cashier: undefined }) };
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
        if (call.path === '/api/v1/shifts/close') {
            return { status: 202, body: openedShift({ id: crypto.randomUUID(), status: 'CLOSING' }) };
        }
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        await assert.rejects(
            () => provider.closeShift({
                providerOperationId: operationId,
                fiscalOperation: {
                    operation_type: 'shift_close',
                    provider_operation_id: operationId,
                    provider_shift_id: PROVIDER_SHIFT_ID,
                    provider_register_id: PROVIDER_REGISTER_ID,
                    provider_cashier_id: PROVIDER_CASHIER_ID,
                    provider_organization_id: PROVIDER_ORGANIZATION_ID
                }
            }),
            error => error instanceof CheckboxClientError && error.code === 'checkbox_shift_id_mismatch'
        );
        assert.equal(calls.filter(call => call.path === '/api/v1/shifts/close').length, 1);
    } finally {
        await close(server);
    }
});

test('runtime provider rechecks worker lease ownership immediately before non-idempotent shift close POST', async () => {
    const operationId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1' } };
        if (call.path === '/api/v1/cashier/me') return { body: cashierProfile() };
        if (call.path === '/api/v1/cash-registers/info') return { body: cashRegisterInfo() };
        if (call.path === '/api/v1/cashier/shift') return { body: openedShift({ cashier: undefined }) };
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
        if (call.path === '/api/v1/shifts/close') return { status: 202, body: openedShift({ status: 'CLOSING' }) };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        const ownershipError = new Error('payment outbox lease ownership lost');
        ownershipError.code = 'payment_outbox_job_ownership_lost';
        let ownershipChecks = 0;
        await assert.rejects(
            () => provider.closeShift({
                providerOperationId: operationId,
                fiscalOperation: {
                    operation_type: 'shift_close',
                    provider_operation_id: operationId,
                    provider_shift_id: PROVIDER_SHIFT_ID,
                    provider_register_id: PROVIDER_REGISTER_ID,
                    provider_cashier_id: PROVIDER_CASHIER_ID,
                    provider_organization_id: PROVIDER_ORGANIZATION_ID
                },
                async beforeExternalMutation() {
                    ownershipChecks += 1;
                    throw ownershipError;
                }
            }),
            error => error === ownershipError
        );
        assert.equal(ownershipChecks, 1);
        assert.equal(calls.filter(call => call.path === '/api/v1/shifts/close').length, 0);
        assert.equal(calls.some(call => call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`), true);
    } finally {
        await close(server);
    }
});

test('shift-close timeout recovery looks up the exact immutable shift instead of the current shift', async () => {
    const calls = [];
    const provider = {
        async lookupShift(input, options) {
            calls.push({ method: 'lookupShift', input, options });
            return {
                id: PROVIDER_SHIFT_ID,
                status: 'CLOSED',
                registerId: PROVIDER_REGISTER_ID,
                cashierId: PROVIDER_CASHIER_ID
            };
        },
        async getCurrentShiftStatus() {
            calls.push({ method: 'getCurrentShiftStatus' });
            return { id: crypto.randomUUID(), status: 'OPENED' };
        },
        async closeShift() {
            calls.push({ method: 'closeShift' });
            throw new Error('close must not be repeated during lookup-only recovery');
        }
    };
    const stages = [];
    const result = await runShiftJob(provider, {
        job: {
            job_type: 'shift_close',
            external_stage: 'shift_close_lookup',
            provider_operation_id: crypto.randomUUID(),
            provider_shift_id: PROVIDER_SHIFT_ID,
            provider_register_id: PROVIDER_REGISTER_ID,
            provider_cashier_id: PROVIDER_CASHIER_ID,
            provider_organization_id: PROVIDER_ORGANIZATION_ID,
            payload: { provider_shift_id: PROVIDER_SHIFT_ID }
        },
        async recordStage(stage) { stages.push(stage); }
    });

    assert.equal(result.source, 'shift_close_lookup');
    assert.equal(result.response.id, PROVIDER_SHIFT_ID);
    assert.equal(result.response.status, 'CLOSED');
    assert.deepEqual(stages, ['shift_close_lookup']);
    assert.equal(calls.filter(call => call.method === 'lookupShift').length, 1);
    assert.deepEqual(calls[0].options, { requireOpened: false });
    assert.equal(calls.some(call => call.method === 'getCurrentShiftStatus'), false);
    assert.equal(calls.some(call => call.method === 'closeShift'), false);
});

test('shift-close recovery observes exact OPENED shift twice before retrying close', async () => {
    const operationId = crypto.randomUUID();
    const calls = [];
    const firstStages = [];
    const provider = {
        async lookupShift(input, options) {
            calls.push({ method: 'lookupShift', input, options });
            return {
                id: PROVIDER_SHIFT_ID,
                status: 'OPENED',
                registerId: PROVIDER_REGISTER_ID,
                cashierId: PROVIDER_CASHIER_ID
            };
        },
        async prepareMutation(input) {
            calls.push({ method: 'prepareMutation', input });
        },
        async closeShift(input) {
            calls.push({ method: 'closeShift', input });
            return {
                id: PROVIDER_SHIFT_ID,
                status: 'CLOSED',
                registerId: PROVIDER_REGISTER_ID,
                cashierId: PROVIDER_CASHIER_ID
            };
        }
    };
    const baseJob = {
        job_type: 'shift_close',
        provider_operation_id: operationId,
        provider_shift_id: PROVIDER_SHIFT_ID,
        provider_register_id: PROVIDER_REGISTER_ID,
        provider_cashier_id: PROVIDER_CASHIER_ID,
        provider_organization_id: PROVIDER_ORGANIZATION_ID,
        payload: { provider_shift_id: PROVIDER_SHIFT_ID }
    };

    await assert.rejects(
        () => runShiftJob(provider, {
            job: { ...baseJob, external_stage: 'shift_close_request_maybe_submitted' },
            async recordStage(stage) { firstStages.push(stage); }
        }),
        error => error?.code === 'checkbox_shift_close_still_open'
            && error.retryable === true
            && error.unknown === true
    );
    assert.deepEqual(firstStages, ['shift_close_lookup', 'shift_close_lookup_still_open']);
    assert.equal(calls.filter(call => call.method === 'closeShift').length, 0);

    const secondStages = [];
    const result = await runShiftJob(provider, {
        job: { ...baseJob, external_stage: 'shift_close_lookup_still_open' },
        async recordStage(stage) { secondStages.push(stage); }
    });
    assert.equal(result.source, 'shift_close_exact_retry');
    assert.equal(result.response.id, PROVIDER_SHIFT_ID);
    assert.equal(result.response.status, 'CLOSED');
    assert.deepEqual(secondStages, [
        'readiness',
        'shift_close_retry_exact_shift',
        'shift_close_request_maybe_submitted'
    ]);
    assert.equal(calls.filter(call => call.method === 'closeShift').length, 1);
    assert.equal(calls.find(call => call.method === 'closeShift').input.fiscalOperation.provider_shift_id, PROVIDER_SHIFT_ID);
});

test('shift-close exact lookup 404 remains recoverable and never repeats close', async () => {
    const calls = [];
    const stages = [];
    const provider = {
        async lookupShift() {
            calls.push('lookupShift');
            throw new CheckboxClientError('checkbox_validation_error', 'Checkbox HTTP 404', {
                status: 404,
                retryable: false
            });
        },
        async closeShift() {
            calls.push('closeShift');
        }
    };
    await assert.rejects(
        () => runShiftJob(provider, {
            job: {
                job_type: 'shift_close',
                external_stage: 'shift_close_lookup',
                provider_operation_id: crypto.randomUUID(),
                provider_shift_id: PROVIDER_SHIFT_ID,
                payload: { provider_shift_id: PROVIDER_SHIFT_ID }
            },
            async recordStage(stage) { stages.push(stage); }
        }),
        error => error?.code === 'checkbox_shift_close_lookup_not_found'
            && error.retryable === true
            && error.unknown === true
    );
    assert.deepEqual(stages, ['shift_close_lookup', 'shift_close_lookup']);
    assert.deepEqual(calls, ['lookupShift']);
});

test('shift-close recovery fails closed when exact immutable shift lookup is unavailable', async () => {
    await assert.rejects(
        () => runShiftJob({ closeShift() {} }, {
            job: {
                job_type: 'shift_close',
                external_stage: 'shift_close_lookup',
                provider_operation_id: crypto.randomUUID(),
                provider_shift_id: PROVIDER_SHIFT_ID,
                payload: { provider_shift_id: PROVIDER_SHIFT_ID }
            }
        }),
        error => error instanceof Error && error.code === 'checkbox_shift_lookup_unavailable' && error.unknown === true
    );
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
        if (call.path === `/api/v1/shifts/${PROVIDER_SHIFT_ID}`) return { body: openedShift() };
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
    const testOverrideConfig = loadCheckboxRuntimeConfig({
        credentialRef: 'park-middle',
        licenseRef: 'park-middle',
        env: {
            ...env,
            CHECKBOX_EXPECT_IS_TEST: 'true',
            CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS: 'true'
        }
    });
    assert.equal(testOverrideConfig.allowUnreportedPaymentPermissions, true);
    assert.equal(createProviderFromConfig(testOverrideConfig).allowUnreportedPaymentPermissions, true);
});

test('runtime config supports explicit password and PIN auth and rejects ambiguity', () => {
    const pinCode = crypto.randomUUID();
    const common = {
        CHECKBOX_EXPECT_IS_TEST: 'true',
        CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://api.checkbox.in.ua',
        CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret'
    };
    const passwordConfig = loadCheckboxRuntimeConfig({
        credentialRef: 'park-middle',
        licenseRef: 'park-middle',
        env: {
            ...common,
            CHECKBOX_PARK_MIDDLE_AUTH_MODE: 'password',
            CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
            CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret'
        }
    });
    assert.equal(passwordConfig.authMode, 'password');
    assert.equal(passwordConfig.pinCode, '');

    const pinConfig = loadCheckboxRuntimeConfig({
        credentialRef: 'park-middle',
        licenseRef: 'park-middle',
        env: {
            ...common,
            CHECKBOX_PARK_MIDDLE_AUTH_MODE: 'pin',
            CHECKBOX_PARK_MIDDLE_PIN_CODE: pinCode
        }
    });
    assert.equal(pinConfig.authMode, 'pin');
    assert.equal(pinConfig.login, '');
    assert.equal(pinConfig.password, '');

    assert.throws(
        () => loadCheckboxRuntimeConfig({
            credentialRef: 'park-middle',
            licenseRef: 'park-middle',
            env: {
                ...common,
                CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
                CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
                CHECKBOX_PARK_MIDDLE_PIN_CODE: pinCode
            }
        }),
        error => error instanceof CheckboxClientError && error.code === 'checkbox_runtime_auth_mode_ambiguous'
    );
});

test('runtime provider uses the selected PIN signin endpoint', async () => {
    const pinCode = crypto.randomUUID();
    const mock = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signinPinCode') return { body: { access_token: 'pin-token' } };
        return { body: {} };
    });
    try {
        const provider = createProviderFromConfig({
            ...providerConfig(mock.baseUrl),
            authMode: 'pin',
            login: '',
            password: '',
            pinCode
        });
        await provider.authenticate();
        assert.equal(mock.calls.length, 1);
        assert.equal(mock.calls[0].path, '/api/v1/cashier/signinPinCode');
        assert.deepEqual(mock.calls[0].body, { pin_code: pinCode });
        assert.equal(mock.calls[0].headers['x-license-key'], 'license-secret');
    } finally {
        await close(mock.server);
    }
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
                CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://api.checkbox.in.ua:8443',
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

    assert.throws(
        () => loadCheckboxRuntimeConfig({
            credentialRef: 'park-middle',
            licenseRef: 'park-middle',
            env: {
                CHECKBOX_EXPECT_IS_TEST: 'false',
                CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://dev.checkbox.ua',
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
        allowLocalMockHost: true,
        env: {
            CHECKBOX_EXPECT_IS_TEST: 'false',
            CHECKBOX_PARK_MIDDLE_BASE_URL: 'http://127.0.0.1:18080',
            CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
            CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
            CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret'
        }
    });
    assert.equal(config.baseUrl, 'http://127.0.0.1:18080');
});
