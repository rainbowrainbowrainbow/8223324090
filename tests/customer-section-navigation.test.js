'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'customers.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'js/customers-page.js'), 'utf8');
function harness(t, revenue = true) {
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://crm.test/customers?businessContext=dar&minVisits=2' });
    t.after(() => dom.window.close());
    const context = dom.getInternalVMContext();
    const calls = [];
    Object.assign(context, {
        CrmState: { activeTab: 'list', page: 3, customers: [{ id: 12 }], filters: { search: 'Test family', tag: 'Іменинники жовтня' }, rfmData: {} },
        canViewCustomerRevenue: () => revenue, showNotification: value => calls.push(value),
        customerBusinessContext: () => 'dar',
        loadDuplicates: () => calls.push('duplicates'), loadNps: () => calls.push('nps'),
        loadChildrenReview: () => calls.push('children-review'), loadBulkTab: () => calls.push('bulk')
    });
    const a = source.indexOf('const CUSTOMER_TOOL_DESCRIPTIONS');
    const b = source.indexOf('async function refreshData()', a);
    vm.runInContext(source.slice(a, b), context);
    context.bindCustomerSectionNavigation();
    return { dom, context, calls };
}
test('tools are grouped under analytics and data quality without changing legacy tab IDs', t => {
    const { dom } = harness(t);
    const d = dom.window.document;
    assert.deepEqual([...d.querySelectorAll('[aria-label="Аналітика"] [data-tab]')].map(el => el.dataset.tab), ['rfm', 'nps']);
    assert.deepEqual([...d.querySelectorAll('[aria-label="Якість даних"] [data-tab]')].map(el => el.dataset.tab), ['children-review', 'duplicates']);
    for (const link of d.querySelectorAll('.crm-tab')) {
        const url = new URL(link.href);
        assert.equal(url.searchParams.get('tab'), link.dataset.tab);
        assert.equal(url.searchParams.get('businessContext'), 'dar');
        assert.equal(url.searchParams.get('minVisits'), '2');
        assert.ok(d.getElementById(link.getAttribute('aria-controls')));
    }
});
for (const tab of ['rfm', 'nps', 'children-review', 'duplicates', 'bulk']) {
    test(`${tab} returns to the same search, birthday filter and page, restoring focus`, t => {
        const { dom, context } = harness(t);
        const d = dom.window.document;
        d.querySelector(`[data-tab="${tab}"]`).click();
        assert.equal(context.CrmState.activeTab, tab);
        assert.equal(d.getElementById('customerToolIntro').hidden, false);
        assert.equal(d.querySelector(`[data-tab="${tab}"]`).getAttribute('aria-current'), 'page');
        d.getElementById('customerReturnToList').click();
        assert.equal(context.CrmState.activeTab, 'list');
        assert.equal(context.CrmState.page, 3);
        assert.equal(context.CrmState.filters.search, 'Test family');
        assert.equal(context.CrmState.filters.tag, 'Іменинники жовтня');
        assert.equal(context.CrmState.customers[0].id, 12);
        assert.equal(d.activeElement.id, 'customerSearchInput');
        assert.equal(d.getElementById('customerToolIntro').hidden, true);
    });
}
test('modified click retains browser link behavior instead of switching the current view', t => {
    const { dom, context } = harness(t);
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    dom.window.document.querySelector('[data-tab="nps"]').dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(context.CrmState.activeTab, 'list');
});

test('links follow the selected business even if the address has an older context', t => {
    const { dom, context } = harness(t);
    context.customerBusinessContext = () => 'event_genix';
    context.syncCustomerSectionNavigation('nps');
    for (const link of dom.window.document.querySelectorAll('.crm-tab')) {
        assert.equal(new URL(link.href).searchParams.get('businessContext'), 'event_genix');
    }
});

test('legacy journey filters do not override an explicit tool tab in a new window', t => {
    const { dom, context } = harness(t);
    dom.reconfigure({ url: 'https://crm.test/customers?journey=returning&tab=nps&businessContext=dar' });
    context.getCustomerLifecycleSegment = () => ({ id: 'returning', kind: 'customers' });
    let applied;
    context.applyCustomerLifecycleSegment = stage => { applied = stage.id; };
    const a = source.indexOf('function applyInitialCustomerQueryParams()');
    const b = source.indexOf('function getCustomerFilterSummary()', a);
    vm.runInContext(source.slice(a, b), context);
    assert.equal(context.applyInitialCustomerQueryParams(), 'nps');
    assert.equal(applied, 'returning');
});
test('existing revenue gate still rejects RFM and unknown tabs return to the list', t => {
    const { context, calls } = harness(t, false);
    context.switchTab('rfm');
    assert.equal(context.CrmState.activeTab, 'list');
    assert.match(calls[0], /Недостатньо прав/);
    context.switchTab('invalid');
    assert.equal(context.CrmState.activeTab, 'list');
});

