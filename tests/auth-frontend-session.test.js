const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const API_CODE = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
const AUTH_CODE = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const ALERTS_CODE = fs.readFileSync(path.join(ROOT, 'js', 'alerts.js'), 'utf8');
const APP_CODE = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const TIMELINE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'timeline.js'), 'utf8');
const TIMELINE_VISIBILITY_CODE = fs.readFileSync(path.join(ROOT, 'js', 'timeline-visibility.js'), 'utf8');
const SIDEBAR_CODE = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
const TASKS_PAGE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
const HR_PAGE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const PROFILE_PAGE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
const STAFF_PAGE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'staff-page.js'), 'utf8');
const LEADS_PAGE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'leads-page.js'), 'utf8');
const DASHBOARD_PAGE_CODE = fs.readFileSync(path.join(ROOT, 'js', 'dashboard-page.js'), 'utf8');

function response(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; }
    };
}

function createControlledTimers() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    return {
        now: () => now,
        setTimeout(fn, delay = 0) {
            const id = nextId++;
            timers.set(id, { at: now + Number(delay || 0), fn });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        advance(ms) {
            now += Number(ms || 0);
            let ran = true;
            while (ran) {
                ran = false;
                const due = [...timers.entries()]
                    .filter(([, timer]) => timer.at <= now)
                    .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
                for (const [id, timer] of due) {
                    if (!timers.has(id)) continue;
                    timers.delete(id);
                    timer.fn();
                    ran = true;
                }
            }
        },
        pendingCount: () => timers.size
    };
}

async function flushAsyncTurns(count = 8) {
    for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function loadApi(fetchImpl, initialStore = {}, options = {}) {
    const store = new Map(Object.entries(initialStore).map(([key, value]) => [key, String(value)]));
    const listeners = new Map();
    const addListener = (type, listener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
    };
    const removeListener = (type, listener) => listeners.get(type)?.delete(listener);
    const dispatchStorageEvent = key => {
        for (const listener of listeners.get('storage') || []) listener({ key });
    };
    const timers = options.timers || null;
    const diagnostics = options.diagnostics || [];
    const BaseDate = Date;
    const RuntimeDate = timers
        ? class extends BaseDate {
            static now() { return timers.now(); }
            static parse(value) { return BaseDate.parse(value); }
            static UTC(...args) { return BaseDate.UTC(...args); }
        }
        : Date;
    const context = {
        console,
        URL,
        URLSearchParams,
        Date: RuntimeDate,
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        window: {
            location: { search: '', href: 'http://localhost/' },
            history: { replaceState() {} },
            addEventListener: addListener,
            removeEventListener: removeListener,
            RedirectDiagnostics: {
                record: (event, details) => diagnostics.push({ event, details })
            }
        },
        document: {
            documentElement: { classList: { contains() { return false; } } }
        },
        fetch: fetchImpl,
        recordApiRedirectDiagnostic: (event, details) => diagnostics.push({ event, details })
    };
    if (timers) {
        context.setTimeout = timers.setTimeout;
        context.clearTimeout = timers.clearTimeout;
        context.window.setTimeout = timers.setTimeout;
        context.window.clearTimeout = timers.clearTimeout;
    }
    context.window.self = context.window;
    context.window.top = context.window;
    vm.createContext(context);
    vm.runInContext(API_CODE, context);
    return { context, store, dispatchStorageEvent, diagnostics, timers };
}

function loadCheckSessionHarness(overrides = {}) {
    const start = AUTH_CODE.indexOf('async function checkSession()');
    const end = AUTH_CODE.indexOf('async function login', start);
    assert.ok(start >= 0, 'checkSession function missing');
    assert.ok(end > start, 'login function should follow checkSession');

    const calls = [];
    const initialStore = overrides.initialStore || {
        pzp_token: 'stored-token',
        pzp_current_user: JSON.stringify({ username: 'cached.user' })
    };
    const { initialStore: _ignoredInitialStore, ...contextOverrides } = overrides;
    const store = new Map(Object.entries(initialStore).map(([key, value]) => [key, String(value)]));
    const classSets = {
        loginScreen: new Set(['hidden']),
        mainApp: new Set(['hidden'])
    };
    const context = {
        console: { warn: (...args) => calls.push(['warn', ...args]), error() {}, log() {} },
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        AppState: { currentUser: null },
        Sidebar: { initUserCard: () => calls.push(['Sidebar.initUserCard']) },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        document: {
            getElementById(id) {
                if (!classSets[id]) return null;
                return {
                    classList: {
                        add: cls => classSets[id].add(cls),
                        remove: cls => classSets[id].delete(cls),
                        contains: cls => classSets[id].has(cls)
                    }
                };
            }
        },
        window: { WorkingRole: { hydrate: () => calls.push(['WorkingRole.hydrate']) } },
        navigator: { onLine: true },
        setTimeout: fn => fn(),
        hasStoredRefreshSession: () => Boolean(store.get('pzp_refresh_token')),
        apiVerifyToken: async () => { throw new Error('verify failed'); },
        captureAuthBootstrapSession: user => ({ user }),
        isAuthBootstrapSessionCurrent: () => true,
        authBootstrapSessionChangedError: () => new Error('session changed'),
        hydrateBusinessOperatingProfile: async () => calls.push(['hydrateBusinessOperatingProfile']),
        hydrateActionPermissions: async () => calls.push(['hydrateActionPermissions']),
        showMainApp: () => calls.push(['showMainApp']),
        showAuthenticatedPageShell: options => calls.push(['showAuthenticatedPageShell', options]),
        renderPermissionBootstrapError: options => calls.push(['renderPermissionBootstrapError', options]),
        applyAuthReturnRouteAfterLogin: () => false,
        clearAuthSessionBootstrapError: () => calls.push(['clearAuthSessionBootstrapError']),
        resetAuthenticatedRuntimeReady: () => {},
        scheduleOfflineSessionRecovery: () => calls.push(['scheduleOfflineSessionRecovery']),
        getApiAuthSessionFailure: () => null,
        isApiAuthSessionFailureTransient: () => false,
        renderAuthSessionBootstrapError: options => calls.push(['renderAuthSessionBootstrapError', options]),
        recordRedirectDiagnostic() {},
        clearAuthStorage: () => {
            calls.push(['clearAuthStorage']);
            store.delete('pzp_token');
            store.delete('pzp_current_user');
        },
        clearPrivateClientCaches: () => calls.push(['clearPrivateClientCaches']),
        showLoginScreen: () => {
            calls.push(['showLoginScreen']);
            classSets.loginScreen.delete('hidden');
            classSets.mainApp.add('hidden');
        },
        ...contextOverrides
    };
    vm.createContext(context);
    vm.runInContext(
        `const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';\n`
            + `const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';\n`
            + AUTH_CODE.slice(start, end),
        context,
        { filename: 'js/auth.js' }
    );
    return { context, calls, classSets, store };
}

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
    throw new Error(`Could not extract ${functionName}`);
}

function extractAuthFunction(functionName) {
    return `function recordRedirectDiagnostic() {}\n${extractSourceFunction(AUTH_CODE, functionName)}`;
}

function loadAutoFillHarness(options = {}) {
    const calls = [];
    const store = new Map();
    const sessionStore = new Map();
    if (options.cachedUser) store.set('pzp_current_user', JSON.stringify(options.cachedUser));
    let permissionStatus = options.permissionStatus || 'idle';
    let runtimeReady = Boolean(options.runtimeReady);
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        AppState: { currentUser: options.appUser || null },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        sessionStorage: {
            getItem: key => sessionStore.get(key) || null,
            setItem: (key, value) => sessionStore.set(key, String(value)),
            removeItem: key => sessionStore.delete(key)
        },
        getPermissionLifecycle: () => ({ status: permissionStatus }),
        isAuthenticatedRuntimeReady: () => runtimeReady,
        enforceCurrentPageAccess: user => {
            calls.push(['enforceCurrentPageAccess', user]);
            return true;
        },
        window: {
            WorkingRole: { hydrate: () => calls.push(['WorkingRole.hydrate']) },
            location: { reload: () => calls.push(['reload']) }
        },
        document: { getElementById: () => null },
        Sidebar: { initUserCard: () => calls.push(['Sidebar.initUserCard']) },
        setApiAuthSessionFailure: (...args) => calls.push(['setApiAuthSessionFailure', ...args]),
        clearRuntimePermissionCatalog: user => calls.push(['clearRuntimePermissionCatalog', user]),
        setPermissionLifecycle: status => {
            permissionStatus = status;
            calls.push(['setPermissionLifecycle', status]);
        },
        resetAuthenticatedRuntimeReady: () => calls.push(['resetAuthenticatedRuntimeReady']),
        showAuthenticatedPageShell: options => calls.push(['showAuthenticatedPageShell', options]),
        renderAuthSessionBootstrapError: options => calls.push(['renderAuthSessionBootstrapError', options])
    };
    vm.createContext(context);
    vm.runInContext(extractAuthFunction('_autoFillUser'), context, { filename: 'js/auth.js' });
    return {
        context,
        calls,
        store,
        sessionStore,
        setPermissionStatus: status => { permissionStatus = status; },
        setRuntimeReady: ready => { runtimeReady = Boolean(ready); }
    };
}

function classListHarness(initial = []) {
    const set = new Set(initial);
    return {
        set,
        classList: {
            add: (...classes) => classes.forEach(cls => set.add(cls)),
            remove: (...classes) => classes.forEach(cls => set.delete(cls)),
            contains: cls => set.has(cls)
        }
    };
}

function createRecoveryElementHarness() {
    const buttons = new Map();
    const status = { hidden: true, textContent: '' };
    const target = {
        _html: '',
        set innerHTML(value) {
            this._html = String(value);
            buttons.clear();
            for (const attr of [
                'data-auth-session-retry',
                'data-auth-session-reload',
                'data-auth-session-copy-diagnostics',
                'data-auth-sw-update-reload',
                'data-auth-sw-update-later'
            ]) {
                if (this._html.includes(attr)) {
                    const button = {
                        disabled: false,
                        attributes: new Map(),
                        listeners: new Map(),
                        setAttribute(name, value) { this.attributes.set(name, String(value)); },
                        removeAttribute(name) { this.attributes.delete(name); },
                        addEventListener(type, handler) { this.listeners.set(type, handler); },
                        async click() {
                            const handler = this.listeners.get('click');
                            if (handler) await handler();
                        }
                    };
                    buttons.set(`[${attr}]`, button);
                }
            }
        },
        get innerHTML() { return this._html; },
        querySelector(selector) {
            if (selector === '[data-auth-session-diagnostics-status]') return status;
            return buttons.get(selector) || null;
        },
        remove() {}
    };
    return { target, buttons, status };
}

function loadLogoutShellHarness(pathname = '/') {
    const calls = [];
    const bodyClasses = classListHarness(['authenticated-shell', 'shell-ready', 'shell-baseline', 'page-exiting']);
    const htmlClasses = classListHarness(['shell-ready']);
    const loginClasses = classListHarness(['hidden']);
    const mainClasses = classListHarness([]);
    const sidebarToggleClasses = classListHarness([]);
    const bodyAttrs = new Map([['aria-busy', 'true']]);
    const elements = {
        loginScreen: { classList: loginClasses.classList },
        mainApp: { classList: mainClasses.classList },
        sidebarToggle: { classList: sidebarToggleClasses.classList }
    };
    const context = {
        console,
        AppState: { currentUser: { id: 1 } },
        ParkWS: { disconnect: () => calls.push(['ParkWS.disconnect']) },
        Sidebar: {
            clearShellReady: () => {
                calls.push(['Sidebar.clearShellReady']);
                bodyClasses.set.delete('shell-ready');
                htmlClasses.set.delete('shell-ready');
            }
        },
        document: {
            body: {
                classList: bodyClasses.classList,
                removeAttribute: name => bodyAttrs.delete(name),
                getAttribute: name => bodyAttrs.get(name) || null
            },
            documentElement: { classList: htmlClasses.classList },
            getElementById: id => elements[id] || null
        },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        window: {
            dispatchEvent() {},
            location: {
                pathname,
                href: `http://localhost${pathname}`,
                replace(target) {
                    calls.push(['location.replace', target]);
                    this.pathname = target;
                    this.href = `http://localhost${target}`;
                }
            }
        },
        revokeStoredRefreshToken: () => calls.push(['revokeStoredRefreshToken']),
        resetAuthenticatedRuntimeReady: () => calls.push(['resetAuthenticatedRuntimeReady']),
        clearAuthStorage: () => calls.push(['clearAuthStorage']),
        clearPrivateClientCaches: () => calls.push(['clearPrivateClientCaches'])
    };
    vm.createContext(context);
    vm.runInContext([
        extractAuthFunction('resetAuthExitVisualState'),
        extractAuthFunction('clearAuthenticatedPageShell'),
        extractAuthFunction('clearAuthSessionBootstrapError'),
        extractAuthFunction('showLoginScreen'),
        extractAuthFunction('logout')
    ].join('\n'), context, { filename: 'js/auth.js' });
    return { context, calls, bodyClasses, htmlClasses, loginClasses, mainClasses, bodyAttrs };
}

function loadRefreshRevocationHarness(localEntries = [], sessionEntries = []) {
    const localStore = new Map(localEntries);
    const sessionStore = new Map(sessionEntries);
    const calls = [];
    const storage = store => ({
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    });
    const context = {
        AUTH_REFRESH_TOKEN_KEY: 'pzp_refresh_token',
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true };
        }
    };
    vm.createContext(context);
    vm.runInContext([
        extractAuthFunction('revokeRefreshTokenValue'),
        extractAuthFunction('revokeStoredRefreshToken')
    ].join('\n'), context, { filename: 'js/auth.js' });
    return { context, calls, localStore, sessionStore };
}

test('apiVerifyToken refreshes a stored refresh session when the legacy token is missing', async () => {
    const calls = [];
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({ url, options });
        if (url === '/api/auth/refresh') {
            assert.deepEqual(JSON.parse(options.body), { refreshToken: 'refresh-one' });
            return response(200, {
                accessToken: 'access-new',
                refreshToken: 'refresh-new',
                refreshExpiresAt: '2026-06-25T00:00:00.000Z',
                user: { id: 7, username: 'new.operator' }
            });
        }
        if (url === '/api/auth/verify') {
            assert.equal(options.headers.Authorization, 'Bearer access-new');
            return response(200, { user: { id: 7, username: 'new.operator' } });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }, {
        pzp_refresh_token: 'refresh-one',
        pzp_current_user: JSON.stringify({ id: 7, username: 'new.operator' })
    });

    const user = await context.apiVerifyToken();
    assert.equal(user.username, 'new.operator');
    assert.deepEqual(calls.map(call => call.url), ['/api/auth/refresh', '/api/auth/verify']);
    assert.equal(store.get('pzp_token'), 'access-new');
    assert.equal(store.get('pzp_access_token'), 'access-new');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-new');
    assert.match(store.get('pzp_current_user'), /new\.operator/);
});



test('apiRefreshAuthSession object argument is expected user override, not diagnostic metadata', async () => {
    const calls = [];
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({ url, options });
        if (url === '/api/auth/refresh') {
            assert.deepEqual(JSON.parse(options.body), { refreshToken: 'refresh-before' });
            return response(200, {
                accessToken: 'access-after',
                refreshToken: 'refresh-after',
                refreshExpiresAt: '2026-09-06T00:00:00.000Z',
                sessionTokenId: 44,
                user: { id: 7, username: 'operator' }
            });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }, {
        pzp_refresh_token: 'refresh-before',
        pzp_current_user: JSON.stringify({ id: 7, username: 'operator' })
    });

    const result = await context.apiRefreshAuthSession({ reason: 'lost-committed-refresh-response' });

    assert.equal(result.outcome, 'superseded');
    assert.equal(result.accessToken, null);
    assert.equal(store.get('pzp_refresh_token'), 'refresh-before');
    assert.equal(store.get('pzp_access_token'), undefined);
    assert.equal(calls.length, 1);
});

