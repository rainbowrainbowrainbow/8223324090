const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

require('./dashboard-hydration-request-budget.test');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readCssWithImports(relPath, seen = new Set()) {
    const normalized = relPath.replace(/\\/g, '/');
    if (seen.has(normalized)) return '';
    seen.add(normalized);

    const css = read(normalized);
    const dir = path.posix.dirname(normalized);
    const imports = [];
    const importPattern = /@import\s+(?:url\()?["']?([^"')]+\.css(?:\?[^"')]+)?)["']?\)?\s*;?/g;
    let match;

    while ((match = importPattern.exec(css)) !== null) {
        const rawRef = match[1].split('?')[0].replace(/^\/+/, '');
        const imported = rawRef.startsWith('css/')
            ? rawRef
            : path.posix.normalize(path.posix.join(dir, rawRef));
        imports.push(readCssWithImports(imported, seen));
    }

    return [css, ...imports].filter(Boolean).join('\n');
}

test('dashboard restores widget manager, full registry, and creator tasker contracts', () => {
    const pageJs = read('js/dashboard-page.js');
    const dashboardHtml = read('dashboard.html');
    const routes = read('routes/dashboard.js');
    const roles = read('config/roles.js');
    const css = readCssWithImports('css/dashboard.css');

    assert.match(pageJs, /const DASHBOARD_RETIRED_WIDGETS = new Set\(\)/);
    assert.match(pageJs, /const BOARD_LIVE_WIDGET_CAP = 18/);
    assert.match(pageJs, /maxLiveWidgets: safeNumber\(preferences\.maxLiveWidgets, BOARD_LIVE_WIDGET_CAP, 1, 24\)/);
    assert.match(routes, /maxLiveWidgets: safeNumber\(preferencesSource\.maxLiveWidgets, 18, 1, 24\)/);

    for (const key of ['my_focus', 'nearest_event', 'finance_today', 'reports_today', 'account_stats', 'week_bookings', 'task_health']) {
        assert.match(pageJs, new RegExp(`${key}:`), `${key} should be declared in the frontend widget registry`);
    }

    assert.match(dashboardHtml, /DashboardPage\.openWidgetManager\(\)/);
    assert.match(pageJs, /function openWidgetManager\(\)/);

    assert.match(roles, /personal_tasker: 'creator'/);
    assert.match(roles, /nearest_event: null/);
    assert.match(roles, /creator:\s*\[\s*'personal_tasker'/);
    assert.match(routes, /case 'nearest_event'/);
    assert.match(routes, /case 'personal_tasker'/);
    assert.match(routes, /req\.user\.role !== 'creator'/);
    assert.match(routes, /buildPersonalTaskerPayload/);

    assert.match(pageJs, /function renderPersonalTasker/);
    assert.match(pageJs, /assigned_to_me/);
    assert.match(pageJs, /created_by_me/);
    assert.match(pageJs, /all_tasks/);
    assert.match(pageJs, /function openPersonalTaskerFullscreen/);
    assert.match(pageJs, /function closePersonalTaskerFullscreen/);
    assert.match(css, /\.personal-tasker-fullscreen-overlay/);
});

test('dashboard funnel widget translates pipeline stage ids for users', () => {
    const pageJs = read('js/dashboard-page.js');

    assert.match(pageJs, /const FUNNEL_STAGE_LABELS = Object\.freeze\(\{/);
    assert.match(pageJs, /deposit_received: 'Депозит отримано'/);
    assert.match(pageJs, /waiting: 'Очікування'/);
    assert.match(pageJs, /function dashboardFunnelStageLabel\(stage = null\)/);
    assert.match(pageJs, /dashboardFunnelStageLabel\(stage\)/);
    assert.match(pageJs, /dashboardFunnelStageLabel\(hotStage\)/);
});

async function openWidgetWorkspace(options = {}) {
    const pageJs = read('js/dashboard-page.js').replace(
        /    return \{\r?\n        init,/,
        '    window.__widgetWorkspaceTest = { loadConfig };\n\n    return {\n        init,'
    );
    assert.ok(pageJs.includes('window.__widgetWorkspaceTest'), 'widget workspace test hook was not installed');
    const dom = new JSDOM(read('dashboard.html'), {
        url: 'http://localhost/dashboard',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const requests = [];
    const issues = [];
    let storedConfig = {
        widgets: ['funnel', 'tasks', 'director_pnl', 'weather'],
        theme: 'default',
        layout: {
            boardState: {
                schemaVersion: 1,
                activeTool: 'brush',
                items: [{ id: 'saved-note', type: 'note', text: 'Keep this note', x: 20, y: 40 }],
                drawings: [{ id: 'saved-stroke', tool: 'brush', points: [[10, 20], [40, 60]], width: 2 }],
                connectors: []
            }
        }
    };
    dom.window.AppState = { currentUser: { id: 7, role: 'creator', name: 'Test Creator' } };
    dom.window.getUserRole = () => 'creator';
    dom.window.hasMinRole = () => true;
    dom.window.resolveCapability = () => ({ allowed: false });
    dom.window.showNotification = message => issues.push(message);
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};
    const addEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, listenerOptions) => {
        if (type !== 'DOMContentLoaded') addEventListener(type, listener, listenerOptions);
    };
    dom.window.fetch = async (url, init = {}) => {
        const method = init.method || 'GET';
        const payload = init.body ? JSON.parse(init.body) : null;
        requests.push({ url: String(url), method, payload });
        if (url === '/api/dashboard/config') {
            if (method === 'PUT') {
                if (options.save) return options.save(payload);
                storedConfig = { ...storedConfig, ...payload, layout: { ...storedConfig.layout, ...payload.layout } };
            } else if (options.load) {
                const response = await options.load();
                if (response) return response;
            }
            return { ok: true, json: async () => ({ success: true, config: structuredClone(storedConfig) }) };
        }
        assert.match(String(url), /^\/api\/dashboard\/widgets\//);
        return { ok: true, json: async () => ({ success: true, data: {} }) };
    };
    vm.runInContext(pageJs, dom.getInternalVMContext());
    const workspace = dom.window.__widgetWorkspaceTest;
    if (!options.skipInitialLoad) {
        await workspace.loadConfig();
        await settleWidgetRequests();
    }
    return { dom, workspace, requests, issues, savedConfig: () => structuredClone(storedConfig) };
}

async function settleWidgetRequests() {
    for (let attempt = 0; attempt < 5; attempt += 1) await new Promise(resolve => setImmediate(resolve));
}

function widgetOrder(document) {
    return [...document.querySelectorAll('#dashboardGrid > .widget-card[data-widget]')].map(card => card.dataset.widget);
}

test('widget workspace opens saved dashboards without drawing tools, board writes, or forbidden revenue widgets', async t => {
    const { dom, requests } = await openWidgetWorkspace();
    t.after(() => dom.window.close());
    const doc = dom.window.document;
    const grid = doc.getElementById('dashboardGrid');

    assert.equal(grid.classList.contains('hidden'), false);
    assert.notEqual(grid.getAttribute('aria-hidden'), 'true');
    assert.deepEqual(widgetOrder(doc), ['funnel', 'tasks', 'weather']);
    assert.equal(doc.querySelector('#dashboardBoardCanvas, [data-board-tool], .board-drawing-layer'), null);
    assert.equal(requests.some(request => request.method !== 'GET'), false, 'opening legacy saved board content must not trigger a write');
    assert.equal(requests.some(request => request.url.includes('/director_pnl')), false, 'denied revenue data must not be fetched');
    assert.equal(grid.querySelectorAll('.widget-drag-handle').length, 3);
});

test('pointer drag reorders live widgets, preserves their DOM, and survives config reload without changing board data', async t => {
    const harness = await openWidgetWorkspace();
    const { dom, requests, workspace } = harness;
    t.after(() => dom.window.close());
    const doc = dom.window.document;
    const grid = doc.getElementById('dashboardGrid');
    const taskCard = grid.querySelector('[data-widget="tasks"]');
    const weatherCard = grid.querySelector('[data-widget="weather"]');
    const taskBody = taskCard.querySelector('.widget-body');
    const originalBoard = harness.savedConfig().layout.boardState;
    [...grid.querySelectorAll('.widget-card')].forEach((card, index) => {
        card.getBoundingClientRect = () => ({ left: index * 300, right: index * 300 + 280, top: 100, bottom: 380 });
    });
    const pointer = (type, x) => new dom.window.MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 200
    });

    taskCard.querySelector('.widget-drag-handle').dispatchEvent(pointer('pointerdown', 350));
    dom.window.dispatchEvent(pointer('pointermove', 660));
    assert.ok(weatherCard.classList.contains('is-drop-target'));
    dom.window.dispatchEvent(pointer('pointerup', 660));
    await settleWidgetRequests();

    assert.deepEqual(widgetOrder(doc), ['funnel', 'weather', 'tasks']);
    assert.equal(grid.querySelector('[data-widget="tasks"]'), taskCard);
    assert.equal(taskCard.querySelector('.widget-body'), taskBody);
    assert.equal(taskCard.style.transform, '');
    const saves = requests.filter(request => request.method === 'PUT');
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].payload.widgets, ['funnel', 'weather', 'director_pnl', 'tasks'], 'hidden widgets retain their configured slots');
    assert.equal('boardState' in saves[0].payload, false);
    assert.equal('boardState' in saves[0].payload.layout, false);
    assert.equal(saves[0].payload.layout.widgetGridVersion, 1);
    assert.deepEqual(harness.savedConfig().layout.boardState, originalBoard);

    await workspace.loadConfig();
    assert.deepEqual(widgetOrder(doc), ['funnel', 'weather', 'tasks']);
});

test('keyboard reorder serializes saves and restores the previous order when persistence fails', async t => {
    let completeSave;
    const { dom, requests, issues } = await openWidgetWorkspace({
        save: () => new Promise(resolve => { completeSave = resolve; })
    });
    t.after(() => dom.window.close());
    const doc = dom.window.document;
    const grid = doc.getElementById('dashboardGrid');
    const handle = grid.querySelector('[data-widget="tasks"] .widget-drag-handle');
    const key = value => new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value });

    handle.dispatchEvent(key('ArrowRight'));
    assert.equal(grid.getAttribute('aria-busy'), 'true');
    assert.deepEqual(widgetOrder(doc), ['funnel', 'weather', 'tasks']);
    handle.dispatchEvent(key('ArrowLeft'));
    assert.deepEqual(widgetOrder(doc), ['funnel', 'weather', 'tasks']);
    await settleWidgetRequests();
    assert.equal(requests.filter(request => request.method === 'PUT').length, 1);

    completeSave({ ok: false, status: 503, json: async () => ({ error: 'Test save unavailable' }) });
    await settleWidgetRequests();

    assert.deepEqual(widgetOrder(doc), ['funnel', 'tasks', 'weather']);
    assert.equal(grid.hasAttribute('aria-busy'), false);
    assert.equal(doc.getElementById('dashboardLayoutStatus').dataset.state, 'error');
    assert.ok(issues.some(message => message.includes('Test save unavailable')));
    assert.equal(doc.activeElement, handle, 'keyboard focus stays on the moved widget after recovery');
});

