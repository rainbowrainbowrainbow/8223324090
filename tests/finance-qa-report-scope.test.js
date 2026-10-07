'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../scripts/test-db-safety');

// Execute actual route SQL against temporary PostgreSQL tables. The remaining
// sources are empty fixtures; no application account, booking or money is written.
function routeFixture(name, client) {
    const filename = path.join(__dirname, '../routes', name + '.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    const queries = [];
    const pool = { async query(sql, params) {
        queries.push(sql);
        if (/FROM bookings\s+b\b/i.test(sql)) return client.query(sql, params);
        return { rows: [{ count: 0, total: 0 }], rowCount: 1 };
    } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports,
        require(id) {
            if (id === '../db') return { pool, query: pool.query.bind(pool) };
            return realRequire(id);
        }, console, process, Buffer, Date, setTimeout, clearTimeout, setInterval, clearInterval
    }, { filename });
    const user = { id: 47, role: 'creator', username: 'qa_report_fixture',
        business_contexts: ['event_genix'], default_business_context: 'event_genix' };
    return { queries, async get(routePath, params = {}, query = {}) {
        const layer = module.exports.stack.find(item => item.route?.path === routePath && item.route.methods.get);
        assert.ok(layer, name + ' route exists');
        let payload;
        let status = 200;
        const res = { locals: {}, status(value) { status = value; return this; }, json(value) { payload = value; return this; } };
        await layer.route.stack.at(-1).handle({ user, params, query,
            headers: { 'x-business-context': 'event_genix' }, method: 'GET' }, res);
        assert.equal(status, 200, name + ' query must execute');
        assert.ok(payload, name + ' response required');
        return payload;
    } };
}

test('money and KPI route aggregates exclude durable finance QA ownership in every run state', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 60000
}, async t => {
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
    assert.equal(database.isLocal, true);
    const client = new Client({ connectionString: database.url.toString(), ssl: false });
    await client.connect();
    try {
        await client.query(`CREATE TEMP TABLE bookings (
            id text PRIMARY KEY, date text, time text, business_context text, status text,
            price integer, linked_to text, created_by text, program_name text
        );
        CREATE TEMP TABLE trusted_qa_run_entities (
            run_id bigint, entity_type text, entity_id text, cleanup_state text
        );
        CREATE TEMP TABLE finance_money_qa_runs (run_id bigint);
        CREATE TEMP TABLE trusted_qa_runs (id bigint, state text, expires_at timestamptz);`);
        const today = (await client.query("SELECT (NOW() AT TIME ZONE 'Europe/Kyiv')::date::text AS today")).rows[0].today;
        await client.query(`INSERT INTO bookings(id,date,time,business_context,status,price,program_name)
            VALUES ('real-confirmed',$1,'12:00','event_genix','confirmed',100,'Real'),
                   ('real-preliminary',$1,'13:00','event_genix','preliminary',40,'Real'),
                   ('qa-active',$1,'14:00','event_genix','confirmed',900,'Synthetic'),
                   ('qa-expired',$1,'15:00','event_genix','confirmed',800,'Synthetic'),
                   ('qa-cleaned',$1,'16:00','event_genix','confirmed',700,'Synthetic');
        `, [today]);
        await client.query(`INSERT INTO finance_money_qa_runs VALUES (1),(2),(3);
            INSERT INTO trusted_qa_run_entities VALUES
                (1,'booking','qa-active','active'),(2,'booking','qa-expired','active'),(3,'booking','qa-cleaned','cleaned');
            INSERT INTO trusted_qa_runs VALUES
                (1,'active',NOW()+INTERVAL '15 minutes'),(2,'active',NOW()-INTERVAL '1 hour'),(3,'cleaned',NOW()-INTERVAL '1 day');`);

        await t.test('dashboard money widget and count share the same exclusion', async () => {
            const route = routeFixture('dashboard', client);
            const response = await route.get('/widgets/:type', { type: 'finance_today' });
            assert.equal(response.success, true);
            assert.equal(response.data.bookingValue, 100);
            assert.equal(response.data.bookings, 2);
            assert.equal(response.data.profit, null);
        });
        await t.test('stats totals and daily groups never count expired or cleaned QA bookings', async () => {
            const route = routeFixture('stats', client);
            const response = await route.get('/revenue', {}, { from: today, to: today });
            assert.equal(response.totals.revenue, 140);
            assert.equal(response.totals.confirmedRevenue, 100);
            assert.equal(response.totals.count, 2);
            assert.deepEqual(JSON.parse(JSON.stringify(response.daily)), [{ date: today, revenue: 140, count: 2 }]);
        });
        await t.test('board operational revenue retains its existing preliminary semantics', async () => {
            const response = await routeFixture('board', client).get('/stats');
            assert.equal(response.revenue, 140);
            assert.equal(response.bookings, 2);
            assert.equal(response.confirmed, 1);
            assert.equal(response.preliminary, 1);
        });
        await t.test('center revenue heatmap retains ordinary bookings only', async () => {
            const response = await routeFixture('center', client).get('/heatmap', {}, { from: today, to: today });
            assert.equal(response.success, true);
            assert.equal(response.heatmap.length, 1);
            assert.equal(response.heatmap[0].revenue, 140);
            assert.equal(response.heatmap[0].count, 2);
        });

        await client.query(`INSERT INTO bookings(id,date,time,business_context,status,price)
            VALUES ('foreign-business',$1,'12:30','dar','confirmed',5000)`, [today]);
        await t.test('adding QA exclusion preserves the existing business scope', async () => {
            const dashboard = await routeFixture('dashboard', client).get('/widgets/:type', { type: 'finance_today' });
            const stats = await routeFixture('stats', client).get('/revenue', {}, { from: today, to: today });
            const board = await routeFixture('board', client).get('/stats');
            assert.equal(dashboard.data.bookingValue, 100);
            assert.equal(stats.totals.revenue, 140);
            assert.equal(board.revenue, 140);
        });
    } finally { await client.end(); }
});
