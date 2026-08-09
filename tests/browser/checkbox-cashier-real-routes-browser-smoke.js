#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pool } = require('../../db');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { createProviderFromConfig } = require('../../services/checkbox/provider');
const { processPaymentOutboxJobs } = require('../../services/payments/paymentOutboxWorker');
const { buildFiscalConfigurationSnapshot } = require('../../services/payments/paymentReadinessService');

const ROOT = path.join(__dirname, '..', '..');
const BASE_URL = process.env.TEST_URL || '';
const MOCK_PORT = Number(process.env.CHECKBOX_BROWSER_MOCK_PORT || 0);
const CREDENTIAL_REF = 'park-middle-browser';
const CRM_PROFILE_KEY = 'event_genix';
const REGISTER_ALIAS = 'middle';
const HEADLESS = process.env.CASHIER_PAYMENTS_BROWSER_SMOKE_HEADLESS !== 'false';
const PAYMENT_ACTIONS = ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open'];

function requirePlaywright() {
    try { return require('playwright'); }
    catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function requireIsolatedInputs() {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL);
    assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
    assertSafeIsolatedTestUrl(BASE_URL);
    assert.ok(MOCK_PORT > 0, 'CHECKBOX_BROWSER_MOCK_PORT is required');
}

async function seedCashier() {
    const password = crypto.randomBytes(18).toString('base64url');
    const username = `checkbox_ui_cashier_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
        `INSERT INTO users (
             username, password_hash, name, role, is_active,
             page_allowlist, action_allowlist, business_contexts, default_business_context
         )
         VALUES ($1, $2, 'Checkbox UI Cashier', 'creator', true, $3::text[], $4::text[], $5::text[], $6)
         RETURNING id, username`,
        [username, passwordHash, ['/cashier-payments'], PAYMENT_ACTIONS, [CRM_PROFILE_KEY], CRM_PROFILE_KEY]
    );
    return { id: Number(userResult.rows[0].id), username, password };
}

async function seedFiscalScope(cashier) {
    const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`.toLowerCase();
    const profile = await pool.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name, tax_identifier,
             provider, provider_organization_id, currency, status
         )
         VALUES ($1, $2, 'Checkbox UI Smoke FOP', $3, 'checkbox', $4, 'UAH', 'active')
         RETURNING id`,
        [CRM_PROFILE_KEY, `fop_checkbox_ui_${suffix}`, `tax-ui-${suffix}`, `mock-org-${suffix}`]
    );
    const location = await pool.query(
        `INSERT INTO fiscal_locations (
             fiscal_profile_id, crm_profile_key, location_alias, display_name,
             provider_outlet_id, address_snapshot, status
         )
         VALUES ($1, $2, 'park', 'Park UI smoke location', $3, 'Local UI smoke address', 'active')
         RETURNING id`,
        [profile.rows[0].id, CRM_PROFILE_KEY, `mock-outlet-${suffix}`]
    );
    const register = await pool.query(
        `INSERT INTO fiscal_registers (
             fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
             display_name, provider, provider_register_id, provider_license_ref,
             status, feature_enabled, metadata
         )
         VALUES ($1, $2, $3, $4, 'Middle UI smoke register', 'checkbox', $5, $6, 'active', true, $7::jsonb)
         RETURNING id`,
        [
            profile.rows[0].id,
            location.rows[0].id,
            CRM_PROFILE_KEY,
            REGISTER_ALIAS,
            `mock-register-${suffix}`,
            CREDENTIAL_REF,
            JSON.stringify({ integration_owner: 'checkbox-ui-real-route-smoke' })
        ]
    );
    const providerShiftId = `mock-shift-${suffix}`;
    await pool.query(
        `INSERT INTO fiscal_shifts (
             fiscal_profile_id, fiscal_register_id, provider, provider_shift_id, status,
             lifecycle_stage, opened_by_user_id, opened_at, provider_opened_at, provider_snapshot
         )
         VALUES ($1, $2, 'checkbox', $3, 'open', 'OPENED', $4, NOW(), NOW(), $5::jsonb)`,
        [
            profile.rows[0].id,
            register.rows[0].id,
            providerShiftId,
            cashier.id,
            JSON.stringify({ seeded_provider_open_shift_for_ui_smoke: true })
        ]
    );
    await pool.query(
        `INSERT INTO fiscal_cashier_bindings (
             fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
             user_id, provider, provider_cashier_id, provider_cashier_login_ref,
             status, capability_scope
         )
         VALUES ($1, $2, $3, $4, $5, 'checkbox', $6, $7, 'active', $8::text[])`,
        [
            profile.rows[0].id,
            register.rows[0].id,
            location.rows[0].id,
            CRM_PROFILE_KEY,
            cashier.id,
            `mock-cashier-${cashier.id}`,
            CREDENTIAL_REF,
            PAYMENT_ACTIONS
        ]
    );
    await pool.query(
        `INSERT INTO fiscal_item_mappings (
             fiscal_profile_id, fiscal_register_id, crm_profile_key, source_type, item_type,
             item_code, fiscal_item_name, provider, provider_tax_id, tax_code, tax_rate_bps, status
         )
          SELECT $1, $2, $3::varchar, 'admission_ticket', 'admission_ticket',
                 type.code, CONCAT('Park admission ', type.code), 'checkbox', '7', 7, 0, 'active'
            FROM admission_ticket_types type
           WHERE type.business_context = $4::varchar
             AND type.is_active = true`,
        [profile.rows[0].id, register.rows[0].id, CRM_PROFILE_KEY, CRM_PROFILE_KEY]
    );
    const readinessConfig = buildFiscalConfigurationSnapshot({
        mapping: {
            fiscal_profile_id: profile.rows[0].id,
            fiscal_location_id: location.rows[0].id,
            fiscal_register_id: register.rows[0].id,
            crm_profile_key: CRM_PROFILE_KEY,
            legal_entity_key: `fop_checkbox_ui_${suffix}`,
            provider_organization_id: `mock-org-${suffix}`,
            provider_outlet_id: `mock-outlet-${suffix}`,
            provider_register_id: `mock-register-${suffix}`,
            provider_license_ref: CREDENTIAL_REF,
            register_alias: REGISTER_ALIAS
        },
        binding: {
            provider_cashier_id: `mock-cashier-${cashier.id}`,
            provider_cashier_login_ref: CREDENTIAL_REF
        },
        runtimeConfig: { expectedIsTest: true }
    });
    await pool.query(
        `INSERT INTO checkbox_readiness_snapshots (
             fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
             register_credential_ref, cashier_credential_ref, fiscal_configuration_hash,
             readiness_code, integration_ready, local_mapping_ready, runtime_secrets_resolvable,
             provider_identity_verified, register_active, cashier_ready, signature_certificate_ready,
             tax_mapping_ready, provider_unavailable, stale_readiness, shift_state,
             provider_organization_id, provider_outlet_id, provider_register_id, provider_cashier_id,
             provider_shift_id, expected_is_test, checked_at, expires_at, latency_ms, result_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'ready', true, true, true, true, true, true, true, true, false, false,
                 'open', $7, $8, $9, $10, $11, true, NOW(), NOW() + INTERVAL '5 minutes', 1, $12::jsonb)`,
        [
            profile.rows[0].id,
            register.rows[0].id,
            location.rows[0].id,
            CRM_PROFILE_KEY,
            CREDENTIAL_REF,
            readinessConfig.hash,
            `mock-org-${suffix}`,
            `mock-outlet-${suffix}`,
            `mock-register-${suffix}`,
            `mock-cashier-${cashier.id}`,
            providerShiftId,
            JSON.stringify({ seeded_ready_snapshot_for_ui_smoke: true })
        ]
    );
    return {
        fiscalProfileId: Number(profile.rows[0].id),
        fiscalRegisterId: Number(register.rows[0].id),
        providerOrganizationId: `mock-org-${suffix}`,
        providerRegisterId: `mock-register-${suffix}`,
        providerCashierId: `mock-cashier-${cashier.id}`,
        providerShiftId
    };
}

async function startMockCheckbox(scope) {
    const state = {
        calls: [],
        tokensIssued: 0,
        shift: {
            id: scope.providerShiftId,
            status: 'OPENED',
            cash_register_id: scope.providerRegisterId,
            cashier_id: scope.providerCashierId
        },
        receipts: new Map()
    };
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            const body = rawBody ? JSON.parse(rawBody) : {};
            state.calls.push({ method: req.method, path: req.url, headers: req.headers, body });
            const send = (status, payload) => {
                res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(payload));
            };
            if (req.url === '/api/v1/cashier/signin' && req.method === 'POST') {
                state.tokensIssued += 1;
                return send(200, { access_token: `mock-token-${state.tokensIssued}`, token_type: 'bearer' });
            }
            if (req.url === '/api/v1/cashier/me' && req.method === 'GET') {
                return send(200, {
                    id: scope.providerCashierId,
                    organization: { id: scope.providerOrganizationId },
                    blocked: false,
                    is_test: true,
                    certificate_end: '2099-01-01T00:00:00.000Z'
                });
            }
            if (req.url === '/api/v1/cashier/shift' && req.method === 'GET') {
                if (!state.shift) return send(404, { error: 'shift_not_open' });
                return send(200, state.shift);
            }
            if (req.url === '/api/v1/shifts' && req.method === 'POST') {
                state.shift = {
                    id: body.id || crypto.randomUUID(),
                    status: 'OPENED',
                    cash_register_id: scope.providerRegisterId,
                    cashier_id: scope.providerCashierId
                };
                return send(202, state.shift);
            }
            if (req.url === '/api/v1/receipts/validate' && req.method === 'POST') {
                return send(200, { valid: true });
            }
            if (req.url === '/api/v1/receipts/sell' && req.method === 'POST') {
                const totalSum = (body.goods || []).reduce((sum, item) => {
                    const price = BigInt(String(item.good?.price || 0));
                    const quantity = BigInt(String(item.quantity || 1000));
                    return sum + (price * quantity / 1000n);
                }, 0n).toString();
                const paymentValue = String(body.payments?.[0]?.value || totalSum);
                const receipt = {
                    id: body.id,
                    status: 'DONE',
                    type: 'SELL',
                    total_sum: totalSum,
                    total_payment: paymentValue,
                    total_rest: body.payments?.[0]?.type === 'CASH' ? (BigInt(paymentValue) - BigInt(totalSum)).toString() : '0',
                    cash_register_id: scope.providerRegisterId,
                    cashier_id: scope.providerCashierId,
                    shift_id: state.shift?.id,
                    payments: body.payments || [],
                    context: body.context,
                    fiscal_code: `FC-${body.id}`.slice(0, 64),
                    serial: state.calls.filter(call => call.path === '/api/v1/receipts/sell').length,
                    tax_url: `https://api.checkbox.ua/api/v1/receipts/${encodeURIComponent(body.id)}`
                };
                state.receipts.set(body.id, receipt);
                return send(201, receipt);
            }
            const receiptMatch = req.url.match(/^\/api\/v1\/receipts\/([^/]+)$/);
            if (receiptMatch && req.method === 'GET') {
                const receipt = state.receipts.get(decodeURIComponent(receiptMatch[1]));
                if (!receipt) return send(404, { error: 'not_found' });
                return send(200, receipt);
            }
            return send(404, { error: 'not_found' });
        });
    });
    await new Promise(resolve => server.listen(MOCK_PORT, '127.0.0.1', resolve));
    return {
        state,
        baseUrl: `http://127.0.0.1:${MOCK_PORT}`,
        close: () => new Promise(resolve => server.close(resolve))
    };
}

