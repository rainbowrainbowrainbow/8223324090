'use strict';

// Actual customer markup, styles and renderer; isolated fixture, no real auth/API/DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/finance-qa-local');
const html = fs.readFileSync(path.join(root, 'customers.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const uiStart = ui.indexOf('if (!window.Explainability)');
const explainability = ui.slice(uiStart, ui.indexOf('\n// ', uiStart));

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://fixture');
        assert.equal(req.method, 'GET');
        assert.ok(!url.pathname.startsWith('/api/'), 'fixture never calls any API');
        if (url.pathname === '/customers') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end(html);
        }
        const file = path.resolve(root, `.${url.pathname}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.QA_CHROMIUM_EXECUTABLE } : {}) });
        const page = await browser.newPage();
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}/customers`);
        await page.evaluate(() => {
            window.AppState = { currentUser: { role: 'creator' } };
            window.getUserRole = () => 'creator';
            window.resolveCapability = () => ({ allowed: true });
            window.showNotification = () => {};
            document.getElementById('mainApp').classList.remove('hidden');
            document.body.classList.add('shell-ready', 'dark-mode');
            document.documentElement.dataset.theme = 'dark';
        });
        await page.addScriptTag({ content: explainability });
        await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'js/customers-page.js'), 'utf8') });
        const results = [];
        for (const width of [1440, 820, 390]) {
            await page.setViewportSize({ width, height: 1180 });
            for (const filtered of [false, true]) {
                await page.evaluate(filtered => {
                    CrmState.customers = [];
                    CrmState.filters.search = filtered ? 'Synthetic no match' : '';
                    renderCustomerTable();
                }, filtered);
                await page.locator('.customer-list-table-wrap').scrollIntoViewIfNeeded();
                const bounds = await page.evaluate(() => {
                    const wrap = document.querySelector('.customer-list-table-wrap');
                    const box = wrap.getBoundingClientRect();
                    return { client: wrap.clientWidth, scroll: wrap.scrollWidth,
                        nodes: Array.from(wrap.querySelectorAll('.explain-empty,.explain-empty-title,.explain-empty-message,button')).map(el => {
                            const r = el.getBoundingClientRect();
                            return { left: r.left - box.left, right: r.right - box.left, text: el.textContent.trim() };
                        }) };
                });
                assert.ok(bounds.nodes.length >= 3, 'actual empty renderer is present');
                assert.ok(bounds.scroll <= bounds.client + 2, `empty state scrolls horizontally at ${width}: ${JSON.stringify(bounds)}`);
                for (const node of bounds.nodes) assert.ok(node.left >= -1 && node.right <= bounds.client + 2, `clipped empty content at ${width}: ${JSON.stringify(node)}`);
                if (filtered) {
                    await page.getByRole('button', { name: 'Показати всіх клієнтів', exact: true }).last().click();
                    await page.screenshot({ path: path.join(output, `customers-empty-fixed-${width}.png`), fullPage: true });
                }
                results.push({ width, filtered, ...bounds });
            }
            await page.evaluate(() => {
                CrmState.filters.search = '';
                CrmState.customers = [{ id: 1, name: 'Synthetic customer', phone: 'fixture', totalBookings: 1, totalSpent: 0 }];
                renderCustomerTable();
            });
            assert.equal(await page.locator('.customer-list-row').count(), 1);
            if (width >= 820) assert.equal(await page.locator('.customer-list-table thead').isVisible(), true, 'populated table retains its header');
        }
        fs.writeFileSync(path.join(output, 'customers-empty-layout-results.json'), JSON.stringify(results, null, 2));
        console.log('PASS: 6 actual rendered empty states (filtered/unfiltered at1440/820/390), visible action clicks, populated table header preserved. No real API/auth/DB.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
