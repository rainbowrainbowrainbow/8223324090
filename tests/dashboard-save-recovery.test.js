'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_SOURCE = fs.readFileSync(path.join(ROOT, 'js', 'dashboard-page.js'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function response(payload = {}, options = {}) {
    return {
        ok: options.ok !== false,
        status: options.status || 200,
        json: async () => payload
    };
}

async function flushAsyncTurns(count = 8) {
    for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function defaultConfig(label = 'server') {
    return {
        widgets: ['tasks'],
        layout: {},
        theme: 'default',
        mode: 'workspace',
        presentationMode: 'mixed-scene',
        sceneOptions: { writingLane: true, controlledChaos: true },
        boardMeta: {
            version: 2,
            enabled: true,
            lastSavedAt: '2026-09-12T00:00:00.000Z',
            dirty: false,
            privacy: 'private',
            collaboration: 'personal'
        },
        boardState: {
            schemaVersion: 2,
            viewport: { x: 0, y: 0, zoom: 1 },
            items: [{
                id: `note-${label}`,
                type: 'note',
                text: label,
                content: label,
                x: 120,
                y: 120,
                width: 200,
                height: 120
            }],
            drawings: [],
            connectors: [],
            activeTool: 'select',
            preferences: {}
        }
    };
}

function injectDashboardTestHooks(source) {
    const marker = '    return {\r\n        init,';
    const normalizedMarker = '    return {\n        init,';
    const hook = `    window.__dashboardSaveTest = {
        setConfig(config) {
            _config = normalizeDashboardConfig(config);
        },
        getConfig() {
            return deepClone(_config);
        },
        setBoardText(value) {
            const state = normalizeBoardState(_config.boardState || {});
            const item = state.items[0] || { id: 'note-test', type: 'note', x: 0, y: 0, width: 200, height: 120 };
            state.items[0] = { ...item, text: value, content: value };
            _config.boardState = state;
            _config.layout = { ...safeObject(_config.layout, {}), boardState: state };
        },
        markBoardDirty,
        saveBoardNow,
        loadConfig,
        saveDashboardConfig,
        restoreBoardDraftIfNeeded,
        restoreDeferredBoardDraft,
        discardDeferredBoardDraft,
        getBoardDirty() {
            return _boardDirty;
        },
        getSaveStatus() {
            return _boardSaveStatus;
        },
        getRecoveryKey() {
            return _boardRecoveryKey;
        },
        setRecoveryKey(value) {
            _boardRecoveryKey = value;
        },
        getConfigWritable() {
            return _dashboardConfigWritable;
        }
    };

`;
    if (source.includes(marker)) return source.replace(marker, hook + marker);
    assert.ok(source.includes(normalizedMarker), 'DashboardPage return marker not found');
    return source.replace(normalizedMarker, hook + normalizedMarker);
}

function createHarness(options = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="dashboardGrid"></div>
        <section id="dashboardBoardShell" class="dashboard-board-shell hidden">
            <div id="dashboardBoardCanvas"></div>
        </section>
        <div id="dashboardBoardToolbar"></div>
        <div id="boardEditControls"></div>
        <div id="boardToolOptions"></div>
        <button id="dashboardGridModeBtn"></button>
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
    const user = options.user || { id: 77, username: 'dashboard.user', name: 'Dashboard User', role: 'manager' };
    const store = dom.window.localStorage;
    store.setItem('pzp_token', 'token-1');
    store.setItem('pzp_auth_session_generation', 'generation-1');
    store.setItem('pzp_current_user', JSON.stringify(user));
    dom.window.console = {
        ...console,
        error: () => {},
        warn: () => {}
    };

    const fetchCalls = [];
    dom.window.AppState = { currentUser: user };
    dom.window.getUserRole = () => 'manager';
    dom.window.hasMinRole = role => role === 'manager';
    dom.window.canAccessPage = () => true;
    dom.window.resolveCapability = () => ({ allowed: false });
    dom.window.CrmBusinessContext = {
        current: () => 'event_genix',
        scope: () => ({ mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] }),
        apiUrl: url => url
    };
    dom.window.captureApiAuthSessionSnapshot = () => ({ generation: store.getItem('pzp_auth_session_generation'), userId: user.id });
    dom.window.isApiAuthSessionSnapshotCurrent = snapshot => snapshot?.generation === store.getItem('pzp_auth_session_generation');
    dom.window.showNotification = () => {};
    dom.window.confirmModal = async () => options.confirmResult !== false;
    dom.window.fetch = async (url, init = {}) => {
        fetchCalls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
        if (options.fetch) return options.fetch(url, init, fetchCalls);
        return response({ success: true, config: defaultConfig('server') });
    };
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};

    const nativeAddEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, listenerOptions) => {
        if (type === 'DOMContentLoaded') return;
        nativeAddEventListener(type, listener, listenerOptions);
    };

    vm.runInContext(injectDashboardTestHooks(DASHBOARD_SOURCE), dom.getInternalVMContext(), {
        filename: 'js/dashboard-page.js'
    });

    return {
        dom,
        fetchCalls,
        testApi: dom.window.__dashboardSaveTest,
        DashboardPage: vm.runInContext('DashboardPage', dom.getInternalVMContext())
    };
}

