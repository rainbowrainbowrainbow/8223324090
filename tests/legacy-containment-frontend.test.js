'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
function fragment(file, start, end) {
    const code = read(file);
    const begin = code.indexOf(start);
    const finish = end ? code.indexOf(end, begin) : code.length;
    assert.ok(begin >= 0 && finish > begin, `${file}: source boundary exists`);
    return code.slice(begin, finish);
}
const helperCode = fragment('js/api.js', 'const legacyBusinessSurfaceDenials', 'function getCrmBusinessProfileForContext');
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const settle = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };

async function setup(html = '') {
    const dom = new JSDOM(html, { url: 'http://localhost/designs', runScripts: 'outside-only' });
    const w = dom.window;
    await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    w.console = { warn() {}, error() {}, log() {} };
    w.AppState = { currentUser: { id: 3, username: 'synthetic.operator', role: 'director', accessContext: { status: 'ready' } } };
    w.fixtureProfile = { membershipMode: 'compatibility', accessContext: { status: 'ready' }, activeBusinessId: 'event_genix' };
    w.fixtureScope = { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] };
    w.getCrmBusinessOperatingProfile = () => w.fixtureProfile;
    w.getCrmBusinessScope = () => w.fixtureScope;
    w.apiAuthAuthorizationFingerprint = user => JSON.stringify(user);
    w.CRM_BUSINESS_SCOPE_SINGLE = 'single';
    w.CRM_BUSINESS_DEFAULT_CONTEXT = 'event_genix';
    w.getAuthHeaders = () => ({ 'X-Business-Context': w.fixtureScope.activeContext });
    w.showNotification = () => {};
    w.eval(helperCode);
    return {
        w,
        close: () => w.close(),
        switch(context = 'dar', mode = 'membership') {
            w.fixtureProfile = { ...w.fixtureProfile, activeBusinessId: context, membershipMode: mode };
            w.fixtureScope = { ...w.fixtureScope, activeContext: context, selectedContexts: [context] };
            w.dispatchEvent(new w.CustomEvent('crmBusinessContextChanged'));
        }
    };
}

test('legacy availability requires a fresh ready compatibility Park profile and a single scope', async () => {
    const h = await setup();
    try {
        for (const surface of ['catalogs', 'booking_templates', 'recurring', 'finance_salary']) {
            assert.equal(h.w.getLegacyBusinessSurfaceAvailability(surface).available, true);
        }
        for (const profile of [null, {}, { membershipMode: 'compatibility', activeBusinessId: 'event_genix' },
            { ...h.w.fixtureProfile, membershipMode: 'membership' }, { ...h.w.fixtureProfile, activeBusinessId: 'dar' }]) {
            h.w.fixtureProfile = profile;
            assert.equal(h.w.getLegacyBusinessSurfaceAvailability('catalogs').available, false);
        }
        h.switch('event_genix', 'compatibility');
        h.w.fixtureProfile.accessContext = { status: 'ready' };
        for (const mode of ['all', 'multi']) {
            h.w.fixtureScope.mode = mode;
            assert.equal(h.w.getLegacyBusinessSurfaceAvailability('catalogs').available, false);
        }
        h.w.fixtureScope.mode = 'single';
        h.w.AppState.currentUser.accessContext.status = 'selection_required';
        assert.equal(h.w.getLegacyBusinessSurfaceAvailability('catalogs').available, false);
    } finally { h.close(); }
});

