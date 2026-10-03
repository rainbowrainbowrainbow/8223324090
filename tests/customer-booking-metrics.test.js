'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const metrics = require('../services/customerBookingMetrics');
const { redactRevenueFieldKeys } = require('../services/revenueAccessPolicy');

test('empty current history cannot revive stale cached counts, money, or dates', () => {
    const actual = metrics.mapCustomerBookingMetrics({
        total_bookings: 99, total_spent: 99999, first_visit: '2020-01-01', last_visit: '2030-01-01'
    });
    assert.equal(actual.totalBookings, 0);
    assert.equal(actual.totalSpent, 0);
    assert.equal(actual.firstVisit, null);
    assert.equal(actual.lastVisit, null);
    assert.equal(actual.nextBookingDate, null);
    assert.equal(actual.plannedBookings, 0);
});

test('live metrics preserve decimal prices and separate past and planned dates', () => {
    const result = metrics.mapCustomerBookingMetrics({
        real_total_bookings: '3', real_total_spent: '1700.25', past_bookings: '1',
        planned_bookings: '2', real_first_visit: '2026-09-01', real_last_visit: '2026-09-01',
        next_booking_date: '2026-10-03', metrics_as_of: '2026-10-03'
    });
    assert.equal(result.totalSpent, 1700.25);
    assert.equal(result.totalBookings, result.pastBookings + result.plannedBookings);
    assert.equal(result.lastVisit, '2026-09-01');
    assert.equal(result.nextBookingDate, '2026-10-03');
    const hidden = redactRevenueFieldKeys(result);
    assert.equal(hidden.totalSpent, undefined);
    assert.equal(hidden.totalBookings, 3);
    assert.equal(result.totalSpent, 1700.25, 'redaction does not mutate data');
});

test('business date follows Kyiv midnight and daylight saving boundaries', () => {
    for (const [instant, date] of [
        ['2026-10-02T20:59:59Z', '2026-10-02'],
        ['2026-10-02T21:00:00Z', '2026-10-03'],
        ['2026-01-01T21:59:59Z', '2026-01-01'],
        ['2026-01-01T22:00:00Z', '2026-01-02'],
        ['2026-10-25T01:30:00Z', '2026-10-25']
    ]) assert.equal(metrics.customerMetricsDate(new Date(instant)), date);
});

test('RFM excludes empty, today-only, future-only and preliminary-only histories from percentiles', () => {
    const valid = [
        { id: 1, frequency: 1, monetary: 400, recencyDays: 1 },
        { id: 2, frequency: 5, monetary: 5000, recencyDays: 90 }
    ];
    const excluded = [
        { id: 3, frequency: 0, monetary: 0, recencyDays: null },
        { id: 4, frequency: 0, monetary: 0, recencyDays: -1 },
        { id: 5, frequency: 1, monetary: 300, recencyDays: 0 }
    ];
    const alone = metrics.calculateRFMScores(valid);
    const together = metrics.calculateRFMScores([...valid, ...excluded]);
    assert.deepEqual(together.slice(0, 2), alone);
    for (const c of together.slice(2)) {
        assert.equal(c.rfmSegment, 'no_history');
        assert.equal(c.rfmScore, null);
        assert.equal(c.rScore, null);
    }
});

test('batch metrics read binds business and IDs and performs no writes', async () => {
    const calls = [];
    const queryable = { query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ customer_id: 7, real_total_bookings: '1' }] };
    } };
    assert.equal((await metrics.loadCustomerBookingMetricRows(queryable, [], { role: 'creator' }, 'event_genix')).size, 0);
    const rows = await metrics.loadCustomerBookingMetricRows(queryable, [7, 8], { id: 1, role: 'creator' }, 'event_genix');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params.at(-1), [7, 8]);
    assert.ok(calls[0].params.includes('event_genix'));
    assert.match(calls[0].sql, /ANY\(\$\d+::int\[\]\)/);
    assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE|c\.total_bookings/);
    assert.equal(rows.get(7).real_total_bookings, '1');
    assert.equal(rows.has(8), false);
});

