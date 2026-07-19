const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function click(window, target) {
    assert.ok(target, 'target exists');
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function key(window, target, value) {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
}

function createHarness({ editable = true, mobile = false } = {}) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/hr#structure',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    window.console = console;
    window.__canManageStructure = editable;
    window.__hrOrgMobile = mobile;
    window.canAccess = action => action === 'manage_staff' && window.__canManageStructure;
    window.showNotification = () => {};
    window.apiVerifyToken = async () => ({ id: 1, role: 'creator', name: 'Tester' });
    window.openProfessionWorkspace = options => {
        window.__lastProfessionWorkspace = options;
        return options;
    };
    window.openStaffEdit = id => {
        window.__lastStaffEdit = Number(id);
        return id;
    };
    window.matchMedia = query => ({
        matches: query.includes('820px') ? window.__hrOrgMobile : false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {}
    });
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(options = {}) {
        this.dataset.scrollBlock = String(options.block || '');
    };

    const uiCode = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
    const hrCode = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    vm.runInContext(uiCode, dom.getInternalVMContext());

    const originalDocumentAddEventListener = window.document.addEventListener.bind(window.document);
    window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') return undefined;
        return originalDocumentAddEventListener(type, listener, options);
    };

    vm.runInContext(`${hrCode}
        window.__hrOrgTreeRegression = {
            setup({ nodes, professions = [], staff = [], editable = true, mobile = false } = {}) {
                window.__canManageStructure = Boolean(editable);
                window.__hrOrgMobile = Boolean(mobile);
                document.body.innerHTML = [
                    '<section id="tab-structure">',
                    '<div class="hr-org-tools">',
                    '<input id="hrOrgSearch">',
                    '<select id="hrOrgArchiveFilter"><option value="active" selected>Active</option><option value="archived">Archived</option><option value="all">All</option></select>',
                    '<button id="hrOrgViewChart"></button>',
                    '<button id="hrOrgViewTree"></button>',
                    '<button id="hrOrgFitBtn"></button>',
                    '<button id="hrOrgZoomOut"></button>',
                    '<output id="hrOrgZoomValue"></output>',
                    '<button id="hrOrgZoomIn"></button>',
                    '<button id="hrOrgUndoBtn"></button>',
                    '<button id="hrOrgRedoBtn"></button>',
                    '<span id="companyStructureStatus"></span>',
                    '<button id="btnSaveCompanyStructure"></button>',
                    '</div>',
                    '<div class="hr-org-main">',
                    '<div id="companyOrgCanvas" class="hr-org-canvas"><div id="companyOrgChart" class="hr-org-stage"></div></div>',
                    '<div id="companyOrgTree" class="hr-org-tree hidden" role="tree"></div>',
                    '</div>',
                    '<aside id="hrOrgInspector" class="hr-org-detail" aria-label="Інспектор вузла" aria-labelledby="hrOrgDetailTitle">',
                    '<button id="hrOrgInspectorClose"></button>',
                    '<h4 id="hrOrgDetailTitle" tabindex="-1"></h4>',
                    '<div id="hrOrgDetailType"></div>',
                    '<p id="hrOrgDetailText"></p>',
                    '<div id="hrOrgDetailParent"></div>',
                    '<select id="hrOrgInspectorParent"></select>',
                    '<div id="hrOrgDetailProfessions"></div>',
                    '<div id="hrOrgDetailStaff"></div>',
                    '<div id="hrOrgInspectorActions">',
                    '<button id="hrOrgAddChildBtn"></button>',
                    '<button id="hrOrgAddSiblingBtn"></button>',
                    '<button id="hrOrgAddProfessionBtn"></button>',
                    '<button id="hrOrgEditSelectedBtn"></button>',
                    '<button id="hrOrgDuplicateBtn"></button>',
                    '<button id="hrOrgArchiveBtn"></button>',
                    '<button id="hrOrgAutoLayoutBtn"></button>',
                    '</div>',
                    '<details id="hrOrgSystemInfo"><summary>System</summary><dl id="hrOrgDetailMeta"></dl></details>',
                    '</aside>',
                    '<textarea id="companyStructureText"></textarea>',
                    '<textarea id="companyStructureNotes"></textarea>',
                    '<textarea id="companyInstructionsText"></textarea>',
                    '<div id="companyStructureRecovery" class="hidden">',
                    '<p id="companyStructureRecoveryMessage"></p>',
                    '<button id="btnRetryCompanyStructure" class="hidden"></button>',
                    '<button id="btnApplyCompanyStructureTemplate" class="hidden"></button>',
                    '<button id="btnReloadCompanyStructureConflict" class="hidden"></button>',
                    '<button id="btnCopyCompanyStructureDraft" class="hidden"></button>',
                    '</div>',
                    '<div class="hr-org-notes"></div>',
                    '<span id="companyStructureModeBadge"></span>',
                    '<span id="hrOrgLinkStatus"></span>',
                    '</section>'
                ].join('');
                hrProfessions = professions;
                teamStaff = staff;
                companyStructureNodes = normalizeCompanyStructureNodes(nodes || [
                    { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 },
                    { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
                ]);
                selectedCompanyStructureNodeId = companyStructureNodes[0]?.id || null;
                companyStructureLoaded = true;
                companyStructureHasSavedData = companyStructureNodes.length > 0;
                companyStructureLoadState = companyStructureNodes.length ? 'ready' : 'empty';
                companyStructureSaveState = 'clean';
                companyStructureDraftRevision = 0;
                companyStructureSavedRevision = 0;
                companyStructureUpdatedAt = companyStructureNodes.length ? '2099-05-31T12:00:00Z' : null;
                companyStructurePermissionDenied = false;
                resetCompanyOrgHistory();
                resetCompanyOrgViewState();
                bindCompanyStructureEditorControls();
                document.getElementById('btnSaveCompanyStructure').onclick = saveCompanyStructure;
                document.getElementById('hrOrgAutoLayoutBtn').onclick = autoArrangeCompanyOrgChart;
                renderCompanyOrgWorkspace();
                selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
                recordCompanyStructureSavedBaseline();
            },
            setEditable(value) {
                window.__canManageStructure = Boolean(value);
                renderCompanyOrgWorkspace();
                selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
            },
            setView(mode) { setCompanyOrgViewMode(mode, { focus: false }); },
            search(value) {
                companyOrgSearchQuery = value || '';
                reconcileCompanyOrgSearchSelection();
                renderCompanyOrgWorkspace();
                selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
            },
            archiveFilter(value) {
                companyOrgArchiveFilter = normalizeCompanyOrgArchiveFilter(value);
                const select = document.getElementById('hrOrgArchiveFilter');
                if (select) select.value = companyOrgArchiveFilter;
                reconcileCompanyOrgSearchSelection();
                renderCompanyOrgWorkspace();
                selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
            },
            add(options) { return addCompanyStructureNode(options); },
            undo() { return undoCompanyStructureDraft(); },
            payload() { return companyStructureDraftPayload(); },
            nodes() { return companyStructureNodes; },
            state() {
                return {
                    draftRevision: companyStructureDraftRevision,
                    saveState: companyStructureSaveState,
                    hasChanges: companyStructureHasUnsavedChanges()
                };
            }
        };
    `, dom.getInternalVMContext());

    return { window, api: window.__hrOrgTreeRegression };
}

