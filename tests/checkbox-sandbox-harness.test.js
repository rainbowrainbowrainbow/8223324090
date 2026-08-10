const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { CheckboxClient } = require('../services/checkbox/client');
const { assertSandboxBaseUrl, loadCheckboxSandboxConfig, publicConfigSummary } = require('../services/checkbox/config');
const { CheckboxClientError, redactCheckboxDiagnostics } = require('../services/checkbox/errors');
const { mapFullReturnReceipt, mapSaleReceipt, mapServiceReceipt } = require('../services/checkbox/mapper');
const { WebhookReplayGuard, signCheckboxWebhookBody, verifyCheckboxWebhookSignature } = require('../services/checkbox/signature');
const { assertOpenApiOperationContract, schemaContainsProperty } = require('../scripts/checkbox-sandbox-smoke');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('sandbox config allows official Checkbox HTTPS hosts and redacts secrets', () => {
  assert.equal(assertSandboxBaseUrl('https://api.checkbox.in.ua'), 'https://api.checkbox.in.ua');
  assert.equal(assertSandboxBaseUrl('https://api.checkbox.ua'), 'https://api.checkbox.ua');
  assert.throws(() => assertSandboxBaseUrl('http://api.checkbox.in.ua'), /must use HTTPS/);
  assert.throws(() => assertSandboxBaseUrl('https://evil.example'), /exact official Checkbox HTTPS API host/);
  assert.throws(() => assertSandboxBaseUrl('https://sandbox.checkbox.example'), /exact official Checkbox HTTPS API host/);
  assert.throws(() => assertSandboxBaseUrl('https://dev.checkbox.ua'), /exact official Checkbox HTTPS API host/);
  const config = loadCheckboxSandboxConfig({
    CHECKBOX_SANDBOX_BASE_URL: 'https://api.checkbox.in.ua',
    CHECKBOX_SANDBOX_LOGIN: 'cashier',
    CHECKBOX_SANDBOX_PASSWORD: 'secret-password',
    CHECKBOX_SANDBOX_LICENSE_KEY: 'license-secret',
    CHECKBOX_SANDBOX_ACCESS_KEY: 'access-secret',
    CHECKBOX_SANDBOX_EXPECT_ORGANIZATION_ID: 'org-test',
    CHECKBOX_SANDBOX_EXPECT_REGISTER_ID: 'register-test',
    CHECKBOX_SANDBOX_EXPECT_CASHIER_ID: 'cashier-test'
  });
  const summary = JSON.stringify(publicConfigSummary(config));
  assert.doesNotMatch(summary, /secret-password|license-secret|access-secret/);
  assert.equal(config.expectedIsTest, true);
  assert.equal(config.includeProOperations, false);
});

test('sandbox config supports a mutation-free PIN readiness mode', () => {
  const pinCode = crypto.randomUUID();
  const config = loadCheckboxSandboxConfig({
    CHECKBOX_SANDBOX_BASE_URL: 'https://api.checkbox.in.ua',
    CHECKBOX_SANDBOX_AUTH_MODE: 'pin',
    CHECKBOX_SANDBOX_PIN_CODE: pinCode,
    CHECKBOX_SANDBOX_LICENSE_KEY: 'license-secret',
    CHECKBOX_SANDBOX_READINESS_ONLY: 'true',
    CHECKBOX_SANDBOX_EXPECT_ORGANIZATION_ID: 'org-test',
    CHECKBOX_SANDBOX_EXPECT_REGISTER_ID: 'register-test',
    CHECKBOX_SANDBOX_EXPECT_CASHIER_ID: 'cashier-test'
  });
  assert.equal(config.authMode, 'pin');
  assert.equal(config.readinessOnly, true);
  assert.equal(config.confirmMutations, false);
  assert.equal(config.login, '');
  assert.equal(config.password, '');
});

