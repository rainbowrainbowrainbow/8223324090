#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'hr-team-browser-smoke');
const HEADLESS = process.env.HR_TEAM_BROWSER_SMOKE_HEADLESS !== 'false';

function fail(message) {
    console.error(`HR Team browser smoke failed: ${message}`);
    process.exit(1);
}

function readRepo(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const nodeModulesDir = path.dirname(normalized);
            const packageDir = path.join(nodeModulesDir, 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

const UI_CODE = readRepo('js', 'ui.js');
const HR_CODE = readRepo('js', 'hr-page.js');
const HR_HTML = readRepo('hr.html');
const CSS_BUNDLE = [
    readRepo('css', 'base.css'),
    readRepo('css', 'modals.css'),
    readRepo('css', 'hr-page.css'),
    readRepo('css', 'pages-hr-foundation.css'),
    readRepo('css', 'pages-hr-staff.css')
].join('\n');

function extractElementMarkup(source, id) {
    const marker = `<div id="${id}"`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`Unable to find #${id} in production markup`);

    const divTag = /<\/?div\b[^>]*>/gi;
    divTag.lastIndex = start;
    let depth = 0;
    let match;
    while ((match = divTag.exec(source))) {
        if (/^<div\b/i.test(match[0])) depth += 1;
        else depth -= 1;
        if (depth === 0) return source.slice(start, divTag.lastIndex);
    }
    throw new Error(`Unable to extract #${id} from production markup`);
}

const STAFF_EDIT_MODAL_HTML = extractElementMarkup(HR_HTML, 'staffEditModal');

const HARNESS_CODE = String.raw`
(() => {
    const staffProfiles = new Map([
        [1, { id: 1, name: 'QA Codex Schedule Replacement', role_type: 'animator', secondary_professions: [], phone: '+380111', photo_url: '/uploads/worker.jpg', hourly_rate: 100, rate_unit: 'hour', company_structure_node_id: 'animators', has_face_descriptor: true, has_account: true, training_readiness: { total: 4, completed: 4, percent: 100 }, onboarding_assignment: { responsible_user_id: 7, responsible_name: 'HR Lead', percent: 100, training_status: 'completed' }, skills: [] }],
        [2, { id: 2, name: 'QA Reserve Beta', role_type: 'technician', secondary_professions: [], phone: '+380222', photo_url: '/uploads/reserve.jpg', hourly_rate: 120, rate_unit: 'hour', hr_pool_status: 'reserve', company_structure_node_id: 'tech', has_face_descriptor: false, has_account: true, training_readiness: { total: 3, completed: 0, percent: 0 }, onboarding_assignment: { responsible_user_id: 7, responsible_name: 'HR Lead', percent: 20, training_status: 'in_progress' }, skills: [] }],
        [3, { id: 3, name: 'QA Intern Gamma', role_type: 'intern', secondary_professions: [], phone: '+380333', photo_url: '/uploads/intern.jpg', hourly_rate: 90, rate_unit: 'hour', company_structure_node_id: 'interns', has_face_descriptor: true, has_account: true, training_readiness: { total: 2, completed: 1, percent: 50 }, skills: [] }],
        [4, { id: 4, name: 'QA Blacklist Delta', role_type: 'animator', secondary_professions: [], phone: '+380444', photo_url: '', hourly_rate: 80, rate_unit: 'hour', hr_pool_status: 'blacklisted', blacklist_reason: 'QA contract', company_structure_node_id: null, has_face_descriptor: true, has_account: false, training_readiness: { total: 1, completed: 1, percent: 100 }, skills: [] }],
        [5, { id: 5, name: 'QA Dismissed Epsilon', role_type: 'animator', secondary_professions: [], phone: '+380555', photo_url: '', hourly_rate: 70, rate_unit: 'hour', is_active: false, company_structure_node_id: null, has_face_descriptor: false, has_account: false, training_readiness: { total: 0, completed: 0, percent: 0 }, skills: [] }]
    ]);
    const pendingProfiles = new Map();
    const pendingHistory = new Map();
    const pendingLazyTabs = new Map();
    const pendingStaffUpdates = [];
    const requestCounts = new Map();
    const staffUpdates = [];
    const workspaceOperations = [];
    const downloads = [];
    const offboardingSubmissions = [];
    const workspace = { documents: [], medical: [], resources: [] };
    const payrollProfiles = [{
        id: 901,
        title: 'QA Animator Base',
        profession_key: 'animator',
        professionKey: 'animator',
        profession_title: 'Аніматор',
        profile_kind: 'shared',
        profileKind: 'shared',
        status: 'active',
        is_default_for_profession: true,
        isDefaultForProfession: true,
        affected_staff_count: 1,
        affectedStaffCount: 1,
        active_assignment_count: 0,
        activeAssignmentCount: 0,
        default_staff_count: 1,
        defaultStaffCount: 1,
        current_version: {
            id: 9011,
            profile_id: 901,
            profileId: 901,
            version_number: 1,
            versionNumber: 1,
            rate_unit: 'hour',
            rateUnit: 'hour',
            default_rate: 150,
            defaultRate: 150,
            effective_from: '2026-07-01',
            effectiveFrom: '2026-07-01',
            effective_to: null,
            effectiveTo: null,
            day_rates: [{ iso_weekday: 6, isoWeekday: 6, rate: 200 }],
            dayRates: [{ iso_weekday: 6, isoWeekday: 6, rate: 200 }]
        },
        currentVersion: null,
        latest_version: null,
        latestVersion: null,
        versions: []
    }];
    payrollProfiles[0].currentVersion = payrollProfiles[0].current_version;
    payrollProfiles[0].latest_version = payrollProfiles[0].current_version;
    payrollProfiles[0].latestVersion = payrollProfiles[0].current_version;
    payrollProfiles[0].versions = [payrollProfiles[0].current_version];
    let holdProfileLoads = false;
    let holdHistoryLoads = false;
    let holdLazyTabLoads = false;
    let holdStaffUpdates = false;
    let failNextStaffUpdate = false;
    let failNextWorkspaceRequest = '';
    let nextWorkspaceId = 1000;

    function resetWorkspace() {
        workspace.documents = [];
        workspace.medical = [];
        workspace.resources = [];
        workspaceOperations.length = 0;
        downloads.length = 0;
        offboardingSubmissions.length = 0;
        failNextWorkspaceRequest = '';
        nextWorkspaceId = 1000;
    }

    function copyWorkspaceRows(rows) {
        return rows.map(row => ({ ...row }));
    }

    function shouldFailWorkspaceRequest(requestPath) {
        if (!failNextWorkspaceRequest || !String(requestPath).includes(failNextWorkspaceRequest)) return false;
        failNextWorkspaceRequest = '';
        return true;
    }

    function profileResponse(id) {
        const profile = staffProfiles.get(Number(id));
        return profile
            ? { success: true, data: { ...profile, name: 'Fresh ' + profile.name, phone: profile.phone + '-fresh' } }
            : { success: false, error: 'missing profile' };
    }

    function deferredProfile(id) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        pendingProfiles.set(Number(id), { promise, resolve });
        return promise;
    }

    function historyResponse(id) {
        return {
            success: true,
            data: [{
                action: 'staff_schedule_replacement_set',
                performed_by: 'QA staff ' + Number(id),
                created_at: new Date().toISOString(),
                details: { changed_fields: ['note', 'status', 'shiftStart', 'shiftEnd', 'professionKey', 'originalStaffId', 'replacementReason'] }
            }]
        };
    }

    function deferredHistory(id) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        pendingHistory.set(Number(id), { promise, resolve });
        return promise;
    }

    function deferredLazyTab(requestPath) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        pendingLazyTabs.set(String(requestPath), { promise, resolve });
        return promise;
    }

    function staffUpdateResponse(id, body = {}) {
        const profile = staffProfiles.get(Number(id));
        if (!profile) return { success: false, error: 'missing profile' };
        const updated = { ...profile, ...body, id: Number(id) };
        staffProfiles.set(Number(id), updated);
        return { success: true, data: updated };
    }

    function deferredStaffUpdate(id, body) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        pendingStaffUpdates.push({ id: Number(id), body, resolve });
        return promise;
    }

    function lazyTabResponse(requestPath) {
        if (String(requestPath).includes('/offboarding-readiness')) {
            return {
                success: true,
                data: {
                    open_resource_count: 1,
                    open_resources: [{ title: 'QA headset', quantity: 1, due_return_at: '2026-08-01' }],
                    active_account_count: 1,
                    active_accounts: [{ username: 'qa.staff', role: 'animator', is_current_user: false, is_protected: false }],
                    document_alert_count: 1,
                    document_alerts: [{ source: 'document', title: 'QA medical book', expires_at: '2026-08-10' }],
                    disable_available: false,
                    disable_blockers: [{ username: 'qa.staff', block_reason: 'requires_manage_accounts' }]
                }
            };
        }
        return { success: true, data: [] };
    }

    function setupDom() {
        document.body.innerHTML = [
            '<nav id="hrNav" class="hr-nav hr-nav--people" aria-label="team buckets">',
            '<button type="button" class="hr-tab" data-tab="team" data-bucket="workers">Робітники <span data-nav-count="workers">0</span></button>',
            '<button type="button" class="hr-tab" data-tab="team" data-bucket="interns">Стажери <span data-nav-count="interns">0</span></button>',
            '<button type="button" class="hr-tab" data-tab="team" data-bucket="blacklist">Чорний список <span data-nav-count="blacklist">0</span></button>',
            '<button type="button" class="hr-tab" data-tab="team" data-bucket="reserve">Резерв <span data-nav-count="reserve">0</span></button>',
            '<button type="button" class="hr-tab" data-tab="team" data-bucket="dismissed">Звільнені <span data-nav-count="dismissed">0</span></button>',
            '</nav>',
            '<main id="tab-team" class="hr-tab-content active">',
            '<div class="hr-team-controls"><div class="hr-team-filter-row">',
            '<input id="teamSearch" class="hr-team-search" aria-label="Пошук">',
            '<div id="teamFilterInfo" class="hr-team-filter-info" aria-live="polite"></div>',
            '</div></div>',
            '<div id="teamGrid" class="hr-team-grid"></div>',
            '</main>',
            window.__hrTeamBrowserModalMarkup,
            '<button id="outsideButton">outside</button>'
        ].join('');
        initModals();
    }

    canManage = true;
    AppState = window.AppState;
    hrProfessions = [
        { key: 'animator', title: 'Аніматор', is_active: true },
        { key: 'technician', title: 'Технік', is_active: true },
        { key: 'intern', title: 'Стажер', is_active: true }
    ];
    companyStructureNodes = [
        { id: 'animators', title: 'Аніматори' },
        { id: 'tech', title: 'Технічний відділ' },
        { id: 'interns', title: 'Стажери' }
    ];
    ensureProfessionsLoaded = async () => hrProfessions;
    ensureCompanyStructureNodesLoaded = async () => companyStructureNodes;
    crmApiFetch = async () => ({ success: true, data: [] });
    hrFetch = async (path, options = {}) => {
        const requestPath = String(path);
        requestCounts.set(requestPath, Number(requestCounts.get(requestPath) || 0) + 1);
        const profileMatch = String(path).match(/^\/staff\/(\d+)$/);
        if (profileMatch) {
            const id = Number(profileMatch[1]);
            if (String(options?.method || '').toUpperCase() === 'PUT') {
                const body = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body || {});
                staffUpdates.push({ path: requestPath, body });
                if (failNextStaffUpdate) {
                    failNextStaffUpdate = false;
                    return { success: false, error: 'simulated staff update failure' };
                }
                if (holdStaffUpdates) return deferredStaffUpdate(id, body);
                return staffUpdateResponse(id, body);
            }
            if (holdProfileLoads) return deferredProfile(id);
            return profileResponse(id);
        }
        const historyMatch = requestPath.match(/^\/staff\/(\d+)\/history/);
        if (historyMatch) {
            const id = Number(historyMatch[1]);
            if (holdHistoryLoads) return deferredHistory(id);
            return historyResponse(id);
        }
        if (String(path).includes('/lifecycle-checklist')) {
            return { success: true, data: { staff: { id: Number(activeEditStaffId()), is_active: true }, summary: { offboarding_started: false }, metrics: { active_account_count: 1, face_descriptor_count: 1, readiness_percent: 50, future_schedule_count: 2, open_time_record_count: 1, open_payroll_count: 0 }, sections: [] } };
        }
        const workspacePath = requestPath.split('?')[0];
        const workspaceMatch = workspacePath.match(/^\/staff\/(\d+)\/(documents|medical-book|resources)(?:\/(\d+)(\/return)?)?$/);
        if (workspaceMatch) {
            const [, , workspaceSection, itemId, returnSuffix] = workspaceMatch;
            const method = String(options?.method || 'GET').toUpperCase();
            if (method === 'GET' && holdLazyTabLoads) return deferredLazyTab(requestPath);
            if (method === 'GET' && shouldFailWorkspaceRequest(requestPath)) {
                return { success: false, error: 'simulated ' + workspaceSection + ' load failure' };
            }
            if (method !== 'GET' && shouldFailWorkspaceRequest(requestPath)) {
                return { success: false, error: 'simulated ' + workspaceSection + ' write failure' };
            }
            if (workspaceSection === 'documents') {
                if (method === 'GET') return { success: true, data: copyWorkspaceRows(workspace.documents.filter(row => requestPath.includes('include_archived=true') || row.status !== 'archived')) };
                if (method === 'POST') {
                    const form = options.body;
                    const file = form?.get?.('document');
                    const row = {
                        id: nextWorkspaceId++,
                        title: form?.get?.('title') || file?.name || 'QA document',
                        original_name: file?.name || 'qa-document.txt',
                        document_type: form?.get?.('document_type') || 'other',
                        file_size: file?.size || 12,
                        notes: form?.get?.('notes') || '',
                        issued_at: null,
                        expires_at: null,
                        status: 'active',
                        uploaded_by: 'QA HR',
                        created_at: '2026-07-12T09:00:00.000Z'
                    };
                    workspace.documents.push(row);
                    workspaceOperations.push('document-upload');
                    return { success: true, data: { ...row } };
                }
                if (method === 'DELETE') {
                    const index = workspace.documents.findIndex(row => Number(row.id) === Number(itemId));
                    if (index < 0) return { success: false, error: 'missing document' };
                    const archived = workspace.documents[index];
                    archived.status = 'archived';
                    archived.archived_by = 'QA HR';
                    archived.archived_at = '2026-07-12T10:00:00.000Z';
                    workspaceOperations.push('document-archive');
                    return { success: true, data: { ...archived, archived_at: new Date().toISOString() } };
                }
            }
            if (workspaceSection === 'medical-book') {
                if (method === 'GET') return { success: true, data: copyWorkspaceRows(workspace.medical) };
                if (method === 'POST') {
                    const row = { id: nextWorkspaceId++, ...(options.body || {}), status: 'active' };
                    workspace.medical.unshift(row);
                    workspaceOperations.push('medical-save');
                    return { success: true, data: { ...row } };
                }
            }
            if (workspaceSection === 'resources') {
                if (method === 'GET') return { success: true, data: copyWorkspaceRows(workspace.resources.filter(row => requestPath.includes('include_returned=true') || row.status === 'issued')) };
                if (method === 'POST') {
                    const row = { id: nextWorkspaceId++, ...(options.body || {}), status: 'issued', issued_by: 'QA HR', issued_at: '2026-07-12' };
                    workspace.resources.unshift(row);
                    workspaceOperations.push('resource-issue:' + row.resource_kind);
                    return { success: true, data: { ...row } };
                }
                if (method === 'PUT' && returnSuffix === '/return') {
                    const row = workspace.resources.find(item => Number(item.id) === Number(itemId));
                    if (!row) return { success: false, error: 'missing resource assignment' };
                    row.status = 'returned';
                    row.returned_by = 'QA HR';
                    row.returned_at = '2026-07-13';
                    workspaceOperations.push('resource-return');
                    return { success: true, data: { ...row } };
                }
            }
            return { success: false, error: 'unsupported workspace request' };
        }
        if (String(path).includes('/resource-options')) {
            if (shouldFailWorkspaceRequest(requestPath)) return { success: false, error: 'simulated resource options failure' };
            const kind = requestPath.includes('kind=costume') ? 'costume' : 'warehouse_stock';
            const label = kind === 'costume' ? 'QA Costume' : 'QA Warehouse Item';
            return { success: true, data: [{ id: kind + '-qa', label, subtitle: 'QA available' }] };
        }
        if (String(path).includes('/offboarding') && String(options?.method || 'GET').toUpperCase() === 'POST') {
            offboardingSubmissions.push({ path: requestPath, body: { ...(options.body || {}) } });
            workspaceOperations.push('offboarding-complete');
            return { success: true, open_resource_count: 0, disabled_accounts: 0 };
        }
        if (String(path).includes('/offboarding-readiness') || String(path).includes('/offboarding')) {
            return holdLazyTabLoads ? deferredLazyTab(requestPath) : lazyTabResponse(requestPath);
        }
        if (String(path).includes('/role-assignments')) return { success: true, data: [] };
        if (String(path).includes('/shift-preferences')) return { success: true, data: [] };
        if (String(path).includes('/payroll-profiles?include_archived=true')) return { success: true, data: payrollProfiles.map(profile => ({ ...profile })) };
        if (String(path).includes('/payroll-profile-assignments?include_past=true')) {
            const staffId = Number(String(path).match(/\/staff\/(\d+)\/payroll-profile-assignments/)?.[1] || 0);
            return { success: true, data: { staff: { id: staffId, name: staffProfiles.get(staffId)?.name || 'QA staff' }, assignments: [] } };
        }
        if (String(path).includes('/payroll-scheme')) return { success: true, data: { fallback_hourly_rate: 100, fallback_rate_unit: 'hour' } };
        if (String(path).includes('/salary?')) {
            return {
                success: true,
                data: [{
                    staff_id: Number(activeEditStaffId()),
                    staffId: Number(activeEditStaffId()),
                    staff_name: 'QA payroll staff',
                    days_worked: 1,
                    hours_worked: 2,
                    planned_days: 1,
                    base_salary: 300,
                    overtime_pay: 0,
                    total_salary: 300,
                    profession_rate_summary: [{
                        profession_key: 'animator',
                        work_date: '2026-07-18',
                        rate: 150,
                        rate_unit: 'hour',
                        hours: 2,
                        amount: 300,
                        rate_source: 'payroll_profile.default.default_rate',
                        profile_id: 901,
                        profile_title: 'QA Animator Base',
                        profile_version_id: 9011,
                        applied_rule: 'default_rate',
                        formula: '2h × 150'
                    }]
                }]
            };
        }
        return { success: true, data: [] };
    };

    window.apiFetchWithAuthRetry = async requestPath => {
        if (String(requestPath).includes('/documents/') && String(requestPath).includes('/download')) {
            workspaceOperations.push('document-download');
            return {
                ok: true,
                blob: async () => new Blob(['QA document'], { type: 'text/plain' })
            };
        }
        return { ok: false, json: async () => ({ error: 'unexpected download request' }) };
    };
    window.finishBlobDownload = (_blob, filename) => {
        downloads.push(String(filename || 'staff-document'));
        return null;
    };

    const productionConfirmModal = confirmModal;
    loadTeam = async () => filterAndRenderTeam();

    window.__hrTeamBrowserSmoke = {
        setup({ dark = false } = {}) {
            setupDom();
            window.__notifications.length = 0;
            showNotification = (message, type = 'info') => window.__notifications.push({ message, type });
            requestCounts.clear();
            pendingHistory.clear();
            holdHistoryLoads = false;
            pendingLazyTabs.clear();
            holdLazyTabLoads = false;
            pendingStaffUpdates.length = 0;
            staffUpdates.length = 0;
            holdStaffUpdates = false;
            failNextStaffUpdate = false;
            resetWorkspace();
            document.body.classList.toggle('dark-mode', Boolean(dark));
            teamStaff = Array.from(staffProfiles.values()).map(item => ({ is_active: true, hr_pool_status: 'core', ...item }));
            activePeopleBucket = 'workers';
            pendingPeopleBucket = null;
            filterAndRenderTeam();
            const search = document.getElementById('teamSearch');
            if (search) search.oninput = filterAndRenderTeam;
        },
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
        searchValue: () => document.getElementById('teamSearch').value,
        activeBucket: () => activePeopleBucket,
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
        resetRoleVisibility() {
            window.HrTeamBucketAccess = null;
            AppState.currentUser = { ...AppState.currentUser, role: 'creator' };
            activePeopleBucket = 'workers';
            pendingPeopleBucket = null;
            document.getElementById('teamSearch').value = '';
            filterAndRenderTeam();
        },
        open: id => openStaffEdit(id),
        openTab: tab => activateStaffProfileTab(tab),
        startTab(tab) {
            activateStaffProfileTab(tab).catch(err => { window.__tabError = err.message; });
        },
        requestCount(fragment) {
            return Array.from(requestCounts.entries())
                .filter(([requestPath]) => requestPath.includes(String(fragment)))
                .reduce((total, [, count]) => total + Number(count || 0), 0);
        },
        workspaceOperations: () => workspaceOperations.slice(),
        downloads: () => downloads.slice(),
        offboardingSubmissions: () => offboardingSubmissions.map(item => ({ path: item.path, body: { ...item.body } })),
        notifications: () => window.__notifications.map(item => ({ ...item })),
        disableConfirmationImplementation() { confirmModal = undefined; },
        restoreConfirmationImplementation() { confirmModal = productionConfirmModal; },
        failNextWorkspaceRequest(fragment) {
            failNextWorkspaceRequest = String(fragment || '');
        },
        close: () => closeHrEditableModal('staffEditModal'),
        staffUpdates: () => staffUpdates.map(item => ({ path: item.path, body: { ...item.body } })),
        enableStaffUpdateHold() { holdStaffUpdates = true; },
        failNextStaffUpdate() { failNextStaffUpdate = true; },
        resolveStaffUpdates() {
            while (pendingStaffUpdates.length) {
                const pending = pendingStaffUpdates.shift();
                pending.resolve(staffUpdateResponse(pending.id, pending.body));
            }
            holdStaffUpdates = false;
        },
        activeId: activeEditStaffId,
        enableProfileHold() {
            holdProfileLoads = true;
            pendingProfiles.clear();
        },
        startRapidOpen() {
            openStaffEdit(1).catch(err => { window.__rapidError = err.message; });
            openStaffEdit(2).catch(err => { window.__rapidError = err.message; });
            openStaffEdit(3).catch(err => { window.__rapidError = err.message; });
        },
        resolveProfile(id) {
            const pending = pendingProfiles.get(Number(id));
            if (pending) pending.resolve(profileResponse(id));
        },
        releaseProfileHold() {
            holdProfileLoads = false;
        },
        enableHistoryHold() {
            holdHistoryLoads = true;
            pendingHistory.clear();
        },
        resolveHistory(id) {
            const pending = pendingHistory.get(Number(id));
            if (pending) pending.resolve(historyResponse(id));
        },
        releaseHistoryHold() {
            holdHistoryLoads = false;
        },
        enableLazyTabHold() {
            holdLazyTabLoads = true;
            pendingLazyTabs.clear();
        },
        resolveLazyTab(fragment) {
            Array.from(pendingLazyTabs.entries())
                .filter(([requestPath]) => requestPath.includes(String(fragment)))
                .forEach(([requestPath, pending]) => {
                    pending.resolve(lazyTabResponse(requestPath));
                    pendingLazyTabs.delete(requestPath);
                });
        },
        releaseLazyTabHold() {
            holdLazyTabLoads = false;
        }
    };
})();
`;

async function installHarness(page, options = {}) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS_BUNDLE}</style></head><body data-page-group="hr"></body></html>`);
    await page.evaluate(markup => {
        window.__hrTeamBrowserModalMarkup = markup;
    }, STAFF_EDIT_MODAL_HTML);
    await page.evaluate(() => {
        window.AppState = { currentUser: { id: 1, role: 'creator', name: 'QA Creator' } };
        window.__notifications = [];
        window.showNotification = (message, type = 'info') => window.__notifications.push({ message, type });
        window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
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
        window.__originalReplaceState = history.replaceState.bind(history);
        history.replaceState = (state, title, url) => {
            window.__lastReplaceStateUrl = String(url || '');
            try {
                window.__originalReplaceState(state, title, url);
            } catch {}
        };
        window.__originalAddEventListener = document.addEventListener.bind(document);
        document.addEventListener = (type, listener, listenerOptions) => {
            if (type === 'DOMContentLoaded') return undefined;
            return window.__originalAddEventListener(type, listener, listenerOptions);
        };
    });
    await page.addScriptTag({ content: UI_CODE });
    await page.addScriptTag({ content: HR_CODE });
    await page.evaluate(() => {
        document.addEventListener = window.__originalAddEventListener;
    });
    await page.addScriptTag({ content: HARNESS_CODE });
    await page.evaluate(setupOptions => window.__hrTeamBrowserSmoke.setup(setupOptions), options);
}

function cardNames(page) {
    return page.locator('#teamGrid .hr-team-name').allTextContents().then(rows => rows.map(text => text.trim()));
}

const CATEGORY_LOCAL_SEARCH_CASES = [
    { bucket: 'workers', title: 'Робітники', ownName: 'QA Codex Schedule Replacement', neighborName: 'QA Blacklist Delta' },
    { bucket: 'interns', title: 'Стажери', ownName: 'QA Intern Gamma', neighborName: 'QA Dismissed Epsilon' },
    { bucket: 'blacklist', title: 'Чорний список', ownName: 'QA Blacklist Delta', neighborName: 'QA Reserve Beta' },
    { bucket: 'reserve', title: 'Резерв', ownName: 'QA Reserve Beta', neighborName: 'QA Codex Schedule Replacement' },
    { bucket: 'dismissed', title: 'Звільнені', ownName: 'QA Dismissed Epsilon', neighborName: 'QA Intern Gamma' }
];

async function assertTeamNavigation(page) {
    assert.deepEqual(await cardNames(page), ['QA Codex Schedule Replacement'], 'active workers bucket renders only worker card');
    assert.equal(await page.locator('#teamGrid .hr-team-card').count(), 1, 'closed bucket cards are not left in DOM');
    assert.equal(await page.locator('.hr-tab[data-bucket="workers"]').getAttribute('aria-pressed'), 'true', 'workers nav has active aria state');
    assert.equal(await page.locator('.hr-tab[data-bucket="reserve"]').getAttribute('aria-pressed'), 'false', 'reserve nav has inactive aria state');

    assert.equal(await page.locator('#teamArchiveSearch').count(), 0, 'dismissed search does not expose an archive checkbox');
    const search = page.locator('#teamSearch');
    for (const current of CATEGORY_LOCAL_SEARCH_CASES) {
        await page.evaluate(bucket => window.__hrTeamBrowserSmoke.setBucket(bucket), current.bucket);
        await search.fill(current.ownName);
        assert.deepEqual(await cardNames(page), [current.ownName], `${current.bucket} finds its own profile`);
        for (const candidate of CATEGORY_LOCAL_SEARCH_CASES) {
            assert.equal(
                await page.locator(`.hr-tab[data-bucket="${candidate.bucket}"]`).getAttribute('aria-pressed'),
                candidate.bucket === current.bucket ? 'true' : 'false',
                `${current.bucket} owns the only active aria state`
            );
        }

        await search.fill(current.neighborName);
        assert.deepEqual(await cardNames(page), [], `${current.bucket} excludes a neighboring category`);
        assert.equal(await page.locator('#teamGrid').getAttribute('data-people-mode'), 'search');
        assert.equal(
            (await page.locator('#teamGrid .hr-people-empty').textContent())?.trim(),
            'Нічого не знайдено в цій категорії. Змініть запит.',
            `${current.bucket} renders the category-local empty state`
        );
        assert.equal((await page.locator('#teamFilterInfo').textContent())?.trim(), `${current.title}: 0 знайдено`);
    }

    await page.evaluate(() => window.__hrTeamBrowserSmoke.setBucket('workers'));
    await search.fill('QA Codex Schedule Replacement');
    await page.evaluate(() => window.__hrTeamBrowserSmoke.setBucket('reserve'));
    assert.equal(await search.inputValue(), '', 'search input clears before rendering a different bucket');
    assert.equal(await page.locator('#teamGrid').getAttribute('data-people-mode'), 'bucket');
    assert.deepEqual(await cardNames(page), ['QA Reserve Beta']);
    assert.equal(await page.locator('.hr-tab[data-bucket="reserve"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.evaluate(() => window.__lastReplaceStateUrl || ''), /#reserve$/, 'bucket navigation writes the canonical reserve hash');

    await search.fill('QA Reserve Beta');
    await page.evaluate(() => window.__hrTeamBrowserSmoke.setBucket('reserve'));
    assert.equal(await search.inputValue(), 'QA Reserve Beta', 'reselecting the active category keeps the query');
    assert.deepEqual(await cardNames(page), ['QA Reserve Beta']);

    await page.evaluate(() => window.__hrTeamBrowserSmoke.setBucket('workers'));
    await search.fill('QA Codex Schedule Replacement');
    await page.evaluate(() => window.__hrTeamBrowserSmoke.activateBucket('blacklist'));
    assert.equal(await search.inputValue(), '', 'activateHrTab clears the query before rendering a different category');
    assert.deepEqual(await cardNames(page), ['QA Blacklist Delta']);
    assert.equal(await page.locator('.hr-tab[data-bucket="blacklist"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.evaluate(() => window.__lastReplaceStateUrl || ''), /#blacklist$/);

    await search.fill('QA Blacklist Delta');
    await page.evaluate(() => window.__hrTeamBrowserSmoke.navigateHash('dismissed'));
    assert.equal(await search.inputValue(), '', 'hash navigation clears the query before rendering a different category');
    assert.deepEqual(await cardNames(page), ['QA Dismissed Epsilon']);
    assert.equal(await page.locator('.hr-tab[data-bucket="dismissed"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.evaluate(() => window.location.hash), /#dismissed$/);

    const roleVisibility = await page.evaluate(() => {
        const api = window.__hrTeamBrowserSmoke;
        const classifications = api.classifications();
        api.search('');
        api.setRoleVisibility('instructor', ['workers', 'interns']);
        const visibleBuckets = api.visibleBuckets();
        const normalizedHiddenBucket = api.normalizeBucket('blacklist');
        api.setBucket('blacklist');
        api.search('QA Blacklist Delta');
        const result = {
            classifications,
            visibleBuckets,
            normalizedHiddenBucket,
            activeBucket: api.activeBucket(),
            cardNames: Array.from(document.querySelectorAll('#teamGrid .hr-team-name')).map(node => node.textContent.trim()),
            pressedBucket: document.querySelector('.hr-tab[aria-pressed="true"]')?.dataset.bucket || ''
        };
        api.resetRoleVisibility();
        return result;
    });
    assert.deepEqual(roleVisibility.classifications, ['1:workers', '2:reserve', '3:interns', '4:blacklist', '5:dismissed']);
    assert.deepEqual(roleVisibility.visibleBuckets, ['workers', 'interns']);
    assert.equal(roleVisibility.normalizedHiddenBucket, 'workers');
    assert.equal(roleVisibility.activeBucket, 'workers');
    assert.deepEqual(roleVisibility.cardNames, [], 'restricted role cannot search a hidden bucket');
    assert.equal(roleVisibility.pressedBucket, 'workers');
}

async function assertCardLayoutAndOverflow(page, options = {}) {
    const longName = page.locator('.hr-team-card[data-staff-id="1"] .hr-team-name');
    const geometry = await longName.evaluate(el => {
        const card = el.closest('.hr-team-card');
        const avatar = card.querySelector('.hr-team-avatar');
        const actions = card.querySelector('.hr-team-card-actions');
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
            cardWidth: card.getBoundingClientRect().width,
            avatarWidth: avatar.getBoundingClientRect().width,
            nameWidth: box.width,
            nameHeight: box.height,
            lineHeight: Number.parseFloat(style.lineHeight),
            overflowWrap: style.overflowWrap,
            wordBreak: style.wordBreak,
            actionTop: actions.getBoundingClientRect().top,
            nameBottom: box.bottom
        };
    });
    assert.ok(
        geometry.nameWidth >= geometry.cardWidth - geometry.avatarWidth - 70,
        `actions do not steal the long-name text column: ${JSON.stringify(geometry)}`
    );
    assert.ok(geometry.nameHeight <= (geometry.lineHeight * 2) + 1, 'long name uses a controlled two-line clamp');
    assert.equal(geometry.overflowWrap, 'break-word', 'long names wrap at word-safe boundaries');
    assert.equal(geometry.wordBreak, 'normal', 'long names do not use per-character word breaking');
    assert.ok(geometry.actionTop >= geometry.nameBottom, 'card actions render below the name instead of compressing it');

    if (options.testOverflow === false) return;

    const trigger = page.locator('.hr-team-card[data-staff-id="1"] .hr-team-overflow-trigger');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('.hr-team-card[data-staff-id="1"] [data-team-card-menu]');
    assert.equal(await menu.isVisible(), true, 'overflow menu opens from the keyboard');
    await page.waitForFunction(() => {
        const activeMenu = document.querySelector('.hr-team-card[data-staff-id="1"] [data-team-card-menu]');
        return activeMenu?.contains(document.activeElement);
    });
    assert.equal(await menu.evaluate(el => el.contains(document.activeElement)), true, 'overflow menu moves focus to its first action');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.hr-team-card[data-staff-id="1"] [data-team-card-menu]')?.hidden === true);
    assert.equal(await menu.isVisible(), false, 'Escape closes the overflow menu');
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true, 'Escape returns focus to the overflow trigger');
}

async function waitForCleanHydration(page) {
    await page.waitForFunction(() => {
        const modal = document.getElementById('staffEditModal');
        return modal
            && modal.style.display !== 'none'
            && modal.getAttribute('aria-hidden') === 'false'
            && modal.dataset.staffProfileHydrating !== 'true';
    }, null, { timeout: 10000 });
}

async function openProfile(page, staffId = 1) {
    await page.evaluate(id => window.__hrTeamBrowserSmoke.open(id), staffId);
    await waitForCleanHydration(page);
}

async function assertExactProfileTabPanels(page) {
    await openProfile(page, 1);
    const expectedOrder = ['main', 'training', 'work', 'payroll', 'resources', 'offboarding', 'history'];
    const tabOrder = ['main', 'work', 'training', 'payroll', 'resources', 'offboarding', 'history'];
    const panelContract = await page.evaluate(() => {
        const body = document.querySelector('#staffEditModal .hr-staff-profile-body');
        const panels = Array.from(body?.children || []).filter(element => element.matches('[data-staff-profile-panel]'));
        return {
            directChildCount: panels.length,
            panels: panels.map(panel => ({
                tab: panel.dataset.staffProfilePanel,
                id: panel.id,
                role: panel.getAttribute('role'),
                labelledBy: panel.getAttribute('aria-labelledby')
            }))
        };
    });
    assert.equal(panelContract.directChildCount, 7, 'real production drawer has exactly seven direct tab panels');
    assert.deepEqual(panelContract.panels.map(panel => panel.tab), expectedOrder, 'real production drawer keeps the canonical panel order');
    panelContract.panels.forEach(panel => {
        const tabId = `staffProfileTab${panel.tab.charAt(0).toUpperCase()}${panel.tab.slice(1)}`;
        const panelId = `staffProfilePanel${panel.tab.charAt(0).toUpperCase()}${panel.tab.slice(1)}`;
        assert.equal(panel.id, panelId, `${panel.tab} has its canonical production panel id`);
        assert.equal(panel.role, 'tabpanel', `${panel.tab} has tabpanel semantics`);
        assert.equal(panel.labelledBy, tabId, `${panel.tab} is labelled by its production tab`);
    });

    for (const tab of tabOrder) {
        await page.locator(`#staffProfileTab${tab.charAt(0).toUpperCase()}${tab.slice(1)}`).click();
        await page.waitForFunction(expectedTab => {
            const body = document.querySelector('#staffEditModal .hr-staff-profile-body');
            const visible = Array.from(body?.children || [])
                .filter(element => element.matches('[data-staff-profile-panel]'))
                .filter(panel => !panel.hidden && getComputedStyle(panel).display !== 'none')
                .map(panel => panel.dataset.staffProfilePanel);
            return visible.length === 1 && visible[0] === expectedTab;
        }, tab);
        const visiblePanels = await page.evaluate(() => {
            const body = document.querySelector('#staffEditModal .hr-staff-profile-body');
            return Array.from(body?.children || [])
                .filter(element => element.matches('[data-staff-profile-panel]'))
                .filter(panel => !panel.hidden && getComputedStyle(panel).display !== 'none')
                .map(panel => panel.dataset.staffProfilePanel);
        });
        assert.deepEqual(visiblePanels, [tab], `${tab} exposes exactly its own top-level panel`);
    }
    await page.locator('#editCloseTop').click();
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.style.display === 'none');
}

