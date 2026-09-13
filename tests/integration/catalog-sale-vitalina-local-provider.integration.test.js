'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../db');
const { canUseAction } = require('../../middleware/auth');
const { createEphemeralActionPin, evaluatePinChallenge, PIN_LOCKOUT_MS } = require('../../services/payments/fiscalApprovals');
const { verifyOwnFiscalActionPin, enrollFiscalActionPin } = require('../../services/payments/cashierOperationsService');
const { createCheckboxProviderFactory } = require('../../services/checkbox/provider');
const { resolveFiscalSaleRoute } = require('../../services/payments/fiscalSaleRouteService');
const fixtureHelpers = require('./catalog-sale-local-provider.integration.test');
const { requirePlaywright } = require('../browser/cashier-payments-browser-smoke');

const ROOT = path.resolve(__dirname, '../..');
const BASE_URL = process.env.TEST_URL;
const ACTIONS = ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open',
    'fiscal.shift.close', 'fiscal.audit.view', 'fiscal.service_out.request', 'fiscal.test.cashier.use'];
const wrongPin = pin => pin.split('').map(digit => String((Number(digit) + 1) % 10)).join('');

async function counters(bindingId) {
    return (await pool.query(`SELECT pin_failed_attempts, pin_locked_until,
        (SELECT COUNT(*)::int FROM fiscal_audit_events WHERE entity_table='fiscal_cashier_bindings'
            AND entity_id=b.id AND event_type='fiscal_action_pin_failed') AS failed_audits
        FROM fiscal_cashier_bindings b WHERE id=$1`, [bindingId])).rows[0];
}

async function noFiscalWork() {
    const counts = (await pool.query(`SELECT
        (SELECT COUNT(*)::int FROM fiscal_operations) AS operations,
        (SELECT COUNT(*)::int FROM payment_orders) AS orders,
        (SELECT COUNT(*)::int FROM payment_outbox_jobs) AS jobs`)).rows[0];
    assert.deepEqual(counts, { operations: 0, orders: 0, jobs: 0 });
}

async function browserProof({ user, bindingId, pin, itemCode }) {
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    const outDir = path.join(ROOT, 'output/playwright/vt1');
    fs.mkdirSync(outDir, { recursive: true });
    const proof = [];
    try {
        for (const theme of ['light', 'dark']) for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
            const context = await browser.newContext({ viewport, colorScheme: theme });
            await context.route('**/*', route => {
                const url = new URL(route.request().url());
                return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort('blockedbyclient');
            });
            const page = await context.newPage();
            const pageErrors = [];
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.goto(`${BASE_URL}/status.html`);
            await page.waitForFunction(() => typeof window.apiLogin === 'function');
            await page.evaluate(async ({ username, password, theme }) => {
                const login = await window.apiLogin(username, password);
                window.rememberApiAuthSession(login);
                localStorage.setItem('pzp_dark_mode', String(theme === 'dark'));
            }, { username: user.username, password: user.password, theme });
            await page.goto(`${BASE_URL}/cashier-payments?businessContext=event_genix&routeOptionId=park_test`);
            assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
            await page.waitForSelector('#addCatalogLineBtn:not([disabled])');
            assert.equal(await page.locator('#paymentCashierBinding option').count(), 2);
            assert.equal(await page.locator('#actionPinForm').isVisible(), false);
            await page.waitForSelector('#checkActionPinBtn:not([disabled])');
            await page.fill('#actionPinCheckValue', wrongPin(pin));
            await page.click('#checkActionPinBtn');
            await page.waitForFunction(() => !window.CashierPaymentsPage.state.actionPinCheckInFlight);
            assert.match(await page.locator('#actionPinCheckNotice').innerText(), /PIN|пін/i);
            assert.equal(await page.inputValue('#actionPinCheckValue'), '');
            await page.locator('#actionPinPanel').screenshot({ path: path.join(outDir, `pin-error-${theme}-${viewport.width}.png`) });
            await page.fill('#actionPinCheckValue', pin);
            await page.click('#checkActionPinBtn');
            await page.waitForFunction(() => document.querySelector('#actionPinCheckNotice').textContent.includes('підтверджено'));
            assert.equal(await page.inputValue('#actionPinCheckValue'), '');
            assert.equal(await page.locator('#cashierGlobalStatus').evaluate(el => el.classList.contains('cashier-alert-danger')), false);
            if (await page.locator('#catalogPicker').isHidden()) await page.click('#addCatalogLineBtn');
            await page.locator(`[data-catalog-add="${itemCode}"]`).click();
            await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
            const routeIds = await page.evaluate(() => window.CashierPaymentsPage.state.routeOptions.map(route => route.id));
            assert.equal(routeIds.some(id => id.startsWith('dar_')), false);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
            const screenshot = `${theme}-${viewport.width}.png`;
            for (const close of await page.locator('#toastContainer .toast-close').all()) {
                if (await close.isVisible()) await close.click();
            }
            await page.waitForFunction(() => !document.querySelector('#toastContainer .toast'), null, { timeout: 15000 });
            await page.evaluate(() => scrollTo(0, 0));
            await page.screenshot({ path: path.join(outDir, `viewport-${screenshot}`) });
            await page.screenshot({ path: path.join(outDir, screenshot), fullPage: true });
            await page.locator('#actionPinPanel').screenshot({ path: path.join(outDir, `pin-${screenshot}`) });
            assert.deepEqual(pageErrors, []);
            proof.push({ theme, width: viewport.width, screenshot, ownBinding: bindingId, correctAndWrongPin: true, cart: true });
            await context.close();
        }
    } finally { await browser.close(); }
    return proof;
}

