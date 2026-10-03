'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/customers-page.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'customers.html'), 'utf8');

function fixture(t) {
    const dom = new JSDOM(html, { url: 'http://localhost/customers', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const w = dom.window;
    const addEvent = w.document.addEventListener.bind(w.document);
    w.document.addEventListener = (type, fn, ...options) => {
        if (type !== 'DOMContentLoaded') addEvent(type, fn, ...options);
    };
    w.localStorage.setItem('pzp_token', 'synthetic-only');
    w.AppState = { currentUser: { id: 1, role: 'creator' } };
    w.resolveCapability = () => ({ allowed: true });
    w.getUserRole = () => 'creator';
    w.showNotification = () => {};
    const calls = [];
    let transport = async () => { throw new Error('Fixture transport not configured'); };
    w.fetch = (url, options) => {
        assert.match(String(url), /^\/api\/customers\?/);
        assert.equal(options.method || 'GET', 'GET');
        calls.push(String(url));
        return transport();
    };
    w.eval(source + '\nwindow.customerQa = { fetchCustomers, reloadCustomers, CrmState };');
    w.customerQa.CrmState.customers = [{ id: 1, name: 'Previous fixture' }];
    w.document.getElementById('customerTableBody').innerHTML = '<tr><td>Previous fixture</td></tr>';
    return { w, calls, api: w.customerQa, table: w.document.getElementById('customerTableBody'),
        setTransport(fn) { transport = fn; } };
}

test('loading replaces prior rows in the actual customer HTML table', async t => {
    const f = fixture(t);
    let finish;
    f.setTransport(() => new Promise(resolve => { finish = resolve; }));
    const loading = f.api.reloadCustomers();
    assert.match(f.table.textContent, /Завантаження/);
    assert.doesNotMatch(f.table.textContent, /Previous fixture/);
    finish({ ok: true, status: 200, json: async () => ({ customers: [], total: 0, pages: 1, page: 1 }) });
    assert.equal(await loading, true);
});

test('HTTP 500 cannot become a successful empty customer search', async t => {
    const f = fixture(t);
    f.setTransport(async () => ({ ok: false, status: 500, json: async () => ({ error: 'synthetic failure' }) }));
    assert.equal(await f.api.reloadCustomers(), false);
    assert.equal(f.api.CrmState.customers[0].name, 'Previous fixture');
    assert.match(f.table.textContent, /Не вдалося завантажити/);
    assert.doesNotMatch(f.table.textContent, /Клієнтів.*не знайдено|Завантаження/);
    assert.ok(f.table.querySelector('[role="alert"]'));
});

test('customer error exposes a GET retry which recovers to a genuine empty state', async t => {
    const f = fixture(t);
    f.setTransport(async () => { throw new Error('synthetic network outage'); });
    assert.equal(await f.api.reloadCustomers(), false);
    const retry = f.table.querySelector('button');
    assert.ok(retry);
    f.setTransport(async () => ({ ok: true, status: 200, json: async () => ({ customers: [], total: 0, pages: 1, page: 1 }) }));
    retry.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 2);
    assert.equal(f.table.querySelector('[role="alert"]'), null);
    assert.match(f.table.textContent, /Клієнтів ще немає/);
});

test('a stale HTTP failure cannot replace the latest successful customer table', async t => {
    const f = fixture(t);
    const responses = [];
    f.setTransport(() => new Promise(resolve => responses.push(resolve)));
    const older = f.api.reloadCustomers();
    const newer = f.api.reloadCustomers();
    responses[1]({ ok: true, status: 200, json: async () => ({ customers: [], total: 0, pages: 1, page: 1 }) });
    assert.equal(await newer, true);
    responses[0]({ ok: false, status: 500, json: async () => ({ error: 'obsolete failure' }) });
    assert.equal(await older, false);
    assert.equal(f.table.querySelector('[role="alert"]'), null);
    assert.match(f.table.textContent, /Клієнтів ще немає/);
});