async function assertDrawerGeometryAndButtonStyles(page, label) {
    const layout = await page.evaluate(() => {
        const modal = document.querySelector('#staffEditModal .hr-staff-profile-modal');
        const header = document.querySelector('.hr-staff-profile-drawer-head');
        const tabs = document.querySelector('.hr-staff-profile-tabs');
        const body = document.querySelector('.hr-staff-profile-body');
        const buttonSelectors = {
            primary: '#editSave',
            secondary: '#editDocumentUpload',
            danger: '#editOffboardingComplete',
            icon: '#editCloseTop'
        };
        const styles = Object.fromEntries(Object.entries(buttonSelectors).map(([kind, selector]) => {
            const element = document.querySelector(selector);
            const computed = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return [kind, {
                className: element.className,
                minHeight: Number.parseFloat(computed.minHeight),
                width: box.width,
                height: box.height,
                borderRadius: Number.parseFloat(computed.borderRadius),
                borderStyle: computed.borderStyle,
                backgroundImage: computed.backgroundImage,
                backgroundColor: computed.backgroundColor,
                color: computed.color
            }];
        }));
        const modalBox = modal.getBoundingClientRect();
        const headerBox = header.getBoundingClientRect();
        const tabsBox = tabs.getBoundingClientRect();
        const bodyBox = body.getBoundingClientRect();
        return {
            modalBox: { top: modalBox.top, right: modalBox.right, bottom: modalBox.bottom, left: modalBox.left },
            headerBox: { top: headerBox.top, bottom: headerBox.bottom, left: headerBox.left, right: headerBox.right },
            tabsBox: { top: tabsBox.top, bottom: tabsBox.bottom, left: tabsBox.left, right: tabsBox.right },
            bodyBox: { top: bodyBox.top, bottom: bodyBox.bottom, left: bodyBox.left, right: bodyBox.right },
            viewport: { width: window.innerWidth, height: window.innerHeight },
            bodyScrollsVertically: body.scrollHeight >= body.clientHeight,
            bodyHasHorizontalOverflow: body.scrollWidth > body.clientWidth + 1,
            hasPersistentFooter: Boolean(document.querySelector('.hr-staff-profile-bottom-actions')),
            styles
        };
    });
    assert.ok(layout.modalBox.top >= -1 && layout.modalBox.bottom <= layout.viewport.height + 1, `${label}: drawer stays inside the viewport vertically`);
    assert.ok(layout.headerBox.top >= layout.modalBox.top - 1, `${label}: header starts inside the drawer`);
    assert.ok(layout.headerBox.bottom <= layout.tabsBox.top + 1, `${label}: header does not overlap tabs`);
    assert.ok(layout.tabsBox.bottom <= layout.bodyBox.top + 1, `${label}: tabs do not overlap scroll body`);
    assert.ok(layout.bodyBox.bottom <= layout.modalBox.bottom + 1, `${label}: scroll body reaches the drawer bottom without a footer overlay`);
    assert.ok(layout.bodyBox.left >= layout.modalBox.left - 1 && layout.bodyBox.right <= layout.modalBox.right + 1, `${label}: body stays inside the drawer width`);
    assert.equal(layout.bodyHasHorizontalOverflow, false, `${label}: drawer body has no accidental horizontal overflow`);
    assert.equal(layout.hasPersistentFooter, false, `${label}: persistent drawer footer is absent`);

    const { primary, secondary, danger, icon } = layout.styles;
    for (const [kind, style] of Object.entries({ primary, secondary, danger })) {
        assert.ok(style.className.includes('btn-'), `${label}: ${kind} action uses the shared modal button class`);
        assert.ok(style.minHeight >= 44, `${label}: ${kind} action keeps a 44px target`);
        assert.ok(style.borderRadius >= 8 && style.borderStyle === 'solid', `${label}: ${kind} action has explicit modal chrome (${JSON.stringify(style)})`);
        assert.ok(style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)', `${label}: ${kind} action is not a browser-default button`);
    }
    assert.ok(icon.className.includes('hr-staff-profile-close'), `${label}: icon action uses the timeline close pattern`);
    assert.ok(icon.width >= 44 && icon.height >= 44 && icon.borderRadius >= 8, `${label}: icon action retains a 44px hit target and chrome`);

    for (const tab of ['main', 'work', 'training', 'payroll', 'resources', 'offboarding', 'history']) {
        await page.locator(`[data-staff-profile-tab="${tab}"]`).click();
        const targetAudit = await page.evaluate(activeTab => {
            const modal = document.querySelector('#staffEditModal .hr-staff-profile-modal');
            const panel = document.querySelector(`[data-staff-profile-panel="${activeTab}"]`);
            const modalBox = modal.getBoundingClientRect();
            const selector = 'button,a[href],summary,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),select,textarea';
            const targets = [document.getElementById('editCloseTop'), ...document.querySelectorAll('.hr-staff-profile-tabs button'), ...panel.querySelectorAll(selector)]
                .filter((element, index, all) => element && all.indexOf(element) === index)
                .filter(element => {
                    const style = getComputedStyle(element);
                    const box = element.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
                })
                .map(element => {
                    const box = element.getBoundingClientRect();
                    return {
                        id: element.id || element.textContent.trim().slice(0, 40) || element.tagName,
                        width: box.width,
                        height: box.height,
                        left: box.left,
                        right: box.right
                    };
                });
            const panelHasHorizontalOverflow = panel.scrollWidth > panel.clientWidth + 1;
            return { targets, panelHasHorizontalOverflow, modalLeft: modalBox.left, modalRight: modalBox.right };
        }, tab);
        assert.equal(targetAudit.panelHasHorizontalOverflow, false, `${label}/${tab}: active panel has no horizontal clipping`);
        targetAudit.targets.forEach(target => {
            assert.ok(target.width >= 44 && target.height >= 44, `${label}/${tab}: ${target.id} has a 44x44px touch target (${target.width}x${target.height})`);
        });
    }
}

