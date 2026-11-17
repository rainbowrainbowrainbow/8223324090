'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { taskUrl, taskId, legacyDestination } = require('../js/task-links');
const redirect = require('../middleware/taskLinkRedirect');

test('task destinations retain only the supported CRM intent', () => {
    assert.equal(taskUrl(42, { businessContext: 'dar', mode: 'edit', view: 'team', next: 'https://evil.test' }),
        '/profile?tab=myday&open=42&businessContext=dar&mode=edit');
    for (const id of ['12junk', '0', '-1', '1.5', 'Infinity', '9007199254740992', '', null]) assert.equal(taskId(id), null);
    assert.equal(taskUrl(1, { businessContext: 'https://evil.test' }), '/profile?tab=myday&open=1');
});

test('legacy messages, html bookmarks and search aliases land in My Day without redirect loops', () => {
    for (const path of ['/tasks', '/tasks.html', '/tasks/']) for (const key of ['open', 'highlight', 'taskId']) {
        const url = `${path}?${key}=42&view=team&businessContext=dar&mode=edit`;
        const target = legacyDestination(url);
        assert.equal(target, '/profile?tab=myday&open=42&businessContext=dar&mode=edit');
        assert.equal(legacyDestination(target), null);
    }
    for (const value of ['/tasks', '/tasks?view=my', '/profile?tab=myday', '/?open=42', 'https://evil.test/tasks?open=42', '//evil.test/tasks?open=42', 'data:text/html,42']) {
        assert.equal(legacyDestination(value), null);
    }
    assert.equal(legacyDestination('/tasks?open=oops'), '/profile?tab=myday&open=invalid');
});

test('compatibility redirects are temporary and never cached; ordinary Task Center remains available', () => {
    let next = 0;
    const res = { set(key, value) { assert.equal(key, 'Cache-Control'); assert.equal(value, 'no-store'); },
        redirect(code, url) { assert.equal(code, 302); assert.equal(url, '/profile?tab=myday&open=42'); } };
    redirect({ method: 'GET', originalUrl: '/tasks.html?open=42' }, res, () => next++);
    redirect({ method: 'GET', originalUrl: '/tasks?view=my' }, res, () => next++);
    redirect({ method: 'POST', originalUrl: '/tasks?open=42' }, res, () => next++);
    assert.equal(next, 2);
});

test('task return intents are tab-local, account-bound, sanitized and consumed once', () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const code = fs.readFileSync(require.resolve('../js/auth.js'), 'utf8');
    const shared = new Map();
    function tab(userId = 14) {
        const local = new Map();
        const storage = map => ({ getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
        const ctx = { URL, URLSearchParams, Date, console, AppState: { currentUser: { id: userId } },
            localStorage: storage(shared), sessionStorage: storage(local),
            window: { location: { origin: 'https://crm.test', href: 'https://crm.test/profile?tab=myday&open=42&businessContext=dar&mode=edit&next=https://evil.test', pathname: '/profile' } },
            recordRedirectDiagnostic() {}, canAccessPage: () => true, getPermissionLifecycle: () => ({ status: 'ready' }) };
        vm.createContext(ctx);
        const start = code.indexOf('const AUTH_SAFE_RETURN_ROUTE_MODULES');
        const end = code.indexOf('function clearAuthSessionBootstrapError', start);
        vm.runInContext(`const AUTH_RETURN_ROUTE_KEY='pzp_auth_return_route_v1'; const AUTH_RETURN_ROUTE_MAX_AGE_MS=600000; ${code.slice(start, end)}`, ctx);
        return ctx;
    }
    const first = tab(), second = tab();
    assert.equal(first.rememberAuthReturnRoute(), true);
    assert.equal(second.consumeAuthReturnRoute({ id: 14 }), '');
    assert.equal(first.consumeAuthReturnRoute({ id: 14 }), '/profile?tab=myday&open=42&businessContext=dar&mode=edit');
    assert.equal(first.consumeAuthReturnRoute({ id: 14 }), '');
    first.rememberAuthReturnRoute();
    assert.equal(first.consumeAuthReturnRoute({ id: 15 }), '');
    assert.equal(first.normalizeSafeAuthReturnRoute('https://evil.test/profile?tab=myday&open=42'), '');
});
