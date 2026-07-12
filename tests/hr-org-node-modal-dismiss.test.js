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
                        '<input id="teamSearch">',
                        '<label><input type="checkbox" id="teamArchiveSearch"> Шукати в архіві</label>',
                        '<div id="teamFilterInfo"></div>',
                        '<div id="teamMissingBanner"></div>',
                        '<div id="teamGrid"></div>'
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

                return {
                    setupDom,
                    render: filterAndRenderTeam,
                    setBucket: bucket => window.setPeopleBucket(bucket),
                    setSetupFilter: filter => window.setTeamSetupFilter(filter),
                    search(value, archive = false) {
                        document.getElementById('teamSearch').value = value;
                        document.getElementById('teamArchiveSearch').checked = archive;
                        filterAndRenderTeam();
                    },
                    grid: () => document.getElementById('teamGrid'),
                    info: () => document.getElementById('teamFilterInfo').textContent,
                    bannerText: () => document.getElementById('teamMissingBanner')?.textContent || '',
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

test('HR team bucket navigation renders one bucket and searches globally with archive semantics', () => {
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
    assert.match(api.bannerText(), /Без фото профілю/);
    assert.match(api.bannerText(), /Без камери/);
    assert.match(api.bannerText(), /Без CRM/);

    api.setSetupFilter('missing_face');
    assert.deepEqual([...api.cardNames()], ['Reserve Beta']);
    assert.equal(api.grid().dataset.peopleMode, 'setup');
    assert.equal(api.grid().querySelector('[data-card-bucket="reserve"]')?.textContent.includes('Резерв'), true);
    assert.match(api.info(), /Без камери/);

    api.setSetupFilter('missing_crm');
    assert.deepEqual([...api.cardNames()], ['Blacklist Delta']);
    assert.equal(api.grid().querySelector('[data-card-bucket="blacklist"]')?.textContent.includes('Чорний список'), true);
    assert.match(api.info(), /Без CRM/);

    api.setSetupFilter('all');
    assert.deepEqual([...api.cardIds()], ['1']);

    api.search('Reserve Beta');
    assert.deepEqual([...api.cardNames()], ['Reserve Beta']);
    assert.equal(api.grid().querySelector('[data-card-bucket="reserve"]')?.textContent.includes('Резерв'), true);
    assert.match(api.info(), /1 .*Резерв/);

    api.search('Dismissed Gamma', false);
    assert.deepEqual([...api.cardIds()], []);
    assert.match(api.info(), /0/);

    api.search('Dismissed Gamma', true);
    assert.deepEqual([...api.cardNames()], ['Dismissed Gamma']);
    assert.equal(api.grid().querySelector('[data-card-bucket="dismissed"]')?.textContent.includes('Звільнені'), true);

    api.search('', false);
    api.setBucket('dismissed');
    assert.deepEqual([...api.cardNames()], ['Dismissed Gamma']);
    assert.equal(api.nav('dismissed').getAttribute('aria-pressed'), 'true');
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
    assert.match(closeCss, /width:\s*38px/);
    assert.equal(document.getElementById('editCancel'), null, 'persistent close button is removed');
    assert.equal(document.querySelector('.hr-staff-profile-bottom-actions'), null, 'persistent profile footer is removed');
});

test('HR staff profile save actions isolate payloads and expose modal action states', () => {
    const js = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const profileCss = fs.readFileSync(path.join(ROOT, 'css', 'hr-page.css'), 'utf8');
    const foundationCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-hr-foundation.css'), 'utf8');
    const mainBuilder = js.slice(js.indexOf('function buildStaffMainPayload'), js.indexOf('function buildStaffWorkPayload'));
    const workBuilder = js.slice(js.indexOf('function buildStaffWorkPayload'), js.indexOf('function buildStaffRatesPayload'));
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
    assert.match(js, /markStaffProfileScopesClean\(\[scope\]\)/);
    assert.match(js, /payrollSave\.textContent = 'Зберегти оплату'/);
    assert.match(profileCss, /#staffEditModal \.hr-staff-action,[\s\S]*?min-height:\s*44px/);
    assert.match(profileCss, /\[data-action-state="loading"\]/);
    assert.match(profileCss, /\[data-action-state="success"\]/);
    assert.match(profileCss, /\[data-action-state="error"\]/);
    assert.match(foundationCss, /\.hr-staff-foundation-actions button,[\s\S]*?min-height:\s*44px/);
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
    assert.equal(moved.x, 400);
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
