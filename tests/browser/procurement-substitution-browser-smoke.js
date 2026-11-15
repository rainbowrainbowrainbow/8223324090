'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '../..');
const origin = 'http://warehouse-fixture.test';
const detailMarker = '[data-procurement-substitution]';

async function main() {
    const html = fs.readFileSync(path.join(root, 'warehouse.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(8000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/warehouse') return route.fulfill({ contentType: 'text/html', body: html });
            if (/^\/css\/[\w-]+\.css$/.test(url.pathname)) {
                return route.fulfill({ contentType: 'text/css', path: path.join(root, url.pathname.slice(1)) });
            }
            return route.abort();
        });
        await page.goto(origin + '/warehouse', { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            const first = {
                id: 71,
                title: 'Закупівля з підміною',
                status: 'in_progress',
                statusLabel: 'В роботі',
                departmentLabel: 'Кухня',
                substitution: { id: '901', state: 'active' }
            };
            const second = { ...first, id: 72, title: 'Інша закупівля', substitution: null };
            window.escapeHtml = input => {
                const node = document.createElement('span');
                node.textContent = input;
                return node.innerHTML;
            };
            window.getLegacyBusinessSurfaceAvailability = () => ({ available: true });
            window.getLegacyBusinessSurfaceContextKey = () => 'event_genix';
            window.canAccess = () => false;
            window.apiGetProcurementLists = async () => ({ lists: [first, second] });
            window.apiGetProcurementList = async id => {
                if (id === first.id && window.holdFirstProcurement) {
                    await new Promise(resolve => { window.releaseProcurement = resolve; });
                    window.releasedProcurement = true;
                }
                if (id === first.id && window.completedProcurement) {
                    return { ...first, substitution: { ...first.substitution, state: 'completed' } };
                }
                return id === first.id ? first : second;
            };
            document.body.classList.add('shell-ready');
            document.getElementById('mainApp').classList.remove('hidden');
            document.getElementById('stockTab').style.display = 'none';
            document.getElementById('procurementTab').style.display = '';
        });
        await page.addScriptTag({ path: path.join(root, 'js/warehouse-page.js') });
        await page.evaluate(() => loadProcLists());

        const first = page.locator('.proc-card').filter({ hasText: 'Закупівля з підміною' });
        const second = page.locator('.proc-card').filter({ hasText: 'Інша закупівля' });
        const modal = page.locator('#procDetailModal');
        const label = modal.locator(detailMarker);
        assert.equal(await first.locator(detailMarker).innerText(), 'Підміна №901 · погоджено');
        assert.equal(await second.locator(detailMarker).count(), 0);

        await first.click();
        await label.waitFor({ state: 'visible' });
        assert.equal(await label.innerText(), 'Підміна №901 · погоджено');
        assert.ok(await label.evaluate(node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const bounds = range.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
        }), 'Full agreement label fits the phone viewport');
        const output = path.join(root, 'output/playwright');
        fs.mkdirSync(output, { recursive: true });
        await modal.locator('.wh-modal').screenshot({
            path: path.join(output, 'procurement-substitution-mobile.png'),
            animations: 'disabled'
        });

        await modal.getByRole('button', { name: 'Закрити', exact: true }).click();
        await modal.waitFor({ state: 'hidden' });
        await page.evaluate(() => { window.holdFirstProcurement = true; });
        await first.click();
        await page.waitForFunction(() => typeof window.releaseProcurement === 'function');
        await second.click();
        await modal.getByRole('heading', { name: 'Інша закупівля' }).waitFor();
        await page.evaluate(() => window.releaseProcurement());
        await page.waitForFunction(() => window.releasedProcurement === true);
        assert.equal(await modal.locator('h3').innerText(), 'Інша закупівля');
        assert.equal(await label.count(), 0);

        await modal.getByRole('button', { name: 'Закрити', exact: true }).click();
        await page.evaluate(() => {
            window.holdFirstProcurement = false;
            window.completedProcurement = true;
        });
        await first.click();
        await label.waitFor({ state: 'visible' });
        assert.equal(await label.innerText(), 'Підміна №901 · завершено');
        assert.deepEqual(errors, []);
        console.log('Procurement agreement mobile and stale-response smoke passed.');
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
