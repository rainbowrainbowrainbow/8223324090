'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');

function fixture(t) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'finance.html'), 'utf8'), {
        url: 'http://localhost/finance', runScripts: 'outside-only', virtualConsole: new VirtualConsole()
    });
    t.after(() => dom.window.close());
    const w = dom.window;
    const addEventListener = w.document.addEventListener.bind(w.document);
    w.document.addEventListener = (name, ...args) => { if (name !== 'DOMContentLoaded') addEventListener(name, ...args); };
    let business = 'event_genix';
    let transport = async () => { throw new Error('Synthetic transport unavailable'); };
    w.AppState = { currentUser: { id: 1 } };
    w.getCrmBusinessContext = () => business;
    w.getCrmBusinessScope = () => null;
    w.getAuthHeaders = () => ({});
    w.handleAuthError = () => false;
    w.apiFetchWithAuthRetry = async url => ({ ok: true, status: 200, json: async () => transport(url) });
    w.eval(fs.readFileSync(path.join(root, 'js/finance-page.js'), 'utf8'));
    return { w, el: id => w.document.getElementById(id), business: value => { business = value; },
        transport: callback => { transport = callback; } };
}

const forecast = () => ({
    period: { from: '2026-10-08', to: '2026-11-06', days: 30 },
    totals: { expectedRevenue: 3000, expectedOutstanding: 1600, recordedPaid: 1600, bookingCount: 3, unpaidBookingCount: 2 },
    weekly: [{ week_start: '2026-10-05', booking_count: 3, expected_revenue: 3000, expected_outstanding: 1600 }],
    historicalAverage: [{ dow: 1, avg_revenue: 100, avg_count: 0.08 }]
});
const pnl = () => ({
    period: { from: '2026-10-01', to: '2026-10-31' },
    previousPeriod: { from: '2026-09-01', to: '2026-09-30' },
    summary: { totalIncome: 600, totalExpenses: 115, grossProfit: 485, margin: 81,
        incomeChange: 0, expenseChange: 0, previousIncome: 0, previousExpenses: 0, previousProfit: 0 },
    bookingRevenue: 795, revenue: [], expenses: []
});
const contextEvents = ['crmBusinessContextChanged', 'crmBusinessScopeChanged', 'crmBusinessContextHydrated',
    'crmBusinessProfileChanged', 'permissions:lifecycle', 'workingRoleChanged', 'rolePreviewChanged'];

test('currency modal uses the shared NBU endpoint and preserves the source calendar date', async t => {
    const f = fixture(t);
    f.transport(async url => {
        assert.equal(url, '/api/dashboard/widgets/currency');
        return { base: 'UAH', rates: { USD: 42.1234, EUR: null, GBP: -1 }, date: '08.10.2026' };
    });
    await f.w.loadCurrencyRatesModal();
    assert.equal(f.el('currencyRatesGrid').querySelectorAll('.currency-rate-card').length, 1);
    assert.match(f.el('currencyRatesGrid').textContent, /USD/);
    assert.match(f.el('currencyRatesMeta').textContent, /НБУ.*08\.10\.2026/);
});

test('currency modal clears old values when the shared source returns an error', async t => {
    const f = fixture(t);
    f.transport(async () => ({ rates: { USD: 42.1234 }, date: '08.10.2026' }));
    await f.w.loadCurrencyRatesModal();
    f.transport(async () => ({ error: 'Currency API unavailable' }));
    await f.w.loadCurrencyRatesModal();
    assert.equal(f.el('currencyRatesGrid').querySelectorAll('.currency-rate-card').length, 0);
    assert.match(f.el('currencyRatesGrid').textContent, /недоступні/);
});

