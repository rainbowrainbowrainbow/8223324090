const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('dashboard board has direct manipulation, pan, and geometry endpoint contracts', () => {
    const pageJs = read('js/dashboard-page.js');
    const css = read('css/dashboard.css');

    assert.match(pageJs, /function canStartDirectBoardDrag/);
    assert.match(pageJs, /function isBoardDragBlockedTarget/);
    assert.match(pageJs, /function beginBoardPan/);
    assert.match(pageJs, /function shouldStartBoardPan/);
    assert.match(pageJs, /function beginBoardConnectorEndpointDrag/);
    assert.match(pageJs, /function findNearestBoardAnchor/);
    assert.match(pageJs, /function boardItemTransientBounds/);
    assert.match(pageJs, /function refreshBoardConnectorLayerForItem/);
    assert.match(pageJs, /function finishBoardGeometryCommit/);
    assert.match(pageJs, /if \(item\.type === 'widget' \|\| item\.type === 'note' \|\| item\.type === 'text'\) return false/);
    assert.doesNotMatch(pageJs, /data-board-line-endpoint="start"/);
    assert.match(css, /\.dashboard-board-shell\.is-panning/);
    assert.match(css, /\.dashboard-board-item\.thin-geometry/);
    assert.match(css, /\.dashboard-board-item\.equilateral-geometry \.board-resize-n/);
    assert.match(css, /\.dashboard-planner-layer[\s\S]*z-index: 0;/);
    assert.match(css, /\.board-connector-endpoint/);
    assert.match(css, /box-shadow: 0 0 0 1px var\(--workspace-selection-ring/);
});

test('dashboard board uses one unified interaction mode instead of forced view/edit', () => {
    const pageJs = read('js/dashboard-page.js');
    const html = read('dashboard.html');
    const css = read('css/dashboard.css');

    assert.match(pageJs, /const BOARD_INTERACTION_MODE = 'unified'/);
    assert.match(pageJs, /let _boardInteractionMode = BOARD_INTERACTION_MODE/);
    assert.doesNotMatch(pageJs, /_boardInteractionMode !== 'edit'/);
    assert.doesNotMatch(pageJs, /_boardInteractionMode === 'view'/);
    assert.doesNotMatch(pageJs, /_boardInteractionMode = 'edit'/);
    assert.doesNotMatch(pageJs, /_boardInteractionMode = 'view'/);
    assert.match(html, /boardUnifiedModeLabel/);
    assert.doesNotMatch(html, /boardViewModeBtn|boardEditModeBtn/);
    assert.doesNotMatch(css, /data-interaction-mode="edit"|data-interaction-mode="view"|boardViewModeBtn|boardEditModeBtn/);
});

test('dashboard board Android openability has guarded init, viewport, and touch fallbacks', () => {
    const pageJs = read('js/dashboard-page.js');
    const css = read('css/dashboard.css');

    assert.match(pageJs, /let _dashboardInitPromise = null/);
    assert.match(pageJs, /if \(_dashboardInitPromise\) return _dashboardInitPromise/);
    assert.match(pageJs, /function revealDashboardShell/);
    assert.match(pageJs, /function renderDashboardOpenFallback/);
    assert.match(pageJs, /function initDashboardViewportHeight/);
    assert.match(pageJs, /visualViewport\?\.addEventListener\?\.\('resize'/);
    assert.match(pageJs, /function captureBoardPointerSafely/);
    assert.doesNotMatch(pageJs, /setPointerCapture\?\.\(event\.pointerId\)/);
    assert.match(css, /--eg-viewport-height/);
    assert.match(css, /\.dashboard-board-shell[\s\S]*-webkit-overflow-scrolling: touch;/);
    assert.match(css, /\.dashboard-board-canvas[\s\S]*touch-action: pan-x pan-y;/);
    assert.match(css, /@media \(max-width: 430px\)[\s\S]*\.dashboard-workspace-stage \.dashboard-board-shell/);
});

function loadDashboardHarness(options = {}) {
    let pageJs = read('js/dashboard-page.js');
    if (options.exposeBoardInternals) {
        pageJs = pageJs.replace(
            /    return \{\r?\n        init,/,
            '    window.__boardTest = { normalizeDashboardConfig, normalizeBoardState };\n\n    return {\n        init,'
        );
        assert.ok(pageJs.includes('window.__boardTest'), 'dashboard board internals hook was not installed');
    }
    const dom = new JSDOM(`<!doctype html>
        <main>
            <div id="dashboardGrid"></div>
            <section id="dashboardBoardShell" class="dashboard-board-shell">
                <div id="dashboardBoardCanvas" class="dashboard-board-canvas"></div>
            </section>
            <div id="dashboardBoardToolbar"></div>
            <div class="dashboard-workspace-stage"></div>
            <div id="boardEditControls">
                <div data-board-tool-family="interaction"></div>
                <div data-board-tool-family="navigate">
                    <button type="button" data-board-tool="select">Вибір</button>
                    <button type="button" data-board-tool="hand">Рука</button>
                </div>
                <div data-board-tool-family="shape">
                    <button type="button" data-board-tool="rect">Прямокутник</button>
                </div>
                <div data-board-tool-family="connect">
                    <button type="button" data-board-tool="arrow">Стрілка</button>
                </div>
            </div>
            <div id="boardToolOptions"></div>
            <button id="dashboardBoardModeBtn"></button>
            <span id="boardUnifiedModeLabel"></span>
            <button id="boardUndoBtn"></button>
            <button id="boardRedoBtn"></button>
            <span id="boardSaveStatus"></span>
        </main>`, {
        url: 'http://localhost/dashboard',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    dom.window.AppState = { currentUser: { id: 1, role: 'creator', name: 'Creator' } };
    dom.window.getUserRole = () => 'creator';
    dom.window.hasMinRole = () => true;
    dom.window.fetch = async () => ({ ok: true, json: async () => ({}) });
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};
    const addEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') return;
        addEventListener(type, listener, options);
    };
    vm.runInContext(pageJs, dom.getInternalVMContext());
    return {
        dom,
        DashboardPage: vm.runInContext('DashboardPage', dom.getInternalVMContext()),
        boardTest: vm.runInContext('window.__boardTest', dom.getInternalVMContext())
    };
}

function createBoardCompatibilityFixture() {
    return {
        schemaVersion: 0,
        viewport: { x: '22', y: -12, zoom: '1.25' },
        items: [
            { id: 'legacy-ellipse', type: 'shape', shape: 'ellipse', x: 40, y: 50, w: 260, h: 130, label: 'Legacy ellipse' },
            { id: 'legacy-generic', kind: 'shape', x: 360, y: 60, w: 220, h: 130, content: 'Generic legacy shape' },
            { id: 'legacy-static-arrow', type: 'shape', shape: 'arrow', x: 80, y: 260, w: 260, h: 42 },
            { id: 'modern-circle', type: 'shape', shape: 'circle', x: 460, y: 260, w: 260, h: 120 },
            { id: 'widget-snapshot', type: 'widget', widgetType: 'tasks', depth: 'snapshot-card', x: 80, y: 390 },
            { id: 'widget-expanded', type: 'widget', widgetType: 'weather', depth: 'live-expanded', x: 430, y: 390 },
            { id: 'legacy-note', noteText: 'Legacy note body', x: 780, y: 80 }
        ],
        drawings: [
            { id: 'stroke-1', tool: 'brush', color: '#111827', width: 3, points: [[10, 10], [30, 40], [60, 42]] }
        ],
        connectors: [
            {
                id: 'conn-json',
                from: JSON.stringify({ itemId: 'widget-snapshot', anchor: 'right' }),
                to: JSON.stringify({ itemId: 'modern-circle', anchor: 'left' }),
                style: 'arrow',
                relationType: 'depends',
                width: 3
            },
            {
                id: 'conn-modern',
                from: { itemId: 'legacy-ellipse', anchor: 'bottom' },
                to: { itemId: 'legacy-generic', anchor: 'top' },
                style: 'curve',
                relationType: 'feeds'
            },
            {
                id: 'conn-orphan',
                from: { itemId: 'missing-item', anchor: 'right' },
                to: { itemId: 'widget-snapshot', anchor: 'left' }
            },
            {
                id: 'conn-self',
                from: { itemId: 'widget-snapshot', anchor: 'right' },
                to: { itemId: 'widget-snapshot', anchor: 'left' }
            }
        ],
        activeTool: 'arrow',
        preferences: {
            snapToGrid: false,
            maxLiveWidgets: 99,
            strokeWidth: 99,
            connectorStyle: 'curve',
            relationType: 'blocks'
        }
    };
}

function byId(items) {
    return Object.fromEntries(items.map(item => [item.id, item]));
}

test('dashboard primitive shapes create as scene-native objects, while notes keep the framed shell', () => {
    const { dom, DashboardPage } = loadDashboardHarness();
    DashboardPage.setBoardInteractionMode('edit');

    const circle = DashboardPage.addBoardShape('circle', [200, 200]);
    const square = DashboardPage.addBoardShape('square', [380, 200]);
    DashboardPage.addBoardShape('rect', [560, 200]);
    DashboardPage.addBoardShape('ellipse', [760, 200]);
    DashboardPage.addBoardNote();

    assert.equal(circle.w, circle.h);
    assert.equal(square.w, square.h);

    const doc = dom.window.document;
    const circleEl = doc.querySelector('[data-board-shape-kind="circle"]');
    const squareEl = doc.querySelector('[data-board-shape-kind="square"]');
    const rectEl = doc.querySelector('[data-board-shape-kind="rect"]');
    const ellipseEl = doc.querySelector('[data-board-shape-kind="ellipse"]');
    const noteEl = doc.querySelector('.dashboard-board-item.type-note');

    for (const el of [circleEl, squareEl, rectEl, ellipseEl]) {
        assert.ok(el?.classList.contains('board-primitive-shape'));
        assert.equal(el.classList.contains('workspace-module'), false);
        assert.equal(el.querySelector('.dashboard-board-item-frame'), null);
        assert.ok(el.querySelector('[data-board-shape]'));
    }

    assert.equal(circleEl.style.width, circleEl.style.height);
    assert.equal(squareEl.style.width, squareEl.style.height);
    assert.ok(noteEl?.classList.contains('workspace-module'));
    assert.ok(noteEl?.querySelector('.dashboard-board-item-frame'));
});

test('dashboard legacy line and arrow shapes are unframed scene geometry and drag freely in 2D', () => {
    const { dom, DashboardPage } = loadDashboardHarness();
    DashboardPage.setBoardInteractionMode('edit');

    const line = DashboardPage.addBoardShape('line', [220, 220]);
    const arrow = DashboardPage.addBoardShape('arrow', [520, 220]);
    DashboardPage.setBoardTool('select');

    const doc = dom.window.document;
    for (const item of [line, arrow]) {
        const el = doc.querySelector(`[data-board-item-id="${item.id}"]`);
        assert.ok(el?.classList.contains('board-primitive-shape'));
        assert.ok(el?.classList.contains('thin-geometry'));
        assert.equal(el.classList.contains('workspace-module'), false);
        assert.equal(el.querySelector('.dashboard-board-item-frame'), null);
        assert.equal(el.querySelector('[data-board-line-endpoint]'), null);
    }

    const arrowEl = doc.querySelector(`[data-board-item-id="${arrow.id}"]`);
    const dragHandle = arrowEl.querySelector('[data-board-drag-handle]');
    dragHandle.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 100,
        clientY: 100
    }));
    doc.dispatchEvent(new dom.window.MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: 164,
        clientY: 147
    }));
    doc.dispatchEvent(new dom.window.MouseEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: 164,
        clientY: 147
    }));

    assert.equal(arrow.x, Number(arrowEl.style.left.replace('px', '')));
    assert.equal(arrow.y, Number(arrowEl.style.top.replace('px', '')));
    assert.ok(arrow.x > 390);
    assert.ok(arrow.y > 220);
});

