'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/leads-page.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'leads.html'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function workspace(id, overrides = {}) {
    return {
        lead: { id, clientName: `Fixture lead ${id}`, businessContext: 'event_genix', pipelineStage: 'new', status: 'new', leadType: 'quality' },
        customer: null,
        tasks: [], bookings: [], interactions: [], conversations: [],
        conversationContext: { confirmedLinks: [], suggestions: [], resolution: { action: 'empty' } },
        ...overrides
    };
}

function response(record, options = {}) {
    return { ok: options.ok !== false, json: async () => ({ success: options.ok !== false, workspace: record, error: options.error }) };
}

function harness(t, url = 'https://crm.example/sales-funnel?queue=active', options = {}) {
    const virtualConsole = new VirtualConsole();
    const navigationAttempts = [];
    virtualConsole.on('jsdomError', error => {
        if (error.message.includes('Not implemented: navigation')) navigationAttempts.push(error.message);
        else throw error;
    });
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url, virtualConsole });
    t.after(() => dom.window.close());
    const { window } = dom;
    const requests = [];
    const notifications = [];
    const confirmations = [];
    let confirmResult = false;
    let requestHandler = request => response(workspace(Number(request.url.match(/\/leads\/(\d+)/)?.[1])));
    // JSDOM has no layout; the actual-app browser smoke checks visible tab scrolling.
    window.HTMLElement.prototype.scrollIntoView = function () {};
    window.canAccess = () => true;
    window.showNotification = (...args) => notifications.push(args);
    window.__workspaceRequest = (url, options = {}) => {
        const request = { url, method: options.method || 'GET', body: options.body };
        requests.push(request);
        return Promise.resolve(requestHandler(request));
    };

    // Keep application startup out of this isolated harness; all workspace functions
    // and renderers below are evaluated directly from the production source.
    const addEventListener = window.document.addEventListener.bind(window.document);
    window.document.addEventListener = (event, listener, options) => {
        if (event !== 'DOMContentLoaded') addEventListener(event, listener, options);
    };
    if (options.editor) {
        vm.runInContext(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'), dom.getInternalVMContext(), { filename: 'js/ui.js' });
        window.confirmModal = async (...args) => { confirmations.push(args); return confirmResult; };
        window.showNotification = (...args) => notifications.push(args);
    }
    vm.runInContext(source, dom.getInternalVMContext(), { filename: 'js/leads-page.js' });
    window.document.addEventListener = addEventListener;
    vm.runInContext(`
        apiFetch = (url, options) => window.__workspaceRequest(url, options);
        window.__workspaceTest = {
            openLeadWorkspace, openWorkspaceFromUrl, closeLeadWorkspace, openLeadCustomerCard,
            openDetails: (...args) => openLeadDetails(...args),
            selectTab: (...args) => setLeadWorkspaceTab(...args),
            getWorkspaceLeadIdFromUrl,
            state: () => ({ leadId: workspaceLeadId, data: currentWorkspaceData }),
            setCustomerEnsure(fn) { ensureLeadCustomerForBooking = fn; },
            setEditableCloseGuard(fn) { closeActiveLeadEditableSurfaces = fn; },
            createCustomer: (...args) => createLeadCustomerCard(...args)
        };
        window.__workspaceTest.edit = (...args) => editLead(...args);
        window.__workspaceTest.save = (...args) => saveLead(...args);
        window.__workspaceTest.openAdd = (...args) => openAddModal(...args);
        window.__workspaceTest.closeEditor = (...args) => closeLeadModal(...args);
        window.__workspaceTest.setup = () => setupEvents();
        window.__workspaceTest.setBusiness = value => { currentBusinessContext = value; };
        window.__workspaceTest.setRows = value => { leadsData = value; };
        const originalLoadLeads = loadLeads;
        window.__workspaceTest.restoreListReload = () => { loadLeads = originalLoadLeads; currentView = 'table'; };
        window.__workspaceTest.rows = () => leadsData;
        window.__workspaceTest.setCollaborationPrompt = fn => { requestCollaborationLeadTaskPayload = fn; };
        window.__workspaceTest.stubListReload = () => { loadLeads = async () => {}; };
    `, dom.getInternalVMContext());
    return {
        window, document: window.document, app: window.__workspaceTest, requests, notifications, confirmations, navigationAttempts,
        setConfirmResult(value) { confirmResult = value; },
        setRequestHandler(handler) { requestHandler = handler; },
        invokeInline(control) { return vm.runInContext(control.getAttribute('onclick'), dom.getInternalVMContext()); },
        async flush() {
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => window.requestAnimationFrame(resolve));
        }
    };
}

