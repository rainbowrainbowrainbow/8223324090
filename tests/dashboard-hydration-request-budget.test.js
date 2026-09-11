'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'dashboard-page.js'), 'utf8');

function instrumentDashboardSource() {
    const injection = /    return \{\r?\n        init,/;
    assert.match(DASHBOARD_SOURCE, injection, 'dashboard test injection point must exist');
    return DASHBOARD_SOURCE.replace(injection, `
    window.__dashboardHydrationTest = {
        setConfig(config) { _config = normalizeDashboardConfig(config); },
        renderWidgets,
        renderBoard,
        refreshWidget,
        loadWidgetData,
        getWidgetData(type) { return _widgetData[type]; },
        getPendingRequestCount() {
            return typeof _widgetDataRequests === 'undefined' ? -1 : _widgetDataRequests.size;
        }
    };

    return {
        init,`);
}

function response(data = {}, options = {}) {
    const ok = options.ok !== false;
    return {
        ok,
        status: options.status || (ok ? 200 : 500),
        json: async () => options.payload || { success: true, data }
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function boardConfig(widgets, items = []) {
    return {
        widgets,
        mode: 'board',
        layout: {},
        boardState: {
            items,
            drawings: [],
            connectors: [],
            preferences: { maxLiveWidgets: 8 }
        }
    };
}

function widgetItem(id, widgetType, x = 20) {
    return {
        id,
        type: 'widget',
        widgetType,
        title: widgetType,
        depth: 'live-compact',
        x,
        y: 20,
        w: 320,
        h: 220,
        z: 1
    };
}

function loadDashboardHarness(options = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="dashboardGrid"></div>
        <section id="dashboardBoardShell"><div id="dashboardBoardCanvas"></div></section>
        <div id="dashboardBoardToolbar"></div>
        <div id="boardEditControls"></div>
        <div id="boardToolOptions"></div>
        <button id="dashboardBoardModeBtn"></button>
        <span id="boardUnifiedModeLabel"></span>
        <button id="boardUndoBtn"></button>
        <button id="boardRedoBtn"></button>
        <span id="boardSaveStatus"></span>
    </body></html>`, {
        url: 'http://localhost/dashboard',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });

    const requests = [];
    let role = options.role || 'manager';
    let business = options.business || 'event_genix';
    let sessionGeneration = options.sessionGeneration || 'session-1';
    let fetchImplementation = async url => response({
        marker: `${business}:${url}`,
        tasks: [],
        shifts: [],
        temperature: 11,
        city: 'Kyiv'
    });

    dom.window.AppState = {
        currentUser: { id: 41, username: 'manager.one', role: 'manager' }
    };
    dom.window.getUserRole = () => role;
    dom.window.hasMinRole = minimumRole => role === 'manager' && minimumRole === 'manager';
    dom.window.canAccessPage = () => true;
    dom.window.resolveCapability = () => ({ allowed: false });
    dom.window.CrmBusinessContext = {
        current: () => business,
        scope: () => ({ mode: 'single', activeContext: business, selectedContexts: [business] }),
        apiUrl: url => `${url}${url.includes('?') ? '&' : '?'}businessContext=${business}`
    };
    dom.window.localStorage.setItem('pzp_token', 'test-token');
    dom.window.localStorage.setItem('pzp_auth_session_generation', sessionGeneration);
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};
    dom.window.fetch = url => {
        const value = String(url);
        requests.push(value);
        return fetchImplementation(value);
    };

    const nativeAddEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, listenerOptions) => {
        if (type === 'DOMContentLoaded') return;
        nativeAddEventListener(type, listener, listenerOptions);
    };

    vm.runInContext(instrumentDashboardSource(), dom.getInternalVMContext(), {
        filename: 'js/dashboard-page.js'
    });

    return {
        dom,
        api: dom.window.__dashboardHydrationTest,
        requests,
        setRole(value) { role = value; },
        setBusiness(value) { business = value; },
        setSessionGeneration(value) {
            sessionGeneration = value;
            dom.window.localStorage.setItem('pzp_auth_session_generation', value);
        },
        setUser(user) { dom.window.AppState.currentUser = user; },
        setFetchImplementation(implementation) { fetchImplementation = implementation; }
    };
}

function widgetRequestCounts(requests) {
    return requests
        .filter(url => url.includes('/api/dashboard/widgets/'))
        .reduce((counts, value) => {
            const url = new URL(value, 'http://localhost');
            const key = `${url.pathname}${url.search}`;
            counts[key] = (counts[key] || 0) + 1;
            return counts;
        }, {});
}

async function flushHydration() {
    await new Promise(resolve => setImmediate(resolve));
    await Promise.resolve();
}

test('cold default-board hydration requests every enabled widget endpoint once', async () => {
    const harness = loadDashboardHarness();
    harness.api.setConfig(boardConfig(['tasks', 'weather']));

    harness.api.renderWidgets();
    await flushHydration();

    assert.deepEqual(widgetRequestCounts(harness.requests), {
        '/api/dashboard/widgets/funnel?businessContext=event_genix': 1,
        '/api/dashboard/widgets/tasks?businessContext=event_genix': 1,
        '/api/dashboard/widgets/weather?businessContext=event_genix': 1
    });
    assert.equal(harness.dom.window.document.getElementById('dashboardGrid').getAttribute('aria-hidden'), 'true');
    harness.dom.window.close();
});

test('saved board coalesces duplicate containers and repeated render reuses current-context data', async () => {
    const harness = loadDashboardHarness();
    harness.api.setConfig(boardConfig(
        ['weather'],
        [widgetItem('weather-a', 'weather'), widgetItem('weather-b', 'weather', 380)]
    ));

    harness.api.renderWidgets();
    await flushHydration();
    harness.api.renderWidgets();
    await flushHydration();

    const counts = widgetRequestCounts(harness.requests);
    assert.equal(counts['/api/dashboard/widgets/weather?businessContext=event_genix'], 1);
    assert.equal(counts['/api/dashboard/widgets/funnel?businessContext=event_genix'] || 0, 0);
    assert.equal(harness.dom.window.document.querySelectorAll('[data-widget-type="weather"] .board-widget-live').length, 2);
    harness.dom.window.close();
});

test('explicit refresh updates compatibility and board containers through one fresh request', async () => {
    const harness = loadDashboardHarness();
    let temperature = 11;
    harness.setFetchImplementation(async url => response({
        marker: `${temperature}:${url}`,
        temperature,
        city: 'Kyiv'
    }));
    harness.api.setConfig(boardConfig(
        ['weather'],
        [widgetItem('weather-a', 'weather'), widgetItem('weather-b', 'weather', 380)]
    ));

    harness.api.renderWidgets();
    await flushHydration();
    temperature = 22;
    await harness.api.refreshWidget('weather');

    const weatherRequests = harness.requests.filter(url => url.includes('/widgets/weather'));
    assert.equal(weatherRequests.length, 2, 'initial hydration plus one explicit refresh');
    const containers = [
        harness.dom.window.document.getElementById('widget-weather'),
        ...harness.dom.window.document.querySelectorAll('[data-widget-type="weather"] .board-widget-live')
    ];
    assert.equal(containers.length, 3);
    containers.forEach(container => assert.match(container.textContent, /22°/));
    harness.dom.window.close();
});

test('failed widget reads leave no poisoned in-flight or fulfilled entry and can retry', async () => {
    const harness = loadDashboardHarness();
    let attempt = 0;
    harness.setFetchImplementation(async () => {
        attempt += 1;
        if (attempt === 1) return response({}, { ok: false, status: 503 });
        return response({ tasks: [], marker: 'retry-ok' });
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-tasks"></div>';

    await harness.api.loadWidgetData('tasks');
    assert.match(harness.dom.window.document.getElementById('widget-tasks').textContent, /Помилка/);
    assert.equal(harness.api.getPendingRequestCount(), 0);

    await harness.api.loadWidgetData('tasks');
    assert.equal(attempt, 2);
    assert.equal(harness.api.getWidgetData('tasks').marker, 'retry-ok');
    assert.equal(harness.api.getPendingRequestCount(), 0);
    harness.dom.window.close();
});

test('new context gets one fresh request and stale old response cannot overwrite it', async () => {
    const harness = loadDashboardHarness();
    const pending = [];
    harness.setFetchImplementation(url => {
        const request = deferred();
        pending.push({ url, ...request });
        return request.promise;
    });
    harness.dom.window.document.getElementById('dashboardGrid').innerHTML = '<div id="widget-tasks"></div>';

    const oldLoad = harness.api.loadWidgetData('tasks');
    assert.equal(pending.length, 1);
    harness.setBusiness('maysternya_doli');
    harness.setSessionGeneration('session-2');
    const newLoad = harness.api.loadWidgetData('tasks');
    assert.equal(pending.length, 2);

    pending[1].resolve(response({ tasks: [], marker: 'new-context' }));
    await newLoad;
    pending[0].resolve(response({ tasks: [], marker: 'old-context' }));
    await oldLoad;

    assert.equal(harness.api.getWidgetData('tasks').marker, 'new-context');
    assert.deepEqual(widgetRequestCounts(harness.requests), {
        '/api/dashboard/widgets/tasks?businessContext=event_genix': 1,
        '/api/dashboard/widgets/tasks?businessContext=maysternya_doli': 1
    });
    assert.equal(harness.api.getPendingRequestCount(), 0);
    harness.dom.window.close();
});

test('empty dashboard and denied revenue widget do not issue forbidden reads', async () => {
    const harness = loadDashboardHarness({ role: 'employee' });
    harness.api.setConfig(boardConfig([]));
    harness.api.renderWidgets();
    await flushHydration();
    assert.deepEqual(widgetRequestCounts(harness.requests), {});

    harness.api.setConfig(boardConfig(['finance_today']));
    harness.api.renderWidgets();
    await flushHydration();
    assert.equal(harness.requests.some(url => url.includes('/widgets/finance_today')), false);
    harness.dom.window.close();
});
