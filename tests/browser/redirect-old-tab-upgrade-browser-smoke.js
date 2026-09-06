#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const {
    assertSafeIsolatedTestUrl,
    assertSafeTestDatabaseUrl
} = require('../../scripts/test-db-safety');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_URL = String(process.env.TEST_URL || '').trim().replace(/\/$/, '');
const ENABLED = process.env.RUN_REDIRECT_OLD_TAB_UPGRADE_BROWSER === 'true';
const TIMEOUT_MS = Number(process.env.REDIRECT_OLD_TAB_BROWSER_TIMEOUT_MS) || 120_000;
const PRE_RELEASE_SHA = '9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5';
const RELEASED_SHA = 'd7aed2573d876c7051e96897a835343ed33573d5';
const CURRENT_SHA = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const OUTPUT_DIR = path.join(ROOT, 'output', 'browser', 'redirect-old-tab-upgrade');
const CHROME_PROFILE_PREFIX = path.join(os.tmpdir(), 'eventgenix-r11-chrome-');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

function step(message) {
    process.stdout.write(`[r11-old-tab-upgrade] ${message}\n`);
}

function requireIsolatedTarget() {
    assert.equal(ENABLED, true, 'set RUN_REDIRECT_OLD_TAB_UPGRADE_BROWSER=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(TARGET_URL, 'TEST_URL is required');
    assertSafeIsolatedTestUrl(TARGET_URL);
    assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.ok(process.env.TEST_USER, 'TEST_USER is required');
    assert.ok(process.env.TEST_PASS, 'TEST_PASS is required');
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function routeToFile(pathname) {
    if (pathname === '/' || pathname === '/index.html') return 'index.html';
    if (pathname === '/sales-funnel' || pathname === '/leads.html') return 'leads.html';
    if (pathname === '/certificates' || pathname.startsWith('/certificates/')) return 'certificates.html';
    return pathname.replace(/^\/+/, '') || 'index.html';
}

function normalizeAssetPath(pathname) {
    return routeToFile(pathname).replace(/\\/g, '/');
}

function gitBlob(commit, relativePath) {
    return childProcess.execFileSync('git', ['show', `${commit}:${relativePath}`], {
        cwd: ROOT,
        encoding: 'buffer',
        maxBuffer: 30 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore']
    });
}

function currentBlob(relativePath) {
    const fullPath = path.resolve(ROOT, relativePath);
    if (!fullPath.startsWith(ROOT) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return null;
    return fs.readFileSync(fullPath);
}

function readAsset(source, relativePath) {
    if (!relativePath || relativePath.includes('..')) return null;
    try {
        if (source.kind === 'current') return currentBlob(relativePath);
        if (source.kind === 'future-sw') {
            const current = currentBlob(relativePath);
            if (!current || relativePath !== 'sw.js') return current;
            return Buffer.concat([
                Buffer.from(current),
                Buffer.from(`\n/* r11-future-update-fixture ${source.label} ${source.revision} */\n`)
            ]);
        }
        return gitBlob(source.sha, relativePath);
    } catch {
        return null;
    }
}

function sourceForMode(mode) {
    if (mode === 'pre') return { kind: 'git', sha: PRE_RELEASE_SHA, label: 'pre-release' };
    if (mode === 'released') return { kind: 'git', sha: RELEASED_SHA, label: 'released' };
    if (mode === 'current') return { kind: 'current', sha: CURRENT_SHA, label: 'current-candidate' };
    if (mode === 'future-a') return { kind: 'future-sw', sha: CURRENT_SHA, label: 'future-update-fixture-a', revision: 'a' };
    if (mode === 'future-b') return { kind: 'future-sw', sha: CURRENT_SHA, label: 'future-update-fixture-b', revision: 'b' };
    throw new Error(`unknown source mode: ${mode}`);
}

function assetHashForMode(mode, relativePath) {
    const body = readAsset(sourceForMode(mode), relativePath);
    return body ? sha256(body) : '';
}

function candidateAssetHashes() {
    return {
        headSha: CURRENT_SHA,
        dirtyPorcelain: childProcess.execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim(),
        assets: Object.fromEntries(['sw.js', 'js/api.js', 'js/auth.js', 'js/components/sidebar.js', 'index.html', 'leads.html', 'certificates.html']
            .map(relativePath => [relativePath, assetHashForMode('current', relativePath)]))
    };
}

const R11_BROWSER_PROBE_SCRIPT = `(() => {
    try {
        const state = window.__r11 || {};
        if (!state.documentId) {
            state.documentId = (crypto && typeof crypto.randomUUID === 'function')
                ? crypto.randomUUID()
                : 'r11-doc-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
        }
        state.probeInstalled = true;
        state.probeVersion = 'r11c-document-probe-v1';
        state.installedAt = Date.now();
        state.controllerChanges = Number(state.controllerChanges || 0);
        state.pageshow = Array.isArray(state.pageshow) ? state.pageshow : [];
        state.visibility = Array.isArray(state.visibility) ? state.visibility : [];
        state.events = Array.isArray(state.events) ? state.events : [];
        const pushEvent = (type, extra = {}) => {
            try {
                state.events.push({
                    type,
                    at: Date.now(),
                    path: location.pathname,
                    visibilityState: document.visibilityState || '',
                    hasFocus: document.hasFocus(),
                    controller: navigator.serviceWorker?.controller?.scriptURL || '',
                    ...extra
                });
                state.events = state.events.slice(-80);
            } catch {}
        };
        window.__r11 = state;
        if (!state.listenersInstalled) {
            state.listenersInstalled = true;
            navigator.serviceWorker?.addEventListener?.('controllerchange', () => {
                state.controllerChanges += 1;
                pushEvent('controllerchange', { count: state.controllerChanges });
            });
            window.addEventListener('pageshow', event => {
                const payload = { persisted: event.persisted === true, trusted: event.isTrusted === true, path: location.pathname };
                state.pageshow.push(payload);
                state.pageshow = state.pageshow.slice(-40);
                pushEvent('pageshow', payload);
            });
            document.addEventListener('visibilitychange', () => {
                const payload = { state: document.visibilityState || '', path: location.pathname };
                state.visibility.push(payload);
                state.visibility = state.visibility.slice(-40);
                pushEvent('visibilitychange', payload);
            });
            window.addEventListener('storage', event => {
                if (!event || !/^pzp_(?:auth_session_generation|refresh_token|access_token|token|current_user|auth_transition|auth_refresh_coordination)/.test(String(event.key || ''))) return;
                pushEvent('auth-storage', {
                    key: event.key,
                    oldPresent: event.oldValue != null,
                    newPresent: event.newValue != null,
                    changed: event.oldValue !== event.newValue
                });
            });
        }
        pushEvent('probe-installed', { readyState: document.readyState || '' });
    } catch {}
})();`;

function send(res, status, contentType, body, extraHeaders = {}) {
    res.writeHead(status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    res.end(body);
}

async function readRequestBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

function sanitizeProxyHeaders(headers) {
    const result = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (/^(host|connection|content-length|accept-encoding)$/i.test(key)) continue;
        result[key] = value;
    }
    return result;
}

function createOverlayServer() {
    const sources = {
        pre: { kind: 'git', sha: PRE_RELEASE_SHA, label: 'pre-release' },
        released: { kind: 'git', sha: RELEASED_SHA, label: 'released' },
        current: { kind: 'current', sha: CURRENT_SHA, label: 'current-candidate' },
        'future-a': { kind: 'future-sw', sha: CURRENT_SHA, label: 'future-update-fixture-a', revision: 'a' },
        'future-b': { kind: 'future-sw', sha: CURRENT_SHA, label: 'future-update-fixture-b', revision: 'b' }
    };
    const state = {
        assetMode: 'pre',
        swMode: 'pre',
        served: [],
        nextRefreshFault: null,
        committedRefreshes: []
    };
    let delayedRefresh = null;

    async function proxyApi(req, res, url) {
        const body = await readRequestBody(req);
        const upstream = await fetch(`${TARGET_URL}${url.pathname}${url.search || ''}`, {
            method: req.method,
            headers: sanitizeProxyHeaders(req.headers),
            body: /^(GET|HEAD)$/i.test(req.method) ? undefined : body
        });
        const responseBody = Buffer.from(await upstream.arrayBuffer());
        if (url.pathname === '/api/auth/refresh' && state.nextRefreshFault) {
            const fault = state.nextRefreshFault;
            state.nextRefreshFault = null;
            let parsed = null;
            try { parsed = JSON.parse(responseBody.toString('utf8') || '{}'); } catch {}
            state.committedRefreshes.push({ status: upstream.status, body: parsed, at: Date.now(), fault: fault.mode });
            if (fault.mode === 'lost') {
                res.destroy();
                return;
            }
            if (fault.mode === 'delayed') {
                await new Promise(resolve => { delayedRefresh = resolve; });
            }
        }
        const headers = {};
        upstream.headers.forEach((value, key) => {
            if (!/^(content-encoding|transfer-encoding|connection)$/i.test(key)) headers[key] = value;
        });
        res.writeHead(upstream.status, headers);
        res.end(responseBody);
    }

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname === '/__asset-mode') {
                const mode = url.searchParams.get('mode');
                const sw = url.searchParams.get('sw');
                if (!sources[mode] || (sw && !sources[sw])) return send(res, 400, 'application/json', JSON.stringify({ error: 'bad_mode' }));
                state.assetMode = mode;
                if (sw) state.swMode = sw;
                return send(res, 200, 'application/json', JSON.stringify({ assetMode: state.assetMode, swMode: state.swMode }));
            }
            if (url.pathname === '/__fault/lost-next-refresh') {
                state.nextRefreshFault = { mode: 'lost' };
                return send(res, 204, 'text/plain', '');
            }
            if (url.pathname === '/__fault/delay-next-refresh') {
                state.nextRefreshFault = { mode: 'delayed' };
                return send(res, 204, 'text/plain', '');
            }
            if (url.pathname === '/__fault/release-delayed-refresh') {
                const release = delayedRefresh;
                delayedRefresh = null;
                if (release) release();
                return send(res, 204, 'text/plain', '');
            }
            if (url.pathname === '/__proof') {
                return send(res, 200, 'application/json', JSON.stringify({
                    sources: { pre: PRE_RELEASE_SHA, released: RELEASED_SHA, current: CURRENT_SHA },
                    assetMode: state.assetMode,
                    swMode: state.swMode,
                    served: state.served.slice(-250),
                    committedRefreshes: state.committedRefreshes.slice()
                }));
            }
            if (url.pathname === '/__harness/blank') {
                return send(res, 200, 'text/html; charset=utf-8', '<!doctype html><meta charset="utf-8"><title>R11 harness blank</title><body>R11 harness blank</body>');
            }
            if (url.pathname === '/ws') {
                return send(res, 404, 'text/plain; charset=utf-8', 'websocket disabled in redirect upgrade smoke');
            }
            if (url.pathname.startsWith('/api/')) return proxyApi(req, res, url);

            const source = url.pathname === '/sw.js' ? sources[state.swMode] : sources[state.assetMode];
            const relativePath = normalizeAssetPath(url.pathname);
            const body = readAsset(source, relativePath);
            if (!body) {
                const upstream = await fetch(`${TARGET_URL}${url.pathname}${url.search || ''}`, {
                    method: req.method,
                    headers: sanitizeProxyHeaders(req.headers)
                });
                const upstreamBody = Buffer.from(await upstream.arrayBuffer());
                const headers = {};
                upstream.headers.forEach((value, key) => {
                    if (!/^(content-encoding|transfer-encoding|connection)$/i.test(key)) headers[key] = value;
                });
                res.writeHead(upstream.status, headers);
                res.end(upstreamBody);
                return;
            }
            state.served.push({
                path: relativePath,
                mode: url.pathname === '/sw.js' ? state.swMode : state.assetMode,
                source: source.label,
                sha: source.sha,
                hash: sha256(body),
                at: Date.now()
            });
            send(res, 200, MIME_TYPES[path.extname(relativePath).toLowerCase()] || 'application/octet-stream', body, {
                ...(url.pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {})
            });
        } catch (error) {
            send(res, 500, 'text/plain; charset=utf-8', error.stack || error.message);
        }
    });
    return server;
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

async function launchChrome() {
    const executable = findChromeExecutable();
    if (!executable) throw new Error('BLOCKED: Chrome/Edge executable was not found; set CHROME_PATH');
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
    const port = await waitForDevToolsPort(userDataDir).catch(error => {
        child.kill('SIGTERM');
        throw new Error(`${error.message}\n${stderr.trim()}`);
    });
    return { child, port, userDataDir };
}

async function stopChrome(chrome) {
    if (!chrome?.child) return;
    if (chrome.child.exitCode === null && !chrome.child.killed) {
        const exited = new Promise(resolve => chrome.child.once('exit', resolve));
        chrome.child.kill('SIGTERM');
        await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
    }
    if (chrome.userDataDir?.startsWith(CHROME_PROFILE_PREFIX)) {
        fs.rmSync(chrome.userDataDir, { recursive: true, force: true });
    }
}