function selectedTab(h) {
    return h.document.querySelector('#leadWorkspaceTabs [aria-selected="true"]')?.dataset.workspaceTab;
}

function assertOnlyReads(h) {
    assert.ok(h.requests.length > 0, 'the real opener requested workspace data');
    assert.deepEqual([...new Set(h.requests.map(request => request.method))], ['GET']);
}

test('lead opener and Details alias share a read-only workspace; tab changes do not write', async t => {
    const h = harness(t);
    await h.app.openLeadWorkspace(901);
    await h.flush();
    assert.equal(selectedTab(h), 'overview');
    assert.equal(h.document.querySelector('#leadWorkspace').getAttribute('aria-hidden'), 'false');
    const requestCountAfterOpen = h.requests.length;
    for (const tab of ['details', 'communications', 'history', 'overview']) {
        h.document.querySelector('#leadWorkspaceBody').scrollTop = 250;
        await h.app.selectTab(tab);
        assert.equal(selectedTab(h), tab);
        assert.equal(h.document.querySelector('#leadWorkspaceBody').scrollTop, 0, 'a different tab starts at the top');
        assert.equal(h.document.querySelector(`#leadWorkspacePanel-${tab}`).hidden, false);
        assert.equal(h.document.querySelectorAll('#leadWorkspaceBody [role="tabpanel"]:not([hidden])').length, 1);
    }
    h.document.querySelector('#leadWorkspaceBody').scrollTop = 80;
    await h.app.selectTab('overview');
    assert.equal(h.document.querySelector('#leadWorkspaceBody').scrollTop, 80, 'reselecting the active tab does not jump the reader');
    assert.equal(h.requests.length, requestCountAfterOpen, 'tab switching reuses loaded workspace data');
    await h.app.openDetails(901);
    assert.equal(selectedTab(h), 'details');
    assert.equal(h.document.querySelector('#leadModal').classList.contains('active'), false);
    assert.equal(h.document.querySelector('#customerCardModal').classList.contains('active'), false);
    assert.equal(h.document.querySelectorAll('#leadWorkspacePanel-details input, #leadWorkspacePanel-details select, #leadWorkspacePanel-details textarea').length, 0);
    assertOnlyReads(h);
});

test('tab deep links survive reload, same-lead refresh, and browser Back without reopening an editor', async t => {
    const h = harness(t, 'https://crm.example/sales-funnel?leadId=902&leadTab=communications&queue=active');
    h.app.openWorkspaceFromUrl();
    await h.flush();
    assert.equal(h.app.state().leadId, 902);
    assert.equal(selectedTab(h), 'communications');
    await h.app.openLeadWorkspace(902, { pushState: false });
    assert.equal(selectedTab(h), 'communications', 'a refresh keeps the active tab');
    await h.app.selectTab('details');
    assert.equal(new URL(h.window.location.href).searchParams.get('leadTab'), 'details');
    assert.equal(new URL(h.window.location.href).searchParams.get('queue'), 'active');
    const popped = new Promise(resolve => h.window.addEventListener('popstate', resolve, { once: true }));
    h.window.history.back();
    await popped;
    await h.flush();
    assert.equal(selectedTab(h), 'communications');
    assert.equal(h.app.state().leadId, 902);
    await h.app.closeLeadWorkspace();
    const closedUrl = new URL(h.window.location.href);
    assert.equal(closedUrl.searchParams.has('lead'), false);
    assert.equal(closedUrl.searchParams.has('leadId'), false);
    assert.equal(closedUrl.searchParams.has('leadTab'), false);
    assertOnlyReads(h);
});

test('legacy open links enter the same viewer and are removed when the workspace URL changes', async t => {
    const h = harness(t, 'https://crm.example/sales-funnel?open=912&queue=active');
    h.app.openWorkspaceFromUrl();
    await h.flush();
    assert.equal(h.app.state().leadId, 912);
    assert.equal(selectedTab(h), 'overview');
    assert.equal(h.document.querySelector('#leadModal').classList.contains('active'), false);
    await h.app.selectTab('details');
    const canonical = new URL(h.window.location.href);
    assert.equal(canonical.searchParams.get('lead'), '912');
    assert.equal(canonical.searchParams.has('open'), false);
    assert.equal(canonical.searchParams.get('businessContext'), 'event_genix');
    await h.app.closeLeadWorkspace();
    assert.equal(h.app.getWorkspaceLeadIdFromUrl(), null, 'closing cannot resurrect a stale open alias');
    assertOnlyReads(h);
});

