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
    createAdmissionTicketPaymentOrder: createAdmissionTicketPaymentOrderBase,
    confirmPaymentOrder
} = require('../../services/payments/paymentService');
const { createProviderFromConfig } = require('../../services/checkbox/provider');
const { credentialEnvPrefix } = require('../../services/checkbox/config');
const {
    approveServiceOut,
    closeShift,
    createFullRefund,
    createReconciliationRevision,
    createServiceIn,
    createServiceOutRequest,
    ensureOpenShiftForSale,
    getOperationalReport
} = require('../../services/payments/cashierOperationsService');
const {
    createActionPinHash,
    createEphemeralActionPin
} = require('../../services/payments/fiscalApprovals');
const {
    DEFAULT_LOCK_EXPIRY_MS,
    claimPaymentOutboxJobs,
    finalizeJobSuccess,
    processOnePaymentOutboxJob,
    processPaymentOutboxJobs
} = require('../../services/payments/paymentOutboxWorker');
const { verifyCheckboxWebhookSignature } = require('../../services/checkbox/webhookAuth');
const { countFiscalShiftCloseBlockers } = require('../../services/payments/shiftCloseBlockers');
const { assertRecoveryActorAuthorized } = require('../../scripts/checkbox-outbox-recovery');
const {
    listUnresolvedPaymentOrders: listUnresolvedPaymentOrdersBase,
    loadCheckboxSalesReport: loadCheckboxSalesReportBase,
    loadReadinessState: loadReadinessStateBase,
    probeCheckboxReadiness: probeCheckboxReadinessBase,
    requestPhase1ShiftClose
} = require('../../services/payments/paymentReadinessService');

const enabled = process.env.RUN_CHECKBOX_PARK_CASHIER_SMOKE_INTEGRATION === 'true';
const CRM_PROFILE_KEY = 'event_genix';
const LOCATION_ALIAS = 'park';
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

function withParkMiddlePaymentScope(body = {}) {
    return {
        crmProfileKey: body.crmProfileKey ?? body.crm_profile_key ?? CRM_PROFILE_KEY,
        locationAlias: body.locationAlias ?? body.location_alias ?? LOCATION_ALIAS,
        registerAlias: body.registerAlias ?? body.register_alias ?? REGISTER_ALIAS,
        ...body
    };
}

function withParkMiddleScope(options = {}) {
    return {
        crmProfileKey: options.crmProfileKey ?? options.crm_profile_key ?? CRM_PROFILE_KEY,
        locationAlias: options.locationAlias ?? options.location_alias ?? LOCATION_ALIAS,
        registerAlias: options.registerAlias ?? options.register_alias ?? REGISTER_ALIAS,
        ...options
    };
}

function createAdmissionTicketPaymentOrder(options = {}) {
    return createAdmissionTicketPaymentOrderBase({
        ...options,
        body: withParkMiddlePaymentScope(options.body || {})
    });
}

function loadReadinessState(options = {}) {
    return loadReadinessStateBase(withParkMiddleScope(options));
}

function probeCheckboxReadiness(options = {}) {
    return probeCheckboxReadinessBase(withParkMiddleScope(options));
}

function listUnresolvedPaymentOrders(options = {}) {
    return listUnresolvedPaymentOrdersBase(withParkMiddleScope(options));
}

