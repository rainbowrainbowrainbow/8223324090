'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function fragment(file, start, end) {
    const source = read(file);
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `${file}: source boundaries exist`);
    return source.slice(from, to);
}
const availabilitySource = fragment('js/api.js', 'const legacyBusinessSurfaceDenials', 'function getCrmBusinessProfileForContext');
const headersSource = fragment('js/api.js', 'function getAuthHeaders(', 'function getTimelineAuthHeaders(');
const linksSource = fragment('js/ui.js', 'let _staffLinkCache =', 'function openSafeNewTab(');
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const links = [{ id: 41, user_id: 101, username: 'synthetic.worker' }];
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function harness({ page = false, membership = false } = {}) {
    const markup = page ? read('hr.html') : '<body></body>';
    const dom = new JSDOM(markup, { url: 'https://fixture.local/hr?businessContext=event_genix#today', runScripts: 'outside-only' });
    const w = dom.window;
    w.document.addEventListener = ((native) => (name, listener, options) => {
        if (name !== 'DOMContentLoaded') native(name, listener, options);
    })(w.document.addEventListener.bind(w.document));
    w.console = { warn() {}, log() {}, error() {} };
    w.AppState = { currentUser: { id: 9, role: 'director', activeBusinessContext: 'event_genix', accessContext: { status: 'ready' } } };
    w.fixtureProfile = { membershipMode: membership ? 'membership' : 'compatibility', activeBusinessId: 'event_genix', accessContext: { status: 'ready' } };
    w.fixtureScope = { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] };
    w.getCrmBusinessOperatingProfile = () => w.fixtureProfile;
    w.getCrmBusinessScope = () => w.fixtureScope;
    w.apiAuthAuthorizationFingerprint = user => JSON.stringify(user);
    w.CRM_BUSINESS_SCOPE_SINGLE = 'single';
    w.CRM_BUSINESS_DEFAULT_CONTEXT = 'event_genix';
    w.getStoredAuthToken = () => 'synthetic-token';
    w.applyCrmBusinessScopeHeaders = headers => ({ ...headers, 'X-Business-Context': w.fixtureScope.activeContext });
    w.canAccess = () => true;
    w.canUseAction = () => true;
    w.getPermissionLifecycle = () => ({ status: 'ready' });
    w.showNotification = () => {};
    w.openStaffProfile = () => {};
    w.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const state = { calls: [], transport: async () => response(200, { success: true, data: links }) };
    w.fetch = async (url, options) => { state.calls.push({ url, options }); return state.transport(url, options); };
    w.apiFetchWithAuthRetry = (url, options) => w.fetch(url, options);
    w.eval(availabilitySource);
    w.eval(headersSource);
    w.eval(linksSource);
    if (page) {
        w.eval(read('js/hr-attendance-state.js'));
        w.eval(read('js/hr-page.js'));
    }
    return { w, state, close: () => w.close() };
}

test('staff availability preserves ready compatibility and rejects unsupported or unsettled scopes without requests', async () => {
    const h = harness();
    try {
        assert.equal(h.w.getLegacyBusinessSurfaceAvailability('staff').available, true);
        for (const change of [
            () => { h.w.fixtureProfile.membershipMode = 'membership'; },
            () => { h.w.fixtureScope.mode = 'multi'; },
            () => { h.w.fixtureProfile.accessContext.status = 'loading'; },
            () => { h.w.fixtureProfile = null; },
            () => { h.w.fixtureProfile.activeBusinessId = 'dar'; h.w.fixtureScope.activeContext = 'dar'; },
            () => { h.w.AppState.currentUser.accessContext.status = 'selection_required'; }
        ]) {
            change();
            const availability = h.w.getLegacyBusinessSurfaceAvailability('staff');
            assert.equal(availability.available, false);
            assert.equal(availability.code, 'staff_not_migrated');
            await assert.rejects(h.w._loadStaffLinks(), error => error.code === 'staff_not_migrated');
            assert.equal(h.state.calls.length, 0);
            h.w.fixtureProfile = { membershipMode: 'compatibility', activeBusinessId: 'event_genix', accessContext: { status: 'ready' } };
            h.w.fixtureScope.mode = 'single';
            h.w.fixtureScope.activeContext = 'event_genix';
            h.w.AppState.currentUser.accessContext.status = 'ready';
        }
        h.w.fixtureProfile.membershipMode = 'membership';
        assert.match(h.w.getLegacyBusinessSurfaceAvailability('staff').message, /Спільні дані працівників/);
        assert.doesNotMatch(h.w.getLegacyBusinessSurfaceAvailability('staff').message, /каталоги/);
    } finally { h.close(); }
});

