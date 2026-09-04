'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const API_CODE = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
const APP_CODE = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

function response(status, body = {}, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: key => headers[String(key).toLowerCase()] || null },
        async json() { return body; },
        clone() { return response(status, body, headers); }
    };
}

function loadApi(fetchImpl, initialStore = {}, contextOverrides = {}) {
    const store = new Map(Object.entries(initialStore).map(([key, value]) => [key, String(value)]));
    const context = {
        console: { warn() {}, error() {}, log() {} },
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
        fetch: fetchImpl,
        setTimeout: callback => {
            callback();
            return 1;
        },
        clearTimeout() {},
        ...contextOverrides
    };
    context.window.self = context.window;
    context.window.top = context.window;
    vm.createContext(context);
    vm.runInContext(API_CODE, context, { filename: 'js/api.js' });
    return { context, store };
}

function extractFunction(source, functionName, nextFunctionName) {
    const start = source.indexOf(`function ${functionName}`);
    const end = source.indexOf(`function ${nextFunctionName}`, start);
    assert.ok(start >= 0, `${functionName} function missing`);
    assert.ok(end > start, `${nextFunctionName} must follow ${functionName}`);
    return source.slice(start, end);
}

test('refresh keeps the hydrated permission snapshot when the response contains a bare user', async () => {
    const permissions = {
        capabilities: { 'page:/certificates': { allowed: true } },
        capabilityCatalog: { pageRoles: { '/certificates': ['animator'] } }
    };
    const { context, store } = loadApi(async () => response(200, {
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        user: { id: 7, username: 'operator', role: 'animator' }
    }), {
        pzp_refresh_token: 'refresh-old',
        pzp_current_user: JSON.stringify({ id: 7, username: 'operator', role: 'animator', permissions })
    });

    assert.equal(await context.apiRefreshAuthToken(), 'access-new');
    const cachedUser = JSON.parse(store.get('pzp_current_user'));
    assert.deepEqual(cachedUser.permissions, permissions);
    assert.equal(cachedUser.role, 'animator');
});

test('an explicitly remembered replacement session never carries permissions across account identities', () => {
    const { context, store } = loadApi(async () => response(500), {
        pzp_token: 'first-access',
        pzp_access_token: 'first-access',
        pzp_refresh_token: 'first-refresh',
        pzp_auth_session_generation: 'first-generation',
        pzp_current_user: JSON.stringify({
            id: 7,
            username: 'first.user',
            permissions: { capabilities: { 'page:/finance': { allowed: true } } }
        })
    });

    assert.equal(context.rememberApiAuthSession({
        accessToken: 'second-access',
        refreshToken: 'second-refresh',
        user: { id: 8, username: 'second.user', role: 'manager' }
    }), true);
    const cachedUser = JSON.parse(store.get('pzp_current_user'));
    assert.equal(cachedUser.id, 8);
    assert.equal(cachedUser.username, 'second.user');
    assert.equal(Object.hasOwn(cachedUser, 'permissions'), false);
});

test('a verified-user merge cannot overwrite a different account already cached by another tab', () => {
    const cachedUser = { id: 8, username: 'second.user', role: 'manager' };
    const { context, store } = loadApi(async () => response(500), {
        pzp_token: 'second-access',
        pzp_access_token: 'second-access',
        pzp_refresh_token: 'second-refresh',
        pzp_auth_session_generation: 'second-generation',
        pzp_current_user: JSON.stringify(cachedUser)
    });
    context.AppState = { currentUser: { id: 7, username: 'first.user', role: 'animator' } };

    const result = context.mergeApiCurrentUser({ id: 7, username: 'first.user', role: 'animator' });

    assert.equal(result, null);
    assert.deepEqual(JSON.parse(store.get('pzp_current_user')), cachedUser);
    assert.equal(context.AppState.currentUser.id, 7);
    const failure = context.getApiAuthSessionFailure();
    assert.equal(failure.kind, 'transient');
    assert.equal(failure.reason, 'session-changed');
});

test('user merge drops cached permissions when authorization fields change for the same account', () => {
    const permissions = { capabilities: { 'action:finance.view': { allowed: true } } };
    const { context, store } = loadApi(async () => response(500), {
        pzp_current_user: JSON.stringify({
            id: 7,
            username: 'operator',
            role: 'manager',
            roles: ['manager'],
            actionDenylist: [],
            permissions
        })
    });

    context.mergeApiCurrentUser({
        id: 7,
        username: 'operator',
        role: 'animator',
        roles: ['animator'],
        actionDenylist: ['finance.view']
    });
    const cachedUser = JSON.parse(store.get('pzp_current_user'));
    assert.equal(cachedUser.role, 'animator');
    assert.deepEqual(cachedUser.actionDenylist, ['finance.view']);
    assert.equal(Object.hasOwn(cachedUser, 'permissions'), false);
});

test('authorization changes invalidate runtime permission catalogs before publishing the user', () => {
    const permissions = { capabilities: { 'page:/finance': { allowed: true } } };
    const runtimeUser = {
        id: 7,
        username: 'operator',
        role: 'manager',
        roles: ['manager'],
        permissions
    };
    const events = [];
    const { context } = loadApi(async () => response(500), {
        pzp_current_user: JSON.stringify(runtimeUser)
    });
    let publishedUser = runtimeUser;
    context.AppState = { authPermissions: permissions };
    Object.defineProperty(context.AppState, 'currentUser', {
        configurable: true,
        get: () => publishedUser,
        set: value => {
            events.push({
                type: 'user',
                permissions: context.AppState.authPermissions,
                lifecycle: events.findLast(event => event.type === 'lifecycle')?.status || null
            });
            publishedUser = value;
        }
    });
    context.clearRuntimePermissionCatalog = user => {
        context.AppState.authPermissions = null;
        delete user.permissions;
        events.push({ type: 'catalog' });
    };
    context.setPermissionLifecycle = status => events.push({ type: 'lifecycle', status });

    const merged = context.mergeApiCurrentUser({
        id: 7,
        username: 'operator',
        role: 'animator',
        roles: ['animator']
    });

    assert.deepEqual(events.map(event => event.type), ['catalog', 'lifecycle', 'user']);
    assert.equal(events[2].permissions, null);
    assert.equal(events[2].lifecycle, 'loading');
    assert.equal(context.AppState.currentUser, merged);
    assert.equal(Object.hasOwn(merged, 'permissions'), false);
});

