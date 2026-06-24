const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const API_CODE = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
const AUTH_CODE = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
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
        setTimeout: fn => fn(),
        hasStoredRefreshSession: () => false,
        apiVerifyToken: async () => { throw new Error('verify failed'); },
        hydrateBusinessOperatingProfile: async () => calls.push(['hydrateBusinessOperatingProfile']),
        hydrateActionPermissions: async () => calls.push(['hydrateActionPermissions']),
        showMainApp: () => calls.push(['showMainApp']),
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
        'clearAuthStorage',
        'clearPrivateClientCaches'
    ]);
    assert.equal(bodyClasses.set.has('auth-screen'), true);
    assert.equal(bodyClasses.set.has('page-exiting'), false);
    assert.equal(bodyAttrs.has('aria-busy'), false);
    assert.equal(loginClasses.set.has('hidden'), false);
    assert.equal(mainClasses.set.has('hidden'), true);
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
        const initStart = code.indexOf('async function initPage()') >= 0
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
