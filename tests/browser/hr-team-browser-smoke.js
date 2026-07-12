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
const CSS_BUNDLE = [
    readRepo('css', 'hr-page.css'),
    readRepo('css', 'pages-hr-foundation.css'),
    readRepo('css', 'pages-hr-staff.css')
].join('\n');

const HARNESS_CODE = String.raw`
(() => {
    const staffProfiles = new Map([
        [1, { id: 1, name: 'QA Worker Alpha', role_type: 'animator', secondary_professions: [], phone: '+380111', photo_url: '/uploads/worker.jpg', hourly_rate: 100, rate_unit: 'hour', company_structure_node_id: 'animators', has_face_descriptor: true, has_account: true, training_readiness: { total: 4, completed: 4, percent: 100 }, onboarding_assignment: { responsible_user_id: 7, responsible_name: 'HR Lead', percent: 100, training_status: 'completed' }, skills: [] }],
        [2, { id: 2, name: 'QA Reserve Beta', role_type: 'technician', secondary_professions: [], phone: '+380222', photo_url: '/uploads/reserve.jpg', hourly_rate: 120, rate_unit: 'hour', hr_pool_status: 'reserve', company_structure_node_id: 'tech', has_face_descriptor: false, has_account: true, training_readiness: { total: 3, completed: 0, percent: 0 }, onboarding_assignment: { responsible_user_id: 7, responsible_name: 'HR Lead', percent: 20, training_status: 'in_progress' }, skills: [] }],
        [3, { id: 3, name: 'QA Intern Gamma', role_type: 'intern', secondary_professions: [], phone: '+380333', photo_url: '/uploads/intern.jpg', hourly_rate: 90, rate_unit: 'hour', company_structure_node_id: 'interns', has_face_descriptor: true, has_account: true, training_readiness: { total: 2, completed: 1, percent: 50 }, skills: [] }],
        [4, { id: 4, name: 'QA Blacklist Delta', role_type: 'animator', secondary_professions: [], phone: '+380444', photo_url: '', hourly_rate: 80, rate_unit: 'hour', hr_pool_status: 'blacklisted', blacklist_reason: 'QA contract', company_structure_node_id: null, has_face_descriptor: true, has_account: false, training_readiness: { total: 1, completed: 1, percent: 100 }, skills: [] }],
        [5, { id: 5, name: 'QA Dismissed Epsilon', role_type: 'animator', secondary_professions: [], phone: '+380555', photo_url: '', hourly_rate: 70, rate_unit: 'hour', is_active: false, company_structure_node_id: null, has_face_descriptor: false, has_account: false, training_readiness: { total: 0, completed: 0, percent: 0 }, skills: [] }]
    ]);
    const pendingProfiles = new Map();
    let holdProfileLoads = false;

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
            '<label class="hr-team-active-toggle"><input type="checkbox" id="teamArchiveSearch"> Шукати в архіві</label>',
            '<div id="teamFilterInfo" class="hr-team-filter-info" aria-live="polite"></div>',
            '</div></div>',
            '<div id="teamMissingBanner"></div>',
            '<div id="teamGrid" class="hr-team-grid"></div>',
            '</main>',
            '<div id="staffEditModal" class="hr-modal-overlay hr-staff-profile-overlay" style="display:none;" aria-hidden="true">',
            '<div class="hr-modal hr-staff-profile-modal" role="dialog" aria-modal="true" aria-labelledby="editStaffHeaderName" aria-describedby="editStaffHeaderMeta">',
            '<input type="hidden" id="editStaffId">',
            '<header class="hr-staff-profile-drawer-head">',
            '<div class="hr-staff-profile-heading"><span>Картка працівника</span><strong id="editStaffHeaderName">ПІБ</strong><div id="editStaffHeaderMeta" class="hr-staff-profile-meta"><i id="editStaffHeaderRole"></i><i id="editStaffHeaderStatus"></i></div></div>',
            '<button type="button" id="editCloseTop" class="btn-secondary">Закрити</button>',
            '</header>',
            '<nav class="hr-staff-profile-tabs" role="tablist" aria-label="Розділи профілю працівника">',
            '<button type="button" id="staffProfileTabMain" role="tab" data-staff-profile-tab="main" aria-controls="staffProfilePanelMain" aria-selected="true">Основне</button>',
            '<button type="button" id="staffProfileTabWork" role="tab" data-staff-profile-tab="work" aria-controls="staffProfilePanelWork" aria-selected="false" tabindex="-1">Робота</button>',
            '<button type="button" id="staffProfileTabTraining" role="tab" data-staff-profile-tab="training" aria-controls="staffProfilePanelTraining" aria-selected="false" tabindex="-1">Навчання</button>',
            '<button type="button" id="staffProfileTabPayroll" role="tab" data-staff-profile-tab="payroll" aria-controls="staffProfilePanelPayroll" aria-selected="false" tabindex="-1">Оплата</button>',
            '<button type="button" id="staffProfileTabResources" role="tab" data-staff-profile-tab="resources" aria-controls="staffProfilePanelResources" aria-selected="false" tabindex="-1">Документи та ресурси</button>',
            '<button type="button" id="staffProfileTabOffboarding" role="tab" data-staff-profile-tab="offboarding" aria-controls="staffProfilePanelOffboarding" aria-selected="false" tabindex="-1" class="is-danger-tab">Завершення співпраці</button>',
            '<button type="button" id="staffProfileTabHistory" role="tab" data-staff-profile-tab="history" aria-controls="staffProfilePanelHistory" aria-selected="false" tabindex="-1">Історія</button>',
            '</nav>',
            '<div class="hr-staff-profile-body" data-active-profile-tab="main">',
            '<section id="staffProfilePanelMain" class="hr-staff-profile-hero" data-staff-profile-panel="main" data-staff-profile-scope="basic" role="tabpanel" aria-labelledby="staffProfileTabMain"><span class="hr-staff-profile-section">Команда</span><div class="hr-staff-profile-card"><span>Картка співробітника</span><strong id="editStaffMainName">ПІБ</strong></div><div class="hr-staff-profile-quick-fields"><label><span>ФІО</span><input id="editStaffName"></label><label><span>Телефон</span><input id="editPhone"></label></div></section>',
            '<div class="form-group hr-staff-photo-field" data-staff-profile-panel="main" data-staff-profile-scope="basic"><label for="editPhotoUrl">Фото профілю</label><div class="hr-staff-photo-editor"><div id="editPhotoPreview" class="hr-staff-photo-preview"></div><div class="hr-staff-photo-controls"><input id="editPhotoUrl"><div class="hr-staff-photo-actions"><small class="form-hint">Камера / Face ID реєструється окремо.</small></div></div></div></div>',
            '<section id="staffProfilePanelTraining" class="hr-staff-foundation-panel hr-lifecycle-panel" data-staff-profile-panel="training" role="tabpanel" aria-labelledby="staffProfileTabTraining"><div id="editStaffLifecycleChecklist"></div></section>',
            '<div class="form-group"><select id="editRoleType"><option value="animator">Аніматор</option><option value="technician">Технік</option><option value="intern">Стажер</option></select></div>',
            '<div class="form-group"><select id="editSecondaryProfessions" multiple></select><input id="editSecondaryProfessionSearch"><div id="editSecondaryProfessionChips"></div><div id="editSecondaryProfessionOptions"></div></div>',
            '<div class="form-group"><div id="editProfessionRates"></div><select id="editCompanyStructureNode"></select></div>',
            '<div class="form-group"><input id="editBirthDate"><input id="editAddress"><input id="editEmergencyContact"><input id="editEmergencyPhone"></div>',
            '<div class="form-group"><input id="editHourlyRate"><select id="editRateUnit"><option value="hour">hour</option><option value="day">day</option><option value="month">month</option></select><span id="editHourlyRateLabel"></span><span id="editHourlyRateHint"></span></div>',
            '<div class="form-group"><input id="editTelegramId"><input id="editTelegramUsername"><select id="editContractType"><option value="parttime">parttime</option></select><input id="editSkills"><textarea id="editNotes"></textarea></div>',
            '<section id="staffProfilePanelResources" class="hr-staff-foundation-panel" data-staff-profile-panel="resources" data-staff-profile-scope="documents"><input id="editDocumentTitle"><textarea id="editDocumentNotes"></textarea><input id="editDocumentFile" type="file"><select id="editDocumentType"><option value="other">other</option></select><input id="editMedicalIssuedAt"><input id="editMedicalExpiresAt"><textarea id="editMedicalNotes"></textarea><select id="editResourceKind"><option value="custom">custom</option></select><select id="editResourceSourceId"></select><div id="editResourceSourceHint"></div><div id="editResourceSourceGroup"></div><div id="editResourceTitleGroup"></div><input id="editResourceTitle"><input id="editResourceDueReturnAt"><textarea id="editResourceNotes"></textarea><input id="editResourceQuantity"><div id="editStaffDocuments"></div><div id="editMedicalBookList"></div><div id="editStaffResources"></div></section>',
            '<section id="staffProfilePanelPayroll" class="hr-staff-foundation-panel" data-staff-profile-panel="payroll" data-staff-profile-scope="payroll"><select id="editPayrollSchemeType"><option value="hourly">hourly</option><option value="per_shift">per_shift</option><option value="monthly_fixed">monthly_fixed</option><option value="hybrid">hybrid</option></select><input id="editPayrollSchemeAmount"><input id="editPayrollSchemeTitle"><input id="editPayrollSchemeEffectiveFrom"><input id="editPayrollSchemeEffectiveTo"><span id="editPayrollSchemeSummary"></span><span id="editPayrollSchemeAmountLabel"></span><div id="editPayrollHybridConfig"></div><select id="editPayrollBaseKind"><option value="hourly">hourly</option></select><input id="editPayrollBaseQuantity"><input id="editPayrollBonusLabel"><input id="editPayrollBonusAmount"><input id="editPayrollHybridPercentRate"><input id="editPayrollHybridPercentBase"><input id="editPayrollDeductionLabel"><input id="editPayrollDeductionAmount"><input id="editPayrollAdvanceLabel"><input id="editPayrollAdvanceAmount"></section>',
            '<section id="staffProfilePanelOffboarding" class="hr-staff-foundation-panel" data-staff-profile-panel="offboarding" data-staff-profile-scope="offboarding"><input id="editOffboardingDate"><select id="editOffboardingPoolStatus"><option value="reserve">reserve</option></select><select id="editOffboardingAccountAction"><option value="review">review</option></select><textarea id="editOffboardingReason"></textarea><textarea id="editOffboardingNotes"></textarea><div id="editOffboardingReadiness"></div><div id="editStaffOffboarding"></div></section>',
            '<section id="staffProfilePanelHistory" class="hr-staff-foundation-panel" data-staff-profile-panel="history" role="tabpanel" aria-labelledby="staffProfileTabHistory"><div id="editStaffHistory"></div><button type="button" id="editHistoryRefresh"></button></section>',
            '<section id="staffProfilePanelWork" class="hr-staff-foundation-panel" data-staff-profile-panel="work"><div id="editStaffRoleAssignments"></div><div id="editStaffShiftPreferences"></div></section>',
            '</div>',
            '<div class="hr-modal-actions hr-staff-profile-bottom-actions"><span>Закриття профілю не зберігає незалежні секції.</span><button type="button" id="editCancel" class="btn-secondary">Закрити профіль</button><button type="button" id="editSave" class="btn-primary">Зберегти основне</button></div>',
            '</div></div>',
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
    hrFetch = async path => {
        const profileMatch = String(path).match(/^\/staff\/(\d+)$/);
        if (profileMatch) {
            const id = Number(profileMatch[1]);
            if (holdProfileLoads) return deferredProfile(id);
            return profileResponse(id);
        }
        if (String(path).includes('/history')) return { success: true, data: [{ action: 'qa', created_at: new Date().toISOString() }] };
        if (String(path).includes('/lifecycle-checklist')) {
            return { success: true, data: { staff: { id: Number(activeEditStaffId()), is_active: true }, summary: { offboarding_started: false }, metrics: { active_account_count: 0, face_descriptor_count: 1, readiness_percent: 50, future_schedule_count: 0, open_payroll_count: 0 }, sections: [] } };
        }
        if (String(path).includes('/documents')) return { success: true, data: [] };
        if (String(path).includes('/medical-book')) return { success: true, data: [] };
        if (String(path).includes('/resources')) return { success: true, data: [] };
        if (String(path).includes('/offboarding-readiness')) return { success: true, data: {} };
        if (String(path).includes('/offboarding')) return { success: true, data: [] };
        if (String(path).includes('/role-assignments')) return { success: true, data: [] };
        if (String(path).includes('/shift-preferences')) return { success: true, data: [] };
        if (String(path).includes('/payroll-scheme')) return { success: true, data: { fallback_hourly_rate: 100, fallback_rate_unit: 'hour' } };
        if (String(path).includes('/resource-options')) return { success: true, data: [] };
        return { success: true, data: [] };
    };

    window.__confirmCalls = [];
    window.__confirmResult = false;
    confirmModal = async (message, options = {}) => {
        window.__confirmCalls.push({ message, options });
        return window.__confirmResult;
    };

    window.__hrTeamBrowserSmoke = {
        setup({ dark = false } = {}) {
            setupDom();
            document.body.classList.toggle('dark-mode', Boolean(dark));
            teamStaff = Array.from(staffProfiles.values()).map(item => ({ is_active: true, hr_pool_status: 'core', ...item }));
            activePeopleBucket = 'workers';
            pendingPeopleBucket = null;
            activeTeamSetupFilter = 'all';
            filterAndRenderTeam();
        },
        render: filterAndRenderTeam,
        setBucket: bucket => window.setPeopleBucket(bucket),
        setSetupFilter: filter => window.setTeamSetupFilter(filter),
        search(value, archive = false) {
            document.getElementById('teamSearch').value = value;
            document.getElementById('teamArchiveSearch').checked = archive;
            filterAndRenderTeam();
        },
        open: id => openStaffEdit(id),
        close: () => closeHrEditableModal('staffEditModal'),
        confirmCalls: () => window.__confirmCalls,
        setConfirmResult: value => { window.__confirmResult = Boolean(value); },
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
        }
    };
})();
`;

