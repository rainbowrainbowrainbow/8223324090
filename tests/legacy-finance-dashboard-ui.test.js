'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const financeSource = fs.readFileSync(path.join(root, 'js/finance-page.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'js/dashboard-page.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');

function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
async function flush() { await new Promise(resolve => setImmediate(resolve)); }

// Run complete production page scripts in a local DOM, suppressing only page bootstrap.
// The transport is synthetic; these checks neither call providers nor represent live QA.
function fixtureDom(markup, page) {
    const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
        url: `http://localhost/${page}`, runScripts: 'outside-only'
    });
    const originalAdd = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (event, listener, options) => {
        if (event !== 'DOMContentLoaded') originalAdd(event, listener, options);
    };
    dom.window.setTimeout = () => 0;
    dom.window.clearTimeout = () => {};
    dom.window.localStorage.setItem('pzp_token', 'synthetic-session-token');
    dom.window.localStorage.setItem('pzp_auth_session_generation', 'fixture-session-1');
    return dom;
}

function financeFixture(t) {
    const dom = fixtureDom(`
        <section id="tabSalary"><input id="salaryMonth" value="2026-09">
        <button class="salary-mode-btn" data-mode="overview"></button>
        <button class="salary-mode-btn" data-mode="builder"></button>
        <button id="salaryCreateSchemeBtn"></button><button id="salaryGenerateReportBtn"></button>
        <div id="salaryStaffList"></div><div id="salaryMainPanel"></div><div id="salaryPreviewPanel"></div></section>
    `, 'finance');
    t.after(() => dom.window.close());
    const window = dom.window;
    const requests = [];
    const denials = [];
    let availability = { available: true };
    let contextKey = 'fixture-account:park:profile-1';
    let transport = async () => { throw new Error('Unexpected fixture request'); };
    let authClears = 0;
    window.getLegacyBusinessSurfaceAvailability = () => availability;
    window.getLegacyBusinessSurfaceContextKey = () => contextKey;
    window.noteLegacyBusinessSurfaceUnavailable = (surface, verdict) => {
        denials.push({ surface, ...verdict });
        availability = { ...verdict, available: false };
        window.dispatchEvent(new window.CustomEvent('legacyBusinessSurfaceUnavailable', { detail: { surface } }));
    };
    window.getAuthHeaders = () => ({ Authorization: 'Bearer ' + window.localStorage.getItem('pzp_token') });
    window.apiFetchWithAuthRetry = (url, options) => {
        requests.push({ url, method: options.method });
        return transport(url, options);
    };
    window.canUseAction = () => true;
    window.clearAuthStorage = () => { authClears++; window.localStorage.removeItem('pzp_token'); };
    window.showLoginScreen = () => { authClears++; };
    const handleStart = apiSource.indexOf('function handleAuthError(');
    const handleEnd = apiSource.indexOf('\n/**', handleStart);
    assert.ok(handleStart >= 0 && handleEnd > handleStart);
    vm.runInContext(apiSource.slice(handleStart, handleEnd), dom.getInternalVMContext(), { filename: 'js/api.js:handleAuthError' });
    vm.runInContext(financeSource + '\nwindow.__financeContainment = { FinState, fetchSalaryReport, renderSalaryWorkspace };',
        dom.getInternalVMContext(), { filename: 'js/finance-page.js' });
    return { dom, window, requests, denials, api: window.__financeContainment,
        setAvailability(value) { availability = value; }, setContextKey(value) { contextKey = value; },
        setTransport(value) { transport = value; }, authClears: () => authClears,
        emit(event = 'crmBusinessProfileChanged') { window.dispatchEvent(new window.Event(event)); },
        installSalaryActionBoundary() {
            const start = financeSource.indexOf("    clearSalaryWorkspace();\n    document.getElementById('tabSalary')");
            const fallback = financeSource.indexOf("    clearSalaryWorkspace();\r\n    document.getElementById('tabSalary')");
            const actualStart = start >= 0 ? start : fallback;
            const end = financeSource.indexOf('    // Year filter', actualStart);
            assert.ok(actualStart >= 0 && end > actualStart);
            vm.runInContext(financeSource.slice(actualStart, end), dom.getInternalVMContext(), { filename: 'js/finance-page.js:salary-initial-action-boundary' });
        },
        panel: id => window.document.getElementById(id),
        month(value) { window.document.getElementById('salaryMonth').value = value; } };
}

