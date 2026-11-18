'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(fetcher) {
    const events = new Map(); const requests = []; const created = []; const revoked = [];
    const state = { sessionCurrent: true, business: 'event_genix' };
    class BrowserURL extends URL {
        static createObjectURL(blob) { created.push(blob); return 'blob:synthetic-' + created.length; }
        static revokeObjectURL(url) { revoked.push(url); }
    }
    const context = { URL: BrowserURL, Blob, AbortController, DOMException, location: { origin: 'https://synthetic.test' },
        document: { readyState: 'loading', addEventListener() {}, querySelectorAll() { return []; } },
        captureApiAuthSessionSnapshot: () => ({ generation: 'synthetic' }),
        isApiAuthSessionSnapshotCurrent: () => state.sessionCurrent,
        getCrmBusinessScope: () => ({ mode: 'single', context: state.business }),
        safeFetch: async (path, options) => { requests.push({ path, options }); return fetcher(path, options); },
        addEventListener(name, handler) { events.set(name, handler); }, setTimeout, clearTimeout };
    context.window = context;
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/chat-private-uploads'), 'utf8'), context);
    return { api: context.ChatPrivateUploads, events, requests, created, revoked, state };
}
function element() {
    return { isConnected: true, tagName: 'A', dataset: {}, removeAttribute() {} };
}

test('private attachments use the existing authenticated API fetch without URL credentials or caching', async () => {
    const f = fixture(async () => new Response('Synthetic file', { headers: { 'content-type': 'text/plain' } }));
    const node = element();
    const url = await f.api.urlFor(node, '/uploads/chat/channels/7/file.txt?legacy-cache=1');
    assert.equal(url, 'blob:synthetic-1');
    assert.equal(f.requests[0].path, '/api/chat/uploads/channels/7/file.txt');
    assert.equal(f.requests[0].options.cache, 'no-store');
    assert.equal(f.requests[0].options.redirect, 'error');
    assert.equal(f.requests[0].options.signal instanceof AbortSignal, true);
    assert.equal(await f.api.urlFor(node, '/uploads/chat/channels/7/file.txt?legacy-cache=1'), url);
    assert.equal(f.requests.length, 1);
    assert.equal(f.api.apiPath('https://foreign.test/uploads/chat/file.txt'), null);
    assert.equal(f.api.apiPath('javascript:alert(1)'), null);
    let paused = 0; let cleared = 0;
    f.api.bindAudio(node, { pause() { paused++; }, removeAttribute() { cleared++; }, load() {} });
    f.api.clear();
    assert.equal(paused, 1);
    assert.equal(cleared, 1);
    assert.deepEqual(f.revoked, [url]);
});

test('business ABA, session changes and detached nodes cannot create stale private object URLs', async () => {
    for (const mutation of ['business', 'session', 'detached']) {
        let resolve;
        const f = fixture(() => new Promise(done => { resolve = done; }));
        const node = element();
        const promise = f.api.urlFor(node, '/uploads/chat/file.png');
        if (mutation === 'business') {
            f.state.business = 'dar'; f.events.get('crmBusinessContextChanged')();
            f.state.business = 'event_genix'; f.events.get('crmBusinessContextChanged')();
        } else if (mutation === 'session') f.state.sessionCurrent = false;
        else node.isConnected = false;
        resolve(new Response('Synthetic image', { headers: { 'content-type': 'image/png' } }));
        await assert.rejects(promise, error => error.name === 'AbortError');
        assert.equal(f.created.length, 0, mutation);
    }
});

test('oversized bodies fail before buffering and unsupported MIME types cannot become active app documents', async () => {
    const oversized = fixture(async () => ({ headers: new Headers({ 'content-length': String(11 * 1024 * 1024) }),
        blob() { throw new Error('Must not buffer oversized body'); } }));
    await assert.rejects(oversized.api.urlFor(element(), '/uploads/chat/oversized.txt'), /Attachment unavailable/);
    assert.equal(oversized.created.length, 0);
    const html = fixture(async () => new Response('<script>PRIVATE_CANARY</script>', { headers: { 'content-type': 'text/html' } }));
    await html.api.urlFor(element(), '/uploads/chat/historical.txt');
    assert.equal(html.created[0].type, 'application/octet-stream');
    html.api.clear();
    assert.equal(html.revoked.length, 1);
});
