'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const AUTH_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');

function extractFunction(source, functionName) {
    const functionStart = source.indexOf(`function ${functionName}`);
    assert.ok(functionStart >= 0, `${functionName} is missing`);
    const bodyStart = source.indexOf('{', source.indexOf('(', functionStart));
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(functionStart, index + 1);
        }
    }
    throw new Error(`Could not extract ${functionName}`);
}

function memoryStorage(options = {}) {
    const values = new Map();
    return {
        getItem(key) {
            if (options.throwOnGet) throw new Error('storage get failed');
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            if (options.throwOnSet) throw new Error('storage set failed');
            values.set(key, String(value));
        },
        removeItem(key) {
            if (options.throwOnRemove) throw new Error('storage remove failed');
            values.delete(key);
        },
        raw(key) {
            return values.get(key) || '';
        }
    };
}

function installHarness(options = {}) {
    let currentNow = options.now || Date.parse('2026-09-05T12:00:00Z');
    class FakeDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [currentNow]));
        }
        static now() {
            return currentNow;
        }
    }
    const localStorage = options.localStorage || memoryStorage();
    const sessionStorage = options.sessionStorage || memoryStorage();
    const window = {
        localStorage,
        sessionStorage,
        location: {
            href: 'https://crm.example/certificates/123?token=secret#frag',
            origin: 'https://crm.example',
            pathname: '/certificates/123'
        },
        document: {
            visibilityState: 'visible',
            scripts: [{
                src: 'https://crm.example/js/auth.js?v=0.81.80',
                getAttribute(name) {
                    return name === 'src' ? '/js/auth.js?v=0.81.80' : '';
                }
            }]
        },
        navigator: {
            serviceWorker: {
                controller: { scriptURL: 'https://crm.example/sw.js' }
            },
            clipboard: options.clipboard || null
        },
        crypto: {
            getRandomValues(buffer) {
                for (let index = 0; index < buffer.length; index += 1) buffer[index] = index + 1;
                return buffer;
            }
        },
        Math
    };
    const context = {
        window,
        Date: FakeDate,
        URL,
        JSON,
        Math,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Set,
        Uint8Array
    };
    vm.runInNewContext(`${extractFunction(AUTH_SOURCE, 'installRedirectDiagnosticsRuntime')}; installRedirectDiagnosticsRuntime(window);`, context);
    return {
        window,
        localStorage,
        sessionStorage,
        setNow(value) { currentNow = value; }
    };
}