function seedSalary(fixture) {
    fixture.api.FinState.salaryReport = { staff: [{ name: 'STALE_PRIVATE_SALARY' }] };
    fixture.api.FinState.salaryWorkspace = { staff: [{ name: 'STALE_PRIVATE_SALARY' }] };
    fixture.api.FinState.selectedSalaryStaffId = 99;
    fixture.api.FinState.creatingSalaryScheme = true;
    for (const id of ['salaryStaffList', 'salaryMainPanel', 'salaryPreviewPanel']) fixture.panel(id).textContent = 'STALE_PRIVATE_SALARY';
}
function assertSalaryCleared(fixture) {
    assert.equal(fixture.api.FinState.salaryReport, null);
    assert.equal(fixture.api.FinState.salaryWorkspace, null);
    assert.equal(fixture.api.FinState.selectedSalaryStaffId, null);
    assert.equal(fixture.api.FinState.creatingSalaryScheme, false);
    assert.doesNotMatch(fixture.window.document.body.textContent, /STALE_PRIVATE_SALARY|OLD_PRIVATE_RESPONSE/);
    assert.ok([...fixture.window.document.querySelectorAll('.salary-mode-btn, #salaryCreateSchemeBtn, #salaryGenerateReportBtn')]
        .every(button => button.disabled));
}
function successfulSalary(name = 'Synthetic permitted worker') {
    return { staff: [{ staffId: 7, name, schemeType: 'hourly', netAmount: 1234, status: 'draft' }],
        totals: { net: 1234, base: 1234, paid: 0, balance: 1234 } };
}

test('salary denies before report or schemes requests and clears old sensitive panels', async t => {
    const f = financeFixture(t);
    for (const reason of ['membership_park', 'membership_dar', 'compatibility_crm', 'compatibility_md', 'aggregate', 'profile_missing']) {
        seedSalary(f);
        f.setAvailability({ available: false, code: 'finance_salary_not_migrated', message: `Unavailable: ${reason}` });
        await f.api.fetchSalaryReport();
        assertSalaryCleared(f);
        assert.match(f.panel('salaryMainPanel').textContent, new RegExp(reason));
    }
    assert.equal(f.requests.length, 0);
});

test('a fresh-profile allow followed by backend 403 keeps session and never fetches schemes', async t => {
    const f = financeFixture(t);
    seedSalary(f);
    f.setTransport(async () => response({ code: 'finance_salary_not_migrated', error: 'Synthetic current-business denial' }, 403));
    await f.api.fetchSalaryReport();
    assertSalaryCleared(f);
    assert.deepEqual(f.requests.map(item => item.url), ['/api/finance/report/salary?month=2026-09']);
    assert.match(f.panel('salaryMainPanel').textContent, /Synthetic current-business denial/);
    assert.equal(f.window.localStorage.getItem('pzp_token'), 'synthetic-session-token');
    assert.equal(f.authClears(), 0);
    assert.equal(f.denials.length, 1);
    assert.equal(f.denials[0].surface, 'finance_salary');
});

test('salary action boundary stays closed until a successful report, including programmatic clicks', async t => {
    const f = financeFixture(t);
    f.installSalaryActionBoundary();
    const action = f.window.document.createElement('button');
    f.window.document.getElementById('tabSalary').appendChild(action);
    let actions = 0;
    action.addEventListener('click', () => actions++);
    const click = () => action.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(click(), false);
    assert.equal(actions, 0);
    f.api.renderSalaryWorkspace();
    assertSalaryCleared(f);
    f.setTransport(url => Promise.resolve(response(url.includes('/report/salary') ? successfulSalary() : { schemes: [] })));
    await f.api.fetchSalaryReport();
    assert.equal(click(), true);
    assert.equal(actions, 1);
    f.setAvailability({ available: false, message: 'Unavailable after role change' });
    assert.equal(click(), false);
    assert.equal(actions, 1);
    assertSalaryCleared(f);
});

test('salary ignores another surface denial but its own event clears state without another request', async t => {
    const f = financeFixture(t);
    f.setTransport(url => Promise.resolve(response(url.includes('/report/salary') ? successfulSalary() : { schemes: [] })));
    await f.api.fetchSalaryReport();
    const count = f.requests.length;
    f.window.dispatchEvent(new f.window.CustomEvent('legacyBusinessSurfaceUnavailable', { detail: { surface: 'catalogs' } }));
    assert.equal(f.api.FinState.salaryReport.staff[0].name, 'Synthetic permitted worker');
    assert.equal(f.requests.length, count);
    f.api.FinState.currentTab = 'salary';
    f.window.noteLegacyBusinessSurfaceUnavailable('finance_salary', { code: 'finance_salary_not_migrated', message: 'Current server denial' });
    assertSalaryCleared(f);
    assert.equal(f.requests.length, count);
});

