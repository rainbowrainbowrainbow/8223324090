'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { shiftCalendarDate } = require('../../utils/financeReporting');

// These are actual finance GET handlers and SQL executed against session-local
// PostgreSQL tables. Existing application records and permissions stay untouched.
function fixture(client) {
    const filename = path.join(__dirname, '../../routes/finance.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    let queries = 0;
    const pool = { query(sql, params) { queries++; return client.query(sql, params); } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
        require(id) { return id === '../db' ? { pool } : realRequire(id); },
        console, process, Buffer, Date, setTimeout, clearTimeout
    }, { filename });
    return { queryCount: () => queries, async get(route, query = {}, context = 'event_genix') {
        const handler = module.exports.stack.find(layer => layer.route?.path === route && layer.route.methods.get);
        assert.ok(handler, `GET ${route} exists`);
        let body;
        let status = 200;
        const res = { locals: {}, status(code) { status = code; return this; }, json(value) { body = value; return this; } };
        const user = { id: 1, username: 'finance_reporting_fixture', role: 'creator',
            business_contexts: ['event_genix', 'dar'], default_business_context: context };
        await handler.route.stack.at(-1).handle({ user, query, headers: { 'x-business-context': context }, method: 'GET' }, res);
        return { status, body: JSON.parse(JSON.stringify(body)) };
    } };
}