test('apiRefreshAuthSession treats repeated duplicate rotation as retry-later without access-only settlement', async () => {
    const timers = createControlledTimers();
    const calls = [];
    const diagnostics = [];
    const { context, store, dispatchStorageEvent } = loadApi(async (url, options = {}) => {
        calls.push({ url, options, at: timers.now() });
        if (url === '/api/auth/refresh') {
            assert.deepEqual(JSON.parse(options.body), { refreshToken: 'refresh-before' });
            return response(409, {
                code: 'refresh_already_rotated',
                requestId: `req-duplicate-${calls.length}`
            });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }, {
        pzp_access_token: 'access-before',
        pzp_token: 'access-before',
        pzp_refresh_token: 'refresh-before',
        pzp_auth_session_generation: 'generation-one',
        pzp_auth_session_token_id: '41',
        pzp_current_user: JSON.stringify({ id: 7, username: 'operator' })
    }, { timers, diagnostics });

    const resultPromise = context.apiRefreshAuthSession();
    let settled = false;
    resultPromise.then(() => { settled = true; });
    await flushAsyncTurns();
    assert.equal(calls.length, 1, 'first duplicate refresh should be observed');

    timers.advance(100);
    store.set('pzp_access_token', 'access-from-other-tab');
    dispatchStorageEvent('pzp_access_token');
    await flushAsyncTurns();

    timers.advance(250);
    await flushAsyncTurns();
    assert.equal(settled, false, 'access-token-only storage events must not settle the duplicate rotation wait');
    assert.equal(calls.length, 1, 'access-token-only storage events must not trigger early replay');

    timers.advance(4900);
    await flushAsyncTurns();
    timers.advance(250);
    await flushAsyncTurns();

    const result = await resultPromise;
    assert.equal(calls.length, 2, 'duplicate confirmation should stay bounded to one replay');
    assert.deepEqual(calls.map(call => call.at), [0, 5500]);
    assert.equal(result.outcome, 'retry-later');
    assert.equal(result.retryable, true);
    assert.equal(result.accessToken, null);
    assert.equal(result.reason, 'refresh-already-rotated');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-before');
    assert.equal(store.get('pzp_auth_session_generation'), 'generation-one');
    assert.equal(store.get('pzp_auth_session_token_id'), '41');
    assert.equal(store.get('pzp_current_user'), JSON.stringify({ id: 7, username: 'operator' }));
    assert.equal(store.get('pzp_access_token'), 'access-from-other-tab');
    assert.equal(store.get('pzp_token'), 'access-before');
    assert.equal(context.getApiAuthSessionFailure().kind, 'transient');
    assert.equal(context.getApiAuthSessionFailure().reason, 'refresh-already-rotated');
    assert.equal(diagnostics.some(item => item.event === 'auth-refresh'
        && item.details.refreshOutcome === 'retry-later'
        && item.details.code === 'refresh_already_rotated'), true);
});

test('apiRefreshAuthSession success returns access outcome and stores the rotated refresh token', async () => {
    const calls = [];
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({ url, options });
        if (url === '/api/auth/refresh') {
            assert.deepEqual(JSON.parse(options.body), { refreshToken: 'refresh-old' });
            return response(200, {
                accessToken: 'access-new',
                refreshToken: 'refresh-new',
                refreshExpiresAt: '2026-09-06T00:00:00.000Z',
                sessionTokenId: 45,
                user: { id: 8, username: 'manager' },
                requestId: 'req-refresh-success'
            });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }, {
        pzp_refresh_token: 'refresh-old',
        pzp_current_user: JSON.stringify({ id: 8, username: 'manager' })
    });

    const result = await context.apiRefreshAuthSession();

    assert.equal(result.outcome, 'success');
    assert.equal(result.accessToken, 'access-new');
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'refreshToken'), false);
    assert.equal(store.get('pzp_token'), 'access-new');
    assert.equal(store.get('pzp_access_token'), 'access-new');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-new');
    assert.equal(store.get('pzp_refresh_expires_at'), '2026-09-06T00:00:00.000Z');
    assert.equal(store.get('pzp_auth_session_token_id'), '45');
});

test('checkSession falls back to login instead of leaving a blank shell when verify throws', async () => {
    const { context, calls, classSets, store } = loadCheckSessionHarness();

    await context.checkSession();

    assert.equal(classSets.loginScreen.has('hidden'), false);
    assert.equal(classSets.mainApp.has('hidden'), true);
    assert.equal(store.has('pzp_token'), false);
    assert.equal(store.has('pzp_current_user'), false);
    assert.deepEqual(
        calls.map(call => call[0]),
        ['warn', 'clearAuthStorage', 'clearPrivateClientCaches', 'showLoginScreen']
    );
});

test('checkSession canonically clears partial auth storage when no token remains', async () => {
    const { context, calls, store } = loadCheckSessionHarness({
        initialStore: {
            pzp_current_user: JSON.stringify({ id: 19, username: 'stale.user', role: 'manager' }),
            pzp_session: JSON.stringify({ userId: 19 }),
            pzp_auth_session_generation: 'stale-generation',
            pzp_auth_login_intent: 'stale-login-intent'
        }
    });
    context.AppState.currentUser = { id: 19, username: 'stale.user', role: 'manager' };
    context.clearAuthStorage = () => {
        calls.push(['clearAuthStorage']);
        store.clear();
        context.AppState.currentUser = null;
    };

    assert.equal(await context.checkSession(), false);

    assert.equal(store.size, 0);
    assert.equal(context.AppState.currentUser, null);
    assert.deepEqual(
        calls.map(call => call[0]),
        ['clearAuthStorage', 'clearPrivateClientCaches', 'showLoginScreen']
    );
});

test('checkSession preserves auth storage and offers retry on transient verification failure', async () => {
    const failure = { kind: 'transient', transient: true, stage: 'verify', status: 429 };
    const { context, calls, store } = loadCheckSessionHarness({
        apiVerifyToken: async () => null,
        getApiAuthSessionFailure: () => failure,
        isApiAuthSessionFailureTransient: value => value?.transient === true
    });

    assert.equal(await context.checkSession(), false);

    assert.equal(store.get('pzp_token'), 'stored-token');
    assert.match(store.get('pzp_current_user'), /cached\.user/);
    assert.equal(calls.some(call => call[0] === 'clearAuthStorage'), false);
    assert.equal(calls.some(call => call[0] === 'clearPrivateClientCaches'), false);
    assert.equal(calls.some(call => call[0] === 'showLoginScreen'), false);
    const recovery = calls.find(call => call[0] === 'renderAuthSessionBootstrapError');
    assert.equal(recovery?.[1]?.failure, failure);
    assert.equal(typeof recovery?.[1]?.retry, 'function');
});

test('checkSession keeps a verified session when permission hydration is temporarily unavailable', async () => {
    const verifiedUser = { id: 7, username: 'cached.user', role: 'manager' };
    const { context, calls, store } = loadCheckSessionHarness({
        apiVerifyToken: async () => verifiedUser,
        hydrateActionPermissions: async () => {
            calls.push(['hydrateActionPermissions']);
            return null;
        }
    });

    assert.equal(await context.checkSession(), false);

    assert.equal(context.AppState.currentUser.username, 'cached.user');
    assert.equal(store.get('pzp_token'), 'stored-token');
    assert.match(store.get('pzp_current_user'), /cached\.user/);
    assert.equal(calls.some(call => call[0] === 'clearAuthStorage'), false);
    assert.equal(calls.some(call => call[0] === 'clearPrivateClientCaches'), false);
    assert.equal(calls.some(call => call[0] === 'showLoginScreen'), false);
    assert.equal(calls.some(call => call[0] === 'showMainApp'), false);
    const shellCall = calls.find(call => call[0] === 'showAuthenticatedPageShell');
    assert.equal(shellCall?.[1]?.markRuntimeReady, false);
    const recovery = calls.find(call => call[0] === 'renderPermissionBootstrapError');
    assert.equal(recovery?.[1]?.overlay, true);
    assert.equal(typeof recovery?.[1]?.retry, 'function');
});

test('checkSession applies a saved return route once after permissions recover on retry', async () => {
    const verifiedUser = { id: 7, username: 'cached.user', role: 'manager' };
    let permissionsReady = false;
    let permissionLifecycle = 'loading';
    const navigations = [];
    const { context, calls, store } = loadCheckSessionHarness({
        apiVerifyToken: async () => verifiedUser,
        hydrateActionPermissions: async () => {
            calls.push(['hydrateActionPermissions']);
            if (!permissionsReady) return null;
            permissionLifecycle = 'ready';
            return { userId: verifiedUser.id };
        },
        getPermissionLifecycle: () => ({ status: permissionLifecycle }),
        canAccessPage: route => route === '/certificates',
        window: {
            WorkingRole: { hydrate: () => calls.push(['WorkingRole.hydrate']) },
            location: {
                origin: 'http://localhost',
                href: 'http://localhost/',
                pathname: '/',
                search: ''
            }
        }
    });
    Object.defineProperty(context.window.location, 'href', {
        get() { return 'http://localhost/'; },
        set(value) { navigations.push(value); }
    });
    vm.runInContext(`
        const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
        const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
        ${AUTH_CODE.slice(AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES'), AUTH_CODE.indexOf('function clearAuthSessionBootstrapError', AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES')))}
    `, context, { filename: 'js/auth.js' });
    store.set('pzp_auth_return_route_v1', JSON.stringify({ route: '/certificates', at: Date.now() }));

    assert.equal(await context.checkSession(), false);
    assert.equal(store.has('pzp_auth_return_route_v1'), true, 'transient permissions failure must not consume the return-route intent');
    assert.equal(navigations.length, 0);

    permissionsReady = true;
    assert.equal(await context.checkSession(), true);
    assert.deepEqual(navigations, ['/certificates']);
    assert.equal(store.has('pzp_auth_return_route_v1'), false);
    assert.equal(calls.some(call => call[0] === 'showMainApp'), false, 'wrong root module must not be shown before return-route navigation');
});

test('checkSession preserves an offline session and can recover when connectivity returns', async () => {
    let verifyOnline = false;
    const navigator = { onLine: false };
    const { context, calls, store } = loadCheckSessionHarness({
        navigator,
        apiVerifyToken: async () => verifyOnline ? { id: 7, username: 'cached.user' } : null
    });

    assert.equal(await context.checkSession(), false);
    assert.equal(store.get('pzp_token'), 'stored-token');
    assert.match(store.get('pzp_current_user'), /cached\.user/);
    assert.equal(calls.some(call => call[0] === 'clearAuthStorage'), false);
    assert.equal(calls.some(call => call[0] === 'clearPrivateClientCaches'), false);
    assert.equal(calls.some(call => call[0] === 'scheduleOfflineSessionRecovery'), true);

    navigator.onLine = true;
    verifyOnline = true;
    assert.equal(await context.checkSession(), true);
    assert.equal(context.AppState.currentUser.username, 'cached.user');
    assert.equal(calls.some(call => call[0] === 'showMainApp'), true);
});

test('checkSession bootstraps access-only and refresh-only sessions without a cached user record', async () => {
    for (const initialStore of [
        { pzp_access_token: 'access-only' },
        { pzp_refresh_token: 'refresh-only' }
    ]) {
        const verifiedUser = { id: 71, username: 'storage.partial', role: 'manager' };
        const { context, calls } = loadCheckSessionHarness({
            initialStore,
            apiVerifyToken: async () => verifiedUser
        });

        assert.equal(await context.checkSession(), true);
        assert.equal(context.AppState.currentUser, verifiedUser);
        assert.equal(calls.some(call => call[0] === 'showMainApp'), true);
        assert.equal(calls.some(call => call[0] === 'showLoginScreen'), false);
        assert.equal(calls.some(call => call[0] === 'clearAuthStorage'), false);
    }
});

test('checkSession restarts once when another tab changes the account during bootstrap', async () => {
    const accountA = { id: 71, username: 'account.a', role: 'animator' };
    const accountB = { id: 72, username: 'account.b', role: 'manager' };
    let markFirstHydrationStarted;
    const firstHydrationStarted = new Promise(resolve => { markFirstHydrationStarted = resolve; });
    let releaseFirstHydration;
    let verifyCalls = 0;
    let hydrateCalls = 0;
    const harness = loadCheckSessionHarness({
        initialStore: {
            pzp_token: 'access-a',
            pzp_access_token: 'access-a',
            pzp_refresh_token: 'refresh-a',
            pzp_auth_session_generation: 'generation-a',
            pzp_current_user: JSON.stringify(accountA)
        }
    });
    const { context, calls, store } = harness;
    context.apiVerifyToken = async () => (++verifyCalls === 1 ? accountA : accountB);
    context.captureAuthBootstrapSession = user => ({
        generation: store.get('pzp_auth_session_generation') || '',
        identity: user
    });
    context.isAuthBootstrapSessionCurrent = (snapshot, user) => {
        const cached = JSON.parse(store.get('pzp_current_user') || 'null');
        const runtime = context.AppState.currentUser;
        return snapshot.generation === (store.get('pzp_auth_session_generation') || '')
            && cached?.id === user?.id
            && (!runtime || runtime.id === user?.id);
    };
    context.hydrateBusinessOperatingProfile = async user => {
        hydrateCalls += 1;
        if (hydrateCalls !== 1) return user;
        markFirstHydrationStarted();
        return new Promise(resolve => { releaseFirstHydration = resolve; });
    };
    context.hydrateActionPermissions = async user => ({ userId: user.id });

    const pending = context.checkSession();
    await firstHydrationStarted;
    store.set('pzp_token', 'access-b');
    store.set('pzp_access_token', 'access-b');
    store.set('pzp_refresh_token', 'refresh-b');
    store.set('pzp_auth_session_generation', 'generation-b');
    store.set('pzp_current_user', JSON.stringify(accountB));
    releaseFirstHydration(accountA);

    assert.equal(await pending, true);
    assert.equal(verifyCalls, 2);
    assert.equal(hydrateCalls, 2);
    assert.equal(context.AppState.currentUser.id, accountB.id);
    assert.equal(calls.filter(call => call[0] === 'showMainApp').length, 1);
    assert.equal(calls.some(call => call[0] === 'clearAuthStorage'), false);
    assert.equal(calls.some(call => call[0] === 'showLoginScreen'), false);
});

test('checkSession fully clears stale runtime state when the session disappears during bootstrap', async () => {
    const account = { id: 75, username: 'account.logout', role: 'animator' };
    let markHydrationStarted;
    let releaseHydration;
    const hydrationStarted = new Promise(resolve => { markHydrationStarted = resolve; });
    const { context, calls, store } = loadCheckSessionHarness({
        initialStore: {
            pzp_token: 'access-a',
            pzp_access_token: 'access-a',
            pzp_refresh_token: 'refresh-a',
            pzp_auth_session_generation: 'generation-a',
            pzp_current_user: JSON.stringify(account)
        },
        apiVerifyToken: async () => account
    });
    context.captureAuthBootstrapSession = user => ({
        generation: store.get('pzp_auth_session_generation') || '',
        identity: user
    });
    context.isAuthBootstrapSessionCurrent = snapshot => (
        snapshot.generation === (store.get('pzp_auth_session_generation') || '')
    );
    context.hydrateBusinessOperatingProfile = async () => {
        markHydrationStarted();
        return new Promise(resolve => { releaseHydration = resolve; });
    };

    const pending = context.checkSession();
    await hydrationStarted;
    [
        'pzp_token',
        'pzp_access_token',
        'pzp_refresh_token',
        'pzp_auth_session_generation'
    ].forEach(key => store.delete(key));
    releaseHydration(account);

    assert.equal(await pending, false);
    assert.equal(context.AppState.currentUser, null);
    assert.equal(store.has('pzp_current_user'), false);
    assert.equal(calls.filter(call => call[0] === 'clearAuthStorage').length, 1);
    assert.equal(calls.filter(call => call[0] === 'showLoginScreen').length, 1);
});

