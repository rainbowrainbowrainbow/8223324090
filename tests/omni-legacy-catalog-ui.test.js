'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'omni.html'), 'utf8');
const unavailable = { available: false, code: 'catalogs_not_migrated', message: 'Спільні каталоги недоступні в цьому кабінеті.' };
const available = { available: true, code: null, message: null };

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function harness(t) {
    const dom = new JSDOM(html, { url: 'https://crm.example/omni', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const { window } = dom;
    let context = 'event_genix';
    let profileKey = 'park-compatibility';
    let access = available;
    let permissionStatus = 'ready';
    window.CrmBusinessContext = { current: () => context };
    window.getLegacyBusinessSurfaceAvailability = () => access;
    window.getLegacyBusinessSurfaceContextKey = () => profileKey;
    window.getPermissionLifecycle = () => ({ status: permissionStatus });
    window.apiVerifyToken = () => new Promise(() => {});
    const script = Array.from(window.document.scripts).find(node => node.textContent.includes('OmniClaw Page —')).textContent;
    const exposed = `window.__catalogUi = {
        initOmniBusinessContext, refreshLeadAssistantAccess, reloadOmniForBusinessContext,
        renderLeadAssistantMaterials, renderLeadAssistantSettings, renderLeadAssistantContent,
        renderLeadAssistantTestResult, renderLeadAssistantCatalogNotice, materialTextByIndex,
        testLeadAssistantScript, loadLeadAssistantSettings, analyzeLeadAssistant,
        state() { return leadAssistantState; },
        selected() { return { currentConvId, conversations }; },
        setState(value) { Object.assign(leadAssistantState, value); },
        setApi(value) { api = value; },
        selectFixture() { currentConvId = 77; conversations = [{id:77, customerName:'Synthetic conversation', channel:'telegram'}]; }
    };`;
    const end = script.lastIndexOf('})();');
    vm.runInContext(script.slice(0, end) + exposed + script.slice(end), dom.getInternalVMContext());
    const app = window.__catalogUi;
    app.initOmniBusinessContext();
    app.setState({ mode: 'ai', settings: {}, open: true });
    const defaultApi = async url => {
        if (url === '/accounts') return { success: true, accounts: [] };
        if (url.startsWith('/conversations?')) return { success: true, data: { conversations: [], total: 0 } };
        return { success: true, data: {} };
    };
    app.setApi(defaultApi);
    return { app, window, document: window.document, defaultApi,
        setAccess(value, key = profileKey) { access = value; profileKey = key; },
        setContext(value) { context = value; profileKey = value; },
        emitProfile() { window.dispatchEvent(new window.CustomEvent('crmBusinessProfileChanged')); },
        emitUnavailable(surface = 'catalogs', eventContext = profileKey) {
            window.dispatchEvent(new window.CustomEvent('legacyBusinessSurfaceUnavailable', {
                detail: { surface, context: eventContext, code: surface + '_not_migrated', message: unavailable.message }
            }));
        },
        emitPermissions(status) { permissionStatus = status; window.dispatchEvent(new window.CustomEvent('permissions:lifecycle', { detail: { status } })); },
        async flush() { await new Promise(resolve => setImmediate(resolve)); },
        transcript() { app.renderLeadAssistantSettings(); window.document.getElementById('omniLeadAssistantTestTranscript').value = 'Client: Synthetic birthday'; }
    };
}

const materials = [
    { source: 'catalog_item', title: 'GLOBAL_CATALOG_SENTINEL', attachText: 'GLOBAL_CATALOG_ATTACHMENT' },
    { source: 'product', title: 'Scoped fixture product', attachText: 'SCOPED_PRODUCT_ATTACHMENT' }
];

test('unavailable Omni catalog entries cannot render or insert; scoped material keeps its original index', t => {
    const h = harness(t);
    h.setAccess(unavailable, 'park-membership');
    h.app.setState({ analysis: { recommendedMaterials: materials, salesContext: { legacyCatalogs: unavailable } },
        salesContext: { legacyCatalogs: unavailable, materials: [materials[1]] } });
    const rendered = h.app.renderLeadAssistantMaterials(materials);
    assert.equal(rendered.includes('GLOBAL_CATALOG'), false);
    assert.match(rendered, /data-ai-material-index="1"/);
    assert.equal(h.app.materialTextByIndex(0), '');
    assert.equal(h.app.materialTextByIndex(1), 'SCOPED_PRODUCT_ATTACHMENT');
    h.app.renderLeadAssistantContent();
    h.app.renderLeadAssistantSettings();
    assert.match(h.document.getElementById('omniLeadAssistantContent').textContent, /Спільні каталоги недоступні/);
    const settingsText = h.document.getElementById('omniLeadAssistantSettings').textContent;
    assert.match(settingsText, /Зараз доступно: 1 матеріалів/);
    assert.match(settingsText, /Спільні каталоги недоступні/);
    assert.equal(settingsText.includes('та catalog_items'), false);
});

test('test summary respects server unavailability even while the local compatibility profile is available', t => {
    const h = harness(t);
    h.app.setState({ testAnalysis: { recommendedMaterials: materials, salesContext: { legacyCatalogs: unavailable } } });
    const rendered = h.app.renderLeadAssistantTestResult();
    assert.equal(rendered.includes('GLOBAL_CATALOG'), false);
    assert.match(rendered, /Scoped fixture product/);
    assert.match(rendered, /Спільні каталоги недоступні/);
    h.app.setState({ testAnalysis: { recommendedMaterials: materials, salesContext: { legacyCatalogs: available } } });
    assert.match(h.app.renderLeadAssistantTestResult(), /GLOBAL_CATALOG_SENTINEL/);
    h.setAccess(unavailable);
    assert.equal(h.app.renderLeadAssistantTestResult().includes('GLOBAL_CATALOG'), false);
});

test('same-context access change clears assistant sources and DOM but identical hydration preserves the conversation', t => {
    const h = harness(t);
    h.app.selectFixture();
    h.app.setState({ analysis: { recommendedMaterials: materials }, testAnalysis: { marker: 'old' },
        settings: { marker: 'old' }, salesContext: { materials }, analytics: { marker: 'old' } });
    h.emitProfile();
    assert.equal(h.app.state().settings.marker, 'old');
    assert.equal(h.app.state().open, true);
    h.document.getElementById('omniLeadAssistantContent').textContent = 'GLOBAL_CATALOG_SENTINEL';
    h.setAccess(unavailable, 'park-membership');
    h.emitProfile();
    for (const key of ['analysis', 'testAnalysis', 'settings', 'salesContext', 'analytics']) assert.equal(h.app.state()[key], null);
    assert.equal(h.app.state().open, false);
    assert.equal(h.document.getElementById('omniLeadAssistantContent').textContent, '');
    assert.equal(h.app.selected().currentConvId, 77);
    assert.equal(h.app.selected().conversations.length, 1);
});

test('late script result after a same-business role change cannot replace a fresh result', async t => {
    const h = harness(t);
    const old = deferred();
    h.transcript();
    h.app.setApi(async () => old.promise);
    const pending = h.app.testLeadAssistantScript();
    h.setAccess(unavailable, 'park-new-role');
    h.emitProfile();
    assert.equal(h.app.state().testingScript, false);
    h.transcript();
    h.app.setApi(async () => ({ success: true, analysis: { marker: 'fresh', salesContext: { legacyCatalogs: unavailable } } }));
    await h.app.testLeadAssistantScript();
    old.resolve({ success: true, analysis: { marker: 'stale', recommendedMaterials: materials } });
    await pending;
    assert.equal(h.app.state().testAnalysis.marker, 'fresh');
    assert.equal(h.app.state().testingScript, false);
});

test('business reload clears test state and rejects a late script response', async t => {
    const h = harness(t);
    const old = deferred();
    h.transcript();
    h.app.setApi(async url => url === '/lead-assistant/test' ? old.promise : h.defaultApi(url));
    const pending = h.app.testLeadAssistantScript();
    h.setContext('dar');
    h.setAccess(unavailable);
    await h.app.reloadOmniForBusinessContext();
    old.resolve({ success: true, analysis: { marker: 'old-park' } });
    await pending;
    assert.equal(h.app.state().testAnalysis, null);
    assert.equal(h.app.state().testTranscript, '');
    assert.equal(h.app.state().testingScript, false);
});

test('permission loss invalidates the last analytics await in settings loading', async t => {
    const h = harness(t);
    const old = deferred();
    let analyticsStarted = false;
    h.app.setApi(async url => {
        if (url === '/lead-assistant/settings') return { success: true, settings: { marker: 'old' } };
        if (url === '/lead-assistant/sales-context') return { success: true, salesContext: { legacyCatalogs: available, materials } };
        analyticsStarted = true;
        return old.promise;
    });
    const pending = h.app.loadLeadAssistantSettings();
    await h.flush();
    assert.equal(analyticsStarted, true);
    h.emitPermissions('error');
    old.resolve({ success: true, analytics: { marker: 'stale' } });
    await pending;
    assert.equal(h.app.state().analytics, null);
    assert.equal(h.app.state().salesContext, null);
    assert.equal(h.app.state().settings, null);
});

test('same-context profile change discards an in-flight conversation analysis without clearing the conversation', async t => {
    const h = harness(t);
    const old = deferred();
    h.app.selectFixture();
    h.app.setApi(async () => old.promise);
    const pending = h.app.analyzeLeadAssistant();
    h.setAccess(unavailable, 'park-membership');
    h.emitProfile();
    old.resolve({ success: true, analysis: { recommendedMaterials: materials, marker: 'old' } });
    await pending;
    assert.equal(h.app.state().analysis, null);
    assert.equal(h.app.state().loading, false);
    assert.equal(h.app.selected().currentConvId, 77);
});

test('same-context sibling denial rejects a delayed success and a fresh retry retains scoped/manual materials', async t => {
    const h = harness(t);
    const old = deferred();
    h.transcript();
    h.app.setApi(async () => old.promise);
    const pending = h.app.testLeadAssistantScript();
    h.emitUnavailable('booking_templates');
    assert.equal(h.app.state().testingScript, true, 'another surface does not invalidate catalog materials');
    h.emitUnavailable('catalogs', 'foreign-context');
    assert.equal(h.app.state().testingScript, true, 'a stale sibling context cannot clear current work');
    h.setAccess(unavailable);
    h.emitUnavailable();
    assert.equal(h.app.state().testingScript, false);
    assert.equal(h.app.state().settings, null);
    old.resolve({ success: true, analysis: { marker: 'stale', recommendedMaterials: materials, salesContext: { legacyCatalogs: available } } });
    await pending;
    assert.equal(h.app.state().testAnalysis, null);

    h.transcript();
    h.app.setApi(async () => ({ success: true, analysis: { marker: 'fresh',
        recommendedMaterials: [...materials, { source: 'manual', title: 'Scoped fixture document' }],
        salesContext: { legacyCatalogs: available }
    } }));
    await h.app.testLeadAssistantScript();
    assert.equal(h.app.state().testAnalysis.marker, 'fresh');
    assert.deepEqual(Array.from(h.app.state().testAnalysis.recommendedMaterials, item => item.source), ['product', 'manual']);
    assert.equal(h.app.state().testAnalysis.salesContext.legacyCatalogs.available, false);
    h.emitUnavailable();
    assert.equal(h.app.state().testAnalysis.marker, 'fresh', 'the same denial does not create an invalidation loop');
});
