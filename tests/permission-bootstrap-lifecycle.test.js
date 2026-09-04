'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const CERTIFICATES = fs.readFileSync(path.join(ROOT, 'js', 'certificates-page.js'), 'utf8');

function extractFunction(source, functionName) {
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
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(declarationStart, i + 1);
        }
    }
    throw new Error(`Could not extract ${functionName}`);
}

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

test('stale account permissions cannot overwrite a newer account session or catalog', async () => {
    let resolvePermissions;
    let jsonStarted;
    const jsonStartedPromise = new Promise(resolve => { jsonStarted = resolve; });
    const authorizationHeaders = [];
    const context = loadHarness(async (_url, options) => {
        authorizationHeaders.push(options.headers?.Authorization || '');
        return response(200, {
            capabilityCatalog: { pageRoles: { '/certificates': ['animator'] } },
            capabilities: { 'page:/certificates': { allowed: true } }
        });
    });
    const userA = { id: 41, username: 'account.a', role: 'animator' };
    const userB = { id: 42, username: 'account.b', role: 'manager' };
    const permissionsB = {
        capabilityCatalog: { pageRoles: { '/sales-funnel': ['manager'] } },
        capabilities: { 'page:/sales-funnel': { allowed: true } }
    };
    context.localStorage.setItem('pzp_token', 'account-a-access');
    context.localStorage.setItem('pzp_access_token', 'account-a-access');
    context.localStorage.setItem('pzp_refresh_token', 'account-a-refresh');
    context.localStorage.setItem('pzp_auth_session_generation', 'account-a-generation');
    context.localStorage.setItem('pzp_current_user', JSON.stringify(userA));
    context.AppState.currentUser = userA;
    context.getAuthHeaders = () => ({ Authorization: `Bearer ${context.localStorage.getItem('pzp_token')}` });
    context.fetch = async (_url, options) => {
        authorizationHeaders.push(options.headers?.Authorization || '');
        return {
            ok: true,
            status: 200,
            async json() {
                jsonStarted();
                return await new Promise(resolve => { resolvePermissions = resolve; });
            }
        };
    };

    const hydration = context.hydrateActionPermissions(userA, { retryDelayMs: 0 });
    await jsonStartedPromise;

    context.localStorage.setItem('pzp_auth_session_generation', 'account-b-generation');
    context.localStorage.setItem('pzp_token', 'account-b-access');
    context.localStorage.setItem('pzp_access_token', 'account-b-access');
    context.localStorage.setItem('pzp_refresh_token', 'account-b-refresh');
    context.localStorage.setItem('pzp_current_user', JSON.stringify(userB));
    context.AppState.currentUser = userB;
    context.AppState.authPermissions = permissionsB;
    context.PAGE_ACCESS = { '/sales-funnel': ['manager'] };
    context.ACTION_PERMISSIONS = { 'lead.read': ['manager'] };
    context.setPermissionLifecycle('ready', { attempt: 1 });
    resolvePermissions(permissionsBody());

    assert.equal(await hydration, null);
    assert.deepEqual(authorizationHeaders, ['Bearer account-a-access']);
    assert.equal(Object.hasOwn(userA, 'permissions'), false);
    assert.equal(context.AppState.currentUser, userB);
    assert.equal(context.AppState.authPermissions, permissionsB);
    assert.deepEqual(context.PAGE_ACCESS, { '/sales-funnel': ['manager'] });
    assert.deepEqual(context.ACTION_PERMISSIONS, { 'lead.read': ['manager'] });
    assert.equal(context.getPermissionLifecycle().status, 'ready');
    assert.equal(JSON.parse(context.localStorage.getItem('pzp_current_user')).id, 42);
    assert.equal(context.localStorage.getItem('pzp_token'), 'account-b-access');
});

