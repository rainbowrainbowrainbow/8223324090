#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    actionableBrowserErrors,
    startServer,
    requirePlaywright,
    permissionPayload
} = require('./cashier-payments-browser-smoke');

const OUTPUT_DIR = String(process.env.CASHIER_HISTORY_VISUAL_ARTIFACT_DIR || '').trim()
    ? path.resolve(process.env.CASHIER_HISTORY_VISUAL_ARTIFACT_DIR)
    : null;

function reportPayload({ id = 9001, page = 1, totalCount = 75, empty = false } = {}) {
    const orders = empty ? [] : [{
        id,
        confirmedAt: '2026-09-11T08:33:34.077Z',
        paymentMethod: 'cash',
        fiscalStatus: 'fiscalized',
        totalAmountMinor: '123450',
        providerTaxUrl: 'https://api.checkbox.ua/receipts/test',
        providerPdfUrl: 'https://api.checkbox.ua.attacker.test/receipts/test.pdf',
        providerQrUrl: 'https://api.checkbox.in.ua/receipts/test/qr'
    }];
    return {
        success: true,
        internalReport: true,
        officialZReport: false,
        page,
        pageSize: 50,
        totalCount: empty ? 0 : totalCount,
        filters: {},
        totals: {
            paymentTotalMinor: empty ? '0' : '823450',
            cashTotalMinor: empty ? '0' : '423450',
            cardTerminalTotalMinor: empty ? '0' : '400000',
            statusCounts: empty ? {} : {
                fiscalized: 69,
                pending: 1,
                failed_retryable: 1,
                unknown: 1,
                validation_failed: 1,
                failed_terminal: 1,
                dead: 1
            }
        },
        orders
    };
}

async function screenshot(page, name) {
    if (!OUTPUT_DIR) return;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({
        path: path.join(OUTPUT_DIR, name),
        fullPage: true,
        animations: 'disabled',
        caret: 'hide'
    });
}