test('server denial is remembered for its exact identity/scope and stale denial cannot contaminate another business', async () => {
    const h = await setup();
    try {
        const w = h.w;
        const old = w.getLegacyBusinessSurfaceContextKey('catalogs');
        let events = 0;
        w.addEventListener('legacyBusinessSurfaceUnavailable', () => events++);
        w.noteLegacyBusinessSurfaceUnavailable('catalogs', { code: 'catalogs_not_migrated', message: 'Synthetic unavailable' }, old);
        assert.equal(w.getLegacyBusinessSurfaceAvailability('catalogs').available, false);
        assert.equal(events, 1);
        w.AppState.currentUser.id = 4;
        assert.equal(w.getLegacyBusinessSurfaceAvailability('catalogs').available, true);
        w.noteLegacyBusinessSurfaceUnavailable('catalogs', { code: 'catalogs_not_migrated' }, old);
        assert.equal(events, 1);
        assert.equal(w.getLegacyBusinessSurfaceAvailability('catalogs').available, true);
    } finally { h.close(); }
});

const templateHtml = '<section id="bookingPanel" class="hidden"><select id="templateSelect"></select><button id="saveTemplateBtn">Save</button><textarea id="bookingNotes">Untouched</textarea><select id="roomSelect"><option value="room">Room</option></select><select id="selectedProgram"></select><input id="kidsCountInput"></section>';
async function templateSetup() {
    const h = await setup(templateHtml);
    h.w.BookingForm = { getFormData: () => ({}) };
    h.w.promptModal = async () => 'Synthetic template';
    h.w.eval(fragment('js/booking-form.js', '// v30.3: BOOKING TEMPLATES'));
    h.w.document.dispatchEvent(new h.w.Event('DOMContentLoaded'));
    return h;
}
const templates = [{ id: 1, name: 'Synthetic template', notes: 'Private legacy note', room: 'room' }];

test('templates clear immediately on context change and an old response cannot repopulate the select', async () => {
    const h = await templateSetup();
    try {
        h.w.fetch = async () => response(200, templates);
        await h.w.BookingTemplates.load();
        assert.equal(h.w.document.getElementById('templateSelect').options.length, 2);
        const wait = deferred();
        h.w.fetch = () => wait.promise;
        const old = h.w.BookingTemplates.load();
        h.switch();
        const select = h.w.document.getElementById('templateSelect');
        assert.equal(select.disabled, true);
        assert.equal(select.options.length, 1);
        assert.equal(h.w.document.getElementById('saveTemplateBtn').disabled, true);
        wait.resolve(response(200, templates));
        await old;
        assert.equal(select.options.length, 1);
        assert.equal(h.w.document.getElementById('bookingNotes').value, 'Untouched');
        assert.match(h.w.document.getElementById('bookingTemplateAvailability').textContent, /недоступний/);
    } finally { h.close(); }
});

test('template application revalidates before any field change; same-session denial never applies cached data or use writes', async () => {
    const h = await templateSetup();
    try {
        const w = h.w;
        let calls = [];
        w.fetch = async (url, options) => { calls.push([url, options?.method || 'GET']); return response(200, templates); };
        await w.BookingTemplates.load();
        const wait = deferred();
        w.fetch = (url, options) => { calls.push([url, options?.method || 'GET']); return wait.promise; };
        const select = w.document.getElementById('templateSelect');
        select.value = '1';
        select.dispatchEvent(new w.Event('change'));
        assert.equal(w.document.getElementById('bookingNotes').value, 'Untouched');
        wait.resolve(response(403, { code: 'booking_templates_not_migrated', message: 'Synthetic access revoked' }));
        await settle();
        assert.equal(w.document.getElementById('bookingNotes').value, 'Untouched');
        assert.equal(calls.filter(call => call[1] === 'POST').length, 0);
        assert.equal(select.disabled, true);
        assert.match(w.document.getElementById('bookingTemplateAvailability').textContent, /Synthetic access revoked/);
    } finally { h.close(); }
});