test('widget manager can save an empty selection without restoring defaults or changing the old board', async t => {
    const harness = await openWidgetWorkspace();
    const { dom, workspace, requests } = harness;
    t.after(() => dom.window.close());
    const doc = dom.window.document;
    const originalBoard = harness.savedConfig().layout.boardState;

    dom.window.DashboardPage.openWidgetManager();
    const overlay = doc.getElementById('settingsOverlay');
    assert.ok(overlay);
    assert.equal(overlay.querySelector('#settingsBoardStrokeColor, #settingsBoardShowGrid, .dashboard-settings-board-card'), null);
    overlay.querySelectorAll('.settings-widget-item input[type="checkbox"]').forEach(checkbox => { checkbox.checked = false; });
    await dom.window.DashboardPage.saveSettings();

    assert.equal(doc.getElementById('settingsOverlay'), null);
    assert.deepEqual(widgetOrder(doc), []);
    assert.ok(doc.querySelector('#dashboardGrid .widget-empty'));
    assert.deepEqual(harness.savedConfig().layout.boardState, originalBoard);
    const saves = requests.filter(request => request.method === 'PUT');
    assert.equal(saves.length, 1);
    assert.equal('boardState' in saves[0].payload, false);
    assert.equal('boardState' in saves[0].payload.layout, false);
    await workspace.loadConfig();
    assert.deepEqual(widgetOrder(doc), []);
});

