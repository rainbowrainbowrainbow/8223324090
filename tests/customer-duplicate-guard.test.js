'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const express = require('express');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const routeFile = path.join(ROOT, 'routes/customers.js');
const routeSource = fs.readFileSync(routeFile, 'utf8');
const uiSource = fs.readFileSync(path.join(ROOT, 'js/customers-page.js'), 'utf8');
const nativeRequire = createRequire(routeFile);

function createRouter(state) {
    const auth = nativeRequire('../middleware/auth');
    const module = { exports: {} };
    const db = {
        pool: {
            async connect() {
                state.connections++;
                throw new Error('Merge must never acquire a DB client');
            },
            async query(sql, params) {
                state.queries.push({ sql, params });
                if (!String(sql).includes('FROM customers c1')) {
                    throw new Error('Unexpected query');
                }
                if (state.lookupError) throw new Error('Synthetic lookup failure');
                return { rows: state.rows };
            }
        }
    };
    vm.runInNewContext(routeSource, {
        module,
        exports: module.exports,
        require(id) {
            if (id === '../db') return db;
            if (id === '../middleware/auth') {
                return {
                    ...auth,
                    authenticateToken(req, res, next) {
                        const role = req.headers['x-test-role'];
                        if (!role) return res.status(401).json({ error: 'Authentication required' });
                        req.user = { id: 1, role };
                        next();
                    }
                };
            }
            if (id === '../utils/logger') return { createLogger: () => ({ info() {}, warn() {}, error() {} }) };
            return nativeRequire(id);
        },
        Buffer, console, process, setTimeout, clearTimeout
    }, { filename: routeFile });
    return module.exports;
}

test('customer merge HTTP endpoint refuses writes while duplicate lookup remains available', async t => {
    const state = { connections: 0, queries: [], rows: [], lookupError: false };
    const app = express();
    app.use(express.json());
    app.use('/api/customers', createRouter(state));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    const base = 'http://127.0.0.1:' + server.address().port + '/api/customers';
    const merge = (body, context = 'event_genix', role = 'creator', primary = '41') => fetch(
        base + '/' + primary + '/merge?businessContext=' + context,
        { method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: JSON.stringify(body) }
    );

    for (const context of ['event_genix', 'maysternya_doli']) {
        for (const body of [{ duplicateId: 42 }, {}, { duplicateId: 41 }, { duplicateId: 'invalid' }]) {
            await t.test('blocks ' + context + ' merge body ' + JSON.stringify(body), async () => {
                const response = await merge(body, context);
                assert.equal(response.status, 409);
                const data = await response.json();
                assert.equal(data.success, false);
                assert.equal(data.code, 'CUSTOMER_MERGE_DISABLED');
                assert.match(data.error, /тимчасово недоступне/);
                assert.equal(state.connections, 0);
                assert.equal(state.queries.length, 0);
            });
        }
    }
    await t.test('preserves authentication and minimum role middleware', async () => {
        assert.equal((await merge({ duplicateId: 42 }, 'event_genix', null)).status, 401);
        assert.equal((await merge({ duplicateId: 42 }, 'event_genix', 'reception')).status, 403);
        assert.equal(state.connections, 0);
        assert.equal(state.queries.length, 0);
    });
    await t.test('preserves the read-only all-business scope', async () => {
        const response = await merge({ duplicateId: 42, businessScope: 'all' });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, 'business_scope_read_only');
        assert.equal(state.connections, 0);
        assert.equal(state.queries.length, 0);
    });
    await t.test('duplicate lookup returns scoped candidate pairs', async () => {
        state.rows = [{ id1: 41, id2: 42, name1: 'Test A', name2: 'Test B', match_type: 'phone' }];
        const response = await fetch(base + '/duplicates?businessContext=maysternya_doli', { headers: { 'x-test-role': 'creator' } });
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.success, true);
        assert.equal(data.count, 1);
        assert.equal(data.duplicates[0].id2, 42);
        assert.deepEqual(Array.from(state.queries.at(-1).params), ['maysternya_doli']);
        assert.match(state.queries.at(-1).sql, /c1.business_context/);
        assert.match(state.queries.at(-1).sql, /c2.business_context/);
        assert.equal(state.connections, 0);
    });
    await t.test('duplicate lookup errors remain HTTP errors', async () => {
        state.lookupError = true;
        const response = await fetch(base + '/duplicates', { headers: { 'x-test-role': 'creator' } });
        assert.equal(response.status, 500);
        assert.equal((await response.json()).success, undefined);
        assert.equal(state.connections, 0);
    });
});