async function processOutboxWithMock(mock) {
    const provider = createProviderFromConfig({
        baseUrl: mock.baseUrl,
        login: 'mock-login',
        password: 'mock-password',
        licenseKey: 'mock-license',
        accessKey: 'mock-access',
        deviceId: 'eventgenix-browser-smoke-device',
        clientName: 'EventGenix Browser Smoke',
        clientVersion: 'test',
        timeoutMs: 1000,
        expectedIsTest: true
    });
    for (let i = 0; i < 8; i += 1) {
        const batch = await processPaymentOutboxJobs({
            dbPool: pool,
            provider,
            batchSize: 10,
            lockedBy: `checkbox-browser-ui-${process.pid}`,
            lockExpiryMs: 30_000
        });
        if (batch.claimed === 0) break;
    }
}

async function loginViaApi(page, cashier) {
    const response = await page.request.post(`${BASE_URL}/api/auth/login`, {
        data: { username: cashier.username, password: cashier.password }
    });
    assert.equal(response.ok(), true, await response.text());
    const payload = await response.json();
    assert.ok(payload.token);
    await page.addInitScript(token => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_dark_mode', 'false');
    }, payload.token);
}

async function run() {
    requireIsolatedInputs();
    const cashier = await seedCashier();
    const scope = await seedFiscalScope(cashier);
    const mock = await startMockCheckbox(scope);
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await loginViaApi(page, cashier);
        await page.goto(`${BASE_URL}/cashier-payments`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#paymentOrderForm');
        const readinessProbe = await page.evaluate(async () => {
            const token = localStorage.getItem('pzp_token');
            const response = await fetch('/api/payments/readiness/probe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ crmProfileKey: 'event_genix', registerAlias: 'middle' })
            });
            return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
        });
        assert.equal(readinessProbe.ok, true, JSON.stringify(readinessProbe));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#paymentOrderForm');
        await page.waitForFunction(() => window.CashierPaymentsPage?.state?.registerState);
        const registerState = await page.evaluate(() => window.CashierPaymentsPage.state.registerState);
        assert.equal(registerState.readinessCode, 'ready', JSON.stringify(registerState));
        assert.equal(registerState.integrationReady, true, JSON.stringify(registerState));
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await page.fill('#paymentKidsCount', '1');
        await page.fill('#paymentAdultsCount', '0');
        await page.click('#createPaymentOrderBtn');
        await page.waitForFunction(() => {
            const cancel = document.querySelector('#cancelDraftOrderBtn');
            const status = document.querySelector('#cashierGlobalStatus');
            return cancel && !cancel.classList.contains('hidden')
                || status && !status.classList.contains('hidden') && status.textContent.trim();
        });
        if (await page.locator('#cancelDraftOrderBtn.hidden').count()) {
            const statusText = await page.locator('#cashierGlobalStatus').textContent().catch(() => '');
            throw new Error(`Payment order was not created: ${String(statusText || '').trim()}`);
        }
        await page.waitForSelector('#cashReceivedAmount:not([disabled])');
        await page.fill('#cashReceivedAmount', '5000');
        await page.click('#confirmCashBtn');
        await page.waitForSelector('#pendingReceiptNotice:not(.hidden)');
        await page.waitForSelector('#unresolvedOrdersBody [data-order-id]');
        const pendingOrderId = await page.evaluate(() => window.CashierPaymentsPage.state.orderDetails.order.id);
        assert.equal(await page.isDisabled('#confirmCashBtn'), true);
        await page.click('#startNextOrderBtn');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        assert.match(await page.textContent('#unresolvedOrdersBody'), new RegExp(`RCP-${pendingOrderId}`), 'unresolved receipt remains visible after next customer');
        await page.goto(`${BASE_URL}/cashier-payments?orderId=${pendingOrderId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#pendingReceiptNotice:not(.hidden)');

        await processOutboxWithMock(mock);
        try {
            await page.waitForSelector('#providerReceiptLinks:not(.hidden)', { timeout: 20000 });
        } catch (err) {
            const browserSnapshot = await page.evaluate(async () => {
                const orderId = window.localStorage.getItem(Object.keys(window.localStorage).find(key => key.endsWith(':lastOrderId')) || 'missing');
                let orderApi = null;
                try {
                    const response = await fetch(`/api/payments/orders/${encodeURIComponent(orderId)}`);
                    orderApi = await response.json();
                } catch (error) {
                    orderApi = { error: String(error?.message || error) };
                }
                const links = document.querySelector('#providerReceiptLinks');
                const tax = document.querySelector('#providerTaxUrl');
                return {
                    orderId,
                    fiscalText: document.querySelector('#cashierFiscalStatus')?.textContent || '',
                    linksClass: links?.className || null,
                    taxClass: tax?.className || null,
                    taxHref: tax?.getAttribute('href') || null,
                    orderApi
                };
            });
            const snapshot = await pool.query(`
                SELECT po.id AS order_id,
                       po.status AS order_status,
                       po.payment_status,
                       po.fiscal_status,
                       fo.status AS operation_status,
                       fr.status AS receipt_status,
                       job.status AS job_status,
                       job.payload->>'external_stage' AS external_stage,
                       job.last_error_code,
                       job.last_error_message
                  FROM payment_orders po
             LEFT JOIN fiscal_operations fo ON fo.payment_order_id = po.id
             LEFT JOIN fiscal_receipts fr ON fr.fiscal_operation_id = fo.id
             LEFT JOIN payment_outbox_jobs job ON job.fiscal_operation_id = fo.id
              ORDER BY po.id ASC, fo.id ASC, job.id ASC
            `);
            throw new Error(`Receipt link did not appear. Browser=${JSON.stringify(browserSnapshot)} DB=${JSON.stringify(snapshot.rows)} mockCalls=${JSON.stringify(mock.state.calls)}`);
        }
        assert.match(await page.getAttribute('#providerTaxUrl', 'href'), /^https:\/\/api\.checkbox\.ua\//);
        assert.equal(await page.locator('#operationalContourPanel').isVisible(), false);

        await page.click('#startNextOrderBtn');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await page.fill('#paymentKidsCount', '1');
        await page.click('#createPaymentOrderBtn');
        await page.waitForSelector('#cancelDraftOrderBtn:not(.hidden)');
        const orderIds = await pool.query('SELECT source_id FROM payment_orders ORDER BY id ASC');
        assert.ok(orderIds.rows.length >= 2);
        assert.notEqual(orderIds.rows.at(-1).source_id, orderIds.rows.at(-2).source_id);

        await page.waitForSelector('#cancelDraftOrderBtn:not(.hidden)');
        await page.click('#cancelDraftOrderBtn');
        await page.waitForSelector('#startNextOrderBtn:not(.hidden)');
        const cancelled = await pool.query('SELECT status, payment_status, fiscal_status FROM payment_orders ORDER BY id DESC LIMIT 1');
        assert.deepEqual(cancelled.rows[0], { status: 'cancelled', payment_status: 'unpaid', fiscal_status: 'not_required' });

        const sellCalls = mock.state.calls.filter(call => call.path === '/api/v1/receipts/sell');
        assert.equal(sellCalls.length, 1);
        await context.close();
    } finally {
        await browser.close().catch(() => {});
        await mock.close().catch(() => {});
        await pool.end().catch(() => {});
    }
    console.log('Checkbox cashier real routes browser smoke passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
