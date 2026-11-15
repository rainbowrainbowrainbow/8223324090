'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { startFixture } = require('./dashboard-presentation-fixture');

async function main() {
    const server = await startFixture();
    const base = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(18000);
        await page.route('**/*', route => new URL(route.request().url()).origin === base
            ? route.continue() : route.abort());
        await page.request.post(base + '/__qa/control', { data: { substitution: true } });
        await page.clock.install({ time: new Date('2026-09-13T10:00:00Z') });
        await page.goto(base + '/dashboard');

        const card = page.locator('[data-focus-task="501"]');
        const label = card.locator('.dashboard-task-substitution');
        assert.equal(await label.innerText(), 'Підміна №901 · погоджено');
        assert.equal(await page.locator('[data-focus-task="502"] .dashboard-task-substitution').count(), 0);
        await card.scrollIntoViewIfNeeded();
        assert.ok(await label.evaluate(node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const bounds = range.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
        }), 'Full agreement label fits the phone viewport');
        const output = path.join(__dirname, '../../output/playwright');
        fs.mkdirSync(output, { recursive: true });
        await card.screenshot({ path: path.join(output, 'dashboard-substitution-mobile.png'), animations: 'disabled' });

        const details = card.locator('a.focus-task-detail-link');
        const target = new URL(await details.getAttribute('href'), base);
        await page.route(target.href, route => route.fulfill({ contentType: 'text/html', body: '<h1>Тестова задача</h1>' }));
        await Promise.all([page.waitForURL(target.href), details.click()]);
        console.log('Dashboard task substitution mobile smoke passed.');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