async function assertProfileCleanDirtyAndFocus(page) {
    await page.evaluate(() => window.__hrTeamBrowserSmoke.setBucket('workers'));
    await page.locator('.hr-team-card[data-staff-id="1"] .hr-team-open').click();
    await waitForCleanHydration(page);

    const drawerLayout = await page.evaluate(() => {
        const header = document.querySelector('.hr-staff-profile-drawer-head');
        const tabs = document.querySelector('.hr-staff-profile-tabs');
        const body = document.querySelector('.hr-staff-profile-body');
        const close = document.getElementById('editCloseTop');
        const headerBox = header?.getBoundingClientRect();
        const tabsBox = tabs?.getBoundingClientRect();
        const bodyBox = body?.getBoundingClientRect();
        return {
            headerPosition: getComputedStyle(header).position,
            tabsPosition: getComputedStyle(tabs).position,
            bodyOverflowY: getComputedStyle(body).overflowY,
            closeClass: close?.classList.contains('hr-staff-profile-close'),
            closeLabel: close?.getAttribute('aria-label'),
            closeWidth: close?.getBoundingClientRect().width,
            hasPersistentFooter: Boolean(document.querySelector('.hr-staff-profile-bottom-actions')),
            headerBottom: headerBox?.bottom,
            tabsTop: tabsBox?.top,
            tabsBottom: tabsBox?.bottom,
            bodyTop: bodyBox?.top
        };
    });
    assert.equal(drawerLayout.headerPosition, 'static', 'drawer header is a normal flex child');
    assert.equal(drawerLayout.tabsPosition, 'static', 'drawer tabs are a normal flex child');
    assert.equal(drawerLayout.bodyOverflowY, 'auto', 'only the profile body owns vertical scrolling');
    assert.equal(drawerLayout.closeClass, true, 'drawer uses the dedicated profile close pattern');
    assert.equal(drawerLayout.closeLabel, 'Закрити картку працівника', 'drawer close has an accessible label');
    assert.ok(drawerLayout.closeWidth >= 38, 'drawer close preserves the timeline close hit area');
    assert.equal(drawerLayout.hasPersistentFooter, false, 'drawer no longer renders a persistent close footer');
    assert.ok(drawerLayout.headerBottom <= drawerLayout.tabsTop + 1, 'header does not overlap tabs');
    assert.ok(drawerLayout.tabsBottom <= drawerLayout.bodyTop + 1, 'tabs do not overlap the scroll body');

    const lowerContent = await page.evaluate(() => {
        const body = document.querySelector('.hr-staff-profile-body');
        const mainPanel = document.getElementById('staffProfilePanelMain');
        const marker = document.createElement('div');
        marker.dataset.testId = 'profile-lower-content';
        marker.style.height = '1600px';
        marker.style.marginTop = '12px';
        mainPanel.append(marker);
        body.scrollTop = body.scrollHeight;
        const bodyBox = body.getBoundingClientRect();
        const markerBox = marker.getBoundingClientRect();
        return {
            scrollHeight: body.scrollHeight,
            clientHeight: body.clientHeight,
            reachedEnd: body.scrollTop + body.clientHeight >= body.scrollHeight - 1,
            markerBottom: markerBox.bottom,
            bodyBottom: bodyBox.bottom
        };
    });
    assert.ok(lowerContent.scrollHeight > lowerContent.clientHeight, 'long profile content scrolls inside the body');
    assert.equal(lowerContent.reachedEnd, true, 'profile body can reach its lowest content');
    assert.ok(lowerContent.markerBottom <= lowerContent.bodyBottom + 1, 'lowest profile content is not hidden behind a footer');

    await page.locator('#editCloseTop').click();
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.style.display === 'none');
    assert.equal(await page.locator('.confirm-overlay').count(), 0, 'clean close does not ask for discard confirmation');
    assert.equal(await page.locator('.hr-team-card[data-staff-id="1"] .hr-team-open').evaluate(el => document.activeElement === el), true, 'focus returns to source card action');

    await openProfile(page, 1);
    await page.fill('#editPhone', '+380999-dirty');
    await page.locator('#editCloseTop').click();
    await page.waitForFunction(() => document.querySelector('.confirm-overlay .confirm-dialog'));
    assert.equal(await page.locator('#staffEditModal').evaluate(el => el.style.display !== 'none'), true, 'dirty rejected close keeps profile open');
    assert.match(await page.locator('.confirm-overlay .confirm-message').textContent(), /незбережені зміни/i, 'dirty close opens the production discard confirmation');

    await page.locator('.confirm-overlay .confirm-cancel').click();
    assert.equal(await page.locator('#staffEditModal').evaluate(el => el.style.display !== 'none'), true, 'cancelled discard keeps profile open');
    await page.locator('#editCloseTop').click();
    await page.waitForFunction(() => document.querySelector('.confirm-overlay .confirm-ok'));
    await page.locator('.confirm-overlay .confirm-ok').click();
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.style.display === 'none');
    await page.waitForFunction(() => !document.querySelector('.confirm-overlay'));
    assert.equal(await page.locator('.confirm-overlay').count(), 0, 'accepted discard closes the production confirmation');
}

