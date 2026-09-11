'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const AUTH_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');
const SIDEBAR_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
const DASHBOARD_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'dashboard-page.js'), 'utf8');

function roleHydrationSource() {
    const start = AUTH_SOURCE.indexOf('function getWorkingRoleState(');
    const end = AUTH_SOURCE.indexOf('const RolePreview =', start);
    assert.ok(start >= 0 && end > start, 'working-role hydration source block must exist');
    return AUTH_SOURCE.slice(start, end);
}

function loadWorkingRoleHarness() {
    let activeRole = 'manager';
    const calls = [];
    const user = { id: 41, username: 'manager.one', role: 'manager' };
    const body = {
        classList: { toggle() {} },
        setAttribute() {},
        removeAttribute() {}
    };
    const context = {
        AppState: { currentUser: user },
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user' } },
        ROLE_PREVIEW_SESSION_KEY: 'role-preview',
        ROLE_PREVIEW_STORAGE_KEY: 'role-preview-storage',
        ROLE_WORKING_STORAGE_KEY: 'working-role',
        ROLE_WORKING_OWNER_KEY: 'working-role-owner',
        localStorage: { setItem() {}, removeItem() {} },
        sessionStorage: { removeItem() {} },
        document: {
            body,
            querySelectorAll() { return []; }
        },
        window: {
            dispatchEvent(event) { calls.push(['event', event.type, event.detail]); }
        },
        CustomEvent: class CustomEvent {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail;
            }
        },
        Sidebar: {
            render() { calls.push(['render']); },
            initUserCard() { calls.push(['user-card']); }
        },
        RoleShell: {
            getRoleLabel: role => role || 'CRM',
            getDashboardPreset: role => role || 'default',
            getQuickAccessHrefs: () => ['/dashboard']
        },
        getRoleStartPage: () => '/dashboard',
        getRealUserRole: candidate => candidate?.role || null,
        getGrantedExtraRoles: () => ['director'],
        getAvailableWorkingRoles: () => ['manager', 'director'],
        getActiveWorkingRole: () => activeRole,
        getStoredPreviewRole: () => null,
        getEffectiveUserRole: () => activeRole,
        describeWorkingRoleImpact: () => [],
        canAccessPage: () => true,
        _normalizePagePath: value => value,
        _isPageAllowedForRole: () => true,
        _normalizeRoleKey: role => String(role || '').trim(),
        clearStoredWorkingRole() {},
        _safeStorageSet() {},
        _workingRoleOwnerKey: () => '41'
    };
    vm.createContext(context);
    vm.runInContext(`${roleHydrationSource()}\nthis.WorkingRole = WorkingRole;`, context, { filename: 'js/auth.js' });
    return {
        context,
        calls,
        setActiveRole(role) { activeRole = role; }
    };
}