test('currency lifecycle invalidation clears existing rates without fetching or closing the modal', async t => {
    const f = fixture(t);
    let requests = 0;
    f.transport(async () => { requests++; return { rates: { USD: 42.1234 }, date: '08.10.2026' }; });
    f.el('currencyRatesModal').classList.remove('hidden');
    for (const eventName of contextEvents) {
        await f.w.loadCurrencyRatesModal();
        assert.equal(f.el('currencyRatesGrid').querySelectorAll('.currency-rate-card').length, 1);
        const before = requests;
        f.w.dispatchEvent(new f.w.Event(eventName));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(requests, before, eventName + ' must not fetch after access changes');
        assert.equal(f.el('currencyRatesGrid').querySelectorAll('.currency-rate-card').length, 0);
        assert.ok(f.el('currencyRatesGrid').querySelector('[role="status"]'));
        assert.match(f.el('currencyRatesMeta').textContent, /оновлення/);
        assert.equal(f.el('currencyRatesModal').classList.contains('hidden'), false);
        assert.ok(f.el('refreshCurrencyRatesBtn'), 'existing explicit refresh control remains available');
    }
});

test('currency ignores an in-flight response after same-actor permissions change', async t => {
    const f = fixture(t);
    let release;
    f.transport(() => new Promise(resolve => { release = resolve; }));
    const pending = f.w.loadCurrencyRatesModal();
    await new Promise(resolve => setImmediate(resolve));
    f.w.dispatchEvent(new f.w.Event('permissions:lifecycle'));
    release({ rates: { USD: 42.1234 }, date: '08.10.2026' });
    await pending;
    assert.equal(f.el('currencyRatesGrid').querySelectorAll('.currency-rate-card').length, 0);
    assert.ok(f.el('currencyRatesGrid').querySelector('[role="status"]'));
});

test('sidebar currency failure cannot substitute hardcoded finance-converter rates', async () => {
    const source = fs.readFileSync(path.join(root, 'js/components/sidebar.js'), 'utf8');
    const functions = source.slice(source.indexOf('    function _normalizeSidebarCurrencyRates('), source.indexOf('    function _ensureSidebarIdentityMeta('));
    let fallbackCalls = 0;
    const values = [];
    const context = vm.createContext({
        _state: { identityMetaDetails: {} },
        _isAuthenticatedSidebarRuntimeReady: () => true,
        _isSidebarCurrencySignalEnabled: () => true,
        _fetchSidebarWidget: async () => ({ error: 'Synthetic source failure' }),
        _fetchSidebarCurrencyFallback: async () => { fallbackCalls++; return { rates: { USD: 41.2 } }; },
        _setSidebarIdentityMetaValue: (...args) => values.push(args),
        _formatSidebarMoney: value => value > 0 ? String(value) : 'н/д',
        _getCurrentSidebarUser: () => ({ role: 'creator' }),
        _getSidebarActiveRole: () => 'creator',
        window: { canUseAction: () => true }, hasAccess: () => true,
        _businessAllowsSidebarItem: () => true, _isNavItemVisible: () => true
    });
    vm.runInContext(functions, context);
    await vm.runInContext('_loadSidebarIdentityMeta(true)', context);
    assert.equal(fallbackCalls, 0);
    assert.equal(values.at(-1)[1], 'н/д');
    assert.equal(values.at(-1)[2], 'limited');
});

test('forecast distinguishes unpaid balance, booking value and historical booking pattern', async t => {
    const f = fixture(t);
    f.transport(async () => forecast());
    await f.w.loadForecast();
    const text = f.el('forecastContent').textContent;
    assert.match(text, /Залишок до сплати/);
    assert.match(text, /Вартість підтверджених бронювань/);
    assert.match(text, /08\.10\.2026.*06\.11\.2026/s);
    assert.match(text, /не є.*датою оплати/s);
    assert.match(text, /дні без бронювань/s);
    assert.doesNotMatch(text, /Середній дохід|Середній чек/);
});

test('forecast never relabels the old full-price API field as an unpaid balance', async t => {
    const f = fixture(t);
    const data = forecast();
    delete data.totals.expectedOutstanding;
    f.transport(async () => data);
    await f.w.loadForecast();
    assert.ok(f.el('forecastContent').querySelector('[role="alert"]'));
    assert.doesNotMatch(f.el('forecastContent').textContent, /3\s*000/);
});