test('OpenAPI compatibility resolves referenced and composed receipt payload schemas', () => {
  const contract = {
    security: [{ bearerAuth: [] }],
    components: {
      schemas: {
        ReceiptSellPayload: {
          allOf: [
            { $ref: '#/components/schemas/ReceiptGoods' },
            { type: 'object', properties: { payments: { type: 'array' } } }
          ]
        },
        ReceiptGoods: { type: 'object', properties: { goods: { type: 'array' } } }
      }
    }
  };
  const operation = {
    requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ReceiptSellPayload' } } } },
    responses: { 200: { description: 'ok' } }
  };
  assert.equal(schemaContainsProperty(contract, operation.requestBody.content['application/json'].schema, 'goods'), true);
  assert.equal(schemaContainsProperty(contract, operation.requestBody.content['application/json'].schema, 'payments'), true);
  assert.doesNotThrow(() => assertOpenApiOperationContract(contract, '/api/v1/receipts/validate', 'post', operation));
});

test('mapper produces official Checkbox receipt/service payload shapes without floating point money', () => {
  const sale = mapSaleReceipt({
    providerRequestUuid: crypto.randomUUID(),
    tender: 'card_terminal_manual',
    amountMinor: '12345',
    items: [{ code: 'park-ticket', name: 'Park ticket', priceMinor: '12345', quantityMillis: 1000, taxCode: '7' }]
  });
  assert.equal(sale.goods[0].good.price, 12345);
  assert.deepEqual(sale.goods[0].good.tax, ['7']);
  assert.equal(sale.payments[0].type, 'CASHLESS');
  assert.equal(sale.payments[0].value, 12345);

  const returned = mapFullReturnReceipt({ providerRequestUuid: crypto.randomUUID(), originalReceiptId: sale.id, originalSalePayload: sale });
  assert.equal(returned.related_receipt_id, sale.id);
  assert.equal(returned.goods[0].is_return, true);

  const serviceIn = mapServiceReceipt({ providerRequestUuid: crypto.randomUUID(), operationType: 'service_in', amountMinor: '1000' });
  const serviceOut = mapServiceReceipt({ providerRequestUuid: crypto.randomUUID(), operationType: 'service_out', amountMinor: '1000' });
  assert.equal(serviceIn.payment.operation_type, 'REINFORCEMENT');
  assert.equal(serviceOut.payment.operation_type, 'COLLECTION');
});

test('client maps exact official endpoints, headers and timeout/lookup recovery avoids duplicate sale', async () => {
  const calls = [];
  const receiptId = crypto.randomUUID();
  const fetchImpl = async (url, request = {}) => {
    calls.push({ url: String(url), method: request.method || 'GET', headers: request.headers || {}, body: request.body ? JSON.parse(request.body) : null });
    if (String(url).endsWith('/api/v1/cashier/signin')) return jsonResponse({ access_token: 'sandbox-token', token_type: 'bearer' });
    if (String(url).endsWith('/api/v1/receipts/sell')) {
      if (calls.filter(call => call.url.endsWith('/api/v1/receipts/sell')).length === 1) {
        const error = new Error('provider timeout');
        error.name = 'AbortError';
        throw error;
      }
      return jsonResponse({ id: receiptId, status: 'DONE' }, 201);
    }
    if (String(url).endsWith(`/api/v1/receipts/${receiptId}`)) return jsonResponse({ id: receiptId, status: 'DONE' });
    return jsonResponse({ ok: true });
  };
  const client = new CheckboxClient({ baseUrl: 'https://sandbox.checkbox.example', licenseKey: 'license', deviceId: 'device', fetchImpl, timeoutMs: 1000 });
  await client.signIn({ login: 'cashier', password: 'password' });
  assert.equal(calls[0].url, 'https://sandbox.checkbox.example/api/v1/cashier/signin');
  assert.equal(calls[0].headers['X-Device-ID'], 'device');
  assert.equal(calls[0].headers.Authorization, undefined);

  const payload = mapSaleReceipt({ providerRequestUuid: receiptId, amountMinor: '1000', items: [{ code: 'x', name: 'Sandbox item', priceMinor: '1000', quantityMillis: 1000 }] });
  await assert.rejects(() => client.createSaleReceipt(payload), error => error instanceof CheckboxClientError && error.unknown === true);
  const lookup = await client.lookupReceipt({ receiptId });
  assert.equal(lookup.status, 'DONE');
  assert.equal(calls.filter(call => call.url.endsWith('/api/v1/receipts/sell')).length, 1);
  assert.match(calls.find(call => call.url.endsWith('/api/v1/receipts/sell')).headers.Authorization, /^Bearer /);
});