class CdpPage {
    constructor(target, port) {
        this.targetId = target.id || '';
        this.chromePort = port;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Map();
        this.lifecycleEvents = [];
        this.frameNavigations = [];
        this.runtimeContexts = [];
        this.serviceWorkerEvents = [];
        this.networkResponses = [];
        this.pageErrors = [];
        this.initScripts = new Map();
        this.ws = new WebSocket(target.webSocketDebuggerUrl);
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
        if (message.method === 'Runtime.consoleAPICalled') {
            const type = message.params?.type || 'log';
            const text = (message.params?.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ');
            this.emit('console', { type, text });
        }
        if (message.method === 'Runtime.exceptionThrown') {
            const detail = message.params?.exceptionDetails || {};
            this.pageErrors.push({ at: Date.now(), detail });
            this.pageErrors = this.pageErrors.slice(-80);
            this.emit('pageerror', detail);
        }
        if (message.method === 'Network.responseReceived') {
            const response = message.params?.response || {};
            this.networkResponses.push({
                at: Date.now(),
                type: message.params?.type || '',
                url: response.url || '',
                status: response.status,
                mimeType: response.mimeType || '',
                fromDiskCache: response.fromDiskCache === true,
                fromServiceWorker: response.fromServiceWorker === true,
                fromPrefetchCache: response.fromPrefetchCache === true
            });
            this.networkResponses = this.networkResponses.slice(-240);
        }
        if (message.method === 'Page.lifecycleEvent') {
            this.lifecycleEvents.push({ at: Date.now(), ...message.params });
            this.lifecycleEvents = this.lifecycleEvents.slice(-200);
        }
        if (message.method === 'Page.frameNavigated') {
            this.frameNavigations.push({ at: Date.now(), frame: message.params?.frame || {} });
            this.frameNavigations = this.frameNavigations.slice(-80);
        }
        if (message.method === 'Runtime.executionContextCreated' || message.method === 'Runtime.executionContextDestroyed' || message.method === 'Runtime.executionContextsCleared') {
            this.runtimeContexts.push({ at: Date.now(), method: message.method, params: message.params || {} });
            this.runtimeContexts = this.runtimeContexts.slice(-120);
        }
        if (String(message.method || '').startsWith('ServiceWorker.')) {
            this.serviceWorkerEvents.push({ at: Date.now(), method: message.method, params: message.params || {} });
            this.serviceWorkerEvents = this.serviceWorkerEvents.slice(-240);
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
        await this.send('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => {});
        await this.send('Emulation.setDeviceMetricsOverride', {
            width: 1440,
            height: 1100,
            deviceScaleFactor: 1,
            mobile: false
        }).catch(() => {});
        await this.send('ServiceWorker.enable').catch(() => {});
    }

    async addInitScript(source) {
        if (!source) return null;
        if (this.initScripts.has(source)) return this.initScripts.get(source);
        const result = await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
        const identifier = result.identifier || '';
        this.initScripts.set(source, identifier);
        return identifier;
    }

    async removeInitScript(sourceOrIdentifier) {
        if (!sourceOrIdentifier) return false;
        const identifier = this.initScripts.get(sourceOrIdentifier) || sourceOrIdentifier;
        if (!identifier) return false;
        await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
        this.initScripts.delete(sourceOrIdentifier);
        for (const [source, storedIdentifier] of this.initScripts.entries()) {
            if (storedIdentifier === identifier) this.initScripts.delete(source);
        }
        return true;
    }

    traceCheckpoint() {
        return {
            lifecycle: this.lifecycleEvents.length,
            frameNavigations: this.frameNavigations.length,
            runtimeContexts: this.runtimeContexts.length,
            serviceWorker: this.serviceWorkerEvents.length,
            networkResponses: this.networkResponses.length,
            pageErrors: this.pageErrors.length
        };
    }

    traceSince(checkpoint = {}) {
        return {
            lifecycle: this.lifecycleEvents.slice(checkpoint.lifecycle || 0),
            frameNavigations: this.frameNavigations.slice(checkpoint.frameNavigations || 0),
            runtimeContexts: this.runtimeContexts.slice(checkpoint.runtimeContexts || 0),
            serviceWorker: this.serviceWorkerEvents.slice(checkpoint.serviceWorker || 0),
            networkResponses: this.networkResponses.slice(checkpoint.networkResponses || 0),
            pageErrors: this.pageErrors.slice(checkpoint.pageErrors || 0)
        };
    }

    async navigate(url, timeoutMs = TIMEOUT_MS) {
        const marker = `r11-nav-${crypto.randomBytes(5).toString('hex')}`;
        await this.evaluate(`window.__r11_document_marker = ${JSON.stringify(marker)}`).catch(() => {});
        await this.send('Page.navigate', { url }, timeoutMs);
        await this.waitForFunction(`(document.readyState === 'interactive' || document.readyState === 'complete') && window.__r11_document_marker !== ${JSON.stringify(marker)}`, timeoutMs);
    }

    async waitForFrameNavigationAfter(previousCount, timeoutMs = TIMEOUT_MS) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (this.frameNavigations.length > previousCount) return this.frameNavigations.at(-1);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error(`Timed out waiting for CDP frame navigation after ${previousCount}`);
    }

    async reload(timeoutMs = TIMEOUT_MS) {
        const previousCount = this.frameNavigations.length;
        await this.send('Page.reload', { ignoreCache: false }, timeoutMs);
        await this.waitForFrameNavigationAfter(previousCount, timeoutMs);
        await this.waitForFunction(`document.readyState === 'interactive' || document.readyState === 'complete'`, timeoutMs);
    }

    async evaluate(expression, timeoutMs = TIMEOUT_MS) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
        if (result.exceptionDetails) throw new Error(`Runtime exception: ${JSON.stringify(result.exceptionDetails)}`);
        return result.result?.value;
    }

    async waitForFunction(expression, timeoutMs = TIMEOUT_MS) {
        const startedAt = Date.now();
        let lastValue;
        let lastError = null;
        while (Date.now() - startedAt < timeoutMs) {
            try {
                lastValue = await this.evaluate(`(async () => Boolean(await (${expression})))()`, 5000);
                lastError = null;
                if (lastValue) return true;
            } catch (error) {
                const message = String(error?.message || error);
                if (!/navigated|Execution context|Cannot find context|CDP timeout for Runtime\.evaluate/i.test(message)) throw error;
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

    async click(selector) {
        return this.evaluate(`(() => {
            const element = document.querySelector(${JSON.stringify(selector)});
            if (!element) return false;
            element.scrollIntoView({ block: 'center', inline: 'center' });
            element.click();
            return true;
        })()`);
    }

    async mouseClickSelector(selector) {
        const rect = await this.evaluate(`(() => {
            const element = document.querySelector(${JSON.stringify(selector)});
            if (!element) return null;
            const box = element.getBoundingClientRect();
            const x = box.left + box.width / 2;
            const y = box.top + box.height / 2;
            const top = document.elementFromPoint(x, y);
            return {
                x,
                y,
                width: box.width,
                height: box.height,
                inViewport: x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight,
                matchesTarget: top === element || Boolean(top && element.contains(top))
            };
        })()`);
        if (!rect || rect.width <= 0 || rect.height <= 0 || !rect.inViewport || !rect.matchesTarget) return false;
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
        return true;
    }

    async mouseClickSidebarHref(href) {
        const rect = await this.evaluate(`(async () => {
            const expectedPath = ${JSON.stringify(href)};
            const findLink = () => Array.from(document.querySelectorAll('.sidebar-links .nav-link[href]')).find((candidate) => {
                try { return new URL(candidate.getAttribute('href'), location.href).pathname === expectedPath; }
                catch { return false; }
            }) || null;
            const scrollCandidates = (link) => {
                const candidates = [
                    link.closest('.sidebar-group-items'),
                    link.closest('.sidebar-links'),
                    link.closest('.sidebar-nav'),
                    document.getElementById('sidebarNav'),
                    document.getElementById('sidebarLinks'),
                    document.scrollingElement || document.documentElement
                ].filter(Boolean);
                let parent = link.parentElement;
                while (parent && parent !== document.body) {
                    const style = getComputedStyle(parent);
                    if (/(auto|scroll|overlay)/.test(style.overflowY || style.overflow || '')) candidates.push(parent);
                    parent = parent.parentElement;
                }
                return Array.from(new Set(candidates));
            };
            const visibility = (link) => {
                if (!link) return null;
                const box = link.getBoundingClientRect();
                const x = box.left + box.width / 2;
                const y = box.top + box.height / 2;
                const top = document.elementFromPoint(x, y);
                const topLink = top?.closest?.('a[href]') || null;
                let topPath = '';
                try { topPath = topLink ? new URL(topLink.getAttribute('href'), location.href).pathname : ''; } catch {}
                return {
                    x,
                    y,
                    width: box.width,
                    height: box.height,
                    inViewport: x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight,
                    matchesTarget: top === link || Boolean(top && link.contains(top)) || topPath === expectedPath,
                    topPath
                };
            };
            for (let attempt = 0; attempt < 8; attempt += 1) {
                const link = findLink();
                if (!link) return null;
                const group = link.closest('.sidebar-group');
                const header = group?.querySelector?.('.sidebar-group-header');
                const items = group?.querySelector?.('.sidebar-group-items');
                if (header && items && !items.classList.contains('open')) header.click();
                link.scrollIntoView({ block: 'center', inline: 'center' });
                const box = link.getBoundingClientRect();
                const deltaY = box.top + box.height / 2 - window.innerHeight / 2;
                for (const container of scrollCandidates(link)) {
                    if (container === document.scrollingElement || container === document.documentElement) {
                        window.scrollBy(0, deltaY);
                    } else if (typeof container.scrollTop === 'number') {
                        container.scrollTop += deltaY;
                    }
                }
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const refreshed = findLink();
                const rect = visibility(refreshed);
                if (rect?.width > 0 && rect.height > 0 && rect.inViewport && rect.matchesTarget) return rect;
            }
            return visibility(findLink());
        })()`);
        if (!rect || rect.width <= 0 || rect.height <= 0 || !rect.inViewport || !rect.matchesTarget) return false;
        await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
        return true;
    }

    async pressEnter() {
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
    }

    async bringToFront() {
        await this.send('Page.bringToFront', {}, 10_000);
        await this.waitForFunction(`document.visibilityState === 'visible'`, 10_000);
    }

    async navigateHistory(delta) {
        const history = await this.send('Page.getNavigationHistory');
        const entry = history.entries?.[history.currentIndex + delta];
        if (!entry) throw new Error(`No browser history entry for delta ${delta}`);
        await this.send('Page.navigateToHistoryEntry', { entryId: entry.id }, TIMEOUT_MS);
        await this.waitForFunction(`document.readyState === 'interactive' || document.readyState === 'complete'`, TIMEOUT_MS);
    }

    async close() {
        if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
        if (this.chromePort && this.targetId) {
            await fetch(`http://127.0.0.1:${this.chromePort}/json/close/${encodeURIComponent(this.targetId)}`).catch(() => {});
        }
    }
}

async function createCdpPage(port, url = 'about:blank') {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`INFRA: unable to create browser tab: ${response.status}`);
    const target = await response.json();
    const page = new CdpPage(target, port);
    await page.init();
    await page.addInitScript(R11_BROWSER_PROBE_SCRIPT);
    page.__chromePort = port;
    return page;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, body };
}

async function overlayControl(origin, pathWithQuery) {
    const response = await fetch(`${origin}${pathWithQuery}`);
    return response.status;
}

async function loginThroughOverlay(origin) {
    const login = await requestJson(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: process.env.TEST_USER, password: process.env.TEST_PASS })
    });
    assert.equal(login.status, 200, `login through overlay failed: ${JSON.stringify(login.body)}`);
    assert.ok(login.body.accessToken && login.body.refreshToken, 'login must return token pair');
    const verify = await requestJson(`${origin}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${login.body.accessToken}` }
    });
    if (verify.status === 200 && verify.body?.user) {
        login.body.user = verify.body.user;
    }
    return login.body;
}

function ensureHarnessSessionGeneration(session) {
    if (!session || typeof session !== 'object') return 'r11-session-missing';
    if (!session.r11SessionGeneration) {
        session.r11SessionGeneration = `r11-session-${crypto.randomBytes(8).toString('hex')}`;
    }
    return session.r11SessionGeneration;
}

function sessionStoragePayload(session) {
    return {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        refreshExpiresAt: session.refreshExpiresAt,
        user: session.user,
        sessionGeneration: ensureHarnessSessionGeneration(session)
    };
}

async function seedBrowserSession(page, session) {
    await page.evaluate(`(({ accessToken, refreshToken, refreshExpiresAt, user, sessionGeneration }) => {
        localStorage.setItem('pzp_token', accessToken);
        localStorage.setItem('pzp_access_token', accessToken);
        localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', refreshExpiresAt);
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_auth_session_generation', sessionGeneration);
        return localStorage.getItem('pzp_auth_session_generation');
    })(${JSON.stringify(sessionStoragePayload(session))})`);
}

async function seedOriginStorageOnce(origin, chromePort, session, label = 'session') {
    const page = await createCdpPage(chromePort);
    try {
        await page.navigate(`${origin}/__harness/blank`);
        await seedBrowserSession(page, session);
        const snapshot = await page.evaluate(`(() => ({
            label: ${JSON.stringify(label)},
            path: location.pathname,
            sessionGeneration: localStorage.getItem('pzp_auth_session_generation') || '',
            hasAccess: Boolean(localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token')),
            hasRefresh: Boolean(localStorage.getItem('pzp_refresh_token')),
            hasUser: Boolean(localStorage.getItem('pzp_current_user'))
        }))()`);
        assert.equal(snapshot.path, '/__harness/blank', `${label}: seed must run on harness blank page`);
        assert.equal(snapshot.sessionGeneration, ensureHarnessSessionGeneration(session), `${label}: seed must use stable generation`);
        assert.equal(snapshot.hasAccess, true, `${label}: seed must store access token`);
        assert.equal(snapshot.hasRefresh, true, `${label}: seed must store refresh token`);
        assert.equal(snapshot.hasUser, true, `${label}: seed must store user`);
        return snapshot;
    } finally {
        await page.close();
    }
}

