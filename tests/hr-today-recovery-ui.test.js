'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { projectParkStaffSchedulePayload } = require('../services/parkStaffScheduleProjection');

const root = path.resolve(__dirname, '..');
const code = file => fs.readFileSync(path.join(root, file), 'utf8');
const markupDom = new JSDOM(code('hr.html'));
const todayMarkup = markupDom.window.document.getElementById('tab-today').outerHTML;
const contextMarkup = markupDom.window.document.getElementById('contextMenu').outerHTML;
markupDom.window.close();

const rows = [
    { staff_id: 9701, staff_name: 'QA Open', role_type: 'manager', department: 'admin', record: { status: 'present', clock_in: '2026-09-14T06:00:00.000Z', clock_out: null } },
    { staff_id: 9702, staff_name: 'QA Late Closed', role_type: 'barista', department: 'cafe', record: { status: 'late', clock_in: '2026-09-14T06:12:00.000Z', clock_out: '2026-09-14T15:00:00.000Z', late_minutes: 12, total_worked_minutes: 468 } },
    { staff_id: 9703, staff_name: 'QA Absent', role_type: 'animator', department: 'animators', record: null, shift: { planned_start: '09:00', planned_end: '18:00' } },
    { staff_id: 9704, staff_name: 'QA Sick', role_type: 'cook', department: 'cafe', record: { status: 'sick', clock_in: null, clock_out: null } }
];

function payload(recovery = true) {
    const source = { success: true, data: structuredClone(rows), summary: { total_staff: 4, present: 1, late: 1, absent: 1, sick: 1, on_vacation: 0 } };
    return recovery ? { ...projectParkStaffSchedulePayload('hr', '/today', source), todayAccess: { readOnly: true, businessContext: 'event_genix' } } : source;
}

function response(status, body) {
    return { status, ok: status >= 200 && status < 300, headers: { get() { return null; } },
        async json() { return body; }, clone() { return response(status, body); } };
}

function harness(options = {}) {
    const contextKey = options.context || 'event_genix';
    const dom = new JSDOM(`<body>${todayMarkup}${contextMarkup}</body>`, {
        url: `https://fixture.local/hr?businessContext=${contextKey}#today`, runScripts: 'outside-only'
    });
    const win = dom.window;
    win.document.addEventListener = ((native) => (type, listener, config) => {
        if (type !== 'DOMContentLoaded') native(type, listener, config);
    })(win.document.addEventListener.bind(win.document));
    win.console = { warn() {}, log() {}, error() {} };
    const user = { id: 9701, role: 'director', activeBusinessContext: contextKey,
        businessContextPolicy: { allowed: ['event_genix', 'park_restaurant'], defaultContext: 'event_genix' } };
    win.AppState = { currentUser: user };
    win.CONFIG = { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } };
    win.localStorage.setItem('pzp_current_user', JSON.stringify(user));
    win.localStorage.setItem('pzp_token', 'test-access-token');
    win.localStorage.setItem('pzp_access_token', 'test-access-token');
    win.canAccess = action => action === 'hr.today.view' || (!options.todayOnly && ['hr.staff.view', 'hr.staff.manage', 'hr.schedule.view'].includes(action));
    const calls = [];
    win.fetch = async (url, request) => {
        calls.push({ url, ...request });
        return response(options.status || 200, options.payload || payload(options.recovery !== false));
    };
    win._loadStaffLinks = async () => { calls.push({ url: 'staff-link-helper', method: 'GET' }); return []; };
    win.showNotification = () => {};
    win.eval(code('js/api.js'));
    win.eval(code('js/hr-attendance-state.js'));
    win.eval(`${code('js/hr-page.js')}\ncanManage = true; window.__todayRecoveryTestState = () => ({ canManage, todayData });`);
    return { dom, win, calls };
}

