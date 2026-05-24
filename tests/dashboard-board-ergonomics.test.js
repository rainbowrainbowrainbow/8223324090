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
    assert.match(pageJs, /data-board-line-endpoint="start"/);
    assert.match(pageJs, /function beginBoardLineEndpointDrag/);
    assert.match(pageJs, /function beginBoardConnectorEndpointDrag/);
    assert.match(pageJs, /function findNearestBoardAnchor/);
    assert.match(pageJs, /if \(item\.type === 'widget' \|\| item\.type === 'note' \|\| item\.type === 'text'\) return false/);
    assert.match(css, /\.dashboard-board-shell\.is-panning/);
    assert.match(css, /\.dashboard-board-item\.thin-geometry/);
    assert.match(css, /\.board-line-endpoint/);
    assert.match(css, /\.board-connector-endpoint/);
    assert.match(css, /box-shadow: 0 0 0 1px var\(--workspace-selection-ring/);
});

function loadDashboardHarness() {
    const pageJs = read('js/dashboard-page.js');
    const dom = new JSDOM(`<!doctype html>
        <main>
            <div id="dashboardGrid"></div>
            <section id="dashboardBoardShell" class="dashboard-board-shell">
                <div id="dashboardBoardCanvas" class="dashboard-board-canvas"></div>
            </section>
            <div id="dashboardBoardToolbar"></div>
            <div class="dashboard-workspace-stage"></div>
            <div id="boardEditControls"></div>
            <div id="boardToolOptions"></div>
            <button id="dashboardBoardModeBtn"></button>
            <button id="boardViewModeBtn"></button>
            <button id="boardEditModeBtn"></button>
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
        DashboardPage: vm.runInContext('DashboardPage', dom.getInternalVMContext())
    };
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
    doc.dispatchEvent(new dom.window.MouseEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + 90,
        clientY: rect.y + 50
    }));

    const after = connectorPath();

    assert.notEqual(before, '');
    assert.notEqual(after, '');
    assert.notEqual(after, before);
});