async function assertScopedSavesAndActionStates(page) {
    await openProfile(page, 1);
    const mainSave = page.locator('#editSave');
    assert.equal(await mainSave.evaluate(el => el.classList.contains('hr-staff-action')), true, 'main save uses the modal action contract');
    assert.ok(await mainSave.evaluate(el => el.getBoundingClientRect().height >= 44), 'main save has a 44px target');

    await page.fill('#editPhone', '+380999-main-save');
    await page.locator('#staffProfileTabWork').click();
    await page.fill('#editNotes', 'work scope note');
    await page.locator('#staffProfileTabMain').click();
    await page.evaluate(() => window.__hrTeamBrowserSmoke.enableStaffUpdateHold());
    const beforeMainSave = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().length);
    await mainSave.click();
    await page.waitForFunction(expected => window.__hrTeamBrowserSmoke.staffUpdates().length === expected, beforeMainSave + 1);
    await page.evaluate(() => { void document.getElementById('editSave').onclick(); });
    await page.waitForTimeout(25);
    const pendingMainSave = await mainSave.evaluate(el => ({
        disabled: el.disabled,
        busy: el.getAttribute('aria-busy'),
        state: el.dataset.actionState
    }));
    assert.deepEqual(pendingMainSave, { disabled: true, busy: 'true', state: 'loading' }, 'main save exposes a disabled loading state');
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().length), beforeMainSave + 1, 'second main-save trigger does not send a duplicate request');

    const mainPayload = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().at(-1).body);
    assert.deepEqual(Object.keys(mainPayload), ['phone'], 'main save sends only the changed main-profile field');
    assert.equal(mainPayload.phone, '+380999-main-save');

    await page.fill('#editStaffName', 'Concurrent local name');
    await page.evaluate(() => window.__hrTeamBrowserSmoke.resolveStaffUpdates());
    await page.waitForFunction(() => document.getElementById('editSave')?.dataset.actionState === 'success');
    assert.equal(await page.locator('#staffProfileTabMain').evaluate(el => el.classList.contains('is-dirty')), true, 'successful main save preserves a concurrent same-scope edit');
    assert.equal(await page.locator('#staffProfileTabWork').evaluate(el => el.classList.contains('is-dirty')), true, 'main save keeps independently dirty work fields unsaved');

    await page.waitForFunction(() => !document.getElementById('editSave')?.disabled);
    await mainSave.click();
    await page.waitForFunction(expected => window.__hrTeamBrowserSmoke.staffUpdates().length === expected, beforeMainSave + 2);
    const concurrentPayload = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().at(-1).body);
    assert.deepEqual(Object.keys(concurrentPayload), ['name'], 'retry sends only the concurrent same-scope field');
    assert.equal(concurrentPayload.name, 'Concurrent local name');
    await page.waitForFunction(() => document.getElementById('editSave')?.dataset.actionState === 'success');
    assert.equal(await page.locator('#staffProfileTabMain').evaluate(el => el.classList.contains('is-dirty')), false, 'retry clears only the confirmed concurrent field');

    await page.locator('#staffProfileTabWork').click();
    const beforeWorkSave = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().length);
    await page.locator('#editSaveWork').click();
    await page.waitForFunction(expected => window.__hrTeamBrowserSmoke.staffUpdates().length === expected, beforeWorkSave + 1);
    const workPayload = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().at(-1).body);
    assert.deepEqual(Object.keys(workPayload), ['notes'], 'work save includes only the changed work field');
    assert.equal('name' in workPayload, false, 'work save does not resend the name');
    assert.equal('phone' in workPayload, false, 'work save does not resend the phone');
    assert.equal('photo_url' in workPayload, false, 'work save does not resend the photo');
    assert.equal('hourly_rate' in workPayload, false, 'work save does not resend rates');

    await page.locator('#staffProfileTabPayroll').click();
    await page.waitForFunction(() => document.querySelector('#editStaffPayrollProfiles')?.textContent.includes('QA Animator Base'));
    const payrollProfilePanel = await page.locator('#editStaffPayrollProfiles').textContent();
    assert.match(payrollProfilePanel, /QA Animator Base/, 'staff payroll tab shows inherited default payroll profile');
    assert.match(payrollProfilePanel, /legacy не використовується/, 'staff payroll tab makes profile-only base explicit');
    assert.equal(await page.locator('#editPayrollProfileSimulator').isVisible(), true, 'staff payroll tab exposes the payroll profile simulator');
    await page.fill('#editHourlyRate', '145');
    const payrollSave = page.locator('#editPayrollSchemeSave');
    assert.equal(await payrollSave.textContent(), 'Зберегти оплату', 'payroll action names every payload it can save');
    assert.ok(await payrollSave.evaluate(el => el.getBoundingClientRect().height >= 44), 'payroll save has a 44px target');
    const beforeRatesSave = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().length);
    await payrollSave.click();
    await page.waitForFunction(expected => window.__hrTeamBrowserSmoke.staffUpdates().length === expected, beforeRatesSave + 1);
    const ratesPayload = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().at(-1).body);
    assert.deepEqual(Object.keys(ratesPayload).sort(), ['hourly_rate', 'profession_rates', 'rate_unit'], 'payroll rate save sends only rate fields');
    assert.equal(ratesPayload.hourly_rate, 145);

    await page.locator('#staffProfileTabMain').click();
    await page.fill('#editPhone', '+380999-error-state');
    await page.evaluate(() => window.__hrTeamBrowserSmoke.failNextStaffUpdate());
    await mainSave.click();
    await page.waitForFunction(() => document.getElementById('editSave')?.dataset.actionState === 'error');
    assert.equal(await mainSave.isDisabled(), true, 'failed save remains disabled while the error state is visible');
    assert.equal(await page.locator('#staffProfileTabMain').evaluate(el => el.classList.contains('is-dirty')), true, 'failed save keeps the main scope dirty');
    await page.waitForFunction(() => !document.getElementById('editSave')?.disabled);
    const beforeRetry = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().length);
    await mainSave.click();
    await page.waitForFunction(expected => window.__hrTeamBrowserSmoke.staffUpdates().length === expected, beforeRetry + 1);
    const retryPayload = await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().at(-1).body);
    assert.deepEqual(Object.keys(retryPayload), ['phone'], 'retry preserves the minimal failed-save payload');
    await page.waitForFunction(() => document.getElementById('editSave')?.dataset.actionState === 'success');
    assert.equal(await page.locator('#staffProfileTabMain').evaluate(el => el.classList.contains('is-dirty')), false, 'successful retry clears its own dirty field');
}

