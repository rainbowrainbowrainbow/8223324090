'use strict';

const assert = require('node:assert/strict');
const { requirePlaywright } = require('./cashier-payments-browser-smoke');

// Invoked inside the disposable PG/loopback provider integration suite.
// All app assets, auth, permission and payment responses come from the actual app.
async function startCanonicalTwoTab({ baseUrl, actor, itemCode, pool }) {
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort('blockedbyclient');
    });
    const captured = [];
    const pageErrors = [];
    const authFailures = [];
    let loseFirstResponse = true;
    context.on('response', response => {
        if (new URL(response.url()).pathname.startsWith('/api/auth/') && response.status() >= 400) {
            authFailures.push({ path: new URL(response.url()).pathname, status: response.status() });
        }
    });
    // Only the first payment response is lost, after real HTTP/PG acceptance.
    await context.route('**/api/payments/catalog/orders', async route => {
        const response = await route.fetch();
        const body = await response.json();
        captured.push({ key: route.request().headers()['idempotency-key'], request: route.request().postDataJSON(),
            response: { status: response.status(), body } });
        if (loseFirstResponse) { loseFirstResponse = false; await route.abort('connectionreset'); }
        else await route.fulfill({ response });
    });
    const first = await context.newPage();
    const second = await context.newPage();
    for (const page of [first, second]) page.on('pageerror', error => pageErrors.push(error.message));
    const url = `${baseUrl}/cashier-payments?businessContext=event_genix&routeOptionId=park_test`;
    try {
        await first.goto(`${baseUrl}/status.html`, { waitUntil: 'domcontentloaded' });
        await first.waitForFunction(() => typeof window.apiLogin === 'function');
        await first.evaluate(async credentials => {
            const result = await window.apiLogin(credentials.username, credentials.password);
            window.rememberApiAuthSession(result);
        }, { username: actor.username, password: actor.password });
        authFailures.length = 0; // Only authenticated navigation belongs to this proof.
        for (const page of [first, second]) {
            await page.goto(url, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#addCatalogLineBtn:not([disabled])', { timeout: 30000 });
            await page.click('#addCatalogLineBtn');
            await page.selectOption('[data-catalog-item]', itemCode);
            await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        }
        await first.click('#createPaymentOrderBtn');
        await first.waitForFunction(() => !window.CashierPaymentsPage.state.createInFlight);
        assert.equal(captured.length, 1);
        assert.equal(captured[0].response.status, 201, JSON.stringify(captured[0].response.body));
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM payment_orders')).rows[0].count, 1);
        assert.equal(await first.isDisabled('#addCatalogLineBtn'), true);
        await first.reload({ waitUntil: 'domcontentloaded' });
        await first.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await Promise.all([first.click('#createPaymentOrderBtn'), second.click('#createPaymentOrderBtn')]);
        const orderId = captured[0].response.body.order.id;
        for (const page of [first, second]) await page.waitForFunction(id =>
            window.CashierPaymentsPage?.state?.orderDetails?.order?.id === id, orderId);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM payment_orders')).rows[0].count, 1);
        assert.ok(captured.every(request => request.key === captured[0].key));
        for (const page of [first, second]) assert.equal(new URL(page.url()).pathname, '/cashier-payments');
        assert.deepEqual(authFailures, []);
        assert.deepEqual(pageErrors, []);
        return {
            cash: { body: captured[0].request, response: captured[0].response, key: captured[0].key },
            async createNextCard() {
                for (const page of [first, second]) {
                    await page.click('#refreshReadinessBtn');
                    await page.waitForFunction(() => !window.CashierPaymentsPage.state.readinessInFlight);
                    await page.evaluate(id => window.CashierPaymentsPage.loadPaymentOrder(id, { silent: true }), orderId);
                    await page.waitForSelector('#startNextOrderBtn:not(.hidden):not([disabled])');
                }
                await first.click('#startNextOrderBtn');
                await first.waitForSelector('#addCatalogLineBtn:not([disabled])');
                assert.equal(await first.locator('[data-catalog-item]').count(), 0);
                assert.equal(await first.inputValue('#catalogDiscountRule'), '');
                assert.equal(await first.locator(`#unresolvedOrdersBody [data-order-id="${orderId}"]`).count(), 1);
                await second.click('#startNextOrderBtn');
                assert.equal(await second.evaluate(() => window.CashierPaymentsPage.state.orderDetails.order.id), orderId);
                await first.click('#addCatalogLineBtn');
                await first.selectOption('[data-catalog-item]', itemCode);
                await first.fill('[data-catalog-quantity]', '2');
                await first.check('input[name="paymentTender"][value="card_terminal_manual"]');
                await first.waitForSelector('#createPaymentOrderBtn:not([disabled])');
                await first.click('#createPaymentOrderBtn');
                await first.waitForFunction(id => {
                    const current = window.CashierPaymentsPage.state.orderDetails?.order?.id;
                    return current && current !== id;
                }, orderId);
                const next = captured.at(-1);
                assert.equal(next.response.status, 201, JSON.stringify(next.response.body));
                assert.notEqual(next.key, captured[0].key);
                assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM payment_orders')).rows[0].count, 2);
                for (const page of [first, second]) assert.equal(new URL(page.url()).pathname, '/cashier-payments');
                assert.deepEqual(authFailures, []);
                assert.deepEqual(pageErrors, []);
                return { body: next.request, response: next.response };
            },
            proof: { canonicalAssets: true, canonicalAuth: true, actualPostgres: true, twoTabs: true,
                lostResponseAfterAcceptance: true, reload: true, stableKey: true, noDuplicateOrder: true,
                nextCustomer: true, staleTabProtected: true, pendingQueueRetained: true },
            close: () => browser.close()
        };
    } catch (error) {
        // Only safe UI state, never cookies/tokens or credentials.
        error.message += `; paths=${JSON.stringify([first, second].map(page => { try { return new URL(page.url()).pathname; } catch { return 'unloaded'; } }))}; authFailures=${JSON.stringify(authFailures)}`;
        await browser.close();
        throw error;
    }
}

module.exports = { startCanonicalTwoTab };