test('RedirectDiagnostics redacts route/query/body-like fields and exports only allowlisted metadata', () => {
    const harness = installHarness();
    const diagnostics = harness.window.RedirectDiagnostics;
    diagnostics.record('auth-session-failure', {
        route: '/customers/987654?token=access.secret&password=hunter2#jwt',
        targetRoute: '/certificates/550e8400-e29b-41d4-a716-446655440000?client=Jane',
        stage: 'Verify User',
        status: 429,
        code: 'AUTH_AVAILABILITY_RATE_LIMITED',
        reason: 'Rate Limit Retry Later',
        requestId: 'req_abc-123',
        Authorization: 'Bearer should-not-appear',
        refreshToken: 'refresh-secret',
        password: 'hunter2',
        responseBody: { customerName: 'Jane Customer' }
    });

    const exported = diagnostics.export();
    assert.equal(exported.entries.length, 1);
    assert.deepEqual(Object.keys(exported.entries[0]).sort(), [
        'at',
        'buildVersion',
        'code',
        'event',
        'reason',
        'requestId',
        'route',
        'stage',
        'status',
        'swVersion',
        'tabId',
        'targetRoute',
        'visibility'
    ].sort());
    assert.equal(exported.entries[0].route, '/customers/:id');
    assert.equal(exported.entries[0].targetRoute, '/certificates/:id');
    assert.equal(exported.entries[0].status, 429);
    assert.equal(exported.entries[0].code, 'auth_availability_rate_limited');
    assert.equal(exported.entries[0].requestId, 'req_abc-123');
    const serialized = JSON.stringify(exported);
    for (const forbidden of ['access.secret', 'hunter2', 'refresh-secret', 'Bearer', 'Jane Customer', '?token', '#jwt']) {
        assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into diagnostics`);
    }
});

test('RedirectDiagnostics applies deduplication, expiry, entry cap, and storage size cap', () => {
    const harness = installHarness();
    const diagnostics = harness.window.RedirectDiagnostics;
    const base = Date.parse('2026-09-05T12:00:00Z');
    diagnostics.record('auth-bootstrap', { route: '/sales-funnel', stage: 'start', reason: 'same' });
    harness.setNow(base + 500);
    diagnostics.record('auth-bootstrap', { route: '/sales-funnel', stage: 'start', reason: 'same' });
    let exported = diagnostics.export();
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0].count, 2);

    harness.setNow(base + 3000);
    for (let index = 0; index < 120; index += 1) {
        diagnostics.record('navigation-click', {
            route: `/customers/${1000 + index}`,
            targetRoute: `/certificates/${1000 + index}`,
            stage: `stage-${index}`,
            reason: `reason-${index}`,
            requestId: `request-${index}`
        });
        harness.setNow(base + 3000 + index * 5);
    }
    exported = diagnostics.export();
    assert.ok(exported.entries.length <= diagnostics.limits.maxEntries);
    assert.ok(harness.localStorage.raw(diagnostics.storageKey).length <= diagnostics.limits.maxStorageBytes);
    assert.equal(exported.entries.some(entry => entry.stage === 'start'), false, 'old capped entry should be pruned');

    harness.setNow(base + diagnostics.limits.maxEntryAgeMs + 120000);
    diagnostics.record('auth-bootstrap', { route: '/sales-funnel/42', stage: 'unknown', reason: 'unknown' });
    exported = diagnostics.export();
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0].route, '/sales-funnel/:id');
});

test('RedirectDiagnostics fails open when storage or clipboard is unavailable', async () => {
    const localStorage = memoryStorage({ throwOnGet: true, throwOnSet: true, throwOnRemove: true });
    const harness = installHarness({ localStorage });
    const diagnostics = harness.window.RedirectDiagnostics;
    assert.doesNotThrow(() => diagnostics.record('auth-storage-clear', {
        route: '/profile/123?password=secret',
        storageClearReason: 'logout'
    }));
    const exported = diagnostics.export();
    assert.equal(exported.schema, 'eventgenix.redirect-diagnostics.v1');
    assert.equal(exported.entries.length, 0);
    const copyResult = await diagnostics.copy();
    assert.equal(copyResult.copied, false);
    assert.equal(copyResult.text.includes('password=secret'), false);
});

const SW_SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

async function offlineNavigationHtml(url = 'https://crm.example/customers/alice%40example.com?token=secret#frag') {
    const context = {
        CACHE_NAME: 'event-genix-vr5-test',
        URL,
        Request,
        Response
    };
    vm.runInNewContext(`
        ${extractFunction(SW_SOURCE, 'escapeOfflineHtml')}
        ${extractFunction(SW_SOURCE, 'offlineNavigationResponse')}
        result = offlineNavigationResponse(new Request(${JSON.stringify(url)})).text();
    `, context);
    return context.result;
}

function extractInlineOfflineScript(html) {
    const match = String(html).match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(match, 'offline page script is missing');
    return match[1];
}

test('RedirectDiagnostics uses route templates and controlled reason/code values', () => {
    const harness = installHarness();
    const diagnostics = harness.window.RedirectDiagnostics;
    diagnostics.record('auth-session-failure', {
        route: '/customers/alice%40example.com?token=secret#frag',
        targetRoute: '/customers/7?client=alice',
        stage: 'verify',
        status: 429,
        code: 'DROP TABLE users',
        reason: 'Bearer abc.def customer Alice',
        requestId: 'req-safe-1'
    });

    const entry = diagnostics.export().entries[0];
    assert.equal(entry.route, '/customers/:id');
    assert.equal(entry.targetRoute, '/customers/:id');
    assert.equal(entry.code, 'unknown');
    assert.equal(entry.reason, 'unknown');
    const serialized = JSON.stringify(entry);
    for (const forbidden of ['alice', 'example.com', 'abc.def', 'DROP TABLE', '?token', '#frag']) {
        assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into diagnostics`);
    }
});