async function assertRapidProfileSwitching(page) {
    await page.evaluate(() => {
        window.__hrTeamBrowserSmoke.enableProfileHold();
        window.__hrTeamBrowserSmoke.startRapidOpen();
    });
    await page.waitForFunction(() => Boolean(window.__hrTeamBrowserSmoke), null, { timeout: 10000 });
    await page.evaluate(() => window.__hrTeamBrowserSmoke.resolveProfile(3));
    await waitForCleanHydration(page);
    assert.equal(await page.inputValue('#editStaffId'), '3', 'latest rapid-open profile wins');
    assert.match(await page.locator('#editStaffHeaderName').textContent(), /Fresh QA Intern Gamma/, 'latest profile name is shown');
    await page.evaluate(() => {
        window.__hrTeamBrowserSmoke.resolveProfile(1);
        window.__hrTeamBrowserSmoke.resolveProfile(2);
        window.__hrTeamBrowserSmoke.releaseProfileHold();
    });
    await page.waitForTimeout(50);
    assert.equal(await page.inputValue('#editStaffId'), '3', 'stale profile responses do not overwrite current profile');
}

async function assertHistoryRaceAndLazyTabs(page) {
    await openProfile(page, 4);
    await page.evaluate(() => {
        window.__hrTeamBrowserSmoke.enableHistoryHold();
        window.__hrTeamBrowserSmoke.startTab('history');
    });
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.requestCount('/staff/4/history') === 1);

    await openProfile(page, 5);
    await page.evaluate(() => window.__hrTeamBrowserSmoke.startTab('history'));
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.requestCount('/staff/5/history') === 1);
    await page.evaluate(() => window.__hrTeamBrowserSmoke.resolveHistory(5));
    await page.waitForFunction(() => document.getElementById('editStaffHistory')?.textContent.includes('QA staff 5'));
    await page.evaluate(() => {
        window.__hrTeamBrowserSmoke.resolveHistory(4);
        window.__hrTeamBrowserSmoke.releaseHistoryHold();
    });
    await page.waitForTimeout(50);
    const activeHistoryText = await page.locator('#editStaffHistory').textContent();
    assert.match(activeHistoryText, /QA staff 5/, 'stale history response does not replace the active profile history');
    assert.match(activeHistoryText, /Призначено підміну зміни/, 'history translates schedule replacement actions');
    assert.match(activeHistoryText, /початок зміни/, 'history translates schedule field keys');
    assert.doesNotMatch(activeHistoryText, /staff_schedule_replacement_set|shiftStart|professionKey/, 'history does not expose raw internal labels');

    await openProfile(page, 3);
    const historyRequestsBefore = await page.evaluate(() => window.__hrTeamBrowserSmoke.requestCount('/staff/3/history'));
    await page.locator('#staffProfileTabMain').focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.getElementById('staffProfileTabHistory')?.getAttribute('aria-selected') === 'true');
    const historyRequestsAfterFirstOpen = await page.evaluate(() => window.__hrTeamBrowserSmoke.requestCount('/staff/3/history'));
    assert.equal(historyRequestsAfterFirstOpen, historyRequestsBefore + 1, 'history tab loads lazily on first open');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#staffProfileTabMain').getAttribute('aria-selected'), 'true', 'Home keyboard navigation activates the first profile tab');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#staffProfileTabHistory').getAttribute('aria-selected'), 'true', 'End keyboard navigation activates the last profile tab');
    const historyRequestsAfterReopen = await page.evaluate(() => window.__hrTeamBrowserSmoke.requestCount('/staff/3/history'));
    assert.equal(historyRequestsAfterReopen, historyRequestsAfterFirstOpen, 'reopening a loaded tab does not duplicate its request');
}

