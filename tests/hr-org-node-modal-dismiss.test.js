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
    window.__canManageStructure = true;
    window.__hrOrgMobile = false;
    window.matchMedia = query => ({
        matches: query.includes('820px') ? window.__hrOrgMobile : false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {}
    });
    window.canAccess = action => action === 'manage_staff' && window.__canManageStructure;

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
                setEditable(editable) {
                    window.__canManageStructure = Boolean(editable);
                    renderCompanyOrgWorkspace();
                },
                setMobile(mobile) {
                    window.__hrOrgMobile = Boolean(mobile);
                    bindCompanyOrgResponsiveState();
                    setCompanyOrgInspectorOpen(document.getElementById('hrOrgInspector')?.classList.contains('is-mobile-open'));
                },
                setFetch(handler) { hrFetch = handler; },
                load(options = {}) { return loadCompanyStructure(options); },
                save(options = {}) { return saveCompanyStructure(options); },
                applyTemplate() { return applyDefaultCompanyStructureTemplate(); },
                changeNotes(value) {
                    document.getElementById('companyStructureNotes').value = value;
                    return markCompanyStructureChanged();
                },
                patchNode(id, patch) {
                    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes.map(node => (
                        node.id === id ? { ...node, ...patch } : node
                    )));
                    markCompanyStructureChanged();
                    renderCompanyOrgWorkspace();
                },
                setProfessions(items) { hrProfessions = items; },
                setStaff(items) { teamStaff = items; },
                add(options) { return addCompanyStructureNode(options); },
                duplicate(id) { return duplicateCompanyStructureNode(id); },
                reparent(id, parentId) { return reparentCompanyStructureNode(id, parentId); },
                wouldCycle(id, parentId) { return companyOrgWouldCreateCycle(id, parentId); },
                impact(id) { return companyOrgNodeImpact(id); },
                archive(id) { return requestArchiveCompanyStructureNode(id); },
                undo() { return undoCompanyStructureDraft(); },
                redo() { return redoCompanyStructureDraft(); },
                resetHistory() { resetCompanyOrgHistory(); },
                fit() { return fitCompanyOrgToScreen(); },
                setView(mode) { setCompanyOrgViewMode(mode, { focus: false }); return companyOrgViewMode; },
                search(value) {
                    companyOrgSearchQuery = value || '';
                    reconcileCompanyOrgSearchSelection();
                    renderCompanyOrgWorkspace();
                    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
                },
                setArchiveFilter(value) {
                    companyOrgArchiveFilter = normalizeCompanyOrgArchiveFilter(value);
                    const filter = document.getElementById('hrOrgArchiveFilter');
                    if (filter) filter.value = companyOrgArchiveFilter;
                    reconcileCompanyOrgSearchSelection();
                    renderCompanyOrgWorkspace();
                    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
                },
                payload() { return companyStructureDraftPayload(); },
                state() {
                    return {
                        loaded: companyStructureLoaded,
                        loadState: companyStructureLoadState,
                        saveState: companyStructureSaveState,
                        hasSavedData: companyStructureHasSavedData,
                        updatedAt: companyStructureUpdatedAt,
                        draftRevision: companyStructureDraftRevision,
                        savedRevision: companyStructureSavedRevision,
                        conflict: companyStructureConflictCurrent
                    };
                },
                renderCanvas() {
                    document.body.innerHTML = [
                        '<section id="tab-structure">',
                        '<span id="companyStructureModeBadge"></span>',
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
                        '<span id="hrOrgLinkStatus"></span>',
                        '<div class="hr-org-tools"></div>',
                        '<div class="hr-org-main">',
                        '<div id="companyOrgCanvas" class="hr-org-canvas"><div id="companyOrgChart" class="hr-org-stage"></div></div>',
                        '<div id="companyOrgTree" class="hr-org-tree hidden" role="tree"></div>',
                        '</div>',
                        '<aside id="hrOrgInspector" class="hr-org-detail" aria-labelledby="hrOrgDetailTitle">',
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
                        '<span id="companyStructureStatus"></span>',
                        '<button id="btnSaveCompanyStructure"></button>',
                        '<div id="companyStructureRecovery" class="hidden">',
                        '<p id="companyStructureRecoveryMessage"></p>',
                        '<button id="btnRetryCompanyStructure" class="hidden"></button>',
                        '<button id="btnApplyCompanyStructureTemplate" class="hidden"></button>',
                        '<button id="btnReloadCompanyStructureConflict" class="hidden"></button>',
                        '<button id="btnCopyCompanyStructureDraft" class="hidden"></button>',
                        '</div>',
                        '<div class="hr-org-notes"></div>',
                        '</section>'
                    ].join('');
                    hrFetch = async () => ({ success: true, data: { nodes: companyStructureNodes, updatedAt: '2099-05-31T12:00:00Z' } });
                    companyStructureLoaded = true;
                    companyStructureHasSavedData = companyStructureNodes.length > 0;
                    companyStructureLoadState = companyStructureNodes.length ? 'ready' : 'empty';
                    companyStructureSaveState = 'clean';
                    companyStructureLoadError = '';
                    companyStructureSaveError = '';
                    companyStructureConflictCurrent = null;
                    companyStructureDraftRevision = 0;
                    companyStructureSavedRevision = 0;
                    companyStructureUpdatedAt = companyStructureNodes.length ? '2099-05-31T12:00:00Z' : null;
                    companyStructurePermissionDenied = false;
                    resetCompanyOrgHistory();
                    resetCompanyOrgViewState();
                    bindCompanyStructureEditorControls();
                    document.getElementById('hrOrgAutoLayoutBtn').onclick = autoArrangeCompanyOrgChart;
                    document.getElementById('btnSaveCompanyStructure').onclick = saveCompanyStructure;
                    renderCompanyOrgWorkspace();
                    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
                    recordCompanyStructureSavedBaseline();
                },
                nodes() { return companyStructureNodes; },
                open: openCompanyOrgNodeEditor,
                overlay() { return document.getElementById('hrOrgNodeEditorOverlay'); }
            };
            window.__hrProfessionWorkspaceTest = {
                parse(hash) { return parseProfessionWorkspaceLocation(hash); },
                hash(key, tab) { return professionWorkspaceHash(key, tab); },
                normalizeTab(tab) { return normalizeProfessionWorkspaceTab(tab); },
                setReady(key, tab = 'main') {
                    professionWorkspaceState = {
                        open: true,
                        loadState: 'ready',
                        data: { profession: { id: 1, key, title: key, source: 'db', isActive: true } },
                        tab: normalizeProfessionWorkspaceTab(tab),
                        isNew: false,
                        returnContext: { tab: 'professions' },
                        error: ''
                    };
                    history.replaceState({ professionWorkspace: true }, '', professionWorkspaceHash(key, tab));
                },
                setTab(tab) { setProfessionWorkspaceTab(tab); },
                state() { return { ...professionWorkspaceState }; }
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
    window.__hrOrgNodeModalTest.renderCanvas();
    return { window, api: window.__hrOrgNodeModalTest };
}

