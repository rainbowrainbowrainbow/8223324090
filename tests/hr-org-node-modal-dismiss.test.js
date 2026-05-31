const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function click(window, target) {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function pointer(window, type, init = {}) {
    const event = new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: init.button ?? 0,
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0
    });
    Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
    return event;
}

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function createHarness() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/hr',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    window.console = console;
    window.showNotification = () => {};
    window.apiVerifyToken = async () => ({ id: 1, role: 'creator', name: 'Tester' });

    const uiCode = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
    const hrCode = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    vm.runInContext(uiCode, dom.getInternalVMContext());

    const originalDocumentAddEventListener = window.document.addEventListener.bind(window.document);
    window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') return;
        return originalDocumentAddEventListener(type, listener, options);
    };
    try {
        vm.runInContext(`${hrCode}
            window.__hrOrgNodeModalTest = {
                setNodes(nodes) {
                    companyStructureNodes = nodes;
                    selectedCompanyStructureNodeId = nodes[0]?.id || null;
                },
                renderCanvas() {
                    document.body.innerHTML = [
                        '<button id="hrOrgAutoLayoutBtn"></button>',
                        '<span id="hrOrgLinkStatus"></span>',
                        '<h4 id="hrOrgDetailTitle"></h4>',
                        '<p id="hrOrgDetailText"></p>',
                        '<button id="hrOrgEditSelectedBtn"></button>',
                        '<textarea id="companyStructureText"></textarea>',
                        '<textarea id="companyStructureNotes"></textarea>',
                        '<textarea id="companyInstructionsText"></textarea>',
                        '<span id="companyStructureStatus"></span>',
                        '<div id="companyOrgChart" class="hr-org-stage"></div>'
                    ].join('');
                    hrFetch = async () => ({ success: true, data: { nodes: companyStructureNodes, updatedAt: '2099-05-31T12:00:00Z' } });
                    initCompanyOrgChart();
                },
                nodes() { return companyStructureNodes; },
                open: openCompanyOrgNodeEditor,
                overlay() { return document.getElementById('hrOrgNodeEditorOverlay'); }
            };
        `, dom.getInternalVMContext());
    } finally {
        window.document.addEventListener = originalDocumentAddEventListener;
    }

    vm.runInContext(`
        window.__confirmCalls = [];
        window.__confirmResult = false;
        confirmModal = async (message, options = {}) => {
            window.__confirmCalls.push({ message, options });
            return window.__confirmResult;
        };
    `, dom.getInternalVMContext());
    window.__hrOrgNodeModalTest.setNodes([{
        id: 'animators',
        title: 'Animators',
        description: 'Run programs.',
        tone: 'purple',
        lane: 'operations',
        parentId: null,
        order: 10,
        stack: null,
        meta: 'programs',
        x: 100,
        y: 100
    }]);
    return { window, api: window.__hrOrgNodeModalTest };
}

test('HR org/profession editor ignores accidental backdrop clicks', () => {
    const { api } = createHarness();
    api.open('animators');
    const overlay = api.overlay();

    assert.ok(overlay, 'editor should open');
    click(overlay.ownerDocument.defaultView, overlay);

    assert.equal(api.overlay(), overlay, 'backdrop click must not close the editor');
    assert.equal(overlay.querySelector('.hr-org-node-modal')?.classList.contains('is-dismiss-attention'), true);
});

test('HR org/profession editor closes through explicit cancel when clean', async () => {
    const { window, api } = createHarness();
    api.open('animators');

    click(window, window.document.getElementById('hrOrgNodeEditorCancel'));
    await settle();

    assert.equal(api.overlay(), null);
    assert.equal(window.__confirmCalls.length, 0);
});

test('HR org/profession editor routes dirty explicit close through discard guard', async () => {
    const { window, api } = createHarness();
    api.open('animators');
    const input = window.document.querySelector('#hrOrgNodeForm input[name="title"]');
    input.value = 'Updated role';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    click(window, window.document.getElementById('hrOrgNodeEditorClose'));
    await settle();

    assert.ok(api.overlay(), 'dirty editor should remain open when discard is rejected');
    assert.equal(window.__confirmCalls.length, 1);

    window.__confirmResult = true;
    click(window, window.document.getElementById('hrOrgNodeEditorClose'));
    await settle();

    assert.equal(api.overlay(), null);
    assert.equal(window.__confirmCalls.length, 2);
});