async function assertIndependentLazyTabRaces(page) {
    await openProfile(page, 2);
    await page.evaluate(() => {
        window.__hrTeamBrowserSmoke.enableLazyTabHold();
        window.__hrTeamBrowserSmoke.startTab('resources');
    });
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.requestCount('/staff/2/documents') === 1);
    assert.equal(await page.locator('#staffProfileTabResources').getAttribute('aria-busy'), 'true', 'lazy resources tab exposes aria-busy while loading');
    assert.equal(await page.locator('#staffProfilePanelResources').getAttribute('aria-busy'), 'true', 'lazy resources panel exposes aria-busy while loading');
    await page.waitForFunction(() => /Завантажуємо.*Документи/i.test(document.getElementById('staffProfileLiveStatus')?.textContent || ''));
    assert.match(await page.locator('#staffProfileLiveStatus').textContent(), /Завантажуємо.*Документи/i, 'lazy loading is announced through the live status');

    await page.evaluate(() => window.__hrTeamBrowserSmoke.startTab('offboarding'));
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.requestCount('/staff/2/offboarding') >= 2);
    await page.evaluate(() => window.__hrTeamBrowserSmoke.resolveLazyTab('/offboarding'));
    await page.waitForFunction(() => !document.getElementById('editStaffOffboarding')?.textContent.includes('завантажується'));

    await page.evaluate(() => {
        window.__hrTeamBrowserSmoke.resolveLazyTab('/documents');
        window.__hrTeamBrowserSmoke.resolveLazyTab('/medical-book');
        window.__hrTeamBrowserSmoke.resolveLazyTab('/resources');
        window.__hrTeamBrowserSmoke.releaseLazyTabHold();
    });
    await page.waitForFunction(() => [
        document.getElementById('editStaffDocuments'),
        document.getElementById('editMedicalBookList'),
        document.getElementById('editStaffResources')
    ].every(root => root && !root.textContent.includes('завантажується')));
    assert.equal(await page.locator('#staffProfileTabResources').getAttribute('aria-busy'), 'false', 'lazy resources tab clears aria-busy after loading');
    assert.equal(await page.locator('#staffProfilePanelResources').getAttribute('aria-busy'), 'false', 'lazy resources panel clears aria-busy after loading');

    const requestsBeforeReopen = await page.evaluate(() => ({
        documents: window.__hrTeamBrowserSmoke.requestCount('/staff/2/documents'),
        offboarding: window.__hrTeamBrowserSmoke.requestCount('/staff/2/offboarding')
    }));
    await page.evaluate(() => window.__hrTeamBrowserSmoke.openTab('resources'));
    await page.evaluate(() => window.__hrTeamBrowserSmoke.openTab('offboarding'));
    const requestsAfterReopen = await page.evaluate(() => ({
        documents: window.__hrTeamBrowserSmoke.requestCount('/staff/2/documents'),
        offboarding: window.__hrTeamBrowserSmoke.requestCount('/staff/2/offboarding')
    }));
    assert.deepEqual(requestsAfterReopen, requestsBeforeReopen, 'independently loaded lazy tabs remain cached without duplicate requests');
}

