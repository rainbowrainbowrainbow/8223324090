#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'browser', 'r10a-recovery-login-ui');
const CHROME_PROFILE_PREFIX = path.join(os.tmpdir(), 'eventgenix-r10a-chrome-');
const AUTH_CODE = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');

function extractSourceFunction(source, functionName) {
    const start = source.indexOf(`function ${functionName}(`);
    assert.ok(start >= 0, `${functionName} function missing`);
    const declarationStart = source.slice(Math.max(0, start - 6), start) === 'async '
        ? start - 6
        : start;
    const signatureStart = source.indexOf('(', start);
    let signatureDepth = 0;
    let signatureEnd = -1;
    for (let i = signatureStart; i < source.length; i += 1) {
        const char = source[i];
        if (char === '(') signatureDepth += 1;
        if (char === ')') {
            signatureDepth -= 1;
            if (signatureDepth === 0) {
                signatureEnd = i;
                break;
            }
        }
    }
    assert.ok(signatureEnd > signatureStart, `${functionName} signature end missing`);
    const bodyStart = source.indexOf('{', signatureEnd);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
        const char = source[i];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(declarationStart, i + 1);
        }
    }
    throw new Error(`${functionName} body end missing`);
}

function authReturnRouteBlock() {
    const start = AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES');
    const end = AUTH_CODE.indexOf('function clearAuthSessionBootstrapError', start);
    assert.ok(start >= 0 && end > start, 'auth return route block missing');
    return AUTH_CODE.slice(start, end);
}

function authRecoveryScript() {
    return `
        const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
        const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
        ${extractSourceFunction(AUTH_CODE, '_escHtml')}
        ${extractSourceFunction(AUTH_CODE, 'authSessionFailureMessage')}
        ${authReturnRouteBlock()}
        ${extractSourceFunction(AUTH_CODE, 'clearAuthSessionBootstrapError')}
        ${extractSourceFunction(AUTH_CODE, 'ensureAuthSessionRecoverySurface')}
        ${extractSourceFunction(AUTH_CODE, 'hasAuthRecoveryUnsavedChanges')}
        ${extractSourceFunction(AUTH_CODE, 'confirmAuthRecoveryReload')}
        ${extractSourceFunction(AUTH_CODE, 'reloadAuthSessionRecoveryPage')}
        ${extractSourceFunction(AUTH_CODE, 'renderAuthSessionBootstrapError')}
    `;
}

function checkSessionScript() {
    return `
        const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
        const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
        const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';
        const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';
        ${authReturnRouteBlock()}
        ${extractSourceFunction(AUTH_CODE, 'checkSessionAttempt')}
        ${extractSourceFunction(AUTH_CODE, 'checkSession')}
    `;
}

function createServer() {
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>R10A Smoke</title></head><body><main id="mainApp" class="hidden"></main><section id="loginScreen" class="hidden"></section><div id="authSessionRecovery"></div></body></html>';
    return http.createServer((req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        res.end(html);
    });
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

async function waitForDevToolsPort(userDataDir, timeoutMs = 10000) {
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

async function launchChrome() {
    const executable = findChromeExecutable();
    if (!executable) throw new Error('BLOCKED: Chrome/Edge executable was not found; set CHROME_PATH to run the browser smoke');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const userDataDir = fs.mkdtempSync(CHROME_PROFILE_PREFIX);
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
    child.on('exit', code => {
        if (code && code !== 0) stderr += `\nChrome exited with ${code}`;
    });
    let port;
    try {
        port = await waitForDevToolsPort(userDataDir);
    } catch (error) {
        child.kill('SIGTERM');
        throw new Error(`${error.message}\n${stderr.trim()}`);
    }
    return { child, port, userDataDir };
}

async function stopChrome(chrome) {
    if (!chrome?.child) return;
    if (chrome.child.exitCode !== null || chrome.child.killed) return;
    const exited = new Promise(resolve => chrome.child.once('exit', resolve));
    chrome.child.kill('SIGTERM');
    await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 2000))
    ]);
}

