'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const QRCode = require('qrcode');

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        const entry = String(process.env.PATH || '').split(path.delimiter)
            .find(item => /node_modules[\\/]\.bin[\\/]?$/i.test(item));
        if (entry) return require(path.join(path.dirname(entry), 'playwright'));
        throw error;
    }
}

const { chromium } = requirePlaywright();
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'output/playwright/certificate-check');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const api = read('js/api.js');
const certificateApi = api.slice(api.indexOf('function certificateApiFailure('), api.indexOf('// v11.0: Kleshnya API'));
const html = read('certificates.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace('</body>', `<script src="/js/ui.js"></script><script src="/fixture-bootstrap.js"></script>
        <script src="/js/certificate-preview.js"></script><script src="/js/certificate-image-export.js"></script>
        <script src="/js/certificates-page.js"></script></body>`);
const prelude = `
const API_BASE = '/api';
window.apiVerifyToken = async () => ({id: 1, username: 'synthetic-reception', role: 'reception'});
window.clearAuthStorage = () => {};
window.hydrateBusinessOperatingProfile = async () => {};
window.hydrateActionPermissions = async () => ({});
window.canAccessPage = () => true;
window.getLegacyBusinessSurfaceAvailability = () => ({available: true});
window.getLegacyBusinessSurfaceContextKey = () => 'event_genix';
window.noteLegacyBusinessSurfaceUnavailable = () => {};
window.getAuthHeaders = () => ({'Content-Type':'application/json'});
window.apiFetchWithAuthRetry = (url, options) => fetch(url, options);
window.apiErrorFromResponse = async response => Object.assign(new Error((await response.json()).error), {status:response.status});
window.showAuthenticatedPageShell = () => document.getElementById('mainApp').classList.remove('hidden');
window.Sidebar = { markShellReady: () => document.body.classList.add('shell-ready') };
window.showNotification = () => {};
window.initDarkMode = () => {};
`;

async function assertFits(page, selector, label) {
    const bounds = await page.locator(selector).evaluate(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth };
    });
    assert.ok(bounds.width > 0 && bounds.left >= -1 && bounds.right <= bounds.viewport + 1,
        `${label}: ${selector} fits viewport (${JSON.stringify(bounds)})`);
}

async function main() {
    const app = express();
    app.use(express.json());
    const issued = [{ id: 1, certCode: 'SYNTHETIC-LAYOUT-1', status: 'active', typeText: 'на одноразовий вхід',
        displayMode: 'fio', displayValue: 'Тестовий отримувач', validUntil: '2026-11-09',
        issuedAt: '2026-09-27T10:00:00Z', issueSource: 'single' }];
    app.get(/^\/certificates(?:\/(?:check|new|batch))?$/, (_req, res) => res.type('html').send(html));
    app.get('/fixture-bootstrap.js', (_req, res) => res.type('js').send(prelude + certificateApi));
    app.get('/api/certificates/qr/:code', async (req, res) => res.json({
        dataUrl: await QRCode.toDataURL(`https://example.test/certificates/check?code=${encodeURIComponent(req.params.code)}`)
    }));
    app.get('/api/certificates', (_req, res) => res.json({ items: issued, total: issued.length }));
    app.get('/api/certificates/:id', (req, res) => {
        const cert = issued.find(item => String(item.id) === req.params.id);
        if (!cert) return res.sendStatus(404);
        res.json(cert);
    });
    app.post('/api/certificates', (req, res) => {
        const cert = { ...req.body, id: issued.length + 1, certCode: `SYNTHETIC-LAYOUT-${issued.length + 1}`,
            status: 'active', issuedAt: '2026-09-27T10:00:00Z', issueSource: 'single' };
        issued.push(cert);
        res.status(201).json(cert);
    });
    app.post('/api/certificates/batch', (req, res) => res.json({ success: true,
        certificates: Array.from({ length: Number(req.body.quantity) }, (_, index) => ({
            certCode: `SYNTHETIC-BATCH-${index + 1}`, typeText: 'на одноразовий вхід'
        }))
    }));
    for (const dir of ['css', 'js', 'images']) app.use('/' + dir, express.static(path.join(ROOT, dir)));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    try {
        for (const viewport of [
            { width: 360, height: 780 }, { width: 390, height: 844 },
            { width: 412, height: 915 }, { width: 812, height: 375 },
            { width: 1280, height: 900 }
        ]) {
            const context = await browser.newContext({ viewport, isMobile: viewport.width <= 412,
                hasTouch: viewport.width <= 412, reducedMotion: 'reduce' });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
            for (const dark of [false, true]) {
                for (const [route, mode, view, action] of [
                    ['/certificates', 'list', '#certificatesListView', '#certPageRefreshBtn'],
                    ['/certificates/new', 'new', '#certificatesNewView', '#certPageSubmitBtn'],
                    ['/certificates/batch', 'batch', '#certificatesBatchView', '#certBatchPageSubmitBtn'],
                    ['/certificates/check', 'check', '#certificatesCheckView', '#certificateCheckSubmit']
                ]) {
                    await page.goto(base + route);
                    await page.locator(`${view}:not(.hidden)`).waitFor();
                    await page.evaluate(isDark => {
                        document.body.classList.toggle('dark-mode', isDark);
                        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
                    }, dark);
                    assert.equal(await page.locator(`.cert-page-actions [data-cert-mode="${mode}"]`).getAttribute('aria-current'), 'page');
                    await assertFits(page, action, `${viewport.width}x${viewport.height} ${mode} ${dark ? 'dark' : 'light'}`);
                    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
                        `${viewport.width}x${viewport.height} ${mode}: no document horizontal overflow`);
                    if (viewport.width === 390 && dark) {
                        fs.mkdirSync(OUTPUT, { recursive: true });
                        await page.screenshot({ path: path.join(OUTPUT, `layout-${mode}-390-dark.png`) });
                    }
                    if (mode === 'list') {
                        const opener = page.locator('#certPageList [data-cert-open]').first();
                        await opener.waitFor();
                        await opener.click();
                        const modal = page.locator('#certificatePageDetailModal:not(.hidden)');
                        await modal.waitFor();
                        await modal.locator('#certificatePagePreview canvas').waitFor();
                        await assertFits(page, '#certificatePageDetailModal .cert-detail-modal-content', 'detail');
                        if (viewport.width === 390 && dark) {
                            await page.screenshot({ path: path.join(OUTPUT, 'layout-detail-390-dark.png') });
                        }
                        const geometry = await modal.evaluate(node => {
                            const content = node.querySelector('.cert-detail-modal-content');
                            const preview = node.querySelector('#certificatePagePreview canvas');
                            const label = node.querySelector('.cert-detail-row .cert-detail-label');
                            const value = node.querySelector('.cert-detail-row .cert-detail-val');
                            const c = content.getBoundingClientRect();
                            const p = preview.getBoundingClientRect();
                            const l = label.getBoundingClientRect();
                            const v = value.getBoundingClientRect();
                            return { width: c.width, previewRight: p.right, contentRight: c.right,
                                maxHeight: c.height, viewportHeight: innerHeight,
                                detailGap: v.left - l.right,
                                columns: getComputedStyle(node.querySelector('.cert-detail-shell')).gridTemplateColumns.split(' ').length };
                        });
                        assert.ok(geometry.previewRight <= geometry.contentRight + 1, `preview not clipped: ${JSON.stringify(geometry)}`);
                        assert.ok(geometry.detailGap >= 6, `detail labels remain distinct from values: ${JSON.stringify(geometry)}`);
                        assert.ok(geometry.maxHeight <= geometry.viewportHeight + 1, `detail scrolls inside viewport: ${JSON.stringify(geometry)}`);
                        if (viewport.width >= 1000) assert.ok(geometry.width >= 676 && geometry.columns === 2,
                            `desktop detail has two complete columns: ${JSON.stringify(geometry)}`);
                        await modal.getByRole('button', { name: 'Закрити' }).focus();
                        await page.keyboard.press('Shift+Tab');
                        assert.equal(await modal.locator('#certificatePageDetailActions button:last-child')
                            .evaluate(node => document.activeElement === node), true, 'Shift+Tab stays in detail');
                        await page.keyboard.press('Escape');
                        await modal.waitFor({ state: 'hidden' });
                        assert.equal(await opener.evaluate(node => document.activeElement === node), true,
                            'closing detail restores focus');
                    }
                }
            }
            await page.goto(`${base}/certificates/new`);
            await page.locator('#certPageDisplayValue').fill('Тестовий отримувач');
            await page.locator('#certPageSubmitBtn').click();
            await page.locator('#certCreateResult h3').filter({ hasText: 'SYNTHETIC-LAYOUT-' }).waitFor();
            await page.waitForFunction(() => document.activeElement === document.querySelector('#certCreateResult h3'));
            await assertFits(page, '#certCreateResult [data-cert-download]', 'issued image action');
            if (viewport.width === 390) {
                await page.evaluate(() => document.body.classList.add('dark-mode'));
                await page.screenshot({ path: path.join(OUTPUT, 'layout-issued-390-dark.png') });
            }
            await page.locator('#certCreateResult [data-cert-download]').click();
            const imageDialog = page.locator('.cert-image-export-dialog');
            await imageDialog.locator('img:not([hidden])').waitFor();
            await imageDialog.getByRole('button', { name: 'Повернутися до сертифіката' }).click();
            await imageDialog.waitFor({ state: 'detached' });
            await page.goto(`${base}/certificates/batch`);
            await page.locator('#certBatchPageSubmitBtn').click();
            await page.locator('#certBatchResultTitle').waitFor();
            await page.waitForFunction(() => document.activeElement === document.querySelector('#certBatchResultTitle'));
            await assertFits(page, '#certBatchCopyBtn', 'batch copy action');
            assert.deepEqual(errors, [], `${viewport.width}x${viewport.height}: no browser errors`);
            await context.close();
        }
        assert.ok(!/maximum-scale|user-scalable=no/i.test(html), 'certificate page allows browser zoom');
        assert.ok(!/iPhone-safe|важкий canvas|той самий API|panel-flow|Standalone сторінка/i.test(html + read('js/certificates-page.js')),
            'certificate UI has no implementation explanations');
        console.log('Certificate layout browser smoke passed: four routes, light/dark, 360/390/412/landscape/desktop, detail focus, issue result and batch result.');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
