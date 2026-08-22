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
const {
  assertOpenApiOperationContract,
  assertNoPreexistingSandboxShift,
  assertSandboxProofMutationGuard,
  closeOwnedSandboxShift,
  publicSandboxEvidence,
  publicReadinessDiagnostics,
  runSandboxSaleProof,
  schemaContainsProperty,
  verifySandboxReceiptProof
} = require('../scripts/checkbox-sandbox-smoke');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function proofConfig(overrides = {}) {
  return {
    confirmMutations: true,
    closeShift: true,
    allowUnreportedPaymentPermissions: true,
    expectedOrganizationId: 'org-test',
    expectedRegisterId: 'register-test',
    expectedCashierId: 'cashier-test',
    expectedIsTest: true,
    expectedIsTestExplicit: true,
    ...overrides
  };
}

function proofDiagnostics({ cash = null, card = null, raw = null } = {}) {
  const ready = code => ({ code, status: 'ready', ready: true, details: {} });
  return {
    ready: cash === true && card === true,
    status: cash === true && card === true ? 'ready' : 'blocked',
    authMode: 'password',
    checks: [
      ready('auth'),
      ready('cashier_identity'),
      ready('organization_identity'),
      ready('register_identity'),
      ready('register_online'),
      ready('is_test'),
      ready('signature'),
      ready('certificate'),
      { ...ready('sales_permission'), details: { permission: 'sales', value: true } },
      { code: 'cash_permission', status: cash === true ? 'ready' : 'blocked', ready: cash === true, details: { permission: 'cash_payment', value: cash } },
      { code: 'card_permission', status: card === true ? 'ready' : 'blocked', ready: card === true, details: { permission: 'card_payment', value: card } },
      ready('provider_taxes'),
      { code: 'current_shift', status: 'not_applicable', ready: true, details: { shiftStatus: 'none' } }
    ],
    summary: { readyCount: 10, blockedCount: 2, unavailableCount: 0, notApplicableCount: 1 },
    raw
  };
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
    CHECKBOX_SANDBOX_DEVICE_ID: 'eventgenix-test-device',
    CHECKBOX_SANDBOX_EXPECT_ORGANIZATION_ID: 'org-test',
    CHECKBOX_SANDBOX_EXPECT_REGISTER_ID: 'register-test',
    CHECKBOX_SANDBOX_EXPECT_CASHIER_ID: 'cashier-test'
  });
  const summary = JSON.stringify(publicConfigSummary(config));
  assert.doesNotMatch(summary, /secret-password|license-secret|access-secret/);
  assert.equal(config.expectedIsTest, true);
  assert.equal(config.expectedIsTestExplicit, false);
  assert.equal(config.includeProOperations, false);
  assert.deepEqual(config.tenders, ['cash', 'card_terminal_manual']);
  assert.equal(config.allowUnreportedPaymentPermissions, false);
  assert.doesNotMatch(summary, /org-test|register-test|cashier-test/);
});