test('checkSession bounds repeated cross-tab account changes and renders recovery', async () => {
    const accounts = [
        { id: 81, username: 'account.a', role: 'animator' },
        { id: 82, username: 'account.b', role: 'manager' },
        { id: 83, username: 'account.c', role: 'creator' }
    ];
    const hydrateStarted = [];
    const hydrateReleased = [];
    const markHydrateStarted = [];
    const releaseHydrate = [];
    let verifyCalls = 0;
    let hydrateCalls = 0;
    const harness = loadCheckSessionHarness({
        initialStore: {
            pzp_token: 'access-a',
            pzp_access_token: 'access-a',
            pzp_refresh_token: 'refresh-a',
            pzp_auth_session_generation: 'generation-a',
            pzp_current_user: JSON.stringify(accounts[0])
        }
    });
    const { context, calls, store } = harness;
    for (let index = 0; index < 2; index += 1) {
        hydrateStarted[index] = new Promise(resolve => { markHydrateStarted[index] = resolve; });
        hydrateReleased[index] = new Promise(resolve => { releaseHydrate[index] = resolve; });
    }
    context.apiVerifyToken = async () => accounts[Math.min(verifyCalls++, 1)];
    context.captureAuthBootstrapSession = user => ({
        generation: store.get('pzp_auth_session_generation') || '',
        identity: user
    });
    context.isAuthBootstrapSessionCurrent = (snapshot, user) => {
        const cached = JSON.parse(store.get('pzp_current_user') || 'null');
        const runtime = context.AppState.currentUser;
        return snapshot.generation === (store.get('pzp_auth_session_generation') || '')
            && cached?.id === user?.id
            && (!runtime || runtime.id === user?.id);
    };
    context.hydrateBusinessOperatingProfile = async () => {
        const index = hydrateCalls++;
        markHydrateStarted[index]();
        return hydrateReleased[index];
    };
    context.hydrateActionPermissions = async user => ({ userId: user.id });

    const pending = context.checkSession();
    await hydrateStarted[0];
    store.set('pzp_token', 'access-b');
    store.set('pzp_access_token', 'access-b');
    store.set('pzp_refresh_token', 'refresh-b');
    store.set('pzp_auth_session_generation', 'generation-b');
    store.set('pzp_current_user', JSON.stringify(accounts[1]));
    releaseHydrate[0](accounts[0]);
    await hydrateStarted[1];
    store.set('pzp_token', 'access-c');
    store.set('pzp_access_token', 'access-c');
    store.set('pzp_refresh_token', 'refresh-c');
    store.set('pzp_auth_session_generation', 'generation-c');
    store.set('pzp_current_user', JSON.stringify(accounts[2]));
    releaseHydrate[1](accounts[1]);

    assert.equal(await pending, false);
    assert.equal(verifyCalls, 2);
    assert.equal(store.get('pzp_refresh_token'), 'refresh-c');
    assert.equal(calls.filter(call => call[0] === 'renderAuthSessionBootstrapError').length, 1);
    assert.equal(calls.some(call => call[0] === 'clearAuthStorage'), false);
    assert.equal(calls.some(call => call[0] === 'showLoginScreen'), false);
});

test('a late login response cannot overwrite a newer cross-tab login', async () => {
    let resolveLogin;
    const loginResponse = new Promise(resolve => { resolveLogin = resolve; });
    const newerUser = { id: 92, username: 'newer.user', role: 'manager' };
    const store = new Map();
    const revoked = [];
    let rememberCalls = 0;
    const context = {
        console: { error() {}, warn() {}, log() {} },
        AUTH_LOGIN_INTENT_KEY: 'pzp_auth_login_intent',
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        apiLogin: async () => loginResponse,
        rememberAuthSession: () => { rememberCalls += 1; return true; },
        revokeRefreshTokenValue: token => revoked.push(token)
    };
    vm.createContext(context);
    vm.runInContext(extractAuthFunction('login'), context, { filename: 'js/auth.js' });

    const pending = context.login('older.user', 'password');
    await Promise.resolve();
    const olderIntent = store.get('pzp_auth_login_intent');
    assert.match(olderIntent, /^login-/);
    store.set('pzp_auth_login_intent', 'login-newer-tab');
    store.set('pzp_token', 'newer-access');
    store.set('pzp_access_token', 'newer-access');
    store.set('pzp_refresh_token', 'newer-refresh');
    store.set('pzp_auth_session_generation', 'newer-generation');
    store.set('pzp_current_user', JSON.stringify(newerUser));
    resolveLogin({
        accessToken: 'older-access',
        refreshToken: 'older-refresh',
        user: { id: 91, username: 'older.user', role: 'animator' }
    });

    const result = await pending;
    assert.equal(result.success, false);
    assert.deepEqual(revoked, ['older-refresh']);
    assert.equal(rememberCalls, 0);
    assert.equal(store.get('pzp_refresh_token'), 'newer-refresh');
    assert.deepEqual(JSON.parse(store.get('pzp_current_user')), newerUser);
    assert.equal(store.get('pzp_auth_login_intent'), 'login-newer-tab');
});

test('Service Worker registration is canonical, authenticated, and idempotent', async () => {
    const registrationCalls = [];
    const events = [];
    const store = new Map();
    const context = {
        console,
        AppState: { currentUser: null },
        localStorage: { getItem: key => store.get(key) || null },
        navigator: {
            serviceWorker: {
                register: async path => {
                    registrationCalls.push(path);
                    return { scope: '/' };
                }
            }
        },
        window: { dispatchEvent: event => events.push(event.type) },
        CustomEvent: class CustomEvent { constructor(type) { this.type = type; } }
    };
    vm.createContext(context);
    vm.runInContext(`
        const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';
        const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';
        let serviceWorkerRegistrationPromise = null;
        let authenticatedRuntimeReady = false;
        function bindAuthenticatedServiceWorkerUpdatePrompt() {}
        ${extractAuthFunction('hasAuthenticatedRuntimeSession')}
        ${extractAuthFunction('isAuthenticatedRuntimeReady')}
        ${extractAuthFunction('registerAuthenticatedServiceWorker')}
        ${extractAuthFunction('markAuthenticatedRuntimeReady')}
    `, context, { filename: 'js/auth.js' });

    assert.equal(await context.registerAuthenticatedServiceWorker(), null);
    assert.deepEqual(registrationCalls, []);

    context.AppState.currentUser = { id: 7 };
    store.set('pzp_token', 'token');
    await context.registerAuthenticatedServiceWorker();
    await context.registerAuthenticatedServiceWorker();
    context.markAuthenticatedRuntimeReady();

    assert.deepEqual(registrationCalls, ['/sw.js']);
    assert.deepEqual(events, ['crm:authenticated-runtime-ready']);
    assert.equal(context.isAuthenticatedRuntimeReady(), true);
    assert.equal((AUTH_CODE.match(/navigator\.serviceWorker\.register\('\/sw\.js'\)/g) || []).length, 1);
});

test('login does not navigate from a stale session after delayed Service Worker registration', async () => {
    const store = new Map();
    const calls = [];
    let releaseServiceWorker;
    let markServiceWorkerStarted;
    const serviceWorkerStarted = new Promise(resolve => { markServiceWorkerStarted = resolve; });
    let sessionCurrent = true;
    const locationState = { pathname: '/', search: '', href: 'http://localhost/' };
    const storage = {
        getItem: key => store.get(key) || null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    };
    const context = {
        console: { warn: (...args) => calls.push(['warn', ...args]), error() {}, log() {} },
        localStorage: storage,
        AppState: { currentUser: null },
        window: {
            WorkingRole: { hydrate: () => calls.push(['WorkingRole.hydrate']) },
            location: locationState
        },
        Sidebar: { initUserCard: () => calls.push(['Sidebar.initUserCard']) },
        AUTH_LOGIN_INTENT_KEY: 'pzp_auth_login_intent',
        apiLogin: async () => ({
            accessToken: 'access-a',
            refreshToken: 'refresh-a',
            user: { id: 10, username: 'account.a', role: 'manager' }
        }),
        rememberAuthSession: data => {
            store.set('pzp_access_token', data.accessToken);
            store.set('pzp_refresh_token', data.refreshToken);
            store.set('pzp_current_user', JSON.stringify(data.user));
            store.set('pzp_auth_session_generation', 'generation-a');
            return true;
        },
        revokeRefreshTokenValue: token => calls.push(['revokeRefreshTokenValue', token]),
        captureAuthBootstrapSession: user => ({ userId: user?.id, generation: store.get('pzp_auth_session_generation') || '' }),
        isAuthBootstrapSessionCurrent: () => sessionCurrent,
        hydrateBusinessOperatingProfile: async () => calls.push(['hydrateBusinessOperatingProfile']),
        hydrateActionPermissions: async () => ({ ready: true }),
        registerAuthenticatedServiceWorker: () => {
            markServiceWorkerStarted();
            return new Promise(resolve => { releaseServiceWorker = resolve; });
        },
        applyAuthReturnRouteAfterLogin: () => {
            calls.push(['applyAuthReturnRouteAfterLogin']);
            return false;
        },
        getAuthenticatedTimelineStartPage: () => '/dashboard',
        recordRedirectDiagnostic: (...args) => calls.push(['recordRedirectDiagnostic', ...args]),
        showMainApp: () => calls.push(['showMainApp']),
        checkDailyLogin: () => calls.push(['checkDailyLogin']),
        resetAuthenticatedRuntimeReady: () => calls.push(['resetAuthenticatedRuntimeReady']),
        showAuthenticatedPageShell: options => calls.push(['showAuthenticatedPageShell', options]),
        renderAuthSessionBootstrapError: options => calls.push(['renderAuthSessionBootstrapError', options]),
        checkSession: () => calls.push(['checkSession'])
    };
    Object.defineProperty(locationState, 'href', {
        get() { return 'http://localhost/'; },
        set(value) { calls.push(['navigate', value]); }
    });
    vm.createContext(context);
    vm.runInContext(extractSourceFunction(AUTH_CODE, 'login'), context, { filename: 'js/auth.js' });

    const pending = context.login('account.a', 'password');
    await serviceWorkerStarted;
    sessionCurrent = false;
    store.clear();
    context.AppState.currentUser = null;
    releaseServiceWorker(null);

    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(result.pending, true);
    assert.equal(calls.some(call => call[0] === 'navigate'), false);
    assert.equal(calls.some(call => call[0] === 'applyAuthReturnRouteAfterLogin'), false);
    assert.equal(calls.some(call => call[0] === 'showMainApp'), false);
    assert.equal(calls.some(call => call[0] === 'Sidebar.initUserCard'), false);
    assert.equal(context.AppState.currentUser, null);
});

test('login keeps the current page when the saved return route already matches it', async () => {
    const store = new Map();
    const calls = [];
    const locationState = { pathname: '/certificates', search: '', origin: 'http://localhost' };
    Object.defineProperty(locationState, 'href', {
        get() { return 'http://localhost/certificates'; },
        set(value) { calls.push(['navigate', value]); }
    });
    const context = {
        URL,
        Date,
        console: { warn() {}, error() {}, log() {} },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        AppState: { currentUser: null },
        window: {
            WorkingRole: { hydrate: () => calls.push(['WorkingRole.hydrate']) },
            location: locationState
        },
        Sidebar: { initUserCard: () => calls.push(['Sidebar.initUserCard']) },
        apiLogin: async () => ({
            accessToken: 'access-current',
            refreshToken: 'refresh-current',
            user: { id: 10, username: 'account.current', role: 'manager' }
        }),
        rememberAuthSession: data => {
            store.set('pzp_token', data.accessToken);
            store.set('pzp_access_token', data.accessToken);
            store.set('pzp_refresh_token', data.refreshToken);
            store.set('pzp_current_user', JSON.stringify(data.user));
            store.set('pzp_auth_session_generation', 'generation-current');
            return true;
        },
        revokeRefreshTokenValue: token => calls.push(['revokeRefreshTokenValue', token]),
        captureAuthBootstrapSession: user => ({ userId: user?.id, generation: store.get('pzp_auth_session_generation') || '' }),
        isAuthBootstrapSessionCurrent: () => true,
        hydrateBusinessOperatingProfile: async () => calls.push(['hydrateBusinessOperatingProfile']),
        hydrateActionPermissions: async () => ({ ready: true }),
        registerAuthenticatedServiceWorker: async () => null,
        getAuthenticatedTimelineStartPage: () => '/dashboard',
        recordRedirectDiagnostic: (...args) => calls.push(['recordRedirectDiagnostic', ...args]),
        showMainApp: () => calls.push(['showMainApp']),
        checkDailyLogin: () => calls.push(['checkDailyLogin']),
        resetAuthenticatedRuntimeReady: () => calls.push(['resetAuthenticatedRuntimeReady']),
        showAuthenticatedPageShell: options => calls.push(['showAuthenticatedPageShell', options]),
        renderAuthSessionBootstrapError: options => calls.push(['renderAuthSessionBootstrapError', options]),
        checkSession: () => calls.push(['checkSession']),
        getPermissionLifecycle: () => ({ status: 'ready' }),
        canAccessPage: route => route === '/certificates',
        document: { getElementById: () => null }
    };
    vm.createContext(context);
    const returnRouteStart = AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES');
    const returnRouteEnd = AUTH_CODE.indexOf('function clearAuthSessionBootstrapError', returnRouteStart);
    vm.runInContext(`
        const AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';
        const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
        const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
        ${AUTH_CODE.slice(returnRouteStart, returnRouteEnd)}
        ${extractSourceFunction(AUTH_CODE, 'login')}
    `, context, { filename: 'js/auth.js' });

    store.set('pzp_auth_return_route_v1', JSON.stringify({ route: '/certificates', at: Date.now() }));
    const result = await context.login('account.current', 'password');

    assert.equal(result.success, true);
    assert.equal(calls.some(call => call[0] === 'navigate'), false, 'same-route return intent must not fall through to default start redirect');
    assert.equal(calls.some(call => call[0] === 'showMainApp'), false, 'same-route return intent is already handled by the current document');
    assert.equal(store.has('pzp_auth_return_route_v1'), false, 'same-route return intent must be consumed exactly once');
    assert.ok(calls.some(call => call[0] === 'recordRedirectDiagnostic' && call[2]?.redirectReason === 'return-route-current'));
});

