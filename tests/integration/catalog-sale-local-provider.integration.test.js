/**
 * Full local PARK/DAR catalog_sale QA through real HTTP routes, payment services,
 * readiness and outbox, backed by disposable PostgreSQL and a loopback-only
 * Checkbox provider mock.
 */
'use strict';

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { pool } = require('../../db');
const { assertSafeIsolatedTestUrl, assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    PLANNED_RECEIPT_COUNT,
    createOneShotPostSubmitUnknownFetch
} = require('../../scripts/checkbox-single-register-mutation-qa');
const { createCheckboxProviderFactory } = require('../../services/checkbox/provider');
const { processPaymentOutboxJobs } = require('../../services/payments/paymentOutboxWorker');
const { requestPhase1ShiftClose } = require('../../services/payments/paymentReadinessService');
const { requestSharedTestDrain, requestSharedTestResume } = require('../../services/payments/sharedTestDayService');
const { createCatalogSalePaymentOrder } = require('../../services/payments/catalogSaleService');
const { handleCheckboxWebhook } = require('../../services/checkbox/webhookService');

const ROOT = path.join(__dirname, '..', '..');
const BASE_URL = process.env.TEST_URL || '';
const MOCK_PORT = Number(process.env.CHECKBOX_LOCAL_QA_MOCK_PORT || 0);
const ACTIONS = Object.freeze([
    'payments.view',
    'payments.create',
    'payments.confirm_received',
    'fiscal.shift.open',
    'fiscal.shift.close'
]);
const ACTOR_ACTIONS = Object.freeze([...ACTIONS, 'fiscal.configure']);
const SHARED_REGISTER = Object.freeze({
    locationAlias: 'shared_test',
    registerAlias: 'shared_test',
    registerName: 'Тестова каса',
    ref: 'SHARED_TEST_LOCAL_QA'
});
const SCOPES = Object.freeze({
    event_genix: Object.freeze({ routeOptionId: 'park_test', businessLabel: 'PARK' }),
    dar: Object.freeze({ routeOptionId: 'dar_test', businessLabel: 'DAR' })
});

function requireIsolatedInputs() {
    assert.equal(process.env.RUN_CATALOG_SALE_LOCAL_QA_INTEGRATION, 'true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.equal(process.env.NODE_ENV, 'test');
    assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
    assertSafeIsolatedTestUrl(BASE_URL);
    assert.ok(Number.isSafeInteger(MOCK_PORT) && MOCK_PORT > 0);
    assert.equal(process.env.CHECKBOX_EXPECT_IS_TEST, 'true');
    assert.equal(process.env.CHECKBOX_INTEGRATION_ENABLED, 'true');
    assert.equal(process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED, 'true');
    assert.equal(process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED, 'true');
}

async function insertUser({ username, name, contexts, actions = ACTIONS }) {
    const password = crypto.randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
        `INSERT INTO users (
             username, password_hash, role, name, is_active,
             action_allowlist, business_contexts, default_business_context
         )
         VALUES ($1, $2, 'creator', $3, TRUE, $4::text[], $5::text[], $6)
         RETURNING id`,
        [username, passwordHash, name, actions, contexts, contexts[0]]
    );
    return {
        id: Number(result.rows[0].id),
        username,
        password,
        role: 'creator',
        actionAllowlist: actions,
        businessContexts: contexts,
        defaultBusinessContext: contexts[0]
    };
}