function createStaffProfileHarness() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/hr#team',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get() {
            return this.hidden || this.style?.display === 'none' ? null : this.ownerDocument.body;
        }
    });
    window.console = console;
    window.showNotification = () => {};
    window.apiVerifyToken = async () => ({ id: 1, role: 'creator', name: 'Tester' });
    window.requestAnimationFrame = callback => callback();

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
            window.__hrStaffProfileTest = (() => {
                const historyDefers = new Map();
                const staffProfiles = new Map([
                    [1, { id: 1, name: 'Cached One', role_type: 'animator', secondary_professions: [], phone: 'old-1', hourly_rate: 100, rate_unit: 'hour', skills: [] }],
                    [2, { id: 2, name: 'Cached Two', role_type: 'instructor', secondary_professions: [], phone: 'old-2', hourly_rate: 120, rate_unit: 'hour', skills: [] }],
                    [3, { id: 3, name: 'Cached Three', role_type: 'animator', secondary_professions: [], phone: 'old-3', hourly_rate: 130, rate_unit: 'hour', skills: [] }]
                ]);

                function setupDom() {
                    document.body.innerHTML = [
                        '<button id="staffTrigger" data-staff-id="1">trigger</button>',
                        '<article class="hr-team-card" data-staff-id="1"><button class="hr-team-open">profile 1</button></article>',
                        '<article class="hr-team-card" data-staff-id="2"><button class="hr-team-open">profile 2</button></article>',
                        '<div id="staffEditModal" class="hr-modal-overlay" style="display:none;" aria-hidden="true">',
                        '<div class="hr-modal hr-staff-profile-modal" role="dialog" aria-modal="true" aria-labelledby="editStaffHeaderName">',
                        '<input type="hidden" id="editStaffId">',
                        '<button type="button" id="editCloseTop" class="hr-staff-profile-close" aria-label="Close staff profile"><span aria-hidden="true">✕</span></button>',
                        '<strong id="editStaffHeaderName"></strong>',
                        '<input id="editStaffName">',
                        '<input id="editPhone">',
                        '<input id="editPhotoUrl">',
                        '<div id="editPhotoPreview"></div>',
                        '<input id="editBirthDate">',
                        '<input id="editAddress">',
                        '<input id="editEmergencyContact">',
                        '<input id="editEmergencyPhone">',
                        '<select id="editRoleType"></select>',
                        '<select id="editSecondaryProfessions" multiple></select>',
                        '<input id="editSecondaryProfessionSearch">',
                        '<div id="editProfessionRates"></div>',
                        '<select id="editCompanyStructureNode"></select>',
                        '<input id="editHourlyRate">',
                        '<select id="editRateUnit"><option value="hour">hour</option><option value="day">day</option><option value="month">month</option></select>',
                        '<span id="editHourlyRateLabel"></span><span id="editHourlyRateHint"></span>',
                        '<input id="editTelegramId">',
                        '<input id="editTelegramUsername">',
                        '<select id="editContractType"><option value="parttime">parttime</option></select>',
                        '<input id="editSkills">',
                        '<textarea id="editNotes"></textarea>',
                        '<input id="editDocumentTitle"><textarea id="editDocumentNotes"></textarea><input id="editDocumentFile" type="file"><select id="editDocumentType"><option value="other">other</option></select>',
                        '<input id="editMedicalIssuedAt"><input id="editMedicalExpiresAt"><textarea id="editMedicalNotes"></textarea>',
                        '<select id="editResourceKind"><option value="custom">custom</option></select><select id="editResourceSourceId"></select><div id="editResourceSourceHint"></div><div id="editResourceSourceGroup"></div><div id="editResourceTitleGroup"></div><input id="editResourceTitle"><input id="editResourceDueReturnAt"><textarea id="editResourceNotes"></textarea><input id="editResourceQuantity">',
                        '<select id="editPayrollSchemeType"><option value="hourly">hourly</option><option value="per_shift">per_shift</option><option value="monthly_fixed">monthly_fixed</option><option value="hybrid">hybrid</option></select><input id="editPayrollSchemeAmount"><input id="editPayrollSchemeTitle"><input id="editPayrollSchemeEffectiveFrom"><input id="editPayrollSchemeEffectiveTo"><span id="editPayrollSchemeSummary"></span><span id="editPayrollSchemeAmountLabel"></span><div id="editPayrollHybridConfig"></div>',
                        '<input id="editOffboardingDate"><select id="editOffboardingPoolStatus"><option value="reserve">reserve</option></select><select id="editOffboardingAccountAction"><option value="review">review</option></select><textarea id="editOffboardingReason"></textarea><textarea id="editOffboardingNotes"></textarea>',
                        '<div id="editStaffHistory"></div><div id="editStaffLifecycleChecklist"></div><div id="editStaffDocuments"></div><div id="editMedicalBookList"></div><div id="editStaffResources"></div><div id="editStaffOffboarding"></div><div id="editOffboardingReadiness"></div><div id="editStaffRoleAssignments"></div><div id="editStaffShiftPreferences"></div>',
                        '<button type="button" id="editHistoryRefresh"></button><button type="button" id="editSave"></button>',
                        '</div></div>'
                    ].join('');
                    initModals();
                }

                function createHistoryDefer(staffId) {
                    const item = { promise: null, resolve: null };
                    item.promise = new Promise(resolve => { item.resolve = resolve; });
                    historyDefers.set(Number(staffId), item);
                    return item;
                }

                canManage = true;
                teamStaff = Array.from(staffProfiles.values()).map(item => ({ ...item }));
                hrProfessions = [
                    { key: 'animator', value: 'animator', label: 'Animator', title: 'Animator' },
                    { key: 'instructor', value: 'instructor', label: 'Instructor', title: 'Instructor' }
                ];
                companyStructureNodes = [];
                ensureProfessionsLoaded = async () => hrProfessions;
                ensureCompanyStructureNodesLoaded = async () => companyStructureNodes;
                hrFetch = async path => {
                    const profileMatch = path.match(/^\\/staff\\/(\\d+)$/);
                    if (profileMatch) {
                        const id = Number(profileMatch[1]);
                        const profile = staffProfiles.get(id);
                        return profile ? { success: true, data: { ...profile, name: 'Fresh ' + id, phone: 'fresh-' + id } } : { success: false, error: 'missing' };
                    }
                    const historyMatch = path.match(/^\\/staff\\/(\\d+)\\/history/);
                    if (historyMatch) return createHistoryDefer(Number(historyMatch[1])).promise;
                    if (path.includes('/lifecycle-checklist')) return { success: true, data: { staff: { id: Number(activeEditStaffId()) }, summary: {}, metrics: {}, sections: [] } };
                    if (path.includes('/documents')) return { success: true, data: [] };
                    if (path.includes('/medical-book')) return { success: true, data: [] };
                    if (path.includes('/resources')) return { success: true, data: [] };
                    if (path.includes('/offboarding-readiness')) return { success: true, data: {} };
                    if (path.includes('/offboarding')) return { success: true, data: [] };
                    if (path.includes('/role-assignments')) return { success: true, data: [] };
                    if (path.includes('/payroll-scheme')) return { success: true, data: { fallback_hourly_rate: 100, fallback_rate_unit: 'hour' } };
                    if (path.includes('/resource-options')) return { success: true, data: [] };
                    return { success: true, data: [] };
                };
                crmApiFetch = async () => ({ success: true, data: [] });

                return {
                    setupDom,
                    open: openStaffEdit,
                    close: closeHrEditableModal,
                    activate: activateStaffProfileTab,
                    loadTab: loadStaffProfileTabData,
                    modal: () => document.getElementById('staffEditModal'),
                    history: staffId => historyDefers.get(Number(staffId)),
                    activeId: activeEditStaffId,
                    staff: () => teamStaff,
                    setProfile(id, profile = {}) {
                        const numericId = Number(id);
                        staffProfiles.set(numericId, { id: numericId, ...profile });
                        teamStaff = Array.from(staffProfiles.values()).map(item => ({ ...item }));
                    },
                    setCompanyStructureNodes(nodes = []) {
                        companyStructureNodes = normalizeCompanyStructureNodes(nodes);
                    },
                    structureOptions() {
                        return Array.from(document.getElementById('editCompanyStructureNode')?.options || [])
                            .map(option => ({ value: option.value, text: option.textContent, selected: option.selected }));
                    },
                    confirmCalls: () => window.__confirmCalls
                };
            })();
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
    window.__hrStaffProfileTest.setupDom();
    return { window, api: window.__hrStaffProfileTest };
}

