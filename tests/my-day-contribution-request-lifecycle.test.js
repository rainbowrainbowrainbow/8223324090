'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'js', 'my-day-contribution.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function response(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return body;
        }
    };
}

function successBody(extra = {}) {
    return {
        success: true,
        range: { from: '2026-08-01', to: '2026-08-03', timezone: 'Europe/Kyiv' },
        totals: { taskCount: 0, taskMinutes: 0, habitCompletions: 0, habitMinutes: 0 },
        directions: [],
        impacts: [],
        days: [],
        ...extra
    };
}

function createHarness(options = {}) {
    const calls = [];
    const authHeaderModes = [];
    const contextUrls = [];
    const handledAuthStatuses = [];
    const timers = [];
    const window = {
        getAuthHeaders(withContentType) {
            authHeaderModes.push(withContentType);
            return { Authorization: 'Bearer test-token', 'X-Business-Context': 'event_genix' };
        },
        CrmBusinessContext: {
            apiUrl(url) {
                contextUrls.push(url);
                const separator = url.includes('?') ? '&' : '?';
                return `${url}${separator}businessContext=event_genix`;
            }
        },
        handleAuthError(res) {
            handledAuthStatuses.push(res.status);
            return res.status === 401;
        }
    };
    const fetchImpl = options.fetchImpl || (async () => response(200, successBody()));
    const sandbox = {
        window,
        AbortController,
        URLSearchParams,
        Intl,
        Date,
        Promise,
        Number,
        String,
        setTimeout: options.setTimeout || ((fn, ms) => {
            timers.push(ms);
            return setTimeout(fn, ms);
        }),
        clearTimeout: options.clearTimeout || clearTimeout,
        fetch(url, fetchOptions) {
            calls.push({ url, options: fetchOptions });
            return fetchImpl(url, fetchOptions);
        }
    };
    vm.runInNewContext(source, sandbox, { filename: sourcePath });
    return { api: window.MyDayContribution, authHeaderModes, calls, contextUrls, handledAuthStatuses, timers };
}

test('contribution load uses canonical auth/context and coalesces one pending request', async () => {
    const pending = deferred();
    const harness = createHarness({ fetchImpl: () => pending.promise });

    const first = harness.api.load();
    const second = harness.api.load();

    assert.strictEqual(second, first);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.authHeaderModes[0], false);
    assert.equal(harness.calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(harness.calls[0].options.headers.Accept, 'application/json');
    assert.match(harness.contextUrls[0], /^\/api\/my-day\/contribution\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    assert.match(harness.calls[0].url, /businessContext=event_genix/);

    pending.resolve(response(200, successBody({ marker: 'loaded' })));
    await first;
    assert.equal(harness.api.state.loaded, true);
    assert.equal(harness.api.state.data.marker, 'loaded');
});

test('401 and 429 failures render one error and do not retry without explicit force', async () => {
    const unauthorized = createHarness({ fetchImpl: async () => response(401, { success: false }) });
    await unauthorized.api.load();
    assert.equal(unauthorized.calls.length, 1);
    assert.deepEqual(unauthorized.handledAuthStatuses, [401]);
    assert.match(unauthorized.api.state.error, /повторна авторизація/);
    await unauthorized.api.load();
    assert.equal(unauthorized.calls.length, 1);

    const limited = createHarness({ fetchImpl: async () => response(429, { success: false }) });
    await limited.api.load();
    assert.equal(limited.calls.length, 1);
    assert.match(limited.api.state.error, /Забагато запитів/);
    await limited.api.load();
    assert.equal(limited.calls.length, 1);

    limited.calls.length = 0;
    limited.api.state.error = 'previous error';
    await limited.api.load(true).catch(() => {});
    assert.equal(limited.calls.length, 1);
});

test('timeout is capped at 15 seconds and does not spin another request', async () => {
    let timeoutMs = 0;
    const harness = createHarness({
        setTimeout(fn, ms) {
            timeoutMs = ms;
            return setImmediate(fn);
        },
        clearTimeout(id) {
            clearImmediate(id);
        },
        fetchImpl(url, options) {
            return new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    const error = new Error('aborted');
                    error.name = 'AbortError';
                    reject(error);
                });
            });
        }
    });

    await harness.api.load();
    assert.equal(timeoutMs, 15000);
    assert.equal(harness.calls.length, 1);
    assert.match(harness.api.state.error, /15 секунд/);
    await harness.api.load();
    assert.equal(harness.calls.length, 1);
});

test('cancelled and stale contribution requests cannot overwrite current state', async () => {
    const pending = [];
    const harness = createHarness({
        fetchImpl() {
            const item = deferred();
            pending.push(item);
            return item.promise;
        }
    });

    const first = harness.api.load();
    assert.equal(harness.api.state.loading, true);
    harness.api.cancel('mode-exit');
    assert.equal(harness.calls[0].options.signal.aborted, true);
    assert.equal(harness.api.state.loading, false);
    pending[0].resolve(response(200, successBody({ marker: 'cancelled' })));
    await first;
    assert.equal(harness.api.state.loaded, false);
    assert.equal(harness.api.state.data, null);

    const oldRequest = harness.api.load();
    const freshRequest = harness.api.load(true);
    assert.equal(harness.calls.length, 3);
    pending[2].resolve(response(200, successBody({ marker: 'fresh' })));
    await freshRequest;
    assert.equal(harness.api.state.loaded, true);
    assert.equal(harness.api.state.data.marker, 'fresh');
    pending[1].resolve(response(200, successBody({ marker: 'old' })));
    await oldRequest;
    assert.equal(harness.api.state.data.marker, 'fresh');
});

test('profile binding, mode switch, and smoke guard against contribution request loops', () => {
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const habits = fs.readFileSync(path.join(root, 'js', 'my-day-habits.js'), 'utf8');
    const smoke = fs.readFileSync(path.join(root, 'scripts', 'live-my-day-smoke.js'), 'utf8');

    assert.match(profile, /MyDayContribution\.state\.loading && !window\.MyDayContribution\.state\.error/);
    assert.match(habits, /MyDayContribution\?\.cancel\?\.\('mode-exit'\)/);
    assert.match(habits, /!window\.MyDayContribution\.state\.error/);
    assert.match(smoke, /one Contribution open sends exactly one GET/);
    assert.match(smoke, /aria-busy'\) === 'false'/);
    assert.match(smoke, /leaving Contribution sends no additional GET/);
});