async function seedQaData() {
    const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    const actor = await insertUser({
        username: `local_qa_actor_${suffix}`,
        name: 'Local QA actor',
        contexts: ['event_genix', 'dar'],
        actions: ACTOR_ACTIONS
    });
    const testCashier = await insertUser({
        username: `local_qa_cashier_${suffix}`,
        name: 'Local QA test cashier',
        contexts: ['event_genix', 'dar']
    });
    const users = { actor, testCashier };
    const organizationId = `local-qa-org-${suffix}`;
    const registerProviderId = `local-qa-register-${suffix}`;
    const cashierProviderId = `local-qa-cashier-${suffix}`;
    const profile = await pool.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name, provider,
             provider_organization_id, currency, status
         )
         VALUES ('event_genix', 'local_qa_legal_entity', 'LOCAL QA LEGAL ENTITY', 'checkbox', $1, 'UAH', 'active')
         RETURNING id`,
        [organizationId]
    );
    const location = await pool.query(
        `INSERT INTO fiscal_locations (
             fiscal_profile_id, crm_profile_key, location_alias, display_name, status
         )
         VALUES ($1, 'event_genix', $2, 'Local QA shared test location', 'active')
         RETURNING id`,
        [profile.rows[0].id, SHARED_REGISTER.locationAlias]
    );
    const register = await pool.query(
        `INSERT INTO fiscal_registers (
             fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
             display_name, provider, provider_register_id, provider_license_ref,
             status, feature_enabled, acceptance_enabled, metadata
         )
         VALUES ($1, $2, 'event_genix', $3, $4, 'checkbox', $5, $6,
                 'active', TRUE, TRUE, $7::jsonb)
         RETURNING id`,
        [
            profile.rows[0].id,
            location.rows[0].id,
            SHARED_REGISTER.registerAlias,
            SHARED_REGISTER.registerName,
            registerProviderId,
            SHARED_REGISTER.ref,
            JSON.stringify({ expected_is_test: true, integration_owner: actor.id })
        ]
    );
    const binding = await pool.query(
        `INSERT INTO fiscal_cashier_bindings (
             fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
             user_id, provider, provider_cashier_id, provider_cashier_login_ref,
             status, capability_scope, cashier_name
         )
         VALUES ($1, $2, $3, 'event_genix', $4, 'checkbox', $5, $6,
                 'active', $7::text[], 'Shared test cashier')
         RETURNING id`,
        [
            profile.rows[0].id,
            register.rows[0].id,
            location.rows[0].id,
            testCashier.id,
            cashierProviderId,
            SHARED_REGISTER.ref,
            ACTIONS
        ]
    );
    const physical = {
        fiscalProfileId: Number(profile.rows[0].id),
        fiscalLocationId: Number(location.rows[0].id),
        fiscalRegisterId: Number(register.rows[0].id),
        selectedBindingId: Number(binding.rows[0].id),
        selectedUser: testCashier,
        organizationId,
        registerProviderId,
        cashierProviderId,
        definition: SHARED_REGISTER
    };
    const contexts = Object.fromEntries(Object.entries(SCOPES).map(([businessContext, definition]) => [
        businessContext,
        { ...physical, businessContext, routeOptionId: definition.routeOptionId, businessLabel: definition.businessLabel }
    ]));

    await pool.query(
        `INSERT INTO fiscal_sale_routes (
             route_option_id, business_context, fiscal_profile_id, fiscal_location_id,
             fiscal_register_id, mode, expected_is_test, status, feature_enabled,
             acceptance_enabled, shared_register_group, metadata
         )
         VALUES
             ('park_test', 'event_genix', $1, $2, $3, 'test', TRUE, 'active', TRUE, TRUE, 'shared_local_qa', '{}'::jsonb),
             ('dar_test', 'dar', $1, $2, $3, 'test', TRUE, 'active', TRUE, TRUE, 'shared_local_qa', '{}'::jsonb)`,
        [physical.fiscalProfileId, physical.fiscalLocationId, physical.fiscalRegisterId]
    );

    await pool.query(`
        INSERT INTO products
            (id, business_context, code, timeline_code, label, name, category, duration, price, is_active, availability_status)
        VALUES
            ('local_qa_park_inactive', 'event_genix', 'LQPI', 'LQPI', 'Inactive', 'Inactive', 'local_qa', 0, 0, FALSE, 'active'),
            ('local_qa_park_zero', 'event_genix', 'LQPZ', 'LQPZ', 'Zero', 'Zero', 'local_qa', 0, 0, TRUE, 'active'),
            ('local_qa_park_ambiguous', 'event_genix', 'LQPA', 'LQPA', 'Ambiguous', 'Ambiguous', 'local_qa', 0, 0, TRUE, 'active')
    `);
    await pool.query(`
        INSERT INTO price_rules (code, name, value, unit, category, product_id)
        VALUES
            ('local_qa_park_inactive_price', 'Inactive', 100, 'грн', 'local_qa', 'local_qa_park_inactive'),
            ('local_qa_park_zero_price', 'Zero', 0, 'грн', 'local_qa', 'local_qa_park_zero'),
            ('local_qa_park_ambiguous_a', 'Ambiguous A', 100, 'грн', 'local_qa', 'local_qa_park_ambiguous'),
            ('local_qa_park_ambiguous_b', 'Ambiguous B', 200, 'грн', 'local_qa', 'local_qa_park_ambiguous')
    `);

    for (const context of Object.values(contexts)) {
        await pool.query(
            `INSERT INTO fiscal_item_mappings (
                 fiscal_profile_id, fiscal_register_id, crm_profile_key, source_type,
                 item_type, item_code, fiscal_item_name, provider, provider_tax_id,
                 tax_code, tax_rate_bps, tax_mode, status, business_context
             )
             SELECT $1, $2, 'event_genix', 'catalog_sale', 'catalog_sale', eligible.id,
                    eligible.name, 'checkbox', NULL, NULL, NULL, 'untaxed', 'active', $3
               FROM (
                    SELECT p.id, p.name
                      FROM products p
                      JOIN price_rules pr ON pr.product_id = p.id AND pr.value > 0
                     WHERE p.business_context = $3
                       AND p.is_active = TRUE
                       AND COALESCE(p.availability_status, 'active') = 'active'
                     GROUP BY p.id, p.name
                    HAVING COUNT(*) = 1
               ) eligible`,
            [context.fiscalProfileId, context.fiscalRegisterId, context.businessContext]
        );
    }

    await pool.query(
            `INSERT INTO fiscal_item_mappings (
                 fiscal_profile_id, fiscal_register_id, crm_profile_key, source_type,
                 item_type, item_code, fiscal_item_name, provider, provider_tax_id,
                 tax_code, tax_rate_bps, tax_mode, status, business_context
             )
             SELECT $1, $2, 'event_genix', 'admission_ticket', 'admission_ticket', type.code,
                type.name, 'checkbox', NULL, NULL, NULL, 'untaxed', 'active', 'event_genix'
           FROM admission_ticket_types type
          WHERE type.business_context = 'event_genix' AND type.is_active = TRUE`,
        [contexts.event_genix.fiscalProfileId, contexts.event_genix.fiscalRegisterId]
    );

    return { users, contexts, physical };
}

function contextForRequest(req, body, physical) {
    const authorization = String(req.headers.authorization || '');
    if (authorization.replace(/^Bearer\s+/i, '') === 'local-qa-token-shared') return physical;
    const license = String(req.headers['x-license-key'] || '');
    if (license === process.env[`CHECKBOX_${physical.definition.ref}_LICENSE_KEY`]) return physical;
    const login = String(body?.login || '');
    if (login === process.env[`CHECKBOX_${physical.definition.ref}_LOGIN`]) return physical;
    return null;
}

async function startMockCheckbox(physical) {
    const state = {
        requests: [],
        calls: [],
        receipts: new Map(),
        saleBodies: new Map(),
        salePostsByUuid: new Map(),
        receiptLookupsByUuid: new Map(),
        shifts: new Map(),
        currentShiftId: null
    };
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body = {};
            try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
            const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
            state.requests.push({ method: req.method, pathname });
            const context = contextForRequest(req, body, physical);
            state.calls.push({ method: req.method, path: pathname, context: context ? 'shared_test' : null, requestId: body?.id || null });
            const send = (status, payload) => {
                res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(payload));
            };
            if (pathname === '/api/v1/cashier/signin' && req.method === 'POST') {
                if (!context) return send(401, { error: 'local_qa_auth_failed' });
                return send(200, { access_token: 'local-qa-token-shared', token_type: 'bearer' });
            }
            if (!context) return send(401, { error: 'local_qa_context_missing' });
            if (state.failReads && req.method === 'GET') return send(503, { error: 'local_qa_read_unavailable' });
            const shift = state.currentShiftId ? state.shifts.get(state.currentShiftId) : null;
            if (pathname === '/api/v1/cashier/me' && req.method === 'GET') {
                return send(200, {
                    id: context.cashierProviderId,
                    organization: { id: context.organizationId },
                    blocked: false,
                    is_test: true,
                    certificate_end: '2099-01-01T00:00:00.000Z',
                    permissions: { sales: true, cash_payment: true, card_payment: true }
                });
            }
            if (pathname === '/api/v1/cash-registers/info' && req.method === 'GET') {
                return send(200, {
                    id: context.registerProviderId,
                    organization_id: context.organizationId,
                    fiscal_number: 'LOCAL-QA-SHARED',
                    is_test: state.registerIsTest !== false,
                    offline_mode: false,
                    stay_offline: false,
                    has_shift: shift?.status === 'OPENED',
                    documents_state: { last_receipt_code: null, last_report_code: null }
                });
            }
            if (pathname === '/api/v1/cashier/check-signature' && req.method === 'GET') {
                return send(200, { online: true, type: 'CLOUD_SIGNATURE_3', shift_open_possibility: true });
            }
            if (pathname === '/api/v1/cashier/tax' && req.method === 'GET') return send(200, []);
            if (pathname === '/api/v1/shifts' && req.method === 'POST') {
                const shiftId = String(body.id || '');
                if (!shiftId) return send(422, { error: 'shift_id_required' });
                if (shift?.status === 'OPENED' && shift.id !== shiftId) {
                    return send(409, { error: 'shift_already_open' });
                }
                const opened = state.shifts.get(shiftId) || {
                    id: shiftId,
                    status: 'OPENED',
                    cash_register: { id: context.registerProviderId },
                    cashier: { id: context.cashierProviderId }
                };
                opened.status = 'OPENED';
                state.shifts.set(shiftId, opened);
                state.currentShiftId = shiftId;
                return send(202, opened);
            }
            if (pathname === '/api/v1/cashier/shift' && req.method === 'GET') {
                if (!shift || shift.status === 'CLOSED') return send(404, { error: 'shift_not_open' });
                return send(200, { id: shift.id, status: shift.status, cash_register: { id: context.registerProviderId } });
            }
            const shiftMatch = pathname.match(/^\/api\/v1\/shifts\/([^/]+)$/);
            if (shiftMatch && req.method === 'GET') {
                const found = state.shifts.get(decodeURIComponent(shiftMatch[1]));
                if (!found) return send(404, { error: 'shift_not_found' });
                return send(200, found);
            }
            if (pathname === '/api/v1/shifts/close' && req.method === 'POST') {
                if (!shift || shift.status !== 'OPENED') return send(404, { error: 'shift_not_open' });
                shift.status = 'CLOSED';
                state.currentShiftId = null;
                return send(202, {
                    id: shift.id,
                    status: 'CLOSED',
                    cash_register: { id: context.registerProviderId },
                    cashier: { id: context.cashierProviderId }
                });
            }
            if (pathname === '/api/v1/receipts/validate' && req.method === 'POST') return send(200, { valid: true });
            if (pathname === '/api/v1/receipts/sell' && req.method === 'POST') {
                const uuid = String(body.id || '');
                state.saleBodies.set(uuid, body);
                state.salePostsByUuid.set(uuid, Number(state.salePostsByUuid.get(uuid) || 0) + 1);
                const total = (body.goods || []).reduce((sum, item) => sum + BigInt(item.good.price) * BigInt(item.quantity) / 1000n, 0n);
                const paid = BigInt(body.payments?.[0]?.value || total);
                const receipt = {
                    id: uuid,
                    status: 'DONE',
                    type: 'SELL',
                    total_sum: total.toString(),
                    total_payment: paid.toString(),
                    total_rest: body.payments?.[0]?.type === 'CASH' ? (paid - total).toString() : '0',
                    cash_register_id: context.registerProviderId,
                    cashier_id: context.cashierProviderId,
                    shift_id: shift.id,
                    organization_id: context.organizationId,
                    payments: body.payments || [],
                    context: body.context,
                    fiscal_code: `LOCAL-QA-${state.receipts.size + 1}`,
                    serial: state.receipts.size + 1,
                    tax_url: `https://api.checkbox.ua/api/v1/receipts/${encodeURIComponent(uuid)}`
                };
                state.receipts.set(uuid, receipt);
                return send(201, receipt);
            }
            const receiptMatch = pathname.match(/^\/api\/v1\/receipts\/([^/]+)$/);
            if (receiptMatch && req.method === 'GET') {
                const uuid = decodeURIComponent(receiptMatch[1]);
                state.receiptLookupsByUuid.set(uuid, Number(state.receiptLookupsByUuid.get(uuid) || 0) + 1);
                const receipt = state.receipts.get(uuid);
                return receipt ? send(200, receipt) : send(404, { error: 'not_found' });
            }
            return send(404, { error: 'local_qa_not_found' });
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(MOCK_PORT, '127.0.0.1', resolve);
    });
    return { state, close: () => new Promise(resolve => server.close(resolve)) };
}

