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

test('HR org canvas renders every saved relation instead of hiding unfocused branches', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 1, stack: null, meta: 'child', x: 90, y: 120 },
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 },
        { id: 'other_child', title: 'Other child', description: 'Other child role.', tone: 'purple', lane: 'operations', parentId: 'other_parent', order: 3, stack: null, meta: 'ops', x: 90, y: 360 },
        { id: 'other_parent', title: 'Other parent', description: 'Other parent role.', tone: 'violet', lane: 'support', parentId: null, order: 4, stack: null, meta: 'support', x: 330, y: 300 }
    ]);
    api.renderCanvas();

    assert.ok(window.document.querySelector('.hr-org-link-group[data-org-link-child="child"]'));
    assert.ok(window.document.querySelector('.hr-org-link-group[data-org-link-child="other_child"]'));
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

test('HR org canvas lets the same port click cancel pending link mode', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: null, order: 1, stack: null, meta: 'child', x: 90, y: 120 },
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 }
    ]);
    api.renderCanvas();

    const port = window.document.querySelector('[data-org-link-parent-port="parent"]');
    click(window, port);
    assert.equal(window.document.getElementById('companyOrgChart').classList.contains('is-linking'), true);
    click(window, port);
    await settle();

    assert.equal(window.document.getElementById('companyOrgChart').classList.contains('is-linking'), false);
    assert.equal(api.nodes().find(node => node.id === 'child').parentId, null);
});

test('HR staff edit modal uses the shared modal layer and viewport-safe scrolling', () => {
    const html = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const overlayCss = html.match(/\.hr-modal-overlay\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const dialogCss = html.match(/\.hr-modal\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const showModalFn = js.slice(js.indexOf('function showHrEditableModal'), js.indexOf('async function closeHrEditableModal'));

    assert.match(overlayCss, /z-index:\s*var\(--z-modal,\s*30000\)/);
    assert.match(overlayCss, /overflow:\s*hidden/);
    assert.match(dialogCss, /max-height:\s*calc\(100dvh - 32px\)/);
    assert.match(dialogCss, /overflow-y:\s*auto/);
    assert.match(html, /id="staffEditModal"[^>]*class="hr-modal-overlay"[\s\S]*?<div class="hr-modal hr-staff-profile-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
    assert.match(html, /\.hr-staff-profile-modal\s*\{[\s\S]*?max-width:\s*640px/);
    assert.match(showModalFn, /modal\.setAttribute\('aria-hidden', 'false'\)/);
    assert.match(showModalFn, /modal\.scrollTop = 0/);
    assert.match(showModalFn, /dialog\.scrollTop = 0/);
});

test('HR staff update route persists every staff edit form field explicitly', () => {
    const source = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
    const start = source.indexOf("router.put('/staff/:id'");
    const end = source.indexOf("// PUT /api/hr/staff/:id/status", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const route = source.slice(start, end);
    const expectedFields = [
        'phone',
        'emergency_contact',
        'emergency_phone',
        'role_type',
        'hourly_rate',
        'birth_date',
        'notes',
        'telegram_id',
        'telegram_username',
        'contract_type',
        'skills',
        'address',
        'hr_pool_status',
        'blacklist_reason'
    ];

    for (const field of expectedFields) {
        assert.match(route, new RegExp(`${field}: hasBodyField\\('${field}'\\)`));
    }
    for (const field of expectedFields.filter(field => field !== 'blacklist_reason')) {
        assert.match(route, new RegExp(`queueStaffUpdate\\('${field}'`));
    }
    assert.match(route, /queueStaffUpdate\('blacklist_reason'/);
    assert.match(route, /blacklist_reason = NULL/);
    assert.match(route, /blacklisted_at = COALESCE\(blacklisted_at, NOW\(\)\)/);
    assert.match(route, /::text\[\]/);
    assert.match(route, /::jsonb/);
    assert.doesNotMatch(route, /COALESCE\(\$\d+,\s*(phone|emergency_contact|emergency_phone|hourly_rate|birth_date|notes|telegram_id|telegram_username|contract_type|skills|address|hr_pool_status)\)/);
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

    const rects = api.nodes().map(node => ({
        id: node.id,
        x: Number(node.x),
        y: Number(node.y),
        width: node.tone === 'gold' ? 220 : 168,
        height: node.tone === 'gold' ? 128 : 108
    }));
    rects.forEach((a, index) => {
        rects.slice(index + 1).forEach(b => {
            const overlap = a.x < b.x + b.width + 24
                && a.x + a.width + 24 > b.x
                && a.y < b.y + b.height + 24
                && a.y + a.height + 24 > b.y;
            assert.equal(overlap, false, `${a.id} should not overlap ${b.id}`);
        });
    });
});

test('HR org auto-arrange infers the default company tree and lays it out top-down', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'director', title: 'Director', description: 'Root.', tone: 'gold', lane: 'root', parentId: null, order: 1, stack: null, meta: 'root', x: 0, y: 0 },
        { id: 'deputy_director', title: 'Deputy', description: 'Deputy.', tone: 'blue', lane: 'deputy', parentId: null, order: 2, stack: null, meta: 'ops', x: 0, y: 0 },
        { id: 'art_director', title: 'Art director', description: 'Art.', tone: 'purple', lane: 'leadership', parentId: null, order: 3, stack: 'art', meta: 'art', x: 0, y: 0 },
        { id: 'animators', title: 'Animators', description: 'Programs.', tone: 'purple', lane: 'operations', parentId: null, order: 4, stack: null, meta: 'programs', x: 0, y: 0 },
        { id: 'admins', title: 'Admins', description: 'Hall.', tone: 'purple', lane: 'leadership', parentId: null, order: 5, stack: 'art', meta: 'hall', x: 0, y: 0 },
        { id: 'barista', title: 'Barista', description: 'Bar.', tone: 'purple', lane: 'operations', parentId: null, order: 6, stack: null, meta: 'bar', x: 0, y: 0 },
        { id: 'chef', title: 'Chef', description: 'Kitchen.', tone: 'violet', lane: 'support', parentId: null, order: 7, stack: 'kitchen', meta: 'kitchen', x: 0, y: 0 },
        { id: 'cooks', title: 'Cooks', description: 'Kitchen team.', tone: 'violet', lane: 'support', parentId: null, order: 8, stack: 'kitchen', meta: 'production', x: 0, y: 0 }
    ]);
    api.renderCanvas();

    click(window, window.document.getElementById('hrOrgAutoLayoutBtn'));
    await settle();

    const byId = new Map(api.nodes().map(node => [node.id, node]));
    assert.equal(byId.get('deputy_director').parentId, 'director');
    assert.equal(byId.get('art_director').parentId, 'deputy_director');
    assert.equal(byId.get('animators').parentId, 'art_director');
    assert.equal(byId.get('admins').parentId, 'art_director');
    assert.equal(byId.get('barista').parentId, 'admins');
    assert.equal(byId.get('chef').parentId, 'deputy_director');
    assert.equal(byId.get('cooks').parentId, 'chef');

    assert.ok(Number(byId.get('director').y) < Number(byId.get('deputy_director').y));
    assert.ok(Number(byId.get('deputy_director').y) < Number(byId.get('art_director').y));
    assert.ok(Number(byId.get('art_director').y) < Number(byId.get('animators').y));
    assert.ok(window.document.querySelector('.hr-org-link-group[data-org-link-child="animators"]'));
    assert.ok(window.document.querySelector('.hr-org-link-group[data-org-link-child="cooks"]'));
});