class CdpPage {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.nextId = 1;
        this.pending = new Map();
        this.ws = new WebSocket(wsUrl);
        this.ready = new Promise((resolve, reject) => {
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
        });
        this.ws.addEventListener('message', event => this.handleMessage(event));
    }

    handleMessage(event) {
        const message = JSON.parse(String(event.data));
        if (!message.id || !this.pending.has(message.id)) return;
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data || {})}`));
        else resolve(message.result || {});
    }

    async send(method, params = {}, timeoutMs = 10000) {
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
    }

    async navigate(url, timeoutMs = 15000) {
        await this.send('Page.navigate', { url }, timeoutMs);
        await this.waitForFunction(`document.readyState === 'interactive' || document.readyState === 'complete'`, timeoutMs);
    }

    async evaluate(expression, timeoutMs = 10000) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        }, timeoutMs);
        if (result.exceptionDetails) {
            throw new Error(`Runtime exception: ${JSON.stringify(result.exceptionDetails)}`);
        }
        return result.result?.value;
    }

    async waitForFunction(expression, timeoutMs = 10000) {
        const startedAt = Date.now();
        let lastValue;
        let lastError = null;
        while (Date.now() - startedAt < timeoutMs) {
            try {
                lastValue = await this.evaluate(`(async () => Boolean(await (${expression})))()`, 2000);
                lastError = null;
                if (lastValue) return true;
            } catch (error) {
                const message = String(error?.message || error);
                if (!/navigated|Execution context|Cannot find context/i.test(message)) throw error;
                lastError = message;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Timed out waiting for function: ${expression}; last=${lastValue}; lastError=${lastError || ''}`);
    }

    async close() {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
    }
}

async function createCdpPage(port, url = 'about:blank') {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`INFRA: unable to create browser tab: ${response.status}`);
    const target = await response.json();
    const page = new CdpPage(target.webSocketDebuggerUrl);
    await page.init();
    return page;
}

async function smokeRecoveryReloadExit(page, origin) {
    await page.navigate(`${origin}/certificates/77?token=secret#frag`);
    const cancelResult = await page.evaluate(`(async () => {
        ${authRecoveryScript()}
        const calls = [];
        const dirty = document.createElement('section');
        dirty.dataset.editableSurface = 'true';
        dirty.dataset.dirty = 'true';
        document.body.appendChild(dirty);
        window.AppState = { currentUser: { id: 14, username: 'operator', role: 'manager' } };
        window.RedirectDiagnostics = { copy: async () => ({ copied: true }) };
        window.UnsafeDismissGuard = { isDirtySurface: surface => surface === dirty };
        window.recordRedirectDiagnostic = (...args) => calls.push(['diagnostic', ...args]);
        window.getPermissionLifecycle = () => ({ status: 'ready' });
        window.canAccessPage = route => route === '/certificates';
        window.getAuthenticatedTimelineStartPage = () => '/dashboard';
        window.confirmModal = async () => false;
        renderAuthSessionBootstrapError({
            failure: { kind: 'transient', reason: 'refresh-watchdog-timeout' },
            retry: () => calls.push(['retry'])
        });
        const button = document.querySelector('[data-auth-session-reload]');
        const note = document.querySelector('[data-auth-session-reload-note]')?.textContent || '';
        button.click();
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
            hasButton: Boolean(button),
            note,
            path: location.pathname,
            routeStored: localStorage.getItem('pzp_auth_return_route_v1')
        };
    })()`);
    assert.equal(cancelResult.hasButton, true, 'PRODUCT_FAILURE: manual reload button is missing');
    assert.match(cancelResult.note, /не гарантує тихе відновлення/i);
    assert.equal(cancelResult.path, '/certificates/77', 'PRODUCT_FAILURE: dirty cancel changed the route');
    assert.equal(cancelResult.routeStored, null, 'PRODUCT_FAILURE: dirty cancel stored a return route');

    const beforeReload = await page.evaluate('performance.getEntriesByType("navigation").length');
    await page.evaluate(`(async () => {
        ${authRecoveryScript()}
        const dirty = document.createElement('section');
        dirty.dataset.editableSurface = 'true';
        dirty.dataset.dirty = 'true';
        document.body.appendChild(dirty);
        window.AppState = { currentUser: { id: 14, username: 'operator', role: 'manager' } };
        window.RedirectDiagnostics = { copy: async () => ({ copied: true }) };
        window.UnsafeDismissGuard = { isDirtySurface: surface => surface === dirty };
        window.recordRedirectDiagnostic = () => {};
        window.getPermissionLifecycle = () => ({ status: 'ready' });
        window.canAccessPage = route => route === '/certificates';
        window.getAuthenticatedTimelineStartPage = () => '/dashboard';
        window.confirmModal = async () => true;
        renderAuthSessionBootstrapError({
            failure: { kind: 'transient', reason: 'refresh-watchdog-timeout' },
            retry: () => {}
        });
        window.__r10a_document_marker = 'before-confirmed-reload';
        document.querySelector('[data-auth-session-reload]').click();
        return true;
    })()`, 2000).catch(error => {
        if (!/navigated|Execution context|Cannot find context/i.test(String(error?.message || error))) throw error;
    });
    await page.waitForFunction(`(document.readyState === 'interactive' || document.readyState === 'complete')
        && typeof window.__r10a_document_marker === 'undefined'`, 10000);
    const afterConfirm = await page.evaluate(`(() => ({
        path: location.pathname,
        beforeReload: ${JSON.stringify(beforeReload)},
        markerPresent: typeof window.__r10a_document_marker !== 'undefined',
        routeStored: JSON.parse(localStorage.getItem('pzp_auth_return_route_v1') || 'null')
    }))()`);
    assert.equal(afterConfirm.path, '/certificates/77', 'PRODUCT_FAILURE: confirmed manual reload did not preserve current URL');
    assert.equal(afterConfirm.markerPresent, false, 'PRODUCT_FAILURE: confirmed manual reload did not create a new document');
    assert.equal(afterConfirm.routeStored.route, '/certificates', 'PRODUCT_FAILURE: confirmed manual reload did not persist a sanitized route');
}