test('finance reporting executes scoped forecast, allocation and P&L SQL in disposable PostgreSQL', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 60000
}, async t => {
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
    assert.equal(database.isLocal, true);
    const client = new Client({ connectionString: database.url.toString(), ssl: false });
    await client.connect();
    try {
        await client.query(`CREATE TEMP TABLE bookings (
            id text PRIMARY KEY, date varchar(10), price integer, paid_amount integer,
            payment_status text, status text, linked_to text, business_context text
        );
        CREATE TEMP TABLE trusted_qa_run_entities (run_id bigint, entity_type text, entity_id text, cleanup_state text);
        CREATE TEMP TABLE finance_money_qa_runs (run_id bigint);
        CREATE TEMP TABLE trusted_qa_runs (id bigint, state text, expires_at timestamptz);
        CREATE TEMP TABLE finance_categories (id integer PRIMARY KEY, name text, icon text, color text,
            type text, is_active boolean, business_context text, finance_qa_run_id bigint);
        CREATE TEMP TABLE finance_transactions (id serial PRIMARY KEY, type text, amount integer,
            date varchar(10), recognition_date date, category_id integer, business_context text);`);
        const route = fixture(client);
        const initial = await route.get('/forecast', { days: '7' });
        assert.equal(initial.status, 200, JSON.stringify(initial.body));
        const { from: today, to: lastDay } = initial.body.period;
        const { from: historyStart, to: yesterday } = initial.body.historicalPeriod;

        await t.test('empty forecast exposes seven days and bounded horizon validation does not query the database', async () => {
            assert.equal(initial.body.daily.length, 7);
            assert.equal(initial.body.daily[0].date, today);
            assert.equal(initial.body.daily.at(-1).date, shiftCalendarDate(today, 6));
            assert.deepEqual(initial.body.totals, { expectedRevenue: 0, expectedOutstanding: 0,
                recordedPaid: 0, bookingCount: 0, unpaidBookingCount: 0 });
            assert.equal(initial.body.historicalAverage.length, 7);
            assert.equal(initial.body.historicalAverage.reduce((sum, row) => sum + row.calendar_day_count, 0), 90);
            const count = route.queryCount();
            for (const days of ['6', '91', '0', '-1', '7abc', '7.5', '', ['7'], {}]) {
                const invalid = await route.get('/forecast', { days });
                assert.equal(invalid.status, 400);
                assert.equal(invalid.body.code, 'finance_forecast_days_invalid');
            }
            assert.equal(route.queryCount(), count);
        });

        await client.query(`INSERT INTO bookings VALUES
            ('unpaid',$1,1000,NULL,NULL,'confirmed',NULL,'event_genix'),
            ('partial',$1,1000,400,'partial','confirmed',NULL,'event_genix'),
            ('overpaid',$1,1000,1200,'partial','confirmed',NULL,'event_genix'),
            ('status-paid',$1,500,NULL,'paid','confirmed',NULL,'event_genix'),
            ('zero',$1,0,0,NULL,'confirmed',NULL,'event_genix'),
            ('last-day',$2,700,100,'partial','confirmed',NULL,'event_genix'),
            ('outside-horizon',$3,9999,0,NULL,'confirmed',NULL,'event_genix'),
            ('foreign',$1,8888,0,NULL,'confirmed',NULL,'dar'),
            ('linked',$1,9999,0,NULL,'confirmed','unpaid','event_genix'),
            ('cancelled',$1,9999,0,NULL,'cancelled',NULL,'event_genix'),
            ('preliminary',$1,9999,0,NULL,'preliminary',NULL,'event_genix'),
            ('qa-active',$1,9999,0,NULL,'confirmed',NULL,'event_genix'),
            ('qa-expired',$1,9999,0,NULL,'confirmed',NULL,'event_genix'),
            ('qa-cleaned',$1,9999,0,NULL,'confirmed',NULL,'event_genix');
        `, [today, lastDay, shiftCalendarDate(lastDay, 1)]);
        await client.query(`INSERT INTO finance_money_qa_runs VALUES (1),(2),(3),(4);
            INSERT INTO trusted_qa_run_entities VALUES
                (1,'booking','qa-active','active'),(2,'booking','qa-expired','active'),
                (3,'booking','qa-cleaned','cleaned'),(4,'booking','qa-history','cleaned');
            INSERT INTO trusted_qa_runs VALUES
                (1,'active',NOW()+INTERVAL '15 minutes'),(2,'active',NOW()-INTERVAL '1 hour'),
                (3,'cleaned',NOW()-INTERVAL '1 day'),(4,'cleaned',NOW()-INTERVAL '1 day');`);

        await t.test('forecast keeps booking value separate from unpaid balances and excludes foreign, linked, cancelled and durable QA bookings', async () => {
            const { status, body } = await route.get('/forecast', { days: '7' });
            assert.equal(status, 200);
            assert.deepEqual(body.totals, { expectedRevenue: 4200, expectedOutstanding: 2200,
                recordedPaid: 1700, bookingCount: 6, unpaidBookingCount: 3 });
            assert.equal(body.daily[0].expected_revenue, 3500);
            assert.equal(body.daily[0].expected_outstanding, 1600);
            assert.equal(body.daily.at(-1).expected_outstanding, 600);
            assert.ok(body.daily.slice(1, -1).every(row => row.expected_revenue === 0));
            for (const [field, expected] of [['expected_revenue', 4200], ['expected_outstanding', 2200],
                ['recorded_paid', 1700], ['booking_count', 6], ['unpaid_booking_count', 3]]) {
                assert.equal(body.weekly.reduce((sum, row) => sum + row[field], 0), expected, field);
            }
            assert.equal(body.basis.expectedOutstanding, 'legacy_booking_balance');
            const foreign = await route.get('/forecast', { days: '7' }, 'dar');
            assert.equal(foreign.status, 200);
            assert.equal(foreign.body.totals.expectedRevenue, 8888);
            assert.equal(foreign.body.totals.bookingCount, 1);
        });

        await client.query(`INSERT INTO bookings VALUES
            ('history-start',$1,1300,1300,'paid','confirmed',NULL,'event_genix'),
            ('history-last',$2,500,0,NULL,'confirmed',NULL,'event_genix'),
            ('history-too-old',$3,9999,0,NULL,'confirmed',NULL,'event_genix'),
            ('history-linked',$1,9999,0,NULL,'confirmed','history-start','event_genix'),
            ('history-cancelled',$1,9999,0,NULL,'cancelled',NULL,'event_genix'),
            ('history-foreign',$1,9999,0,NULL,'confirmed',NULL,'dar'),
            ('qa-history',$1,9999,0,NULL,'confirmed',NULL,'event_genix');`,
        [historyStart, yesterday, shiftCalendarDate(historyStart, -1)]);
        await t.test('history uses exactly 90 prior calendar days with zeros and the same ownership exclusions', async () => {
            const { status, body } = await route.get('/forecast', { days: '7' });
            assert.equal(status, 200);
            const startDow = new Date(`${historyStart}T00:00:00Z`).getUTCDay();
            const lastDow = new Date(`${yesterday}T00:00:00Z`).getUTCDay();
            assert.equal(body.historicalAverage.reduce((sum, row) => sum + row.calendar_day_count, 0), 90);
            for (const row of body.historicalAverage) {
                const revenue = (row.dow === startDow ? 1300 : 0) + (row.dow === lastDow ? 500 : 0);
                assert.equal(row.avg_revenue, Math.round(revenue / row.calendar_day_count));
                const count = Number(row.dow === startDow) + Number(row.dow === lastDow);
                assert.equal(row.avg_count, Math.round(count / row.calendar_day_count * 100) / 100,
                    'low-frequency bookings keep fractional daily averages');
            }
        });

        await client.query(`INSERT INTO finance_categories VALUES
            (1,'Active expense','A','#111111','expense',true,'event_genix',NULL),
            (2,'Archived expense','B','#222222','expense',false,'event_genix',NULL),
            (3,'Foreign private category','C','#333333','expense',true,'dar',NULL);
        INSERT INTO finance_transactions(type,amount,date,recognition_date,category_id,business_context) VALUES
            ('income',200,'2198-01-10',NULL,NULL,'event_genix'),
            ('income',5,'2198-01-10',NULL,1,'event_genix'),
            ('expense',10,'2198-01-10',NULL,1,'event_genix'),
            ('expense',20,'2198-01-10',NULL,2,'event_genix'),
            ('expense',30,'2198-01-10',NULL,NULL,'event_genix'),
            ('expense',7,'2198-01-10',NULL,3,'event_genix'),
            ('expense',3,'2198-02-10','2198-01-20',2,'event_genix'),
            ('expense',999,'2198-01-10','2198-02-20',1,'event_genix'),
            ('expense',777,'2198-01-10',NULL,3,'dar'),
            ('income',100,'2197-12-10',NULL,NULL,'event_genix'),
            ('expense',40,'2197-12-10',NULL,NULL,'event_genix');
        INSERT INTO bookings VALUES ('pnl-booking','2198-01-10',795,0,NULL,'confirmed',NULL,'event_genix');`);
        await t.test('allocation includes archived and uncategorized expenses, excludes income and reconciles to P&L', async () => {
            const allocation = await route.get('/expense-allocation', { from: '2198-01-01', to: '2198-01-31' });
            assert.equal(allocation.status, 200, JSON.stringify(allocation.body));
            assert.equal(allocation.body.totalExpenses, 70);
            const categories = Object.fromEntries(allocation.body.allocation.map(row => [row.category, row]));
            assert.equal(categories['Active expense'].total, 10);
            assert.equal(categories['Archived expense'].total, 23);
            assert.equal(categories['Без категорії'].total, 37);
            assert.equal(categories['Без категорії'].count, 2);
            assert.equal(categories['Foreign private category'], undefined);
            assert.ok(allocation.body.allocation.every(row => row.percentage === Math.round(row.total / 70 * 100)));
            const foreign = await route.get('/expense-allocation', { from: '2198-01-01', to: '2198-01-31' }, 'dar');
            assert.equal(foreign.status, 200);
            assert.equal(foreign.body.totalExpenses, 777);
            const pnl = await route.get('/report/pnl', { year: '2198', month: '1' });
            assert.equal(pnl.status, 200);
            assert.equal(pnl.body.summary.totalExpenses, allocation.body.totalExpenses);
        });

        await t.test('P&L exposes bases and previous dates without changing numeric contracts or inventing reconciliation', async () => {
            const { status, body } = await route.get('/report/pnl', { year: '2198', month: '1' });
            assert.equal(status, 200);
            assert.equal(body.bookingRevenue, 795);
            assert.deepEqual(body.summary, { totalIncome: 205, totalExpenses: 70, grossProfit: 135,
                margin: 66, previousIncome: 100, previousExpenses: 40, previousProfit: 60,
                incomeChange: 105, expenseChange: 75 });
            assert.deepEqual(body.previousPeriod, { from: '2197-12-01', to: '2197-12-31' });
            assert.equal(body.basis.date, 'recognition_date_or_payment_date');
            assert.equal(body.basis.bookingRevenue, 'confirmed_primary_booking_price');
            assert.equal(body.basis.profit, 'recorded_income_minus_recorded_expenses');
            const year = await route.get('/report/pnl', { year: '2198' });
            assert.equal(year.status, 200);
            assert.deepEqual(year.body.previousPeriod, { from: '2197-01-01', to: '2197-12-31' });
        });
    } finally { await client.end(); }
});
