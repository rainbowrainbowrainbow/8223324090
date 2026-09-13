'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const API_CODE = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const BUSINESSES = [
    { key: 'event_genix', businessId: 1, organizationId: 1, label: 'Fixture Park' },
    { key: 'dar', businessId: 2, organizationId: 1, label: 'Fixture Dar' },
    { key: 'fixture_custom', businessId: 3, organizationId: 1, label: 'Fixture Custom' },
    { key: 'fixture_other', businessId: 4, organizationId: 2, label: 'Fixture Other' }
].map(item => ({ ...item, id: item.key, businessContext: item.key, modules: { enabled: { tasks: true, dashboard: true } } }));

function response(status, body = {}) {
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
        async json() { return body; }, clone() { return response(status, body); } };
}

function readyUser(context = 'event_genix', options = {}) {
    const allowed = options.allowed || ['event_genix', 'dar', 'fixture_custom'];
    const role = options.role || 'manager';
    const business = BUSINESSES.find(item => item.key === context);
    return {
        id: 7, username: 'business.profile.fixture', name: 'Business profile fixture',
        role, roles: [role], extraRoles: [], pageAllowlist: [], pageDenylist: [], actionAllowlist: [], actionDenylist: [],
        businessContexts: allowed, defaultBusinessContext: options.defaultContext || allowed[0] || null,
        activeBusinessContext: context, organizationId: business?.organizationId || null,
        activeBusinessMembership: context ? { businessContext: context, businessId: business.businessId, organizationId: business.organizationId, role } : null,
        businessContextPolicy: { allowed, defaultContext: options.defaultContext || allowed[0] || null,
            canSwitch: allowed.length > 1, forced: allowed.length === 1 ? allowed[0] : null },
        accessContext: { status: 'ready', code: null },
        ...options.overrides
    };
}

function profilePayload(user) {
    const allowed = user.businessContextPolicy.allowed;
    const active = user.accessContext.status === 'ready' ? user.activeBusinessContext : null;
    return {
        success: true, user,
        businessProfile: {
            source: 'server_business_profile', activeBusinessId: active, activeBusinessContext: active,
            activeMembership: active ? user.activeBusinessMembership : null,
            businesses: BUSINESSES.filter(item => allowed.includes(item.key)),
            scope: { mode: 'single', activeContext: active, selectedContexts: active ? [active] : [], allowedContexts: allowed,
                invalid: !active, readOnly: !active, canWrite: Boolean(active), reason: user.accessContext.code }
        }
    };
}