test('refresh clears auth storage only for a terminal invalid-session response', async () => {
    const { context, store } = loadApi(async () => response(401, { error: 'invalid refresh' }), {
        pzp_token: 'stale-token',
        pzp_access_token: 'stale-access',
        pzp_refresh_token: 'invalid-refresh',
        pzp_refresh_expires_at: '2026-09-05T00:00:00.000Z',
        pzp_current_user: JSON.stringify({ id: 7 }),
        pzp_session: 'stale-session'
    });

    assert.equal(await context.apiRefreshAuthToken(), null);
    assert.equal(store.size, 0);
    const failure = context.getApiAuthSessionFailure();
    assert.equal(failure.kind, 'terminal');
    assert.equal(failure.stage, 'refresh');
    assert.equal(failure.status, 401);
});

for (const status of [429, 503]) {
    test(`refresh preserves auth storage for transient HTTP ${status}`, async () => {
        const initialUser = JSON.stringify({ id: 9, permissions: { capabilities: {} } });
        const { context, store } = loadApi(async () => response(status, { error: 'temporary failure' }), {
            pzp_token: 'stored-token',
            pzp_access_token: 'stored-access',
            pzp_refresh_token: 'stored-refresh',
            pzp_current_user: initialUser
        });

        assert.equal(await context.apiRefreshAuthToken(), null);
        assert.equal(store.get('pzp_token'), 'stored-token');
        assert.equal(store.get('pzp_access_token'), 'stored-access');
        assert.equal(store.get('pzp_refresh_token'), 'stored-refresh');
        assert.equal(store.get('pzp_current_user'), initialUser);
        const failure = context.getApiAuthSessionFailure();
        assert.equal(failure.kind, 'transient');
        assert.equal(failure.status, status);
    });
}

test('refresh preserves auth storage on a network failure', async () => {
    const { context, store } = loadApi(async () => { throw new Error('offline'); }, {
        pzp_token: 'stored-token',
        pzp_refresh_token: 'stored-refresh',
        pzp_current_user: JSON.stringify({ id: 11 })
    });

    assert.equal(await context.apiRefreshAuthToken(), null);
    assert.equal(store.get('pzp_token'), 'stored-token');
    assert.equal(store.get('pzp_refresh_token'), 'stored-refresh');
    assert.equal(context.getApiAuthSessionFailure().kind, 'transient');
    assert.equal(context.getApiAuthSessionFailure().reason, 'network');
});

for (const staleResponse of [
    response(200, {
        accessToken: 'old-access-result',
        refreshToken: 'old-refresh-result',
        user: { id: 21, username: 'old.user' }
    }),
    response(401, { error: 'old refresh rejected' })
]) {
    test(`stale refresh ${staleResponse.status} cannot write or clear a newer session`, async () => {
        let releaseRefresh;
        const pendingResponse = new Promise(resolve => { releaseRefresh = resolve; });
        const { context, store } = loadApi(async () => pendingResponse, {
            pzp_token: 'old-access',
            pzp_refresh_token: 'old-refresh',
            pzp_current_user: JSON.stringify({ id: 21, username: 'old.user' })
        });

        const oldRefresh = context.apiRefreshAuthToken();
        store.set('pzp_token', 'new-account-access');
        store.set('pzp_access_token', 'new-account-access');
        store.set('pzp_refresh_token', 'new-account-refresh');
        store.set('pzp_current_user', JSON.stringify({ id: 22, username: 'new.user' }));
        releaseRefresh(staleResponse);

        assert.equal(await oldRefresh, null);
        assert.equal(store.get('pzp_token'), 'new-account-access');
        assert.equal(store.get('pzp_access_token'), 'new-account-access');
        assert.equal(store.get('pzp_refresh_token'), 'new-account-refresh');
        assert.equal(JSON.parse(store.get('pzp_current_user')).id, 22);
        assert.equal(context.getApiAuthSessionFailure(), null);
    });
}

test('same-tab concurrent refresh calls share one rotation request', async () => {
    let fetchCalls = 0;
    let releaseRefresh;
    const refreshResponse = new Promise(resolve => { releaseRefresh = resolve; });
    const { context, store } = loadApi(async () => {
        fetchCalls += 1;
        return refreshResponse;
    }, {
        pzp_refresh_token: 'refresh-one',
        pzp_current_user: JSON.stringify({ id: 12, permissions: { capabilities: {} } })
    });

    const first = context.apiRefreshAuthToken();
    const second = context.apiRefreshAuthToken();
    assert.equal(fetchCalls, 1);

    releaseRefresh(response(200, {
        accessToken: 'access-two',
        refreshToken: 'refresh-two',
        user: { id: 12 }
    }));

    assert.deepEqual(await Promise.all([first, second]), ['access-two', 'access-two']);
    assert.equal(fetchCalls, 1);
    assert.equal(store.get('pzp_refresh_token'), 'refresh-two');
    assert.ok(JSON.parse(store.get('pzp_current_user')).permissions);

    assert.equal(await context.apiRefreshAuthToken(), 'access-two');
    assert.equal(fetchCalls, 2, 'a settled refresh must not pin the old in-flight promise');
});

test('single-flight is keyed by refresh token so a newer session never waits for the old one', async () => {
    let releaseOldRefresh;
    const oldResponse = new Promise(resolve => { releaseOldRefresh = resolve; });
    const calls = [];
    const { context, store } = loadApi(async (_url, options) => {
        const refreshToken = JSON.parse(options.body).refreshToken;
        calls.push(refreshToken);
        if (refreshToken === 'refresh-old') return oldResponse;
        return response(200, {
            accessToken: 'access-new-result',
            refreshToken: 'refresh-new-result',
            user: { id: 42, username: 'new.user' }
        });
    }, {
        pzp_refresh_token: 'refresh-old',
        pzp_current_user: JSON.stringify({ id: 41, username: 'old.user' })
    });

    const oldRefresh = context.apiRefreshAuthToken();
    store.set('pzp_token', 'access-new-start');
    store.set('pzp_refresh_token', 'refresh-new-start');
    store.set('pzp_current_user', JSON.stringify({ id: 42, username: 'new.user' }));
    const newRefresh = context.apiRefreshAuthToken();

    assert.equal(await newRefresh, 'access-new-result');
    assert.deepEqual(calls, ['refresh-old', 'refresh-new-start']);
    releaseOldRefresh(response(401, { error: 'old token rejected' }));
    assert.equal(await oldRefresh, null);
    assert.equal(store.get('pzp_token'), 'access-new-result');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-new-result');
    assert.equal(JSON.parse(store.get('pzp_current_user')).id, 42);
});