test('SQL normalizes legacy text dates for comparisons, extrema and RFM subtraction', () => {
    const params = [];
    const { sql } = metrics.buildScopedBookingAggregateSql({ role: 'creator' }, params, 'b', 'event_genix', { asOf: '2026-10-03' });
    const date = "NULLIF(BTRIM(b.date::text), '')::date";
    assert.ok(sql.includes(date + ' < '));
    assert.ok(sql.includes(date + ' >= '));
    assert.ok(sql.includes(date + ' IS NULL'));
    assert.ok(sql.includes('MIN(' + date + ')'));
    assert.ok(sql.includes('MAX(' + date + ')'));
    assert.doesNotMatch(sql, /b\.date\s*(?:<|>=)|(?:MIN|MAX)\(b\.date\)/);
});

test('denied revenue capability keeps count/date SQL without reading booking prices', () => {
    const params = [];
    const { sql } = metrics.buildScopedBookingAggregateSql({
        role: 'creator', action_denylist: ['view_revenue']
    }, params, 'b', 'event_genix', { asOf: '2026-10-03' });
    assert.doesNotMatch(sql, /b\.price/);
    assert.match(sql, /COUNT\(\*\) AS booking_count/);
    assert.match(sql, /AS real_last_visit/);
});

function routeHarness(rows = []) {
    const source = fs.readFileSync(path.join(__dirname, '../routes/customers.js'), 'utf8');
    const handlers = new Map();
    const calls = [];
    const context = vm.createContext({
        ...metrics, scopedBookingAggregateSql: metrics.buildScopedBookingAggregateSql,
        ...require('../services/customerBirthdaySegments'),
        getCustomerOmniSummaries: async () => new Map(),
        DEFAULT_BUSINESS_CONTEXT: 'event_genix',
        pool: { query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: /^\s*SELECT COUNT\(\*\)/.test(sql) ? [{ count: String(rows.length) }] : rows };
        } },
        router: { get: (route, ...callbacks) => handlers.set(route, callbacks.at(-1)) },
        log: { error: () => {}, warn: () => {} }, requireAction: () => () => {},
        ensureBusinessContext: () => 'event_genix', ensureBusinessScope: () => 'event_genix',
        canUseAction: () => true,
        customerContextCondition: (params, scope, alias) => require('../services/businessContext').pushBusinessContextCondition(params, scope, alias),
        customerScopeCondition: (params, scope, alias) => require('../services/businessContext').pushBusinessScopeCondition(params, scope, alias),
        normalizeSocialIdentities: () => [], normalizeCustomerSource: value => value || 'unknown',
        getCustomerSourceLabel: value => value || 'unknown',
        loadCustomerChildrenMap: async () => new Map(),
        applyCustomerChildrenProjection: c => c
    });
    function extract(start, end) {
        const a = source.indexOf(start);
        const b = source.indexOf(end, a);
        assert.ok(a >= 0 && b > a, 'route source markers exist');
        return source.slice(a, b);
    }
    vm.runInContext([
        extract('function parseCustomerVisitBound(', 'let customerSocialIdentitiesColumnReady'),
        extract('function mapCustomerRow(', 'function escapeCsv('),
        extract("router.get('/rfm'", "router.get('/segments'"),
        extract("router.get('/ltv'", "router.get('/nps-stats'"),
        extract("router.get('/',", 'function mapCompactBookingLeadContext(')
    ].join('\n'), context);
    async function request(route, query = {}) {
        let status = 200;
        let body;
        const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
        await handlers.get(route)({ query, user: { id: 1, role: 'creator' }, method: 'GET' }, res);
        return { status, body };
    }
    return { request, calls, context };
}

