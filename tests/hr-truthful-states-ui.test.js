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