test('fresh compatibility templates still apply and suspended save cannot write after switching business', async () => {
    const h = await templateSetup();
    try {
        const calls = [];
        h.w.fetch = async (url, options) => { calls.push([url, options]); return response(200, templates); };
        await h.w.BookingTemplates.load();
        const select = h.w.document.getElementById('templateSelect');
        select.value = '1'; select.dispatchEvent(new h.w.Event('change'));
        await settle();
        assert.equal(h.w.document.getElementById('bookingNotes').value, 'Private legacy note');
        assert.equal(calls.at(-1)[0], '/api/booking-templates/1/use');
        assert.equal(calls.at(-1)[1].headers['X-Business-Context'], 'event_genix');
        const prompt = deferred();
        h.w.promptModal = () => prompt.promise;
        const saving = h.w.BookingTemplates.save();
        h.switch(); prompt.resolve('Late synthetic template'); await saving;
        assert.equal(calls.filter(([url, options]) => url === '/api/booking-templates' && options?.method === 'POST').length, 0);
    } finally { h.close(); }
});

test('a successful template GET followed by denied use leaves every form field and success notice untouched', async () => {
    const h = await templateSetup();
    try {
        const notices = [];
        h.w.showNotification = (...args) => notices.push(args);
        const calls = [];
        h.w.fetch = async (url, options) => {
            calls.push(url);
            return options?.method === 'POST'
                ? response(403, { code: 'booking_templates_not_migrated', message: 'Use denied' })
                : response(200, templates);
        };
        await h.w.BookingTemplates.load();
        const select = h.w.document.getElementById('templateSelect');
        select.value = '1'; select.dispatchEvent(new h.w.Event('change')); await settle();
        assert.equal(calls.at(-1), '/api/booking-templates/1/use');
        assert.equal(h.w.document.getElementById('bookingNotes').value, 'Untouched');
        assert.equal(notices.length, 0);
        assert.equal(select.disabled, true);
        assert.match(h.w.document.getElementById('bookingTemplateAvailability').textContent, /Use denied/);
    } finally { h.close(); }
});

test('designs legacy 403 presents unavailable without erasing the session or redirecting', async () => {
    const h = await setup();
    try {
        const w = h.w;
        w.localStorage.setItem('pzp_token', 'synthetic-session');
        let calls = 0;
        w.fetch = async () => { calls++; return response(403, { code: 'catalogs_not_migrated', message: 'Catalog isolation pending' }); };
        w.eval(fragment('js/designs-page.js', 'function authHeaders(', 'async function loadDesigns('));
        await assert.rejects(w.apiFetch('/api/catalogs/definitions'), error => error.code === 'catalogs_not_migrated');
        assert.equal(w.localStorage.getItem('pzp_token'), 'synthetic-session');
        assert.equal(w.location.pathname, '/designs');
        await assert.rejects(w.apiFetch('/api/catalogs/definitions'));
        assert.equal(calls, 1);
    } finally { h.close(); }
});

test('designs rejects JSON delivered after a business switch, even when headers arrived earlier', async () => {
    const h = await setup();
    try {
        const delayedBody = deferred();
        h.w.fetch = async () => ({ status: 200, ok: true, json: () => delayedBody.promise });
        h.w.eval(fragment('js/designs-page.js', 'function authHeaders(', 'async function loadDesigns('));
        const res = await h.w.apiFetch('/api/catalogs/definitions');
        const body = res.json();
        h.switch(); delayedBody.resolve({ catalogs: [{ name: 'Must not appear' }] });
        await assert.rejects(body, /Бізнес змінився/);
    } finally { h.close(); }
});

test('catalog widget drops late definitions and closes controls on business change', async () => {
    const h = await setup('<select id="catCatalogId"></select><div id="recentCatalogItems"></div><button id="publishBtn"></button>');
    try {
        h.w.eval(read('js/catalogs.js'));
        const old = deferred(); let calls = 0;
        h.w.apiCall = () => { calls++; return old.promise; };
        const load = h.w.loadCatalogDefinitions();
        h.switch();
        old.resolve({ catalogs: [{ id: 1, name: 'Private catalog', emoji: '' }] }); await load;
        assert.equal(h.w.document.getElementById('catCatalogId').disabled, true);
        assert.doesNotMatch(h.w.document.body.textContent, /Private catalog/);
        assert.equal(h.w.document.getElementById('publishBtn').disabled, true);
        h.w.openAddCatalogItem();
        assert.equal(calls, 1);
    } finally { h.close(); }
});