async function api(token, method, pathname, { body, idempotencyKey, routeOptionId } = {}) {
    const response = await fetch(`${BASE_URL}${pathname}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(routeOptionId ? { 'X-Fiscal-Route-Option': routeOptionId } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function login(user) {
    const response = await api('', 'POST', '/api/auth/login', { body: { username: user.username, password: user.password } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.ok(response.body.token);
    return response.body.token;
}

async function createCatalogOrder(token, routeOptionId, context, cashierBindingId, tender, items, options = {}) {
    const body = {
        businessContext: context,
        routeOptionId,
        cashierBindingId,
        tender,
        items,
        ...(options.discountCodes ? { discountCodes: options.discountCodes } : {})
    };
    const response = await api(token, 'POST', '/api/payments/catalog/orders', {
        body,
        idempotencyKey: options.idempotencyKey || crypto.randomUUID()
    });
    assert.equal(response.status, options.expectedStatus || 201, JSON.stringify(response.body));
    return { response, body };
}

async function confirmOrder(token, order, tender, key = crypto.randomUUID()) {
    const body = {
        tender,
        confirmedAmountMinor: order.totalAmountMinor,
        ...(tender === 'card_terminal_manual' ? { terminalShowedSuccess: true, terminalReference: 'LOCAL-QA' } : {})
    };
    const response = await api(token, 'POST', `/api/payments/orders/${order.id}/confirm`, { body, idempotencyKey: key });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return { response, body, key };
}

async function processAllAvailableJobs(provider, { waitForQueued = true } = {}) {
    const summaries = [];
    const deadline = Date.now() + 5000;
    for (let index = 0; index < (waitForQueued ? 100 : 20); index += 1) {
        const summary = await processPaymentOutboxJobs({ dbPool: pool, provider, batchSize: 25, lockedBy: `catalog-local-qa-${process.pid}` });
        summaries.push(summary);
        if (summary.claimed === 0) {
            const queued = waitForQueued && (await pool.query("SELECT COUNT(*)::int AS count FROM payment_outbox_jobs WHERE status='queued'")).rows[0].count;
            if (!queued || Date.now() >= deadline) break;
            // SKIP LOCKED may temporarily produce no claim even while a job remains queued.
            // Do not alter job state/backoff or retry failed/unknown work in this wait.
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    return summaries;
}

async function assertProviderPayload(mock, orderId) {
    const result = await pool.query(
        `SELECT fo.provider_operation_id,
                jsonb_agg(jsonb_build_object(
                    'name', item.item_name,
                    'price', item.unit_price_minor::text,
                    'quantity', item.quantity_millis::text,
                    'tax_mode', item.tax_mode
                ) ORDER BY item.line_number) AS items
           FROM fiscal_operations fo
           JOIN payment_order_items item ON item.payment_order_id = fo.payment_order_id
          WHERE fo.payment_order_id = $1 AND fo.operation_type = 'sale'
          GROUP BY fo.provider_operation_id`,
        [orderId]
    );
    assert.equal(result.rows.length, 1);
    const uuid = result.rows[0].provider_operation_id;
    const payload = mock.state.saleBodies.get(uuid);
    assert.ok(payload, `missing provider payload for order ${orderId}; operation=${uuid}; mock=${[...mock.state.saleBodies.keys()].join(',')}`);
    assert.deepEqual(payload.goods.map(item => ({
        name: item.good.name,
        price: String(item.good.price),
        quantity: String(item.quantity),
        tax: item.good.tax ?? null
    })), result.rows[0].items.map(item => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        tax: null
    })));
    assert.ok(result.rows[0].items.every(item => item.tax_mode === 'untaxed'));
    return uuid;
}

async function assertConcurrentPaymentAdmission({ fixture, shiftId, itemCode }) {
    let releaseStop;
    const released = new Promise(resolve => { releaseStop = resolve; });
    let reachedInsert;
    const atInsert = new Promise(resolve => { reachedInsert = resolve; });
    const stopPool = { connect: async () => {
        const client = await pool.connect();
        return { release: () => client.release(), query: async (...args) => {
            const result = await client.query(...args);
            if (String(args[0]).includes('INSERT INTO fiscal_register_payment_drains')) {
                reachedInsert();
                await released;
            }
            return result;
        } };
    } };
    let admissionPid;
    const admissionPool = { connect: async () => {
        const client = await pool.connect();
        admissionPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        return { release: () => client.release(), query: (...args) => client.query(...args) };
    } };
    const before = (await pool.query('SELECT COUNT(*)::int AS count FROM payment_orders')).rows[0].count;
    const stop = requestSharedTestDrain({ dbPool: stopPool, user: fixture.users.actor, shiftId,
        routeOptionId: 'park_test', idempotencyKey: 'stop-while-accepted-card-pending', body: {}, env: process.env });
    let admission;
    try {
        await Promise.race([atInsert, stop.then(() => { throw new Error('Stop did not insert a new drain'); })]);
        admission = createCatalogSalePaymentOrder({ dbPool: admissionPool, user: fixture.users.actor,
            idempotencyKey: 'concurrent-new-payment-after-stop', requireCheckboxIntegrationReady: true,
            body: { businessContext: 'event_genix', routeOptionId: 'park_test',
                cashierBindingId: fixture.contexts.event_genix.selectedBindingId, tender: 'cash',
                items: [{ itemCode, quantityMillis: 1000 }] }, env: process.env })
            .then(() => ({ accepted: true }), error => ({ error }));
        let waiting = false;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            if (admissionPid) waiting = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                WHERE pid=$1 AND wait_event_type='Lock' AND wait_event='advisory') AS waiting`, [admissionPid])).rows[0].waiting;
            if (waiting) break;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true, 'new payment must wait for the uncommitted physical stop');
        releaseStop();
        await stop;
        assert.equal((await admission).error?.code, 'shared_test_register_draining');
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM payment_orders')).rows[0].count, before);
    } finally {
        releaseStop();
        await Promise.allSettled([stop, admission].filter(Boolean));
    }
}