function createTeamBucketHarness() {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/hr#workers',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    window.console = console;
    window.showNotification = () => {};
    window.AppState = { currentUser: { id: 1, role: 'creator', name: 'Tester' } };
    window.requestAnimationFrame = callback => callback();
    window.HrPulseSwitcher = {
        items: () => [],
        renderTab(item, options = {}) {
            const attrs = options.attrs?.(item) || {};
            const attrText = Object.entries(attrs)
                .filter(([, value]) => value)
                .map(([name, value]) => `${name}="${value}"`)
                .join(' ');
            const count = item.bucket ? `<span data-nav-count="${item.bucket}">0</span>` : '';
            return `<button type="button" class="${options.className || ''}" ${attrText}>${item.label || ''}${count}</button>`;
        }
    };

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
            window.__hrTeamBucketTest = (() => {
                function setupDom() {
                    document.body.innerHTML = [
                        '<nav id="hrNav" class="hr-nav hr-nav--people" aria-label="team buckets">',
                        '<button type="button" class="hr-tab" data-tab="team" data-bucket="workers">Workers <span data-nav-count="workers">0</span></button>',
                        '<button type="button" class="hr-tab" data-tab="team" data-bucket="interns">Interns <span data-nav-count="interns">0</span></button>',
                        '<button type="button" class="hr-tab" data-tab="team" data-bucket="blacklist">Blacklist <span data-nav-count="blacklist">0</span></button>',
                        '<button type="button" class="hr-tab" data-tab="team" data-bucket="reserve">Reserve <span data-nav-count="reserve">0</span></button>',
                        '<button type="button" class="hr-tab" data-tab="team" data-bucket="dismissed">Dismissed <span data-nav-count="dismissed">0</span></button>',
                        '</nav>',
                        '<main id="tab-team" class="hr-tab-content active">',
                        '<input id="teamSearch">',
                        '<div id="teamFilterInfo"></div>',
                        '<div id="teamGrid"></div>',
                        '</main>'
                    ].join('');
                }

                AppState = window.AppState;
                canManage = true;
                activePeopleBucket = 'workers';
                pendingPeopleBucket = null;
                hrProfessions = [
                    { key: 'animator', title: 'Аніматор', is_active: true },
                    { key: 'intern', title: 'Стажер', is_active: true },
                    { key: 'technician', title: 'Технік', is_active: true }
                ];
                companyStructureNodes = [];
                teamStaff = [
                    { id: 1, name: 'Worker Alpha', role_type: 'animator', secondary_professions: [], phone: '111', is_active: true, hr_pool_status: 'core', photo_url: '/uploads/worker.jpg', has_face_descriptor: true, has_account: true, company_structure_node_id: 'animators', training_readiness: { total: 4, completed: 4, percent: 100 }, onboarding_assignment: { responsible_user_id: 7, responsible_name: 'HR Lead', percent: 100, training_status: 'completed' } },
                    { id: 2, name: 'Reserve Beta', role_type: 'technician', secondary_professions: [], phone: '222', is_active: true, hr_pool_status: 'reserve', photo_url: '/uploads/reserve.jpg', has_face_descriptor: false, has_account: true, company_structure_node_id: 'tech', training_readiness: { total: 3, completed: 0, percent: 0 }, onboarding_assignment: { responsible_user_id: 7, responsible_name: 'HR Lead', percent: 20, training_status: 'in_progress' } },
                    { id: 3, name: 'Dismissed Gamma', role_type: 'animator', secondary_professions: [], phone: '333', is_active: false, hr_pool_status: 'core', photo_url: '', has_face_descriptor: false, has_account: false, company_structure_node_id: null, training_readiness: { total: 0, completed: 0, percent: 0 } },
                    { id: 4, name: 'Blacklist Delta', role_type: 'animator', secondary_professions: [], phone: '444', is_active: true, hr_pool_status: 'blacklisted', photo_url: '', has_face_descriptor: true, has_account: false, company_structure_node_id: null, training_readiness: { total: 2, completed: 1, percent: 50 } },
                    { id: 5, name: 'Intern Epsilon', role_type: 'intern', secondary_professions: [], phone: '555', is_active: true, hr_pool_status: 'core', photo_url: '/uploads/intern.jpg', has_face_descriptor: true, has_account: true, company_structure_node_id: 'interns', training_readiness: { total: 1, completed: 0, percent: 0 } }
                ];
                loadTeam = async () => filterAndRenderTeam();

                return {
                    setupDom,
                    render: filterAndRenderTeam,
                    setBucket: bucket => window.setPeopleBucket(bucket),
                    activateBucket: bucket => activateHrTab('team', { bucket, updateHash: true }),
                    async navigateHash(bucket) {
                        window.location.hash = '#' + bucket;
                        const target = getInitialHrTab();
                        await activateHrTab(target, { updateHash: false });
                    },
                    search(value) {
                        document.getElementById('teamSearch').value = value;
                        filterAndRenderTeam();
                    },
                    grid: () => document.getElementById('teamGrid'),
                    info: () => document.getElementById('teamFilterInfo').textContent,
                    searchValue: () => document.getElementById('teamSearch').value,
                    emptyText: () => document.querySelector('#teamGrid .hr-people-empty')?.textContent || '',
                    activeBucket: () => activePeopleBucket,
                    hash: () => window.location.hash,
                    hasArchiveSearch: () => Boolean(document.getElementById('teamArchiveSearch')),
                    classifications: () => teamStaff.map(staff => String(staff.id) + ':' + bucketForStaff(staff)),
                    visibleBuckets: () => visiblePeopleBuckets().map(bucket => bucket.id),
                    normalizeBucket: bucket => normalizeVisiblePeopleBucket(bucket),
                    setRoleVisibility(role, bucketIds) {
                        const allowed = new Set(bucketIds);
                        AppState.currentUser = { ...AppState.currentUser, role };
                        window.HrTeamBucketAccess = {
                            canSeeBucket: (bucket, user) => user?.role === role ? allowed.has(bucket) : true,
                            canManage: () => false
                        };
                        activePeopleBucket = normalizeVisiblePeopleBucket(activePeopleBucket);
                        pendingPeopleBucket = null;
                        filterAndRenderTeam();
                    },
                    cardIds: () => Array.from(document.querySelectorAll('#teamGrid .hr-team-card')).map(card => card.dataset.staffId),
                    cardNames: () => Array.from(document.querySelectorAll('#teamGrid .hr-team-name')).map(node => node.textContent.trim()),
                    toggleMenu: button => toggleTeamCardMenu(null, button),
                    nav: bucket => document.querySelector(\`.hr-tab[data-bucket="\${bucket}"]\`),
                    count: bucket => document.querySelector(\`[data-nav-count="\${bucket}"]\`)?.textContent || ''
                };
            })();
        `, dom.getInternalVMContext());
    } finally {
        window.document.addEventListener = originalDocumentAddEventListener;
    }

    window.__hrTeamBucketTest.setupDom();
    return { window, api: window.__hrTeamBucketTest };
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

test('HR team bucket navigation searches only within each active category', async () => {
    const { window, api } = createTeamBucketHarness();

    api.render();
    assert.deepEqual([...api.cardIds()], ['1']);
    assert.equal(api.grid().querySelectorAll('.hr-people-bucket').length, 0, 'closed bucket cards must not remain in DOM');
    assert.equal(api.grid().querySelectorAll('.hr-team-open').length, 1, 'card should expose one primary open action');
    assert.equal(api.grid().querySelectorAll('.hr-team-profile-trigger, .hr-team-name-button, .hr-team-edit--top').length, 0, 'avatar/name/profile duplicate open triggers should stay removed');
    assert.equal(api.grid().querySelectorAll('.hr-team-contact-grid').length, 0, 'contact and payroll rows should stay inside the profile, not on cards');
    const menuTrigger = api.grid().querySelector('.hr-team-overflow-trigger');
    assert.ok(menuTrigger, 'compact card should expose overflow actions');
    api.toggleMenu(menuTrigger);
    const menu = api.grid().querySelector('[data-team-card-menu]');
    assert.equal(menu.hidden, false);
    assert.match(menu.textContent, /Документи/);
    assert.match(menu.textContent, /Перемістити/);
    assert.match(menu.textContent, /тільки для дубля/);
    const menuItem = menu.querySelector('button');
    menuItem?.focus();
    menuItem?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(menu.hidden, true, 'Escape should close the overflow menu');
    assert.equal(window.document.activeElement, menuTrigger, 'Escape should restore focus to the overflow trigger');
    assert.equal(api.nav('workers').getAttribute('aria-pressed'), 'true');
    assert.equal(api.nav('reserve').getAttribute('aria-pressed'), 'false');
    assert.equal(api.count('workers'), '1');
    assert.equal(api.count('interns'), '1');
    assert.equal(api.count('blacklist'), '1');
    assert.equal(api.count('reserve'), '1');
    assert.equal(api.count('dismissed'), '1');

    const categoryCases = [
        { bucket: 'workers', title: 'Робітники', ownName: 'Worker Alpha', neighborName: 'Blacklist Delta' },
        { bucket: 'interns', title: 'Стажери', ownName: 'Intern Epsilon', neighborName: 'Dismissed Gamma' },
        { bucket: 'blacklist', title: 'Чорний список', ownName: 'Blacklist Delta', neighborName: 'Reserve Beta' },
        { bucket: 'reserve', title: 'Резерв', ownName: 'Reserve Beta', neighborName: 'Worker Alpha' },
        { bucket: 'dismissed', title: 'Звільнені', ownName: 'Dismissed Gamma', neighborName: 'Intern Epsilon' }
    ];

    for (const current of categoryCases) {
        api.setBucket(current.bucket);
        api.search(current.ownName);
        assert.deepEqual([...api.cardNames()], [current.ownName], `${current.bucket} finds its own profile`);
        for (const candidate of categoryCases) {
            assert.equal(
                api.nav(candidate.bucket).getAttribute('aria-pressed'),
                candidate.bucket === current.bucket ? 'true' : 'false',
                `${current.bucket} owns the only active aria state`
            );
        }

        api.search(current.neighborName);
        assert.deepEqual([...api.cardNames()], [], `${current.bucket} excludes a neighboring category`);
        assert.equal(api.grid().dataset.peopleMode, 'search');
        assert.equal(api.emptyText(), 'Нічого не знайдено в цій категорії. Змініть запит.');
        assert.equal(api.info(), `${current.title}: 0 знайдено`);
    }

    assert.equal(api.hasArchiveSearch(), false, 'dismissed search must not require an archive checkbox');
    api.setBucket('dismissed');
    api.search('Dismissed Gamma');
    assert.deepEqual([...api.cardNames()], ['Dismissed Gamma']);

    api.setBucket('workers');
    api.search('Worker Alpha');
    assert.equal(api.searchValue(), 'Worker Alpha');
    api.setBucket('reserve');
    assert.equal(api.searchValue(), '', 'switching category clears the previous query');
    assert.equal(api.grid().dataset.peopleMode, 'bucket');
    assert.deepEqual([...api.cardNames()], ['Reserve Beta']);
    assert.equal(api.hash(), '#reserve');

    api.search('Reserve Beta');
    api.setBucket('reserve');
    assert.equal(api.searchValue(), 'Reserve Beta', 'reselecting the active category keeps the query');
    assert.deepEqual([...api.cardNames()], ['Reserve Beta']);

    api.setBucket('workers');
    api.search('Worker Alpha');
    await api.activateBucket('blacklist');
    assert.equal(api.searchValue(), '', 'activateHrTab clears the query before rendering a different category');
    assert.equal(api.activeBucket(), 'blacklist');
    assert.equal(api.hash(), '#blacklist');
    assert.equal(api.nav('blacklist').getAttribute('aria-pressed'), 'true');
    assert.deepEqual([...api.cardNames()], ['Blacklist Delta']);

    api.search('Blacklist Delta');
    await api.navigateHash('dismissed');
    assert.equal(api.searchValue(), '', 'hash navigation clears the query before rendering a different category');
    assert.equal(api.activeBucket(), 'dismissed');
    assert.equal(api.hash(), '#dismissed');
    assert.equal(api.nav('dismissed').getAttribute('aria-pressed'), 'true');
    assert.deepEqual([...api.cardNames()], ['Dismissed Gamma']);
});

test('HR role visibility stays separate from staff bucket classification', () => {
    const { api } = createTeamBucketHarness();

    api.render();
    const classifications = ['1:workers', '2:reserve', '3:dismissed', '4:blacklist', '5:interns'];
    assert.deepEqual([...api.classifications()], classifications);

    api.setRoleVisibility('instructor', ['workers', 'interns']);
    assert.deepEqual([...api.visibleBuckets()], ['workers', 'interns']);
    assert.equal(api.normalizeBucket('blacklist'), 'workers');
    assert.deepEqual([...api.classifications()], classifications, 'visibility policy must not change bucket classification');

    api.setBucket('blacklist');
    assert.equal(api.activeBucket(), 'workers');
    assert.equal(api.nav('workers').getAttribute('aria-pressed'), 'true');
    assert.equal(api.nav('blacklist').getAttribute('aria-pressed'), 'false');
    api.search('Blacklist Delta');
    assert.deepEqual([...api.cardNames()], [], 'restricted roles cannot search a hidden category');
});

test('HR staff profile opens from fresh data and marks clean only after hydration', async () => {
    const { window, api } = createStaffProfileHarness();

    window.document.getElementById('staffTrigger').focus();
    await api.open(1);
    assert.equal(window.document.getElementById('editStaffName').value, 'Fresh 1');
    assert.equal(api.staff().find(item => item.id === 1).phone, 'fresh-1');
    assert.equal(api.modal().dataset.staffProfileHydrating, 'true');

    await api.close('staffEditModal');
    assert.equal(api.confirmCalls().length, 0, 'clean hydrating profile close should not ask to discard');
    assert.equal(api.modal().style.display, 'none');

    await api.open(1);
    await settle();
    await settle();
    assert.equal(api.modal().dataset.staffProfileHydrating, 'false');

    window.document.getElementById('editSave').focus();
    api.modal().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(window.document.activeElement.id, 'editCloseTop');

    window.document.getElementById('editStaffName').focus();
    api.modal().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    assert.equal(api.confirmCalls().length, 0, 'clean hydrated Escape close should not ask to discard');
    assert.equal(api.modal().style.display, 'none');

    await api.open(1);
    await settle();
    await settle();
    const name = window.document.getElementById('editStaffName');
    name.value = 'Fresh 1 edited';
    name.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }));

    await api.close('staffEditModal');
    assert.equal(api.confirmCalls().length, 1, 'real field edit should ask to discard');
    assert.equal(api.modal().style.display, 'flex');
});

