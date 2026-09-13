'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const apiSource = fs.readFileSync(path.join(__dirname, '../js/api.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '../js/warehouse-page.js'), 'utf8');
function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const ready = { success: true, status: { telegram: { configured: true }, vision: { configured: true }, counts: {} } };
const denial = { success: false, code: 'warehouse_photo_intake_not_migrated', error: 'Server membership denial' };
const item = name => ({ id: 91, status: 'needs_review', draft: { name, quantity: 3, category: 'craft', unit: 'шт' } });

function fixture(t) {
    const dom = new JSDOM(`<!doctype html><body>
        <div id="stockGrid">SUPPORTED_STOCK_SENTINEL</div><button id="addItemBtn">Додати позицію</button>
        <section><button id="refreshIntakeBtn">Оновити intake</button>
        <div id="warehouseBotStatus"></div><div id="warehouseIntakeList"></div></section>
    </body>`, { url: 'http://localhost/warehouse', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const window = dom.window;
    const originalAdd = window.document.addEventListener.bind(window.document);
    window.document.addEventListener = (name, listener, options) => {
        if (name !== 'DOMContentLoaded') originalAdd(name, listener, options);
    };
    window.localStorage.setItem('pzp_token', 'synthetic-session-token');
    window.fetch = () => { throw new Error('Unexpected external request'); };
    const requests = [];
    const errors = [];
    window.console.error = (...args) => errors.push(args);
    window.getAuthHeaders = () => ({ Authorization: 'Bearer synthetic-session-token' });
    let transport = () => { throw new Error('Unexpected fixture transport'); };
    window.apiNetworkFetch = (url, options) => { requests.push({ url, options }); return transport(url); };
    const handleStart = apiSource.indexOf('function handleAuthError(');
    const handleEnd = apiSource.indexOf('\n/**', handleStart);
    const start = apiSource.indexOf('async function apiGetWarehousePhotoIntakeStatus(');
    const end = apiSource.indexOf('async function apiConfirmWarehousePhotoIntake(', start);
    assert.ok(handleStart >= 0 && handleEnd > handleStart && start >= 0 && end > start);
    vm.runInContext("const API_BASE = '/api';\n" + apiSource.slice(handleStart, handleEnd)
        + '\n' + apiSource.slice(start, end), dom.getInternalVMContext(), { filename: 'js/api.js:intake-read-wrappers' });
    vm.runInContext(pageSource + '\nwindow.__intake = { loadWarehousePhotoIntake, setupEventListeners };',
        dom.getInternalVMContext(), { filename: 'js/warehouse-page.js' });
    const panel = id => window.document.getElementById(id);
    return { window, requests, errors, panel, load: window.__intake.loadWarehousePhotoIntake,
        setTransport(fn) { transport = fn; },
        setPair(statusBody, listBody, statusCode = 200, listCode = 200) {
            transport = async url => url.endsWith('/status') ? response(statusBody, statusCode) : response(listBody, listCode);
        },
        bindRefresh() { window.__intake.setupEventListeners(); },
        text() { return panel('warehouseBotStatus').textContent + panel('warehouseIntakeList').textContent; } };
}

function assertUnavailable(f) {
    assert.match(f.text(), /Фото-приймання тимчасово недоступне.*розмежування даних за бізнесами/);
    assert.doesNotMatch(f.text(), /Немає токена|Немає ключа|Надішліть фото|STALE_INTAKE|OLD_SUCCESS/);
    assert.equal(f.panel('warehouseIntakeList').children.length, 0);
    assert.ok(f.panel('warehouseBotStatus').querySelector('[role="status"]'));
    assert.equal(f.panel('stockGrid').textContent, 'SUPPORTED_STOCK_SENTINEL');
    assert.equal(f.panel('addItemBtn').disabled, false);
    assert.equal(f.panel('refreshIntakeBtn').disabled, false);
    assert.equal(f.window.localStorage.getItem('pzp_token'), 'synthetic-session-token');
}

test('actual read wrappers preserve membership403 and the page clears stale cards without a bot setup invitation', async t => {
    for (const deniedEndpoint of ['status', 'list', 'both']) {
        const f = fixture(t);
        f.setPair(ready, { success: true, items: [item('STALE_INTAKE')] });
        await f.load();
        assert.ok(f.panel('warehouseIntakeList').querySelector('input[data-intake-field="name"]'));
        f.setPair(deniedEndpoint === 'list' ? ready : denial,
            deniedEndpoint === 'status' ? { success: true, items: [item('STALE_INTAKE')] } : denial,
            deniedEndpoint === 'list' ? 200 : 403, deniedEndpoint === 'status' ? 200 : 403);
        await f.load();
        assertUnavailable(f);
        assert.equal(f.errors.length, 0, 'Expected containment does not log a network failure');
        assert.equal(f.requests.length, 4);
        assert.equal(f.requests[2].options.headers.Authorization, 'Bearer synthetic-session-token');
    }
});

test('a successful empty compatibility queue keeps its genuine empty and bot readiness states', async t => {
    const f = fixture(t);
    f.setPair({ success: true, status: { telegram: { configured: false }, vision: { configured: false }, counts: {} } },
        { success: true, items: [] });
    await f.load();
    assert.match(f.text(), /Надішліть фото/);
    assert.match(f.text(), /Немає токена/);
    assert.doesNotMatch(f.text(), /тимчасово недоступне|Не вдалося завантажити/);
});

test('generic HTTP and network failures clear old cards and offer retry instead of claiming an empty queue', async t => {
    for (const network of [false, true]) {
        const f = fixture(t);
        f.setPair(ready, { success: true, items: [item('STALE_INTAKE')] });
        await f.load();
        if (network) f.setTransport(async () => { throw new Error('Synthetic transport offline'); });
        else f.setPair({ error: 'Server unavailable' }, { error: 'Server unavailable' }, 503, 503);
        await f.load();
        assert.match(f.text(), /Не вдалося завантажити фото-приймання.*повторити спробу/);
        assert.doesNotMatch(f.text(), /Надішліть фото|Немає токена|STALE_INTAKE|розмежування даних/);
        assert.equal(f.panel('warehouseIntakeList').children.length, 0);
    }
});

test('the existing refresh button recovers from denial to permitted data and clears the unavailable message', async t => {
    const f = fixture(t);
    f.bindRefresh();
    f.setPair(denial, denial, 403, 403);
    await f.load();
    assertUnavailable(f);
    f.setPair(ready, { success: true, items: [item('RECOVERED_INTAKE')] });
    f.panel('refreshIntakeBtn').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.doesNotMatch(f.text(), /тимчасово недоступне|Не вдалося завантажити/);
    assert.equal(f.panel('warehouseIntakeList').querySelector('input[data-intake-field="name"]').value, 'RECOVERED_INTAKE');
    assert.equal(f.requests.length, 4);
});

test('an older successful response cannot replace a newer denial or restore stale editable cards', async t => {
    const f = fixture(t);
    const status = deferred();
    const list = deferred();
    f.setTransport(url => url.endsWith('/status') ? status.promise : list.promise);
    const old = f.load();
    f.setPair(denial, denial, 403, 403);
    await f.load();
    status.resolve(response(ready));
    list.resolve(response({ success: true, items: [item('OLD_SUCCESS')] }));
    await old;
    assertUnavailable(f);
});

test('an older denial cannot override a newer successful retry', async t => {
    const f = fixture(t);
    const status = deferred();
    const list = deferred();
    f.setTransport(url => url.endsWith('/status') ? status.promise : list.promise);
    const old = f.load();
    f.setPair(ready, { success: true, items: [item('CURRENT_INTAKE')] });
    await f.load();
    status.resolve(response(denial, 403));
    list.resolve(response(denial, 403));
    await old;
    assert.equal(f.panel('warehouseIntakeList').querySelector('input[data-intake-field="name"]').value, 'CURRENT_INTAKE');
    assert.doesNotMatch(f.text(), /тимчасово недоступне|Не вдалося завантажити/);
});

test('malformed or incomplete success payloads are failures, not an empty queue', async t => {
    const f = fixture(t);
    for (const [status, list] of [[{ success: true }, { success: true, items: [] }],
        [ready, { success: true }], [ready, { success: true, items: {} }]]) {
        f.setPair(status, list);
        await f.load();
        assert.match(f.text(), /Не вдалося завантажити фото-приймання/);
        assert.doesNotMatch(f.text(), /Надішліть фото|Немає токена/);
    }
    f.setTransport(async () => ({ ok: false, status: 503, async json() { throw new Error('Synthetic malformed JSON'); } }));
    await f.load();
    assert.match(f.text(), /Не вдалося завантажити фото-приймання/);
});
