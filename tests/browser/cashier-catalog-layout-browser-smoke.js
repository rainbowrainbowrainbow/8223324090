'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, requirePlaywright, permissionPayload } = require('./cashier-payments-browser-smoke');

async function run() {
    const output = path.resolve(process.env.CASHIER_LAYOUT_OUTPUT || 'output/playwright/park-dar/summary-layout');
    fs.mkdirSync(output, { recursive: true });
    const server = await startServer();
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    const report = { browser: browser.version(), kind: 'CSS viewport layout; NOT native browser zoom', cases: [] };
    try {
        const context = await browser.newContext({ viewport: { width: 1152, height: 800 } });
        await context.addInitScript(() => {
            localStorage.setItem('pzp_token', 'layout-fixture-token');
            localStorage.setItem('pzp_dark_mode', 'false');
        });
        await context.route('**/api/auth/verify', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 4, name: 'Layout QA', role: 'creator', roles: ['creator'], businessProfile: 'event_genix' } }) }));
        await context.route('**/api/auth/permissions*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(permissionPayload(true, { fiscalConfigure: true })) }));
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/cashier-payments?businessContext=event_genix&routeOptionId=park_production`);
        await page.waitForSelector('#addCatalogLineBtn:not([disabled])');
        await page.click('#addCatalogLineBtn');
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
                            formFits: document.getElementById('paymentOrderForm').scrollWidth <= document.getElementById('paymentOrderForm').clientWidth + 1
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
        report.result = 'PASS';
    } finally {
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
    console.log(`Cashier catalog layout PASS: ${report.cases.length} cases; ${output}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