test('list handler aligns display, count/date filters and sorting to live aggregate', async () => {
    const h = routeHarness([{ id: 1, name: 'Empty', total_bookings: 99, total_spent: 99999, last_visit: '2030-01-01' }]);
    const result = await h.request('/', { dateFrom: '2026-09-01', dateTo: '2026-10-02', maxVisits: '0', sortBy: 'last_visit' });
    assert.equal(result.status, 200);
    assert.equal(result.body.customers[0].totalBookings, 0);
    assert.equal(result.body.customers[0].lastVisit, null);
    assert.equal(result.body.customers[0].ltv, undefined);
    const sql = h.calls[1].sql;
    assert.match(sql, /b_agg\.real_last_visit >= \$\d+::date/);
    assert.match(sql, /b_agg\.real_last_visit <= \$\d+::date/);
    assert.match(sql, /COALESCE\(b_agg\.booking_count, 0\) <=/);
    assert.match(sql, /ORDER BY b_agg\.real_last_visit DESC NULLS LAST, c\.id ASC/);
    assert.doesNotMatch(sql, /c\.last_visit|c\.total_bookings/);
    h.calls.length = 0;
    assert.equal((await h.request('/', { sortBy: 'next_booking' })).status, 200);
    assert.match(h.calls[1].sql, /ORDER BY b_agg\.next_booking_date ASC NULLS LAST, c\.id ASC/);
});

test('RFM handler uses confirmed-history aliases rather than overall booking counts', async () => {
    const h = routeHarness([{ id: 1, name: 'Future', real_total_bookings: '5', real_total_spent: '4000',
        planned_bookings: '5', rfm_frequency: '0', rfm_monetary: '0', recency_days: null }]);
    const { status, body } = await h.request('/rfm');
    assert.equal(status, 200);
    assert.equal(body.customers[0].totalBookings, 5);
    assert.equal(body.customers[0].frequency, 0);
    assert.equal(body.customers[0].rfmSegment, 'no_history');
    assert.equal(body.segments.noHistory, 1);
    assert.equal(body.segments.lost, 0);
});

test('retired LTV endpoint and sort reject explicitly without querying database', async () => {
    const h = routeHarness();
    assert.equal((await h.request('/ltv')).status, 410);
    assert.equal((await h.request('/', { sortBy: 'ltv' })).status, 400);
    assert.equal(h.calls.length, 0);
});

test('list database failure returns an error rather than a successful zero history', async () => {
    const h = routeHarness();
    h.context.pool.query = async () => { throw new Error('Fixture database unavailable'); };
    const result = await h.request('/');
    assert.equal(result.status, 500);
    assert.equal(result.body.customers, undefined);
});