test('catalog widget reloads when a delayed compatibility profile becomes ready and refuses in-flight same-scope denial', async () => {
    const h = await setup('<select id="catCatalogId"></select><div id="recentCatalogItems"></div><button id="publishBtn"></button>');
    try {
        h.w.fixtureProfile.accessContext.status = 'unavailable';
        h.w.eval(read('js/catalogs.js'));
        let calls = 0;
        h.w.apiCall = async () => { calls++; return { catalogs: [{ id: 'fixture', name: 'Allowed catalog', emoji: '' }] }; };
        await h.w.loadCatalogDefinitions();
        assert.equal(calls, 0);
        h.w.fixtureProfile.accessContext.status = 'ready';
        h.w.dispatchEvent(new h.w.CustomEvent('crmBusinessProfileChanged')); await settle();
        assert.equal(h.w.document.getElementById('catCatalogId').disabled, false);
        assert.match(h.w.document.body.textContent, /Allowed catalog/);
        const late = deferred(); h.w.apiCall = () => late.promise;
        const pending = h.w.catalogSurfaceCall('GET', '/catalogs/image-job/fixture');
        h.w.noteLegacyBusinessSurfaceUnavailable('catalogs', { code: 'catalogs_not_migrated', message: 'Denied elsewhere' });
        late.resolve({ status: 'done', imageUrl: 'private.png' });
        await assert.rejects(pending, error => error.code === 'catalogs_not_migrated');
        assert.equal(h.w.document.getElementById('catCatalogId').disabled, true);
        assert.equal(h.w.document.getElementById('publishBtn').disabled, true);
        assert.doesNotMatch(h.w.document.body.textContent, /Allowed catalog/);
    } finally { h.close(); }
});

test('mixed product catalog response keeps scoped graduation count and constructor while hiding legacy entries', async () => {
    const h = await setup('<div id="catalogsGrid"></div>');
    try {
        const w = h.w;
        h.switch('event_genix', 'membership');
        w.escapeHtml = value => String(value || '');
        w.isParkProductsContext = () => true;
        w.productBusinessScope = () => w.fixtureScope;
        w.getPermissionLifecycle = () => ({ status: 'ready' });
        w.canAccessPage = () => true;
        w.getCatalogStatusLabel = () => 'Ready';
        w.apiCall = async () => [{ id: 1 }, { id: 2 }];
        w.apiGetProductCatalogs = async () => ({ catalogs: [{ id: 'graduation', title: 'Scoped graduation', href: '/designs#catalog-graduation' },
            { id: 'global', title: 'Private global catalog' }], legacyCatalogs: { available: false, code: 'catalogs_not_migrated', message: 'Shared catalogs unavailable' } });
        w.eval('var productCatalogRequest=0, productCatalogs=[], graduationCatalogPackageCount=null, catalogEntriesLoaded=false, productLegacyCatalogAvailability=null, productCatalogContext=null;');
        w.eval(fragment('js/programs-page.js', 'async function loadCatalogEntries()', '// PRODUCT FORM'));
        await w.loadCatalogEntries();
        assert.match(w.document.body.textContent, /недоступний/);
        assert.match(w.document.body.textContent, /Scoped graduation/);
        assert.match(w.document.body.textContent, /Пакетів: 2/);
        assert.doesNotMatch(w.document.body.textContent, /Private global catalog/);
        assert.ok(w.document.querySelector('a[href="/graduation"]'));
    } finally { h.close(); }
});