function instrumentSidebarSource() {
    const injection = /    return \{\r?\n        init,/;
    assert.match(SIDEBAR_SOURCE, injection, 'sidebar test injection point must exist');
    return SIDEBAR_SOURCE.replace(injection, `
    window.__sidebarRequestBudget = {
        fetchLiveBadges: _fetchLiveBadges,
        fetchBusinessLiveCounters: _fetchBusinessLiveCounters,
        refreshTaskMiniWidget: _refreshTaskMiniWidget
    };

    return {
        init,`);
}

function loadSidebarHarness() {
    const dom = new JSDOM(`<!doctype html><body>
        <a data-badge-type="alerts"></a>
        <a data-badge-type="leads_new"></a>
        <section id="focusChipAlerts"><span id="focusChipAlertsValue"></span><span id="focusChipAlertsMeta"></span></section>
        <section id="focusChipTasks"><span id="focusChipTasksDoneValue"></span><span id="focusChipTasksValue"></span><span id="focusChipTasksMeta"></span></section>
    </body>`, { url: 'http://localhost/dashboard', runScripts: 'outside-only' });
    const requests = [];
    let role = 'manager';
    let business = 'event_genix';
    const user = { id: 41, username: 'manager.one', role: 'manager' };
    dom.window.AppState = { currentUser: user };
    dom.window.isAuthenticatedRuntimeReady = () => true;
    dom.window.canAccessPage = () => true;
    dom.window.getUserRole = () => role;
    dom.window.getAuthHeaders = () => ({ Authorization: 'Bearer test-token' });
    dom.window.ChatState = { totalUnread: 0 };
    dom.window.CrmBusinessContext = {
        current: () => business,
        scope: () => ({ mode: 'single', activeContext: business, selectedContexts: [business] }),
        apiUrl: url => `${url}?businessContext=${business}`
    };
    dom.window.localStorage.setItem('pzp_token', 'test-token');
    dom.window.localStorage.setItem('pzp_auth_session_generation', 'session-41');
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};
    dom.window.fetch = async url => {
        const value = String(url);
        requests.push(value);
        if (value.includes('/api/dashboard/alerts')) {
            return { ok: true, json: async () => ({ success: true, count: 0, alerts: [] }) };
        }
        if (value.includes('/api/tasks/my-cabinet')) {
            return {
                ok: true,
                json: async () => ({ success: true, sections: { today: [], overdue: [], completed: [] }, counts: {} })
            };
        }
        if (value.includes('/api/business/live-counters')) {
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    scope: { mode: 'single', activeContext: business, selectedContexts: [business] },
                    counters: { total: { leads: { new: 0, hot: 0 }, tasks: { active: 0, overdue: 0 }, alerts: { active: 0 } } }
                })
            };
        }
        throw new Error(`Unexpected request: ${value}`);
    };
    const nativeAddEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') return;
        nativeAddEventListener(type, listener, options);
    };
    vm.runInContext(instrumentSidebarSource(), dom.getInternalVMContext(), { filename: 'js/components/sidebar.js' });
    return {
        dom,
        api: dom.window.__sidebarRequestBudget,
        requests,
        setRole(value) { role = value; },
        setBusiness(value) { business = value; }
    };
}

function instrumentDashboardSource() {
    const injection = /    return \{\r?\n        init,/;
    assert.match(DASHBOARD_SOURCE, injection, 'dashboard test injection point must exist');
    return DASHBOARD_SOURCE.replace(injection, `
    window.__dashboardRequestBudget = {
        setConfig(config) { _config = normalizeDashboardConfig(config); },
        renderWidgets,
        refreshWidget
    };

    return {
        init,`);
}

function loadDashboardRequestHarness() {
    const dom = new JSDOM(`<!doctype html><body>
        <div id="dashboardGrid"></div>
        <section id="dashboardBoardShell"><div id="dashboardBoardCanvas"></div></section>
        <div id="dashboardBoardToolbar"></div>
        <div id="boardEditControls"></div>
        <div id="boardToolOptions"></div>
        <button id="dashboardBoardModeBtn"></button>
        <span id="boardUnifiedModeLabel"></span>
        <button id="boardUndoBtn"></button><button id="boardRedoBtn"></button><span id="boardSaveStatus"></span>
    </body>`, { url: 'http://localhost/dashboard', runScripts: 'outside-only', pretendToBeVisual: true });
    const requests = [];
    dom.window.AppState = { currentUser: { id: 41, username: 'manager.one', role: 'manager' } };
    dom.window.getUserRole = () => 'manager';
    dom.window.hasMinRole = () => true;
    dom.window.canAccessPage = () => true;
    dom.window.CrmBusinessContext = { apiUrl: url => url };
    dom.window.localStorage.setItem('pzp_token', 'test-token');
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};
    dom.window.fetch = async url => {
        requests.push(String(url));
        return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
    };
    const nativeAddEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') return;
        nativeAddEventListener(type, listener, options);
    };
    vm.runInContext(instrumentDashboardSource(), dom.getInternalVMContext(), { filename: 'js/dashboard-page.js' });
    return { dom, api: dom.window.__dashboardRequestBudget, requests };
}