async function waitForRequestCount(requests, expected) {
    const startedAt = Date.now();
    while (requests.length < expected && Date.now() - startedAt < 3000) {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(requests.length, expected);
}

async function run() {
    const { chromium } = requirePlaywright();
    const server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({
        headless: true,
        args: ['--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1']
    });
    let context;
    try {
        context = await browser.newContext({ timezoneId: 'Europe/Kyiv', viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(() => {
            localStorage.setItem('pzp_token', 'receipt-history-smoke-token');
            localStorage.setItem('pzp_dark_mode', 'false');
        });
        await context.route('**/api/auth/permissions*', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(permissionPayload(true, { fiscalConfigure: true }))
        }));
        await context.route('**/api/auth/verify', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: { id: 4, name: 'Receipt History QA', role: 'creator', roles: ['creator'], businessProfile: 'event_genix' } })
        }));

        const requests = [];
        const held = [];
        let mode = 'hold';
        let responseId = 9001;
        await context.route('**/api/payments/checkbox-sales-report*', async route => {
            const request = route.request();
            assert.equal(request.method(), 'GET', 'history control must remain read-only');
            const url = new URL(request.url());
            requests.push(url);
            if (mode === 'hold') {
                held.push(route);
                return;
            }
            if (mode === 'offline') return route.abort('internetdisconnected');
            if (mode === '403') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'forbidden' }) });
            if (mode === '500') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'history_failed' }) });
            const page = Number(url.searchParams.get('page') || 1);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(reportPayload({ id: responseId, page, empty: mode === 'empty' }))
            });
        });

        const page = await context.newPage();
        const mutationRequests = [];
        const browserErrors = [];
        page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`));
        page.on('console', message => {
            if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
        });
        page.on('request', request => {
            if (request.url().includes('/api/payments/') && request.method() !== 'GET') mutationRequests.push(`${request.method()} ${request.url()}`);
        });
        await page.goto(`${base}/cashier-payments?saleMode=admission&businessContext=event_genix&routeOptionId=park_production`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.CashierPaymentsPage?.state?.routeReady === true);

        const summary = page.locator('#checkboxSalesReportPanel > summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        await waitForRequestCount(requests, 1);
        assert.equal(await page.locator('#checkboxSalesReportPanel').getAttribute('open'), '');
        assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#checkboxSalesReportPanel > summary')), true);
        assert.equal(await page.locator('#loadCheckboxSalesReportBtn').textContent(), 'Оновлюємо…');

        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(80);
        assert.equal(requests.length, 1, 'repeated toggle during loading shares the first request');
        mode = 'normal';
        await held.shift().fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reportPayload()) });
        await page.waitForSelector('#checkboxSalesReportBody .cashier-history-item');
        assert.equal(requests.length, 1, 'first open performs exactly one GET');
        assert.equal(await page.locator('.cashier-history-link').count(), 2, 'only exact trusted Checkbox hosts render as actions');
        assert.equal(await page.locator('a[href*="attacker.test"]').count(), 0);
        assert.equal((await page.locator('#checkboxReportRange').textContent()).trim(), '1–50 із 75');
        assert.match(await page.locator('#checkboxSalesReportBody').textContent(), /В обробці\s*2[\s\S]*Невідомо\s*1[\s\S]*Зупинено\s*3/);

        await page.evaluate(() => {
            const key = Object.keys(localStorage).find(item => item.endsWith(':pendingOrderIds'));
            if (key) localStorage.setItem(key, JSON.stringify(['777']));
            const status = document.getElementById('cashierGlobalStatus');
            status.textContent = 'Результат оплати уточнюється. Не повторюйте оплату.';
            status.className = 'cashier-alert cashier-alert-danger';
            window.CashierPaymentsPage.state.paymentErrorActive = true;
        });
        responseId = 9002;
        await page.locator('#loadCheckboxSalesReportBtn').click();
        await page.waitForFunction(() => document.querySelector('#checkboxSalesReportBody')?.textContent.includes('RCP-9002'));
        assert.match(await page.locator('#cashierGlobalStatus').textContent(), /Результат оплати уточнюється/);

        mode = 'hold';
        await page.locator('[data-history-period="yesterday"]').click();
        await waitForRequestCount(requests, 3);
        mode = 'normal';
        responseId = 9004;
        await page.locator('[data-history-period="today"]').click();
        await waitForRequestCount(requests, 4);
        await page.waitForFunction(() => document.querySelector('#checkboxSalesReportBody')?.textContent.includes('RCP-9004'));
        await held.shift().fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reportPayload({ id: 9003 })) });
        await page.waitForTimeout(80);
        assert.doesNotMatch(await page.locator('#checkboxSalesReportBody').textContent(), /RCP-9003/, 'late date response is ignored');

        mode = 'hold';
        await page.locator('#loadCheckboxSalesReportBtn').click();
        await waitForRequestCount(requests, 5);
        mode = 'normal';
        responseId = 9010;
        assert.equal(await page.isDisabled('#paymentBusinessContext'), true, 'business selector is read-only; business changes through the global CRM switch');
        await page.evaluate(() => {
            const currentUser = String(window.CashierPaymentsPage?.state?.user?.id || '');
            localStorage.setItem('pzp_crm_business_context', 'dar');
            if (currentUser) localStorage.setItem('pzp_crm_business_context_user', currentUser);
            window.dispatchEvent(new CustomEvent('crmBusinessContextChanged', {
                detail: { previous: 'event_genix', current: 'dar' }
            }));
        });
        await page.waitForFunction(() => window.CashierPaymentsPage?.state?.routeReady === true && document.querySelector('#paymentBusinessContext')?.value === 'dar');
        await waitForRequestCount(requests, 6);
        await page.waitForFunction(() => document.querySelector('#checkboxSalesReportBody')?.textContent.includes('RCP-9010'));
        await held.shift().fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reportPayload({ id: 9009 })) });
        await page.waitForTimeout(80);
        assert.doesNotMatch(await page.locator('#checkboxSalesReportBody').textContent(), /RCP-9009/, 'late prior-route response is ignored');
        assert.match(await page.locator('#checkboxReportAppliedFilter').textContent(), /ДАР/);

        responseId = 9011;
        await page.locator('#checkboxReportNextPage').click();
        await page.waitForFunction(() => document.querySelector('#checkboxSalesReportBody')?.textContent.includes('RCP-9011'));
        await page.waitForFunction(() => document.querySelector('#checkboxReportRange')?.textContent.includes('51–75'));
        assert.match(await page.locator('#checkboxSalesReportBody').textContent(), /RCP-9011/);
        assert.match(await page.locator('#checkboxSalesReportBody').textContent(), /8\s?234,50/);
        assert.equal(await page.locator('#checkboxReportNextPage').isDisabled(), true);

        mode = '500';
        await page.locator('#loadCheckboxSalesReportBtn').click();
        await page.waitForFunction(() => document.querySelector('#checkboxReportRefreshStatus')?.textContent.includes('Не вдалося оновити'));
        assert.match(await page.locator('#checkboxSalesReportBody').textContent(), /RCP-9011/);
        assert.match(await page.locator('#checkboxReportRefreshStatus').textContent(), /неактуальними/);

        for (const [failureMode, date] of [['403', '2026-09-08'], ['500', '2026-09-07'], ['offline', '2026-09-06']]) {
            mode = failureMode;
            await page.locator('[data-history-period="custom"]').click();
            await page.evaluate(value => {
                const from = document.getElementById('checkboxReportDateFrom');
                const to = document.getElementById('checkboxReportDateTo');
                from.value = value;
                to.value = value;
                to.dispatchEvent(new Event('change', { bubbles: true }));
            }, date);
            await page.waitForFunction(() => document.querySelector('#checkboxSalesReportBody')?.classList.contains('is-error'));
            assert.match(await page.locator('#checkboxSalesReportBody').textContent(), /Дані не вважаються порожніми/);
            assert.doesNotMatch(await page.locator('#checkboxSalesReportBody').textContent(), /чеків немає/);
        }

        mode = 'empty';
        await page.evaluate(() => {
            const to = document.getElementById('checkboxReportDateTo');
            to.value = '2026-09-05';
            to.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelector('#checkboxSalesReportBody')?.textContent.includes('За цим фільтром чеків немає'));
        assert.match(await page.locator('#checkboxSalesReportSummaryBadge').textContent(), /чеків немає/);

        mode = 'normal';
        responseId = '1234567890123456789012345678901234567890';
        await page.locator('#loadCheckboxSalesReportBtn').click();
        await page.waitForSelector('#checkboxSalesReportBody .cashier-history-item');
        for (const dark of [false, true]) {
            await page.evaluate(value => document.body.classList.toggle('dark-mode', value), dark);
            for (const width of [1440, 1024, 390]) {
                await page.setViewportSize({ width, height: 1000 });
                const layout = await page.locator('#checkboxSalesReportPanel').evaluate(panel => ({
                    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
                    panelFits: panel.scrollWidth <= panel.clientWidth + 1,
                    rowsFit: [...panel.querySelectorAll('.cashier-history-item')].every(row => row.scrollWidth <= row.clientWidth + 1),
                    panelWidth: panel.clientWidth,
                    panelScrollWidth: panel.scrollWidth,
                    overflowing: [...panel.querySelectorAll('*')]
                        .filter(element => element.scrollWidth > element.clientWidth + 1)
                        .slice(0, 5)
                        .map(element => `${element.tagName.toLowerCase()}#${element.id}.${element.className}`)
                }));
                assert.equal(layout.documentFits, true, `document fits at ${width}px: ${JSON.stringify(layout)}`);
                assert.equal(layout.panelFits, true, `history panel fits at ${width}px: ${JSON.stringify(layout)}`);
                assert.equal(layout.rowsFit, true, `history rows fit at ${width}px: ${JSON.stringify(layout)}`);
                await screenshot(page, `history-${dark ? 'dark' : 'light'}-${width}.png`);
            }
        }
        assert.deepEqual(mutationRequests, [], 'history interactions never send payment/provider mutations');
        const actionableErrors = actionableBrowserErrors(browserErrors);
        assert.deepEqual(actionableErrors, [], `history browser emitted errors: ${actionableErrors.join(' | ')}`);
    } finally {
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
    console.log('Cashier receipt history browser smoke passed');
}

if (require.main === module) run().catch(error => {
    console.error(error);
    process.exit(1);
});
