'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '../..');
const origin = 'http://lead-fixture.test';

async function main() {
    const html = fs.readFileSync(path.join(root, 'leads.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        page.setDefaultTimeout(8000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/sales-funnel') return route.fulfill({ contentType: 'text/html', body: html });
            if (/^\/css\/[\w-]+\.css$/.test(url.pathname)) {
                return route.fulfill({ contentType: 'text/css', path: path.join(root, url.pathname.slice(1)) });
            }
            if (/^\/api\/leads\/(71|72)\/workspace$/.test(url.pathname)) {
                const firstLead = url.pathname.includes('/71/');
                return route.fulfill({ json: { success: true, workspace: { lead: {
                    id: firstLead ? 71 : 72, clientName: firstLead ? 'Лід із підміною' : 'Другий лід',
                    assignedName: firstLead ? 'Виконавець підміни' : 'Інший відповідальний',
                    substitution: firstLead ? { id: '901', state: 'active' } : null
                } } } });
            }
            return route.abort();
        });
        await page.goto(origin + '/sales-funnel', { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            window.getAuthHeaders = () => ({});
            window.apiFetchWithAuthRetry = (...args) => fetch(...args);
            window.escapeHtml = input => {
                const node = document.createElement('span');
                node.textContent = input;
                return node.innerHTML;
            };
            document.body.classList.add('shell-ready');
        });
        await page.addScriptTag({ path: path.join(root, 'js/leads-page.js') });
        await page.evaluate(() => openLeadWorkspace(71));
        const overview = page.locator('#leadWorkspacePanel-overview');
        const details = page.locator('#leadWorkspacePanel-details');
        const label = panel => panel.locator('dt').filter({ hasText: /^Підміна$/ });
        const value = panel => label(panel).locator('xpath=following-sibling::dd[1]');

        await label(overview).waitFor({ state: 'visible' });
        assert.equal(await value(overview).innerText(), '№901 · погоджено');
        assert.equal(await overview.locator('dt').filter({ hasText: /^Відповідальний$/ })
            .locator('xpath=following-sibling::dd[1]').innerText(), 'Виконавець підміни');
        await page.locator('#leadWorkspaceTabs [data-workspace-tab="details"]').click();
        await label(details).waitFor({ state: 'visible' });
        assert.equal(await value(details).innerText(), '№901 · погоджено');
        assert.ok(await value(details).evaluate(node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const bounds = range.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
        }), 'The full agreement label fits on mobile');

        const output = path.join(root, 'output/playwright');
        fs.mkdirSync(output, { recursive: true });
        await page.locator('#leadWorkspace').screenshot({
            path: path.join(output, 'lead-substitution-mobile.png'),
            animations: 'disabled'
        });
        await page.evaluate(() => openLeadWorkspace(72));
        assert.equal(await label(overview).count(), 0);
        assert.equal(await label(details).count(), 0);
        assert.deepEqual(errors, []);
        console.log('Lead agreement overview and details mobile smoke passed.');
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
