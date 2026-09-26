'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const code = file => fs.readFileSync(path.join(root, file), 'utf8');
const hrHtml = code('hr.html');
const hrPage = code('js/hr-page.js');

function elementOuterHtml(id) {
    const dom = new JSDOM(hrHtml);
    const html = dom.window.document.getElementById(id).outerHTML;
    dom.window.close();
    return html;
}

function response(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get() { return null; } },
        async json() { return body; },
        clone() { return response(status, body); }
    };
}

function harness(markup, options = {}) {
    const dom = new JSDOM(`<body>${markup}</body>`, {
        url: 'https://fixture.local/hr?businessContext=event_genix#reports',
        runScripts: 'outside-only'
    });
    const win = dom.window;
    win.document.addEventListener = ((native) => (type, listener, config) => {
        if (type !== 'DOMContentLoaded') native(type, listener, config);
    })(win.document.addEventListener.bind(win.document));
    win.console = { warn() {}, log() {}, error() {} };
    win.AppState = { currentUser: { role: 'director', activeBusinessContext: 'event_genix' } };
    win.canAccess = action => options.canAccess ? options.canAccess(action) : true;
    win.canUseAction = action => action === 'export_data';
    win.showNotification = message => { win.__lastNotification = message; };
    win.openModal = () => {};
    win.closeModal = () => {};
    win.ModalLayer = { ensureTopLayer() {} };
    win.fetch = options.fetch || (async () => response(500, { success: false, error: 'Unexpected fetch' }));
    win.eval(`${hrPage}
window.__hrTruthfulState = () => ({ reportState, professionCatalogAccess, professionCatalogLoadState });`);
    return { dom, win };
}

