#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.INVITE_BROWSER_SMOKE_HEADLESS !== 'false';
const INVITE_PATH = '/invite?date=2026-06-25&time=15:00&end=15:30&program=Паперове%20Неон-шоу&room=Поні&card=show-program';

function fail(message) {
    console.error(`Invite browser smoke failed: ${message}`);
    process.exit(1);
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const nodeModulesDir = path.dirname(normalized);
            const packageDir = path.join(nodeModulesDir, 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.js') return 'application/javascript; charset=utf-8';
    if (ext === '.png') return 'image/png';
    if (ext === '.ico') return 'image/x-icon';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.json') return 'application/json; charset=utf-8';
    return 'application/octet-stream';
}

function staticFilePath(requestUrl) {
    const url = new URL(requestUrl, 'http://local');
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (relativePath === 'invite') relativePath = 'invite.html';
    const absolutePath = path.resolve(ROOT, relativePath);
    const rootPrefix = `${ROOT}${path.sep}`;
    if (absolutePath !== ROOT && !absolutePath.startsWith(rootPrefix)) return null;
    return absolutePath;
}

function createStaticServer() {
    const server = http.createServer((req, res) => {
        const filePath = staticFilePath(req.url || '/');
        if (!filePath) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, body) => {
            if (err) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            res.writeHead(200, {
                'Content-Type': contentType(filePath),
                'Cache-Control': 'no-store'
            });
            res.end(body);
        });
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${address.port}`
            });
        });
    });
}

async function waitForImageLoad(locator, label) {
    await locator.evaluate(img => new Promise(resolve => {
        if (img.complete) {
            resolve();
            return;
        }
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
    }));

    const loaded = await locator.evaluate(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
    assert.equal(loaded, true, `${label} image asset loads`);
}

async function visibleText(locator) {
    return String(await locator.textContent() || '').replace(/\s+/g, ' ').trim();
}

async function assertTextIncludes(locator, expected, label) {
    const text = await visibleText(locator);
    assert.ok(text.includes(expected), `${label} includes "${expected}"`);
}

async function assertNoHorizontalOverflow(page) {
    const metrics = await page.evaluate(() => ({
        htmlScrollWidth: document.documentElement.scrollWidth,
        htmlClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth
    }));
    assert.ok(metrics.htmlScrollWidth <= metrics.htmlClientWidth + 1, `html has no horizontal overflow: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.bodyScrollWidth <= metrics.viewportWidth + 1, `body has no horizontal overflow: ${JSON.stringify(metrics)}`);
}

async function assertSkipLinkHiddenByDefault(page) {
    const hidden = await page.locator('.skip-link').evaluate(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width <= 1
            && rect.height <= 1
            && style.overflow === 'hidden'
            && (style.clipPath.includes('inset') || style.clip !== 'auto');
    });
    assert.equal(hidden, true, 'skip-link is visually hidden until focus');
}

async function verifyInvite(page, baseUrl) {
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());

    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`${baseUrl}${INVITE_PATH}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#inviteHeroImage[data-card="show-program"]', { timeout: 5000 });

    const logo = page.locator('.logo-img');
    assert.equal(await logo.count(), 1, 'company logo exists');
    assert.equal(await logo.isVisible(), true, 'company logo is visible');
    assert.ok(String(await logo.getAttribute('src') || '').endsWith('images/brand/event-genix-logo.png'), 'company logo source is stable');
    await waitForImageLoad(logo, 'company logo');

    const hero = page.locator('#inviteHeroImage');
    assert.equal(await hero.isVisible(), true, 'event-card hero is visible');
    assert.ok(String(await hero.getAttribute('src') || '').endsWith('/images/event-cards/event-card-show-program.png'), 'event-card hero uses show-program PNG');
    assert.equal(await hero.evaluate(el => getComputedStyle(el).objectFit), 'cover', 'event-card hero uses object-fit: cover');
    await waitForImageLoad(hero, 'event-card hero');

    await assertTextIncludes(page.locator('#inviteTitle'), 'Паперове Неон-шоу', 'invite title');

    const labelText = await page.locator('.event-detail-label').allTextContents();
    const labels = labelText.map(item => item.trim());
    assert.ok(labels.includes('Дата'), 'date label is visible');
    assert.ok(labels.includes('Час активності') || labels.includes('Час події'), 'time label is visible');
    assert.ok(labels.includes('Активність'), 'activity label is visible');
    assert.ok(labels.includes('Кімната'), 'room label is visible');
    await assertTextIncludes(page.locator('#eventDetails'), '15:00 - 15:30', 'time range');
    await assertTextIncludes(page.locator('#eventDetails'), 'Поні', 'room value');

    await assertTextIncludes(page.locator('#inviteLocationSection'), 'вул. Закревського 61/2, 3 поверх', 'location section');
    const mapHref = await page.locator('#inviteLocationSection .map-link').getAttribute('href');
    assert.equal(mapHref, 'https://maps.google.com/?q=вул.+Закревського+61/2+Київ', 'map link uses the current address');
    assert.equal((await visibleText(page.locator('.invite-card'))).includes('Закревського 31/2'), false, 'old address is absent from visible invite card');

    await assertTextIncludes(page.locator('#inviteVisitSection'), 'Перед візитом', 'visit section');
    await assertTextIncludes(page.locator('#inviteVisitSection'), 'до початку шоу', 'show-program visit tips');

    const bodyText = await visibleText(page.locator('body'));
    assert.equal(bodyText.includes('Що вас чекає'), false, 'generic service grid title is absent');
    assert.equal(await page.locator('.features-list, .feature-item').count(), 0, 'generic service grid markup is absent');

    const shareButtons = page.locator('.share-btn');
    assert.equal(await shareButtons.count(), 2, 'share/copy controls exist');
    assert.equal(await shareButtons.first().isVisible(), true, 'share control is visible');
    assert.equal(await shareButtons.nth(1).isVisible(), true, 'copy control is visible');
    await assertTextIncludes(page.locator('.invite-footer'), 'Поділитися запрошенням', 'share footer');

    await assertSkipLinkHiddenByDefault(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    await assertNoHorizontalOverflow(page);
}

(async () => {
    let playwright;
    try {
        playwright = requirePlaywright();
    } catch {
        fail('Playwright is not available. Run through: npx --yes --package playwright node tests/browser/invite-browser-smoke.js');
    }

    const { server, baseUrl } = await createStaticServer();
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage();

    try {
        await verifyInvite(page, baseUrl);
        console.log(`Invite browser smoke passed: ${baseUrl}${INVITE_PATH}`);
    } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    fail(error?.stack || error?.message || String(error));
});