test('RedirectDiagnostics export re-sanitizes old malformed storage entries', () => {
    const localStorage = memoryStorage();
    const staleAt = Date.parse('2026-09-01T12:00:00Z');
    const currentAt = Date.parse('2026-09-05T12:00:00Z');
    localStorage.setItem('pzp_redirect_diagnostics_v1', JSON.stringify({
        schema: 'eventgenix.redirect-diagnostics.v1',
        entries: [
            { event: 'auth-refresh', at: staleAt, route: '/customers/stale@example.com', reason: 'network', token: 'secret-token' },
            {
                event: 'navigation-click',
                at: currentAt,
                tabId: 'tab-a',
                route: '/customers/alice%40example.com?password=secret',
                targetRoute: '/certificates/7?client=alice',
                visibility: 'visible',
                stage: 'sidebar-click',
                reason: 'Bearer secret',
                code: 'auth_availability_rate_limited',
                requestId: 'req_123',
                responseBody: { customer: 'Alice' }
            },
            'corrupt'
        ]
    }));
    const harness = installHarness({ localStorage, now: currentAt });
    const exported = harness.window.RedirectDiagnostics.export();
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0].route, '/customers/:id');
    assert.equal(exported.entries[0].targetRoute, '/certificates/:id');
    assert.equal(exported.entries[0].reason, 'unknown');
    assert.deepEqual(Object.keys(exported.entries[0]).sort(), [
        'at',
        'buildVersion',
        'code',
        'event',
        'reason',
        'requestId',
        'route',
        'stage',
        'swVersion',
        'tabId',
        'targetRoute',
        'visibility'
    ].sort());
    const serialized = JSON.stringify(exported);
    for (const forbidden of ['secret-token', 'Alice', 'password=secret', 'stale@example.com']) {
        assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked from old storage`);
    }
});

test('RedirectDiagnostics dedup keeps separate tab ids distinct', () => {
    const harness = installHarness();
    const diagnostics = harness.window.RedirectDiagnostics;
    harness.sessionStorage.setItem('pzp_redirect_diagnostics_tab_id', 'tab-alpha');
    diagnostics.record('navigation-click', { route: '/sales-funnel', stage: 'sidebar-click', targetRoute: '/certificates' });
    harness.sessionStorage.setItem('pzp_redirect_diagnostics_tab_id', 'tab-beta');
    diagnostics.record('navigation-click', { route: '/sales-funnel', stage: 'sidebar-click', targetRoute: '/certificates' });
    const exported = diagnostics.export();
    assert.equal(exported.entries.length, 2);
    assert.deepEqual(exported.entries.map(entry => entry.tabId), ['tab-alpha', 'tab-beta']);
});

test('RedirectDiagnostics swVersion is true controller revision or unknown, not script pathname', async () => {
    let savedPort = null;
    class FakeMessageChannel {
        constructor() {
            this.port1 = { onmessage: null };
            this.port2 = { postMessage() {} };
            savedPort = this.port1;
        }
    }
    const harness = installHarness({
        localStorage: memoryStorage(),
        sessionStorage: memoryStorage()
    });
    harness.window.MessageChannel = FakeMessageChannel;
    harness.window.navigator.serviceWorker.controller = {
        scriptURL: 'https://crm.example/sw.js',
        postMessage(message) {
            assert.equal(message.type, 'redirect-diagnostics:get-version');
            setTimeout(() => {
                savedPort.onmessage({ data: { type: 'redirect-diagnostics:version', swVersion: 'event-genix-vr5-controller' } });
            }, 0);
        }
    };
    assert.equal(harness.window.RedirectDiagnostics.export().swVersion, 'unknown');
    await harness.window.RedirectDiagnostics.refreshServiceWorkerVersion();
    assert.equal(harness.window.RedirectDiagnostics.export().swVersion, 'event-genix-vr5-controller');
});

test('Service Worker offline writer applies the same redaction and export bounds', async () => {
    const html = await offlineNavigationHtml();
    const script = extractInlineOfflineScript(html);
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const now = Date.parse('2026-09-05T12:00:00Z');
    const oversizedEntries = Array.from({ length: 140 }, (_, index) => ({
        event: 'navigation-click',
        at: now - 1000 + index,
        tabId: `tab-${index}`,
        route: `/customers/${index}?token=secret`,
        reason: 'network',
        responseBody: 'private-customer-body'.repeat(20)
    }));
    oversizedEntries.unshift({
        event: 'auth-refresh',
        at: now - 3 * 24 * 60 * 60 * 1000,
        tabId: 'tab-stale',
        route: '/customers/stale@example.com',
        reason: 'network'
    });
    localStorage.setItem('pzp_redirect_diagnostics_v1', JSON.stringify({
        schema: 'eventgenix.redirect-diagnostics.v1',
        entries: oversizedEntries
    }));
    vm.runInNewContext(script, {
        Date: class extends Date {
            constructor(...args) { super(...(args.length ? args : [now])); }
            static now() { return now; }
        },
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        localStorage,
        sessionStorage,
        document: { visibilityState: 'visible' },
        location: {
            pathname: '/customers/alice%40example.com',
            href: 'https://crm.example/customers/alice%40example.com?token=secret#frag'
        },
        window: { addEventListener() {} },
        setTimeout() {}
    });
    const harness = installHarness({ localStorage, sessionStorage, now });
    const exported = harness.window.RedirectDiagnostics.export();
    assert.ok(exported.entries.length <= harness.window.RedirectDiagnostics.limits.maxEntries);
    assert.ok(localStorage.raw(harness.window.RedirectDiagnostics.storageKey).length <= harness.window.RedirectDiagnostics.limits.maxStorageBytes);
    const last = exported.entries.at(-1);
    assert.equal(last.event, 'sw-offline-navigation');
    assert.equal(last.route, '/customers/:id');
    assert.equal(last.swVersion, 'event-genix-vr5-test');
    const serialized = JSON.stringify(exported);
    for (const forbidden of ['alice', 'example.com', 'private-customer-body', '?token', '#frag', 'stale@example.com']) {
        assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked through SW writer/export`);
    }
});