test('recommended dashboard layout previews changes before replacing the personal widget set', async t => {
    const harness = await openWidgetWorkspace();
    const { dom, requests } = harness;
    t.after(() => dom.window.close());
    const doc = dom.window.document;

    dom.window.DashboardPage.openWidgetManager();
    const overlay = doc.getElementById('settingsOverlay');
    assert.ok(overlay);

    dom.window.DashboardPage.previewRecommendedDashboardLayout();
    const preview = doc.getElementById('settingsRecommendedLayoutPreview');
    assert.equal(preview.hidden, false);
    assert.match(preview.textContent, /Що зміниться/);
    assert.match(preview.textContent, /Мій фокус/);
    assert.equal(requests.some(request => request.method === 'PUT'), false, 'preview must not save');
    assert.deepEqual(widgetOrder(doc), ['funnel', 'tasks', 'weather']);

    dom.window.DashboardPage.applyRecommendedDashboardLayout();
    const selectedBeforeSave = [...doc.querySelectorAll('.settings-widget-item')]
        .filter(item => item.querySelector('input').checked)
        .map(item => item.dataset.widget);
    assert.deepEqual(selectedBeforeSave.slice(0, 5), ['quick_stats', 'my_focus', 'nearest_event', 'funnel', 'bookings_today']);
    assert.equal(requests.some(request => request.method === 'PUT'), false, 'apply in the modal still waits for Save');

    await dom.window.DashboardPage.saveSettings();
    const saves = requests.filter(request => request.method === 'PUT');
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0].payload.widgets.slice(0, 5), ['quick_stats', 'my_focus', 'nearest_event', 'funnel', 'bookings_today']);
    assert.ok(saves[0].payload.widgets.includes('director_pnl'), 'role-hidden existing widgets remain preserved in saved config');
    await settleWidgetRequests();
});

