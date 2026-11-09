'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const code = file => fs.readFileSync(path.join(root, file), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function response(status, body) {
    return { status, ok: status >= 200 && status < 300, headers: { get() { return null; } },
        json: async () => body, clone: () => response(status, body) };
}

function harness(t, page = 'staff') {
    const dom = new JSDOM('<body><button id="createStaffBtn"></button><button id="copyWeekBtn"></button><button id="fillWeekBtn"></button><button id="exportExcelBtn"></button><div id="scheduleWrapper"></div></body>', {
        url: `https://fixture.local/${page}?businessContext=event_genix`, runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const win = dom.window;
    const nativeListener = win.document.addEventListener.bind(win.document);
    win.document.addEventListener = (type, ...args) => type === 'DOMContentLoaded' ? undefined : nativeListener(type, ...args);
    win.console = { log() {}, warn() {}, error() {} };
    const user = { id: 97001, role: 'director', username: 'synthetic',
        activeBusinessContext: 'event_genix', businessContextPolicy: { allowed: ['event_genix', 'dar'], defaultContext: 'dar' } };
    win.AppState = { currentUser: user };
    win.CONFIG = { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } };
    win.localStorage.setItem('pzp_current_user', JSON.stringify(user));
    win.localStorage.setItem('pzp_token', 'synthetic-token');
    win.localStorage.setItem('pzp_access_token', 'synthetic-token');
    win.__allowed = new Set(['hr.schedule.view', 'hr.schedule.manage', 'hr.staff.view', 'hr.staff.manage', 'export_data']);
    win.canAccess = action => win.__allowed.has(action);
    win.showNotification = () => {};
    const requests = [];
    let transport = async url => response(200, { success: true, data: [], departments: {} });
    win.fetch = (url, options) => { requests.push({ url, options }); return transport(url, options); };
    win.eval(code('js/api.js'));
    if (page === 'staff') {
        win.getLegacyBusinessSurfaceAvailability = () => ({ available: win.__staffWrites === true });
        win.eval(code('js/staff-page.js').replace('window.StaffSchedulePage = {', `
            window.__followup = { state: StaffState, postAttendanceAction, fetchStaff, fetchHrProfessions,
                syncStaffScheduleCapabilities, performStaffScheduleRefresh, openAddStaffModal, goToScheduleRange,
                context: staffScheduleRequestContext,
                markInitialized() { staffScheduleInitialized = true; staffScheduleInitPromise = Promise.resolve(); staffScheduleAccessFingerprint = staffScheduleRequestContext(); },
                resetInitialization() { staffScheduleInitialized = false; staffScheduleInitPromise = null; },
                stubPresentation() { renderDeptFilter = () => {}; renderSchedule = () => {}; renderLoadView = () => {}; closeEditModal = async () => {}; },
                flush: () => staffScheduleRefreshQueue };
            window.StaffSchedulePage = {`));
        win.__followup.stubPresentation();
        win.__followup.markInitialized();
    } else {
        win.resolveCapability = () => ({ allowed: true });
        win.getUserRole = () => 'director';
        win.eval(code('js/dashboard-page.js').replace(/    return \{\r?\n        init,/, `
            window.__followup = { openTask, runTaskQueueAction, invalidateDashboardTaskDetails,
                context: dashboardTaskContext,
                fallback: id => dashboardScopedApiUrl(dashboardHrefWithParams('/tasks', { open: id })),
                stubPresentation() { showTaskModal = task => { const modal = document.createElement('div'); modal.id = 'dashTaskModal'; modal.dataset.taskId = task.id; document.body.appendChild(modal); };
                    setExecutionFeedback = () => {}; renderTriageWorkspaceOnly = () => {}; refetchQueueAfterDurableExecution = async () => {}; } };
            return {\n        init,`));
        win.__followup.stubPresentation();
    }
    return { win, api: win.__followup, requests, setTransport: fn => { transport = fn; },
        switchBusiness(context) { win.history.replaceState({}, '', `/${page}?businessContext=${context}`); win.CrmBusinessContext.set(context, { updateUrl: false, emit: false }); } };
}

test('all three manual marks use the selected business rather than the account default', async t => {
    const h = harness(t);
    for (const [action, endpoint] of [['clock-in', 'clock-in'], ['clock-out', 'clock-out'], ['excused', 'mark-absent']]) {
        assert.equal((await h.api.postAttendanceAction(action, 97002)).success, true);
        const request = h.requests.at(-1);
        assert.equal(request.url, '/api/hr/' + endpoint);
        assert.equal(request.options.headers['X-Business-Context'], 'event_genix');
        assert.equal(request.options.headers.Authorization, 'Bearer synthetic-token');
        assert.equal(JSON.parse(request.options.body).staff_id, 97002);
    }
});

test('a late manual mark response is ignored after switching business', async t => {
    const h = harness(t);
    const pending = deferred();
    h.setTransport(() => pending.promise);
    const mark = h.api.postAttendanceAction('clock-in', 97002);
    h.switchBusiness('dar');
    pending.resolve(response(200, { success: true }));
    assert.equal((await mark).stale, true);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].options.headers['X-Business-Context'], 'event_genix');
});