function buildSessionSeedScript(session) {
    const payload = JSON.stringify(sessionStoragePayload(session));
    return `(() => {
        const session = ${payload};
        try {
            if (!localStorage.getItem('pzp_access_token')) localStorage.setItem('pzp_access_token', session.accessToken);
            if (!localStorage.getItem('pzp_token')) localStorage.setItem('pzp_token', session.accessToken);
            if (!localStorage.getItem('pzp_refresh_token')) localStorage.setItem('pzp_refresh_token', session.refreshToken);
            if (session.refreshExpiresAt && !localStorage.getItem('pzp_refresh_expires_at')) localStorage.setItem('pzp_refresh_expires_at', session.refreshExpiresAt);
            if (!localStorage.getItem('pzp_current_user')) localStorage.setItem('pzp_current_user', JSON.stringify(session.user));
            if (!localStorage.getItem('pzp_auth_session_generation')) localStorage.setItem('pzp_auth_session_generation', session.sessionGeneration);
        } catch (error) {
            window.__r11_session_seed_error = String(error && error.message || error || 'session seed failed');
        }
    })();`;
}

async function installSessionSeedOnNewDocument(page, session) {
    const source = buildSessionSeedScript(session);
    const identifier = await page.addInitScript(source);
    return { source, identifier };
}

async function removeSessionSeedOnNewDocument(page, seedHandle) {
    if (!seedHandle) return false;
    return page.removeInitScript(seedHandle.identifier || seedHandle.source);
}

async function installBrowserProbes(page) {
    await page.addInitScript(R11_BROWSER_PROBE_SCRIPT);
    await page.evaluate(R11_BROWSER_PROBE_SCRIPT);
    const probe = await page.evaluate(`(() => ({
        installed: window.__r11?.probeInstalled === true,
        version: window.__r11?.probeVersion || '',
        documentId: window.__r11?.documentId || '',
        listenerReady: window.__r11?.listenersInstalled === true
    }))()`);
    assert.equal(probe.installed, true, `R11 document probe must be installed: ${JSON.stringify(probe)}`);
    assert.equal(probe.listenerReady, true, `R11 document probe listeners must be installed: ${JSON.stringify(probe)}`);
    return probe;
}

async function assertBrowserProbeInstalled(page, label) {
    const probe = await page.evaluate(`(() => ({
        installed: window.__r11?.probeInstalled === true,
        version: window.__r11?.probeVersion || '',
        documentId: window.__r11?.documentId || '',
        listenerReady: window.__r11?.listenersInstalled === true,
        path: location.pathname,
        readyState: document.readyState
    }))()`);
    assert.equal(probe.installed, true, `${label}: R11 document probe missing after navigation: ${JSON.stringify(probe)}`);
    assert.equal(probe.listenerReady, true, `${label}: R11 document probe listeners missing after navigation: ${JSON.stringify(probe)}`);
    return probe;
}

async function pageProbe(page) {
    return page.evaluate(`(() => ({
        url: location.href,
        path: location.pathname,
        title: document.title,
        hasApiRefresh: typeof window.apiRefreshAuthSession === 'function',
        bodyClass: document.body?.className || '',
        hasTimeline: Boolean(document.querySelector('#timelineDate, #timelineLines, #bookingForm')) || document.body.classList.contains('timeline-dashboard-page'),
        hasLeads: Boolean(document.querySelector('#leadsApp, #leadsTableBody, #leadsKanbanLayout')),
        hasCertificateAnchors: Boolean(document.querySelector('#certificatesListView, #certificatePageTitle, #certPageList')),
        hasCertificates: Boolean(document.querySelector('#certificatesListView, #certificatePageTitle, #certPageList'))
            || (location.pathname.startsWith('/certificates') && document.body.classList.contains('certificates-page') && /Сертифікати/.test(document.title || '')),
        hasUpdatePrompt: Boolean(document.querySelector('#authServiceWorkerUpdatePrompt [data-auth-sw-update-prompt]')),
        loginVisible: Boolean((document.getElementById('loginScreen') || document.getElementById('loginOverlay')) && !(document.getElementById('loginScreen') || document.getElementById('loginOverlay')).classList.contains('hidden')),
        shellVisible: (() => {
            const shell = document.getElementById('mainApp') || document.getElementById('main-content');
            if (!shell) return false;
            return !shell.classList.contains('hidden') && getComputedStyle(shell).visibility !== 'hidden';
        })(),
        currentUser: Boolean(localStorage.getItem('pzp_current_user')),
        accessToken: Boolean(localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token')),
        refreshToken: Boolean(localStorage.getItem('pzp_refresh_token')),
        probeInstalled: window.__r11?.probeInstalled === true,
        probeVersion: window.__r11?.probeVersion || '',
        documentId: window.__r11?.documentId || '',
        r11Events: window.__r11?.events || [],
        controllerScript: navigator.serviceWorker?.controller?.scriptURL || '',
        controllerChanges: window.__r11?.controllerChanges || 0,
        pageshow: window.__r11?.pageshow || [],
        visibility: window.__r11?.visibility || [],
        unsavedValue: document.getElementById('r11-unsaved-proof')?.value || '',
        routeIntent: localStorage.getItem('pzp_auth_return_route_v1'),
        sessionGeneration: localStorage.getItem('pzp_auth_session_generation') || '',
        authStorageEvents: (window.__r11?.events || []).filter(event => event.type === 'auth-storage').slice(-20)
    }))()`);
}

async function safePageProbe(page, label, timeoutMs = 2_000) {
    try {
        return await page.evaluate(`(() => ({
            label: ${JSON.stringify(label)},
            url: location.href,
            path: location.pathname,
            readyState: document.readyState || '',
            visibilityState: document.visibilityState || '',
            hasFocus: document.hasFocus(),
            bodyClass: document.body?.className || '',
            shellVisible: (() => {
                const shell = document.getElementById('mainApp') || document.getElementById('main-content');
                if (!shell) return false;
                return !shell.classList.contains('hidden') && getComputedStyle(shell).visibility !== 'hidden';
            })(),
            loginVisible: Boolean((document.getElementById('loginScreen') || document.getElementById('loginOverlay')) && !(document.getElementById('loginScreen') || document.getElementById('loginOverlay')).classList.contains('hidden')),
            hasTimeline: Boolean(document.querySelector('#timelineDate, #timelineLines, #bookingForm')) || document.body.classList.contains('timeline-dashboard-page'),
            hasLeads: Boolean(document.querySelector('#leadsApp, #leadsTableBody, #leadsKanbanLayout')),
            hasCertificates: Boolean(document.querySelector('#certificatesListView, #certificatePageTitle, #certPageList'))
                || (location.pathname.startsWith('/certificates') && document.body.classList.contains('certificates-page') && /Сертифікати/.test(document.title || '')),
            accessToken: Boolean(localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token')),
            refreshToken: Boolean(localStorage.getItem('pzp_refresh_token')),
            currentUser: Boolean(localStorage.getItem('pzp_current_user')),
            sessionGeneration: localStorage.getItem('pzp_auth_session_generation') || '',
            probeInstalled: window.__r11?.probeInstalled === true,
            documentId: window.__r11?.documentId || '',
            authStorageEvents: (window.__r11?.events || []).filter(event => event.type === 'auth-storage').slice(-20),
            controllerScript: navigator.serviceWorker?.controller?.scriptURL || ''
        }))()`, timeoutMs);
    } catch (error) {
        return {
            label,
            probeError: String(error?.message || error),
            trace: page.traceSince({})
        };
    }
}

async function collectFrontendIdentity(page, origin, label) {
    const runtime = await page.evaluate(`(() => ({
        label: ${JSON.stringify(label)},
        url: location.href,
        path: location.pathname,
        readyState: document.readyState,
        apiRefreshAuthSessionType: typeof window.apiRefreshAuthSession,
        apiVerifyTokenType: typeof window.apiVerifyToken,
        serviceWorkerUpdatePromptType: typeof window.renderAuthenticatedServiceWorkerUpdatePrompt,
        scripts: Array.from(document.scripts || [])
            .map(script => ({
                src: script.src || '',
                type: script.type || 'classic',
                defer: script.defer === true,
                async: script.async === true
            }))
            .filter(script => /(?:^|\\/)js\\/(?:api|auth)\\.js(?:\\?|$)/.test(script.src)),
        resources: performance.getEntriesByType('resource')
            .filter(entry => /(?:^|\\/)js\\/(?:api|auth)\\.js(?:\\?|$)/.test(entry.name)
                || /(?:^|\\/)sw\\.js(?:\\?|$)/.test(entry.name))
            .map(entry => ({
                name: entry.name,
                initiatorType: entry.initiatorType,
                transferSize: entry.transferSize,
                encodedBodySize: entry.encodedBodySize,
                decodedBodySize: entry.decodedBodySize
            }))
    }))()`);
    const proof = await requestJson(`${origin}/__proof`).catch(error => ({ status: 0, body: { error: String(error?.message || error) } }));
    const served = Array.isArray(proof.body?.served) ? proof.body.served : [];
    return {
        label,
        runtime,
        served: served
            .filter(entry => ['js/api.js', 'js/auth.js', 'sw.js', 'index.html', 'leads.html', 'certificates.html'].includes(entry.path))
            .slice(-100),
        network: page.networkResponses
            .filter(entry => {
                try {
                    const parsed = new URL(entry.url, origin);
                    return /^(?:\/js\/api\.js|\/js\/auth\.js|\/sw\.js)$/.test(parsed.pathname);
                } catch {
                    return false;
                }
            })
            .slice(-100),
        pageErrors: page.pageErrors.slice(-30)
    };
}

function createTestDbPool() {
    const testDb = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 2,
        connectionTimeoutMillis: 10_000
    });
}

async function readRefreshChain(refreshToken) {
    const pool = createTestDbPool();
    try {
        const tokenHash = sha256(Buffer.from(String(refreshToken || ''), 'utf8'));
        const result = await pool.query(
            `WITH RECURSIVE chain AS (
                SELECT id, user_id, revoked_at, replaced_by, created_at, expires_at, 0 AS depth
                  FROM refresh_tokens
                 WHERE token_hash = $1
                UNION ALL
                SELECT rt.id, rt.user_id, rt.revoked_at, rt.replaced_by, rt.created_at, rt.expires_at, chain.depth + 1
                  FROM refresh_tokens rt
                  JOIN chain ON rt.id = chain.replaced_by
                 WHERE chain.depth < 8
             )
             SELECT id, user_id, revoked_at IS NOT NULL AS revoked, replaced_by,
                    created_at::text AS created_at, expires_at::text AS expires_at, depth
               FROM chain
              ORDER BY depth`,
            [tokenHash]
        );
        return result.rows.map(row => ({
            id: Number(row.id),
            userId: Number(row.user_id),
            revoked: row.revoked === true,
            replacedBy: row.replaced_by == null ? null : Number(row.replaced_by),
            depth: Number(row.depth),
            createdAt: row.created_at,
            expiresAt: row.expires_at
        }));
    } finally {
        await pool.end();
    }
}

async function storedSessionSnapshot(page) {
    return page.evaluate(`(() => ({
        accessPresent: Boolean(localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token')),
        refreshPresent: Boolean(localStorage.getItem('pzp_refresh_token')),
        refreshChangedFromInitial: Boolean(window.__r11_initial_refresh_token && localStorage.getItem('pzp_refresh_token') && localStorage.getItem('pzp_refresh_token') !== window.__r11_initial_refresh_token),
        userPresent: Boolean(localStorage.getItem('pzp_current_user')),
        sessionGeneration: localStorage.getItem('pzp_auth_session_generation') || '',
        failure: localStorage.getItem('pzp_auth_session_failure') || ''
    }))()`);
}

async function invokeRefreshAndVerify(page) {
    return page.evaluate(`(async () => {
        const beforeRefresh = localStorage.getItem('pzp_refresh_token') || '';
        try {
            const result = await window.apiRefreshAuthSession();
            const access = localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token') || '';
            const afterRefresh = localStorage.getItem('pzp_refresh_token') || '';
            let verifyStatus = null;
            if (access) {
                verifyStatus = await fetch('/api/auth/verify', {
                    headers: { Authorization: 'Bearer ' + access }
                }).then(response => response.status).catch(() => 0);
            }
            return {
                threw: false,
                outcome: result?.outcome || '',
                retryable: result?.retryable === true,
                reason: result?.reason || '',
                hasAccessToken: Boolean(result?.accessToken),
                storageAccessPresent: Boolean(access),
                storageRefreshPresent: Boolean(afterRefresh),
                storageRefreshChanged: Boolean(beforeRefresh && afterRefresh && beforeRefresh !== afterRefresh),
                verifyStatus
            };
        } catch (error) {
            return {
                threw: true,
                name: error.name || '',
                code: error.code || '',
                message: String(error.message || ''),
                retryLater: error.authSessionRetryLater === true,
                storage: {
                    accessPresent: Boolean(localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token')),
                    refreshPresent: Boolean(localStorage.getItem('pzp_refresh_token')),
                    userPresent: Boolean(localStorage.getItem('pzp_current_user'))
                }
            };
        }
    })()`, 45_000);
}