test('permitted legacy salary authorizes the report before schemes and renders the real workspace', async t => {
    const f = financeFixture(t);
    const first = deferred();
    f.setTransport(url => url.includes('/report/salary') ? first.promise : Promise.resolve(response({ schemes: [{ id: 12 }] })));
    const loading = f.api.fetchSalaryReport();
    assert.equal(f.requests.length, 1, 'Schemes must wait for successful report authorization');
    first.resolve(response(successfulSalary()));
    await loading;
    assert.deepEqual(f.requests.map(item => item.url), ['/api/finance/report/salary?month=2026-09', '/api/payroll/schemes?month=2026-09']);
    assert.equal(f.api.FinState.salaryWorkspace.month, '2026-09');
    assert.equal(f.api.FinState.salaryWorkspace.schemes[0].id, 12);
    assert.match(f.panel('salaryStaffList').textContent, /Synthetic permitted worker/);
    assert.match(f.panel('salaryMainPanel').textContent, /Огляд зарплат за 2026-09/);
    assert.match(f.panel('salaryPreviewPanel').textContent, /Synthetic permitted worker/);
    assert.equal(f.panel('salaryCreateSchemeBtn').disabled, false);
});

test('same-context profile revocation rejects a late report and avoids schemes', async t => {
    const f = financeFixture(t);
    const pending = deferred();
    f.api.FinState.currentTab = 'salary';
    f.setTransport(() => pending.promise);
    const loading = f.api.fetchSalaryReport();
    f.setAvailability({ available: false, message: 'Membership revoked' });
    f.emit();
    pending.resolve(response(successfulSalary('OLD_PRIVATE_RESPONSE')));
    await loading;
    assertSalaryCleared(f);
    assert.equal(f.requests.length, 1);
    assert.match(f.panel('salaryMainPanel').textContent, /Membership revoked/);
});

test('same-context profile revocation rejects an already requested late schemes response', async t => {
    const f = financeFixture(t);
    const schemes = deferred();
    f.setTransport(url => url.includes('/report/salary') ? Promise.resolve(response(successfulSalary('OLD_PRIVATE_RESPONSE'))) : schemes.promise);
    const loading = f.api.fetchSalaryReport();
    await flush();
    assert.equal(f.requests.length, 2);
    f.setAvailability({ available: false, message: 'Role changed' });
    f.emit('workingRoleChanged');
    schemes.resolve(response({ schemes: [{ name: 'OLD_PRIVATE_RESPONSE' }] }));
    await loading;
    assertSalaryCleared(f);
});

test('month switch rejects an old report after the newer month has rendered', async t => {
    const f = financeFixture(t);
    const old = deferred();
    f.setTransport(url => url.includes('/report/salary?month=2026-09') ? old.promise
        : Promise.resolve(response(url.includes('/report/salary') ? successfulSalary('New month worker') : { schemes: [] })));
    const earlier = f.api.fetchSalaryReport();
    f.month('2026-10');
    await f.api.fetchSalaryReport();
    old.resolve(response(successfulSalary('OLD_PRIVATE_RESPONSE')));
    await earlier;
    assert.equal(f.api.FinState.salaryWorkspace.month, '2026-10');
    assert.match(f.panel('salaryStaffList').textContent, /New month worker/);
    assert.doesNotMatch(f.window.document.body.textContent, /OLD_PRIVATE_RESPONSE/);
    assert.equal(f.requests.filter(item => item.url.includes('/schemes?month=2026-09')).length, 0);
});

test('business context key change rejects late schemes even without a delivered change event', async t => {
    const f = financeFixture(t);
    const oldSchemes = deferred();
    f.setTransport(url => url.includes('/report/salary') ? Promise.resolve(response(successfulSalary('OLD_PRIVATE_RESPONSE'))) : oldSchemes.promise);
    const earlier = f.api.fetchSalaryReport();
    await flush();
    f.setContextKey('fixture-account:dar:profile-1');
    oldSchemes.resolve(response({ schemes: [] }));
    await earlier;
    assertSalaryCleared(f);
});

for (const eventName of ['crmBusinessProfileChanged', 'permissions:lifecycle']) {
test(`same-key ${eventName} generation prevents an older salary response replacing the new report`, async t => {
    const f = financeFixture(t);
    const old = deferred();
    f.api.FinState.currentTab = 'salary';
    f.setTransport(() => old.promise);
    const earlier = f.api.fetchSalaryReport();
    f.setTransport(url => Promise.resolve(response(url.includes('/report/salary') ? successfulSalary('Fresh profile worker') : { schemes: [] })));
    f.emit(eventName);
    await flush();
    old.resolve(response(successfulSalary('OLD_PRIVATE_RESPONSE')));
    await earlier;
    assert.match(f.panel('salaryStaffList').textContent, /Fresh profile worker/);
    assert.doesNotMatch(f.window.document.body.textContent, /OLD_PRIVATE_RESPONSE/);
});
}