test('Omni and customer entry points include the source business in canonical lead URLs', () => {
    const omniSource = fs.readFileSync(path.join(root, 'omni.html'), 'utf8');
    const customerSource = fs.readFileSync(path.join(root, 'js/customers-page.js'), 'utf8');
    let businessContext = 'event_genix';
    const sandbox = {
        URL,
        window: {
            location: { origin: 'https://crm.example' },
            CrmBusinessContext: { current: () => businessContext }
        },
        customerBusinessContext: () => businessContext
    };
    vm.createContext(sandbox);
    vm.runInContext(
        omniSource.slice(omniSource.indexOf('function getOmniBusinessContext('), omniSource.indexOf('function omniApiUrl('))
        + omniSource.slice(omniSource.indexOf('function leadUrl('), omniSource.indexOf('function openLeadUrl('))
        + customerSource.slice(customerSource.indexOf('function customerCrmContextHref('), customerSource.indexOf('const CUSTOMER_PIPELINE_STAGE_MAP')),
        sandbox
    );
    for (const context of ['event_genix', 'dar', 'maysternya_doli']) {
        businessContext = context;
        for (const [entry, href] of [['Omni', sandbox.leadUrl(911)], ['customer', sandbox.leadCrmLinkForCustomer(911)]]) {
            const url = new URL(href, 'https://crm.example');
            assert.equal(url.pathname, '/sales-funnel', entry);
            assert.equal(url.searchParams.get('lead'), '911', entry);
            assert.equal(url.searchParams.get('businessContext'), context, `${entry} must not inherit another tab's last business`);
            assert.equal(url.searchParams.has('open'), false, entry);
        }
    }
});

test('stale workspace responses cannot replace another lead or reopen a closed card', async t => {
    const h = harness(t);
    const old = deferred();
    h.setRequestHandler(request => request.url.includes('/901/') ? old.promise : response(workspace(902)));
    const firstOpen = h.app.openLeadWorkspace(901, { tab: 'details' });
    await h.flush();
    await h.app.openLeadWorkspace(902, { tab: 'communications' });
    old.resolve(response(workspace(901)));
    await firstOpen;
    assert.equal(h.app.state().leadId, 902);
    assert.equal(h.app.state().data.lead.id, 902);
    assert.equal(selectedTab(h), 'communications');
    assert.match(h.document.querySelector('#leadWorkspaceTitle').textContent, /902/);

    const closed = deferred();
    h.setRequestHandler(() => closed.promise);
    const loadingOpen = h.app.openLeadWorkspace(903);
    await h.flush();
    await h.app.closeLeadWorkspace();
    closed.resolve(response(workspace(903)));
    await loadingOpen;
    assert.equal(h.app.state().leadId, null);
    assert.equal(h.document.querySelector('#leadWorkspace').getAttribute('aria-hidden'), 'true');
    assert.notEqual(h.app.state().data?.lead?.id, 903, 'closed workspace response is discarded');
});

test('tab keyboard navigation uses one focus stop and never sends mutations', async t => {
    const h = harness(t);
    const trigger = h.document.createElement('button');
    trigger.textContent = 'Fixture lead trigger';
    h.document.body.append(trigger);
    trigger.focus();
    await h.app.openLeadWorkspace(904);
    await h.flush();
    const tab = name => h.document.querySelector(`#leadWorkspaceTabs [data-workspace-tab="${name}"]`);
    tab('overview').focus();
    tab('overview').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(h.document.activeElement, tab('details'));
    tab('details').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    assert.equal(h.document.activeElement, tab('history'));
    tab('history').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assert.equal(h.document.activeElement, tab('overview'));
    assert.equal(h.document.querySelectorAll('#leadWorkspaceTabs [tabindex="0"]').length, 1);
    h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await h.flush();
    assert.equal(h.document.querySelector('#leadWorkspace').getAttribute('aria-hidden'), 'true');
    assert.equal(h.document.activeElement, trigger, 'closing the workspace returns keyboard focus to its opener');
    assertOnlyReads(h);
});

test('opening a missing customer never creates one; only the explicit create action does', async t => {
    const h = harness(t);
    let ensureCalls = 0;
    h.app.setCustomerEnsure(async leadId => {
        ensureCalls += 1;
        return { lead: workspace(leadId).lead, customer: { id: 990 } };
    });
    await h.app.openLeadWorkspace(905);
    await h.app.openLeadCustomerCard(905);
    assert.equal(ensureCalls, 0, 'opening a customer card cannot call the customer creation helper');
    assertOnlyReads(h);
    await h.app.createCustomer(905);
    assert.equal(ensureCalls, 1, 'the explicit create action owns customer creation');
});