test('widget manager cannot overwrite a failed config load and recovers after retry', async t => {
    let failLoad = true;
    const harness = await openWidgetWorkspace({
        load: () => failLoad ? { ok: false, status: 503 } : undefined
    });
    const { dom, requests, issues } = harness;
    t.after(() => dom.window.close());
    const originalConfig = harness.savedConfig();
    const doc = dom.window.document;

    dom.window.DashboardPage.openWidgetManager();
    assert.equal(doc.getElementById('settingsOverlay'), null);
    assert.ok(doc.querySelector('[data-dashboard-open-fallback="config"]'));
    assert.ok(issues.some(message => message.includes('Повторити')));
    await dom.window.DashboardPage.saveSettings();
    assert.equal(requests.some(request => request.method === 'PUT'), false);
    assert.deepEqual(harness.savedConfig(), originalConfig);

    failLoad = false;
    await dom.window.DashboardPage.retryDashboard();
    await settleWidgetRequests();
    dom.window.DashboardPage.openWidgetManager();
    const selected = [...doc.querySelectorAll('.settings-widget-item')]
        .filter(item => item.querySelector('input').checked)
        .map(item => item.dataset.widget);
    assert.deepEqual(selected, ['funnel', 'tasks', 'weather']);
    assert.deepEqual(widgetOrder(doc), ['funnel', 'tasks', 'weather']);
    assert.equal(requests.some(request => request.method === 'PUT'), false);
});

test('widget manager waits for pending config and cannot save during a reload', async t => {
    let completeLoad;
    const { dom, workspace, requests, issues } = await openWidgetWorkspace({
        skipInitialLoad: true,
        load: () => new Promise(resolve => { completeLoad = resolve; })
    });
    t.after(() => dom.window.close());
    const doc = dom.window.document;
    const initialLoad = workspace.loadConfig();

    dom.window.DashboardPage.openWidgetManager();
    assert.equal(doc.getElementById('settingsOverlay'), null);
    assert.ok(issues.some(message => message.includes('Зачекайте')));
    await workspace.loadConfig();
    assert.equal(requests.filter(request => request.url === '/api/dashboard/config').length, 1);
    completeLoad();
    await initialLoad;

    dom.window.DashboardPage.openWidgetManager();
    assert.ok(doc.getElementById('settingsOverlay'));
    const reload = workspace.loadConfig();
    await dom.window.DashboardPage.saveSettings();
    assert.equal(requests.some(request => request.method === 'PUT'), false);
    completeLoad();
    await reload;
});