test('dashboard widget movement commits without remounting the live widget subtree', () => {
    const { dom, DashboardPage } = loadDashboardHarness();
    DashboardPage.setBoardInteractionMode('edit');

    const widget = DashboardPage.addBoardWidgetByType('tasks', [360, 260]);
    DashboardPage.setBoardTool('select');

    const doc = dom.window.document;
    const widgetEl = doc.querySelector(`[data-board-item-id="${widget.id}"]`);
    const liveBefore = widgetEl.querySelector('.board-widget-live');
    const frame = widgetEl.querySelector('.dashboard-board-item-frame');

    frame.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 100,
        clientY: 100
    }));
    doc.dispatchEvent(new dom.window.MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: 142,
        clientY: 136
    }));
    doc.dispatchEvent(new dom.window.MouseEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: 142,
        clientY: 136
    }));

    const widgetAfter = doc.querySelector(`[data-board-item-id="${widget.id}"]`);
    assert.equal(widgetAfter, widgetEl);
    assert.equal(widgetAfter.querySelector('.board-widget-live'), liveBefore);
    assert.equal(widget.x, Number(widgetAfter.style.left.replace('px', '')));
    assert.equal(widget.y, Number(widgetAfter.style.top.replace('px', '')));
    assert.equal(widgetAfter.dataset.widgetRuntime, 'live');
});