test('apiVerifyToken classifies a refresh rate-limit as transient without erasing the session', async () => {
    const calls = [];
    const { context, store } = loadApi(async (url) => {
        calls.push(url);
        if (url === '/api/auth/verify') return response(401, { error: 'expired' });
        if (url === '/api/auth/refresh') return response(429, { error: 'slow down' });
        throw new Error(`Unexpected request: ${url}`);
    }, {
        pzp_token: 'expired-access',
        pzp_refresh_token: 'refresh-kept',
        pzp_current_user: JSON.stringify({ id: 13 })
    });

    assert.equal(await context.apiVerifyToken(), null);
    assert.deepEqual(calls, ['/api/auth/verify', '/api/auth/refresh']);
    assert.equal(store.get('pzp_token'), 'expired-access');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-kept');
    assert.equal(context.getApiAuthSessionFailure().kind, 'transient');
    assert.equal(context.getApiAuthSessionFailure().status, 429);
});

test('apiVerifyToken treats verify 403 as terminal without attempting refresh', async () => {
    const calls = [];
    const { context, store } = loadApi(async (url) => {
        calls.push(url);
        if (url === '/api/auth/verify') return response(403, { error: 'deactivated' });
        throw new Error(`Refresh must not run after terminal verify 403: ${url}`);
    }, {
        pzp_token: 'deactivated-access',
        pzp_refresh_token: 'deactivated-refresh',
        pzp_current_user: JSON.stringify({ id: 31 })
    });

    assert.equal(await context.apiVerifyToken(), null);
    assert.deepEqual(calls, ['/api/auth/verify']);
    assert.equal(store.size, 0);
    assert.equal(context.getApiAuthSessionFailure().kind, 'terminal');
    assert.equal(context.getApiAuthSessionFailure().status, 403);
});

test('apiVerifyToken treats a 200 response without user as transient and preserves auth', async () => {
    const { context, store } = loadApi(async () => response(200, { success: true }), {
        pzp_token: 'valid-access',
        pzp_refresh_token: 'valid-refresh',
        pzp_current_user: JSON.stringify({ id: 32, username: 'operator' })
    });

    assert.equal(await context.apiVerifyToken(), null);
    assert.equal(store.get('pzp_token'), 'valid-access');
    assert.equal(store.get('pzp_refresh_token'), 'valid-refresh');
    assert.equal(JSON.parse(store.get('pzp_current_user')).id, 32);
    assert.equal(context.getApiAuthSessionFailure().kind, 'transient');
    assert.equal(context.getApiAuthSessionFailure().reason, 'malformed-response');
});

test('stale verify response restarts against the newer session instead of restoring the old user', async () => {
    let releaseOldVerify;
    const oldVerifyResponse = new Promise(resolve => { releaseOldVerify = resolve; });
    const calls = [];
    const { context, store } = loadApi(async (url, options) => {
        calls.push({ url, authorization: options.headers?.Authorization || '' });
        if (calls.length === 1) return oldVerifyResponse;
        return response(200, { user: { id: 52, username: 'new.user', role: 'manager' } });
    }, {
        pzp_token: 'old-access',
        pzp_refresh_token: 'old-refresh',
        pzp_current_user: JSON.stringify({ id: 51, username: 'old.user', role: 'animator' })
    });

    const verification = context.apiVerifyToken();
    store.set('pzp_token', 'new-access');
    store.set('pzp_access_token', 'new-access');
    store.set('pzp_refresh_token', 'new-refresh');
    store.set('pzp_current_user', JSON.stringify({ id: 52, username: 'new.user', role: 'manager' }));
    releaseOldVerify(response(200, { user: { id: 51, username: 'old.user', role: 'animator' } }));

    const user = await verification;
    assert.equal(user.id, 52);
    assert.deepEqual(calls.map(call => call.authorization), ['Bearer old-access', 'Bearer new-access']);
    assert.equal(JSON.parse(store.get('pzp_current_user')).id, 52);
    assert.equal(context.getApiAuthSessionFailure(), null);
});

test('authenticated retry does not turn a transient refresh failure into logout', async () => {
    const calls = [];
    const { context, store } = loadApi(async (url) => {
        calls.push(url);
        if (url === '/api/private') return response(401, { error: 'expired', code: 'auth_token_invalid' });
        if (url === '/api/auth/refresh') return response(503, { error: 'unavailable' });
        throw new Error(`Unexpected request: ${url}`);
    }, {
        pzp_token: 'expired-access',
        pzp_refresh_token: 'refresh-kept',
        pzp_current_user: JSON.stringify({ id: 14 })
    });

    const result = await context.apiFetchWithAuthRetry('/api/private', { headers: {} });
    assert.equal(result, null);
    assert.deepEqual(calls, ['/api/private', '/api/auth/refresh']);
    assert.equal(store.get('pzp_token'), 'expired-access');
    assert.equal(store.get('pzp_refresh_token'), 'refresh-kept');
    assert.equal(context.getApiAuthSessionFailure().kind, 'transient');
});

test('a current-client already-rotated refresh exits the unrecoverable local session', async () => {
    let refreshCalls = 0;
    const sessionStore = new Map([
        ['impersonating', 'target.user'],
        ['realToken', 'creator-legacy'],
        ['realAccessToken', 'creator-access'],
        ['realRefreshToken', 'creator-refresh'],
        ['realRefreshExpiresAt', '2026-10-01T00:00:00.000Z'],
        ['realSessionBackupVersion', '2'],
        ['realUser', JSON.stringify({ id: 1, username: 'creator' })]
    ]);
    const { context, store } = loadApi(async url => {
        assert.equal(url, '/api/auth/refresh');
        refreshCalls += 1;
        return response(409, {
            error: 'Refresh token was already rotated by this client',
            code: 'refresh_already_rotated',
            retryable: true
        });
    }, {
        pzp_token: 'expired-access',
        pzp_access_token: 'expired-access',
        pzp_refresh_token: 'lost-success-refresh',
        pzp_auth_session_generation: 'lost-success-generation',
        pzp_current_user: JSON.stringify({ id: 14, username: 'operator' })
    });
    context.sessionStorage = {
        getItem: key => sessionStore.get(key) || null,
        setItem: (key, value) => sessionStore.set(key, String(value)),
        removeItem: key => sessionStore.delete(key)
    };

    assert.equal(await context.apiRefreshAuthToken(), null);
    assert.equal(store.size, 0);
    assert.equal(sessionStore.size, 0);
    const failure = context.getApiAuthSessionFailure();
    assert.equal(failure.kind, 'terminal');
    assert.equal(failure.reason, 'refresh-already-rotated');
    assert.equal(refreshCalls, 2, 'the old token must be confirmed after the fixed settlement window');
});