test('stale dashboard save response does not overwrite newer local board edits', async () => {
    const put = deferred();
    let capturedPayload = null;
    const harness = createHarness({
        fetch: async (_url, init) => {
            capturedPayload = JSON.parse(init.body);
            await put.promise;
            return response({ success: true, config: capturedPayload });
        }
    });
    const api = harness.testApi;
    api.setRecoveryKey('eg_dashboard_board_draft_77');
    api.setConfig(defaultConfig('initial'));

    api.setBoardText('A');
    api.markBoardDirty('edit-a');
    const savePromise = api.saveBoardNow();

    await flushAsyncTurns();
    assert.equal(capturedPayload.boardState.items[0].text, 'A');

    api.setBoardText('B');
    api.markBoardDirty('edit-b');
    assert.equal(JSON.parse(harness.dom.window.localStorage.getItem('eg_dashboard_board_draft_77')).boardState.items[0].text, 'B');

    put.resolve();
    await savePromise;

    assert.equal(api.getConfig().boardState.items[0].text, 'B');
    assert.equal(api.getBoardDirty(), true);
    assert.equal(api.getSaveStatus(), 'dirty');
    assert.equal(JSON.parse(harness.dom.window.localStorage.getItem('eg_dashboard_board_draft_77')).boardState.items[0].text, 'B');
});

test('dashboard config saves are serialized instead of concurrent full PUT requests', async () => {
    const firstPut = deferred();
    let putCount = 0;
    const harness = createHarness({
        fetch: async (_url, init) => {
            putCount += 1;
            const payload = JSON.parse(init.body);
            if (putCount === 1) await firstPut.promise;
            return response({ success: true, config: payload });
        }
    });
    const api = harness.testApi;
    api.setRecoveryKey('eg_dashboard_board_draft_77');
    api.setConfig(defaultConfig('initial'));

    const firstSave = api.saveDashboardConfig({ mode: 'workspace' });
    await flushAsyncTurns();
    assert.equal(putCount, 1);

    const secondSave = api.saveDashboardConfig({ sceneOptions: { writingLane: false, controlledChaos: true } });
    await flushAsyncTurns();
    assert.equal(putCount, 1, 'second PUT started before first PUT completed');

    firstPut.resolve();
    await firstSave;
    await flushAsyncTurns();
    assert.equal(putCount, 2);
    await secondSave;
});

test('failed initial config load blocks default-state writes until retry succeeds', async () => {
    let putCount = 0;
    const harness = createHarness({
        fetch: async (_url, init = {}) => {
            if (init.method === 'PUT') {
                putCount += 1;
                return response({ success: true, config: JSON.parse(init.body) });
            }
            return response({ success: false, error: 'config unavailable' });
        }
    });
    const api = harness.testApi;

    await api.loadConfig();
    assert.equal(api.getConfigWritable(), false);
    assert.match(harness.dom.window.document.getElementById('dashboardGrid').textContent, /Повторити/);

    const result = await api.saveDashboardConfig({ mode: 'workspace' });
    assert.equal(result.success, false);
    assert.equal(result.blockedWrite, true);
    assert.equal(putCount, 0);
});