test('Today recovery sends only its business-scoped read and keeps counters, filters and global capabilities intact', async () => {
    const { dom, win, calls } = harness();
    try {
        await win.loadToday();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/hr/today');
        assert.equal(calls[0].headers['X-Business-Context'], 'event_genix');
        assert.equal(calls[0].headers.Authorization, 'Bearer test-access-token');
        assert.equal(win.__todayRecoveryTestState().canManage, true, 'per-response mode does not change shared capabilities');
        for (const id of ['todayOnShiftMetric', 'todayLateMetric', 'todayAbsentMetric', 'todayLeaveMetric']) {
            assert.equal(win.document.getElementById(id).textContent, '1', id);
        }
        assert.equal(win.document.querySelectorAll('#todayList .hr-staff-row').length, 4);
        assert.equal(win.document.querySelectorAll('#todayList .hr-clock-btn:not(:disabled)').length, 0);
        assert.equal(win.document.querySelectorAll('#todayList [onclick*="handleClock"], #todayList [oncontextmenu]').length, 0);
        assert.equal(win.document.querySelectorAll('#todayList .hr-today-row-action--profile').length, 4);
        assert.match(win.document.querySelector('[data-staff-id="9701"] .hr-today-row-action--profile').getAttribute('onclick'), /openStaffEdit\(9701\)/);
        assert.equal(win.document.querySelectorAll('.hr-today-row-action--schedule').length, 4);
        assert.equal(win.document.getElementById('btnHrPrintDocuments').hidden, true);
        assert.doesNotMatch(win.document.getElementById('todayList').textContent, /Відмітити прихід|Не з'явився — відмітити/);
        const search = win.document.getElementById('todaySearch');
        search.value = 'QA Absent';
        search.dispatchEvent(new win.Event('input'));
        assert.equal(win.document.getElementById('todayAbsentMetric').textContent, '1');
        assert.equal(win.document.getElementById('todayOnShiftMetric').textContent, '0');
        assert.equal(win.document.querySelectorAll('#todayList .hr-staff-row').length, 1);
    } finally { dom.window.close(); }
});

test('recovery profile action stays on the HR card for a linked account and hides on revoked capability or business scope', async () => {
    const { dom, win, calls } = harness();
    try {
        await win.loadToday();
        win._staffLinkCache = [{ id: 9701, user_id: 2026 }];
        win.openStaffProfile = () => { throw new Error('account profile must not open'); };
        win.renderToday(win.__todayRecoveryTestState().todayData);
        const action = win.document.querySelector('[data-staff-id="9701"] .hr-today-row-action--profile');
        assert.match(action.getAttribute('onclick'), /openStaffEdit\(9701\)/);
        assert.doesNotMatch(action.getAttribute('onclick'), /openStaffProfile/);
        assert.match(action.getAttribute('aria-label'), /HR картку/);
        assert.equal(calls.some(call => call.url === 'staff-link-helper'), false);

        win.canAccess = action => action === 'hr.today.view' || action === 'hr.schedule.view';
        win.renderToday(win.__todayRecoveryTestState().todayData);
        assert.equal(win.document.querySelectorAll('.hr-today-row-action--profile').length, 0);
        assert.equal(win.document.querySelectorAll('.hr-today-row-action--schedule').length, 4);

        win.canAccess = () => true;
        win.AppState.currentUser.activeBusinessContext = 'park_restaurant';
        win.renderToday(win.__todayRecoveryTestState().todayData);
        assert.equal(win.document.querySelectorAll('.hr-today-row-action--profile').length, 0);

        win.AppState.currentUser.activeBusinessContext = 'event_genix';
        win.history.replaceState(null, '', '/hr?businessContext=event_genix&businessScope=all#today');
        win.renderToday(win.__todayRecoveryTestState().todayData);
        assert.equal(win.document.querySelectorAll('.hr-today-row-action--profile').length, 0);
    } finally { dom.window.close(); }
});

test('Today-only permissions need no profession, roster or account dependencies and expose no unavailable links', async () => {
    const { dom, win, calls } = harness({ todayOnly: true });
    try {
        await win.loadToday();
        assert.deepEqual(calls.map(call => call.url), ['/api/hr/today']);
        assert.equal(win.document.querySelectorAll('.hr-today-row-actions a, .hr-today-row-actions button').length, 0);
        await win.openTodayStaffSchedule(9701);
        assert.equal(calls.length, 1);
    } finally { dom.window.close(); }
});

test('recovery prevents direct clock, correction, context-status and print entry points from submitting requests', async () => {
    const { dom, win, calls } = harness();
    try {
        await win.loadToday();
        win.initContextMenu();
        await win.handleClock(9701, 'out', 'QA Open');
        await win.handleClock(9703, 'in', 'QA Absent');
        win.showContext({ preventDefault() {} }, 9701);
        win.openCorrectionModal(9701);
        await win.saveCorrection();
        await win.openHrPrintDocuments();
        win.document.querySelector('.hr-context-item').click();
        assert.equal(win.document.getElementById('contextMenu').classList.contains('visible'), false);
        assert.equal(calls.length, 1);
    } finally { dom.window.close(); }
});

test('compatibility responses preserve original clock actions and the optional account helper', async () => {
    const { dom, win, calls } = harness({ recovery: false });
    try {
        await win.loadToday();
        assert.deepEqual(calls.map(call => call.url), ['/api/hr/today', 'staff-link-helper']);
        assert.ok(win.document.querySelector('#todayList [onclick*="handleClock"]'));
        assert.ok(win.document.querySelector('#todayList [oncontextmenu]'));
        assert.equal(win.__todayRecoveryTestState().canManage, true);
    } finally { dom.window.close(); }
});

test('a denied non-Park Today read preserves the selected context and does not retry Park or load account data', async () => {
    const { dom, win, calls } = harness({ context: 'park_restaurant', status: 403,
        payload: { success: false, error: 'HR unavailable in this business', code: 'staff_not_migrated' } });
    try {
        await win.loadToday();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].headers['X-Business-Context'], 'park_restaurant');
        assert.equal(win.document.querySelectorAll('#todayList .hr-staff-row').length, 0);
    } finally { dom.window.close(); }
});

test('a denied refresh clears the previous Today roster, drill-down and counters without retrying another business', async () => {
    const { dom, win, calls } = harness();
    try {
        await win.loadToday();
        win.document.querySelector('[data-today-metric="shift"]').click();
        assert.equal(win.document.getElementById('todayMetricPeoplePanel').hidden, false);
        win.fetch = async (url, request) => {
            calls.push({ url, ...request });
            return response(403, { success: false, code: 'staff_not_migrated' });
        };
        await win.loadToday();
        assert.equal(calls.length, 2);
        assert.ok(calls.every(call => call.headers['X-Business-Context'] === 'event_genix'));
        assert.equal(win.__todayRecoveryTestState().todayData, null);
        assert.equal(win.document.querySelectorAll('#todayList .hr-staff-row').length, 0);
        assert.equal(win.document.getElementById('todayMetricPeoplePanel').hidden, true);
        assert.match(win.document.querySelector('#todayList [role="alert"]').textContent, /Не вдалося завантажити/);
        for (const id of ['todayOnShiftMetric', 'todayLateMetric', 'todayAbsentMetric', 'todayLeaveMetric']) {
            assert.equal(win.document.getElementById(id).textContent, '0', id);
        }
        win.document.querySelector('[data-today-metric="shift"]').click();
        assert.equal(win.document.querySelectorAll('[data-today-metric-staff-id]').length, 0);
    } finally { dom.window.close(); }
});