test('a duplicate 409 waits for the cross-tab refresh winner before clearing storage', async () => {
    let releaseSettlement;
    let markSettlementStarted;
    const settlementStarted = new Promise(resolve => { markSettlementStarted = resolve; });
    const user = { id: 14, username: 'operator' };
    const { context, store } = loadApi(async () => response(409, {
        error: 'Refresh token was already rotated by this client',
        code: 'refresh_already_rotated',
        retryable: true
    }), {
        pzp_token: 'expired-access',
        pzp_access_token: 'expired-access',
        pzp_refresh_token: 'shared-refresh-old',
        pzp_auth_session_generation: 'shared-generation',
        pzp_current_user: JSON.stringify(user)
    }, {
        setTimeout: callback => {
            releaseSettlement = callback;
            markSettlementStarted();
            return 1;
        },
        clearTimeout() {}
    });

    const pending = context.apiRefreshAuthToken();
    await settlementStarted;
    store.set('pzp_token', 'winner-access');
    store.set('pzp_access_token', 'winner-access');
    store.set('pzp_refresh_token', 'winner-refresh');
    releaseSettlement();

    assert.equal(await pending, null);
    assert.equal(store.get('pzp_access_token'), 'winner-access');
    assert.equal(store.get('pzp_refresh_token'), 'winner-refresh');
    assert.equal(context.getApiAuthSessionFailure(), null);
});

test('an account transition during replay confirmation prevents a second refresh attempt', async () => {
    const timers = [];
    let refreshCalls = 0;
    const user = { id: 14, username: 'operator' };
    const { context, store } = loadApi(async url => {
        assert.equal(url, '/api/auth/refresh');
        refreshCalls += 1;
        return response(409, {
            error: 'Refresh token was already rotated by this client',
            code: 'refresh_already_rotated',
            retryable: true
        });
    }, {
        pzp_token: 'expired-access',
        pzp_access_token: 'expired-access',
        pzp_refresh_token: 'shared-refresh-old',
        pzp_auth_session_generation: 'shared-generation',
        pzp_current_user: JSON.stringify(user)
    }, {
        setTimeout: callback => {
            timers.push(callback);
            return timers.length;
        },
        clearTimeout() {}
    });

    const pending = context.apiRefreshAuthToken();
    while (timers.length < 1) await Promise.resolve();
    assert.equal(refreshCalls, 1);
    timers.shift()();
    while (timers.length < 1) await Promise.resolve();
    store.set('pzp_auth_transition', `auth-${Date.now().toString(36)}-external`);
    timers.shift()();

    assert.equal(await pending, null);
    assert.equal(refreshCalls, 1);
    assert.equal(store.get('pzp_refresh_token'), 'shared-refresh-old');
    const failure = context.getApiAuthSessionFailure();
    assert.equal(failure.kind, 'transient');
    assert.equal(failure.reason, 'session-transition');
});

test('protected 401 followed by terminal refresh rejection exits through terminal auth handling', async () => {
    const calls = [];
    const { context, store } = loadApi(async url => {
        calls.push(url);
        if (url === '/api/private') return response(401, { error: 'expired', code: 'auth_token_invalid' });
        if (url === '/api/auth/refresh') return response(401, { error: 'invalid refresh' });
        throw new Error(`Unexpected request: ${url}`);
    }, {
        pzp_token: 'expired-access',
        pzp_access_token: 'expired-access',
        pzp_refresh_token: 'invalid-refresh',
        pzp_auth_session_generation: 'terminal-generation',
        pzp_current_user: JSON.stringify({ id: 14, username: 'operator' })
    });

    const result = await context.apiFetchWithAuthRetry('/api/private', { headers: {} });

    assert.equal(result, null);
    assert.deepEqual(calls, ['/api/private', '/api/auth/refresh']);
    assert.equal(store.size, 0);
    const failure = context.getApiAuthSessionFailure();
    assert.equal(failure.kind, 'terminal');
    assert.equal(failure.status, 401);
    assert.equal(failure.reason, 'http');
});

test('expired impersonated access never replays a mutation with the creator refresh identity', async () => {
    const calls = [];
    const sessionStore = new Map([
        ['realSessionBackupVersion', '2'],
        ['impersonating', 'target.user'],
        ['realRefreshToken', 'isolated-creator-refresh']
    ]);
    const targetUser = { id: 71, username: 'target.user', role: 'animator' };
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({
            url,
            authorization: options.headers?.Authorization || '',
            body: options.body || ''
        });
        if (url === '/api/private') return response(401, { error: 'expired', code: 'auth_token_invalid' });
        if (url === '/api/auth/refresh') {
            return response(200, {
                accessToken: 'creator-access-new',
                refreshToken: 'creator-refresh-new',
                user: { id: 1, username: 'creator', role: 'creator' }
            });
        }
        if (url === '/api/auth/logout') return response(200, { success: true });
        throw new Error(`A cross-account mutation replay must not occur: ${url}`);
    }, {
        pzp_token: 'target-access-expired',
        pzp_access_token: 'target-access-expired',
        pzp_refresh_token: 'creator-refresh-old',
        pzp_auth_session_generation: 'target-generation',
        pzp_current_user: JSON.stringify(targetUser)
    }, {
        sessionStorage: {
            getItem: key => sessionStore.get(key) || null,
            setItem: (key, value) => sessionStore.set(key, String(value)),
            removeItem: key => sessionStore.delete(key)
        }
    });
    context.AppState = { currentUser: targetUser };

    const result = await context.apiFetchWithAuthRetry('/api/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destructive: true })
    });

    assert.equal(result, null);
    assert.deepEqual(calls.map(call => call.url), [
        '/api/private',
        '/api/auth/refresh',
        '/api/auth/logout',
        '/api/auth/logout'
    ]);
    assert.equal(calls[0].authorization, 'Bearer target-access-expired');
    assert.equal(JSON.parse(calls[2].body).refreshToken, 'creator-refresh-new');
    assert.equal(JSON.parse(calls[3].body).refreshToken, 'isolated-creator-refresh');
    assert.equal(store.size, 0);
    assert.equal(sessionStore.size, 0);
    assert.equal(context.AppState.currentUser, null);
    const failure = context.getApiAuthSessionFailure();
    assert.equal(failure.kind, 'terminal');
    assert.equal(failure.reason, 'refresh-identity-mismatch');
});

