#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'browser', 'redirect-regression-gate');
const CHROME_PROFILE_PREFIX = path.join(os.tmpdir(), 'eventgenix-r4-chrome-');
const SW_SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const R4_RUNTIME_CACHE_PREFIX = 'event-genix-v-r4-browser-';
const R4_API_CACHE_PREFIX = 'event-genix-api-v-r4-browser-';
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

function routeToFile(pathname) {
    if (pathname === '/' || pathname === '/index.html') return 'index.html';
    if (pathname === '/sales-funnel' || pathname === '/leads.html') return 'leads.html';
    if (pathname === '/certificates' || pathname.startsWith('/certificates/')) return 'certificates.html';
    return pathname.replace(/^\/+/, '');
}

function send(res, status, contentType, body, extraHeaders = {}) {
    res.writeHead(status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    res.end(body);
}

function createServer() {
    const state = {
        swRevision: 1,
        swRequests: []
    };
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname === '/api/auth/verify') {
                send(res, 200, 'application/json', JSON.stringify({
                    user: { id: 14, username: 'r4.browser', role: 'creator' }
                }));
                return;
            }
            if (url.pathname === '/api/auth/permissions') {
                send(res, 200, 'application/json', JSON.stringify({
                    capabilityCatalog: {
                        pageRoles: {
                            '/': ['creator'],
                            '/sales-funnel': ['creator'],
                            '/certificates': ['creator']
                        },
                        actionRoles: {}
                    },
                    capabilities: {
                        'page:/': { allowed: true },
                        'page:/sales-funnel': { allowed: true },
                        'page:/certificates': { allowed: true }
                    },
                    pageAllowlist: [],
                    actionAllowlist: [],
                    actionDenylist: []
                }));
                return;
            }
            if (url.pathname === '/api/auth/profile' || url.pathname === '/api/permissions/me') {
                send(res, 200, 'application/json', JSON.stringify({
                    user: { id: 14, username: 'r4.browser', role: 'creator' },
                    permissions: { capabilities: {} }
                }));
                return;
            }
            if (url.pathname.startsWith('/api/')) {
                send(res, 200, 'application/json', JSON.stringify({ success: true, data: [], items: [] }));
                return;
            }
            const relative = routeToFile(url.pathname);
            const fullPath = path.resolve(ROOT, relative);
            if (!fullPath.startsWith(ROOT) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
                send(res, 404, 'text/plain; charset=utf-8', 'Not found');
                return;
            }
            const extension = path.extname(fullPath).toLowerCase();
            let body = fs.readFileSync(fullPath);
            if (url.pathname === '/sw.js') {
                state.swRequests.push(state.swRevision);
                body = serviceWorkerRevisionSource(state.swRevision);
            }
            send(res, 200, MIME_TYPES[extension] || 'application/octet-stream', body, {
                ...(url.pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {})
            });
        } catch (error) {
            send(res, 500, 'text/plain; charset=utf-8', error.stack || error.message);
        }
    });
    server.setServiceWorkerRevision = revision => { state.swRevision = revision; };
    server.getServiceWorkerRequests = () => state.swRequests.slice();
    return server;
}

function runtimeCacheNameForRevision(revision) {
    return `${R4_RUNTIME_CACHE_PREFIX}${revision}`;
}

function apiCacheNameForRevision(revision) {
    return `${R4_API_CACHE_PREFIX}${revision}`;
}

