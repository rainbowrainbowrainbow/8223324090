'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const API_CODE = fs.readFileSync(path.join(__dirname, '../js/api.js'), 'utf8');
const AUTH_CODE = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
const USER_KEY = 'pzp_current_user';
const GENERATION_KEY = 'pzp_auth_session_generation';
const clone = value => JSON.parse(JSON.stringify(value));

function authFunction(name) {
    const start = AUTH_CODE.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing actual auth function: ${name}`);
    const body = AUTH_CODE.indexOf('{', AUTH_CODE.indexOf(')', start));
    let depth = 0;
    for (let index = body; index < AUTH_CODE.length; index += 1) {
        if (AUTH_CODE[index] === '{') depth += 1;
        if (AUTH_CODE[index] === '}' && --depth === 0) return AUTH_CODE.slice(start, index + 1);
    }
    throw new Error(`Unterminated actual auth function: ${name}`);
}

function businessUser(activeBusinessContext, role = 'manager', id = 7) {
    const allowed = ['event_genix', 'dar', 'maysternya_doli'];
    return {
        id, username: `cross.tab.fixture.${id}`, role, roles: [role], extraRoles: [],
        pageAllowlist: [], pageDenylist: [], actionAllowlist: [], actionDenylist: [],
        activeBusinessContext, organizationId: 1, businessContexts: allowed, defaultBusinessContext: 'event_genix',
        businessContextPolicy: { allowed, defaultContext: 'event_genix', canSwitch: true, forced: null },
        accessContext: { status: 'ready', code: null }
    };
}

function sharedStorage(user) {
    const store = new Map([
        [USER_KEY, JSON.stringify(user)], [GENERATION_KEY, 'fixture-generation'],
        ['pzp_access_token', 'fixture-access'], ['pzp_token', 'fixture-access'], ['pzp_refresh_token', 'fixture-refresh']
    ]);
    const tabs = new Map();
    const pending = [];
    const writes = [];
    function write(source, key, value) {
        const oldValue = store.get(key) ?? null;
        const newValue = value === null ? null : String(value);
        if (oldValue === newValue) return;
        if (newValue === null) store.delete(key);
        else store.set(key, newValue);
        writes.push({ source, key, oldValue, newValue, userAtWrite: JSON.parse(store.get(USER_KEY) || 'null') });
        for (const target of tabs.keys()) if (target !== source) pending.push({ target, event: { key, oldValue, newValue } });
    }
    return {
        store, tabs, writes,
        forTab(id) {
            return { getItem: key => store.get(key) ?? null,
                setItem: (key, value) => write(id, key, value), removeItem: key => write(id, key, null) };
        },
        flush() {
            let delivered = 0;
            while (pending.length) {
                assert.ok(++delivered < 100, 'Storage events must converge without a reload loop');
                const { target, event } = pending.shift();
                tabs.get(target).context.handleCrossTabAuthStorageChange(event);
            }
        }
    };
}

function loadTab(hub, id, url, user = JSON.parse(hub.store.get(USER_KEY))) {
    const calls = [];
    const location = new URL(url);
    location.reload = () => calls.push({ type: 'reload', url: location.href });
    let timerId = 0;
    const context = {
        console: { log() {}, warn() {}, error() {} }, URL, URLSearchParams,
        CONFIG: { STORAGE: { CURRENT_USER: USER_KEY, SESSION: 'pzp_session' } },
        AppState: { currentUser: clone(user), authPermissions: { allowed: true } },
        localStorage: hub.forTab(id),
        window: { location, history: { state: {}, replaceState(state, title, next) {
            location.href = String(next); calls.push({ type: 'route', url: location.href });
        } }, addEventListener() {}, dispatchEvent() {}, setTimeout: () => ++timerId, clearTimeout() {} },
        document: { body: { dataset: {} }, documentElement: { classList: { contains: () => false } },
            querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
            getElementById: id => ({ classList: { add: value => calls.push({ type: 'hide', id, value }) } }) },
        fetch: async () => { throw new Error('No network is expected in the cross-tab fixture'); },
        setTimeout: () => ++timerId, clearTimeout() {},
        resetAuthenticatedRuntimeReady: () => calls.push({ type: 'reset-runtime' }),
        clearRuntimePermissionCatalog: target => {
            context.AppState.authPermissions = null;
            delete target.permissions;
            calls.push({ type: 'clear-permissions' });
        },
        clearAuthenticatedPageShell: () => calls.push({ type: 'clear-shell' })
    };
    context.window.self = context.window;
    context.window.top = context.window;
    vm.createContext(context);
    vm.runInContext(API_CODE, context, { filename: 'js/api.js' });
    vm.runInContext([
        "const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';",
        "const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';",
        `const AUTH_SESSION_GENERATION_KEY = '${GENERATION_KEY}';`,
        "const AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';",
        'let crossTabLogoutInProgress = false;', 'let crossTabSessionSyncInProgress = false;',
        ...['readAuthBootstrapStoredUser', 'authBootstrapUsersShareIdentity', 'synchronizeSharedBusinessRoute',
            'handleCrossTabAuthStorageChange'].map(authFunction)
    ].join('\n'), context, { filename: 'js/auth.js' });
    const tab = { context, calls, location };
    hub.tabs.set(id, tab);
    return tab;
}

for (const [previous, next] of [['event_genix', 'dar'], ['dar', 'event_genix']]) {
    test(`${previous}/${next} tabs converge before reload and verifying the adopted business does not rotate again`, () => {
        const user = businessUser(previous);
        const incoming = businessUser(next);
        const hub = sharedStorage(user);
        const source = loadTab(hub, 'source', `http://localhost/tasks?businessContext=${next}`, user);
        const peer = loadTab(hub, 'peer', `http://localhost/dashboard?business_context=${previous}&businessScope=all&businessContexts=event_genix,dar&filter=retained`, user);
        source.context.mergeApiCurrentUser(incoming);
        const generation = hub.store.get(GENERATION_KEY);
        const generationWrite = hub.writes.find(write => write.key === GENERATION_KEY);
        assert.equal(generationWrite.userAtWrite.activeBusinessContext, next,
            'A generation event must expose the accepted user before another tab handles it');
        hub.flush();
        assert.equal(peer.location.searchParams.get('businessContext'), next);
        for (const key of ['business_context', 'businessScope', 'businessContexts']) assert.equal(peer.location.searchParams.has(key), false);
        assert.equal(peer.location.searchParams.get('filter'), 'retained');
        assert.ok(peer.calls.findIndex(call => call.type === 'route') < peer.calls.findIndex(call => call.type === 'reload'));
        assert.equal(peer.calls.filter(call => call.type === 'reload').length, 1);
        assert.equal(peer.context.AppState.currentUser, null);
        assert.equal(peer.context.AppState.authPermissions, null);
        assert.ok(peer.calls.some(call => call.type === 'hide' && call.id === 'mainApp'));

        const reloaded = loadTab(hub, 'peer', peer.location.href);
        assert.equal(reloaded.context.apiAuthBusinessContextHeaders()['X-Business-Context'], next);
        reloaded.context.mergeApiCurrentUser(incoming);
        hub.flush();
        assert.equal(hub.store.get(GENERATION_KEY), generation);
        assert.equal(hub.writes.filter(write => write.key === GENERATION_KEY).length, 1);
        assert.equal(source.calls.filter(call => call.type === 'reload').length, 0);
        assert.equal(reloaded.calls.filter(call => call.type === 'reload').length, 0);
        assert.equal(reloaded.context.getCrmBusinessContext(), next);
    });
}