test('dashboard circle and square resize through freeform corner handles without drifting from equal bounds', () => {
    const { dom, DashboardPage } = loadDashboardHarness();
    DashboardPage.setBoardInteractionMode('edit');

    const circle = DashboardPage.addBoardShape('circle', [220, 220]);
    const doc = dom.window.document;
    let circleEl = doc.querySelector(`[data-board-item-id="${circle.id}"]`);
    const circleHandles = [...circleEl.querySelectorAll('[data-board-resize-handle]')].map(handle => handle.dataset.boardResizeHandle).sort();

    assert.deepEqual(circleHandles, ['ne', 'nw', 'se', 'sw']);

    circleEl.querySelector('[data-board-resize-handle="se"]').dispatchEvent(new dom.window.MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: circle.x + circle.w,
        clientY: circle.y + circle.h
    }));
    doc.dispatchEvent(new dom.window.MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: circle.x + circle.w + 74,
        clientY: circle.y + circle.h + 26
    }));
    doc.dispatchEvent(new dom.window.MouseEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: circle.x + circle.w + 74,
        clientY: circle.y + circle.h + 26
    }));

    circleEl = doc.querySelector(`[data-board-item-id="${circle.id}"]`);
    assert.equal(circle.w, circle.h);
    assert.equal(circleEl.style.width, circleEl.style.height);
    assert.ok(circle.w > 150);

    const square = DashboardPage.addBoardShape('square', [520, 220]);
    const squareEl = doc.querySelector(`[data-board-item-id="${square.id}"]`);
    const squareHandles = [...squareEl.querySelectorAll('[data-board-resize-handle]')].map(handle => handle.dataset.boardResizeHandle).sort();

    assert.deepEqual(squareHandles, ['ne', 'nw', 'se', 'sw']);
    assert.equal(squareEl.style.width, squareEl.style.height);
});