test('refresh-only bootstrap never sends a target mutation with a foreign refresh identity', async () => {
    const calls = [];
    const targetUser = { id: 72, username: 'target.runtime', role: 'animator' };
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({
            url,
            authorization: options.headers?.Authorization || '',
            body: options.body || ''
        });
        if (url === '/api/auth/refresh') {
            return response(200, {
                accessToken: 'creator-access-new',
                refreshToken: 'creator-refresh-new',
                user: { id: 1, username: 'creator', role: 'creator' }
            });
        }
        if (url === '/api/auth/logout') return response(200, { success: true });
        throw new Error(`A refresh-only cross-account mutation must not run: ${url}`);
    }, {
        pzp_refresh_token: 'creator-refresh-old',
        pzp_auth_session_generation: 'runtime-target-generation'
    });
    context.AppState = { currentUser: targetUser };

    const result = await context.apiFetchWithAuthRetry('/api/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destructive: true })
    });

    assert.equal(result, null);
    assert.deepEqual(calls.map(call => call.url), ['/api/auth/refresh', '/api/auth/logout']);
    assert.equal(JSON.parse(calls[1].body).refreshToken, 'creator-refresh-new');
    assert.equal(store.size, 0);
    assert.equal(context.AppState.currentUser, null);
    const failure = context.getApiAuthSessionFailure();
    assert.equal(failure.kind, 'terminal');
    assert.equal(failure.reason, 'refresh-identity-mismatch');
});

test('a staggered 401 retries with a newer token only for the same account', async () => {
    let releaseFirstResponse;
    const calls = [];
    const { context, store } = loadApi(async (url, options) => {
        calls.push({ url, authorization: options.headers?.Authorization || '' });
        if (calls.length === 1) {
            return new Promise(resolve => { releaseFirstResponse = resolve; });
        }
        return response(200, { ok: true });
    }, {
        pzp_token: 'access-old',
        pzp_access_token: 'access-old',
        pzp_refresh_token: 'refresh-old',
        pzp_current_user: JSON.stringify({ id: 14, username: 'operator' })
    });
    context.AppState = { currentUser: { id: 14, username: 'operator' } };

    const pendingRequest = context.apiFetchWithAuthRetry('/api/private', { headers: {} });
    store.set('pzp_token', 'access-new');
    store.set('pzp_access_token', 'access-new');
    store.set('pzp_refresh_token', 'refresh-new');
    store.set('pzp_current_user', JSON.stringify({ id: 14, username: 'operator' }));
    releaseFirstResponse(response(401, { error: 'expired', code: 'auth_token_invalid' }));

    const result = await pendingRequest;
    assert.equal(result.status, 200);
    assert.deepEqual(calls.map(call => call.authorization), ['Bearer access-old', 'Bearer access-new']);
    assert.equal(context.getApiAuthSessionFailure(), null);
});

test('an account transition blocks a protected retry before it reaches the server', async () => {
    let releaseClassification;
    let markClassificationStarted;
    const classificationStarted = new Promise(resolve => { markClassificationStarted = resolve; });
    const calls = [];
    const user = { id: 14, username: 'operator' };
    const firstResponse = response(401, { error: 'expired', code: 'auth_token_invalid' });
    firstResponse.clone = () => ({
        async json() {
            markClassificationStarted();
            return new Promise(resolve => { releaseClassification = resolve; });
        }
    });
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({ url, authorization: options.headers?.Authorization || '' });
        if (calls.length === 1) return firstResponse;
        return response(200, { ok: true });
    }, {
        pzp_token: 'access-old',
        pzp_access_token: 'access-old',
        pzp_refresh_token: 'refresh-old',
        pzp_auth_session_generation: 'shared-generation',
        pzp_current_user: JSON.stringify(user)
    });
    context.AppState = { currentUser: user };

    const pending = context.apiFetchWithAuthRetry('/api/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destructive: true })
    });
    await classificationStarted;
    store.set('pzp_token', 'access-new');
    store.set('pzp_access_token', 'access-new');
    store.set('pzp_auth_transition', `auth-${Date.now().toString(36)}-external`);
    releaseClassification({ error: 'expired', code: 'auth_token_invalid' });

    assert.equal(await pending, null);
    assert.deepEqual(calls, [{ url: '/api/private', authorization: 'Bearer access-old' }]);
    assert.equal(store.get('pzp_access_token'), 'access-new');
    assert.equal(store.get('pzp_auth_transition').startsWith('auth-'), true);
    const failure = context.getApiAuthSessionFailure();
    assert.equal(failure.kind, 'transient');
    assert.equal(failure.reason, 'session-transition');
});

test('a cross-tab account switch blocks stale UI requests before they reach the server', async () => {
    let fetchCalls = 0;
    const { context, store } = loadApi(async () => {
        fetchCalls += 1;
        return response(200, { ok: true });
    }, {
        pzp_token: 'account-b-access',
        pzp_refresh_token: 'account-b-refresh',
        pzp_current_user: JSON.stringify({ id: 22, username: 'account.b' })
    });
    context.AppState = { currentUser: { id: 21, username: 'account.a' } };

    assert.equal(await context.apiFetchWithAuthRetry('/api/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: true })
    }), null);
    assert.equal(fetchCalls, 0);
    assert.equal(store.get('pzp_token'), 'account-b-access');
    assert.equal(context.getApiAuthSessionFailure().reason, 'session-changed');
});

test('an in-progress auth transition blocks mutations before they reach the server', async () => {
    let fetchCalls = 0;
    const transitionMarker = `api-${Date.now().toString(36)}-active`;
    const { context, store } = loadApi(async () => {
        fetchCalls += 1;
        return response(200, { ok: true });
    }, {
        pzp_token: 'account-b-access',
        pzp_access_token: 'account-b-access',
        pzp_refresh_token: 'account-b-refresh',
        pzp_auth_session_generation: 'account-a-generation',
        pzp_auth_transition: transitionMarker,
        pzp_current_user: JSON.stringify({ id: 22, username: 'account.b' })
    });
    context.AppState = { currentUser: { id: 21, username: 'account.a' } };

    const result = await context.apiFetchWithAuthRetry('/api/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: true })
    });

    assert.equal(result, null);
    assert.equal(fetchCalls, 0);
    assert.equal(store.get('pzp_auth_transition'), transitionMarker);
    assert.equal(context.getApiAuthSessionFailure().kind, 'transient');
    assert.equal(context.getApiAuthSessionFailure().reason, 'session-transition');
});

test('a stale auth transition marker is cleared instead of blocking the CRM forever', async () => {
    let fetchCalls = 0;
    const staleTimestamp = Date.now() - 60000;
    const { context, store } = loadApi(async () => {
        fetchCalls += 1;
        return response(200, { ok: true });
    }, {
        pzp_token: 'valid-access',
        pzp_access_token: 'valid-access',
        pzp_refresh_token: 'valid-refresh',
        pzp_auth_session_generation: 'valid-generation',
        pzp_auth_transition: `api-${staleTimestamp.toString(36)}-abandoned`,
        pzp_current_user: JSON.stringify({ id: 22, username: 'account.b' })
    });
    context.AppState = { currentUser: { id: 22, username: 'account.b' } };

    const result = await context.apiFetchWithAuthRetry('/api/private', { headers: {} });

    assert.equal(result.status, 200);
    assert.equal(fetchCalls, 1);
    assert.equal(store.has('pzp_auth_transition'), false);
});

