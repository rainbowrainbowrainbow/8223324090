const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const API_CODE = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

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