test('dashboard shape allow-lists and sanitizer preserve legacy rect/ellipse while admitting circle/square', () => {
    const pageJs = read('js/dashboard-page.js');
    const routeJs = read('routes/dashboard.js');
    const html = read('dashboard.html');
    const css = read('css/dashboard.css');

    assert.match(pageJs, /BOARD_SHAPE_TOOLS = new Set\(\[[^\]]*'rect'[^\]]*'square'[^\]]*'circle'[^\]]*'ellipse'/);
    assert.doesNotMatch(pageJs, /BOARD_SHAPE_TOOLS = new Set\(\[[^\]]*'arrow'/);
    assert.match(pageJs, /BOARD_ALLOWED_SHAPES = new Set\(\[[^\]]*'arrow'/);
    assert.match(routeJs, /BOARD_ALLOWED_SHAPES = new Set\(\[[^\]]*'rect'[^\]]*'square'[^\]]*'circle'[^\]]*'ellipse'/);
    assert.match(pageJs, /function normalizeBoardShapeDimensions/);
    assert.match(routeJs, /function normalizeBoardShapeDimensions/);
    assert.match(pageJs, /if \(type === 'shape'\) \{\s*const dimensions = normalizeBoardShapeDimensions\(safe\.shape, safe\.w, safe\.h\);/);
    assert.match(routeJs, /if \(type === 'shape'\) \{\s*const dimensions = normalizeBoardShapeDimensions\(safe\.shape, safe\.w, safe\.h\);/);
    assert.match(html, /data-board-tool="square"/);
    assert.match(html, /data-board-tool="circle"/);
    assert.match(css, /\.board-shape-circle/);
    assert.match(css, /\.board-shape-square/);
});

