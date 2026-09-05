#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

const { chromium } = requirePlaywright();

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'service-worker-policy');
const AUTH_CODE = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const ALERTS_CODE = fs.readFileSync(path.join(ROOT, 'js', 'alerts.js'), 'utf8');
const CURRENT_SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const CURRENT_RUNTIME_CACHE = `event-genix-v${PACKAGE_VERSION}`;
const CURRENT_API_CACHE = `event-genix-api-v${PACKAGE_VERSION}`;
const OLD_RUNTIME_CACHE = `${CURRENT_RUNTIME_CACHE}-browser-old`;
const OLD_API_CACHE = `${CURRENT_API_CACHE}-browser-old`;

function extractFunction(source, functionName) {
    const functionStart = source.indexOf(`function ${functionName}`);
    assert.ok(functionStart >= 0, `${functionName} is missing`);
    const start = source.slice(functionStart - 6, functionStart) === 'async '
        ? functionStart - 6
        : functionStart;
    const bodyStart = source.indexOf('{', source.indexOf('(', functionStart));
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${functionName}`);
}

const authHarnessSource = [
    extractFunction(AUTH_CODE, 'hasAuthenticatedRuntimeSession'),
    extractFunction(AUTH_CODE, 'isAuthenticatedRuntimeReady'),
    extractFunction(AUTH_CODE, 'registerAuthenticatedServiceWorker'),
    extractFunction(AUTH_CODE, 'markAuthenticatedRuntimeReady'),
    extractFunction(AUTH_CODE, 'resetAuthenticatedRuntimeReady'),
    extractFunction(AUTH_CODE, 'scheduleOfflineSessionRecovery'),
    extractFunction(AUTH_CODE, 'readAuthBootstrapStoredUser'),
    extractFunction(AUTH_CODE, 'authBootstrapUsersShareIdentity'),
    extractFunction(AUTH_CODE, 'captureAuthBootstrapSession'),
    extractFunction(AUTH_CODE, 'isAuthBootstrapSessionCurrent'),
    extractFunction(AUTH_CODE, 'authBootstrapSessionChangedError'),
    extractFunction(AUTH_CODE, 'clearAuthSessionBootstrapError'),
    extractFunction(AUTH_CODE, 'checkSession'),
    extractFunction(AUTH_CODE, 'checkSessionAttempt'),
    extractFunction(AUTH_CODE, 'clearPrivateClientCaches')
].join('\n');

let serveCurrentWorker = false;
let alertRequests = 0;
let unauthorizedAlertRequests = 0;

function htmlHarness() {
    return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Service Worker policy smoke</title></head>
<body>
    <main id="status">login</main>
    <script>
        const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';
        const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';
        const CONFIG = { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } };
        const AppState = { currentUser: null };
        window.AppState = AppState;
        let serviceWorkerRegistrationPromise = null;
        let authenticatedRuntimeReady = false;
        let offlineSessionRecoveryBound = false;
        window.__smoke = { loginScreens: 0, mainScreens: 0 };
        window.__testOnline = true;
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            get() { return window.__testOnline; }
        });

        ${authHarnessSource}

        window.isAuthenticatedRuntimeReady = isAuthenticatedRuntimeReady;

        function hasStoredRefreshSession() {
            return Boolean(localStorage.getItem(AUTH_REFRESH_TOKEN_KEY));
        }
        async function apiVerifyToken() {
            return window.__testOnline ? { id: 17, username: 'qa.operator' } : null;
        }
        async function hydrateBusinessOperatingProfile() {}
        async function hydrateActionPermissions() {
            return { capabilityCatalog: { pageRoles: {}, actionRoles: {} }, capabilities: {} };
        }
        function showLoginScreen() {
            window.__smoke.loginScreens += 1;
            document.getElementById('status').textContent = 'login';
        }
        function showMainApp() {
            window.__smoke.mainScreens += 1;
            markAuthenticatedRuntimeReady();
            document.getElementById('status').textContent = 'authenticated';
        }
        function showAuthenticatedPageShell() {}
        function renderAuthSessionBootstrapError() {
            showLoginScreen();
        }
        function renderPermissionBootstrapError() {
            showLoginScreen();
        }
        function clearAuthStorage() {
            for (const key of ['pzp_token', AUTH_ACCESS_TOKEN_KEY, AUTH_REFRESH_TOKEN_KEY, 'pzp_current_user', 'pzp_session']) {
                localStorage.removeItem(key);
            }
        }
        async function apiFetchWithAuthRetry(url, options = {}) {
            const token = localStorage.getItem(AUTH_ACCESS_TOKEN_KEY) || localStorage.getItem('pzp_token');
            const headers = new Headers(options.headers || {});
            if (token) headers.set('Authorization', 'Bearer ' + token);
            return fetch(url, { ...options, headers });
        }
        window.testAuthenticate = async function testAuthenticate() {
            localStorage.setItem('pzp_token', 'browser-token');
            localStorage.setItem(AUTH_ACCESS_TOKEN_KEY, 'browser-token');
            localStorage.setItem('pzp_current_user', JSON.stringify({ id: 17, username: 'qa.operator' }));
            AppState.currentUser = { id: 17, username: 'qa.operator' };
            await registerAuthenticatedServiceWorker();
            markAuthenticatedRuntimeReady();
        };
        window.testPrepareOfflineSession = function testPrepareOfflineSession() {
            AppState.currentUser = null;
            resetAuthenticatedRuntimeReady();
            window.__smoke.loginScreens = 0;
            window.__smoke.mainScreens = 0;
        };
        window.testLogout = function testLogout() {
            AppState.currentUser = null;
            resetAuthenticatedRuntimeReady();
            clearAuthStorage();
            clearPrivateClientCaches();
        };
    </script>
    <script src="/js/alerts.js"></script>
</body>
</html>`;
}