test('sandbox config supports a mutation-free PIN readiness mode', () => {
  const pinCode = crypto.randomUUID();
  const config = loadCheckboxSandboxConfig({
    CHECKBOX_SANDBOX_BASE_URL: 'https://api.checkbox.in.ua',
    CHECKBOX_SANDBOX_AUTH_MODE: 'pin',
    CHECKBOX_SANDBOX_PIN_CODE: pinCode,
    CHECKBOX_SANDBOX_LICENSE_KEY: 'license-secret',
    CHECKBOX_SANDBOX_DEVICE_ID: 'eventgenix-test-device',
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

test('sandbox config requires an explicit stable device identity across process restarts', () => {
  const shared = {
    CHECKBOX_SANDBOX_BASE_URL: 'https://api.checkbox.in.ua',
    CHECKBOX_SANDBOX_LOGIN: 'cashier',
    CHECKBOX_SANDBOX_PASSWORD: 'secret-password',
    CHECKBOX_SANDBOX_LICENSE_KEY: 'license-secret',
    CHECKBOX_SANDBOX_DEVICE_ID: 'eventgenix-explicit-test-device',
    CHECKBOX_SANDBOX_EXPECT_ORGANIZATION_ID: 'org-test',
    CHECKBOX_SANDBOX_EXPECT_REGISTER_ID: 'register-test',
    CHECKBOX_SANDBOX_EXPECT_CASHIER_ID: 'cashier-test'
  };
  const first = loadCheckboxSandboxConfig(shared);
  const second = loadCheckboxSandboxConfig(shared);
  assert.equal(first.deviceId, second.deviceId);
  assert.equal(first.deviceId, 'eventgenix-explicit-test-device');
  const { CHECKBOX_SANDBOX_DEVICE_ID, ...withoutDevice } = shared;
  assert.throws(
    () => loadCheckboxSandboxConfig(withoutDevice),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_env_missing'
  );
});

test('sandbox config supports a card-only recovery proof and rejects unknown tenders', () => {
  const shared = {
    CHECKBOX_SANDBOX_BASE_URL: 'https://api.checkbox.in.ua',
    CHECKBOX_SANDBOX_LOGIN: 'cashier',
    CHECKBOX_SANDBOX_PASSWORD: 'secret-password',
    CHECKBOX_SANDBOX_LICENSE_KEY: 'license-secret',
    CHECKBOX_SANDBOX_DEVICE_ID: 'eventgenix-test-device',
    CHECKBOX_SANDBOX_EXPECT_REGISTER_ID: 'register-test'
  };
  const cardOnly = loadCheckboxSandboxConfig({
    ...shared,
    CHECKBOX_SANDBOX_TENDERS: 'card'
  });
  assert.deepEqual(cardOnly.tenders, ['card_terminal_manual']);
  assert.throws(
    () => loadCheckboxSandboxConfig({ ...shared, CHECKBOX_SANDBOX_TENDERS: 'crypto' }),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_tenders_invalid'
  );
});

test('card-only proof does not require an unrelated cash permission', () => {
  const diagnostics = proofDiagnostics({ cash: false, card: true });
  const result = assertSandboxProofMutationGuard(
    proofConfig({ tenders: ['card_terminal_manual'] }),
    diagnostics
  );
  assert.equal(result.allowed, true);
  assert.deepEqual(result.unreportedPaymentPermissions, []);
});

test('sandbox proof permits only unreported test payment permissions behind every explicit guard', () => {
  const config = proofConfig();
  const result = assertSandboxProofMutationGuard(config, proofDiagnostics());
  assert.equal(result.allowed, true);
  assert.deepEqual(result.unreportedPaymentPermissions.sort(), ['card_payment', 'cash_payment']);

  assert.throws(
    () => assertSandboxProofMutationGuard({ ...config, confirmMutations: false }, proofDiagnostics()),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_mutation_confirmation_required'
  );
  assert.throws(
    () => assertSandboxProofMutationGuard({ ...config, expectedIsTestExplicit: false }, proofDiagnostics()),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_test_identity_must_be_explicit'
  );
  assert.throws(
    () => assertSandboxProofMutationGuard({ ...config, expectedRegisterId: null }, proofDiagnostics()),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_expected_identity_missing'
  );
  assert.throws(
    () => assertSandboxProofMutationGuard({ ...config, allowUnreportedPaymentPermissions: false }, proofDiagnostics()),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_proof_readiness_blocked'
  );
});

test('sandbox mutation proof requires owned shift cleanup to be enabled', () => {
  assert.throws(
    () => assertSandboxProofMutationGuard(
      proofConfig({ closeShift: false }),
      proofDiagnostics({ cash: true, card: true })
    ),
    error => error instanceof CheckboxClientError
      && error.code === 'checkbox_sandbox_shift_cleanup_required'
  );
});

test('sandbox proof never bypasses an explicit false payment permission', () => {
  for (const diagnostics of [proofDiagnostics({ cash: false }), proofDiagnostics({ card: false })]) {
    assert.throws(
      () => assertSandboxProofMutationGuard(proofConfig(), diagnostics),
      error => error instanceof CheckboxClientError
        && error.code === 'checkbox_sandbox_payment_permission_denied'
        && error.details?.explicitlyDenied === true
    );
  }
});

test('sandbox proof never bypasses malformed payment permissions', () => {
  const diagnostics = proofDiagnostics();
  const cash = diagnostics.checks.find(check => check.code === 'cash_permission');
  cash.details.state = 'malformed';
  cash.details.value = null;
  assert.throws(
    () => assertSandboxProofMutationGuard(proofConfig(), diagnostics),
    error => error instanceof CheckboxClientError
      && error.code === 'checkbox_sandbox_payment_permission_malformed'
      && error.details?.malformed === true
  );
});

test('sandbox proof reports provider-unavailable readiness without misclassifying permissions', () => {
  const diagnostics = proofDiagnostics({ card: null });
  const auth = diagnostics.checks.find(check => check.code === 'auth');
  auth.status = 'blocked';
  auth.ready = false;
  const card = diagnostics.checks.find(check => check.code === 'card_permission');
  card.status = 'unavailable';
  card.ready = false;
  card.details.state = 'malformed';

  assert.throws(
    () => assertSandboxProofMutationGuard(
      proofConfig({ tenders: ['card_terminal_manual'] }),
      diagnostics
    ),
    error => error instanceof CheckboxClientError
      && error.code === 'checkbox_sandbox_proof_readiness_blocked'
      && error.details?.blocked?.includes('auth')
      && error.details?.blocked?.includes('card_permission')
  );
});

test('public sandbox readiness output omits raw provider payload and provider identities', () => {
  const diagnostics = proofDiagnostics({
    raw: {
      cashier: { id: 'cashier-private', organization_id: 'org-private', login: 'cashier-login' },
      register: { id: 'register-private' },
      provider: { access_token: 'provider-secret-token' }
    }
  });
  diagnostics.checks.find(check => check.code === 'cashier_identity').details = {
    cashierId: 'cashier-private',
    organizationId: 'org-private'
  };
  const output = JSON.stringify(publicReadinessDiagnostics(diagnostics));
  assert.doesNotMatch(output, /cashier-private|org-private|register-private|cashier-login|provider-secret-token|\"raw\"/);
  assert.match(output, /cash_permission/);
  assert.match(output, /\"reported\":false/);
});

test('public sandbox evidence removes provider and receipt identities even from mismatch diagnostics', () => {
  const output = JSON.stringify(publicSandboxEvidence({
    shiftId: 'shift-private',
    receipt_id: 'receipt-private',
    providerCashierId: 'cashier-private',
    field: 'cash_register.id',
    expected: 'register-private',
    actual: 'wrong-register-private',
    providerStatus: 'DONE',
    count: 2
  }));
  assert.doesNotMatch(output, /shift-private|receipt-private|cashier-private|register-private/);
  assert.match(output, /\"providerStatus\":\"DONE\"/);
  assert.match(output, /\"count\":2/);
});

test('sandbox sale proof creates exact CASH and CASHLESS receipts and verifies official receipt identity', async () => {
  const validated = [];
  const created = [];
  const lookedUp = [];
  const documents = [];
  const payloads = new Map();
  const openedShift = {
    id: 'shift-test',
    status: 'OPENED',
    cash_register: { id: 'register-test' },
    cashier: { id: 'cashier-test' }
  };
  const client = {
    baseUrl: 'https://api.checkbox.in.ua',
    async validateSale(payload) {
      validated.push(payload);
      return { ok: true };
    },
    async createSaleReceipt(payload) {
      created.push(payload);
      payloads.set(payload.id, payload);
      return { id: payload.id, status: 'CREATED' };
    },
    async lookupReceipt({ receiptId }) {
      lookedUp.push(receiptId);
      const payload = payloads.get(receiptId);
      const tender = payload.payments[0];
      return {
        id: receiptId,
        status: 'DONE',
        type: 'SELL',
        total_sum: 1000,
        total_payment: 1000,
        total_rest: 0,
        cash_register_id: 'register-test',
        cashier_id: 'cashier-test',
        shift_id: 'shift-test',
        payments: [{ type: tender.type, value: tender.value, label: tender.label }],
        context: payload.context
      };
    },
    async getReceiptDocument({ receiptId, format }) {
      documents.push({ receiptId, format });
      return Buffer.from('sandbox-pdf');
    }
  };
  const config = proofConfig({ amountMinor: '1000', taxCode: null });
  const proofOptions = {
    openedShift,
    identityProof: { organizationVerified: true }
  };
  const cash = await runSandboxSaleProof(client, config, '20260822010101', 'cash', proofOptions);
  const cashless = await runSandboxSaleProof(client, config, '20260822010101', 'card_terminal_manual', proofOptions);
  assert.equal(cash.payload.payments[0].type, 'CASH');
  assert.equal(cashless.payload.payments[0].type, 'CASHLESS');
  assert.equal(cash.verified.verified, true);
  assert.equal(cashless.verified.verified, true);
  assert.notEqual(cash.receiptId, cashless.receiptId);
  assert.equal(validated.length, 2);
  assert.equal(created.length, 2);
  assert.deepEqual(lookedUp, [cash.receiptId, cashless.receiptId]);
  assert.deepEqual(documents.map(item => item.format), ['pdf', 'pdf']);
});

test('sandbox receipt proof fails closed on UUID, amount, type, tender, register, cashier, shift, context or organization proof mismatch', () => {
  const config = proofConfig({ amountMinor: '1000', taxCode: null });
  const openedShift = {
    id: 'shift-test',
    status: 'OPENED',
    cash_register: { id: 'register-test' },
    cashier: { id: 'cashier-test' }
  };
  const payload = mapSaleReceipt({
    providerRequestUuid: 'receipt-test',
    tender: 'cash',
    amountMinor: '1000',
    items: [{ code: 'park', name: 'Park', priceMinor: '1000', quantityMillis: 1000 }],
    context: {
      fiscal_profile_id: 'sandbox-profile',
      fiscal_operation_id: 'sandbox-operation',
      payment_order_id: 'sandbox-payment'
    }
  });
  const baseReceipt = {
    id: payload.id,
    status: 'DONE',
    type: 'SELL',
    total_sum: 1000,
    total_payment: 1000,
    total_rest: 0,
    cash_register_id: 'register-test',
    cashier_id: 'cashier-test',
    shift_id: 'shift-test',
    payments: [{ type: 'CASH', value: 1000, label: 'Готівка' }],
    context: payload.context
  };
  const client = { baseUrl: 'https://api.checkbox.in.ua' };
  const verify = (receipt, identityProof = { organizationVerified: true }) => verifySandboxReceiptProof({
    client,
    config,
    openedShift,
    payload,
    receipt,
    tender: 'cash',
    identityProof
  });

  assert.equal(verify(baseReceipt).verified, true);
  for (const [field, value] of [
    ['id', 'wrong-receipt'],
    ['status', 'CREATED'],
    ['type', 'RETURN'],
    ['total_sum', 999],
    ['cash_register_id', 'wrong-register'],
    ['cashier_id', 'wrong-cashier'],
    ['shift_id', 'wrong-shift'],
    ['payments', [{ type: 'CASHLESS', value: 1000 }]],
    ['payments', [{ type: 'CASH', value: 1000 }, { type: 'CASHLESS', value: 1000 }]],
    ['context', { ...payload.context, fiscal_operation_id: 'wrong-operation' }]
  ]) {
    assert.throws(() => verify({ ...baseReceipt, [field]: value }), CheckboxClientError, field);
  }
  assert.throws(() => verify(baseReceipt, { organizationVerified: false }), error => (
    error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_organization_proof_missing'
  ));
});

test('sandbox shift cleanup never closes a pre-existing shift and closes only the exact smoke-owned shift', async () => {
  const config = proofConfig({ closeShift: true });
  const shift = {
    id: 'shift-owned',
    status: 'OPENED',
    cash_register: { id: 'register-test' },
    cashier: { id: 'cashier-test' }
  };
  let closeCalls = 0;
  let lookupCalls = 0;
  const client = {
    async getShiftById({ shiftId }) {
      lookupCalls += 1;
      assert.equal(shiftId, 'shift-owned');
      return shift;
    },
    async getCurrentShift() { return shift; },
    async closeShift() {
      closeCalls += 1;
      return { ...shift, status: 'CLOSED' };
    }
  };

  const preexisting = await closeOwnedSandboxShift({ client, config, shift, openedBySmoke: false });
  assert.deepEqual(preexisting, { attempted: false, closed: false, reason: 'preexisting_shift' });
  assert.equal(closeCalls, 0);
  assert.equal(lookupCalls, 0);

  const owned = await closeOwnedSandboxShift({ client, config, shift, openedBySmoke: true });
  assert.equal(owned.attempted, true);
  assert.equal(owned.closed, true);
  assert.equal(closeCalls, 1);
  assert.equal(lookupCalls, 1);
});

test('sandbox shift cleanup accepts official short current-shift without cashier after detailed ownership proof', async () => {
  const config = proofConfig({ closeShift: true });
  const detailedShift = {
    id: 'shift-owned',
    status: 'OPENED',
    cash_register: { id: 'register-test' },
    cashier: { id: 'cashier-test' }
  };
  const shortCurrentShift = {
    id: 'shift-owned',
    status: 'OPENED',
    cash_register: { id: 'register-test' }
  };
  let closeCalls = 0;
  const client = {
    async getShiftById() { return detailedShift; },
    async getCurrentShift() { return shortCurrentShift; },
    async closeShift() {
      closeCalls += 1;
      return { ...detailedShift, status: 'CLOSED' };
    }
  };

  const result = await closeOwnedSandboxShift({ client, config, shift: detailedShift, openedBySmoke: true });
  assert.equal(result.closed, true);
  assert.equal(closeCalls, 1);
});

test('sandbox shift cleanup rejects a cashier mismatch when short current-shift includes cashier', async () => {
  const config = proofConfig({ closeShift: true });
  const detailedShift = {
    id: 'shift-owned',
    status: 'OPENED',
    cash_register: { id: 'register-test' },
    cashier: { id: 'cashier-test' }
  };
  let closeCalls = 0;
  const client = {
    async getShiftById() { return detailedShift; },
    async getCurrentShift() {
      return {
        id: 'shift-owned',
        status: 'OPENED',
        cash_register: { id: 'register-test' },
        cashier: { id: 'cashier-other' }
      };
    },
    async closeShift() { closeCalls += 1; }
  };

  await assert.rejects(
    closeOwnedSandboxShift({ client, config, shift: detailedShift, openedBySmoke: true }),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_shift_cashier_mismatch'
  );
  assert.equal(closeCalls, 0);
});

test('sandbox mutations fail closed when Checkbox already has a shift not owned by this run', () => {
  assert.doesNotThrow(() => assertNoPreexistingSandboxShift(null));
  assert.doesNotThrow(() => assertNoPreexistingSandboxShift({ id: 'old', status: 'CLOSED' }));
  for (const status of ['CREATED', 'OPENING', 'OPENED', 'CLOSING']) {
    assert.throws(
      () => assertNoPreexistingSandboxShift({ id: 'foreign', status }),
      error => error instanceof CheckboxClientError
        && error.code === 'checkbox_sandbox_preexisting_shift_requires_manual_resolution'
        && error.details?.providerStatus === status
    );
  }
});

test('failure cleanup bounded-polls the exact smoke-owned UUID through not-found and opening before close', async () => {
  const config = proofConfig({ closeShift: false });
  const states = [
    new CheckboxClientError('not_found', 'not found', { status: 404 }),
    { id: 'shift-owned', status: 'CREATED', cash_register: { id: 'register-test' }, cashier: { id: 'cashier-test' } },
    { id: 'shift-owned', status: 'OPENING', cash_register: { id: 'register-test' }, cashier: { id: 'cashier-test' } },
    { id: 'shift-owned', status: 'OPENED', cash_register: { id: 'register-test' }, cashier: { id: 'cashier-test' } }
  ];
  const lookedUpIds = [];
  let closeCalls = 0;
  const client = {
    async getShiftById({ shiftId }) {
      lookedUpIds.push(shiftId);
      const state = states.shift();
      if (state instanceof Error) throw state;
      return state;
    },
    async getCurrentShift() {
      return { id: 'shift-owned', status: 'OPENED', cash_register: { id: 'register-test' }, cashier: { id: 'cashier-test' } };
    },
    async closeShift() {
      closeCalls += 1;
      return { id: 'shift-owned', status: 'CLOSED', cash_register: { id: 'register-test' }, cashier: { id: 'cashier-test' } };
    }
  };

  const result = await closeOwnedSandboxShift({
    client,
    config,
    shift: { id: 'shift-owned', status: 'CREATED' },
    openedBySmoke: true,
    force: true,
    pollAttempts: 5,
    pollDelayMs: 0
  });
  assert.equal(result.closed, true);
  assert.equal(closeCalls, 1);
  assert.deepEqual(lookedUpIds, ['shift-owned', 'shift-owned', 'shift-owned', 'shift-owned']);
});

test('failure cleanup times out safely without closing when exact owned shift cannot be proven', async () => {
  const config = proofConfig({ closeShift: false });
  let closeCalls = 0;
  const client = {
    async getShiftById() {
      throw new CheckboxClientError('not_found', 'not found', { status: 404 });
    },
    async getCurrentShift() { throw new Error('must not inspect a foreign current shift'); },
    async closeShift() { closeCalls += 1; }
  };
  await assert.rejects(
    closeOwnedSandboxShift({
      client,
      config,
      shift: { id: 'shift-owned', status: 'CREATED' },
      openedBySmoke: true,
      force: true,
      pollAttempts: 3,
      pollDelayMs: 0
    }),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_owned_shift_cleanup_timeout'
  );
  assert.equal(closeCalls, 0);
});

test('failure cleanup force-closes a smoke-owned shift even when normal close is disabled', async () => {
  const config = proofConfig({ closeShift: false });
  const shift = {
    id: 'shift-owned',
    status: 'OPENED',
    cash_register: { id: 'register-test' },
    cashier: { id: 'cashier-test' }
  };
  let closeCalls = 0;
  const client = {
    async getShiftById() { return shift; },
    async getCurrentShift() { return shift; },
    async closeShift() {
      closeCalls += 1;
      return { ...shift, status: 'CLOSED' };
    }
  };
  const skipped = await closeOwnedSandboxShift({ client, config, shift, openedBySmoke: true });
  assert.equal(skipped.reason, 'close_disabled');
  const cleanup = await closeOwnedSandboxShift({ client, config, shift, openedBySmoke: true, force: true });
  assert.equal(cleanup.closed, true);
  assert.equal(closeCalls, 1);
});

test('sandbox cleanup refuses to close when the current provider shift changed', async () => {
  const config = proofConfig({ closeShift: true });
  const ownedShift = {
    id: 'shift-owned',
    status: 'OPENED',
    cash_register: { id: 'register-test' },
    cashier: { id: 'cashier-test' }
  };
  let closeCalls = 0;
  const client = {
    async getShiftById() { return ownedShift; },
    async getCurrentShift() { return { ...ownedShift, id: 'shift-other' }; },
    async closeShift() { closeCalls += 1; }
  };
  await assert.rejects(
    closeOwnedSandboxShift({ client, config, shift: ownedShift, openedBySmoke: true }),
    error => error instanceof CheckboxClientError && error.code === 'checkbox_sandbox_current_shift_uuid_mismatch'
  );
  assert.equal(closeCalls, 0);
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

test('client signs out the authenticated cashier and clears the cached token', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(null, { status: 204 });
  };
  const client = new CheckboxClient({
    baseUrl: 'https://api.checkbox.in.ua',
    fetchImpl
  });
  client.setAccessToken('test-token');
  await client.signOut();
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/api/v1/cashier/signout');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(client.accessToken, null);
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
  assert.match(script, /allowUnreportedPaymentPermissions:\s*config\.allowUnreportedPaymentPermissions === true/);
  assert.match(script, /cashier-readiness-checklist/);
  assert.match(script, /assertSandboxProofMutationGuard/);
  assert.match(script, /allowUnreportedPaymentPermissions/);
  assert.match(script, /expectedIsTest: true/);
  assert.match(script, /waitShiftOpened/);
  assert.match(script, /waitShiftClosed/);
  assert.match(script, /shift-cleanup-after-failure/);
  assert.match(script, /waitReceiptDone/);
  assert.match(script, /card_terminal_manual/);
  assert.match(script, /phase2-operations-skipped/);
  assert.match(script, /checkbox:sandbox:readiness/);
  assert.match(script, /mutations: false/);
  assert.doesNotMatch(script, /sha256=\\$\\{signCheckboxWebhookBody/);
});