test('dashboard board persistence normalizes legacy and modern saved content consistently', () => {
    const dashboardRoute = require(path.join(ROOT, 'routes/dashboard'));
    const routeTest = dashboardRoute.__boardTest;
    assert.equal(typeof routeTest?.sanitizeBoardState, 'function');
    assert.equal(typeof routeTest?.buildPersistedDashboardConfig, 'function');
    assert.deepEqual(routeTest.persistenceContract, {
        source: 'postgres',
        table: 'dashboard_configs',
        endpoint: '/api/dashboard/config',
        boardStatePath: 'layout.boardState'
    });

    const fixture = createBoardCompatibilityFixture();
    const backendState = routeTest.sanitizeBoardState(fixture, 'creator');
    const { boardTest } = loadDashboardHarness({ exposeBoardInternals: true });
    const frontendState = boardTest.normalizeBoardState(fixture);
    const backendDefaultState = routeTest.sanitizeBoardState({}, 'creator');
    const frontendDefaultState = boardTest.normalizeBoardState({});
    const backendItems = byId(backendState.items);
    const frontendItems = byId(frontendState.items);

    for (const state of [backendDefaultState, frontendDefaultState]) {
        assert.equal(state.preferences.snapMode, 'freeform');
        assert.equal(state.preferences.snapToGrid, false);
    }

    for (const state of [backendState, frontendState]) {
        assert.equal(state.schemaVersion, 1);
        assert.equal(state.viewport.x, 22);
        assert.equal(state.preferences.snapMode, 'freeform');
        assert.equal(state.preferences.maxLiveWidgets, 24);
        assert.equal(state.preferences.strokeWidth, 12);
        assert.deepEqual(state.connectors.map(conn => conn.id).sort(), ['conn-json', 'conn-modern']);
    }

    for (const items of [backendItems, frontendItems]) {
        assert.equal(items['legacy-ellipse'].shape, 'ellipse');
        assert.equal(items['legacy-generic'].shape, 'rect');
        assert.equal(items['legacy-static-arrow'].shape, 'arrow');
        assert.equal(items['modern-circle'].w, items['modern-circle'].h);
        assert.equal(items['widget-snapshot'].depth, 'snapshot-static');
        assert.equal(items['widget-expanded'].depth, 'live-compact');
        assert.equal(items['legacy-note'].type, 'note');
        assert.equal(items['legacy-note'].text, 'Legacy note body');
    }

    const firstSave = routeTest.buildPersistedDashboardConfig({
        layout: { boardState: fixture },
        widgets: ['tasks'],
        theme: 'default'
    }, {
        boardState: fixture,
        widgets: ['tasks']
    }, 'creator');

    assert.deepEqual(firstSave.layout.boardState, firstSave.boardState);
    assert.equal(firstSave.boardState.connectors.length, 2);

    const editedState = {
        ...firstSave.boardState,
        items: firstSave.boardState.items.map(item => item.id === 'modern-circle'
            ? { ...item, w: item.w + 90, h: item.h }
            : item),
        connectors: [
            ...firstSave.boardState.connectors,
            { id: 'conn-after-reload-orphan', from: { itemId: 'missing', anchor: 'right' }, to: { itemId: 'modern-circle', anchor: 'left' } }
        ]
    };
    const secondSave = routeTest.buildPersistedDashboardConfig(firstSave, {
        boardState: editedState,
        widgets: firstSave.widgets
    }, 'creator');
    const secondItems = byId(secondSave.boardState.items);

    assert.deepEqual(secondSave.layout.boardState, secondSave.boardState);
    assert.equal(secondSave.boardState.schemaVersion, 1);
    assert.equal(secondSave.boardState.connectors.length, 2);
    assert.equal(secondItems['modern-circle'].w, secondItems['modern-circle'].h);
    assert.equal(secondItems['widget-snapshot'].depth, 'snapshot-static');
});

