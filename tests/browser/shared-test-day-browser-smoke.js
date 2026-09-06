'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, requirePlaywright, state, permissionPayload } = require('./cashier-payments-browser-smoke');

async function run() {
    const server = await startServer();
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    const output = path.resolve('output/playwright/park-dar/test-day');
    fs.mkdirSync(output, { recursive: true });
    let active = null;
    let failResume = true;
    const keys = { drain: [], resume: [] };
    state.shift = { id: 501, status: 'open', providerStatus: 'OPENED' };
    try {
        const context = await browser.newContext({ viewport: { width: 1152, height: 800 } });
        await context.addInitScript(() => { localStorage.setItem('pzp_token', 'day-fixture'); localStorage.setItem('pzp_dark_mode', 'false'); });
        await context.route('**/api/auth/verify', route => route.fulfill({ json: { user: { id: 4, name: 'Test owner', role: 'creator', roles: ['creator'], businessProfile: 'event_genix' } } }));
        await context.route('**/api/auth/permissions*', route => route.fulfill({ json: permissionPayload(true, { fiscalConfigure: true }) }));
        await context.route('**/api/payments/catalog/routes*', route => route.fulfill({ json: { success: true, routes: [{ id: 'park_test', businessContext: 'event_genix', businessLabel: 'ПАРК', mode: 'test', registerLabel: 'Тестова каса', status: 'active', configured: true, featureEnabled: true, acceptanceEnabled: true, sequentialReady: true, readinessCode: 'ready' }] } }));
        await context.route('**/api/payments/pilot-register-state*', async route => {
            const original = await (await route.fetch()).json();
            await route.fulfill({ json: { ...original, sharedTestDay: { visible: true, activeDrain: active,
                localDrainBlocked: Boolean(active), canDrain: !active && state.shift.providerStatus === 'OPENED', canResume: active?.status === 'closed' } } });
        });
        await context.route('**/api/payments/shifts/*/phase1-drain', async route => {
            assert.equal(route.request().headers()['x-fiscal-route-option'], 'park_test');
            assert.deepEqual(route.request().postDataJSON(), {});
            keys.drain.push(route.request().headers()['idempotency-key']);
            active = { id: 91, shiftId: 501, status: 'draining' };
            await route.abort('connectionreset'); // Lost response after durable server acceptance.
        });
        await context.route('**/api/payments/test-drains/*/resume', async route => {
            assert.deepEqual(route.request().postDataJSON(), { confirmNextTestDay: true });
            keys.resume.push(route.request().headers()['idempotency-key']);
            if (failResume) { failResume = false; return route.abort('connectionreset'); }
            active = null;
            return route.fulfill({ json: { success: true, drain: { id: 91, status: 'resumed' }, activeDrain: null } });
        });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/cashier-payments?businessContext=event_genix&routeOptionId=park_test`);
        await page.waitForSelector('#sharedTestDrainBtn:not([disabled])');
        await page.click('#addCatalogLineBtn');
        await page.click('#sharedTestDrainBtn');
        await page.waitForSelector('.confirm-overlay');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#sharedTestDrainBtn:not([disabled])');
        assert.equal(keys.drain.length, 0);
        await page.click('#sharedTestDrainBtn');
        await page.getByRole('button', { name: 'Підтвердити', exact: true }).click();
        await page.waitForFunction(() => window.CashierPaymentsPage.state.registerState?.sharedTestDay?.localDrainBlocked === true);
        assert.equal(keys.drain.length, 1);
        assert.equal(await page.isDisabled('#createPaymentOrderBtn'), true);
        assert.equal(await page.isDisabled('#sharedTestResumeBtn'), true);
        assert.equal(state.phase1CloseKeys.length, 0, 'stop never automatically closes a shift');
        state.shift = { ...state.shift, status: 'closed', providerStatus: 'CLOSED' };
        active.status = 'closed';
        await page.reload();
        await page.waitForSelector('#sharedTestResumeBtn:not([disabled])');
        for (const width of [1152, 390]) for (const dark of [false, true]) {
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(value => document.body.classList.toggle('dark-mode', value), dark);
            await page.locator('#sharedTestDayPanel').screenshot({ path: path.join(output, `closed-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
        }
        await page.click('#sharedTestResumeBtn');
        await page.getByRole('button', { name: 'Підтвердити', exact: true }).click();
        await page.waitForSelector('#sharedTestResumeBtn:not([disabled])');
        assert.equal(active.status, 'closed', 'failed resume preserves stop');
        await page.reload();
        await page.waitForSelector('#sharedTestResumeBtn:not([disabled])');
        await page.click('#sharedTestResumeBtn');
        await page.getByRole('button', { name: 'Підтвердити', exact: true }).click();
        await page.waitForFunction(() => window.CashierPaymentsPage.state.registerState?.sharedTestDay?.localDrainBlocked === false);
        assert.equal(keys.resume.length, 2);
        assert.equal(keys.resume[0], keys.resume[1], 'resume key survives uncertain response and reload');
        assert.equal(state.shift.providerStatus, 'CLOSED', 'resume does not open a shift');
        assert.equal(state.orders.size, 0, 'lifecycle UI never creates a payment');
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ result: 'PASS', cancel: true, lostStopResponse: true,
            resumeRetryAfterReload: true, noAutomaticCloseOpenOrPayment: true, screenshotCount: 4 }, null, 2));
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
    console.log('Shared Test day browser smoke PASS');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
