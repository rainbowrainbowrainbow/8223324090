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
    window.__dashboardMobileFallbackTest = {
        setConfig(config) { _config = normalizeDashboardConfig(config); },
        renderWidgets,
        renderDashboardOpenFallback,
        retryDashboardBoardRender,
        setConfigWritable(value) {
            _dashboardConfigWritable = value === true;
            _dashboardConfigLoadError = value === true ? null : new Error('GET failed');
        },
        boardSnapshot() { return JSON.stringify(_config?.boardState || null); }
    };

    return {
        init,`);
}

function widgetItem(id, widgetType, overrides = {}) {
    return {
        id,
        type: 'widget',
        widgetType,
        title: widgetType,
        depth: 'live-compact',
        x: 20,
        y: 20,
        w: 320,
        h: 220,
        z: 1,
        ...overrides
    };
}

function boardConfig() {
    return {
        widgets: ['tasks'],
        mode: 'workspace',
        layout: {},
        boardState: {
            items: [
                widgetItem('board-weather', 'weather'),
                widgetItem('hidden-alerts', 'alerts', { hidden: true })
            ],
            drawings: [],
            connectors: [],
            preferences: { maxLiveWidgets: 8 }
        }
    };
}

function loadHarness() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="loginScreen"></div>
        <div id="mainApp" class="hidden">
            <main class="dashboard-page">
                <header class="dashboard-header">
                    <div><h1>Dashboard</h1></div>
                    <div class="dashboard-actions">
                        <button type="button" class="dashboard-btn primary" id="dashboardAddWidgetBtn">Додати віджет</button>
                        <button type="button" class="dashboard-btn" id="dashboardSettingsBtn">Налаштувати</button>
                    </div>
                </header>
                <div id="dashboardBoardToolbar" class="dashboard-board-toolbar dashboard-workspace-toolbar"></div>
                <div class="dashboard-workspace-stage">
                    <div id="boardEditControls" class="board-pro-palette board-tool-rail"></div>
                    <section id="dashboardBoardShell" class="dashboard-board-shell hidden">
                        <div id="dashboardBoardCanvas" class="dashboard-board-canvas"></div>
                    </section>
                </div>
                <div id="dashboardGrid" class="dashboard-grid"><div class="widget-loading">Завантаження...</div></div>
                <div id="boardToolOptions"></div>
                <button id="dashboardBoardModeBtn"></button>
                <span id="boardUnifiedModeLabel"></span>
                <button id="boardUndoBtn"></button>
                <button id="boardRedoBtn"></button>
                <span id="boardSaveStatus"></span>
            </main>
        </div>
    </body></html>`, {
        url: 'http://localhost/dashboard',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });

    dom.window.AppState = { currentUser: { id: 7, username: 'creator', role: 'creator' } };
    dom.window.getUserRole = () => 'creator';
    dom.window.hasMinRole = () => true;
    dom.window.canAccessPage = () => true;
    dom.window.resolveCapability = () => ({ allowed: false });
    dom.window.CrmBusinessContext = {
        current: () => 'event_genix',
        scope: () => ({ mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] }),
        apiUrl: url => url
    };
    dom.window.localStorage.setItem('pzp_token', 'test-token');
    dom.window.localStorage.setItem('pzp_auth_session_generation', 'session-1');
    dom.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};
    const nativeAddEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') return;
        nativeAddEventListener(type, listener, options);
    };

    vm.runInContext(instrumentDashboardSource(), dom.getInternalVMContext(), { filename: 'js/dashboard-page.js' });
    return {
        dom,
        api: dom.window.__dashboardMobileFallbackTest
    };
}

test('dashboard render fallback shows visible board widgets without mutating board state', async () => {
    const harness = loadHarness();
    harness.api.setConfig(boardConfig());
    const before = harness.api.boardSnapshot();

    harness.api.renderDashboardOpenFallback(new Error('forced render failure'), 'unit-test');
    await Promise.resolve();

    const { document } = harness.dom.window;
    const grid = document.getElementById('dashboardGrid');
    const shell = document.getElementById('dashboardBoardShell');
    assert.equal(harness.api.boardSnapshot(), before, 'fallback must not mutate board state');
    assert.equal(grid.classList.contains('hidden'), false, 'fallback grid is visible');
    assert.equal(grid.getAttribute('aria-hidden'), null, 'fallback grid is exposed to assistive tech');
    assert.equal(shell.classList.contains('dashboard-render-fallback'), true, 'shell is marked as render fallback');
    assert.ok(document.querySelector('.dashboard-fallback-banner'), 'fallback explains the reduced view');
    assert.ok(document.getElementById('widget-weather'), 'visible board widget absent from config.widgets is shown');
    assert.ok(document.getElementById('widget-tasks'), 'legacy config widget is preserved in fallback');
    assert.equal(document.getElementById('widget-alerts'), null, 'hidden board widget is not shown');
    assert.ok(document.querySelector('[data-dashboard-open-fallback="unit-test"]'), 'fallback source is recorded');
});

test('dashboard render retry restores board shell without autosave/reset fallback state', () => {
    const harness = loadHarness();
    harness.api.setConfig(boardConfig());
    harness.api.renderDashboardOpenFallback(new Error('forced render failure'), 'unit-test');
    const before = harness.api.boardSnapshot();

    const result = harness.api.retryDashboardBoardRender();

    const { document } = harness.dom.window;
    assert.equal(result, true, 'retry renders the board successfully');
    assert.equal(harness.api.boardSnapshot(), before, 'retry does not rewrite board state');
    assert.equal(document.getElementById('dashboardGrid').classList.contains('hidden'), true, 'compat grid is hidden after successful retry');
    assert.equal(document.getElementById('dashboardBoardShell').classList.contains('dashboard-render-fallback'), false, 'fallback marker is cleared');
    assert.ok(document.getElementById('board-widget-board-weather'), 'board widget is rendered back on the canvas');
});

test('dashboard render fallback delegates to config-load retry when confirmed config is unavailable', () => {
    const harness = loadHarness();
    harness.api.setConfig(boardConfig());
    harness.api.setConfigWritable(false);

    harness.api.renderDashboardOpenFallback(new Error('paint failure after GET failure'), 'unit-test');

    const { document } = harness.dom.window;
    assert.ok(document.querySelector('.dashboard-config-retry'), 'failed GET guard remains authoritative');
    assert.equal(document.getElementById('widget-weather'), null, 'fallback must not expose data from unconfirmed config');
    assert.equal(document.getElementById('dashboardBoardShell').classList.contains('hidden'), true, 'board shell stays closed on config failure');
});