async function assertResourcesWorkspaceStatesAndActions(page) {
    await openProfile(page, 4);
    await page.evaluate(() => {
        const body = document.querySelector('.hr-staff-profile-body');
        const main = document.getElementById('staffProfilePanelMain');
        const marker = document.createElement('div');
        marker.style.height = '1400px';
        main.append(marker);
        body.scrollTop = body.scrollHeight;
        window.__hrTeamBrowserSmoke.failNextWorkspaceRequest('/documents');
    });
    await page.locator('#staffProfileTabResources').click();
    await page.waitForFunction(() => document.getElementById('editStaffDocuments')?.dataset.state === 'error');
    assert.equal(await page.locator('.hr-staff-profile-body').evaluate(el => el.scrollTop), 0, 'opening the resources workspace resets the body scroll position');
    assert.equal(await page.locator('#editStaffDocuments [data-state="error"]').count(), 1, 'document load failure renders a section-specific error state');
    assert.equal(await page.locator('#editStaffDocuments button').count(), 1, 'document load failure exposes a retry action');

    await page.locator('#editStaffDocuments button').click();
    await page.waitForFunction(() => document.getElementById('editStaffDocuments')?.dataset.state === 'ready');
    assert.equal(await page.locator('#editStaffDocuments [data-state="empty"]').count(), 1, 'successful document retry renders the explicit empty state');

    await page.fill('#editMedicalNotes', 'independent medical draft');
    await page.fill('#editDocumentTitle', 'QA uploaded scan');
    await page.locator('#editDocumentFile').setInputFiles({
        name: 'qa-upload.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('QA document upload')
    });
    await page.locator('#editDocumentUpload').click();
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.workspaceOperations().includes('document-upload'));
    await page.waitForFunction(() => document.getElementById('editStaffDocuments')?.textContent.includes('QA uploaded scan'));
    assert.match(await page.locator('#editStaffDocumentsFeedback').textContent(), /додано/i, 'document upload reports a local section result');
    assert.deepEqual(await page.evaluate(() => staffProfileDirtyScopes()), ['medical'], 'document upload clears only its own scope');

    await page.fill('#editDocumentNotes', 'independent archive-time draft');

    await page.locator('#editStaffDocuments button').first().click();
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.workspaceOperations().includes('document-download'));
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.downloads().length), 1, 'document download completes through the guarded download flow');

    await page.evaluate(() => window.__hrTeamBrowserSmoke.disableConfirmationImplementation());
    await page.locator('#editStaffDocuments button').last().click();
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.notifications().some(item => /Підтвердження дії недоступне/.test(item.message)));
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.workspaceOperations().filter(item => item === 'document-archive').length), 0, 'missing confirmation implementation fails closed before archive request');
    assert.equal(await page.locator('#editStaffDocuments .hr-staff-foundation-item').count(), 1, 'fail-closed archive keeps the document visible');
    await page.evaluate(() => window.__hrTeamBrowserSmoke.restoreConfirmationImplementation());

    await page.locator('#editStaffDocuments button').last().click();
    await page.waitForFunction(() => document.querySelector('.confirm-overlay .confirm-dialog'));
    assert.match(await page.locator('.confirm-overlay .confirm-message').textContent(), /Архівувати документ/i, 'archive opens the production confirmation');
    await page.locator('.confirm-overlay .confirm-cancel').click();
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.workspaceOperations().filter(item => item === 'document-archive').length), 0, 'cancelled archive does not send a request');

    await page.locator('#editStaffDocuments button').last().click();
    await page.waitForFunction(() => document.querySelector('.confirm-overlay .confirm-ok'));
    await page.locator('.confirm-overlay .confirm-ok').click();
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.workspaceOperations().includes('document-archive'));
    await page.waitForFunction(() => document.querySelector('#editStaffDocuments [data-state="empty"]'));
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.workspaceOperations().filter(item => item === 'document-archive').length), 1, 'confirmed archive sends exactly one request');
    assert.equal(await page.locator('#editStaffDocuments [data-state="empty"]').count(), 1, 'archiving a document updates the documents subsection');
    assert.deepEqual((await page.evaluate(() => staffProfileDirtyScopes())).sort(), ['documents', 'medical'], 'inline archive preserves document and medical form drafts');
    const dirtyMessage = await page.evaluate(() => staffProfileDirtyMessage('fallback'));
    assert.match(dirtyMessage, /Документи/, 'close warning names the unsaved document scope');
    assert.match(dirtyMessage, /Медкнижка/, 'close warning names the unsaved medical scope');

    await page.evaluate(() => window.__hrTeamBrowserSmoke.failNextWorkspaceRequest('include_archived=true'));
    await page.locator('[data-staff-workspace-view="documents:archive"]').click();
    await page.waitForFunction(() => document.getElementById('editStaffDocuments')?.dataset.state === 'error');
    assert.equal(await page.locator('#editStaffDocuments [data-state="error"] button').count(), 1, 'document archive error exposes its own retry');
    await page.locator('#editStaffDocuments [data-state="error"] button').click();
    await page.waitForFunction(() => document.querySelector('#editStaffDocuments [data-document-status="archived"]'));
    assert.ok(await page.evaluate(() => window.__hrTeamBrowserSmoke.requestCount('/staff/4/documents?include_archived=true') >= 1), 'document archive view requests archived metadata explicitly');
    assert.match(await page.locator('#editStaffDocuments').textContent(), /В архіві.*QA HR/s, 'document archive shows status, date, and audit actor');
    assert.equal(await page.locator('#editStaffDocuments button').count(), 1, 'archived document remains downloadable without a second archive action');
    await page.evaluate(() => {
        staffDocumentListView = 'active';
        restoreStaffWorkspaceViews();
    });
    assert.equal(await page.locator('[data-staff-workspace-view="documents:archive"]').getAttribute('aria-pressed'), 'true', 'document archive filter restores from session state after reinitialization');
    await page.locator('[data-staff-workspace-view="documents:active"]').click();
    await page.waitForFunction(() => document.querySelector('#editStaffDocuments [data-state="empty"]'));

    await page.fill('#editMedicalIssuedAt', '2026-07-01');
    await page.fill('#editMedicalExpiresAt', '2027-07-01');
    await page.locator('#editMedicalSave').click();
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.workspaceOperations().includes('medical-save'));
    assert.equal(await page.locator('#editMedicalBookList .hr-staff-foundation-item').count(), 1, 'medical-book save updates its own subsection');
    assert.deepEqual(await page.evaluate(() => staffProfileDirtyScopes()), ['documents'], 'medical save clears only the medical scope');

    await page.fill('#editResourceTitle', 'QA custom resource');
    const issueRequestsBefore = await page.evaluate(() => window.__hrTeamBrowserSmoke.requestCount('/staff/4/resources'));
    await page.evaluate(() => {
        void document.getElementById('editResourceIssue').onclick();
        void document.getElementById('editResourceIssue').onclick();
    });
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.workspaceOperations().includes('resource-issue:custom'));
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.requestCount('/staff/4/resources')), issueRequestsBefore + 2, 'double-click sends one resource issue plus its single refresh request');
    await page.fill('#editResourceNotes', 'independent return-time draft');
    await page.locator('#editStaffResources button').first().click();
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.workspaceOperations().includes('resource-return'));
    assert.ok((await page.evaluate(() => staffProfileDirtyScopes())).includes('resourceIssue'), 'inline resource return preserves the issue-form draft');

    await page.evaluate(() => window.__hrTeamBrowserSmoke.failNextWorkspaceRequest('include_returned=true'));
    await page.locator('[data-staff-workspace-view="resources:history"]').click();
    await page.waitForFunction(() => document.getElementById('editStaffResources')?.dataset.state === 'error');
    assert.equal(await page.locator('#editStaffResources [data-state="error"] button').count(), 1, 'resource history error exposes its own retry');
    await page.locator('#editStaffResources [data-state="error"] button').click();
    await page.waitForFunction(() => document.querySelector('#editStaffResources [data-resource-status="returned"]'));
    assert.ok(await page.evaluate(() => window.__hrTeamBrowserSmoke.requestCount('/staff/4/resources?include_returned=true') >= 1), 'resource history requests returned assignments explicitly');
    assert.match(await page.locator('#editStaffResources').textContent(), /Повернуто.*QA HR/s, 'resource history shows status, date, and audit actor');
    await page.evaluate(() => {
        staffResourceListView = 'active';
        restoreStaffWorkspaceViews();
    });
    assert.equal(await page.locator('[data-staff-workspace-view="resources:history"]').getAttribute('aria-pressed'), 'true', 'resource history filter restores from session state after reinitialization');
    await page.locator('[data-staff-workspace-view="resources:active"]').click();
    await page.waitForFunction(() => document.querySelector('#editStaffResources [data-state="empty"]'));

    await page.evaluate(() => window.__hrTeamBrowserSmoke.failNextWorkspaceRequest('/staff/4/resources'));
    await page.fill('#editResourceTitle', 'QA retry resource');
    await page.locator('#editResourceIssue').click();
    await page.waitForFunction(() => document.getElementById('editResourceIssue')?.dataset.actionState === 'error');
    assert.ok((await page.evaluate(() => staffProfileDirtyScopes())).includes('resourceIssue'), 'resource issue error keeps its dirty scope');
    await page.waitForFunction(() => !document.getElementById('editResourceIssue')?.disabled);
    await page.locator('#editResourceIssue').click();
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.workspaceOperations().filter(item => item === 'resource-issue:custom').length === 2);
    assert.equal((await page.evaluate(() => staffProfileDirtyScopes())).includes('resourceIssue'), false, 'successful resource retry clears only the issue form');
    assert.ok((await page.evaluate(() => staffProfileDirtyScopes())).includes('documents'), 'resource retry keeps the independent document draft');

    let expectedReturnCount = 1;
    for (const kind of ['warehouse_stock', 'costume']) {
        await page.selectOption('#editResourceKind', kind);
        await page.evaluate(selectedKind => loadStaffResourceOptions(selectedKind), kind);
        await page.waitForFunction(() => document.getElementById('editResourceSourceId')?.options.length > 1);
        const option = kind === 'costume' ? 'costume-qa' : 'warehouse_stock-qa';
        await page.selectOption('#editResourceSourceId', option);
        await page.evaluate(() => syncResourceTitleFromOption());
        await page.locator('#editResourceIssue').click();
        await page.waitForFunction(expected => window.__hrTeamBrowserSmoke.workspaceOperations().includes(`resource-issue:${expected}`), kind);
        await page.locator('#editStaffResources button').first().click();
        expectedReturnCount += 1;
        await page.waitForFunction(expected => window.__hrTeamBrowserSmoke.workspaceOperations().filter(operation => operation === 'resource-return').length >= expected, expectedReturnCount);
    }
    const operations = await page.evaluate(() => window.__hrTeamBrowserSmoke.workspaceOperations());
    assert.ok(operations.includes('resource-issue:warehouse_stock'), 'warehouse issue uses the resource workspace route');
    assert.ok(operations.includes('resource-issue:costume'), 'costume issue uses the resource workspace route');

    await page.evaluate(() => window.__hrTeamBrowserSmoke.failNextWorkspaceRequest('/resource-options'));
    await page.selectOption('#editResourceKind', 'warehouse_stock');
    await page.evaluate(() => loadStaffResourceOptions('warehouse_stock'));
    await page.waitForFunction(() => document.getElementById('editResourceOptionsState')?.dataset.state === 'error');
    assert.equal(await page.locator('#editResourceOptionsState button').count(), 1, 'resource-picker failure exposes a local retry action');
    await page.locator('#editResourceOptionsState button').click();
    await page.waitForFunction(() => document.getElementById('editResourceOptionsState')?.hidden === true);

    await page.evaluate(async () => {
        canManage = false;
        await loadStaffDocumentsAndResources(activeEditStaffId(), { force: true });
    });
    assert.equal(await page.locator('#editStaffDocuments [data-state="restricted"]').count(), 1, 'restricted documents state is explicit');
    assert.equal(await page.locator('#editMedicalBookList [data-state="restricted"]').count(), 1, 'restricted medical state is explicit');
    assert.equal(await page.locator('#editStaffResources [data-state="restricted"]').count(), 1, 'restricted resources state is explicit');
    await page.evaluate(() => { canManage = true; });
}