async function installHarness(page, options = {}) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS_BUNDLE}</style></head><body></body></html>`);
    await page.evaluate(() => {
        window.AppState = { currentUser: { id: 1, role: 'creator', name: 'QA Creator' } };
        window.__notifications = [];
        window.showNotification = (message, type = 'info') => window.__notifications.push({ message, type });
        window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
        window.__originalReplaceState = history.replaceState.bind(history);
        history.replaceState = (state, title, url) => {
            try {
                window.__originalReplaceState(state, title, url);
            } catch {
                window.__lastReplaceStateUrl = String(url || '');
            }
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

async function assertTeamNavigation(page) {
    assert.deepEqual(await cardNames(page), ['QA Worker Alpha'], 'active workers bucket renders only worker card');
    assert.equal(await page.locator('#teamGrid .hr-team-card').count(), 1, 'closed bucket cards are not left in DOM');
    assert.equal(await page.locator('.hr-tab[data-bucket="workers"]').getAttribute('aria-pressed'), 'true', 'workers nav has active aria state');
    assert.equal(await page.locator('.hr-tab[data-bucket="reserve"]').getAttribute('aria-pressed'), 'false', 'reserve nav has inactive aria state');

    await page.evaluate(() => window.__hrTeamBrowserSmoke.search('Reserve Beta'));
    assert.deepEqual(await cardNames(page), ['QA Reserve Beta'], 'search finds profile outside current bucket');
    assert.match(await page.locator('#teamFilterInfo').textContent(), /Резерв/, 'search result explains found bucket');
    assert.equal(await page.locator('[data-card-bucket="reserve"]').count(), 1, 'search result shows bucket badge');

    await page.evaluate(() => window.__hrTeamBrowserSmoke.setSetupFilter('missing_face'));
    assert.deepEqual(await cardNames(page), ['QA Reserve Beta'], 'setup filter Без камери filters to matching card');
    assert.equal(await page.locator('#teamGrid').evaluate(el => el.dataset.peopleMode), 'setup', 'setup filter uses global setup render mode');
    assert.equal(await page.locator('.hr-setup-filter-chip[aria-pressed="true"]').filter({ hasText: 'Без камери' }).count(), 1, 'active setup filter has aria-pressed');

    await page.evaluate(() => {
        window.__hrTeamBrowserSmoke.setSetupFilter('all');
        window.__hrTeamBrowserSmoke.search('');
        window.__hrTeamBrowserSmoke.setBucket('reserve');
    });
    assert.deepEqual(await cardNames(page), ['QA Reserve Beta'], 'bucket switch renders selected bucket only');
    assert.equal(await page.locator('.hr-tab[data-bucket="reserve"]').getAttribute('aria-pressed'), 'true', 'reserve bucket has aria active state after switch');
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

async function assertProfileCleanDirtyAndFocus(page) {
    await page.evaluate(() => window.__hrTeamBrowserSmoke.setBucket('workers'));
    await page.locator('.hr-team-card[data-staff-id="1"] .hr-team-open').click();
    await waitForCleanHydration(page);

    const headerPosition = await page.locator('.hr-staff-profile-drawer-head').evaluate(el => getComputedStyle(el).position);
    const tabsPosition = await page.locator('.hr-staff-profile-tabs').evaluate(el => getComputedStyle(el).position);
    assert.equal(headerPosition, 'sticky', 'drawer header is sticky');
    assert.equal(tabsPosition, 'sticky', 'drawer tabs are sticky');
    assert.equal(await page.locator('.hr-staff-profile-bottom-actions #editSave').isVisible(), true, 'drawer bottom save action remains visible');

    await page.locator('#editCloseTop').click();
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.style.display === 'none');
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.confirmCalls().length), 0, 'clean close does not ask for discard confirmation');
    assert.equal(await page.locator('.hr-team-card[data-staff-id="1"] .hr-team-open').evaluate(el => document.activeElement === el), true, 'focus returns to source card action');

    await openProfile(page, 1);
    await page.fill('#editPhone', '+380999-dirty');
    await page.locator('#editCloseTop').click();
    assert.equal(await page.locator('#staffEditModal').evaluate(el => el.style.display !== 'none'), true, 'dirty rejected close keeps profile open');
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.confirmCalls().length), 1, 'dirty close opens discard confirmation');

    await page.evaluate(() => window.__hrTeamBrowserSmoke.setConfirmResult(true));
    await page.locator('#editCloseTop').click();
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.style.display === 'none');
    assert.ok(await page.evaluate(() => window.__hrTeamBrowserSmoke.confirmCalls().length >= 2), 'dirty accepted close asks before closing');
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

async function assertFocusTrap(page) {
    await openProfile(page, 1);
    await page.locator('#staffProfileTabMain').focus();
    for (let i = 0; i < 16; i += 1) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.getElementById('staffEditModal').contains(document.activeElement)), true, `focus stays inside profile drawer after Tab ${i + 1}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('staffEditModal')?.style.display === 'none');
}