test('a refresh response cannot join and overwrite another tab auth transition', async () => {
    let releaseRefresh;
    let markRefreshStarted;
    const refreshStarted = new Promise(resolve => { markRefreshStarted = resolve; });
    const calls = [];
    const { context, store } = loadApi(async (url, options = {}) => {
        calls.push({ url, options });
        if (url === '/api/auth/refresh') {
            markRefreshStarted();
            return await new Promise(resolve => { releaseRefresh = resolve; });
        }
        if (url === '/api/auth/logout') return response(200, { success: true });
        throw new Error(`Unexpected request: ${url}`);
    }, {
        pzp_token: 'old-access',
        pzp_access_token: 'old-access',
        pzp_refresh_token: 'old-refresh',
        pzp_auth_session_generation: 'old-generation',
        pzp_current_user: JSON.stringify({ id: 22, username: 'account.b' })
    });

    const pending = context.apiRefreshAuthToken();
    await refreshStarted;
    const transitionMarker = `auth-${Date.now().toString(36)}-external`;
    store.set('pzp_auth_transition', transitionMarker);
    releaseRefresh(response(200, {
        accessToken: 'stale-new-access',
        refreshToken: 'stale-new-refresh',
        user: { id: 22, username: 'account.b' }
    }));

    assert.equal(await pending, null);
    await Promise.resolve();
    assert.equal(store.get('pzp_token'), 'old-access');
    assert.equal(store.get('pzp_refresh_token'), 'old-refresh');
    assert.equal(store.get('pzp_auth_transition'), transitionMarker);
    assert.equal(context.getApiAuthSessionFailure().reason, 'session-transition');
    const logoutCall = calls.find(call => call.url === '/api/auth/logout');
    assert.deepEqual(JSON.parse(logoutCall.options.body), { refreshToken: 'stale-new-refresh' });
});

test('a verify response cannot publish inside another tab auth transition', async () => {
    let releaseVerify;
    let markVerifyStarted;
    const verifyStarted = new Promise(resolve => { markVerifyStarted = resolve; });
    const originalUser = { id: 22, username: 'account.b', role: 'animator' };
    const { context, store } = loadApi(async url => {
        assert.equal(url, '/api/auth/verify');
        markVerifyStarted();
        return await new Promise(resolve => { releaseVerify = resolve; });
    }, {
        pzp_token: 'valid-access',
        pzp_access_token: 'valid-access',
        pzp_refresh_token: 'valid-refresh',
        pzp_auth_session_generation: 'valid-generation',
        pzp_current_user: JSON.stringify(originalUser)
    });
    context.AppState = { currentUser: originalUser };

    const pending = context.apiVerifyToken();
    await verifyStarted;
    const transitionMarker = `auth-${Date.now().toString(36)}-external`;
    store.set('pzp_auth_transition', transitionMarker);
    releaseVerify(response(200, {
        user: { id: 22, username: 'account.b', role: 'manager' }
    }));

    assert.equal(await pending, null);
    assert.equal(JSON.parse(store.get('pzp_current_user')).role, 'animator');
    assert.equal(context.AppState.currentUser.role, 'animator');
    assert.equal(store.get('pzp_auth_transition'), transitionMarker);
    assert.equal(context.getApiAuthSessionFailure().reason, 'session-transition');
});

test('an old terminal API response cannot clear a newly-started auth transition', async () => {
    let releaseResponse;
    let markRequestStarted;
    const requestStarted = new Promise(resolve => { markRequestStarted = resolve; });
    const user = { id: 22, username: 'account.b' };
    const { context, store } = loadApi(async () => {
        markRequestStarted();
        return await new Promise(resolve => { releaseResponse = resolve; });
    }, {
        pzp_token: 'valid-access',
        pzp_access_token: 'valid-access',
        pzp_refresh_token: 'valid-refresh',
        pzp_auth_session_generation: 'valid-generation',
        pzp_current_user: JSON.stringify(user)
    });
    context.AppState = { currentUser: user };

    const pending = context.apiFetchWithAuthRetry('/api/private', { headers: {} });
    await requestStarted;
    const transitionMarker = `auth-${Date.now().toString(36)}-external`;
    store.set('pzp_auth_transition', transitionMarker);
    releaseResponse(response(401, {
        error: 'session revoked',
        code: 'auth_session_revoked'
    }));

    assert.equal(await pending, null);
    assert.equal(store.get('pzp_token'), 'valid-access');
    assert.equal(store.get('pzp_refresh_token'), 'valid-refresh');
    assert.equal(store.get('pzp_auth_transition'), transitionMarker);
    assert.equal(context.AppState.currentUser, user);
    assert.equal(context.getApiAuthSessionFailure().kind, 'transient');
    assert.equal(context.getApiAuthSessionFailure().reason, 'session-transition');
});

test('terminal business-profile auth failure stays terminal after snapshot invalidation', async () => {
    const user = { id: 22, username: 'account.b', role: 'animator' };
    const { context, store } = loadApi(async url => {
        assert.match(url, /\/api\/business\/profile/);
        return response(401, {
            error: 'session revoked',
            code: 'auth_session_revoked'
        });
    }, {
        pzp_token: 'revoked-access',
        pzp_access_token: 'revoked-access',
        pzp_refresh_token: 'revoked-refresh',
        pzp_auth_session_generation: 'revoked-generation',
        pzp_current_user: JSON.stringify(user)
    });
    context.AppState = { currentUser: user };
    const snapshot = context.captureApiAuthSessionSnapshot(user);

    assert.equal(await context.hydrateCrmBusinessProfile({ user, sessionSnapshot: snapshot }), null);

    assert.equal(context.getApiAuthSessionFailure().kind, 'terminal');
    assert.equal(context.getApiAuthSessionFailure().reason, 'unauthorized');
    assert.equal(store.has('pzp_token'), false);
    assert.equal(store.has('pzp_refresh_token'), false);
    assert.equal(context.AppState.currentUser, null);
});