test('page access guard defers without redirect until permissions are ready', () => {
    const calls = [];
    let permissionStatus = 'idle';
    const context = {
        AppState: { currentUser: { role: 'manager' } },
        getPermissionLifecycle: () => ({ status: permissionStatus }),
        getCurrentPageAccessPath: () => '/sales-funnel',
        canAccessPage: path => {
            calls.push(['canAccessPage', path]);
            return false;
        },
        getAuthenticatedTimelineStartPage: () => '/',
        window: {
            location: {
                pathname: '/sales-funnel',
                replace: target => calls.push(['replace', target])
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(AUTH, 'enforceCurrentPageAccess'), context, { filename: 'js/auth.js' });

    assert.equal(context.enforceCurrentPageAccess(), null);
    assert.deepEqual(calls, []);

    permissionStatus = 'ready';
    assert.equal(context.enforceCurrentPageAccess(), false);
    assert.deepEqual(calls, [['canAccessPage', '/sales-funnel'], ['replace', '/']]);
});

test('Certificates waits for delayed verification and permissions before exposing its shell', async () => {
    const calls = [];
    let resolveVerify;
    let resolvePermissions;
    const verifyPromise = new Promise(resolve => { resolveVerify = resolve; });
    const permissionsPromise = new Promise(resolve => { resolvePermissions = resolve; });
    const currentUserElement = { textContent: '' };
    const context = {
        AppState: { currentUser: null },
        apiVerifyToken: () => {
            calls.push('verify');
            return verifyPromise;
        },
        hydrateBusinessOperatingProfile: async () => { calls.push('business-profile'); },
        hydrateActionPermissions: () => {
            calls.push('permissions');
            return permissionsPromise;
        },
        enforceCurrentPageAccess: () => {
            calls.push('access');
            return true;
        },
        showAuthenticatedPageShell: () => calls.push('shell'),
        bindLogoutButton: () => calls.push('logout-binding'),
        $: id => id === 'currentUser' ? currentUserElement : null,
        window: { WorkingRole: { hydrate: () => calls.push('working-role') } },
        Sidebar: { initUserCard: () => calls.push('sidebar') },
        clearAuthStorage: () => calls.push('clear-auth'),
        redirectToLogin: () => calls.push('redirect')
    };
    vm.createContext(context);
    vm.runInContext(
        extractFunction(CERTIFICATES, 'bootstrapAuthenticatedShell'),
        context,
        { filename: 'js/certificates-page.js' }
    );

    const bootstrap = context.bootstrapAuthenticatedShell();
    await Promise.resolve();
    assert.deepEqual(calls, ['verify']);
    assert.equal(context.AppState.currentUser, null);

    const verifiedUser = { id: 41, name: 'Даша', role: 'animator' };
    resolveVerify(verifiedUser);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['verify', 'business-profile', 'permissions']);
    assert.equal(context.AppState.currentUser, null);
    assert.equal(calls.includes('shell'), false);

    resolvePermissions({ capabilities: { 'page:/certificates': { allowed: true } } });
    const result = await bootstrap;

    assert.equal(result, verifiedUser);
    assert.equal(context.AppState.currentUser, verifiedUser);
    assert.equal(currentUserElement.textContent, 'Даша');
    assert.deepEqual(calls, [
        'verify',
        'business-profile',
        'permissions',
        'working-role',
        'access',
        'shell',
        'logout-binding'
    ]);
});

test('Certificates permission failure never continues to access enforcement or shell', async () => {
    const calls = [];
    const context = {
        AppState: { currentUser: null },
        apiVerifyToken: async () => ({ id: 42, name: 'Валерія', role: 'animator' }),
        hydrateBusinessOperatingProfile: async () => { calls.push('business-profile'); },
        hydrateActionPermissions: async () => {
            calls.push('permissions');
            return null;
        },
        enforceCurrentPageAccess: () => { calls.push('access'); return true; },
        showAuthenticatedPageShell: () => calls.push('shell'),
        bindLogoutButton: () => calls.push('logout-binding'),
        $: () => null,
        window: { WorkingRole: { hydrate: () => calls.push('working-role') } },
        Sidebar: { initUserCard: () => calls.push('sidebar') },
        clearAuthStorage() {},
        redirectToLogin() {}
    };
    vm.createContext(context);
    vm.runInContext(
        extractFunction(CERTIFICATES, 'bootstrapAuthenticatedShell'),
        context,
        { filename: 'js/certificates-page.js' }
    );

    await assert.rejects(
        context.bootstrapAuthenticatedShell(),
        error => error?.code === 'permission_bootstrap_failed'
    );
    assert.equal(context.AppState.currentUser, null);
    assert.deepEqual(calls, ['business-profile', 'permissions']);
});

test('Certificates preserves the session and renders retry state on transient verify failure', async () => {
    const calls = [];
    const failure = { kind: 'transient', transient: true, stage: 'verify', status: 503 };
    const context = {
        AppState: { currentUser: null },
        apiVerifyToken: async () => {
            calls.push('verify');
            return null;
        },
        hydrateBusinessOperatingProfile: async () => {},
        hydrateActionPermissions: async () => ({}),
        getApiAuthSessionFailure: () => failure,
        isApiAuthSessionFailureTransient: value => value?.transient === true,
        clearAuthStorage: () => calls.push('clear-auth'),
        redirectToLogin: () => calls.push('redirect'),
        showAuthenticatedPageShell: options => calls.push(['shell', options]),
        renderAuthSessionBootstrapError: options => calls.push(['auth-recovery', options]),
        renderPermissionBootstrapError: () => calls.push('permission-error'),
        handleStandaloneInitError: () => calls.push('fatal-error'),
        renderCertificatePageFatalError: () => calls.push('certificate-fatal'),
        initDarkMode: () => calls.push('dark-mode'),
        bindEvents: () => calls.push('bind-events'),
        setMode: () => calls.push('set-mode'),
        detectMode: () => 'list',
        $: () => null,
        window: {
            location: { reload: () => calls.push('reload') },
            WorkingRole: { hydrate: () => calls.push('working-role') },
            Sidebar: null
        },
        Sidebar: { initUserCard: () => calls.push('sidebar') }
    };
    vm.createContext(context);
    vm.runInContext([
        extractFunction(CERTIFICATES, 'bootstrapAuthenticatedShell'),
        extractFunction(CERTIFICATES, 'init')
    ].join('\n'), context, { filename: 'js/certificates-page.js' });

    await context.init();

    assert.equal(calls.includes('clear-auth'), false);
    assert.equal(calls.includes('redirect'), false);
    assert.equal(calls.includes('bind-events'), false);
    assert.equal(calls.includes('fatal-error'), false);
    assert.deepEqual(calls.slice(0, 2), ['dark-mode', 'verify']);
    const shellCall = calls.find(call => Array.isArray(call) && call[0] === 'shell');
    assert.equal(shellCall?.[1]?.markRuntimeReady, false);
    const recovery = calls.find(call => Array.isArray(call) && call[0] === 'auth-recovery');
    assert.equal(recovery?.[1]?.failure, failure);
    assert.equal(typeof recovery?.[1]?.retry, 'function');
});

test('Certificates never reveals the protected shell after terminal permission hydration', async () => {
    const calls = [];
    const terminalFailure = { kind: 'terminal', terminal: true, reason: 'unauthorized' };
    const context = {
        AppState: { currentUser: null },
        apiVerifyToken: async () => ({ id: 43, name: 'Валерія', role: 'animator' }),
        hydrateBusinessOperatingProfile: async () => { calls.push('business-profile'); },
        hydrateActionPermissions: async () => {
            calls.push('permissions');
            return null;
        },
        getApiAuthSessionFailure: () => terminalFailure,
        isApiAuthSessionFailureTerminal: failure => failure?.terminal === true,
        enforceCurrentPageAccess: () => { calls.push('access'); return true; },
        showAuthenticatedPageShell: () => calls.push('shell'),
        renderAuthSessionBootstrapError: () => calls.push('auth-recovery'),
        renderPermissionBootstrapError: () => calls.push('permission-error'),
        handleStandaloneInitError: () => calls.push('fatal-error'),
        initDarkMode: () => calls.push('dark-mode'),
        bindEvents: () => calls.push('bind-events'),
        setMode: () => calls.push('set-mode'),
        detectMode: () => 'list',
        bindLogoutButton: () => calls.push('logout-binding'),
        $: () => null,
        window: { location: { reload() {} }, WorkingRole: { hydrate() {} }, Sidebar: null },
        Sidebar: { initUserCard() {} }
    };
    vm.createContext(context);
    vm.runInContext([
        extractFunction(CERTIFICATES, 'bootstrapAuthenticatedShell'),
        extractFunction(CERTIFICATES, 'init')
    ].join('\n'), context, { filename: 'js/certificates-page.js' });

    await context.init();

    assert.deepEqual(calls.slice(0, 3), ['dark-mode', 'business-profile', 'permissions']);
    assert.equal(calls.includes('shell'), false);
    assert.equal(calls.includes('permission-error'), false);
    assert.equal(calls.includes('auth-recovery'), false);
    assert.equal(calls.includes('bind-events'), false);
});

test('Leads terminal bootstrap errors never expose the protected shell', () => {
    const leads = fs.readFileSync(path.join(ROOT, 'js', 'leads-page.js'), 'utf8');
    const calls = [];
    const terminalFailure = { kind: 'terminal', terminal: true, reason: 'unauthorized' };
    const context = {
        getApiAuthSessionFailure: () => terminalFailure,
        isApiAuthSessionFailureTerminal: failure => failure?.terminal === true,
        normalizeLeadCanonicalRoute: () => calls.push('normalize-route'),
        showAuthenticatedPageShell: () => calls.push('shell'),
        renderAuthSessionBootstrapError: () => calls.push('auth-recovery'),
        renderPermissionBootstrapError: () => calls.push('permission-error'),
        window: { location: { reload() {} } },
        Sidebar: { markShellReady: () => calls.push('shell') }
    };
    vm.createContext(context);
    vm.runInContext(extractFunction(leads, 'showLeadBootstrapError'), context, {
        filename: 'js/leads-page.js'
    });

    context.showLeadBootstrapError({ code: 'permission_bootstrap_failed' });

    assert.deepEqual(calls, []);
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
    const files = ['js/hr-page.js', 'js/staff-page.js', 'js/training-page.js', 'js/finance-page.js', 'js/certificates-page.js', 'js/hermes-studio-page.js', 'checkin.html'];
    for (const file of files) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        assert.match(source, /hydrateActionPermissions/, `${file} must hydrate permissions`);
        assert.match(source, /renderPermissionBootstrapError|Не вдалося завантажити права доступу/, `${file} must show a distinct permissions failure state`);
    }
});