test('VT1 actual PostgreSQL PIN durability and narrow cashier through actual HTTP/UI', async t => {
    fixtureHelpers.requireIsolatedInputs();
    const fixture = await fixtureHelpers.seedQaData();
    const mock = await fixtureHelpers.startMockCheckbox(fixture.physical);
    let cleaned = false;
    const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        await mock.close();
        await pool.end();
    };
    t.after(cleanup);
    let pin = createEphemeralActionPin();
    const cashier = await fixtureHelpers.insertUser({
        username: `vt1_cashier_${crypto.randomBytes(4).toString('hex')}`,
        name: 'VT1 synthetic PARK cashier', role: 'senior_manager', contexts: ['event_genix'], actions: ACTIONS
    });
    const binding = (await pool.query(`INSERT INTO fiscal_cashier_bindings
        (fiscal_profile_id,fiscal_location_id,fiscal_register_id,crm_profile_key,user_id,provider,
         provider_cashier_id,provider_cashier_login_ref,status,capability_scope,cashier_name)
        SELECT fiscal_profile_id,fiscal_location_id,fiscal_register_id,crm_profile_key,$2,provider,
         provider_cashier_id,provider_cashier_login_ref,'active',$3::text[],'VT1 own test cashier'
        FROM fiscal_cashier_bindings WHERE id=$1 RETURNING id`,
    [fixture.physical.selectedBindingId, cashier.id, ACTIONS.filter(action => action !== 'fiscal.test.cashier.use')])).rows[0];
    const input = () => ({ user: cashier, bindingId: binding.id,
        body: { actionPin: pin, routeOptionId: 'park_test', businessContext: 'event_genix' } });
    const enroll = () => enrollFiscalActionPin({ ...input(), user: fixture.users.actor });
    const report = { status: 'LOCAL_FAILED', scope: 'disposable PostgreSQL, synthetic identities, loopback provider only', checks: {} };
    try {
        await enroll();
        await t.test('five concurrent failures commit and lock; expiry, correct reset and rotation', async () => {
            const now = new Date();
            const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => verifyOwnFiscalActionPin({
                ...input(), body: { ...input().body, actionPin: wrongPin(pin) },
                pinEvaluator: options => evaluatePinChallenge({ ...options, now })
            })));
            assert.equal(outcomes.filter(result => result.status === 'rejected').length, 5);
            const saved = await counters(binding.id);
            assert.equal(saved.pin_failed_attempts, 5);
            assert.equal(saved.failed_audits, 5);
            assert.equal(saved.pin_locked_until.getTime(), now.getTime() + PIN_LOCKOUT_MS);
            await assert.rejects(verifyOwnFiscalActionPin(input()), error => error.code === 'action_pin_locked');
            await verifyOwnFiscalActionPin({ ...input(),
                pinEvaluator: options => evaluatePinChallenge({ ...options, now: new Date(now.getTime() + PIN_LOCKOUT_MS + 1) }) });
            assert.equal((await counters(binding.id)).pin_failed_attempts, 0);
            const oldPin = pin;
            pin = createEphemeralActionPin();
            await enroll();
            await assert.rejects(verifyOwnFiscalActionPin({ ...input(), body: { ...input().body, actionPin: oldPin } }),
                error => error.code === 'action_pin_invalid');
            await verifyOwnFiscalActionPin(input());
            report.checks.durableLockExpiryRotation = true;
        });
        await t.test('unexpected persistence error rolls back; owner, business, inactive and production guards', async () => {
            const before = await counters(binding.id);
            await assert.rejects(verifyOwnFiscalActionPin({ ...input(), persistPinResult: async client => {
                await client.query('UPDATE fiscal_cashier_bindings SET pin_failed_attempts=3 WHERE id=$1', [binding.id]);
                throw new Error('synthetic audit storage failure');
            } }), /synthetic audit storage failure/);
            assert.deepEqual(await counters(binding.id), before);
            await assert.rejects(verifyOwnFiscalActionPin({ ...input(), bindingId: fixture.physical.selectedBindingId }),
                error => error.code === 'fiscal_binding_not_found');
            await assert.rejects(enrollFiscalActionPin({ ...input(),
                user: { ...cashier, actionAllowlist: [...ACTIONS, 'fiscal.test.pin.manage'] } }),
                error => /distinct|own|self/.test(error.code));
            await assert.rejects(verifyOwnFiscalActionPin({ ...input(), body: { ...input().body, routeOptionId: 'dar_test', businessContext: 'dar' } }),
                error => error.code === 'fiscal_route_business_denied');
            await pool.query("UPDATE fiscal_cashier_bindings SET status='suspended' WHERE id=$1", [binding.id]);
            await assert.rejects(verifyOwnFiscalActionPin(input()), error => error.code === 'fiscal_binding_not_found');
            await pool.query("UPDATE fiscal_cashier_bindings SET status='active' WHERE id=$1", [binding.id]);
            await pool.query(`UPDATE fiscal_registers SET metadata=metadata || '{"expected_is_test":false}'::jsonb WHERE id=$1`, [fixture.physical.fiscalRegisterId]);
            await assert.rejects(verifyOwnFiscalActionPin(input()), error => error.code === 'fiscal_route_mode_mismatch');
            await pool.query(`UPDATE fiscal_registers SET metadata=metadata || '{"expected_is_test":true}'::jsonb WHERE id=$1`, [fixture.physical.fiscalRegisterId]);
            await noFiscalWork();
            assert.equal(mock.state.requests.length, 0);
            report.checks.noPinFiscalSideEffects = true;
        });
        await t.test('membership-only PARK access, own cashier list, catalog and guarded actions', async () => {
            const org = (await pool.query("INSERT INTO organizations(slug,name) VALUES('vt1-isolated','VT1 Isolated') RETURNING id")).rows[0];
            const business = (await pool.query(`INSERT INTO businesses(organization_id,context_key,label,short_label,access_mode)
                VALUES($1,'event_genix','VT1 PARK','PARK','membership') RETURNING id`, [org.id])).rows[0];
            await pool.query(`INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')`, [org.id, cashier.id]);
            await pool.query(`INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default,action_allowlist)
                VALUES($1,$2,$3,'senior_manager',true,$4::text[])`, [business.id, org.id, cashier.id, ACTIONS]);
            // User allowlist deliberately empty: runtime must use the active membership.
            await pool.query("UPDATE users SET action_allowlist='{}' WHERE id=$1", [cashier.id]);
            cashier.token = await fixtureHelpers.login(cashier);
            const routes = await fixtureHelpers.api(cashier.token, 'GET', '/api/payments/catalog/routes');
            assert.equal(routes.status, 200, JSON.stringify(routes.body));
            assert.equal(canUseAction(cashier, 'fiscal.configure'), false);
            const options = routes.body.routes;
            assert.ok(options.find(route => route.id === 'park_test' && route.salesAllowed === true));
            assert.equal(options.some(route => route.id.startsWith('dar_')), false);
            const cashiers = await fixtureHelpers.api(cashier.token, 'GET', '/api/payments/catalog/cashiers?businessContext=event_genix&routeOptionId=park_test');
            assert.equal(cashiers.status, 200, JSON.stringify(cashiers.body));
            assert.deepEqual(cashiers.body.cashiers.map(row => row.id), [Number(binding.id)]);
            const dar = await fixtureHelpers.api(cashier.token, 'GET', '/api/payments/catalog/items?businessContext=dar&routeOptionId=dar_test');
            assert.equal(dar.status, 403);
            const catalog = await fixtureHelpers.api(cashier.token, 'GET', '/api/payments/catalog/items?businessContext=event_genix&routeOptionId=park_test');
            assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
            report.itemCode = catalog.body.items[0].itemCode;
            report.checks.membershipAndIsolation = true;
        });
        await t.test('actual browser light/dark desktop/mobile and own PIN', async () => {
            const probe = await fixtureHelpers.api(cashier.token, 'POST', '/api/payments/readiness/probe', {
                body: { businessContext: 'event_genix', routeOptionId: 'park_test', cashierBindingId: Number(binding.id), requiredTender: 'cash' }
            });
            assert.equal(probe.status, 200, JSON.stringify(probe.body));
            report.browser = await browserProof({ user: cashier, bindingId: binding.id, pin, itemCode: report.itemCode });
            await noFiscalWork();
        });
        await t.test('own test catalog payment confirms and opens shift without fiscal.configure', async () => {
            const probe = await fixtureHelpers.api(cashier.token, 'POST', '/api/payments/readiness/probe', {
                body: { businessContext: 'event_genix', routeOptionId: 'park_test', cashierBindingId: Number(binding.id), requiredTender: 'cash' }
            });
            assert.equal(probe.status, 200, JSON.stringify(probe.body));
            const item = { itemCode: report.itemCode, quantity: 1 };
            const denied = await fixtureHelpers.createCatalogOrder(cashier.token, 'park_test', 'event_genix',
                fixture.physical.selectedBindingId, 'cash', [item], { expectedStatus: 403 });
            assert.equal(denied.response.body.code, 'fiscal_test_cashier_binding_denied');
            await noFiscalWork();
            const created = await fixtureHelpers.createCatalogOrder(cashier.token, 'park_test', 'event_genix', Number(binding.id), 'cash', [item]);
            await fixtureHelpers.confirmOrder(cashier.token, created.response.body.order, 'cash');
            const provider = createCheckboxProviderFactory({ env: process.env });
            await fixtureHelpers.processAllAvailableJobs(provider);
            const order = (await pool.query('SELECT * FROM payment_orders WHERE id=$1', [created.response.body.order.id])).rows[0];
            assert.equal(order.fiscal_status, 'fiscalized');
            assert.equal(Number(order.cashier_user_id), cashier.id);
            const routes = await resolveFiscalSaleRoute({ user: cashier, routeOptionId: 'park_test', businessContext: 'event_genix' });
            assert.equal(Number(routes.cashierBinding.id), Number(binding.id));
            const shift = (await pool.query("SELECT * FROM fiscal_shifts WHERE status='open'")).rows[0];
            assert.ok(shift);
            const reportResponse = await fixtureHelpers.api(cashier.token, 'GET', `/api/payments/shifts/${shift.id}/report?routeOptionId=park_test`);
            assert.equal(reportResponse.status, 200, JSON.stringify(reportResponse.body));
            report.checks.actualTestPaymentAndShift = true;
        });
        await t.test('service-out own cancellation, X report and operator-only phase1 close retain their gates', async () => {
            const shift = (await pool.query("SELECT * FROM fiscal_shifts WHERE status='open'")).rows[0];
            const beforePosts = mock.state.requests.filter(request => request.method === 'POST').length;
            const requested = await fixtureHelpers.api(cashier.token, 'POST', '/api/payments/service-out', {
                body: { businessContext: 'event_genix', routeOptionId: 'park_test', amountMinor: '100', reason: 'VT1 synthetic cancellation proof' },
                idempotencyKey: crypto.randomUUID()
            });
            assert.equal(requested.status, 201, JSON.stringify(requested.body));
            const cancelled = await fixtureHelpers.api(cashier.token, 'POST', `/api/payments/service-out/${requested.body.operationId}/cancel`, {
                idempotencyKey: crypto.randomUUID()
            });
            assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
            assert.equal(cancelled.body.cancelled, true);
            assert.equal(mock.state.requests.filter(request => request.method === 'POST').length, beforePosts);
            const xKey = crypto.randomUUID();
            for (let attempt = 0; attempt < 2; attempt++) {
                const x = await fixtureHelpers.api(cashier.token, 'POST', `/api/payments/shifts/${shift.id}/x-report?routeOptionId=park_test`, { idempotencyKey: xKey });
                assert.equal(x.status, attempt === 0 ? 202 : 200, JSON.stringify(x.body));
                assert.equal(x.body.xReport.status, 'succeeded');
            }
            assert.equal(mock.state.requests.filter(request => request.method === 'POST' && request.pathname === '/api/v1/reports').length, 1);
            const close = await fixtureHelpers.api(cashier.token, 'POST', `/api/payments/shifts/${shift.id}/phase1-close?routeOptionId=park_test`, { idempotencyKey: crypto.randomUUID() });
            assert.equal(close.status, 403, JSON.stringify(close.body));
            assert.equal(close.body.code, 'phase1_close_owner_denied');
            report.checks.serviceOutXAndOwnerGuard = true;
        });
        assert.equal(Object.keys(report.checks).length, 5);
        assert.equal(report.browser?.length, 4);
        report.status = 'LOCAL_PASS';
    } finally {
        fs.mkdirSync(path.join(ROOT, 'output/playwright/vt1'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, 'output/playwright/vt1/result.json'), JSON.stringify(report, null, 2) + '\n');
        await cleanup();
    }
});