test('HR staff profile structure dropdown keeps current approved node and full approved order when loaded structure is partial', async () => {
    const { window, api } = createStaffProfileHarness();
    api.setCompanyStructureNodes([
        { id: 'director', title: 'Керівництво', description: 'Leadership.', tone: 'gold', lane: 'root', parentId: null, order: 10 },
        { id: 'hr', title: 'HR', description: 'People.', tone: 'blue', lane: 'leadership', parentId: 'director', order: 20 },
        { id: 'accountant', title: 'Бухгалтерія', description: 'Accounting.', tone: 'blue', lane: 'leadership', parentId: 'director', order: 30 },
        { id: 'marketer', title: 'Маркетинг', description: 'Demand.', tone: 'blue', lane: 'leadership', parentId: 'director', order: 40 },
        { id: 'it_specialist', title: 'IT', description: 'Systems.', tone: 'violet', lane: 'leadership', parentId: 'director', order: 50 },
        { id: 'senior_trampoline', title: 'Ігрові зони', description: 'Play zones.', tone: 'purple', lane: 'operations', parentId: 'director', order: 55 },
        { id: 'chef', title: 'Кухня', description: 'Kitchen.', tone: 'violet', lane: 'support', parentId: 'director', order: 60 },
        { id: 'admins', title: 'Адміністративно-операційний відділ', description: 'Operations.', tone: 'purple', lane: 'leadership', parentId: 'director', order: 61 }
    ]);
    api.setProfile(3, {
        id: 3,
        name: 'Шарлай Сергій',
        role_type: 'art_director',
        secondary_professions: [],
        company_structure_node_id: 'art_director',
        phone: 'fresh-3',
        hourly_rate: 0,
        rate_unit: 'hour',
        skills: []
    });

    await api.open(3);

    const select = window.document.getElementById('editCompanyStructureNode');
    const options = api.structureOptions();
    assert.equal(select.value, 'art_director');
    const optionValues = Array.from(options, option => option.value);
    assert.deepEqual(optionValues, [
        '',
        'director',
        'admins',
        'top_manager',
        'art_director',
        'senior_trampoline',
        'chef',
        'pastry_chef',
        'technical_staff',
        'accountant',
        'hr',
        'marketer',
        'it_specialist'
    ]);
    assert.ok(
        options.some(option => option.value === 'art_director' && /Арт-відділ/.test(option.text)),
        'staff card must keep the current Арт-відділ node visible even when the loaded node list is partial'
    );
    assert.ok(
        options.some(option => option.value === 'admins' && /Адміністративно-операційний відділ/.test(option.text)),
        'staff card must include the approved Адміністративно-операційний відділ node from the fallback list'
    );
    assert.ok(
        options.some(option => option.value === 'top_manager' && /Відділ продажів \/ CRM/.test(option.text)),
        'staff card must include the approved Відділ продажів / CRM node from the fallback list'
    );
});

test('HR staff profile ignores stale history responses after rapid profile switches', async () => {
    const { window, api } = createStaffProfileHarness();

    await api.open(1);
    const firstHistoryLoad = api.activate('history');
    const firstHistory = api.history(1);
    await api.open(2);
    const secondHistoryLoad = api.activate('history');
    const secondHistory = api.history(2);

    firstHistory.resolve({
        success: true,
        data: [{ id: 1, action: 'staff_update', performed_by: 'first-actor', details: {}, created_at: '2099-01-01T10:00:00Z' }]
    });
    await firstHistoryLoad;
    await settle();
    assert.equal(window.document.getElementById('editStaffHistory').textContent.includes('first-actor'), false);

    secondHistory.resolve({
        success: true,
        data: [{ id: 2, action: 'staff_update', performed_by: 'second-actor', details: {}, created_at: '2099-01-01T10:01:00Z' }]
    });
    await secondHistoryLoad;
    await settle();
    await settle();

    const historyText = window.document.getElementById('editStaffHistory').textContent;
    assert.equal(api.activeId(), '2');
    assert.equal(historyText.includes('second-actor'), true);
    assert.equal(historyText.includes('first-actor'), false);
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
    assert.ok(form.querySelector('.hr-org-node-editor-summary')?.textContent.includes('Фільтр:'));
    assert.equal(form.querySelector('select[name="displayGroup"]')?.value, 'animators');
    assert.equal(form.querySelector('input[name="x"]')?.value, '100');
    assert.equal(form.querySelector('input[name="y"]')?.value, '100');
    assert.ok(form.querySelector('select[name="parentId"]'));
});

test('HR org compact nodes select separately from quick actions and reparent through the validated model', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: null, order: 1, stack: null, meta: 'child', x: 90, y: 120 },
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 }
    ]);
    api.renderCanvas();

    assert.equal(window.document.querySelectorAll('.hr-org-port').length, 0);
    assert.equal(window.document.querySelectorAll('[data-org-quick-add]').length, 2);
    assert.equal(window.document.querySelectorAll('[data-org-quick-more]').length, 2);
    assert.equal(api.reparent('child', 'parent'), true);
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

test('HR org reparent rejects parent=self and cycle creation', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 1, stack: null, meta: 'child', x: 90, y: 120 },
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 }
    ]);
    api.renderCanvas();

    assert.equal(api.wouldCycle('parent', 'child'), true);
    assert.equal(api.reparent('parent', 'child'), false);
    assert.equal(api.reparent('child', 'child'), false);
    assert.equal(api.nodes().find(node => node.id === 'parent').parentId, null);
    assert.equal(api.nodes().find(node => node.id === 'child').parentId, 'parent');
});

test('HR org adds child and sibling with stable unique ids', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 }
    ]);
    api.renderCanvas();

    const child = api.add({ relation: 'child', sourceId: 'parent', title: 'Child' });
    const sibling = api.add({ relation: 'sibling', sourceId: child.id, title: 'Sibling' });
    assert.ok(child.id);
    assert.notEqual(child.id, sibling.id);
    assert.equal(child.parentId, 'parent');
    assert.equal(sibling.parentId, 'parent');
    api.open(child.id);
    const form = window.document.getElementById('hrOrgNodeForm');
    form.querySelector('input[name="title"]').value = 'Renamed child';
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    assert.equal(api.nodes().find(node => node.id === child.id).title, 'Renamed child');
});

test('HR org duplicate and undo/redo preserve hierarchy changes in the local draft', () => {
    const { api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 },
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
    ]);
    api.renderCanvas();
    api.resetHistory();

    const duplicate = api.duplicate('child');
    assert.ok(duplicate.id);
    assert.equal(duplicate.parentId, 'parent');
    assert.equal(api.nodes().length, 3);
    assert.equal(api.undo(), true);
    assert.equal(api.nodes().length, 2);
    assert.equal(api.redo(), true);
    assert.equal(api.nodes().length, 3);
});

