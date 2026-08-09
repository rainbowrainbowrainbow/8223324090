/**
 * Fresh PostgreSQL + local HTTP Checkbox smoke for the park thin MVP.
 *
 * Run only through:
 *   npm run test:integration:checkbox-park-cashier-smoke:isolated
 */
'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { pool } = require('../../db');
const {
    cancelDraftPaymentOrder,
    createAdmissionTicketPaymentOrder,
    confirmPaymentOrder
} = require('../../services/payments/paymentService');
const { createProviderFromConfig } = require('../../services/checkbox/provider');
const { processPaymentOutboxJobs } = require('../../services/payments/paymentOutboxWorker');
const { verifyCheckboxWebhookSignature } = require('../../services/checkbox/webhookAuth');
const { createActionPinHash } = require('../../services/payments/fiscalApprovals');
const {
    listUnresolvedPaymentOrders,
    loadCheckboxSalesReport
} = require('../../services/payments/paymentReadinessService');

const enabled = process.env.RUN_CHECKBOX_PARK_CASHIER_SMOKE_INTEGRATION === 'true';
const CRM_PROFILE_KEY = 'event_genix';
const REGISTER_ALIAS = 'middle';
const FISCAL_ACTIONS = Object.freeze([
    'payments.view',
    'payments.create',
    'payments.confirm_received',
    'fiscal.shift.open'
]);

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

async function seedUser({ username, name, role }) {
    const result = await pool.query(
        `INSERT INTO users (
             username, password_hash, name, role, is_active,
             action_allowlist, business_contexts, default_business_context
         )
         VALUES ($1, $2, $3, $4, true, $5::text[], $6::text[], $7)
         RETURNING id, username, name, role`,
        [
            username,
            `smoke-password-hash-${crypto.randomUUID()}`,
            name,
            role,
            FISCAL_ACTIONS,
            [CRM_PROFILE_KEY],
            CRM_PROFILE_KEY
        ]
    );
    return createUserPayload(result.rows[0]);
}