test('RFM failure is visible and reopening retries without caching an empty result', async t => {
    const { dom, context } = harness(t);
    context.CrmState.rfmData = null;
    let attempts = 0, renders = 0;
    context.fetchRFM = async () => {
        attempts++;
        if (attempts === 1) throw new Error('Fixture unavailable');
        context.CrmState.rfmData = { customers: [], segments: {} };
    };
    context.renderRFM = () => { renders++; };
    context.switchTab('rfm');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(dom.window.document.getElementById('rfmTableBody').textContent, /Не вдалося/);
    assert.ok(dom.window.document.querySelector('#rfmTableBody [role="alert"]'));
    assert.equal(context.CrmState.rfmData, null);
    context.switchTab('rfm');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 2);
    assert.equal(renders, 1);
});

test('list lookup failure preserves filters/page, clears stale rows and offers explicit retry', async t => {
    const { dom, context } = harness(t);
    Object.assign(context, {
        customerApiUrl: value => value, hasVisitBound: () => false,
        AbortController, fetch: async () => ({ ok: false, json: async () => ({ error: 'Fixture unavailable' }) }),
        renderCustomerTable: () => assert.fail('Failure must not render a successful list'),
        renderPagination: () => assert.fail('Failure must not render successful pagination')
    });
    const a = source.indexOf('async function fetchCustomers()');
    const b = source.indexOf('async function fetchStats()', a);
    vm.runInContext('let customersRequestController=null, customersRequestSeq=0;\n' + source.slice(a, b), context);
    assert.equal(await context.reloadCustomers(), false);
    const d = dom.window.document;
    assert.ok(d.querySelector('#customerTableBody [role="alert"]'));
    assert.ok(d.querySelector('[data-customers-retry]'));
    assert.equal(context.CrmState.page, 3);
    assert.equal(context.CrmState.filters.search, 'Test family');
    assert.equal(context.CrmState.customers[0].id, 12);
    assert.doesNotMatch(d.getElementById('customerTableBody').textContent, /Клієнтів не знайдено/);
});

function customerInitHarness(t) {
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://crm.test/customers?tab=rfm' });
    t.after(() => dom.window.close());
    const context = dom.getInternalVMContext();
    const calls = { permissions: [], data: [], decisions: [], shells: [], recoveries: [] };
    const user = { id: 73, name: 'Fixture manager', role: 'senior_manager' };
    let resolvePermissions;
    const permissionResponse = new Promise(resolve => { resolvePermissions = resolve; });
    let initialize;
    const addEventListener = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') initialize = listener;
        else addEventListener(type, listener, options);
    };
    vm.runInContext(source + '\nthis.customerInitState = CrmState;', context, { filename: 'js/customers-page.js' });
    dom.window.document.addEventListener = addEventListener;
    assert.equal(typeof initialize, 'function', 'The real customer page registers its initialization entrypoint');
    Object.assign(context, {
        AppState: { currentUser: null },
        initDarkMode() {},
        apiVerifyToken: async () => user,
        async hydrateActionPermissions(verifiedUser) {
            calls.permissions.push(verifiedUser);
            const permissions = await permissionResponse;
            context.AppState.authPermissions = permissions;
            return permissions;
        },
        canAccess(action) {
            calls.decisions.push({ action, permissions: context.AppState.authPermissions });
            return context.AppState.authPermissions?.capabilities?.['action:' + action]?.allowed === true;
        },
        showAuthenticatedPageShell: options => calls.shells.push(options),
        initCustomerBusinessContext() {},
        reloadCustomers: async () => { calls.data.push('customers'); },
        fetchStats: async () => { calls.data.push('stats'); },
        fetchCustomerTags: async () => { calls.data.push('tags'); },
        fetchRFM: async () => {
            calls.data.push('rfm');
            context.customerInitState.rfmData = { customers: [], segments: {} };
        },
        showNotification() {},
        maybeOpenCustomerCreateFromUrl: () => false,
        permissionFailureMessage: () => 'Fixture permission service unavailable',
        _escHtml: value => String(value),
        ensureAuthSessionRecoverySurface() {
            let surface = dom.window.document.getElementById('fixture-permission-recovery');
            if (!surface) {
                surface = dom.window.document.createElement('div');
                surface.id = 'fixture-permission-recovery';
                dom.window.document.body.appendChild(surface);
            }
            return surface;
        }
    });
    for (const name of [
        'syncCustomerActionsMenu', 'syncCustomerReadOnlyUi', 'bindCustomerActionsMenu',
        'bindCustomerFilterControls', 'renderCustomerFilterControls', 'bindChildrenReviewTools',
        'bindCustomerIdentityTools', 'bindCustomerEditTagTools', 'bindCustomerEditChildrenTools',
        'bindEntityModalSafeClose', 'bindCustomerEntityEscapeClose', 'renderTagFilters',
        'renderStats', 'renderRFM', 'openCustomerDeepLink'
    ]) context[name] = () => {};
    const authSource = fs.readFileSync(path.join(root, 'js/auth.js'), 'utf8');
    const recoveryStart = authSource.indexOf('function renderPermissionBootstrapError(');
    const recoveryEnd = authSource.indexOf('async function hydrateActionPermissions(', recoveryStart);
    assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
    vm.runInContext(authSource.slice(recoveryStart, recoveryEnd), context, { filename: 'js/auth.js' });
    const renderRecovery = context.renderPermissionBootstrapError;
    context.renderPermissionBootstrapError = options => {
        calls.recoveries.push(options);
        return renderRecovery(options);
    };
    return { dom, context, calls, user, initialize, resolvePermissions };
}

