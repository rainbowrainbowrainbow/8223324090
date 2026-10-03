'use strict';
// Actual product markup/styles/category renderer, isolated from auth/API/provider jobs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/finance-qa-local');
const html = fs.readFileSync(path.join(root, 'programs.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = fs.readFileSync(path.join(root, 'js/programs-page.js'), 'utf8');
const start = source.indexOf('function renderCategoryTabs()');
const end = source.indexOf('\n// ', start);
assert.ok(start >= 0 && end > start);

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://fixture');
        assert.equal(req.method, 'GET');
        assert.ok(!url.pathname.startsWith('/api/'));
        if (url.pathname === '/programs') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html); }
        const file = path.resolve(root, `.${url.pathname}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream' });
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.QA_CHROMIUM_EXECUTABLE } : {}) });
        const page = await browser.newPage();
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}/programs`);
        await page.evaluate(() => {
            document.getElementById('mainApp').classList.remove('hidden');
            document.body.classList.add('shell-ready', 'dark-mode');
            document.documentElement.dataset.theme = 'dark';
        });
        await page.addScriptTag({ content: `let currentCategory='all'; window.fixtureRenders=0; function renderProducts(){window.fixtureRenders++;} function syncProductsRouteState(){history.replaceState(null,'',currentCategory==='all'?'/programs':'/programs#'+currentCategory);} ${source.slice(start, end)} renderCategoryTabs();` });
        const results = [];
        for (const width of [1440, 820, 390]) {
            await page.setViewportSize({ width, height: 1180 });
            const sizes = await page.locator('#categoryTabs .category-tab').evaluateAll(nodes => nodes.map(node => ({ label: node.textContent, height: node.getBoundingClientRect().height, font: getComputedStyle(node).fontFamily })));
            assert.equal(sizes.length, 8);
            for (const button of sizes) assert.ok(button.height >= 44, `small category hit target at${width}: ${JSON.stringify(button)}`);
            await page.locator('#categoryTabs [data-cat=animation]').click();
            assert.equal(await page.locator('#categoryTabs [data-cat=animation]').evaluate(el => el.classList.contains('active')), true);
            assert.ok(page.url().endsWith('#animation'));
            const bounds = await page.locator('#categoryTabs').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
            assert.ok(bounds.scroll <= bounds.client + 2, `category tabs overflow at${width}`);
            await page.screenshot({ path: path.join(output, `products-category-fixed-${width}.png`), fullPage: true });
            await page.locator('#categoryTabs [data-cat=all]').click();
            assert.equal(await page.locator('#categoryTabs .active').textContent(), 'Всі');
            results.push({ width, sizes, bounds });
        }
        fs.writeFileSync(path.join(output, 'products-category-layout-results.json'), JSON.stringify(results, null, 2));
        console.log('PASS: 8actual category buttons at1440/820/390 have44px hit targets, wrap without overflow and click/select/reset correctly; no real API/auth/providers.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
