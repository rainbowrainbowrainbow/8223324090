#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const {
    assertSafeIsolatedTestUrl,
    assertSafeTestDatabaseUrl
} = require('../../scripts/test-db-safety');

const TARGET_URL = String(process.env.TEST_URL || '').trim().replace(/\/$/, '');
const ENABLED = process.env.RUN_REDIRECT_AUTH_POSTGRES_BROWSER === 'true';
const HEADLESS = process.env.REDIRECT_AUTH_BROWSER_HEADLESS !== 'false';
const TIMEOUT_MS = Number(process.env.REDIRECT_AUTH_BROWSER_TIMEOUT_MS) || 90_000;

function requireIsolatedTarget() {
    assert.equal(ENABLED, true, 'set RUN_REDIRECT_AUTH_POSTGRES_BROWSER=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(TARGET_URL, 'TEST_URL is required');
    assertSafeIsolatedTestUrl(TARGET_URL);
    assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.ok(process.env.TEST_USER, 'TEST_USER is required');
    assert.ok(process.env.TEST_PASS, 'TEST_PASS is required');
}

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function chromeCandidates() {
    if (process.env.CHROME_PATH) return [process.env.CHROME_PATH];
    if (process.platform === 'win32') {
        return [
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe')
        ];
    }
    if (process.platform === 'darwin') {
        return [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ];
    }
    return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
}

function findChromeExecutable() {
    return chromeCandidates().find(candidate => candidate && fs.existsSync(candidate));
}

async function waitForDevToolsPort(userDataDir, timeoutMs = 10_000) {
    const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (fs.existsSync(activePortFile)) {
            try {
                const [port] = fs.readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/);
                const parsed = Number(port);
                if (Number.isInteger(parsed) && parsed > 0) return parsed;
            } catch (error) {
                if (error.code !== 'EBUSY' && error.code !== 'EACCES') throw error;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('INFRA: Chrome did not expose DevToolsActivePort');
}

function cdpPatternMatches(pattern, requestUrl) {
    if (pattern === '**/*') return true;
    if (pattern === '**/api/auth/refresh') {
        try { return new URL(requestUrl).pathname === '/api/auth/refresh'; }
        catch { return String(requestUrl || '').includes('/api/auth/refresh'); }
    }
    return String(requestUrl || '').includes(String(pattern || '').replace(/^\*\*\//, ''));
}

function sanitizeFetchHeaders(headers = {}) {
    const sanitized = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (/^(host|connection|content-length|accept-encoding)$/i.test(key)) continue;
        sanitized[key] = value;
    }
    return sanitized;
}

class CdpRoute {
    constructor(page, params) {
        this.page = page;
        this.params = params;
        this.finished = false;
    }

    request() {
        return {
            url: () => this.params.request.url,
            method: () => this.params.request.method,
            postData: () => this.params.request.postData || null,
            headers: () => ({ ...(this.params.request.headers || {}) })
        };
    }

    async fetch() {
        const request = this.params.request;
        const response = await fetch(request.url, {
            method: request.method,
            headers: sanitizeFetchHeaders(request.headers),
            body: /^(GET|HEAD)$/i.test(request.method) ? undefined : request.postData
        });
        const text = await response.text();
        return {
            status: () => response.status,
            headers: () => Object.fromEntries(response.headers.entries()),
            json: async () => JSON.parse(text || '{}'),
            text: async () => text
        };
    }

    async continue() {
        if (this.finished) return;
        this.finished = true;
        await this.page.send('Fetch.continueRequest', { requestId: this.params.requestId });
    }

    async abort(reason = 'failed') {
        if (this.finished) return;
        this.finished = true;
        const errorReason = /blockedbyclient/i.test(reason) ? 'BlockedByClient' : 'Failed';
        await this.page.send('Fetch.failRequest', { requestId: this.params.requestId, errorReason });
    }

    async fulfill(response) {
        if (this.finished) return;
        this.finished = true;
        const headers = Object.entries(response.headers || {}).map(([name, value]) => ({
            name,
            value: String(value)
        }));
        await this.page.send('Fetch.fulfillRequest', {
            requestId: this.params.requestId,
            responseCode: Number(response.status || 200),
            responseHeaders: headers,
            body: Buffer.from(String(response.body || '')).toString('base64')
        });
    }
}

class CdpPage {
    constructor(wsUrl, context) {
        this.wsUrl = wsUrl;
        this.context = context;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
        this.ws = new WebSocket(wsUrl);
        this.ready = new Promise((resolve, reject) => {
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
        });
        this.ws.addEventListener('message', event => this.handleMessage(event));
    }

    on(eventName, handler) {
        const list = this.listeners.get(eventName) || [];
        list.push(handler);
        this.listeners.set(eventName, list);
    }

    emit(eventName, payload) {
        for (const handler of this.listeners.get(eventName) || []) handler(payload);
    }

    handleMessage(event) {
        const message = JSON.parse(String(event.data));
        if (message.id && this.pending.has(message.id)) {
            const { resolve, reject, timer } = this.pending.get(message.id);
            clearTimeout(timer);
            this.pending.delete(message.id);
            if (message.error) reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data || {})}`));
            else resolve(message.result || {});
            return;
        }
        if (message.method === 'Fetch.requestPaused') {
            this.handleRequestPaused(message.params || {}).catch(error => {
                this.emit('pageerror', error);
            });
            return;
        }
        if (message.method === 'Runtime.exceptionThrown') {
            this.emit('pageerror', new Error(message.params?.exceptionDetails?.text || 'Runtime exception'));
            return;
        }
        if (message.method === 'Runtime.consoleAPICalled') {
            const type = message.params?.type || 'log';
            const text = (message.params?.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ');
            this.emit('console', { type: () => type, text: () => text });
        }
    }

    async handleRequestPaused(params) {
        const routeEntry = [...this.context.routes].reverse().find(entry => cdpPatternMatches(entry.pattern, params.request?.url));
        if (!routeEntry) {
            await this.send('Fetch.continueRequest', { requestId: params.requestId });
            return;
        }
        const route = new CdpRoute(this, params);
        try {
            await routeEntry.handler(route);
            if (!route.finished) await route.continue();
        } catch (error) {
            this.emit('pageerror', error);
            if (!route.finished) await route.abort('failed').catch(() => {});
        }
    }

    async send(method, params = {}, timeoutMs = 10_000) {
        await this.ready;
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP timeout for ${method}`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async init() {
        await this.send('Page.enable');
        await this.send('Runtime.enable');
        await this.send('Network.enable');
        await this.refreshFetchInterception();
    }

    async refreshFetchInterception() {
        if (!this.context.routes.length) {
            await this.send('Fetch.disable').catch(() => {});
            return;
        }
        await this.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    }

    async goto(url, options = {}) {
        const timeout = Number(options.timeout || TIMEOUT_MS);
        await this.send('Page.navigate', { url }, timeout);
        await this.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete', null, { timeout });
    }

    async evaluate(fnOrExpression, arg) {
        const expression = typeof fnOrExpression === 'function'
            ? `(${fnOrExpression.toString()})(${JSON.stringify(arg)})`
            : String(fnOrExpression);
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        }, TIMEOUT_MS);
        if (result.exceptionDetails) {
            throw new Error(`Runtime exception: ${JSON.stringify(result.exceptionDetails)}`);
        }
        return result.result?.value;
    }

    async waitForFunction(fnOrExpression, arg, options = {}) {
        const timeout = Number(options.timeout || TIMEOUT_MS);
        const startedAt = Date.now();
        let lastValue;
        let lastError = null;
        while (Date.now() - startedAt < timeout) {
            try {
                const expression = typeof fnOrExpression === 'function'
                    ? `(${fnOrExpression.toString()})(${JSON.stringify(arg)})`
                    : String(fnOrExpression);
                lastValue = await this.evaluate(`(async () => Boolean(await (${expression})))()`);
                lastError = null;
                if (lastValue) return true;
            } catch (error) {
                const message = String(error?.message || error);
                if (!/navigated|Execution context|Cannot find context/i.test(message)) throw error;
                lastError = message;
            }
            await this.waitForTimeout(100);
        }
        throw new Error(`Timed out waiting for browser condition; last=${lastValue}; lastError=${lastError || ''}`);
    }

    async waitForTimeout(ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async close() {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
    }
}

class CdpContext {
    constructor(port) {
        this.port = port;
        this.routes = [];
        this.pages = new Set();
    }

    async route(pattern, handler) {
        this.routes.push({ pattern, handler });
        await Promise.all([...this.pages].map(page => page.refreshFetchInterception()));
    }

    async unroute(pattern) {
        this.routes = this.routes.filter(entry => entry.pattern !== pattern);
        await Promise.all([...this.pages].map(page => page.refreshFetchInterception()));
    }

    async newPage() {
        const response = await fetch(`http://127.0.0.1:${this.port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
        if (!response.ok) throw new Error(`INFRA: unable to create Chrome tab: ${response.status}`);
        const target = await response.json();
        const page = new CdpPage(target.webSocketDebuggerUrl, this);
        this.pages.add(page);
        await page.init();
        return page;
    }
}

function createCdpChromium() {
    return {
        async launch() {
            const executable = findChromeExecutable();
            if (!executable) throw new Error('INFRA: playwright missing and Chrome/Edge executable was not found; set CHROME_PATH');
            const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-r6-chrome-'));
            const child = childProcess.spawn(executable, [
                '--headless=new',
                '--remote-debugging-port=0',
                `--user-data-dir=${userDataDir}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-background-networking',
                '--disable-sync',
                '--disable-extensions',
                'about:blank'
            ], { stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = '';
            child.stderr.on('data', chunk => { stderr += chunk.toString(); });
            const port = await waitForDevToolsPort(userDataDir).catch(error => {
                child.kill('SIGTERM');
                throw new Error(`${error.message}\n${stderr.trim()}`);
            });
            return {
                async newContext() { return new CdpContext(port); },
                async close() {
                    if (child.exitCode === null && !child.killed) {
                        const exited = new Promise(resolve => child.once('exit', resolve));
                        child.kill('SIGTERM');
                        await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
                    }
                    if (userDataDir.startsWith(path.join(os.tmpdir(), 'eventgenix-r6-chrome-'))) {
                        fs.rmSync(userDataDir, { recursive: true, force: true });
                    }
                }
            };
        }
    };
}

function loadBrowserEngine() {
    try {
        return requirePlaywright().chromium;
    } catch (error) {
        process.stdout.write(`[redirect-auth-browser] playwright unavailable; using local Chrome CDP fallback (${error.code || error.message})\n`);
        return createCdpChromium();
    }
}

function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function waitForReady(label, ready) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} did not reach committed response`)), TIMEOUT_MS));
    return Promise.race([ready.promise, timeout]);
}

async function tokenRow(pool, token) {
    const result = await pool.query(
        'SELECT id, user_id, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1',
        [hashRefreshToken(token)]
    );
    return result.rows[0] || null;
}

async function activeSessionCount(pool, userId) {
    const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()',
        [userId]
    );
    return Number(result.rows[0]?.count || 0);
}

async function refreshTokenCount(pool, userId) {
    const result = await pool.query(
        'SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE user_id = $1',
        [userId]
    );
    return Number(result.rows[0]?.count || 0);
}

async function requestJson(pathname, { method = 'GET', body = null, token = '' } = {}) {
    const headers = {};
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${TARGET_URL}${pathname}`, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, data };
}