async function runLostCommittedRefreshCase({ origin, chromePort, delayMs, label, expected }) {
    const page = await createCdpPage(chromePort);
    try {
        const session = await loginThroughOverlay(origin);
        const seed = await seedOriginStorageOnce(origin, chromePort, session, `${label}-initial-seed`);
        await page.navigate(`${origin}/certificates`);
        await page.bringToFront();
        await installBrowserProbes(page);
        await waitForModule(page, 'certificates');
        await page.evaluate(`window.__r11_initial_refresh_token = localStorage.getItem('pzp_refresh_token') || ''`);
        const initialRefresh = session.refreshToken;
        const beforeChain = await readRefreshChain(initialRefresh);

        await overlayControl(origin, '/__fault/lost-next-refresh');
        const lostResult = await invokeRefreshAndVerify(page);
        const storageAfterLost = await storedSessionSnapshot(page);
        const proofAfterLost = await requestJson(`${origin}/__proof`);
        const committed = (proofAfterLost.body.committedRefreshes || []).at(-1);
        assert.equal(committed?.status, 200, `${label}: first lost refresh must be committed by server before recovery attempt`);
        assert.ok(committed?.body?.accessToken && committed?.body?.refreshToken, `${label}: committed refresh must include a new token pair before response is lost`);
        const autoRecoveredFirstCall = lostResult?.outcome === 'success'
            && storageAfterLost.refreshChangedFromInitial === true
            && lostResult.verifyStatus === 200;
        const committedAt = Number(committed.at || Date.now());
        const remainingWait = Math.max(0, delayMs - (Date.now() - committedAt));
        if (remainingWait > 0) await new Promise(resolve => setTimeout(resolve, remainingWait));
        const elapsedFromCommitMs = Date.now() - committedAt;
        const retryResult = await invokeRefreshAndVerify(page);
        const afterChain = await readRefreshChain(initialRefresh);
        const storage = await storedSessionSnapshot(page);
        const evidence = {
            label,
            delayMs,
            expected,
            elapsedFromCommitMs,
            classification: autoRecoveredFirstCall ? 'frontend-auto-recovered-first-lost-response' : 'stale-token-retry-after-lost-response',
            lostResult,
            storageAfterLost,
            retryResult,
            storage,
            committed: {
                status: committed.status,
                recovered: committed.body?.recovered === true,
                hasAccessToken: Boolean(committed.body?.accessToken),
                hasRefreshToken: Boolean(committed.body?.refreshToken),
                sessionTokenId: committed.body?.sessionTokenId || null,
                at: committed.at
            },
            beforeChain,
            afterChain,
            frontendIdentity: await collectFrontendIdentity(page, origin, `lost-refresh-${label}`)
        };
        evidence.artifactPath = await writeJsonArtifact(`r11-lost-refresh-${label}-evidence.json`, evidence);

        if (autoRecoveredFirstCall) {
            assert.equal(lostResult.hasAccessToken, true, `${label}: frontend auto-recovery must return access token: ${JSON.stringify(lostResult)}`);
            assert.equal(lostResult.storageRefreshPresent, true, `${label}: frontend auto-recovery must keep refresh storage: ${JSON.stringify(lostResult)}`);
            assert.equal(lostResult.storageRefreshChanged, true, `${label}: frontend auto-recovery must rotate refresh storage: ${JSON.stringify(lostResult)}`);
            assert.equal(lostResult.verifyStatus, 200, `${label}: frontend auto-recovered access token must verify`);
        } else if (expected === 'duplicate-grace') {
            assert.equal(retryResult.outcome, 'success', `${label}: duplicate grace must return usable success under the server grace contract: ${JSON.stringify(retryResult)}`);
            assert.equal(retryResult.hasAccessToken, true, `${label}: duplicate grace success must return access token`);
            assert.equal(retryResult.storageRefreshPresent, true, `${label}: duplicate grace must preserve/store refresh storage`);
            assert.equal(retryResult.storageRefreshChanged, true, `${label}: duplicate grace success must replace stale refresh token`);
            assert.equal(retryResult.verifyStatus, 200, `${label}: duplicate grace access token must verify`);
        } else if (expected === 'recovery') {
            assert.equal(retryResult.outcome, 'success', `${label}: recovery window must resolve with success outcome: ${JSON.stringify(retryResult)}`);
            assert.equal(retryResult.hasAccessToken, true, `${label}: recovery success must return access token`);
            assert.equal(retryResult.storageRefreshPresent, true, `${label}: recovery success must store refresh token`);
            assert.equal(retryResult.storageRefreshChanged, true, `${label}: recovery success must replace stale refresh token`);
            assert.equal(retryResult.verifyStatus, 200, `${label}: server must accept recovered access token`);
        } else if (expected === 'terminal' && retryResult.outcome === 'success') {
            const failurePath = await writeJsonArtifact(`r11-lost-refresh-${label}-product-failure.json`, {
                classification: 'product-failure-backend-recovery-window-or-proof-reuse',
                note: 'Stale browser refresh token replay after the configured 30s recovery window returned success. This is R10B backend/replay scope, not an R11D harness fix.',
                evidence
            });
            throw new assert.AssertionError({
                message: `${label}: post-window stale replay silently recovered after ${elapsedFromCommitMs}ms from committed rotation; evidence=${failurePath}`,
                actual: retryResult.outcome,
                expected: 'non-success terminal auth result',
                operator: 'notStrictEqual'
            });
        }

        return evidence;
    } finally {
        await page.close();
    }
}

function assertRefreshOutcomeUsableOrControlled(result, label) {
    const usable = result?.outcome === 'success'
        && result.hasAccessToken === true
        && result.storageRefreshPresent === true
        && result.verifyStatus === 200;
    const supersededByUsableStorage = result?.outcome === 'superseded'
        && result.storageAccessPresent === true
        && result.storageRefreshPresent === true
        && result.verifyStatus === 200;
    const controlledRetryLater = result?.outcome === 'retry-later'
        && result.retryable === true
        && result.storageRefreshPresent === true;
    assert.equal(
        usable || supersededByUsableStorage || controlledRetryLater,
        true,
        `${label}: refresh result must be usable, superseded by usable storage, or controlled retry-later: ${JSON.stringify(result)}`
    );
}

async function runTwoCertificatesBootstrapControl({ origin, chromePort }) {
    const pageA = await createCdpPage(chromePort);
    const pageB = await createCdpPage(chromePort);
    try {
        const session = await loginThroughOverlay(origin);
        const seed = await seedOriginStorageOnce(origin, chromePort, session, 'two-certificates-control-seed');
        const passes = [];
        await pageA.navigate(`${origin}/certificates`);
        await pageA.bringToFront();
        await installBrowserProbes(pageA);
        await waitForModule(pageA, 'certificates');
        await pageB.navigate(`${origin}/certificates`);
        await pageB.bringToFront();
        await installBrowserProbes(pageB);
        await waitForModule(pageB, 'certificates');
        const expectedGeneration = seed.sessionGeneration;
        for (let index = 0; index < 3; index += 1) {
            if (index > 0) {
                await pageA.reload();
                await installBrowserProbes(pageA);
                await pageB.reload();
                await installBrowserProbes(pageB);
            }
            const pageAProbe = await waitForModule(pageA, 'certificates');
            const pageBProbe = await waitForModule(pageB, 'certificates');
            const pageAStorage = await storedSessionSnapshot(pageA);
            const pageBStorage = await storedSessionSnapshot(pageB);
            const sensitivePageAEvents = pageAProbe.authStorageEvents.filter(event => event.key !== 'pzp_current_user');
            const sensitivePageBEvents = pageBProbe.authStorageEvents.filter(event => event.key !== 'pzp_current_user');
            assert.equal(pageAStorage.sessionGeneration, expectedGeneration, `control pass ${index}: pageA generation changed without auth operation`);
            assert.equal(pageBStorage.sessionGeneration, expectedGeneration, `control pass ${index}: pageB generation changed without auth operation`);
            assert.equal(pageAProbe.shellVisible, true, `control pass ${index}: pageA shell must be visible`);
            assert.equal(pageBProbe.shellVisible, true, `control pass ${index}: pageB shell must be visible`);
            assert.equal(sensitivePageAEvents.length, 0, `control pass ${index}: pageA must not observe token/generation auth storage churn: ${JSON.stringify(pageAProbe.authStorageEvents)}`);
            assert.equal(sensitivePageBEvents.length, 0, `control pass ${index}: pageB must not observe token/generation auth storage churn: ${JSON.stringify(pageBProbe.authStorageEvents)}`);
            passes.push({
                index,
                pageA: pageAProbe,
                pageB: pageBProbe,
                pageAStorage,
                pageBStorage,
                benignCurrentUserRewrites: {
                    pageA: pageAProbe.authStorageEvents.filter(event => event.key === 'pzp_current_user'),
                    pageB: pageBProbe.authStorageEvents.filter(event => event.key === 'pzp_current_user')
                }
            });
        }
        return {
            seed,
            passes,
            pageAIdentity: await collectFrontendIdentity(pageA, origin, 'two-certificates-control-page-a'),
            pageBIdentity: await collectFrontendIdentity(pageB, origin, 'two-certificates-control-page-b')
        };
    } finally {
        await pageA.close();
        await pageB.close();
    }
}

async function runDelayedConcurrentRefreshCase({ origin, chromePort }) {
    const pageA = await createCdpPage(chromePort);
    const pageB = await createCdpPage(chromePort);
    try {
        const session = await loginThroughOverlay(origin);
        const seed = await seedOriginStorageOnce(origin, chromePort, session, 'delayed-concurrent-initial-seed');
        await pageA.navigate(`${origin}/certificates`);
        await pageA.bringToFront();
        await installBrowserProbes(pageA);
        await waitForModule(pageA, 'certificates');
        const shared = await pageA.evaluate(`JSON.stringify({
            accessToken: localStorage.getItem('pzp_access_token') || localStorage.getItem('pzp_token'),
            refreshToken: localStorage.getItem('pzp_refresh_token'),
            refreshExpiresAt: localStorage.getItem('pzp_refresh_expires_at'),
            user: JSON.parse(localStorage.getItem('pzp_current_user') || 'null'),
            sessionGeneration: localStorage.getItem('pzp_auth_session_generation') || ''
        })`);
        await pageB.navigate(`${origin}/certificates`);
        await pageB.bringToFront();
        await installBrowserProbes(pageB);
        await waitForModule(pageB, 'certificates');

        await overlayControl(origin, '/__fault/delay-next-refresh');
        const delayedPromise = invokeRefreshAndVerify(pageA);
        await new Promise(resolve => setTimeout(resolve, 300));
        const parallelPromise = invokeRefreshAndVerify(pageB);
        await new Promise(resolve => setTimeout(resolve, 500));
        await overlayControl(origin, '/__fault/release-delayed-refresh');
        const [delayedResult, parallelResult] = await Promise.all([delayedPromise, parallelPromise]);
        assertRefreshOutcomeUsableOrControlled(delayedResult, 'delayed first tab');
        assertRefreshOutcomeUsableOrControlled(parallelResult, 'parallel second tab');
        return {
            delayedResult,
            parallelResult,
            pageAStorage: await storedSessionSnapshot(pageA),
            pageBStorage: await storedSessionSnapshot(pageB),
            committedRefreshes: (await requestJson(`${origin}/__proof`)).body.committedRefreshes,
            pageAIdentity: await collectFrontendIdentity(pageA, origin, 'delayed-refresh-page-a'),
            pageBIdentity: await collectFrontendIdentity(pageB, origin, 'delayed-refresh-page-b')
        };
    } finally {
        await pageA.close();
        await pageB.close();
    }
}

async function waitForModule(page, moduleName) {
    const moduleExpression = moduleName === 'timeline'
        ? `(document.querySelector('#timelineDate, #timelineLines, #bookingForm') || document.body.classList.contains('timeline-dashboard-page'))`
        : moduleName === 'leads'
            ? `document.querySelector('#leadsApp, #leadsTableBody, #leadsKanbanLayout')`
            : `(document.querySelector('#certificatesListView, #certificatePageTitle, #certPageList')
                || (location.pathname.startsWith('/certificates') && document.body.classList.contains('certificates-page') && /Сертифікати/.test(document.title || '')))`;
    try {
        await page.waitForFunction(`(() => {
            const shell = document.getElementById('mainApp') || document.getElementById('main-content');
            const login = document.getElementById('loginScreen') || document.getElementById('loginOverlay');
            const shellVisible = Boolean(shell && !shell.classList.contains('hidden') && getComputedStyle(shell).visibility !== 'hidden');
            const loginVisible = Boolean(login && !login.classList.contains('hidden'));
            return Boolean(${moduleExpression})
                && location.pathname === ${JSON.stringify(moduleName === 'timeline' ? '/' : moduleName === 'leads' ? '/sales-funnel' : '/certificates')}
                && (document.readyState === 'interactive' || document.readyState === 'complete')
                && typeof window.apiRefreshAuthSession === 'function'
                && shellVisible
                && !loginVisible
                && Boolean(localStorage.getItem('pzp_current_user'))
                && Boolean(localStorage.getItem('pzp_refresh_token'));
        })()`, TIMEOUT_MS);
    } catch (error) {
        const probe = await safePageProbe(page, `${moduleName}-wait-timeout`);
        throw new Error(`${moduleName}: timed out waiting for authenticated module bootstrap; probe=${JSON.stringify(probe)}; cause=${error.message}`);
    }
    await assertBrowserProbeInstalled(page, moduleName);
    const probe = await pageProbe(page);
    assert.equal(probe.probeInstalled, true, `${moduleName}: observer must survive navigation: ${JSON.stringify(probe)}`);
    assert.ok(probe.documentId, `${moduleName}: observer must expose document identity: ${JSON.stringify(probe)}`);
    assert.equal(probe.loginVisible, false, `${moduleName}: must not show login after authenticated navigation: ${JSON.stringify(probe)}`);
    assert.equal(probe.shellVisible, true, `${moduleName}: authenticated shell must be visible after bootstrap: ${JSON.stringify(probe)}`);
    assert.equal(probe.currentUser, true, `${moduleName}: must keep user storage: ${JSON.stringify(probe)}`);
    assert.equal(probe.refreshToken, true, `${moduleName}: must keep refresh token: ${JSON.stringify(probe)}`);
    assert.equal(/\bpage-exiting\b/.test(probe.bodyClass), false, `${moduleName}: page-exiting must clear after module bootstrap: ${JSON.stringify(probe)}`);
    if (moduleName === 'leads') assert.equal(probe.hasTimeline, false, `Leads must not be substituted by Timeline: ${JSON.stringify(probe)}`);
    if (moduleName === 'certificates') assert.equal(probe.hasTimeline, false, `Certificates must not be substituted by Timeline: ${JSON.stringify(probe)}`);
    return probe;
}

