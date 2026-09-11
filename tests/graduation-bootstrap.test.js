'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../graduation.html'), 'utf8');
const bootstrap = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).find(script => script.includes('GradPage.init()'));

function harness(options = {}) {
    const calls = [];
    const user = { id: 1, role: 'senior_manager' };
    let initialize;
    const context = {
        URLSearchParams,
        location: { search: options.embedded ? '?embedded=1' : '', href: '/graduation' },
        document: {
            addEventListener: (name, handler) => { if (name === 'DOMContentLoaded') initialize = handler; },
            documentElement: { classList: { add() {} } },
            body: { classList: { add() {} } },
            querySelector: () => null,
            getElementById: () => null
        },
        localStorage: { getItem: () => 'fixture-session' },
        AppState: {},
        apiVerifyToken: async () => { calls.push('verify'); return options.user === null ? null : user; },
        hydrateBusinessOperatingProfile: async () => { calls.push('business'); },
        hydrateActionPermissions: async () => { calls.push('permissions'); return options.permissions === null ? null : {}; },
        enforceCurrentPageAccess: () => { calls.push('access'); return options.access !== false; },
        showAuthenticatedPageShell: value => calls.push(value?.markRuntimeReady === false ? 'shell-pending' : 'shell-ready'),
        bindLogoutButton: () => calls.push('logout-bound'),
        clearAuthStorage: () => calls.push('clear-session'),
        clearAuthenticatedPageShell: () => calls.push('clear-shell'),
        getApiAuthSessionFailure: () => ({ retryable: options.transient === true }),
        isApiAuthSessionFailureTransient: failure => failure.retryable,
        renderAuthSessionBootstrapError: () => calls.push('session-error'),
        handleTransientAuthSessionBootstrap: () => {
            if (!options.transient) return false;
            calls.push('shell-pending', 'session-error');
            return true;
        },
        renderPermissionBootstrapError: () => calls.push('permission-error'),
        handleStandaloneInitError: (name, error, render) => render(),
        renderStandaloneFatalError: () => calls.push('fatal-error'),
        Sidebar: { init: selector => calls.push(`sidebar:${selector}`) },
        GradPage: { init: () => calls.push('products-init') },
        console: { error() {} }
    };
    context.window = context;
    context.self = context;
    context.top = context;
    context.parent = context;
    Object.assign(context, options.overrides);
    vm.runInNewContext(bootstrap, context);
    return { calls, context, initialize: () => initialize() };
}

test('graduation verifies session and hydrates permissions before sidebar and product initialization', async () => {
    const run = harness();
    await run.initialize();
    assert.deepEqual(run.calls, ['verify', 'business', 'permissions', 'access', 'shell-ready', 'logout-bound', 'sidebar:#sidebarLinks', 'products-init']);
    assert.equal(run.context.AppState.currentUser.role, 'senior_manager');
});

test('pending permissions cannot start graduation API loads or make the shell ready', async () => {
    let resolve;
    const run = harness({ overrides: { hydrateActionPermissions: () => new Promise(done => { resolve = done; }) } });
    const ready = run.initialize();
    await new Promise(done => setImmediate(done));
    assert.deepEqual(run.calls, ['verify', 'business']);
    resolve({});
    await ready;
    assert.equal(run.calls.at(-1), 'products-init');
});

test('missing permissions and page denial keep graduation uninitialized', async () => {
    const unavailable = harness({ permissions: null });
    await unavailable.initialize();
    assert.deepEqual(unavailable.calls, ['verify', 'business', 'permissions', 'shell-pending', 'permission-error']);
    const denied = harness({ access: false });
    await denied.initialize();
    assert.deepEqual(denied.calls, ['verify', 'business', 'permissions', 'access']);
});

test('transient auth failure preserves the session and exposes the shared retry UI', async () => {
    const run = harness({ user: null, transient: true });
    await run.initialize();
    assert.deepEqual(run.calls, ['verify', 'shell-pending', 'session-error']);
    assert.equal(run.context.location.href, '/graduation');
});

test('terminal session failure returns to login without loading product data', async () => {
    const run = harness({ user: null });
    await run.initialize();
    assert.deepEqual(run.calls, ['verify', 'clear-session', 'clear-shell']);
    assert.equal(run.context.location.href, '/');
});

test('bootstrap exceptions fail closed and embedded initialization retains the existing parent flow', async () => {
    const failed = harness({ overrides: { apiVerifyToken: async () => { throw new Error('fixture failure'); } } });
    await failed.initialize();
    assert.deepEqual(failed.calls, ['fatal-error']);
    const transient = harness({ transient: true, overrides: { apiVerifyToken: async () => { throw new Error('fixture offline'); } } });
    await transient.initialize();
    assert.deepEqual(transient.calls, ['shell-pending', 'session-error']);
    const embedded = harness({ embedded: true });
    await embedded.initialize();
    assert.deepEqual(embedded.calls, ['products-init']);
});
