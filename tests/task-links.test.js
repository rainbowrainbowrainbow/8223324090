'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { taskUrl, taskId, legacyDestination } = require('../js/task-links');
const redirect = require('../middleware/taskLinkRedirect');

test('WebKit cancellation evidence cannot hide live CORS failures or unrelated JavaScript errors', () => {
    const { isNavigationInterruption } = require('./browser/task-entry-checks');
    const error = { engine: 'webkit', page: 'tab-a', at: 5000,
        message: '/127.0.0.1:1234/api/auth/telegram-crm due to access control checks.' };
    const failure = { page: 'tab-a', at: 5001, path: '/api/auth/telegram-crm', reason: 'cancelled' };
    const navigation = { page: 'tab-a', at: 5002 };
    const readbacks = [{ page: 'tab-a', at: 6000, path: '/api/auth/telegram-crm', ok: true }];
    assert.equal(isNavigationInterruption(error, [], [navigation], readbacks), true, 'WebKit may omit requestfailed');
    assert.equal(isNavigationInterruption(error, [failure], [navigation], readbacks), true);
    assert.equal(isNavigationInterruption(error, [], [navigation], []), false, 'no successful readback stays fatal');
    assert.equal(isNavigationInterruption(error, [], [navigation], [{ ...readbacks[0], ok: false }]), false);
    assert.equal(isNavigationInterruption(error, [], [navigation], [{ ...readbacks[0], page: 'tab-b' }]), false);
    assert.equal(isNavigationInterruption(error, [], [navigation], [{ ...readbacks[0], at: 4999 }]), false);
    assert.equal(isNavigationInterruption(error, [failure], [], readbacks), false, 'active-page errors remain fatal');
    assert.equal(isNavigationInterruption(error, [{ ...failure, reason: 'CORS blocked' }], [navigation], readbacks), false);
    assert.equal(isNavigationInterruption(error, [failure], [{ ...navigation, page: 'tab-b' }], readbacks), false);
    assert.equal(isNavigationInterruption(error, [failure], [{ ...navigation, at: 10000 }], readbacks), false);
    assert.equal(isNavigationInterruption({ ...error, engine: 'chromium' }, [failure], [navigation], readbacks), false);
    assert.equal(isNavigationInterruption({ ...error, message: 'TypeError: real task bug' }, [failure], [navigation], readbacks), false);
});

test('task destinations retain only the supported CRM intent', () => {
    assert.equal(taskUrl(42, { businessContext: 'dar', mode: 'edit', view: 'team', next: 'https://evil.test' }),
        '/profile?tab=myday&open=42&businessContext=dar&mode=edit');
    for (const id of ['12junk', '0', '-1', '1.5', 'Infinity', '9007199254740992', '', null]) assert.equal(taskId(id), null);
    assert.equal(taskUrl(1, { businessContext: 'https://evil.test' }), '/profile?tab=myday&open=1');
});

test('legacy messages, html bookmarks and search aliases land in My Day without redirect loops', () => {
    for (const path of ['/tasks', '/tasks.html', '/tasks/']) for (const key of ['open', 'highlight', 'taskId', 'task']) {
        const url = `${path}?${key}=42&view=team&businessContext=dar&mode=edit`;
        const target = legacyDestination(url);
        assert.equal(target, '/profile?tab=myday&open=42&businessContext=dar&mode=edit');
        assert.equal(legacyDestination(target), null);
    }
    for (const value of ['/tasks', '/tasks?view=my', '/profile?tab=myday', '/?open=42', 'https://evil.test/tasks?open=42', '//evil.test/tasks?open=42', 'data:text/html,42']) {
        assert.equal(legacyDestination(value), null);
    }
    assert.equal(legacyDestination('/tasks?open=oops'), '/profile?tab=myday&open=invalid');
    assert.equal(legacyDestination('/tasks?task=12junk'), '/profile?tab=myday&open=invalid');
    assert.equal(legacyDestination('/tasks?open=oops&task=42'), '/profile?tab=myday&open=invalid');
    assert.equal(legacyDestination('/tasks?highlight=21&taskId=30&task=42'), '/profile?tab=myday&open=21');
});

test('compatibility redirects are temporary and never cached; ordinary Task Center remains available', () => {
    let next = 0;
    const res = { set(key, value) { assert.equal(key, 'Cache-Control'); assert.equal(value, 'no-store'); },
        redirect(code, url) { assert.equal(code, 302); assert.equal(url, '/profile?tab=myday&open=42'); } };
    redirect({ method: 'GET', originalUrl: '/tasks.html?open=42' }, res, () => next++);
    redirect({ method: 'HEAD', originalUrl: '/tasks?task=42' }, res, () => next++);
    redirect({ method: 'GET', originalUrl: '/tasks?view=my' }, res, () => next++);
    redirect({ method: 'POST', originalUrl: '/tasks?open=42' }, res, () => next++);
    assert.equal(next, 2);
});

test('Operations Center task and issue buttons use the shared scoped task destination', () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../js/center-page.js'), 'utf8');
    const context = vm.createContext({ TaskLinks: { taskUrl }, escapeHtml: String, opsRowMeta: () => '', opsBadge: () => '', formatDateTime: String });
    for (const name of ['renderOpsIssue', 'renderOpsTask']) {
        const start = source.indexOf(`function ${name}(`);
        const end = source.indexOf('\nfunction ', start + 1);
        assert.ok(start >= 0 && end > start);
        vm.runInContext(source.slice(start, end), context);
    }
    assert.match(context.renderOpsTask({ id: 42, title: 'Test', businessContext: 'dar' }), /href="\/profile\?tab=myday&open=42&businessContext=dar"/);
    assert.match(context.renderOpsIssue({ ref: { taskId: 43, businessContext: 'event_genix' } }), /href="\/profile\?tab=myday&open=43&businessContext=event_genix"/);
    assert.doesNotMatch(context.renderOpsTask({ id: '42junk' }), /open=42/);
    const page = fs.readFileSync(require.resolve('../center.html'), 'utf8');
    assert.ok(page.indexOf('js/task-links.js') < page.indexOf('js/center-page.js'));
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