async function smokeReturnRouteAfterPermissionRetry(page, origin) {
    await page.navigate(`${origin}/`);
    const result = await page.evaluate(`(async () => {
        ${checkSessionScript()}
        const calls = [];
        let permissionsReady = false;
        let permissionLifecycle = 'loading';
        window.AppState = { currentUser: null };
        window.Sidebar = { initUserCard: () => calls.push(['sidebar']) };
        window.hasStoredRefreshSession = () => Boolean(localStorage.getItem('pzp_refresh_token'));
        window.apiVerifyToken = async () => ({ id: 7, username: 'cached.user', role: 'manager' });
        window.captureAuthBootstrapSession = user => ({ user });
        window.isAuthBootstrapSessionCurrent = () => true;
        window.authBootstrapSessionChangedError = () => ({ authFailure: { kind: 'transient' } });
        window.hydrateBusinessOperatingProfile = async () => {};
        window.hydrateActionPermissions = async () => {
            if (!permissionsReady) return null;
            permissionLifecycle = 'ready';
            return { ok: true };
        };
        window.WorkingRole = { hydrate: () => calls.push(['hydrate-role']) };
        window.showMainApp = () => calls.push(['show-main']);
        window.showAuthenticatedPageShell = () => calls.push(['show-shell']);
        window.renderPermissionBootstrapError = options => calls.push(['permission-error', typeof options.retry]);
        window.clearAuthSessionBootstrapError = () => {};
        window.resetAuthenticatedRuntimeReady = () => {};
        window.scheduleOfflineSessionRecovery = () => {};
        window.getApiAuthSessionFailure = () => null;
        window.isApiAuthSessionFailureTransient = () => false;
        window.renderAuthSessionBootstrapError = () => calls.push(['auth-error']);
        window.recordRedirectDiagnostic = (...args) => calls.push(['diagnostic', ...args]);
        window.clearAuthStorage = () => calls.push(['clear-auth']);
        window.clearPrivateClientCaches = () => calls.push(['clear-private']);
        window.showLoginScreen = () => calls.push(['show-login']);
        window.getPermissionLifecycle = () => ({ status: permissionLifecycle });
        window.canAccessPage = route => route === '/certificates';
        window.getAuthenticatedTimelineStartPage = () => '/dashboard';
        localStorage.setItem('pzp_token', 'stored-token');
        localStorage.setItem('pzp_refresh_token', 'stored-refresh');
        localStorage.setItem('pzp_auth_return_route_v1', JSON.stringify({ route: '/certificates', at: Date.now() }));
        await checkSession();
        const afterFirst = {
            intent: localStorage.getItem('pzp_auth_return_route_v1'),
            path: location.pathname,
            calls: calls.slice()
        };
        permissionsReady = true;
        calls.length = 0;
        const second = await checkSession();
        sessionStorage.setItem('__r10a_return_route_probe', JSON.stringify({ second, calls }));
        return { afterFirst };
    })()`);
    assert.ok(result.afterFirst.intent, 'PRODUCT_FAILURE: permission retry consumed return route too early');
    assert.equal(result.afterFirst.path, '/', 'PRODUCT_FAILURE: permission retry navigated before permissions were ready');
    await page.waitForFunction('location.pathname === "/certificates"', 10000);
    const finalProbe = await page.evaluate(`(() => ({
        path: location.pathname,
        intent: localStorage.getItem('pzp_auth_return_route_v1')
    }))()`);
    assert.equal(finalProbe.path, '/certificates', 'PRODUCT_FAILURE: retry bootstrap did not navigate to saved route');
    assert.equal(finalProbe.intent, null, 'PRODUCT_FAILURE: return route was not consumed after successful permission-ready bootstrap');
}