function createBrowserDiagnostics() {
    return { pageErrors: [], unexpectedConsoleErrors: [], expectedFaults: [] };
}

function recordBrowserConsole(diagnostics, message) {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/api\/auth\/refresh|api\/auth\/logout|api\/auth\/verify|net::ERR_FAILED|net::ERR_ABORTED|Failed to load resource|401|blockedbyclient/i.test(text)) {
        diagnostics.expectedFaults.push(text);
        return;
    }
    diagnostics.unexpectedConsoleErrors.push(new Error(text));
}

function assertNoUnexpectedBrowserFaults(diagnostics) {
    assert.deepEqual(diagnostics.pageErrors, [], 'browser pageerror events must fail the proof');
    assert.deepEqual(diagnostics.unexpectedConsoleErrors, [], 'unexpected browser console errors must fail the proof');
}

async function newAppPage(context, diagnostics, pathname = '/status.html') {
    const page = await context.newPage();
    page.on('pageerror', error => diagnostics.pageErrors.push(error));
    page.on('console', message => recordBrowserConsole(diagnostics, message));
    await page.goto(`${TARGET_URL}${pathname}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await page.waitForFunction(() => typeof window.apiLogin === 'function' && typeof window.apiRefreshAuthSession === 'function', null, { timeout: TIMEOUT_MS });
    return page;
}

async function browserLogin(page) {
    const result = await page.evaluate(async ({ username, password }) => {
        const data = await window.apiLogin(username, password);
        window.rememberApiAuthSession(data);
        return {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            refreshExpiresAt: data.refreshExpiresAt,
            user: data.user,
            storedRefreshToken: localStorage.getItem('pzp_refresh_token')
        };
    }, { username: process.env.TEST_USER, password: process.env.TEST_PASS });
    assert.ok(result.accessToken, 'browser login must return an access token');
    assert.ok(result.refreshToken, 'browser login must return a refresh token');
    assert.equal(result.storedRefreshToken, result.refreshToken, 'browser login must store the refresh token in the same client');
    return result;
}

async function verifyStoredAccessToken(page) {
    const token = await page.evaluate(() => localStorage.getItem('pzp_access_token'));
    assert.ok(token, 'browser must store an access token');
    const verified = await requestJson('/api/auth/verify', { token });
    assert.equal(verified.status, 200, 'server must accept the browser-stored access token');
    assert.ok(verified.data.user?.id || verified.data.user?.username, 'verify must return a user');
    return verified.data.user;
}

async function assertModuleNavigation(page) {
    for (const pathname of ['/', '/sales-funnel', '/certificates']) {
        await page.goto(`${TARGET_URL}${pathname}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
        await page.waitForFunction(() => {
            const login = document.getElementById('loginScreen') || document.getElementById('loginOverlay');
            const main = document.getElementById('mainApp');
            const mainContent = document.getElementById('main-content');
            const loginVisible = Boolean(login && !login.classList.contains('hidden'));
            const shellVisible = Boolean((main && !main.classList.contains('hidden')) || (mainContent && !mainContent.classList.contains('hidden')));
            return Boolean(localStorage.getItem('pzp_current_user'))
                && Boolean(localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token'))
                && !loginVisible
                && shellVisible;
        }, null, { timeout: TIMEOUT_MS });
        const state = await page.evaluate(() => {
            const login = document.getElementById('loginScreen') || document.getElementById('loginOverlay');
            const main = document.getElementById('mainApp');
            const mainContent = document.getElementById('main-content');
            return {
                pathname: window.location.pathname,
                title: document.title,
                hasUser: Boolean(localStorage.getItem('pzp_current_user')),
                hasAccess: Boolean(localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token')),
                loginVisible: Boolean(login && !login.classList.contains('hidden')),
                shellVisible: Boolean((main && !main.classList.contains('hidden')) || (mainContent && !mainContent.classList.contains('hidden'))),
                shellExists: Boolean(main || mainContent),
                mainContentText: String((document.getElementById('main-content') || document.body)?.textContent || '').slice(0, 1000),
                moduleMarkers: {
                    timeline: Boolean(document.getElementById('timelineDate') || document.getElementById('timelineLines') || document.getElementById('bookingForm')),
                    leads: Boolean(document.getElementById('leadsApp') || document.getElementById('leadsTableBody') || document.getElementById('leadsKanbanLayout')),
                    certificates: Boolean(document.getElementById('certificatePageTitle') || document.getElementById('certPageList') || document.getElementById('certificatePageForm'))
                }
            };
        });
        assert.equal(state.pathname, pathname, `module pathname must be ${pathname}`);
        assert.equal(state.hasUser, true, `${pathname} must keep current user in storage`);
        assert.equal(state.hasAccess, true, `${pathname} must keep access token in storage`);
        assert.equal(state.loginVisible, false, `${pathname} must not show login form`);
        assert.equal(state.shellExists, true, `${pathname} must render the authenticated app shell`);
        assert.equal(state.shellVisible, true, `${pathname} must show the authenticated app shell`);
        if (pathname === '/') assert.equal(state.moduleMarkers.timeline, true, 'root page must render the timeline CRM module shell');
        if (pathname === '/sales-funnel') assert.equal(state.moduleMarkers.leads, true, 'sales funnel page must render the leads module shell');
        if (pathname === '/certificates') assert.equal(state.moduleMarkers.certificates, true, 'certificates page must render the certificates module shell');
    }
}

async function installExternalRequestGuard(context) {
    await context.route('**/*', async route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.origin !== TARGET_URL) return route.abort('blockedbyclient');
        return route.continue();
    });
}

