'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { buildCapabilitySnapshot } = require('../../services/accountAccessPolicy');

const ROOT = path.resolve(__dirname, '..', '..');
const USER = { id: 901, username: 'ci.hr.pulse', name: 'CI HR Pulse', role: 'creator' };

function requirePlaywright() {
    try { return require('playwright'); } catch {}
    for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
        const normalized = entry.replace(/[\\/]+$/, '');
        if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
        const packageDir = path.join(path.dirname(normalized), 'playwright');
        if (fs.existsSync(packageDir)) return require(packageDir);
    }
    throw new Error('Playwright is unavailable; run through npm run test:browser:hr-pulse');
}

function contentType(file) {
    if (file.endsWith('.html')) return 'text/html; charset=utf-8';
    if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (file.endsWith('.css')) return 'text/css; charset=utf-8';
    if (file.endsWith('.svg')) return 'image/svg+xml';
    if (file.endsWith('.png')) return 'image/png';
    if (file.endsWith('.woff2')) return 'font/woff2';
    return 'application/octet-stream';
}

function resolveStaticFile(pathname) {
    const aliases = { '/': 'index.html', '/hr': 'hr.html', '/hr/': 'hr.html' };
    const relative = aliases[pathname] || pathname.replace(/^\/+/, '');
    const file = path.resolve(ROOT, relative);
    return file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

async function createStaticServer() {
    const server = http.createServer((req, res) => {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = resolveStaticFile(pathname);
        if (!file) return res.writeHead(404).end('Not found');
        res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function permissionsFor(user) {
    const snapshot = buildCapabilitySnapshot(user);
    return {
        role: user.role,
        roles: [user.role],
        pageAllowlist: [],
        actionAllowlist: [],
        actionDenylist: [],
        pages: snapshot.pages,
        actions: snapshot.actions,
        capabilities: snapshot.decisions,
        capabilityCatalog: snapshot.catalog
    };
}

function json(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installApi(page, state) {
    await page.route('https://www.clarity.ms/**', route => route.abort());
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = url.pathname;
        const method = request.method();
        state.requests.push(`${method} ${pathname}`);

        if (pathname === '/api/auth/refresh') {
            return json(route, { accessToken: 'ci-access-token', refreshToken: 'ci-refresh-token-rotated', user: USER });
        }
        if (pathname === '/api/auth/verify') return json(route, { success: true, user: USER });
        if (pathname === '/api/auth/permissions') return json(route, permissionsFor(USER));
        if (pathname === '/api/auth/action-permissions') return json(route, { success: true, data: {} });
        if (pathname === '/api/settings/business-operating-profile') return json(route, { success: true, data: {} });
        if (pathname === '/api/hr/today') return json(route, {
            success: true,
            data: [],
            summary: { total: 0, checked_in: 0, late: 0, absent: 0, left_early: 0, overtime: 0, completed: 0, excused: 0 },
            displayGroups: []
        });
        if (pathname === '/api/hr/staff' || pathname === '/api/staff') return json(route, { success: true, data: [], departments: [], displayGroups: [] });
        if (pathname === '/api/staff/schedule' || pathname === '/api/staff/attendance') return json(route, { success: true, data: [], displayGroups: [] });
        if (pathname.startsWith('/api/bookings/')) return json(route, []);
        return json(route, { success: true, data: [] });
    });
}

async function run() {
    const { chromium } = requirePlaywright();
    const { server, baseUrl } = await createStaticServer();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const state = { requests: [] };

    try {
        await page.addInitScript(() => {
            localStorage.clear();
            window.__hrPulseFreshAuthBeforeBootstrap = {
                legacyToken: localStorage.getItem('pzp_token'),
                accessToken: localStorage.getItem('pzp_access_token'),
                currentUser: localStorage.getItem('pzp_current_user'),
                cachedPermissions: localStorage.getItem('pzp_auth_permissions')
            };
            localStorage.setItem('pzp_refresh_token', 'ci-refresh-only-token');
            localStorage.setItem('pzp_refresh_expires_at', '2099-01-01T00:00:00.000Z');
        });
        await installApi(page, state);
        await page.goto(`${baseUrl}/hr#today`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.getPermissionLifecycle?.().status === 'ready');
        await page.locator('#mainApp').waitFor();

        const fresh = await page.evaluate(() => window.__hrPulseFreshAuthBeforeBootstrap);
        assert.deepEqual(fresh, { legacyToken: null, accessToken: null, currentUser: null, cachedPermissions: null }, 'Pulse starts with refresh-only auth and no cached permission state');
        assert.equal(state.requests.includes('POST /api/auth/refresh'), true, 'refresh-only session is exchanged before HR renders');
        assert.equal(state.requests.includes('GET /api/auth/verify'), true, 'refreshed access token is verified');
        assert.equal(state.requests.includes('GET /api/auth/permissions'), true, 'permissions are hydrated from the endpoint');

        for (const item of ['today', 'schedule', 'reports']) {
            const button = page.locator(`.hr-pulse-card[data-nav-id="${item}"]`);
            await button.waitFor();
            await button.click();
            await page.waitForFunction(expected => document.getElementById(`tab-${expected}`)?.classList.contains('active') === true, item);
        }
        assert.equal(await page.locator('.hr-pulse-card').count(), 3, 'all three Pulse controls remain visible after real permission hydration');
        assert.equal(state.requests.some(item => /^POST \/api\/(?!auth\/refresh)/.test(item)), false, 'smoke performs no HR or attendance mutation');
        console.log('HR Pulse refresh-only permission hydration browser smoke passed');
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            lifecycle: window.getPermissionLifecycle?.(),
            mainAppClass: document.querySelector('#mainApp')?.className || '',
            bodyText: document.body.textContent.slice(0, 500)
        })).catch(() => ({}));
        const diagnosticText = `HR Pulse diagnostics: ${JSON.stringify({ requests: state.requests, ...diagnostics })}`;
        error.message = `${error.message}\n${diagnosticText}`;
        error.stack = `${error.stack || error.message}\n${diagnosticText}`;
        throw error;
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
}

module.exports = { run };