test('P&L explains journal arithmetic and keeps booking prices separate from profit', async t => {
    const f = fixture(t);
    f.transport(async () => pnl());
    await f.w.loadPnlReport();
    const text = f.el('pnlContent').textContent;
    assert.match(text, /Результат за обліком/);
    assert.match(text, /600 ₴.*115 ₴.*485 ₴/s);
    assert.match(text, /дата визнання/);
    assert.match(text, /Вартість підтверджених бронювань/);
    assert.match(text, /01\.09\.2026.*30\.09\.2026/s);
    assert.match(text, /не є боргом/);
    assert.doesNotMatch(text, /Чистий прибуток|Виручка з бронювань/);
});

for (const [method, id, data] of [['loadForecast', 'forecastContent', forecast], ['loadPnlReport', 'pnlContent', pnl]]) {
    test(`${method} clears rendered values on each context event and refreshes only on explicit request`, async t => {
        const f = fixture(t);
        let requests = 0;
        f.transport(async () => { requests++; return data(); });
        for (const eventName of contextEvents) {
            await f.w[method]();
            assert.match(f.el(id).textContent, /485 ₴|1\s*600 ₴/);
            const before = requests;
            f.w.dispatchEvent(new f.w.Event(eventName));
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(requests, before, eventName + ' must not fetch after access changes');
            assert.doesNotMatch(f.el(id).textContent, /485 ₴|1\s*600 ₴/);
            assert.ok(f.el(id).querySelector('[role="status"]'));
            assert.equal(f.el(id).querySelector('[role="alert"]'), null);
            f.el(id).querySelector('button').click();
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(requests, before + 1);
            assert.match(f.el(id).textContent, /485 ₴|1\s*600 ₴/);
        }
    });

    test(`${method} ignores in-flight responses after same-actor permissions change`, async t => {
        const f = fixture(t);
        let release;
        f.transport(() => new Promise(resolve => { release = resolve; }));
        const pending = f.w[method]();
        await new Promise(resolve => setImmediate(resolve));
        f.w.dispatchEvent(new f.w.Event('permissions:lifecycle'));
        release(data());
        await pending;
        assert.doesNotMatch(f.el(id).textContent, /485 ₴|1\s*600 ₴/);
        assert.ok(f.el(id).querySelector('[role="status"]'));
    });

    test(`${method} clears stale values on failure and offers a working retry`, async t => {
        const f = fixture(t);
        f.transport(async () => data());
        await f.w[method]();
        f.transport(async () => { throw new Error('Synthetic failure'); });
        await f.w[method]();
        assert.ok(f.el(id).querySelector('[role="alert"]'));
        assert.doesNotMatch(f.el(id).textContent, /485 ₴|1\s*600 ₴/);
        f.transport(async () => data());
        f.el(id).querySelector('button').click();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.el(id).querySelector('[role="alert"]'), null);
    });

    test(`${method} ignores late responses after actor/business changes`, async t => {
        const f = fixture(t);
        let release;
        f.transport(() => new Promise(resolve => { release = resolve; }));
        const pending = f.w[method]();
        await new Promise(resolve => setImmediate(resolve));
        f.business('dar');
        f.w.AppState.currentUser.id = 2;
        release(data());
        await pending;
        assert.doesNotMatch(f.el(id).textContent, /485 ₴|1\s*600 ₴/);
    });

    test(`${method} keeps the newest request when responses arrive out of order`, async t => {
        const f = fixture(t);
        let release;
        f.transport(() => new Promise(resolve => { release = resolve; }));
        const pending = f.w[method]();
        await new Promise(resolve => setImmediate(resolve));
        f.transport(async () => { throw new Error('Newest query failed'); });
        await f.w[method]();
        release(data());
        await pending;
        assert.ok(f.el(id).querySelector('[role="alert"]'));
    });
}