async function assertWebhookLifecycleSerialization({ fixture, phase, runLifecycle }) {
    const operation = (await pool.query(`SELECT provider_operation_id FROM fiscal_operations operation
        WHERE fiscal_register_id=$1 AND operation_type='sale' AND status='fiscalized'
        AND NOT EXISTS (SELECT 1 FROM payment_outbox_jobs job WHERE job.fiscal_operation_id=operation.id AND job.job_type='receipt_status_lookup')
        ORDER BY id LIMIT 1`,
    [fixture.physical.fiscalRegisterId])).rows[0];
    assert.ok(operation);
    let releaseLifecycle;
    const released = new Promise(resolve => { releaseLifecycle = resolve; });
    let reachedZero;
    const atZero = new Promise(resolve => { reachedZero = resolve; });
    let blockerReads = 0;
    const lifecyclePool = { connect: async () => {
        const client = await pool.connect();
        return { release: () => client.release(), query: async (...args) => {
            const result = await client.query(...args);
            if (String(args[0]).includes('WITH blocking_orders AS') && ++blockerReads === 2) {
                assert.equal(result.rows[0].blocker_count, 0);
                reachedZero();
                await released;
            }
            return result;
        } };
    } };
    let webhookPid;
    let webhookDone = false;
    const webhookPool = { connect: async () => {
        const client = await pool.connect();
        webhookPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        return { release: () => client.release(), query: (...args) => client.query(...args) };
    } };
    const lifecycle = runLifecycle(lifecyclePool);
    let webhook;
    try {
        await Promise.race([atZero, lifecycle.then(() => { throw new Error('Lifecycle skipped authoritative zero check'); })]);
        webhook = handleCheckboxWebhook({ dbPool: webhookPool, rawBody: Buffer.from(JSON.stringify({
            event_id: `race-${phase}`, provider_operation_id: operation.provider_operation_id, status: 'DONE'
        })) }).finally(() => { webhookDone = true; });
        // Observe the actual PostgreSQL wait, not a delay-based guess about request order.
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (!webhookDone && Date.now() < deadline) {
            if (webhookPid) waiting = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                WHERE pid=$1 AND wait_event_type='Lock' AND wait_event='advisory') AS waiting`, [webhookPid])).rows[0].waiting;
            if (waiting) break;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true, 'webhook must wait for lifecycle physical lock after its final zero-blocker read');
        assert.equal(webhookDone, false);
        releaseLifecycle();
        const result = await lifecycle;
        const admitted = await webhook;
        assert.equal(admitted.queued, true, 'needed lookup recovery remains accepted after lifecycle commit');
        return result;
    } finally {
        releaseLifecycle();
        await Promise.allSettled([lifecycle, webhook].filter(Boolean));
    }
}

async function assertCurrentResumeActor({ fixture, drainId, resumeRequest, mock }) {
    const original = (await pool.query('SELECT is_active, action_denylist, business_contexts FROM users WHERE id=$1', [fixture.users.actor.id])).rows[0];
    for (const fault of ['is_active', 'action_denylist', 'business_contexts']) {
        let revoked = false;
        const beforePosts = mock.state.requests.filter(row => row.method !== 'GET').length;
        try {
            await assert.rejects(() => requestSharedTestResume({ user: fixture.users.actor, drainId, ...resumeRequest,
                fetchImpl: async (url, options) => {
                    if (!revoked && String(options?.method || 'GET').toUpperCase() === 'GET') {
                        const value = fault === 'is_active' ? false : fault === 'action_denylist' ? ['fiscal.shift.close'] : ['event_genix'];
                        await pool.query(`UPDATE users SET ${fault}=$2 WHERE id=$1`, [fixture.users.actor.id, value]);
                        revoked = true;
                    }
                    return fetch(url, options);
                } }), error => ['FiscalAccessError', 'PaymentReadinessError', 'TestDrainError'].includes(error.name),
            `resume must rehydrate actor after provider I/O: ${fault}`);
            assert.equal(revoked, true, 'preflight authorized before fixture access revocation');
            assert.equal((await pool.query('SELECT status FROM fiscal_register_payment_drains WHERE id=$1', [drainId])).rows[0].status, 'closed');
            assert.equal(mock.state.requests.filter(row => row.method !== 'GET').length, beforePosts);
        } finally {
            await pool.query(`UPDATE users SET is_active=$2, action_denylist=$3, business_contexts=$4 WHERE id=$1`,
                [fixture.users.actor.id, original.is_active, original.action_denylist, original.business_contexts]);
        }
    }
}

async function closeQaShift({ fixture, businessContext, provider, actorToken, mock }) {
    const shifts = await pool.query(
        `SELECT id, business_context
           FROM fiscal_shifts
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND status = 'open'
          ORDER BY id`,
        [fixture.physical.fiscalProfileId, fixture.physical.fiscalRegisterId]
    );
    assert.equal(shifts.rows.length, 1);
    assert.equal(shifts.rows[0].business_context, businessContext);
    const routeOptionId = SCOPES[businessContext].routeOptionId;
    const shiftId = Number(shifts.rows[0].id);
    const request = { body: {}, routeOptionId, idempotencyKey: `local-test-drain-${businessContext}` };
    const postCount = () => mock.state.requests.filter(row => row.method !== 'GET').length;
    const beforeDrainPosts = postCount();
    const drains = await Promise.all([api(actorToken, 'POST', `/api/payments/shifts/${shiftId}/phase1-drain`, request),
        api(actorToken, 'POST', `/api/payments/shifts/${shiftId}/phase1-drain`, { ...request, idempotencyKey: `${request.idempotencyKey}-second` })]);
    for (const response of drains) assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(drains[0].body.drain.id, drains[1].body.drain.id);
    assert.equal(postCount(), beforeDrainPosts, 'stop performs provider reads only');
    const drainId = drains[0].body.drain.id;
    const invariantClient = await pool.connect();
    try {
        await invariantClient.query('BEGIN');
        // Reapplying the additive DDL must preserve an already-active stop and its history.
        await invariantClient.query(fs.readFileSync(path.join(ROOT, 'db/migrations/352_shared_test_payment_drains.sql'), 'utf8'));
        const assertConstraint = async (sql, params, code) => {
            await invariantClient.query('SAVEPOINT invariant_case');
            await assert.rejects(() => invariantClient.query(sql, params), error => error.code === code);
            await invariantClient.query('ROLLBACK TO SAVEPOINT invariant_case');
        };
        await assertConstraint('UPDATE fiscal_register_payment_drains SET scope_fingerprint=repeat(\'a\',64) WHERE id=$1', [drainId], '23514');
        await assertConstraint('DELETE FROM fiscal_register_payment_drains WHERE id=$1', [drainId], '23514');
        await assertConstraint(`INSERT INTO fiscal_register_payment_drains
            (fiscal_profile_id,fiscal_register_id,fiscal_shift_id,initiating_route_option_id,scope_fingerprint,initiated_by_user_id,drain_idempotency_key,status)
            SELECT fiscal_profile_id,fiscal_register_id,999999999,initiating_route_option_id,scope_fingerprint,initiated_by_user_id,'drain:bad-fk','draining'
            FROM fiscal_register_payment_drains WHERE id=$1`, [drainId], '23505');
        // A separate register with no active row isolates the composite FK from the active unique index.
        await assertConstraint(`INSERT INTO fiscal_register_payment_drains
            (fiscal_profile_id,fiscal_register_id,fiscal_shift_id,initiating_route_option_id,scope_fingerprint,initiated_by_user_id,drain_idempotency_key,status)
            SELECT fiscal_profile_id,999999999,999999999,initiating_route_option_id,scope_fingerprint,initiated_by_user_id,'drain:bad-scope','draining'
            FROM fiscal_register_payment_drains WHERE id=$1`, [drainId], '23503');
        await invariantClient.query('ROLLBACK');
    } finally { invariantClient.release(); }
    const earlyResume = await api(actorToken, 'POST', `/api/payments/test-drains/${drainId}/resume`, {
        routeOptionId, idempotencyKey: `early-resume-${drainId}`, body: { confirmNextTestDay: true } });
    assert.equal(earlyResume.status, 409);
    for (const business of ['event_genix', 'dar']) {
        const rejected = await api(actorToken, 'POST', '/api/payments/catalog/orders', { idempotencyKey: `blocked-${business}-${drainId}`,
            body: { businessContext: business, routeOptionId: SCOPES[business].routeOptionId,
                cashierBindingId: fixture.contexts[business].selectedBindingId, tender: 'cash', items: [{ itemCode: 'dar_logic_single', quantityMillis: 1000 }] } });
        assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
        assert.ok(['shared_test_register_draining', 'shared_test_register_owned_by_other_business'].includes(rejected.body.code), JSON.stringify(rejected.body));
    }
    const old = (await pool.query("SELECT * FROM fiscal_register_payment_drains WHERE status='resumed' ORDER BY id LIMIT 1")).rows[0];
    if (old) {
        const stale = await api(actorToken, 'POST', `/api/payments/test-drains/${old.id}/resume`, { routeOptionId: old.initiating_route_option_id,
            idempotencyKey: `stale-resume-${old.id}`, body: { confirmNextTestDay: true } });
        assert.equal(stale.status, 200, JSON.stringify(stale.body));
        assert.equal(stale.body.activeDrain.id, drainId, 'cycle A replay cannot clear B');
    }
    const executeClose = dbPool => requestPhase1ShiftClose({
        dbPool,
        user: fixture.users.actor,
        routeOptionId,
        shiftId: shifts.rows[0].id,
        idempotencyKey: `local-qa-close-${businessContext}`,
        body: {},
        env: process.env
    });
    const close = businessContext === 'dar'
        ? await assertWebhookLifecycleSerialization({ fixture, phase: `close-${businessContext}`, runLifecycle: executeClose })
        : await executeClose(pool);
    assert.equal(close.status, 'closing');
    const drain = await processAllAvailableJobs(provider, { waitForQueued: true });
    assert.equal(drain.reduce((sum, item) => sum + item.failed, 0), 0);
    const final = await pool.query(
        `SELECT
             (SELECT COUNT(*)::int
                FROM fiscal_shifts
               WHERE fiscal_profile_id = $1
                 AND fiscal_register_id = $2
                 AND status IN ('opening', 'open', 'closing')) AS active_shifts,
             (SELECT COUNT(*)::int
                FROM payment_outbox_jobs job
                LEFT JOIN payment_orders po ON po.id = job.payment_order_id
                LEFT JOIN fiscal_operations operation ON operation.id = job.fiscal_operation_id
               WHERE COALESCE(po.fiscal_register_id, operation.fiscal_register_id) = $2
                 AND job.status IN ('queued', 'claimed', 'running', 'failed', 'dead')) AS pending_jobs,
             (SELECT COUNT(*)::int
                FROM fiscal_operations
               WHERE fiscal_register_id = $2 AND status = 'unknown') AS unknown_operations`,
        [fixture.physical.fiscalProfileId, fixture.physical.fiscalRegisterId]
    );
    const queuedDiagnostics = (await pool.query(`SELECT job_type, status, last_error_code,
        (next_run_at > NOW()) AS scheduled_later FROM payment_outbox_jobs WHERE status <> 'done'`)).rows;
    assert.deepEqual(final.rows[0], { active_shifts: 0, pending_jobs: 0, unknown_operations: 0 }, JSON.stringify({ queuedDiagnostics, drain }));
    assert.equal((await pool.query('SELECT status FROM fiscal_register_payment_drains WHERE id=$1', [drainId])).rows[0].status, 'closed');
    const beforeResumePosts = postCount();
    const resumeRequest = { routeOptionId, idempotencyKey: `resume-${drainId}`, body: { confirmNextTestDay: true } };
    const wrongRoute = await api(actorToken, 'POST', `/api/payments/test-drains/${drainId}/resume`, {
        ...resumeRequest, routeOptionId: routeOptionId === 'park_test' ? 'dar_test' : 'park_test' });
    assert.notEqual(wrongRoute.status, 200);
    await assert.rejects(() => requestSharedTestResume({ user: fixture.users.testCashier, drainId, ...resumeRequest }),
        error => ['FiscalAccessError', 'PaymentReadinessError', 'TestDrainError'].includes(error.name));
    for (const fault of ['registerIsTest', 'failReads']) {
        mock.state[fault] = fault === 'failReads';
        try {
            const blocked = await api(actorToken, 'POST', `/api/payments/test-drains/${drainId}/resume`, resumeRequest);
            assert.notEqual(blocked.status, 200, `resume fails closed for ${fault}`);
            assert.equal((await pool.query('SELECT status FROM fiscal_register_payment_drains WHERE id=$1', [drainId])).rows[0].status, 'closed');
        } finally { delete mock.state[fault]; }
    }
    const completedJob = (await pool.query(`SELECT id, status FROM payment_outbox_jobs
        WHERE payment_order_id IN (SELECT id FROM payment_orders WHERE fiscal_register_id=$1)
        ORDER BY id LIMIT 1`, [fixture.physical.fiscalRegisterId])).rows[0];
    assert.ok(completedJob);
    await pool.query("UPDATE payment_outbox_jobs SET status='failed' WHERE id=$1", [completedJob.id]);
    try {
        const unresolved = await api(actorToken, 'POST', `/api/payments/test-drains/${drainId}/resume`, resumeRequest);
        assert.equal(unresolved.status, 409);
        assert.equal(unresolved.body.code, 'shared_test_resume_blocked_unresolved');
    } finally { await pool.query('UPDATE payment_outbox_jobs SET status=$2 WHERE id=$1', [completedJob.id, completedJob.status]); }
    if (businessContext === 'event_genix') {
        await assertCurrentResumeActor({ fixture, drainId, resumeRequest, mock });
        const offResume = await assertWebhookLifecycleSerialization({ fixture, phase: `resume-${businessContext}`,
            runLifecycle: dbPool => requestSharedTestResume({ dbPool, user: fixture.users.actor, drainId, ...resumeRequest,
                env: { ...process.env, CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'false' } }) });
        assert.equal(offResume.drain.status, 'resumed');
        assert.equal(offResume.paymentAcceptanceEnabled, false, 'resume cannot override global OFF');
        const recovered = await processAllAvailableJobs(provider);
        assert.equal(recovered.reduce((sum, item) => sum + item.failed, 0), 0);
    }
    const resumes = await Promise.all([api(actorToken, 'POST', `/api/payments/test-drains/${drainId}/resume`, resumeRequest),
        api(actorToken, 'POST', `/api/payments/test-drains/${drainId}/resume`, resumeRequest)]);
    for (const response of resumes) {
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.drain.status, 'resumed');
        assert.equal(response.body.activeDrain, null);
    }
    assert.equal(postCount(), beforeResumePosts, 'resume performs no provider authentication or mutation');
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM fiscal_audit_events WHERE event_type='shared_test_resumed' AND entity_id=$1", [drainId])).rows[0].count, 1);
    await assert.rejects(() => pool.query(`UPDATE fiscal_register_payment_drains SET status='closed',
        resumed_at=NULL, resumed_by_user_id=NULL, resume_idempotency_key=NULL WHERE id=$1`, [drainId]), error => error.code === '23514');
}

test('PARK/DAR catalog_sale full local provider QA', async () => {
    requireIsolatedInputs();
    const fixture = await seedQaData();
    const mock = await startMockCheckbox(fixture.physical);
    const created = { park: [], dar: [], admission: [] };
    const qaRunId = crypto.randomUUID();
    let reportWritten = false;
    let canonicalBrowser = null;
    try {
        const actorToken = await login(fixture.users.actor);

        const physicalTopology = await pool.query(
            `SELECT COUNT(DISTINCT fiscal_register_id)::int AS physical_registers,
                    COUNT(*)::int AS logical_routes
               FROM fiscal_sale_routes
              WHERE route_option_id IN ('park_test', 'dar_test')`
        );
        assert.deepEqual(physicalTopology.rows[0], { physical_registers: 1, logical_routes: 2 });
        const credentialedBindings = await pool.query(
            `SELECT COUNT(*)::int AS count
               FROM fiscal_cashier_bindings
              WHERE fiscal_profile_id = $1
                AND fiscal_register_id = $2
                AND status = 'active'
                AND provider_cashier_login_ref IS NOT NULL`,
            [fixture.physical.fiscalProfileId, fixture.physical.fiscalRegisterId]
        );
        assert.equal(credentialedBindings.rows[0].count, 1);
        assert.notEqual(fixture.users.actor.id, fixture.physical.selectedUser.id);

        const parkCashiers = await api(actorToken, 'GET', '/api/payments/catalog/cashiers?businessContext=event_genix&routeOptionId=park_test');
        const darCashiers = await api(actorToken, 'GET', '/api/payments/catalog/cashiers?businessContext=dar&routeOptionId=dar_test');
        assert.equal(parkCashiers.status, 200);
        assert.equal(darCashiers.status, 200);
        assert.deepEqual(parkCashiers.body.cashiers.map(row => row.id), [fixture.contexts.event_genix.selectedBindingId]);
        assert.deepEqual(darCashiers.body.cashiers.map(row => row.id), [fixture.contexts.dar.selectedBindingId]);
        assert.equal(fixture.contexts.event_genix.selectedBindingId, fixture.contexts.dar.selectedBindingId);
        assert.doesNotMatch(JSON.stringify({ park: parkCashiers.body, dar: darCashiers.body }), /login|credential|provider.*id|password|license|access.?key|device/i);

        const parkPilotState = await api(actorToken, 'GET', `/api/payments/pilot-register-state?businessContext=event_genix&routeOptionId=park_test&cashierBindingId=${fixture.contexts.event_genix.selectedBindingId}`);
        const darPilotState = await api(actorToken, 'GET', `/api/payments/pilot-register-state?businessContext=dar&routeOptionId=dar_test&cashierBindingId=${fixture.contexts.dar.selectedBindingId}`);
        assert.equal(parkPilotState.status, 200, JSON.stringify(parkPilotState.body));
        assert.equal(darPilotState.status, 200, JSON.stringify(darPilotState.body));
        assert.equal(parkPilotState.body.fiscalProfileId, fixture.physical.fiscalProfileId);
        assert.equal(darPilotState.body.fiscalProfileId, fixture.physical.fiscalProfileId);

        for (const [businessContext, context] of Object.entries(fixture.contexts)) {
            const preflight = await api(
                actorToken,
                'POST',
                '/api/payments/readiness/probe',
                {
                    body: {
                        force: true,
                        businessContext,
                        routeOptionId: context.routeOptionId,
                        cashierBindingId: context.selectedBindingId
                    }
                }
            );
            assert.equal(preflight.status, 200, JSON.stringify(preflight.body));
            assert.equal(preflight.body.integrationReady, true, JSON.stringify(preflight.body));
        }

        const parkCatalog = await api(actorToken, 'GET', '/api/payments/catalog/items?businessContext=event_genix&routeOptionId=park_test');
        const darCatalog = await api(actorToken, 'GET', '/api/payments/catalog/items?businessContext=dar&routeOptionId=dar_test');
        assert.equal(parkCatalog.status, 200, JSON.stringify(parkCatalog.body));
        assert.equal(darCatalog.status, 200, JSON.stringify(darCatalog.body));
        assert.equal(parkCatalog.body.items.length, 140);
        assert.equal(darCatalog.body.items.length, 21);
        assert.deepEqual(
            parkCatalog.body.items.filter(item => item.itemCode.startsWith('local_qa_park_')),
            []
        );
        const parkItem = parkCatalog.body.items[0];

        const rejectedPrice = await api(actorToken, 'POST', '/api/payments/catalog/orders', {
            idempotencyKey: 'local-qa-browser-price',
            body: {
                businessContext: 'event_genix',
                routeOptionId: 'park_test',
                cashierBindingId: fixture.contexts.event_genix.selectedBindingId,
                tender: 'cash',
                items: [{ itemCode: parkItem.itemCode, quantityMillis: 1000, price: 1 }]
            }
        });
        assert.equal(rejectedPrice.status, 422);

        for (const itemCode of ['local_qa_park_inactive', 'local_qa_park_zero', 'local_qa_park_ambiguous']) {
            const rejected = await api(actorToken, 'POST', '/api/payments/catalog/orders', {
                idempotencyKey: `local-qa-reject-${itemCode}`,
                body: {
                    businessContext: 'event_genix',
                    routeOptionId: 'park_test',
                    cashierBindingId: fixture.contexts.event_genix.selectedBindingId,
                    tender: 'cash',
                    items: [{ itemCode, quantityMillis: 1000 }]
                }
            });
            assert.equal(rejected.status, 409, `${itemCode}: ${JSON.stringify(rejected.body)}`);
        }

        const mixed = await api(actorToken, 'POST', '/api/payments/catalog/orders', {
            idempotencyKey: 'local-qa-mixed-context',
            body: {
                businessContext: 'event_genix',
                routeOptionId: 'park_test',
                cashierBindingId: fixture.contexts.event_genix.selectedBindingId,
                tender: 'cash',
                items: [{ itemCode: parkItem.itemCode }, { itemCode: 'dar_logic_single' }]
            }
        });
        assert.equal(mixed.status, 409);
        const wrongBinding = await api(actorToken, 'POST', '/api/payments/catalog/orders', {
            idempotencyKey: 'local-qa-wrong-binding',
            body: {
                businessContext: 'event_genix',
                routeOptionId: 'park_test',
                cashierBindingId: fixture.contexts.event_genix.selectedBindingId + 999999,
                tender: 'cash',
                items: [{ itemCode: parkItem.itemCode }]
            }
        });
        assert.equal(wrongBinding.status, 409);
        const scopeOverride = await api(actorToken, 'POST', '/api/payments/catalog/orders', {
            idempotencyKey: 'local-qa-scope-override',
            body: {
                businessContext: 'dar',
                routeOptionId: 'dar_test',
                registerAlias: 'middle',
                provider_register_id: 'browser-value',
                cashierBindingId: fixture.contexts.dar.selectedBindingId,
                tender: 'cash',
                items: [{ itemCode: 'dar_logic_single' }]
            }
        });
        assert.equal(scopeOverride.status, 422);

        const weekendTooShort = await api(actorToken, 'POST', '/api/payments/catalog/orders', {
            idempotencyKey: 'local-qa-weekend-too-short',
            body: {
                businessContext: 'dar',
                routeOptionId: 'dar_test',
                cashierBindingId: fixture.contexts.dar.selectedBindingId,
                tender: 'cash',
                items: [{ itemCode: 'dar_hourly_care_weekend', quantityMillis: 1000 }]
            }
        });
        assert.equal(weekendTooShort.status, 422, JSON.stringify(weekendTooShort.body));

        if (process.env.RUN_PARK_DAR_CANONICAL_BROWSER === 'true') {
            canonicalBrowser = await require('../browser/park-dar-canonical-two-tab').startCanonicalTwoTab({
                baseUrl: BASE_URL, actor: fixture.users.actor, itemCode: parkItem.itemCode, pool
            });
        }
        const parkCreateKey = canonicalBrowser?.cash.key || 'local-qa-park-cash-create';
        const parkCash = canonicalBrowser?.cash || await createCatalogOrder(actorToken, 'park_test', 'event_genix', fixture.contexts.event_genix.selectedBindingId, 'cash', [{ itemCode: parkItem.itemCode, quantityMillis: 1000 }], { idempotencyKey: parkCreateKey });
        created.park.push(parkCash.response.body.order);
        const parkReplay = await api(actorToken, 'POST', '/api/payments/catalog/orders', { body: parkCash.body, idempotencyKey: parkCreateKey });
        assert.equal(parkReplay.status, 200);
        assert.equal(parkReplay.body.replayed, true);
        assert.equal(parkReplay.body.order.id, parkCash.response.body.order.id);
        const parkConflict = await api(actorToken, 'POST', '/api/payments/catalog/orders', {
            body: { ...parkCash.body, items: [{ itemCode: parkItem.itemCode, quantityMillis: 2000 }] },
            idempotencyKey: parkCreateKey
        });
        assert.equal(parkConflict.status, 409);
        const parkConfirm = await confirmOrder(actorToken, parkCash.response.body.order, 'cash', 'local-qa-park-cash-confirm');
        const parkConfirmReplay = await api(actorToken, 'POST', `/api/payments/orders/${parkCash.response.body.order.id}/confirm`, { body: parkConfirm.body, idempotencyKey: parkConfirm.key });
        assert.equal(parkConfirmReplay.status, 200);
        assert.equal(parkConfirmReplay.body.replayed, true);
        const recoveryOperation = await pool.query(
            `SELECT provider_operation_id
               FROM fiscal_operations
              WHERE payment_order_id=$1 AND operation_type='sale'`,
            [parkCash.response.body.order.id]
        );
        assert.equal(recoveryOperation.rows.length, 1);
        const recoveryUuid = recoveryOperation.rows[0].provider_operation_id;
        const recoveryFetch = createOneShotPostSubmitUnknownFetch({
            fetchImpl: globalThis.fetch,
            qaRunId,
            operationUuid: recoveryUuid,
            evidence: {
                exactOrganization: true,
                exactRegister: true,
                exactCashier: true,
                licenseDeviceOwnedByRegister: true,
                activeBinding: true,
                untaxedMappings: true,
                acceptanceIsolated: true,
                noForeignShift: true,
                queuesEmpty: true,
                expectedIsTest: true,
                isTest: true
            },
            allowedOrigins: ['https://api.checkbox.ua']
        });
        const providerFactory = createCheckboxProviderFactory({ env: process.env, fetchImpl: recoveryFetch });
        const firstDrain = await processAllAvailableJobs(providerFactory, { waitForQueued: true });
        assert.equal(
            firstDrain.reduce((sum, item) => sum + item.failed, 0),
            1,
            JSON.stringify({ firstDrain, recovery: recoveryFetch.evidence() })
        );
        const firstDrainState = await pool.query(
            `SELECT job.job_type, job.status, job.external_stage, job.last_error_code,
                    operation.status AS operation_status,
                    operation.last_error_code AS operation_error_code
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation ON operation.id = job.fiscal_operation_id
              ORDER BY job.id`
        );
        assert.equal(
            firstDrainState.rows.find(row => row.job_type === 'shift_open')?.status,
            'succeeded',
            JSON.stringify(firstDrainState.rows)
        );
        const unknownBefore = await pool.query(
            `SELECT job.id, job.status, job.external_stage, job.last_error_code,
                    operation.status AS operation_status,
                    operation.provider_operation_id
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation ON operation.id = job.fiscal_operation_id
              WHERE operation.provider_operation_id = $1`,
            [recoveryUuid]
        );
        assert.equal(unknownBefore.rows[0].status, 'failed');
        assert.equal(
            unknownBefore.rows[0].external_stage,
            'sale_submit',
            JSON.stringify({ job: unknownBefore.rows[0], recovery: recoveryFetch.evidence() })
        );
        assert.equal(unknownBefore.rows[0].operation_status, 'unknown');
        // The actual UI waits for the normal worker to open the shift. Keep the
        // accepted receipt unresolved while exercising the next-customer flow.
        if (!canonicalBrowser) {
            const readyAfterOpen = await api(actorToken, 'POST', '/api/payments/readiness/probe', {
                body: { force: true, businessContext: 'event_genix', routeOptionId: 'park_test',
                    cashierBindingId: fixture.contexts.event_genix.selectedBindingId } });
            assert.equal(readyAfterOpen.status, 200, JSON.stringify(readyAfterOpen.body));
        }
        const parkCard = canonicalBrowser ? await canonicalBrowser.createNextCard()
            : await createCatalogOrder(actorToken, 'park_test', 'event_genix', fixture.contexts.event_genix.selectedBindingId, 'card_terminal_manual', [{ itemCode: parkItem.itemCode, quantityMillis: 2000 }]);
        created.park.push(parkCard.response.body.order);
        await canonicalBrowser?.close();
        await pool.query(`UPDATE payment_outbox_jobs SET next_run_at = NOW() WHERE id = $1`, [unknownBefore.rows[0].id]);
        const recoveryDrain = await processAllAvailableJobs(providerFactory);
        assert.ok(recoveryDrain.reduce((sum, item) => sum + item.succeeded, 0) >= 1);
        assert.equal(mock.state.salePostsByUuid.get(recoveryUuid), 1);
        assert.ok(Number(mock.state.receiptLookupsByUuid.get(recoveryUuid) || 0) >= 1);
        assert.deepEqual(recoveryFetch.evidence(), {
            qaRunId,
            operationUuid: recoveryUuid,
            acceptedPostCount: 1,
            blockedDuplicatePostCount: 0,
            lookupCount: Number(mock.state.receiptLookupsByUuid.get(recoveryUuid) || 0),
            injected: true
        });

        await confirmOrder(actorToken, parkCard.response.body.order, 'card_terminal_manual');
        const pendingShift = (await pool.query("SELECT id FROM fiscal_shifts WHERE fiscal_register_id=$1 AND status='open'", [fixture.physical.fiscalRegisterId])).rows[0];
        await assertConcurrentPaymentAdmission({ fixture, shiftId: pendingShift.id, itemCode: parkItem.itemCode });
        await assert.rejects(() => requestPhase1ShiftClose({ user: fixture.users.actor, shiftId: pendingShift.id,
            routeOptionId: 'park_test', idempotencyKey: 'close-while-pending', env: process.env }),
        error => error.code === 'shift_close_blocked_unresolved');
        const parkCardDrain = await processAllAvailableJobs(providerFactory);
        assert.equal(parkCardDrain.reduce((sum, item) => sum + item.failed, 0), 0);

        const darWhileParkOwnsRegister = await api(actorToken, 'POST', '/api/payments/catalog/orders', {
            idempotencyKey: 'local-qa-dar-while-park-active',
            body: {
                businessContext: 'dar',
                routeOptionId: 'dar_test',
                cashierBindingId: fixture.contexts.dar.selectedBindingId,
                tender: 'cash',
                items: [{ itemCode: 'dar_logic_single', quantityMillis: 1000 }]
            }
        });
        assert.equal(darWhileParkOwnsRegister.status, 409);

        const unsettledSaleJobs = await pool.query(
            `SELECT job.payment_order_id, job.status, job.last_error_code, operation.provider_operation_id
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation ON operation.id = job.fiscal_operation_id
              WHERE job.job_type = 'receipt_sell'
                AND job.status <> 'succeeded'
              ORDER BY job.payment_order_id`
        );
        assert.deepEqual(unsettledSaleJobs.rows, [], JSON.stringify(unsettledSaleJobs.rows));

        for (const order of created.park) await assertProviderPayload(mock, order.id);
        assert.equal(mock.state.receipts.size, 2);
        const admissionReadiness = await api(
            actorToken,
            'POST',
            '/api/payments/readiness/probe?businessContext=event_genix&routeOptionId=park_test',
            {
                body: {
                    force: true,
                    businessContext: 'event_genix',
                    routeOptionId: 'park_test',
                    cashierBindingId: fixture.contexts.event_genix.selectedBindingId
                }
            }
        );
        assert.equal(admissionReadiness.status, 200, JSON.stringify(admissionReadiness.body));
        assert.equal(admissionReadiness.body.integrationReady, true, JSON.stringify(admissionReadiness.body));
        const admissionMappingCount = await pool.query(
            `SELECT COUNT(*)::int AS count
               FROM fiscal_item_mappings
              WHERE fiscal_profile_id=$1 AND fiscal_register_id=$2
                AND COALESCE(business_context, crm_profile_key)='event_genix'
                AND source_type='admission_ticket' AND item_type='admission_ticket'
                AND status='active' AND tax_mode='untaxed'
                AND provider_tax_id IS NULL`,
            [fixture.physical.fiscalProfileId, fixture.physical.fiscalRegisterId]
        );
        assert.equal(admissionMappingCount.rows[0].count, 6);

        await closeQaShift({ fixture, businessContext: 'event_genix', provider: providerFactory, actorToken, mock });

        const darReadiness = await api(
            actorToken,
            'POST',
            '/api/payments/readiness/probe',
            {
                body: {
                    force: true,
                    businessContext: 'dar',
                    routeOptionId: 'dar_test',
                    cashierBindingId: fixture.contexts.dar.selectedBindingId
                }
            }
        );
        assert.equal(darReadiness.status, 200, JSON.stringify(darReadiness.body));
        assert.equal(darReadiness.body.integrationReady, true, JSON.stringify(darReadiness.body));

        const darCash = await createCatalogOrder(
            actorToken,
            'dar_test',
            'dar',
            fixture.contexts.dar.selectedBindingId,
            'cash',
            [
                { itemCode: 'dar_hourly_care_weekend', quantityMillis: 2000 },
                { itemCode: 'dar_hourly_care_weekday', quantityMillis: 1000 }
            ],
            { discountCodes: ['dar_ubd_20'], idempotencyKey: 'local-qa-dar-combined-cash' }
        );
        darCash.response.body.order.qaKey = 'combined_cash';
        created.dar.push(darCash.response.body.order);

        const darCard = await createCatalogOrder(
            actorToken,
            'dar_test',
            'dar',
            fixture.contexts.dar.selectedBindingId,
            'card_terminal_manual',
            [
                { itemCode: 'dar_school_prep_single', quantityMillis: 1000 },
                { itemCode: 'dar_logic_single', quantityMillis: 1000 }
            ],
            { discountCodes: ['dar_second_club_direction_10'], idempotencyKey: 'local-qa-dar-combined-card' }
        );
        darCard.response.body.order.qaKey = 'combined_card';
        created.dar.push(darCard.response.body.order);

        await confirmOrder(actorToken, darCash.response.body.order, 'cash', 'local-qa-dar-combined-cash-confirm');
        const darCashDrain = await processAllAvailableJobs(providerFactory);
        assert.equal(darCashDrain.reduce((sum, item) => sum + item.failed, 0), 0);
        const darReadyAfterOpen = await api(actorToken, 'POST', '/api/payments/readiness/probe', {
            body: { force: true, businessContext: 'dar', routeOptionId: 'dar_test',
                cashierBindingId: fixture.contexts.dar.selectedBindingId } });
        assert.equal(darReadyAfterOpen.status, 200, JSON.stringify(darReadyAfterOpen.body));

        const darCardConfirm = await confirmOrder(actorToken, darCard.response.body.order, 'card_terminal_manual', 'local-qa-dar-combined-card-confirm');
        const darCardReplay = await api(actorToken, 'POST', `/api/payments/orders/${darCard.response.body.order.id}/confirm`, {
            body: darCardConfirm.body,
            idempotencyKey: darCardConfirm.key
        });
        assert.equal(darCardReplay.status, 200);
        assert.equal(darCardReplay.body.replayed, true);

        const darDrain = await processAllAvailableJobs(providerFactory);
        assert.equal(darDrain.reduce((sum, item) => sum + item.failed, 0), 0);
        for (const order of created.dar) await assertProviderPayload(mock, order.id);

        const darSnapshot = await pool.query(
            `SELECT item.item_code, item.unit_price_minor::text AS final_price,
                    item.item_snapshot->>'original_unit_price_minor' AS original_price,
                    item.item_snapshot->>'discount_amount_minor' AS discount_amount
               FROM payment_order_items item
               JOIN payment_orders po ON po.id = item.payment_order_id
              WHERE po.id = ANY($1::bigint[])
              ORDER BY po.id, item.line_number`,
            [created.dar.map(order => order.id)]
        );
        assert.ok(darSnapshot.rows.some(row => row.item_code === 'dar_school_prep_single' && row.original_price === '30000' && row.final_price === '30000' && row.discount_amount === '0'));
        assert.ok(darSnapshot.rows.some(row => row.item_code === 'dar_logic_single' && row.original_price === '30000' && row.final_price === '27000' && row.discount_amount === '3000'));
        assert.ok(darSnapshot.rows.some(row => row.item_code === 'dar_hourly_care_weekday' && row.original_price === '20000' && row.final_price === '16000' && row.discount_amount === '4000'));
        assert.ok(darSnapshot.rows.some(row => row.item_code === 'dar_hourly_care_weekend' && row.original_price === '35000' && row.final_price === '28000' && row.discount_amount === '7000'));

        await closeQaShift({ fixture, businessContext: 'dar', provider: providerFactory, actorToken, mock });

        const allOrders = [...created.park, ...created.dar, ...created.admission];
        const receiptCountBeforeReplay = mock.state.receipts.size;
        assert.equal(receiptCountBeforeReplay, PLANNED_RECEIPT_COUNT);
        assert.equal(allOrders.length, PLANNED_RECEIPT_COUNT);
        assert.equal([...mock.state.salePostsByUuid.values()].reduce((sum, count) => sum + count, 0), PLANNED_RECEIPT_COUNT);

        const parkHistory = await api(actorToken, 'GET', '/api/payments/checkbox-sales-report?businessContext=event_genix&routeOptionId=park_test&page=1&pageSize=100');
        const darHistory = await api(actorToken, 'GET', '/api/payments/checkbox-sales-report?businessContext=dar&routeOptionId=dar_test&page=1&pageSize=100');
        assert.equal(parkHistory.status, 200, JSON.stringify(parkHistory.body));
        assert.equal(darHistory.status, 200, JSON.stringify(darHistory.body));
        assert.deepEqual(new Set(parkHistory.body.orders.map(order => order.id)), new Set(created.park.map(order => order.id)));
        assert.deepEqual(new Set(darHistory.body.orders.map(order => order.id)), new Set(created.dar.map(order => order.id)));

        const shiftSequence = await pool.query(
            `SELECT business_context, status, lifecycle_stage
               FROM fiscal_shifts
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
              ORDER BY id`,
            [fixture.physical.fiscalProfileId, fixture.physical.fiscalRegisterId]
        );
        assert.deepEqual(shiftSequence.rows, [
            { business_context: 'event_genix', status: 'closed', lifecycle_stage: 'CLOSED' },
            { business_context: 'dar', status: 'closed', lifecycle_stage: 'CLOSED' }
        ]);
        process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'false';

        const finalState = await pool.query(`
            SELECT
                (SELECT COUNT(*)::int FROM payment_orders WHERE source_type = 'catalog_sale') AS catalog_orders,
                (SELECT COUNT(*)::int FROM payment_orders WHERE source_type = 'admission_ticket') AS admission_orders,
                (SELECT COUNT(*)::int FROM fiscal_receipts WHERE receipt_type = 'sale') AS receipts,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs) AS jobs,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs WHERE status = 'queued') AS queued,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs WHERE status = 'failed') AS failed,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs WHERE status = 'dead') AS dead,
                (SELECT COUNT(*)::int FROM payment_orders WHERE fiscal_status <> 'fiscalized') AS unknown_orders,
                (SELECT COUNT(*)::int FROM fiscal_operations WHERE status IN ('pending','unknown','failed')) AS unknown_operations,
                (SELECT COUNT(*)::int FROM fiscal_shifts WHERE status <> 'closed' OR lifecycle_stage <> 'CLOSED') AS open_shifts
        `);
        const totals = finalState.rows[0];
        assert.deepEqual(totals, {
            catalog_orders: 4,
            admission_orders: 0,
            receipts: 4,
            jobs: 10,
            queued: 0,
            failed: 0,
            dead: 0,
            unknown_orders: 0,
            unknown_operations: 0,
            open_shifts: 0
        });
        const jobBreakdown = await pool.query(
            `SELECT job_type, COUNT(*)::int AS count
               FROM payment_outbox_jobs
              GROUP BY job_type
              ORDER BY job_type`
        );
        assert.deepEqual(jobBreakdown.rows, [
            { job_type: 'receipt_sell', count: 4 },
            { job_type: 'receipt_status_lookup', count: 2 },
            { job_type: 'shift_close', count: 2 },
            { job_type: 'shift_open', count: 2 }
        ]);
        assert.equal(mock.state.shifts.size, 2);
        assert.equal(mock.state.currentShiftId, null);
        assert.ok([...mock.state.shifts.values()].every(shift => shift.status === 'CLOSED'));

        const report = {
            mode: 'disposable_postgresql_and_loopback_mock',
            canonical_browser: canonicalBrowser?.proof || { executed: false },
            reusable_test_day: { cycles: 2, history_retained: true, concurrent_replay: true,
                pending_receipt_finished_after_stop: true, close_blocked_while_pending: true,
                stale_cycle_cannot_resume_new_cycle: true, resume_with_global_off_stays_disabled: true,
                stop_resume_provider_mutations: 0, database_identity_delete_fk_active_unique_guards: true,
                resume_rejects_wrong_owner_route_non_test_unavailable_and_failed_job: true,
                webhook_close_resume_advisory_serialization: true,
                concurrent_new_payment_waits_for_stop_and_is_rejected: true,
                resume_rehydrates_deactivation_capability_and_business_access_after_provider_io: true },
            topology: {
                physical_test_registers: physicalTopology.rows[0].physical_registers,
                logical_routes: ['park_test', 'dar_test'],
                sequential_shift_ownership: true
            },
            park: {
                status: 'passed',
                catalog_items: parkCatalog.body.items.length,
                catalog_orders: created.park.length,
                cash: true,
                card_terminal: true,
                invalid_products_rejected: true,
                browser_price_rejected: true
            },
            dar: {
                status: 'passed',
                catalog_items: darCatalog.body.items.length,
                catalog_orders: created.dar.length,
                cash: true,
                card_terminal: true,
                discounts: true,
                hourly_rules: true
            },
            totals: {
                planned_receipts: PLANNED_RECEIPT_COUNT,
                catalog_orders: totals.catalog_orders,
                admission_orders: totals.admission_orders,
                receipts: totals.receipts,
                jobs: totals.jobs
            },
            idempotency: { same_order: true, one_receipt: true, conflicting_payload_rejected: true },
            recovery: {
                lookup_only: true,
                same_uuid: unknownBefore.rows[0].provider_operation_id === recoveryUuid,
                sell_posts_for_recovered_uuid: mock.state.salePostsByUuid.get(recoveryUuid),
                lookups_for_recovered_uuid: mock.state.receiptLookupsByUuid.get(recoveryUuid),
                duplicate_sale_posts_blocked_before_network: true
            },
            final_state: {
                queued: totals.queued,
                failed: totals.failed,
                dead: totals.dead,
                unknown_orders: totals.unknown_orders,
                unknown_operations: totals.unknown_operations,
                open_shifts: totals.open_shifts,
                acceptance_flag: false
            },
            admission_ticket_regression: 'passed',
            external_network_used: false
        };
        const serialized = JSON.stringify(report, null, 2);
        assert.doesNotMatch(serialized, /login|credential|provider.*id|password|pin|license|access.?key|device|username|tax.identifier/i);
        const outputDir = path.join(ROOT, 'outputs');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'catalog-sale-local-qa-report.json'), `${serialized}\n`, 'utf8');
        reportWritten = true;
    } finally {
        await canonicalBrowser?.close();
        process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'false';
        await mock.close();
    }
    assert.equal(reportWritten, true);
});