test('client maps official license-bound PIN signin without login or password fields', async () => {
  const calls = [];
  const pinCode = crypto.randomUUID();
  const fetchImpl = async (url, request = {}) => {
    calls.push({
      url: String(url),
      method: request.method,
      headers: request.headers || {},
      body: request.body ? JSON.parse(request.body) : null
    });
    return jsonResponse({ access_token: 'pin-token', token_type: 'bearer' });
  };
  const client = new CheckboxClient({
    baseUrl: 'https://api.checkbox.in.ua',
    licenseKey: 'license-secret',
    deviceId: 'eventgenix-pin-device',
    fetchImpl
  });
  await client.signInWithPinCode({ pinCode });
  assert.equal(calls[0].url, 'https://api.checkbox.in.ua/api/v1/cashier/signinPinCode');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { pin_code: pinCode });
  assert.equal(calls[0].headers['X-License-Key'], 'license-secret');
  assert.equal(calls[0].headers['X-Device-ID'], 'eventgenix-pin-device');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(Object.hasOwn(calls[0].body, 'login'), false);
  assert.equal(Object.hasOwn(calls[0].body, 'password'), false);
});

test('webhook signature and replay helper accepts first event, flags replay and rejects conflict', () => {
  const secret = 'sandbox-webhook-secret';
  const rawBody = Buffer.from(JSON.stringify({ id: crypto.randomUUID(), status: 'DONE' }));
  const signature = signCheckboxWebhookBody(rawBody, secret);
  assert.equal(verifyCheckboxWebhookSignature({ rawBody, signatureHeader: signature, signingSecret: secret }), true);
  const guard = new WebhookReplayGuard();
  const eventId = crypto.randomUUID();
  const hash = crypto.createHash('sha256').update(rawBody).digest('hex');
  assert.deepEqual(guard.remember(eventId, hash), { accepted: true, replay: false, conflict: false });
  assert.deepEqual(guard.remember(eventId, hash), { accepted: true, replay: true, conflict: false });
  assert.deepEqual(guard.remember(eventId, crypto.randomUUID().replace(/-/g, '')), { accepted: false, replay: true, conflict: true });
});

test('diagnostic redaction removes token, PIN, password and authorization material', () => {
  const generatedPin = [1, 2, 3, 4].join('');
  const output = JSON.stringify(redactCheckboxDiagnostics({
    authorization: 'Bearer abc.def.ghi',
    password: 'cashier-password',
    pin: generatedPin,
    nested: { access_key: 'access-key' },
    text: 'token=abc123 and password: qwerty'
  }));
  assert.doesNotMatch(output, new RegExp(`abc\\.def|cashier-password|${generatedPin}|access-key|abc123|qwerty`));
});

test('sandbox smoke harness stays Phase 1 test-mode guarded by official contract checks', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'checkbox-sandbox-smoke.js'), 'utf8');
  assert.match(script, /assertOpenApiOperationContract/);
  assert.match(script, /x-request-signature/);
  assert.match(script, /assertExpectedSandboxIdentityConfig/);
  assert.match(script, /createProviderFromConfig/);
  assert.match(script, /collectReadinessDiagnostics/);
  assert.match(script, /cashier-readiness-checklist/);
  assert.match(script, /provider\.verifyReadiness/);
  assert.match(script, /expectedIsTest: true/);
  assert.match(script, /waitShiftOpened/);
  assert.match(script, /waitReceiptDone/);
  assert.match(script, /phase2-operations-skipped/);
  assert.match(script, /checkbox:sandbox:readiness/);
  assert.match(script, /mutations: false/);
  assert.doesNotMatch(script, /sha256=\\$\\{signCheckboxWebhookBody/);
});