test('dashboard board persistence path stays canonical Postgres and excludes Supabase', () => {
    const routeJs = read('routes/dashboard.js');
    const pageJs = read('js/dashboard-page.js');
    const migration = read('db/migrations/038_dashboard_and_roles.sql');

    assert.match(routeJs, /const \{ pool \} = require\('\.\.\/db'\)/);
    assert.match(routeJs, /DASHBOARD_CONFIG_PERSISTENCE = Object\.freeze/);
    assert.match(routeJs, /source: 'postgres'/);
    assert.match(routeJs, /table: 'dashboard_configs'/);
    assert.match(routeJs, /boardStatePath: 'layout\.boardState'/);
    assert.match(routeJs, /DASHBOARD_CONFIG_SELECT_SQL/);
    assert.match(routeJs, /DASHBOARD_CONFIG_UPSERT_SQL/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS dashboard_configs/);
    assert.match(migration, /layout JSONB DEFAULT '\{\}'/);
    assert.match(pageJs, /fetch\('\/api\/dashboard\/config'/);
    assert.match(pageJs, /layout:\s*\{[\s\S]*boardState: patch\.boardState \|\| _config\.boardState/);

    for (const source of [routeJs, pageJs]) {
        assert.doesNotMatch(source, /@supabase\/supabase-js/);
        assert.doesNotMatch(source, /require\(['"]\.\.\/db\/supabase['"]\)/);
        assert.doesNotMatch(source, /\bgetSupabase\b/);
        assert.doesNotMatch(source, /\bsupabase\b/i);
    }
});

test('dashboard arrow tool creates an anchor connector draft instead of inserting a static arrow shape', () => {
    const { dom, DashboardPage } = loadDashboardHarness();
    DashboardPage.setBoardInteractionMode('edit');

    const rect = DashboardPage.addBoardShape('rect', [200, 200]);
    const circle = DashboardPage.addBoardShape('circle', [520, 200]);
    DashboardPage.setBoardTool('arrow');

    const doc = dom.window.document;
    const startEl = () => doc.querySelector(`[data-board-item-id="${rect.id}"]`);
    const endEl = () => doc.querySelector(`[data-board-item-id="${circle.id}"]`);
    const click = (el, x, y) => el.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y
    }));

    click(startEl(), rect.x + rect.w, rect.y + rect.h / 2);

    assert.equal(doc.querySelector('[data-board-shape-kind="arrow"]'), null);
    assert.ok(doc.querySelector('[data-board-connector-draft="true"]'));
    assert.equal(doc.getElementById('dashboardBoardCanvas')?.dataset.workspaceMode, 'board:connect');

    doc.getElementById('dashboardBoardCanvas').dispatchEvent(new dom.window.MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: circle.x,
        clientY: circle.y + circle.h / 2
    }));

    assert.ok(doc.querySelector('.board-anchor.is-draft-target'));

    click(endEl(), circle.x, circle.y + circle.h / 2);

    assert.equal(doc.querySelector('[data-board-connector-draft="true"]'), null);
    assert.equal(doc.querySelectorAll('[data-board-connector-id]').length, 1);
    assert.match(doc.querySelector('[data-board-connector-id] .board-connector-path')?.getAttribute('d') || '', /^M /);
});

