'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const settle = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function harness(route = '/certificates/new', options = {}) {
    const art = route.startsWith('/art-director');
    const dom = new JSDOM(read(art ? 'art-director.html' : 'certificates.html'), { url: `https://fixture.local${route}`, runScripts: 'outside-only' });
    const w = dom.window;
    await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    w.console = { error() {}, warn() {}, log() {} };
    const user = { id: 9701, username: 'synthetic.operator', role: 'senior_manager', accessContext: { status: 'ready' } };
    w.AppState = { currentUser: user };
    w.localStorage.setItem('pzp_token', 'synthetic-token');
    const ui = read('js/ui.js');
    w.eval(ui.slice(ui.indexOf('if (!window.CrmApiErrors)'), ui.indexOf('if (!window.CrmUiState)')));
    w.eval(read('js/api.js'));
    w.API_BASE = '/api';
    w.fixtureScope = { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] };
    w.fixtureProfile = { activeBusinessId: 'event_genix', accessContext: { status: 'ready' }, membershipMode: 'membership',
        activeProfile: { accessMode: 'membership', modules: { source: 'business_registry', enabled: { certificates: false, art: false } },
            legacySurfaces: { certificates: { available: options.available !== false }, art: { available: options.available !== false } } } };
    w.getCrmBusinessOperatingProfile = () => w.fixtureProfile;
    w.getCrmBusinessProfileForContext = () => w.fixtureProfile.activeProfile;
    w.getCrmBusinessScope = () => w.fixtureScope;
    w.apiVerifyToken = async () => user;
    w.hydrateBusinessOperatingProfile = async () => w.fixtureProfile;
    w.hydrateActionPermissions = async () => ({});
    w.enforceCurrentPageAccess = () => true;
    w.showAuthenticatedPageShell = () => {};
    const calls = [], notices = [];
    w.showNotification = (...args) => notices.push(args);
    w.apiFetchWithAuthRetry = async (url, request) => {
        calls.push({ url, ...request });
        return options.fetch ? options.fetch(url, request) : response(200, { items: [], total: 0, stats: {}, success: true, templates: [] });
    };
    w.eval(read(art ? 'js/art-director-page.js' : 'js/certificates-page.js'));
    await settle();
    return { w, calls, notices, close: () => w.close(),
        submit(id = 'certificatePageForm') { w.document.getElementById(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); },
        switch(context = 'dar') { w.fixtureScope = { mode: 'single', activeContext: context, selectedContexts: [context] }; w.dispatchEvent(new w.Event('crmBusinessContextChanged')); } };
}

test('membership visibility requires an explicit server recovery flag and ready matching Park scope', async () => {
    const h = await harness();
    try {
        const w = h.w;
        for (const surface of ['certificates', 'art']) {
            assert.equal(w.getLegacyBusinessSurfaceAvailability(surface).available, true);
            assert.equal(w.crmBusinessContextHasModule('event_genix', surface), true);
            delete w.fixtureProfile.activeProfile.legacySurfaces[surface];
            assert.equal(w.getLegacyBusinessSurfaceAvailability(surface).available, false);
            assert.equal(w.crmBusinessContextHasModule('event_genix', surface), false);
        }
        w.fixtureProfile.activeProfile.legacySurfaces.certificates = { available: true };
        for (const context of ['dar', 'park_restaurant']) {
            h.switch(context);
            assert.equal(w.getLegacyBusinessSurfaceAvailability('certificates').available, false);
        }
        h.switch('event_genix');
        w.fixtureScope.mode = 'all';
        assert.equal(w.getLegacyBusinessSurfaceAvailability('certificates').available, false);
        w.fixtureScope.mode = 'single';
        w.AppState.currentUser.accessContext.status = 'selection_required';
        assert.equal(w.getLegacyBusinessSurfaceAvailability('certificates').available, false);
    } finally { h.close(); }
});

for (const mode of ['new', 'batch']) {
    test(`${mode} form uses its hydrated availability without a preflight and sends one request while in flight`, async () => {
        const pending = deferred();
        const h = await harness(`/certificates/${mode}`, { fetch: () => pending.promise });
        try {
            assert.equal(h.calls.length, 0);
            h.w.document.getElementById('certPageDisplayValue').value = 'Synthetic Recipient';
            const form = mode === 'new' ? 'certificatePageForm' : 'certificateBatchPageForm';
            h.submit(form); h.submit(form);
            assert.equal(h.calls.length, 1);
            assert.equal(h.calls[0].headers['X-Business-Context'], 'event_genix');
            assert.equal(h.calls[0].method, 'POST');
            pending.resolve(response(200, mode === 'new'
                ? { id: 9701, certCode: 'CERT-SYNTHETIC', displayValue: 'Synthetic Recipient', status: 'active' }
                : { success: true, certificates: [{ id: 9701, certCode: 'CERT-SYNTHETIC' }] }));
            await settle();
            assert.equal(h.notices.filter(([, type]) => type === 'success').length, 1);
        } finally { h.close(); }
    });
}

test('a business denial preserves typed recipient, disables retries and displays one persistent error', async () => {
    const h = await harness('/certificates/new', { fetch: () => response(403, { code: 'certificates_not_migrated', error: 'Synthetic business unavailable' }) });
    try {
        h.w.document.getElementById('certPageDisplayValue').value = 'Synthetic Recipient';
        h.submit(); await settle(); h.submit(); await settle();
        assert.equal(h.calls.length, 1);
        assert.equal(h.w.document.getElementById('certPageSubmitBtn').disabled, true);
        assert.equal(h.w.document.getElementById('certPageDisplayValue').value, 'Synthetic Recipient');
        assert.match(h.w.document.getElementById('certificateBusinessAvailability').textContent, /Synthetic business unavailable/);
        assert.equal(h.notices.length, 0);
        assert.equal(h.w.localStorage.getItem('pzp_token'), 'synthetic-token');
    } finally { h.close(); }
});

