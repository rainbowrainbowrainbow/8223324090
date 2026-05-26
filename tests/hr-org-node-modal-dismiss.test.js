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