test('a failed workspace load hides the previous lead and retry preserves the requested lead and tab', async t => {
    const h = harness(t);
    await h.app.openLeadWorkspace(906);
    h.setRequestHandler(() => response(null, { ok: false, error: 'Fixture unavailable' }));
    await h.app.openLeadWorkspace(907, { tab: 'details' });
    const body = h.document.querySelector('#leadWorkspaceBody').textContent;
    assert.match(body, /Fixture unavailable/);
    assert.doesNotMatch(body, /Fixture lead 906/);
    assert.equal(h.app.state().data, null, 'actions cannot reuse data from the previously opened lead after an error');
    assert.match(h.document.querySelector('#leadWorkspaceBody [role="alert"]').textContent, /Fixture unavailable/);
    const retry = [...h.document.querySelectorAll('#leadWorkspaceBody button')].find(button => button.textContent === 'Спробувати ще раз');
    assert.ok(retry, 'the failure offers a usable retry control');
    const historyLength = h.window.history.length;
    const requestCount = h.requests.length;
    h.setRequestHandler(() => response(workspace(907)));
    await h.invokeInline(retry);
    assert.equal(h.app.state().data.lead.id, 907);
    assert.equal(selectedTab(h), 'details');
    assert.equal(h.window.history.length, historyLength, 'retry does not add duplicate history');
    assert.equal(h.requests.length, requestCount + 1, 'retry emits one workspace read');
    assert.equal(h.document.querySelector('#leadWorkspaceBody [role="alert"]'), null);
    assertOnlyReads(h);
});

test('cross-business browser history honors discard before reinitializing the context', async t => {
    const h = harness(t);
    await h.app.openLeadWorkspace(909, { tab: 'details' });
    let closeChecks = 0;
    h.app.setEditableCloseGuard(async () => { closeChecks += 1; return false; });
    const requestCount = h.requests.length;
    h.window.history.replaceState({}, '', '/sales-funnel?lead=910&leadTab=communications&businessContext=dar');
    h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
    await h.flush();
    const restored = new URL(h.window.location.href);
    assert.equal(restored.searchParams.get('businessContext'), 'event_genix');
    assert.equal(restored.searchParams.get('lead'), '909');
    assert.equal(restored.searchParams.get('leadTab'), 'details');
    assert.equal(h.navigationAttempts.length, 0, 'rejected discard cannot reload away from the dirty editor');
    assert.equal(h.requests.length, requestCount, 'another business cannot fetch a lead through the old context');

    h.app.setEditableCloseGuard(async () => { closeChecks += 1; return true; });
    h.window.history.replaceState({}, '', '/sales-funnel?lead=910&leadTab=communications&businessContext=dar');
    h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
    await h.flush();
    assert.equal(closeChecks, 2);
    assert.equal(h.navigationAttempts.length, 1, 'accepted discard reinitializes the page context');
    assert.equal(h.requests.length, requestCount, 'reinitialization never reuses the old business API context');
    assertOnlyReads(h);
});

test('Details preserves lead data without overriding explicit guest counts or inventing an Instagram username', async t => {
    const h = harness(t);
    const lead = {
        ...workspace(908).lead,
        phone: '+380000000908', instagram: '10000000000908', assignedName: 'Fixture manager',
        sourceChannel: 'instagram', childrenCount: 7,
        eventPreference: { preferredDate: '2099-05-12', childrenCount: 0, adultsCount: 12 },
        notes: 'Fixture lead notes', programName: 'Fixture program'
    };
    h.setRequestHandler(() => response(workspace(908, { lead })));
    await h.app.openLeadWorkspace(908, { tab: 'details' });
    const panel = h.document.querySelector('#leadWorkspacePanel-details');
    const value = label => [...panel.querySelectorAll('dt')].find(node => node.textContent === label)?.nextElementSibling.textContent;
    assert.equal(value('Діти'), '0', 'an explicit zero from event preference wins over a legacy count');
    assert.equal(value('Дорослі'), '12');
    assert.equal(value('Телефон'), lead.phone);
    assert.equal(value('Відповідальний'), lead.assignedName);
    assert.equal(value('Програма'), lead.programName);
    assert.equal(value('Нотатки ліда'), lead.notes);
    assert.match(panel.querySelector('details').textContent, /10000000000908/);
    assert.doesNotMatch(h.document.querySelector('.workspace-hero').textContent, /@10000000000908/);
    delete lead.eventPreference;
    await h.app.openLeadWorkspace(908, { pushState: false });
    const legacyChildren = [...h.document.querySelectorAll('#leadWorkspacePanel-details dt')]
        .find(node => node.textContent === 'Діти').nextElementSibling.textContent;
    assert.equal(legacyChildren, '7', 'legacy camelCase API count remains visible when no preference is saved');
    assertOnlyReads(h);
});

