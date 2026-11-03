'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const express = require('express');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

test('browser generates one guarded menu draft and applies only after confirmation', {
    skip: process.env.RUN_MENU_GUARD_BROWSER_POSTGRES !== 'true', timeout: 90000
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true);
    const root = path.resolve(__dirname, '../..');
    const schema = `menu_browser_test_${randomBytes(8).toString('hex')}`;
    const common = { connectionString: target.url.toString(), ssl: false };
    const admin = new Pool(common);
    const db = require('../../db');
    const originalQuery = db.pool.query, originalConnect = db.pool.connect, originalFetch = global.fetch;
    const originalKey = process.env.KIE_API_KEY, originalFlag = process.env.CRM_MENU_PAID_GUARD_ENABLED;
    const originalReviewFlag = process.env.CRM_MENU_RECONCILIATION_ENABLED;
    const storage = require('../../services/imageStorage'), originalUpload = storage.uploadFromUrl;
    let pool, server, browser, created = false;
    try {
        await admin.query(`CREATE SCHEMA ${schema}`); created = true;
        pool = new Pool({ ...common, options: `-c search_path=${schema}`, max: 10 });
        await pool.query(fs.readFileSync(path.join(root, 'db/migrations/387_menu_image_paid_operations.sql'), 'utf8'));
        await pool.query(`CREATE TABLE products (id text PRIMARY KEY, business_context text, domain text, kitchen_type text,
            name text, icon_url text, is_active boolean, ai_card_draft jsonb, updated_at timestamptz, updated_by text)`);
        await pool.query(`INSERT INTO products VALUES ('fixture-menu-full','event_genix','kitchen','menu',
            'Тестова страва','/images/menu-fixture.svg',true,'{}',now(),'fixture')`);
        db.pool.connect = (...args) => pool.connect(...args);
        let injectConcurrentDraft = false;
        db.pool.query = async (sql, params) => {
            if (injectConcurrentDraft && sql.includes('ai_card_draft IS NOT DISTINCT FROM $7::jsonb')) {
                injectConcurrentDraft = false;
                await pool.query("UPDATE products SET ai_card_draft=$1::jsonb WHERE id='fixture-menu-full'",
                    [JSON.stringify({ imageStudio: { status: 'ready', imageUrl: '/images/menu-fixture.svg' }, testMarker: 'concurrent' })]);
            }
            if (sql.includes('WHERE p.id = $1')) return pool.query('SELECT * FROM products WHERE id=$1 AND business_context=$2', params.slice(0, 2));
            return pool.query(sql, params);
        };
        let injectConcurrentManual = false;
        storage.uploadFromUrl = async () => {
            if (injectConcurrentManual) {
                injectConcurrentManual = false;
                await pool.query("UPDATE products SET ai_card_draft=$1::jsonb WHERE id='fixture-menu-full'",
                    [JSON.stringify({ imageStudio: { status: 'ready', imageUrl: '/images/menu-fixture.svg' } })]);
            }
            return '/images/menu-draft.svg';
        };
        process.env.KIE_API_KEY = 'synthetic-test-key';
        process.env.CRM_MENU_PAID_GUARD_ENABLED = 'true';
        process.env.CRM_MENU_RECONCILIATION_ENABLED = 'true';
        let starts = 0, polls = 0, failStart = false;
        global.fetch = async (_url, options) => {
            if (options.method === 'POST') {
                starts++;
                if (failStart) throw new Error('synthetic timeout');
                return new Response(JSON.stringify({ code: 200, data: { taskId: 'browser-fixture-task' } }));
            }
            polls++; return new Response(JSON.stringify({ code: 200, data: { state: 'success',
                resultJson: JSON.stringify({ resultUrls: ['https://tempfileb.aiquickdraw.com/fixture.png'] }) } }));
        };
        const router = require('../../routes/products');
        const source = fs.readFileSync(path.join(root, 'tests/browser/products-demo.spec.js'), 'utf8');
        const fixtureSource = source.slice(source.indexOf("const fs ="), source.indexOf('let server, baseUrl;'));
        const fixture = new Function('require', '__dirname', `${fixtureSource}\nreturn { fixtureHtml, bootstrap };`)(require, path.join(root, 'tests/browser'));
        const app = express(); app.set('trust proxy', true); app.use(express.json());
        app.use((req, _res, next) => { const role = req.get('x-fixture-role') || 'creator';
            req.user = { id: 1, username: 'fixture', role, platformRole: role, defaultBusinessContext: 'event_genix' }; next(); });
        for (const [method, route] of [['post', '/:id/menu-image/draft'], ['post', '/:id/menu-image/external-draft'], ['get', '/:id/menu-image/status'],
            ['get', '/:id/menu-image/operation'], ['post', '/:id/menu-image/operation/reconcile'],
            ['post', '/:id/menu-image/apply'], ['post', '/:id/menu-image/reject']]) {
            const layer = router.stack.find(x => x.route?.path === route && x.route.methods[method]).route;
            app[method](`/api/products${route}`, ...layer.stack.map(x => x.handle));
        }
        app.get('/fixture/products', async (_req, res) => {
            const row = (await pool.query("SELECT * FROM products WHERE id='fixture-menu-full'")).rows[0];
            res.json([{ id: row.id, businessContext: row.business_context, domain: row.domain,
                kitchenType: row.kitchen_type, category: 'menu', name: row.name, iconUrl: row.icon_url, aiCardDraft: row.ai_card_draft }]);
        });
        app.get('/programs', (_req, res) => res.type('html').send(fixture.fixtureHtml('programs')
            .replace('<script src="/js/programs-page.js"></script>', '<script src="/fixture-real-api.js"></script><script src="/js/programs-page.js"></script>')));
        app.get('/fixture-bootstrap.js', (_req, res) => res.type('js').send(fixture.bootstrap()));
        app.get('/fixture-real-api.js', (_req, res) => res.type('js').send(`
            window.apiGetProducts=async()=>await (await fetch('/fixture/products')).json();
            window.apiGenerateProductMenuImage=async(id,payload)=>await (await fetch('/api/products/'+id+'/menu-image/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
            // Separate synthetic IP prevents this extra manual-race scenario from
            // consuming the four-request shared review budget of the later flow.
            window.apiCreateProductMenuExternalDraft=async(id,payload)=>await (await fetch('/api/products/'+id+'/menu-image/external-draft',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'127.0.0.2'},body:JSON.stringify(payload)})).json();
            window.apiGetProductMenuImageStatus=async(id,options)=>await (await fetch('/api/products/'+id+'/menu-image/status?businessContext='+encodeURIComponent(options.businessContext))).json();
            window.apiApplyProductMenuImage=async(id,payload)=>await (await fetch('/api/products/'+id+'/menu-image/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
            window.apiRejectProductMenuImage=async(id,payload)=>await (await fetch('/api/products/'+id+'/menu-image/reject',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
            window.apiGetProductMenuImageOperation=async(id,options)=>await (await fetch('/api/products/'+id+'/menu-image/operation?businessContext='+encodeURIComponent(options.businessContext))).json();
            window.apiReconcileProductMenuImageOperation=async(id,payload)=>await (await fetch('/api/products/'+id+'/menu-image/operation/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
        `));
        for (const [name, color] of [['menu-fixture.svg', '#4c8a65'], ['menu-draft.svg', '#c57c36']]) {
            app.get(`/images/${name}`, (_req, res) => res.type('svg').send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/><circle cx="200" cy="150" r="100" fill="white"/></svg>`));
        }
        app.use('/js', express.static(path.join(root, 'js'))); app.use('/css', express.static(path.join(root, 'css')));
        app.use('/images', express.static(path.join(root, 'images')));
        server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
        browser = await chromium.launch({ headless: true, executablePath: process.env.CRM_AUTOMATION_CHROME_PATH });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/programs?editor=1#kitchen-menu`);
        const card = page.locator('[data-id="fixture-menu-full"]'); await card.waitFor({ state: 'visible' });
        await card.locator('[data-menu-image-open]').click();
        const dialog = card.locator('.kitchen-menu-image-dialog'); await dialog.waitFor({ state: 'visible' });
        await dialog.locator('[data-menu-image-action="generate"]').evaluate(button => { button.click(); button.click(); });
        await page.waitForFunction(() => document.querySelector('[data-menu-image-action="apply"]')?.disabled === false, null, { timeout: 20000 });
        assert.equal(starts, 1); assert.equal(polls, 1);
        await page.waitForFunction(() => [...document.querySelectorAll('.kitchen-menu-image-frame img')]
            .length === 2 && [...document.querySelectorAll('.kitchen-menu-image-frame img')].every(image => image.complete && image.naturalWidth > 0));
        let row = (await pool.query("SELECT icon_url, ai_card_draft FROM products WHERE id='fixture-menu-full'")).rows[0];
        assert.equal(row.icon_url, '/images/menu-fixture.svg'); assert.equal(row.ai_card_draft.imageStudio.status, 'ready');
        const evidence = process.env.MENU_GUARD_BROWSER_OUTPUT;
        if (!evidence || !path.isAbsolute(evidence)) throw Error('Absolute evidence output required');
        fs.mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: path.join(evidence, 'review-before-apply.png'), fullPage: true });
        await page.locator('[data-menu-image-action="apply"]').click();
        const deadline = Date.now() + 10000;
        do {
            row = (await pool.query("SELECT icon_url, ai_card_draft FROM products WHERE id='fixture-menu-full'")).rows[0];
            if (row.ai_card_draft.imageStudio.status === 'applied') break;
            await new Promise(resolve => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        assert.equal(row.icon_url, '/images/menu-draft.svg'); assert.equal(row.ai_card_draft.imageStudio.status, 'applied');
        await page.setViewportSize({ width: 390, height: 844 });
        const mobileGenerate = page.locator('[data-menu-image-action="generate"]');
        await mobileGenerate.waitFor({ state: 'visible' });
        await mobileGenerate.click();
        await page.waitForFunction(() => document.querySelector('[data-menu-image-action="reject"]')?.disabled === false, null, { timeout: 20000 });
        assert.equal(starts, 2); assert.equal(polls, 2);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
        await page.screenshot({ path: path.join(evidence, 'mobile-before-reject.png'), fullPage: true });
        await page.locator('[data-menu-image-action="reject"]').click();
        const rejectDeadline = Date.now() + 10000;
        do {
            row = (await pool.query("SELECT icon_url, ai_card_draft FROM products WHERE id='fixture-menu-full'")).rows[0];
            if (row.ai_card_draft.imageStudio.status === 'rejected') break;
            await new Promise(resolve => setTimeout(resolve, 50));
        } while (Date.now() < rejectDeadline);
        assert.equal(row.ai_card_draft.imageStudio.status, 'rejected');
        assert.equal(row.icon_url, '/images/menu-draft.svg');
        injectConcurrentManual = true;
        await page.locator('[data-menu-image-url]').fill('https://example.com/manual.png');
        await page.locator('[data-menu-image-url]').blur();
        await page.waitForFunction(() => document.querySelector('[data-menu-image-manual-status]')?.textContent.includes('Чернетка змінилася'));
        assert.equal(await page.locator('[data-menu-image-manual-status]').isVisible(), true);
        assert.equal(await page.locator('[data-menu-image-manual-status]').evaluate(el => {
            const box = el.getBoundingClientRect(), dialogBox = el.closest('dialog').getBoundingClientRect();
            return box.top >= dialogBox.top && box.bottom <= dialogBox.bottom && box.bottom <= innerHeight;
        }), true);
        assert.equal(await page.locator('[data-menu-image-url]').inputValue(), '');
        assert.equal(await page.locator('[data-menu-image-action="external-draft"]').isHidden(), true);
        assert.equal(starts, 2);
        await page.screenshot({ path: path.join(evidence, 'mobile-manual-conflict.png'), fullPage: true });
        injectConcurrentDraft = true;
        await page.locator('[data-menu-image-action="generate"]').click();
        await page.waitForFunction(() => document.querySelector('[data-menu-image-generation-status]')?.textContent.includes('Генерацію не запущено'));
        assert.equal(starts, 2, 'stale draft must not trigger a provider request');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
        await page.screenshot({ path: path.join(evidence, 'mobile-draft-conflict.png'), fullPage: true });
        failStart = true;
        await page.locator('[data-menu-image-action="generate"]').click();
        await page.waitForFunction(() => document.querySelector('[data-menu-image-generation-status]')?.textContent.includes('Не запускайте її повторно'), null, { timeout: 10000 });
        assert.equal(await page.locator('[data-menu-image-action="generate"]').isDisabled(), true);
        assert.equal(await page.locator('[data-menu-image-action="inspect-paid-operation"]').isEnabled(), true);
        await page.locator('[data-menu-image-action="inspect-paid-operation"]').click();
        await page.waitForFunction(() => document.querySelector('[data-menu-image-operation-status]')?.textContent.includes('незавершена генерація'));
        assert.equal(starts, 3);
        row = (await pool.query("SELECT icon_url, ai_card_draft FROM products WHERE id='fixture-menu-full'")).rows[0];
        assert.equal(row.ai_card_draft.imageStudio.outcomeUncertain, true);
        assert.equal(row.icon_url, '/images/menu-draft.svg');
        await page.screenshot({ path: path.join(evidence, 'mobile-uncertain.png'), fullPage: true });
        const operationId = row.ai_card_draft.imageStudio.operationId;
        await pool.query("UPDATE menu_image_paid_operations SET created_at=now()-interval '11 minutes' WHERE operation_id=$1", [operationId]);
        const denied = await page.evaluate(async operationId => (await fetch('/api/products/fixture-menu-full/menu-image/operation/reconcile', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-fixture-role': 'manager' },
            body: JSON.stringify({ businessContext: 'event_genix', operationId, reviewNote: 'Checked provider account and reviewed the uncertain charge',
                providerReviewed: true, acceptsPossibleCharge: true }) })).status, operationId);
        assert.equal(denied, 403);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM menu_image_paid_operation_reviews')).rows[0].count, 0);
        const reviewButton = page.locator('[data-menu-image-action="review-paid-operation"]');
        await reviewButton.click();
        await page.locator('.prompt-input').fill('Checked provider account and reviewed the uncertain charge');
        await page.locator('.confirm-overlay:has(.prompt-input) .confirm-cancel').click();
        await page.locator('.prompt-input').waitFor({ state: 'detached' });
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM menu_image_paid_operation_reviews')).rows[0].count, 0);
        await reviewButton.click();
        await page.locator('.prompt-input').fill('Checked provider account and reviewed the uncertain charge');
        await page.locator('.confirm-overlay:has(.prompt-input) .confirm-ok').click();
        await page.locator('.confirm-overlay[data-confirm-kind="confirm"] .confirm-cancel').click();
        await page.locator('.confirm-overlay[data-confirm-kind="confirm"]').waitFor({ state: 'detached' });
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM menu_image_paid_operation_reviews')).rows[0].count, 0);
        await reviewButton.click();
        await page.locator('.prompt-input').fill('Checked provider account and reviewed the uncertain charge');
        await page.screenshot({ path: path.join(evidence, 'mobile-review-note.png'), fullPage: true });
        await page.locator('.confirm-overlay:has(.prompt-input) .confirm-ok').click();
        await page.locator('.confirm-overlay[data-confirm-kind="confirm"] .confirm-ok').waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(evidence, 'mobile-review-confirm.png'), fullPage: true });
        await page.locator('.confirm-overlay[data-confirm-kind="confirm"] .confirm-ok').click();
        try {
            await page.waitForFunction(() => document.querySelector('[data-menu-image-action="generate"]')?.disabled === false, null, { timeout: 10000 });
        } catch (error) {
            await page.screenshot({ path: path.join(evidence, 'mobile-review-debug.png'), fullPage: true });
            const debug = await page.locator('[data-menu-image-action="generate"]').evaluate(button => ({
                disabled: button.disabled, savedDisabled: button.dataset.menuImageWasDisabled,
                busy: button.closest('.kitchen-menu-image-studio')?.getAttribute('aria-busy'),
                status: document.querySelector('[data-menu-image-generation-status]')?.textContent
            }));
            throw new Error(`${error.message}; synthetic UI state: ${JSON.stringify(debug)}`);
        }
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM menu_image_paid_operation_reviews')).rows[0].count, 1);
        assert.equal((await pool.query('SELECT status FROM menu_image_paid_operations WHERE operation_id=$1', [operationId])).rows[0].status, 'reviewed_unknown');
        assert.equal(starts, 3, 'manual reconciliation must not call provider');
        assert.deepEqual(errors, []);
    } finally {
        if (browser) await browser.close();
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        db.pool.query = originalQuery; db.pool.connect = originalConnect; global.fetch = originalFetch; storage.uploadFromUrl = originalUpload;
        if (originalKey === undefined) delete process.env.KIE_API_KEY; else process.env.KIE_API_KEY = originalKey;
        if (originalFlag === undefined) delete process.env.CRM_MENU_PAID_GUARD_ENABLED; else process.env.CRM_MENU_PAID_GUARD_ENABLED = originalFlag;
        if (originalReviewFlag === undefined) delete process.env.CRM_MENU_RECONCILIATION_ENABLED; else process.env.CRM_MENU_RECONCILIATION_ENABLED = originalReviewFlag;
        if (pool) await pool.end(); if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); await db.pool.end();
    }
});