test('unchanged working-role hydration renders the sidebar once and role changes force one refresh', async () => {
    const harness = loadWorkingRoleHarness();

    await Promise.all([
        harness.context.WorkingRole.hydrate(),
        harness.context.WorkingRole.hydrate(),
        harness.context.WorkingRole.hydrate()
    ]);
    assert.equal(harness.calls.filter(call => call[0] === 'render').length, 1);

    harness.setActiveRole('director');
    harness.context.WorkingRole.refreshShell({ mode: 'working-role' });
    assert.equal(harness.calls.filter(call => call[0] === 'render').length, 2);
    const roleEvent = harness.calls.findLast(call => call[0] === 'event' && call[1] === 'roleSwitched');
    assert.equal(roleEvent[2].shellApplied, true);
});

test('sidebar shared GETs coalesce in flight, reuse a short fulfilled result, and stay scope-bound', async () => {
    const harness = loadSidebarHarness();
    const { api, requests } = harness;

    await Promise.all([api.fetchLiveBadges(), api.fetchLiveBadges()]);
    await Promise.all([api.refreshTaskMiniWidget(), api.refreshTaskMiniWidget()]);
    await Promise.all([api.fetchBusinessLiveCounters(), api.fetchBusinessLiveCounters()]);
    await api.fetchLiveBadges();
    await api.refreshTaskMiniWidget();

    const count = fragment => requests.filter(url => url.includes(fragment)).length;
    assert.equal(count('/api/dashboard/alerts'), 1, 'alerts initial budget');
    assert.equal(count('/api/tasks/my-cabinet'), 1, 'task cabinet initial budget');
    assert.equal(count('/api/business/live-counters'), 1, 'live counters initial budget');

    harness.setRole('director');
    await Promise.all([api.fetchLiveBadges(), api.refreshTaskMiniWidget(), api.fetchBusinessLiveCounters()]);
    assert.equal(count('/api/dashboard/alerts'), 2, 'role scope must get fresh alerts');
    assert.equal(count('/api/tasks/my-cabinet'), 2, 'role scope must get fresh tasks');
    assert.equal(count('/api/business/live-counters'), 2, 'role scope must get fresh counters');

    harness.setBusiness('maysternya_doli');
    await Promise.all([api.fetchLiveBadges(), api.refreshTaskMiniWidget(), api.fetchBusinessLiveCounters()]);
    assert.equal(count('/api/dashboard/alerts'), 3, 'business scope must get fresh alerts');
    assert.equal(count('/api/tasks/my-cabinet'), 3, 'business scope must get fresh tasks');
    assert.equal(count('/api/business/live-counters'), 3, 'business scope must get fresh counters');

    await Promise.all([
        api.fetchLiveBadges({ force: true }),
        api.refreshTaskMiniWidget({ force: true }),
        api.fetchBusinessLiveCounters(null, { force: true })
    ]);
    assert.equal(count('/api/dashboard/alerts'), 4, 'manual alerts refresh bypasses fulfilled TTL');
    assert.equal(count('/api/tasks/my-cabinet'), 4, 'manual task refresh bypasses fulfilled TTL');
    assert.equal(count('/api/business/live-counters'), 4, 'manual counters refresh bypasses fulfilled TTL');
    harness.dom.window.close();
});

test('dashboard initial render requests every widget endpoint once', async () => {
    const harness = loadDashboardRequestHarness();
    harness.api.setConfig({
        widgets: ['tasks', 'weather'],
        mode: 'board',
        layout: {},
        boardState: { items: [], drawings: [], connectors: [], preferences: { maxLiveWidgets: 4 } }
    });

    harness.api.renderWidgets();
    await new Promise(resolve => setImmediate(resolve));

    const widgetRequests = harness.requests.filter(url => url.includes('/api/dashboard/widgets/'));
    const counts = widgetRequests.reduce((result, url) => {
        result[url] = (result[url] || 0) + 1;
        return result;
    }, {});
    assert.deepEqual(counts, {
        '/api/dashboard/widgets/funnel': 1,
        '/api/dashboard/widgets/tasks': 1,
        '/api/dashboard/widgets/weather': 1
    });

    await harness.api.refreshWidget('tasks');
    assert.equal(
        harness.requests.filter(url => url === '/api/dashboard/widgets/tasks').length,
        2,
        'manual refresh updates compatibility and board containers through one shared request'
    );
    harness.dom.window.close();
});