function editorHarness(t, records) {
    const h = harness(t, 'https://crm.example/sales-funnel', { editor: true });
    h.app.stubListReload();
    h.app.setup();
    h.setRequestHandler(request => {
        const id = Number(request.url.match(/\/leads\/(\d+)/)?.[1]);
        if (request.method === 'PATCH') return { ok: true, json: async () => ({ success: true, lead: { id } }) };
        return response(records.get(id) || workspace(id));
    });
    h.field = id => h.document.getElementById(id);
    h.change = (id, value) => {
        h.field(id).value = value;
        h.field(id).dispatchEvent(new h.window.Event('input', { bubbles: true }));
    };
    h.mutations = () => h.requests.filter(request => !['GET', 'HEAD'].includes(request.method));
    return h;
}

function editableWorkspace(id, leadOverrides = {}) {
    return workspace(id, { lead: {
        ...workspace(id).lead,
        source: 'instagram', sourceChannel: 'instagram', phone: '+380000000901',
        notes: 'Original lead note', eventDate: '2099-05-12', childrenCount: 3,
        eventPreference: { preferredDate: '2099-05-12', childrenCount: 3, adultsCount: 4, notes: 'Preserve preference note' },
        celebrants: [{ name: 'Fixture child', age: 8, birthday: '2091-05-12', notes: 'Preserve child note' }],
        ...leadOverrides
    } });
}

test('editing a direct-ID lead mounts one shared form and preserves its draft across tabs and refresh', async t => {
    const record = editableWorkspace(920);
    const h = editorHarness(t, new Map([[920, record]]));
    h.app.setRows([]);
    await h.app.edit(920);
    assert.equal(h.document.querySelectorAll('#leadEditorForm').length, 1);
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadWorkspaceEditorHost');
    assert.equal(h.field('leadEditId').value, '920');
    assert.equal(h.field('leadName').value, record.lead.clientName);
    assert.equal(h.field('leadModal').classList.contains('active'), false, 'editing does not open the old create overlay');
    h.change('leadName', 'Unsaved direct-ID draft');
    const readCount = h.requests.length;
    await h.app.selectTab('communications');
    await h.app.selectTab('details');
    await h.app.openLeadWorkspace(920, { tab: 'history' });
    await h.app.openLeadWorkspace(920, { tab: 'details' });
    assert.equal(h.requests.length, readCount, 'same-lead tab opening reuses the loaded data');
    const form = h.field('leadEditorForm');
    const refreshed = editableWorkspace(920, { notes: 'Fresh server context' });
    h.setRequestHandler(() => response(refreshed));
    await h.app.openLeadWorkspace(920, { pushState: false });
    assert.equal(h.field('leadName').value, 'Unsaved direct-ID draft');
    assert.equal(h.field('leadEditorForm'), form, 'context refresh retains the actual draft form node');
    assert.equal(h.requests.length, readCount + 1);
    assert.equal(h.app.state().data.lead.notes, 'Fresh server context');
    assert.match(h.field('leadWorkspaceDataView').textContent, /Fresh server context/);
    h.setRequestHandler(() => response(null, { ok: false, error: 'Context refresh unavailable' }));
    await h.app.openLeadWorkspace(920, { pushState: false });
    assert.equal(h.field('leadEditorForm'), form);
    assert.equal(h.field('leadName').value, 'Unsaved direct-ID draft');
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadWorkspaceEditorHost');
    assert.deepEqual(h.mutations(), []);
});

test('changing only the name emits a sparse patch without clearing untouched lead metadata', async t => {
    const h = editorHarness(t, new Map([[921, editableWorkspace(921)]]));
    await h.app.edit(921);
    h.change('leadName', 'Changed name');
    await h.app.save();
    assert.equal(h.mutations().length, 1);
    const patch = JSON.parse(h.mutations()[0].body);
    assert.equal(patch.client_name, 'Changed name');
    for (const field of ['phone', 'instagram', 'source', 'source_channel', 'event_date', 'children_count', 'eventPreference', 'celebrants', 'notes', 'assigned_to', 'pipeline_stage', 'lead_type', 'program_id']) {
        assert.equal(Object.hasOwn(patch, field), false, `unchanged ${field} must not be overwritten`);
    }
});

test('guest-count changes preserve saved event-preference notes', async t => {
    const h = editorHarness(t, new Map([[922, editableWorkspace(922)]]));
    await h.app.edit(922);
    h.change('leadAdultsCount', '12');
    await h.app.save();
    const patch = JSON.parse(h.mutations()[0].body);
    assert.equal(patch.eventPreference.adultsCount, 12);
    assert.equal(patch.eventPreference.childrenCount, 3);
    assert.equal(patch.eventPreference.notes, 'Preserve preference note');
    assert.equal(Object.hasOwn(patch, 'celebrants'), false);
    assert.equal(Object.hasOwn(patch, 'notes'), false);
});

