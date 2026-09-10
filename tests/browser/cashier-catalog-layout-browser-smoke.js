'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, requirePlaywright, permissionPayload, state } = require('./cashier-payments-browser-smoke');

async function run() {
    const output = path.resolve(process.env.CASHIER_LAYOUT_OUTPUT || 'output/playwright/park-dar/summary-layout');
    fs.mkdirSync(output, { recursive: true });
    const server = await startServer();
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    const report = { browser: browser.version(), kind: 'CSS viewport layout; NOT native browser zoom', cases: [] };
    try {
        const context = await browser.newContext({ viewport: { width: 1152, height: 800 } });
        await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await context.route('**/js/auth.js*', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: `
            window.AppState = window.AppState || {};
            window.canAccess = window.canAccessPage = () => true;
            window.apiVerifyToken = async () => ({ id: 4, name: 'Layout QA', role: 'creator' });
            window.hydrateActionPermissions = async () => ({});
            window.getAuthHeaders = () => ({ 'Content-Type': 'application/json' });
            window.showAuthenticatedPageShell = () => { document.querySelector('#mainApp').classList.remove('hidden'); document.body.classList.add('authenticated-shell', 'shell-ready'); };
        ` }));
        await context.addInitScript(() => {
            localStorage.setItem('pzp_token', 'layout-fixture-token');
            localStorage.setItem('pzp_dark_mode', 'false');
        });
        await context.route('**/api/auth/verify', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 4, name: 'Layout QA', role: 'creator', roles: ['creator'], businessProfile: 'event_genix' } }) }));
        await context.route('**/api/auth/permissions*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(permissionPayload(true, { fiscalConfigure: true })) }));
        const page = await context.newPage();
        const pageErrors = [];
        const paymentErrors = [];
        const mutations = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('request', request => {
            if (request.url().includes('/api/payments/') && request.method() !== 'GET') mutations.push(request.url());
        });
        page.on('response', response => {
            if (response.url().includes('/api/payments/') && response.status() >= 400) paymentErrors.push(response.status());
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/cashier-payments?businessContext=event_genix&routeOptionId=park_production`);
        await page.waitForSelector('#addCatalogLineBtn:not([disabled])');
        await page.click('#addCatalogLineBtn');
        assert.equal(await page.locator('[data-catalog-item]').count(), 0);
        await page.locator('[data-catalog-add]').first().click();
        assert.equal(await page.locator('[data-catalog-add]').count(), 140);
        await page.locator('[data-catalog-add]').first().click();
        assert.equal(await page.inputValue('[data-catalog-quantity]'), '2');
        await page.evaluate(() => {
            window.CashierPaymentsPage.state.catalogItems[0].name = 'Абонемент на індивідуальні творчі заняття та розвивальні майстер-класи для дітей';
            document.querySelector('[data-catalog-item]').dispatchEvent(new Event('change', { bubbles: true }));
        });
        for (const [width, height] of [[1152, 800], [960, 667], [1440, 1000], [390, 844]]) {
            await page.setViewportSize({ width, height });
            // Sidebar/responsive transitions must settle before measuring the form.
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
            for (const dark of [false, true]) {
                for (const longAmounts of [false, true]) {
                    await page.evaluate(({ dark, longAmounts }) => {
                        document.body.classList.toggle('dark-mode', dark);
                        const amounts = longAmounts
                            ? ['1 234 567 899,99 грн', '246 913 580,00 грн', '987 654 319,99 грн']
                            : ['10,00 грн', '0,00 грн', '10,00 грн'];
                        ['catalogOriginalTotal', 'catalogDiscountTotal', 'catalogFinalTotal'].forEach((id, index) => {
                            document.getElementById(id).textContent = amounts[index].replaceAll(' ', '\u00a0');
                        });
                    }, { dark, longAmounts });
                    const result = await page.evaluate(() => {
                        const summary = document.getElementById('catalogCartSummary');
                        const rows = [...summary.children];
                        const rect = el => el.getBoundingClientRect();
                        const separated = (a, b, gap) => a.right + gap <= b.left + 1 || b.right + gap <= a.left + 1 || a.bottom + gap <= b.top + 1 || b.bottom + gap <= a.top + 1;
                        const texts = rows.flatMap(row => [...row.children]);
                        const name = document.querySelector('[data-catalog-name]');
                        return {
                            summaryWidth: rect(summary).width,
                            rowsFit: rows.every(row => row.scrollWidth <= row.clientWidth + 1),
                            textsFit: texts.every(el => el.scrollWidth <= el.clientWidth + 1),
                            labelValueSeparated: rows.every(row => separated(rect(row.children[0]), rect(row.children[1]), 4)),
                            neighboringTextsSeparated: texts.every((a, i) => texts.slice(i + 1).every(b => separated(rect(a), rect(b), 4))),
                            summaryFits: summary.scrollWidth <= summary.clientWidth + 1,
                            nameFits: name.scrollWidth <= name.clientWidth + 1,
                            formFits: document.getElementById('paymentOrderForm').scrollWidth <= document.getElementById('paymentOrderForm').clientWidth + 1,
                            basketRowsFit: [...document.querySelectorAll('.cashier-catalog-line')].every(el => el.scrollWidth <= el.clientWidth + 1)
                        };
                    });
                    const screenshot = `${width}-${dark ? 'dark' : 'light'}-${longAmounts ? 'long' : 'normal'}.png`;
                    await page.locator('#catalogCartSummary').screenshot({ path: path.join(output, screenshot), animations: 'disabled' });
                    report.cases.push({ width, height, dark, longAmounts, result, screenshot });
                    assert.ok(Object.entries(result).every(([key, value]) => key === 'summaryWidth' || value === true), JSON.stringify(report.cases.at(-1)));
                    if (longAmounts) await page.locator('#paymentOrderForm').screenshot({ path: path.join(output, `form-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
                }
            }
        }
        const orderId = 9001;
        state.orders.set(orderId, { id: orderId, sourceId: 1, status: 'payment_recorded', paymentStatus: 'confirmed', fiscalStatus: 'failed', tender: 'cash' });
        let orderReads = 0;
        await context.route(`**/api/payments/orders/${orderId}`, async route => {
            orderReads += 1;
            const response = await route.fetch();
            const body = await response.json();
            if (body.outboxJob) Object.assign(body.outboxJob, { status: 'failed', lastErrorCode: 'checkbox_receipt_pending', attempts: 1 });
            await route.fulfill({ response, json: body });
        });
        await page.evaluate(id => window.CashierPaymentsPage.loadPaymentOrder(id, { silent: true }), orderId);
        assert.match(await page.textContent('#fiscalReceiptBadge'), /Checkbox обробляє чек/);
        assert.equal(await page.isDisabled('#confirmCashBtn'), true);
        const readsBefore = orderReads;
        state.orders.get(orderId).fiscalStatus = 'fiscalized';
        await page.waitForFunction(() => document.getElementById('fiscalReceiptBadge').textContent === 'чек створено', null, { timeout: 15000 });
        assert.ok(orderReads > readsBefore, 'actual page polling fetched the final state without manual refresh');
        assert.match(await page.textContent('#fiscalPendingMessage'), /Оплату завершено/);
        assert.equal(await page.isDisabled('#confirmCashBtn'), true);
        report.polling = { result: 'PASS', orderReads, final: 'fiscalized', paymentPosts: mutations.length };

        await page.goto(`http://127.0.0.1:${server.address().port}/cashier-payments?businessContext=dar&routeOptionId=dar_production`);
        await page.waitForSelector('[data-catalog-add]');
        await page.fill('#catalogSearch', 'dar_010');
        await page.locator('[data-catalog-add="dar_010"]').click();
        assert.equal(await page.inputValue('[data-catalog-item]'), 'dar_010');
        await page.fill('#catalogSearch', 'no such product');
        assert.match(await page.textContent('#catalogSearchResults'), /немає доступних позицій/);
        assert.equal(await page.inputValue('[data-catalog-item]'), 'dar_010');
        await page.fill('#catalogSearch', '');
        await page.selectOption('#catalogCategory', { index: 1 });
        assert.ok(await page.locator('[data-catalog-add]').count() > 0);
        assert.equal(await page.inputValue('[data-catalog-item]'), 'dar_010');
        await page.click('[data-catalog-remove]');
        assert.equal(await page.locator('[data-catalog-item]').count(), 0);
        report.darCatalog = 'PASS: code search, empty search, category, cart preservation, removal';
        assert.deepEqual(mutations, []);
        assert.deepEqual(paymentErrors, []);
        assert.deepEqual(pageErrors, []);
        report.result = 'PASS';
    } finally {
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
    console.log(`Cashier catalog layout PASS: ${report.cases.length} cases; ${output}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
