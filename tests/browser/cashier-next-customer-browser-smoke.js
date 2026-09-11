#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { actionableBrowserErrors, startServer, requirePlaywright, state, permissionPayload } = require('./cashier-payments-browser-smoke');

async function addFirstVisibleCatalogItem(page) {
    const picker = page.locator('#catalogPicker');
    if (!await picker.isVisible()) {
        await page.click('#addCatalogLineBtn');
    }
    assert.equal(await picker.isVisible(), true, 'catalog picker must be visible before selecting an item');
    await page.locator('[data-catalog-add]:visible').first().click();
}

async function run() {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const browserErrors = [];
        await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
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
            page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`));
            page.on('console', message => {
                if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
            });
            await page.goto(`${base}/cashier-payments?businessContext=event_genix&routeOptionId=park_production`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#addCatalogLineBtn:not([disabled])').catch(async error => {
                console.error(await page.locator('#cashierAccessDenied, #cashierGlobalStatus, #catalogSaleSummary').allTextContents());
                console.error(await page.evaluate(() => ({ ready: document.readyState, page: Boolean(window.CashierPaymentsPage), user: window.CashierPaymentsPage?.state?.user?.id, saleMode: window.CashierPaymentsPage?.state?.saleMode, routeReady: window.CashierPaymentsPage?.state?.routeReady, deniedHidden: document.querySelector('#cashierAccessDenied')?.className })));
                throw error;
            });
            await addFirstVisibleCatalogItem(page);
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
            await page.waitForFunction(() => {
                const cashierState = window.CashierPaymentsPage.state;
                return !cashierState.createInFlight && Boolean(cashierState.orderDetails?.order?.id);
            });
        }
        assert.equal(state.orders.size, 1, 'two tabs converge on the same logical draft');
        assert.ok(state.createKeys.every(key => key === originalKey), 'reload and concurrent retry preserve the original key');
        const firstId = [...state.orders.keys()][0];
        Object.assign(state.orders.get(firstId), { status: 'payment_recorded', paymentStatus: 'confirmed', fiscalStatus: 'pending' });
        await Promise.all([first, second].map(page => page.evaluate(
            id => window.CashierPaymentsPage.loadPaymentOrder(id, { silent: true }),
            firstId
        )));
        for (const [index, page] of [first, second].entries()) {
            await page.waitForFunction(id => {
                const cashierState = window.CashierPaymentsPage.state;
                const button = document.getElementById('startNextOrderBtn');
                return cashierState.orderDetails?.order?.id === id
                    && cashierState.orderDetails.order.paymentStatus === 'confirmed'
                    && cashierState.unresolvedQueueState === 'available'
                    && button && !button.hidden && !button.classList.contains('hidden') && !button.disabled;
            }, firstId).catch(async error => {
                const snapshot = await page.evaluate(() => {
                    const cashierState = window.CashierPaymentsPage.state;
                    const button = document.getElementById('startNextOrderBtn');
                    return {
                        order: cashierState.orderDetails?.order,
                        unresolvedQueueState: cashierState.unresolvedQueueState,
                        unresolvedLastError: cashierState.unresolvedLastError,
                        buttonClass: button?.className,
                        buttonDisabled: button?.disabled,
                        pageVisibility: document.visibilityState
                    };
                });
                console.error(`Next-customer page ${index + 1} state: ${JSON.stringify(snapshot)}`);
                throw error;
            });
        }
        await first.click('#startNextOrderBtn');
        await first.waitForSelector('#addCatalogLineBtn:not([disabled])');
        assert.equal(await first.locator('[data-catalog-item]').count(), 0);
        assert.equal(await first.inputValue('#catalogDiscountRule'), '');
        assert.match(await first.textContent('#catalogFinalTotal'), /0[,.]00/);
        assert.equal(await first.locator(`#unresolvedOrdersBody [data-order-id="${firstId}"]`).count(), 1, 'previous paid receipt remains in recovery');
        await second.click('#startNextOrderBtn');
        assert.equal(await second.evaluate(() => window.CashierPaymentsPage.state.orderDetails.order.id), firstId, 'stale tab cannot reset another customer');
        await addFirstVisibleCatalogItem(first);
        await first.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await first.click('#createPaymentOrderBtn');
        await first.waitForFunction(id => {
            const cashierState = window.CashierPaymentsPage.state;
            return !cashierState.createInFlight
                && Boolean(cashierState.orderDetails?.order?.id)
                && cashierState.orderDetails.order.id !== id;
        }, firstId);
        assert.equal(state.orders.size, 2, 'same cart for next customer creates a different order');
        assert.notEqual(state.createKeys.at(-1), originalKey);
        const secondId = [...state.orders.keys()].at(-1);
        Object.assign(state.orders.get(secondId), { status: 'payment_recorded', paymentStatus: 'confirmed', fiscalStatus: 'fiscalized' });
        await first.evaluate(id => window.CashierPaymentsPage.loadPaymentOrder(id, { silent: true }), secondId);
        assert.equal(await first.isDisabled('#createPaymentOrderBtn'), true, 'completed order cannot be submitted again');
        assert.match(await first.textContent('#fiscalPendingMessage'), /Оплату завершено/);
        const actionableErrors = actionableBrowserErrors(browserErrors);
        assert.deepEqual(actionableErrors, [], `next-customer browser emitted errors: ${actionableErrors.join(' | ')}`);
        await context.close();
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
    console.log('Next-customer browser smoke passed: lost response, reload, two tabs, stale reset, identical next cart, pending recovery, completed state');
}

run().catch(error => { console.error(error); process.exit(1); });