test('Maysternya edits omit hidden guest, event and celebrant fields', async t => {
    const record = editableWorkspace(923, { businessContext: 'maysternya_doli', source: 'maysternya_bot', sourceChannel: 'maysternya_bot' });
    const h = editorHarness(t, new Map([[923, record]]));
    h.app.setBusiness('maysternya_doli');
    await h.app.edit(923);
    h.change('leadNotes', 'Updated consultation note');
    await h.app.save();
    const patch = JSON.parse(h.mutations()[0].body);
    assert.equal(patch.notes, 'Updated consultation note');
    assert.equal(patch.businessContext, 'maysternya_doli');
    for (const field of ['eventPreference', 'children_count', 'celebrants', 'child_age', 'program_id', 'event_date', 'source']) {
        assert.equal(Object.hasOwn(patch, field), false, `hidden or unchanged ${field} must stay intact`);
    }
});

test('duplicate saves send one request and server or network failure retains the editable draft', async t => {
    const record = editableWorkspace(924);
    const h = editorHarness(t, new Map([[924, record]]));
    await h.app.edit(924);
    h.change('leadName', 'Recoverable draft');
    const pending = deferred();
    h.setRequestHandler(request => request.method === 'PATCH' ? pending.promise : response(record));
    const first = h.app.save();
    const second = h.app.save();
    await h.flush();
    assert.equal(h.mutations().length, 1);
    assert.equal(h.field('leadModalSave').disabled, true);
    pending.resolve({ ok: false, json: async () => ({ success: false, error: 'Fixture network failure' }) });
    await Promise.all([first, second]);
    assert.equal(h.field('leadName').value, 'Recoverable draft');
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadWorkspaceEditorHost');
    assert.equal(h.field('leadModalSave').disabled, false);
    assert.ok(h.notifications.some(args => args.some(value => String(value).includes('Fixture network failure'))));
    h.setRequestHandler(request => request.method === 'PATCH' ? Promise.reject(new Error('Fixture connection lost')) : response(record));
    await h.app.save();
    assert.equal(h.field('leadName').value, 'Recoverable draft');
    assert.equal(h.field('leadModalSave').disabled, false);
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadWorkspaceEditorHost');
    assert.ok(h.notifications.some(args => args.some(value => String(value).includes('Fixture connection lost'))));
});

test('dirty embedded drafts reject close, Escape, other-lead and business-history navigation', async t => {
    const h = editorHarness(t, new Map([[925, editableWorkspace(925)], [926, editableWorkspace(926)]]));
    await h.app.edit(925);
    h.change('leadName', 'Protected draft');
    const reload = new h.window.Event('beforeunload', { cancelable: true });
    h.window.dispatchEvent(reload);
    assert.equal(reload.defaultPrevented, true, 'reload or external navigation warns before discarding the draft');
    h.setConfirmResult(false);
    await h.app.closeLeadWorkspace();
    assert.equal(h.app.state().leadId, 925);
    h.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await h.flush();
    assert.equal(h.app.state().leadId, 925);
    await h.app.openLeadWorkspace(926);
    assert.equal(h.app.state().leadId, 925);
    h.window.history.replaceState({}, '', '/sales-funnel?businessContext=event_genix');
    h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
    await h.flush();
    assert.equal(new URL(h.window.location.href).searchParams.get('lead'), '925', 'rejected Back restores the draft lead URL');
    assert.equal(new URL(h.window.location.href).searchParams.get('leadTab'), 'details');
    h.window.history.replaceState({}, '', '/sales-funnel?lead=926&businessContext=dar');
    h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
    await h.flush();
    assert.equal(new URL(h.window.location.href).searchParams.get('businessContext'), 'event_genix');
    assert.equal(h.navigationAttempts.length, 0);
    assert.equal(h.field('leadName').value, 'Protected draft');
    assert.ok(h.confirmations.length >= 5, 'every navigation boundary asks before discarding');
    assert.deepEqual(h.mutations(), []);
    h.setConfirmResult(true);
    await h.app.closeLeadWorkspace();
    assert.equal(h.app.state().leadId, null);
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadCreateEditorHost');
});

