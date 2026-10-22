'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { trackRequests } = require('./helpers/browser-smoke-sync');
const origin = 'http://127.0.0.1:12345';
const request = path => ({ url: () => origin + path, method: () => 'GET', resourceType: () => 'fetch' });

test('a request beginning during an empty interval prevents premature navigation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const context = new EventEmitter(), tracker = trackRequests(context, origin);
    let ready = false;
    const idle = tracker.idle({ quietMs: 100, timeoutMs: 1000 }).then(() => { ready = true; });
    t.mock.timers.tick(50);
    const r = request('/api/lines/2030-01-01?businessContext=dar'); context.emit('request', r);
    t.mock.timers.tick(150); await Promise.resolve(); assert.equal(ready, false);
    context.emit('requestfinished', r); t.mock.timers.tick(99); await Promise.resolve(); assert.equal(ready, false);
    t.mock.timers.tick(1); await idle; assert.equal(ready, true); tracker.dispose();
});
test('failed requests drain, foreign requests do not block, listeners are released', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const context = new EventEmitter(), tracker = trackRequests(context, origin);
    const r = request('/api/my-day/timer'); context.emit('request', r);
    context.emit('request', { url: () => 'https://example.invalid/font' });
    const idle = tracker.idle({ quietMs: 10 }); context.emit('requestfailed', r);
    t.mock.timers.tick(10); await idle; tracker.dispose();
    for (const event of ['request', 'requestfinished', 'requestfailed']) assert.equal(context.listenerCount(event), 0);
});
test('a stuck request fails closed with redacted route diagnostics, then a retry can settle', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const context = new EventEmitter(), tracker = trackRequests(context, origin);
    const r = request('/api/staff/98765?token=secret'); context.emit('request', r);
    const idle = tracker.idle({ quietMs: 10, timeoutMs: 50 });
    const rejected = assert.rejects(idle, error => error.message.includes('/api/staff/:id') && !error.message.includes('secret') && !error.message.includes('98765'));
    t.mock.timers.tick(50); await rejected;
    context.emit('requestfinished', r); const retry = tracker.idle({ quietMs: 10 }); t.mock.timers.tick(10); await retry; tracker.dispose();
});

test('committed navigation retires only old-document reads, keeping writes and current reads strict', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const context = new EventEmitter(), tracker = trackRequests(context, origin);
    const frame = {}, page = new EventEmitter(); page.mainFrame = () => frame; context.emit('page', page);
    const old = { ...request('/api/lines/123'), frame: () => frame };
    const write = { ...request('/api/tasks/123'), frame: () => frame, method: () => 'POST' };
    context.emit('request', old); context.emit('request', write); page.emit('framenavigated', frame);
    assert.deepEqual(tracker.retiredReads(), [{ method: 'GET', path: '/api/lines/:id', reason: 'previous_document_navigation' }]);
    const current = { ...request('/api/education/groups'), frame: () => frame }; context.emit('request', current);
    let ready = false; const idle = tracker.idle({ quietMs: 10 }).then(() => { ready = true; });
    t.mock.timers.tick(20); await Promise.resolve(); assert.equal(ready, false);
    context.emit('requestfinished', write); t.mock.timers.tick(20); await Promise.resolve(); assert.equal(ready, false);
    context.emit('requestfinished', current); t.mock.timers.tick(10); await idle;
    tracker.dispose(); assert.equal(page.listenerCount('framenavigated'), 0); assert.equal(context.listenerCount('page'), 0);
});