test('service worker update prompt is manual, dirty-guarded, and preserves auth storage', async () => {
    const store = new Map([
        ['pzp_token', 'access-token'],
        ['pzp_access_token', 'access-token'],
        ['pzp_refresh_token', 'refresh-token'],
        ['pzp_current_user', JSON.stringify({ id: 14, username: 'operator', role: 'manager' })]
    ]);
    const calls = [];
    const { target, buttons } = createRecoveryElementHarness();
    const dirtySurface = {
        dataset: {
            editableSurface: 'true',
            dirty: 'true'
        }
    };
    const locationState = {
        origin: 'http://localhost',
        href: 'http://localhost/certificates/99?secret=1#frag',
        pathname: '/certificates/99',
        reload: () => calls.push(['reload'])
    };
    let confirmResult = false;
    const context = {
        URL,
        Date,
        console: { warn() {}, error() {}, log() {} },
        AppState: { currentUser: { id: 14, username: 'operator', role: 'manager' } },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        window: {
            location: locationState,
            UnsafeDismissGuard: { isDirtySurface: surface => surface === dirtySurface }
        },
        navigator: {
            serviceWorker: {
                controller: { scriptURL: 'http://localhost/sw.js' }
            }
        },
        document: {
            body: { appendChild: node => calls.push(['appendChild', node]) },
            createElement: () => target,
            getElementById: id => id === 'authServiceWorkerUpdatePrompt' ? target : null,
            querySelectorAll: selector => selector === '[data-editable-surface="true"]' ? [dirtySurface] : []
        },
        confirmModal: async (message, options) => {
            calls.push(['confirmModal', message, options]);
            return confirmResult;
        },
        showNotification: (...args) => calls.push(['showNotification', ...args]),
        recordRedirectDiagnostic: (...args) => calls.push(['recordRedirectDiagnostic', ...args]),
        getPermissionLifecycle: () => ({ status: 'ready' }),
        canAccessPage: route => route === '/certificates',
        getAuthenticatedTimelineStartPage: () => '/dashboard'
    };
    vm.createContext(context);
    const returnRouteStart = AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES');
    const returnRouteEnd = AUTH_CODE.indexOf('function clearAuthSessionBootstrapError', returnRouteStart);
    vm.runInContext(`
        const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
        const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
        let authServiceWorkerUpdatePromptVisible = false;
        let authServiceWorkerUpdateDismissedForController = '';
        ${AUTH_CODE.slice(returnRouteStart, returnRouteEnd)}
        ${extractSourceFunction(AUTH_CODE, 'hasAuthenticatedRuntimeSession')}
        ${extractSourceFunction(AUTH_CODE, 'hasAuthRecoveryUnsavedChanges')}
        ${extractSourceFunction(AUTH_CODE, 'authenticatedServiceWorkerUpdateControllerKey')}
        ${extractSourceFunction(AUTH_CODE, 'ensureAuthenticatedServiceWorkerUpdateSurface')}
        ${extractSourceFunction(AUTH_CODE, 'confirmAuthenticatedServiceWorkerUpdateReload')}
        ${extractSourceFunction(AUTH_CODE, 'applyAuthenticatedServiceWorkerUpdateReload')}
        ${extractSourceFunction(AUTH_CODE, 'dismissAuthenticatedServiceWorkerUpdatePrompt')}
        ${extractSourceFunction(AUTH_CODE, 'renderAuthenticatedServiceWorkerUpdatePrompt')}
    `, context, { filename: 'js/auth.js' });

    assert.equal(context.renderAuthenticatedServiceWorkerUpdatePrompt('controllerchange'), true);
    assert.match(target.innerHTML, /data-auth-sw-update-prompt/);
    assert.match(target.innerHTML, /Оновити/);
    assert.match(target.innerHTML, /Пізніше/);

    const reloadButton = buttons.get('[data-auth-sw-update-reload]');
    assert.ok(reloadButton, 'SW update prompt must expose a manual reload action');
    await reloadButton.click();
    assert.equal(calls.some(call => call[0] === 'reload'), false, 'dirty cancel must not reload');
    assert.equal(store.get('pzp_access_token'), 'access-token', 'dirty cancel must preserve access token');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-token', 'dirty cancel must preserve refresh token');
    assert.equal(store.has('pzp_auth_return_route_v1'), false, 'dirty cancel must not write a route intent');

    confirmResult = true;
    await reloadButton.click();
    assert.equal(calls.some(call => call[0] === 'reload'), true);
    assert.equal(store.get('pzp_access_token'), 'access-token');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-token');
    assert.equal(JSON.parse(store.get('pzp_auth_return_route_v1')).route, '/certificates');
});

test('showLoginScreen clears logout exit state before showing the canonical login screen', () => {
    const { context, calls, bodyClasses, htmlClasses, loginClasses, mainClasses, bodyAttrs } = loadLogoutShellHarness('/');

    context.showLoginScreen();

    assert.equal(bodyClasses.set.has('auth-screen'), true);
    assert.equal(bodyClasses.set.has('authenticated-shell'), false);
    assert.equal(bodyClasses.set.has('page-exiting'), false);
    assert.equal(bodyClasses.set.has('shell-baseline'), false);
    assert.equal(bodyClasses.set.has('shell-ready'), false);
    assert.equal(htmlClasses.set.has('shell-ready'), false);
    assert.equal(bodyAttrs.has('aria-busy'), false);
    assert.equal(loginClasses.set.has('hidden'), false);
    assert.equal(mainClasses.set.has('hidden'), true);
    assert.equal(calls.some(call => call[0] === 'location.replace'), false);
});

test('showLoginScreen redirects sub-pages without leaving a partially hidden shell', () => {
    for (const pagePath of ['/customers', '/leads', '/dashboard', '/profile']) {
        const { context, calls, bodyClasses, htmlClasses, loginClasses, mainClasses, bodyAttrs } = loadLogoutShellHarness(pagePath);

        context.showLoginScreen();

        assert.equal(bodyClasses.set.has('page-exiting'), false, `${pagePath} keeps page-exiting`);
        assert.equal(bodyClasses.set.has('shell-baseline'), false, `${pagePath} keeps shell-baseline`);
        assert.equal(bodyClasses.set.has('authenticated-shell'), false, `${pagePath} keeps authenticated-shell`);
        assert.equal(bodyClasses.set.has('auth-screen'), false, `${pagePath} enters auth-screen before redirect`);
        assert.equal(bodyClasses.set.has('shell-ready'), true, `${pagePath} hides mainApp before redirect`);
        assert.equal(htmlClasses.set.has('shell-ready'), true, `${pagePath} clears html shell-ready before redirect`);
        assert.equal(bodyAttrs.has('aria-busy'), false, `${pagePath} keeps aria-busy`);
        assert.equal(loginClasses.set.has('hidden'), true, `${pagePath} shows local login before redirect`);
        assert.equal(mainClasses.set.has('hidden'), false, `${pagePath} hides mainApp before redirect`);
        assert.deepEqual(calls.filter(call => call[0] === 'location.replace'), [['location.replace', '/']], pagePath);
    }
});

test('logout clears session data and exits to a stable login visual state', () => {
    const { context, calls, bodyClasses, loginClasses, mainClasses, bodyAttrs } = loadLogoutShellHarness('/');

    context.logout();

    assert.equal(context.AppState.currentUser, null);
    assert.deepEqual(calls.slice(0, 4).map(call => call[0]), [
        'ParkWS.disconnect',
        'revokeStoredRefreshToken',
        'resetAuthenticatedRuntimeReady',
        'clearAuthStorage',
    ]);
    assert.equal(calls.some(call => call[0] === 'clearPrivateClientCaches'), true);
    assert.equal(bodyClasses.set.has('auth-screen'), true);
    assert.equal(bodyClasses.set.has('page-exiting'), false);
    assert.equal(bodyAttrs.has('aria-busy'), false);
    assert.equal(loginClasses.set.has('hidden'), false);
    assert.equal(mainClasses.set.has('hidden'), true);
});

test('canonical auth cleanup purges impersonation backup credentials', () => {
    const localStore = new Map([
        ['pzp_token', 'target-token'],
        ['pzp_access_token', 'target-access'],
        ['pzp_refresh_token', 'target-refresh'],
        ['pzp_refresh_expires_at', 'target-expiry'],
        ['pzp_auth_session_generation', 'target-generation'],
        ['pzp_auth_login_intent', 'pending-login'],
        ['pzp_current_user', JSON.stringify({ id: 14, username: 'target.user' })],
        ['pzp_session', 'target-session']
    ]);
    const sessionStore = new Map([
        ['impersonating', 'target.user'],
        ['realToken', 'creator-token'],
        ['realAccessToken', 'creator-access'],
        ['realRefreshToken', 'creator-refresh'],
        ['realRefreshExpiresAt', 'creator-expiry'],
        ['realSessionBackupVersion', '2'],
        ['realUser', JSON.stringify({ id: 1, username: 'creator' })]
    ]);
    const storage = map => ({
        getItem: key => map.get(key) || null,
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: key => map.delete(key)
    });
    const calls = [];
    const context = {
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true };
        },
        AUTH_ACCESS_TOKEN_KEY: 'pzp_access_token',
        AUTH_REFRESH_TOKEN_KEY: 'pzp_refresh_token',
        AUTH_REFRESH_EXPIRES_KEY: 'pzp_refresh_expires_at',
        AUTH_SESSION_GENERATION_KEY: 'pzp_auth_session_generation',
        AUTH_TRANSITION_KEY: 'pzp_auth_transition',
        AUTH_LOGIN_INTENT_KEY: 'pzp_auth_login_intent',
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } }
    };
    vm.createContext(context);
    vm.runInContext([
        extractAuthFunction('revokeRefreshTokenValue'),
        extractAuthFunction('clearImpersonationBackup'),
        extractAuthFunction('clearAuthStorage')
    ].join('\n'), context, { filename: 'js/auth.js' });

    context.clearAuthStorage();

    assert.equal(localStore.size, 0);
    assert.equal(sessionStore.size, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), { refreshToken: 'creator-refresh' });
});

test('terminal cleanup can preserve an active explicit login intent while clearing the old session', () => {
    const localStore = new Map([
        ['pzp_token', 'old-token'],
        ['pzp_access_token', 'old-access'],
        ['pzp_refresh_token', 'old-refresh'],
        ['pzp_auth_login_intent', 'pending-login'],
        ['pzp_current_user', JSON.stringify({ id: 14, username: 'old.user' })]
    ]);
    const sessionStore = new Map();
    const storage = map => ({
        getItem: key => map.get(key) || null,
        removeItem: key => map.delete(key)
    });
    const context = {
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        AUTH_ACCESS_TOKEN_KEY: 'pzp_access_token',
        AUTH_REFRESH_TOKEN_KEY: 'pzp_refresh_token',
        AUTH_REFRESH_EXPIRES_KEY: 'pzp_refresh_expires_at',
        AUTH_SESSION_GENERATION_KEY: 'pzp_auth_session_generation',
        AUTH_TRANSITION_KEY: 'pzp_auth_transition',
        AUTH_LOGIN_INTENT_KEY: 'pzp_auth_login_intent',
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } }
    };
    vm.createContext(context);
    vm.runInContext([
        extractAuthFunction('clearImpersonationBackup'),
        extractAuthFunction('clearAuthStorage')
    ].join('\n'), context, { filename: 'js/auth.js' });

    context.clearAuthStorage({ preserveLoginIntent: true });

    assert.deepEqual([...localStore.entries()], [['pzp_auth_login_intent', 'pending-login']]);
    assert.equal(sessionStore.size, 0);
});

test('remembering a new login revokes an isolated creator refresh before replacing the session', () => {
    const localStore = new Map([
        ['pzp_token', 'target-access'],
        ['pzp_refresh_token', 'target-refresh'],
        ['pzp_current_user', JSON.stringify({ id: 14, username: 'target.user' })]
    ]);
    const sessionStore = new Map([
        ['realSessionBackupVersion', '2'],
        ['impersonating', 'target.user'],
        ['realRefreshToken', 'creator-refresh']
    ]);
    const calls = [];
    const storage = store => ({
        getItem: key => store.get(key) || null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    });
    const context = {
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true };
        },
        AUTH_ACCESS_TOKEN_KEY: 'pzp_access_token',
        AUTH_REFRESH_TOKEN_KEY: 'pzp_refresh_token',
        AUTH_REFRESH_EXPIRES_KEY: 'pzp_refresh_expires_at',
        AUTH_SESSION_GENERATION_KEY: 'pzp_auth_session_generation',
        AUTH_TRANSITION_KEY: 'pzp_auth_transition',
        AUTH_LOGIN_INTENT_KEY: 'pzp_auth_login_intent',
        AUTH_TRANSITION_MAX_AGE_MS: 15000,
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } }
    };
    vm.createContext(context);
    vm.runInContext(
        `let authOwnedTransition = null;\n`
            + extractAuthFunction('getActiveAuthTransitionMarker') + '\n'
            + extractAuthFunction('beginAuthTransition') + '\n'
            + extractAuthFunction('endAuthTransition') + '\n'
            + extractAuthFunction('revokeRefreshTokenValue') + '\n'
            + extractAuthFunction('clearImpersonationBackup') + '\n'
            + extractAuthFunction('rememberAuthSession'),
        context,
        { filename: 'js/auth.js' }
    );

    assert.equal(context.rememberAuthSession({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        user: { id: 93, username: 'new.user', role: 'manager' }
    }), true);

    assert.equal(sessionStore.size, 0);
    assert.equal(localStore.get('pzp_refresh_token'), 'new-refresh');
    assert.equal(JSON.parse(localStore.get('pzp_current_user')).id, 93);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), { refreshToken: 'creator-refresh' });
});

test('logout revokes an isolated creator refresh token before impersonation cleanup', () => {
    const { context, calls, localStore, sessionStore } = loadRefreshRevocationHarness([], [
        ['realSessionBackupVersion', '2'],
        ['impersonating', 'target.user'],
        ['realRefreshToken', 'creator-refresh']
    ]);

    context.revokeStoredRefreshToken();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/auth/logout');
    assert.equal(calls[0].options.keepalive, true);
    assert.deepEqual(JSON.parse(calls[0].options.body), { refreshToken: 'creator-refresh' });
    assert.equal(localStore.size, 0);
    assert.equal(sessionStore.get('realRefreshToken'), 'creator-refresh');
});

test('logout revokes each unique active and isolated refresh token exactly once', () => {
    const { context, calls } = loadRefreshRevocationHarness([
        ['pzp_refresh_token', 'target-refresh']
    ], [
        ['realSessionBackupVersion', '2'],
        ['impersonating', 'target.user'],
        ['realRefreshToken', 'creator-refresh']
    ]);

    context.revokeStoredRefreshToken();

    assert.deepEqual(
        calls.map(call => JSON.parse(call.options.body).refreshToken).sort(),
        ['creator-refresh', 'target-refresh']
    );
});

test('logout ignores a stale creator refresh backup without both impersonation markers', () => {
    for (const sessionEntries of [
        [['realRefreshToken', 'stale-refresh']],
        [['realSessionBackupVersion', '2'], ['realRefreshToken', 'stale-refresh']],
        [['impersonating', 'target.user'], ['realRefreshToken', 'stale-refresh']]
    ]) {
        const { context, calls } = loadRefreshRevocationHarness([], sessionEntries);
        context.revokeStoredRefreshToken();
        assert.equal(calls.length, 0);
    }
});

test('cross-tab terminal logout revokes and purges an isolated creator refresh backup', () => {
    const localStore = new Map();
    const sessionStore = new Map([
        ['realSessionBackupVersion', '2'],
        ['impersonating', 'target.user'],
        ['realRefreshToken', 'creator-refresh']
    ]);
    const calls = [];
    const storage = store => ({
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    });
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true };
        },
        setTimeout: callback => {
            callback();
            return 1;
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';\n`
            + `const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';\n`
            + `const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';\n`
            + `const AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';\n`
            + `let crossTabLogoutInProgress = false;\n`
            + `let crossTabSessionSyncInProgress = false;\n`
            + extractAuthFunction('clearImpersonationBackup') + '\n'
            + extractAuthFunction('revokeRefreshTokenValue') + '\n'
            + extractAuthFunction('revokeStoredRefreshToken') + '\n'
            + extractAuthFunction('handleCrossTabAuthStorageChange'),
        context,
        { filename: 'js/auth.js' }
    );
    context.logout = () => {
        context.revokeStoredRefreshToken();
        context.clearImpersonationBackup();
    };

    context.handleCrossTabAuthStorageChange({
        key: 'pzp_auth_session_generation',
        newValue: null
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/auth/logout');
    assert.deepEqual(JSON.parse(calls[0].options.body), { refreshToken: 'creator-refresh' });
    assert.equal(sessionStore.size, 0);
});