function loadApi(user, fetchImpl = async () => response(500), options = {}) {
    const store = new Map(Object.entries({
        pzp_token: 'fixture-access', pzp_access_token: 'fixture-access', pzp_refresh_token: 'fixture-refresh',
        pzp_current_user: JSON.stringify(user), ...options.store
    }));
    const location = new URL(options.url || 'http://localhost/tasks');
    const events = [];
    const requests = [];
    let timerId = 0;
    const timers = new Map();
    const setTimer = callback => { timers.set(++timerId, callback); return timerId; };
    const context = {
        console: { warn() {}, error() {}, log() {} }, URL, URLSearchParams,
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        AppState: { currentUser: plain(user), authPermissions: user.permissions || null },
        localStorage: { getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
        document: { body: { dataset: {} }, documentElement: { classList: { contains: () => false } },
            querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, addEventListener() {} },
        window: {
            location,
            history: { state: {}, replaceState(state, title, nextUrl) { location.href = String(nextUrl); } },
            addEventListener() {}, dispatchEvent(event) { events.push(event); },
            setTimeout: setTimer, clearTimeout: id => timers.delete(id)
        },
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        fetch: async (url, init) => { requests.push({ url: String(url), init }); return fetchImpl(url, init); },
        setTimeout: setTimer, clearTimeout: id => timers.delete(id)
    };
    context.window.self = context.window;
    context.window.top = context.window;
    vm.createContext(context);
    vm.runInContext(API_CODE, context, { filename: 'js/api.js' });
    return { context, store, events, requests, location };
}

async function flushMicrotasks() {
    for (let count = 0; count < 12; count += 1) await Promise.resolve();
}

test('membership module map never falls back to static defaults before or after profile hydration', () => {
    const user = readyUser('event_genix', { overrides: { membershipMode: 'membership' } });
    const { context } = loadApi(user);
    assert.equal(context.crmBusinessContextHasModule('event_genix', 'timeline'), false);
    const payload = profilePayload(user);
    payload.businessProfile.membershipMode = 'membership';
    payload.businessProfile.businesses = payload.businessProfile.businesses.map(business => ({
        ...business, accessMode: 'membership', modules: { source: 'business_registry', enabled: {} }
    }));
    context.applyCrmBusinessProfile(payload, { user, syncScope: false, emit: false });
    for (const key of ['timeline', 'dashboard', 'hr', 'graduation']) {
        assert.equal(context.crmBusinessContextHasModule('event_genix', key), false);
    }
    payload.businessProfile.businesses[0].modules.enabled.tasks = true;
    context.applyCrmBusinessProfile(payload, { user, syncScope: false, emit: false });
    assert.equal(context.crmBusinessContextHasModule('event_genix', 'tasks'), true);
});

test('owner recovery can send exact cabinet lifecycle actions while operational writes remain blocked', () => {
    const user = readyUser(null, { allowed: [], overrides: {
        membershipMode: 'membership', accessContext: { status: 'unavailable', code: 'business_context_unavailable' }
    } });
    const { context } = loadApi(user);
    assert.equal(context.getCrmBusinessScope().readOnly, true);
    assert.doesNotThrow(() => context.assertCrmBusinessWritableRequest('/api/organizations/businesses/7/configuration', 'PATCH'));
    assert.doesNotThrow(() => context.assertCrmBusinessWritableRequest('/api/organizations/businesses/7/initialize-resources', 'POST'));
    const denied = error => error.status === 403 && error.payload?.code === 'business_scope_read_only';
    assert.throws(() => context.assertCrmBusinessWritableRequest('/api/bookings', 'POST'), denied);
    assert.throws(() => context.assertCrmBusinessWritableRequest('/api/organizations/businesses/7/configuration', 'DELETE'), denied);
});

test('server membership policy permits lower-role Dar and custom businesses without a Park grant', () => {
    for (const business of ['dar', 'fixture_custom']) {
        const user = readyUser(business, { role: 'animator', allowed: [business] });
        const { context } = loadApi(user);
        const policy = context.resolveCrmBusinessPolicy(user);
        assert.deepEqual(plain(policy.allowed), [business]);
        assert.equal(policy.defaultContext, business);
        assert.equal(context.getCrmBusinessContext(user), business);
        assert.equal(context.userCanAccessCrmBusinessContext(user, 'event_genix'), false);
        context.applyCrmBusinessProfile(profilePayload(user), { user, syncScope: false, emit: false });
        assert.equal(context.getCrmBusinessContextOptions(user)[0].label,
            BUSINESSES.find(item => item.key === business).label);
    }
});

test('a custom membership business survives persistence and reload without a hardcoded catalog entry', () => {
    const user = readyUser('fixture_custom');
    const { context, store } = loadApi(user);
    context.applyCrmBusinessProfile(profilePayload(user), { user, syncScope: false, emit: false });
    context.setCrmBusinessContext('fixture_custom', { user, updateUrl: false, emit: false });
    assert.equal(context.resolveStoredCrmBusinessContext(user).key, 'fixture_custom');
    assert.equal(context.getCrmBusinessContext(user), 'fixture_custom');
    const reloaded = loadApi(user, undefined, { store: Object.fromEntries(store) });
    assert.equal(reloaded.context.resolveStoredCrmBusinessContext(user).key, 'fixture_custom');
    assert.equal(reloaded.context.getCrmBusinessContext(user), 'fixture_custom');
});

test('explicit empty server permissions never manufacture a Park business or writable scope', () => {
    const user = readyUser(null, { role: 'creator', allowed: [], overrides: {
        accessContext: { status: 'unavailable', code: 'business_context_unavailable' }
    } });
    const { context } = loadApi(user, undefined, { url: 'http://localhost/?businessContext=event_genix' });
    assert.deepEqual(plain(context.resolveCrmBusinessPolicy(user).allowed), []);
    assert.equal(context.getCrmBusinessContext(user), null);
    const scope = context.getCrmBusinessScope(user);
    assert.equal(scope.activeContext, null);
    assert.deepEqual(plain(scope.selectedContexts), []);
    assert.equal(scope.canWrite, false);
    assert.deepEqual(plain(context.getCrmBusinessContextOptions(user)), []);
});

test('selection-required identity keeps no active business despite a stale URL and discovery choices', () => {
    const user = readyUser(null, { allowed: ['event_genix', 'fixture_other'], overrides: {
        role: null, roles: [], accessContext: { status: 'selection_required', code: 'business_context_required' }
    } });
    const { context } = loadApi(user, undefined, { url: 'http://localhost/dashboard?businessContext=event_genix' });
    assert.equal(context.getCrmBusinessContext(user), null);
    assert.equal(context.getCrmBusinessScope(user).canWrite, false);
    const normalized = context.normalizeCrmBusinessProfilePayload(profilePayload(user));
    assert.equal(normalized.activeBusinessContext, null);
    assert.equal(normalized.activeProfile, null);
    assert.equal(normalized.businesses.length, 2);
});

test('canonical null profile selection does not fall back to the first business or stale active profile', () => {
    const user = readyUser('dar');
    const { context } = loadApi(user);
    context.applyCrmBusinessProfile(profilePayload(user), { user, syncScope: false, emit: false });
    assert.equal(context.getCrmBusinessOperatingProfile().activeBusinessContext, 'dar');
    const unavailable = readyUser(null, { allowed: [], overrides: {
        role: null, roles: [], accessContext: { status: 'unavailable', code: 'business_context_unavailable' }
    } });
    context.mergeApiCurrentUser(unavailable);
    context.applyCrmBusinessProfile(profilePayload(unavailable), { user: unavailable, emit: false, updateUrl: false });
    assert.equal(context.getCrmBusinessOperatingProfile().activeProfile, null);
    assert.equal(context.getCrmBusinessProfileForContext('dar'), null);
    assert.equal(context.getCrmBusinessContext(), null);
});

test('applying the canonical profile publishes organizations to runtime and stored account state', () => {
    const user = readyUser('event_genix');
    const { context, store } = loadApi(user);
    const payload = profilePayload(user);
    payload.businessProfile.organizations = [{ id: 1, name: 'Fixture Organization', slug: 'fixture-org', role: 'owner' }];
    context.applyCrmBusinessProfile(payload, { syncScope: false, emit: false });
    assert.deepEqual(plain(context.AppState.currentUser.businessProfile.organizations), payload.businessProfile.organizations);
    assert.deepEqual(JSON.parse(store.get('pzp_current_user')).businessProfile.organizations, payload.businessProfile.organizations);
    assert.equal(context.AppState.currentUser.id, user.id);
    assert.equal(context.AppState.currentUser.businessProfile.organizations[0].role, 'owner');
});

test('a same-role business change invalidates cached permissions before publishing the next principal', () => {
    const permissions = { capabilities: { 'action:view_revenue': { allowed: true } } };
    const user = readyUser('event_genix', { overrides: { permissions } });
    const { context, store } = loadApi(user);
    const next = readyUser('dar');
    const lifecycle = [];
    context.clearRuntimePermissionCatalog = target => { context.AppState.authPermissions = null; delete target.permissions; };
    context.setPermissionLifecycle = status => lifecycle.push(status);
    assert.notEqual(context.apiAuthAuthorizationFingerprint(user), context.apiAuthAuthorizationFingerprint(next));
    context.mergeApiCurrentUser(next);
    const cached = JSON.parse(store.get('pzp_current_user'));
    assert.equal(cached.activeBusinessContext, 'dar');
    assert.equal(cached.role, 'manager');
    assert.equal(Object.hasOwn(cached, 'permissions'), false);
    assert.equal(context.AppState.authPermissions, null);
    assert.deepEqual(lifecycle, ['loading']);
});

test('late business-switch responses cannot overwrite the newer accepted selection', async () => {
    const pending = new Map();
    const user = readyUser('event_genix');
    const f = loadApi(user, url => new Promise(resolve => {
        pending.set(new URL(url, 'http://localhost').searchParams.get('businessContext'), resolve);
    }));
    f.context.applyCrmBusinessProfile(profilePayload(user), { user: f.context.AppState.currentUser, syncScope: false, emit: false });
    const loadedBusinesses = [];
    f.context.renderCrmBusinessShell = () => {};
    f.context.initCrmBusinessContextPage({ onChange: value => loadedBusinesses.push(value.current) });
    const first = f.context.switchCrmBusinessContext('dar', { navigate: false }).then(value => ({ value }), error => ({ error }));
    await flushMicrotasks();
    const second = f.context.switchCrmBusinessContext('fixture_custom', { navigate: false });
    await flushMicrotasks();
    assert.equal(f.context.getCrmBusinessContext(), 'event_genix');
    assert.ok(pending.has('dar') && pending.has('fixture_custom'));
    pending.get('fixture_custom')(response(200, profilePayload(readyUser('fixture_custom'))));
    assert.equal(await second, 'fixture_custom');
    pending.get('dar')(response(200, profilePayload(readyUser('dar'))));
    assert.ok((await first).error);
    assert.equal(f.context.AppState.currentUser.activeBusinessContext, 'fixture_custom');
    assert.equal(f.context.getCrmBusinessOperatingProfile().activeBusinessContext, 'fixture_custom');
    assert.equal(f.context.getCrmBusinessContext(), 'fixture_custom');
    assert.deepEqual(f.events.filter(event => event.type === 'crmBusinessContextChanged').map(event => event.detail.current), ['fixture_custom']);
    assert.deepEqual(loadedBusinesses, ['fixture_custom']);
});

for (const failure of ['denied', 'network']) test(`a ${failure} business-profile switch preserves the previous scope and principal`, async () => {
    const user = readyUser('event_genix');
    const f = loadApi(user, async () => {
        if (failure === 'network') throw new Error('Fixture offline');
        const unavailable = readyUser(null, { overrides: { role: null, roles: [],
            accessContext: { status: 'unavailable', code: 'business_context_unavailable' } } });
        return response(403, { ...profilePayload(unavailable), success: false, code: 'business_context_unavailable' });
    });
    f.context.applyCrmBusinessProfile(profilePayload(user), { user: f.context.AppState.currentUser, syncScope: false, emit: false });
    const before = f.location.href;
    await assert.rejects(f.context.switchCrmBusinessContext('dar', { navigate: false }));
    assert.equal(f.context.AppState.currentUser.activeBusinessContext, 'event_genix');
    assert.equal(f.context.getCrmBusinessOperatingProfile().activeBusinessContext, 'event_genix');
    assert.equal(f.context.getCrmBusinessContext(), 'event_genix');
    assert.equal(f.location.href, before);
    assert.equal(f.events.some(event => event.type === 'crmBusinessContextChanged'), false);
});

test('permission hydration failure blocks the accepted new scope without restoring old grants or loading data', async () => {
    const user = readyUser('event_genix', { overrides: { permissions: { capabilities: { 'action:view_revenue': { allowed: true } } } } });
    const f = loadApi(user, async () => response(200, profilePayload(readyUser('dar'))));
    f.context.applyCrmBusinessProfile(profilePayload(user), { user: f.context.AppState.currentUser, syncScope: false, emit: false });
    let dataLoads = 0;
    f.context.renderCrmBusinessShell = () => {};
    f.context.initCrmBusinessContextPage({ onChange: () => { dataLoads += 1; } });
    let overlay = false;
    f.context.clearRuntimePermissionCatalog = target => { f.context.AppState.authPermissions = null; delete target.permissions; };
    f.context.hydrateActionPermissions = async () => null;
    f.context.renderPermissionBootstrapError = () => { overlay = true; };
    f.context.checkSession = () => {};
    await assert.rejects(f.context.switchCrmBusinessContext('dar', { navigate: false }));
    assert.equal(overlay, true);
    assert.equal(f.context.getCrmBusinessContext(), 'dar');
    assert.equal(f.context.AppState.currentUser.activeBusinessContext, 'dar');
    assert.equal(f.context.AppState.authPermissions, null);
    assert.equal(Object.hasOwn(f.context.AppState.currentUser, 'permissions'), false);
    assert.equal(dataLoads, 0);
    assert.equal(f.events.some(event => ['crmBusinessContextChanged', 'crmBusinessProfileChanged'].includes(event.type)), false);
});

for (const businessContext of ['dar', 'fixture_custom']) test(`refresh and verify preserve requested ${businessContext} through the server context header`, async () => {
    const user = readyUser(businessContext);
    const f = loadApi(user, async url => String(url).includes('/refresh')
        ? response(200, { accessToken: 'fixture-next-access', refreshToken: 'fixture-next-refresh', user })
        : response(200, { user }), { url: 'http://localhost/tasks?businessContext=' + businessContext });
    assert.equal(await f.context.apiRefreshAuthToken(), 'fixture-next-access');
    assert.equal((await f.context.apiVerifyToken()).activeBusinessContext, businessContext);
    const requests = f.requests.filter(row => /\/auth\/(refresh|verify)/.test(row.url));
    assert.equal(requests.length, 2);
    for (const request of requests) assert.equal(request.init.headers['X-Business-Context'], businessContext);
});

test('switching to Park while Dar is default preserves explicit Park through URL reload and refresh', async () => {
    const user = readyUser('dar', { defaultContext: 'dar' });
    const parkUser = readyUser('event_genix', { defaultContext: 'dar' });
    const fetchImpl = async url => String(url).includes('/auth/refresh')
        ? response(200, { accessToken: 'fixture-refreshed-park', refreshToken: 'fixture-next-refresh', user: parkUser })
        : response(200, profilePayload(parkUser));
    const f = loadApi(user, fetchImpl, { url: 'http://localhost/tasks?businessContext=dar' });
    f.context.applyCrmBusinessProfile(profilePayload(user), { user: f.context.AppState.currentUser, syncScope: false, emit: false });
    assert.equal(await f.context.switchCrmBusinessContext('event_genix', { navigate: false }), 'event_genix');
    assert.equal(f.location.searchParams.get('businessContext'), 'event_genix');
    assert.equal(f.context.getCrmBusinessContext(), 'event_genix');
    const reloaded = loadApi(JSON.parse(f.store.get('pzp_current_user')), fetchImpl,
        { url: f.location.href, store: Object.fromEntries(f.store) });
    assert.equal(reloaded.context.getCrmBusinessContext(), 'event_genix');
    assert.equal(await reloaded.context.apiRefreshAuthToken(), 'fixture-refreshed-park');
    const refreshRequest = reloaded.requests.find(item => item.url.includes('/auth/refresh'));
    assert.equal(refreshRequest.init.headers['X-Business-Context'], 'event_genix');
    assert.equal(reloaded.context.getCrmBusinessContext(), 'event_genix');
    assert.equal(reloaded.context.AppState.currentUser.defaultBusinessContext, 'dar');
});

test('organization aggregate selection removes foreign organizations and remains read-only', () => {
    const user = readyUser('event_genix', { allowed: ['event_genix', 'dar', 'fixture_other'] });
    const { context } = loadApi(user, undefined, { url: 'http://localhost/dashboard' });
    context.applyCrmBusinessProfile(profilePayload(user), { user, syncScope: false, emit: false });
    const all = context.sanitizeCrmBusinessScopeForUser({ mode: 'all', activeContext: 'event_genix' }, user, { page: { id: 'dashboard' } });
    assert.deepEqual(plain(all.selectedContexts).sort(), ['dar', 'event_genix']);
    assert.equal(all.canWrite, false);
    const multi = context.sanitizeCrmBusinessScopeForUser({ mode: 'multi', activeContext: 'event_genix',
        selectedContexts: ['event_genix', 'fixture_other', 'dar'] }, user, { page: { id: 'dashboard' } });
    assert.deepEqual(plain(multi.selectedContexts).sort(), ['dar', 'event_genix']);
    assert.equal(multi.readOnly, true);
    assert.equal(multi.canWrite, false);
});

test('Dar stays active and read-only on an all-business URL before profile hydration', () => {
    const user = readyUser('dar', { defaultContext: 'dar', allowed: ['event_genix', 'dar'] });
    const { context } = loadApi(user, undefined, { url: 'http://localhost/dashboard?businessScope=all' });
    assert.equal(context.getCrmBusinessOperatingProfile(), null);
    assert.equal(context.getCrmBusinessContext(), 'dar');
    const scope = context.getCrmBusinessScope();
    assert.equal(scope.mode, 'all');
    assert.equal(scope.activeContext, 'dar');
    assert.equal(scope.readOnly, true);
    assert.equal(scope.canWrite, false);
});

test('selection-required aggregate URLs cannot select Park before organization discovery', () => {
    const user = readyUser(null, { allowed: ['event_genix', 'fixture_other'], overrides: {
        role: null, roles: [], accessContext: { status: 'selection_required', code: 'business_context_required' }
    } });
    for (const mode of ['all', 'multi']) {
        const { context } = loadApi(user, undefined,
            { url: `http://localhost/dashboard?businessScope=${mode}&businessContext=event_genix&businessContexts=event_genix,fixture_other` });
        assert.equal(context.getCrmBusinessOperatingProfile(), null);
        assert.equal(context.getCrmBusinessContext(), null);
        const scope = context.getCrmBusinessScope();
        assert.equal(scope.mode, mode);
        assert.equal(scope.activeContext, null);
        assert.deepEqual(plain(scope.selectedContexts), []);
        assert.equal(scope.readOnly, true);
        assert.equal(scope.canWrite, false);
    }
});

test('all and multi scopes never become writable single scopes when metadata is unavailable', () => {
    for (const allowed of [['dar'], ['dar', 'fixture_other']]) {
        for (const mode of ['all', 'multi']) {
            const user = readyUser('dar', { defaultContext: 'dar', allowed });
            const { context } = loadApi(user, undefined,
                { url: `http://localhost/dashboard?businessScope=${mode}&businessContexts=dar,fixture_other` });
            assert.equal(context.getCrmBusinessOperatingProfile(), null);
            const scope = context.getCrmBusinessScope();
            assert.equal(scope.mode, mode);
            assert.equal(scope.activeContext, 'dar');
            assert.equal(scope.readOnly, true);
            assert.equal(scope.canWrite, false);
            assert.equal(context.guardCrmBusinessWrite('save fixture', scope), false);
        }
    }
});