test('HR org archive impact counts links and archive keeps all relations intact', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 },
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
    ]);
    api.setProfessions([
        { key: 'animator', title: 'Animator', structure_node_id: 'parent', people: [{ id: 10 }, { id: 11 }] },
        { key: 'host', title: 'Host', structureNodeId: 'parent', people: [{ id: 11 }] }
    ]);
    api.setStaff([{ id: 12, company_structure_node_id: 'parent' }]);
    api.renderCanvas();

    assert.deepEqual({ ...api.impact('parent') }, { children: 1, professions: 2, staff: 3 });
    window.__confirmResult = true;
    assert.equal(await api.archive('parent'), true);
    const parent = api.nodes().find(node => node.id === 'parent');
    assert.equal(parent.archived, true);
    assert.equal(api.nodes().find(node => node.id === 'child').parentId, 'parent');
    assert.equal(api.nodes().length, 2);
    assert.match(window.__confirmCalls.at(-1).message, /дочірніх вузлів — 1, професій — 2, працівників — 3/);
});

test('HR staff edit modal uses the shared modal layer and viewport-safe scrolling', () => {
    const html = [
        fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8')
    ].join('\n');
    const js = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const overlayCss = html.match(/\.hr-modal-overlay\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const dialogCss = html.match(/\.hr-modal\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const showModalFn = js.slice(js.indexOf('function showHrEditableModal'), js.indexOf('async function closeHrEditableModal'));

    assert.match(overlayCss, /z-index:\s*var\(--z-modal,\s*30000\)/);
    assert.match(overlayCss, /overflow:\s*hidden/);
    assert.match(dialogCss, /max-height:\s*calc\(100dvh - 32px\)/);
    assert.match(dialogCss, /overflow-y:\s*auto/);
    assert.match(html, /id="staffEditModal"[^>]*class="hr-modal-overlay hr-staff-profile-overlay"[\s\S]*?<div class="hr-modal hr-staff-profile-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-describedby="editStaffHeaderMeta"/);
    assert.match(html, /\.hr-staff-profile-modal\s*\{[\s\S]*?max-width:\s*1040px[\s\S]*?height:\s*100dvh/);
    assert.match(html, /class="hr-staff-profile-tabs" role="tablist"/);
    assert.match(html, /data-staff-profile-tab="resources"/);
    assert.match(showModalFn, /setAttribute\('aria-hidden', 'false'\)/);
    assert.match(showModalFn, /target\.querySelector\('\.hr-staff-profile-body'\)/);
    assert.match(showModalFn, /scrollRoot\.scrollTop = 0/);
    assert.doesNotMatch(showModalFn, /dialog\.scrollTop = 0/);
});

test('HR staff profile declares one production tab panel per profile section', () => {
    const html = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const body = document.querySelector('#staffEditModal .hr-staff-profile-body');
    const expectedTabs = ['main', 'work', 'training', 'payroll', 'resources', 'offboarding', 'history'];
    const panels = Array.from(body?.children || []).filter(node => node.matches?.('[data-staff-profile-panel]'));

    assert.equal(panels.length, expectedTabs.length, 'production drawer exposes exactly seven top-level panels');
    assert.deepEqual(panels.map(panel => panel.dataset.staffProfilePanel), [
        'main', 'training', 'work', 'payroll', 'resources', 'offboarding', 'history'
    ]);

    expectedTabs.forEach(tab => {
        const button = document.querySelector(`#staffProfileTab${tab.charAt(0).toUpperCase()}${tab.slice(1)}`);
        const panel = document.querySelector(`#staffProfilePanel${tab.charAt(0).toUpperCase()}${tab.slice(1)}`);
        assert.ok(button, `${tab} tab button exists`);
        assert.ok(panel, `${tab} panel exists`);
        assert.equal(button.getAttribute('aria-controls'), panel.id, `${tab} tab controls its production panel`);
        assert.equal(panel.getAttribute('role'), 'tabpanel', `${tab} panel has tabpanel semantics`);
        assert.equal(panel.getAttribute('aria-labelledby'), button.id, `${tab} panel is labelled by its tab`);
    });

    assert.ok(document.querySelector('#staffProfilePanelPayroll #editHourlyRate'));
    assert.ok(document.querySelector('#staffProfilePanelPayroll #editProfessionRates'));
    assert.equal(document.querySelector('#staffProfilePanelWork #editHourlyRate'), null, 'base rate does not leak into work');
    assert.equal(document.querySelector('#staffProfilePanelWork #editProfessionRates'), null, 'profession rates do not leak into work');
    assert.doesNotMatch(js, /function setStaffProfilePanel/);
    assert.doesNotMatch(js, /function staffProfileClosestSection/);
    assert.doesNotMatch(js, /insertAdjacentHTML\('afterend', `<div class="hr-staff-profile-save-scope"/);
});

test('HR staff profile panel contract rejects the legacy leaked-panel layout', () => {
    const html = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const body = document.querySelector('#staffEditModal .hr-staff-profile-body');
    const assertSevenDirectPanels = () => {
        const panels = Array.from(body?.children || []).filter(node => node.matches?.('[data-staff-profile-panel]'));
        assert.equal(panels.length, 7, 'staff profile must expose exactly seven direct tab panels');
    };

    assertSevenDirectPanels();
    const leakedLegacySection = document.createElement('div');
    leakedLegacySection.dataset.staffProfilePanel = 'main';
    leakedLegacySection.dataset.staffProfileScope = 'basic';
    body.append(leakedLegacySection);
    assert.throws(assertSevenDirectPanels, /exactly seven direct tab panels/, 'the legacy extra main section must fail the production panel contract');
});

test('HR staff profile drawer uses a single body scroll root and timeline-style close action', () => {
    const html = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8');
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const profileHeadCss = css.match(/\.hr-staff-profile-drawer-head\s*\{[\s\S]*?\n\}/)?.[0] || '';
    const profileTabsCss = css.match(/\.hr-staff-profile-tabs\s*\{[\s\S]*?\n\}/)?.[0] || '';
    const profileBodyCss = css.match(/\.hr-staff-profile-body\s*\{[\s\S]*?\n\}/)?.[0] || '';
    const closeCss = css.match(/\.hr-staff-profile-close\s*\{[\s\S]*?\n\}/)?.[0] || '';
    const close = document.getElementById('editCloseTop');

    assert.match(profileHeadCss, /flex:\s*0 0 auto/);
    assert.match(profileTabsCss, /flex:\s*0 0 auto/);
    assert.doesNotMatch(profileHeadCss, /position:\s*sticky/);
    assert.doesNotMatch(profileTabsCss, /position:\s*sticky/);
    assert.match(profileTabsCss, /overflow-x:\s*auto/);
    assert.match(profileTabsCss, /overflow-y:\s*hidden/);
    assert.match(profileBodyCss, /overflow-y:\s*auto/);
    assert.match(profileBodyCss, /safe-area-inset-bottom/);

    assert.ok(close?.classList.contains('hr-staff-profile-close'));
    assert.equal(close?.getAttribute('aria-label'), 'Закрити картку працівника');
    assert.equal(close?.textContent.trim(), '✕');
    assert.match(closeCss, /background:\s*#0f766e/);
    assert.match(closeCss, /width:\s*44px/);
    assert.equal(document.getElementById('editCancel'), null, 'persistent close button is removed');
    assert.equal(document.querySelector('.hr-staff-profile-bottom-actions'), null, 'persistent profile footer is removed');
});

test('HR staff profile save actions isolate payloads and expose modal action states', () => {
    const js = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const profileCss = fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8');
    const foundationCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-hr-foundation.css'), 'utf8');
    const mainBuilder = js.slice(js.indexOf('function buildStaffMainPayload'), js.indexOf('function buildStaffWorkPayload'));
    const workBuilder = js.slice(js.indexOf('function buildStaffWorkPayload'), js.indexOf('const STAFF_MAIN_PAYLOAD_FIELDS'));
    const ratesBuilder = js.slice(js.indexOf('function buildStaffRatesPayload'), js.indexOf('async function updateStaffProfileFields'));
    const payrollSave = js.slice(js.indexOf('async function saveStaffPayrollScheme'), js.indexOf('async function loadStaffResourceOptions'));

    assert.match(mainBuilder, /name:/);
    assert.match(mainBuilder, /phone:/);
    assert.match(mainBuilder, /photo_url:/);
    assert.doesNotMatch(mainBuilder, /role_type:|hourly_rate:|notes:/);
    assert.match(workBuilder, /role_type:/);
    assert.match(workBuilder, /notes:/);
    assert.doesNotMatch(workBuilder, /^\s*(?:name|phone|photo_url|hourly_rate|profession_rates):/m);
    assert.match(ratesBuilder, /hourly_rate:/);
    assert.match(ratesBuilder, /rate_unit:/);
    assert.match(ratesBuilder, /profession_rates:/);
    assert.doesNotMatch(ratesBuilder, /^\s*(?:name|phone|notes):/m);
    assert.match(payrollSave, /dirtyScopes\.has\('rates'\)/);
    assert.match(payrollSave, /dirtyScopes\.has\('payroll'\)/);
    assert.match(payrollSave, /saveStaffRates\(staffId\)/);
    assert.match(js, /button\.dataset\.staffActionPending === 'true'/);
    assert.match(js, /button\.disabled = true/);
    assert.match(js, /setStaffProfileActionState\(button, 'success'/);
    assert.match(js, /setStaffProfileActionState\(button, 'error'/);
    assert.match(js, /markStaffProfileScopeFieldsClean\(scope, submittedFields\)/);
    assert.match(js, /scopes: \['documents', 'medical', 'resourceIssue'\]/);
    assert.doesNotMatch(js.slice(js.indexOf('async function archiveStaffDocument'), js.indexOf('async function saveStaffMedicalBook')), /markStaffProfileScopesClean/);
    assert.doesNotMatch(js.slice(js.indexOf('async function returnStaffResource'), js.indexOf('async function completeStaffOffboarding')), /markStaffProfileScopesClean/);
    assert.match(js, /payrollSave\.textContent = 'Зберегти базові ставки'/);
    assert.match(profileCss, /#staffEditModal \.hr-staff-action,[\s\S]*?min-height:\s*44px/);
    assert.match(profileCss, /\[data-action-state="loading"\]/);
    assert.match(profileCss, /\[data-action-state="success"\]/);
    assert.match(profileCss, /\[data-action-state="error"\]/);
    assert.match(foundationCss, /\.hr-staff-foundation-actions button,[\s\S]*?min-height:\s*44px/);
});

test('HR staff destructive actions use the shared dynamic confirmation and fail closed without it', () => {
    const js = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const confirmHelper = js.slice(js.indexOf('async function confirmHrAction'), js.indexOf('// ==========================================', js.indexOf('async function confirmHrAction')));
    const archiveAction = js.slice(js.indexOf('async function archiveStaffDocument'), js.indexOf('async function saveStaffMedicalBook'));
    const offboardingAction = js.slice(js.indexOf('async function completeStaffOffboarding'), js.indexOf('function staffEditRestoreFocusTarget'));

    assert.match(confirmHelper, /typeof confirmModal === 'function'/);
    assert.match(confirmHelper, /return confirmModal\(message,/);
    assert.match(confirmHelper, /Підтвердження дії недоступне/);
    assert.doesNotMatch(confirmHelper, /customConfirm/);
    assert.match(archiveAction, /okText: 'До архіву'/);
    assert.match(offboardingAction, /type: 'danger'/);
    assert.match(offboardingAction, /okText: 'Завершити співпрацю'/);
});

test('HR staff documents and resources expose persisted archive/history workspaces', () => {
    const html = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const routes = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');

    assert.match(html, /data-staff-workspace-view="documents:archive"/);
    assert.match(html, /data-staff-workspace-view="resources:history"/);
    assert.match(html, /id="editStaffDocumentsRestricted"/);
    assert.match(html, /id="editStaffDocumentsForm"/);
    assert.match(js, /include_archived=true/);
    assert.match(js, /function previewStaffDocument/);
    assert.match(js, /function restoreStaffDocument/);
    assert.match(js, /syncStaffDocumentPermissionState/);
    assert.match(js, />До архіву<\/button>/);
    assert.match(js, />Відновити<\/button>/);
    assert.match(js, /resources\?view=\$\{currentStaffWorkspaceView\('resources'\)\}/);
    assert.match(js, /function showStaffResourceDetails/);
    assert.match(js, /transitionStaffResourceStatus/);
    assert.match(js, /archived_at/);
    assert.match(js, /archived_by/);
    assert.match(js, /returned_at/);
    assert.match(js, /returned_by/);
    assert.match(js, /sessionStorage/);
    assert.match(routes, /req\.query\.include_archived === 'true'/);
    assert.match(routes, /documents\/:documentId\/preview/);
    assert.match(routes, /documents\/:documentId\/restore/);
    assert.match(routes, /req\.query\.include_returned === 'true'/);
});

test('HR staff drawer exposes 44px controls, focus rings, and live lazy-tab status', () => {
    const html = fs.readFileSync(path.join(ROOT, 'hr.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const profileCss = fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8');
    const foundationCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-hr-foundation.css'), 'utf8');

    assert.match(html, /id="staffProfileLiveStatus"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(profileCss, /\.hr-staff-profile-close\s*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/);
    assert.match(profileCss, /\.hr-staff-profile-tabs button\s*\{[\s\S]*?min-height:\s*44px/);
    assert.match(profileCss, /\.hr-staff-profile-tabs button:focus-visible/);
    assert.match(profileCss, /#staffEditModal input:focus-visible/);
    assert.match(foundationCss, /\.hr-lifecycle-action\s*\{[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
    assert.match(foundationCss, /\.hr-lifecycle-metrics-help summary\s*\{[\s\S]*?min-height:\s*44px/);
    assert.match(js, /button\.setAttribute\('aria-busy', loading \? 'true' : 'false'\)/);
    assert.match(js, /panel\.setAttribute\('aria-busy', loading \? 'true' : 'false'\)/);
    assert.match(js, /announceStaffProfileStatus/);
});

test('HR staff profile write smoke is explicit, QA-only, browser-driven, and restorative', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts', 'live-hr-staff-profile-write-smoke.js'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    assert.equal(
        pkg.scripts['smoke:hr-team:write'],
        'npm exec --yes --package=playwright -c "node scripts/live-hr-staff-profile-write-smoke.js"'
    );
    assert.match(script, /LIVE_HR_PROFILE_WRITE_CONFIRM/);
    assert.match(script, /I_CONFIRM_HR_PROFILE_QA_WRITES/);
    assert.match(script, /LIVE_HR_PROFILE_QA_STAFF_ID/);
    assert.match(script, /QA_STAFF_ID !== 818/);
    assert.match(script, /LIVE_HR_PROFILE_DISPOSABLE_FIXTURE/);
    assert.match(script, /LIVE_HR_PROFILE_WRITE_SCENARIOS/);
    assert.match(script, /window\.openStaffEdit/);
    assert.match(script, /#editPhone/);
    assert.match(script, /#editSave/);
    assert.match(script, /exact one-field payload/);
    assert.match(script, /double-click sends one request/);
    assert.match(script, /T00:00:00/);
    assert.match(script, /assertDrawerPersistence/);
    assert.match(script, /defensive profile restore failed/);
    assert.match(script, /restoreError/);
    assert.match(script, /finally/);
    assert.match(script, /\/api\/hr\/staff\/\$\{QA_STAFF_ID\}/);
    assert.doesNotMatch(script, /\/api\/hr\/staff\/\$\{QA_STAFF_ID\}\/(?:documents|resources|offboarding)/i);
    assert.doesNotMatch(pkg.scripts.test, /smoke:hr-team:write/);
});

test('HR staff update route persists every staff edit form field explicitly', () => {
    const source = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
    const start = source.indexOf("router.put('/staff/:id'");
    const end = source.indexOf("// PUT /api/hr/staff/:id/status", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const route = source.slice(start, end);
    const expectedFields = [
        'name',
        'phone',
        'emergency_contact',
        'emergency_phone',
        'role_type',
        'hourly_rate',
        'rate_unit',
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
    assert.doesNotMatch(route, /COALESCE\(\$\d+,\s*(name|phone|emergency_contact|emergency_phone|hourly_rate|birth_date|notes|telegram_id|telegram_username|contract_type|skills|address|hr_pool_status)\)/);
});

test('HR org initial load failure keeps defaults out of the editable canvas', async () => {
    const { window, api } = createHarness();
    api.renderCanvas();
    let putCalls = 0;
    api.setFetch(async (_path, options = {}) => {
        if (options.method === 'PUT') putCalls += 1;
        return { success: false, error: 'offline' };
    });

    await api.load({ force: true });

    assert.equal(api.state().loadState, 'error');
    assert.equal(api.nodes().length, 0);
    assert.equal(putCalls, 0);
    assert.equal(window.document.querySelector('[data-org-node-id]'), null);
    assert.equal(window.document.getElementById('companyStructureStatus').dataset.state, 'error');
    assert.equal(window.document.getElementById('btnRetryCompanyStructure').classList.contains('hidden'), false);
});

test('HR profession workspace normalizes deep-link and tab state canonically', () => {
    const { window } = createHarness();
    const api = window.__hrProfessionWorkspaceTest;

    assert.equal(api.hash('senior animator', 'checklist'), '#profession/senior%20animator/checklist');
    assert.equal(api.normalizeTab('unknown'), 'main');
    const parsed = api.parse('#profession/animator/people');
    assert.equal(parsed.key, 'animator');
    assert.equal(parsed.initialTab, 'people');

    api.setReady('animator', 'main');
    api.setTab('usage');
    assert.equal(api.state().tab, 'usage');
    assert.equal(window.location.hash, '#profession/animator/usage');
});

test('HR org default template requires a successful empty server response and explicit action', async () => {
    const { api } = createHarness();
    api.renderCanvas();
    assert.equal(api.applyTemplate(), false);

    api.setFetch(async () => ({
        success: true,
        data: { schemaVersion: 1, structure: '', instructions: '', nodes: [], updatedAt: null },
        hasSavedStructure: false,
        displayGroups: []
    }));
    await api.load({ force: true });

    assert.equal(api.state().loadState, 'empty');
    assert.deepEqual(api.nodes(), []);
    assert.equal(api.applyTemplate(), true);
    assert.equal(api.state().loadState, 'ready');
    assert.equal(api.state().saveState, 'changed');
    assert.ok(api.nodes().length > 0);
});

test('HR org keeps newer draft changes when an older single-flight save resolves', async () => {
    const { api } = createHarness();
    api.renderCanvas();
    let resolvePut;
    const pendingPut = new Promise(resolve => { resolvePut = resolve; });
    const requests = [];
    api.setFetch(async (requestPath, options = {}) => {
        requests.push({ requestPath, options });
        return pendingPut;
    });
    api.changeNotes('first draft');

    const firstSave = api.save();
    const secondSave = api.save();
    await settle();
    assert.equal(requests.length, 1);
    const savedPayload = JSON.parse(requests[0].options.body);
    assert.equal(savedPayload.baseUpdatedAt, '2099-05-31T12:00:00Z');

    api.patchNode('animators', { x: 420, title: 'Newer local title' });
    resolvePut({
        success: true,
        data: { ...savedPayload, updatedAt: '2099-06-01T12:00:00Z', updatedBy: 'other-editor' },
        displayGroups: []
    });
    assert.deepEqual(await Promise.all([firstSave, secondSave]), [true, true]);

    assert.equal(requests.length, 1);
    assert.equal(api.nodes()[0].x, 420);
    assert.equal(api.nodes()[0].title, 'Newer local title');
    assert.equal(api.state().saveState, 'changed');
    assert.ok(api.state().draftRevision > api.state().savedRevision);
});

test('HR org exposes a 409 conflict without overwriting the local draft', async () => {
    const { window, api } = createHarness();
    api.renderCanvas();
    api.changeNotes('my local draft');
    api.setFetch(async (_requestPath, options = {}) => {
        const payload = JSON.parse(options.body);
        assert.equal(payload.baseUpdatedAt, '2099-05-31T12:00:00Z');
        return {
            success: false,
            status: 409,
            error: 'version conflict',
            current: {
                schemaVersion: 1,
                structure: 'server version',
                instructions: '',
                nodes: [{ ...api.nodes()[0], title: 'Server title' }],
                updatedAt: '2099-06-02T12:00:00Z',
                updatedBy: 'HR Editor'
            }
        };
    });

    assert.equal(await api.save(), false);
    assert.equal(api.state().saveState, 'conflict');
    assert.equal(api.state().conflict.updatedBy, 'HR Editor');
    assert.equal(api.nodes()[0].title, 'Animators');
    assert.equal(window.document.getElementById('btnReloadCompanyStructureConflict').classList.contains('hidden'), false);
    assert.equal(window.document.getElementById('btnCopyCompanyStructureDraft').classList.contains('hidden'), false);
});

test('HR org read-only capability removes mutation controls but keeps the structure visible', () => {
    const { window, api } = createHarness();
    api.renderCanvas();
    api.setEditable(false);

    assert.ok(window.document.querySelector('[data-org-node-id="animators"]'));
    assert.equal(window.document.querySelector('[data-org-link-parent-port]'), null);
    assert.equal(window.document.querySelector('[data-org-link-child-port]'), null);
    assert.equal(window.document.getElementById('btnSaveCompanyStructure').classList.contains('hidden'), true);
    assert.equal(window.document.getElementById('hrOrgAutoLayoutBtn').classList.contains('hidden'), true);
    assert.equal(window.document.getElementById('hrOrgEditSelectedBtn').classList.contains('hidden'), true);
    assert.equal(window.document.getElementById('companyStructureNotes').readOnly, true);
    assert.equal(window.document.getElementById('companyInstructionsText').readOnly, true);
});

test('HR org canvas drag keeps the moved node in the draft', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: null, order: 1, stack: null, meta: 'child', x: 90, y: 120 },
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 2, stack: null, meta: 'parent', x: 330, y: 30 }
    ]);
    api.renderCanvas();

    const node = window.document.querySelector('[data-org-node-id="parent"]');
    node.dispatchEvent(pointer(window, 'pointerdown', { pointerId: 8, clientX: 100, clientY: 100 }));
    window.dispatchEvent(pointer(window, 'pointermove', { pointerId: 8, clientX: 160, clientY: 130 }));
    window.dispatchEvent(pointer(window, 'pointerup', { pointerId: 8, clientX: 160, clientY: 130 }));
    await settle();

    const moved = api.nodes().find(item => item.id === 'parent');
    assert.equal(moved.x, 400);
    assert.equal(moved.y, 60);
    assert.equal(api.state().saveState, 'changed');
});

test('HR org fit and view switching are viewport-only and do not dirty saved coordinates', () => {
    const { api } = createHarness();
    api.setNodes([
        { id: 'director', title: 'Director', description: 'Root.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 420, y: 40 },
        { id: 'child', title: 'Child', description: 'Child.', tone: 'blue', lane: 'operations', parentId: 'director', order: 2, x: 900, y: 520 }
    ]);
    api.renderCanvas();
    const before = api.nodes().map(node => ({ id: node.id, x: node.x, y: node.y, parentId: node.parentId }));
    const revision = api.state().draftRevision;

    api.setView('tree');
    api.setView('chart');
    api.fit();

    assert.deepEqual(api.nodes().map(node => ({ id: node.id, x: node.x, y: node.y, parentId: node.parentId })), before);
    assert.equal(api.state().draftRevision, revision);
});

test('HR org tree collapse and expand are local viewport state only', () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40, collapsed: true },
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
    ]);
    api.renderCanvas();
    api.setView('tree');

    const revision = api.state().draftRevision;
    assert.ok(window.document.querySelector('[data-org-tree-select="child"]'));
    click(window, window.document.querySelector('[data-org-tree-toggle="parent"]'));

    assert.equal(api.state().draftRevision, revision);
    assert.equal(api.state().saveState, 'clean');
    assert.equal(api.nodes().find(node => node.id === 'parent').collapsed, true);
    assert.equal(api.payload().nodes.some(node => Object.prototype.hasOwnProperty.call(node, 'collapsed')), false);
    assert.equal(window.document.querySelector('[data-org-tree-select="child"]'), null);

    api.setEditable(false);
    api.setView('tree');
    click(window, window.document.querySelector('[data-org-tree-toggle="parent"]'));
    assert.ok(window.document.querySelector('[data-org-tree-select="child"]'));
    assert.equal(window.document.querySelector('[data-org-tree-add="parent"]'), null);
    assert.equal(api.state().saveState, 'clean');
});

test('HR org tree quick actions open child add and node action menu', () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 },
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
    ]);
    api.renderCanvas();
    api.setView('tree');

    click(window, window.document.querySelector('[data-org-tree-add="parent"]'));
    assert.ok(window.document.querySelector('.form-modal-overlay'));
    assert.match(window.document.querySelector('.form-modal-overlay').textContent, /Новий дочірній вузол/);
    assert.equal(window.document.querySelector('[data-org-tree-add-menu="parent"]'), null);
    window.document.querySelector('.form-modal-overlay')?.remove();

    click(window, window.document.querySelector('[data-org-tree-more="parent"]'));
    const moreMenu = window.document.querySelector('[data-org-tree-more-menu="parent"]');
    assert.equal(moreMenu.classList.contains('hidden'), false);
    assert.match(moreMenu.textContent, /Перейменувати/);
    assert.match(moreMenu.textContent, /Сусідній вузол/);
});

test('HR org undo returns to saved revision as clean state', () => {
    const { api, window } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 }
    ]);
    api.renderCanvas();

    const added = api.add({ relation: 'child', sourceId: 'parent', title: 'Temp child' });
    assert.equal(added.parentId, 'parent');
    assert.equal(api.state().saveState, 'changed');

    api.undo();
    assert.equal(api.nodes().length, 1);
    assert.equal(api.state().saveState, 'saved');
    assert.equal(window.document.getElementById('btnSaveCompanyStructure').disabled, true);
});

test('HR org tree search can select by staff name and keeps the inspector on a visible node', () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 },
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
    ]);
    api.setStaff([{ id: 12, name: 'QA Tree Staff', company_structure_node_id: 'child' }]);
    api.renderCanvas();
    api.setView('tree');

    api.search('Tree Staff');

    assert.ok(window.document.querySelector('[data-org-tree-select="child"]'));
    assert.equal(window.document.querySelector('[data-org-tree-select="child"]').getAttribute('aria-selected'), 'true');
    assert.ok(window.document.querySelector('[data-org-tree-select="child"]').classList.contains('is-search-match'));
    assert.equal(window.document.getElementById('hrOrgDetailTitle').textContent, 'Child');
});

test('HR org archive filter preserves visible active descendants and can find archived nodes', () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Archived Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40, archived: true },
        { id: 'child', title: 'Active Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
    ]);
    api.renderCanvas();
    api.setView('tree');

    assert.ok(window.document.querySelector('[data-org-tree-select="parent"]'));
    assert.ok(window.document.querySelector('[data-org-tree-select="child"]'));
    assert.ok(window.document.querySelector('[data-org-tree-row="parent"]').classList.contains('is-archived'));
    assert.equal(window.document.getElementById('hrOrgDetailTitle').textContent, 'Active Child');

    api.setArchiveFilter('archived');
    assert.ok(window.document.querySelector('[data-org-tree-select="parent"]'));
    assert.equal(window.document.querySelector('[data-org-tree-select="child"]'), null);

    api.search('Archived Parent');
    assert.ok(window.document.querySelector('[data-org-tree-select="parent"]'));
    assert.equal(window.document.querySelector('[data-org-tree-select="parent"]').getAttribute('aria-selected'), 'true');

    api.setArchiveFilter('all');
    api.search('Active Child');
    assert.ok(window.document.querySelector('[data-org-tree-select="parent"]'));
    assert.ok(window.document.querySelector('[data-org-tree-select="child"]'));
    assert.equal(window.document.querySelector('[data-org-tree-select="child"]').getAttribute('aria-selected'), 'true');
});

test('HR org node inspector presents manager content before collapsed system information', () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent Division', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 },
        { id: 'child', title: 'Long Child Division Name For Readability', description: 'Owns daily operations.', tone: 'purple', lane: 'operations', parentId: 'parent', order: 2, x: 100, y: 180, displayGroup: 'sales' }
    ]);
    api.setProfessions([{ key: 'manager', title: 'Operations Manager', structure_node_id: 'child', is_active: true }]);
    api.setStaff([{ id: 77, name: 'Ada Manager', role_type: 'lead', phone: '+380000000000', company_structure_node_id: 'child' }]);
    api.renderCanvas();

    click(window, window.document.querySelector('[data-org-tree-select="child"]'));

    const inspector = window.document.getElementById('hrOrgInspector');
    assert.equal(window.document.getElementById('hrOrgDetailTitle').textContent, 'Long Child Division Name For Readability');
    assert.match(window.document.getElementById('hrOrgDetailType').textContent, /Операційний контур|Operations|Контур/);
    assert.match(window.document.getElementById('hrOrgDetailText').textContent, /Owns daily operations/);
    assert.match(window.document.getElementById('hrOrgDetailParent').textContent, /Parent Division/);
    assert.match(window.document.getElementById('hrOrgDetailProfessions').textContent, /Operations Manager/);
    assert.match(window.document.getElementById('hrOrgDetailStaff').textContent, /Ada Manager/);
    assert.ok(inspector.querySelector('#hrOrgInspectorActions'));
    assert.ok(inspector.querySelector('#hrOrgSystemInfo'));
    assert.equal(window.document.getElementById('hrOrgSystemInfo').open, false);
    assert.match(window.document.getElementById('hrOrgDetailMeta').textContent, /ID/);
    assert.match(window.document.getElementById('hrOrgDetailMeta').textContent, /Parent/);
    assert.match(window.document.getElementById('hrOrgDetailMeta').textContent, /Display group/);
    assert.match(window.document.getElementById('hrOrgDetailMeta').textContent, /Авто-layout/);
});

test('HR org tree keeps keyboard focus and selection attributes after rerender', () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 },
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
    ]);
    api.renderCanvas();
    api.setView('tree');

    const parentButton = window.document.querySelector('[data-org-tree-select="parent"]');
    const toggle = window.document.querySelector('[data-org-tree-toggle="parent"]');
    parentButton.focus();
    parentButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(window.document.activeElement.dataset.orgTreeSelect, 'child');

    toggle.focus();
    click(window, toggle);
    assert.equal(window.document.activeElement.dataset.orgTreeSelect, 'parent');
    assert.equal(window.document.querySelector('[data-org-tree-select="parent"]').getAttribute('aria-selected'), 'true');
    assert.equal(window.document.querySelector('[data-org-tree-select="parent"]').tabIndex, 0);
});

test('HR org mobile inspector behaves as an accessible dialog and returns focus', () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'parent', title: 'Parent', description: 'Parent role.', tone: 'gold', lane: 'root', parentId: null, order: 1, x: 100, y: 40 },
        { id: 'child', title: 'Child', description: 'Child role.', tone: 'blue', lane: 'leadership', parentId: 'parent', order: 2, x: 100, y: 180 }
    ]);
    api.renderCanvas();
    api.setView('tree');
    api.setMobile(true);

    const childButton = window.document.querySelector('[data-org-tree-select="child"]');
    childButton.focus();
    click(window, childButton);

    const inspector = window.document.getElementById('hrOrgInspector');
    assert.equal(inspector.getAttribute('role'), 'dialog');
    assert.equal(inspector.getAttribute('aria-modal'), 'true');
    assert.equal(inspector.getAttribute('aria-hidden'), 'false');
    assert.equal(window.document.querySelector('.hr-org-main').inert, true);
    assert.ok(window.document.body.classList.contains('hr-org-inspector-lock'));

    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(inspector.getAttribute('aria-hidden'), 'true');
    assert.equal(window.document.querySelector('.hr-org-main').inert, false);
    assert.equal(window.document.activeElement.dataset.orgTreeSelect, 'child');
});

test('HR org inspector CSS resets the legacy two-column grid and dark mode avoids inverted variables', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8');
    const lateDetailCss = css.slice(css.indexOf('/* HR company structure workspace */'));
    const orgWorkspaceCss = lateDetailCss.slice(0, lateDetailCss.indexOf('/* Profession checklist templates and dashboard */'));
    const detailRule = lateDetailCss.match(/\.hr-org-detail\s*\{[\s\S]*?\n\}/)?.[0] || '';
    const darkTokensRule = lateDetailCss.match(/body\.dark-mode \.hr-org-chart-card\s*\{[\s\S]*?\n\}/)?.[0] || '';
    const saveDisabledRule = lateDetailCss.match(/#btnSaveCompanyStructure:disabled,[\s\S]*?#btnSaveCompanyStructure:disabled:focus-visible\s*\{[\s\S]*?\n\}/)?.[0] || '';

    assert.match(detailRule, /display:\s*block/);
    assert.match(detailRule, /grid-template-columns:\s*none/);
    assert.match(detailRule, /width:\s*100%/);
    assert.doesNotMatch(detailRule, /minmax\(0,\s*1fr\)\s+auto/);
    assert.match(lateDetailCss, /\.hr-org-detail-meta\s*\{[\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(darkTokensRule, /--hr-org-surface:\s*#111827/);
    assert.match(darkTokensRule, /--hr-org-text:\s*#F8FAFC/);
    assert.match(lateDetailCss, /\.hr-org-tree\s*\{[\s\S]*?background:\s*var\(--hr-org-surface\)/);
    assert.match(lateDetailCss, /\.hr-org-detail\s*\{[\s\S]*?background:\s*var\(--hr-org-surface\)/);
    assert.match(lateDetailCss, /@media \(max-width:\s*1100px\)/);
    assert.doesNotMatch(orgWorkspaceCss, /@media \(max-width:\s*1050px\)/);
    assert.doesNotMatch(darkTokensRule, /var\(--gray-900\)/);
    assert.doesNotMatch(orgWorkspaceCss, /var\(--primary-500\)|var\(--danger-500\)/);
    assert.match(saveDisabledRule, /cursor:\s*not-allowed/);
    assert.match(saveDisabledRule, /opacity:\s*1/);
    assert.match(saveDisabledRule, /background:\s*var\(--hr-org-surface-muted\)/);
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
        width: node.tone === 'gold' ? 180 : 142,
        height: node.tone === 'gold' ? 96 : 84
    }));
    rects.forEach((a, index) => {
        rects.slice(index + 1).forEach(b => {
            const overlap = a.x < b.x + b.width + 16
                && a.x + a.width + 16 > b.x
                && a.y < b.y + b.height + 18
                && a.y + a.height + 18 > b.y;
            assert.equal(overlap, false, `${a.id} should not overlap ${b.id}`);
        });
    });
});

test('HR org auto-arrange changes coordinates without changing parentId', async () => {
    const { window, api } = createHarness();
    api.setNodes([
        { id: 'director', title: 'Director', description: 'Root.', tone: 'gold', lane: 'root', parentId: null, order: 1, stack: null, meta: 'root', x: 0, y: 0 },
        { id: 'deputy_director', title: 'Deputy', description: 'Deputy.', tone: 'blue', lane: 'deputy', parentId: 'director', order: 2, stack: null, meta: 'ops', x: 0, y: 0 },
        { id: 'art_director', title: 'Art director', description: 'Art.', tone: 'purple', lane: 'leadership', parentId: 'deputy_director', order: 3, stack: 'art', meta: 'art', x: 0, y: 0 },
        { id: 'animators', title: 'Animators', description: 'Programs.', tone: 'purple', lane: 'operations', parentId: 'art_director', order: 4, stack: null, meta: 'programs', x: 0, y: 0 },
        { id: 'admins', title: 'Admins', description: 'Hall.', tone: 'purple', lane: 'leadership', parentId: 'art_director', order: 5, stack: 'art', meta: 'hall', x: 0, y: 0 },
        { id: 'barista', title: 'Barista', description: 'Bar.', tone: 'purple', lane: 'operations', parentId: null, order: 6, stack: null, meta: 'bar', x: 0, y: 0 },
        { id: 'chef', title: 'Chef', description: 'Kitchen.', tone: 'violet', lane: 'support', parentId: 'deputy_director', order: 7, stack: 'kitchen', meta: 'kitchen', x: 0, y: 0 },
        { id: 'cooks', title: 'Cooks', description: 'Kitchen team.', tone: 'violet', lane: 'support', parentId: 'chef', order: 8, stack: 'kitchen', meta: 'production', x: 0, y: 0 }
    ]);
    api.renderCanvas();
    const parentsBefore = new Map(api.nodes().map(node => [node.id, node.parentId]));

    click(window, window.document.getElementById('hrOrgAutoLayoutBtn'));
    await settle();

    const byId = new Map(api.nodes().map(node => [node.id, node]));
    api.nodes().forEach(node => assert.equal(node.parentId, parentsBefore.get(node.id), node.id));
    assert.equal(byId.get('barista').parentId, null);

    assert.ok(Number(byId.get('director').y) < Number(byId.get('deputy_director').y));
    assert.ok(Number(byId.get('deputy_director').y) < Number(byId.get('art_director').y));
    assert.ok(Number(byId.get('art_director').y) < Number(byId.get('animators').y));
    assert.ok(window.document.querySelector('.hr-org-link-group[data-org-link-child="animators"]'));
    assert.ok(window.document.querySelector('.hr-org-link-group[data-org-link-child="cooks"]'));
    assert.equal(api.state().saveState, 'changed');
});