async function collectSidebarClickReadiness(page, href) {
    const initial = await page.evaluate(`(() => {
        const link = Array.from(document.querySelectorAll('.sidebar-links .nav-link[href]')).find((candidate) => {
            try { return new URL(candidate.getAttribute('href'), location.href).pathname === ${JSON.stringify(href)}; }
            catch { return false; }
        });
        const box = link?.getBoundingClientRect?.();
        const center = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
        let elementAtPoint = null;
        if (center) {
            const element = document.elementFromPoint(center.x, center.y);
            elementAtPoint = element ? {
                tag: element.tagName,
                href: element.closest?.('a[href]')?.getAttribute?.('href') || '',
                text: element.textContent?.trim?.().slice?.(0, 80) || '',
                matchesTarget: (() => { const anchor = element.closest?.('a[href]'); try { return element === link || link.contains(element) || (anchor && new URL(anchor.getAttribute('href'), location.href).pathname === ${JSON.stringify(href)}); } catch { return false; } })()
            } : null;
        }
        window.__r11_sidebar_readiness_counter = Number(window.__r11_sidebar_readiness_counter || 0);
        const beforeRafCounter = window.__r11_sidebar_readiness_counter;
        let rafScheduled = false;
        let rafError = '';
        try {
            requestAnimationFrame(() => {
                window.__r11_sidebar_readiness_counter = Number(window.__r11_sidebar_readiness_counter || 0) + 1;
            });
            rafScheduled = true;
        } catch (error) {
            rafError = String(error?.message || error);
        }
        return {
            visibilityState: document.visibilityState || '',
            hasFocus: document.hasFocus(),
            viewport: { width: innerWidth, height: innerHeight },
            link: link ? {
                href: link.getAttribute('href') || '',
                text: link.textContent?.trim?.().slice?.(0, 80) || '',
                rect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
            } : null,
            elementAtPoint,
            rafScheduled,
            beforeRafCounter,
            rafError,
            bodyClass: document.body?.className || ''
        };
    })()`, 2_000);
    await new Promise(resolve => setTimeout(resolve, 200));
    const after = await page.evaluate(`(() => ({
        afterRafCounter: Number(window.__r11_sidebar_readiness_counter || 0)
    }))()`, 2_000).catch(error => ({
        afterRafError: String(error?.message || error)
    }));
    return {
        ...initial,
        ...after,
        rafRan: Number(after.afterRafCounter || 0) > Number(initial.beforeRafCounter || 0)
    };
}

async function captureSidebarDebug(page, href, readiness) {
    return page.evaluate(`(() => {
        const link = Array.from(document.querySelectorAll('.sidebar-links .nav-link[href]')).find((candidate) => {
            try { return new URL(candidate.getAttribute('href'), location.href).pathname === ${JSON.stringify(href)}; }
            catch { return false; }
        });
        const box = link?.getBoundingClientRect?.();
        const style = link ? getComputedStyle(link) : null;
        return {
            path: location.pathname,
            href: link?.getAttribute?.('href') || '',
            text: link?.textContent?.trim?.() || '',
            outer: link?.outerHTML?.slice?.(0, 400) || '',
            display: style?.display || '',
            visibility: style?.visibility || '',
            pointerEvents: style?.pointerEvents || '',
            rect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
            shellVisible: (() => {
                const shell = document.getElementById('mainApp') || document.getElementById('main-content');
                return Boolean(shell && !shell.classList.contains('hidden') && getComputedStyle(shell).visibility !== 'hidden');
            })(),
            bodyClass: document.body?.className || '',
            readiness: ${JSON.stringify(readiness)},
            links: Array.from(document.querySelectorAll('.sidebar-links .nav-link[href]')).map(a => a.getAttribute('href')).slice(0, 30)
        };
    })()`);
}

async function attemptSidebarClick(page, href, options = {}) {
    if (options.bringToFront !== false) await page.bringToFront();
    await page.waitForFunction(`Array.from(document.querySelectorAll('.sidebar-links .nav-link[href]')).some(link => {
        try { return new URL(link.getAttribute('href'), location.href).pathname === ${JSON.stringify(href)}; }
        catch { return false; }
    })`, TIMEOUT_MS);
    const scrollResult = await page.evaluate(`(async () => {
        const expectedPath = ${JSON.stringify(href)};
        const findLink = () => Array.from(document.querySelectorAll('.sidebar-links .nav-link[href]')).find((candidate) => {
            try { return new URL(candidate.getAttribute('href'), location.href).pathname === expectedPath; }
            catch { return false; }
        }) || null;
        const isVisible = (link) => {
            if (!link) return false;
            const box = link.getBoundingClientRect();
            const centerX = box.left + box.width / 2;
            const centerY = box.top + box.height / 2;
            const top = document.elementFromPoint(centerX, centerY);
            const topLink = top?.closest?.('a[href]') || null;
            let topPath = '';
            try { topPath = topLink ? new URL(topLink.getAttribute('href'), location.href).pathname : ''; } catch {}
            return box.width > 0
                && box.height > 0
                && centerX >= 0
                && centerX <= window.innerWidth
                && centerY >= 0
                && centerY <= window.innerHeight
                && (top === link || link.contains(top) || topPath === expectedPath);
        };
        const openGroup = (link) => {
            const group = link?.closest?.('.sidebar-group');
            const header = group?.querySelector?.('.sidebar-group-header');
            const items = group?.querySelector?.('.sidebar-group-items');
            if (header && items && !items.classList.contains('open')) header.click();
        };
        const nudgeContainers = (link) => {
            const box = link.getBoundingClientRect();
            const deltaY = box.top + box.height / 2 - window.innerHeight / 2;
            const containers = [
                link.closest('.sidebar-group-items'),
                link.closest('.sidebar-links'),
                link.closest('.sidebar-nav'),
                document.getElementById('sidebarNav'),
                document.getElementById('sidebarLinks'),
                document.scrollingElement || document.documentElement
            ].filter(Boolean);
            let parent = link.parentElement;
            while (parent && parent !== document.body) {
                const style = getComputedStyle(parent);
                if (/(auto|scroll|overlay)/.test(style.overflowY || style.overflow || '')) containers.push(parent);
                parent = parent.parentElement;
            }
            for (const container of Array.from(new Set(containers))) {
                if (container === document.scrollingElement || container === document.documentElement) {
                    window.scrollBy(0, deltaY);
                } else if (typeof container.scrollTop === 'number') {
                    container.scrollTop += deltaY;
                }
            }
        };
        for (let index = 0; index < 12; index += 1) {
            const link = findLink();
            if (!link) return { found: false, visible: false, iteration: index };
            openGroup(link);
            const box = link.getBoundingClientRect();
            if ((box.x + box.width) < 1 || box.y < 0) {
                const toggle = document.getElementById('sidebarToggle');
                if (toggle) toggle.click();
            }
            link.scrollIntoView({ block: 'center', inline: 'center' });
            nudgeContainers(link);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const refreshed = findLink();
            if (isVisible(refreshed)) {
                const rect = refreshed.getBoundingClientRect();
                return {
                    found: true,
                    visible: true,
                    iteration: index,
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                };
            }
        }
        const finalLink = findLink();
        const finalBox = finalLink?.getBoundingClientRect?.();
        return {
            found: Boolean(finalLink),
            visible: isVisible(finalLink),
            iteration: 12,
            rect: finalBox ? { x: finalBox.x, y: finalBox.y, width: finalBox.width, height: finalBox.height } : null
        };
    })()`, 5_000);
    const readiness = await collectSidebarClickReadiness(page, href);
    if (!scrollResult.visible) {
        const debug = await captureSidebarDebug(page, href, readiness);
        if (options.expectNavigation === false) {
            return {
                clicked: false,
                navigated: false,
                navigationError: '',
                visibilityError: `href-based sidebar link did not become visible: ${JSON.stringify(scrollResult)}`,
                readiness,
                scrollResult,
                debug
            };
        }
        throw new Error(`sidebar link ${href} did not become visible/clickable: ${JSON.stringify(debug)}; scroll=${JSON.stringify(scrollResult)}`);
    }
    const clicked = await page.mouseClickSidebarHref(href);
    assert.equal(clicked, true, `sidebar link ${href} must be clickable`);
    const navigationTimeoutMs = Number(options.navigationTimeoutMs) || 3_000;
    let navigationError = null;
    try {
        await page.waitForFunction(`location.pathname === ${JSON.stringify(href)}`, navigationTimeoutMs);
    } catch (error) {
        navigationError = error;
    }
    const debug = await captureSidebarDebug(page, href, readiness);
    return {
        clicked,
        navigated: debug.path === href,
        navigationError: navigationError ? String(navigationError.message || navigationError) : '',
        readiness,
        scrollResult,
        debug
    };
}

async function clickSidebarTo(page, href, moduleName, options = {}) {
    const attempt = await attemptSidebarClick(page, href, options);
    if (!attempt.navigated) {
        if (options.expectNavigation === false) return attempt;
        throw new Error(`sidebar click did not navigate to ${href}: ${JSON.stringify(attempt.debug)}; original=${attempt.navigationError}`);
    }
    if (options.expectNavigation === false) return attempt;
    const moduleProbe = await waitForModule(page, moduleName);
    return { readiness: attempt.readiness, moduleProbe, attempt };
}

async function collectServiceWorkerReadySnapshot(page, timeoutMs = 1500) {
    try {
        return await page.evaluate(`(async () => {
            const snapshot = {
                ok: true,
                at: Date.now(),
                path: location.pathname,
                readyState: document.readyState || '',
                visibilityState: document.visibilityState || '',
                hasFocus: document.hasFocus(),
                controller: navigator.serviceWorker?.controller?.scriptURL || '',
                registerStarted: window.__r11_sw_register_started === true,
                registerResolved: Boolean(window.__r11_sw_register_result),
                registerError: window.__r11_sw_register_error || null,
                readyResolved: Boolean(window.__r11_sw_ready_result),
                readyError: window.__r11_sw_ready_error || null,
                registration: null
            };
            try {
                const registration = await navigator.serviceWorker.getRegistration('/');
                snapshot.registration = registration ? {
                    scope: registration.scope || '',
                    installing: registration.installing ? { state: registration.installing.state, scriptURL: registration.installing.scriptURL || '' } : null,
                    waiting: registration.waiting ? { state: registration.waiting.state, scriptURL: registration.waiting.scriptURL || '' } : null,
                    active: registration.active ? { state: registration.active.state, scriptURL: registration.active.scriptURL || '' } : null
                } : null;
            } catch (error) {
                snapshot.registrationError = String(error?.message || error);
            }
            return snapshot;
        })()`, timeoutMs);
    } catch (error) {
        return {
            ok: false,
            error: String(error?.message || error),
            at: Date.now()
        };
    }
}

function classifySwReadyPhase(snapshot) {
    if (!snapshot?.ok) return 'execution-context';
    if (snapshot.registerError) return 'register-error';
    if (!snapshot.registerResolved) return 'register';
    if (snapshot.readyError) return 'ready-error';
    if (!snapshot.readyResolved) return 'ready';
    if (!snapshot.controller) return 'controller';
    return 'controlled';
}