test('HR org/profession editor exposes relation and grid position controls', () => {
    const { window, api } = createHarness();
    api.open('animators');
    const form = window.document.getElementById('hrOrgNodeForm');

    assert.ok(form.querySelector('.hr-org-node-editor-summary')?.textContent.includes('ID:'));
    assert.equal(form.querySelector('input[name="x"]')?.value, '100');
    assert.equal(form.querySelector('input[name="y"]')?.value, '100');
    assert.ok(form.querySelector('select[name="parentId"]'));
});

test('HR org canvas creates visible parent links directly through node ports', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: null, order: 1, stack: null, meta: 'child', x: 90, y: 120 },
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 }
    ]);
    api.renderCanvas();

    assert.equal(window.document.querySelectorAll('.hr-org-port--child').length, 2);
    assert.equal(window.document.querySelectorAll('.hr-org-port--parent').length, 2);
    assert.equal(window.document.querySelectorAll('[data-org-link-parent-port]').length, 2);
    assert.equal(window.document.querySelectorAll('[data-org-link-child-port]').length, 2);

    click(window, window.document.querySelector('[data-org-link-parent-port="parent"]'));
    assert.equal(window.document.getElementById('companyOrgChart').classList.contains('is-linking'), true);
    assert.ok(window.document.querySelector('.hr-org-link-preview'));
    click(window, window.document.querySelector('[data-org-link-child-port="child"]'));
    await settle();

    assert.equal(api.nodes().find(node => node.id === 'child').parentId, 'parent');
    assert.ok(window.document.querySelector('.hr-org-link-group[data-org-link-child="child"] .hr-org-link-hit'));
});

test('HR org canvas does not create links from card clicks while relinking is active', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: null, order: 1, stack: null, meta: 'child', x: 90, y: 120 },
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 }
    ]);
    api.renderCanvas();

    click(window, window.document.querySelector('[data-org-link-child-port="child"]'));
    click(window, window.document.querySelector('[data-org-node-id="parent"]'));
    await settle();

    assert.equal(api.nodes().find(node => node.id === 'child').parentId, null);
    assert.equal(window.document.getElementById('companyOrgChart').classList.contains('is-linking'), true);
});

test('HR org canvas drag cancels sticky relink mode and persists the moved node position', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: null, order: 1, stack: null, meta: 'child', x: 90, y: 120 },
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 }
    ]);
    api.renderCanvas();

    click(window, window.document.querySelector('[data-org-link-child-port="child"]'));
    assert.equal(window.document.getElementById('companyOrgChart').classList.contains('is-linking'), true);

    const node = window.document.querySelector('[data-org-node-id="parent"]');
    node.dispatchEvent(pointer(window, 'pointerdown', { pointerId: 8, clientX: 100, clientY: 100 }));
    window.dispatchEvent(pointer(window, 'pointermove', { pointerId: 8, clientX: 160, clientY: 130 }));
    window.dispatchEvent(pointer(window, 'pointerup', { pointerId: 8, clientX: 160, clientY: 130 }));
    await settle();

    const moved = api.nodes().find(item => item.id === 'parent');
    assert.equal(window.document.getElementById('companyOrgChart').classList.contains('is-linking'), false);
    assert.equal(moved.x, 390);
    assert.equal(moved.y, 60);
});

test('HR org auto-arrange spreads cards instead of stacking roles on top of each other', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'director', title: 'Director', description: 'Root.', tone: 'gold', lane: 'root', parentId: null, order: 1, stack: null, meta: 'root', x: 0, y: 0 },
        { id: 'admin', title: 'Admin', description: 'Admin.', tone: 'purple', lane: 'operations', parentId: 'director', order: 2, stack: null, meta: 'admin', x: 0, y: 0 },
        { id: 'bar', title: 'Bar', description: 'Bar.', tone: 'violet', lane: 'support', parentId: 'director', order: 3, stack: null, meta: 'bar', x: 0, y: 0 },
        { id: 'hr', title: 'HR', description: 'HR.', tone: 'blue', lane: 'leadership', parentId: 'director', order: 4, stack: null, meta: 'people', x: 0, y: 0 }
    ]);
    api.renderCanvas();

    click(window, window.document.getElementById('hrOrgAutoLayoutBtn'));
    await settle();

    const positions = api.nodes().map(node => `${node.x}:${node.y}`);
    assert.equal(new Set(positions).size, positions.length);
    assert.ok(api.nodes().every(node => Number(node.x) >= 0 && Number(node.y) >= 0));
});