function serviceWorkerRevisionSource(revision) {
    return SW_SOURCE
        .replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = '${runtimeCacheNameForRevision(revision)}';`)
        .replace(/const API_CACHE_NAME = '[^']+';/, `const API_CACHE_NAME = '${apiCacheNameForRevision(revision)}';`);
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
    if (!executable) throw new Error('INFRA: Chrome/Edge executable was not found; set CHROME_PATH to run the browser smoke');
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
        this.eventWaiters = [];
        this.serviceWorkerEvents = [];
        this.ws = new WebSocket(wsUrl);
        this.ready = new Promise((resolve, reject) => {
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
        });
        this.ws.addEventListener('message', event => this.handleMessage(event));
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
        if (!message.method) return;
        if (message.method.startsWith('ServiceWorker.')) {
            this.serviceWorkerEvents.push({
                method: message.method,
                params: message.params || {}
            });
            if (this.serviceWorkerEvents.length > 20) this.serviceWorkerEvents.shift();
        }
        for (const waiter of [...this.eventWaiters]) {
            if (waiter.method === message.method && waiter.predicate(message.params || {})) {
                clearTimeout(waiter.timer);
                this.eventWaiters.splice(this.eventWaiters.indexOf(waiter), 1);
                waiter.resolve(message.params || {});
            }
        }
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

    waitForEvent(method, predicate = () => true, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const waiter = {
                method,
                predicate,
                resolve,
                timer: setTimeout(() => {
                    this.eventWaiters.splice(this.eventWaiters.indexOf(waiter), 1);
                    reject(new Error(`CDP timeout waiting for ${method}`));
                }, timeoutMs)
            };
            this.eventWaiters.push(waiter);
        });
    }

    async init() {
        await this.send('Page.enable');
        await this.send('Runtime.enable');
        await this.send('Network.enable');
        await this.send('ServiceWorker.enable').catch(() => {});
        await this.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `(() => {
                function readArray(key) {
                    try { return JSON.parse(sessionStorage.getItem(key) || '[]'); }
                    catch (_) { return []; }
                }
                function append(key, entry) {
                    try {
                        const entries = readArray(key);
                        entries.push({ ...entry, path: location.pathname, at: Date.now() });
                        sessionStorage.setItem(key, JSON.stringify(entries.slice(-30)));
                    } catch (_) {}
                }
                const next = Number(localStorage.getItem('__r4_navigation_probe_count') || 0) + 1;
                localStorage.setItem('__r4_navigation_probe_count', String(next));
                window.__r4_controller_changes = Number(window.__r4_controller_changes || 0);
                navigator.serviceWorker?.addEventListener?.('controllerchange', () => {
                    window.__r4_controller_changes += 1;
                    append('__r4_controller_events', { type: 'controllerchange' });
                });
                window.addEventListener('pageshow', event => {
                    append('__r4_pageshow_events', {
                        type: 'pageshow',
                        persisted: event.persisted === true,
                        trusted: event.isTrusted === true
                    });
                });
                document.addEventListener('visibilitychange', () => {
                    append('__r4_visibility_events', {
                        type: 'visibilitychange',
                        state: document.visibilityState || ''
                    });
                });
                window.addEventListener('beforeunload', () => {
                    try {
                        sessionStorage.setItem('__r4_transition_before_unload', JSON.stringify({
                            path: location.pathname,
                            pageExiting: document.body?.classList?.contains('page-exiting') === true,
                            ariaBusy: document.body?.getAttribute('aria-busy') || null
                        }));
                    } catch (_) {}
                });
            })();`
        });
    }

    async navigate(url, timeoutMs = 15000) {
        await this.send('Page.navigate', { url }, timeoutMs);
        await this.waitForFunction(`document.readyState === 'interactive' || document.readyState === 'complete'`, timeoutMs);
    }

    async reload(timeoutMs = 15000) {
        await this.send('Page.reload', { ignoreCache: false }, timeoutMs);
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
                lastValue = await this.evaluate(`(async () => Boolean(await (${expression})))()`);
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

    async setOffline(offline) {
        await this.send('Network.emulateNetworkConditions', {
            offline: Boolean(offline),
            latency: 0,
            downloadThroughput: offline ? 0 : -1,
            uploadThroughput: offline ? 0 : -1,
            connectionType: offline ? 'none' : 'wifi'
        });
    }

    async clickSelector(selector) {
        return this.evaluate(`(() => {
            const element = document.querySelector(${JSON.stringify(selector)});
            if (!element) return false;
            element.scrollIntoView({ block: 'center', inline: 'center' });
            element.click();
            return true;
        })()`);
    }

    async navigateHistory(delta) {
        const history = await this.send('Page.getNavigationHistory');
        const entry = history.entries?.[history.currentIndex + delta];
        if (!entry) throw new Error(`No browser history entry for delta ${delta}`);
        await this.send('Page.navigateToHistoryEntry', { entryId: entry.id }, 15000);
        await this.waitForFunction(`document.readyState === 'interactive' || document.readyState === 'complete'`, 15000);
    }

    async goBack() {
        await this.navigateHistory(-1);
    }

    async goForward() {
        await this.navigateHistory(1);
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

function storageScript() {
    const entries = {
        pzp_token: 'browser-access',
        pzp_access_token: 'browser-access',
        pzp_refresh_token: 'browser-refresh',
        pzp_auth_session_generation: 'browser-generation',
        pzp_current_user: JSON.stringify({ id: 14, username: 'r4.browser', role: 'creator' })
    };
    return `(() => {
        const entries = ${JSON.stringify(entries)};
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
        return true;
    })()`;
}

async function prepareStorage(page, origin) {
    await page.navigate(`${origin}/index.html`);
    await page.evaluate(storageScript());
}

async function visiblePageProbe(page) {
    const probe = await page.evaluate(`(() => ({
        url: location.href,
        bodyClass: document.body.className,
        shellReady: document.body.classList.contains('shell-ready'),
        pageExiting: document.body.classList.contains('page-exiting'),
        ariaBusy: document.body.getAttribute('aria-busy'),
        mainAppHidden: document.getElementById('mainApp')?.classList.contains('hidden') ?? null,
        mainAppVisibility: (document.getElementById('mainApp') || document.getElementById('main-content'))
            ? getComputedStyle(document.getElementById('mainApp') || document.getElementById('main-content')).visibility
            : null,
        hasTimeline: document.body.classList.contains('timeline-dashboard-page'),
        hasMainContent: Boolean(document.querySelector('#main-content')),
        hasLeadsApp: Boolean(document.querySelector('#main-content #leadsApp')),
        hasCertificatesList: Boolean(document.querySelector('#main-content #certificatesListView')),
        hasOfflineNavigation: document.body.dataset.offlineNavigation === 'true',
        requestedRoute: document.body.dataset.requestedRoute || '',
        unsavedValue: document.getElementById('r4-unsaved-proof')?.value || '',
        navigationProbeCount: Number(localStorage.getItem('__r4_navigation_probe_count') || 0),
        swControlled: Boolean(navigator.serviceWorker.controller),
        controllerChanges: Number(window.__r4_controller_changes || 0),
        controllerEvents: JSON.parse(sessionStorage.getItem('__r4_controller_events') || '[]'),
        pageshowEvents: JSON.parse(sessionStorage.getItem('__r4_pageshow_events') || '[]'),
        visibilityEvents: JSON.parse(sessionStorage.getItem('__r4_visibility_events') || '[]'),
        transitionBeforeUnload: JSON.parse(sessionStorage.getItem('__r4_transition_before_unload') || '{}'),
        runtimeCaches: []
    }))()`);
    const caches = await page.evaluate(`caches.keys().then(names => names.filter(name => name.startsWith('${R4_RUNTIME_CACHE_PREFIX}')).sort())`);
    probe.runtimeCaches = caches;
    return probe;
}

async function assertSyntheticLifecycleRecovery(page, label) {
    await page.evaluate(`(() => {
        document.body.classList.add('authenticated-shell', 'shell-baseline', 'page-exiting');
        document.body.classList.remove('auth-screen', 'shell-ready');
        document.documentElement.classList.remove('shell-ready');
        document.body.setAttribute('aria-busy', 'true');
        const event = new Event('pageshow');
        Object.defineProperty(event, 'persisted', { value: true });
        window.dispatchEvent(event);
        return true;
    })()`);
    let probe = await visiblePageProbe(page);
    assert.equal(probe.pageExiting, false, `PRODUCT_FAILURE: synthetic pageshow recovery kept page-exiting on ${label}: ${JSON.stringify(probe)}`);
    assert.equal(probe.shellReady, true, `PRODUCT_FAILURE: synthetic pageshow recovery did not restore shell-ready on ${label}: ${JSON.stringify(probe)}`);
    assert.equal(probe.ariaBusy, null, `PRODUCT_FAILURE: synthetic pageshow recovery kept aria-busy on ${label}: ${JSON.stringify(probe)}`);
    assert.equal(probe.mainAppVisibility, 'visible', `PRODUCT_FAILURE: synthetic pageshow recovery left shell hidden on ${label}: ${JSON.stringify(probe)}`);

    await page.evaluate(`(() => {
        document.body.classList.add('authenticated-shell', 'shell-baseline', 'page-exiting');
        document.body.classList.remove('auth-screen', 'shell-ready');
        document.documentElement.classList.remove('shell-ready');
        document.body.setAttribute('aria-busy', 'true');
        try {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        } catch (_) {}
        document.dispatchEvent(new Event('visibilitychange'));
        return true;
    })()`);
    probe = await visiblePageProbe(page);
    assert.equal(probe.pageExiting, false, `PRODUCT_FAILURE: synthetic visibility recovery kept page-exiting on ${label}: ${JSON.stringify(probe)}`);
    assert.equal(probe.shellReady, true, `PRODUCT_FAILURE: synthetic visibility recovery did not restore shell-ready on ${label}: ${JSON.stringify(probe)}`);
    assert.equal(probe.ariaBusy, null, `PRODUCT_FAILURE: synthetic visibility recovery kept aria-busy on ${label}: ${JSON.stringify(probe)}`);
    assert.equal(probe.mainAppVisibility, 'visible', `PRODUCT_FAILURE: synthetic visibility recovery left shell hidden on ${label}: ${JSON.stringify(probe)}`);
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
    let secondTab = null;
    const step = name => console.log(`[redirect-regression-gate-browser-smoke] ${name}`);
    try {
        step('launch chrome');
        chrome = await launchChrome();
        page = await createCdpPage(chrome.port);
        secondTab = await createCdpPage(chrome.port);
        step('prepare authenticated storage');
        await prepareStorage(page, origin);
        await prepareStorage(secondTab, origin);
        step('load leads and certificates');
        await page.navigate(`${origin}/sales-funnel`);
        await secondTab.navigate(`${origin}/certificates`);
        const leadsProbe = await visiblePageProbe(page);
        const certificatesProbe = await visiblePageProbe(secondTab);
        assert.equal(leadsProbe.hasLeadsApp, true, `INFRA: /sales-funnel did not load leads.html: ${JSON.stringify(leadsProbe)}`);
        assert.equal(certificatesProbe.hasCertificatesList, true, `INFRA: /certificates did not load certificates.html: ${JSON.stringify(certificatesProbe)}`);

        step('register service worker');
        const registrationProbe = await page.evaluate(`(async () => {
            const registration = await navigator.serviceWorker.register('/sw.js');
            await registration.update().catch(() => null);
            return {
                scope: registration.scope || '',
                installing: Boolean(registration.installing),
                waiting: Boolean(registration.waiting),
                active: Boolean(registration.active)
            };
        })()`, 15000);
        console.log(`[redirect-regression-gate-browser-smoke] registration ${JSON.stringify(registrationProbe)}`);
        assert.equal(Boolean(registrationProbe.scope), true, `INFRA: service worker registration did not return a scope: ${JSON.stringify(registrationProbe)}`);
        try {
            await page.waitForFunction(`(async () => {
                const registration = await navigator.serviceWorker.getRegistration();
                return registration && (registration.installing || registration.waiting || registration.active);
            })()`, 10000);
        } catch (error) {
            throw new Error(`${error.message}; serviceWorkerEvents=${JSON.stringify(page.serviceWorkerEvents)}`);
        }
        await page.reload();
        await secondTab.reload();
        try {
            await page.waitForFunction('navigator.serviceWorker.controller');
            await secondTab.waitForFunction('navigator.serviceWorker.controller');
        } catch (error) {
            const swProbe = await page.evaluate(`(async () => {
                const registrations = await navigator.serviceWorker.getRegistrations();
                return {
                    controller: Boolean(navigator.serviceWorker.controller),
                    registrations: registrations.map(registration => ({
                        scope: registration.scope,
                        installing: registration.installing?.state || '',
                        waiting: registration.waiting?.state || '',
                        active: registration.active?.state || ''
                    }))
                };
            })()`);
            throw new Error(`${error.message}; probe=${JSON.stringify(swProbe)}`);
        }

        step('offline certificates navigation');
        await page.setOffline(true);
        await page.navigate(`${origin}/certificates`);
        await page.waitForFunction(`document.body.dataset.offlineNavigation === 'true'
            || (document.querySelector('#certificatesListView')
                && getComputedStyle(document.getElementById('mainApp') || document.getElementById('main-content')).visibility === 'visible')`);
        const offlineProbe = await visiblePageProbe(page);
        assert.equal(offlineProbe.swControlled, true, `INFRA: service worker did not control offline navigation: ${JSON.stringify(offlineProbe)}`);
        const sameModuleOffline = offlineProbe.hasCertificatesList && offlineProbe.mainAppVisibility === 'visible';
        assert.equal(offlineProbe.hasOfflineNavigation || sameModuleOffline, true, `PRODUCT_FAILURE: offline /certificates must return neutral retry UI or visible Certificates module: ${JSON.stringify(offlineProbe)}`);
        if (offlineProbe.hasOfflineNavigation) {
            assert.equal(offlineProbe.requestedRoute, '/certificates', `PRODUCT_FAILURE: offline retry UI must preserve requested route: ${JSON.stringify(offlineProbe)}`);
        }
        assert.equal(offlineProbe.hasTimeline, false, `PRODUCT_FAILURE: offline /certificates received Timeline shell: ${JSON.stringify(offlineProbe)}`);

        step('reconnect certificates navigation');
        await page.setOffline(false);
        if (offlineProbe.hasOfflineNavigation) {
            await page.evaluate(`document.querySelector('button')?.click(); true`);
        } else {
            await page.reload();
        }
        await page.waitForFunction('document.querySelector("#certificatesListView")');
        const reconnectProbe = await visiblePageProbe(page);
        assert.equal(reconnectProbe.hasCertificatesList, true, `PRODUCT_FAILURE: reconnect did not open requested Certificates module: ${JSON.stringify(reconnectProbe)}`);
        assert.equal(reconnectProbe.hasTimeline, false, `PRODUCT_FAILURE: reconnect opened Timeline instead of Certificates: ${JSON.stringify(reconnectProbe)}`);

        step('back-forward module navigation');
        await page.navigate(`${origin}/sales-funnel`);
        await page.waitForFunction(`document.querySelector('#leadsApp')
            && getComputedStyle(document.getElementById('mainApp') || document.getElementById('main-content')).visibility === 'visible'`);
        await page.waitForFunction(`document.querySelector('.sidebar-links .nav-link[href="/certificates"]')`);
        const clickedCertificateLink = await page.clickSelector('.sidebar-links .nav-link[href="/certificates"]');
        assert.equal(clickedCertificateLink, true, 'INFRA: Certificates sidebar link was not available on Leads page');
        const transitionProof = await page.evaluate(`(() => ({
            path: location.pathname,
            pageExiting: document.body.classList.contains('page-exiting'),
            ariaBusy: document.body.getAttribute('aria-busy')
        }))()`);
        if (transitionProof.path === '/sales-funnel') {
            assert.equal(transitionProof.pageExiting, true, `PRODUCT_FAILURE: sidebar click did not set page-exiting before navigation: ${JSON.stringify(transitionProof)}`);
            assert.equal(transitionProof.ariaBusy, 'true', `PRODUCT_FAILURE: sidebar click did not set aria-busy before navigation: ${JSON.stringify(transitionProof)}`);
        }
        try {
            await page.waitForFunction('location.pathname === "/certificates" && document.querySelector("#certificatesListView")');
        } catch (error) {
            const probe = await visiblePageProbe(page).catch(probeError => ({ probeError: probeError.message }));
            throw new Error(`${error.message}; afterSidebarClick=${JSON.stringify(probe)}`);
        }
        await page.goBack();
        await page.waitForFunction('location.pathname === "/sales-funnel" && document.querySelector("#leadsApp")');
        const backProbe = await visiblePageProbe(page);
        assert.equal(backProbe.hasLeadsApp, true, `PRODUCT_FAILURE: Back did not restore Leads module: ${JSON.stringify(backProbe)}`);
        assert.equal(backProbe.pageExiting, false, `PRODUCT_FAILURE: Back left shell in page-exiting state: ${JSON.stringify(backProbe)}`);
        assert.equal(backProbe.mainAppVisibility, 'visible', `PRODUCT_FAILURE: Back left authenticated shell hidden: ${JSON.stringify(backProbe)}`);
        assert.ok(backProbe.pageshowEvents.some(event => event.path === '/sales-funnel' && event.trusted === true), `INFRA: Back/Forward proof did not capture a real trusted pageshow for Leads: ${JSON.stringify(backProbe)}`);
        await assertSyntheticLifecycleRecovery(page, 'Leads');
        await page.goForward();
        await page.waitForFunction('location.pathname === "/certificates" && document.querySelector("#certificatesListView")');
        const navigationDiagnostics = await page.evaluate(`(() => window.RedirectDiagnostics?.export?.() || null)()`);
        assert.ok(navigationDiagnostics?.entries?.some(entry => entry.event === 'navigation-transition' && entry.targetRoute === '/certificates'), `PRODUCT_FAILURE: sidebar click did not pass through transition diagnostics: ${JSON.stringify(navigationDiagnostics)}`);
        const forwardProbe = await visiblePageProbe(page);
        assert.equal(forwardProbe.hasCertificatesList, true, `PRODUCT_FAILURE: Forward did not restore Certificates module: ${JSON.stringify(forwardProbe)}`);
        assert.equal(forwardProbe.pageExiting, false, `PRODUCT_FAILURE: Forward left shell in page-exiting state: ${JSON.stringify(forwardProbe)}`);
        assert.ok(forwardProbe.pageshowEvents.some(event => event.path === '/certificates' && event.trusted === true), `INFRA: Back/Forward proof did not capture a real trusted pageshow for Certificates: ${JSON.stringify(forwardProbe)}`);

        step('synthetic lifecycle recovery');
        await assertSyntheticLifecycleRecovery(page, 'Certificates');

        step('stale tab service worker update');
        const beforeUpdate = await visiblePageProbe(page);
        const secondBeforeUpdate = await visiblePageProbe(secondTab);
        await page.evaluate(`(() => {
            const proof = document.createElement('textarea');
            proof.id = 'r4-unsaved-proof';
            proof.value = 'unsaved certificate note';
            document.body.appendChild(proof);
            return true;
        })()`);
        const swRequestsBeforeUpdate = server.getServiceWorkerRequests().length;
        server.setServiceWorkerRevision(2);
        await page.evaluate(`(async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            await registration.update();
            return true;
        })()`);
        await page.waitForFunction(`window.__r4_controller_changes > ${beforeUpdate.controllerChanges}`, 15000);
        await secondTab.waitForFunction(`window.__r4_controller_changes > ${secondBeforeUpdate.controllerChanges}`, 15000);
        await page.waitForFunction(`caches.keys().then(names => names.includes('${runtimeCacheNameForRevision(2)}') && !names.includes('${runtimeCacheNameForRevision(1)}'))`, 15000);
        const afterUpdate = await visiblePageProbe(page);
        const secondAfterUpdate = await visiblePageProbe(secondTab);
        assert.ok(server.getServiceWorkerRequests().length > swRequestsBeforeUpdate, 'INFRA: SW update was not requested');
        assert.ok(afterUpdate.controllerChanges > beforeUpdate.controllerChanges, `PRODUCT_FAILURE: primary stale tab did not receive controllerchange: ${JSON.stringify(afterUpdate)}`);
        assert.ok(secondAfterUpdate.controllerChanges > secondBeforeUpdate.controllerChanges, `PRODUCT_FAILURE: second stale tab did not receive controllerchange: ${JSON.stringify(secondAfterUpdate)}`);
        assert.ok(afterUpdate.runtimeCaches.includes(runtimeCacheNameForRevision(2)), `PRODUCT_FAILURE: new SW runtime cache is missing: ${JSON.stringify(afterUpdate)}`);
        assert.equal(afterUpdate.runtimeCaches.includes(runtimeCacheNameForRevision(1)), false, `PRODUCT_FAILURE: old SW runtime cache survived activation: ${JSON.stringify(afterUpdate)}`);
        assert.equal(afterUpdate.navigationProbeCount, beforeUpdate.navigationProbeCount, `PRODUCT_FAILURE: SW update caused a reload loop: ${JSON.stringify(afterUpdate)}`);
        assert.equal(afterUpdate.unsavedValue, 'unsaved certificate note', `PRODUCT_FAILURE: SW update lost unsaved form state: ${JSON.stringify(afterUpdate)}`);
        assert.equal(afterUpdate.hasCertificatesList, true, `PRODUCT_FAILURE: stale tab after SW update left Certificates module: ${JSON.stringify(afterUpdate)}`);
        assert.equal(secondAfterUpdate.hasCertificatesList, true, `PRODUCT_FAILURE: second stale tab left Certificates module after SW update: ${JSON.stringify(secondAfterUpdate)}`);

        step('redirect diagnostics are bounded and redacted');
        const diagnosticsProbe = await page.evaluate(`(() => window.RedirectDiagnostics?.export?.() || null)()`);
        assert.ok(diagnosticsProbe, 'PRODUCT_FAILURE: RedirectDiagnostics export is unavailable in browser');
        const diagnosticEvents = new Set((diagnosticsProbe.entries || []).map(entry => entry.event));
        assert.equal(diagnosticEvents.has('navigation-click'), true, `PRODUCT_FAILURE: diagnostics did not capture sidebar navigation click: ${JSON.stringify(diagnosticsProbe)}`);
        assert.equal(diagnosticEvents.has('navigation-transition'), true, `PRODUCT_FAILURE: diagnostics did not capture sidebar transition: ${JSON.stringify(diagnosticsProbe)}`);
        assert.equal(diagnosticEvents.has('shell-lifecycle'), true, `PRODUCT_FAILURE: diagnostics did not capture lifecycle recovery: ${JSON.stringify(diagnosticsProbe)}`);
        assert.ok((diagnosticsProbe.entries || []).length <= 80, `PRODUCT_FAILURE: diagnostics exceeded entry cap: ${JSON.stringify(diagnosticsProbe)}`);
        const diagnosticsJson = JSON.stringify(diagnosticsProbe);
        ['browser-access', 'browser-refresh', 'data-requested-route', '?', '#'].forEach(fragment => {
            assert.equal(diagnosticsJson.includes(fragment), false, `PRODUCT_FAILURE: diagnostics leaked ${fragment}: ${diagnosticsJson}`);
        });
    } finally {
        await page?.setOffline(false).catch(() => {});
        await page?.close().catch(() => {});
        await secondTab?.close().catch(() => {});
        await stopChrome(chrome);
        await new Promise(resolve => server.close(resolve));
        if (chrome?.userDataDir?.startsWith(CHROME_PROFILE_PREFIX)) {
            try {
                fs.rmSync(chrome.userDataDir, { recursive: true, force: true });
            } catch (error) {
                console.warn(`[redirect-regression-gate-browser-smoke] deferred cleanup for ${chrome.userDataDir}: ${error.message}`);
            }
        }
    }
}

main().catch(error => {
    console.error(`[redirect-regression-gate-browser-smoke] ${error.stack || error.message}`);
    process.exitCode = 1;
});