test('protected responses are discarded after an account switch for every HTTP outcome', async () => {
    for (const status of [200, 403, 503]) {
        let releaseResponse;
        let bodyReads = 0;
        const calls = [];
        const { context, store } = loadApi(async (url, options) => {
            calls.push({ url, authorization: options.headers?.Authorization || '' });
            return new Promise(resolve => {
                releaseResponse = () => resolve({
                    ...response(status, { account: 'a' }),
                    async json() {
                        bodyReads += 1;
                        return { account: 'a' };
                    }
                });
            });
        }, {
            pzp_token: 'account-a-access',
            pzp_access_token: 'account-a-access',
            pzp_refresh_token: 'account-a-refresh',
            pzp_auth_session_generation: 'account-a-generation',
            pzp_current_user: JSON.stringify({ id: 21, username: 'account.a' })
        });
        context.AppState = { currentUser: { id: 21, username: 'account.a' } };

        const pending = context.apiFetchWithAuthRetry('/api/private', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: true })
        });
        await Promise.resolve();
        store.set('pzp_auth_session_generation', 'account-b-generation');
        store.set('pzp_token', 'account-b-access');
        store.set('pzp_access_token', 'account-b-access');
        store.set('pzp_refresh_token', 'account-b-refresh');
        store.set('pzp_current_user', JSON.stringify({ id: 22, username: 'account.b' }));
        context.AppState.currentUser = { id: 22, username: 'account.b' };
        releaseResponse();

        assert.equal(await pending, null, `status ${status} must not cross the account boundary`);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].authorization, 'Bearer account-a-access');
        assert.equal(bodyReads, 0, 'the stale response body must not be consumed');
        assert.equal(store.get('pzp_token'), 'account-b-access');
        assert.equal(JSON.parse(store.get('pzp_current_user')).id, 22);
        const failure = context.getApiAuthSessionFailure();
        assert.equal(failure.kind, 'transient');
        assert.equal(failure.stage, 'request');
        assert.equal(failure.reason, 'session-changed');
    }
});

test('an in-flight response is discarded after same-account authorization changes', async () => {
    let releaseResponse;
    const manager = { id: 14, username: 'operator', role: 'manager', roles: ['manager'] };
    const { context, store } = loadApi(async () => new Promise(resolve => {
        releaseResponse = () => resolve(response(200, { secret: 'manager-only' }));
    }), {
        pzp_token: 'manager-access',
        pzp_access_token: 'manager-access',
        pzp_refresh_token: 'manager-refresh',
        pzp_auth_session_generation: 'manager-generation',
        pzp_current_user: JSON.stringify(manager)
    });
    context.AppState = { currentUser: manager };

    const pending = context.apiFetchWithAuthRetry('/api/private', { headers: {} });
    await Promise.resolve();
    context.mergeApiCurrentUser({
        id: 14,
        username: 'operator',
        role: 'animator',
        roles: ['animator']
    });
    assert.notEqual(store.get('pzp_auth_session_generation'), 'manager-generation');
    releaseResponse();

    assert.equal(await pending, null);
    assert.equal(context.getApiAuthSessionFailure().reason, 'session-changed');
    assert.equal(JSON.parse(store.get('pzp_current_user')).role, 'animator');
});

test('same-account token rotation does not hide a successful mutation response', async () => {
    let releaseResponse;
    const { context, store } = loadApi(async () => new Promise(resolve => {
        releaseResponse = () => resolve(response(201, { success: true, id: 77 }));
    }), {
        pzp_token: 'access-before',
        pzp_access_token: 'access-before',
        pzp_refresh_token: 'refresh-before',
        pzp_auth_session_generation: 'stable-account-generation',
        pzp_current_user: JSON.stringify({ id: 14, username: 'operator' })
    });
    context.AppState = { currentUser: { id: 14, username: 'operator' } };

    const pending = context.apiFetchWithAuthRetry('/api/private', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: true })
    });
    await Promise.resolve();
    store.set('pzp_token', 'access-after');
    store.set('pzp_access_token', 'access-after');
    store.set('pzp_refresh_token', 'refresh-after');
    releaseResponse();

    const result = await pending;
    assert.equal(result.status, 201);
    assert.deepEqual(await result.json(), { success: true, id: 77 });
    assert.equal(context.getApiAuthSessionFailure(), null);
});

test('timeline auth headers stay free of aggregate business scope across authenticated retries', async () => {
    const calls = [];
    const user = {
        id: 14,
        username: 'operator',
        role: 'creator',
        businessContexts: ['event_genix', 'dar'],
        defaultBusinessContext: 'event_genix'
    };
    const { context } = loadApi(async (url, options = {}) => {
        calls.push({ url, headers: options.headers || {} });
        if (calls.length === 1) return response(401, { error: 'expired', code: 'auth_token_invalid' });
        if (url === '/api/auth/refresh') {
            return response(200, {
                accessToken: 'timeline-access-new',
                refreshToken: 'timeline-refresh-new',
                user
            });
        }
        return response(200, { success: true });
    }, {
        pzp_token: 'timeline-access-old',
        pzp_access_token: 'timeline-access-old',
        pzp_refresh_token: 'timeline-refresh-old',
        pzp_auth_session_generation: 'timeline-generation',
        pzp_current_user: JSON.stringify(user),
        pzp_crm_business_context: 'event_genix',
        pzp_crm_business_context_user: '14',
        pzp_crm_business_scope_mode: 'all'
    });
    context.AppState = { currentUser: user };

    const result = await context.apiFetchWithAuthRetry('/api/bookings', {
        method: 'GET',
        headers: context.getTimelineAuthHeaders(false)
    });

    assert.equal(result.status, 200);
    assert.deepEqual(calls.map(call => call.url), [
        '/api/bookings',
        '/api/auth/refresh',
        '/api/bookings'
    ]);
    for (const call of calls.filter(call => call.url === '/api/bookings')) {
        const normalized = Object.fromEntries(
            Object.entries(call.headers).map(([key, value]) => [key.toLowerCase(), value])
        );
        assert.equal(normalized['x-business-context'], undefined);
        assert.equal(normalized['x-business-scope'], undefined);
        assert.equal(normalized['x-business-contexts'], undefined);
    }
});

test('timeline mutations remain blocked in aggregate business scope', async () => {
    let calls = 0;
    const user = {
        id: 14,
        username: 'operator',
        role: 'creator',
        businessContexts: ['event_genix', 'dar'],
        defaultBusinessContext: 'event_genix'
    };
    const { context } = loadApi(async () => {
        calls += 1;
        return response(200, { success: true });
    }, {
        pzp_token: 'timeline-access',
        pzp_access_token: 'timeline-access',
        pzp_refresh_token: 'timeline-refresh',
        pzp_auth_session_generation: 'timeline-generation',
        pzp_current_user: JSON.stringify(user),
        pzp_crm_business_context: 'event_genix',
        pzp_crm_business_context_user: '14',
        pzp_crm_business_scope_mode: 'all'
    });
    context.AppState = { currentUser: user };
    context.window.location.pathname = '/sales-funnel';
    context.window.location.href = 'http://localhost/sales-funnel';
    context.window.location.origin = 'http://localhost';

    await assert.rejects(
        context.apiFetchWithAuthRetry('/api/bookings', {
            method: 'POST',
            headers: context.getTimelineAuthHeaders(),
            body: JSON.stringify({ name: 'Blocked aggregate write' })
        }),
        /змінювати дані/
    );
    assert.equal(calls, 0);
});