async function assertOffboardingDangerFlow(page) {
    await openProfile(page, 1);
    await page.locator('#staffProfileTabOffboarding').click();
    await page.waitForFunction(() => document.querySelectorAll('#editOffboardingReadiness .hr-offboarding-readiness-grid > div').length === 4);

    const complete = page.locator('#editOffboardingComplete');
    assert.equal(await complete.isDisabled(), true, 'offboarding action is disabled before date and reason are provided');
    assert.equal(await page.locator('.hr-offboarding-history #editStaffOffboarding').count(), 1, 'past offboarding events are isolated from the readiness section');
    assert.match(await page.locator('#editOffboardingActionStatus').textContent(), /дату/i, 'disabled action explains the missing date');

    await page.fill('#editOffboardingReason', 'QA controlled offboarding');
    assert.equal(await complete.isDisabled(), true, 'reason alone does not unlock offboarding');
    await page.fill('#editOffboardingDate', '2026-08-15');
    await page.waitForFunction(() => !document.getElementById('editOffboardingComplete')?.disabled);
    assert.match(await page.locator('#editOffboardingConsequenceSummary').textContent(), /неактивним/i, 'visible consequence summary explains the profile outcome');
    assert.match(await page.locator('#editOffboardingConsequenceSummary').textContent(), /майбутніх змін: 2/i, 'visible consequence summary includes future shifts');

    await page.selectOption('#editOffboardingAccountAction', 'disable');
    await page.waitForFunction(() => document.getElementById('editOffboardingComplete')?.disabled === true);
    assert.match(await page.locator('#editOffboardingActionStatus').textContent(), /manage_accounts/i, 'account permission blocker explains why automatic disable is unavailable');
    await page.selectOption('#editOffboardingAccountAction', 'review');
    await page.waitForFunction(() => !document.getElementById('editOffboardingComplete')?.disabled);

    await complete.click();
    await page.waitForFunction(() => document.querySelector('.confirm-overlay .confirm-dialog.danger'));
    const confirmationMessage = await page.locator('.confirm-overlay .confirm-message').textContent();
    assert.match(confirmationMessage, /Підтвердьте завершення співпраці/i, 'final submit shows an explicit confirmation summary');
    assert.match(confirmationMessage, /майбутніх змін: 2/i, 'final confirmation repeats the planned schedule cleanup');
    await page.locator('.confirm-overlay .confirm-cancel').click();
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.offboardingSubmissions().length), 0, 'cancelled offboarding does not send a request');
    assert.equal(await page.locator('#staffEditModal').evaluate(el => el.style.display !== 'none'), true, 'cancelled final confirmation does not change the profile');

    await complete.click();
    await page.waitForFunction(() => document.querySelector('.confirm-overlay .confirm-ok'));
    await page.locator('.confirm-overlay .confirm-ok').click();
    await page.waitForFunction(() => window.__hrTeamBrowserSmoke.offboardingSubmissions().length === 1);
    const submissions = await page.evaluate(() => window.__hrTeamBrowserSmoke.offboardingSubmissions());
    assert.equal(submissions.length, 1, 'confirmed offboarding sends exactly one request');
    assert.deepEqual(submissions[0].body, {
        effective_date: '2026-08-15',
        target_pool_status: 'reserve',
        account_action: 'review',
        reason: 'QA controlled offboarding',
        notes: null
    }, 'confirmed offboarding preserves the reviewed consequence payload');
}

async function assertFocusTrap(page) {
    await installHarness(page, { dark: false });
    await openProfile(page, 1);
    await page.locator('#staffProfileTabMain').focus();
    const tabFocusStyle = await page.locator('#staffProfileTabMain').evaluate(el => getComputedStyle(el).boxShadow);
    assert.notEqual(tabFocusStyle, 'none', 'focused profile tab has an explicit focus-visible ring');
    for (let i = 0; i < 16; i += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.getElementById('staffEditModal').contains(document.activeElement)), true, `focus stays inside profile drawer after Tab ${i + 1}`);
    }
    for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.getElementById('staffEditModal').contains(document.activeElement)), true, `focus stays inside profile drawer after Shift+Tab ${i + 1}`);
    }
    await page.locator('#editCloseTop').focus();
    const closeFocusStyle = await page.locator('#editCloseTop').evaluate(el => getComputedStyle(el).boxShadow);
    assert.notEqual(closeFocusStyle, 'none', 'focused close action has an explicit focus-visible ring');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.style.display === 'none');
    assert.equal(await page.locator('.hr-team-card[data-staff-id="1"] .hr-team-open').evaluate(el => document.activeElement === el), true, 'Escape restores focus to the source profile action');
}

async function assertMobileAndTheme(page) {
    for (const width of [390, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await installHarness(page, { dark: false });
        await assertCardLayoutAndOverflow(page, { testOverflow: false });
        await openProfile(page, 1);
        await assertDrawerGeometryAndButtonStyles(page, `${width}px light`);
        const viewportLayout = await page.evaluate(() => {
            const header = document.querySelector('.hr-staff-profile-drawer-head');
            const tabs = document.querySelector('.hr-staff-profile-tabs');
            const body = document.querySelector('.hr-staff-profile-body');
            return {
                headerPosition: getComputedStyle(header).position,
                tabsPosition: getComputedStyle(tabs).position,
                tabsCanScrollHorizontally: tabs.scrollWidth > tabs.clientWidth,
                bodyOverflowY: getComputedStyle(body).overflowY
            };
        });
        assert.equal(viewportLayout.headerPosition, 'static', `header remains non-sticky at ${width}px`);
        assert.equal(viewportLayout.tabsPosition, 'static', `tabs remain non-sticky at ${width}px`);
        assert.equal(viewportLayout.bodyOverflowY, 'auto', `body remains the vertical scroll root at ${width}px`);
        if (width === 390) assert.equal(viewportLayout.tabsCanScrollHorizontally, true, 'mobile tabs remain horizontally reachable');
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await installHarness(page, { dark: false });
    await openProfile(page, 1);
    const mobileBox = await page.locator('.hr-staff-profile-modal').boundingBox();
    assert.ok(mobileBox.width <= 391, 'mobile profile uses full-screen width');
    assert.ok(mobileBox.height >= 840, 'mobile profile uses full-screen height');
    assert.equal(await page.locator('.hr-staff-profile-modal').evaluate(el => getComputedStyle(el).borderRadius), '0px', 'mobile profile removes desktop drawer radius');
    assert.ok(await page.locator('#editCloseTop').evaluate(el => el.getBoundingClientRect().width >= 44), 'mobile close action has a 44px touch target');

    await page.setViewportSize({ width: 1440, height: 900 });
    await installHarness(page, { dark: true });
    await openProfile(page, 1);
    await assertDrawerGeometryAndButtonStyles(page, '1440px dark');
    assert.equal(await page.evaluate(() => document.body.classList.contains('dark-mode')), true, 'dark mode class is active');
    const darkHeader = await page.locator('.hr-staff-profile-drawer-head').evaluate(el => getComputedStyle(el).backgroundColor + getComputedStyle(el).backgroundImage);
    assert.match(darkHeader, /15,\s*23,\s*42|30,\s*30,\s*56|45,\s*212,\s*191/, 'dark drawer header uses dark/themed surface');

    await installHarness(page, { dark: false });
    await openProfile(page, 1);
    await assertDrawerGeometryAndButtonStyles(page, '1440px light rerender');
    assert.equal(await page.evaluate(() => document.body.classList.contains('dark-mode')), false, 'light mode class is inactive');
}

async function run() {
    const playwright = requirePlaywright();
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15000);
    try {
        await installHarness(page, { dark: false });
        await assertCardLayoutAndOverflow(page);
        await assertTeamNavigation(page);
        await assertExactProfileTabPanels(page);
        await assertProfileCleanDirtyAndFocus(page);
        await assertScopedSavesAndActionStates(page);
        await assertRapidProfileSwitching(page);
        await assertHistoryRaceAndLazyTabs(page);
        await assertIndependentLazyTabRaces(page);
        await assertResourcesWorkspaceStatesAndActions(page);
        await assertOffboardingDangerFlow(page);
        await assertFocusTrap(page);
        await assertMobileAndTheme(page);
        console.log('HR Team browser smoke passed');
    } catch (err) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'failure.png'), fullPage: true }).catch(() => {});
        throw err;
    } finally {
        await browser.close().catch(() => {});
    }
}

run().catch(err => fail(err?.stack || err?.message || String(err)));