async function waitForServiceWorkerControllerExternally(page, timeoutMs = TIMEOUT_MS) {
    const startedAt = Date.now();
    const snapshots = [];
    while (Date.now() - startedAt < timeoutMs) {
        const snapshot = await collectServiceWorkerReadySnapshot(page, 1500);
        snapshots.push(snapshot);
        const phase = classifySwReadyPhase(snapshot);
        if (snapshot?.ok && snapshot.controller) return { snapshot, snapshots: snapshots.slice(-20), phase: 'controlled' };
        if (phase === 'controller') return { snapshot, snapshots: snapshots.slice(-20), phase };
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    const finalSnapshot = await collectServiceWorkerReadySnapshot(page, 1500);
    snapshots.push(finalSnapshot);
    return { snapshot: finalSnapshot, snapshots: snapshots.slice(-20), phase: classifySwReadyPhase(finalSnapshot), timedOut: true };
}

async function ensureControlledBy(page, origin, expectedSha) {
    await page.bringToFront();
    const checkpoint = page.traceCheckpoint();
    step(`ensure SW control for ${expectedSha.slice(0, 8)}`);
    const start = await page.evaluate(`(() => {
        window.__r11_sw_register_started = true;
        window.__r11_sw_register_result = null;
        window.__r11_sw_register_error = null;
        window.__r11_sw_ready_result = null;
        window.__r11_sw_ready_error = null;
        try {
            const registrationPromise = navigator.serviceWorker.register('/sw.js');
            registrationPromise.then(registration => {
                window.__r11_sw_register_result = {
                    scope: registration.scope || '',
                    installing: registration.installing ? { state: registration.installing.state, scriptURL: registration.installing.scriptURL || '' } : null,
                    waiting: registration.waiting ? { state: registration.waiting.state, scriptURL: registration.waiting.scriptURL || '' } : null,
                    active: registration.active ? { state: registration.active.state, scriptURL: registration.active.scriptURL || '' } : null
                };
            }).catch(error => {
                window.__r11_sw_register_error = String(error?.message || error);
            });
            navigator.serviceWorker.ready.then(registration => {
                window.__r11_sw_ready_result = {
                    scope: registration.scope || '',
                    active: registration.active ? { state: registration.active.state, scriptURL: registration.active.scriptURL || '' } : null
                };
            }).catch(error => {
                window.__r11_sw_ready_error = String(error?.message || error);
            });
            return {
                started: true,
                controller: navigator.serviceWorker?.controller?.scriptURL || '',
                readyState: document.readyState || ''
            };
        } catch (error) {
            window.__r11_sw_register_error = String(error?.message || error);
            return { started: false, error: String(error?.message || error) };
        }
    })()`, 5000);
    assert.equal(start?.started, true, `service worker registration must start synchronously: ${JSON.stringify(start)}`);
    let control = await waitForServiceWorkerControllerExternally(page, TIMEOUT_MS);
    if (!control.snapshot?.controller && control.phase !== 'controller') {
        const beforeReloadFailure = {
            phase: control.phase,
            start,
            control,
            trace: page.traceSince(checkpoint),
            identity: await collectFrontendIdentity(page, origin, `sw-ready-timeout-${expectedSha.slice(0, 8)}`).catch(error => ({ error: String(error?.message || error) }))
        };
        const failurePath = await writeJsonArtifact(`r11-sw-ready-timeout-${expectedSha.slice(0, 8)}.json`, beforeReloadFailure);
        throw new Error(`SW ready timeout phase=${control.phase}; evidence=${failurePath}`);
    }
    if (!control.snapshot?.controller) {
        await page.reload();
        await installBrowserProbes(page);
        control = await waitForServiceWorkerControllerExternally(page, TIMEOUT_MS);
    }
    if (!control.snapshot?.controller) {
        const failure = {
            phase: control.phase,
            start,
            control,
            trace: page.traceSince(checkpoint),
            identity: await collectFrontendIdentity(page, origin, `sw-controller-timeout-${expectedSha.slice(0, 8)}`).catch(error => ({ error: String(error?.message || error) }))
        };
        const failurePath = await writeJsonArtifact(`r11-sw-controller-timeout-${expectedSha.slice(0, 8)}.json`, failure);
        throw new Error(`SW controller timeout phase=${control.phase}; evidence=${failurePath}`);
    }
    step(`wait controller for ${expectedSha.slice(0, 8)}`);
    const proof = await requestJson(`${origin}/__proof`);
    const swEntry = proof.body.served.find(entry => entry.path === 'sw.js' && entry.sha === expectedSha);
    assert.ok(swEntry, `browser must have fetched expected SW bytes ${expectedSha}: ${JSON.stringify(proof.body.served.slice(-10))}`);
    return { controllerReady: true, expectedSha, swEntry, control, trace: page.traceSince(checkpoint) };
}

async function waitForControllerChange(page, previousCount) {
    try {
        await page.waitForFunction(`(window.__r11?.controllerChanges || 0) > ${Number(previousCount)}`, TIMEOUT_MS);
    } catch (error) {
        const probe = await pageProbe(page).catch(probeError => ({ probeError: String(probeError?.message || probeError) }));
        throw new Error(`controllerchange not observed after SW byte update: ${JSON.stringify(probe)}; original=${error.message}`);
    }
    return pageProbe(page);
}

async function waitForControllerStability(page, previousCount) {
    await new Promise(resolve => setTimeout(resolve, 750));
    const probe = await pageProbe(page);
    assert.equal(probe.controllerChanges, previousCount, `SW controller must not change when bytes are identical: ${JSON.stringify(probe)}`);
    return probe;
}

async function collectLifecycleEvidence(page, checkpoint = null) {
    return {
        probe: await pageProbe(page).catch(error => ({ probeError: String(error?.message || error) })),
        trace: checkpoint ? page.traceSince(checkpoint) : page.traceSince({})
    };
}

function classifyDocumentChange(before, after) {
    const beforeProbe = before?.probe || before || {};
    const afterProbe = after?.probe || after || {};
    if (beforeProbe.documentId && afterProbe.documentId && beforeProbe.documentId !== afterProbe.documentId) return 'new-document';
    if (beforeProbe.documentId && afterProbe.documentId && beforeProbe.documentId === afterProbe.documentId) return 'same-document';
    return 'unknown-document-identity';
}

async function runBackgroundSidebarRafControl({ origin, chromePort, sourceMode, sourceSha, session, label }) {
    step(`${label}: background sidebar rAF control`);
    await setOverlayMode(origin, sourceMode, sourceMode);
    const backgroundPage = await createCdpPage(chromePort);
    const foregroundPage = await createCdpPage(chromePort);
    try {
        await backgroundPage.navigate(`${origin}/`);
        await installBrowserProbes(backgroundPage);
        await ensureControlledBy(backgroundPage, origin, sourceSha);
        step(`${label}: background wait timeline after SW control`);
        await waitForModule(backgroundPage, 'timeline');

        await foregroundPage.navigate('about:blank');
        await foregroundPage.bringToFront();
        await new Promise(resolve => setTimeout(resolve, 200));

        step(`${label}: background readiness while hidden`);
        const beforeVisible = await safePageProbe(backgroundPage, `${label}-background-before-hidden-control`);
        try {
            const before = await collectSidebarClickReadiness(backgroundPage, '/sales-funnel');
            const attempt = await clickSidebarTo(backgroundPage, '/sales-funnel', 'leads', {
                bringToFront: false,
                expectNavigation: false,
                navigationTimeoutMs: 1_000,
                visibilityTimeoutMs: 1_000
            });
            const after = await safePageProbe(backgroundPage, `${label}-background-after-hidden-control`);
            return { status: 'PASS', beforeVisible, before, attempt, after };
        } catch (error) {
            return {
                status: 'INFRA_BLOCKED',
                phase: 'hidden-tab-readiness-or-click',
                reason: String(error?.message || error),
                beforeVisible,
                hiddenProbe: await safePageProbe(backgroundPage, `${label}-background-hidden-failure`),
                trace: backgroundPage.traceSince({})
            };
        }
    } finally {
        await backgroundPage.close();
        await foregroundPage.close();
    }
}

async function switchToCurrentServiceWorker({ origin, sourceMode, label, pageA, pageB, preUpdateProofPath = '' }) {
    const sourceSwHash = assetHashForMode(sourceMode, 'sw.js');
    const currentSwHash = assetHashForMode('current', 'sw.js');
    const checkpointA = pageA.traceCheckpoint();
    const checkpointB = pageB.traceCheckpoint();
    const beforeEvidenceA = await collectLifecycleEvidence(pageA, checkpointA);
    const beforeEvidenceB = await collectLifecycleEvidence(pageB, checkpointB);
    assert.equal(beforeEvidenceA.probe?.probeInstalled, true, `${label}: pageA observer missing before SW update: ${JSON.stringify(beforeEvidenceA.probe)}`);
    assert.equal(beforeEvidenceB.probe?.probeInstalled, true, `${label}: pageB observer missing before SW update: ${JSON.stringify(beforeEvidenceB.probe)}`);
    const beforeA = Number(beforeEvidenceA.probe?.controllerChanges || 0);
    const beforeB = Number(beforeEvidenceB.probe?.controllerChanges || 0);
    step(`${label}: switch to current SW`);
    await setOverlayMode(origin, 'current', 'current');
    const triggerResult = await triggerServiceWorkerUpdate(pageA);
    if (sourceSwHash && currentSwHash && sourceSwHash === currentSwHash) {
        const afterA = await waitForControllerStability(pageA, beforeA);
        const afterB = await waitForControllerStability(pageB, beforeB);
        const afterEvidenceA = await collectLifecycleEvidence(pageA, checkpointA);
        const afterEvidenceB = await collectLifecycleEvidence(pageB, checkpointB);
        return {
            kind: 'legitimate-no-update-same-sw-bytes',
            sourceSwHash,
            currentSwHash,
            triggerResult,
            beforeA,
            beforeB,
            beforeEvidenceA,
            beforeEvidenceB,
            afterEvidenceA,
            afterEvidenceB,
            documentChangeA: classifyDocumentChange(beforeEvidenceA, afterEvidenceA),
            documentChangeB: classifyDocumentChange(beforeEvidenceB, afterEvidenceB),
            afterA,
            afterB
        };
    }
    let afterA;
    let afterB;
    try {
        afterA = await waitForControllerChange(pageA, beforeA);
        afterB = await waitForControllerChange(pageB, beforeB);
    } catch (error) {
        const afterEvidenceA = await collectLifecycleEvidence(pageA, checkpointA);
        const afterEvidenceB = await collectLifecycleEvidence(pageB, checkpointB);
        const proof = await requestJson(`${origin}/__proof`).catch(proofError => ({ proofError: String(proofError?.message || proofError) }));
        const recentSwServes = proof.body?.served?.filter?.(entry => entry.path === 'sw.js').slice(-12) || [];
        const failurePath = await writeJsonArtifact(`r11-old-tab-upgrade-${sourceMode}-sw-controllerchange-failure.json`, {
            status: 'FAIL',
            label,
            reason: 'controllerchange-not-observed-after-real-sw-byte-update',
            sourceMode,
            sourceSwHash,
            currentSwHash,
            currentSha: CURRENT_SHA,
            candidateAssetHashes: candidateAssetHashes(),
            preUpdateProofPath,
            triggerResult,
            recentSwServes,
            beforeEvidenceA,
            beforeEvidenceB,
            afterEvidenceA,
            afterEvidenceB,
            documentChangeA: classifyDocumentChange(beforeEvidenceA, afterEvidenceA),
            documentChangeB: classifyDocumentChange(beforeEvidenceB, afterEvidenceB),
            pageA: afterEvidenceA.probe,
            pageB: afterEvidenceB.probe,
            originalError: String(error.message || error)
        });
        throw new Error(`${label}: SW bytes differ but controllerchange was not observed; failurePath=${failurePath}; trigger=${JSON.stringify(triggerResult)}; recentSwServes=${JSON.stringify(recentSwServes)}; original=${error.message}`);
    }
    const afterEvidenceA = await collectLifecycleEvidence(pageA, checkpointA);
    const afterEvidenceB = await collectLifecycleEvidence(pageB, checkpointB);
    return {
        kind: 'real-upgrade-different-sw-bytes',
        sourceSwHash,
        currentSwHash,
        triggerResult,
        beforeA,
        beforeB,
        beforeEvidenceA,
        beforeEvidenceB,
        afterEvidenceA,
        afterEvidenceB,
        documentChangeA: classifyDocumentChange(beforeEvidenceA, afterEvidenceA),
        documentChangeB: classifyDocumentChange(beforeEvidenceB, afterEvidenceB),
        afterA,
        afterB
    };
}

async function setOverlayMode(origin, assetMode, swMode = assetMode) {
    const status = await overlayControl(origin, `/__asset-mode?mode=${encodeURIComponent(assetMode)}&sw=${encodeURIComponent(swMode)}`);
    assert.equal(status, 200, `overlay mode ${assetMode}/${swMode} must be accepted`);
}

async function clearOriginState(chromePort, origin, label) {
    const page = await createCdpPage(chromePort);
    try {
        await page.send('Storage.clearDataForOrigin', {
            origin,
            storageTypes: 'appcache,cache_storage,cookies,file_systems,indexeddb,local_storage,service_workers,websql'
        }).catch(async () => {
            await page.navigate(origin);
            await page.evaluate(`(async () => {
                localStorage.clear();
                sessionStorage.clear();
                const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
                await Promise.all(registrations.map(registration => registration.unregister()));
                const keys = await caches?.keys?.() || [];
                await Promise.all(keys.map(key => caches.delete(key)));
                return true;
            })()`);
        });
        step(`${label}: cleared isolated browser origin state`);
    } finally {
        await page.close();
    }
}

async function verifyServedBytes(origin, expectedSha, paths, label) {
    const proof = await requestJson(`${origin}/__proof`);
    assert.equal(proof.status, 200, `${label}: proof endpoint must be readable`);
    for (const expectedPath of paths) {
        const entry = proof.body.served.find(item => item.path === expectedPath && item.sha === expectedSha);
        assert.ok(entry, `${label}: expected real bytes for ${expectedPath} from ${expectedSha}; served=${JSON.stringify(proof.body.served.slice(-40))}`);
    }
}

async function addUnsavedProofInput(page) {
    return page.evaluate(`(() => {
        let input = document.getElementById('r11-unsaved-proof');
        if (!input) input = document.createElement('textarea');
        const proofId = 'r11-proof-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        input.id = 'r11-unsaved-proof';
        input.value = 'unsaved r11 proof';
        input.dataset.dirty = 'true';
        input.dataset.editableSurface = 'true';
        input.dataset.r11ProofId = proofId;
        if (!input.parentNode) document.body.appendChild(input);
        window.__eventGenixDirtyForms = true;
        return {
            path: location.pathname,
            documentId: window.__r11?.documentId || '',
            proofId,
            isConnected: input.isConnected === true,
            value: input.value,
            nodeName: input.nodeName || '',
            controllerScript: navigator.serviceWorker?.controller?.scriptURL || ''
        };
    })()`);
}

async function assertUnsavedProofPrecondition(page, expected, label, checkpoint = {}) {
    const actual = await page.evaluate(`(() => {
        const input = document.getElementById('r11-unsaved-proof');
        return {
            path: location.pathname,
            documentId: window.__r11?.documentId || '',
            expectedDocumentId: ${JSON.stringify(expected?.documentId || '')},
            proofId: input?.dataset?.r11ProofId || '',
            expectedProofId: ${JSON.stringify(expected?.proofId || '')},
            isConnected: input?.isConnected === true,
            value: input?.value || '',
            exists: Boolean(input),
            nodeName: input?.nodeName || '',
            controllerScript: navigator.serviceWorker?.controller?.scriptURL || '',
            readyState: document.readyState || '',
            bodyClass: document.body?.className || '',
            shellVisible: (() => {
                const shell = document.getElementById('mainApp') || document.getElementById('main-content');
                return Boolean(shell && !shell.classList.contains('hidden') && getComputedStyle(shell).visibility !== 'hidden');
            })()
        };
    })()`);
    const ok = actual.documentId
        && actual.documentId === expected?.documentId
        && actual.proofId === expected?.proofId
        && actual.isConnected === true
        && actual.value === expected?.value
        && actual.path === '/sales-funnel';
    if (!ok) {
        const failurePath = await writeJsonArtifact(`r11-unsaved-input-precondition-failed-${Date.now()}.json`, {
            status: 'PRECONDITION_FAILED',
            label,
            expected,
            actual,
            probe: await safePageProbe(page, `${label}-unsaved-precondition`),
            trace: page.traceSince(checkpoint)
        });
        throw new Error(`${label}: PRECONDITION_FAILED before SW update; evidence=${failurePath}`);
    }
    return actual;
}

async function triggerServiceWorkerUpdate(page) {
    return page.evaluate(`(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (!registration) throw new Error('missing service worker registration');
        const trace = [];
        const seenWorkers = new WeakSet();
        const snapshot = (label) => {
            const value = {
                label,
                at: Date.now(),
                controller: navigator.serviceWorker?.controller?.scriptURL || '',
                probeInstalled: window.__r11?.probeInstalled === true,
                documentId: window.__r11?.documentId || '',
                controllerChanges: window.__r11?.controllerChanges || 0,
                installing: registration.installing ? { state: registration.installing.state, scriptURL: registration.installing.scriptURL || '' } : null,
                waiting: registration.waiting ? { state: registration.waiting.state, scriptURL: registration.waiting.scriptURL || '' } : null,
                active: registration.active ? { state: registration.active.state, scriptURL: registration.active.scriptURL || '' } : null
            };
            trace.push(value);
            return value;
        };
        const attachWorker = (worker, source) => {
            if (!worker || seenWorkers.has(worker)) return;
            seenWorkers.add(worker);
            trace.push({ label: 'worker-observed', source, at: Date.now(), state: worker.state, scriptURL: worker.scriptURL || '' });
            worker.addEventListener('statechange', () => {
                trace.push({ label: 'worker-statechange', source, at: Date.now(), state: worker.state, scriptURL: worker.scriptURL || '' });
            });
        };
        attachWorker(registration.installing, 'initial-installing');
        attachWorker(registration.waiting, 'initial-waiting');
        attachWorker(registration.active, 'initial-active');
        const before = snapshot('before-update');
        let updateFound = false;
        registration.addEventListener('updatefound', () => {
            updateFound = true;
            attachWorker(registration.installing, 'updatefound-installing');
            snapshot('updatefound');
        });
        const updatedRegistration = await registration.update();
        attachWorker(updatedRegistration.installing, 'updated-installing');
        attachWorker(updatedRegistration.waiting, 'updated-waiting');
        attachWorker(updatedRegistration.active, 'updated-active');
        snapshot('after-registration-update');
        const startedAt = Date.now();
        let postedSkipWaiting = false;
        while (Date.now() - startedAt < 10_000) {
            attachWorker(registration.installing, 'poll-installing');
            attachWorker(registration.waiting, 'poll-waiting');
            attachWorker(registration.active, 'poll-active');
            const waiting = registration.waiting || updatedRegistration.waiting;
            if (waiting && !postedSkipWaiting) {
                postedSkipWaiting = true;
                waiting.postMessage({ type: 'SKIP_WAITING' });
                trace.push({ label: 'posted-skip-waiting', at: Date.now(), state: waiting.state, scriptURL: waiting.scriptURL || '' });
            }
            const current = snapshot('poll');
            if ((window.__r11?.controllerChanges || 0) > before.controllerChanges && current.active?.state === 'activated') break;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        const after = snapshot('final');
        return {
            before,
            updateFound,
            postedSkipWaiting,
            after,
            controllerChanges: window.__r11?.controllerChanges || 0,
            trace
        };
    })()`, 20_000);
}

async function triggerFutureServiceWorkerPrompt(page, origin, swMode) {
    await setOverlayMode(origin, 'current', swMode);
    let updateResult = null;
    try {
        updateResult = await triggerServiceWorkerUpdate(page);
        await page.waitForFunction(`Boolean(document.querySelector('#authServiceWorkerUpdatePrompt [data-auth-sw-update-prompt]'))`, TIMEOUT_MS);
        return {
            kind: 'future-update-fixture',
            swMode,
            updateResult,
            prompt: await pageProbe(page),
            identity: await collectFrontendIdentity(page, origin, `future-update-${swMode}`)
        };
    } catch (error) {
        const identity = await collectFrontendIdentity(page, origin, `future-update-${swMode}-failure`).catch(identityError => ({
            identityError: String(identityError?.message || identityError)
        }));
        const probe = await pageProbe(page).catch(probeError => ({ probeError: String(probeError?.message || probeError) }));
        throw new Error(`future SW update prompt did not appear for ${swMode}; probe=${JSON.stringify(probe)}; identity=${JSON.stringify(identity)}; update=${JSON.stringify(updateResult)}; original=${error.message}`);
    }
}

async function runOldCohortUpgrade({ origin, chromePort, sourceMode, sourceSha, label }) {
    step(`${label}: open old cohort`);
    await clearOriginState(chromePort, origin, label);
    await setOverlayMode(origin, sourceMode, sourceMode);
    const pageA = await createCdpPage(chromePort);
    const pageB = await createCdpPage(chromePort);
    let pageC = null;
    try {
        const session = await loginThroughOverlay(origin);
        const seed = await seedOriginStorageOnce(origin, chromePort, session, `${label}-initial-seed`);
        const backgroundControl = await runBackgroundSidebarRafControl({
            origin,
            chromePort,
            sourceMode,
            sourceSha,
            session,
            label
        });

        step(`${label}: load first tab`);
        await pageA.navigate(`${origin}/`);
        await pageA.bringToFront();
        await installBrowserProbes(pageA);
        await ensureControlledBy(pageA, origin, sourceSha);
        step(`${label}: wait first timeline`);
        await waitForModule(pageA, 'timeline');

        step(`${label}: second old tab`);
        await pageB.navigate(`${origin}/certificates`);
        await pageB.bringToFront();
        await installBrowserProbes(pageB);
        await ensureControlledBy(pageB, origin, sourceSha);
        await waitForModule(pageB, 'certificates');

        step(`${label}: sidebar navigation`);
        const sidebarTraceCheckpoint = pageA.traceCheckpoint();
        const backgroundBeforeActiveClick = await collectSidebarClickReadiness(pageA, '/sales-funnel');
        const sidebarNavigation = await clickSidebarTo(pageA, '/sales-funnel', 'leads', { bringToFront: true });
        const unsavedInput = await addUnsavedProofInput(pageA);
        const unsavedInputPrecondition = await assertUnsavedProofPrecondition(pageA, unsavedInput, label, sidebarTraceCheckpoint);
        await verifyServedBytes(origin, sourceSha, ['index.html', 'leads.html', 'certificates.html', 'js/api.js', 'js/auth.js', 'js/components/sidebar.js', 'sw.js'], label);

        const preUpdateProofPath = await writeJsonArtifact(`r11-old-tab-upgrade-${sourceMode}-pre-update-proof.json`, {
            status: 'PRE_UPDATE_PASS',
            label,
            sourceMode,
            sourceSha,
            currentSha: CURRENT_SHA,
            candidateAssetHashes: candidateAssetHashes(),
            backgroundControl,
            backgroundBeforeActiveClick,
            sidebarNavigation,
            sidebarTrace: pageA.traceSince(sidebarTraceCheckpoint),
            unsavedInput,
            unsavedInputPrecondition,
            oldLeadsBeforeUpdate: await pageProbe(pageA),
            oldCertificatesBeforeUpdate: await pageProbe(pageB),
            unsavedInputBeforeSwUpdate: await assertUnsavedProofPrecondition(pageA, unsavedInput, label, sidebarTraceCheckpoint)
        });
        const swUpdate = await switchToCurrentServiceWorker({ origin, sourceMode, label, pageA, pageB, preUpdateProofPath });
        const afterA = swUpdate.afterA;
        const afterB = swUpdate.afterB;

        try {
            assert.equal(afterA.path, '/sales-funnel', `${label}: old leads tab must keep route after SW update check`);
            assert.equal(afterA.unsavedValue, 'unsaved r11 proof', `${label}: SW update check must not lose unsaved input`);
            assert.equal(afterA.loginVisible, false, `${label}: SW update check must not force logout`);
            assert.equal(afterA.hasTimeline, false, `${label}: leads tab must not fall back to Timeline`);
            assert.equal(afterB.path, '/certificates', `${label}: old certificates tab must keep route after SW update check`);
            assert.equal(afterB.loginVisible, false, `${label}: second old tab must not force logout`);
            assert.equal(afterB.hasTimeline, false, `${label}: certificates tab must not fall back to Timeline`);
        } catch (error) {
            const failurePath = await writeJsonArtifact(`r11-old-tab-upgrade-${sourceMode}-post-sw-assertion-failure.json`, {
                status: 'FAIL',
                label,
                sourceMode,
                sourceSha,
                currentSha: CURRENT_SHA,
                candidateAssetHashes: candidateAssetHashes(),
                preUpdateProofPath,
                swUpdate,
                afterA,
                afterB,
                pageANow: await safePageProbe(pageA, `${label}-post-sw-page-a-failure`),
                pageBNow: await safePageProbe(pageB, `${label}-post-sw-page-b-failure`),
                originalError: String(error?.message || error)
            });
            throw new Error(`${error.message}; evidence=${failurePath}`);
        }

        step(`${label}: new current tab`);
        pageC = await createCdpPage(chromePort);
        await pageC.navigate(`${origin}/certificates`);
        await installBrowserProbes(pageC);
        await waitForModule(pageC, 'certificates');
        await verifyServedBytes(origin, CURRENT_SHA, ['certificates.html', 'js/api.js', 'js/auth.js', 'sw.js'], `${label} new tab`);
        const oldLeadsIdentity = await collectFrontendIdentity(pageA, origin, `${label} old leads`);
        const oldCertificatesIdentity = await collectFrontendIdentity(pageB, origin, `${label} old certificates`);
        const newTabIdentity = await collectFrontendIdentity(pageC, origin, `${label} new current tab`);

        return {
            label,
            sourceMode,
            sourceSha,
            sourceAssetHashes: {
                sw: assetHashForMode(sourceMode, 'sw.js'),
                index: assetHashForMode(sourceMode, 'index.html'),
                api: assetHashForMode(sourceMode, 'js/api.js'),
                auth: assetHashForMode(sourceMode, 'js/auth.js'),
                sidebar: assetHashForMode(sourceMode, 'js/components/sidebar.js')
            },
            backgroundControl,
            backgroundBeforeActiveClick,
            sidebarNavigation,
            swUpdate,
            oldLeads: afterA,
            oldCertificates: afterB,
            newTab: await pageProbe(pageC),
            frontendIdentity: {
                oldLeads: oldLeadsIdentity,
                oldCertificates: oldCertificatesIdentity,
                newTab: newTabIdentity
            }
        };
    } finally {
        await pageA.close();
        await pageB.close();
        if (pageC) await pageC.close();
    }
}

async function runNavigationLifecycleOffline({ origin, chromePort }) {
    step('current candidate: sidebar/back-forward/offline lifecycle');
    await clearOriginState(chromePort, origin, 'navigation-lifecycle-offline');
    await setOverlayMode(origin, 'current', 'current');
    const page = await createCdpPage(chromePort);
    try {
        const session = await loginThroughOverlay(origin);
        const seed = await seedOriginStorageOnce(origin, chromePort, session, 'navigation-lifecycle-initial-seed');
        await page.navigate(`${origin}/`);
        await page.bringToFront();
        await installBrowserProbes(page);
        await waitForModule(page, 'timeline');

        const leads = await clickSidebarTo(page, '/sales-funnel', 'leads');
        const certificates = await clickSidebarTo(page, '/certificates', 'certificates');

        await page.navigateHistory(-1);
        const back = await waitForModule(page, 'leads');
        await page.navigateHistory(1);
        const forward = await waitForModule(page, 'certificates');

        await page.evaluate(`(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
            document.dispatchEvent(new Event('visibilitychange'));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            return true;
        })()`);
        const syntheticLifecycle = await pageProbe(page);
        assert.equal(syntheticLifecycle.path, '/certificates', 'synthetic lifecycle must keep certificates route');
        assert.equal(syntheticLifecycle.hasTimeline, false, 'synthetic lifecycle must not substitute certificates with Timeline');

        await page.setOffline(true);
        await page.navigate(`${origin}/certificates`).catch(() => {});
        await page.setOffline(false);
        await page.reload();
        const reconnect = await waitForModule(page, 'certificates');

        const realBfcachePersisted = (forward.pageshow || []).some(event => event.persisted === true && event.trusted === true)
            || (back.pageshow || []).some(event => event.persisted === true && event.trusted === true);
        return { leads, certificates, back, forward, syntheticLifecycle, reconnect, realBfcachePersisted };
    } finally {
        await page.setOffline(false).catch(() => {});
        await page.close();
    }
}

async function prepareCurrentCandidatePage({ origin, chromePort, label }) {
    await setOverlayMode(origin, 'current', 'current');
    const page = await createCdpPage(chromePort);
    const session = await loginThroughOverlay(origin);
    const seed = await seedOriginStorageOnce(origin, chromePort, session, `${label}-seed`);
    await page.navigate(`${origin}/certificates`);
    await page.bringToFront();
    await installBrowserProbes(page);
    await waitForModule(page, 'certificates');
    await ensureControlledBy(page, origin, CURRENT_SHA);
    await page.reload();
    await installBrowserProbes(page);
    await waitForModule(page, 'certificates');
    return {
        page,
        session,
        seed,
        beforeIdentity: await collectFrontendIdentity(page, origin, `${label}-before`),
        beforeDocId: (await pageProbe(page)).documentId
    };
}

async function runCurrentUpdatePromptProof({ origin, chromePort }) {
    step('current candidate: safe update prompt');

    await clearOriginState(chromePort, origin, 'current-update-prompt-later');
    let laterPage = null;
    let laterProof = null;
    try {
        const prepared = await prepareCurrentCandidatePage({ origin, chromePort, label: 'current-update-later' });
        laterPage = prepared.page;
        const update = await triggerFutureServiceWorkerPrompt(laterPage, origin, 'future-a');
        const laterClicked = await laterPage.click('[data-auth-sw-update-later]');
        assert.equal(laterClicked, true, 'later button must be clickable');
        await laterPage.waitForFunction(`!document.querySelector('#authServiceWorkerUpdatePrompt [data-auth-sw-update-prompt]')`, TIMEOUT_MS);
        const afterLater = await laterPage.pageProbe?.().catch(() => null) || await pageProbe(laterPage);
        assert.equal(afterLater.path, '/certificates', 'later update action must not navigate');
        assert.equal(afterLater.accessToken, true, 'later update action must keep auth token');
        assert.equal(afterLater.refreshToken, true, 'later update action must keep refresh token');
        laterProof = {
            fixtureKind: 'future-update-fixture-not-exact-candidate',
            beforeDocId: prepared.beforeDocId,
            beforeIdentity: prepared.beforeIdentity,
            update,
            afterLater
        };
    } finally {
        if (laterPage) await laterPage.close();
    }

    await clearOriginState(chromePort, origin, 'current-update-prompt-dirty');
    let dirtyPage = null;
    try {
        const prepared = await prepareCurrentCandidatePage({ origin, chromePort, label: 'current-update-dirty' });
        dirtyPage = prepared.page;
        await dirtyPage.evaluate(`(() => {
            const input = document.createElement('input');
            input.id = 'r11-unsaved-proof';
            input.value = 'unsaved update proof';
            input.dataset.dirty = 'true';
            input.setAttribute('data-editable-surface', 'true');
            document.body.appendChild(input);
            window.__eventGenixDirtyForms = true;
            return true;
        })()`);
        const update = await triggerFutureServiceWorkerPrompt(dirtyPage, origin, 'future-b');
        const cancelAttempt = await dirtyPage.click('[data-auth-sw-update-reload]');
        assert.equal(cancelAttempt, true, 'update button must be clickable for dirty cancel proof');
        await dirtyPage.waitForFunction(`Boolean(document.querySelector('.confirm-overlay[data-confirm-kind="confirm"] .confirm-cancel'))`, TIMEOUT_MS);
        const cancelClicked = await dirtyPage.click('.confirm-overlay[data-confirm-kind="confirm"] .confirm-cancel');
        assert.equal(cancelClicked, true, 'dirty guard cancel button must be clickable');
        await new Promise(resolve => setTimeout(resolve, 300));
        const afterCancel = await pageProbe(dirtyPage);
        assert.equal(afterCancel.path, '/certificates', 'cancelled update must not navigate');
        assert.equal(afterCancel.documentId, prepared.beforeDocId, 'cancelled update must keep the same document');
        assert.equal(afterCancel.unsavedValue, 'unsaved update proof', 'cancelled update must keep unsaved input');
        assert.equal(afterCancel.accessToken, true, 'cancelled update must keep auth tokens');

        await dirtyPage.evaluate(`window.__r11_reload_marker = window.__r11?.documentId || ''`);
        const confirmAttempt = await dirtyPage.click('[data-auth-sw-update-reload]');
        assert.equal(confirmAttempt, true, 'confirmed update button must be clickable');
        await dirtyPage.waitForFunction(`Boolean(document.querySelector('.confirm-overlay[data-confirm-kind="confirm"] .confirm-ok'))`, TIMEOUT_MS);
        const confirmClicked = await dirtyPage.click('.confirm-overlay[data-confirm-kind="confirm"] .confirm-ok');
        assert.equal(confirmClicked, true, 'dirty guard confirm button must be clickable');
        await dirtyPage.waitForFunction(`(document.readyState === 'interactive' || document.readyState === 'complete') && !window.__r11_reload_marker`, TIMEOUT_MS);
        await installBrowserProbes(dirtyPage);
        await waitForModule(dirtyPage, 'certificates');
        const afterReload = await pageProbe(dirtyPage);
        assert.equal(afterReload.path, '/certificates', 'confirmed update reload must preserve safe route');
        assert.equal(afterReload.accessToken, true, 'confirmed update reload must not clear auth storage');
        assert.equal(afterReload.refreshToken, true, 'confirmed update reload must not clear refresh token');
        assert.notEqual(afterReload.documentId, prepared.beforeDocId, 'confirmed update must load a new document');
        return {
            fixtureKind: 'future-update-fixture-not-exact-candidate',
            laterProof,
            dirtyProof: {
                beforeDocId: prepared.beforeDocId,
                beforeIdentity: prepared.beforeIdentity,
                update,
                afterCancel,
                afterReload,
                afterReloadIdentity: await collectFrontendIdentity(dirtyPage, origin, 'current-update-prompt-after-reload')
            }
        };
    } finally {
        if (dirtyPage) await dirtyPage.close();
    }
}

async function runLostAndDelayedRefreshProof({ origin, chromePort }) {
    step('current candidate: lost and delayed refresh');
    await clearOriginState(chromePort, origin, 'lost-delayed-refresh');
    await setOverlayMode(origin, 'current', 'current');
    const bootstrapControl = await runTwoCertificatesBootstrapControl({ origin, chromePort });
    const duplicateGrace = await runLostCommittedRefreshCase({
        origin,
        chromePort,
        delayMs: 1_000,
        label: 'duplicate-grace-1s',
        expected: 'duplicate-grace'
    });
    const recovery = await runLostCommittedRefreshCase({
        origin,
        chromePort,
        delayMs: 6_200,
        label: 'recovery-window-6s',
        expected: 'recovery'
    });
    const terminal = await runLostCommittedRefreshCase({
        origin,
        chromePort,
        delayMs: 31_000,
        label: 'terminal-post-window-31s',
        expected: 'terminal'
    });
    const delayedConcurrent = await runDelayedConcurrentRefreshCase({ origin, chromePort });
    return {
        bootstrapControl,
        duplicateGrace,
        recovery,
        terminal,
        delayedConcurrent
    };
}
async function runLogoutDuringUpdateProof({ origin, chromePort }) {
    step('current candidate: logout/account switch during update');
    await clearOriginState(chromePort, origin, 'logout-during-update');
    await setOverlayMode(origin, 'current', 'current');
    const page = await createCdpPage(chromePort);
    try {
        const session = await loginThroughOverlay(origin);
        const seed = await seedOriginStorageOnce(origin, chromePort, session, 'logout-during-update-initial-seed');
        await page.navigate(`${origin}/certificates`);
        await page.bringToFront();
        await installBrowserProbes(page);
        await waitForModule(page, 'certificates');
        await ensureControlledBy(page, origin, CURRENT_SHA);
        await page.reload();
        await installBrowserProbes(page);
        await waitForModule(page, 'certificates');
        const beforeIdentity = await collectFrontendIdentity(page, origin, 'logout-during-update-before');
        const update = await triggerFutureServiceWorkerPrompt(page, origin, 'future-a');
        await page.evaluate(`(() => {
            localStorage.removeItem('pzp_token');
            localStorage.removeItem('pzp_access_token');
            localStorage.removeItem('pzp_refresh_token');
            localStorage.removeItem('pzp_current_user');
            window.__eventGenixDirtyForms = false;
            window.__r11_reload_marker = window.__r11?.documentId || '';
            return true;
        })()`);
        const clicked = await page.click('[data-auth-sw-update-reload]');
        assert.equal(clicked, true, 'update prompt reload button must exist before logout guard proof');
        await page.waitForFunction(`(document.readyState === 'interactive' || document.readyState === 'complete') && !window.__r11_reload_marker`, TIMEOUT_MS);
        await installBrowserProbes(page);
        const probe = await pageProbe(page);
        assert.equal(probe.accessToken, false, 'logout/account switch guard must not restore access token');
        assert.equal(probe.refreshToken, false, 'logout/account switch guard must not restore refresh token');
        assert.equal(probe.currentUser, false, 'logout/account switch guard must not restore user');
        return {
            beforeIdentity,
            update,
            afterReload: probe,
            afterReloadIdentity: await collectFrontendIdentity(page, origin, 'logout-during-update-after')
        };
    } finally {
        await page.close();
    }
}

async function writeJsonArtifact(fileName, result) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const artifactPath = path.join(OUTPUT_DIR, fileName);
    const scrubbed = JSON.parse(JSON.stringify(result, (key, value) => {
        if (/token|password|authorization|cookie/i.test(key)) return '[redacted]';
        return value;
    }));
    fs.writeFileSync(artifactPath, JSON.stringify(scrubbed, null, 2));
    return artifactPath;
}

