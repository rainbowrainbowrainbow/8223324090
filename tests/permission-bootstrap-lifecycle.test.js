'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');

function response(status, body = {}) {
    return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

function permissionsBody() {
    return {
        capabilityCatalog: { pageRoles: { '/hr': ['creator'] }, actionRoles: { 'hr.today.view': ['creator'] } },
        capabilities: { 'page:/hr': { allowed: true }, 'action:hr.today.view': { allowed: true } },
        pageAllowlist: [], actionAllowlist: [], actionDenylist: []
    };
}

function loadHarness(fetchImpl) {
    const start = AUTH.indexOf('const PERMISSION_RETRY_DELAY_MS');
    const end = AUTH.indexOf('function hasStoredRefreshSession', start);
    assert.ok(start >= 0 && end > start, 'permission lifecycle source block must exist');
    const store = new Map();
    const context = {
        AppState: {},
        PAGE_ACCESS: Object.create(null), ACTION_PERMISSIONS: Object.create(null),
        PAGE_CAPABILITY_ALIASES: Object.create(null), ACTION_CAPABILITY_ALIASES: Object.create(null),
        ACTION_LEGACY_KEYS: Object.create(null), EXPLICIT_ALLOW_DISABLED_PAGES: new Set(), NON_DELEGABLE_ACTIONS: new Set(),
        AUTH_ACCESS_TOKEN_KEY: 'pzp_access_token', CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } },
        localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, String(value)) },
        getAuthHeaders: () => ({ Authorization: 'Bearer test' }), fetch: fetchImpl,
        setTimeout: callback => { callback(); }, Date, Error, Object, Number, Set,
        window: { dispatchEvent() {} }, document: { getElementById() { return null; } }, console
    };
    vm.createContext(context);
    vm.runInContext(AUTH.slice(start, end), context, { filename: 'js/auth.js' });
    return context;
}

test('401 and 403 permissions failures do not retry or masquerade as zero access', async () => {
    for (const status of [401, 403]) {
        let calls = 0;
        const context = loadHarness(async () => { calls += 1; return response(status); });
        const result = await context.hydrateActionPermissions({ role: 'creator' }, { retryDelayMs: 0 });
        const lifecycle = context.getPermissionLifecycle();
        assert.equal(result, null);
        assert.equal(calls, 1);
        assert.equal(lifecycle.status, 'error');
        assert.equal(lifecycle.failure.status, status);
        assert.equal(lifecycle.failure.retryable, false);
        assert.equal(context.AppState.authPermissions, null);
    }
});

test('500 retries once and recovers permissions without a page reload', async () => {
    let calls = 0;
    const context = loadHarness(async () => {
        calls += 1;
        return calls === 1 ? response(500) : response(200, permissionsBody());
    });
    const user = { role: 'creator' };
    const result = await context.hydrateActionPermissions(user, { retryDelayMs: 0 });
    assert.deepEqual(result.capabilityCatalog.pageRoles['/hr'], ['creator']);
    assert.equal(calls, 2);
    assert.equal(context.getPermissionLifecycle().status, 'ready');
    assert.equal(user.permissions.capabilities['page:/hr'].allowed, true);
});

test('network failure retries once, then remains an explicit permissions error', async () => {
    let calls = 0;
    const context = loadHarness(async () => { calls += 1; throw new Error('network unavailable'); });
    const result = await context.hydrateActionPermissions({ role: 'creator' }, { retryDelayMs: 0 });
    const lifecycle = context.getPermissionLifecycle();
    assert.equal(result, null);
    assert.equal(calls, 2);
    assert.equal(lifecycle.status, 'error');
    assert.equal(lifecycle.failure.status, 0);
    assert.equal(lifecycle.failure.retryable, true);
});

test('persistent 500 failure remains explicit after exactly one retry', async () => {
    let calls = 0;
    const context = loadHarness(async () => { calls += 1; return response(500); });
    assert.equal(await context.hydrateActionPermissions({ role: 'creator' }, { retryDelayMs: 0 }), null);
    assert.equal(calls, 2);
    assert.equal(context.getPermissionLifecycle().status, 'error');
});

test('HR Pulse waits for ready permissions and only then may render its zero-access state', () => {
    const hr = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const navStart = hr.indexOf('function renderHrNav');
    const navEnd = hr.indexOf('function hashForHrTarget', navStart);
    const nav = hr.slice(navStart, navEnd);
    assert.match(nav, /getPermissionLifecycle\(\)[\s\S]*status !== 'ready'/);
    assert.match(nav, /data-permission-state="loading"/);
    assert.match(nav, /Немає доступних HR-розділів/);
    assert.match(hr, /const permissions = typeof hydrateActionPermissions[\s\S]*if \(!permissions\)[\s\S]*renderPermissionBootstrapError[\s\S]*return;/);
});

test('every affected bootstrap gates content on successful permissions hydration', () => {
    const files = ['js/hr-page.js', 'js/staff-page.js', 'js/training-page.js', 'js/finance-page.js', 'checkin.html'];
    for (const file of files) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        assert.match(source, /hydrateActionPermissions/, `${file} must hydrate permissions`);
        assert.match(source, /renderPermissionBootstrapError|Не вдалося завантажити права доступу/, `${file} must show a distinct permissions failure state`);
    }
});
test('affected pages wire retry to their own bootstrap without a reload', () => {
    const expectedRetries = {
        'js/hr-page.js': 'retry: initPage',
        'js/staff-page.js': 'retry: () => initStaffSchedulePage(options)',
        'js/training-page.js': 'retry: initializeTrainingPage',
        'js/finance-page.js': 'retry: initFinancePage'
    };
    for (const [file, retry] of Object.entries(expectedRetries)) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        assert.ok(source.includes(retry), `${file} must retry its own bootstrap`);
    }
    const checkin = fs.readFileSync(path.join(ROOT, 'checkin.html'), 'utf8');
    assert.match(checkin, /setRetryVisible\(true\)[\s\S]*return false/);
    assert.match(checkin, /retryCheckinInitialization = initializeCheckin/);
});