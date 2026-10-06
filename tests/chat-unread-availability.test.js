'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const api = read('js/api.js');
const availability = api.slice(api.indexOf('const legacyBusinessSurfaceDenials'), api.indexOf('function getCrmBusinessProfileForContext'));
const headers = api.slice(api.indexOf('function getAuthHeaders('), api.indexOf('function getTimelineAuthHeaders('));
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const response = (status, body) => ({ ok: status === 200, status, json: async () => body });
function harness(mode = 'compatibility') {
    const dom = new JSDOM('<span id="chatUnreadBadge"></span>', { url: 'https://fixture.local/hr', runScripts: 'outside-only' });
    const w = dom.window;
    let socket;
    w.WebSocket = class {
        static OPEN = 1; static CONNECTING = 0;
        constructor() { this.readyState = 1; socket = this; }
        send() {} close() {}
    };
    w.AppState = { currentUser: { id: 9, role: 'director', accessContext: { status: 'ready' } } };
    w.profile = { membershipMode: mode, activeBusinessId: 'event_genix', accessContext: { status: 'ready' } };
    w.scope = { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] };
    w.getCrmBusinessOperatingProfile = () => w.profile;
    w.getCrmBusinessScope = () => w.scope;
    w.CrmBusinessContext = { current: () => w.scope.activeContext };
    w.apiAuthAuthorizationFingerprint = user => JSON.stringify(user);
    w.CRM_BUSINESS_SCOPE_SINGLE = 'single'; w.CRM_BUSINESS_DEFAULT_CONTEXT = 'event_genix';
    w.canAccess = () => true;
    w.getStoredAuthToken = () => w.localStorage.getItem('pzp_token');
    w.applyCrmBusinessScopeHeaders = value => ({ ...value, 'X-Business-Context': w.scope.activeContext });
    w.localStorage.setItem('pzp_token', 'synthetic-token');
    w.localStorage.setItem('pzp_auth_session_generation', '1');
    const state = { calls: [], transport: async () => response(200, { total: 3 }) };
    w.fetch = async (url, options) => { state.calls.push({ url, options }); return state.transport(); };
    w.eval(availability); w.eval(headers); w.eval(read('js/ws.js'));
    w.ParkWS.connect();
    const auth = () => socket.onmessage({ data: JSON.stringify({ type: 'auth:success', payload: { username: 'synthetic' } }) });
    const emit = name => w.dispatchEvent(new w.CustomEvent(name));
    const badge = w.document.getElementById('chatUnreadBadge');
    const receive = message => socket.onmessage({ data: JSON.stringify(message) });
    return { w, state, auth, emit, receive, badge, close: () => { w.ParkWS.disconnect(); w.close(); } };
}

test('membership chat unread is unavailable without sending a forbidden request', async () => {
    const h = harness('membership');
    try {
        h.auth(); await settle();
        assert.equal(h.state.calls.length, 0);
        assert.equal(h.w.getLegacyBusinessSurfaceAvailability('chat').code, 'chat_not_migrated');
        assert.match(h.badge.title, /чат/i);
        assert.equal(h.badge.dataset.loadState, 'unavailable');
    } finally { h.close(); }
});

test('unread waits for profile readiness and uses current scoped headers once ready', async () => {
    const h = harness();
    try {
        h.w.profile.accessContext.status = 'loading'; h.auth(); await settle();
        assert.equal(h.state.calls.length, 0);
        h.w.profile.accessContext.status = 'ready'; h.emit('crmBusinessProfileChanged'); await settle();
        assert.equal(h.state.calls.length, 1);
        assert.equal(h.state.calls[0].options.headers['X-Business-Context'], 'event_genix');
        assert.equal(h.badge.textContent, '3');
        h.emit('crmBusinessProfileChanged'); await settle();
        assert.equal(h.state.calls.length, 1);
    } finally { h.close(); }
});