function loadCheckboxSalesReport(options = {}) {
    return loadCheckboxSalesReportBase(withParkMiddleScope(options));
}

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
        registerCredentialRef: 'park-middle-smoke-register',
        cashierCredentialRef: 'park-middle-smoke-cashier',
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
    const acceptingRegister = await pool.query(
        `UPDATE fiscal_registers
            SET acceptance_enabled = TRUE,
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2
            AND status = 'active'
            AND feature_enabled = TRUE
          RETURNING feature_enabled, acceptance_enabled`,
        [applied.fiscalRegisterId, applied.fiscalProfileId]
    );
    assert.equal(acceptingRegister.rowCount, 1, 'isolated mock smoke register must be feature-enabled before payment acceptance');
    assert.equal(acceptingRegister.rows[0].feature_enabled, true);
    assert.equal(acceptingRegister.rows[0].acceptance_enabled, true);

    const catalogSaleItems = await activeCatalogSaleItems();
    for (const item of catalogSaleItems) {
        await pool.query(
            `INSERT INTO fiscal_item_mappings (
                 fiscal_profile_id, fiscal_register_id, crm_profile_key, business_context,
                 source_type, item_type, item_code, fiscal_item_name, provider,
                 provider_tax_id, tax_code, tax_rate_bps, tax_mode, status
             )
             VALUES ($1, $2, $3, $3, 'catalog_sale', 'catalog_sale', $4, $5, 'checkbox',
                     NULL, NULL, NULL, 'untaxed', 'active')
             ON CONFLICT (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code, provider)
             DO UPDATE
                 SET business_context = EXCLUDED.business_context,
                     fiscal_item_name = EXCLUDED.fiscal_item_name,
                     provider_tax_id = NULL,
                     tax_code = NULL,
                     tax_rate_bps = NULL,
                     tax_mode = 'untaxed',
                     status = 'active',
                     updated_at = NOW()`,
            [applied.fiscalProfileId, applied.fiscalRegisterId, CRM_PROFILE_KEY, item.itemCode, item.fiscalItemName]
        );
    }

    const mappingRows = await pool.query(
        `SELECT source_type, item_type, item_code, tax_mode, provider_tax_id, tax_code, tax_rate_bps
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND status = 'active'
          ORDER BY source_type, item_code`,
        [applied.fiscalProfileId, applied.fiscalRegisterId]
    );
    const admissionRows = mappingRows.rows.filter(row => row.source_type === 'admission_ticket');
    const catalogRows = mappingRows.rows.filter(row => row.source_type === 'catalog_sale');
    assert.deepEqual(admissionRows.map(row => row.item_code), [...TICKET_CODES].sort());
    assert.deepEqual(catalogRows.map(row => row.item_code), catalogSaleItems.map(item => item.itemCode));
    assert.ok(mappingRows.rows.every(row => row.item_type === row.source_type));
    assert.ok(mappingRows.rows.every(row => row.tax_mode === 'untaxed'));
    assert.ok(mappingRows.rows.every(row => row.provider_tax_id === null));
    assert.ok(catalogRows.every(row => row.tax_code === null && row.tax_rate_bps === null));

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
    const ownerBinding = bindingRows.rows.find(row => Number(row.user_id) === Number(cashier.id));
    const operatorBinding = bindingRows.rows.find(row => Number(row.user_id) === Number(secondCashier.id));
    assert.ok(ownerBinding.capability_scope.includes('fiscal.incident.manage'));
    assert.equal(operatorBinding.capability_scope.includes('fiscal.incident.manage'), false);

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
                        has_shift: Boolean(state.shiftOpened && state.shiftStatus !== 'CLOSED'),
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
                        cash_register: { id: state.registerId, fiscal_number: '4000000000' }
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
                        cash_register: { id: state.registerId, fiscal_number: '4000000000' },
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
                    return send(202, {
                        id: state.shiftId,
                        status: 'OPENED',
                        cash_register: { id: state.registerId, fiscal_number: '4000000000' },
                        cashier: { id: state.cashierId }
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
                        organization_id: state.organizationId,
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
    // The Windows test host occasionally applies a backwards wall-clock correction
    // between COMMIT and the worker claim. Only normalize pristine jobs whose
    // default next_run_at is exactly their creation timestamp; explicit delays and
    // retry backoff remain untouched.
    await pool.query(
        `UPDATE payment_outbox_jobs
            SET next_run_at = clock_timestamp()
          WHERE status = 'queued'
            AND attempts = 0
            AND next_run_at = created_at
            AND next_run_at > clock_timestamp()`
    );
    const results = [];
    for (let i = 0; i < maxRounds; i += 1) {
        const options = {
            dbPool: pool,
            batchSize: 1,
            lockedBy: `checkbox-park-http-smoke-${process.pid}`,
            lockExpiryMs: DEFAULT_LOCK_EXPIRY_MS
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
            SET next_run_at = NOW() - INTERVAL '1 second',
                status = 'failed',
                locked_at = NULL,
                locked_by = NULL,
                lock_token = NULL,
                heartbeat_at = NULL
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

async function activeCatalogSaleItems() {
    const result = await pool.query(
        `SELECT p.id AS item_code,
                COALESCE(NULLIF(BTRIM(p.name), ''), NULLIF(BTRIM(p.label), ''), p.id) AS fiscal_item_name
           FROM products p
           JOIN price_rules pr
             ON pr.product_id = p.id
            AND pr.value > 0
          WHERE p.business_context = $1
            AND p.is_active = TRUE
            AND COALESCE(p.availability_status, 'active') = 'active'
          GROUP BY p.id, p.name, p.label
         HAVING COUNT(*) = 1
          ORDER BY p.id`,
        [CRM_PROFILE_KEY]
    );
    return result.rows.map(row => ({
        itemCode: String(row.item_code || '').trim(),
        fiscalItemName: String(row.fiscal_item_name || row.item_code || '').trim()
    })).filter(item => item.itemCode && item.fiscalItemName);
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
            CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_BASE_URL: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_BASE_URL,
            CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_LICENSE_KEY: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_LICENSE_KEY,
            CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_ACCESS_KEY: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_ACCESS_KEY,
            CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_AUTH_MODE: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_AUTH_MODE,
            CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_LOGIN: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_LOGIN,
            CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_PASSWORD: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_PASSWORD,
            CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_DEVICE_ID: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_DEVICE_ID,
            CHECKBOX_PHASE2_REFUND_CASHIER_LOGIN: process.env.CHECKBOX_PHASE2_REFUND_CASHIER_LOGIN,
            CHECKBOX_PHASE2_REFUND_CASHIER_PASSWORD: process.env.CHECKBOX_PHASE2_REFUND_CASHIER_PASSWORD,
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
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_BASE_URL = 'https://api.checkbox.in.ua';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_LICENSE_KEY = 'mock-license';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_REGISTER_ACCESS_KEY = 'mock-access';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_AUTH_MODE = 'password';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_LOGIN = 'mock-login';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_PASSWORD = 'mock-password';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_CASHIER_DEVICE_ID = 'eventgenix-smoke-device';
        process.env.CHECKBOX_PHASE2_REFUND_CASHIER_LOGIN = 'mock-refund-login';
        process.env.CHECKBOX_PHASE2_REFUND_CASHIER_PASSWORD = 'mock-refund-password';
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

    test('operator recovery authorization is enforced by real PostgreSQL user, binding and integration owner rows', async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const actor = await assertRecoveryActorAuthorized(client, {
                fiscal_profile_id: scope.fiscalProfileId,
                fiscal_register_id: scope.fiscalRegisterId
            }, cashier.id);
            assert.equal(Number(actor.id), Number(cashier.id));
            await assert.rejects(
                assertRecoveryActorAuthorized(client, {
                    fiscal_profile_id: scope.fiscalProfileId,
                    fiscal_register_id: scope.fiscalRegisterId
                }, secondCashier.id),
                /canonical fiscal\.incident\.manage|binding does not allow|integration owner/
            );
        } finally {
            await client.query('ROLLBACK').catch(() => {});
            client.release();
        }
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

    test('missing cashier credential ref blocks payment before monetary or outbox writes', async () => {
        const order = await createOrder({
            user: cashier,
            key: 'missing-cashier-credential-ref',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const bindingBefore = await pool.query(
            `SELECT provider_cashier_login_ref
               FROM fiscal_cashier_bindings
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND user_id = $3
                AND status = 'active'`,
            [scope.fiscalProfileId, scope.fiscalRegisterId, cashier.id]
        );
        assert.equal(bindingBefore.rowCount, 1);
        assert.ok(String(bindingBefore.rows[0].provider_cashier_login_ref || '').trim());
        const originalCashierCredentialRef = bindingBefore.rows[0].provider_cashier_login_ref;
        const orderStateBefore = await pool.query(
            `SELECT status, payment_status, fiscal_status, confirmation_snapshot,
                    received_amount_minor, change_amount_minor, terminal_reference
               FROM payment_orders
              WHERE id = $1`,
            [order.order.id]
        );
        const loadLedgerCounts = async () => (await pool.query(
            `SELECT
                 (SELECT COUNT(*)::integer FROM payment_attempts WHERE payment_order_id = $1) AS attempts,
                 (SELECT COUNT(*)::integer FROM payment_allocations WHERE payment_order_id = $1) AS allocations,
                 (SELECT COUNT(*)::integer FROM fiscal_operations WHERE payment_order_id = $1) AS operations,
                 (SELECT COUNT(*)::integer FROM payment_outbox_jobs WHERE payment_order_id = $1) AS jobs`,
            [order.order.id]
        )).rows[0];
        const ledgerCountsBefore = await loadLedgerCounts();

        await pool.query(
            `UPDATE fiscal_cashier_bindings
                SET provider_cashier_login_ref = NULL,
                    updated_at = NOW()
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND user_id = $3`,
            [scope.fiscalProfileId, scope.fiscalRegisterId, cashier.id]
        );
        try {
            const error = await expectErrorCode(
                confirmPaymentOrder({
                    dbPool: pool,
                    user: cashier,
                    orderId: order.order.id,
                    idempotencyKey: `confirm-missing-cashier-credential-ref-${process.pid}`,
                    requireCheckboxIntegrationReady: false,
                    body: { tender: 'cash', confirmedAmountMinor: '10000' }
                }),
                'fiscal_provider_context_incomplete'
            );
            assert.deepEqual(error.details?.missing, ['cashier_credential_ref']);
            assert.deepEqual((await pool.query(
                `SELECT status, payment_status, fiscal_status, confirmation_snapshot,
                        received_amount_minor, change_amount_minor, terminal_reference
                   FROM payment_orders
                  WHERE id = $1`,
                [order.order.id]
            )).rows[0], orderStateBefore.rows[0]);
            assert.deepEqual(await loadLedgerCounts(), ledgerCountsBefore);
        } finally {
            await pool.query(
                `UPDATE fiscal_cashier_bindings
                    SET provider_cashier_login_ref = $4,
                        updated_at = NOW()
                  WHERE fiscal_profile_id = $1
                    AND fiscal_register_id = $2
                    AND user_id = $3`,
                [scope.fiscalProfileId, scope.fiscalRegisterId, cashier.id, originalCashierCredentialRef]
            );
        }
    });

    test('PostgreSQL claim serializes one in-flight job per register while different registers remain parallel', async () => {
        const suffix = `${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
        const primaryContextResult = await pool.query(
            `SELECT fr.provider_license_ref AS register_credential_ref,
                    fcb.provider_cashier_login_ref AS cashier_credential_ref,
                    fcb.provider_cashier_id
               FROM fiscal_registers fr
               JOIN fiscal_cashier_bindings fcb
                 ON fcb.fiscal_profile_id = fr.fiscal_profile_id
                AND fcb.fiscal_register_id = fr.id
                AND fcb.user_id = $3
                AND fcb.status = 'active'
              WHERE fr.id = $1
                AND fr.fiscal_profile_id = $2`,
            [scope.fiscalRegisterId, scope.fiscalProfileId, cashier.id]
        );
        assert.equal(primaryContextResult.rowCount, 1);
        const primaryContext = {
            registerId: scope.fiscalRegisterId,
            registerCredentialRef: primaryContextResult.rows[0].register_credential_ref,
            cashierCredentialRef: primaryContextResult.rows[0].cashier_credential_ref
        };
        const secondRegister = await pool.query(
            `INSERT INTO fiscal_registers (
                 fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
                 display_name, provider, provider_register_id, provider_license_ref,
                 status, feature_enabled, metadata
             )
             VALUES ($1, $2, $3, $4, 'Worker claim parallel register', 'checkbox', $5, $6,
                     'active', TRUE, '{"expected_is_test":true}'::jsonb)
             RETURNING id`,
            [
                scope.fiscalProfileId,
                scope.fiscalLocationId,
                CRM_PROFILE_KEY,
                `worker_claim_${suffix}`.slice(0, 64),
                `worker-register-${suffix}`,
                primaryContext.registerCredentialRef
            ]
        );
        const secondRegisterId = Number(secondRegister.rows[0].id);
        await pool.query(
            `INSERT INTO fiscal_cashier_bindings (
                 fiscal_profile_id, fiscal_register_id, user_id, provider,
                 provider_cashier_id, provider_cashier_login_ref, status,
                 crm_profile_key, fiscal_location_id, capability_scope
             )
             VALUES ($1, $2, $3, 'checkbox', $4, $5, 'active', $6, $7,
                     ARRAY['payments.view', 'payments.create', 'payments.confirm_received',
                           'fiscal.shift.open', 'fiscal.shift.close']::text[])`,
            [
                scope.fiscalProfileId,
                secondRegisterId,
                cashier.id,
                primaryContextResult.rows[0].provider_cashier_id,
                primaryContext.cashierCredentialRef,
                CRM_PROFILE_KEY,
                scope.fiscalLocationId
            ]
        );
        const secondContext = {
            registerId: secondRegisterId,
            registerCredentialRef: primaryContext.registerCredentialRef,
            cashierCredentialRef: primaryContext.cashierCredentialRef
        };
        const queueClaimCandidate = async (context, label) => {
            const operation = await pool.query(
                `INSERT INTO fiscal_operations (
                     fiscal_profile_id, fiscal_register_id, operation_type, status,
                     idempotency_key, provider, provider_operation_id, currency, request_snapshot,
                     external_stage, initiated_by_user_id, register_credential_ref,
                     cashier_credential_ref
                 )
                 VALUES ($1, $2, 'status_lookup', 'pending', $3, 'checkbox', $4, 'UAH', '{}'::jsonb,
                         'auth', $5, $6, $7)
                 RETURNING id`,
                [
                    scope.fiscalProfileId,
                    context.registerId,
                    `worker-claim-operation:${label}:${suffix}`,
                    crypto.randomUUID(),
                    cashier.id,
                    context.registerCredentialRef,
                    context.cashierCredentialRef
                ]
            );
            const job = await pool.query(
                `INSERT INTO payment_outbox_jobs (
                     fiscal_profile_id, fiscal_operation_id, job_type, status,
                     idempotency_key, payload, external_stage
                 )
                 VALUES ($1, $2, 'receipt_status_lookup', 'queued', $3,
                         '{"provider":"checkbox"}'::jsonb, 'auth')
                 RETURNING id`,
                [
                    scope.fiscalProfileId,
                    operation.rows[0].id,
                    `worker-claim-job:${label}:${suffix}`
                ]
            );
            return { operationId: Number(operation.rows[0].id), jobId: Number(job.rows[0].id) };
        };
        const claimConcurrently = async () => {
            const firstClient = await pool.connect();
            const secondClient = await pool.connect();
            try {
                await Promise.all([firstClient.query('BEGIN'), secondClient.query('BEGIN')]);
                const [first, second] = await Promise.all([
                    claimPaymentOutboxJobs(firstClient, { batchSize: 1, lockedBy: `claim-a-${suffix}` }),
                    claimPaymentOutboxJobs(secondClient, { batchSize: 1, lockedBy: `claim-b-${suffix}` })
                ]);
                await Promise.all([firstClient.query('COMMIT'), secondClient.query('COMMIT')]);
                return [...first, ...second];
            } catch (error) {
                await Promise.allSettled([firstClient.query('ROLLBACK'), secondClient.query('ROLLBACK')]);
                throw error;
            } finally {
                firstClient.release();
                secondClient.release();
            }
        };
        const settleCandidates = async candidates => {
            const jobIds = candidates.map(candidate => candidate.jobId);
            const operationIds = candidates.map(candidate => candidate.operationId);
            await pool.query(
                `UPDATE payment_outbox_jobs
                    SET status = 'succeeded', locked_at = NULL, locked_by = NULL,
                        lock_token = NULL, heartbeat_at = NULL, updated_at = NOW()
                  WHERE id = ANY($1::bigint[])`,
                [jobIds]
            );
            await pool.query(
                `UPDATE fiscal_operations
                    SET status = 'cancelled'
                  WHERE id = ANY($1::bigint[])`,
                [operationIds]
            );
        };

        const sameRegisterCandidates = await Promise.all([
            queueClaimCandidate(primaryContext, 'same-register-a'),
            queueClaimCandidate(primaryContext, 'same-register-b')
        ]);
        const sameRegisterClaims = await claimConcurrently();
        assert.equal(sameRegisterClaims.length, 1, 'concurrent claim transactions must not lease two jobs for one register');
        assert.ok(
            sameRegisterCandidates.some(candidate => candidate.jobId === Number(sameRegisterClaims[0].id)),
            'the claimed row must belong to the tested register queue'
        );
        await settleCandidates(sameRegisterCandidates);

        const differentRegisterCandidates = await Promise.all([
            queueClaimCandidate(primaryContext, 'different-register-main'),
            queueClaimCandidate(secondContext, 'different-register-second')
        ]);
        const differentRegisterClaims = await claimConcurrently();
        assert.equal(differentRegisterClaims.length, 2, 'separate registers must remain claimable in parallel');
        assert.deepEqual(
            new Set(differentRegisterClaims.map(job => Number(job.id))),
            new Set(differentRegisterCandidates.map(candidate => candidate.jobId))
        );
        await settleCandidates(differentRegisterCandidates);

        const staleCandidate = await queueClaimCandidate(primaryContext, 'expired-owner');
        const staleClient = await pool.connect();
        let staleClaim;
        try {
            await staleClient.query('BEGIN');
            staleClaim = await claimPaymentOutboxJobs(staleClient, {
                batchSize: 1,
                lockedBy: `expired-owner-${suffix}`,
                lockExpiryMs: 30_000
            });
            await staleClient.query('COMMIT');
        } catch (error) {
            await staleClient.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            staleClient.release();
        }
        assert.equal(staleClaim.length, 1);
        assert.equal(Number(staleClaim[0].id), staleCandidate.jobId);
        await pool.query(
            `UPDATE payment_outbox_jobs
                SET max_attempts = attempts,
                    locked_at = NOW() - INTERVAL '31 seconds',
                    heartbeat_at = NOW() - INTERVAL '31 seconds'
              WHERE id = $1`,
            [staleCandidate.jobId]
        );

        const successorCandidate = await queueClaimCandidate(primaryContext, 'successor-after-expiry');
        const successorClient = await pool.connect();
        let successorClaim;
        try {
            await successorClient.query('BEGIN');
            successorClaim = await claimPaymentOutboxJobs(successorClient, {
                batchSize: 1,
                lockedBy: `successor-owner-${suffix}`,
                lockExpiryMs: 30_000
            });
            await successorClient.query('COMMIT');
        } catch (error) {
            await successorClient.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            successorClient.release();
        }
        assert.equal(successorClaim.length, 1);
        assert.equal(Number(successorClaim[0].id), successorCandidate.jobId);

        let staleProviderCalls = 0;
        const staleResult = await processOnePaymentOutboxJob({
            dbPool: pool,
            provider: {
                async lookupReceipt() {
                    staleProviderCalls += 1;
                    return { found: false };
                }
            },
            job: staleClaim[0],
            lockExpiryMs: 30_000
        });
        assert.equal(staleResult.ok, false);
        assert.equal(staleResult.error.code, 'payment_outbox_job_ownership_lost');
        assert.equal(staleProviderCalls, 0, 'an expired worker must be rejected before any provider HTTP');
        await settleCandidates([staleCandidate, successorCandidate]);
    });

    test('PostgreSQL enforces one semantic fill-only open and close operation per fiscal shift', async () => {
        const createClosedShift = async suffix => {
            const result = await pool.query(
                `INSERT INTO fiscal_shifts (
                     fiscal_profile_id, fiscal_register_id, provider, provider_shift_id,
                     status, lifecycle_stage, opened_at, closed_at
                 )
                 VALUES ($1, $2, 'checkbox', $3, 'closed', 'CLOSED', NOW(), NOW())
                 RETURNING id`,
                [scope.fiscalProfileId, scope.fiscalRegisterId, `db-invariant-shift-${suffix}-${crypto.randomUUID()}`]
            );
            return Number(result.rows[0].id);
        };
        const fiscalBindingContextResult = await pool.query(
            `SELECT fp.provider_organization_id,
                    fl.provider_outlet_id,
                    fr.provider_register_id,
                    fr.provider_license_ref,
                    COALESCE(fr.metadata->>'expected_is_test', fr.metadata->>'expectedIsTest')::boolean AS expected_is_test,
                    binding.id AS cashier_binding_id,
                    binding.provider_cashier_id,
                    binding.provider_cashier_login_ref
               FROM fiscal_profiles fp
               JOIN fiscal_locations fl
                 ON fl.fiscal_profile_id = fp.id
                AND fl.id = $3
               JOIN fiscal_registers fr
                 ON fr.fiscal_profile_id = fp.id
                AND fr.id = $2
                AND fr.fiscal_location_id = fl.id
               JOIN fiscal_cashier_bindings binding
                 ON binding.fiscal_profile_id = fp.id
                AND binding.fiscal_location_id = fl.id
                AND binding.fiscal_register_id = fr.id
                AND binding.user_id = $4
                AND binding.status = 'active'
              WHERE fp.id = $1
              LIMIT 2`,
            [scope.fiscalProfileId, scope.fiscalRegisterId, scope.fiscalLocationId, cashier.id]
        );
        assert.equal(fiscalBindingContextResult.rowCount, 1);
        const fiscalBindingContext = fiscalBindingContextResult.rows[0];
        assert.ok(String(fiscalBindingContext.provider_license_ref || '').trim());
        assert.ok(String(fiscalBindingContext.provider_cashier_login_ref || '').trim());

        const createShiftOperation = async (shiftId, operationType, status = 'fiscalized') => {
            const providerRequestUuid = crypto.randomUUID();
            const result = await pool.query(
                `INSERT INTO fiscal_operations (
                     fiscal_profile_id, fiscal_register_id, fiscal_shift_id, fiscal_location_id,
                     operation_type, status, idempotency_key, provider,
                     provider_operation_id, currency, request_snapshot, initiated_by_user_id,
                     provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
                     register_credential_ref, cashier_credential_ref, expected_is_test
                  )
                  VALUES ($1, $2, $3, $4, $5, $6, $7, 'checkbox', $8, 'UAH', $9::jsonb, $10,
                          $11, $12, $13, $14, $15, $16, $17)
                  RETURNING id`,
                [
                    scope.fiscalProfileId,
                    scope.fiscalRegisterId,
                    shiftId,
                    scope.fiscalLocationId,
                    operationType,
                    status,
                    `db-invariant:${operationType}:${shiftId}:${crypto.randomUUID()}`,
                    providerRequestUuid,
                    JSON.stringify({
                        cashier_binding_id: Number(fiscalBindingContext.cashier_binding_id),
                        provider_request_uuid: providerRequestUuid
                    }),
                    cashier.id,
                    fiscalBindingContext.provider_organization_id,
                    fiscalBindingContext.provider_outlet_id,
                    fiscalBindingContext.provider_register_id,
                    fiscalBindingContext.provider_cashier_id,
                    fiscalBindingContext.provider_license_ref,
                    fiscalBindingContext.provider_cashier_login_ref,
                    fiscalBindingContext.expected_is_test
                ]
            );
            return Number(result.rows[0].id);
        };

        const originalProviderShift = {
            shiftOpened: mock.state.shiftOpened,
            shiftExists: mock.state.shiftExists,
            shiftStatus: mock.state.shiftStatus,
            shiftId: mock.state.shiftId
        };

        const upgradeClient = await pool.connect();
        try {
            await upgradeClient.query('BEGIN');
            await upgradeClient.query(
                'ALTER TABLE fiscal_shifts DROP CONSTRAINT chk_fiscal_shifts_status_lifecycle_v343'
            );
            const simulatedLegacyShift = await upgradeClient.query(
                `INSERT INTO fiscal_shifts (
                     fiscal_profile_id, fiscal_register_id, provider, status,
                     opened_at, closed_at
                 )
                 VALUES ($1, $2, 'checkbox', 'closed', NOW(), NOW())
                 RETURNING lifecycle_stage`,
                [scope.fiscalProfileId, scope.fiscalRegisterId]
            );
            assert.equal(
                simulatedLegacyShift.rows[0].lifecycle_stage,
                'CREATED',
                'migration 325 default must reproduce the historical closed-shift mismatch'
            );
            const migration343Sql = fs.readFileSync(
                path.join(__dirname, '../../db/migrations/343_checkbox_shift_operation_invariants.sql'),
                'utf8'
            );
            await assert.rejects(
                upgradeClient.query(migration343Sql),
                error => error?.code === '23514'
                    && /legacy fiscal shift status\/lifecycle mismatch requires audited reconciliation/.test(error.message)
            );
            await upgradeClient.query('ROLLBACK');

            await upgradeClient.query('BEGIN');
            await upgradeClient.query(
                'ALTER TABLE fiscal_shifts DROP CONSTRAINT chk_fiscal_shifts_status_lifecycle_v343'
            );
            await upgradeClient.query(
                `INSERT INTO fiscal_shifts (
                     fiscal_profile_id, fiscal_register_id, provider, status,
                     lifecycle_stage, provider_snapshot
                 )
                 VALUES ($1, $2, 'checkbox', 'failed', 'CLOSED', '{}'::jsonb)`,
                [scope.fiscalProfileId, scope.fiscalRegisterId]
            );
            await assert.rejects(
                upgradeClient.query(migration343Sql),
                error => error?.code === '23514'
                    && /legacy fiscal shift status\/lifecycle mismatch requires audited reconciliation/.test(error.message)
            );
            await upgradeClient.query('ROLLBACK');
        } catch (error) {
            await upgradeClient.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            upgradeClient.release();
        }

        mock.state.shiftOpened = false;
        mock.state.shiftExists = false;
        mock.state.shiftStatus = 'CLOSED';
        mock.state.shiftId = null;
        let transientShiftId = null;
        try {
            const readyBeforeLocalTransition = await probeCheckboxReadiness({
                dbPool: pool,
                user: cashier,
                crmProfileKey: CRM_PROFILE_KEY,
                registerAlias: REGISTER_ALIAS,
                fetchImpl: createOfficialHostMockFetch(mock),
                force: true
            });
            assert.equal(readyBeforeLocalTransition.shiftState, 'closed');
            assert.equal(readyBeforeLocalTransition.integrationReady, true);

            const transientShift = await pool.query(
                `INSERT INTO fiscal_shifts (
                     fiscal_profile_id, fiscal_register_id, provider, status,
                     lifecycle_stage, provider_snapshot
                 )
                 VALUES ($1, $2, 'checkbox', 'opening', 'OPENING', '{}'::jsonb)
                 RETURNING id`,
                [scope.fiscalProfileId, scope.fiscalRegisterId]
            );
            transientShiftId = Number(transientShift.rows[0].id);
            const callsBeforeCachedTransitionChecks = mock.state.calls.length;
            const loadedAfterLocalTransition = await loadReadinessState({
                dbPool: pool,
                user: cashier,
                crmProfileKey: CRM_PROFILE_KEY,
                registerAlias: REGISTER_ALIAS
            });
            assert.equal(loadedAfterLocalTransition.integrationReady, false);
            assert.equal(loadedAfterLocalTransition.shiftState, 'opening');
            assert.equal(loadedAfterLocalTransition.readinessCode, 'shift_opening');
            const cachedAfterLocalTransition = await probeCheckboxReadiness({
                dbPool: pool,
                user: cashier,
                crmProfileKey: CRM_PROFILE_KEY,
                registerAlias: REGISTER_ALIAS,
                fetchImpl: createOfficialHostMockFetch(mock),
                force: false
            });
            assert.equal(cachedAfterLocalTransition.integrationReady, false);
            assert.equal(cachedAfterLocalTransition.shiftState, 'opening');
            assert.equal(cachedAfterLocalTransition.readinessCode, 'shift_opening');
            assert.equal(
                mock.state.calls.length,
                callsBeforeCachedTransitionChecks,
                'cache reconciliation must fail closed without provider HTTP'
            );
        } finally {
            if (transientShiftId) {
                await pool.query(
                    'DELETE FROM fiscal_shifts WHERE id = $1',
                    [transientShiftId]
                );
            }
            mock.state.shiftOpened = originalProviderShift.shiftOpened;
            mock.state.shiftExists = originalProviderShift.shiftExists;
            mock.state.shiftStatus = originalProviderShift.shiftStatus;
            mock.state.shiftId = originalProviderShift.shiftId;
        }

        const externalProviderShiftId = `db-invariant-external-shift-${crypto.randomUUID()}`;
        const mutationCallsBeforeExternalShiftProbe = mock.state.calls.filter(
            call => call.method === 'POST' && ['/api/v1/shifts', '/api/v1/shifts/close', '/api/v1/receipts/validate', '/api/v1/receipts/sell'].includes(call.path)
        ).length;
        mock.state.shiftOpened = true;
        mock.state.shiftExists = true;
        mock.state.shiftStatus = 'OPENED';
        mock.state.shiftId = externalProviderShiftId;
        try {
            const unresolvedLocalShiftsBeforeProbe = await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_shifts
                  WHERE fiscal_profile_id = $1
                    AND fiscal_register_id = $2
                    AND lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING')`,
                [scope.fiscalProfileId, scope.fiscalRegisterId]
            );
            assert.equal(unresolvedLocalShiftsBeforeProbe, 0);
            const externalShiftReadiness = await probeCheckboxReadiness({
                dbPool: pool,
                user: cashier,
                crmProfileKey: CRM_PROFILE_KEY,
                registerAlias: REGISTER_ALIAS,
                fetchImpl: createOfficialHostMockFetch(mock),
                force: true
            });
            assert.equal(externalShiftReadiness.integrationReady, false);
            assert.equal(externalShiftReadiness.shiftState, 'external_open');
            assert.equal(externalShiftReadiness.readinessCode, 'external_shift_requires_sync');
            assert.equal(externalShiftReadiness.providerShiftId, externalProviderShiftId);
            const storedExternalShiftReadiness = await pool.query(
                `SELECT shift_state, readiness_code, integration_ready, provider_shift_id
                   FROM checkbox_readiness_snapshots
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND fiscal_register_id = $3`,
                [
                    externalShiftReadiness.readinessSnapshot.id,
                    scope.fiscalProfileId,
                    scope.fiscalRegisterId
                ]
            );
            assert.deepEqual(storedExternalShiftReadiness.rows[0], {
                shift_state: 'external_open',
                readiness_code: 'external_shift_requires_sync',
                integration_ready: false,
                provider_shift_id: externalProviderShiftId
            });
            const callsBeforeCachedExternalShift = mock.state.calls.length;
            const cachedExternalShiftReadiness = await probeCheckboxReadiness({
                dbPool: pool,
                user: cashier,
                crmProfileKey: CRM_PROFILE_KEY,
                registerAlias: REGISTER_ALIAS,
                fetchImpl: createOfficialHostMockFetch(mock),
                force: false
            });
            assert.equal(cachedExternalShiftReadiness.cached, true);
            assert.equal(cachedExternalShiftReadiness.shiftState, 'external_open');
            assert.equal(cachedExternalShiftReadiness.readinessCode, 'external_shift_requires_sync');
            assert.equal(mock.state.calls.length, callsBeforeCachedExternalShift);
            assert.equal(
                await countRows(
                    `SELECT COUNT(*)::integer AS count
                       FROM fiscal_shifts
                      WHERE fiscal_profile_id = $1
                        AND fiscal_register_id = $2
                        AND lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING')`,
                    [scope.fiscalProfileId, scope.fiscalRegisterId]
                ),
                0,
                'provider OPENED readiness must never adopt or create a local shift implicitly'
            );

            const externalShiftBlockedOrder = await createOrder({
                user: cashier,
                key: 'external-shift-readiness-block',
                tender: 'cash',
                totalUah: TEST_TICKET_PRICES_UAH.regular_child,
                itemCode: 'regular_child'
            });
            await assert.rejects(
                confirmPaymentOrder({
                    dbPool: pool,
                    user: cashier,
                    orderId: externalShiftBlockedOrder.order.id,
                    idempotencyKey: `confirm-external-shift-readiness-block-${process.pid}`,
                    requireCheckboxIntegrationReady: true,
                    checkboxFetchImpl: createOfficialHostMockFetch(mock),
                    body: { tender: 'cash', confirmedAmountMinor: '10000' }
                }),
                error => error?.code === 'external_shift_requires_sync'
            );
            const externalShiftBlockedLedger = await pool.query(
                `SELECT po.status,
                        po.payment_status,
                        po.fiscal_status,
                        (SELECT COUNT(*)::integer FROM payment_attempts WHERE payment_order_id = po.id) AS attempts,
                        (SELECT COUNT(*)::integer FROM payment_allocations WHERE payment_order_id = po.id) AS allocations,
                        (SELECT COUNT(*)::integer FROM fiscal_operations WHERE payment_order_id = po.id) AS operations,
                        (SELECT COUNT(*)::integer FROM payment_outbox_jobs WHERE payment_order_id = po.id) AS jobs
                   FROM payment_orders po
                  WHERE po.id = $1`,
                [externalShiftBlockedOrder.order.id]
            );
            assert.deepEqual(externalShiftBlockedLedger.rows[0], {
                status: 'draft',
                payment_status: 'unpaid',
                fiscal_status: 'pending',
                attempts: 0,
                allocations: 0,
                operations: 0,
                jobs: 0
            });
            await cancelDraftPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: externalShiftBlockedOrder.order.id,
                idempotencyKey: `cancel-external-shift-readiness-block-${process.pid}`
            });
            assert.equal(
                mock.state.calls.filter(
                    call => call.method === 'POST' && ['/api/v1/shifts', '/api/v1/shifts/close', '/api/v1/receipts/validate', '/api/v1/receipts/sell'].includes(call.path)
                ).length,
                mutationCallsBeforeExternalShiftProbe
            );
        } finally {
            mock.state.shiftOpened = originalProviderShift.shiftOpened;
            mock.state.shiftExists = originalProviderShift.shiftExists;
            mock.state.shiftStatus = originalProviderShift.shiftStatus;
            mock.state.shiftId = originalProviderShift.shiftId;
        }

        const unresolvedShift = await pool.query(
            `INSERT INTO fiscal_shifts (
                 fiscal_profile_id, fiscal_register_id, provider, status,
                 lifecycle_stage, provider_snapshot
             )
             VALUES ($1, $2, 'checkbox', 'failed', 'OPENING', '{}'::jsonb)
             RETURNING id`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        const unresolvedShiftId = Number(unresolvedShift.rows[0].id);
        const unresolvedOpenOperationId = await createShiftOperation(unresolvedShiftId, 'shift_open', 'unknown');
        await pool.query(
            `UPDATE fiscal_operations
                SET external_stage = 'shift_lookup'
              WHERE id = $1`,
            [unresolvedOpenOperationId]
        );
        await pool.query(
            'UPDATE fiscal_shifts SET open_operation_id = $2 WHERE id = $1',
            [unresolvedShiftId, unresolvedOpenOperationId]
        );
        await pool.query(
            `INSERT INTO payment_outbox_jobs (
                 fiscal_profile_id, fiscal_operation_id, job_type, status,
                 idempotency_key, payload, external_stage
             )
             VALUES ($1, $2, 'shift_open', 'dead', $3, '{}'::jsonb, 'shift_lookup')`,
            [
                scope.fiscalProfileId,
                unresolvedOpenOperationId,
                `db-invariant:dead-shift-open:${unresolvedShiftId}:${crypto.randomUUID()}`
            ]
        );

        const blockedReadiness = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: true
        });
        assert.equal(blockedReadiness.integrationReady, false);
        assert.equal(blockedReadiness.shiftState, 'local_stale');
        assert.equal(blockedReadiness.readinessCode, 'local_shift_requires_reconciliation');
        const storedLocalStaleReadiness = await pool.query(
            `SELECT shift_state, readiness_code, integration_ready
               FROM checkbox_readiness_snapshots
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND fiscal_register_id = $3`,
            [
                blockedReadiness.readinessSnapshot.id,
                scope.fiscalProfileId,
                scope.fiscalRegisterId
            ]
        );
        assert.deepEqual(storedLocalStaleReadiness.rows[0], {
            shift_state: 'local_stale',
            readiness_code: 'local_shift_requires_reconciliation',
            integration_ready: false
        });
        const callsBeforeCachedLocalStale = mock.state.calls.length;
        const cachedLocalStaleReadiness = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: false
        });
        assert.equal(cachedLocalStaleReadiness.cached, true);
        assert.equal(cachedLocalStaleReadiness.shiftState, 'local_stale');
        assert.equal(cachedLocalStaleReadiness.readinessCode, 'local_shift_requires_reconciliation');
        assert.equal(mock.state.calls.length, callsBeforeCachedLocalStale);

        const blockedOrder = await createOrder({
            user: cashier,
            key: 'dead-shift-readiness-block',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const mutationCallsBeforeBlockedConfirm = mock.state.calls.filter(
            call => call.method === 'POST' && ['/api/v1/shifts', '/api/v1/shifts/close', '/api/v1/receipts/validate', '/api/v1/receipts/sell'].includes(call.path)
        ).length;
        await assert.rejects(
            confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: blockedOrder.order.id,
                idempotencyKey: `confirm-dead-shift-readiness-block-${process.pid}`,
                requireCheckboxIntegrationReady: true,
                checkboxFetchImpl: createOfficialHostMockFetch(mock),
                body: { tender: 'cash', confirmedAmountMinor: '10000' }
            }),
            error => error?.code === 'local_shift_requires_reconciliation'
        );
        const blockedOrderLedger = await pool.query(
            `SELECT po.status,
                    po.payment_status,
                    po.fiscal_status,
                    (SELECT COUNT(*)::integer FROM payment_attempts WHERE payment_order_id = po.id) AS attempts,
                    (SELECT COUNT(*)::integer FROM payment_allocations WHERE payment_order_id = po.id) AS allocations,
                    (SELECT COUNT(*)::integer FROM fiscal_operations WHERE payment_order_id = po.id) AS operations,
                    (SELECT COUNT(*)::integer FROM payment_outbox_jobs WHERE payment_order_id = po.id) AS jobs
               FROM payment_orders po
              WHERE po.id = $1`,
            [blockedOrder.order.id]
        );
        assert.deepEqual(blockedOrderLedger.rows[0], {
            status: 'draft',
            payment_status: 'unpaid',
            fiscal_status: 'pending',
            attempts: 0,
            allocations: 0,
            operations: 0,
            jobs: 0
        });
        assert.equal(
            mock.state.calls.filter(
                call => call.method === 'POST' && ['/api/v1/shifts', '/api/v1/shifts/close', '/api/v1/receipts/validate', '/api/v1/receipts/sell'].includes(call.path)
            ).length,
            mutationCallsBeforeBlockedConfirm
        );

        const transaction = await pool.connect();
        try {
            await transaction.query('BEGIN');
            await assert.rejects(
                ensureOpenShiftForSale(transaction, {
                    order: {
                        fiscal_profile_id: scope.fiscalProfileId,
                        fiscal_location_id: scope.fiscalLocationId,
                        fiscal_register_id: scope.fiscalRegisterId
                    },
                    user: cashier
                }),
                error => error?.code === 'shift_open_recovery_required'
            );
            await transaction.query('ROLLBACK');
        } catch (error) {
            await transaction.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            transaction.release();
        }
        await pool.query(
            `UPDATE payment_outbox_jobs
                SET status = 'queued',
                    next_run_at = NOW()
              WHERE fiscal_operation_id = $1
                AND job_type = 'shift_open'`,
            [unresolvedOpenOperationId]
        );
        const recoveryTransaction = await pool.connect();
        try {
            await recoveryTransaction.query('BEGIN');
            const recovered = await ensureOpenShiftForSale(recoveryTransaction, {
                order: {
                    fiscal_profile_id: scope.fiscalProfileId,
                    fiscal_location_id: scope.fiscalLocationId,
                    fiscal_register_id: scope.fiscalRegisterId
                },
                user: cashier
            });
            assert.equal(Number(recovered.id), unresolvedShiftId);
            await recoveryTransaction.query('COMMIT');
        } catch (error) {
            await recoveryTransaction.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            recoveryTransaction.release();
        }
        await assert.rejects(
            pool.query(
                `INSERT INTO fiscal_shifts (
                     fiscal_profile_id, fiscal_register_id, provider, status,
                     lifecycle_stage, provider_snapshot
                 )
                 VALUES ($1, $2, 'checkbox', 'opening', 'CREATED', '{}'::jsonb)`,
                [scope.fiscalProfileId, scope.fiscalRegisterId]
            ),
            error => error?.code === '23505'
        );
        const durableOpen = await pool.query(
            `SELECT COUNT(*)::integer AS shift_count,
                    COUNT(DISTINCT operation.provider_operation_id)::integer AS provider_uuid_count
               FROM fiscal_shifts shift
               JOIN fiscal_operations operation
                 ON operation.id = shift.open_operation_id
                AND operation.fiscal_shift_id = shift.id
              WHERE shift.fiscal_profile_id = $1
                AND shift.fiscal_register_id = $2
                AND shift.lifecycle_stage IN ('CREATED', 'OPENING')`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        assert.deepEqual(durableOpen.rows[0], { shift_count: 1, provider_uuid_count: 1 });
        await pool.query(
            `UPDATE payment_outbox_jobs
                SET status = 'dead'
              WHERE fiscal_operation_id = $1
                AND job_type = 'shift_open'`,
            [unresolvedOpenOperationId]
        );
        await pool.query(
            `UPDATE fiscal_shifts
                SET status = 'closed',
                    lifecycle_stage = 'CLOSED',
                    provider_shift_id = $2,
                    closed_at = NOW()
               WHERE id = $1`,
            [unresolvedShiftId, `db-invariant-recovered-shift-${crypto.randomUUID()}`]
        );

        const primaryShiftId = await createClosedShift('primary');
        await assert.rejects(
            pool.query(
                `INSERT INTO fiscal_shifts (
                     fiscal_profile_id, fiscal_register_id, provider, status,
                     lifecycle_stage, provider_snapshot
                 )
                 VALUES ($1, $2, 'checkbox', 'failed', 'CLOSED', '{}'::jsonb)`,
                [scope.fiscalProfileId, scope.fiscalRegisterId]
            ),
            error => error?.code === '23514'
        );
        await assert.rejects(
            pool.query("UPDATE fiscal_shifts SET status = 'failed' WHERE id = $1", [primaryShiftId]),
            error => error?.code === '23514'
        );
        const openOperationId = await createShiftOperation(primaryShiftId, 'shift_open');
        const closeOperationId = await createShiftOperation(primaryShiftId, 'shift_close');
        await pool.query(
            `UPDATE fiscal_shifts
                SET open_operation_id = $2,
                    close_operation_id = $3
              WHERE id = $1`,
            [primaryShiftId, openOperationId, closeOperationId]
        );

        await assert.rejects(
            createShiftOperation(primaryShiftId, 'shift_open'),
            error => error?.code === '23505'
        );
        await assert.rejects(
            createShiftOperation(primaryShiftId, 'shift_close'),
            error => error?.code === '23505'
        );
        await assert.rejects(
            pool.query('UPDATE fiscal_shifts SET open_operation_id = NULL WHERE id = $1', [primaryShiftId]),
            error => error?.code === '55000'
        );
        await assert.rejects(
            pool.query(
                'UPDATE fiscal_shifts SET fiscal_register_id = $2 WHERE id = $1',
                [primaryShiftId, scope.fiscalRegisterId + 1000000]
            ),
            error => error?.code === '55000'
        );

        const foreignShiftId = await createClosedShift('foreign-operation');
        const foreignCloseOperationId = await createShiftOperation(foreignShiftId, 'shift_close');
        const unlinkedShiftId = await createClosedShift('unlinked');
        await assert.rejects(
            pool.query('UPDATE fiscal_shifts SET close_operation_id = $2 WHERE id = $1', [unlinkedShiftId, foreignCloseOperationId]),
            error => error?.code === '23514'
        );
        await assert.rejects(
            pool.query(
                `INSERT INTO fiscal_shifts (
                     fiscal_profile_id, fiscal_register_id, provider, provider_shift_id,
                     status, lifecycle_stage, opened_at, closed_at, close_operation_id
                 )
                 VALUES ($1, $2, 'checkbox', $3, 'closed', 'CLOSED', NOW(), NOW(), $4)`,
                [
                    scope.fiscalProfileId,
                    scope.fiscalRegisterId,
                    `db-invariant-insert-foreign-close-${crypto.randomUUID()}`,
                    foreignCloseOperationId
                ]
            ),
            error => error?.code === '23514'
        );
        await assert.rejects(
            pool.query(
                `INSERT INTO fiscal_shifts (
                     fiscal_profile_id, fiscal_register_id, provider, provider_shift_id,
                     status, lifecycle_stage, opened_at, closed_at, open_operation_id
                 )
                 VALUES ($1, $2, 'checkbox', $3, 'closed', 'CLOSED', NOW(), NOW(), $4)`,
                [
                    scope.fiscalProfileId,
                    scope.fiscalRegisterId,
                    `db-invariant-insert-wrong-type-${crypto.randomUUID()}`,
                    foreignCloseOperationId
                ]
            ),
            error => error?.code === '23514'
        );
        await assert.rejects(
            pool.query(
                `INSERT INTO fiscal_operations (
                     fiscal_profile_id, fiscal_register_id, fiscal_shift_id,
                     operation_type, status, idempotency_key, provider, currency
                 )
                 VALUES ($1, $2, NULL, 'shift_close', 'pending', $3, 'checkbox', 'UAH')`,
                [scope.fiscalProfileId, scope.fiscalRegisterId, `db-invariant:null-shift:${crypto.randomUUID()}`]
            ),
            error => error?.code === '23514'
        );

        const driftShiftId = await createClosedShift('cancelled-drift');
        const driftOperation = await pool.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, fiscal_shift_id,
                 operation_type, status, idempotency_key, provider, currency, request_snapshot
             )
             VALUES ($1, $2, $3, 'shift_close', 'cancelled', $4, 'checkbox', 'UAH', '{}'::jsonb)
             RETURNING id`,
            [
                scope.fiscalProfileId,
                scope.fiscalRegisterId,
                driftShiftId,
                `db-invariant:cancelled-drift:${crypto.randomUUID()}`
            ]
        );
        await assert.rejects(
            pool.query(
                `UPDATE fiscal_operations
                    SET operation_type = 'status_lookup',
                        fiscal_shift_id = NULL
                  WHERE id = $1`,
                [driftOperation.rows[0].id]
            ),
            error => error?.code === '55000'
        );
        await assert.rejects(
            createShiftOperation(driftShiftId, 'shift_close'),
            error => error?.code === '23505'
        );

        // Resolve the intentionally dead recovery fixture before later tests exercise
        // register-wide close blockers. The production invariant is intentionally
        // register-scoped, so leaving this synthetic incident unresolved would
        // correctly block every subsequent shift close in this shared test database.
        await pool.query(
            `UPDATE payment_outbox_jobs
                SET status = 'succeeded',
                    locked_at = NULL,
                    locked_by = NULL,
                    lock_token = NULL,
                    heartbeat_at = NULL,
                    updated_at = NOW()
              WHERE fiscal_operation_id = $1
                AND job_type = 'shift_open'`,
            [unresolvedOpenOperationId]
        );
        await pool.query(
            `UPDATE fiscal_operations
                SET status = 'cancelled',
                    completed_at = COALESCE(completed_at, NOW())
              WHERE id = $1`,
            [unresolvedOpenOperationId]
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

    test('explicit card permission denial blocks confirmation before payment or fiscal mutation', async () => {
        const order = await createOrder({
            user: cashier,
            key: 'card-permission-denied',
            tender: 'card_terminal_manual',
            totalUah: TEST_TICKET_PRICES_UAH.adult_companion,
            itemCode: 'adult_companion'
        });
        const originalPermissions = { ...mock.state.permissions };
        mock.state.permissions = { ...originalPermissions, card_payment: false };
        try {
            await assert.rejects(
                confirmPaymentOrder({
                    dbPool: pool,
                    user: cashier,
                    orderId: order.order.id,
                    idempotencyKey: `confirm-card-permission-denied-${process.pid}`,
                    requireCheckboxIntegrationReady: true,
                    checkboxFetchImpl: createOfficialHostMockFetch(mock),
                    body: {
                        tender: 'card_terminal_manual',
                        confirmedAmountMinor: '1000',
                        terminalShowedSuccess: true,
                        terminalReference: 'permission-denied-test'
                    }
                }),
                error => error?.code === 'checkbox_cashier_permissions_missing'
            );
        } finally {
            mock.state.permissions = originalPermissions;
        }
        const state = await pool.query(
            `SELECT po.status,
                    po.payment_status,
                    po.fiscal_status,
                    (SELECT COUNT(*)::integer FROM payment_attempts pa WHERE pa.payment_order_id = po.id) AS attempt_count,
                    (SELECT COUNT(*)::integer FROM payment_allocations allocation WHERE allocation.payment_order_id = po.id) AS allocation_count,
                    (SELECT COUNT(*)::integer FROM fiscal_operations operation WHERE operation.payment_order_id = po.id) AS operation_count,
                    (SELECT COUNT(*)::integer FROM payment_outbox_jobs job WHERE job.payment_order_id = po.id) AS job_count
               FROM payment_orders po
              WHERE po.id = $1`,
            [order.order.id]
        );
        assert.deepEqual(state.rows[0], {
            status: 'draft',
            payment_status: 'unpaid',
            fiscal_status: 'pending',
            attempt_count: 0,
            allocation_count: 0,
            operation_count: 0,
            job_count: 0
        });
    });

    test('unexpected provider shift status blocks confirmation without payment or fiscal ledger writes', async () => {
        const order = await createOrder({
            user: cashier,
            key: 'unexpected-provider-shift-status',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const originalShift = {
            shiftOpened: mock.state.shiftOpened,
            shiftExists: mock.state.shiftExists,
            shiftStatus: mock.state.shiftStatus,
            shiftId: mock.state.shiftId
        };
        mock.state.shiftOpened = true;
        mock.state.shiftExists = true;
        mock.state.shiftStatus = 'ERROR';
        mock.state.shiftId = `mock-unexpected-shift-${process.pid}`;
        try {
            await assert.rejects(
                confirmPaymentOrder({
                    dbPool: pool,
                    user: cashier,
                    orderId: order.order.id,
                    idempotencyKey: `confirm-unexpected-provider-shift-status-${process.pid}`,
                    requireCheckboxIntegrationReady: true,
                    checkboxFetchImpl: createOfficialHostMockFetch(mock),
                    body: { tender: 'cash', confirmedAmountMinor: '10000' }
                }),
                error => error?.code === 'checkbox_shift_status_unknown'
            );
        } finally {
            mock.state.shiftOpened = originalShift.shiftOpened;
            mock.state.shiftExists = originalShift.shiftExists;
            mock.state.shiftStatus = originalShift.shiftStatus;
            mock.state.shiftId = originalShift.shiftId;
        }
        const state = await pool.query(
            `SELECT po.status,
                    po.payment_status,
                    po.fiscal_status,
                    (SELECT COUNT(*)::integer FROM payment_attempts pa WHERE pa.payment_order_id = po.id) AS attempt_count,
                    (SELECT COUNT(*)::integer FROM payment_allocations allocation WHERE allocation.payment_order_id = po.id) AS allocation_count,
                    (SELECT COUNT(*)::integer FROM fiscal_operations operation WHERE operation.payment_order_id = po.id) AS operation_count,
                    (SELECT COUNT(*)::integer FROM payment_outbox_jobs job WHERE job.payment_order_id = po.id) AS job_count
               FROM payment_orders po
              WHERE po.id = $1`,
            [order.order.id]
        );
        assert.deepEqual(state.rows[0], {
            status: 'draft',
            payment_status: 'unpaid',
            fiscal_status: 'pending',
            attempt_count: 0,
            allocation_count: 0,
            operation_count: 0,
            job_count: 0
        });
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

        const retryState = await pool.query(
            `SELECT job.status,
                    job.attempts,
                    job.max_attempts,
                    job.next_run_at <= NOW() AS due,
                    operation.provider,
                    operation.fiscal_register_id,
                    register.status AS register_status,
                    register.feature_enabled
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
               JOIN fiscal_registers register
                 ON register.id = operation.fiscal_register_id
                AND register.fiscal_profile_id = operation.fiscal_profile_id
              WHERE job.id = $1`,
            [shift.job_id]
        );
        assert.equal(retryState.rows[0].status, 'failed');
        assert.equal(retryState.rows[0].due, true);
        assert.ok(Number(retryState.rows[0].attempts) < Number(retryState.rows[0].max_attempts));
        assert.equal(retryState.rows[0].provider, 'checkbox');
        assert.equal(Number(retryState.rows[0].fiscal_register_id), scope.fiscalRegisterId);
        assert.equal(retryState.rows[0].register_status, 'active');
        assert.equal(retryState.rows[0].feature_enabled, true);

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
        const unresolvedCloseOrder = await createOrder({
            user: cashier,
            key: 'phase1-close-blocker',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        await confirmOrder({
            user: cashier,
            order: unresolvedCloseOrder,
            key: 'phase1-close-blocker',
            tender: 'cash',
            amountMinor: '10000',
            receivedAmountMinor: '10000'
        });
        const previousAcceptance = process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED;
        process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'false';
        try {
            const closeMutationCounts = async () => {
                const result = await pool.query(
                    `SELECT
                         COUNT(DISTINCT fo.id) FILTER (WHERE fo.operation_type = 'shift_close')::integer AS operation_count,
                         COUNT(DISTINCT job.id) FILTER (WHERE fo.operation_type = 'shift_close')::integer AS job_count
                       FROM fiscal_operations fo
                       LEFT JOIN payment_outbox_jobs job
                         ON job.fiscal_operation_id = fo.id
                        AND job.fiscal_profile_id = fo.fiscal_profile_id
                      WHERE fo.fiscal_shift_id = $1`,
                    [shift.fiscal_shift_id]
                );
                return {
                    operationCount: Number(result.rows[0].operation_count || 0),
                    jobCount: Number(result.rows[0].job_count || 0),
                    providerClosePosts: mock.state.calls.filter(call => call.path === '/api/v1/shifts/close' && call.method === 'POST').length
                };
            };
            const beforeUnsafeClose = await closeMutationCounts();
            const callsBeforeBlockedClose = mock.state.calls.length;
            await assert.rejects(
                requestPhase1ShiftClose({
                    dbPool: pool,
                    user: cashier,
                    shiftId: shift.fiscal_shift_id,
                    idempotencyKey: `phase1-close-unresolved-${process.pid}`,
                    fetchImpl: createOfficialHostMockFetch(mock)
                }),
                error => error?.code === 'shift_close_blocked_unresolved'
            );
            assert.equal(
                mock.state.calls.length,
                callsBeforeBlockedClose,
                'Known unresolved blockers must fail before any provider readiness HTTP'
            );
            assert.deepEqual(
                await closeMutationCounts(),
                beforeUnsafeClose,
                'Confirmed unresolved order must create no shift-close operation, job, or provider close POST'
            );
            await runWorkerUntilIdle(createHttpProvider(mock));
            const resolvedBlocker = await pool.query('SELECT fiscal_status FROM payment_orders WHERE id = $1', [unresolvedCloseOrder.order.id]);
            assert.equal(resolvedBlocker.rows[0].fiscal_status, 'fiscalized');

            const originalReceipt = await pool.query(
                `SELECT id, total_amount_minor
                   FROM fiscal_receipts
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id = $2
                    AND receipt_type = 'sale'
                    AND status = 'fiscalized'
                  LIMIT 1`,
                [scope.fiscalProfileId, unresolvedCloseOrder.order.id]
            );
            assert.equal(originalReceipt.rowCount, 1);
            const serviceOperation = await pool.query(
                `INSERT INTO fiscal_operations (
                     fiscal_profile_id, fiscal_register_id, fiscal_shift_id,
                     operation_type, status, idempotency_key, provider,
                     provider_operation_id, amount_minor, currency, request_snapshot
                 )
                 VALUES ($1, $2, $3, 'service_in', 'pending', $4, 'checkbox', $5, 100, 'UAH', '{}'::jsonb)
                 RETURNING id`,
                [
                    scope.fiscalProfileId,
                    scope.fiscalRegisterId,
                    shift.fiscal_shift_id,
                    `phase1-close-service-blocker:${crypto.randomUUID()}`,
                    `phase1-close-service-provider-${crypto.randomUUID()}`
                ]
            );
            const deadServiceJob = await pool.query(
                `INSERT INTO payment_outbox_jobs (
                     fiscal_profile_id, fiscal_operation_id, job_type, status,
                     idempotency_key, attempts, max_attempts, payload
                 )
                 VALUES ($1, $2, 'service_receipt', 'dead', $3, 10, 10, '{}'::jsonb)
                 RETURNING id`,
                [
                    scope.fiscalProfileId,
                    serviceOperation.rows[0].id,
                    `phase1-close-service-job:${crypto.randomUUID()}`
                ]
            );
            const operationlessOrderJob = await pool.query(
                `INSERT INTO payment_outbox_jobs (
                     fiscal_profile_id, fiscal_operation_id, payment_order_id, job_type,
                     status, idempotency_key, attempts, max_attempts, payload
                 )
                 VALUES ($1, NULL, $2, 'receipt_status_lookup', 'dead', $3, 10, 10, '{}'::jsonb)
                 RETURNING id`,
                [
                    scope.fiscalProfileId,
                    unresolvedCloseOrder.order.id,
                    `phase1-close-operationless-job:${crypto.randomUUID()}`
                ]
            );
            const statusLookupOperation = await pool.query(
                `INSERT INTO fiscal_operations (
                     fiscal_profile_id, fiscal_register_id, fiscal_shift_id,
                     operation_type, status, idempotency_key, provider, currency, request_snapshot
                 )
                 VALUES ($1, $2, $3, 'status_lookup', 'unknown', $4, 'checkbox', 'UAH', '{}'::jsonb)
                 RETURNING id`,
                [
                    scope.fiscalProfileId,
                    scope.fiscalRegisterId,
                    shift.fiscal_shift_id,
                    `phase1-close-status-blocker:${crypto.randomUUID()}`
                ]
            );
            const pendingRefund = await pool.query(
                `INSERT INTO payment_refunds (
                     fiscal_profile_id, payment_order_id, original_fiscal_receipt_id,
                     idempotency_key, status, refund_method, amount_minor, currency,
                     reason, requested_by_user_id, fiscal_register_id, fiscal_shift_id,
                     refund_type, money_refund_status, fiscal_refund_status
                 )
                 VALUES ($1, $2, $3, $4, 'requested', 'cash', $5, 'UAH',
                         'Phase-1 close blocker test', $6, $7, $8, 'full', 'not_started', 'not_started')
                 RETURNING id`,
                [
                    scope.fiscalProfileId,
                    unresolvedCloseOrder.order.id,
                    originalReceipt.rows[0].id,
                    `phase1-close-refund-blocker:${crypto.randomUUID()}`,
                    originalReceipt.rows[0].total_amount_minor,
                    cashier.id,
                    scope.fiscalRegisterId,
                    shift.fiscal_shift_id
                ]
            );
            const callsBeforeNonSaleBlocker = mock.state.calls.length;
            const blockedAuditBefore = await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_audit_events
                  WHERE fiscal_profile_id = $1
                    AND entity_table = 'fiscal_shifts'
                    AND entity_id = $2
                    AND event_type = 'phase1_shift_close_blocked'`,
                [scope.fiscalProfileId, shift.fiscal_shift_id]
            );
            const blockedOutboxBefore = await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM outbox_events
                  WHERE aggregate_type = 'fiscal_shift'
                    AND aggregate_id = $1
                    AND event_type = 'shift.close_blocked'`,
                [String(shift.fiscal_shift_id)]
            );
            await assert.rejects(
                requestPhase1ShiftClose({
                    dbPool: pool,
                    user: cashier,
                    shiftId: shift.fiscal_shift_id,
                    idempotencyKey: `phase1-close-non-sale-blockers-${process.pid}`,
                    fetchImpl: createOfficialHostMockFetch(mock)
                }),
                error => error?.code === 'shift_close_blocked_unresolved'
            );
            assert.equal(
                mock.state.calls.length,
                callsBeforeNonSaleBlocker,
                'Pending service/refund/status and dead jobs must block before provider HTTP'
            );
            assert.equal(
                await countRows(
                    `SELECT COUNT(*)::integer AS count
                       FROM fiscal_audit_events
                      WHERE fiscal_profile_id = $1
                        AND entity_table = 'fiscal_shifts'
                        AND entity_id = $2
                        AND event_type = 'phase1_shift_close_blocked'`,
                    [scope.fiscalProfileId, shift.fiscal_shift_id]
                ),
                blockedAuditBefore + 1,
                'Blocked Phase-1 close must commit an append-only audit observation'
            );
            assert.equal(
                await countRows(
                    `SELECT COUNT(*)::integer AS count
                       FROM outbox_events
                      WHERE aggregate_type = 'fiscal_shift'
                        AND aggregate_id = $1
                        AND event_type = 'shift.close_blocked'`,
                    [String(shift.fiscal_shift_id)]
                ),
                blockedOutboxBefore + 1,
                'Blocked Phase-1 close must commit a structured outbox event'
            );
            await pool.query(
                `UPDATE fiscal_operations
                    SET status = 'fiscalized', completed_at = NOW()
                  WHERE id = ANY($1::bigint[])`,
                [[serviceOperation.rows[0].id, statusLookupOperation.rows[0].id]]
            );
            await pool.query(
                `UPDATE payment_outbox_jobs
                    SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = NOW()
                  WHERE id = ANY($1::bigint[])`,
                [[deadServiceJob.rows[0].id, operationlessOrderJob.rows[0].id]]
            );
            await pool.query(
                `UPDATE payment_refunds
                    SET status = 'cancelled',
                        money_refund_status = 'not_started',
                        fiscal_refund_status = 'not_started'
                  WHERE id = $1`,
                [pendingRefund.rows[0].id]
            );

            const expectedCashierId = mock.state.cashierId;
            mock.state.cashierId = 'wrong-close-cashier';
            try {
                await assert.rejects(
                    requestPhase1ShiftClose({
                        dbPool: pool,
                        user: cashier,
                        shiftId: shift.fiscal_shift_id,
                        idempotencyKey: `phase1-close-wrong-identity-${process.pid}`,
                        fetchImpl: createOfficialHostMockFetch(mock)
                    }),
                    error => error?.code === 'checkbox_cashier_identity_mismatch'
                );
            } finally {
                mock.state.cashierId = expectedCashierId;
            }
            assert.deepEqual(
                await closeMutationCounts(),
                beforeUnsafeClose,
                'Provider identity mismatch must create no shift-close operation, job, or close POST'
            );

            mock.state.unavailablePaths.add('/api/v1/cash-registers/info');
            try {
                await assert.rejects(
                    requestPhase1ShiftClose({
                        dbPool: pool,
                        user: cashier,
                        shiftId: shift.fiscal_shift_id,
                        idempotencyKey: `phase1-close-provider-unavailable-${process.pid}`,
                        fetchImpl: createOfficialHostMockFetch(mock)
                    }),
                    error => error?.code === 'provider_unavailable'
                );
            } finally {
                mock.state.unavailablePaths.delete('/api/v1/cash-registers/info');
            }
            assert.deepEqual(
                await closeMutationCounts(),
                beforeUnsafeClose,
                'Provider unavailable readiness must create no shift-close operation, job, or close POST'
            );

            const callsBeforeDeniedClose = mock.state.calls.length;
            await assert.rejects(
                requestPhase1ShiftClose({
                    dbPool: pool,
                    user: { ...cashier, id: 999999 },
                    shiftId: shift.fiscal_shift_id,
                    idempotencyKey: `phase1-close-denied-${process.pid}`,
                    fetchImpl: createOfficialHostMockFetch(mock)
                }),
                error => error?.code === 'phase1_close_owner_denied'
            );
            assert.equal(
                mock.state.calls.length,
                callsBeforeDeniedClose,
                'Unauthorized exact-shift close must not perform provider HTTP'
            );
            const callsBeforeWrongOwner = mock.state.calls.length;
            await assert.rejects(
                requestPhase1ShiftClose({
                    dbPool: pool,
                    user: secondCashier,
                    shiftId: shift.fiscal_shift_id,
                    idempotencyKey: `phase1-close-wrong-owner-${process.pid}`,
                    fetchImpl: createOfficialHostMockFetch(mock)
                }),
                error => error?.code === 'phase1_close_owner_denied'
            );
            assert.equal(mock.state.calls.length, callsBeforeWrongOwner, 'Non-owner close must fail before provider HTTP');
            const closeRequest = await requestPhase1ShiftClose({
                dbPool: pool,
                user: cashier,
                shiftId: shift.fiscal_shift_id,
                idempotencyKey: `phase1-close-recovery-${process.pid}`,
                fetchImpl: createOfficialHostMockFetch(mock)
            });
            assert.equal(closeRequest.replayed, false);
            assert.equal(
                await countRows(
                    `SELECT COUNT(*)::integer AS count
                       FROM fiscal_audit_events
                      WHERE fiscal_profile_id = $1
                        AND entity_table = 'fiscal_operations'
                        AND entity_id = $2
                        AND event_type = 'phase1_shift_close_requested'`,
                    [scope.fiscalProfileId, closeRequest.fiscalOperationId]
                ),
                1,
                'Phase-1 close request must have one explicit append-only operator audit event'
            );
            const callsBeforeReplay = mock.state.calls.length;
            const closeReplay = await requestPhase1ShiftClose({
                dbPool: pool,
                user: cashier,
                shiftId: shift.fiscal_shift_id,
                idempotencyKey: `phase1-close-recovery-${process.pid}`,
                fetchImpl: createOfficialHostMockFetch(mock)
            });
            assert.equal(closeReplay.replayed, true);
            assert.equal(closeReplay.fiscalOperationId, closeRequest.fiscalOperationId);
            assert.equal(closeReplay.outboxJobId, closeRequest.outboxJobId);
            assert.equal(closeReplay.providerRequestUuid, closeRequest.providerRequestUuid);
            assert.equal(mock.state.calls.length, callsBeforeReplay, 'Idempotent close replay must not perform provider readiness HTTP');
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
        const previousFetch = globalThis.fetch;
        let cashWorkerBatches;
        try {
            // Exercise the production-shaped default provider factory while routing its
            // allowlisted official-host requests into the loopback HTTP Checkbox server.
            globalThis.fetch = createOfficialHostMockFetch(mock);
            cashWorkerBatches = await runWorkerUntilIdle();
        } finally {
            globalThis.fetch = previousFetch;
        }
        const shiftOpenCallsAfterCash = mock.state.calls.filter(call => call.path === '/api/v1/shifts').length;
        const queueDiagnostics = await pool.query(
            `SELECT job.id,
                    job.job_type,
                    job.status AS job_status,
                    job.attempts,
                    job.max_attempts,
                    job.next_run_at <= NOW() AS due,
                    shift.status AS shift_status,
                    shift.lifecycle_stage,
                    register.status AS register_status,
                    register.feature_enabled
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
               LEFT JOIN fiscal_shifts shift
                 ON shift.id = operation.fiscal_shift_id
                AND shift.fiscal_profile_id = operation.fiscal_profile_id
               JOIN fiscal_registers register
                 ON register.id = operation.fiscal_register_id
                AND register.fiscal_profile_id = operation.fiscal_profile_id
              WHERE job.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND job.status <> 'succeeded'
              ORDER BY job.id`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
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
                queue: queueDiagnostics.rows,
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

    test('Phase-1 close requires payment drain and serializes against a concurrent confirmation', async () => {
        const openShiftResult = await pool.query(
            `SELECT id, fiscal_profile_id, fiscal_register_id
               FROM fiscal_shifts
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND status = 'open'
                AND lifecycle_stage = 'OPENED'
              ORDER BY id DESC
              LIMIT 1`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        assert.equal(openShiftResult.rowCount, 1, 'test requires the provider-confirmed OPENED shift from the preceding sale flow');
        const openShift = openShiftResult.rows[0];

        const closeMutationCounts = async () => {
            const result = await pool.query(
                `SELECT
                     COUNT(DISTINCT operation.id) FILTER (WHERE operation.operation_type = 'shift_close')::integer AS operation_count,
                     COUNT(DISTINCT job.id) FILTER (WHERE operation.operation_type = 'shift_close')::integer AS job_count
                   FROM fiscal_operations operation
                   LEFT JOIN payment_outbox_jobs job
                     ON job.fiscal_operation_id = operation.id
                    AND job.fiscal_profile_id = operation.fiscal_profile_id
                  WHERE operation.fiscal_shift_id = $1`,
                [openShift.id]
            );
            return {
                operationCount: Number(result.rows[0].operation_count || 0),
                jobCount: Number(result.rows[0].job_count || 0),
                providerClosePosts: mock.state.calls.filter(
                    call => call.method === 'POST' && call.path === '/api/v1/shifts/close'
                ).length
            };
        };

        const mutationsBeforeAcceptanceGate = await closeMutationCounts();
        const callsBeforeAcceptanceGate = mock.state.calls.length;
        await assert.rejects(
            requestPhase1ShiftClose({
                dbPool: pool,
                user: cashier,
                shiftId: openShift.id,
                idempotencyKey: `phase1-close-acceptance-enabled-${process.pid}`,
                env: { ...process.env, CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true' },
                fetchImpl: createOfficialHostMockFetch(mock)
            }),
            error => error?.code === 'phase1_close_requires_payment_drain'
        );
        assert.equal(
            mock.state.calls.length,
            callsBeforeAcceptanceGate,
            'acceptance-enabled close must fail before provider readiness or close HTTP'
        );
        assert.deepEqual(
            await closeMutationCounts(),
            mutationsBeforeAcceptanceGate,
            'acceptance-enabled close must not create a close operation or outbox job'
        );

        const raceOrder = await createOrder({
            user: cashier,
            key: 'phase1-close-confirm-race',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });

        const deferred = () => {
            let resolvePromise;
            let resolved = false;
            const promise = new Promise(resolve => {
                resolvePromise = resolve;
            });
            return {
                promise,
                resolve() {
                    if (resolved) return;
                    resolved = true;
                    resolvePromise();
                }
            };
        };
        const withTimeout = async (promise, message, timeoutMs = 3000) => {
            let timeout;
            try {
                return await Promise.race([
                    promise,
                    new Promise((resolve, reject) => {
                        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
                    })
                ]);
            } finally {
                clearTimeout(timeout);
            }
        };
        const confirmLockAcquired = deferred();
        const releaseConfirm = deferred();
        let interceptedRegisterLock = false;
        const lockingPool = {
            connect: async () => {
                const pgClient = await pool.connect();
                return {
                    query: async (sql, params = []) => {
                        const result = await pgClient.query(sql, params);
                        const compactSql = typeof sql === 'string' ? sql.replace(/\s+/g, ' ').trim() : '';
                        if (!interceptedRegisterLock
                            && compactSql === 'SELECT pg_advisory_xact_lock($1, $2)'
                            && Number(params[0]) === Number(openShift.fiscal_profile_id)
                            && Number(params[1]) === Number(openShift.fiscal_register_id)) {
                            interceptedRegisterLock = true;
                            confirmLockAcquired.resolve();
                            await releaseConfirm.promise;
                        }
                        return result;
                    },
                    release: () => pgClient.release()
                };
            }
        };

        let confirmPromise;
        let closeOutcomePromise;
        try {
            confirmPromise = confirmPaymentOrder({
                dbPool: lockingPool,
                user: cashier,
                orderId: raceOrder.order.id,
                idempotencyKey: `confirm-phase1-close-race-${process.pid}`,
                requireCheckboxIntegrationReady: true,
                env: { ...process.env, CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true' },
                checkboxFetchImpl: createOfficialHostMockFetch(mock),
                body: {
                    tender: 'cash',
                    confirmedAmountMinor: '10000',
                    receivedAmountMinor: '10000'
                }
            });
            await withTimeout(
                confirmLockAcquired.promise,
                'confirmation did not acquire the profile/register advisory lock'
            );

            closeOutcomePromise = requestPhase1ShiftClose({
                dbPool: pool,
                user: cashier,
                shiftId: openShift.id,
                idempotencyKey: `phase1-close-concurrent-confirm-${process.pid}`,
                env: { ...process.env, CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'false' },
                fetchImpl: createOfficialHostMockFetch(mock)
            }).then(
                value => ({ status: 'fulfilled', value }),
                error => ({ status: 'rejected', error })
            );

            const advisoryDeadline = Date.now() + 3000;
            let advisoryWait = null;
            while (Date.now() < advisoryDeadline) {
                const locks = await pool.query(
                    `SELECT
                         COUNT(*) FILTER (WHERE granted)::integer AS granted_count,
                         COUNT(*) FILTER (WHERE NOT granted)::integer AS waiting_count
                       FROM pg_locks
                      WHERE locktype = 'advisory'
                        AND classid = $1::oid
                        AND objid = $2::oid`,
                    [openShift.fiscal_profile_id, openShift.fiscal_register_id]
                );
                const observation = {
                    grantedCount: Number(locks.rows[0].granted_count || 0),
                    waitingCount: Number(locks.rows[0].waiting_count || 0)
                };
                if (observation.grantedCount >= 1 && observation.waitingCount >= 1) {
                    advisoryWait = observation;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.ok(advisoryWait, 'Phase-1 close did not wait on the confirmation advisory lock');
            assert.ok(advisoryWait.grantedCount >= 1);
            assert.ok(advisoryWait.waitingCount >= 1);
            assert.deepEqual(
                await closeMutationCounts(),
                mutationsBeforeAcceptanceGate,
                'waiting close must not create a close operation, job, or provider close POST'
            );

            releaseConfirm.resolve();
            const [confirmed, closeOutcome] = await Promise.all([confirmPromise, closeOutcomePromise]);
            assert.ok(confirmed.fiscalOperationId, 'concurrent confirmation commits one unresolved sale operation');
            assert.equal(closeOutcome.status, 'rejected');
            assert.equal(closeOutcome.error?.code, 'shift_close_blocked_unresolved');
            assert.deepEqual(
                await closeMutationCounts(),
                mutationsBeforeAcceptanceGate,
                'close must re-read after lock acquisition and create no close mutation when the new sale is unresolved'
            );
            assert.equal(
                await countRows(
                    `SELECT COUNT(*)::integer AS count
                       FROM fiscal_operations
                      WHERE payment_order_id = $1
                        AND operation_type = 'sale'
                        AND status IN ('pending', 'validating', 'ready_to_send', 'sending', 'failed', 'unknown', 'blocked')`,
                    [raceOrder.order.id]
                ),
                1,
                'the newly committed sale is the authoritative close blocker'
            );
        } finally {
            releaseConfirm.resolve();
            await Promise.allSettled([confirmPromise, closeOutcomePromise].filter(Boolean));
        }

        await runWorkerUntilIdle(createHttpProvider(mock));
        const recoveredOrder = await pool.query(
            'SELECT payment_status, fiscal_status FROM payment_orders WHERE id = $1',
            [raceOrder.order.id]
        );
        assert.deepEqual(recoveredOrder.rows[0], { payment_status: 'confirmed', fiscal_status: 'fiscalized' });
        let remainingPaidQueueBlockers = null;
        for (let drainAttempt = 0; drainAttempt < 50; drainAttempt += 1) {
            remainingPaidQueueBlockers = await countFiscalShiftCloseBlockers(pool, {
                fiscalProfileId: openShift.fiscal_profile_id,
                fiscalRegisterId: openShift.fiscal_register_id
            });
            if (remainingPaidQueueBlockers === 0) break;
            await runWorkerUntilIdle(createHttpProvider(mock));
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        const paidQueueBlockerDiagnostics = remainingPaidQueueBlockers > 0
            ? await pool.query(
                `SELECT operation.id,
                        operation.operation_type,
                        operation.status AS operation_status,
                        operation.external_stage,
                        job.id AS job_id,
                        job.job_type,
                        job.status AS job_status,
                        job.attempts,
                        job.max_attempts,
                        job.next_run_at <= NOW() AS due,
                        ROUND(EXTRACT(EPOCH FROM (job.next_run_at - NOW()))::numeric, 3) AS seconds_until_due,
                        job.last_error_code,
                        job.external_stage AS job_external_stage,
                        payment.id AS payment_order_id,
                        payment.payment_status,
                        payment.fiscal_status
                   FROM fiscal_operations operation
                   LEFT JOIN payment_outbox_jobs job
                     ON job.fiscal_operation_id = operation.id
                    AND job.fiscal_profile_id = operation.fiscal_profile_id
                   LEFT JOIN payment_orders payment
                     ON payment.id = operation.payment_order_id
                    AND payment.fiscal_profile_id = operation.fiscal_profile_id
                  WHERE operation.fiscal_profile_id = $1
                    AND operation.fiscal_register_id = $2
                    AND (
                        operation.status IN ('pending', 'validating', 'ready_to_send', 'sending', 'validation_failed', 'failed', 'unknown', 'blocked')
                        OR job.status IN ('queued', 'claimed', 'running', 'failed', 'dead')
                        OR (payment.payment_status = 'confirmed' AND payment.fiscal_status <> 'fiscalized')
                    )
                  ORDER BY operation.id, job.id`,
                [openShift.fiscal_profile_id, openShift.fiscal_register_id]
            )
            : { rows: [] };
        assert.equal(
            remainingPaidQueueBlockers,
            0,
            `paid queue did not fully drain before the close-first concurrency scenario: ${JSON.stringify(paidQueueBlockerDiagnostics.rows)}`
        );

        const closeFirstOrder = await createOrder({
            user: cashier,
            key: 'phase1-close-first-confirm-race',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const closeMarkedClosing = deferred();
        const releaseClose = deferred();
        let interceptedClosingUpdate = false;
        const closeLockingPool = {
            connect: async () => {
                const pgClient = await pool.connect();
                return {
                    query: async (sql, params = []) => {
                        const result = await pgClient.query(sql, params);
                        const compactSql = typeof sql === 'string' ? sql.replace(/\s+/g, ' ').trim() : '';
                        if (!interceptedClosingUpdate
                            && compactSql.startsWith("UPDATE fiscal_shifts SET status = 'closing'")) {
                            interceptedClosingUpdate = true;
                            closeMarkedClosing.resolve();
                            await releaseClose.promise;
                        }
                        return result;
                    },
                    release: () => pgClient.release()
                };
            }
        };

        let closeFirstPromise;
        let closeFirstResult;
        let confirmAfterClosePromise;
        let confirmAfterCloseResult;
        try {
            closeFirstPromise = requestPhase1ShiftClose({
                dbPool: closeLockingPool,
                user: cashier,
                shiftId: openShift.id,
                idempotencyKey: `phase1-close-first-${process.pid}`,
                env: { ...process.env, CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'false' },
                fetchImpl: createOfficialHostMockFetch(mock)
            }).then(
                value => ({ status: 'fulfilled', value }),
                error => ({ status: 'rejected', error })
            );
            await withTimeout(
                closeMarkedClosing.promise,
                'Phase-1 close did not enter CLOSING while holding the register lock'
            );

            confirmAfterClosePromise = confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: closeFirstOrder.order.id,
                idempotencyKey: `confirm-after-close-first-${process.pid}`,
                requireCheckboxIntegrationReady: true,
                env: { ...process.env, CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true' },
                checkboxFetchImpl: createOfficialHostMockFetch(mock),
                body: {
                    tender: 'cash',
                    confirmedAmountMinor: '10000',
                    receivedAmountMinor: '10000'
                }
            }).then(
                value => ({ status: 'fulfilled', value }),
                error => ({ status: 'rejected', error })
            );

            const confirmAdvisoryDeadline = Date.now() + 3000;
            let confirmAdvisoryWait = null;
            while (Date.now() < confirmAdvisoryDeadline) {
                const locks = await pool.query(
                    `SELECT
                         COUNT(*) FILTER (WHERE granted)::integer AS granted_count,
                         COUNT(*) FILTER (WHERE NOT granted)::integer AS waiting_count
                       FROM pg_locks
                      WHERE locktype = 'advisory'
                        AND classid = $1::oid
                        AND objid = $2::oid`,
                    [openShift.fiscal_profile_id, openShift.fiscal_register_id]
                );
                const observation = {
                    grantedCount: Number(locks.rows[0].granted_count || 0),
                    waitingCount: Number(locks.rows[0].waiting_count || 0)
                };
                if (observation.grantedCount >= 1 && observation.waitingCount >= 1) {
                    confirmAdvisoryWait = observation;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.ok(confirmAdvisoryWait, 'confirmation did not wait for the close-owned register advisory lock');

            const beforeCloseRelease = await pool.query(
                `SELECT
                     (SELECT COUNT(*)::integer FROM payment_attempts WHERE payment_order_id = $1) AS attempts,
                     (SELECT COUNT(*)::integer FROM payment_allocations WHERE payment_order_id = $1) AS allocations,
                     (SELECT COUNT(*)::integer FROM fiscal_operations WHERE payment_order_id = $1) AS operations,
                     (SELECT COUNT(*)::integer FROM payment_outbox_jobs WHERE payment_order_id = $1) AS jobs`,
                [closeFirstOrder.order.id]
            );
            assert.deepEqual(beforeCloseRelease.rows[0], { attempts: 0, allocations: 0, operations: 0, jobs: 0 });

            releaseClose.resolve();
            const [closeFirstOutcome, confirmationOutcome] = await Promise.all([closeFirstPromise, confirmAfterClosePromise]);
            assert.equal(closeFirstOutcome.status, 'fulfilled');
            closeFirstResult = closeFirstOutcome.value;
            confirmAfterCloseResult = confirmationOutcome;
            assert.ok(closeFirstResult.fiscalOperationId, 'close-first flow must create one durable close operation');
            assert.equal(confirmAfterCloseResult.status, 'rejected');
            assert.equal(confirmAfterCloseResult.error?.code, 'external_shift_requires_sync');

            const rejectedConfirmation = await pool.query(
                `SELECT
                     po.status,
                     po.payment_status,
                     po.fiscal_status,
                     (SELECT COUNT(*)::integer FROM payment_attempts WHERE payment_order_id = po.id) AS attempts,
                     (SELECT COUNT(*)::integer FROM payment_allocations WHERE payment_order_id = po.id) AS allocations,
                     (SELECT COUNT(*)::integer FROM fiscal_operations WHERE payment_order_id = po.id) AS operations,
                     (SELECT COUNT(*)::integer FROM payment_outbox_jobs WHERE payment_order_id = po.id) AS jobs
                   FROM payment_orders po
                  WHERE po.id = $1`,
                [closeFirstOrder.order.id]
            );
            assert.deepEqual(rejectedConfirmation.rows[0], {
                status: 'draft',
                payment_status: 'unpaid',
                fiscal_status: 'pending',
                attempts: 0,
                allocations: 0,
                operations: 0,
                jobs: 0
            });
        } finally {
            releaseClose.resolve();
            await Promise.allSettled([closeFirstPromise, confirmAfterClosePromise].filter(Boolean));
        }

        await cancelDraftPaymentOrder({
            dbPool: pool,
            user: cashier,
            orderId: closeFirstOrder.order.id,
            idempotencyKey: `cancel-close-first-draft-${process.pid}`
        });
        const closeDrainBatches = [];
        for (let closeRound = 0; closeRound < 3; closeRound += 1) {
            closeDrainBatches.push(await runWorkerUntilIdle(createHttpProvider(mock)));
            const closeState = await pool.query(
                'SELECT status FROM fiscal_operations WHERE id = $1',
                [closeFirstResult.fiscalOperationId]
            );
            if (closeState.rows[0]?.status === 'fiscalized') break;
            await forceRetryNow(closeFirstResult.fiscalOperationId);
        }
        const closedAfterRace = await pool.query(
            'SELECT status, lifecycle_stage FROM fiscal_shifts WHERE id = $1',
            [openShift.id]
        );
        const closeAfterRaceJob = await pool.query(
            `SELECT status, attempts, max_attempts, external_stage, last_error_code
               FROM payment_outbox_jobs
              WHERE fiscal_operation_id = $1`,
            [closeFirstResult.fiscalOperationId]
        );
        assert.deepEqual(
            closedAfterRace.rows[0],
            { status: 'closed', lifecycle_stage: 'CLOSED' },
            JSON.stringify({ batches: closeDrainBatches, job: closeAfterRaceJob.rows[0] || null, providerShiftStatus: mock.state.shiftStatus })
        );

        const portalSyncOrder = await createOrder({
            user: cashier,
            key: 'phase1-portal-close-sync',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        await confirmOrder({
            user: cashier,
            order: portalSyncOrder,
            key: 'phase1-portal-close-sync',
            tender: 'cash',
            amountMinor: '10000',
            receivedAmountMinor: '10000'
        });
        await runWorkerUntilIdle(createHttpProvider(mock));
        const portalShift = await pool.query(
            `SELECT id, provider_shift_id
               FROM fiscal_shifts
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND status = 'open'
                AND lifecycle_stage = 'OPENED'
              ORDER BY id DESC
              LIMIT 1`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        assert.equal(portalShift.rowCount, 1);
        const portalClose = await requestPhase1ShiftClose({
            dbPool: pool,
            user: cashier,
            shiftId: portalShift.rows[0].id,
            idempotencyKey: `phase1-portal-close-sync-${process.pid}`,
            env: { ...process.env, CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'false' },
            fetchImpl: createOfficialHostMockFetch(mock)
        });
        const deadPortalClose = await pool.query(
            `UPDATE payment_outbox_jobs
                SET status = 'dead',
                    attempts = max_attempts,
                    last_error_code = 'simulated_close_timeout',
                    last_error_message = 'sanitized simulated provider timeout',
                    next_run_at = NOW() + INTERVAL '1 day'
              WHERE id = $1
                AND fiscal_operation_id = $2
              RETURNING max_attempts`,
            [portalClose.outboxJobId, portalClose.fiscalOperationId]
        );
        assert.equal(deadPortalClose.rowCount, 1);
        const originalPortalCloseMaxAttempts = Number(deadPortalClose.rows[0].max_attempts);
        await pool.query(
            `UPDATE fiscal_operations
                SET status = 'failed',
                    last_error_code = 'simulated_close_timeout',
                    last_error_message = 'sanitized simulated provider timeout'
              WHERE id = $1
                AND fiscal_shift_id = $2`,
            [portalClose.fiscalOperationId, portalShift.rows[0].id]
        );
        const closePostsBeforePortalSync = mock.state.calls.filter(
            call => call.method === 'POST' && call.path === '/api/v1/shifts/close'
        ).length;
        mock.state.shiftExists = true;
        mock.state.shiftOpened = false;
        mock.state.shiftStatus = 'CLOSED';
        const portalReadiness = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: true
        });
        assert.equal(
            portalReadiness.shiftState,
            'closed',
            JSON.stringify({
                readinessCode: portalReadiness.readinessCode,
                shiftState: portalReadiness.shiftState,
                providerReady: portalReadiness.providerReady,
                mockShiftOpened: mock.state.shiftOpened,
                mockShiftStatus: mock.state.shiftStatus
            })
        );
        const syncedPortalState = await pool.query(
            `SELECT
                 shift.status,
                 shift.lifecycle_stage,
                 job.status AS job_status,
                 job.attempts AS job_attempts,
                 job.max_attempts AS job_max_attempts,
                 job.payload->>'portal_closed_dead_recovery_used' AS dead_recovery_used,
                 job.external_stage AS job_external_stage,
                 operation.status AS operation_status,
                 operation.external_stage AS operation_external_stage
               FROM fiscal_shifts shift
               JOIN fiscal_operations operation
                 ON operation.id = $2
                AND operation.fiscal_shift_id = shift.id
                AND operation.fiscal_profile_id = shift.fiscal_profile_id
               JOIN payment_outbox_jobs job
                 ON job.id = $3
                AND job.fiscal_operation_id = operation.id
                AND job.fiscal_profile_id = operation.fiscal_profile_id
              WHERE shift.id = $1`,
            [portalShift.rows[0].id, portalClose.fiscalOperationId, portalClose.outboxJobId]
        );
        assert.deepEqual(syncedPortalState.rows[0], {
            status: 'closed',
            lifecycle_stage: 'CLOSED',
            job_status: 'queued',
            job_attempts: originalPortalCloseMaxAttempts,
            job_max_attempts: originalPortalCloseMaxAttempts + 1,
            dead_recovery_used: 'true',
            job_external_stage: 'shift_close_lookup',
            operation_status: 'pending',
            operation_external_stage: 'shift_close_lookup'
        });
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_audit_events
                  WHERE fiscal_profile_id = $1
                    AND entity_table = 'fiscal_shifts'
                    AND entity_id = $2
                    AND event_type = 'fiscal_shift_portal_close_synced'`,
                [scope.fiscalProfileId, portalShift.rows[0].id]
            ),
            1,
            'portal-close synchronization must leave one append-only audit observation'
        );
        const portalFinalize = await processPaymentOutboxJobs({
            dbPool: pool,
            provider: createHttpProvider(mock),
            batchSize: 1,
            lockedBy: `checkbox-portal-close-finalize-${process.pid}`
        });
        assert.equal(portalFinalize.succeeded, 1, JSON.stringify(portalFinalize));
        assert.equal(portalFinalize.results[0].source, 'shift_close_lookup');
        assert.equal(
            mock.state.calls.filter(call => call.method === 'POST' && call.path === '/api/v1/shifts/close').length,
            closePostsBeforePortalSync,
            'a provider-closed local shift must finalize by exact lookup without a second close POST'
        );

        mock.state.shiftExists = false;
        mock.state.shiftOpened = false;
        mock.state.shiftStatus = 'CLOSED';
        const activeRaceOrder = await createOrder({
            user: cashier,
            key: 'phase1-active-close-recovery-race',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        await confirmOrder({
            user: cashier,
            order: activeRaceOrder,
            key: 'phase1-active-close-recovery-race',
            tender: 'cash',
            amountMinor: '10000',
            receivedAmountMinor: '10000'
        });
        await runWorkerUntilIdle(createHttpProvider(mock));
        const activeRaceShift = await pool.query(
            `SELECT id, provider_shift_id
               FROM fiscal_shifts
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND status = 'open'
                AND lifecycle_stage = 'OPENED'
              ORDER BY id DESC
              LIMIT 1`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        assert.equal(activeRaceShift.rowCount, 1);
        const activeRaceBlockerCount = await countFiscalShiftCloseBlockers(pool, {
            fiscalProfileId: scope.fiscalProfileId,
            fiscalRegisterId: scope.fiscalRegisterId
        });
        const activeRaceBlockerDiagnostics = activeRaceBlockerCount > 0
            ? await pool.query(
                `SELECT operation.id,
                        operation.operation_type,
                        operation.status AS operation_status,
                        job.id AS job_id,
                        job.job_type,
                        job.status AS job_status,
                        payment.id AS payment_order_id,
                        payment.payment_status,
                        payment.fiscal_status
                   FROM fiscal_operations operation
                   LEFT JOIN payment_outbox_jobs job
                     ON job.fiscal_operation_id = operation.id
                    AND job.fiscal_profile_id = operation.fiscal_profile_id
                   LEFT JOIN payment_orders payment
                     ON payment.id = operation.payment_order_id
                    AND payment.fiscal_profile_id = operation.fiscal_profile_id
                  WHERE operation.fiscal_profile_id = $1
                    AND operation.fiscal_register_id = $2
                    AND (
                        operation.status IN ('pending', 'validating', 'ready_to_send', 'sending', 'validation_failed', 'failed', 'unknown', 'blocked')
                        OR job.status IN ('queued', 'claimed', 'running', 'failed', 'dead')
                        OR (payment.payment_status = 'confirmed' AND payment.fiscal_status <> 'fiscalized')
                    )
                  ORDER BY operation.id, job.id`,
                [scope.fiscalProfileId, scope.fiscalRegisterId]
            )
            : { rows: [] };
        assert.equal(activeRaceBlockerCount, 0, JSON.stringify(activeRaceBlockerDiagnostics.rows));
        const activeRaceClose = await requestPhase1ShiftClose({
            dbPool: pool,
            user: cashier,
            shiftId: activeRaceShift.rows[0].id,
            idempotencyKey: `phase1-active-close-recovery-race-${process.pid}`,
            env: { ...process.env, CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'false' },
            fetchImpl: createOfficialHostMockFetch(mock)
        });
        const closeMutationEntered = deferred();
        const releaseCloseMutation = deferred();
        const activeRaceProvider = Object.create(createHttpProvider(mock));
        activeRaceProvider.closeShift = async input => {
            await input.beforeExternalMutation?.({ operation: 'shift_close' });
            closeMutationEntered.resolve();
            await releaseCloseMutation.promise;
            throw new Error('sanitized simulated active close timeout');
        };
        const activeRaceWorker = processPaymentOutboxJobs({
            dbPool: pool,
            provider: activeRaceProvider,
            batchSize: 1,
            lockedBy: `checkbox-active-portal-close-race-${process.pid}`
        });
        await withTimeout(closeMutationEntered.promise, 'active close worker did not reach the external mutation boundary');
        mock.state.shiftExists = true;
        mock.state.shiftOpened = false;
        mock.state.shiftStatus = 'CLOSED';
        mock.state.shiftId = activeRaceShift.rows[0].provider_shift_id;
        const activeRaceReadiness = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: true
        });
        assert.equal(activeRaceReadiness.shiftState, 'closed');
        releaseCloseMutation.resolve();
        const activeRaceFailure = await activeRaceWorker;
        assert.equal(activeRaceFailure.failed, 1, JSON.stringify(activeRaceFailure));
        assert.equal(activeRaceFailure.results[0].recoveryQueued, true, JSON.stringify(activeRaceFailure));
        const activeRaceRecovery = await pool.query(
            `SELECT job.status,
                    job.external_stage,
                    job.payload->>'portal_closed_sync_observed' AS sync_observed,
                    job.payload->>'portal_closed_active_recovery_used' AS active_recovery_used,
                    operation.status AS operation_status,
                    operation.external_stage AS operation_external_stage
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE job.id = $1
                AND operation.id = $2`,
            [activeRaceClose.outboxJobId, activeRaceClose.fiscalOperationId]
        );
        assert.deepEqual(activeRaceRecovery.rows[0], {
            status: 'queued',
            external_stage: 'shift_close_lookup',
            sync_observed: 'true',
            active_recovery_used: 'true',
            operation_status: 'pending',
            operation_external_stage: 'shift_close_lookup'
        });
        const activeRaceFinalize = await processPaymentOutboxJobs({
            dbPool: pool,
            provider: createHttpProvider(mock),
            batchSize: 1,
            lockedBy: `checkbox-active-portal-close-finalize-${process.pid}`
        });
        assert.equal(activeRaceFinalize.succeeded, 1, JSON.stringify(activeRaceFinalize));
        assert.equal(activeRaceFinalize.results[0].source, 'shift_close_lookup');
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_audit_events
                  WHERE fiscal_profile_id = $1
                    AND entity_table = 'payment_outbox_jobs'
                    AND entity_id = $2
                    AND event_type = 'payment_outbox_active_portal_close_requeued'`,
                [scope.fiscalProfileId, activeRaceClose.outboxJobId]
            ),
            1
        );

        const missedOpenedShift = await (async () => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const created = await ensureOpenShiftForSale(client, {
                    user: cashier,
                    order: {
                        fiscal_profile_id: scope.fiscalProfileId,
                        fiscal_location_id: scope.fiscalLocationId,
                        fiscal_register_id: scope.fiscalRegisterId,
                        crm_profile_key: CRM_PROFILE_KEY,
                        provider_organization_id: scope.providerOrganizationId,
                        provider_outlet_id: null,
                        provider_register_id: scope.providerRegisterId,
                        provider_license_ref: 'park-middle-smoke-register',
                        register_expected_is_test: true
                    },
                    fiscalConfig: { snapshot: { expected_is_test: true } }
                });
                await client.query('COMMIT');
                return created;
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            } finally {
                client.release();
            }
        })();
        const missedOpenedWorkflow = await pool.query(
            `SELECT operation.id AS operation_id,
                    operation.provider_operation_id,
                    job.id AS job_id
               FROM fiscal_operations operation
               JOIN payment_outbox_jobs job
                 ON job.fiscal_operation_id = operation.id
                AND job.fiscal_profile_id = operation.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND operation.fiscal_shift_id = $3
                AND operation.operation_type = 'shift_open'
                AND job.job_type = 'shift_open'`,
            [scope.fiscalProfileId, scope.fiscalRegisterId, missedOpenedShift.id]
        );
        assert.equal(missedOpenedWorkflow.rowCount, 1);
        const missedOpenedUuid = missedOpenedWorkflow.rows[0].provider_operation_id;
        const deadMissedOpenedJob = await pool.query(
            `UPDATE payment_outbox_jobs
                SET external_stage = 'shift_lookup',
                    payload = payload || '{"external_stage":"shift_lookup"}'::jsonb,
                    status = 'dead',
                    attempts = max_attempts,
                    last_error_code = 'simulated_open_timeout',
                    last_error_message = 'sanitized simulated provider timeout',
                    next_run_at = NOW() + INTERVAL '1 day'
              WHERE id = $1`,
            [missedOpenedWorkflow.rows[0].job_id]
        );
        assert.equal(deadMissedOpenedJob.rowCount, 1);
        await pool.query(
            `UPDATE fiscal_operations
                SET status = 'failed',
                    external_stage = 'shift_lookup',
                    last_error_code = 'simulated_open_timeout',
                    last_error_message = 'sanitized simulated provider timeout'
              WHERE id = $1`,
            [missedOpenedWorkflow.rows[0].operation_id]
        );
        await pool.query(
            `UPDATE fiscal_shifts
                SET status = 'failed',
                    lifecycle_stage = 'OPENING'
              WHERE id = $1`,
            [missedOpenedShift.id]
        );
        mock.state.shiftExists = true;
        mock.state.shiftOpened = false;
        mock.state.shiftStatus = 'CLOSED';
        mock.state.shiftId = missedOpenedUuid;
        const shiftOpenPostsBeforeMissedObservation = mock.state.calls.filter(
            call => call.method === 'POST' && call.path === '/api/v1/shifts'
        ).length;
        const missedOpenedReadiness = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: true
        });
        assert.equal(missedOpenedReadiness.integrationReady, false);
        assert.equal(missedOpenedReadiness.readinessCode, 'local_shift_requires_reconciliation');
        const recoveredMissedOpenedJob = await pool.query(
            `SELECT shift.status,
                    shift.lifecycle_stage,
                    shift.opened_at,
                    shift.provider_opened_at,
                    shift.closed_at,
                    shift.provider_closed_at,
                    job.status AS job_status,
                    job.external_stage AS job_external_stage,
                    operation.status AS operation_status,
                    operation.external_stage AS operation_external_stage
               FROM fiscal_shifts shift
               JOIN fiscal_operations operation
                 ON operation.id = shift.open_operation_id
                AND operation.fiscal_profile_id = shift.fiscal_profile_id
               JOIN payment_outbox_jobs job
                 ON job.id = $2
                AND job.fiscal_operation_id = operation.id
                AND job.fiscal_profile_id = operation.fiscal_profile_id
              WHERE shift.id = $1`,
            [missedOpenedShift.id, missedOpenedWorkflow.rows[0].job_id]
        );
        assert.deepEqual(recoveredMissedOpenedJob.rows[0], {
            status: 'closed',
            lifecycle_stage: 'CLOSED',
            opened_at: null,
            provider_opened_at: null,
            closed_at: recoveredMissedOpenedJob.rows[0].closed_at,
            provider_closed_at: null,
            job_status: 'queued',
            job_external_stage: 'shift_lookup',
            operation_status: 'pending',
            operation_external_stage: 'shift_lookup'
        });
        assert.ok(recoveredMissedOpenedJob.rows[0].closed_at);
        const missedOpenedFinalize = await processPaymentOutboxJobs({
            dbPool: pool,
            provider: createHttpProvider(mock),
            batchSize: 1,
            lockedBy: `checkbox-missed-opened-finalize-${process.pid}`
        });
        assert.equal(missedOpenedFinalize.succeeded, 1, JSON.stringify(missedOpenedFinalize));
        assert.equal(missedOpenedFinalize.results[0].source, 'shift_lookup_observed_closed');
        assert.equal(
            mock.state.calls.filter(call => call.method === 'POST' && call.path === '/api/v1/shifts').length,
            shiftOpenPostsBeforeMissedObservation,
            'CLOSED observation for the exact durable open UUID must not submit another shift open'
        );
        const missedOpenedState = await pool.query(
            `SELECT shift.status,
                    shift.lifecycle_stage,
                    shift.provider_shift_id,
                    shift.opened_at,
                    shift.provider_opened_at,
                    shift.provider_closed_at,
                    operation.status AS operation_status,
                    job.status AS job_status
               FROM fiscal_shifts shift
               JOIN fiscal_operations operation
                 ON operation.id = shift.open_operation_id
                AND operation.fiscal_profile_id = shift.fiscal_profile_id
               JOIN payment_outbox_jobs job
                 ON job.id = $2
                AND job.fiscal_operation_id = operation.id
                AND job.fiscal_profile_id = operation.fiscal_profile_id
              WHERE shift.id = $1`,
            [missedOpenedShift.id, missedOpenedWorkflow.rows[0].job_id]
        );
        assert.deepEqual(missedOpenedState.rows[0], {
            status: 'closed',
            lifecycle_stage: 'CLOSED',
            provider_shift_id: missedOpenedUuid,
            opened_at: null,
            provider_opened_at: null,
            provider_closed_at: null,
            operation_status: 'fiscalized',
            job_status: 'succeeded'
        });
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_audit_events
                  WHERE fiscal_profile_id = $1
                    AND entity_table = 'fiscal_shifts'
                    AND entity_id = $2
                    AND event_type = 'fiscal_shift_open_observed_closed'`,
                [scope.fiscalProfileId, missedOpenedShift.id]
            ),
            1
        );
    });

    test('duplicate click, conflicting idempotency key, and concurrent confirmation do not duplicate sale jobs', async () => {
        const identicalOrder = await createOrder({
            user: cashier,
            key: 'parallel-identical-idempotency',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const identicalIdempotencyKey = `confirm-parallel-identical-${process.pid}`;
        const identicalBody = { tender: 'cash', confirmedAmountMinor: '10000' };
        const identicalConfirmations = await Promise.all([
            confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: identicalOrder.order.id,
                idempotencyKey: identicalIdempotencyKey,
                body: identicalBody
            }),
            confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: identicalOrder.order.id,
                idempotencyKey: identicalIdempotencyKey,
                body: identicalBody
            })
        ]);
        assert.deepEqual(
            identicalConfirmations.map(result => result.replayed).sort(),
            [false, true],
            'concurrent identical confirmations must converge to one result and one replay'
        );
        const identicalCounts = await pool.query(
            `SELECT
                 (SELECT COUNT(*)::integer FROM payment_attempts WHERE payment_order_id = $1) AS attempts,
                 (SELECT COUNT(*)::integer FROM fiscal_operations WHERE payment_order_id = $1 AND operation_type = 'sale') AS operations,
                 (SELECT COUNT(*)::integer FROM payment_outbox_jobs WHERE payment_order_id = $1 AND job_type = 'receipt_sell') AS jobs,
                 (SELECT COUNT(DISTINCT provider_operation_id)::integer FROM fiscal_operations WHERE payment_order_id = $1 AND operation_type = 'sale') AS provider_uuids`,
            [identicalOrder.order.id]
        );
        assert.deepEqual(identicalCounts.rows[0], { attempts: 1, operations: 1, jobs: 1, provider_uuids: 1 });

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
        const idleTransactions = await pool.query(
            `SELECT pid,
                    ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - xact_start))::numeric, 3) AS transaction_age_seconds,
                    LEFT(REGEXP_REPLACE(query, '\\s+', ' ', 'g'), 240) AS last_query
               FROM pg_stat_activity
              WHERE datname = current_database()
                AND state = 'idle in transaction'
                AND pid <> pg_backend_pid()
              ORDER BY xact_start`
        );
        assert.deepEqual(idleTransactions.rows, [], `pool leaked an idle transaction before outbox drain: ${JSON.stringify(idleTransactions.rows)}`);
        const activeLeases = await pool.query(
            `SELECT id,
                    job_type,
                    status,
                    locked_by,
                    ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(heartbeat_at, locked_at)))::numeric, 3) AS lease_age_seconds
               FROM payment_outbox_jobs
              WHERE status IN ('claimed', 'running')
              ORDER BY id`
        );
        assert.deepEqual(activeLeases.rows, [], `unexpected active lease before outbox drain: ${JSON.stringify(activeLeases.rows)}`);
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
        await pool.query(
            `UPDATE payment_orders
                SET status = 'payment_recorded',
                    payment_status = 'confirmed',
                    fiscal_status = 'pending',
                    confirmed_at = NOW(),
                    sealed_at = COALESCE(sealed_at, NOW()),
                    received_amount_minor = total_amount_minor,
                    change_amount_minor = 0,
                    confirmation_snapshot = jsonb_build_object(
                        'tender', 'cash',
                        'amount_minor', total_amount_minor::text,
                        'received_amount_minor', total_amount_minor::text,
                        'change_amount_minor', '0',
                        'confirmed_by_user_id', $2,
                        'fixture', 'register_wide_unresolved_queue'
                    ),
                    updated_at = NOW()
              WHERE id = $1
                AND cashier_user_id = $2`,
            [second.order.id, secondCashier.id]
        );

        const latestJobBefore = await pool.query(
            `SELECT fiscal_profile_id, fiscal_operation_id, payment_order_id
               FROM payment_outbox_jobs
              WHERE fiscal_operation_id = $1
              ORDER BY id DESC
              LIMIT 1`,
            [firstConfirmed.fiscalOperationId]
        );
        const dedupeJobKey = `dedupe-regression:${process.pid}:${first.order.id}`;
        const dedupeJob = await pool.query(
            `INSERT INTO payment_outbox_jobs (
                 fiscal_profile_id, fiscal_operation_id, payment_order_id, job_type,
                 status, idempotency_key, attempts, max_attempts, next_run_at, payload
             )
             VALUES ($1, $2, $3, 'receipt_status_lookup', 'failed', $4, 1, 10, NOW(), '{"source":"dedupe-regression"}'::jsonb)
             RETURNING id`,
            [
                latestJobBefore.rows[0].fiscal_profile_id,
                latestJobBefore.rows[0].fiscal_operation_id,
                latestJobBefore.rows[0].payment_order_id,
                dedupeJobKey
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

        const firstUnresolvedPage = await listUnresolvedPaymentOrders({
            dbPool: pool,
            user: secondCashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            page: 1,
            pageSize: 1
        });
        const secondUnresolvedPage = await listUnresolvedPaymentOrders({
            dbPool: pool,
            user: secondCashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            page: 2,
            pageSize: 1,
            cursor: firstUnresolvedPage.nextCursor,
            snapshotRevision: firstUnresolvedPage.snapshotRevision
        });
        assert.equal(firstUnresolvedPage.orders.length, 1, 'unresolved rows respect pageSize');
        assert.equal(secondUnresolvedPage.orders.length, 1, 'the next unresolved page remains reachable');
        assert.notEqual(firstUnresolvedPage.orders[0].id, secondUnresolvedPage.orders[0].id);
        assert.equal(firstUnresolvedPage.page, 1);
        assert.equal(firstUnresolvedPage.pageSize, 1);
        assert.equal(firstUnresolvedPage.hasMore, true);
        assert.equal(firstUnresolvedPage.registerCount, unresolvedForSecondCashier.registerCount);
        assert.equal(secondUnresolvedPage.registerCount, unresolvedForSecondCashier.registerCount);
        assert.equal(firstUnresolvedPage.myCount, unresolvedForSecondCashier.myCount);
        assert.equal(secondUnresolvedPage.myCount, unresolvedForSecondCashier.myCount);
        assert.match(firstUnresolvedPage.snapshotRevision, /^[0-9a-f]{32}$/);
        assert.equal(firstUnresolvedPage.nextCursor, firstUnresolvedPage.orders[0].id);
        assert.equal(secondUnresolvedPage.snapshotRevision, firstUnresolvedPage.snapshotRevision);

        await pool.query(
            `UPDATE payment_outbox_jobs
                SET status = 'dead', updated_at = NOW()
              WHERE id = $1`,
            [dedupeJob.rows[0].id]
        );
        await assert.rejects(
            listUnresolvedPaymentOrders({
                dbPool: pool,
                user: secondCashier,
                crmProfileKey: CRM_PROFILE_KEY,
                registerAlias: REGISTER_ALIAS,
                page: 2,
                pageSize: 1,
                cursor: firstUnresolvedPage.nextCursor,
                snapshotRevision: firstUnresolvedPage.snapshotRevision
            }),
            error => error?.code === 'unresolved_snapshot_changed' && error?.status === 409
        );
        await pool.query(
            `UPDATE payment_outbox_jobs
                SET status = 'failed', updated_at = NOW()
              WHERE id = $1`,
            [dedupeJob.rows[0].id]
        );

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
        const timedOutShift = await pool.query(
            `SELECT shift.id, shift.provider_shift_id
               FROM fiscal_shifts shift
               JOIN fiscal_operations operation
                 ON operation.fiscal_shift_id = shift.id
                AND operation.fiscal_profile_id = shift.fiscal_profile_id
              WHERE operation.id = $1`,
            [timeoutConfirm.fiscalOperationId]
        );
        assert.equal(timedOutShift.rowCount, 1);
        assert.equal(timedOutShift.rows[0].provider_shift_id, mock.state.shiftId);
        mock.state.shiftExists = true;
        mock.state.shiftOpened = false;
        mock.state.shiftStatus = 'CLOSED';
        const portalClosedAfterSaleSubmit = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: true
        });
        assert.equal(portalClosedAfterSaleSubmit.shiftState, 'closed');
        const localClosedAfterSaleSubmit = await pool.query(
            'SELECT status, lifecycle_stage FROM fiscal_shifts WHERE id = $1',
            [timedOutShift.rows[0].id]
        );
        assert.deepEqual(localClosedAfterSaleSubmit.rows[0], { status: 'closed', lifecycle_stage: 'CLOSED' });
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
            const failedJob = await pool.query(
                `SELECT status, attempts, max_attempts, external_stage, last_error_code, next_run_at
                   FROM payment_outbox_jobs
                  WHERE fiscal_operation_id = $1
                  ORDER BY id DESC
                  LIMIT 1`,
                [confirmed.fiscalOperationId]
            );
            assert.ok(
                ['failed', 'dead'].includes(failedJob.rows[0]?.status)
                    && Number(failedJob.rows[0]?.attempts || 0) >= 1,
                `${mode} response must leave the exact job durably failed: ${JSON.stringify({
                    batches,
                    job: failedJob.rows[0] || null
                })}`
            );
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

    test('receipt identity mismatch commits observation and incident while preserving the immutable receipt', async () => {
        const order = await createOrder({
            user: cashier,
            key: 'receipt-mismatch-evidence',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const confirmation = await confirmOrder({
            user: cashier,
            order,
            key: 'receipt-mismatch-evidence',
            tender: 'cash',
            amountMinor: '10000',
            receivedAmountMinor: '10000'
        });
        const providerReceiptId = await providerRequestUuidForOperation(confirmation.fiscalOperationId);
        const conflictingFiscalCode = `PREEXISTING-${crypto.randomUUID()}`;
        const conflictingSerial = `immutable-serial-${process.pid}`;
        await pool.query(
            `INSERT INTO fiscal_receipts (
                 fiscal_profile_id, fiscal_operation_id, payment_order_id, receipt_type, status,
                 provider, provider_receipt_id, provider_fiscal_code, provider_serial,
                 total_amount_minor, currency, provider_snapshot
             )
             VALUES ($1, $2, $3, 'sale', 'pending', 'checkbox', $4, $5, $6, $7, 'UAH', $8::jsonb)`,
            [
                scope.fiscalProfileId,
                confirmation.fiscalOperationId,
                order.order.id,
                providerReceiptId,
                conflictingFiscalCode,
                conflictingSerial,
                '10000',
                JSON.stringify({ seeded_for_mismatch_regression: true })
            ]
        );

        const workerOwner = `receipt-mismatch-evidence-${process.pid}`;
        const workerToken = crypto.randomUUID();
        const claimed = await pool.query(
            `UPDATE payment_outbox_jobs
                SET status = 'running',
                    attempts = attempts + 1,
                    locked_at = NOW(),
                    heartbeat_at = NOW(),
                    locked_by = $2,
                    lock_token = $3::uuid,
                    updated_at = NOW()
              WHERE fiscal_operation_id = $1
                AND job_type = 'receipt_sell'
                AND status = 'queued'
              RETURNING *`,
            [confirmation.fiscalOperationId, workerOwner, workerToken]
        );
        assert.equal(claimed.rowCount, 1, 'the mismatch finalizer must own one exact outbox lease');
        const immutableProviderContext = await pool.query(
            `SELECT operation.provider_organization_id,
                    operation.provider_register_id,
                    operation.provider_cashier_id,
                    operation.provider_operation_id,
                    shift.provider_shift_id
               FROM fiscal_operations operation
               JOIN fiscal_shifts shift
                 ON shift.id = operation.fiscal_shift_id
                AND shift.fiscal_profile_id = operation.fiscal_profile_id
                AND shift.fiscal_register_id = operation.fiscal_register_id
              WHERE operation.id = $1
                AND operation.fiscal_profile_id = $2`,
            [confirmation.fiscalOperationId, scope.fiscalProfileId]
        );
        assert.equal(immutableProviderContext.rowCount, 1);
        const providerContext = immutableProviderContext.rows[0];
        const mismatchResult = await finalizeJobSuccess(
            pool,
            { job: claimed.rows[0] },
            {
                source: 'receipt_lookup',
                receipt: {
                    id: providerContext.provider_operation_id,
                    status: 'DONE',
                    receiptType: 'SELL',
                    fiscalCode: `CONFLICTING-${crypto.randomUUID()}`,
                    serial: conflictingSerial,
                    totalAmountMinor: '10000',
                    providerOrganizationId: providerContext.provider_organization_id,
                    providerRegisterId: providerContext.provider_register_id,
                    providerCashierId: providerContext.provider_cashier_id,
                    providerShiftId: providerContext.provider_shift_id
                }
            }
        );
        assert.equal(mismatchResult.ok, false);
        assert.equal(mismatchResult.receiptMismatch, true);

        const durableState = await pool.query(
            `SELECT receipt.status AS receipt_status,
                    receipt.provider_fiscal_code,
                    receipt.provider_serial,
                    operation.status AS operation_status,
                    payment.fiscal_status,
                    job.status AS job_status,
                    job.last_error_code
               FROM fiscal_receipts receipt
               JOIN fiscal_operations operation
                 ON operation.id = receipt.fiscal_operation_id
                AND operation.fiscal_profile_id = receipt.fiscal_profile_id
               JOIN payment_orders payment
                 ON payment.id = receipt.payment_order_id
                AND payment.fiscal_profile_id = receipt.fiscal_profile_id
               JOIN payment_outbox_jobs job
                 ON job.fiscal_operation_id = operation.id
                AND job.fiscal_profile_id = operation.fiscal_profile_id
              WHERE receipt.provider = 'checkbox'
                AND receipt.provider_receipt_id = $1`,
            [providerReceiptId]
        );
        assert.deepEqual(durableState.rows[0], {
            receipt_status: 'pending',
            provider_fiscal_code: conflictingFiscalCode,
            provider_serial: conflictingSerial,
            operation_status: 'blocked',
            fiscal_status: 'blocked',
            job_status: 'dead',
            last_error_code: 'fiscal_receipt_identity_mismatch'
        });
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_audit_events
                  WHERE fiscal_profile_id = $1
                    AND entity_table = 'fiscal_operations'
                    AND entity_id = $2
                    AND event_type = 'fiscal_receipt_mismatch_observed'`,
                [scope.fiscalProfileId, confirmation.fiscalOperationId]
            ),
            1,
            'append-only mismatch observation must survive the finalize failure'
        );
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_operational_incidents
                  WHERE fiscal_profile_id = $1
                    AND fiscal_operation_id = $2
                    AND payment_order_id = $3
                    AND incident_type = 'fiscal.receipt_mismatch'
                    AND status = 'open'`,
                [scope.fiscalProfileId, confirmation.fiscalOperationId, order.order.id]
            ),
            1,
            'specific mismatch incident must survive the finalize failure'
        );
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_receipts
                  WHERE provider = 'checkbox'
                    AND provider_receipt_id = $1`,
                [providerReceiptId]
            ),
            1,
            'mismatch handling must not create or replace the provider receipt row'
        );
    });

    test('Cashier PRO service creators seal provider context and service-out approval preserves the durable UUID', async () => {
        const requesterActions = [...new Set([
            ...CONFIG_ACTOR_ACTIONS,
            'fiscal.service_in',
            'fiscal.service_out.request'
        ])];
        const approverActions = [...new Set([
            ...CONFIG_ACTOR_ACTIONS,
            'fiscal.service_out.approve',
            'fiscal.refund'
        ])];
        const requester = {
            ...cashier,
            role: 'creator',
            action_allowlist: requesterActions,
            actionAllowlist: requesterActions
        };
        const approver = {
            ...secondCashier,
            role: 'director',
            action_allowlist: approverActions,
            actionAllowlist: approverActions
        };
        const ephemeralPin = createEphemeralActionPin();
        const ephemeralPinHash = await createActionPinHash(ephemeralPin);

        await pool.query(
            `UPDATE fiscal_cashier_bindings
                SET capability_scope = CASE
                        WHEN user_id = $3 THEN ARRAY(
                            SELECT DISTINCT capability
                              FROM unnest(capability_scope || $4::text[]) capability
                        )
                        WHEN user_id = $5 THEN ARRAY(
                            SELECT DISTINCT capability
                              FROM unnest(capability_scope || $6::text[]) capability
                        )
                        ELSE capability_scope
                    END,
                    provider_cashier_login_ref = CASE
                        WHEN user_id = $5 THEN $8
                        ELSE provider_cashier_login_ref
                    END,
                    action_pin_hash = CASE WHEN user_id = $5 THEN $7 ELSE action_pin_hash END,
                    pin_failed_attempts = 0,
                    pin_locked_until = NULL
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND user_id IN ($3, $5)`,
            [
                scope.fiscalProfileId,
                scope.fiscalRegisterId,
                requester.id,
                ['fiscal.service_in', 'fiscal.service_out.request'],
                approver.id,
                ['fiscal.service_out.approve', 'fiscal.refund'],
                ephemeralPinHash,
                'phase2-refund-cashier'
            ]
        );

        const serviceIn = await createServiceIn({
            user: requester,
            idempotencyKey: `phase2-service-in-${process.pid}`,
            body: {
                fiscalProfileId: scope.fiscalProfileId,
                fiscalLocationId: scope.fiscalLocationId,
                fiscalRegisterId: scope.fiscalRegisterId,
                crmProfileKey: CRM_PROFILE_KEY,
                amountMinor: '100',
                finalConfirmation: 'Готівку внесено — створити службове внесення'
            }
        });
        const serviceOut = await createServiceOutRequest({
            user: requester,
            idempotencyKey: `phase2-service-out-${process.pid}`,
            body: {
                fiscalProfileId: scope.fiscalProfileId,
                fiscalLocationId: scope.fiscalLocationId,
                fiscalRegisterId: scope.fiscalRegisterId,
                crmProfileKey: CRM_PROFILE_KEY,
                amountMinor: '100',
                reason: 'Disposable PostgreSQL immutable snapshot regression'
            }
        });
        const beforeApproval = await pool.query(
            `SELECT provider_operation_id, request_snapshot, fiscal_configuration_hash
               FROM fiscal_operations
              WHERE id = $1
                AND fiscal_profile_id = $2`,
            [serviceOut.operationId, scope.fiscalProfileId]
        );
        assert.equal(beforeApproval.rowCount, 1);
        assert.equal(beforeApproval.rows[0].provider_operation_id, serviceOut.providerRequestUuid);
        assert.match(beforeApproval.rows[0].fiscal_configuration_hash, /^[0-9a-f]{64}$/);
        assert.equal(beforeApproval.rows[0].request_snapshot.provider_request_uuid, serviceOut.providerRequestUuid);
        assert.equal(beforeApproval.rows[0].request_snapshot.provider_context.provider_cashier_id, scope.providerCashierId);

        const approved = await approveServiceOut({
            user: approver,
            operationId: serviceOut.operationId,
            idempotencyKey: `phase2-service-out-approval-${process.pid}`,
            body: { pin: ephemeralPin }
        });
        assert.equal(approved.providerRequestUuid, serviceOut.providerRequestUuid);
        const afterApproval = await pool.query(
            `SELECT provider_operation_id, request_snapshot, fiscal_configuration_hash, status,
                    server_approval_status, approved_by_user_id
               FROM fiscal_operations
              WHERE id = $1
                AND fiscal_profile_id = $2`,
            [serviceOut.operationId, scope.fiscalProfileId]
        );
        assert.equal(afterApproval.rows[0].provider_operation_id, beforeApproval.rows[0].provider_operation_id);
        assert.deepEqual(afterApproval.rows[0].request_snapshot, beforeApproval.rows[0].request_snapshot);
        assert.equal(afterApproval.rows[0].fiscal_configuration_hash, beforeApproval.rows[0].fiscal_configuration_hash);
        assert.equal(afterApproval.rows[0].status, 'pending');
        assert.equal(afterApproval.rows[0].server_approval_status, 'consumed');
        assert.equal(Number(afterApproval.rows[0].approved_by_user_id), approver.id);

        const fakeProvider = {
            async createServiceReceipt(input) {
                await input.beforeExternalMutation();
                const operation = input.fiscalOperation;
                return {
                    id: operation.provider_operation_id,
                    status: 'DONE',
                    totalAmountMinor: String(operation.fiscal_operation_amount_minor),
                    receiptType: operation.operation_type === 'service_out' ? 'SERVICE_OUT' : 'SERVICE_IN',
                    providerRegisterId: operation.provider_register_id,
                    providerCashierId: operation.provider_cashier_id,
                    providerShiftId: operation.provider_shift_id,
                    providerOrganizationId: operation.provider_organization_id
                };
            }
        };
        for (const operationId of [serviceIn.operationId, serviceOut.operationId]) {
            const lockToken = crypto.randomUUID();
            const claimed = await pool.query(
                `UPDATE payment_outbox_jobs
                    SET status = 'claimed',
                        locked_by = $3,
                        lock_token = $4::uuid,
                        locked_at = NOW(),
                        heartbeat_at = NOW(),
                        attempts = attempts + 1
                  WHERE fiscal_profile_id = $1
                    AND fiscal_operation_id = $2
                    AND job_type = 'service_receipt'
                  RETURNING *`,
                [scope.fiscalProfileId, operationId, `phase2-service-worker-${process.pid}`, lockToken]
            );
            assert.equal(claimed.rowCount, 1);
            const processed = await processOnePaymentOutboxJob({
                dbPool: pool,
                provider: fakeProvider,
                job: claimed.rows[0]
            });
            assert.equal(processed.ok, true, JSON.stringify(processed));
            assert.equal(processed.source, 'service_submit');
        }

        const completed = await pool.query(
            `SELECT operation.id,
                    operation.provider_operation_id,
                    operation.status,
                    operation.external_stage AS operation_stage,
                    job.status AS job_status,
                    job.external_stage AS job_stage,
                    receipt.provider_receipt_id,
                    receipt.receipt_type
               FROM fiscal_operations operation
               JOIN payment_outbox_jobs job
                 ON job.fiscal_profile_id = operation.fiscal_profile_id
                AND job.fiscal_operation_id = operation.id
                AND job.job_type = 'service_receipt'
               JOIN fiscal_receipts receipt
                 ON receipt.fiscal_profile_id = operation.fiscal_profile_id
                AND receipt.fiscal_operation_id = operation.id
              WHERE operation.fiscal_profile_id = $1
                AND operation.id = ANY($2::bigint[])
              ORDER BY operation.id`,
            [scope.fiscalProfileId, [serviceIn.operationId, serviceOut.operationId]]
        );
        assert.equal(completed.rowCount, 2);
        assert.ok(completed.rows.every(row => row.status === 'fiscalized'));
        assert.ok(completed.rows.every(row => row.operation_stage === 'complete'));
        assert.ok(completed.rows.every(row => row.job_status === 'succeeded'));
        assert.ok(completed.rows.every(row => row.job_stage === 'complete'));
        assert.ok(completed.rows.every(row => row.provider_operation_id === row.provider_receipt_id));
        assert.deepEqual(completed.rows.map(row => row.receipt_type).sort(), ['service_in', 'service_out']);

        const refundableOrder = await pool.query(
            `SELECT payment.id
               FROM payment_orders payment
               JOIN fiscal_receipts receipt
                 ON receipt.fiscal_profile_id = payment.fiscal_profile_id
                AND receipt.payment_order_id = payment.id
                AND receipt.receipt_type = 'sale'
              WHERE payment.fiscal_profile_id = $1
                AND payment.fiscal_register_id = $2
                AND payment.cashier_user_id = $3
                AND payment.payment_method = 'cash'
                AND payment.payment_status = 'confirmed'
                AND payment.fiscal_status = 'fiscalized'
                AND NOT EXISTS (
                    SELECT 1
                      FROM payment_refunds refund
                     WHERE refund.fiscal_profile_id = payment.fiscal_profile_id
                       AND refund.payment_order_id = payment.id
                )
              ORDER BY payment.id
              LIMIT 1`,
            [scope.fiscalProfileId, scope.fiscalRegisterId, requester.id]
        );
        assert.equal(refundableOrder.rowCount, 1, 'a fiscalized sale by the original cashier is required');
        const refund = await createFullRefund({
            user: approver,
            orderId: Number(refundableOrder.rows[0].id),
            idempotencyKey: `phase2-refund-different-actor-${process.pid}`,
            body: {
                reason: 'Different authorized actor binding regression',
                pin: ephemeralPin
            }
        });
        const refundOperation = await pool.query(
            `SELECT initiated_by_user_id, register_credential_ref, cashier_credential_ref
               FROM fiscal_operations
              WHERE id = $1
                AND fiscal_profile_id = $2`,
            [refund.fiscalOperationId, scope.fiscalProfileId]
        );
        assert.equal(Number(refundOperation.rows[0].initiated_by_user_id), approver.id);
        assert.equal(refundOperation.rows[0].cashier_credential_ref, 'phase2-refund-cashier');

        const refundClaimClient = await pool.connect();
        let refundClaims;
        try {
            await refundClaimClient.query('BEGIN');
            refundClaims = await claimPaymentOutboxJobs(refundClaimClient, {
                batchSize: 1,
                lockedBy: `phase2-refund-worker-${process.pid}`,
                cashierProEnabled: true,
                eligibleRuntimeContexts: [{
                    fiscalProfileId: scope.fiscalProfileId,
                    fiscalRegisterId: scope.fiscalRegisterId,
                    registerCredentialRef: refundOperation.rows[0].register_credential_ref,
                    cashierCredentialRef: refundOperation.rows[0].cashier_credential_ref
                }]
            });
            await refundClaimClient.query('COMMIT');
        } catch (error) {
            await refundClaimClient.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            refundClaimClient.release();
        }
        assert.equal(refundClaims.length, 1, 'refund job must resolve the refund initiator binding, not the original sale cashier');
        assert.equal(Number(refundClaims[0].fiscal_operation_id), refund.fiscalOperationId);

        const refundProcessed = await processOnePaymentOutboxJob({
            dbPool: pool,
            provider: {
                async createReturnReceipt(input) {
                    await input.beforeExternalMutation();
                    const operation = input.fiscalOperation;
                    return {
                        id: operation.provider_operation_id,
                        status: 'DONE',
                        totalAmountMinor: String(operation.fiscal_operation_amount_minor),
                        receiptType: 'RETURN',
                        providerRegisterId: operation.provider_register_id,
                        providerCashierId: operation.provider_cashier_id,
                        providerShiftId: operation.provider_shift_id,
                        providerOrganizationId: operation.provider_organization_id
                    };
                }
            },
            job: refundClaims[0]
        });
        assert.equal(refundProcessed.ok, true, JSON.stringify(refundProcessed));
        const refundState = await pool.query(
            `SELECT refund.fiscal_refund_status,
                    operation.status AS operation_status,
                    job.status AS job_status,
                    receipt.provider_receipt_id
               FROM payment_refunds refund
               JOIN fiscal_operations operation
                 ON operation.id = refund.fiscal_operation_id
                AND operation.fiscal_profile_id = refund.fiscal_profile_id
               JOIN payment_outbox_jobs job
                 ON job.fiscal_operation_id = operation.id
                AND job.fiscal_profile_id = operation.fiscal_profile_id
               JOIN fiscal_receipts receipt
                 ON receipt.fiscal_operation_id = operation.id
                AND receipt.fiscal_profile_id = operation.fiscal_profile_id
              WHERE refund.id = $1`,
            [refund.refundId]
        );
        assert.deepEqual(refundState.rows[0], {
            fiscal_refund_status: 'returned',
            operation_status: 'fiscalized',
            job_status: 'succeeded',
            provider_receipt_id: refund.providerRequestUuid
        });
    });

    test('concurrent wrong service-out PIN attempts increment the binding without lost updates', async () => {
        const requesterActions = [...new Set([
            ...CONFIG_ACTOR_ACTIONS,
            'fiscal.service_out.request'
        ])];
        const approverActions = [...new Set([
            ...CONFIG_ACTOR_ACTIONS,
            'fiscal.service_out.approve'
        ])];
        const requester = {
            ...cashier,
            role: 'creator',
            action_allowlist: requesterActions,
            actionAllowlist: requesterActions
        };
        const approver = {
            ...secondCashier,
            role: 'director',
            action_allowlist: approverActions,
            actionAllowlist: approverActions
        };
        const correctPin = createEphemeralActionPin();
        const wrongPin = correctPin === '000000' ? '111111' : '000000';
        const pinHash = await createActionPinHash(correctPin);
        await pool.query(
            `UPDATE fiscal_cashier_bindings
                SET capability_scope = CASE
                        WHEN user_id = $3 THEN ARRAY(
                            SELECT DISTINCT capability
                              FROM unnest(capability_scope || $4::text[]) capability
                        )
                        WHEN user_id = $5 THEN ARRAY(
                            SELECT DISTINCT capability
                              FROM unnest(capability_scope || $6::text[]) capability
                        )
                        ELSE capability_scope
                    END,
                    action_pin_hash = CASE WHEN user_id = $5 THEN $7 ELSE action_pin_hash END,
                    pin_failed_attempts = 0,
                    pin_last_failed_at = NULL,
                    pin_locked_until = NULL,
                    pin_last_verified_at = NULL
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND user_id IN ($3, $5)`,
            [
                scope.fiscalProfileId,
                scope.fiscalRegisterId,
                requester.id,
                ['fiscal.service_out.request'],
                approver.id,
                ['fiscal.service_out.approve'],
                pinHash
            ]
        );

        const requests = await Promise.all([0, 1].map(index => createServiceOutRequest({
            user: requester,
            idempotencyKey: `phase2-concurrent-pin-service-out-${process.pid}-${index}`,
            body: {
                fiscalProfileId: scope.fiscalProfileId,
                fiscalLocationId: scope.fiscalLocationId,
                fiscalRegisterId: scope.fiscalRegisterId,
                crmProfileKey: CRM_PROFILE_KEY,
                amountMinor: '100',
                reason: `Concurrent wrong PIN regression ${index}`
            }
        })));
        const attempts = await Promise.allSettled(requests.map((request, index) => approveServiceOut({
            user: approver,
            operationId: request.operationId,
            idempotencyKey: `phase2-concurrent-pin-approval-${process.pid}-${index}`,
            body: { pin: wrongPin }
        })));
        assert.ok(attempts.every(attempt => attempt.status === 'rejected'));
        assert.deepEqual(
            attempts.map(attempt => attempt.reason?.code).sort(),
            ['action_pin_invalid', 'action_pin_invalid'],
            JSON.stringify(attempts.map(attempt => ({
                status: attempt.status,
                name: attempt.reason?.name,
                code: attempt.reason?.code,
                message: attempt.reason?.message
            })))
        );

        const afterFailures = await pool.query(
            `SELECT pin_failed_attempts, pin_locked_until
               FROM fiscal_cashier_bindings
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND user_id = $3`,
            [scope.fiscalProfileId, scope.fiscalRegisterId, approver.id]
        );
        assert.equal(Number(afterFailures.rows[0].pin_failed_attempts), 2);
        assert.equal(afterFailures.rows[0].pin_locked_until, null);

        const approved = await approveServiceOut({
            user: approver,
            operationId: requests[0].operationId,
            idempotencyKey: `phase2-concurrent-pin-correct-${process.pid}`,
            body: { pin: correctPin }
        });
        const afterSuccess = await pool.query(
            `SELECT binding.pin_failed_attempts, binding.pin_locked_until,
                    approval.status, approval.approved_at, approval.expires_at, approval.consumed_at
               FROM fiscal_cashier_bindings binding
               JOIN fiscal_action_approvals approval
                 ON approval.id = $4
              WHERE binding.fiscal_profile_id = $1
                AND binding.fiscal_register_id = $2
                AND binding.user_id = $3`,
            [scope.fiscalProfileId, scope.fiscalRegisterId, approver.id, approved.approvalId]
        );
        assert.equal(Number(afterSuccess.rows[0].pin_failed_attempts), 0);
        assert.equal(afterSuccess.rows[0].pin_locked_until, null);
        assert.equal(afterSuccess.rows[0].status, 'consumed');
        assert.ok(afterSuccess.rows[0].consumed_at instanceof Date);
        assert.ok(afterSuccess.rows[0].expires_at > afterSuccess.rows[0].approved_at);

        await expectErrorCode(
            approveServiceOut({
                user: approver,
                operationId: requests[0].operationId,
                idempotencyKey: `phase2-concurrent-pin-replay-${process.pid}`,
                body: { pin: correctPin }
            }),
            'service_out_not_pending_approval'
        );
        const afterReplay = await pool.query(
            `SELECT pin_failed_attempts
               FROM fiscal_cashier_bindings
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND user_id = $3`,
            [scope.fiscalProfileId, scope.fiscalRegisterId, approver.id]
        );
        assert.equal(Number(afterReplay.rows[0].pin_failed_attempts), 0);

        const secondApproved = await approveServiceOut({
            user: approver,
            operationId: requests[1].operationId,
            idempotencyKey: `phase2-concurrent-pin-second-correct-${process.pid}`,
            body: { pin: correctPin }
        });
        const fakeProvider = {
            async createServiceReceipt(input) {
                await input.beforeExternalMutation();
                const operation = input.fiscalOperation;
                return {
                    id: operation.provider_operation_id,
                    status: 'DONE',
                    totalAmountMinor: String(operation.fiscal_operation_amount_minor),
                    receiptType: 'SERVICE_OUT',
                    providerRegisterId: operation.provider_register_id,
                    providerCashierId: operation.provider_cashier_id,
                    providerShiftId: operation.provider_shift_id,
                    providerOrganizationId: operation.provider_organization_id
                };
            }
        };
        for (const approvedOperation of [approved, secondApproved]) {
            const lockToken = crypto.randomUUID();
            const claimed = await pool.query(
                `UPDATE payment_outbox_jobs
                    SET status = 'claimed',
                        locked_by = $3,
                        lock_token = $4::uuid,
                        locked_at = NOW(),
                        heartbeat_at = NOW(),
                        attempts = attempts + 1
                  WHERE fiscal_profile_id = $1
                    AND fiscal_operation_id = $2
                    AND job_type = 'service_receipt'
                  RETURNING *`,
                [
                    scope.fiscalProfileId,
                    approvedOperation.operationId,
                    `concurrent-pin-cleanup-${process.pid}`,
                    lockToken
                ]
            );
            assert.equal(claimed.rowCount, 1);
            const processed = await processOnePaymentOutboxJob({
                dbPool: pool,
                provider: fakeProvider,
                job: claimed.rows[0]
            });
            assert.equal(processed.ok, true, JSON.stringify(processed));
        }
    });

    test('concurrent wrong reconciliation and close PIN attempts commit both counters and roll back approval drafts', async t => {
        const isolatedSuffix = `${process.pid}_${crypto.randomUUID().replace(/-/g, '')}`;
        const runtimeCredentialRef = `pin-concurrency-${isolatedSuffix}`;
        const runtimeEnvPrefix = credentialEnvPrefix(runtimeCredentialRef);
        const runtimeEnv = {
            [`${runtimeEnvPrefix}_BASE_URL`]: 'https://api.checkbox.in.ua',
            [`${runtimeEnvPrefix}_AUTH_MODE`]: 'password',
            [`${runtimeEnvPrefix}_LOGIN`]: 'isolated-pin-concurrency-login',
            [`${runtimeEnvPrefix}_PASSWORD`]: 'isolated-pin-concurrency-password',
            [`${runtimeEnvPrefix}_LICENSE_KEY`]: 'isolated-pin-concurrency-license'
        };
        const priorRuntimeEnv = new Map(
            Object.keys(runtimeEnv).map(name => [name, process.env[name]])
        );
        Object.assign(process.env, runtimeEnv);
        t.after(() => {
            for (const [name, previous] of priorRuntimeEnv.entries()) {
                if (previous == null) delete process.env[name];
                else process.env[name] = previous;
            }
        });
        const actorActions = [...new Set([
            ...CONFIG_ACTOR_ACTIONS,
            'fiscal.reconcile',
            'fiscal.shift.close',
            'fiscal.audit.view'
        ])];
        const actor = {
            ...cashier,
            role: 'creator',
            action_allowlist: actorActions,
            actionAllowlist: actorActions
        };
        const correctPin = createEphemeralActionPin();
        const wrongPin = correctPin === '000000' ? '111111' : '000000';
        const pinHash = await createActionPinHash(correctPin);
        const isolatedRegister = await pool.query(
            `INSERT INTO fiscal_registers (
                 fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
                 display_name, provider, provider_register_id, provider_license_ref,
                 status, feature_enabled, metadata
             )
             VALUES ($1, $2, $3, $4, 'PIN concurrency register', 'checkbox', $5, $6,
                     'active', TRUE, '{"expected_is_test":true}'::jsonb)
             RETURNING id`,
            [
                scope.fiscalProfileId,
                scope.fiscalLocationId,
                CRM_PROFILE_KEY,
                `pin_concurrency_${isolatedSuffix}`.slice(0, 64),
                `pin-concurrency-register-${isolatedSuffix}`,
                runtimeCredentialRef
            ]
        );
        const isolatedRegisterId = Number(isolatedRegister.rows[0].id);
        await pool.query(
            `INSERT INTO fiscal_cashier_bindings (
                 fiscal_profile_id, fiscal_register_id, user_id, provider,
                 provider_cashier_id, provider_cashier_login_ref, status,
                 crm_profile_key, fiscal_location_id, capability_scope, action_pin_hash,
                 pin_failed_attempts, pin_last_failed_at, pin_locked_until, pin_last_verified_at
             )
             VALUES ($1, $2, $3, 'checkbox', $4, $5, 'active', $6, $7,
                     $8::text[], $9, 0, NULL, NULL, NULL)`,
            [
                scope.fiscalProfileId,
                isolatedRegisterId,
                actor.id,
                scope.providerCashierId,
                runtimeCredentialRef,
                CRM_PROFILE_KEY,
                scope.fiscalLocationId,
                ['fiscal.reconcile', 'fiscal.shift.close', 'fiscal.audit.view'],
                pinHash
            ]
        );
        const openShift = await pool.query(
            `INSERT INTO fiscal_shifts (
                 fiscal_profile_id, fiscal_register_id, provider, provider_shift_id,
                 status, lifecycle_stage, opened_by_user_id, opened_at, provider_opened_at,
                 provider_snapshot
             )
             VALUES ($1, $2, 'checkbox', $3, 'open', 'OPENED', $4, NOW(), NOW(), $5::jsonb)
             RETURNING id`,
            [
                scope.fiscalProfileId,
                isolatedRegisterId,
                `pin-concurrency-shift-${crypto.randomUUID()}`,
                actor.id,
                JSON.stringify({ source: 'isolated_pin_concurrency_regression', expected_is_test: true })
            ]
        );
        assert.equal(openShift.rowCount, 1);
        const shiftId = Number(openShift.rows[0].id);
        const report = await getOperationalReport({ user: actor, shiftId });
        const body = {
            cashActualMinor: (BigInt(report.checklist.cashExpectedMinor) + 1n).toString(),
            terminalReportTotalMinor: report.checklist.terminalExpectedMinor,
            reason: 'Concurrent reconciliation and close wrong PIN regression',
            pin: wrongPin
        };
        const auditCountBefore = await countRows(
            `SELECT COUNT(*)::integer AS count
               FROM fiscal_audit_events
              WHERE fiscal_profile_id = $1
                AND actor_user_id = $2
                AND event_type = 'fiscal_action_pin_failed'`,
            [scope.fiscalProfileId, actor.id]
        );
        const reconciliationKey = `phase2-concurrent-pin-reconciliation-${process.pid}`;
        const closeKey = `phase2-concurrent-pin-close-${process.pid}`;
        const attempts = await Promise.allSettled([
            createReconciliationRevision({
                user: actor,
                shiftId,
                idempotencyKey: reconciliationKey,
                body
            }),
            closeShift({
                user: actor,
                shiftId,
                idempotencyKey: closeKey,
                body
            })
        ]);
        assert.ok(attempts.every(attempt => attempt.status === 'rejected'));
        if (attempts.some(attempt => !attempt.reason?.code)) {
            throw new Error(JSON.stringify(attempts.map(attempt => ({
                status: attempt.status,
                name: attempt.reason?.name,
                code: attempt.reason?.code,
                message: attempt.reason?.message
            }))));
        }
        assert.deepEqual(
            attempts.map(attempt => attempt.reason?.code).sort(),
            ['action_pin_invalid', 'action_pin_invalid']
        );

        const afterFailures = await pool.query(
            `SELECT pin_failed_attempts, pin_locked_until
               FROM fiscal_cashier_bindings
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND user_id = $3`,
            [scope.fiscalProfileId, isolatedRegisterId, actor.id]
        );
        assert.equal(Number(afterFailures.rows[0].pin_failed_attempts), 2);
        assert.equal(afterFailures.rows[0].pin_locked_until, null);
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_audit_events
                  WHERE fiscal_profile_id = $1
                    AND actor_user_id = $2
                    AND event_type = 'fiscal_action_pin_failed'`,
                [scope.fiscalProfileId, actor.id]
            ),
            auditCountBefore + 2
        );
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_operations
                  WHERE fiscal_profile_id = $1
                    AND idempotency_key = ANY($2::text[])`,
                [
                    scope.fiscalProfileId,
                    [
                        `fiscal_operation:reconciliation_difference:${shiftId}:${reconciliationKey}`,
                        `fiscal_operation:shift_close:${shiftId}:${closeKey}`
                    ]
                ]
            ),
            0,
            'wrong PIN must not leave reconciliation or close approval drafts'
        );

        const reconciled = await createReconciliationRevision({
            user: actor,
            shiftId,
            idempotencyKey: reconciliationKey,
            body: { ...body, pin: correctPin }
        });
        assert.equal(reconciled.differenceMinor, '1');
        const afterSuccess = await pool.query(
            `SELECT pin_failed_attempts, pin_locked_until
               FROM fiscal_cashier_bindings
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND user_id = $3`,
            [scope.fiscalProfileId, isolatedRegisterId, actor.id]
        );
        assert.equal(Number(afterSuccess.rows[0].pin_failed_attempts), 0);
        assert.equal(afterSuccess.rows[0].pin_locked_until, null);
        await expectErrorCode(
            createReconciliationRevision({
                user: actor,
                shiftId,
                idempotencyKey: reconciliationKey,
                body: { ...body, pin: correctPin }
            }),
            'reconciliation_difference_already_requested'
        );
    });

    test('provider-closed shift blocks an already-paid pre-submit sale without a second receipt mutation', async () => {
        const openedShift = await pool.query(
            `SELECT id, provider_shift_id
               FROM fiscal_shifts
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND status = 'open'
                AND lifecycle_stage = 'OPENED'
                AND provider_shift_id IS NOT NULL
              ORDER BY id DESC
              LIMIT 1`,
            [scope.fiscalProfileId, scope.fiscalRegisterId]
        );
        assert.equal(openedShift.rowCount, 1, 'the preceding sale scenarios must leave one exact provider OPENED shift');

        const paidOrder = await createOrder({
            user: cashier,
            key: 'provider-closed-paid-pre-submit-sale',
            tender: 'cash',
            totalUah: TEST_TICKET_PRICES_UAH.regular_child,
            itemCode: 'regular_child'
        });
        const paidConfirmation = await confirmOrder({
            user: cashier,
            order: paidOrder,
            key: 'provider-closed-paid-pre-submit-sale',
            tender: 'cash',
            amountMinor: '10000',
            receivedAmountMinor: '10000'
        });
        const exactProviderReceiptUuid = paidConfirmation.providerRequestUuid;
        const providerValidateCallsBefore = mock.state.calls.filter(
            call => call.method === 'POST'
                && call.path === '/api/v1/receipts/validate'
                && call.body?.id === exactProviderReceiptUuid
        ).length;
        const providerSellCallsBefore = mock.state.calls.filter(
            call => call.method === 'POST'
                && call.path === '/api/v1/receipts/sell'
                && call.body?.id === exactProviderReceiptUuid
        ).length;

        mock.state.shiftExists = true;
        mock.state.shiftOpened = false;
        mock.state.shiftStatus = 'CLOSED';
        mock.state.shiftId = openedShift.rows[0].provider_shift_id;
        const readiness = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: true
        });
        assert.equal(readiness.integrationReady, false);
        assert.equal(readiness.blockingFiscalIncident, true);
        assert.equal(readiness.readinessCode, 'paid_sale_closed_shift_reconciliation_required');

        const blockedSale = await pool.query(
            `SELECT payment.status AS payment_status,
                    payment.payment_status AS money_status,
                    payment.fiscal_status,
                    operation.status AS operation_status,
                    operation.external_stage,
                    operation.provider_operation_id,
                    job.status AS job_status,
                    job.attempts,
                    job.last_error_code
               FROM payment_orders payment
               JOIN fiscal_operations operation
                 ON operation.payment_order_id = payment.id
                AND operation.fiscal_profile_id = payment.fiscal_profile_id
                AND operation.operation_type = 'sale'
               JOIN payment_outbox_jobs job
                 ON job.fiscal_operation_id = operation.id
                AND job.fiscal_profile_id = operation.fiscal_profile_id
                AND job.job_type = 'receipt_sell'
              WHERE payment.id = $1
                AND payment.fiscal_profile_id = $2`,
            [paidOrder.order.id, scope.fiscalProfileId]
        );
        assert.deepEqual(blockedSale.rows[0], {
            payment_status: 'payment_recorded',
            money_status: 'confirmed',
            fiscal_status: 'blocked',
            operation_status: 'blocked',
            external_stage: 'auth',
            provider_operation_id: exactProviderReceiptUuid,
            job_status: 'dead',
            attempts: 0,
            last_error_code: 'provider_shift_closed_before_sale_submit'
        });
        assert.equal(
            mock.state.calls.filter(
                call => call.method === 'POST'
                    && call.path === '/api/v1/receipts/validate'
                    && call.body?.id === exactProviderReceiptUuid
            ).length,
            providerValidateCallsBefore
        );
        assert.equal(
            mock.state.calls.filter(
                call => call.method === 'POST'
                    && call.path === '/api/v1/receipts/sell'
                    && call.body?.id === exactProviderReceiptUuid
            ).length,
            providerSellCallsBefore
        );
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_operational_incidents
                  WHERE fiscal_profile_id = $1
                    AND fiscal_register_id = $2
                    AND fiscal_operation_id = $3
                    AND payment_order_id = $4
                    AND incident_type = 'checkbox.paid_sale_blocked_by_closed_shift'
                    AND status = 'open'
                    AND details->>'automatic_resubmission_allowed' = 'false'
                    AND details->>'sanitized' = 'true'`,
                [
                    scope.fiscalProfileId,
                    scope.fiscalRegisterId,
                    paidConfirmation.fiscalOperationId,
                    paidOrder.order.id
                ]
            ),
            1
        );
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_audit_events
                  WHERE fiscal_profile_id = $1
                    AND entity_table = 'fiscal_operations'
                    AND entity_id = $2
                    AND event_type = 'paid_sale_blocked_by_closed_shift'`,
                [scope.fiscalProfileId, paidConfirmation.fiscalOperationId]
            ),
            1
        );

        await expectErrorCode(
            createAdmissionTicketPaymentOrder({
                dbPool: pool,
                user: cashier,
                idempotencyKey: `order-blocked-by-closed-shift-sale-${process.pid}`,
                body: {
                    tender: 'cash',
                    admissionTicket: { smoke: 'blocked-by-closed-shift-sale' }
                },
                quoteResolver: makeQuote({
                    fingerprint: `quote-blocked-by-closed-shift-sale-${process.pid}`,
                    totalUah: TEST_TICKET_PRICES_UAH.regular_child,
                    code: 'regular_child',
                    name: 'Park test regular_child'
                }),
                requireCheckboxIntegrationReady: true
            }),
            'paid_sale_closed_shift_reconciliation_required'
        );

        const repeatedReadiness = await probeCheckboxReadiness({
            dbPool: pool,
            user: cashier,
            crmProfileKey: CRM_PROFILE_KEY,
            registerAlias: REGISTER_ALIAS,
            fetchImpl: createOfficialHostMockFetch(mock),
            force: true
        });
        assert.equal(repeatedReadiness.readinessCode, 'paid_sale_closed_shift_reconciliation_required');
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_operational_incidents
                  WHERE fiscal_operation_id = $1
                    AND incident_type = 'checkbox.paid_sale_blocked_by_closed_shift'`,
                [paidConfirmation.fiscalOperationId]
            ),
            1,
            'repeated readiness must reopen/update the same incident instead of duplicating it'
        );
        assert.equal(
            await countRows(
                `SELECT COUNT(*)::integer AS count
                   FROM fiscal_operations
                  WHERE id = $1
                    AND provider_operation_id = $2`,
                [paidConfirmation.fiscalOperationId, exactProviderReceiptUuid]
            ),
            1,
            'the durable sale UUID must remain unchanged'
        );
    });
});