test('task details and task mutations use the selected business and canonical deep link', async t => {
    const h = harness(t, 'dashboard');
    h.setTransport(async () => response(200, { id: 501, success: true }));
    await h.api.openTask(501);
    assert.equal(h.win.document.getElementById('dashTaskModal').dataset.taskId, '501');
    const button = h.win.document.createElement('button');
    await h.api.runTaskQueueAction(button, '/api/tasks/501/status', 'PATCH', { status: 'done' });
    assert.equal(button.disabled, false);
    assert.equal(h.requests.length, 2);
    for (const request of h.requests) {
        assert.equal(request.options.headers['X-Business-Context'], 'event_genix');
        assert.equal(new URL(request.url, h.win.location.origin).searchParams.get('businessContext'), 'event_genix');
    }
    const fallback = new URL(h.api.fallback(501), h.win.location.origin);
    assert.equal(fallback.searchParams.get('open'), '501');
    assert.equal(fallback.searchParams.get('businessContext'), 'event_genix');
});

test('task details drop responses after a business switch, including a switch back', async t => {
    const h = harness(t, 'dashboard');
    const pending = deferred();
    h.setTransport(() => pending.promise);
    const request = h.api.openTask(501);
    h.switchBusiness('dar');
    h.win.dispatchEvent(new h.win.Event('crmBusinessContextChanged'));
    h.switchBusiness('event_genix');
    pending.resolve(response(200, { id: 501 }));
    await request;
    assert.equal(h.win.document.getElementById('dashTaskModal'), null);
    assert.equal(h.win.location.pathname, '/dashboard');
});

test('permission lifecycle changes close an already open task and invalidate pending opens', async t => {
    const h = harness(t, 'dashboard');
    h.setTransport(async () => response(200, { id: 501 }));
    await h.api.openTask(501);
    assert.ok(h.win.document.getElementById('dashTaskModal'));
    h.win.dispatchEvent(new h.win.Event('permissions:lifecycle'));
    assert.equal(h.win.document.getElementById('dashTaskModal'), null);
});

for (const mode of ['all', 'multi']) {
    test(`${mode} scope keeps task reads scoped and blocks task writes`, async t => {
        const h = harness(t, 'dashboard');
        h.win.CrmBusinessContext.setScope({ mode, activeContext: 'event_genix', selectedContexts: ['event_genix', 'dar'] }, { allowAggregate: true, emit: false });
        h.setTransport(async () => response(200, { id: 501 }));
        await h.api.openTask(501);
        const read = h.requests.at(-1);
        assert.equal(read.options.headers['X-Business-Scope'], mode);
        assert.equal(new URL(read.url, h.win.location.origin).searchParams.get('businessScope'), mode);
        await assert.rejects(h.api.runTaskQueueAction(null, '/api/tasks/501/status', 'PATCH', { status: 'done' }), /бізнес|business/i);
        assert.equal(h.requests.length, 1);
    });
}