test('salary denial clears stale amounts, keeps an explicit error during filtering and recovers on retry', async () => {
    let fail = true;
    const { dom, win } = harness(elementOuterHtml('tab-salary'), {
        fetch: async url => url.includes('/professions')
            ? response(200, { success: true, data: [] })
            : fail ? response(403, { success: false, code: 'staff_not_migrated', error: 'Synthetic payroll unavailable' })
                : response(200, { success: true, data: [], totals: {}, month: '2026-09' })
    });
    try {
        const d = win.document;
        d.getElementById('salaryTotals').textContent = 'Stale salary';
        d.getElementById('salaryList').textContent = 'Stale employee';
        await win.loadSalary();
        assert.match(d.querySelector('#salaryList [role="alert"]').textContent, /Synthetic payroll unavailable/);
        assert.equal(d.getElementById('salaryTotals').textContent, '');
        assert.equal(d.getElementById('salaryFilterInfo').textContent, 'Дані недоступні');
        assert.equal(d.getElementById('btnCommitSalary').disabled, true);
        win.renderPayrollVisibleRows('salary');
        assert.ok(d.querySelector('[data-salary-retry]'));
        fail = false;
        d.querySelector('[data-salary-retry]').click();
        for (let i = 0; i < 30 && d.getElementById('salaryFilterInfo').textContent === 'Завантаження…'; i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(d.querySelector('#salaryList [role="alert"]'), null);
        assert.match(d.getElementById('salaryFilterInfo').textContent, /0/);
        assert.match(d.getElementById('salaryTotals').textContent, /Всього/);
    } finally { dom.window.close(); }
});

test('late salary response cannot restore payroll data after business context changes', async () => {
    let resolveSalary;
    const pending = new Promise(resolve => { resolveSalary = resolve; });
    const { dom, win } = harness(elementOuterHtml('tab-salary'), {
        fetch: async url => url.includes('/professions') ? response(200, { success: true, data: [] }) : pending
    });
    try {
        let context = 'park';
        win.getLegacyBusinessSurfaceContextKey = () => context;
        const request = win.loadSalary();
        context = 'another-business';
        win.dispatchEvent(new win.Event('crmBusinessContextChanged'));
        resolveSalary(response(200, { success: true, data: [], totals: { total_salary: 999 }, month: '2026-09' }));
        await request;
        assert.match(win.document.querySelector('#salaryList [role="alert"]').textContent, /Бізнес або доступ змінився/);
        assert.equal(win.document.getElementById('salaryTotals').textContent, '');
    } finally { dom.window.close(); }
});

test('network failure in salary load offers retry instead of empty payroll', async () => {
    const { dom, win } = harness(elementOuterHtml('tab-salary'), { fetch: async () => { throw new Error('Synthetic network failure'); } });
    try {
        await win.loadSalary();
        assert.match(win.document.querySelector('#salaryList [role="alert"]').textContent, /Synthetic network failure/);
        assert.ok(win.document.querySelector('[data-salary-retry]'));
    } finally { dom.window.close(); }
});

test('partial Park profession catalog shows unknown counts and disables unsupported workspace actions', async () => {
    const markup = [
        elementOuterHtml('tab-professions'),
        elementOuterHtml('professionWorkspaceOverlay')
    ].join('');
    const partialPayload = {
        success: true,
        data: [
            { id: 4, key: 'animator', title: 'Аніматор', department: 'Аніматори', is_active: true },
            { id: 5, key: 'cook', title: 'Кухар', department: 'Кухня', is_active: true }
        ],
        professionCatalogAccess: {
            readOnly: true,
            partial: true,
            businessContext: 'event_genix',
            reason: 'park_schedule_recovery_projection',
            unsupportedFields: ['people', 'staffCount', 'checklist', 'checklistCount', 'workspace']
        }
    };
    const { dom, win } = harness(markup, {
        fetch: async url => {
            assert.equal(url, '/api/hr/professions');
            return response(200, partialPayload);
        }
    });
    try {
        await win.loadProfessions();
        const text = win.document.getElementById('professionCatalogList').textContent;
        assert.match(win.document.getElementById('professionCatalogStats').textContent, /скорочений read-only список/);
        assert.match(text, /— людей/);
        assert.match(text, /Чекліст недоступний/);
        assert.doesNotMatch(text, /0 людей|Без чекліста/);
        assert.equal(win.document.getElementById('btnAddProfession').hidden, true);
        assert.equal(win.document.querySelectorAll('[data-profession-open-key]').length, 0);
        assert.equal(win.document.querySelectorAll('.hr-profession-master-row[aria-disabled="true"]').length, 2);
        const staffFilter = win.document.getElementById('professionCatalogStaff');
        staffFilter.value = 'with';
        staffFilter.dispatchEvent(new win.Event('change'));
        assert.equal(win.document.querySelectorAll('.hr-profession-master-row').length, 2);
        await win.openProfessionWorkspace({ key: 'animator' });
        assert.match(win.__lastNotification, /Картка професії недоступна/);
        assert.equal(win.document.getElementById('professionWorkspaceOverlay').classList.contains('hidden'), true);
    } finally {
        dom.window.close();
    }
});

test('HR reports failure uses unavailable state, clears stale rows and blocks current export', async () => {
    const markup = elementOuterHtml('tab-reports');
    const monthlySuccess = {
        success: true,
        data: [{
            staff_name: 'QA Staff',
            days_scheduled: 2,
            days_worked: 1,
            late_count: 1,
            days_early_leave: 0,
            days_absent: 0,
            total_overtime_hours: 0,
            avg_late_minutes: 7,
            total_worked_hours: 8,
            estimated_salary: 1000,
            task_kpi: { tasks_done: 1, tasks_assigned: 2, tasks_overdue: 0 },
            task_completion_rate: 50
        }]
    };
    let monthlyStatus = 200;
    const calls = [];
    const { dom, win } = harness(markup, {
        fetch: async url => {
            calls.push(url);
            if (String(url).includes('/api/hr/report/monthly')) {
                return monthlyStatus === 200
                    ? response(200, monthlySuccess)
                    : response(403, { success: false, error: 'HR unavailable in this business', code: 'staff_not_migrated' });
            }
            if (String(url).includes('/api/hr/role-assignments/report')) {
                return response(403, { success: false, error: 'Roles unavailable' });
            }
            return response(500, { success: false, error: 'Unexpected fetch' });
        }
    });
    try {
        await win.loadReports();
        assert.equal(win.document.getElementById('reportHeroAttendance').textContent, '50%');
        assert.match(win.document.getElementById('reportBody').textContent, /QA Staff/);
        assert.equal(win.document.getElementById('reportExport').disabled, false);

        monthlyStatus = 403;
        await win.loadReports();
        assert.equal(win.document.getElementById('reportHeroAttendance').textContent, '—');
        assert.match(win.document.getElementById('reportHeroAttendanceMeta').textContent, /HR unavailable/);
        assert.doesNotMatch(win.document.getElementById('reportBody').textContent, /QA Staff/);
        assert.equal(win.document.getElementById('reportExport').disabled, true);
        await win.exportCSV();
        assert.match(win.__lastNotification, /Експорт доступний після успішного завантаження/);
        assert.equal(calls.filter(url => String(url).includes('/api/hr/report/export')).length, 0);
    } finally {
        dom.window.close();
    }
});

test('payroll profiles do not turn denied staff into zero people and retry restores the catalog', async () => {
    let staffDenied = true;
    const { dom, win } = harness(elementOuterHtml('tab-profiles'), {
        fetch: async url => {
            if (url.includes('/professions')) return response(200, { success: true, data: [] });
            if (url.includes('/payroll-profiles')) return response(200, { success: true, data: [{ id: 7, title: 'QA Profile', status: 'draft', professionKey: 'animator' }] });
            if (url.includes('/staff?')) return staffDenied
                ? response(403, { success: false, code: 'staff_not_migrated' })
                : response(200, { success: true, data: [{ id: 4, name: 'QA Staff' }] });
            return response(500, { success: false, error: 'Unexpected fetch' });
        }
    });
    try {
        await win.loadPayrollProfilesCatalog();
        const d = win.document;
        assert.equal(d.getElementById('payrollProfilesFilterInfo').textContent, '— профілів');
        assert.match(d.querySelector('#payrollProfilesList [role="alert"]').textContent, /список співробітників/);
        assert.doesNotMatch(d.getElementById('payrollProfilesList').textContent, /QA Profile/);
        assert.equal(d.getElementById('btnNewPayrollProfile').disabled, true);
        staffDenied = false;
        d.querySelector('[data-payroll-profiles-retry]').click();
        for (let i = 0; i < 30 && !d.getElementById('payrollProfilesList').textContent.includes('QA Profile'); i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.match(d.getElementById('payrollProfilesList').textContent, /QA Profile/);
        assert.equal(d.getElementById('btnNewPayrollProfile').disabled, false);
    } finally { dom.window.close(); }
});

test('late payroll profile response cannot restore another business catalog', async () => {
    let resolveStaff;
    const pending = new Promise(resolve => { resolveStaff = resolve; });
    const { dom, win } = harness(elementOuterHtml('tab-profiles'), {
        fetch: async url => url.includes('/professions') ? response(200, { success: true, data: [] })
            : url.includes('/payroll-profiles') ? response(200, { success: true, data: [{ id: 7, title: 'Old Business' }] })
                : pending
    });
    try {
        const request = win.loadPayrollProfilesCatalog();
        win.dispatchEvent(new win.Event('crmBusinessContextChanged'));
        resolveStaff(response(200, { success: true, data: [{ id: 4, name: 'Old Staff' }] }));
        await request;
        assert.match(win.document.getElementById('payrollProfilesList').textContent, /Бізнес або доступ змінився/);
        assert.doesNotMatch(win.document.getElementById('payrollProfilesList').textContent, /Old Business|Old Staff/);
    } finally { dom.window.close(); }
});

test('checklist dashboard keeps a context-change error instead of a late staff feed', async () => {
    let resolveDashboard;
    const pending = new Promise(resolve => { resolveDashboard = resolve; });
    const { dom, win } = harness(elementOuterHtml('tab-checklists'), {
        fetch: async url => url.includes('/professions') ? response(200, { success: true, data: [] }) : pending
    });
    try {
        const request = win.loadProfessionChecklists();
        for (let i = 0; i < 20 && win.document.getElementById('professionChecklistDashboardState').dataset.state !== 'loading'; i++) await new Promise(resolve => setTimeout(resolve, 5));
        win.dispatchEvent(new win.Event('crmBusinessContextChanged'));
        resolveDashboard(response(200, { success: true, data: { assignments: [{ staffName: 'Old Staff' }] } }));
        await request;
        assert.match(win.document.getElementById('professionChecklistDashboardState').textContent, /Бізнес або доступ змінився/);
        assert.doesNotMatch(win.document.getElementById('professionChecklistList').textContent, /Old Staff/);
    } finally { dom.window.close(); }
});

test('checklist 403 clears rendered people and survives another render', async () => {
    let denied = false;
    const { dom, win } = harness(elementOuterHtml('tab-checklists'), {
        fetch: async url => url.includes('/professions') ? response(200, { success: true, data: [] })
            : denied ? response(403, { success: false, code: 'staff_not_migrated' })
                : response(200, { success: true, data: { assignments: [{ staffId: 4, staffName: 'QA Staff', professionKey: 'animator' }] } })
    });
    try {
        await win.loadProfessionChecklists();
        assert.match(win.document.getElementById('professionChecklistList').textContent, /QA Staff/);
        denied = true;
        await win.loadProfessionChecklists();
        win.renderProfessionChecklists();
        assert.equal(win.document.getElementById('professionChecklistDashboardState').getAttribute('role'), 'alert');
        assert.doesNotMatch(win.document.getElementById('professionChecklistList').textContent, /QA Staff/);
        assert.ok(win.document.getElementById('professionChecklistDashboardRetry'));
    } finally { dom.window.close(); }
});

test('onboarding start explains denied dependency and retries without submitting writes', async () => {
    let denied = true;
    let modalCount = 0;
    const { dom, win } = harness(elementOuterHtml('tab-onboarding'), {
        fetch: async url => {
            if (url.includes('/staff?')) return response(200, { success: true, data: [{ id: 4, name: 'QA Staff' }] });
            if (url.includes('/onboarding/templates')) return response(200, { success: true, data: [{ id: 3, name: 'QA Template' }] });
            if (url.includes('/onboarding/responsible-candidates')) return denied
                ? response(403, { success: false, code: 'staff_not_migrated' })
                : response(200, { success: true, data: [{ id: 2, name: 'QA Manager' }] });
            throw new Error(`Unexpected request ${url}`);
        }
    });
    win.formModal = async () => { modalCount += 1; return null; };
    try {
        await win.showStartOnboarding();
        assert.match(win.document.getElementById('onboardingStartState').textContent, /Немає доступу до відповідальних/);
        assert.equal(modalCount, 0);
        denied = false;
        await win.showStartOnboarding();
        assert.equal(modalCount, 1);
        assert.equal(win.document.getElementById('onboardingStartState').hidden, true);
    } finally { dom.window.close(); }
});

test('onboarding start does not report success after a synthetic POST 403', async () => {
    let posts = 0;
    const { dom, win } = harness(elementOuterHtml('tab-onboarding'), {
        fetch: async (url, request) => {
            if (request?.method === 'POST') {
                posts += 1;
                return response(403, { success: true, code: 'staff_not_migrated' });
            }
            if (url.includes('/staff?')) return response(200, { success: true, data: [{ id: 4, name: 'QA Staff' }] });
            if (url.includes('/onboarding/templates')) return response(200, { success: true, data: [{ id: 3, name: 'QA Template' }] });
            return response(200, { success: true, data: [{ id: 2, name: 'QA Manager' }] });
        }
    });
    win.formModal = async () => ({ scope: 'general', staffId: '4', templateId: '3', responsibleUserId: '2' });
    try {
        await win.showStartOnboarding();
        assert.equal(posts, 1);
        assert.match(win.document.getElementById('onboardingStartState').textContent, /Немає доступу до запуску/);
        assert.doesNotMatch(win.__lastNotification, /запущено/);
    } finally { dom.window.close(); }
});

test('onboarding list distinguishes forbidden, offline and successful empty results', async () => {
    let mode = 'forbidden';
    const { dom, win } = harness(elementOuterHtml('tab-onboarding'), {
        fetch: async () => {
            if (mode === 'offline') throw new Error('Synthetic offline');
            return mode === 'forbidden'
                ? response(403, { success: false, code: 'staff_not_migrated' })
                : response(200, { success: true, data: [] });
        }
    });
    try {
        await win.loadOnboarding();
        assert.match(win.document.getElementById('onboardingList').textContent, /недоступний/);
        assert.ok(win.document.querySelector('#onboardingList button'));
        mode = 'offline';
        await win.loadOnboarding();
        assert.match(win.document.getElementById('onboardingList').textContent, /Synthetic offline/);
        mode = 'empty';
        await win.loadOnboarding();
        assert.match(win.document.getElementById('onboardingList').textContent, /Процесів онбордингу поки немає/);
        assert.equal(win.document.querySelector('#onboardingList [role="alert"]'), null);
    } finally { dom.window.close(); }
});

test('staff onboarding dialog shows a retryable dependency error', async () => {
    const { dom, win } = harness('<div id="staffOnboardingScopeBody"></div>', {
        fetch: async url => url.includes('/onboarding-processes')
            ? response(403, { success: false, code: 'staff_not_migrated' })
            : response(200, { success: true, data: [] })
    });
    try {
        await win.refreshStaffOnboardingDialog(4);
        const root = win.document.getElementById('staffOnboardingScopeBody');
        assert.match(root.querySelector('[role="alert"]').textContent, /недоступний/);
        assert.ok(root.querySelector('button'));
        assert.equal(root.getAttribute('aria-busy'), 'false');
    } finally { dom.window.close(); }
});

test('onboarding start discards a dependency response after business context changes', async () => {
    let resolveStaff;
    const pending = new Promise(resolve => { resolveStaff = resolve; });
    const { dom, win } = harness(elementOuterHtml('tab-onboarding'), {
        fetch: async url => url.includes('/staff?') ? pending : response(200, { success: true, data: [{ id: 2, name: 'Fixture' }] })
    });
    let modalCount = 0;
    win.formModal = async () => { modalCount += 1; return null; };
    try {
        const request = win.showStartOnboarding();
        win.dispatchEvent(new win.Event('crmBusinessContextChanged'));
        resolveStaff(response(200, { success: true, data: [{ id: 4, name: 'Old Staff' }] }));
        await request;
        assert.equal(modalCount, 0);
        assert.match(win.document.getElementById('onboardingStartState').textContent, /Бізнес або доступ змінився/);
    } finally { dom.window.close(); }
});

test('late onboarding list cannot show people from the previous business', async () => {
    let resolveList;
    const pending = new Promise(resolve => { resolveList = resolve; });
    const { dom, win } = harness(elementOuterHtml('tab-onboarding'), { fetch: async () => pending });
    try {
        const request = win.loadOnboarding();
        win.dispatchEvent(new win.Event('crmBusinessContextChanged'));
        resolveList(response(200, { success: true, data: [{ staff_id: 4, staff_name: 'Old Staff' }] }));
        await request;
        assert.match(win.document.getElementById('onboardingList').textContent, /Бізнес або доступ змінився/);
        assert.doesNotMatch(win.document.getElementById('onboardingList').textContent, /Old Staff/);
    } finally { dom.window.close(); }
});

test('account onboarding payroll hint distinguishes denial from missing default profile', async () => {
    const markup = '<select id="accountOnboardingConditionProfession"><option value="animator" selected>Animator</option></select><div id="accountOnboardingPayrollProfileHint"></div>';
    let denied = true;
    const { dom, win } = harness(markup, {
        fetch: async () => denied
            ? response(403, { success: false, code: 'HR_CAPABILITY_REQUIRED' })
            : response(200, { success: true, data: [] })
    });
    try {
        await win.ensureAccountOnboardingPayrollProfiles(true);
        const hint = win.document.getElementById('accountOnboardingPayrollProfileHint');
        assert.equal(hint.dataset.state, 'error');
        assert.match(hint.textContent, /недоступні/);
        assert.doesNotMatch(hint.textContent, /ще немає/);
        denied = false;
        hint.querySelector('button').click();
        for (let i = 0; i < 20 && hint.dataset.state !== 'warning'; i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(hint.dataset.state, 'warning');
        assert.match(hint.textContent, /ще немає/);
    } finally { dom.window.close(); }
});