for (const allowed of [true, false]) {
    test(`customer init waits for server revenue ${allowed ? 'allow' : 'deny'} before deciding the RFM deep link`, async t => {
        const h = customerInitHarness(t);
        const initialized = h.initialize();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(h.calls.permissions, [h.user], 'Permissions are loaded for the verified account');
        assert.deepEqual(h.calls.decisions, [], 'Revenue visibility is not decided before server permissions arrive');
        assert.deepEqual(h.calls.data, [], 'Customer data requests wait for permission bootstrap');
        assert.deepEqual(h.calls.shells, [], 'The authenticated runtime is not marked ready while permissions are pending');
        const permissions = { capabilities: { 'action:view_revenue': { allowed } } };
        h.resolvePermissions(permissions);
        await initialized;
        await new Promise(resolve => setImmediate(resolve));
        const d = h.dom.window.document;
        assert.equal(d.querySelector('[data-tab="rfm"]').style.display, allowed ? '' : 'none');
        assert.equal(d.getElementById('customerSpentHeader').style.display, allowed ? '' : 'none');
        assert.equal(h.context.customerInitState.activeTab, allowed ? 'rfm' : 'list');
        assert.deepEqual(h.calls.data, allowed ? ['customers', 'stats', 'tags', 'rfm'] : ['customers', 'stats', 'tags']);
        assert.ok(h.calls.decisions.every(decision => decision.permissions === permissions));
        assert.equal(h.calls.recoveries.length, 0);
    });
}

test('customer init permission failure stops data requests and renders the existing retry recovery', async t => {
    const h = customerInitHarness(t);
    const initialized = h.initialize();
    await new Promise(resolve => setImmediate(resolve));
    h.resolvePermissions(null);
    await initialized;
    assert.deepEqual(h.calls.permissions, [h.user]);
    assert.deepEqual(h.calls.decisions, [], 'Unavailable permissions must not masquerade as an authoritative deny');
    assert.deepEqual(h.calls.data, []);
    assert.equal(h.calls.shells.length, 1);
    assert.equal(h.calls.shells[0].markRuntimeReady, false);
    assert.equal(h.calls.recoveries.length, 1);
    assert.equal(h.calls.recoveries[0].overlay, true);
    assert.equal(typeof h.calls.recoveries[0].retry, 'function');
    const recovery = h.dom.window.document.querySelector('[data-permission-state="error"]');
    assert.ok(recovery);
    assert.equal(recovery.getAttribute('role'), 'alert');
    assert.match(recovery.textContent, /Fixture permission service unavailable/);
    assert.ok(recovery.querySelector('[data-permission-retry]'));
    assert.equal(h.context.customerInitState.activeTab, 'list');
});