async function runLostResponseRecovery(chromium, pool) {
    const browser = await chromium.launch({ headless: HEADLESS });
    const diagnostics = createBrowserDiagnostics();
    try {
        const context = await browser.newContext();
        await installExternalRequestGuard(context);
        const page = await newAppPage(context, diagnostics);
        const session = await browserLogin(page);
        const firstRefreshReady = deferred();
        await context.route('**/api/auth/refresh', async route => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.refreshToken !== session.refreshToken) return route.continue();
            const committed = await route.fetch();
            const payload = await committed.json().catch(() => ({}));
            firstRefreshReady.resolve(payload);
            await route.abort('failed');
        });

        const lostResult = await page.evaluate(() => window.apiRefreshAuthSession());
        assert.equal(lostResult.outcome, 'transient', 'lost committed response must be transient locally');
        const lostPayload = await waitForReady('lost first refresh', firstRefreshReady);
        assert.ok(lostPayload.refreshToken, 'lost committed response must have created a replacement refresh token');
        assert.equal(await page.evaluate(oldRefresh => localStorage.getItem('pzp_refresh_token') === oldRefresh, session.refreshToken), true);
        await context.unroute('**/api/auth/refresh');

        await page.waitForTimeout(5200);
        const recovered = await page.evaluate(() => window.apiRefreshAuthSession());
        assert.equal(recovered.outcome, 'success', 'same-session post-grace retry must recover a new token pair');
        assert.ok(recovered.accessToken, 'recovery must return an access token');
        assert.notEqual(await page.evaluate(() => localStorage.getItem('pzp_refresh_token')), session.refreshToken);
        await verifyStoredAccessToken(page);

        const root = await tokenRow(pool, session.refreshToken);
        const lost = await tokenRow(pool, lostPayload.refreshToken);
        const recoveredRow = await tokenRow(pool, await page.evaluate(() => localStorage.getItem('pzp_refresh_token')));
        assert.ok(root?.revoked_at, 'root refresh token must be revoked after rotation');
        assert.ok(lost?.revoked_at, 'lost replacement must be revoked after recovery');
        assert.equal(Number(root.replaced_by), Number(lost.id), 'root must keep its first replacement link');
        assert.equal(Number(lost.replaced_by), Number(recoveredRow.id), 'lost replacement must link to recovered replacement');
        assert.equal(recoveredRow.revoked_at, null, 'recovered refresh must be active');

        const next = await page.evaluate(() => window.apiRefreshAuthSession());
        assert.equal(next.outcome, 'success', 'next refresh after recovery must work');
        await verifyStoredAccessToken(page);
        await assertModuleNavigation(page);
        assertNoUnexpectedBrowserFaults(diagnostics);
    } finally {
        await browser.close();
    }
}