async function assertMobileAndTheme(page) {
    await page.setViewportSize({ width: 390, height: 844 });
    await installHarness(page, { dark: false });
    await openProfile(page, 1);
    const mobileBox = await page.locator('.hr-staff-profile-modal').boundingBox();
    assert.ok(mobileBox.width <= 391, 'mobile profile uses full-screen width');
    assert.ok(mobileBox.height >= 840, 'mobile profile uses full-screen height');
    assert.equal(await page.locator('.hr-staff-profile-modal').evaluate(el => getComputedStyle(el).borderRadius), '0px', 'mobile profile removes desktop drawer radius');

    await page.setViewportSize({ width: 1440, height: 900 });
    await installHarness(page, { dark: true });
    await openProfile(page, 1);
    assert.equal(await page.evaluate(() => document.body.classList.contains('dark-mode')), true, 'dark mode class is active');
    const darkHeader = await page.locator('.hr-staff-profile-drawer-head').evaluate(el => getComputedStyle(el).backgroundColor + getComputedStyle(el).backgroundImage);
    assert.match(darkHeader, /15,\s*23,\s*42|30,\s*30,\s*56|45,\s*212,\s*191/, 'dark drawer header uses dark/themed surface');

    await installHarness(page, { dark: false });
    await openProfile(page, 1);
    assert.equal(await page.evaluate(() => document.body.classList.contains('dark-mode')), false, 'light mode class is inactive');
}

async function run() {
    const playwright = requirePlaywright();
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15000);
    try {
        await installHarness(page, { dark: false });
        await assertTeamNavigation(page);
        await assertProfileCleanDirtyAndFocus(page);
        await assertRapidProfileSwitching(page);
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