test('cross-tab account replacement immediately covers stale private UI and reloads once', () => {
    const userA = { id: 31, username: 'account.a' };
    const localStore = new Map([
        ['pzp_token', 'account-b-token'],
        ['pzp_access_token', 'account-b-token'],
        ['pzp_refresh_token', 'account-b-refresh'],
        ['pzp_auth_session_generation', 'generation-b'],
        ['pzp_current_user', JSON.stringify({ id: 32, username: 'account.b' })]
    ]);
    const calls = [];
    const elements = new Map();
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        localStorage: {
            getItem: key => localStore.get(key) || null
        },
        AppState: { currentUser: userA },
        resetAuthenticatedRuntimeReady: () => calls.push('reset-runtime'),
        clearRuntimePermissionCatalog: user => calls.push(['clear-permissions', user]),
        clearAuthenticatedPageShell: () => calls.push('clear-shell'),
        authBootstrapUsersShareIdentity: (left, right) => left?.id === right?.id,
        document: {
            getElementById: id => {
                if (!elements.has(id)) {
                    elements.set(id, { classList: { add: value => calls.push(['hide', id, value]) } });
                }
                return elements.get(id);
            }
        },
        window: { location: { reload: () => calls.push('reload') } }
    };
    vm.createContext(context);
    vm.runInContext(
        `const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';\n`
            + `const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';\n`
            + `const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';\n`
            + `const AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';\n`
            + `let crossTabLogoutInProgress = false;\n`
            + `let crossTabSessionSyncInProgress = false;\n`
            + extractAuthFunction('handleCrossTabAuthStorageChange'),
        context,
        { filename: 'js/auth.js' }
    );

    context.handleCrossTabAuthStorageChange({
        key: 'pzp_auth_session_generation',
        oldValue: 'generation-a',
        newValue: 'generation-b'
    });
    context.handleCrossTabAuthStorageChange({
        key: 'pzp_current_user',
        oldValue: JSON.stringify(userA),
        newValue: localStore.get('pzp_current_user')
    });

    assert.equal(context.AppState.currentUser, null);
    assert.equal(calls.filter(call => call === 'reload').length, 1);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'clear-permissions'), true);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'hide' && call[1] === 'mainApp'), true);
    assert.equal(localStore.get('pzp_refresh_token'), 'account-b-refresh');
});

test('cross-tab cleanup does not cancel an explicit login already in flight', () => {
    const localStore = new Map([['pzp_auth_login_intent', 'pending-login']]);
    const calls = [];
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        localStorage: {
            getItem: key => localStore.get(key) || null
        },
        clearAuthStorage: options => calls.push(['clear-auth', options]),
        clearPrivateClientCaches: () => calls.push('clear-caches'),
        showLoginScreen: () => calls.push('show-login'),
        logout: () => calls.push('logout'),
        setTimeout: callback => {
            callback();
            return 1;
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';\n`
            + `const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';\n`
            + `const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';\n`
            + `const AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';\n`
            + `let crossTabLogoutInProgress = false;\n`
            + `let crossTabSessionSyncInProgress = false;\n`
            + extractAuthFunction('handleCrossTabAuthStorageChange'),
        context,
        { filename: 'js/auth.js' }
    );

    context.handleCrossTabAuthStorageChange({
        key: 'pzp_auth_session_generation',
        oldValue: 'generation-a',
        newValue: null
    });

    assert.equal(calls.some(call => call === 'logout'), false);
    assert.equal(calls[0][0], 'clear-auth');
    assert.equal(calls[0][1]?.preserveLoginIntent, true);
    assert.equal(localStore.get('pzp_auth_login_intent'), 'pending-login');
});

test('logout cache fallback removes API and runtime namespaces', async () => {
    const deleted = [];
    const messages = [];
    const cacheStorage = {
        async keys() {
            return ['event-genix-api-v0.79.0', 'event-genix-v0.79.0', 'unrelated-cache'];
        },
        async delete(key) {
            deleted.push(key);
            return true;
        }
    };
    const context = {
        OfflineQueue: { clearQueue: async () => {} },
        navigator: {
            serviceWorker: {
                controller: { postMessage: message => messages.push(message) }
            }
        },
        window: { caches: cacheStorage },
        caches: cacheStorage
    };
    vm.createContext(context);
    vm.runInContext(extractAuthFunction('clearPrivateClientCaches'), context, { filename: 'js/auth.js' });

    context.clearPrivateClientCaches();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'CLEAR_PRIVATE_CACHES' }]);
    assert.deepEqual(deleted.sort(), ['event-genix-api-v0.79.0', 'event-genix-v0.79.0']);
});

test('alerts wait for authenticated runtime readiness before protected loading', () => {
    assert.match(
        ALERTS_CODE,
        /async function loadAlertBell\(\) \{\s*if \(typeof window\.isAuthenticatedRuntimeReady[^\n]+return;/
    );
    assert.match(
        ALERTS_CODE,
        /document\.addEventListener\('DOMContentLoaded', \(\) => \{\s*startAlertRuntime\(\);\s*\}\);/
    );
    assert.match(ALERTS_CODE, /window\.addEventListener\('crm:authenticated-runtime-ready', startAlertRuntime\)/);
});

test('timeline and deep-link loaders wait for successful session verification', () => {
    const initializeAppStart = APP_CODE.indexOf('function initializeApp()');
    const initializeAppEnd = APP_CODE.indexOf('function _checkAutoOpen()', initializeAppStart);
    const initializeAppBlock = APP_CODE.slice(initializeAppStart, initializeAppEnd);
    const renderTimelineStart = TIMELINE_CODE.indexOf('async function renderTimeline()');
    const renderTimelineEnd = TIMELINE_CODE.indexOf('function updateFilterBanner()', renderTimelineStart + 1);
    const renderTimelineBlock = TIMELINE_CODE.slice(renderTimelineStart, renderTimelineEnd);

    assert.match(initializeAppBlock, /const sessionCheck = checkSession\(\)/);
    assert.match(initializeAppBlock, /Promise\.resolve\(sessionCheck\)[\s\S]*if \(!authenticated\) return;[\s\S]*initializeAuthenticatedAppRuntime\(\);[\s\S]*_checkAutoOpen\(\)/);
    assert.doesNotMatch(initializeAppBlock, /initBookingPackageWorkspace\(\)/);
    assert.match(
        renderTimelineBlock,
        /if \(typeof window\.isAuthenticatedRuntimeReady === 'function' && !window\.isAuthenticatedRuntimeReady\(\)\) \{\s*queueTimelineRenderAfterAuthenticatedRuntimeReady\(\);\s*return false;/
    );
    assert.ok(
        renderTimelineBlock.indexOf('isAuthenticatedRuntimeReady') < renderTimelineBlock.indexOf('getBookingsForDate'),
        'auth guard must run before protected timeline API loaders'
    );
});

test('shared protected bootstrap waits for authenticated runtime readiness', () => {
    const authenticatedRuntimeStart = APP_CODE.indexOf('function initializeAuthenticatedAppRuntime()');
    const authenticatedRuntimeEnd = APP_CODE.indexOf('function bootstrapInitializeApp()', authenticatedRuntimeStart);
    const authenticatedRuntimeBlock = APP_CODE.slice(authenticatedRuntimeStart, authenticatedRuntimeEnd);

    assert.ok(authenticatedRuntimeStart >= 0);
    assert.match(authenticatedRuntimeBlock, /if \(!isAuthenticatedAppRuntimeReady\(\)\) return false;/);
    assert.match(authenticatedRuntimeBlock, /initBookingPackageWorkspace\(\)/);
    assert.match(APP_CODE, /window\.addEventListener\('crm:authenticated-runtime-ready', initializeAuthenticatedAppRuntime\)/);

    assert.match(
        SIDEBAR_CODE,
        /function _isAuthenticatedSidebarRuntimeReady\(\) \{[\s\S]*window\.isAuthenticatedRuntimeReady\(\)/
    );
    for (const functionName of [
        '_ensureSidebarBusinessProfile',
        '_refreshSidebarOperationalWidgets',
        '_refreshSidebarTimelineSummary',
        '_loadSidebarIdentityMeta'
    ]) {
        const start = SIDEBAR_CODE.indexOf(`function ${functionName}(`);
        const next = SIDEBAR_CODE.indexOf('\n    function ', start + 1);
        const block = SIDEBAR_CODE.slice(start, next > start ? next : undefined);
        assert.ok(start >= 0, `${functionName} is missing`);
        assert.match(block, /_isAuthenticatedSidebarRuntimeReady\(\)/, `${functionName} must be auth-ready gated`);
    }
    assert.match(SIDEBAR_CODE, /window\.addEventListener\('crm:authenticated-runtime-ready', \(\) => \{/);
    assert.match(
        TIMELINE_VISIBILITY_CODE,
        /function hasAuthenticatedTimelineUser\(\) \{[\s\S]*window\.isAuthenticatedRuntimeReady\(\)/
    );
    assert.match(
        TIMELINE_VISIBILITY_CODE,
        /window\.addEventListener\('crm:authenticated-runtime-ready', refreshAccess\)/
    );
});

test('apiFetchWithAuthRetry refreshes before protected task mutations when the legacy token is missing', async () => {
    const calls = [];
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({ url, options });
        if (url === '/api/auth/refresh') {
            return response(200, {
                accessToken: 'task-access-new',
                refreshToken: 'task-refresh-new',
                user: { id: 11, username: 'task.user' }
            });
        }
        if (url === '/api/tasks') {
            assert.equal(options.headers.Authorization, 'Bearer task-access-new');
            assert.equal(options.headers['Content-Type'], 'application/json');
            return response(200, { success: true, task: { id: 901 } });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }, {
        pzp_refresh_token: 'task-refresh-old',
        pzp_current_user: JSON.stringify({ id: 11, username: 'task.user' })
    });

    const res = await context.apiFetchWithAuthRetry('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'refresh-protected task' })
    });
    const data = await res.json();
    assert.equal(data.success, true);
    assert.deepEqual(calls.map(call => call.url), ['/api/auth/refresh', '/api/tasks']);
    assert.equal(store.get('pzp_token'), 'task-access-new');
    assert.equal(store.get('pzp_refresh_token'), 'task-refresh-new');
});

test('apiFetchWithAuthRetry preserves session on forbidden role-scoped API responses', async () => {
    const calls = [];
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({ url, options });
        assert.equal(url, '/api/tasks/owners');
        assert.equal(options.headers.Authorization, 'Bearer animator-token');
        return response(403, { error: 'Forbidden' });
    }, {
        pzp_token: 'animator-token',
        pzp_access_token: 'animator-token',
        pzp_refresh_token: 'animator-refresh',
        pzp_current_user: JSON.stringify({ id: 39, username: '1234567', role: 'animator' })
    });

    const res = await context.apiFetchWithAuthRetry('/api/tasks/owners');
    assert.equal(res.status, 403);
    assert.deepEqual(calls.map(call => call.url), ['/api/tasks/owners']);
    assert.equal(store.get('pzp_token'), 'animator-token');
    assert.equal(store.get('pzp_access_token'), 'animator-token');
    assert.equal(store.get('pzp_refresh_token'), 'animator-refresh');
    assert.match(store.get('pzp_current_user'), /1234567/);
});

test('handleAuthError treats 403 as authorization failure without logging the user out', () => {
    const { context, store } = loadApi(async () => response(500), {
        pzp_token: 'still-valid-token',
        pzp_access_token: 'still-valid-access',
        pzp_refresh_token: 'still-valid-refresh',
        pzp_current_user: JSON.stringify({ username: 'role-limited' })
    });

    assert.equal(context.handleAuthError(response(403)), false);
    assert.equal(store.get('pzp_token'), 'still-valid-token');
    assert.equal(store.get('pzp_access_token'), 'still-valid-access');
    assert.equal(store.get('pzp_refresh_token'), 'still-valid-refresh');
    assert.match(store.get('pzp_current_user'), /role-limited/);
});

test('a terminal response from an old session preserves an in-flight explicit login intent', () => {
    const loginIntent = 'login-in-progress';
    const { context, store } = loadApi(async () => response(500), {
        pzp_token: 'old-token',
        pzp_access_token: 'old-access',
        pzp_refresh_token: 'old-refresh',
        pzp_current_user: JSON.stringify({ id: 41, username: 'old.user' }),
        pzp_auth_login_intent: loginIntent
    });
    const clearCalls = [];
    context.clearAuthStorage = options => {
        clearCalls.push(options);
        store.delete('pzp_token');
        store.delete('pzp_access_token');
        store.delete('pzp_refresh_token');
        store.delete('pzp_current_user');
        if (options?.preserveLoginIntent !== true) store.delete('pzp_auth_login_intent');
    };
    context.clearPrivateClientCaches = () => {};
    context.showLoginScreen = () => {};

    assert.equal(context.handleAuthError(response(401), { refreshAttempted: true }), true);

    assert.equal(clearCalls.length, 1);
    assert.equal(clearCalls[0]?.preserveLoginIntent, true);
    assert.equal(store.get('pzp_auth_login_intent'), loginIntent);
    assert.equal(store.has('pzp_refresh_token'), false);
});

test('dashboard impersonation isolates the creator refresh session before reloading as the target', async () => {
    const localStore = new Map([
        ['pzp_token', 'creator-legacy'],
        ['pzp_access_token', 'creator-access'],
        ['pzp_refresh_token', 'creator-refresh'],
        ['pzp_refresh_expires_at', '2026-10-01T00:00:00.000Z'],
        ['pzp_auth_session_generation', 'creator-generation'],
        ['pzp_current_user', JSON.stringify({ id: 1, username: 'creator' })]
    ]);
    const sessionStore = new Map();
    const calls = [];
    const storage = store => ({
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    });
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } },
        AppState: { currentUser: { id: 1, username: 'creator' } },
        RoleSwitcher: {},
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        document: { getElementById: id => id === 'testUserSelect' ? { value: '72' } : null },
        fetch: async () => response(200, {
            token: 'target-access',
            user: { id: 72, username: 'target.user', role: 'animator' }
        }),
        rotateApiAuthSessionGeneration: () => {
            calls.push('rotate');
            localStore.set('pzp_auth_session_generation', 'target-generation');
        },
        showNotification: message => calls.push(['notification', message]),
        window: { location: { reload: () => calls.push('reload') } }
    };
    vm.createContext(context);
    vm.runInContext(extractSourceFunction(DASHBOARD_PAGE_CODE, 'switchTestUser'), context, {
        filename: 'js/dashboard-page.js'
    });

    await context.switchTestUser();

    assert.equal(sessionStore.get('realSessionBackupVersion'), '2');
    assert.equal(sessionStore.get('realToken'), 'creator-legacy');
    assert.equal(sessionStore.get('realAccessToken'), 'creator-access');
    assert.equal(sessionStore.get('realRefreshToken'), 'creator-refresh');
    assert.equal(sessionStore.get('realRefreshExpiresAt'), '2026-10-01T00:00:00.000Z');
    assert.equal(sessionStore.get('realSessionGeneration'), 'creator-generation');
    assert.equal(sessionStore.get('impersonationSessionGeneration'), 'target-generation');
    assert.equal(JSON.parse(sessionStore.get('impersonationTargetUser')).id, 72);
    assert.equal(localStore.get('pzp_token'), 'target-access');
    assert.equal(localStore.get('pzp_access_token'), 'target-access');
    assert.equal(localStore.has('pzp_refresh_token'), false);
    assert.equal(localStore.has('pzp_refresh_expires_at'), false);
    assert.equal(JSON.parse(localStore.get('pzp_current_user')).id, 72);
    assert.equal(localStore.has('pzp_auth_transition'), false);
    assert.deepEqual(calls, ['rotate', 'reload']);
});