test('only the latest task click can open its details', async t => {
    const h = harness(t, 'dashboard');
    const first = deferred();
    h.setTransport(url => String(url).includes('/501?') ? first.promise : Promise.resolve(response(200, { id: 502 })));
    const old = h.api.openTask(501);
    await h.api.openTask(502);
    first.resolve(response(200, { id: 501 }));
    await old;
    assert.equal(h.win.document.getElementById('dashTaskModal').dataset.taskId, '502');
});

test('a late task mutation never refreshes the new business or dispatches its success event', async t => {
    const h = harness(t, 'dashboard');
    const pending = deferred();
    h.setTransport(() => pending.promise);
    let events = 0;
    h.win.addEventListener('crm:tasks-updated', () => events++);
    const request = h.api.runTaskQueueAction(null, '/api/tasks/501/status', 'PATCH', { status: 'done' });
    h.switchBusiness('dar');
    h.win.dispatchEvent(new h.win.Event('crmBusinessContextChanged'));
    h.switchBusiness('event_genix');
    pending.resolve(response(200, { success: true }));
    assert.equal((await request).stale, true);
    assert.equal(events, 0);
    assert.equal(h.requests.length, 1, 'no replay under another business');
});

for (const status of [401, 403, 500]) {
    test(`schedule refresh ${status} ${status === 500 ? 'preserves current data' : 'clears old data and disables writes'}`, async t => {
        const h = harness(t);
        Object.assign(h.api.state, { staff: [{ id: 97002, name: 'Synthetic Park' }], professions: [{ key: 'host' }],
            schedule: { old: {} }, attendance: { old: {} }, hoursData: { old: {} } });
        h.setTransport(async () => response(status, { success: false, error: 'Synthetic failure' }));
        const result = await h.api.performStaffScheduleRefresh();
        assert.equal(result.success, false);
        if (status === 500) {
            assert.equal(h.api.state.staff.length, 1);
            assert.equal(h.api.state.professions.length, 1);
        } else {
            for (const field of ['staff', 'professions', 'schedule', 'attendance']) assert.equal(Object.keys(h.api.state[field]).length, 0, field);
            assert.equal(h.api.state.hoursData, null);
            assert.equal(h.api.state.canManageSchedule, false);
            assert.equal(h.api.state.canManageStaff, false);
        }
    });
}

test('initial schedule access denial never proceeds to range reads or leaves write buttons enabled', async t => {
    const h = harness(t);
    h.api.resetInitialization();
    h.win.StaffScheduleShell = { ensure: () => h.win.document.body };
    h.setTransport(async () => response(403, { success: false, error: 'Synthetic denied' }));
    await h.win.StaffSchedulePage.init({ mode: 'hr', user: h.win.AppState.currentUser });
    assert.equal(h.win.StaffSchedulePage.isInitialized(), false);
    assert.equal(h.api.state.canManageSchedule, false);
    assert.equal(h.requests.some(request => String(request.url).startsWith('/api/staff/schedule')), false);
});

