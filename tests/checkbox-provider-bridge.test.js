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
        timeoutMs: 1000
    };
}

function saleInput(receiptId = crypto.randomUUID()) {
    return {
        providerOperationId: receiptId,
        fiscalOperation: { id: 501, fiscal_operation_id: 501, fiscal_profile_id: 7 },
        paymentOrder: { id: 301, payment_order_id: 301, fiscal_profile_id: 7, total_amount_minor: '12345', payment_method: 'card_terminal_manual' },
        items: [{
            line_number: 1,
            item_name: 'Park admission',
            item_code: 'park-admission',
            unit_price_minor: '12345',
            quantity_milli: 1000,
            provider_tax_id: '7'
        }]
    };
}

test('runtime provider maps worker DTO to official auth, shift, validate, sell and lookup calls', async () => {
    const receiptId = crypto.randomUUID();
    const { server, calls, baseUrl } = await listenMock(call => {
        if (call.path === '/api/v1/cashier/signin') return { body: { access_token: 'token-1', token_type: 'bearer' } };
        if (call.path === '/api/v1/cashier/shift') return { body: { id: crypto.randomUUID(), status: 'OPENED', serial: 1, taxes: [], cash_register: {}, cashier: {} } };
        if (call.path === '/api/v1/receipts/validate') return { body: { valid: true } };
        if (call.path === '/api/v1/receipts/sell') return { status: 201, body: { id: receiptId, status: 'DONE', fiscal_code: 'FC-1', total_payment: 12345, serial: 2 } };
        if (call.path === `/api/v1/receipts/${receiptId}`) return { body: { id: receiptId, status: 'DONE', fiscal_code: 'FC-1', total_payment: 12345, serial: 2 } };
        return { status: 404, body: { error: 'not found' } };
    });
    try {
        const provider = createProviderFromConfig(providerConfig(baseUrl));
        await provider.validateSale(saleInput(receiptId));
        const receipt = await provider.createSaleReceipt(saleInput(receiptId));
        const lookup = await provider.lookupReceipt({ providerOperationId: receiptId });

        assert.equal(receipt.providerReceiptId, receiptId);
        assert.equal(receipt.status, 'DONE');
        assert.equal(lookup.receipt.providerReceiptId, receiptId);
        assert.equal(calls[0].path, '/api/v1/cashier/signin');
        assert.equal(calls[0].headers.authorization, undefined);

        const validate = calls.find(call => call.path === '/api/v1/receipts/validate');
        const sell = calls.find(call => call.path === '/api/v1/receipts/sell');
        assert.equal(validate.headers.authorization, 'Bearer token-1');
        assert.equal(validate.headers['x-device-id'], 'eventgenix-test-device');
        assert.equal(sell.headers['x-access-key'], 'access-secret');
        assert.equal(sell.body.id, receiptId);
        assert.equal(sell.body.goods[0].good.name, 'Park admission');
        assert.deepEqual(sell.body.goods[0].good.tax, ['7']);
        assert.equal(sell.body.goods[0].quantity, 1000);
        assert.equal(sell.body.payments[0].type, 'CASHLESS');
        assert.equal(sell.body.payments[0].value, 12345);
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
        if (call.path === '/api/v1/cashier/shift') return { body: { id: crypto.randomUUID(), status: 'OPENED', serial: 1, taxes: [], cash_register: {}, cashier: {} } };
        if (call.path === '/api/v1/receipts/sell') {
            const sellCount = allCalls.filter(item => item.path === '/api/v1/receipts/sell').length;
            if (sellCount === 1) return { status: 401, body: { detail: 'expired token access-secret cashier-password' } };
            return { status: 201, body: { id: receiptId, status: 'DONE', total_payment: 1000, serial: 3 } };
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
            CHECKBOX_PARK_MIDDLE_BASE_URL: 'https://checkbox.example',
            CHECKBOX_PARK_MIDDLE_LOGIN: 'cashier',
            CHECKBOX_PARK_MIDDLE_PASSWORD: 'password-secret',
            CHECKBOX_PARK_MIDDLE_LICENSE_KEY: 'license-secret',
            CHECKBOX_PARK_MIDDLE_ACCESS_KEY: 'access-secret'
        }
    });
    assert.equal(factory.canResolveRefs({ credentialRef: 'park-middle', licenseRef: 'park-middle' }), true);
    assert.equal(factory.canResolveRefs({ credentialRef: 'missing', licenseRef: 'missing' }), false);
});
