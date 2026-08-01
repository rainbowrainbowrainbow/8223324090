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

function response(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; }
    };
}

function loadApi(fetchImpl, initialStore = {}) {
    const store = new Map(Object.entries(initialStore).map(([key, value]) => [key, String(value)]));
    const context = {
        console,
        URL,
        URLSearchParams,
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        window: {
            location: { search: '', href: 'http://localhost/' },
            history: { replaceState() {} }
        },
        document: {
            documentElement: { classList: { contains() { return false; } } }
        },
        fetch: fetchImpl
    };
    context.window.self = context.window;
    context.window.top = context.window;
    vm.createContext(context);
    vm.runInContext(API_CODE, context);
    return { context, store };
}

function loadCheckSessionHarness(overrides = {}) {
    const start = AUTH_CODE.indexOf('async function checkSession()');
    const end = AUTH_CODE.indexOf('async function login', start);
    assert.ok(start >= 0, 'checkSession function missing');
    assert.ok(end > start, 'login function should follow checkSession');

    const calls = [];
    const store = new Map([
        ['pzp_token', 'stored-token'],
        ['pzp_current_user', JSON.stringify({ username: 'cached.user' })]
    ]);
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
        hasStoredRefreshSession: () => false,
        apiVerifyToken: async () => { throw new Error('verify failed'); },
        hydrateBusinessOperatingProfile: async () => calls.push(['hydrateBusinessOperatingProfile']),
        hydrateActionPermissions: async () => calls.push(['hydrateActionPermissions']),
        showMainApp: () => calls.push(['showMainApp']),
        resetAuthenticatedRuntimeReady: () => {},
        scheduleOfflineSessionRecovery: () => calls.push(['scheduleOfflineSessionRecovery']),
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
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(AUTH_CODE.slice(start, end), context, { filename: 'js/auth.js' });
    return { context, calls, classSets, store };
}

function extractAuthFunction(functionName) {
    const start = AUTH_CODE.indexOf(`function ${functionName}`);
    assert.ok(start >= 0, `${functionName} function missing`);
    const signatureStart = AUTH_CODE.indexOf('(', start);
    let signatureDepth = 0;
    let signatureEnd = -1;
    for (let i = signatureStart; i < AUTH_CODE.length; i += 1) {
        const char = AUTH_CODE[i];
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
    const bodyStart = AUTH_CODE.indexOf('{', signatureEnd);
    let depth = 0;
    for (let i = bodyStart; i < AUTH_CODE.length; i += 1) {
        const char = AUTH_CODE[i];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return AUTH_CODE.slice(start, i + 1);
        }
    }
    throw new Error(`Could not extract ${functionName}`);
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
        window: {
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
        extractAuthFunction('showLoginScreen'),
        extractAuthFunction('logout')
    ].join('\n'), context, { filename: 'js/auth.js' });
    return { context, calls, bodyClasses, htmlClasses, loginClasses, mainClasses, bodyAttrs };
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
        pzp_current_user: JSON.stringify({ username: 'old' })
    });

    const user = await context.apiVerifyToken();
    assert.equal(user.username, 'new.operator');
    assert.deepEqual(calls.map(call => call.url), ['/api/auth/refresh', '/api/auth/verify']);
    assert.equal(store.get('pzp_token'), 'access-new');
    assert.equal(store.get('pzp_access_token'), 'access-new');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-new');
    assert.match(store.get('pzp_current_user'), /new\.operator/);
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
        const requestEnd = code.indexOf('\n}\n', requestStart) + 3;
        const requestCode = code.slice(requestStart, requestEnd);
        assert.doesNotMatch(requestCode, /res\.status === 401 \|\| res\.status === 403/);
        assert.match(requestCode, /handleAuthError\(res\)/);
    }
});