test('account session controls remain available in aggregate business scope', async () => {
    const calls = [];
    const user = {
        id: 14,
        username: 'creator',
        role: 'creator',
        businessContexts: ['event_genix', 'dar'],
        defaultBusinessContext: 'event_genix'
    };
    const { context } = loadApi(async (url, options = {}) => {
        calls.push({ url, options });
        return response(200, {
            success: true,
            token: 'target-access',
            accessToken: 'target-access',
            refreshToken: 'target-refresh',
            user: { id: 22, username: 'target.user', role: 'manager' }
        });
    }, {
        pzp_token: 'creator-access',
        pzp_access_token: 'creator-access',
        pzp_refresh_token: 'creator-refresh',
        pzp_auth_session_generation: 'creator-generation',
        pzp_current_user: JSON.stringify(user),
        pzp_crm_business_context: 'event_genix',
        pzp_crm_business_context_user: '14',
        pzp_crm_business_scope_mode: 'all'
    });
    context.AppState = { currentUser: user };
    context.window.location.pathname = '/dashboard';
    context.window.location.href = 'http://localhost/dashboard';
    context.window.location.origin = 'http://localhost';

    const result = await context.apiFetchWithAuthRetry('/api/auth/impersonate', {
        method: 'POST',
        headers: context.getAuthHeaders(true),
        body: JSON.stringify({ targetUsername: 'target.user' })
    });

    assert.equal(result.status, 200);
    assert.deepEqual(calls.map(call => call.url), ['/api/auth/impersonate']);
});

test('semantic 401 is returned without refresh or logout', async () => {
    const calls = [];
    const user = { id: 14, username: 'operator', role: 'manager' };
    const { context, store } = loadApi(async url => {
        calls.push(url);
        return response(401, {
            error: 'Невірний поточний пароль',
            code: 'current_password_invalid'
        });
    }, {
        pzp_token: 'valid-access',
        pzp_access_token: 'valid-access',
        pzp_refresh_token: 'valid-refresh',
        pzp_auth_session_generation: 'valid-generation',
        pzp_current_user: JSON.stringify(user)
    });
    context.AppState = { currentUser: user };

    const result = await context.apiFetchWithAuthRetry('/api/auth/password', {
        method: 'PUT',
        headers: context.getAuthHeaders(),
        body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'NewPassword123!' })
    });

    assert.equal(result.status, 401);
    assert.equal(context.handleAuthError(result), false);
    assert.deepEqual(calls, ['/api/auth/password']);
    assert.equal(store.get('pzp_refresh_token'), 'valid-refresh');
    assert.equal(context.getApiAuthSessionFailure(), null);
});

test('terminal auth-boundary 401 skips refresh and clears the session', async () => {
    const calls = [];
    const user = { id: 14, username: 'operator', role: 'manager' };
    const { context, store } = loadApi(async url => {
        calls.push(url);
        return response(401, { error: 'Account inactive', code: 'auth_user_deactivated' });
    }, {
        pzp_token: 'inactive-access',
        pzp_access_token: 'inactive-access',
        pzp_refresh_token: 'inactive-refresh',
        pzp_auth_session_generation: 'inactive-generation',
        pzp_current_user: JSON.stringify(user)
    });
    context.AppState = { currentUser: user };

    const result = await context.apiFetchWithAuthRetry('/api/private', { headers: {} });

    assert.equal(result, null);
    assert.deepEqual(calls, ['/api/private']);
    assert.equal(store.size, 0);
    assert.equal(context.getApiAuthSessionFailure().kind, 'terminal');
});

test('transient auth failure returns retryable messaging instead of a logout message', () => {
    const { context } = loadApi(async () => response(503));
    context.setApiAuthSessionFailure('transient', {
        stage: 'refresh',
        status: 503,
        reason: 'http'
    });

    const result = context.apiAuthFailure(null);

    assert.equal(result.success, false);
    assert.equal(result.authTransient, true);
    assert.equal(result.retryable, true);
    assert.equal(result.code, 'auth_session_temporarily_unavailable');
    assert.match(result.error, /Тимчасово/);
});

test('login form ignores duplicate submits and restores its UI after failure', async () => {
    let submitHandler;
    let loginCalls = 0;
    let finishLogin;
    const attributes = new Map();
    const button = { tagName: 'BUTTON', disabled: false, textContent: 'Увійти →', value: '' };
    const form = {
        addEventListener(type, handler) {
            if (type === 'submit') submitHandler = handler;
        },
        querySelector() { return button; },
        setAttribute(name, value) { attributes.set(name, value); },
        removeAttribute(name) { attributes.delete(name); }
    };
    const username = { value: 'manager' };
    const password = { value: 'secret' };
    const loginError = { textContent: 'old error' };
    const elements = { loginForm: form, username, password, loginError };
    const context = {
        document: { getElementById: id => elements[id] || null },
        bindSmartCredentialPaste() {},
        bindLogoutButton() {},
        applyLoginCredentialBlock() { return false; },
        login: async () => {
            loginCalls += 1;
            return new Promise(resolve => { finishLogin = resolve; });
        }
    };
    vm.createContext(context);
    vm.runInContext(
        extractFunction(APP_CODE, 'initAuthListeners', 'initTimelineListeners'),
        context,
        { filename: 'js/app.js' }
    );
    context.initAuthListeners();
    assert.equal(typeof submitHandler, 'function');

    const event = { currentTarget: form, preventDefault() {} };
    const firstSubmit = submitHandler(event);
    const duplicateSubmit = submitHandler(event);
    await duplicateSubmit;

    assert.equal(loginCalls, 1);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Вхід…');
    assert.equal(attributes.get('aria-busy'), 'true');
    assert.equal(loginError.textContent, '');

    finishLogin({ success: false, error: 'Тимчасова помилка' });
    await firstSubmit;

    assert.equal(loginError.textContent, 'Тимчасова помилка');
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Увійти →');
    assert.equal(attributes.has('aria-busy'), false);

    context.login = async () => {
        loginCalls += 1;
        throw new Error('Мережа недоступна');
    };
    await submitHandler(event);
    assert.equal(loginCalls, 2);
    assert.equal(loginError.textContent, 'Мережа недоступна');
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Увійти →');
    assert.equal(attributes.has('aria-busy'), false);
});