async function smokeLoginSameReturnRoute(page, origin) {
    await page.navigate(`${origin}/certificates`);
    const result = await page.evaluate(`(async () => {
        const calls = [];
        const AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';
        ${checkSessionScript()}
        ${extractSourceFunction(AUTH_CODE, 'login')}
        window.AppState = { currentUser: null };
        window.Sidebar = { initUserCard: () => calls.push(['sidebar']) };
        window.apiLogin = async () => ({
            accessToken: 'access-current',
            refreshToken: 'refresh-current',
            user: { id: 10, username: 'account.current', role: 'manager' }
        });
        window.rememberAuthSession = data => {
            localStorage.setItem('pzp_token', data.accessToken);
            localStorage.setItem('pzp_access_token', data.accessToken);
            localStorage.setItem('pzp_refresh_token', data.refreshToken);
            localStorage.setItem('pzp_current_user', JSON.stringify(data.user));
            localStorage.setItem('pzp_auth_session_generation', 'generation-current');
            return true;
        };
        window.revokeRefreshTokenValue = token => calls.push(['revoke', token]);
        window.captureAuthBootstrapSession = user => ({ userId: user?.id, generation: localStorage.getItem('pzp_auth_session_generation') || '' });
        window.isAuthBootstrapSessionCurrent = () => true;
        window.hydrateBusinessOperatingProfile = async () => {};
        window.hydrateActionPermissions = async () => ({ ok: true });
        window.WorkingRole = { hydrate: () => calls.push(['hydrate-role']) };
        window.registerAuthenticatedServiceWorker = async () => null;
        window.getAuthenticatedTimelineStartPage = () => '/dashboard';
        window.recordRedirectDiagnostic = (...args) => calls.push(['diagnostic', ...args]);
        window.showMainApp = () => calls.push(['show-main']);
        window.checkDailyLogin = () => calls.push(['daily']);
        window.resetAuthenticatedRuntimeReady = () => calls.push(['reset-runtime']);
        window.showAuthenticatedPageShell = () => calls.push(['show-shell']);
        window.renderAuthSessionBootstrapError = () => calls.push(['auth-error']);
        window.getPermissionLifecycle = () => ({ status: 'ready' });
        window.canAccessPage = route => route === '/certificates';
        localStorage.setItem('pzp_auth_return_route_v1', JSON.stringify({ route: '/certificates', at: Date.now() }));
        const loginResult = await login('account.current', 'password');
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
            loginResult,
            path: location.pathname,
            intent: localStorage.getItem('pzp_auth_return_route_v1'),
            calls
        };
    })()`);
    assert.equal(result.loginResult.success, true);
    assert.equal(result.path, '/certificates', 'PRODUCT_FAILURE: same-route login fell through to default start redirect');
    assert.equal(result.intent, null, 'PRODUCT_FAILURE: same-route login did not consume return route');
    assert.equal(result.calls.some(call => call[0] === 'show-main'), false, 'PRODUCT_FAILURE: same-route login showed the wrong default module before staying put');
    assert.ok(result.calls.some(call => call[0] === 'diagnostic' && call[2]?.redirectReason === 'return-route-current'));
}