function dashboardFixture(t) {
    const dom = fixtureDom('<div id="widget-catalogs"></div><div id="widget-content_pipeline"></div>', 'dashboard');
    t.after(() => dom.window.close());
    const window = dom.window;
    let availability = { available: true };
    let contextKey = 'fixture-account:park:profile-1';
    let business = 'event_genix';
    let transport = async () => response({ success: true, data: { legacyCatalogs: availability } });
    const requests = [];
    const denials = [];
    window.AppState = { currentUser: { id: 7, username: 'fixture-director', role: 'director' } };
    window.getUserRole = () => 'director';
    window.getLegacyBusinessSurfaceAvailability = () => availability;
    window.getLegacyBusinessSurfaceContextKey = () => contextKey;
    window.CrmBusinessContext = { current: () => business,
        scope: () => ({ mode: 'single', activeContext: business, selectedContexts: [business] }),
        apiUrl: url => `${url}${url.includes('?') ? '&' : '?'}businessContext=${business}` };
    window.fetch = url => { requests.push(String(url)); return transport(String(url)); };
    const injection = /    return \{\r?\n        init,/;
    assert.match(dashboardSource, injection);
    const instrumented = dashboardSource.replace(injection, `
    window.__dashboardContainment = { renderCatalogs, renderContentPipeline, loadWidgetData, dashboardWidgetRequestContext,
        getData(type) { return _widgetData[type]; },
        seedData(type, data) { _widgetData[type] = data; _widgetDataContextKeys.set(type, dashboardWidgetRequestContext(type).key); }
    };
    return {
        init,`);
    vm.runInContext(instrumented, dom.getInternalVMContext(), { filename: 'js/dashboard-page.js' });
    return { window, dom, requests, denials, api: window.__dashboardContainment,
        setAvailability(value) { availability = value; }, setContextKey(value) { contextKey = value; },
        setBusiness(value) { business = value; }, setTransport(value) { transport = value; },
        enableSharedDenialBridge() {
            window.noteLegacyBusinessSurfaceUnavailable = (surface, verdict) => {
                if (verdict.code !== `${surface}_not_migrated`) return;
                denials.push({ surface, ...verdict });
                availability = { ...verdict, available: false };
                window.dispatchEvent(new window.CustomEvent('legacyBusinessSurfaceUnavailable', { detail: { surface } }));
            };
        },
        container(type) { return window.document.getElementById(`widget-${type}`); },
        emit(event = 'crmBusinessProfileChanged') { window.dispatchEvent(new window.Event(event)); } };
}
function poisonedCatalogData(marker) {
    return { legacyCatalogs: marker, recentItems: [{ name: 'PRIVATE_CATALOG_ITEM' }],
        definitions: [{ name: 'PRIVATE_CATALOG_DEFINITION' }], catalogs: [{ name: 'PRIVATE_CATALOG_ROW' }],
        inReview: [{ title: 'Scoped Art review' }], approvedThisWeek: 4, designTasks: [{ title: 'Scoped design task' }] };
}

test('dashboard backend unavailable marker wins over poisoned catalog arrays while retaining Art pipeline', t => {
    const f = dashboardFixture(t);
    const data = poisonedCatalogData({ available: false, code: 'catalogs_not_migrated', message: 'Catalog ownership unavailable' });
    f.api.renderCatalogs(data, f.container('catalogs'));
    f.api.renderContentPipeline(data, f.container('content_pipeline'));
    assert.match(f.container('catalogs').textContent, /Catalog ownership unavailable/);
    assert.equal(f.container('catalogs').querySelector('button'), null);
    assert.doesNotMatch(f.window.document.body.textContent, /PRIVATE_CATALOG/);
    assert.match(f.container('content_pipeline').textContent, /Scoped Art review/);
    assert.match(f.container('content_pipeline').textContent, /Scoped design task/);
    assert.match(f.container('content_pipeline').textContent, /4/);
});

test('dashboard current profile denial overrides an older allowed backend marker', t => {
    const f = dashboardFixture(t);
    f.setAvailability({ available: false, message: 'Current profile denies catalogs' });
    const data = poisonedCatalogData({ available: true });
    f.api.renderCatalogs(data, f.container('catalogs'));
    f.api.renderContentPipeline(data, f.container('content_pipeline'));
    assert.doesNotMatch(f.window.document.body.textContent, /PRIVATE_CATALOG/);
    assert.match(f.window.document.body.textContent, /Current profile denies catalogs/);
    assert.match(f.container('content_pipeline').textContent, /Scoped Art review/);
});

test('permitted legacy dashboard still renders catalog items and Art pipeline data', t => {
    const f = dashboardFixture(t);
    const data = poisonedCatalogData({ available: true });
    f.api.renderCatalogs(data, f.container('catalogs'));
    f.api.renderContentPipeline(data, f.container('content_pipeline'));
    assert.match(f.container('catalogs').textContent, /PRIVATE_CATALOG_ITEM/);
    assert.match(f.container('catalogs').textContent, /PRIVATE_CATALOG_DEFINITION/);
    assert.match(f.container('content_pipeline').textContent, /PRIVATE_CATALOG_ROW/);
    assert.match(f.container('content_pipeline').textContent, /Scoped Art review/);
});

for (const eventName of ['crmBusinessProfileChanged', 'permissions:lifecycle']) {
test(`dashboard ${eventName} clears cached catalog widgets and rejects older same-key responses`, async t => {
    const f = dashboardFixture(t);
    const old = deferred();
    for (const type of ['catalogs', 'content_pipeline']) {
        f.api.seedData(type, poisonedCatalogData({ available: true }));
        f.container(type).textContent = 'PRIVATE_CATALOG_CACHED';
    }
    f.setTransport(() => old.promise);
    const pending = f.api.loadWidgetData('catalogs', f.container('catalogs'), { force: true });
    const originalKey = f.api.dashboardWidgetRequestContext('catalogs').key;
    f.setTransport(async () => response({ success: true, data: { legacyCatalogs: { available: false, message: 'New server verdict' },
        inReview: [{ title: 'Fresh scoped Art' }] } }));
    f.emit(eventName);
    assert.notEqual(f.api.dashboardWidgetRequestContext('catalogs').key, originalKey, 'Generation changes even if the external key stays equal');
    assert.equal(f.api.getData('catalogs'), undefined);
    assert.doesNotMatch(f.window.document.body.textContent, /PRIVATE_CATALOG_CACHED/);
    await flush();
    old.resolve(response({ success: true, data: poisonedCatalogData({ available: true }) }));
    assert.equal((await pending).stale, true);
    assert.doesNotMatch(f.window.document.body.textContent, /PRIVATE_CATALOG/);
    assert.match(f.container('catalogs').textContent, /New server verdict/);
    assert.match(f.container('content_pipeline').textContent, /Fresh scoped Art/);
    assert.equal(f.requests.length, 3);
});
}

test('dashboard context key and business scope reject late catalog requests without relying on events', async t => {
    const f = dashboardFixture(t);
    for (const change of [() => f.setContextKey('fixture-account:park:profile-2'), () => f.setBusiness('dar')]) {
        const old = deferred();
        f.setTransport(() => old.promise);
        const pending = f.api.loadWidgetData('catalogs', f.container('catalogs'), { force: true });
        change();
        old.resolve(response({ success: true, data: poisonedCatalogData({ available: true }) }));
        assert.equal((await pending).stale, true);
        assert.equal(f.api.getData('catalogs'), undefined);
        assert.doesNotMatch(f.window.document.body.textContent, /PRIVATE_CATALOG/);
    }
});

test('mixed dashboard denial fans out once, invalidates another widget and does not loop requests', async t => {
    const f = dashboardFixture(t);
    f.enableSharedDenialBridge();
    f.api.seedData('content_pipeline', poisonedCatalogData({ available: true }));
    f.api.renderContentPipeline(poisonedCatalogData({ available: true }), f.container('content_pipeline'));
    const marker = { available: false, code: 'catalogs_not_migrated', message: 'Shared catalog denial' };
    f.setTransport(async () => response({ success: true, data: poisonedCatalogData(marker) }));
    await f.api.loadWidgetData('catalogs', f.container('catalogs'), { force: true });
    await flush();
    assert.equal(f.denials.length, 1);
    assert.equal(f.requests.length, 3, 'Initial widget plus one refresh for each affected widget');
    assert.doesNotMatch(f.window.document.body.textContent, /PRIVATE_CATALOG/);
    assert.match(f.container('content_pipeline').textContent, /Scoped Art review/);
    assert.match(f.container('catalogs').textContent, /Shared catalog denial/);
    const requests = f.requests.length;
    f.window.dispatchEvent(new f.window.CustomEvent('legacyBusinessSurfaceUnavailable', { detail: { surface: 'finance_salary' } }));
    await flush();
    assert.equal(f.requests.length, requests, 'An unrelated denied surface must not reload catalog widgets');
});