test('tree collapse does not dirty state or enter structure payload', () => {
    const { window, api } = createHarness();
    api.setup({
        nodes: [
            { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40, collapsed: true },
            { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
        ]
    });
    api.setView('tree');

    const before = api.state();
    assert.ok(window.document.querySelector('[data-org-tree-select="child"]'), 'legacy collapsed flag must not hide children');
    click(window, window.document.querySelector('[data-org-tree-toggle="parent"]'));

    assert.equal(api.state().draftRevision, before.draftRevision);
    assert.equal(api.state().saveState, 'clean');
    assert.equal(api.state().hasChanges, false);
    assert.equal(api.payload().nodes.some(node => Object.prototype.hasOwnProperty.call(node, 'collapsed')), false);
    assert.equal(window.document.querySelector('[data-org-tree-select="child"]'), null);
});

test('tree collapse remains available for read-only users', () => {
    const { window, api } = createHarness({ editable: false });
    api.setup({ editable: false });
    api.setView('tree');

    click(window, window.document.querySelector('[data-org-tree-toggle="parent"]'));

    assert.equal(window.document.querySelector('[data-org-tree-select="child"]'), null);
    assert.equal(window.document.querySelector('[data-org-tree-add="parent"]'), null);
    assert.equal(api.state().saveState, 'clean');
});

test('undo back to saved revision clears dirty state and disables save', () => {
    const { window, api } = createHarness();
    api.setup();

    const added = api.add({ relation: 'child', sourceId: 'parent', title: 'Temporary node' });
    assert.equal(added.parentId, 'parent');
    assert.equal(api.state().saveState, 'changed');

    assert.equal(api.undo(), true);
    assert.equal(api.nodes().some(node => node.title === 'Temporary node'), false);
    assert.equal(api.state().saveState, 'saved');
    assert.equal(api.state().hasChanges, false);
    assert.equal(window.document.getElementById('btnSaveCompanyStructure').disabled, true);
});

test('tree quick actions open child add modal and node action menu', () => {
    const { window, api } = createHarness();
    api.setup();
    api.setView('tree');

    click(window, window.document.querySelector('[data-org-tree-add="parent"]'));
    assert.ok(window.document.querySelector('.form-modal-overlay'), 'plus opens add child modal');
    assert.equal(window.document.querySelector('[data-org-tree-add-menu="parent"]'), null);
    window.document.querySelector('.form-modal-overlay')?.remove();

    click(window, window.document.querySelector('[data-org-tree-more="parent"]'));
    const menu = window.document.querySelector('[data-org-tree-more-menu="parent"]');
    assert.ok(menu);
    assert.equal(menu.classList.contains('hidden'), false);
    assert.match(menu.textContent, /Перейменувати/);
});

test('search selects a visible match and does not leave inspector on a hidden node', () => {
    const { window, api } = createHarness();
    api.setup({
        staff: [{ id: 7, name: 'Needle Staff', company_structure_node_id: 'child' }]
    });
    api.setView('tree');

    api.search('Needle Staff');

    const child = window.document.querySelector('[data-org-tree-select="child"]');
    assert.ok(child);
    assert.equal(child.getAttribute('aria-selected'), 'true');
    assert.ok(child.classList.contains('is-search-match'));
    assert.equal(window.document.getElementById('hrOrgDetailTitle').textContent, 'Child');
    assert.equal(window.document.querySelector('[data-org-tree-select="parent"]').getAttribute('aria-selected'), 'false');
});

test('archived filter exposes archived nodes without hiding active descendants behind archived parents', () => {
    const { window, api } = createHarness();
    api.setup({
        nodes: [
            { id: 'archived-parent', title: 'Archived Parent', description: 'Parent.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40, archived: true },
            { id: 'active-child', title: 'Active Child', description: 'Child.', tone: 'blue', lane: 'leadership', parentId: 'archived-parent', order: 2, x: 100, y: 180 }
        ]
    });
    api.setView('tree');

    assert.ok(window.document.querySelector('[data-org-tree-select="archived-parent"]'));
    assert.ok(window.document.querySelector('[data-org-tree-select="active-child"]'));
    assert.ok(window.document.querySelector('[data-org-tree-row="archived-parent"]').classList.contains('is-archived'));

    api.archiveFilter('archived');
    assert.ok(window.document.querySelector('[data-org-tree-select="archived-parent"]'));
    assert.equal(window.document.querySelector('[data-org-tree-select="active-child"]'), null);
});

test('tree keyboard navigation updates focus and ARIA selected state', () => {
    const { window, api } = createHarness();
    api.setup();
    api.setView('tree');

    const parent = window.document.querySelector('[data-org-tree-select="parent"]');
    parent.focus();
    key(window, parent, 'ArrowDown');
    assert.equal(window.document.activeElement.dataset.orgTreeSelect, 'child');

    key(window, window.document.activeElement, 'ArrowUp');
    assert.equal(window.document.activeElement.dataset.orgTreeSelect, 'parent');

    key(window, window.document.activeElement, 'ArrowRight');
    assert.equal(window.document.activeElement.dataset.orgTreeSelect, 'child');

    key(window, window.document.activeElement, 'Home');
    assert.equal(window.document.activeElement.dataset.orgTreeSelect, 'parent');

    key(window, window.document.activeElement, 'End');
    assert.equal(window.document.activeElement.dataset.orgTreeSelect, 'child');

    key(window, window.document.activeElement, 'Enter');
    assert.equal(window.document.querySelector('[data-org-tree-select="child"]').getAttribute('aria-selected'), 'true');
    assert.equal(window.document.querySelector('[data-org-tree-select="parent"]').tabIndex, -1);
});
