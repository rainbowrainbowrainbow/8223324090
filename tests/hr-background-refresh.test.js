'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/hr-page.js'), 'utf8');
const begin = source.indexOf('// HR_BACKGROUND_REFRESH_START');
const end = source.indexOf('// HR_BACKGROUND_REFRESH_END', begin);
assert.ok(begin >= 0 && end > begin);
const factory = vm.runInNewContext(`${source.slice(begin, end)}\ncreateHrReadRefreshController;`, { Promise });
function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
    let active = true, key = 'event_genix:ready:2026-11-07';
    const reads = [], errors = [];
    const controller = factory({ isActive: () => active, contextKey: () => key,
        read: () => { const d = deferred(); reads.push(d); return d.promise; }, onError: e => errors.push(e) });
    return { controller, reads, errors, setActive: v => { active = v; }, setKey: v => { key = v; } };
}

test('many overlapping timer ticks share one optional read', async () => {
    const h = setup();
    const pending = Array.from({ length: 20 }, () => h.controller.request('poll'));
    await flush(); assert.equal(h.reads.length, 1);
    h.reads[0].resolve('current'); await Promise.all(pending); await flush();
    assert.equal(h.reads.length, 1);
});

test('new attendance events retain exactly one fresh trailing read', async () => {
    const h = setup(); const first = h.controller.request('poll'); await flush();
    for (let i = 0; i < 20; i++) h.controller.request('realtime');
    h.reads[0].resolve('before-mutation'); await first; await flush();
    assert.equal(h.reads.length, 2);
    h.reads[1].resolve('after-mutation'); await flush();
    assert.equal(h.reads.length, 2);
});

test('inactive or hidden Today makes no read; becoming visible refreshes once', async () => {
    const h = setup(); h.setActive(false);
    await Promise.all([h.controller.request('poll'), h.controller.request('realtime')]);
    assert.equal(h.reads.length, 0);
    h.setActive(true); const next = h.controller.request('visible'); await flush();
    assert.equal(h.reads.length, 1); h.reads[0].resolve(); await next;
});

test('hide while in flight postpones the trailing work until visible', async () => {
    const h = setup(); const first = h.controller.request('poll'); await flush();
    h.controller.request('realtime'); h.setActive(false); h.reads[0].resolve(); await first; await flush();
    assert.equal(h.reads.length, 1);
    h.setActive(true); const next = h.controller.request('visible'); await flush();
    assert.equal(h.reads.length, 2); h.reads[1].resolve(); await next;
});

test('changed business/date/permission key starts current read without waiting for old one', async () => {
    const h = setup(); const old = h.controller.request('poll'); await flush();
    h.controller.request('realtime'); h.setKey('park:permissions-v2:2026-11-08');
    const fresh = h.controller.request('visible'); await flush(); assert.equal(h.reads.length, 2);
    h.reads[0].resolve('old'); await old; await flush(); assert.equal(h.reads.length, 2);
    h.reads[1].resolve('fresh'); await fresh;
});

test('failed read is handled and the next poll can recover', async () => {
    const h = setup(); const first = h.controller.request('poll'); await flush();
    h.reads[0].reject(new Error('synthetic failure')); await first; assert.equal(h.errors.length, 1);
    const next = h.controller.request('poll'); await flush(); assert.equal(h.reads.length, 2);
    h.reads[1].resolve('recovered'); await next;
});

test('page exit prevents a queued or later optional read', async () => {
    const h = setup(); const first = h.controller.request('poll'); await flush();
    h.controller.request('realtime'); h.controller.stop(); h.reads[0].resolve(); await first; await flush();
    await h.controller.request('visible'); assert.equal(h.reads.length, 1);
});

test('visibility or page exit before the queued microtask prevents the read', async () => {
    for (const stop of [false, true]) {
        const h = setup(); const next = h.controller.request('poll');
        if (stop) h.controller.stop(); else h.setActive(false);
        await next; assert.equal(h.reads.length, 0);
    }
});

test('context change before the read starts skips the stale request and refreshes current key', async () => {
    const h = setup(); const first = h.controller.request('poll');
    h.setKey('park:ready:2026-11-08'); await first; await flush();
    assert.equal(h.reads.length, 1); h.reads[0].resolve('current'); await flush();
});

test('actual HR timer and WebSocket wiring skips hidden work and refreshes once on return', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<body><button class="hr-tab active" data-tab="today"></button></body>', {
        url: 'https://fixture.local/hr#today', runScripts: 'outside-only'
    });
    const w = dom.window; let visibility = 'hidden';
    Object.defineProperty(w.document, 'visibilityState', { get: () => visibility });
    const intervals = [], timeouts = new Map(); let nextTimer = 0, subscriptions = 0;
    w.setInterval = fn => { intervals.push(fn); return intervals.length; };
    w.clearInterval = () => {};
    w.setTimeout = fn => { const id = ++nextTimer; timeouts.set(id, fn); return id; };
    w.clearTimeout = id => timeouts.delete(id);
    w.document.addEventListener = ((original) => (name, fn, options) => {
        if (name !== 'DOMContentLoaded') original(name, fn, options);
    })(w.document.addEventListener.bind(w.document));
    w.console = { log() {}, warn() {}, error() {} };
    const reads = [];
    try {
        w.eval(source);
        w.teamAccessContext = () => 'event_genix:session1';
        w.hrTodayKyivDate = () => '2026-11-07';
        w.syncHrRealtimeDateSubscription = () => { subscriptions++; };
        w.loadToday = () => { const d = deferred(); reads.push(d); return d.promise; };
        w.initHrRealtime(); w.initHrRealtime(); w.startPolling();
        intervals[0](); w.dispatchEvent(new w.Event('ws:hr-attendance')); await flush();
        assert.equal(reads.length, 0); assert.equal(timeouts.size, 0);
        visibility = 'visible'; w.document.dispatchEvent(new w.Event('visibilitychange')); await flush();
        assert.equal(reads.length, 1); assert.equal(subscriptions, 1);
        intervals[0](); intervals[0](); await flush(); assert.equal(reads.length, 1);
        w.dispatchEvent(new w.Event('ws:hr-attendance')); w.dispatchEvent(new w.Event('ws:hr-attendance'));
        assert.equal(timeouts.size, 1); for (const fn of timeouts.values()) fn(); timeouts.clear();
        await flush(); assert.equal(reads.length, 1);
        reads[0].resolve('old'); await flush(); assert.equal(reads.length, 2);
        reads[1].resolve('new'); await flush();
        visibility = 'hidden'; w.document.dispatchEvent(new w.Event('visibilitychange')); intervals[0]();
        await flush(); assert.equal(reads.length, 2);
        w.dispatchEvent(new w.Event('beforeunload'));
    } finally { dom.window.close(); }
});