test('board save failure keeps dirty draft and a later retry can clear it', async () => {
    let shouldFail = true;
    const harness = createHarness({
        fetch: async (_url, init) => {
            const payload = JSON.parse(init.body);
            if (shouldFail) return response({ success: false, error: 'temporary write failure' }, { ok: false, status: 500 });
            return response({ success: true, config: payload });
        }
    });
    const api = harness.testApi;
    api.setRecoveryKey('eg_dashboard_board_draft_77');
    api.setConfig(defaultConfig('initial'));

    api.setBoardText('retry-me');
    api.markBoardDirty('retry-test');
    await api.saveBoardNow();

    assert.equal(api.getBoardDirty(), true);
    assert.equal(api.getSaveStatus(), 'error');
    assert.equal(JSON.parse(harness.dom.window.localStorage.getItem('eg_dashboard_board_draft_77')).boardState.items[0].text, 'retry-me');

    shouldFail = false;
    await api.saveBoardNow();

    assert.equal(api.getBoardDirty(), false);
    assert.equal(api.getSaveStatus(), 'saved');
    assert.equal(harness.dom.window.localStorage.getItem('eg_dashboard_board_draft_77'), null);
});

test('choosing not now defers recovery without deleting the draft during later successful saves', async () => {
    const activeKey = 'eg_dashboard_board_draft_77';
    const deferredKey = `${activeKey}_deferred`;
    const serverConfig = defaultConfig('server');
    serverConfig.widgets = [];
    serverConfig.boardMeta.lastSavedAt = '2026-09-12T00:00:00.000Z';
    const draft = {
        updatedAt: '2026-09-12T01:00:00.000Z',
        reason: 'previous-edit',
        mode: 'workspace',
        boardState: defaultConfig('deferred').boardState
    };
    const harness = createHarness({
        confirmResult: false,
        fetch: async (_url, init = {}) => {
            if (init.method === 'PUT') return response({ success: true, config: JSON.parse(init.body) });
            return response({ success: true, config: serverConfig });
        }
    });
    const api = harness.testApi;
    api.setRecoveryKey(activeKey);
    harness.dom.window.localStorage.setItem(activeKey, JSON.stringify(draft));

    await api.loadConfig();

    assert.equal(harness.dom.window.localStorage.getItem(activeKey), null);
    assert.equal(JSON.parse(harness.dom.window.localStorage.getItem(deferredKey)).boardState.items[0].text, 'deferred');

    api.setBoardText('new-edit');
    api.markBoardDirty('new-edit');
    await api.saveBoardNow();

    assert.equal(api.getSaveStatus(), 'saved');
    assert.equal(harness.dom.window.localStorage.getItem(activeKey), null);
    assert.equal(JSON.parse(harness.dom.window.localStorage.getItem(deferredKey)).boardState.items[0].text, 'deferred');

    assert.equal(api.restoreDeferredBoardDraft(), true);
    assert.equal(api.getConfig().boardState.items[0].text, 'deferred');
    assert.equal(harness.dom.window.localStorage.getItem(deferredKey), null);
});

test('queued save is not sent after account and session change', async () => {
    const firstPut = deferred();
    let putCount = 0;
    const harness = createHarness({
        fetch: async (_url, init) => {
            putCount += 1;
            const payload = JSON.parse(init.body);
            if (putCount === 1) await firstPut.promise;
            return response({ success: true, config: payload });
        }
    });
    const api = harness.testApi;
    api.setRecoveryKey('eg_dashboard_board_draft_77');
    api.setConfig(defaultConfig('initial'));

    api.setBoardText('old-account-a');
    api.markBoardDirty('old-account-a');
    const firstSave = api.saveBoardNow();
    await flushAsyncTurns();
    assert.equal(putCount, 1);

    api.setBoardText('old-account-b');
    const queuedSave = api.saveDashboardConfig({ boardState: api.getConfig().boardState });
    harness.dom.window.AppState.currentUser = { id: 88, username: 'other.user', name: 'Other User', role: 'manager' };
    harness.dom.window.localStorage.setItem('pzp_token', 'token-2');
    harness.dom.window.localStorage.setItem('pzp_auth_session_generation', 'generation-2');

    firstPut.resolve();
    await firstSave.catch(() => {});
    const queuedResult = await queuedSave;

    assert.equal(putCount, 1, 'queued old-account PUT was sent after session changed');
    assert.equal(queuedResult.success, false);
    assert.equal(queuedResult.staleSession, true);
});