test('dashboard connectors rerender from item anchors after connected objects move', () => {
    const { dom, DashboardPage } = loadDashboardHarness();
    DashboardPage.setBoardInteractionMode('edit');

    const rect = DashboardPage.addBoardShape('rect', [220, 240]);
    const square = DashboardPage.addBoardShape('square', [560, 240]);
    DashboardPage.handleBoardAnchor(rect.id, 'right');
    DashboardPage.handleBoardAnchor(square.id, 'left');

    const doc = dom.window.document;
    const connectorPath = () => doc.querySelector('[data-board-connector-id] .board-connector-path')?.getAttribute('d') || '';
    const before = connectorPath();

    DashboardPage.setBoardTool('select');
    const rectEl = doc.querySelector(`[data-board-item-id="${rect.id}"]`);
    const dragHandle = rectEl?.querySelector('[data-board-drag-handle]') || rectEl;
    dragHandle.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: rect.x + 20,
        clientY: rect.y + 20
    }));
    doc.dispatchEvent(new dom.window.MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + 90,
        clientY: rect.y + 50
    }));
    const during = connectorPath();
    doc.dispatchEvent(new dom.window.MouseEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + 90,
        clientY: rect.y + 50
    }));

    const after = connectorPath();

    assert.notEqual(before, '');
    assert.notEqual(during, '');
    assert.notEqual(during, before);
    assert.notEqual(after, '');
    assert.notEqual(after, before);
});

test('dashboard connector mode snaps from near-canvas clicks to item anchors', () => {
    const { dom, DashboardPage } = loadDashboardHarness();
    DashboardPage.setBoardInteractionMode('edit');

    const rect = DashboardPage.addBoardShape('rect', [220, 220]);
    const circle = DashboardPage.addBoardShape('circle', [520, 220]);
    const doc = dom.window.document;
    const canvas = doc.getElementById('dashboardBoardCanvas');

    DashboardPage.setBoardTool('connector');
    canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: rect.x + rect.w + 36,
        clientY: rect.y + rect.h / 2
    }));

    assert.ok(doc.querySelector('[data-board-connector-draft="true"]'));

    canvas.dispatchEvent(new dom.window.MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: circle.x - 44,
        clientY: circle.y + circle.h / 2
    }));
    assert.ok(doc.querySelector('.board-anchor.is-draft-target'));

    canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: circle.x - 36,
        clientY: circle.y + circle.h / 2
    }));

    assert.equal(doc.querySelector('[data-board-connector-draft="true"]'), null);
    assert.equal(doc.querySelectorAll('[data-board-connector-id]').length, 1);
});

test('dashboard sandbox UX exposes tool families, canvas hints, and cancel reset', () => {
    const { dom, DashboardPage } = loadDashboardHarness();
    DashboardPage.setBoardInteractionMode('edit');

    const rect = DashboardPage.addBoardShape('rect', [220, 220]);
    const circle = DashboardPage.addBoardShape('circle', [520, 220]);
    const doc = dom.window.document;
    const canvas = doc.getElementById('dashboardBoardCanvas');

    DashboardPage.setBoardTool('rect');
    assert.equal(canvas.dataset.toolFamily, 'shape');
    assert.ok(doc.querySelector('[data-board-current-family="shape"]'));
    assert.ok(doc.querySelector('[data-board-canvas-hint="true"].is-shape'));
    assert.equal(doc.querySelector('[data-board-tool="rect"]')?.getAttribute('aria-pressed'), 'true');
    assert.equal(doc.querySelector('[data-board-tool-family="shape"]')?.dataset.activeFamily, 'true');
    assert.equal(doc.querySelector('[data-board-tool="rect"]')?.dataset.toolLabel, 'Прямокутник');

    DashboardPage.setBoardTool('arrow');
    doc.querySelector(`[data-board-item-id="${rect.id}"]`).dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.w,
        clientY: rect.y + rect.h / 2
    }));
    canvas.dispatchEvent(new dom.window.MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: circle.x,
        clientY: circle.y + circle.h / 2
    }));

    assert.equal(canvas.dataset.toolFamily, 'connect');
    assert.equal(canvas.dataset.connectorDraft, 'true');
    assert.ok(doc.querySelector('[data-board-canvas-hint="true"].is-connect.is-draft'));

    DashboardPage.cancelBoardAction();

    assert.equal(canvas.dataset.connectorDraft, 'false');
    assert.equal(canvas.dataset.activeTool, 'select');
    assert.equal(canvas.dataset.toolFamily, 'navigate');
    assert.equal(doc.querySelector('[data-board-tool="select"]')?.getAttribute('aria-pressed'), 'true');
});