test('unchanged edits close without a PATCH and validation keeps the create draft open', async t => {
    const h = editorHarness(t, new Map([[927, editableWorkspace(927)]]));
    await h.app.edit(927);
    await h.app.save();
    assert.deepEqual(h.mutations(), []);
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadCreateEditorHost');
    await h.app.openAdd();
    await h.app.save();
    assert.deepEqual(h.mutations(), []);
    assert.equal(h.field('leadModal').classList.contains('active'), true);
    h.change('leadName', 'Validated create draft');
    h.change('leadChildrenCount', '201');
    await h.app.save();
    assert.deepEqual(h.mutations(), []);
    assert.equal(h.field('leadName').value, 'Validated create draft');
    assert.equal(h.field('leadModalSave').disabled, false);
    assert.ok(h.notifications.some(args => args.some(value => String(value).includes('від 0 до 200'))));
});

test('create duplicate submission is blocked while the real stage confirmation awaits a response', async t => {
    const h = editorHarness(t, new Map());
    const prompt = deferred();
    h.setConfirmResult(prompt.promise);
    await h.app.openAdd({ createStage: 'deposit_received' });
    h.change('leadName', 'Single create after prompt');
    h.setRequestHandler(request => request.method === 'POST'
        ? { ok: true, json: async () => ({ success: true, lead: { id: 928 } }) } : response(workspace(928)));
    const first = h.app.save();
    const second = h.app.save();
    await h.flush();
    assert.equal(h.confirmations.length, 1, 'duplicate click must not open another workflow prompt');
    assert.deepEqual(h.mutations(), []);
    assert.equal(await h.app.closeEditor(), false, 'pending workflow blocks navigation before any HTTP mutation');
    prompt.resolve(true);
    await Promise.all([first, second]);
    assert.equal(h.mutations().length, 1);
    assert.equal(JSON.parse(h.mutations()[0].body).pipeline_stage, 'deposit_received');
    assert.equal(h.field('leadModal').classList.contains('active'), false);
});

test('collaboration workflow success followed by PATCH failure retries contacts without duplicating the task', async t => {
    const record = editableWorkspace(929);
    const h = editorHarness(t, new Map([[929, record]]));
    await h.app.edit(929);
    h.change('leadName', 'Contact draft after collaboration');
    h.change('leadLeadType', 'collaboration');
    let promptCount = 0;
    h.app.setCollaborationPrompt(async () => { promptCount += 1; return { title: 'Isolated task' }; });
    let patchCount = 0;
    h.setRequestHandler(request => {
        if (request.url.endsWith('/collaboration-task')) return {
            ok: true, json: async () => ({ success: true, task: { id: 99 }, lead: { pipeline_stage: 'contacted' } })
        };
        if (request.method === 'PATCH') {
            patchCount += 1;
            return { ok: patchCount > 1, json: async () => ({ success: patchCount > 1, error: 'Retry contact save' }) };
        }
        return response(record);
    });
    await h.app.save();
    assert.equal(h.field('leadPipelineStage').value, 'contacted');
    assert.equal(h.field('leadName').value, 'Contact draft after collaboration');
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadWorkspaceEditorHost');
    await h.app.save();
    assert.equal(promptCount, 1);
    assert.equal(h.mutations().filter(request => request.url.endsWith('/collaboration-task')).length, 1);
    const patches = h.mutations().filter(request => request.method === 'PATCH');
    assert.equal(patches.length, 2);
    for (const request of patches) {
        const payload = JSON.parse(request.body);
        assert.equal(payload.client_name, 'Contact draft after collaboration');
        assert.equal(Object.hasOwn(payload, 'lead_type'), false);
        assert.equal(Object.hasOwn(payload, 'pipeline_stage'), false);
    }
});

test('late editor load is discarded after a newer lead enters editing', async t => {
    const records = new Map([[930, editableWorkspace(930)], [931, editableWorkspace(931)]]);
    const h = editorHarness(t, records);
    await h.app.openLeadWorkspace(930);
    const pending = deferred();
    h.setRequestHandler(request => request.url.includes('/930/') ? pending.promise : response(records.get(931)));
    const older = h.app.edit(930);
    await h.flush();
    await h.app.edit(931);
    h.change('leadName', 'Newer editor draft');
    pending.resolve(response(records.get(930)));
    await older;
    assert.equal(h.app.state().leadId, 931);
    assert.equal(h.field('leadEditId').value, '931');
    assert.equal(h.field('leadName').value, 'Newer editor draft');
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadWorkspaceEditorHost');
    assert.deepEqual(h.mutations(), []);
});