async function runTerminalReplayScenarios(chromium, pool) {
    const browser = await chromium.launch({ headless: HEADLESS });
    const diagnostics = createBrowserDiagnostics();
    try {
        const context = await browser.newContext();
        await installExternalRequestGuard(context);
        const page = await newAppPage(context, diagnostics);

        const noProofSession = await browserLogin(page);
        const noProofRotated = await page.evaluate(() => window.apiRefreshAuthSession());
        assert.equal(noProofRotated.outcome, 'success');
        await page.waitForTimeout(5200);
        const noProofReplay = await page.evaluate(async oldRefresh => {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: oldRefresh })
            });
            return { status: response.status, body: await response.json().catch(() => ({})) };
        }, noProofSession.refreshToken);
        assert.equal(noProofReplay.status, 401, 'same browser UA/IP without signed access proof must be hostile after grace');
        assert.equal(noProofReplay.body.code, 'refresh_token_reuse');

        const logoutSession = await browserLogin(page);
        const logoutOldAccess = logoutSession.accessToken;
        const logoutOldRefresh = logoutSession.refreshToken;
        const logoutRotated = await page.evaluate(() => window.apiRefreshAuthSession());
        assert.equal(logoutRotated.outcome, 'success');
        const firstReplacement = await page.evaluate(() => localStorage.getItem('pzp_refresh_token'));
        await page.waitForTimeout(5200);
        const logout = await page.evaluate(async refreshToken => {
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });
            return { status: response.status, body: await response.json().catch(() => ({})) };
        }, firstReplacement);
        assert.equal(logout.status, 200);
        await page.evaluate(({ accessToken, refreshToken, user }) => {
            localStorage.setItem('pzp_token', accessToken);
            localStorage.setItem('pzp_access_token', accessToken);
            localStorage.setItem('pzp_refresh_token', refreshToken);
            localStorage.setItem('pzp_current_user', JSON.stringify(user));
        }, { accessToken: logoutOldAccess, refreshToken: logoutOldRefresh, user: logoutSession.user });
        const logoutRoot = await tokenRow(pool, logoutOldRefresh);
        const logoutReplacement = await tokenRow(pool, firstReplacement);
        assert.ok(logoutRoot?.revoked_at, 'logout scenario root must be revoked');
        assert.ok(logoutReplacement?.revoked_at, 'logout scenario replacement must be revoked');
        const activeBeforeReplay = await activeSessionCount(pool, logoutSession.user.id);
        const tokenCountBeforeReplay = await refreshTokenCount(pool, logoutSession.user.id);
        const replayAfterLogout = await page.evaluate(() => window.apiRefreshAuthSession());
        assert.equal(replayAfterLogout.outcome, 'terminal', 'predecessor replay after logout must be terminal');
        assert.equal(await activeSessionCount(pool, logoutSession.user.id), activeBeforeReplay, 'logout-then-predecessor replay must not create an active session');
        assert.equal(await refreshTokenCount(pool, logoutSession.user.id), tokenCountBeforeReplay, 'logout-then-predecessor replay must not create a replacement token row');
        assertNoUnexpectedBrowserFaults(diagnostics);
    } finally {
        await browser.close();
    }
}