function rewriteWorkerCacheNames(source, runtimeCacheName, apiCacheName) {
    return source
        .replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = '${runtimeCacheName}';`)
        .replace(/const API_CACHE_NAME = '[^']+';/, `const API_CACHE_NAME = '${apiCacheName}';`);
}

function workerSource() {
    return serveCurrentWorker
        ? rewriteWorkerCacheNames(CURRENT_SW, CURRENT_RUNTIME_CACHE, CURRENT_API_CACHE)
        : rewriteWorkerCacheNames(CURRENT_SW, OLD_RUNTIME_CACHE, OLD_API_CACHE);
}

function send(response, status, contentType, body, extraHeaders = {}) {
    response.writeHead(status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    response.end(body);
}

const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/sw.js') {
        send(response, 200, 'application/javascript; charset=utf-8', workerSource(), {
            'Service-Worker-Allowed': '/'
        });
        return;
    }
    if (url.pathname === '/__use-current-sw') {
        serveCurrentWorker = true;
        send(response, 204, 'text/plain', '');
        return;
    }
    if (url.pathname === '/js/alerts.js') {
        send(response, 200, 'application/javascript; charset=utf-8', ALERTS_CODE);
        return;
    }
    if (url.pathname === '/js/probe.js') {
        send(response, 200, 'application/javascript; charset=utf-8', 'window.__probeLoaded = true;');
        return;
    }
    if (url.pathname.startsWith('/uploads/')) {
        send(response, 200, 'text/plain; charset=utf-8', 'private-upload-marker');
        return;
    }
    if (url.pathname === '/api/dashboard/alerts') {
        alertRequests += 1;
        if (request.headers.authorization !== 'Bearer browser-token') {
            unauthorizedAlertRequests += 1;
            send(response, 401, 'application/json', JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        send(response, 200, 'application/json', JSON.stringify({ alerts: [] }));
        return;
    }
    if (url.pathname === '/manifest.json') {
        send(response, 200, 'application/manifest+json', JSON.stringify({ name: 'SW smoke' }));
        return;
    }
    if (url.pathname.startsWith('/css/')) {
        send(response, 200, 'text/css; charset=utf-8', 'body { font-family: sans-serif; }');
        return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
        send(response, 200, 'text/html; charset=utf-8', htmlHarness());
        return;
    }
    send(response, 404, 'text/plain; charset=utf-8', 'Not found');
});

async function cacheSnapshot(page) {
    return page.evaluate(async () => {
        const result = {};
        for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            result[name] = (await cache.keys()).map(request => new URL(request.url).pathname);
        }
        return result;
    });
}

async function run() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', message => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
            console.error('[browser console]', message.text());
        }
    });
    page.on('pageerror', error => {
        consoleErrors.push(error.message);
        console.error('[browser pageerror]', error.message);
    });

    try {
        await page.goto(`${origin}/index.html`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(300);
        assert.equal(alertRequests, 0, 'login screen must not start protected alerts loader');
        assert.equal(unauthorizedAlertRequests, 0, 'login screen must not create 401 responses');
        assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistration()), undefined);

        await page.evaluate(() => window.testAuthenticate());
        await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
        await page.waitForFunction(async cacheName => (await caches.keys()).includes(cacheName), OLD_RUNTIME_CACHE);
        await page.waitForFunction(() => window.__smoke.mainScreens === 0 && document.getElementById('status').textContent === 'login');
        await page.waitForFunction(() => window.isAuthenticatedRuntimeReady());
        await page.waitForFunction(() => window.__smoke && document.getElementById('alertsPanel'));
        assert.equal(alertRequests, 1, 'alerts loader should start once after authentication');
        assert.equal(unauthorizedAlertRequests, 0);

        let snapshot = await cacheSnapshot(page);
        assert.ok(snapshot[OLD_RUNTIME_CACHE]?.includes('/index.html'), 'cold install must cache /index.html');

        await page.evaluate(async () => {
            await fetch('/js/probe.js');
            await fetch('/uploads/private.txt');
        });
        snapshot = await cacheSnapshot(page);
        assert.ok(Object.values(snapshot).flat().includes('/js/probe.js'), 'reviewed public JS should enter runtime cache');
        assert.equal(Object.values(snapshot).flat().some(pathname => pathname.startsWith('/uploads/')), false);

        await context.setOffline(true);
        await page.evaluate(() => { window.__testOnline = false; });
        await page.evaluate(() => window.testPrepareOfflineSession());
        assert.equal(await page.evaluate(() => checkSession()), false);
        assert.equal(await page.evaluate(() => localStorage.getItem('pzp_token')), 'browser-token');
        assert.equal(await page.evaluate(() => window.__smoke.loginScreens), 1);
        await context.setOffline(false);
        const recoveryProbe = await page.evaluate(async () => {
            window.__testOnline = true;
            const before = { ...window.__smoke };
            window.dispatchEvent(new Event('online'));
            const result = await checkSession();
            return {
                result,
                before,
                after: { ...window.__smoke },
                online: navigator.onLine,
                failure: typeof getApiAuthSessionFailure === 'function' ? getApiAuthSessionFailure() : null,
                status: document.getElementById('status')?.textContent || null
            };
        });
        assert.ok(recoveryProbe.after.mainScreens >= 1, `offline recovery did not restore authenticated UI: ${JSON.stringify(recoveryProbe)}`);
        await page.waitForFunction(() => window.__smoke.mainScreens >= 1);
        assert.equal(await page.evaluate(() => localStorage.getItem('pzp_token')), 'browser-token');

        await page.evaluate(() => fetch('/__use-current-sw'));
        const updateProbe = await page.evaluate(async ({ currentRuntimeCache, oldRuntimeCache }) => {
            const beforeController = navigator.serviceWorker.controller?.scriptURL || null;
            let controllerChanges = 0;
            const controllerChanged = new Promise(resolve => {
                const timer = setTimeout(() => resolve(false), 10000);
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    controllerChanges += 1;
                    clearTimeout(timer);
                    resolve(true);
                }, { once: true });
            });
            const registration = await navigator.serviceWorker.getRegistration();
            await registration.update();
            const changed = await controllerChanged;
            const cacheNames = await caches.keys();
            return {
                beforeController,
                afterController: navigator.serviceWorker.controller?.scriptURL || null,
                changed,
                controllerChanges,
                hasCurrentRuntimeCache: cacheNames.includes(currentRuntimeCache),
                hasOldRuntimeCache: cacheNames.includes(oldRuntimeCache)
            };
        }, { currentRuntimeCache: CURRENT_RUNTIME_CACHE, oldRuntimeCache: OLD_RUNTIME_CACHE });
        assert.equal(updateProbe.changed, true, `updated service worker must activate and claim the existing tab: ${JSON.stringify(updateProbe)}`);
        assert.ok(updateProbe.controllerChanges >= 1, `controllerchange was not observed: ${JSON.stringify(updateProbe)}`);
        assert.equal(updateProbe.hasCurrentRuntimeCache, true, `current runtime cache was not created: ${JSON.stringify(updateProbe)}`);
        assert.equal(updateProbe.hasOldRuntimeCache, false, `old runtime cache survived activation: ${JSON.stringify(updateProbe)}`);

        await page.evaluate(async ({ cacheName, apiCacheName }) => {
            const runtimeCache = await caches.open(cacheName);
            await runtimeCache.put('/uploads/legacy-private.txt', new Response('legacy-private'));
            const apiCache = await caches.open(apiCacheName);
            await apiCache.put('/api/customers/private', new Response('{"private":true}'));
            window.testLogout();
        }, { cacheName: CURRENT_RUNTIME_CACHE, apiCacheName: CURRENT_API_CACHE });
        await page.waitForFunction(async () => {
            const names = await caches.keys();
            if (names.some(name => name.startsWith('event-genix-api-'))) return false;
            for (const name of names) {
                const cache = await caches.open(name);
                const paths = (await cache.keys()).map(request => new URL(request.url).pathname);
                if (paths.some(pathname => pathname.startsWith('/uploads/'))) return false;
            }
            return true;
        });
        assert.equal(await page.evaluate(() => localStorage.getItem('pzp_token')), null);
        assert.equal(await page.evaluate(() => window.isAuthenticatedRuntimeReady()), false);

        await page.screenshot({ path: path.join(OUTPUT_DIR, 'final.png'), fullPage: true });
        assert.deepEqual(consoleErrors, []);
        console.log(JSON.stringify({
            coldInstall: true,
            indexCached: true,
            offlineOnlineRecovered: true,
            updateActivated: true,
            privateCachesCleared: true,
            unauthorizedAlertRequests
        }));
    } finally {
        await context.close();
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