test('unavailable profile blocks both forms before any certificate request', async () => {
    const h = await harness('/certificates/new', { available: false });
    try {
        h.w.document.getElementById('certPageDisplayValue').value = 'Synthetic Recipient';
        h.submit(); h.submit('certificateBatchPageForm'); await settle();
        assert.equal(h.calls.length, 0);
        assert.equal(h.w.document.getElementById('certPageSubmitBtn').disabled, true);
        assert.equal(h.w.document.getElementById('certBatchPageSubmitBtn').disabled, true);
    } finally { h.close(); }
});

test('registry HTTP failure is distinct from a successful empty registry and retains code and status', async () => {
    const h = await harness('/certificates', { fetch: () => response(503, { code: 'synthetic_unavailable', error: 'Synthetic unavailable' }) });
    try {
        const result = await h.w.apiGetCertificates();
        assert.equal(result.success, false);
        assert.equal(result.code, 'synthetic_unavailable');
        assert.equal(result.status, 503, JSON.stringify(result));
        assert.equal(result.items, undefined);
        assert.match(h.w.document.getElementById('certPageList').textContent, /Synthetic unavailable/);
        assert.doesNotMatch(h.w.document.getElementById('certPageList').textContent, /Сертифікатів не знайдено/);
        h.w.apiFetchWithAuthRetry = async () => response(200, { items: [], total: 0 });
        await h.w.CertificatePage.load();
        assert.match(h.w.document.getElementById('certPageList').textContent, /Сертифікатів не знайдено/);
    } finally { h.close(); }
});

test('an in-flight certificate response cannot expose its result after changing business', async () => {
    const pending = deferred();
    const h = await harness('/certificates/new', { fetch: () => pending.promise });
    try {
        h.w.document.getElementById('certPageDisplayValue').value = 'Synthetic Recipient';
        h.submit(); h.switch();
        pending.resolve(response(200, { id: 9701, certCode: 'PRIVATE-SYNTHETIC' })); await settle();
        assert.doesNotMatch(h.w.document.getElementById('certCreateResult').textContent, /PRIVATE-SYNTHETIC/);
        assert.equal(h.notices.length, 0);
        assert.equal(h.w.document.getElementById('certPageSubmitBtn').disabled, true);
    } finally { h.close(); }
});

test('Art uses the shared scoped auth wrapper and reports server errors instead of empty data', async () => {
    const h = await harness('/art-director', { fetch: () => response(503, { code: 'synthetic_unavailable', error: 'Synthetic Art unavailable' }) });
    try {
        const result = await h.w.apiGet('/overview');
        assert.equal(result.status, 503, JSON.stringify(result));
        assert.equal(result.code, 'synthetic_unavailable');
        assert.equal(h.calls[0].headers['X-Business-Context'], 'event_genix');
        await h.w.loadOverview();
        assert.match(h.w.document.getElementById('overviewStats').textContent, /Synthetic Art unavailable/);
    } finally { h.close(); }
});

test('Art business denial hides the workspace and prevents subsequent data requests', async () => {
    const h = await harness('/art-director', { fetch: () => response(403, { code: 'art_not_migrated', error: 'Synthetic Art denied' }) });
    try {
        const result = await h.w.apiGet('/overview');
        assert.equal(result.code, 'art_not_migrated');
        await h.w.apiPost('/content', { title: 'Synthetic' });
        assert.equal(h.calls.length, 1);
        assert.equal(h.w.document.querySelector('.artdir-page').classList.contains('hidden'), true);
        assert.match(h.w.document.getElementById('artBusinessAvailability').textContent, /Synthetic Art denied/);
    } finally { h.close(); }
});

test('Art bootstrap hydrates the server profile before its two existing initial data reads', async () => {
    const h = await harness('/art-director');
    try {
        const order = [];
        h.w.hydrateBusinessOperatingProfile = async () => { order.push('profile'); return h.w.fixtureProfile; };
        h.w.hydrateActionPermissions = async () => { order.push('permissions'); return {}; };
        await h.w.initArtDirectorPage();
        assert.deepEqual(order, ['profile', 'permissions']);
        assert.deepEqual(h.calls.map(call => call.url), ['/api/art-director/overview', '/api/art-director/templates']);
        assert.equal(h.w.document.querySelector('.artdir-page').classList.contains('hidden'), false);
    } finally { h.close(); }
});

test('the settings registry also renders failure without inventing an empty count', async () => {
    const h = await harness('/certificates/new', { fetch: () => response(503, { error: 'Synthetic settings failure' }) });
    try {
        h.w.document.body.insertAdjacentHTML('beforeend', '<div id="certificatesList"></div><div id="certPanelStats">Stale counts</div>');
        h.w._escS = value => String(value).replace(/</g, '&lt;');
        const code = read('js/settings.js');
        h.w.eval(code.slice(code.indexOf('async function loadCertificates()'), code.indexOf('function renderCertStats(')));
        await h.w.loadCertificates();
        assert.match(h.w.document.getElementById('certificatesList').textContent, /Synthetic settings failure/);
        assert.doesNotMatch(h.w.document.getElementById('certificatesList').textContent, /Сертифікатів не знайдено/);
        assert.equal(h.w.document.getElementById('certPanelStats').textContent, '');
    } finally { h.close(); }
});