test('same-business role revocation still clears the peer grants and reloads exactly once', () => {
    const user = businessUser('dar');
    user.permissions = { capabilities: { 'action:view_revenue': { allowed: true } } };
    const hub = sharedStorage(user);
    const source = loadTab(hub, 'source', 'http://localhost/tasks?businessContext=dar', user);
    const peer = loadTab(hub, 'peer', 'http://localhost/finance?businessContext=dar', user);
    source.context.mergeApiCurrentUser(businessUser('dar', 'animator'));
    hub.flush();
    assert.equal(peer.context.AppState.currentUser, null);
    assert.equal(peer.context.AppState.authPermissions, null);
    assert.equal(peer.calls.filter(call => call.type === 'reload').length, 1);
    assert.equal(peer.calls.filter(call => call.type === 'route').length, 0);
    assert.equal(JSON.parse(hub.store.get(USER_KEY)).role, 'animator');
    assert.equal(Object.hasOwn(JSON.parse(hub.store.get(USER_KEY)), 'permissions'), false);
});

test('account replacement keeps identity isolation and never adopts the foreign account route', () => {
    const user = businessUser('event_genix');
    const hub = sharedStorage(user);
    const source = loadTab(hub, 'source', 'http://localhost/tasks?businessContext=dar', user);
    const peer = loadTab(hub, 'peer', 'http://localhost/dashboard?businessContext=event_genix', user);
    source.context.mergeApiCurrentUser(businessUser('dar', 'manager', 99), { allowIdentityChange: true });
    hub.flush();
    assert.equal(peer.context.AppState.currentUser, null);
    assert.equal(peer.context.AppState.authPermissions, null);
    assert.equal(peer.calls.filter(call => call.type === 'reload').length, 1);
    assert.equal(peer.calls.filter(call => call.type === 'route').length, 0);
    assert.equal(peer.location.searchParams.get('businessContext'), 'event_genix');
    assert.equal(hub.store.get('pzp_refresh_token'), 'fixture-refresh');
});

test('a forced Maysternya route relinquishes its old cabinet before the peer reloads into Dar', () => {
    const user = businessUser('maysternya_doli');
    const hub = sharedStorage(user);
    const source = loadTab(hub, 'source', 'http://localhost/tasks?businessContext=dar', user);
    const peer = loadTab(hub, 'peer', 'http://localhost/maysternya-doli.html?business_scope=all&view=retained', user);
    source.context.mergeApiCurrentUser(businessUser('dar'));
    hub.flush();
    assert.equal(peer.location.pathname, '/');
    assert.equal(peer.location.searchParams.get('businessContext'), 'dar');
    assert.equal(peer.location.searchParams.get('view'), 'retained');
    assert.equal(peer.location.searchParams.has('business_scope'), false);
    assert.equal(peer.calls.filter(call => call.type === 'reload').length, 1);
    const reloaded = loadTab(hub, 'peer', peer.location.href);
    assert.equal(reloaded.context.apiAuthBusinessContextHeaders()['X-Business-Context'], 'dar');
});