test('supported staff links use scoped headers, cache successful rows and retain account badges', async () => {
    const h = harness();
    try {
        const result = await h.w._loadStaffLinks();
        assert.equal(result[0].user_id, 101);
        assert.equal(h.state.calls[0].url, '/api/staff/link-status');
        assert.equal(h.state.calls[0].options.headers.Authorization, 'Bearer synthetic-token');
        assert.equal(h.state.calls[0].options.headers['X-Business-Context'], 'event_genix');
        await h.w._loadStaffLinks();
        assert.equal(h.state.calls.length, 1);
        assert.match(h.w.staffAccountBadge(41), /synthetic.worker/);
        h.w.AppState.currentUser.id = 10;
        assert.equal(h.w.getStaffLinksForCurrentContext(), null);
        assert.equal(h.w.staffAccountBadge(41), '');
        await h.w._loadStaffLinks();
        assert.equal(h.state.calls.length, 2);
    } finally { h.close(); }
});

test('staff link failures remain explicit and can recover on the next request', async () => {
    const h = harness();
    try {
        for (const status of [403, 500]) {
            h.state.transport = async () => response(status, { success: false, code: 'synthetic_denial', error: 'Synthetic failure' });
            await assert.rejects(h.w._loadStaffLinks(), error => error.status === status && error.message === 'Synthetic failure');
            assert.equal(h.w.getStaffLinksForCurrentContext(), null);
        }
        h.state.transport = async () => { throw new TypeError('Synthetic offline'); };
        await assert.rejects(h.w._loadStaffLinks(), error => error.code === 'staff_links_load_failed');
        h.state.transport = async () => response(200, { success: true, data: null });
        await assert.rejects(h.w._loadStaffLinks(), error => error.code === 'staff_links_invalid_response');
        h.state.transport = async () => response(200, { success: true, data: [] });
        assert.equal((await h.w._loadStaffLinks()).length, 0);
        const calls = h.state.calls.length;
        await h.w._loadStaffLinks();
        assert.equal(h.state.calls.length, calls, 'a confirmed empty result is cached');
    } finally { h.close(); }
});

test('a same-user session generation change invalidates cached staff links without an event', async () => {
    const h = harness();
    try {
        h.w.localStorage.setItem('pzp_auth_session_generation', 'first-session');
        await h.w._loadStaffLinks();
        assert.match(h.w.staffAccountBadge(41), /synthetic.worker/);
        h.w.localStorage.setItem('pzp_auth_session_generation', 'second-session');
        assert.equal(h.w.getStaffLinksForCurrentContext(), null);
        assert.equal(h.w.staffAccountBadge(41), '');
        await h.w._loadStaffLinks();
        assert.equal(h.state.calls.length, 2);
        assert.match(h.w.staffAccountBadge(41), /synthetic.worker/);
    } finally { h.close(); }
});

test('an in-flight staff response is rejected after same-user session rotation without an event', async () => {
    const h = harness();
    try {
        h.w.localStorage.setItem('pzp_auth_session_generation', 'first-session');
        const wait = deferred();
        h.state.transport = () => wait.promise;
        const request = h.w._loadStaffLinks();
        const rejected = assert.rejects(request, error => error.code === 'staff_links_context_changed');
        h.w.localStorage.setItem('pzp_auth_session_generation', 'second-session');
        wait.resolve(response(200, { success: true, data: links }));
        await rejected;
        assert.equal(h.w.getStaffLinksForCurrentContext(), null);
        assert.equal(h.w.staffAccountBadge(41), '');
        h.state.transport = async () => response(200, { success: true, data: links });
        await h.w._loadStaffLinks();
        assert.equal(h.state.calls.length, 2);
    } finally { h.close(); }
});

test('context invalidation rejects an old staff response even after returning to the original scope', async () => {
    const h = harness();
    try {
        const wait = deferred();
        h.state.transport = () => wait.promise;
        const request = h.w._loadStaffLinks();
        const rejected = assert.rejects(request, error => error.code === 'staff_links_context_changed');
        h.w.fixtureProfile.membershipMode = 'membership';
        h.w.dispatchEvent(new h.w.CustomEvent('crmBusinessProfileChanged'));
        h.w.fixtureProfile.membershipMode = 'compatibility';
        h.w.dispatchEvent(new h.w.CustomEvent('crmBusinessProfileChanged'));
        wait.resolve(response(200, { success: true, data: links }));
        await rejected;
        assert.equal(h.w.getStaffLinksForCurrentContext(), null);
        assert.equal(h.w.staffAccountBadge(41), '');
    } finally { h.close(); }
});

test('a ready profile refresh with the same context retains in-flight and cached staff links', async () => {
    const h = harness();
    try {
        const wait = deferred();
        h.state.transport = () => wait.promise;
        const request = h.w._loadStaffLinks();
        h.w.fixtureProfile = { ...h.w.fixtureProfile, accessContext: { status: 'ready' } };
        h.w.dispatchEvent(new h.w.CustomEvent('crmBusinessProfileChanged'));
        wait.resolve(response(200, { success: true, data: links }));
        assert.equal((await request)[0].user_id, 101);
        h.w.dispatchEvent(new h.w.CustomEvent('crmBusinessProfileChanged'));
        await h.w._loadStaffLinks();
        assert.equal(h.state.calls.length, 1);
        assert.match(h.w.staffAccountBadge(41), /synthetic.worker/);
        h.w.dispatchEvent(new h.w.CustomEvent('crm:auth-cleared'));
        assert.equal(h.w.getStaffLinksForCurrentContext(), null);
    } finally { h.close(); }
});

