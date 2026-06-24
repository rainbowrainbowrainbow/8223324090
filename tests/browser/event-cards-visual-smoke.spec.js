#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function requirePlaywrightTest() {
    try {
        return require('@playwright/test');
    } catch (err) {
        const cliPath = process.argv.find(arg => /@playwright[\\/]test[\\/]cli\.js$/i.test(arg));
        if (cliPath) return require(path.dirname(cliPath));

        const candidates = [process.argv[1], require.main?.filename, module.parent?.filename].filter(Boolean);
        for (const candidate of candidates) {
            const normalized = String(candidate);
            const marker = `${path.sep}node_modules${path.sep}playwright${path.sep}`;
            const index = normalized.toLowerCase().indexOf(marker.toLowerCase());
            if (index === -1) continue;
            const nodeModulesDir = normalized.slice(0, index + `${path.sep}node_modules`.length);
            const packageDir = path.join(nodeModulesDir, '@playwright', 'test');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }

        throw err;
    }
}

const { test, expect } = requirePlaywrightTest();

const ROOT = path.join(__dirname, '..', '..');

const SURFACES = [
    {
        name: 'programs',
        page: '/programs.html',
        consumer: 'js/programs-page.js',
        event: { title: 'Birthday party' },
        expectedFile: 'event-card-holiday-party.png'
    },
    {
        name: 'leads',
        page: '/leads.html',
        consumer: 'js/leads-page.js',
        event: { title: 'Treasure quest' },
        expectedFile: 'event-card-quest.png'
    },
    {
        name: 'afisha',
        page: '/afisha.html',
        consumer: 'js/afisha-page.js',
        event: { title: 'Workshop craft event' },
        expectedFile: 'event-card-workshop.png'
    },
    {
        name: 'timeline booking details',
        page: '/index.html',
        consumer: 'js/booking.js',
        event: { title: 'Private VIP party' },
        expectedFile: 'event-card-private-party.png'
    }
];

function contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') return 'text/html; charset=utf-8';
    if (ext === '.css') return 'text/css; charset=utf-8';
    if (ext === '.js') return 'application/javascript; charset=utf-8';
    if (ext === '.png') return 'image/png';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.json') return 'application/json; charset=utf-8';
    return 'application/octet-stream';
}

function staticFilePath(requestUrl) {
    const url = new URL(requestUrl, 'http://local');
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
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

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function getHtmlScripts(html) {
    return [...html.matchAll(/<script\s+src=["']([^"']+)["']/g)]
        .map(match => match[1].split('?')[0]);
}

function scriptIndex(scripts, expected) {
    return scripts.findIndex(src => src === expected || src.endsWith(`/${expected}`));
}

function assertScriptBefore(pageFile, dependency, consumer) {
    const scripts = getHtmlScripts(readProjectFile(pageFile.replace(/^\/+/, '')));
    const dependencyIndex = scriptIndex(scripts, dependency);
    const consumerIndex = scriptIndex(scripts, consumer);
    assert.ok(dependencyIndex >= 0, `${pageFile} loads ${dependency}`);
    assert.ok(consumerIndex >= 0, `${pageFile} loads ${consumer}`);
    assert.ok(dependencyIndex < consumerIndex, `${pageFile} loads ${dependency} before ${consumer}`);
}

async function routeApiAsEmptyJson(page) {
    await page.route('**/api/**', route => route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: '{}'
    }));
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
    assert.equal(loaded, true, `${label} event-card image asset loads`);
}

async function verifySurface(page, baseUrl, surface) {
    assertScriptBefore(surface.page, 'js/event-cards.js', surface.consumer);

    await page.setViewportSize({ width: 1366, height: 768 });
    await routeApiAsEmptyJson(page);
    await page.goto(`${baseUrl}${surface.page}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => window.EventCards?.renderEventCardImage, null, { timeout: 5000 });
    await page.evaluate(event => {
        const host = document.createElement('section');
        host.id = 'event-card-browser-smoke';
        host.innerHTML = window.EventCards.renderEventCardImage(event, { className: 'event-card-browser-smoke-card' });
        document.body.appendChild(host);
    }, surface.event);

    const visual = page.locator('#event-card-browser-smoke .event-card-visual');
    const image = visual.locator('img');
    await expect(image, `${surface.name} renders one event-card image`).toHaveCount(1);

    const src = await image.getAttribute('src');
    assert.ok(src?.startsWith('/images/event-cards/'), `${surface.name} image uses /images/event-cards/`);
    assert.ok(src.endsWith(surface.expectedFile), `${surface.name} renders ${surface.expectedFile}`);

    const objectFit = await image.evaluate(el => getComputedStyle(el).objectFit);
    assert.equal(objectFit, 'cover', `${surface.name} image uses object-fit: cover`);

    const aspectRatio = await visual.evaluate(el => getComputedStyle(el).aspectRatio);
    assert.ok(aspectRatio === '16 / 9' || aspectRatio === '16/9', `${surface.name} visual uses 16 / 9 aspect-ratio`);

    await waitForImageLoad(image, surface.name);
}

let staticServer;
let staticBaseUrl;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    const started = await createStaticServer();
    staticServer = started.server;
    staticBaseUrl = started.baseUrl;
});

test.afterAll(async () => {
    if (staticServer) await new Promise(resolve => staticServer.close(resolve));
});

for (const surface of SURFACES) {
    test(`event card image renders on ${surface.name}`, async ({ page }) => {
        await verifySurface(page, staticBaseUrl, surface);
    });
}