function frontendHarness() {
    const source = fs.readFileSync(path.join(__dirname, '../js/customers-page.js'), 'utf8');
    const dom = new JSDOM('<table><tbody id="customerTableBody"></tbody></table><div id="rfmOverview"></div><table><tbody id="rfmTableBody"></tbody></table>', { runScripts: 'outside-only' });
    const context = dom.getInternalVMContext();
    Object.assign(context, {
        CrmState: { customers: [], rfmData: null },
        isMaysternyaCustomerContext: () => false, canViewCustomerRevenue: () => true,
        syncCustomerPresentationUi: () => {}, renderCustomerExplainability: () => {}, renderCustomerFilterControls: () => {},
        getCustomerSourceBadgeKey: () => 'phone', getCustomerSourceLabel: () => 'Телефон',
        renderCustomerTagPill: () => '', customerChildrenInlineLabel: () => '',
        escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        formatMoney: value => String(value) + ' грн',
        formatDateOnly: value => value || '—', dateInputValue: value => String(value || '').slice(0, 10),
        showCustomerDetail: () => {}, customerBookingDateTimeText: b => b.date || '',
        customerBookingStatusLabel: s => s,
        customerPipelineStageMeta: () => ({ cls: '', label: 'Без ліда' }),
        customerHeaderOmniTarget: () => ({}), customerInitials: () => 'Т',
        renderSocialIdentities: () => '—', renderCustomerOmniNavigation: () => '',
        canManageCustomerActions: () => false
    });
    const segmentsStart = source.indexOf('const RFM_SEGMENTS =');
    const segmentsEnd = source.indexOf('\n};', segmentsStart) + 3;
    function extract(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
    vm.runInContext([
        source.slice(segmentsStart, segmentsEnd),
        extract('function renderCustomerTable()', 'function renderPagination()'),
        extract('function renderRFM()', 'async function showCustomerDetail('),
        extract('function pickCustomerHeaderBooking(', 'function customerBookingStatusLabel('),
        extract('function customerHeaderBookingDetails(', 'function customerContextualizeHref('),
        extract('function renderCustomerDetailHero(', 'function customerHubDialogTarget('),
        'this.hooks = { renderCustomerTable, renderRFM, customerBookingHistoryHtml, pickCustomerHeaderBooking, renderCustomerDetailHero };'
    ].join('\n'), context);
    return { dom, context, hooks: context.hooks };
}

test('list renders separate dates and counts without stale LTV badges', () => {
    const { dom, context, hooks } = frontendHarness();
    context.CrmState.customers = [{
        id: 1, name: 'Fixture', totalBookings: 3, totalSpent: 1700.25,
        pastBookings: 1, plannedBookings: 2, lastVisit: '2026-09-01',
        nextBookingDate: '2026-10-03', ltv: 99999
    }];
    hooks.renderCustomerTable();
    const text = dom.window.document.getElementById('customerTableBody').textContent;
    assert.match(text, /Минулих: 1 · Запланованих: 2/);
    assert.match(text, /Найближче: 2026-10-03/);
    assert.doesNotMatch(text, /LTV|99999|🔥/);
    assert.match(text, /1700.25 грн/);
    dom.window.close();
});

test('RFM presents no-history separately with empty scores and correct champion totals', () => {
    const { dom, context, hooks } = frontendHarness();
    context.CrmState.rfmData = {
        segments: { champions: 2, noHistory: 3, lost: 0 },
        customers: metrics.calculateRFMScores([{ id: 1, name: 'Empty', frequency: 0, monetary: 0, recencyDays: null }])
    };
    hooks.renderRFM();
    const cards = [...dom.window.document.querySelectorAll('.rfm-segment-card')];
    assert.equal(cards.find(c => c.textContent.includes('Чемпіони')).querySelector('.rfm-count').textContent, '2');
    assert.equal(cards.find(c => c.textContent.includes('Без підтвердженої')).querySelector('.rfm-count').textContent, '3');
    const text = dom.window.document.getElementById('rfmTableBody').textContent;
    assert.match(text, /Без підтвердженої минулої історії/);
    assert.doesNotMatch(text, /null|undefined|Втрачені|-1 дн/);
    dom.window.close();
});

test('detail groups today as planned and keeps cancelled records visible', () => {
    const { dom, hooks } = frontendHarness();
    const bookings = [
        { id: 'past', date: '2026-10-02', status: 'preliminary', price: 100 },
        { id: 'today', date: '2026-10-03', status: 'confirmed', price: 300 },
        { id: 'later', date: '2026-10-04', status: 'confirmed', price: 500 },
        { id: 'cancel', date: '2026-10-01', status: 'cancelled', price: 700 },
        { id: 'undated', date: null, status: 'confirmed', price: null }
    ];
    const html = hooks.customerBookingHistoryHtml({ bookings, metricsAsOf: '2026-10-03' }, true);
    assert.match(html, /Заплановані \(сьогодні й пізніше\) \(2\)/);
    assert.match(html, /Минулі за датою \(1\)/);
    assert.match(html, /Скасовані \(1\)/);
    assert.match(html, /Без дати \(1\)/);
    assert.equal(hooks.pickCustomerHeaderBooking(bookings, '2026-10-03').id, 'today');
    assert.doesNotMatch(hooks.customerBookingHistoryHtml({ bookings, metricsAsOf: '2026-10-03' }, false), /грн/);
    dom.window.close();
});

test('nearest date outside the history window cannot be replaced with a later booking', () => {
    const { dom, hooks } = frontendHarness();
    const bookings = [{ id: 'later', date: '2027-01-01', status: 'confirmed', price: 100 }];
    assert.equal(hooks.pickCustomerHeaderBooking(bookings, '2026-10-03', '2026-10-04'), null);
    const html = hooks.renderCustomerDetailHero({
        name: 'Fixture', bookings, metricsAsOf: '2026-10-03', nextBookingDate: '2026-10-04'
    });
    assert.match(html, /2026-10-04/);
    assert.match(html, /Деталі поза останніми 50 записами історії/);
    assert.doesNotMatch(html, /2027-01-01/);
    dom.window.close();
});