test('server staff unavailability clears cached badges only for the staff surface', async () => {
    const h = harness();
    try {
        await h.w._loadStaffLinks();
        h.w.noteLegacyBusinessSurfaceUnavailable('catalogs', { code: 'catalogs_not_migrated' });
        assert.match(h.w.staffAccountBadge(41), /synthetic.worker/);
        h.w.noteLegacyBusinessSurfaceUnavailable('staff', { code: 'staff_not_migrated', message: 'Synthetic staff restriction' });
        assert.equal(h.w.staffAccountBadge(41), '');
        await assert.rejects(h.w._loadStaffLinks(), /Synthetic staff restriction/);
        assert.equal(h.state.calls.length, 1);
    } finally { h.close(); }
});

const today = { success: true, todayAccess: { readOnly: false, businessContext: 'event_genix' },
    data: [{ staff_id: 41, staff_name: 'Synthetic Staff', role_type: 'manager', department: 'admin', record: null }] };
const roleReport = { success: true, summary: { staff_count: 1, role_count: 1 }, data: [
    { staff_id: 41, staff_name: 'Synthetic Staff', profession_title: 'Synthetic Role', status: 'active' }
] };

test('writable Park Today and role report avoid legacy requests and show explicit unavailable states', async () => {
    const h = harness({ page: true, membership: true });
    try {
        h.state.transport = async url => {
            assert.equal(url, '/api/hr/today', 'only the supported Today endpoint is requested');
            return response(200, today);
        };
        await h.w.loadToday();
        await h.w.loadRoleAssignmentsReport();
        assert.equal(h.state.calls.length, 1);
        assert.match(h.w.document.getElementById('todayList').textContent, /Synthetic Staff/);
        assert.match(h.w.document.getElementById('todayStaffLinksStatus').textContent, /недоступн/);
        assert.equal(h.w.document.getElementById('todayStaffLinksStatus').getAttribute('role'), 'status');
        assert.match(h.w.document.getElementById('roleReportSummary').textContent, /недоступн/);
        assert.equal(h.w.document.getElementById('roleReportBody').textContent, '');
    } finally { h.close(); }
});

test('compatible Today and role report retain requests and surface genuine adjunct failures', async () => {
    const h = harness({ page: true });
    let fail = false;
    try {
        h.state.transport = async url => {
            if (url === '/api/hr/today') return response(200, today);
            if (fail) return response(500, { success: false, error: 'Synthetic adjunct failure' });
            return response(200, url === '/api/staff/link-status' ? { success: true, data: links } : roleReport);
        };
        await h.w.loadToday();
        await h.w.loadRoleAssignmentsReport();
        assert.equal(h.state.calls.filter(call => call.url === '/api/staff/link-status').length, 1);
        assert.equal(h.state.calls.filter(call => call.url === '/api/hr/role-assignments/report').length, 1);
        assert.match(h.w.document.getElementById('roleReportBody').textContent, /Synthetic Role/);
        assert.match(h.w.document.querySelector('.hr-today-row-action--profile').getAttribute('onclick'), /openStaffProfile\(101\)/);
        h.w.clearStaffLinksCache();
        fail = true;
        await h.w.loadToday();
        await h.w.loadRoleAssignmentsReport();
        assert.match(h.w.document.getElementById('todayList').textContent, /Synthetic Staff/);
        assert.match(h.w.document.getElementById('todayStaffLinksStatus').textContent, /Synthetic adjunct failure/);
        assert.equal(h.w.document.getElementById('todayStaffLinksStatus').getAttribute('role'), 'alert');
        assert.match(h.w.document.getElementById('roleReportSummary').textContent, /Synthetic adjunct failure/);
        assert.ok(h.w.document.querySelector('#roleReportSummary [role="alert"]'));
        assert.equal(h.w.document.getElementById('roleReportBody').textContent, '');
    } finally { h.close(); }
});

test('an old role report response cannot repopulate the section after a business switch', async () => {
    const h = harness({ page: true });
    try {
        const wait = deferred();
        h.state.transport = () => wait.promise;
        const request = h.w.loadRoleAssignmentsReport();
        h.w.fixtureProfile.membershipMode = 'membership';
        h.w.dispatchEvent(new h.w.CustomEvent('crmBusinessProfileChanged'));
        await h.w.loadRoleAssignmentsReport();
        wait.resolve(response(200, roleReport));
        await request;
        assert.equal(h.state.calls.length, 1);
        assert.equal(h.w.document.getElementById('roleReportBody').textContent, '');
        assert.doesNotMatch(h.w.document.getElementById('roleReportSummary').textContent, /Synthetic Role/);
    } finally { h.close(); }
});