async function smokeStaleLoginAfterServiceWorkerAwait(page, origin) {
    await page.navigate(`${origin}/`);
    const result = await page.evaluate(`(async () => {
        ${extractSourceFunction(AUTH_CODE, 'login')}
        const calls = [];
        let releaseServiceWorker;
        const serviceWorkerStarted = new Promise(resolve => {
            window.__markServiceWorkerStarted = resolve;
        });
        let sessionCurrent = true;
        window.AppState = { currentUser: null };
        window.AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';
        window.apiLogin = async () => ({
            accessToken: 'access-a',
            refreshToken: 'refresh-a',
            user: { id: 10, username: 'account.a', role: 'manager' }
        });
        window.rememberAuthSession = data => {
            localStorage.setItem('pzp_access_token', data.accessToken);
            localStorage.setItem('pzp_refresh_token', data.refreshToken);
            localStorage.setItem('pzp_current_user', JSON.stringify(data.user));
            localStorage.setItem('pzp_auth_session_generation', 'generation-a');
            return true;
        };
        window.revokeRefreshTokenValue = token => calls.push(['revoke', token]);
        window.captureAuthBootstrapSession = user => ({ userId: user?.id });
        window.isAuthBootstrapSessionCurrent = () => sessionCurrent;
        window.hydrateBusinessOperatingProfile = async () => {};
        window.hydrateActionPermissions = async () => ({ ok: true });
        window.WorkingRole = { hydrate: () => calls.push(['hydrate-role']) };
        window.registerAuthenticatedServiceWorker = () => {
            window.__markServiceWorkerStarted();
            return new Promise(resolve => { releaseServiceWorker = resolve; });
        };
        window.Sidebar = { initUserCard: () => calls.push(['sidebar']) };
        window.applyAuthReturnRouteAfterLogin = () => {
            calls.push(['apply-return-route']);
            return false;
        };
        window.getAuthenticatedTimelineStartPage = () => '/dashboard';
        window.recordRedirectDiagnostic = (...args) => calls.push(['diagnostic', ...args]);
        window.showMainApp = () => calls.push(['show-main']);
        window.checkDailyLogin = () => calls.push(['daily']);
        window.resetAuthenticatedRuntimeReady = () => calls.push(['reset-runtime']);
        window.showAuthenticatedPageShell = () => calls.push(['show-shell']);
        window.renderAuthSessionBootstrapError = () => calls.push(['auth-error']);
        const pending = login('account.a', 'password');
        await serviceWorkerStarted;
        sessionCurrent = false;
        localStorage.clear();
        window.AppState.currentUser = null;
        releaseServiceWorker(null);
        const loginResult = await pending;
        return {
            loginResult,
            path: location.pathname,
            calls,
            user: window.AppState.currentUser
        };
    })()`);
    assert.equal(result.loginResult.success, true, 'PRODUCT_FAILURE: stale login did not return a controlled result');
    assert.equal(result.loginResult.pending, true, 'PRODUCT_FAILURE: stale login was not marked pending/stale');
    assert.equal(result.path, '/', 'PRODUCT_FAILURE: stale login navigated after session changed');
    assert.equal(result.calls.some(call => call[0] === 'apply-return-route'), false, 'PRODUCT_FAILURE: stale login consumed a return route');
    assert.equal(result.calls.some(call => call[0] === 'sidebar'), false, 'PRODUCT_FAILURE: stale login initialized protected sidebar');
    assert.equal(result.calls.some(call => call[0] === 'show-main'), false, 'PRODUCT_FAILURE: stale login showed protected shell');
    assert.equal(result.user, null, 'PRODUCT_FAILURE: stale login restored an obsolete user');
}

async function main() {
    if (!process.versions.node.startsWith('22.')) {
        throw new Error(`INFRA: Node 22 is required, got ${process.version}`);
    }
    if (typeof WebSocket !== 'function') {
        throw new Error('INFRA: Node WebSocket global is unavailable');
    }
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let chrome = null;
    let page = null;
    const step = name => console.log(`[r10a-recovery-login-ui-browser-smoke] ${name}`);
    try {
        step('launch chrome');
        chrome = await launchChrome();
        page = await createCdpPage(chrome.port);
        step('manual reload exit');
        await smokeRecoveryReloadExit(page, origin);
        step('return route after permission retry');
        await smokeReturnRouteAfterPermissionRetry(page, origin);
        step('same-route login return route');
        await smokeLoginSameReturnRoute(page, origin);
        step('stale login after delayed service worker await');
        await smokeStaleLoginAfterServiceWorkerAwait(page, origin);
        console.log('[r10a-recovery-login-ui-browser-smoke] PASS');
    } finally {
        await page?.close().catch(() => {});
        await stopChrome(chrome);
        await new Promise(resolve => server.close(resolve));
        if (chrome?.userDataDir?.startsWith(CHROME_PROFILE_PREFIX)) {
            try {
                fs.rmSync(chrome.userDataDir, { recursive: true, force: true });
            } catch (error) {
                console.warn(`[r10a-recovery-login-ui-browser-smoke] deferred cleanup for ${chrome.userDataDir}: ${error.message}`);
            }
        }
    }
}

main().catch(error => {
    console.error(`[r10a-recovery-login-ui-browser-smoke] ${error.stack || error.message}`);
    process.exitCode = 1;
});