test('Hermes Studio verifies refresh-only sessions and hydrates permissions before access enforcement', () => {
    const hermes = fs.readFileSync(path.join(ROOT, 'js', 'hermes-studio-page.js'), 'utf8');
    const initStart = hermes.indexOf('async function initAuth()');
    const initEnd = hermes.indexOf("if (document.readyState === 'loading')", initStart);
    const initAuth = hermes.slice(initStart, initEnd);

    assert.match(initAuth, /apiHasStoredAuthSession\(\)/);
    assert.match(initAuth, /await apiVerifyToken\(\)/);
    assert.match(initAuth, /const bootstrapSession = captureAuthBootstrapSession\(user\)/);
    assert.ok(
        initAuth.indexOf('await hydrateActionPermissions(user, { sessionSnapshot: bootstrapSession })')
            < initAuth.indexOf('enforceCurrentPageAccess(user)')
    );
    assert.ok(initAuth.indexOf('enforceCurrentPageAccess(user)') < initAuth.indexOf('await loadJobs('));
    assert.match(initAuth, /sessionSnapshot: bootstrapSession,[\s\S]*authUser: user/);
    assert.ok(initAuth.indexOf("'hermes-publish'") < initAuth.indexOf('showAuthenticatedPageShell()'));
    assert.match(initAuth, /showAuthenticatedPageShell\(\{ markRuntimeReady: false \}\)/);
    const genericFailure = initAuth.slice(initAuth.indexOf("console.error('[hermes-studio] bootstrap failed'"));
    assert.doesNotMatch(genericFailure, /clearAuthenticatedPageShell\(\)|window\.location\.href\s*=\s*'\/'/);
    assert.match(genericFailure, /renderAuthSessionBootstrapError\([\s\S]*stage: 'page-bootstrap'/);
});

test('Hermes Studio never restores an authenticated shell after a terminal request failure', () => {
    const hermes = fs.readFileSync(path.join(ROOT, 'js', 'hermes-studio-page.js'), 'utf8');
    assert.match(hermes, /isApiAuthSessionFailureTransient\(failure\)/);
    assert.match(hermes, /'auth_session_terminal'/);
    assert.match(hermes, /isApiAuthSessionFailureTerminal\(authFailure\)/);
    assert.match(hermes, /if \(terminalAuthFailure\) return;/);
});

test('Hermes Studio bootstrap propagates a terminal jobs failure and never reveals the shell', async () => {
    const hermes = fs.readFileSync(path.join(ROOT, 'js', 'hermes-studio-page.js'), 'utf8');
    const calls = [];
    const terminalError = new Error('session ended');
    terminalError.code = 'auth_session_terminal';
    const elements = new Map();
    const context = {
        URLSearchParams,
        console: { error: (...args) => calls.push(['console.error', ...args]) },
        state: { jobs: [], selectedJobId: null, canDecide: false, loading: false },
        $: id => {
            if (!elements.has(id)) elements.set(id, { value: '', textContent: '', classList: { remove() {} } });
            return elements.get(id);
        },
        withBusinessContext: params => params,
        studioFetch: async () => { throw terminalError; },
        renderQueue: () => calls.push('render-queue'),
        renderAll: () => calls.push('render-all'),
        notify: (...args) => calls.push(['notify', ...args]),
        apiHasStoredAuthSession: () => true,
        apiVerifyToken: async () => ({ id: 7, username: 'operator', role: 'manager' }),
        apiFetchWithAuthRetry: async () => null,
        captureAuthBootstrapSession: user => ({ userId: user.id, generation: 'generation-a' }),
        isAuthBootstrapSessionCurrent: () => true,
        authBootstrapSessionChangedError: stage => {
            const error = new Error('session changed');
            error.code = 'auth_session_transient';
            error.authFailure = { kind: 'transient', transient: true, stage, reason: 'session-changed' };
            return error;
        },
        hydrateActionPermissions: async () => ({ capabilities: {} }),
        hydrateBusinessOperatingProfile: async () => ({}),
        enforceCurrentPageAccess: () => true,
        bindLogoutButton: () => calls.push('bind-logout'),
        initDarkMode: () => calls.push('dark-mode'),
        canCurrentUserDecide: () => false,
        bindUi: () => calls.push('bind-ui'),
        showAuthenticatedPageShell: options => calls.push(['shell', options]),
        localStorage: { getItem: () => 'stored-session' },
        AppState: { currentUser: null },
        window: { location: { href: '', reload() {} }, WorkingRole: { hydrate() {} } }
    };
    vm.createContext(context);
    vm.runInContext([
        extractFunction(hermes, 'assertHermesBootstrapSessionCurrent'),
        extractFunction(hermes, 'loadJobs'),
        extractFunction(hermes, 'initAuth')
    ].join('\n'), context, { filename: 'js/hermes-studio-page.js' });

    await context.initAuth();

    assert.equal(calls.includes('render-queue'), true);
    assert.equal(calls.includes('render-all'), true);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'shell'), false);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'notify'), false);
    assert.equal(context.window.location.href, '');
});

