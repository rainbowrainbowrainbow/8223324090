'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'dashboard-page.js'), 'utf8');
const DASHBOARD_HTML = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

function dashboardConfig() {
    return {
        widgets: [],
        mode: 'workspace',
        layout: {},
        boardState: {
            items: [],
            drawings: [],
            connectors: [],
            preferences: {}
        }
    };
}

function response(payload = {}, options = {}) {
    return {
        ok: options.ok !== false,
        status: options.status || 200,
        json: async () => payload
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function loadDashboardHarness(options = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="loginScreen"></div>
        <div id="mainApp" class="hidden"></div>
        <span id="currentUser"></span>
        <main id="main-content">
            <div id="dashboardGrid"></div>
            <section id="dashboardBoardShell" class="dashboard-board-shell hidden">
                <div id="dashboardBoardCanvas"></div>
            </section>
            <div id="dashboardBoardToolbar"></div>
            <div id="boardEditControls"></div>
            <div id="boardToolOptions"></div>
            <button id="dashboardBoardModeBtn"></button>
            <span id="boardUnifiedModeLabel"></span>
            <button id="boardUndoBtn"></button>
            <button id="boardRedoBtn"></button>
            <span id="boardSaveStatus"></span>
        </main>
    </body></html>`, {
        url: 'http://localhost/dashboard',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const calls = [];
    const requests = [];
    const user = options.user || { id: 42, username: 'manager.one', name: 'Manager One', role: 'manager' };
    const permissionQueue = Array.isArray(options.permissions)
        ? [...options.permissions]
        : [{ ok: true }];
    let generation = options.generation || 'session-1';

    dom.window.localStorage.setItem('pzp_token', 'token-1');
    dom.window.localStorage.setItem('pzp_auth_session_generation', generation);
    dom.window.localStorage.setItem('pzp_current_user', JSON.stringify(user));
    dom.window.console = {
        ...console,
        error: () => calls.push('console-error'),
        warn: () => calls.push('console-warn')
    };
    dom.window.AppState = { currentUser: null };
    dom.window.apiHasStoredAuthSession = () => options.hasStoredSession !== false;
    dom.window.apiVerifyToken = async () => {
        calls.push('verify');
        if (options.verifyDeferred) await options.verifyDeferred.promise;
        return options.verifyUser === undefined ? { ...user } : options.verifyUser;
    };
    dom.window.captureAuthBootstrapSession = authUser => {
        calls.push('capture');
        return {
            generation,
            identity: { id: authUser?.id ?? null, username: authUser?.username || '' },
            hadStoredUser: true
        };
    };
    dom.window.isAuthBootstrapSessionCurrent = (snapshot, authUser) => {
        calls.push('session-current');
        return generation === String(snapshot?.generation || '')
            && String(authUser?.id || '') === String(snapshot?.identity?.id || '');
    };
    dom.window.authBootstrapSessionChangedError = stage => {
        const error = new Error('session changed');
        error.code = 'auth_session_transient';
        error.authFailure = { kind: 'transient', transient: true, stage, reason: 'session-changed' };
        return error;
    };
    dom.window.hydrateBusinessOperatingProfile = async authUser => {
        calls.push('profile');
        if (options.changeSessionDuringProfile) {
            generation = 'session-2';
            dom.window.localStorage.setItem('pzp_auth_session_generation', generation);
        }
        authUser.businessProfile = { key: 'event_genix' };
        return authUser.businessProfile;
    };
    dom.window.hydrateActionPermissions = async () => {
        calls.push('permissions');
        return permissionQueue.length ? permissionQueue.shift() : { ok: true };
    };
    dom.window.enforceCurrentPageAccess = () => {
        calls.push('access');
        return options.access !== false;
    };
    dom.window.getApiAuthSessionFailure = () => ({ status: 503, retryable: true, stage: 'dashboard-test' });
    dom.window.isApiAuthSessionFailureTransient = () => true;
    dom.window.showAuthenticatedPageShell = shellOptions => {
        calls.push(shellOptions?.markRuntimeReady === false ? 'show-shell-pending' : 'show-shell-ready');
        dom.window.document.body.classList.add('authenticated-shell', 'shell-ready');
        dom.window.document.getElementById('mainApp').classList.remove('hidden');
    };
    dom.window.renderPermissionBootstrapError = errorOptions => {
        calls.push('permission-error');
        dom.window.__permissionRetry = errorOptions.retry;
    };
    dom.window.renderAuthSessionBootstrapError = errorOptions => {
        calls.push('auth-error');
        dom.window.__authRetry = errorOptions.retry;
    };
    dom.window.Sidebar = { initUserCard: () => calls.push('sidebar-user-card') };
    dom.window.WorkingRole = { hydrate: () => calls.push('working-role') };
    dom.window.getUserRole = () => 'manager';
    dom.window.hasMinRole = role => role === 'manager';
    dom.window.canAccessPage = () => true;
    dom.window.resolveCapability = () => ({ allowed: false });
    dom.window.CrmBusinessContext = {
        current: () => 'event_genix',
        scope: () => ({ mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] }),
        apiUrl: url => url
    };
    dom.window.fetch = async url => {
        const value = String(url);
        calls.push(`fetch:${value}`);
        requests.push(value);
        if (value === '/api/dashboard/config') return response({ success: true, config: dashboardConfig() });
        return response({ success: true, data: {} });
    };
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};

    const nativeAddEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, listenerOptions) => {
        if (type === 'DOMContentLoaded') return;
        nativeAddEventListener(type, listener, listenerOptions);
    };

    vm.runInContext(DASHBOARD_SOURCE, dom.getInternalVMContext(), {
        filename: 'js/dashboard-page.js'
    });

    return {
        calls,
        requests,
        dom,
        DashboardPage: vm.runInContext('DashboardPage', dom.getInternalVMContext())
    };
}

test('dashboard init hydrates business profile and permissions before dashboard data requests', async () => {
    const harness = loadDashboardHarness();

    assert.equal(await harness.DashboardPage.init(), true);

    const permissionIndex = harness.calls.indexOf('permissions');
    const accessIndex = harness.calls.indexOf('access');
    const configIndex = harness.calls.findIndex(call => call === 'fetch:/api/dashboard/config');
    assert.ok(permissionIndex > -1, 'permissions were not hydrated');
    assert.ok(accessIndex > permissionIndex, 'access was checked before permissions finished');
    assert.ok(configIndex > accessIndex, 'dashboard config loaded before access was enforced');
});

test('dashboard permission bootstrap failure does not request config and can retry', async () => {
    const harness = loadDashboardHarness({ permissions: [null, { ok: true }] });

    assert.equal(await harness.DashboardPage.init(), false);
    assert.equal(harness.requests.length, 0);
    assert.ok(harness.calls.includes('permission-error'));

    assert.equal(await harness.DashboardPage.init(), true);
    assert.equal(harness.requests.filter(url => url === '/api/dashboard/config').length, 1);
    assert.equal(harness.calls.filter(call => call === 'verify').length, 2);
});

test('dashboard session change during bootstrap does not apply stale permissions or config', async () => {
    const harness = loadDashboardHarness({ changeSessionDuringProfile: true });

    assert.equal(await harness.DashboardPage.init(), false);

    assert.ok(harness.calls.includes('auth-error'));
    assert.equal(harness.calls.includes('permissions'), false);
    assert.equal(harness.requests.length, 0);
});

test('dashboard init coalesces duplicate startup calls', async () => {
    const verifyDeferred = deferred();
    const harness = loadDashboardHarness({ verifyDeferred });

    const first = harness.DashboardPage.init();
    const second = harness.DashboardPage.init();
    verifyDeferred.resolve();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);

    assert.equal(harness.calls.filter(call => call === 'verify').length, 1);
    assert.equal(harness.requests.filter(url => url === '/api/dashboard/config').length, 1);
});

test('dashboard html delegates session load to DashboardPage init', () => {
    assert.doesNotMatch(DASHBOARD_HTML, /Check session on load/);
    assert.doesNotMatch(DASHBOARD_HTML, /const user = await apiVerifyToken\(\)/);
});