test('late save cannot close or overwrite a newer editor after forced context teardown', async t => {
    const records = new Map([[932, editableWorkspace(932)], [933, editableWorkspace(933)]]);
    const h = editorHarness(t, records);
    await h.app.edit(932);
    h.change('leadName', 'Older pending save');
    const pending = deferred();
    h.setRequestHandler(request => request.method === 'PATCH' ? pending.promise
        : response(records.get(Number(request.url.match(/\/leads\/(\d+)/)?.[1]))));
    const saving = h.app.save();
    await h.flush();
    await h.app.openLeadWorkspace(933);
    assert.equal(h.app.state().leadId, 932, 'ordinary navigation is blocked during saving');
    await h.app.closeLeadWorkspace({ force: true, guard: false });
    await h.app.edit(933);
    h.change('leadName', 'Newer untouched draft');
    pending.resolve({ ok: true, json: async () => ({ success: true }) });
    await saving;
    assert.equal(h.app.state().leadId, 933);
    assert.equal(h.field('leadName').value, 'Newer untouched draft');
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadWorkspaceEditorHost');
    assert.equal(h.mutations().length, 1);
});

test('finishing an earlier save refresh unlocks a new create draft without replacing it', async t => {
    const record = editableWorkspace(935);
    const h = editorHarness(t, new Map([[935, record]]));
    await h.app.edit(935);
    h.app.restoreListReload();
    const refresh = deferred();
    let holdRefresh = true;
    const listResponse = () => ({ ok: true, json: async () => ({
        leads: [{ id: 935, client_name: 'Saved fixture', pipeline_stage: 'new', lead_type: 'quality' }],
        pagination: { total: 1, hasMore: false }
    }) });
    h.setRequestHandler(request => {
        if (request.method === 'PATCH') return { ok: true, json: async () => ({ success: true }) };
        if (request.method === 'POST') return { ok: true, json: async () => ({ success: true, lead: { id: 936 } }) };
        if (request.url.includes('/workspace')) return response(record);
        if (request.url.includes('/stats')) return { ok: true, json: async () => ({}) };
        return holdRefresh ? refresh.promise : listResponse();
    });
    h.change('leadNotes', 'Persisted before the list responds');
    const saving = h.app.save();
    await h.flush();
    assert.equal(h.field('leadEditorForm').parentElement.id, 'leadCreateEditorHost');
    await h.app.openAdd();
    h.change('leadName', 'New draft during list refresh');
    h.change('leadNotes', 'Keep this unsaved note');
    assert.equal(h.field('leadModalSave').disabled, true, 'a previous active save still owns the submit lock');
    holdRefresh = false;
    refresh.resolve(listResponse());
    await saving;
    assert.equal(h.field('leadModal').classList.contains('active'), true);
    assert.equal(h.field('leadName').value, 'New draft during list refresh');
    assert.equal(h.field('leadNotes').value, 'Keep this unsaved note');
    assert.equal(h.field('leadModalSave').disabled, false, 'the previous refresh cannot leave a new editor locked');
    await h.app.save();
    const creates = h.mutations().filter(request => request.method === 'POST');
    assert.equal(creates.length, 1);
    assert.equal(JSON.parse(creates[0].body).client_name, 'New draft during list refresh');
});

test('saving preserves the loaded table pages, search and list scroll position', async t => {
    const h = editorHarness(t, new Map([[934, editableWorkspace(934)]]));
    await h.app.edit(934);
    const rows = Array.from({ length: 175 }, (_, index) => ({ id: 1000 + index, client_name: `Row ${index}`, status: 'new', pipeline_stage: 'new', lead_type: 'quality' }));
    h.app.setRows(rows);
    h.app.restoreListReload();
    h.field('leadsSearch').value = 'Keep this filter';
    const scroll = h.document.querySelector('.leads-table-wrap');
    scroll.scrollTop = 320;
    const listPages = [];
    h.setRequestHandler(request => {
        if (request.method === 'PATCH') return { ok: true, json: async () => ({ success: true }) };
        if (request.url.includes('/934/workspace')) return response(editableWorkspace(934));
        if (request.url.includes('/api/leads/stats')) return { ok: true, json: async () => ({}) };
        const query = new URL(request.url, 'https://crm.example').searchParams;
        const offset = Number(query.get('offset'));
        listPages.push({ offset, search: query.get('search') });
        const leads = rows.slice(offset, offset + 100);
        return { ok: true, json: async () => ({ leads, pagination: { total: 175, offset, limit: 100, hasMore: offset + leads.length < 175, nextOffset: offset + leads.length } }) };
    });
    h.change('leadNotes', 'Save while the second page is loaded');
    await h.app.save();
    assert.deepEqual(listPages, [{ offset: 0, search: 'Keep this filter' }, { offset: 100, search: 'Keep this filter' }]);
    assert.equal(h.app.rows().length, 175);
    assert.equal(scroll.scrollTop, 320);
    assert.equal(h.field('leadsSearch').value, 'Keep this filter');
});