test('read permission absence and missing availability helper fail closed', async () => {
    for (const configure of [h => { h.w.canAccess = () => false; }, h => { delete h.w.getLegacyBusinessSurfaceAvailability; }]) {
        const h = harness();
        try { configure(h); h.auth(); await settle(); assert.equal(h.state.calls.length, 0); }
        finally { h.close(); }
    }
});

test('a late unread response cannot repaint after a business switch', async () => {
    const h = harness();
    try {
        let resolve; h.state.transport = () => new Promise(done => { resolve = done; });
        h.auth();
        h.w.profile.membershipMode = 'membership'; h.emit('crmBusinessContextChanged');
        resolve(response(200, { total: 91 })); await settle();
        assert.notEqual(h.badge.textContent, '91');
        assert.equal(h.badge.dataset.loadState, 'unavailable');
    } finally { h.close(); }
});

test('same-business session change discards an older response', async () => {
    const h = harness();
    try {
        let resolve; h.state.transport = () => new Promise(done => { resolve = done; }); h.auth();
        h.w.localStorage.setItem('pzp_auth_session_generation', '2');
        h.state.transport = async () => response(200, { total: 7 });
        h.emit('crmBusinessProfileChanged'); await settle();
        resolve(response(200, { total: 91 })); await settle();
        assert.equal(h.badge.textContent, '7');
    } finally { h.close(); }
});

test('server namespace denial is remembered without repeated forbidden requests', async () => {
    const h = harness();
    try {
        h.state.transport = async () => response(403, { code: 'chat_not_migrated', message: 'Чат недоступний для цього бізнесу' });
        h.auth(); await settle(); h.emit('crmBusinessProfileChanged'); h.auth(); await settle();
        assert.equal(h.state.calls.length, 1);
        assert.equal(h.badge.dataset.loadState, 'unavailable');
        assert.match(h.badge.title, /Чат недоступний/);
    } finally { h.close(); }
});

test('business ABA switch and auth clearing cannot revive a stale counter', async () => {
    const h = harness();
    try {
        let resolve; h.state.transport = () => new Promise(done => { resolve = done; }); h.auth();
        h.w.profile.membershipMode = 'membership'; h.emit('crmBusinessContextChanged');
        h.w.profile.membershipMode = 'compatibility';
        h.state.transport = async () => response(200, { total: 7 });
        h.emit('crmBusinessContextChanged'); await settle();
        resolve(response(200, { total: 91 })); await settle();
        assert.equal(h.badge.textContent, '7');
        h.w.localStorage.removeItem('pzp_token'); h.emit('crm:auth-cleared');
        assert.notEqual(h.badge.textContent, '7');
        assert.equal(h.badge.dataset.loadState, 'unavailable');
    } finally { h.close(); }
});

test('a message during the initial count fetch refreshes the count instead of incrementing an unknown value', async () => {
    const h = harness();
    try {
        let resolve; h.state.transport = () => new Promise(done => { resolve = done; }); h.auth();
        h.state.transport = async () => response(200, { total: 4 });
        h.receive({ type: 'chat:message', payload: {} }); await settle();
        resolve(response(200, { total: 3 })); await settle();
        assert.equal(h.state.calls.length, 2);
        assert.equal(h.badge.dataset.loadState, 'ready');
        assert.equal(h.badge.textContent, '4');
    } finally { h.close(); }
});

test('HTTP and malformed unread failures are explicit, while successful zero stays empty', async () => {
    for (const result of [response(500, {}), response(200, { error: 'not a count' }), response(200, { total: -1 })]) {
        const h = harness();
        try {
            h.state.transport = async () => result; h.auth(); await settle();
            assert.equal(h.badge.dataset.loadState, 'unavailable');
            assert.match(h.badge.title, /Не вдалося/);
        } finally { h.close(); }
    }
    const h = harness();
    try {
        h.state.transport = async () => response(200, { total: 0 }); h.auth(); await settle();
        assert.equal(h.badge.dataset.loadState, 'ready'); assert.equal(h.badge.style.display, 'none');
    } finally { h.close(); }
});