test('a stale impersonation response cannot overwrite an account selected in another tab', async () => {
    const creator = { id: 1, username: 'creator' };
    const newerUser = { id: 91, username: 'newer.account' };
    const localStore = new Map([
        ['pzp_token', 'creator-access'],
        ['pzp_access_token', 'creator-access'],
        ['pzp_refresh_token', 'creator-refresh'],
        ['pzp_auth_session_generation', 'creator-generation'],
        ['pzp_current_user', JSON.stringify(creator)]
    ]);
    const sessionStore = new Map();
    const calls = [];
    let resolveImpersonation;
    let markRequestStarted;
    const requestStarted = new Promise(resolve => { markRequestStarted = resolve; });
    const storage = store => ({
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    });
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } },
        AppState: { currentUser: creator },
        RoleSwitcher: {},
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        document: { getElementById: id => id === 'testUserSelect' ? { value: '72' } : null },
        fetch: async () => {
            markRequestStarted();
            return await new Promise(resolve => { resolveImpersonation = resolve; });
        },
        rotateApiAuthSessionGeneration: () => calls.push('rotate'),
        showNotification: message => calls.push(['notification', message]),
        window: { location: { reload: () => calls.push('reload') } }
    };
    vm.createContext(context);
    vm.runInContext(extractSourceFunction(DASHBOARD_PAGE_CODE, 'switchTestUser'), context, {
        filename: 'js/dashboard-page.js'
    });

    const pendingSwitch = context.switchTestUser();
    await requestStarted;
    localStore.set('pzp_token', 'newer-access');
    localStore.set('pzp_access_token', 'newer-access');
    localStore.set('pzp_refresh_token', 'newer-refresh');
    localStore.set('pzp_auth_session_generation', 'newer-generation');
    localStore.set('pzp_current_user', JSON.stringify(newerUser));
    context.AppState.currentUser = newerUser;
    resolveImpersonation(response(200, {
        token: 'target-access',
        user: { id: 72, username: 'target.user', role: 'animator' }
    }));
    await pendingSwitch;

    assert.equal(localStore.get('pzp_token'), 'newer-access');
    assert.equal(localStore.get('pzp_refresh_token'), 'newer-refresh');
    assert.deepEqual(JSON.parse(localStore.get('pzp_current_user')), newerUser);
    assert.equal(sessionStore.size, 0);
    assert.equal(calls.some(call => call === 'reload' || call === 'rotate'), false);
    assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'notification').length, 1);
});

test('ending impersonation restores the creator token pair under a fresh session generation', () => {
    const localStore = new Map([
        ['pzp_token', 'target-access'],
        ['pzp_access_token', 'target-access'],
        ['pzp_auth_session_generation', 'target-generation'],
        ['pzp_current_user', JSON.stringify({ id: 72, username: 'target.user' })]
    ]);
    const sessionStore = new Map([
        ['realSessionBackupVersion', '2'],
        ['realToken', 'creator-legacy'],
        ['realAccessToken', 'creator-access'],
        ['realRefreshToken', 'creator-refresh'],
        ['realRefreshExpiresAt', '2026-10-01T00:00:00.000Z'],
        ['realSessionGeneration', 'creator-generation'],
        ['realUser', JSON.stringify({ id: 1, username: 'creator' })],
        ['impersonating', 'target.user'],
        ['impersonationSessionGeneration', 'target-generation'],
        ['impersonationTargetUser', JSON.stringify({ id: 72, username: 'target.user' })]
    ]);
    const calls = [];
    const storage = store => ({
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    });
    const roleSwitcherStart = AUTH_CODE.indexOf('const RoleSwitcher = (() => {');
    const roleSwitcherEnd = AUTH_CODE.indexOf('window.RoleSwitcher = RoleSwitcher;', roleSwitcherStart)
        + 'window.RoleSwitcher = RoleSwitcher;'.length;
    assert.ok(roleSwitcherStart >= 0 && roleSwitcherEnd > roleSwitcherStart);
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } },
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        revokeRefreshTokenValue: token => calls.push(['revoke', token]),
        clearImpersonationBackup: () => sessionStore.clear(),
        rotateApiAuthSessionGeneration: () => {
            calls.push('rotate');
            localStore.set('pzp_auth_session_generation', 'restored-generation');
        },
        window: {
            RolePreview: { clearPreviewRole: () => false },
            location: { reload: () => calls.push('reload') }
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';\n`
            + `const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';\n`
            + `const AUTH_REFRESH_EXPIRES_KEY = 'pzp_refresh_expires_at';\n`
            + `const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';\n`
            + `const AUTH_TRANSITION_KEY = 'pzp_auth_transition';\n`
            + AUTH_CODE.slice(roleSwitcherStart, roleSwitcherEnd),
        context,
        { filename: 'js/auth.js' }
    );

    assert.equal(context.window.RoleSwitcher.resetImpersonation(), true);
    assert.equal(localStore.get('pzp_token'), 'creator-legacy');
    assert.equal(localStore.get('pzp_access_token'), 'creator-access');
    assert.equal(localStore.get('pzp_refresh_token'), 'creator-refresh');
    assert.equal(localStore.get('pzp_refresh_expires_at'), '2026-10-01T00:00:00.000Z');
    assert.equal(localStore.get('pzp_auth_session_generation'), 'restored-generation');
    assert.equal(JSON.parse(localStore.get('pzp_current_user')).id, 1);
    assert.equal(sessionStore.size, 0);
    assert.deepEqual(calls, ['rotate', 'reload']);
});

test('ending stale impersonation cannot overwrite a newer cross-tab account session', () => {
    const newerUser = { id: 91, username: 'newer.account' };
    const localStore = new Map([
        ['pzp_token', 'newer-access'],
        ['pzp_access_token', 'newer-access'],
        ['pzp_refresh_token', 'newer-refresh'],
        ['pzp_auth_session_generation', 'newer-generation'],
        ['pzp_current_user', JSON.stringify(newerUser)]
    ]);
    const sessionStore = new Map([
        ['realSessionBackupVersion', '2'],
        ['realToken', 'creator-legacy'],
        ['realAccessToken', 'creator-access'],
        ['realRefreshToken', 'creator-refresh'],
        ['realUser', JSON.stringify({ id: 1, username: 'creator' })],
        ['impersonating', 'target.user'],
        ['impersonationSessionGeneration', 'target-generation'],
        ['impersonationTargetUser', JSON.stringify({ id: 72, username: 'target.user' })]
    ]);
    const calls = [];
    const storage = store => ({
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    });
    const roleSwitcherStart = AUTH_CODE.indexOf('const RoleSwitcher = (() => {');
    const roleSwitcherEnd = AUTH_CODE.indexOf('window.RoleSwitcher = RoleSwitcher;', roleSwitcherStart)
        + 'window.RoleSwitcher = RoleSwitcher;'.length;
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } },
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        rotateApiAuthSessionGeneration: () => calls.push('rotate'),
        revokeRefreshTokenValue: token => calls.push(['revoke', token]),
        clearImpersonationBackup: () => sessionStore.clear(),
        window: {
            RolePreview: { clearPreviewRole: () => false },
            location: { reload: () => calls.push('reload') }
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';\n`
            + `const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';\n`
            + `const AUTH_REFRESH_EXPIRES_KEY = 'pzp_refresh_expires_at';\n`
            + `const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';\n`
            + `const AUTH_TRANSITION_KEY = 'pzp_auth_transition';\n`
            + AUTH_CODE.slice(roleSwitcherStart, roleSwitcherEnd),
        context,
        { filename: 'js/auth.js' }
    );

    assert.equal(context.window.RoleSwitcher.resetImpersonation(), false);
    assert.equal(localStore.get('pzp_token'), 'newer-access');
    assert.equal(localStore.get('pzp_refresh_token'), 'newer-refresh');
    assert.deepEqual(JSON.parse(localStore.get('pzp_current_user')), newerUser);
    assert.equal(sessionStore.size, 0);
    assert.deepEqual(calls, [['revoke', 'creator-refresh']]);
});

test('ending impersonation during an active auth transition preserves the creator backup', () => {
    const targetUser = { id: 72, username: 'target.user' };
    const marker = `auth-${Date.now().toString(36)}-external`;
    const localStore = new Map([
        ['pzp_token', 'target-access'],
        ['pzp_access_token', 'target-access'],
        ['pzp_auth_session_generation', 'target-generation'],
        ['pzp_auth_transition', marker],
        ['pzp_current_user', JSON.stringify(targetUser)]
    ]);
    const sessionStore = new Map([
        ['realSessionBackupVersion', '2'],
        ['realRefreshToken', 'creator-refresh'],
        ['realUser', JSON.stringify({ id: 1, username: 'creator' })],
        ['impersonating', 'target.user'],
        ['impersonationSessionGeneration', 'target-generation'],
        ['impersonationTargetUser', JSON.stringify(targetUser)]
    ]);
    const calls = [];
    const storage = store => ({
        getItem: key => store.has(key) ? store.get(key) : null,
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key)
    });
    const roleSwitcherStart = AUTH_CODE.indexOf('const RoleSwitcher = (() => {');
    const roleSwitcherEnd = AUTH_CODE.indexOf('window.RoleSwitcher = RoleSwitcher;', roleSwitcherStart)
        + 'window.RoleSwitcher = RoleSwitcher;'.length;
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } },
        localStorage: storage(localStore),
        sessionStorage: storage(sessionStore),
        revokeRefreshTokenValue: token => calls.push(['revoke', token]),
        clearImpersonationBackup: () => sessionStore.clear(),
        window: {
            RolePreview: { clearPreviewRole: () => false },
            location: { reload: () => calls.push('reload') }
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';\n`
            + `const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';\n`
            + `const AUTH_REFRESH_EXPIRES_KEY = 'pzp_refresh_expires_at';\n`
            + `const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';\n`
            + `const AUTH_TRANSITION_KEY = 'pzp_auth_transition';\n`
            + `const AUTH_TRANSITION_MAX_AGE_MS = 15000;\n`
            + `let authOwnedTransition = null;\n`
            + extractAuthFunction('getActiveAuthTransitionMarker') + '\n'
            + extractAuthFunction('beginAuthTransition') + '\n'
            + extractAuthFunction('endAuthTransition') + '\n'
            + AUTH_CODE.slice(roleSwitcherStart, roleSwitcherEnd),
        context,
        { filename: 'js/auth.js' }
    );

    assert.equal(context.window.RoleSwitcher.resetImpersonation(), false);
    assert.equal(localStore.get('pzp_auth_transition'), marker);
    assert.equal(sessionStore.get('realRefreshToken'), 'creator-refresh');
    assert.deepEqual(calls, []);
});

test('auth headers and session detection accept access-only or refresh-only storage', () => {
    const { context: accessContext } = loadApi(async () => response(500), {
        pzp_access_token: 'access-only'
    });
    assert.equal(accessContext.apiHasStoredAuthSession(), true);
    assert.equal(accessContext.getAuthHeaders(false).Authorization, 'Bearer access-only');

    const { context: refreshContext } = loadApi(async () => response(500), {
        pzp_refresh_token: 'refresh-only'
    });
    assert.equal(refreshContext.apiHasStoredAuthSession(), true);
    assert.equal(refreshContext.getAuthHeaders(false).Authorization, undefined);

    const { context: emptyContext } = loadApi(async () => response(500));
    assert.equal(emptyContext.apiHasStoredAuthSession(), false);
});

test('apiVerifyToken returns null without stored auth state and avoids network requests', async () => {
    const { context } = loadApi(async url => {
        throw new Error(`Unexpected fetch: ${url}`);
    });

    assert.equal(await context.apiVerifyToken(), null);
});

test('auto-fill never enforces page access while permissions are idle', () => {
    const { context, calls } = loadAutoFillHarness({
        appUser: { id: 17, username: 'manager.cached', role: 'manager' },
        permissionStatus: 'idle',
        runtimeReady: true
    });

    context._autoFillUser();

    assert.equal(calls.some(call => call[0] === 'enforceCurrentPageAccess'), false);
});

test('terminal auth cleanup cannot be undone by a later auto-fill tick', () => {
    const user = { id: 17, username: 'manager.cached', role: 'manager' };
    const { context, calls, store, sessionStore } = loadAutoFillHarness({
        appUser: user,
        cachedUser: user,
        permissionStatus: 'ready',
        runtimeReady: true
    });
    store.set('pzp_token', 'expired-token');
    store.set('pzp_access_token', 'expired-access');
    store.set('pzp_refresh_token', 'revoked-refresh');
    store.set('pzp_auth_session_generation', 'terminal-generation');
    sessionStore.set('realSessionBackupVersion', '2');
    sessionStore.set('impersonating', 'target.user');
    sessionStore.set('realRefreshToken', 'creator-refresh');

    vm.runInContext(
        `const AUTH_ACCESS_TOKEN_KEY = 'pzp_access_token';\n`
            + `const AUTH_REFRESH_TOKEN_KEY = 'pzp_refresh_token';\n`
            + `const AUTH_REFRESH_EXPIRES_KEY = 'pzp_refresh_expires_at';\n`
            + `const AUTH_SESSION_GENERATION_KEY = 'pzp_auth_session_generation';\n`
            + `const AUTH_TRANSITION_KEY = 'pzp_auth_transition';\n`
            + `const AUTH_LOGIN_INTENT_KEY = 'pzp_auth_login_intent';\n`
            + extractAuthFunction('clearImpersonationBackup') + '\n'
            + extractAuthFunction('clearAuthStorage'),
        context,
        { filename: 'js/auth.js' }
    );

    context.clearAuthStorage();
    context._autoFillUser();

    assert.equal(context.AppState.currentUser, null);
    assert.equal(store.has('pzp_current_user'), false);
    assert.equal(store.has('pzp_refresh_token'), false);
    assert.equal(sessionStore.size, 0);
    assert.equal(calls.some(call => call[0] === 'enforceCurrentPageAccess'), false);
});

test('cache-only user cannot become verified across repeated auto-fill ticks', () => {
    const harness = loadAutoFillHarness({
        cachedUser: { id: 23, name: 'Cached Manager', role: 'manager' },
        permissionStatus: 'ready',
        runtimeReady: false
    });

    harness.context._autoFillUser();
    assert.equal(harness.context.AppState.currentUser.id, 23, 'first tick may restore display data');
    harness.context._autoFillUser();
    assert.equal(
        harness.calls.some(call => call[0] === 'enforceCurrentPageAccess'),
        false,
        'restored AppState data must not become proof of server verification on the next tick'
    );

    harness.setRuntimeReady(true);
    harness.context._autoFillUser();
    assert.equal(harness.calls.filter(call => call[0] === 'enforceCurrentPageAccess').length, 1);
});

test('auto-fill never overwrites a newer account stored by another tab', () => {
    const accountA = { id: 23, username: 'account.a', name: 'Account A', role: 'animator' };
    const accountB = { id: 24, username: 'account.b', name: 'Account B', role: 'manager' };
    const harness = loadAutoFillHarness({
        appUser: accountA,
        cachedUser: accountB,
        permissionStatus: 'ready',
        runtimeReady: true
    });

    harness.context._autoFillUser();

    assert.equal(harness.context.AppState.currentUser, accountA);
    assert.deepEqual(JSON.parse(harness.store.get('pzp_current_user')), accountB);
    assert.equal(harness.calls.some(call => call[0] === 'enforceCurrentPageAccess'), false);
    assert.equal(harness.calls.some(call => call[0] === 'setApiAuthSessionFailure'), true);
    assert.equal(harness.calls.some(call => call[0] === 'showAuthenticatedPageShell'), true);
    assert.equal(harness.calls.some(call => call[0] === 'renderAuthSessionBootstrapError'), true);
});