async function writeProofArtifact(result) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const proofPath = path.join(OUTPUT_DIR, 'r11-old-tab-upgrade-proof.json');
    const scrubbed = JSON.parse(JSON.stringify(result, (key, value) => {
        if (/token|password|authorization|cookie/i.test(key)) return '[redacted]';
        return value;
    }));
    fs.writeFileSync(proofPath, JSON.stringify(scrubbed, null, 2));
    return proofPath;
}

async function main() {
    requireIsolatedTarget();
    const overlay = createOverlayServer();
    let chrome = null;
    let overlayPort = null;
    const failures = [];
    const markFailure = (name, error) => {
        const message = String(error?.stack || error?.message || error);
        const failure = { status: 'FAIL', name, message };
        failures.push(failure);
        step(`${name}: FAIL ${String(error?.message || error).split('\n')[0]}`);
        return failure;
    };
    try {
        overlayPort = await new Promise((resolve, reject) => {
            overlay.once('error', reject);
            overlay.listen(0, '127.0.0.1', () => resolve(overlay.address().port));
        });
        const origin = `http://127.0.0.1:${overlayPort}`;
        assertSafeIsolatedTestUrl(origin);
        step(`overlay ${origin}`);
        chrome = await launchChrome();
        step('chrome launched');

        const result = {
            currentSha: CURRENT_SHA,
            candidateAssetHashes: candidateAssetHashes(),
            fixtureShas: {
                preRelease: PRE_RELEASE_SHA,
                released: RELEASED_SHA
            },
            targetUrl: TARGET_URL,
            startedAt: new Date().toISOString(),
            cohorts: [],
            checks: {}
        };

        async function runSection(name, assign, fn) {
            try {
                const value = await fn();
                assign({ status: 'PASS', ...value });
            } catch (error) {
                assign(markFailure(name, error));
            }
        }

        await runSection('pre-release-frontend-to-current-candidate', value => result.cohorts.push(value), () => runOldCohortUpgrade({
            origin,
            chromePort: chrome.port,
            sourceMode: 'pre',
            sourceSha: PRE_RELEASE_SHA,
            label: 'pre-release-frontend-to-current-candidate'
        }));
        await runSection('released-frontend-to-current-candidate', value => result.cohorts.push(value), () => runOldCohortUpgrade({
            origin,
            chromePort: chrome.port,
            sourceMode: 'released',
            sourceSha: RELEASED_SHA,
            label: 'released-frontend-to-current-candidate'
        }));
        await runSection('navigationLifecycleOffline', value => { result.checks.navigationLifecycleOffline = value; }, () => runNavigationLifecycleOffline({ origin, chromePort: chrome.port }));
        await runSection('currentUpdatePrompt', value => { result.checks.currentUpdatePrompt = value; }, () => runCurrentUpdatePromptProof({ origin, chromePort: chrome.port }));
        await runSection('lostDelayedRefresh', value => { result.checks.lostDelayedRefresh = value; }, () => runLostAndDelayedRefreshProof({ origin, chromePort: chrome.port }));
        await runSection('logoutDuringUpdate', value => { result.checks.logoutDuringUpdate = value; }, () => runLogoutDuringUpdateProof({ origin, chromePort: chrome.port }));
        result.finishedAt = new Date().toISOString();
        result.failures = failures;
        result.proofPath = await writeProofArtifact(result);

        const status = failures.length ? 'FAIL' : 'PASS';
        process.stdout.write(JSON.stringify({
            status,
            proofPath: result.proofPath,
            currentSha: CURRENT_SHA,
            candidateAssetHashes: result.candidateAssetHashes,
            fixtureShas: result.fixtureShas,
            failures: failures.map(item => ({ name: item.name, message: item.message.split('\n')[0] })),
            realBfcachePersisted: result.checks.navigationLifecycleOffline?.realBfcachePersisted === true
        }, null, 2) + '\n');
        if (failures.length) {
            throw new Error(`redirect old-tab upgrade proof failed in ${failures.length} section(s); proofPath=${result.proofPath}`);
        }
    } finally {
        await stopChrome(chrome);
        await new Promise(resolve => overlay.close(resolve));
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`[r11-old-tab-upgrade] ${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}