test('business changes during initial range loading cannot leave an old initialized roster', async t => {
    const h = harness(t);
    h.api.resetInitialization();
    h.win.eval(code('js/staff-schedule-shell.js'));
    const host = h.win.document.createElement('div');
    host.id = 'hrStaffScheduleShell';
    h.win.document.body.appendChild(host);
    const pending = deferred();
    h.setTransport(async url => {
        if (String(url).startsWith('/api/staff/schedule?')) return pending.promise;
        return response(200, { success: true, data: String(url).startsWith('/api/staff?') ? [{ id: 97002, name: 'Old Park row' }] : [], departments: {} });
    });
    const initial = h.win.StaffSchedulePage.init({ mode: 'hr', user: h.win.AppState.currentUser });
    for (let tick = 0; tick < 20 && !h.requests.some(request => String(request.url).startsWith('/api/staff/schedule?')); tick++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(h.requests.some(request => String(request.url).startsWith('/api/staff/schedule?')));
    h.switchBusiness('dar');
    h.win.dispatchEvent(new h.win.Event('crmBusinessContextChanged'));
    pending.resolve(response(200, { success: true, data: [] }));
    await initial;
    assert.equal(h.win.StaffSchedulePage.isInitialized(), false);
    assert.equal(h.api.state.staff.length, 0);
    assert.equal(h.api.state.canManageSchedule, false);
});

test('a denied range refresh clears previously committed schedule and attendance', async t => {
    const h = harness(t);
    h.api.state.staff = [{ id: 97002 }];
    h.api.state.schedule = { old: {} };
    h.api.state.attendance = { old: {} };
    h.setTransport(async () => response(403, { success: false, error: 'Synthetic denied' }));
    assert.equal(await h.api.goToScheduleRange('2026-11-06', '2026-11-14'), false);
    assert.equal(h.api.state.staff.length, 0);
    assert.equal(Object.keys(h.api.state.schedule).length, 0);
    assert.equal(Object.keys(h.api.state.attendance).length, 0);
    assert.equal(h.api.state.canManageSchedule, false);
});

test('an old roster cannot repopulate state after business or capability changes', async t => {
    const h = harness(t);
    const pending = deferred();
    h.setTransport(() => pending.promise);
    const request = h.api.fetchStaff();
    h.switchBusiness('dar');
    pending.resolve(response(200, { success: true, data: [{ id: 97002, name: 'Old Park row' }] }));
    assert.equal((await request).stale, true);
    assert.equal(h.api.state.staff.length, 0);
});

test('unsupported staff creation stays hidden and never opens or submits its form', async t => {
    const h = harness(t);
    h.win.__allowed.add('hr.staff.create');
    let opened = 0;
    h.win.formModal = async () => { opened++; return { name: 'Synthetic' }; };
    h.api.syncStaffScheduleCapabilities();
    assert.equal(h.api.state.canManageSchedule, true, 'schedule lane remains independent');
    assert.equal(h.win.document.getElementById('createStaffBtn').hidden, true);
    await h.api.openAddStaffModal();
    assert.equal(opened, 0);
    assert.equal(h.requests.length, 0);
});

test('staff creation drops an open form after its context changes', async t => {
    const h = harness(t);
    h.win.__staffWrites = true;
    h.win.__allowed = new Set(['hr.schedule.view', 'hr.staff.create']);
    const form = deferred();
    h.win.formModal = () => form.promise;
    const request = h.api.openAddStaffModal();
    assert.equal(h.api.state.canManageStaff, false);
    assert.equal(h.win.document.getElementById('createStaffBtn').hidden, false);
    h.switchBusiness('dar');
    form.resolve({ name: 'Synthetic' });
    await request;
    assert.equal(h.requests.length, 0);
});

test('cached initialization rechecks canonical permissions without binding a second initializer', async t => {
    const h = harness(t);
    h.win.__allowed.delete('hr.schedule.manage');
    h.api.syncStaffScheduleCapabilities();
    h.api.markInitialized();
    assert.equal(h.api.state.canManageSchedule, false);
    h.win.__allowed.add('hr.schedule.manage');
    await h.win.StaffSchedulePage.init({ mode: 'hr', user: h.win.AppState.currentUser });
    await h.api.flush();
    assert.equal(h.api.state.canManageSchedule, true);
    assert.equal(h.requests.filter(request => String(request.url).startsWith('/api/staff?')).length, 1, 'cached init schedules only one roster refresh');
    h.win.__allowed.delete('hr.schedule.manage');
    h.win.dispatchEvent(new h.win.Event('permissions:lifecycle'));
    await h.api.flush();
    assert.equal(h.api.state.canManageSchedule, false);
    assert.equal(h.win.document.getElementById('copyWeekBtn').hidden, true);
});