test('business profile hydration cannot publish after the auth session changes', async () => {
    let resolveProfile;
    let profileStarted;
    const profileStartedPromise = new Promise(resolve => { profileStarted = resolve; });
    const accountA = { id: 31, username: 'account.a', role: 'animator' };
    const accountB = { id: 32, username: 'account.b', role: 'manager' };
    const store = new Map([['pzp_current_user', JSON.stringify(accountA)]]);
    let sessionCurrent = true;
    const context = {
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } },
        AppState: { currentUser: accountA },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value))
        },
        captureAuthBootstrapSession: () => ({ generation: 'account-a-generation' }),
        isAuthBootstrapSessionCurrent: () => sessionCurrent,
        authBootstrapSessionChangedError: stage => {
            const error = new Error('session changed');
            error.code = 'auth_session_transient';
            error.stage = stage;
            return error;
        },
        window: {
            CrmBusinessContext: {
                hydrateProfile: async () => {
                    profileStarted();
                    return await new Promise(resolve => { resolveProfile = resolve; });
                }
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(
        extractAuthFunction('hydrateBusinessOperatingProfile'),
        context,
        { filename: 'js/auth.js' }
    );

    const hydration = context.hydrateBusinessOperatingProfile(accountA);
    await profileStartedPromise;
    sessionCurrent = false;
    context.AppState.currentUser = accountB;
    store.set('pzp_current_user', JSON.stringify(accountB));
    resolveProfile({ key: 'stale-account-a-profile' });

    await assert.rejects(hydration, error => error.code === 'auth_session_transient');
    assert.equal(Object.hasOwn(accountA, 'businessProfile'), false);
    assert.equal(context.AppState.currentUser, accountB);
    assert.equal(JSON.parse(store.get('pzp_current_user')).id, 32);
});

test('bootstrap session-change errors preserve an existing terminal auth failure', () => {
    const terminalFailure = {
        kind: 'terminal',
        terminal: true,
        transient: false,
        stage: 'request',
        reason: 'unauthorized'
    };
    const calls = [];
    const context = {
        getApiAuthSessionFailure: () => terminalFailure,
        markApiAuthSessionChanged: stage => calls.push(['mark', stage]),
        setApiAuthSessionFailure: (...args) => calls.push(['set', ...args])
    };
    vm.createContext(context);
    vm.runInContext(extractAuthFunction('authBootstrapSessionChangedError'), context, {
        filename: 'js/auth.js'
    });

    const error = context.authBootstrapSessionChangedError('business-profile');

    assert.equal(error.code, 'auth_session_terminal');
    assert.equal(error.authFailure, terminalFailure);
    assert.deepEqual(calls, []);
});

test('sidebar verify fallback preserves hydrated runtime and cached permissions', () => {
    const permissionSnapshot = {
        capabilities: { 'page:/certificates': { allowed: true } },
        capabilityCatalog: { pageRoles: { '/certificates': ['animator'] } }
    };
    const runtimeUser = {
        id: 31,
        name: '?',
        role: 'animator',
        permissions: permissionSnapshot,
        businessProfile: { key: 'event_genix' }
    };
    const store = new Map([
        ['pzp_current_user', JSON.stringify(runtimeUser)]
    ]);
    const context = {
        AppState: { currentUser: runtimeUser, authPermissions: permissionSnapshot },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value))
        }
    };
    vm.createContext(context);
    vm.runInContext(
        extractSourceFunction(SIDEBAR_CODE, '_mergeVerifiedSidebarUser'),
        context,
        { filename: 'js/components/sidebar.js' }
    );

    const result = context._mergeVerifiedSidebarUser({ id: 31, name: 'Валерія', role: 'animator' });
    const cached = JSON.parse(store.get('pzp_current_user'));

    assert.equal(result, runtimeUser, 'sidebar must preserve the hydrated runtime user object');
    assert.equal(context.AppState.currentUser, runtimeUser);
    assert.equal(result.permissions, permissionSnapshot);
    assert.equal(result.businessProfile.key, 'event_genix');
    assert.equal(cached.permissions.capabilities['page:/certificates'].allowed, true);
});

test('sidebar verify fallback drops stale permissions when authorization changes', () => {
    const permissionSnapshot = {
        capabilities: { 'page:/certificates': { allowed: true } }
    };
    const runtimeUser = {
        id: 31,
        username: 'operator',
        role: 'animator',
        roles: ['animator'],
        permissions: permissionSnapshot
    };
    const store = new Map([
        ['pzp_current_user', JSON.stringify(runtimeUser)]
    ]);
    const context = {
        AppState: { currentUser: runtimeUser, authPermissions: permissionSnapshot },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value))
        }
    };
    vm.createContext(context);
    vm.runInContext(
        extractSourceFunction(SIDEBAR_CODE, '_mergeVerifiedSidebarUser'),
        context,
        { filename: 'js/components/sidebar.js' }
    );

    const result = context._mergeVerifiedSidebarUser({
        id: 31,
        username: 'operator',
        role: 'manager',
        roles: ['manager']
    });
    const cached = JSON.parse(store.get('pzp_current_user'));

    assert.notEqual(result, runtimeUser);
    assert.equal(result.role, 'manager');
    assert.equal(Object.hasOwn(result, 'permissions'), false);
    assert.equal(context.AppState.authPermissions, null);
    assert.equal(cached.role, 'manager');
    assert.equal(Object.hasOwn(cached, 'permissions'), false);
});

test('sidebar clears stale permission state before publishing an authorization change', () => {
    const permissionSnapshot = {
        capabilities: { 'page:/certificates': { allowed: true } }
    };
    const runtimeUser = {
        id: 31,
        username: 'operator',
        role: 'animator',
        permissions: permissionSnapshot
    };
    const events = [];
    let currentUser = runtimeUser;
    let lifecycle = 'ready';
    const appState = { authPermissions: permissionSnapshot };
    Object.defineProperty(appState, 'currentUser', {
        configurable: true,
        get: () => currentUser,
        set: value => {
            events.push({
                type: 'user-changed',
                permissions: appState.authPermissions,
                lifecycle
            });
            currentUser = value;
        }
    });
    const context = {
        AppState: appState,
        clearRuntimePermissionCatalog: target => {
            events.push({ type: 'catalog-cleared' });
            appState.authPermissions = null;
            delete target.permissions;
        },
        setPermissionLifecycle: status => {
            lifecycle = status;
            events.push({ type: 'lifecycle', status });
        },
        localStorage: {
            getItem: () => JSON.stringify(runtimeUser),
            setItem: () => {}
        }
    };
    vm.createContext(context);
    vm.runInContext(
        extractSourceFunction(SIDEBAR_CODE, '_mergeVerifiedSidebarUser'),
        context,
        { filename: 'js/components/sidebar.js' }
    );

    context._mergeVerifiedSidebarUser({
        id: 31,
        username: 'operator',
        role: 'manager',
        roles: ['manager']
    });

    assert.deepEqual(events.map(event => event.type), ['catalog-cleared', 'lifecycle', 'user-changed']);
    assert.equal(events[2].permissions, null, 'user-changed listeners must not observe the old catalog');
    assert.equal(events[2].lifecycle, 'loading', 'user-changed listeners must see permissions as loading');
});

test('sidebar verify fallback cannot overwrite a runtime user after an account switch', () => {
    const runtimeUser = { id: 42, username: 'new.account', role: 'manager' };
    const cachedJson = JSON.stringify(runtimeUser);
    const store = new Map([['pzp_current_user', cachedJson]]);
    const context = {
        AppState: { currentUser: runtimeUser, authPermissions: { capabilities: {} } },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value))
        }
    };
    vm.createContext(context);
    vm.runInContext(
        extractSourceFunction(SIDEBAR_CODE, '_mergeVerifiedSidebarUser'),
        context,
        { filename: 'js/components/sidebar.js' }
    );

    const result = context._mergeVerifiedSidebarUser({
        id: 41,
        username: 'old.account',
        role: 'animator'
    });

    assert.equal(result, null);
    assert.equal(context.AppState.currentUser, runtimeUser);
    assert.equal(store.get('pzp_current_user'), cachedJson);
});

test('sidebar verify fallback cannot restore stale runtime identity over a newer cached account', () => {
    const runtimeUser = { id: 41, username: 'old.account', role: 'animator' };
    const cachedUser = { id: 42, username: 'new.account', role: 'manager' };
    const cachedJson = JSON.stringify(cachedUser);
    const store = new Map([['pzp_current_user', cachedJson]]);
    const failures = [];
    const context = {
        AppState: { currentUser: runtimeUser, authPermissions: { capabilities: {} } },
        setApiAuthSessionFailure: (kind, details) => failures.push({ kind, ...details }),
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value))
        }
    };
    vm.createContext(context);
    vm.runInContext(
        extractSourceFunction(SIDEBAR_CODE, '_mergeVerifiedSidebarUser'),
        context,
        { filename: 'js/components/sidebar.js' }
    );

    const result = context._mergeVerifiedSidebarUser(runtimeUser);

    assert.equal(result, null);
    assert.equal(context.AppState.currentUser, runtimeUser);
    assert.equal(store.get('pzp_current_user'), cachedJson);
    assert.deepEqual(failures, [{ kind: 'transient', stage: 'sidebar', reason: 'session-changed' }]);
});