test('graduation viewer remains usable while legacy catalogs are unavailable; switching clears the viewer', async () => {
    const h = await setup(read('designs.html'));
    try {
        h.switch('event_genix', 'membership');
        const w = h.w;
        const calls = [];
        w.apiFetch = async url => { calls.push(url); return response(200, [{ name: 'Scoped package A', services: [] }, { name: 'Scoped package B', services: [] }]); };
        w.buildCatalogPageHtml = row => `<p>${row.name}</p>`;
        w.buildAutoPageHtml = () => { throw Error('Legacy renderer must not execute'); };
        w.eval(fragment('js/designs-page.js', 'let catalogPackages =', 'function buildCatalogPageHtml('));
        await w.openCatalog('global');
        assert.equal(calls.length, 0);
        assert.match(w.document.getElementById('catalogPages').textContent, /недоступний/);
        await w.openCatalog('graduation');
        assert.match(w.document.getElementById('catalogPages').textContent, /Scoped package A/);
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        assert.match(w.document.getElementById('catalogPages').textContent, /Scoped package B/);
        h.switch();
        assert.doesNotMatch(w.document.getElementById('catalogPages').textContent, /Scoped package/);
    } finally { h.close(); }
});

test('recurring controls cannot open or submit without availability and dynamic detail buttons become disabled', async () => {
    const h = await setup('<div id="bookingDetails"></div><div id="recurringModal" class="hidden"><form id="recurringForm"><input id="recurringBookingId"><input id="recurringEndDate"><select id="recurringPattern"><option value="weekly">Weekly</option></select><div id="recurringDaysSection"></div><button type="submit">Create</button></form></div>');
    try {
        const w = h.w;
        let reads = 0;
        w.getBookingsForDate = async () => { reads++; return [{ id: 'fixture', date: '2026-09-12' }]; };
        w.getBookingPackageFromBooking = () => null;
        w.formatDate = () => '2026-12-12';
        w.closeAllModals = () => {};
        w.eval(fragment('js/booking.js', 'let recurringSourceContext', '// v30.3: BULK OPERATIONS'));
        w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
        await w.showRecurringModal('fixture');
        assert.equal(w.document.getElementById('recurringModal').classList.contains('hidden'), false);
        h.switch();
        assert.equal(w.document.getElementById('recurringModal').classList.contains('hidden'), true);
        assert.equal(w.document.getElementById('recurringBookingId').value, '');
        await w.showRecurringModal('fixture');
        w.document.getElementById('recurringForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await settle();
        assert.equal(reads, 1);
        w.document.getElementById('bookingDetails').innerHTML = '<button onclick="showRecurringModal(\'fixture\')">Recurring</button>';
        await settle();
        assert.equal(w.document.querySelector('#bookingDetails button').disabled, true);
        assert.equal(w.document.querySelector('#bookingDetails button').getAttribute('aria-disabled'), 'true');
    } finally { h.close(); }
});

test('legacy inline catalog cleanup cancels owned polling, drops generated URLs, and preserves the graduation card', async () => {
    const h = await setup('<div id="catalogList"><div class="catalog-card" data-catalog="graduation">Graduation</div><div class="catalog-card" data-catalog="private">Private</div></div><div id="dynamicCatalogCards"></div><div id="inlineCatalogView">Private pages</div>');
    try {
        const w = h.w;
        const stopped = [];
        w.clearInterval = id => stopped.push(id);
        w.eval(fragment('designs.html', 'var legacyCatalogUiGeneration', 'async function loadDynamicCatalogCards()'));
        w.legacyCatalogPollTimers.add(123);
        w._refGenUrl = 'private-reference.png'; w._imgGenUrl = 'private-generated.png';
        h.switch();
        assert.deepEqual(stopped, [123]);
        assert.equal(w._refGenUrl, null); assert.equal(w._imgGenUrl, null);
        assert.ok(w.document.querySelector('[data-catalog="graduation"]'));
        assert.equal(w.document.querySelector('[data-catalog="private"]'), null);
        assert.equal(w.document.getElementById('inlineCatalogView').textContent, '');
    } finally { h.close(); }
});