async function runDelayedTwoTabRefresh(chromium, pool, order) {
    const browser = await chromium.launch({ headless: HEADLESS });
    const diagnostics = createBrowserDiagnostics();
    try {
        const context = await browser.newContext();
        await installExternalRequestGuard(context);
        const firstPage = await newAppPage(context, diagnostics);
        const session = await browserLogin(firstPage);
        const secondPage = await newAppPage(context, diagnostics);
        const thirdPage = await newAppPage(context, diagnostics);
        const originalReady = deferred();
        const recoveryReady = deferred();
        const originalRelease = deferred();
        const recoveryRelease = deferred();
        let controlledRequests = 0;
        let originalPayload = null;
        let recoveryPayload = null;
        await context.route('**/api/auth/refresh', async route => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.refreshToken !== session.refreshToken) return route.continue();
            controlledRequests += 1;
            const committed = await route.fetch();
            const payload = await committed.json().catch(() => ({}));
            const response = {
                status: committed.status(),
                headers: committed.headers(),
                body: JSON.stringify(payload)
            };
            if (controlledRequests === 1) {
                originalPayload = payload;
                originalReady.resolve(payload);
                await originalRelease.promise;
                return route.fulfill(response);
            }
            recoveryPayload = payload;
            recoveryReady.resolve(payload);
            await recoveryRelease.promise;
            return route.fulfill(response);
        });

        const first = firstPage.evaluate(() => window.apiRefreshAuthSession());
        await secondPage.waitForTimeout(25);
        const second = secondPage.evaluate(() => window.apiRefreshAuthSession());
        await waitForReady(`${order} original`, originalReady);
        await waitForReady(`${order} recovery`, recoveryReady);
        assert.ok(originalPayload.refreshToken, 'original delayed response must contain T1');
        assert.equal(recoveryPayload.recovered, true, 'second committed response must be marked as recovery');
        assert.ok(recoveryPayload.refreshToken, 'recovery response must contain T2');

        if (order === 'original-first') {
            originalRelease.resolve();
            await first;
            recoveryRelease.resolve();
        } else {
            recoveryRelease.resolve();
            await second;
            originalRelease.resolve();
        }
        const results = await Promise.all([first, second]);
        assert.ok(results.some(result => result.outcome === 'success'), `${order}: one tab must store a session`);
        assert.ok(results.every(result => ['success', 'superseded'].includes(result.outcome)), `${order}: no tab may terminal-clear the session`);
        assert.equal(controlledRequests, 2, `${order}: refresh calls must be bounded to original + recovery`);
        assert.equal(await firstPage.evaluate(() => localStorage.getItem('pzp_refresh_token')), recoveryPayload.refreshToken, `${order}: final storage must keep recovered T2`);
        const root = await tokenRow(pool, session.refreshToken);
        const original = await tokenRow(pool, originalPayload.refreshToken);
        const recovered = await tokenRow(pool, recoveryPayload.refreshToken);
        assert.ok(root?.revoked_at, `${order}: T0 must be revoked`);
        assert.ok(original?.revoked_at, `${order}: T1 must be revoked by recovery`);
        assert.equal(Number(root.replaced_by), Number(original.id), `${order}: T0 must link to T1`);
        assert.equal(Number(original.replaced_by), Number(recovered.id), `${order}: T1 must link to T2`);
        assert.equal(recovered.revoked_at, null, `${order}: T2 must remain active`);

        const next = await thirdPage.evaluate(() => window.apiRefreshAuthSession());
        assert.equal(next.outcome, 'success', `${order}: next refresh after delayed delivery must work`);
        await verifyStoredAccessToken(firstPage);
        await verifyStoredAccessToken(secondPage);
        await verifyStoredAccessToken(thirdPage);
        await assertModuleNavigation(firstPage);
        await context.unroute('**/api/auth/refresh');
        assertNoUnexpectedBrowserFaults(diagnostics);
    } finally {
        await browser.close();
    }
}

async function main() {
    requireIsolatedTarget();
    const chromium = loadBrowserEngine();
    const testDb = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    const pool = new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 10_000
    });
    try {
        await runLostResponseRecovery(chromium, pool);
        await runDelayedTwoTabRefresh(chromium, pool, 'original-first');
        await runDelayedTwoTabRefresh(chromium, pool, 'recovery-first');
        await runTerminalReplayScenarios(chromium, pool);
        process.stdout.write('[redirect-auth-browser] R2 PostgreSQL/browser auth recovery proof passed\n');
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    process.stderr.write(`[redirect-auth-browser] ${error.stack || error.message}\n`);
    process.exitCode = 1;
});