test('sales funnel verifies the shared session before protected loaders', () => {
    const resolverStart = LEADS_PAGE_CODE.indexOf('async function resolveLeadAuthenticatedUser()');
    const resolverEnd = LEADS_PAGE_CODE.indexOf('function showLeadBootstrapError(', resolverStart);
    const resolverCode = LEADS_PAGE_CODE.slice(resolverStart, resolverEnd);
    const initStart = LEADS_PAGE_CODE.indexOf("document.addEventListener('DOMContentLoaded', async () => {");
    const verifyCall = LEADS_PAGE_CODE.indexOf('user = await resolveLeadAuthenticatedUser()', initStart);
    const authErrorStart = LEADS_PAGE_CODE.indexOf('} catch (error) {', verifyCall);
    const missingSessionRedirect = LEADS_PAGE_CODE.indexOf('if (!user) {', authErrorStart);
    const authErrorCode = LEADS_PAGE_CODE.slice(authErrorStart, missingSessionRedirect);
    const autoFillStart = AUTH_CODE.indexOf('function _autoFillUser()');
    const autoFillEnd = AUTH_CODE.indexOf('setTimeout(_autoFillUser, 200)', autoFillStart);
    const autoFillCode = AUTH_CODE.slice(autoFillStart, autoFillEnd);
    const loadUsersCall = LEADS_PAGE_CODE.indexOf('await loadUsers()', initStart);
    const loadLeadsCall = LEADS_PAGE_CODE.indexOf('await loadLeads()', initStart);
    const initAuthBlock = LEADS_PAGE_CODE.slice(initStart, verifyCall);

    assert.ok(resolverStart >= 0 && resolverEnd > resolverStart, 'sales funnel auth resolver is missing');
    assert.ok(initStart >= 0, 'sales funnel bootstrap is missing');
    assert.ok(verifyCall > initStart, 'sales funnel must verify the shared auth session');
    assert.ok(authErrorStart > verifyCall && missingSessionRedirect > authErrorStart, 'sales funnel auth failure branches are missing');
    assert.ok(loadUsersCall > verifyCall, 'users must load after session verification');
    assert.ok(loadLeadsCall > loadUsersCall, 'leads must load after session verification');
    assert.doesNotMatch(initAuthBlock, /localStorage\.getItem\(['"]pzp_token['"]\)/);
    assert.match(resolverCode, /apiHasStoredAuthSession\(\)/);
    assert.match(resolverCode, /await apiVerifyToken\(\)/);
    assert.match(resolverCode, /await hydrateBusinessOperatingProfile\(user\)/);
    assert.match(resolverCode, /await hydrateActionPermissions\(user\)/);
    assert.match(resolverCode, /if \(!permissions\) throw new Error\(/);
    assert.match(resolverCode, /AppState\.currentUser = user/);
    assert.match(resolverCode, /!enforceCurrentPageAccess\(user\)/);
    assert.match(resolverCode, /return user;/);
    assert.match(authErrorCode, /showLeadBootstrapError\(error\);\s*return;/);
    assert.match(LEADS_PAGE_CODE.slice(missingSessionRedirect, loadUsersCall), /if \(!leadAuthRedirectHandled\) window\.location\.href = '\/';/);
    assert.match(LEADS_PAGE_CODE, /apiFetchWithAuthRetry\(leadApiUrl\(url\)/);
    assert.match(autoFillCode, /const hasVerifiedRuntime = isAuthenticatedRuntimeReady\(\);/);
    assert.match(autoFillCode, /if \(!hasVerifiedRuntime \|\| permissionState !== 'ready'\) return;/);
    assert.match(autoFillCode, /if \(!enforceCurrentPageAccess\(user\)\) return;/);
});

test('tasks page lets apiVerifyToken own refresh-token bootstrap instead of prechecking legacy token', () => {
    const initStart = TASKS_PAGE_CODE.indexOf('async function initPage()');
    const verifyCall = TASKS_PAGE_CODE.indexOf('user = await apiVerifyToken()', initStart);
    const initAuthBlock = TASKS_PAGE_CODE.slice(initStart, verifyCall);
    assert.ok(initStart >= 0);
    assert.ok(verifyCall > initStart);
    assert.doesNotMatch(initAuthBlock, /localStorage\.getItem\('pzp_token'\)/);
    assert.doesNotMatch(initAuthBlock, /window\.location\.href = '\/'/);
});

test('account/profile/staff surfaces do not block refresh-token bootstrap with legacy token prechecks', () => {
    for (const [name, code] of [
        ['hr', HR_PAGE_CODE],
        ['profile', PROFILE_PAGE_CODE],
        ['staff', STAFF_PAGE_CODE]
    ]) {
        const initStart = name === 'staff'
            ? code.indexOf('async function initStaffSchedulePage')
            : code.indexOf('async function initPage()') >= 0
                ? code.indexOf('async function initPage()')
                : code.indexOf('async function initProfilePage()');
        const verifyCall = code.indexOf('apiVerifyToken()', initStart);
        const initAuthBlock = code.slice(initStart, verifyCall);
        assert.ok(initStart >= 0, `${name} init function missing`);
        assert.ok(verifyCall > initStart, `${name} verify call missing`);
        assert.doesNotMatch(initAuthBlock, /localStorage\.getItem\('pzp_token'\)/, `${name} prechecks legacy token before refresh`);
        assert.doesNotMatch(initAuthBlock, /window\.location\.href = '\/'/, `${name} redirects before refresh`);
    }
    assert.match(HR_PAGE_CODE, /apiFetchWithAuthRetry\(`\/api\/hr\$\{path\}`/);
    assert.match(HR_PAGE_CODE, /apiFetchWithAuthRetry\(path, request\)/);
});

test('apiVerifyToken retries verify once after an expired stored token', async () => {
    const calls = [];
    const { context } = loadApi(async (url, options = {}) => {
        calls.push({ url, auth: options.headers?.Authorization || '' });
        if (url === '/api/auth/verify' && calls.length === 1) return response(401, { error: 'expired' });
        if (url === '/api/auth/refresh') {
            return response(200, {
                accessToken: 'access-rotated',
                refreshToken: 'refresh-rotated',
                user: { id: 8, username: 'rotated.user' }
            });
        }
        if (url === '/api/auth/verify') {
            assert.equal(options.headers.Authorization, 'Bearer access-rotated');
            return response(200, { user: { id: 8, username: 'rotated.user' } });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }, {
        pzp_token: 'expired-token',
        pzp_refresh_token: 'refresh-old',
        pzp_current_user: JSON.stringify({ username: 'rotated.user' })
    });

    const user = await context.apiVerifyToken();
    assert.equal(user.username, 'rotated.user');
    assert.deepEqual(calls.map(call => call.url), ['/api/auth/verify', '/api/auth/refresh', '/api/auth/verify']);
    assert.equal(calls[0].auth, 'Bearer expired-token');
});

test('apiVerifyToken clears stored auth state when refresh is rejected', async () => {
    const { context, store } = loadApi(async (url) => {
        assert.equal(url, '/api/auth/refresh');
        return response(401, { error: 'invalid refresh' });
    }, {
        pzp_refresh_token: 'bad-refresh',
        pzp_access_token: 'stale-access',
        pzp_token: 'stale-token',
        pzp_current_user: JSON.stringify({ username: 'stale' }),
        pzp_session: 'stale-session'
    });

    const user = await context.apiRefreshAuthToken();
    assert.equal(user, null);
    assert.equal(store.has('pzp_refresh_token'), false);
    assert.equal(store.has('pzp_access_token'), false);
    assert.equal(store.has('pzp_token'), false);
    assert.equal(store.has('pzp_current_user'), false);
    assert.equal(store.has('pzp_session'), false);
});

test('protected page bootstrap inventory delegates refresh-only sessions to apiVerifyToken', () => {
    const surfaces = [
        ['finance', 'js/finance-page.js', 'async function initFinancePage()'],
        ['training', 'js/training-page.js', 'async function initTrainingShell()'],
        ['accounting deposits', 'js/accounting-deposits.js', 'async function bootstrapAccountingDepositsShell()'],
        ['afisha', 'js/afisha-page.js', 'async function bootstrapAfishaShell()'],
        ['analytics', 'js/analytics-page.js', 'async function initStandaloneAnalyticsPage()'],
        ['warehouse', 'js/warehouse-page.js', 'async function initPage()'],
        ['dashboard', 'dashboard.html', '// Check session on load'],
        ['designer', 'designer.html', '// Auth check — unhide mainApp'],
        ['room', 'room.html', 'async function initRoomPage()'],
        ['quiz', 'quiz.html', 'async function initQuizPage()'],
        ['shop', 'js/shop-page.js', 'async function initShopPage()'],
        ['certificates', 'js/certificates-page.js', 'async function bootstrapAuthenticatedShell()'],
        ['customers', 'js/customers-page.js', 'async function initPage()'],
        ['copilot', 'js/copilot-page.js', 'async function waitForAuth()'],
        ['omni', 'omni.html', '// Auth check (standalone page pattern'],
        ['chat', 'js/chat-page.js', 'async function _checkAuthAndInit()'],
        ['guardian ops', 'js/guardian-ops-page.js', 'async function initSession()'],
        ['designs', 'js/designs-page.js', '(async function initAuth()'],
        ['mini-game', 'js/minigame-match3.js', 'async function initGamePage()'],
        ['art director', 'js/art-director-page.js', 'async function initAuth()']
    ];

    for (const [name, relativePath, marker] of surfaces) {
        const code = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
        const start = code.indexOf(marker);
        const verifyCall = code.indexOf('apiVerifyToken()', start);
        const bootstrapBeforeVerify = code.slice(start, verifyCall);
        assert.ok(start >= 0, `${name} bootstrap marker missing`);
        assert.ok(verifyCall > start, `${name} must call apiVerifyToken`);
        assert.doesNotMatch(
            bootstrapBeforeVerify,
            /localStorage\.getItem\(['"]pzp_token['"]\)/,
            `${name} must not reject refresh-only sessions before verification`
        );
    }
});

test('every production apiVerifyToken page bootstrap distinguishes transient failures before terminal handling', () => {
    const dedicatedTransientHandlers = new Set([
        'js/auth.js',
        'js/certificates-page.js',
        'js/hermes-studio-page.js',
        'js/leads-page.js'
    ]);
    const harmlessCallsites = new Set([
        'js/components/sidebar.js'
    ]);
    const productionFiles = [
        ...fs.readdirSync(ROOT)
            .filter(file => file.endsWith('.html')),
        ...fs.readdirSync(path.join(ROOT, 'js'), { recursive: true })
            .filter(file => file.endsWith('.js'))
            .map(file => `js/${file.replaceAll('\\', '/')}`)
    ];
    const pageCallsites = productionFiles.filter(relativePath => {
        if (relativePath === 'js/api.js') return false;
        const code = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
        return /\bapiVerifyToken\s*\(/.test(code);
    });

    assert.ok(pageCallsites.length >= 37, 'expected the complete protected-page bootstrap inventory');
    for (const relativePath of pageCallsites) {
        const code = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
        if (harmlessCallsites.has(relativePath)) {
            assert.doesNotMatch(
                code,
                /apiVerifyToken[\s\S]{0,1200}(?:showLoginScreen\s*\(|location\.(?:assign|replace)\s*\(|location\.href\s*=|logout\s*\()/,
                `${relativePath} harmless verifier must not perform terminal auth handling`
            );
            continue;
        }
        if (dedicatedTransientHandlers.has(relativePath)) {
            assert.match(
                code,
                /isApiAuthSessionFailureTransient\s*\(/,
                `${relativePath} must retain its dedicated transient-session branch`
            );
            continue;
        }
        assert.match(
            code,
            /handleTransientAuthSessionBootstrap\s*\(/,
            `${relativePath} must guard transient null/throw before login redirect or overlay`
        );
    }

    for (const relativePath of [
        'js/center-page.js',
        'js/demo-page.js',
        'js/programs-page.js',
        'sound.html'
    ]) {
        const code = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
        const verifyIndex = code.indexOf('apiVerifyToken()');
        assert.ok(verifyIndex > 0, `${relativePath} verify call missing`);
        assert.match(
            code.slice(0, verifyIndex),
            /apiHasStoredAuthSession\s*\(\s*\)/,
            `${relativePath} must accept refresh-token-only sessions before verification`
        );
    }
});

test('Task 4 protected request surfaces use shared refresh retry and preserve 403 handling', () => {
    for (const [name, relativePath] of [
        ['finance', 'js/finance-page.js'],
        ['training', 'js/training-page.js'],
        ['afisha', 'js/afisha-page.js'],
        ['analytics', 'js/analytics-page.js'],
        ['warehouse', 'js/warehouse-page.js'],
        ['shop', 'js/shop-page.js'],
        ['room', 'room.html'],
        ['quiz', 'quiz.html'],
        ['mini-game', 'js/minigame-match3.js']
    ]) {
        const code = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
        assert.match(code, /apiFetchWithAuthRetry\(/, `${name} must use shared refresh retry`);
    }

    for (const relativePath of ['js/finance-page.js', 'js/analytics-page.js']) {
        const code = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
        const requestStart = code.indexOf('async function apiRequest(');
        const closingMatch = code.slice(requestStart).match(/\r?\n}\r?\n/);
        const requestEnd = closingMatch
            ? requestStart + closingMatch.index + closingMatch[0].length
            : requestStart;
        const requestCode = code.slice(requestStart, requestEnd);
        assert.doesNotMatch(requestCode, /res\.status === 401 \|\| res\.status === 403/);
        assert.match(requestCode, /handleAuthError\(res\)/);
    }
});


test('auth return route strips dynamic segments and applies once after allowed login', () => {
    const store = new Map();
    const diagnostics = [];
    const context = {
        URL,
        Date,
        console: { warn() {}, error() {}, log() {} },
        AppState: { currentUser: { id: 14, username: 'operator', role: 'animator' } },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        window: {
            location: {
                origin: 'http://localhost',
                href: 'http://localhost/customers/alice%40example.com?token=secret#frag',
                pathname: '/customers/alice%40example.com'
            }
        },
        recordRedirectDiagnostic: (event, details) => diagnostics.push({ event, details }),
        getApiAuthSessionFailure: () => ({ kind: 'terminal' }),
        getPermissionLifecycle: () => ({ status: 'ready' }),
        canAccessPage: route => route === '/customers',
        getAuthenticatedTimelineStartPage: () => '/dashboard'
    };
    vm.createContext(context);
    const start = AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES');
    const end = AUTH_CODE.indexOf('function clearAuthSessionBootstrapError', start);
    assert.ok(start >= 0 && end > start, 'auth return-route helper block missing');
    vm.runInContext(`const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
${AUTH_CODE.slice(start, end)}`, context, { filename: 'js/auth.js' });

    assert.equal(context.shouldRememberAuthReturnRouteForAuthFailure(), true);
    assert.equal(context.rememberAuthReturnRoute('terminal-auth'), true);
    assert.equal(JSON.parse(store.get('pzp_auth_return_route_v1')).route, '/customers');
    assert.equal(diagnostics.at(-1).details.targetRoute, '/customers');

    context.window.location.pathname = '/';
    context.window.location.href = 'http://localhost/';
    assert.equal(context.applyAuthReturnRouteAfterLogin(context.AppState.currentUser), true);
    assert.equal(context.window.location.href, '/customers');
    assert.equal(store.has('pzp_auth_return_route_v1'), false);
    assert.equal(context.applyAuthReturnRouteAfterLogin(context.AppState.currentUser), false);
});

test('auth return route rejects external, unknown, expired, and inaccessible routes', () => {
    const cases = [
        { route: 'https://evil.example/customers/7', expected: '' },
        { route: '/unknown/7', expected: '' },
        { route: '/certificates/new?secret=1', expected: '/certificates/new' },
        { route: '/customers/7', expected: '/customers' }
    ];
    for (const item of cases) {
        const store = new Map();
        const context = {
            URL,
            Date,
            console: { warn() {}, error() {}, log() {} },
            AppState: { currentUser: { id: 14, username: 'operator', role: 'animator' } },
            localStorage: {
                getItem: key => store.get(key) || null,
                setItem: (key, value) => store.set(key, String(value)),
                removeItem: key => store.delete(key)
            },
            window: { location: { origin: 'http://localhost', href: 'http://localhost/', pathname: '/' } },
            recordRedirectDiagnostic() {},
            getPermissionLifecycle: () => ({ status: 'ready' }),
            canAccessPage: route => route !== '/customers',
            getAuthenticatedTimelineStartPage: () => '/dashboard'
        };
        vm.createContext(context);
        const start = AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES');
        const end = AUTH_CODE.indexOf('function clearAuthSessionBootstrapError', start);
        vm.runInContext(`const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
${AUTH_CODE.slice(start, end)}`, context, { filename: 'js/auth.js' });
        assert.equal(context.normalizeSafeAuthReturnRoute(item.route), item.expected);
        if (item.expected) {
            store.set('pzp_auth_return_route_v1', JSON.stringify({ route: item.expected, at: Date.now() - 1000 }));
            assert.equal(context.consumeAuthReturnRoute(context.AppState.currentUser), item.expected === '/customers' ? '' : item.expected);
            assert.equal(store.has('pzp_auth_return_route_v1'), false);
        }
        store.set('pzp_auth_return_route_v1', JSON.stringify({ route: '/certificates', at: Date.now() - (11 * 60 * 1000) }));
        assert.equal(context.consumeAuthReturnRoute(context.AppState.currentUser), '');
    }
});


test('auth return route is not captured for logout or non-terminal login display', () => {
    const store = new Map();
    const context = {
        URL,
        Date,
        console: { warn() {}, error() {}, log() {} },
        AppState: { currentUser: null },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        window: { location: { origin: 'http://localhost', href: 'http://localhost/leads', pathname: '/leads' } },
        recordRedirectDiagnostic() {},
        getApiAuthSessionFailure: () => null,
        getPermissionLifecycle: () => ({ status: 'ready' }),
        canAccessPage: () => true,
        getAuthenticatedTimelineStartPage: () => '/dashboard'
    };
    vm.createContext(context);
    const start = AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES');
    const end = AUTH_CODE.indexOf('function clearAuthSessionBootstrapError', start);
    vm.runInContext(`const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
${AUTH_CODE.slice(start, end)}`, context, { filename: 'js/auth.js' });

    assert.equal(context.shouldRememberAuthReturnRouteForAuthFailure(), false);
    assert.equal(store.has('pzp_auth_return_route_v1'), false);
});

test('refresh watchdog recovery surface exposes explicit reload exit with dirty guard and safe route', async () => {
    const store = new Map();
    const calls = [];
    const { target, buttons } = createRecoveryElementHarness();
    const dirtySurface = {
        dataset: {
            editableSurface: 'true',
            dirty: 'true'
        }
    };
    let confirmResult = false;
    const context = {
        URL,
        Date,
        console: { warn() {}, error() {}, log() {} },
        AppState: { currentUser: { id: 14, username: 'operator', role: 'manager' } },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        window: {
            location: {
                origin: 'http://localhost',
                href: 'http://localhost/certificates/77?token=secret#frag',
                pathname: '/certificates/77',
                reload: () => calls.push(['reload'])
            },
            RedirectDiagnostics: { copy: async () => ({ copied: true }) },
            UnsafeDismissGuard: {
                isDirtySurface: surface => surface === dirtySurface
            }
        },
        document: {
            body: { appendChild: node => calls.push(['appendChild', node]) },
            createElement: () => target,
            getElementById: id => id === 'authSessionRecovery' ? target : null,
            querySelectorAll: selector => selector === '[data-editable-surface="true"]' ? [dirtySurface] : []
        },
        confirmModal: async (message, options) => {
            calls.push(['confirmModal', message, options]);
            return confirmResult;
        },
        showNotification: (...args) => calls.push(['showNotification', ...args]),
        recordRedirectDiagnostic: (...args) => calls.push(['recordRedirectDiagnostic', ...args]),
        getPermissionLifecycle: () => ({ status: 'ready' }),
        canAccessPage: route => route === '/certificates',
        getAuthenticatedTimelineStartPage: () => '/dashboard'
    };
    vm.createContext(context);
    const returnRouteStart = AUTH_CODE.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES');
    const returnRouteEnd = AUTH_CODE.indexOf('function clearAuthSessionBootstrapError', returnRouteStart);
    assert.ok(returnRouteStart >= 0 && returnRouteEnd > returnRouteStart, 'auth return-route helper block missing');
    vm.runInContext(`
        const AUTH_RETURN_ROUTE_KEY = 'pzp_auth_return_route_v1';
        const AUTH_RETURN_ROUTE_MAX_AGE_MS = 10 * 60 * 1000;
        ${extractAuthFunction('_escHtml')}
        ${extractAuthFunction('authSessionFailureMessage')}
        ${AUTH_CODE.slice(returnRouteStart, returnRouteEnd)}
        ${extractAuthFunction('clearAuthSessionBootstrapError')}
        ${extractAuthFunction('ensureAuthSessionRecoverySurface')}
        ${extractAuthFunction('hasAuthRecoveryUnsavedChanges')}
        ${extractAuthFunction('confirmAuthRecoveryReload')}
        ${extractAuthFunction('reloadAuthSessionRecoveryPage')}
        ${extractAuthFunction('renderAuthSessionBootstrapError')}
    `, context, { filename: 'js/auth.js' });

    context.renderAuthSessionBootstrapError({
        failure: { kind: 'transient', reason: 'refresh-watchdog-timeout' },
        retry: () => calls.push(['retry'])
    });
    assert.match(target.innerHTML, /data-auth-session-reload/);
    assert.match(target.innerHTML, /не гарантує тихе відновлення/i);
    const reloadButton = buttons.get('[data-auth-session-reload]');
    assert.ok(reloadButton, 'watchdog recovery must expose explicit reload action');

    await reloadButton.click();
    assert.equal(calls.some(call => call[0] === 'reload'), false, 'dirty cancel must not reload');
    assert.equal(store.has('pzp_auth_return_route_v1'), false, 'cancelled reload must not consume or store a new intent');

    confirmResult = true;
    await reloadButton.click();
    assert.equal(calls.some(call => call[0] === 'reload'), true);
    assert.equal(JSON.parse(store.get('pzp_auth_return_route_v1')).route, '/certificates');
});
