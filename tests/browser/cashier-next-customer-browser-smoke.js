#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { startServer, requirePlaywright, state, permissionPayload } = require('./cashier-payments-browser-smoke');

async function run() {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        await context.addInitScript(() => localStorage.setItem('pzp_token', 'local-synthetic-cashier'));
        // Isolate payment-tab orchestration from the separately owned auth/session
        // storage lifecycle. The full cashier smoke still exercises canonical auth.
        await context.route('**/js/auth.js*', route => route.fulfill({
            status: 200, contentType: 'application/javascript', body: `
                window.AppState = window.AppState || {};
                window.canAccess = window.canAccessPage = () => true;
                window.apiVerifyToken = async () => ({ id: 4, name: 'Local QA Creator', role: 'creator' });
                window.hydrateActionPermissions = async () => ({});
                window.getAuthHeaders = () => ({ 'Content-Type': 'application/json' });
                window.showAuthenticatedPageShell = () => { document.querySelector('#mainApp').classList.remove('hidden'); document.body.classList.add('authenticated-shell', 'shell-ready'); };
            `
        }));
        await context.route('**/api/auth/verify', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 4, name: 'Local QA Creator', role: 'creator', roles: ['creator'], businessProfile: 'event_genix' } }) }));
        await context.route('**/api/auth/permissions*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(permissionPayload(true, { fiscalConfigure: true })) }));
        // The fixture API is loopback only. A submitted order survives the simulated lost response.
        let loseResponse = true;
        await context.route('**/api/payments/catalog/orders', async route => {
            if (loseResponse) {
                loseResponse = false;
                await route.fetch();
                await route.abort('connectionreset');
            } else await route.continue();
        });
        const first = await context.newPage();
        const second = await context.newPage();
        for (const page of [first, second]) {
            await page.bringToFront();
            page.on('pageerror', error => console.error('Fixture page error:', error.message));
            await page.goto(`${base}/cashier-payments?businessContext=event_genix&routeOptionId=park_production`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#addCatalogLineBtn:not([disabled])').catch(async error => {
                console.error(await page.locator('#cashierAccessDenied, #cashierGlobalStatus, #catalogSaleSummary').allTextContents());
                console.error(await page.evaluate(() => ({ ready: document.readyState, page: Boolean(window.CashierPaymentsPage), user: window.CashierPaymentsPage?.state?.user?.id, saleMode: window.CashierPaymentsPage?.state?.saleMode, routeReady: window.CashierPaymentsPage?.state?.routeReady, deniedHidden: document.querySelector('#cashierAccessDenied')?.className })));
                throw error;
            });
            await page.click('#addCatalogLineBtn');
            await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        }
        await first.click('#createPaymentOrderBtn');
        await first.waitForFunction(() => !window.CashierPaymentsPage.state.createInFlight);
        assert.equal(state.orders.size, 1, 'lost response still created exactly one mock order');
        assert.equal(await first.isDisabled('#addCatalogLineBtn'), true, 'uncertain create freezes its payload');
        const originalKey = state.createKeys[0];
        await first.reload();
        await first.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        assert.match(await first.textContent('#createPaymentOrderBtn'), /Відновити/);
        await Promise.all([first.click('#createPaymentOrderBtn'), second.click('#createPaymentOrderBtn')]);
        for (const page of [first, second]) {
            await page.waitForFunction(() => Boolean(window.CashierPaymentsPage.state.orderDetails?.order?.id));
        }
        assert.equal(state.orders.size, 1, 'two tabs converge on the same logical draft');
        assert.ok(state.createKeys.every(key => key === originalKey), 'reload and concurrent retry preserve the original key');
        const firstId = [...state.orders.keys()][0];
        Object.assign(state.orders.get(firstId), { status: 'payment_recorded', paymentStatus: 'confirmed', fiscalStatus: 'pending' });
        for (const page of [first, second]) {
            await page.evaluate(id => window.CashierPaymentsPage.loadPaymentOrder(id, { silent: true }), firstId);
            await page.waitForSelector('#startNextOrderBtn:not(.hidden):not([disabled])');
        }
        await first.click('#startNextOrderBtn');
        await first.waitForSelector('#addCatalogLineBtn:not([disabled])');
        assert.equal(await first.locator('[data-catalog-item]').count(), 0);
        assert.equal(await first.inputValue('#catalogDiscountRule'), '');
        assert.match(await first.textContent('#catalogFinalTotal'), /0[,.]00/);
        assert.equal(await first.locator(`#unresolvedOrdersBody [data-order-id="${firstId}"]`).count(), 1, 'previous paid receipt remains in recovery');
        await second.click('#startNextOrderBtn');
        assert.equal(await second.evaluate(() => window.CashierPaymentsPage.state.orderDetails.order.id), firstId, 'stale tab cannot reset another customer');
        await first.click('#addCatalogLineBtn');
        await first.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await first.click('#createPaymentOrderBtn');
        await first.waitForFunction(id => window.CashierPaymentsPage.state.orderDetails?.order?.id !== id, firstId);
        assert.equal(state.orders.size, 2, 'same cart for next customer creates a different order');
        assert.notEqual(state.createKeys.at(-1), originalKey);
        const secondId = [...state.orders.keys()].at(-1);
        Object.assign(state.orders.get(secondId), { status: 'payment_recorded', paymentStatus: 'confirmed', fiscalStatus: 'fiscalized' });
        await first.evaluate(id => window.CashierPaymentsPage.loadPaymentOrder(id, { silent: true }), secondId);
        assert.equal(await first.isDisabled('#createPaymentOrderBtn'), true, 'completed order cannot be submitted again');
        assert.match(await first.textContent('#fiscalPendingMessage'), /Оплату завершено/);
        await context.close();
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
    console.log('Next-customer browser smoke passed: lost response, reload, two tabs, stale reset, identical next cart, pending recovery, completed state');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
