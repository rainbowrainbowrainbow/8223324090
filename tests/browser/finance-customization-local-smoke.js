'use strict';

// Real finance assets, synthetic in-memory API only. No credentials, DB or provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createFixtureServer } = require('./finance-workflow-fixture');
const output = path.resolve(__dirname, '../../output/playwright/finance-customization-local');

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const fixture = createFixtureServer();
    await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${fixture.server.address().port}`;
    let browser;
    let scenarios = 0;
    const errors = [];
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
        for (const theme of ['dark', 'light']) for (const width of [390, 1440]) {
            const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
            const suffix = `${theme}-${width}`;
            const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow: ${suffix}`);
            const shot = async name => {
                while (await page.locator('#toastContainer .toast').count()) {
                    await page.locator('#toastContainer .toast').first().waitFor({ state: 'detached', timeout: 10000 });
                }
                assert.equal(await page.locator('#toastContainer .toast').count(), 0, 'screenshots must not obscure content with a toast');
                await noOverflow();
                await page.screenshot({ path: path.join(output, `${name}-${suffix}.png`), fullPage: true, animations: 'disabled' });
            };

            await page.goto(`${origin}/finance?theme=${theme}&tab=accounts`);
            await page.locator('#accountsList .fin-account-card').first().waitFor();
            await page.locator('#accountsList button').filter({ hasText: /^Редагувати$/ }).first().click();
            assert.equal(await page.locator('#accType').isDisabled(), true);
            const newName = `Каса тестування ${suffix}`;
            await page.locator('#accName').fill(newName);
            await page.locator('#accEmoji').selectOption('💼');
            await page.locator('#accDescription').fill('Перевірка метаданих без зміни типу та історії');
            await shot('account-edit');
            const saved = page.waitForResponse(response => response.url() === `${origin}/api/finance/accounts/1` && response.request().method() === 'PATCH');
            await page.locator('#addAccountModal').getByRole('button', { name: 'Зберегти', exact: true }).click();
            const accountResponse = await saved;
            assert.deepEqual(Object.keys(accountResponse.request().postDataJSON()).sort(), ['description', 'emoji', 'name']);
            await page.locator('#addAccountModal').waitFor({ state: 'hidden' });
            await page.getByText(newName, { exact: true }).waitFor();
            await shot('accounts');

            await page.locator('[data-finance-group="planning"]').click();
            await page.locator('#budgetAmountInput').fill('987');
            await page.locator('[data-finance-categories="budgetCategorySelect"]').click();
            await page.locator('#financeCategoryRecord').selectOption('2');
            const beforeReuse = fixture.requests.filter(request => request.method !== 'GET').length;
            await page.locator('#useFinanceCategoryBtn').click();
            await page.locator('#financeCategoryModal').waitFor({ state: 'hidden' });
            assert.equal(await page.locator('#budgetCategorySelect').inputValue(), '2');
            assert.equal(await page.locator('#budgetAmountInput').inputValue(), '987');
            assert.equal(fixture.requests.filter(request => request.method !== 'GET').length, beforeReuse, 'category reuse has no writes');

            await page.locator('[data-finance-categories="budgetCategorySelect"]').click();
            await page.locator('#financeCategoryName').fill(' матеріали qa ');
            await page.locator('#saveFinanceCategoryBtn').click();
            await page.locator('#financeCategoryError').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#useFinanceCategoryBtn').isVisible(), true);
            await shot('category-reuse');
            await page.locator('#useFinanceCategoryBtn').click();
            await page.locator('.confirm-overlay .confirm-ok').click();
            await page.locator('#financeCategoryModal').waitFor({ state: 'hidden' });
            assert.equal(fixture.requests.filter(request => request.method !== 'GET').length, beforeReuse);

            await page.locator('.fin-tab[data-tab="forecast"]').click();
            await page.getByText('Залишок до сплати', { exact: true }).waitFor();
            assert.match(await page.locator('#forecastContent').innerText(), /5\s*700/);
            await shot('forecast');
            await page.locator('[data-finance-group="results"]').click();
            await page.getByText('Зафіксовані переходи угод', { exact: true }).waitFor();
            assert.match(await page.locator('#dealsLifecycleContent').innerText(), /Вперше зафіксовано прийняття/);
            const dealsChart = page.locator('.an-bar-chart--deals');
            const chooseDealsRange = async (from, to, expectedBars) => {
                await page.locator('#dateFromFilter').fill(from);
                const response = page.waitForResponse(value => {
                    const url = new URL(value.url());
                    return url.pathname === '/api/analytics/deals-lifecycle'
                        && url.searchParams.get('from') === from && url.searchParams.get('to') === to;
                });
                await page.locator('#dateToFilter').fill(to);
                const body = await (await response).json();
                assert.equal(body.recordedEvents.trend.length,
                    Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
                await page.waitForFunction(count => document.querySelectorAll('.an-bar-chart--deals .an-bar-group').length === count, expectedBars);
                await noOverflow();
                assert.ok(await dealsChart.locator('.an-bar[title$=": 0"]').evaluateAll(bars => bars.length > 0
                    && bars.every(bar => bar.getBoundingClientRect().height === 0)), 'zero-filled days must not render a positive bar');
                assert.ok(await dealsChart.locator('.an-bar-label').evaluateAll(labels => labels.every(label => {
                    const text = document.createRange(); text.selectNodeContents(label);
                    return text.getBoundingClientRect().width <= label.parentElement.getBoundingClientRect().width;
                })), 'date labels must fit their groups without overlap');
                await dealsChart.evaluate(chart => { chart.scrollLeft = chart.scrollWidth; });
                assert.ok(await dealsChart.evaluate(chart => chart.lastElementChild.getBoundingClientRect().right <= chart.getBoundingClientRect().right + 1), 'last date is reachable inside chart');
                await dealsChart.evaluate(chart => { chart.scrollLeft = 0; });
            };
            await chooseDealsRange('2026-10-01', '2026-10-31', 31);
            await shot('deals-history');
            await page.locator('#dealsLifecycleContent').screenshot({ path: path.join(output, `deals-chart-month-${suffix}.png`), animations: 'disabled' });
            await chooseDealsRange('2024-01-01', '2024-12-31', 12);
            assert.match(await dealsChart.locator('.an-bar-label').first().innerText(), /^2024-01$/);
            assert.match(await dealsChart.locator('.an-bar-label').last().innerText(), /^2024-12$/);
            assert.match(await page.locator('#dealsLifecycleContent').innerText(), /за місяцями/);
            await shot('deals-history-year');
            await page.locator('#dealsLifecycleContent').screenshot({ path: path.join(output, `deals-chart-year-${suffix}.png`), animations: 'disabled' });
            await page.locator('.fin-tab[data-tab="pnl"]').click();
            await page.locator('#pnlContent .fin-stat-label').filter({ hasText: 'Результат за обліком' }).waitFor();
            const pnlText = await page.locator('#pnlContent').innerText();
            assert.doesNotMatch(pnlText, /Чистий прибуток/);
            const pnlYear = await page.locator('#pnlYear').inputValue();
            assert.equal(await page.locator('#pnlMonth').inputValue(), '');
            for (const date of [`01.01.${pnlYear}`, `31.12.${pnlYear}`, `01.01.${Number(pnlYear) - 1}`, `31.12.${Number(pnlYear) - 1}`]) {
                assert.ok(pnlText.includes(date), `P&L fixture must reflect selected full year: ${date}`);
            }
            await shot('pnl');
            await page.locator('.fa-tools > summary').click();
            await page.locator('#openCurrencyRatesBtn').click();
            await page.locator('#currencyRatesGrid .currency-rate-card').first().waitFor();
            assert.match(await page.locator('#currencyRatesMeta').innerText(), /08.10.2026/);
            assert.match(await page.locator('#currencyRatesGrid').innerText(), /42[.,]12/);
            await shot('currency');
            if (theme === 'light' && width === 1440) {
                await page.goto(`${origin}/finance?theme=${theme}&tab=accounts`);
                await page.locator('#addFinanceAccountBtn').click();
                assert.equal(await page.locator('#accType').isEnabled(), true);
                await page.locator('#accName').fill('Тимчасовий рахунок для архіву');
                await page.locator('#addAccountModal').getByRole('button', { name: 'Зберегти', exact: true }).click();
                await page.getByRole('button', { name: 'Архівувати рахунок Тимчасовий рахунок для архіву', exact: true }).click();
                await page.locator('.confirm-overlay .confirm-ok').click();
                await page.getByText('Тимчасовий рахунок для архіву', { exact: true }).waitFor({ state: 'hidden' });
                assert.equal(fixture.accounts.find(account => account.name === 'Тимчасовий рахунок для архіву').is_active, false);
            }
            await page.close();
            scenarios++;
        }
        const viewer = await browser.newPage({ viewport: { width: 390, height: 1000 }, serviceWorkers: 'block' });
        await viewer.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
        await viewer.goto(`${origin}/finance?theme=dark&tab=accounts&viewer=1`);
        await viewer.locator('#accountsList .fin-account-card').first().waitFor();
        assert.equal(await viewer.locator('#accountsList button').count(), 0);
        assert.equal(await viewer.locator('#addFinanceAccountBtn').isVisible(), false);
        await viewer.close();
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ success: true, scenarios, viewer: 'read-only', externalRequests: 'blocked', output }));
    } finally {
        await browser?.close();
        await new Promise(resolve => fixture.server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