function uiHarness({ revenue = true } = {}) {
    const dom = new JSDOM('<div id="tabDuplicates"></div>', { runScripts: 'outside-only', url: 'https://crm.test/customers' });
    const context = dom.getInternalVMContext();
    const requests = [];
    const opened = [];
    const notices = [];
    context.AbortController = AbortController;
    context.scope = { mode: 'single', activeContext: 'event_genix' };
    context.customerBusinessScope = () => context.scope;
    context.customerApiUrl = value => value + '?businessContext=' + context.scope.activeContext;
    context.canViewCustomerRevenue = () => revenue;
    context.formatMoney = value => String(value) + ' грн';
    context.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    context.showCustomerDetail = id => opened.push({ id, context: context.scope.activeContext });
    context.showNotification = (...args) => notices.push(args);
    context.fetch = (url, options) => {
        let resolve, reject;
        const promise = new Promise((a, b) => { resolve = a; reject = b; });
        requests.push({ url, options, resolve, reject });
        return promise;
    };
    const start = uiSource.indexOf('let duplicatesRequestController = null;');
    const end = uiSource.indexOf('// v30.4: COMMUNICATIONS', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(uiSource.slice(start, end) + '\nthis.loadTestDuplicates = loadDuplicates;', context);
    return { dom, context, requests, opened, notices, panel: dom.window.document.getElementById('tabDuplicates') };
}

const pair = { id1: 41, id2: 42, name1: 'Test <A>', name2: 'Test B', phone1: '+380000000000', match_type: 'phone', bookings1: 2, bookings2: 1, spent1: 1700, spent2: 900 };
const response = (data, ok = true) => ({ ok, json: async () => data });

test('duplicate panel opens both profiles, escapes data and has no merge action', async t => {
    const h = uiHarness();
    t.after(() => h.dom.window.close());
    const loading = h.context.loadTestDuplicates();
    assert.equal(h.panel.getAttribute('aria-busy'), 'true');
    h.requests[0].resolve(response({ success: true, count: 999, duplicates: [pair] }));
    assert.equal(await loading, true);
    assert.equal(h.panel.getAttribute('aria-busy'), 'false');
    assert.match(h.panel.textContent, /Пар можливих дублікатів у списку: 1/);
    assert.doesNotMatch(h.panel.textContent, /999/);
    assert.equal(h.panel.querySelector('a,script'), null);
    assert.match(h.panel.textContent, /Test <A>/);
    const buttons = h.panel.querySelectorAll('[data-duplicate-customer-id]');
    buttons[0].click();
    buttons[1].click();
    assert.deepEqual(h.opened.map(item => item.id), [41, 42]);
    assert.ok(h.panel.querySelector('button[disabled]'));
    assert.equal(h.panel.querySelector('[onclick*="mergeCustomers"]'), null);
    const before = h.requests.length;
    assert.equal(h.context.mergeCustomers(41, 42), false);
    assert.equal(h.requests.length, before, 'stale merge handler must not send a request');
    assert.match(h.notices[0][0], /тимчасово недоступне/);
});

test('duplicate panel preserves financial visibility and business context', async t => {
    const h = uiHarness({ revenue: false });
    t.after(() => h.dom.window.close());
    h.context.scope = { mode: 'single', activeContext: 'maysternya_doli' };
    const loading = h.context.loadTestDuplicates();
    h.requests[0].resolve(response({ success: true, duplicates: [pair] }));
    await loading;
    assert.match(h.requests[0].url, /businessContext=maysternya_doli/);
    assert.doesNotMatch(h.panel.textContent, /1700|900|грн/);
    h.panel.querySelector('[data-duplicate-customer-id]').click();
    assert.deepEqual(h.opened, [{ id: 41, context: 'maysternya_doli' }]);
    h.context.scope = { mode: 'single', activeContext: 'event_genix' };
    h.panel.querySelector('[data-duplicate-customer-id]').click();
    assert.equal(h.opened.length, 1, 'old context profile buttons must not open a different business');
});

for (const scenario of ['empty', 'http', 'network', 'json', 'missing', 'invalid-id']) {
    test('duplicate lookup distinguishes ' + scenario + ' from a successful empty result', async t => {
        const h = uiHarness();
        t.after(() => h.dom.window.close());
        const loading = h.context.loadTestDuplicates();
        if (scenario === 'network') h.requests[0].reject(new Error('Synthetic network failure'));
        else if (scenario === 'json') h.requests[0].resolve({ ok: true, json: async () => { throw new Error('Invalid JSON'); } });
        else if (scenario === 'http') h.requests[0].resolve(response({ error: 'Internal server error' }, false));
        else if (scenario === 'missing') h.requests[0].resolve(response({ success: true }));
        else if (scenario === 'invalid-id') h.requests[0].resolve(response({ success: true, duplicates: [{ ...pair, id1: '<script>' }] }));
        else h.requests[0].resolve(response({ success: true, duplicates: [] }));
        assert.equal(await loading, scenario === 'empty');
        assert.equal(Boolean(h.panel.querySelector('[role="alert"]')), scenario !== 'empty');
        assert.equal(Boolean(h.panel.querySelector('[data-duplicates-retry]')), scenario !== 'empty');
        if (scenario === 'empty') assert.match(h.panel.textContent, /Можливих дублікатів не знайдено/);
        else assert.doesNotMatch(h.panel.textContent, /Можливих дублікатів не знайдено/);
        assert.equal(h.panel.getAttribute('aria-busy'), 'false');
    });
}

test('duplicate lookup retry replaces error with results and restores focus', async t => {
    const h = uiHarness();
    t.after(() => h.dom.window.close());
    const loading = h.context.loadTestDuplicates();
    h.requests[0].reject(new Error('Synthetic failure'));
    await loading;
    const retry = h.panel.querySelector('[data-duplicates-retry]');
    retry.focus();
    retry.click();
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve(response({ success: true, duplicates: [pair] }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.panel.querySelector('[role="alert"]'), null);
    assert.equal(h.dom.window.document.activeElement.tagName, 'H4');
});

for (const scenario of ['stale-success', 'stale-error', 'context-change']) {
    test('duplicate lookup ignores ' + scenario, async t => {
        const h = uiHarness();
        t.after(() => h.dom.window.close());
        const a = h.context.loadTestDuplicates();
        if (scenario === 'context-change') h.context.scope = { mode: 'single', activeContext: 'maysternya_doli' };
        const b = h.context.loadTestDuplicates();
        assert.equal(h.requests[0].options.signal.aborted, true);
        h.requests[1].resolve(response({ success: true, duplicates: [{ ...pair, name1: 'Current result' }] }));
        assert.equal(await b, true);
        if (scenario === 'stale-error') h.requests[0].reject(new Error('Old error'));
        else h.requests[0].resolve(response({ success: true, duplicates: [{ ...pair, name1: 'Old result' }] }));
        assert.equal(await a, false);
        assert.match(h.panel.textContent, /Current result/);
        assert.doesNotMatch(h.panel.textContent, /Old result|Не вдалося/);
    });
}
