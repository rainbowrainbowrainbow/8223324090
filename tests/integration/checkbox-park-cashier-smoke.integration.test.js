/**
 * Fresh PostgreSQL + local HTTP Checkbox smoke for the park thin MVP.
 *
 * Run only through:
 *   npm run test:integration:checkbox-park-cashier-smoke:isolated
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { run: runPilotConfig } = require('../../scripts/configure-checkbox-park-pilot');
const { pool } = require('../../db');
const {
    cancelDraftPaymentOrder,
    createAdmissionTicketPaymentOrder,
    confirmPaymentOrder
} = require('../../services/payments/paymentService');
const { createProviderFromConfig } = require('../../services/checkbox/provider');
const { processPaymentOutboxJobs } = require('../../services/payments/paymentOutboxWorker');
const { verifyCheckboxWebhookSignature } = require('../../services/checkbox/webhookAuth');
const {
    listUnresolvedPaymentOrders,
    loadCheckboxSalesReport,
    probeCheckboxReadiness,
    requestPhase1ShiftClose
} = require('../../services/payments/paymentReadinessService');

const enabled = process.env.RUN_CHECKBOX_PARK_CASHIER_SMOKE_INTEGRATION === 'true';
const CRM_PROFILE_KEY = 'event_genix';
const REGISTER_ALIAS = 'middle';
const FISCAL_ACTIONS = Object.freeze([
    'payments.view',
    'payments.create',
    'payments.confirm_received',
    'fiscal.shift.open',
    'fiscal.shift.close'
]);
const CONFIG_ACTOR_ACTIONS = Object.freeze([
    ...FISCAL_ACTIONS,
    'fiscal.configure'
]);
const TICKET_CODES = Object.freeze([
    'regular_child',
    'under_3_child',
    'discounted_child',
    'birthday_child',
    'adult_companion',
    'adult_game'
]);
const TEST_TICKET_PRICES_UAH = Object.freeze({
    regular_child: 100,
    under_3_child: 100,
    discounted_child: 100,
    birthday_child: 100,
    adult_companion: 10,
    adult_game: 10
});
const nativeFetch = globalThis.fetch;
const OFFICIAL_CHECKBOX_HOSTS = new Set(['api.checkbox.in.ua', 'api.checkbox.ua']);

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_CHECKBOX_PARK_CASHIER_SMOKE_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL);
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createUserPayload(row) {
    return {
        id: Number(row.id),
        username: row.username,
        name: row.name,
        role: row.role,
        action_allowlist: FISCAL_ACTIONS,
        actionAllowlist: FISCAL_ACTIONS,
        business_contexts: [CRM_PROFILE_KEY],
        businessContexts: [CRM_PROFILE_KEY],
        default_business_context: CRM_PROFILE_KEY,
        defaultBusinessContext: CRM_PROFILE_KEY
    };
}

async function seedFixedUser({ id, username, name, role = 'reception', actions = FISCAL_ACTIONS }) {
    const result = await pool.query(
        `INSERT INTO users (
             id, username, password_hash, name, role, is_active,
             action_allowlist, business_contexts, default_business_context
         )
         VALUES ($1, $2, $3, $4, $5, true, $6::text[], $7::text[], $8)
         ON CONFLICT (id) DO UPDATE
             SET username = EXCLUDED.username,
                 password_hash = EXCLUDED.password_hash,
                 name = EXCLUDED.name,
                 role = EXCLUDED.role,
                 is_active = true,
                 action_allowlist = EXCLUDED.action_allowlist,
                 business_contexts = EXCLUDED.business_contexts,
                 default_business_context = EXCLUDED.default_business_context
         RETURNING id, username, name, role`,
        [
            id,
            username,
            `smoke-password-hash-${crypto.randomUUID()}`,
            name,
            role,
            actions,
            [CRM_PROFILE_KEY],
            CRM_PROFILE_KEY
        ]
    );
    await pool.query(
        `SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1), true)`
    );
    return createUserPayload({
        ...result.rows[0],
        action_allowlist: actions,
        actionAllowlist: actions
    });
}

function testPilotConfig({ cashierIds, legalEntityKey, providerOrganizationId, providerRegisterId, providerCashierId }) {
    return {
        crmProfileKey: CRM_PROFILE_KEY,
        locationAlias: 'park',
        registerAlias: REGISTER_ALIAS,
        legalEntityKey,
        legalEntityName: 'ФОПТЕСТ',
        taxIdentifier: `test-tax-${process.pid}`,
        providerOrganizationId,
        providerOutletId: null,
        locationName: 'Дитячий критий парк',
        registerName: 'Середня каса',
        providerRegisterId,
        credentialRef: 'park-middle-smoke',
        providerCashierId,
        expectedIsTest: true,
        integrationOwnerUserId: cashierIds[0],
        cashierUserIds: cashierIds,
        eventGenixUsers: {
            primaryTestCashierUserId: 3,
            primaryTestCashierName: 'Natalia Vasylivna',
            cashierUserIds: cashierIds,
            integrationOwnerUserIds: [cashierIds[0]]
        },
        capabilities: [...FISCAL_ACTIONS],
        priceSource: 'EventGenix admission tariff immutable snapshot',
        items: TICKET_CODES.map(code => ({
            itemCode: code,
            fiscalItemName: code === 'adult_companion'
                ? 'Дорослий супровід'
                : `Тестовий квиток ${code}`,
            taxMode: 'untaxed'
        }))
    };
}

async function withTempConfigFile(config, callback) {
    const filePath = path.join(os.tmpdir(), `checkbox-park-smoke-${process.pid}-${crypto.randomUUID()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    try {
        return await callback(filePath);
    } finally {
        fs.rmSync(filePath, { force: true });
    }
}

async function seedFiscalScope({ cashier, secondCashier }) {
    const legalEntityKey = `fop_park_smoke_${process.pid}`.toLowerCase();
    const providerOrganizationId = `mock-org-${process.pid}`;
    const providerRegisterId = `mock-register-${process.pid}`;
    const providerCashierId = `mock-cashier-${cashier.id}`;
    const env = { EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };
    const config = testPilotConfig({
        cashierIds: [cashier.id, secondCashier.id],
        legalEntityKey,
        providerOrganizationId,
        providerRegisterId,
        providerCashierId
    });
    const applied = await withTempConfigFile(config, async filePath => {
        const preflight = await runPilotConfig(['preflight', '--config-file', filePath], { env, dbPool: pool });
        assert.equal(preflight.ok, true, JSON.stringify(preflight.preflight?.checks || preflight));
        const apply = await runPilotConfig(
            ['apply', '--config-file', filePath, '--actor-user-id', String(cashier.id), '--reason', 'integration smoke config-file apply'],
            { env, dbPool: pool }
        );
        assert.equal(apply.applied, true);
        const enabledRegister = await runPilotConfig(
            ['enable-register', '--config-file', filePath, '--actor-user-id', String(cashier.id), '--reason', 'integration smoke enable local register'],
            { env, dbPool: pool }
        );
        assert.equal(enabledRegister.featureEnabled, true);
        return apply;
    });

    const mappingRows = await pool.query(
        `SELECT item_code, tax_mode, provider_tax_id
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND status = 'active'
          ORDER BY item_code`,
        [applied.fiscalProfileId, applied.fiscalRegisterId]
    );
    assert.deepEqual(mappingRows.rows.map(row => row.item_code), [...TICKET_CODES].sort());
    assert.ok(mappingRows.rows.every(row => row.tax_mode === 'untaxed'));
    assert.ok(mappingRows.rows.every(row => row.provider_tax_id === null));

    const bindingRows = await pool.query(
        `SELECT user_id, action_pin_hash, capability_scope
           FROM fiscal_cashier_bindings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND status = 'active'
          ORDER BY user_id`,
        [applied.fiscalProfileId, applied.fiscalRegisterId]
    );
    assert.deepEqual(bindingRows.rows.map(row => Number(row.user_id)), [cashier.id, secondCashier.id].sort((a, b) => a - b));
    assert.ok(bindingRows.rows.every(row => row.action_pin_hash === null), 'thin MVP bindings must not require PIN');

    const dummyProfile = await pool.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name,
             tax_identifier, provider, provider_organization_id, currency, status
         )
         VALUES ('dummy_profile', $1, 'Dummy FOP', $2, 'checkbox', $3, 'UAH', 'active')
         RETURNING id`,
        [`dummy_fop_${process.pid}`, `dummy-tax-${process.pid}`, `dummy-org-${process.pid}`]
    );

    return {
        fiscalProfileId: Number(applied.fiscalProfileId),
        fiscalLocationId: Number(applied.fiscalLocationId),
        fiscalRegisterId: Number(applied.fiscalRegisterId),
        dummyFiscalProfileId: Number(dummyProfile.rows[0].id),
        providerOrganizationId,
        providerRegisterId,
        providerCashierId,
        legalEntityKey
    };
}

function makeQuote({ fingerprint, totalUah, code, name }) {
    return async () => ({
        legacy: false,
        requiresExplicitConversion: false,
        quoteFingerprint: fingerprint,
        ticketSubtotal: totalUah,
        ticketLines: [{
            ticketTypeCode: code,
            ticketTypeName: name,
            quantity: 1,
            unitPriceUah: totalUah,
            subtotalUah: totalUah,
            tariffVersionId: null
        }]
    });
}

async function listenMockCheckbox() {
    const state = {
        shiftOpened: false,
        shiftExists: false,
        shiftStatus: null,
        cashierId: null,
        organizationId: null,
        registerId: null,
        shiftId: 'mock-shift-1',
        calls: [],
        receipts: new Map(),
        modes: new Map(),
        unavailablePaths: new Set(),
        permissions: { sales: true, cash_payment: true, card_payment: true },
        tokensIssued: 0
    };
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
            const rawBody = Buffer.concat(chunks);
            const bodyText = rawBody.toString('utf8');
            const body = bodyText ? JSON.parse(bodyText) : null;
            const call = {
                method: req.method,
                path: req.url,
                headers: req.headers,
                body,
                rawBody: bodyText
            };
            state.calls.push(call);

            const send = (status, payload) => {
                if (res.destroyed || res.writableEnded) return;
                res.writeHead(status, { 'content-type': 'application/json' });
                res.end(JSON.stringify(payload));
            };

            try {
                if (state.unavailablePaths.has(req.url)) {
                    return send(503, { error: 'provider_unavailable' });
                }
                if (req.url === '/api/v1/cashier/signin' && req.method === 'POST') {
                    state.tokensIssued += 1;
                    return send(200, { access_token: `mock-token-${state.tokensIssued}`, token_type: 'bearer' });
                }
                if (req.url === '/api/v1/cashier/signinPinCode' && req.method === 'POST') {
                    if (!body?.pin_code) return send(400, { error: 'pin_code_required' });
                    state.tokensIssued += 1;
                    return send(200, { access_token: `mock-pin-token-${state.tokensIssued}`, token_type: 'bearer' });
                }
                if (req.url === '/api/v1/cashier/me' && req.method === 'GET') {
                    return send(200, {
                        id: state.cashierId,
                        blocked: false,
                        organization: { id: state.organizationId },
                        is_test: true,
                        certificate_end: '2099-01-01T00:00:00.000Z',
                        permissions: state.permissions
                    });
                }
                if (req.url === '/api/v1/cash-registers/info' && req.method === 'GET') {
                    return send(200, {
                        id: state.registerId,
                        organization_id: state.organizationId,
                        fiscal_number: '4000000000',
                        is_test: true,
                        created_at: '2026-01-01T00:00:00.000Z',
                        offline_mode: false,
                        stay_offline: false,
                        documents_state: { last_receipt_code: null, last_report_code: null }
                    });
                }
                if (req.url === '/api/v1/cashier/check-signature' && req.method === 'GET') {
                    return send(200, {
                        online: true,
                        type: 'CLOUD_SIGNATURE_3',
                        shift_open_possibility: true
                    });
                }
                if (req.url === '/api/v1/cashier/tax' && req.method === 'GET') {
                    return send(200, [{
                        id: '7',
                        code: 7,
                        label: 'VAT 20',
                        symbol: 'А',
                        rate: 20,
                        included: true,
                        created_at: '2026-01-01T00:00:00.000Z'
                    }]);
                }
                if (req.url === '/api/v1/cashier/shift' && req.method === 'GET') {
                    if (!state.shiftOpened || state.shiftStatus === 'CLOSED') {
                        return send(404, { error: 'shift_not_opened' });
                    }
                    return send(200, {
                        id: state.shiftId,
                        status: state.shiftStatus || 'OPENED',
                        cash_register_id: state.registerId,
                        cashier_id: state.cashierId
                    });
                }
                if (req.url.startsWith('/api/v1/shifts/') && req.method === 'GET') {
                    const requestedShiftId = decodeURIComponent(req.url.slice('/api/v1/shifts/'.length));
                    if (!state.shiftExists || requestedShiftId !== state.shiftId) {
                        return send(404, { error: 'shift_not_found' });
                    }
                    const status = state.shiftStatus || (state.shiftOpened ? 'OPENED' : 'CLOSED');
                    const payload = {
                        id: state.shiftId,
                        status,
                        cash_register: { id: state.registerId, fiscal_number: '4000000000', active: true },
                        cashier: { id: state.cashierId }
                    };
                    if (status === 'CLOSING') {
                        state.shiftStatus = 'CLOSED';
                        state.shiftOpened = false;
                    }
                    return send(200, payload);
                }
                if (req.url === '/api/v1/shifts' && req.method === 'POST') {
                    state.shiftOpened = true;
                    state.shiftExists = true;
                    state.shiftStatus = 'OPENED';
                    state.shiftId = body?.id || state.shiftId || crypto.randomUUID();
                    return send(201, {
                        id: state.shiftId,
                        status: 'OPENED',
                        cash_register_id: state.registerId,
                        cashier_id: state.cashierId
                    });
                }
                if (req.url === '/api/v1/shifts/close' && req.method === 'POST') {
                    if (!state.shiftOpened || state.shiftStatus !== 'OPENED') {
                        return send(409, { error: 'shift_not_opened' });
                    }
                    state.shiftStatus = 'CLOSING';
                    return send(202, {
                        id: state.shiftId,
                        status: 'CLOSING',
                        cash_register: { id: state.registerId, fiscal_number: '4000000000' },
                        cashier: { id: state.cashierId }
                    });
                }
                if (req.url === '/api/v1/receipts/validate' && req.method === 'POST') {
                    if (state.modes.get(body?.id) === 'validation_422') {
                        return send(422, { error: 'validation failed', authorization: 'Bearer should-redact' });
                    }
                    return send(200, { valid: true });
                }
                if (req.url === '/api/v1/receipts/sell' && req.method === 'POST') {
                    const id = String(body?.id || '');
                    const mode = state.modes.get(id) || 'success';
                    const receipt = {
                        id,
                        status: mode === 'pending' ? 'CREATED' : 'DONE',
                        type: 'SELL',
                        fiscal_code: `FC-${id}`.slice(0, 80),
                        serial: state.calls.filter(item => item.path === '/api/v1/receipts/sell').length,
                        total_sum: (body?.goods?.reduce((sum, item) => sum + Number(item.good?.price || 0) * Number(item.quantity || 1000) / 1000, 0) || 0) + (mode === 'invalid_amount' ? 1 : 0),
                        total_payment: body?.payments?.[0]?.value || 0,
                        total_rest: Math.max(0, Number(body?.payments?.[0]?.value || 0) - (body?.goods?.reduce((sum, item) => sum + Number(item.good?.price || 0) * Number(item.quantity || 1000) / 1000, 0) || 0)),
                        payments: body?.payments || [],
                        cash_register_id: state.registerId,
                        cashier_id: state.cashierId,
                        shift_id: state.shiftId,
                        context: body?.context || {},
                        tax_url: `https://api.checkbox.in.ua/api/v1/receipts/${id}`
                    };
                    if (mode === 'malformed') return send(200, { status: 'DONE' });
                    state.receipts.set(id, { ...receipt, status: 'DONE' });
                    if (mode === 'timeout_after_success') {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        return send(201, receipt);
                    }
                    return send(201, receipt);
                }
                const receiptMatch = req.url.match(/^\/api\/v1\/receipts\/([^/]+)$/);
                if (receiptMatch && req.method === 'GET') {
                    const receipt = state.receipts.get(decodeURIComponent(receiptMatch[1]));
                    if (!receipt) return send(404, { error: 'not found' });
                    return send(200, receipt);
                }
                return send(404, { error: 'not found' });
            } catch (error) {
                return send(500, { error: error.message });
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
        state,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    };
}

function providerConfig(baseUrl, timeoutMs = 1000, overrides = {}) {
    return {
        baseUrl,
        login: 'mock-login',
        password: 'mock-password',
        licenseKey: 'mock-license',
        accessKey: 'mock-access',
        deviceId: 'eventgenix-smoke-device',
        expectedIsTest: true,
        clientName: 'EventGenix Smoke',
        clientVersion: 'test',
        timeoutMs,
        ...overrides
    };
}

function createHttpProvider(mock, timeoutMs = 1000) {
    return createProviderFromConfig(providerConfig(mock.baseUrl, timeoutMs));
}

function createOfficialHostMockFetch(mock) {
    const mockOrigin = new URL(mock.baseUrl);
    return function officialHostMockFetch(input, init) {
        const source = input instanceof Request ? input.url : String(input);
        const url = new URL(source);
        if (!OFFICIAL_CHECKBOX_HOSTS.has(url.hostname.toLowerCase())) {
            throw new Error(`Unexpected external host in isolated Checkbox test: ${url.hostname}`);
        }
        url.protocol = mockOrigin.protocol;
        url.hostname = mockOrigin.hostname;
        url.port = mockOrigin.port;
        const rewritten = input instanceof Request ? new Request(url, input) : url;
        return nativeFetch(rewritten, init);
    };
}

async function runWorkerUntilIdle(provider = null, maxRounds = 80) {
    const results = [];
    for (let i = 0; i < maxRounds; i += 1) {
        const options = {
            dbPool: pool,
            batchSize: 1,
            lockedBy: `checkbox-park-http-smoke-${process.pid}`,
            lockExpiryMs: 30_000
        };
        if (provider) options.provider = provider;
        const batch = await processPaymentOutboxJobs(options);
        results.push(batch);
        if (batch.claimed === 0) break;
    }
    return results;
}

async function forceRetryNow(operationId) {
    await pool.query(
        `UPDATE payment_outbox_jobs
            SET next_run_at = NOW(), status = 'failed', locked_at = NULL, locked_by = NULL
          WHERE fiscal_operation_id = $1
            AND status = 'failed'`,
        [operationId]
    );
}

async function createOrder({ user, key, tender, totalUah, itemCode }) {
    return createAdmissionTicketPaymentOrder({
        dbPool: pool,
        user,
        idempotencyKey: `order-${key}-${process.pid}`,
        body: {
            tender,
            admissionTicket: { smoke: key }
        },
        quoteResolver: makeQuote({
            fingerprint: `quote-${key}-${process.pid}`,
            totalUah,
            code: itemCode,
            name: `Park test ${itemCode}`
        })
    });
}

async function confirmOrder({ user, order, key, tender, amountMinor, receivedAmountMinor, terminalReference }) {
    return confirmPaymentOrder({
        dbPool: pool,
        user,
        orderId: order.order.id,
        idempotencyKey: `confirm-${key}-${process.pid}`,
        body: tender === 'cash'
            ? { tender, confirmedAmountMinor: receivedAmountMinor || amountMinor }
            : { tender, confirmedAmountMinor: amountMinor, terminalShowedSuccess: true, terminalReference }
    });
}

async function countRows(sql, params = []) {
    const result = await pool.query(sql, params);
    return Number(result.rows[0].count);
}

async function providerRequestUuidForOperation(fiscalOperationId) {
    const result = await pool.query(
        'SELECT provider_operation_id FROM fiscal_operations WHERE id = $1',
        [fiscalOperationId]
    );
    return result.rows[0]?.provider_operation_id || null;
}

async function expectErrorCode(promise, code) {
    let caught = null;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.ok(caught, `expected ${code}`);
    assert.equal(caught.code, code);
    return caught;
}

describe('Checkbox park thin MVP on fresh PostgreSQL and local HTTP mock', {
    skip: !enabled,
    concurrency: 1
}, () => {
    let cashier;
    let secondCashier;
    let scope;
    let mock;
    let previousCheckboxEnv;

    before(async () => {
        requireIsolatedDatabase();
        previousCheckboxEnv = {
            CHECKBOX_INTEGRATION_ENABLED: process.env.CHECKBOX_INTEGRATION_ENABLED,
            CHECKBOX_ACCEPT_PAYMENTS_ENABLED: process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED,
            CHECKBOX_PARK_MIDDLE_SMOKE_BASE_URL: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_BASE_URL,
            CHECKBOX_PARK_MIDDLE_SMOKE_LOGIN: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_LOGIN,
            CHECKBOX_PARK_MIDDLE_SMOKE_PASSWORD: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_PASSWORD,
            CHECKBOX_PARK_MIDDLE_SMOKE_LICENSE_KEY: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_LICENSE_KEY,
            CHECKBOX_PARK_MIDDLE_SMOKE_ACCESS_KEY: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_ACCESS_KEY,
            CHECKBOX_PARK_MIDDLE_SMOKE_DEVICE_ID: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_DEVICE_ID,
            CHECKBOX_EXPECT_IS_TEST: process.env.CHECKBOX_EXPECT_IS_TEST,
            PAYMENT_OUTBOX_WAKEUP_DISABLED: process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED
        };
        cashier = await seedFixedUser({
            id: 3,
            username: `natalia_http_smoke_${process.pid}`,
            name: 'Наталія Василівна / Natalia Vasylivna',
            role: 'creator',
            actions: CONFIG_ACTOR_ACTIONS
        });
        secondCashier = await seedFixedUser({
            id: 4,
            username: `cashier_http_smoke_second_${process.pid}`,
            name: 'Checkbox HTTP smoke second cashier',
            role: 'reception',
            actions: CONFIG_ACTOR_ACTIONS
        });
        scope = await seedFiscalScope({ cashier, secondCashier });
        mock = await listenMockCheckbox();
        mock.state.cashierId = scope.providerCashierId;
        mock.state.organizationId = scope.providerOrganizationId;
        mock.state.registerId = scope.providerRegisterId;
        process.env.CHECKBOX_INTEGRATION_ENABLED = 'true';
        process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'true';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_BASE_URL = 'https://api.checkbox.in.ua';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_LOGIN = 'mock-login';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_PASSWORD = 'mock-password';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_LICENSE_KEY = 'mock-license';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_ACCESS_KEY = 'mock-access';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_DEVICE_ID = 'eventgenix-smoke-device';
        process.env.CHECKBOX_EXPECT_IS_TEST = 'true';
        process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED = 'true';
    });

    after(async () => {
        if (previousCheckboxEnv) {
            for (const [key, value] of Object.entries(previousCheckboxEnv)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
        if (mock) await mock.close().catch(() => {});
        await pool.end().catch(() => {});
    });

    test('standalone walk-in identity separates identical customers and scopes idempotency replay', async () => {
        const body = { tender: 'cash', admissionTicket: { sameTickets: true } };
        const sharedQuote = makeQuote({
            fingerprint: `quote-identical-${process.pid}`,
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            code: 'regular_child',
            name: 'Дитячий test ticket'
        });

        const first = await createAdmissionTicketPaymentOrder({
            dbPool: pool,
            user: cashier,
            body,
            idempotencyKey: `identity-a-${process.pid}`,
            quoteResolver: sharedQuote
        });
        const reload = await createAdmissionTicketPaymentOrder({
            dbPool: pool,
            user: cashier,
            body,
            idempotencyKey: `identity-a-${process.pid}`,
            quoteResolver: sharedQuote
        });
        const secondCustomer = await createAdmissionTicketPaymentOrder({
            dbPool: pool,
            user: cashier,
            body,
            idempotencyKey: `identity-b-${process.pid}`,
            quoteResolver: sharedQuote
        });

        assert.equal(first.replayed, false);
        assert.equal(reload.replayed, true);
        assert.equal(reload.order.id, first.order.id);
        assert.equal(secondCustomer.replayed, false);
        assert.notEqual(secondCustomer.order.id, first.order.id);
        assert.notEqual(secondCustomer.order.sourceId, first.order.sourceId);
        assert.match(first.order.sourceId, /^walkin_sale_[0-9a-f-]{36}$/);

        await expectErrorCode(
            createAdmissionTicketPaymentOrder({
                dbPool: pool,
                user: cashier,
                body: { tender: 'card_terminal_manual', admissionTicket: { sameTickets: true } },
                idempotencyKey: `identity-a-${process.pid}`,
                quoteResolver: sharedQuote
            }),
            'idempotency_key_conflict'
        );
        await expectErrorCode(
            createAdmissionTicketPaymentOrder({
                dbPool: pool,
                user: secondCashier,
                body,
                idempotencyKey: `identity-a-${process.pid}`,
                quoteResolver: sharedQuote
            }),
            'idempotency_key_scope_conflict'
        );
    });

    test('local HTTP Checkbox readiness supports password and PIN auth without fiscal mutations', async () => {
        const expected = {
            expectedOrganizationId: scope.providerOrganizationId,
            expectedRegisterId: scope.providerRegisterId,
            expectedCashierId: scope.providerCashierId,
            expectedIsTest: true
        };
        const passwordProvider = createProviderFromConfig(providerConfig(mock.baseUrl, 1000, { authMode: 'password' }));
        const passwordDiagnostics = await passwordProvider.collectReadinessDiagnostics(expected);
        assert.equal(passwordDiagnostics.mutations, false);
        assert.equal(passwordDiagnostics.checks.find(check => check.code === 'auth')?.status, 'ready');
        assert.equal(mock.state.calls.some(call => call.path === '/api/v1/cashier/signin'), true);

        const pinProvider = createProviderFromConfig(providerConfig(mock.baseUrl, 1000, {
            authMode: 'pin',
            login: '',
            password: '',
            pinCode: crypto.randomUUID()
        }));
        const pinDiagnostics = await pinProvider.collectReadinessDiagnostics(expected);
        assert.equal(pinDiagnostics.mutations, false);
        assert.equal(pinDiagnostics.checks.find(check => check.code === 'auth')?.status, 'ready');
        assert.equal(mock.state.calls.some(call => call.path === '/api/v1/cashier/signinPinCode'), true);
        assert.equal(mock.state.calls.filter(call => ['/api/v1/shifts', '/api/v1/receipts/validate', '/api/v1/receipts/sell'].includes(call.path)).length, 0);
    });

    test('readiness negative scenarios aggregate wrong identity, missing permissions, and provider unavailable', async () => {
        const expected = {
            expectedOrganizationId: scope.providerOrganizationId,
            expectedRegisterId: scope.providerRegisterId,
            expectedCashierId: scope.providerCashierId,
            expectedIsTest: true
        };
        const provider = createHttpProvider(mock);
        const original = {
            cashierId: mock.state.cashierId,
            organizationId: mock.state.organizationId,
            registerId: mock.state.registerId,
            permissions: { ...mock.state.permissions }
        };
        try {
            mock.state.cashierId = 'wrong-cashier';
            const wrongCashierDiagnostics = await provider.collectReadinessDiagnostics(expected);
            const wrongCashierByCode = new Map(wrongCashierDiagnostics.checks.map(check => [check.code, check]));
            assert.equal(wrongCashierDiagnostics.ready, false);
            assert.equal(wrongCashierByCode.get('cashier_identity')?.status, 'blocked');

            mock.state.cashierId = original.cashierId;
            mock.state.organizationId = 'wrong-org';
            mock.state.registerId = 'wrong-register';
            mock.state.permissions = { sales: false, cash_payment: false, card_payment: false };
            mock.state.unavailablePaths.add('/api/v1/cash-registers/info');
            const diagnostics = await provider.collectReadinessDiagnostics(expected);
            const byCode = new Map(diagnostics.checks.map(check => [check.code, check]));
            assert.equal(diagnostics.ready, false);
            assert.equal(byCode.get('organization_identity')?.status, 'blocked');
            assert.equal(byCode.get('register_identity')?.status, 'unavailable');
            assert.equal(byCode.get('sales_permission')?.status, 'blocked');
            assert.equal(byCode.get('cash_permission')?.status, 'blocked');
            assert.equal(byCode.get('card_permission')?.status, 'blocked');
            assert.equal(diagnostics.mutations, false);
        } finally {
            mock.state.cashierId = original.cashierId;
            mock.state.organizationId = original.organizationId;
            mock.state.registerId = original.registerId;
            mock.state.permissions = original.permissions;
            mock.state.unavailablePaths.clear();
        }
    });

    test('actual worker preserves shift recovery stage and retries only the same durable UUID after two exact 404 lookups', async () => {
        assert.equal(mock.state.shiftOpened, false, 'recovery regression must start without a provider shift');
        const order = await createOrder({
            user: cashier,
            key: 'shift-crash-before-http',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        await confirmOrder({
            user: cashier,
            order,
            key: 'shift-crash-before-http',
            tender: 'cash',
            amountMinor: '10000'
        });

        const shiftOperation = await pool.query(
            `SELECT fo.id AS operation_id,
                    fo.provider_operation_id,
                    fo.fiscal_shift_id,
                    job.id AS job_id
               FROM fiscal_operations fo
               JOIN payment_outbox_jobs job
                 ON job.fiscal_operation_id = fo.id
                AND job.fiscal_profile_id = fo.fiscal_profile_id
              WHERE fo.fiscal_profile_id = $1
                AND fo.fiscal_register_id = $2
                AND fo.operation_type = 'shift_open'
              ORDER BY fo.id DESC
              LIMIT 1`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        assert.equal(shiftOperation.rowCount, 1);
        const shift = shiftOperation.rows[0];
        const durableUuid = shift.provider_operation_id;

        await pool.query(
            `UPDATE fiscal_operations
                SET external_stage = 'shift_request_maybe_submitted'
              WHERE id = $1`,
            [shift.operation_id]
        );
        await pool.query(
            `UPDATE payment_outbox_jobs
                SET external_stage = 'shift_request_maybe_submitted',
                    payload = payload || '{"external_stage":"shift_request_maybe_submitted"}'::jsonb,
                    status = 'queued',
                    next_run_at = NOW()
              WHERE id = $1`,
            [shift.job_id]
        );
        await pool.query(
            `UPDATE payment_outbox_jobs
                SET next_run_at = NOW() + INTERVAL '1 hour'
              WHERE payment_order_id = $1
                AND job_type = 'receipt_sell'`,
            [order.order.id]
        );

        const first = await processPaymentOutboxJobs({
            dbPool: pool,
            provider: createHttpProvider(mock),
            batchSize: 1,
            lockedBy: `checkbox-shift-crash-first-${process.pid}`
        });
        assert.equal(first.failed, 1);
        assert.equal(first.results[0].error.code, 'checkbox_shift_open_lookup_not_found');
        assert.equal(mock.state.calls.filter(call => call.path === '/api/v1/shifts' && call.method === 'POST').length, 0);

        const firstStage = await pool.query(
            'SELECT external_stage, status FROM payment_outbox_jobs WHERE id = $1',
            [shift.job_id]
        );
        assert.equal(firstStage.rows[0].external_stage, 'shift_lookup_not_found');
        assert.equal(firstStage.rows[0].status, 'failed');
        await forceRetryNow(shift.operation_id);

        const second = await processPaymentOutboxJobs({
            dbPool: pool,
            provider: createHttpProvider(mock),
            batchSize: 1,
            lockedBy: `checkbox-shift-crash-second-${process.pid}`
        });
        assert.equal(second.succeeded, 1, JSON.stringify(second));
        assert.equal(second.results[0].source, 'shift_open_same_uuid_retry');
        const opens = mock.state.calls.filter(call => call.path === '/api/v1/shifts' && call.method === 'POST');
        assert.equal(opens.length, 1);
        assert.equal(opens[0].body.id, durableUuid);
        assert.equal(mock.state.shiftId, durableUuid);

        const persistedShift = await pool.query(
            'SELECT provider_shift_id, status, lifecycle_stage FROM fiscal_shifts WHERE id = $1',
            [shift.fiscal_shift_id]
        );
        assert.deepEqual(persistedShift.rows[0], {
            provider_shift_id: durableUuid,
            status: 'open',
            lifecycle_stage: 'OPENED'
        });
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_audit_events
                  WHERE entity_table = 'payment_outbox_jobs'
                    AND entity_id = $1
                    AND event_type = 'checkbox_shift_same_uuid_retry'`,
                [shift.job_id]
            ),
            1
        );

        await pool.query(
            `UPDATE payment_outbox_jobs
                SET next_run_at = NOW()
              WHERE payment_order_id = $1
                AND job_type = 'receipt_sell'`,
            [order.order.id]
        );
        await runWorkerUntilIdle(createHttpProvider(mock));
        const paidState = await pool.query('SELECT fiscal_status FROM payment_orders WHERE id = $1', [order.order.id]);
        assert.equal(paidState.rows[0].fiscal_status, 'fiscalized');

        const readiness = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: true
        });
        assert.equal(readiness.providerReady, true);
        const previousAcceptance = process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED;
        process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'false';
        try {
            const closeRequest = await requestPhase1ShiftClose({
                dbPool: pool,
                user: cashier,
                shiftId: shift.fiscal_shift_id,
                idempotencyKey: `phase1-close-recovery-${process.pid}`
            });
            const queuedClose = await pool.query(
                'SELECT status, external_stage FROM payment_outbox_jobs WHERE id = $1',
                [closeRequest.outboxJobId]
            );
            assert.deepEqual(queuedClose.rows[0], { status: 'queued', external_stage: 'auth' });

            const closeSubmit = await processPaymentOutboxJobs({
                dbPool: pool,
                provider: createHttpProvider(mock),
                batchSize: 1,
                lockedBy: `checkbox-shift-close-submit-${process.pid}`
            });
            assert.equal(closeSubmit.failed, 1);
            assert.equal(closeSubmit.results[0].error.code, 'checkbox_shift_close_pending');
            assert.equal(mock.state.calls.filter(call => call.path === '/api/v1/shifts/close' && call.method === 'POST').length, 1);

            await forceRetryNow(closeRequest.fiscalOperationId);
            const closeLookupPending = await processPaymentOutboxJobs({
                dbPool: pool,
                provider: createHttpProvider(mock),
                batchSize: 1,
                lockedBy: `checkbox-shift-close-lookup-pending-${process.pid}`
            });
            assert.equal(closeLookupPending.failed, 1);
            assert.equal(closeLookupPending.results[0].error.code, 'checkbox_shift_close_pending');
            assert.equal(mock.state.calls.filter(call => call.path === '/api/v1/shifts/close' && call.method === 'POST').length, 1);

            await forceRetryNow(closeRequest.fiscalOperationId);
            const closeFinal = await processPaymentOutboxJobs({
                dbPool: pool,
                provider: createHttpProvider(mock),
                batchSize: 1,
                lockedBy: `checkbox-shift-close-final-${process.pid}`
            });
            assert.equal(closeFinal.succeeded, 1, JSON.stringify(closeFinal));
            assert.equal(closeFinal.results[0].source, 'shift_close_lookup');
            assert.equal(mock.state.calls.filter(call => call.path === '/api/v1/shifts/close' && call.method === 'POST').length, 1);
            const closedShift = await pool.query(
                'SELECT status, lifecycle_stage, provider_shift_id FROM fiscal_shifts WHERE id = $1',
                [shift.fiscal_shift_id]
            );
            assert.deepEqual(closedShift.rows[0], {
                status: 'closed',
                lifecycle_stage: 'CLOSED',
                provider_shift_id: durableUuid
            });
        } finally {
            if (previousAcceptance === undefined) delete process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED;
            else process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = previousAcceptance;
        }
    });

    test('draft cancellation is audited and paid orders cannot be cancelled', async () => {
        const draft = await createOrder({
            user: cashier,
            key: 'cancel-draft',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const cancelled = await cancelDraftPaymentOrder({
            dbPool: pool,
            user: cashier,
            orderId: draft.order.id,
            idempotencyKey: `cancel-draft-${process.pid}`
        });
        const replay = await cancelDraftPaymentOrder({
            dbPool: pool,
            user: cashier,
            orderId: draft.order.id,
            idempotencyKey: `cancel-draft-${process.pid}`
        });
        assert.equal(cancelled.order.status, 'cancelled');
        assert.equal(cancelled.order.paymentStatus, 'unpaid');
        assert.equal(cancelled.order.fiscalStatus, 'not_required');
        assert.equal(replay.replayed, true);
        const auditCount = await countRows(
            `SELECT COUNT(*) FROM fiscal_audit_events WHERE entity_table = 'payment_orders' AND entity_id = $1 AND event_type = 'payment_order_cancelled'`,
            [draft.order.id]
        );
        assert.equal(auditCount, 1);

        const paid = await createOrder({
            user: cashier,
            key: 'cancel-paid',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        await confirmOrder({
            user: cashier,
            order: paid,
            key: 'cancel-paid',
            tender: 'cash',
            amountMinor: '10000'
        });
        await expectErrorCode(
            cancelDraftPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: paid.order.id,
                idempotencyKey: `cancel-paid-${process.pid}`
            }),
            'payment_order_cancel_denied'
        );
    });

    test('all six active admission ticket codes can create immutable untaxed order items from config-file mapping', async () => {
        for (const code of TICKET_CODES) {
            const order = await createOrder({
                user: cashier,
                key: `six-codes-${code}`,
                tender: 'cash',
                totalUah: TEST_TICKET_PRICES_UAH[code],
                itemCode: code
            });
            const items = await pool.query(
                `SELECT item_code, provider_tax_id, tax_mode, unit_price_minor, total_amount_minor
                   FROM payment_order_items
                  WHERE payment_order_id = $1`,
                [order.order.id]
            );
            assert.equal(items.rowCount, 1, code);
            assert.equal(items.rows[0].item_code, code);
            assert.equal(items.rows[0].provider_tax_id, null);
            assert.equal(items.rows[0].tax_mode, 'untaxed');
            assert.equal(BigInt(items.rows[0].unit_price_minor), BigInt(TEST_TICKET_PRICES_UAH[code] * 100));
            assert.equal(BigInt(items.rows[0].total_amount_minor), BigInt(TEST_TICKET_PRICES_UAH[code] * 100));
            await cancelDraftPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: order.order.id,
                idempotencyKey: `cancel-six-codes-${code}-${process.pid}`
            });
        }
    });

    test('manual terminal reference is metadata and does not globally block another payment', async () => {
        const first = await createOrder({
            user: cashier,
            key: 'terminal-ref-a',
            tender: 'card_terminal_manual',
            totalUah: TEST_TICKET_PRICES_UAH.adult_companion,
            itemCode: 'adult_companion'
        });
        const second = await createOrder({
            user: cashier,
            key: 'terminal-ref-b',
            tender: 'card_terminal_manual',
            totalUah: TEST_TICKET_PRICES_UAH.adult_companion,
            itemCode: 'adult_companion'
        });
        await confirmOrder({
            user: cashier,
            order: first,
            key: 'terminal-ref-a',
            tender: 'card_terminal_manual',
            amountMinor: '1000',
            terminalReference: 'same-terminal-report'
        });
        await confirmOrder({
            user: cashier,
            order: second,
            key: 'terminal-ref-b',
            tender: 'card_terminal_manual',
            amountMinor: '1000',
            terminalReference: 'same-terminal-report'
        });
        const refs = await pool.query(
            `SELECT provider_payment_reference, request_snapshot
               FROM payment_attempts
              WHERE payment_order_id = ANY($1::bigint[])
              ORDER BY payment_order_id`,
            [[first.order.id, second.order.id]]
        );
        assert.equal(refs.rows.length, 2);
        assert.equal(refs.rows[0].provider_payment_reference, null);
        assert.equal(refs.rows[1].provider_payment_reference, null);
        assert.equal(refs.rows[0].request_snapshot.terminal_reference, 'same-terminal-report');
        assert.equal(refs.rows[1].request_snapshot.terminal_reference, 'same-terminal-report');
    });

    test('cash and manual terminal sales fiscalize once through real CheckboxClient over local HTTP', async () => {
        await runWorkerUntilIdle(createHttpProvider(mock));

        const cashOrder = await createOrder({
            user: cashier,
            key: 'cash',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const confirmedCash = await confirmOrder({
            user: cashier,
            order: cashOrder,
            key: 'cash',
            tender: 'cash',
            amountMinor: '10000',
            receivedAmountMinor: '15000'
        });
        assert.ok(confirmedCash.fiscalOperationId);
        const cashProviderRequestUuid = await providerRequestUuidForOperation(confirmedCash.fiscalOperationId);

        const confirmation = await pool.query('SELECT confirmation_snapshot FROM payment_orders WHERE id = $1', [cashOrder.order.id]);
        assert.equal(confirmation.rows[0].confirmation_snapshot.received_amount_minor, '15000');
        assert.equal(confirmation.rows[0].confirmation_snapshot.change_amount_minor, '5000');

        const shiftOpenCallsBeforeCash = mock.state.calls.filter(call => call.path === '/api/v1/shifts').length;
        const cashWorkerBatches = await runWorkerUntilIdle(createHttpProvider(mock));
        const shiftOpenCallsAfterCash = mock.state.calls.filter(call => call.path === '/api/v1/shifts').length;
        assert.ok(
            shiftOpenCallsAfterCash === shiftOpenCallsBeforeCash || shiftOpenCallsAfterCash === shiftOpenCallsBeforeCash + 1,
            'provider shift is reused when already OPENED or opened at most once for the register'
        );
        assert.equal(
            mock.state.calls.filter(call => call.path === '/api/v1/receipts/sell' && call.body?.id === cashProviderRequestUuid).length,
            1,
            JSON.stringify({
                providerRequestUuid: cashProviderRequestUuid,
                batches: cashWorkerBatches,
                calls: mock.state.calls.map(call => ({ method: call.method, path: call.path, id: call.body?.id || null }))
            })
        );

        const cashCounts = await pool.query(
            `SELECT
                 (SELECT COUNT(*)::integer FROM payment_orders WHERE id = $1) AS orders,
                 (SELECT COUNT(*)::integer FROM fiscal_operations WHERE payment_order_id = $1 AND operation_type = 'sale') AS operations,
                 (SELECT COUNT(*)::integer FROM payment_outbox_jobs WHERE payment_order_id = $1 AND job_type = 'receipt_sell') AS jobs,
                 (SELECT COUNT(*)::integer FROM fiscal_receipts WHERE payment_order_id = $1 AND receipt_type = 'sale') AS receipts`,
            [cashOrder.order.id]
        );
        assert.deepEqual(cashCounts.rows[0], { orders: 1, operations: 1, jobs: 1, receipts: 1 });

        const cardOrder = await createOrder({
            user: cashier,
            key: 'card',
            tender: 'card_terminal_manual',
            totalUah: TEST_TICKET_PRICES_UAH.adult_companion,
            itemCode: 'adult_companion'
        });
        const confirmedCard = await confirmOrder({
            user: cashier,
            order: cardOrder,
            key: 'card',
            tender: 'card_terminal_manual',
            amountMinor: '1000',
            terminalReference: 'terminal-report-1'
        });
        const cardProviderRequestUuid = await providerRequestUuidForOperation(confirmedCard.fiscalOperationId);
        const shiftOpenCallsBeforeCard = mock.state.calls.filter(call => call.path === '/api/v1/shifts').length;
        await runWorkerUntilIdle(createHttpProvider(mock));

        assert.equal(mock.state.calls.filter(call => call.path === '/api/v1/shifts').length, shiftOpenCallsBeforeCard, 'second sale reuses provider-opened shift');
        assert.equal(mock.state.calls.filter(call => call.path === '/api/v1/receipts/sell' && call.body?.id === cardProviderRequestUuid).length, 1);

        const cardState = await pool.query('SELECT payment_status, fiscal_status, confirmation_snapshot FROM payment_orders WHERE id = $1', [cardOrder.order.id]);
        assert.equal(cardState.rows[0].payment_status, 'confirmed');
        assert.equal(cardState.rows[0].fiscal_status, 'fiscalized');
        assert.equal(cardState.rows[0].confirmation_snapshot.terminal_reference, 'terminal-report-1');

        const saleCall = mock.state.calls.find(call => call.path === '/api/v1/receipts/sell' && call.body?.id === cashProviderRequestUuid);
        assert.equal(saleCall.headers.authorization.startsWith('Bearer '), true);
        assert.equal(saleCall.headers['x-access-key'], 'mock-access');
        assert.equal(saleCall.body.goods[0].good.tax, undefined, 'untaxed test items must not send fabricated Checkbox tax ids');
        assert.doesNotMatch(JSON.stringify(saleCall.body), /admission_tariff:/);
    });

    test('duplicate click, conflicting idempotency key, and concurrent confirmation do not duplicate sale jobs', async () => {
        const order = await createOrder({
            user: cashier,
            key: 'concurrent',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });

        const first = await confirmPaymentOrder({
            dbPool: pool,
            user: cashier,
            orderId: order.order.id,
            idempotencyKey: `confirm-duplicate-${process.pid}`,
            body: { tender: 'cash', confirmedAmountMinor: '10000' }
        });
        const duplicate = await confirmPaymentOrder({
            dbPool: pool,
            user: cashier,
            orderId: order.order.id,
            idempotencyKey: `confirm-duplicate-${process.pid}`,
            body: { tender: 'cash', confirmedAmountMinor: '10000' }
        });
        assert.equal(duplicate.replayed, true);
        assert.equal(
            await countRows('SELECT COUNT(*)::integer AS count FROM fiscal_operations WHERE payment_order_id = $1 AND operation_type = $2', [order.order.id, 'sale']),
            1
        );

        await expectErrorCode(
            confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: order.order.id,
                idempotencyKey: `confirm-duplicate-${process.pid}`,
                body: { tender: 'cash', confirmedAmountMinor: '9000' }
            }),
            'idempotency_key_conflict'
        );

        const concurrentOrder = await createOrder({
            user: cashier,
            key: 'parallel',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const results = await Promise.allSettled([
            confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: concurrentOrder.order.id,
                idempotencyKey: `confirm-parallel-a-${process.pid}`,
                body: { tender: 'cash', confirmedAmountMinor: '10000' }
            }),
            confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: concurrentOrder.order.id,
                idempotencyKey: `confirm-parallel-b-${process.pid}`,
                body: { tender: 'cash', confirmedAmountMinor: '10000' }
            })
        ]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(
            await countRows('SELECT COUNT(*)::integer AS count FROM fiscal_operations WHERE payment_order_id = $1 AND operation_type = $2', [concurrentOrder.order.id, 'sale']),
            1
        );
        assert.equal(
            await countRows('SELECT COUNT(*)::integer AS count FROM payment_outbox_jobs WHERE payment_order_id = $1 AND job_type = $2', [concurrentOrder.order.id, 'receipt_sell']),
            1
        );
        await runWorkerUntilIdle(createHttpProvider(mock));
    });

    test('unresolved queue is register-wide, latest-job deduped, and sales report totals run on PostgreSQL', async () => {
        const first = await createOrder({
            user: cashier,
            key: 'report-cashier-a',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const firstConfirmed = await confirmOrder({
            user: cashier,
            order: first,
            key: 'report-cashier-a',
            tender: 'cash',
            amountMinor: '10000'
        });
        const second = await createOrder({
            user: secondCashier,
            key: 'report-cashier-b',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        await confirmOrder({
            user: secondCashier,
            order: second,
            key: 'report-cashier-b',
            tender: 'cash',
            amountMinor: '10000'
        });

        const latestJobBefore = await pool.query(
            `SELECT fiscal_profile_id, fiscal_operation_id, payment_order_id
               FROM payment_outbox_jobs
              WHERE fiscal_operation_id = $1
              ORDER BY id DESC
              LIMIT 1`,
            [firstConfirmed.fiscalOperationId]
        );
        await pool.query(
            `INSERT INTO payment_outbox_jobs (
                 fiscal_profile_id, fiscal_operation_id, payment_order_id, job_type,
                 status, idempotency_key, attempts, max_attempts, next_run_at, payload
             )
             VALUES ($1, $2, $3, 'receipt_status_lookup', 'failed', $4, 1, 10, NOW(), '{"source":"dedupe-regression"}'::jsonb)`,
            [
                latestJobBefore.rows[0].fiscal_profile_id,
                latestJobBefore.rows[0].fiscal_operation_id,
                latestJobBefore.rows[0].payment_order_id,
                `dedupe-regression:${process.pid}:${first.order.id}`
            ]
        );

        const unresolvedForSecondCashier = await listUnresolvedPaymentOrders({
            dbPool: pool,
            user: secondCashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS
        });
        const unresolvedIds = unresolvedForSecondCashier.orders.map(order => order.id);
        assert.equal(new Set(unresolvedIds).size, unresolvedIds.length, 'latest-job CTE must not duplicate unresolved orders');
        assert.ok(unresolvedIds.includes(first.order.id), 'second cashier must see unresolved order from the same register');
        assert.ok(unresolvedIds.includes(second.order.id), 'second cashier must see own unresolved order');
        assert.equal(unresolvedForSecondCashier.orders.find(order => order.id === first.order.id).isMine, false);
        assert.equal(unresolvedForSecondCashier.orders.find(order => order.id === second.order.id).isMine, true);
        assert.ok(unresolvedForSecondCashier.registerCount >= 2);
        assert.ok(unresolvedForSecondCashier.myCount >= 1);

        const report = await loadCheckboxSalesReport({
            dbPool: pool,
            user: secondCashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            page: 1,
            pageSize: 1
        });
        assert.equal(report.orders.length, 1, 'report rows respect pagination');
        assert.ok(report.totalCount >= 2, 'report totals count the full filter scope, not only current page');
        assert.ok(BigInt(report.totals.paymentTotalMinor) >= 20000n);

        const mineReport = await loadCheckboxSalesReport({
            dbPool: pool,
            user: secondCashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            cashierUserId: 'mine',
            page: 1,
            pageSize: 10
        });
        assert.ok(mineReport.orders.every(order => order.id !== first.order.id), 'mine filter must not leak another cashier order');
        assert.ok(mineReport.orders.some(order => order.id === second.order.id));
    });

    test('4xx, pending, malformed, timeout-after-success, webhook replay, cross-profile isolation, and redaction fail safely', async () => {
        await runWorkerUntilIdle(createHttpProvider(mock));

        await expectErrorCode(
            createOrder({
                user: cashier,
                key: 'missing-mapping',
                tender: 'cash',
                totalUah: 100,
                itemCode: 'missing_ticket_mapping'
            }),
            'fiscal_item_mapping_missing'
        );

        const validationOrder = await createOrder({
            user: cashier,
            key: '422',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.discounted_child,
            itemCode: 'discounted_child'
        });
        const validationConfirm = await confirmOrder({
            user: cashier,
            order: validationOrder,
            key: '422',
            tender: 'cash',
            amountMinor: '10000'
        });
        const validationProviderRequestUuid = await providerRequestUuidForOperation(validationConfirm.fiscalOperationId);
        mock.state.modes.set(validationProviderRequestUuid, 'validation_422');
        await runWorkerUntilIdle(createHttpProvider(mock));
        const validationJob = await pool.query('SELECT status, attempts, last_error_message FROM payment_outbox_jobs WHERE fiscal_operation_id = $1', [validationConfirm.fiscalOperationId]);
        assert.equal(validationJob.rows[0].status, 'dead');
        assert.equal(validationJob.rows[0].attempts, 1);
        assert.doesNotMatch(validationJob.rows[0].last_error_message || '', /mock-access|mock-password|Bearer should-redact/i);

        const timeoutOrder = await createOrder({
            user: cashier,
            key: 'timeout',
            tender: 'card_terminal_manual',
            totalUah: TEST_TICKET_PRICES_UAH.adult_companion,
            itemCode: 'adult_companion'
        });
        const timeoutConfirm = await confirmOrder({
            user: cashier,
            order: timeoutOrder,
            key: 'timeout',
            tender: 'card_terminal_manual',
            amountMinor: '1000',
            terminalReference: 'timeout-terminal'
        });
        const timeoutProviderRequestUuid = await providerRequestUuidForOperation(timeoutConfirm.fiscalOperationId);
        mock.state.modes.set(timeoutProviderRequestUuid, 'timeout_after_success');
        const timeoutBatches = await runWorkerUntilIdle(createHttpProvider(mock, 100));
        assert.ok(timeoutBatches.some(batch => batch.failed >= 1), 'timeout-after-success must enter retryable recovery');
        await forceRetryNow(timeoutConfirm.fiscalOperationId);
        const saleCountBeforeLookup = mock.state.calls.filter(call => call.path === '/api/v1/receipts/sell' && call.body?.id === timeoutProviderRequestUuid).length;
        const lookupBatches = await runWorkerUntilIdle(createHttpProvider(mock));
        assert.ok(
            lookupBatches.some(batch => batch.succeeded >= 1 && batch.results.some(result => result.source === 'lookup')),
            'timeout recovery must converge through lookup'
        );
        assert.equal(
            mock.state.calls.filter(call => call.path === '/api/v1/receipts/sell' && call.body?.id === timeoutProviderRequestUuid).length,
            saleCountBeforeLookup,
            'unknown timeout recovery must lookup without second sell'
        );

        for (const mode of ['pending', 'malformed']) {
            const order = await createOrder({
                user: cashier,
                key: mode,
                tender: 'cash',
                totalUah: TEST_TICKET_PRICES_UAH.regular_child,
                itemCode: mode === 'pending' ? 'under_3_child' : 'birthday_child'
            });
            const confirmed = await confirmOrder({
                user: cashier,
                order,
                key: mode,
                tender: 'cash',
                amountMinor: '10000'
            });
            const providerRequestUuid = await providerRequestUuidForOperation(confirmed.fiscalOperationId);
            mock.state.modes.set(providerRequestUuid, mode);
            const batches = await runWorkerUntilIdle(createHttpProvider(mock));
            assert.ok(batches.some(batch => batch.failed >= 1), `${mode} response must fail closed during worker drain`);
            const state = await pool.query('SELECT fiscal_status FROM payment_orders WHERE id = $1', [order.order.id]);
            assert.notEqual(state.rows[0].fiscal_status, 'fiscalized');
            assert.equal(
                await countRows('SELECT COUNT(*)::integer AS count FROM fiscal_receipts WHERE payment_order_id = $1', [order.order.id]),
                0
            );
        }

        const invalidAmountOrder = await createOrder({
            user: cashier,
            key: 'invalid-amount',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const invalidAmountConfirm = await confirmOrder({
            user: cashier,
            order: invalidAmountOrder,
            key: 'invalid-amount',
            tender: 'cash',
            amountMinor: '10000'
        });
        const invalidAmountUuid = await providerRequestUuidForOperation(invalidAmountConfirm.fiscalOperationId);
        mock.state.modes.set(invalidAmountUuid, 'invalid_amount');
        const invalidAmountBatches = await runWorkerUntilIdle(createHttpProvider(mock));
        assert.ok(invalidAmountBatches.some(batch => batch.failed >= 1), 'wrong provider amount must fail closed');
        const invalidAmountState = await pool.query('SELECT fiscal_status FROM payment_orders WHERE id = $1', [invalidAmountOrder.order.id]);
        assert.notEqual(invalidAmountState.rows[0].fiscal_status, 'fiscalized');

        const rawWebhookBody = Buffer.from(JSON.stringify({ id: `event-${process.pid}`, receipt_id: timeoutProviderRequestUuid }));
        const webhookSecret = crypto.randomBytes(32).toString('hex');
        const validSignature = crypto.createHmac('sha256', webhookSecret).update(rawWebhookBody).digest('base64');
        assert.equal(verifyCheckboxWebhookSignature({ rawBody: rawWebhookBody, signatureHeader: validSignature, signingSecret: webhookSecret }), true);
        assert.throws(
            () => verifyCheckboxWebhookSignature({ rawBody: Buffer.from(`${rawWebhookBody} `), signatureHeader: validSignature, signingSecret: webhookSecret }),
            error => error.code === 'checkbox_webhook_signature_invalid'
        );

        await pool.query(
            `INSERT INTO provider_webhook_events (
                 fiscal_profile_id, provider, provider_event_id, event_type,
                 webhook_signature_valid, payload_sha256, sanitized_payload, status
             )
             VALUES ($1, 'checkbox', $2, 'receipt.updated', true, $3, $4::jsonb, 'received')`,
            [
                scope.fiscalProfileId,
                `webhook-event-${process.pid}`,
                crypto.createHash('sha256').update(rawWebhookBody).digest('hex'),
                rawWebhookBody.toString('utf8')
            ]
        );
        await assert.rejects(
            pool.query(
                `INSERT INTO provider_webhook_events (
                     fiscal_profile_id, provider, provider_event_id, event_type,
                     webhook_signature_valid, payload_sha256, sanitized_payload, status
                 )
                 VALUES ($1, 'checkbox', $2, 'receipt.updated', true, $3, $4::jsonb, 'received')`,
                [
                    scope.fiscalProfileId,
                    `webhook-event-${process.pid}`,
                    crypto.createHash('sha256').update(rawWebhookBody).digest('hex'),
                    rawWebhookBody.toString('utf8')
                ]
            ),
            /duplicate key|unique/i
        );

        assert.equal(
            await countRows('SELECT COUNT(*)::integer AS count FROM payment_orders WHERE fiscal_profile_id = $1', [scope.dummyFiscalProfileId]),
            0,
            'dummy fiscal profile remains isolated from park smoke operations'
        );
    });
});
