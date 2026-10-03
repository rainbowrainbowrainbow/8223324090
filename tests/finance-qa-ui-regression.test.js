'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'finance.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'js/finance-page.js'), 'utf8');

function fixture(t, query = '') {
    const dom = new JSDOM(html, { url: `http://localhost/finance${query}`, runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const { window } = dom;
    const originalAdd = window.document.addEventListener.bind(window.document);
    window.document.addEventListener = (event, listener, options) => {
        if (event !== 'DOMContentLoaded') originalAdd(event, listener, options);
    };
    window.handleAuthError = () => false;
    window.getAuthHeaders = () => ({});
    const requests = [];
    let transport = async () => ({ ok: true, json: async () => ({ transactions: [], totalPages: 1 }) });
    window.apiFetchWithAuthRetry = (url, options) => {
        requests.push({ url, method: options.method });
        return transport(url, options);
    };
    window.eval(`${source}\nwindow.qaFinance = { FinState, formatDate, getInitialFinanceMode,
        getInitialFinanceTab, setFinanceMode, switchTab, loadForecast, loadAdvancedDashboard };`);
    return { window, api: window.qaFinance, requests,
        transport(value) { transport = value; }, el: id => window.document.getElementById(id) };
}

test('P&L and legacy operational links open their requested workspace; explicit mode wins', t => {
    const f = fixture(t, '?tab=pnl');
    assert.equal(f.api.getInitialFinanceMode(), 'operations');
    assert.equal(f.api.getInitialFinanceTab(), 'pnl');
    for (const tab of ['cash', 'salary', 'budget', 'forecast', 'advanced', 'transactions']) {
        f.window.history.replaceState(null, '', `/finance?tab=${tab}`);
        assert.equal(f.api.getInitialFinanceMode(), 'operations', tab);
    }
    f.window.history.replaceState(null, '', '/finance?mode=insights&tab=pnl');
    assert.equal(f.api.getInitialFinanceMode(), 'insights');
    f.window.history.replaceState(null, '', '/finance?tab=unknown');
    assert.equal(f.api.getInitialFinanceMode(), 'overview');
});

test('overview and insights expose one labelled shared date range; monthly workspaces keep their own scope', async t => {
    const f = fixture(t);
    f.el('dateFromFilter').value = '2026-09-01';
    f.el('dateToFilter').value = '2026-09-30';
    assert.equal(f.window.document.querySelectorAll('#dateFromFilter').length, 1);
    assert.equal(f.el('dateFromFilter').labels[0].textContent.trim(), 'Від');
    f.api.setFinanceMode('overview');
    assert.notEqual(f.el('financePeriodControls').style.display, 'none');
    f.api.setFinanceMode('insights');
    assert.notEqual(f.el('financePeriodControls').style.display, 'none');
    f.api.setFinanceMode('operations', { switchTab: false });
    f.api.FinState.currentTab = 'pnl';
    f.api.setFinanceMode('operations', { switchTab: false });
    assert.equal(f.el('financePeriodControls').style.display, 'none');
    f.api.switchTab('transactions');
    assert.notEqual(f.el('financePeriodControls').style.display, 'none');
    assert.equal(f.el('dateFromFilter').value, '2026-09-01');
    assert.equal(f.el('dateToFilter').value, '2026-09-30');
    await new Promise(resolve => setImmediate(resolve));
});

test('forecast renders a serialized PostgreSQL week date and arithmetic without timestamp fragments', async t => {
    const f = fixture(t);
    f.transport(async () => ({ ok: true, json: async () => ({
        totals: { expectedRevenue: 8700, bookingCount: 5 },
        weekly: [{ week_start: '2026-09-28T00:00:00.000Z', booking_count: 5, expected_revenue: 8700 }],
        historicalAverage: []
    }) }));
    await f.api.loadForecast();
    assert.equal(f.el('forecastContent').querySelector('tbody td').textContent.trim(), '28.09.2026');
    assert.doesNotMatch(f.el('forecastContent').textContent, /T00:00/);
    assert.match(f.el('forecastContent').textContent.replace(/\s/g, ''), /1740₴/);
    assert.equal(f.api.formatDate('2026-09-28'), '28.09.2026');
    assert.equal(f.api.formatDate(null), '—');
});

test('failed financial panel clears stale data, reports unavailability, and retries using GET only', async t => {
    const f = fixture(t);
    let attempts = 0;
    f.el('advancedContent').textContent = 'stale 999999';
    f.transport(async () => {
        attempts++;
        if (attempts === 1) return { ok: false, status: 500, json: async () => ({ error: 'synthetic failure' }) };
        return { ok: true, json: async () => ({ metrics: {
            monthIncome: 11600, monthExpense: 0, monthProfit: 11600,
            avgBookingPrice: 1933, bookingsCount: 6, margin: 100
        } }) };
    });
    f.window.console.error = () => {};
    await f.api.loadAdvancedDashboard();
    assert.match(f.el('advancedContent').querySelector('[role=alert]').textContent, /Дані недоступні/);
    assert.doesNotMatch(f.el('advancedContent').textContent, /999999/);
    f.el('advancedContent').querySelector('button').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 2);
    assert.equal(f.el('advancedContent').querySelector('[role=alert]'), null);
    assert.match(f.el('advancedContent').textContent.replace(/\s/g, ''), /11600₴/);
    assert.ok(f.requests.every(request => request.method === 'GET'));
});
