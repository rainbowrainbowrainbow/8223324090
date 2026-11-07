#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const sharp = require('sharp');
const { chromium } = require('../helpers/playwright')();
const { buildCatalogImageThumbnailHandler } = require('../../services/catalogImageThumbnails');
const ROOT = path.resolve(__dirname, '../..');
async function run() {
    const tempRoot = path.resolve(os.tmpdir());
    const cacheDir = await fsp.mkdtemp(path.join(tempRoot, 'eg-thumb-browser-'));
    assert.ok(path.resolve(cacheDir).startsWith(tempRoot + path.sep));
    const original = await sharp({ create: { width: 1254, height: 1000, channels: 3, background: '#187fc3' } }).png({ compressionLevel: 0 }).toBuffer();
    const html = fs.readFileSync(path.join(ROOT, 'programs.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const source = fs.readFileSync(path.join(ROOT, 'js/programs-page.js'), 'utf8').replace("document.addEventListener('DOMContentLoaded', initPage);", '');
    let failThumbnails = false, failOriginal = false, originalRequests = 0, thumbnailRequests = 0, apiRequests = 0, codecCreates = 0;
    const handler = buildCatalogImageThumbnailHandler(null, { cacheDir,
        readOriginal: async filename => filename === 'fixture.png' ? { data: original, content_type: 'image/png' } : null,
        onStats: () => { codecCreates++; } });
    const app = express();
    app.get('/programs', (req, res) => res.type('html').send(html));
    app.get('/uploads/catalog-images/cards/:width/:filename', (req, res) => {
        thumbnailRequests++;
        return failThumbnails ? res.status(503).end() : handler(req, res);
    });
    app.get('/uploads/catalog-images/items/fixture.png', (req, res) => {
        originalRequests++;
        return failOriginal ? res.status(404).end() : res.type('png').send(original);
    });
    app.use('/api', (req, res) => { apiRequests++; res.status(503).end(); });
    for (const folder of ['css', 'images', 'assets']) app.use('/' + folder, express.static(path.join(ROOT, folder)));
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    let browser;
    async function open(width, theme) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
        const page = await context.newPage();
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        await page.goto(`http://127.0.0.1:${server.address().port}/programs`);
        await page.evaluate(dark => {
            document.getElementById('mainApp').classList.remove('hidden');
            document.body.classList.add('shell-ready');
            document.body.classList.toggle('dark-mode', dark);
            document.documentElement.dataset.theme = dark ? 'dark' : 'light';
            window.AppState = { currentUser: { id: 999, role: 'creator' } };
            window.getUserRole = () => 'creator';
            window.canAccess = () => true;
            window.resolveCapability = () => ({ allowed: true });
            window.CrmBusinessContext = { normalize: value => value || 'event_genix', current: () => 'event_genix',
                scope: () => ({ mode: 'single', activeContext: 'event_genix' }), isReadOnly: () => false };
            window.formatPrice = value => `${value} ₴`;
            window.showNotification = () => {};
            window.EventCards = { renderEventCardImage: () => '' };
        }, theme === 'dark');
        await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8') });
        await page.addScriptTag({ content: source });
        await page.evaluate(async () => {
            const product = { id: 'synthetic-dish', code: 'SYNTH', timelineCode: 'SYN', businessContext: 'event_genix', domain: 'kitchen',
                kitchenType: 'menu', category: 'menu', name: 'Синтетична страва', menuSection: 'Тест', price: 100,
                description: 'Локальна перевірка фото картки', iconUrl: '/uploads/catalog-images/items/fixture.png', isActive: true };
            allProducts = [product]; activeProductTab = 'kitchen'; activeKitchenTab = 'menu';
            activeMenuSection = 'all'; productsLoadState = 'ready'; await setProductTab('kitchen');
        });
        return { context, page };
    }
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
        for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
            const { context, page } = await open(width, theme);
            try {
                const image = page.locator('#kitchenGrid .kitchen-product-media img').first();
                await image.scrollIntoViewIfNeeded();
                await page.waitForFunction(() => document.querySelector('#kitchenGrid .kitchen-product-media')?.dataset.photoState === 'ready');
                assert.match(await image.evaluate(node => node.currentSrc), /\/cards\/(384|768)\/fixture\.png$/);
                assert.ok(await image.evaluate(node => node.naturalWidth <= 768));
                const beforeOpen = originalRequests;
                await page.locator('#kitchenGrid .kitchen-menu-photo-open').first().click();
                await page.waitForFunction(() => document.querySelector('.kitchen-menu-photo-dialog img')?.naturalWidth === 1254);
                assert.equal(await page.locator('.kitchen-menu-photo-dialog img').getAttribute('src'), '/uploads/catalog-images/items/fixture.png');
                assert.ok(originalRequests > beforeOpen, 'opening the viewer fetches the original');
                await page.locator('.kitchen-menu-photo-dialog button[aria-label^="Закрити"]').click();
                if (process.env.CATALOG_THUMBNAIL_SCREENSHOTS_DIR) {
                    fs.mkdirSync(process.env.CATALOG_THUMBNAIL_SCREENSHOTS_DIR, { recursive: true });
                    await page.locator('#kitchenGrid').screenshot({ path: path.join(process.env.CATALOG_THUMBNAIL_SCREENSHOTS_DIR, `catalog-card-${width}-${theme}.png`) });
                }
            } finally { await context.close(); }
        }
        failThumbnails = true;
        const fallback = await open(390, 'light');
        try {
            const image = fallback.page.locator('#kitchenGrid .kitchen-product-media img').first();
            await image.scrollIntoViewIfNeeded();
            await fallback.page.waitForFunction(() => document.querySelector('#kitchenGrid .kitchen-product-media')?.dataset.photoState === 'ready');
            assert.equal(await image.getAttribute('src'), '/uploads/catalog-images/items/fixture.png');
            assert.equal(await image.getAttribute('srcset'), null);
        } finally { await fallback.context.close(); }
        failOriginal = true;
        const unavailable = await open(390, 'light');
        try {
            await unavailable.page.locator('#kitchenGrid').scrollIntoViewIfNeeded();
            await unavailable.page.waitForFunction(() => document.querySelector('#kitchenGrid .kitchen-product-media')?.dataset.photoState === 'error');
            assert.equal(await unavailable.page.locator('#kitchenGrid .kitchen-product-media img').getAttribute('src'), null);
        } finally { await unavailable.context.close(); }
        assert.equal(apiRequests, 0);
        assert.ok(codecCreates > 0 && codecCreates <= 2, `codec creates must be cached, observed ${codecCreates}`);
        console.log(JSON.stringify({ result: 'PASS', widths: [390, 1440], themes: ['light', 'dark'],
            fallback: true, unavailable: true, originalRequests, thumbnailRequests, codecCreates, apiRequests, paidCalls: 0 }));
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
        await fsp.rm(cacheDir, { recursive: true, force: true });
    }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