test('Hermes Studio discards jobs and keeps the shell covered when the account changes mid-bootstrap', async () => {
    const hermes = fs.readFileSync(path.join(ROOT, 'js', 'hermes-studio-page.js'), 'utf8');
    const calls = [];
    const elements = new Map();
    const user = { id: 17, username: 'account.a', role: 'manager' };
    let sessionCurrent = true;
    let markJobsStarted;
    const jobsStarted = new Promise(resolve => { markJobsStarted = resolve; });
    let releaseJobs;
    const jobsResponse = new Promise(resolve => { releaseJobs = resolve; });
    const context = {
        URLSearchParams,
        console: { error: (...args) => calls.push(['console.error', ...args]) },
        state: { jobs: [], selectedJobId: null, canDecide: false, loading: false },
        $: id => {
            if (!elements.has(id)) elements.set(id, { value: '', textContent: '', classList: { remove() {} } });
            return elements.get(id);
        },
        withBusinessContext: params => params,
        studioFetch: async () => {
            markJobsStarted();
            return jobsResponse;
        },
        renderQueue: () => calls.push('render-queue'),
        renderAll: () => calls.push('render-all'),
        notify: (...args) => calls.push(['notify', ...args]),
        apiHasStoredAuthSession: () => true,
        apiVerifyToken: async () => user,
        apiFetchWithAuthRetry: async () => null,
        captureAuthBootstrapSession: authUser => ({ userId: authUser.id, generation: 'generation-a' }),
        isAuthBootstrapSessionCurrent: () => sessionCurrent,
        authBootstrapSessionChangedError: stage => {
            const error = new Error('session changed');
            error.code = 'auth_session_transient';
            error.authFailure = { kind: 'transient', transient: true, stage, reason: 'session-changed' };
            return error;
        },
        hydrateActionPermissions: async () => ({ capabilities: {} }),
        hydrateBusinessOperatingProfile: async () => ({}),
        enforceCurrentPageAccess: () => true,
        bindLogoutButton: () => calls.push('bind-logout'),
        initDarkMode: () => calls.push('dark-mode'),
        canCurrentUserDecide: () => false,
        bindUi: () => calls.push('bind-ui'),
        showAuthenticatedPageShell: options => calls.push(['shell', options]),
        renderAuthSessionBootstrapError: options => calls.push(['recovery', options]),
        clearRuntimePermissionCatalog: authUser => calls.push(['clear-permissions', authUser.id]),
        localStorage: { getItem: () => 'stored-session' },
        AppState: { currentUser: null },
        window: { location: { href: '', reload: () => calls.push('reload') }, WorkingRole: { hydrate() {} } }
    };
    vm.createContext(context);
    vm.runInContext([
        extractFunction(hermes, 'assertHermesBootstrapSessionCurrent'),
        extractFunction(hermes, 'loadJobs'),
        extractFunction(hermes, 'initAuth')
    ].join('\n'), context, { filename: 'js/hermes-studio-page.js' });

    const bootstrap = context.initAuth();
    await jobsStarted;
    sessionCurrent = false;
    releaseJobs({
        items: [{ id: 'private-job-a', title: 'Account A private job' }],
        meta: { canDecide: true }
    });
    await bootstrap;

    assert.equal(context.state.jobs.length, 0);
    assert.equal(context.AppState.currentUser, null);
    assert.equal(calls.includes('render-all'), false);
    assert.equal(calls.includes('bind-ui'), false);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'shell'), false);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'recovery'), true);
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'notify'), false);
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
