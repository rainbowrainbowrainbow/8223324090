'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const pageCode = fs.readFileSync(path.join(root, 'js/hr-page.js'), 'utf8');
const template = new JSDOM(fs.readFileSync(path.join(root, 'hr.html'), 'utf8'));
const reportMarkup = template.window.document.getElementById('tab-reports').outerHTML;
const todayMarkup = template.window.document.getElementById('tab-today').outerHTML;
template.window.close();

function report(name) {
    return { success: true, data: [{ staff_name: name, role_type: 'animator', days_scheduled: 1,
        days_worked: 1, total_worked_hours: 8, task_kpi: { tasks_assigned: 0, tasks_done: 0 } }] };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function harness(loadMonthly, { context = 'event_genix:ready', active = true, includeToday = false } = {}) {
    const dom = new JSDOM(`<body>${reportMarkup}${includeToday ? todayMarkup : ''}</body>`, {
        url: 'https://fixture.local/hr?businessContext=event_genix#reports', runScripts: 'outside-only'
    });
    const win = dom.window;
    const nativeListen = win.document.addEventListener.bind(win.document);
    win.document.addEventListener = (type, listener, options) => {
        if (type !== 'DOMContentLoaded') nativeListen(type, listener, options);
    };
    win.console = { log() {}, warn() {}, error() {} };
    win.AppState = { currentUser: { id: 71, role: 'director', activeBusinessContext: 'event_genix' } };
    win.canAccess = () => true;
    win.canUseAction = () => true;
    win.showNotification = () => {};
    win.openModal = win.closeModal = () => {};
    win.ModalLayer = { ensureTopLayer() {} };
    win.getLegacyBusinessSurfaceContextKey = () => context;
    win.getLegacyBusinessSurfaceAvailability = () => ({ available: true });
    win.eval(`${pageCode}\nwindow.readReportState = () => ({ ...reportState });\nwindow.readTodayData = () => todayData;`);
    win.document.getElementById('tab-reports').classList.toggle('active', active);
    let monthlyCalls = 0;
    win.hrFetch = async route => route.startsWith('/report/monthly')
        ? loadMonthly(++monthlyCalls) : { success: true, data: [], summary: {} };
    return {
        dom, win,
        setContext(value) { context = value; },
        calls: () => monthlyCalls,
        body: () => win.document.getElementById('reportBody').textContent,
        state: () => win.readReportState(),
        profileChanged() { win.dispatchEvent(new win.Event('crmBusinessProfileChanged')); }
    };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('initial business profile readiness automatically replaces the pending monthly request', async () => {
    const pending = deferred();
    const h = harness(call => call === 1 ? pending.promise : report('Current Profile Person'), { context: 'profile:pending' });
    try {
        const firstLoad = h.win.loadReports();
        h.setContext('event_genix:ready');
        h.profileChanged();
        await flush();
        pending.resolve(report('Before Readiness Person'));
        await firstLoad;
        assert.equal(h.calls(), 2);
        assert.equal(h.state().loadState, 'ready');
        assert.match(h.body(), /Current Profile Person/);
        assert.doesNotMatch(h.body(), /Before Readiness Person/);
        assert.equal(h.win.document.querySelector('[data-report-retry]'), null);
    } finally { pending.resolve(report('Unused')); h.dom.window.close(); }
});

test('same-context profile events preserve a pending report and do not add a request', async () => {
    const pending = deferred();
    const h = harness(() => pending.promise);
    try {
        const load = h.win.loadReports();
        h.profileChanged();
        pending.resolve(report('Same Context Person'));
        await load;
        assert.equal(h.calls(), 1);
        assert.equal(h.state().loadState, 'ready');
        assert.match(h.body(), /Same Context Person/);
        h.profileChanged();
        await flush();
        assert.equal(h.calls(), 1);
        assert.equal(h.state().loadState, 'ready');
    } finally { pending.resolve(report('Unused')); h.dom.window.close(); }
});

test('real business changes clear old rows and export until the new profile loads', async () => {
    const current = deferred();
    const h = harness(call => call === 1 ? report('Previous Business Person') : current.promise);
    try {
        await h.win.loadReports();
        assert.equal(h.win.document.getElementById('reportExport').disabled, false);
        h.setContext('park:ready');
        h.win.dispatchEvent(new h.win.Event('crmBusinessContextChanged'));
        assert.equal(h.state().loadState, 'error');
        assert.doesNotMatch(h.body(), /Previous Business Person/);
        assert.equal(h.win.document.getElementById('reportExport').disabled, true);
        h.profileChanged();
        assert.equal(h.state().loadState, 'loading');
        current.resolve(report('Current Business Person'));
        await flush();
        assert.equal(h.calls(), 2);
        assert.equal(h.state().loadState, 'ready');
        assert.match(h.body(), /Current Business Person/);
    } finally { current.resolve(report('Unused')); h.dom.window.close(); }
});

test('a stale rejected request cannot replace the successfully reloaded profile report', async () => {
    const previous = deferred();
    const h = harness(call => call === 1 ? previous.promise : report('Current Report Person'), { context: 'profile:pending' });
    try {
        const firstLoad = h.win.loadReports();
        h.setContext('event_genix:ready');
        h.profileChanged();
        await flush();
        previous.reject(new Error('Synthetic outdated network failure'));
        await firstLoad;
        assert.equal(h.state().loadState, 'ready');
        assert.match(h.body(), /Current Report Person/);
        assert.equal(h.win.document.querySelector('[data-report-retry]'), null);
    } finally { previous.resolve(report('Unused')); h.dom.window.close(); }
});

test('an inactive report is invalidated without fetching when the business profile changes', async () => {
    const h = harness(() => report('Inactive Report Person'), { active: false });
    try {
        await h.win.loadReports();
        h.setContext('park:ready');
        h.profileChanged();
        await flush();
        assert.equal(h.calls(), 1);
        assert.equal(h.state().loadState, 'error');
        assert.doesNotMatch(h.body(), /Inactive Report Person/);
        assert.equal(h.win.document.getElementById('reportExport').disabled, true);
    } finally { h.dom.window.close(); }
});

test('access and session events still invalidate reports when the business context is unchanged', async () => {
    for (const eventName of ['permissions:lifecycle', 'roleSwitched', 'crm:auth-cleared']) {
        const h = harness(() => report('Protected Person'));
        try {
            await h.win.loadReports();
            h.win.dispatchEvent(new h.win.Event(eventName));
            await flush();
            assert.equal(h.calls(), 1, eventName);
            assert.equal(h.state().loadState, 'error', eventName);
            assert.doesNotMatch(h.body(), /Protected Person/, eventName);
            assert.equal(h.win.document.getElementById('reportExport').disabled, true, eventName);
        } finally { h.dom.window.close(); }
    }
});

test('a ready profile reloads reports after permission invalidation even with the same context key', async () => {
    const h = harness(call => report(call === 1 ? 'Previous Permission Person' : 'Revalidated Person'));
    try {
        await h.win.loadReports();
        h.win.dispatchEvent(new h.win.Event('permissions:lifecycle'));
        assert.equal(h.state().loadState, 'error');
        h.profileChanged();
        await flush();
        assert.equal(h.calls(), 2);
        assert.equal(h.state().loadState, 'ready');
        assert.match(h.body(), /Revalidated Person/);
        assert.doesNotMatch(h.body(), /Previous Permission Person/);
    } finally { h.dom.window.close(); }
});

test('a profile event cannot reload an invalidated report without a current user or report rights', async () => {
    for (const reason of ['no-user', 'no-report-rights']) {
        const h = harness(() => report('Revoked Person'));
        try {
            await h.win.loadReports();
            if (reason === 'no-user') h.win.AppState.currentUser = null;
            else h.win.canAccess = () => false;
            h.win.dispatchEvent(new h.win.Event('permissions:lifecycle'));
            h.profileChanged();
            await flush();
            assert.equal(h.calls(), 1, reason);
            assert.equal(h.state().loadState, 'error', reason);
            assert.doesNotMatch(h.body(), /Revoked Person/, reason);
        } finally { h.dom.window.close(); }
    }
});

test('an old Today staff-link request cannot restore data or errors after a newer business load', async () => {
    const links = deferred();
    const h = harness(() => report('Unused'), { active: false, includeToday: true });
    const rendered = [];
    let todayCalls = 0;
    let linkCalls = 0;
    h.win.hrFetch = async () => ({ success: true, data: [{ staff_name: ++todayCalls === 1 ? 'Previous Today Person' : 'Current Today Person' }] });
    h.win._loadStaffLinks = () => ++linkCalls === 1 ? links.promise : Promise.resolve([]);
    h.win.renderToday = data => { rendered.push(data.data[0].staff_name); };
    try {
        const previous = h.win.loadToday();
        await flush();
        assert.equal(h.win.readTodayData(), null, 'main data is not published while its adjunct is pending');
        h.setContext('park:ready');
        await h.win.loadToday();
        links.reject(Object.assign(new Error('Synthetic stale staff-link failure'), { code: 'staff_links_context_changed' }));
        await previous;
        assert.deepEqual(rendered, ['Current Today Person']);
        assert.equal(h.win.readTodayData().data[0].staff_name, 'Current Today Person');
        assert.equal(h.win.document.getElementById('todayStaffLinksStatus'), null);
    } finally { links.resolve([]); h.dom.window.close(); }
});

test('a stale Today main response cannot publish data for an inactive tab after context changes', async () => {
    const main = deferred();
    const h = harness(() => report('Unused'), { active: false, includeToday: true });
    const rendered = [];
    h.win.document.getElementById('tab-today').classList.remove('active');
    h.win.hrFetch = () => main.promise;
    h.win.renderToday = data => { rendered.push(data); };
    try {
        const load = h.win.loadToday();
        h.setContext('park:ready');
        main.resolve({ success: true, data: [{ staff_name: 'Wrong Business Person' }] });
        await load;
        assert.equal(rendered.length, 0);
        assert.equal(h.win.readTodayData(), null);
    } finally { main.resolve({ success: true, data: [] }); h.dom.window.close(); }
});

test('Today refetches the current business after first profile readiness without publishing the old response', async () => {
    const main = deferred();
    const h = harness(() => report('Unused'), { context: 'profile:pending', active: false, includeToday: true });
    const rendered = [];
    let todayCalls = 0;
    let linkCalls = 0;
    h.win.document.getElementById('tab-today').classList.add('active');
    h.win.hrFetch = () => ++todayCalls === 1 ? main.promise
        : Promise.resolve({ success: true, data: [{ staff_name: 'Ready Profile Person' }] });
    h.win._loadStaffLinks = async () => { linkCalls++; return []; };
    h.win.renderToday = data => { rendered.push(data.data[0].staff_name); };
    try {
        const load = h.win.loadToday();
        h.setContext('event_genix:ready');
        h.profileChanged();
        main.resolve({ success: true, data: [{ staff_name: 'Pending Profile Person' }] });
        await load;
        assert.equal(todayCalls, 2);
        assert.equal(linkCalls, 1);
        assert.deepEqual(rendered, ['Ready Profile Person']);
        assert.equal(h.win.readTodayData().data[0].staff_name, 'Ready Profile Person');
    } finally { main.resolve({ success: true, data: [] }); h.dom.window.close(); }
});