async function seedFiscalScope({ cashier }) {
    const ephemeralPinHash = await createActionPinHash(String(crypto.randomInt(100000, 999999)));
    const profile = await pool.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name,
             tax_identifier, provider, provider_organization_id, currency, status, settings
         )
         VALUES ($1, $2, $3, $4, 'checkbox', $5, 'UAH', 'active', $6::jsonb)
         RETURNING *`,
        [
            CRM_PROFILE_KEY,
            `fop_park_smoke_${process.pid}`.toLowerCase(),
            'Checkbox Park Smoke FOP',
            `smoke-tax-${process.pid}`,
            `mock-org-${process.pid}`,
            JSON.stringify({ pilot: true, smoke: true })
        ]
    );
    const location = await pool.query(
        `INSERT INTO fiscal_locations (
             fiscal_profile_id, crm_profile_key, location_alias, display_name,
             provider_outlet_id, address_snapshot, status
         )
         VALUES ($1, $2, 'park', 'Park test location', $3, 'Local smoke address', 'active')
         RETURNING *`,
        [profile.rows[0].id, CRM_PROFILE_KEY, `mock-outlet-${process.pid}`]
    );
    const register = await pool.query(
        `INSERT INTO fiscal_registers (
             fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
             display_name, provider, provider_register_id, provider_license_ref,
             status, feature_enabled, metadata
         )
         VALUES ($1, $2, $3, $4, 'Middle cash register smoke', 'checkbox', $5, $6, 'active', true, $7::jsonb)
         RETURNING *`,
        [
            profile.rows[0].id,
            location.rows[0].id,
            CRM_PROFILE_KEY,
            REGISTER_ALIAS,
            `mock-register-${process.pid}`,
            'park-middle-smoke',
            JSON.stringify({ integration_owner: 'checkbox-park-smoke', expected_is_test: true })
        ]
    );
    await pool.query(
        `INSERT INTO fiscal_cashier_bindings (
             fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
             user_id, provider, provider_cashier_id, provider_cashier_login_ref,
             status, capability_scope, action_pin_hash, action_pin_set_at, action_pin_updated_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, 'checkbox', $6, $7, 'active', $8::text[], $9, NOW(), $5)`,
        [
            profile.rows[0].id,
            register.rows[0].id,
            location.rows[0].id,
            CRM_PROFILE_KEY,
            cashier.id,
            `mock-cashier-${cashier.id}`,
            'park-middle-smoke',
            FISCAL_ACTIONS,
            ephemeralPinHash
        ]
    );

    const itemCodes = ['park_child_day_cash', 'park_child_day_card', 'park_child_422', 'park_child_timeout', 'park_child_pending', 'park_child_malformed', 'park_child_concurrent'];
    for (const itemCode of itemCodes) {
        await pool.query(
            `INSERT INTO fiscal_item_mappings (
                 fiscal_profile_id, fiscal_register_id, crm_profile_key, source_type, item_type,
                 item_code, fiscal_item_name, provider, provider_tax_id, tax_code, tax_rate_bps, status
             )
             VALUES ($1, $2, $3, 'admission_ticket', 'admission_ticket', $4, $5, 'checkbox', '7', 7, 0, 'active')`,
            [
                profile.rows[0].id,
                register.rows[0].id,
                CRM_PROFILE_KEY,
                itemCode,
                `Park admission ${itemCode}`
            ]
        );
    }

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
        fiscalProfileId: Number(profile.rows[0].id),
        fiscalLocationId: Number(location.rows[0].id),
        fiscalRegisterId: Number(register.rows[0].id),
        dummyFiscalProfileId: Number(dummyProfile.rows[0].id),
        providerOrganizationId: profile.rows[0].provider_organization_id,
        providerRegisterId: register.rows[0].provider_register_id
    };
}

async function bindUserToFiscalScope({ user, scope }) {
    const ephemeralPinHash = await createActionPinHash(String(crypto.randomInt(100000, 999999)));
    await pool.query(
        `INSERT INTO fiscal_cashier_bindings (
             fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
             user_id, provider, provider_cashier_id, provider_cashier_login_ref,
             status, capability_scope, action_pin_hash, action_pin_set_at, action_pin_updated_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, 'checkbox', $6, $7, 'active', $8::text[], $9, NOW(), $5)`,
        [
            scope.fiscalProfileId,
            scope.fiscalRegisterId,
            scope.fiscalLocationId,
            CRM_PROFILE_KEY,
            user.id,
            `mock-cashier-${user.id}`,
            'park-middle-smoke',
            FISCAL_ACTIONS,
            ephemeralPinHash
        ]
    );
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
        cashierId: null,
        organizationId: null,
        registerId: null,
        shiftId: 'mock-shift-1',
        calls: [],
        receipts: new Map(),
        modes: new Map(),
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
                if (req.url === '/api/v1/cashier/signin' && req.method === 'POST') {
                    state.tokensIssued += 1;
                    return send(200, { access_token: `mock-token-${state.tokensIssued}`, token_type: 'bearer' });
                }
                if (req.url === '/api/v1/cashier/me' && req.method === 'GET') {
                    return send(200, {
                        id: state.cashierId,
                        blocked: false,
                        organization: { id: state.organizationId },
                        is_test: true,
                        certificate_end: '2099-01-01T00:00:00.000Z',
                        permissions: { sales: true, cash_payment: true, card_payment: true }
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
                    return send(200, {
                        id: state.shiftOpened ? state.shiftId : 'mock-shift-closed',
                        status: state.shiftOpened ? 'OPENED' : 'CLOSED',
                        cash_register_id: state.registerId,
                        cashier_id: state.cashierId
                    });
                }
                if (req.url.startsWith('/api/v1/shifts/') && req.method === 'GET') {
                    return send(200, {
                        id: state.shiftId,
                        status: state.shiftOpened ? 'OPENED' : 'CLOSED',
                        cash_register: { id: state.registerId, fiscal_number: '4000000000', active: true },
                        cashier: { id: state.cashierId }
                    });
                }
                if (req.url === '/api/v1/shifts' && req.method === 'POST') {
                    state.shiftOpened = true;
                    state.shiftId = body?.id || state.shiftId || crypto.randomUUID();
                    return send(201, {
                        id: state.shiftId,
                        status: 'OPENED',
                        cash_register_id: state.registerId,
                        cashier_id: state.cashierId
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
                        total_sum: body?.goods?.reduce((sum, item) => sum + Number(item.good?.price || 0) * Number(item.quantity || 1000) / 1000, 0) || 0,
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

function providerConfig(baseUrl, timeoutMs = 1000) {
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
        timeoutMs
    };
}

function createHttpProvider(mock, timeoutMs = 1000) {
    return createProviderFromConfig(providerConfig(mock.baseUrl, timeoutMs));
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
            CHECKBOX_PARK_MIDDLE_SMOKE_BASE_URL: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_BASE_URL,
            CHECKBOX_PARK_MIDDLE_SMOKE_LOGIN: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_LOGIN,
            CHECKBOX_PARK_MIDDLE_SMOKE_PASSWORD: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_PASSWORD,
            CHECKBOX_PARK_MIDDLE_SMOKE_LICENSE_KEY: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_LICENSE_KEY,
            CHECKBOX_PARK_MIDDLE_SMOKE_ACCESS_KEY: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_ACCESS_KEY,
            CHECKBOX_PARK_MIDDLE_SMOKE_DEVICE_ID: process.env.CHECKBOX_PARK_MIDDLE_SMOKE_DEVICE_ID,
            CHECKBOX_ALLOW_LOCAL_MOCK_HOST: process.env.CHECKBOX_ALLOW_LOCAL_MOCK_HOST,
            CHECKBOX_EXPECT_IS_TEST: process.env.CHECKBOX_EXPECT_IS_TEST
        };
        cashier = await seedUser({
            username: `cashier_http_smoke_${process.pid}`,
            name: 'Checkbox HTTP smoke cashier',
            role: 'reception'
        });
        scope = await seedFiscalScope({ cashier });
        secondCashier = await seedUser({
            username: `cashier_http_smoke_second_${process.pid}`,
            name: 'Checkbox HTTP smoke second cashier',
            role: 'reception'
        });
        await bindUserToFiscalScope({ user: secondCashier, scope });
        mock = await listenMockCheckbox();
        mock.state.cashierId = `mock-cashier-${cashier.id}`;
        mock.state.organizationId = scope.providerOrganizationId;
        mock.state.registerId = scope.providerRegisterId;
        process.env.CHECKBOX_INTEGRATION_ENABLED = 'true';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_BASE_URL = mock.baseUrl;
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_LOGIN = 'mock-login';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_PASSWORD = 'mock-password';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_LICENSE_KEY = 'mock-license';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_ACCESS_KEY = 'mock-access';
        process.env.CHECKBOX_PARK_MIDDLE_SMOKE_DEVICE_ID = 'eventgenix-smoke-device';
        process.env.CHECKBOX_ALLOW_LOCAL_MOCK_HOST = 'true';
        process.env.CHECKBOX_EXPECT_IS_TEST = 'true';
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
            totalUah: 180,
            code: 'park_child_day_cash',
            name: 'Park child day'
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

    test('draft cancellation is audited and paid orders cannot be cancelled', async () => {
        const draft = await createOrder({
            user: cashier,
            key: 'cancel-draft',
            tender: 'cash',
            totalUah: 90,
            itemCode: 'park_child_day_cash'
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
            totalUah: 100,
            itemCode: 'park_child_day_cash'
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

    test('manual terminal reference is metadata and does not globally block another payment', async () => {
        const first = await createOrder({
            user: cashier,
            key: 'terminal-ref-a',
            tender: 'card_terminal_manual',
            totalUah: 130,
            itemCode: 'park_child_day_card'
        });
        const second = await createOrder({
            user: cashier,
            key: 'terminal-ref-b',
            tender: 'card_terminal_manual',
            totalUah: 130,
            itemCode: 'park_child_day_card'
        });
        await confirmOrder({
            user: cashier,
            order: first,
            key: 'terminal-ref-a',
            tender: 'card_terminal_manual',
            amountMinor: '13000',
            terminalReference: 'same-terminal-report'
        });
        await confirmOrder({
            user: cashier,
            order: second,
            key: 'terminal-ref-b',
            tender: 'card_terminal_manual',
            amountMinor: '13000',
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
            totalUah: 120,
            itemCode: 'park_child_day_cash'
        });
        const confirmedCash = await confirmOrder({
            user: cashier,
            order: cashOrder,
            key: 'cash',
            tender: 'cash',
            amountMinor: '12000',
            receivedAmountMinor: '15000'
        });
        assert.ok(confirmedCash.fiscalOperationId);
        const cashProviderRequestUuid = await providerRequestUuidForOperation(confirmedCash.fiscalOperationId);

        const confirmation = await pool.query('SELECT confirmation_snapshot FROM payment_orders WHERE id = $1', [cashOrder.order.id]);
        assert.equal(confirmation.rows[0].confirmation_snapshot.received_amount_minor, '15000');
        assert.equal(confirmation.rows[0].confirmation_snapshot.change_amount_minor, '3000');

        const shiftOpenCallsBeforeCash = mock.state.calls.filter(call => call.path === '/api/v1/shifts').length;
        await runWorkerUntilIdle(createHttpProvider(mock));
        const shiftOpenCallsAfterCash = mock.state.calls.filter(call => call.path === '/api/v1/shifts').length;
        assert.ok(
            shiftOpenCallsAfterCash === shiftOpenCallsBeforeCash || shiftOpenCallsAfterCash === shiftOpenCallsBeforeCash + 1,
            'provider shift is reused when already OPENED or opened at most once for the register'
        );
        assert.equal(mock.state.calls.filter(call => call.path === '/api/v1/receipts/sell' && call.body?.id === cashProviderRequestUuid).length, 1);

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
            totalUah: 180,
            itemCode: 'park_child_day_card'
        });
        const confirmedCard = await confirmOrder({
            user: cashier,
            order: cardOrder,
            key: 'card',
            tender: 'card_terminal_manual',
            amountMinor: '18000',
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
        assert.deepEqual(saleCall.body.goods[0].good.tax, ['7']);
        assert.doesNotMatch(JSON.stringify(saleCall.body), /admission_tariff:/);
    });

    test('duplicate click, conflicting idempotency key, and concurrent confirmation do not duplicate sale jobs', async () => {
        const order = await createOrder({
            user: cashier,
            key: 'concurrent',
            tender: 'cash',
            totalUah: 90,
            itemCode: 'park_child_concurrent'
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
            totalUah: 95,
            itemCode: 'park_child_concurrent'
        });
        const results = await Promise.allSettled([
            confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: concurrentOrder.order.id,
                idempotencyKey: `confirm-parallel-a-${process.pid}`,
                body: { tender: 'cash', confirmedAmountMinor: '9500' }
            }),
            confirmPaymentOrder({
                dbPool: pool,
                user: cashier,
                orderId: concurrentOrder.order.id,
                idempotencyKey: `confirm-parallel-b-${process.pid}`,
                body: { tender: 'cash', confirmedAmountMinor: '9500' }
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
            totalUah: 40,
            itemCode: 'park_child_day_cash'
        });
        const firstConfirmed = await confirmOrder({
            user: cashier,
            order: first,
            key: 'report-cashier-a',
            tender: 'cash',
            amountMinor: '4000'
        });
        const second = await createOrder({
            user: secondCashier,
            key: 'report-cashier-b',
            tender: 'cash',
            totalUah: 50,
            itemCode: 'park_child_day_cash'
        });
        await confirmOrder({
            user: secondCashier,
            order: second,
            key: 'report-cashier-b',
            tender: 'cash',
            amountMinor: '5000'
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
        assert.ok(BigInt(report.totals.paymentTotalMinor) >= 9000n);

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

        const validationOrder = await createOrder({
            user: cashier,
            key: '422',
            tender: 'cash',
            totalUah: 70,
            itemCode: 'park_child_422'
        });
        const validationConfirm = await confirmOrder({
            user: cashier,
            order: validationOrder,
            key: '422',
            tender: 'cash',
            amountMinor: '7000'
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
            totalUah: 80,
            itemCode: 'park_child_timeout'
        });
        const timeoutConfirm = await confirmOrder({
            user: cashier,
            order: timeoutOrder,
            key: 'timeout',
            tender: 'card_terminal_manual',
            amountMinor: '8000',
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
                totalUah: 60,
                itemCode: mode === 'pending' ? 'park_child_pending' : 'park_child_malformed'
            });
            const confirmed = await confirmOrder({
                user: cashier,
                order,
                key: mode,
                tender: 'cash',
                amountMinor: '6000'
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
