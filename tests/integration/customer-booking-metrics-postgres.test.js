'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { buildCustomerSearchQuery } = require('../../services/customerSearchQuery');
const { buildScopedBookingAggregateSql, customerMetricsProjectionSql,
    mapCustomerBookingMetrics, calculateRFMScores } = require('../../services/customerBookingMetrics');

test('current booking metrics preserve arithmetic, dates, package ownership and business isolation', { timeout: 60000 }, async t => {
    const configuredUrl = process.env.CUSTOMER_METRICS_TEST_DATABASE_URL;
    assert.ok(configuredUrl, 'CUSTOMER_METRICS_TEST_DATABASE_URL is required; no production fallback');
    assert.ok(!process.env.RAILWAY_PROJECT_ID && process.env.NODE_ENV !== 'production');
    const rootUrl = new URL(configuredUrl);
    if (process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER === 'true') {
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
        assertSafeTestDatabaseUrl(configuredUrl, process.env);
    } else {
        assert.notEqual(configuredUrl, process.env.DATABASE_URL);
        assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(rootUrl.hostname));
        assert.match(rootUrl.pathname, /^\/customer_metrics_fixture_test(?:_\d+)?$/);
    }
    const database = 'customer_metrics_test_' + randomUUID().replaceAll('-', '');
    assert.match(database, /^customer_metrics_test_[a-f0-9]{32}$/);
    const admin = new Pool({ connectionString: rootUrl.href, connectionTimeoutMillis: 5000 });
    let pool;
    let created = false;
    t.after(async () => {
        await pool?.end();
        try {
            if (created) await admin.query(`DROP DATABASE "${database}"`);
        } finally { await admin.end(); }
    });
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const fixtureUrl = new URL(rootUrl.href);
    fixtureUrl.pathname = '/' + database;
    pool = new Pool({ connectionString: fixtureUrl.href, connectionTimeoutMillis: 5000 });
    await pool.query(`
        CREATE TABLE customers (
            id INT PRIMARY KEY, business_context TEXT, total_bookings INT,
            total_spent NUMERIC, first_visit DATE, last_visit DATE
        );
        CREATE TABLE bookings (
            id TEXT PRIMARY KEY, customer_id INT, business_context TEXT,
            status TEXT, date VARCHAR(20), price NUMERIC, linked_to TEXT, extra_data JSONB
        );
        INSERT INTO customers
        SELECT n, 'event_genix', 99, 99999, '2020-01-01'::date, '2030-01-01'::date
        FROM generate_series(1, 12) n;
        INSERT INTO bookings (id, customer_id, business_context, status, date, price, linked_to) VALUES
            ('past', 2, 'event_genix', 'confirmed', '2026-10-02', 500.25, NULL),
            ('future', 3, 'event_genix', 'confirmed', '2026-10-10', 700, NULL),
            ('today', 4, 'event_genix', 'confirmed', '2026-10-03', 300, NULL),
            ('preliminary', 5, 'event_genix', 'preliminary', '2026-09-01', 200, NULL),
            ('cancelled', 6, 'event_genix', 'cancelled', '2026-09-01', 9000, NULL),
            ('package', 7, 'event_genix', 'confirmed', '2026-09-02', 1500.25, NULL),
            ('child', 7, 'event_genix', 'confirmed', '2026-09-02', 500, 'package'),
            ('orphan-child', 7, 'event_genix', 'confirmed', '2026-09-02', 500, 'missing-root'),
            ('independent', 7, 'event_genix', ' CONFIRMED ', '2026-09-03', 200, ' '),
            ('moved', 8, 'event_genix', 'confirmed', '2026-10-01', 400, NULL),
            ('undated', 9, 'event_genix', 'confirmed', NULL, 200, NULL),
            ('blank-date', 9, 'event_genix', 'confirmed', ' ', 100, NULL),
            ('unknown', 10, 'event_genix', 'completed', '2026-09-01', 900, NULL),
            ('blank', 10, 'event_genix', '', '2026-09-01', 900, NULL),
            ('missing-status', 10, 'event_genix', NULL, '2026-09-01', 900, NULL),
            ('missing-price', 11, 'event_genix', 'confirmed', '2026-10-01', NULL, NULL),
            ('negative-price', 11, 'event_genix', 'confirmed', '2026-10-01', -100, NULL),
            ('free', 11, 'event_genix', 'confirmed', '2026-10-01', 0, NULL),
            ('other-business', 2, 'maysternya', 'confirmed', '2026-10-01', 99999, NULL);
        UPDATE bookings SET extra_data = '{"finalTotal":1500.25,"packagePrice":1500.25}' WHERE id = 'package';
        INSERT INTO bookings (id, customer_id, business_context, status, date, price)
        SELECT 'many-' || n, 12, 'event_genix', 'confirmed', '2026-09-01', 10
        FROM generate_series(1, 60) n;
    `);
    async function readMetrics({ dateFrom, order = 'c.id' } = {}) {
        const params = [];
        const aggregate = buildScopedBookingAggregateSql({ id: 1, role: 'creator' }, params, 'b', 'event_genix', { asOf: '2026-10-03' });
        const where = dateFrom ? `WHERE b_agg.real_last_visit >= $${params.push(dateFrom)}::date` : '';
        const result = await pool.query(`SELECT c.*, ${customerMetricsProjectionSql()}
            FROM customers c LEFT JOIN (${aggregate.sql}) b_agg ON b_agg.customer_id = c.id
            ${where} ORDER BY ${order}`, params);
        return result.rows.map(row => ({ id: row.id, ...mapCustomerBookingMetrics(row),
            frequency: Number(row.rfm_frequency), monetary: Number(row.rfm_monetary),
            recencyDays: row.recency_days == null ? null : Number(row.recency_days) }));
    }
    let rows = await readMetrics();
    let byId = new Map(rows.map(row => [row.id, row]));
    for (const id of [1, 6, 10]) {
        assert.equal(byId.get(id).totalBookings, 0);
        assert.equal(byId.get(id).totalSpent, 0);
        assert.equal(byId.get(id).lastVisit, null);
    }
    assert.equal(byId.get(2).totalSpent, 500.25, 'cross-business price is excluded');
    assert.equal(byId.get(2).recencyDays, 1);
    assert.equal(byId.get(3).nextBookingDate, '2026-10-10');
    assert.equal(byId.get(3).lastVisit, null);
    assert.equal(byId.get(4).plannedBookings, 1);
    assert.equal(byId.get(4).pastBookings, 0);
    assert.equal(byId.get(5).pastBookings, 1);
    assert.equal(byId.get(5).frequency, 0);
    assert.equal(byId.get(7).totalBookings, 2);
    assert.equal(byId.get(7).totalSpent, 1700.25, 'package root price counted exactly once');
    assert.equal(byId.get(9).undatedBookings, 2, 'NULL and blank legacy text dates are undated');
    assert.equal(byId.get(2).recencyDays, 1, 'VARCHAR dates support calendar subtraction');
    assert.equal(byId.get(9).totalBookings, 2);
    assert.equal(byId.get(9).lastVisit, null);
    assert.equal(byId.get(11).totalSpent, 0);
    assert.equal(byId.get(11).unpricedBookings, 2, 'zero is a known price');
    assert.equal(byId.get(12).totalBookings, 60, 'summary is independent of the 50-record history window');
    const rfm = calculateRFMScores(rows);
    for (const id of [1, 3, 4, 5, 6, 9, 10]) assert.equal(rfm.find(c => c.id === id).rfmSegment, 'no_history');
    assert.ok(rfm.filter(c => c.rfmSegment !== 'no_history').every(c => c.recencyDays > 0));
    assert.deepEqual((await readMetrics({ dateFrom: '2026-10-02' })).map(c => c.id), [2]);
    assert.deepEqual((await readMetrics({ order: 'b_agg.next_booking_date ASC NULLS LAST, c.id' })).slice(0, 2).map(c => c.id), [4, 3]);

    await pool.query("UPDATE bookings SET date = '2026-10-20' WHERE id = 'moved'");
    rows = await readMetrics();
    byId = new Map(rows.map(row => [row.id, row]));
    assert.equal(byId.get(8).pastBookings, 0);
    assert.equal(byId.get(8).plannedBookings, 1);
    assert.equal(byId.get(8).lastVisit, null);
    assert.equal(byId.get(8).nextBookingDate, '2026-10-20');
    assert.equal(byId.get(8).frequency, 0);
    const cached = await pool.query('SELECT total_bookings, total_spent, last_visit::text FROM customers WHERE id = 8');
    assert.equal(cached.rows[0].total_bookings, 99, 'reads do not rewrite legacy data');
    assert.equal(cached.rows[0].last_visit, '2030-01-01');

    await t.test('autocomplete ranks every match by its last visible visit before taking the limit', async () => {
        await pool.query(`
            ALTER TABLE customers
                ADD COLUMN name TEXT, ADD COLUMN phone TEXT, ADD COLUMN instagram TEXT,
                ADD COLUMN child_name TEXT, ADD COLUMN child_birthday DATE, ADD COLUMN source TEXT,
                ADD COLUMN notes TEXT, ADD COLUMN social_identities JSONB;
            ALTER TABLE bookings ADD COLUMN created_by TEXT, ADD COLUMN second_animator TEXT;
            CREATE TABLE customer_children (customer_id INT, business_context TEXT, name TEXT);
            INSERT INTO customers (id, business_context, name, notes) VALUES
                (101, 'event_genix', 'Search example first', NULL),
                (102, 'event_genix', 'Search example second', NULL),
                (103, 'event_genix', 'Parent matched through child', 'Selected notes'),
                (104, 'dar', 'Search example outside business', NULL),
                (105, 'event_genix', 'Unmatched customer', NULL);
            INSERT INTO customer_children VALUES
                (103, 'event_genix', 'Search example child'), (105, 'dar', 'Search example child');
            INSERT INTO bookings (id, customer_id, business_context, status, date, price, linked_to, created_by) VALUES
                ('search-old', 102, 'event_genix', 'confirmed', '2025-02-01', 100, NULL, 'fixture_actor'),
                ('search-recent', 103, 'event_genix', 'preliminary', '2025-03-01', 250.50, NULL, 'other_actor'),
                ('search-linked', 101, 'event_genix', 'confirmed', '2025-04-01', 500, 'search-old', 'fixture_actor'),
                ('search-cancelled', 101, 'event_genix', 'cancelled', '2025-05-01', 500, NULL, 'fixture_actor'),
                ('search-cross-booking', 101, 'dar', 'confirmed', '2025-06-01', 500, NULL, 'fixture_actor'),
                ('search-cross-customer', 104, 'dar', 'confirmed', '2025-07-01', 500, NULL, 'fixture_actor'),
                ('search-cross-child', 105, 'event_genix', 'confirmed', '2025-08-01', 500, NULL, 'fixture_actor'),
                ('search-future', 101, 'event_genix', 'confirmed', '2099-01-01', 500, NULL, 'fixture_actor');
        `);
        async function search(user, limit) {
            const { sql, params } = buildCustomerSearchQuery({ query: 'Search example', user, limit });
            return (await pool.query(sql, params)).rows;
        }

        const all = await search({ role: 'creator' }, 3);
        assert.deepEqual(all.map(row => [row.id, row.real_last_visit]), [
            [103, '2025-03-01'], [102, '2025-02-01'], [101, null]
        ]);
        const [top] = await search({ role: 'creator' }, 1);
        assert.equal(top.id, 103);
        assert.equal(top.notes, 'Selected notes');
        assert.equal(Number(top.real_total_spent), 250.50);
        assert.equal(Number(top.preliminary_bookings), 1);
        assert.equal(Number(all[2].planned_bookings), 1);

        const [scoped] = await search({ role: 'animator', username: 'fixture_actor' }, 1);
        assert.equal(scoped.id, 102, 'an invisible newer booking cannot win the ranking');
        assert.equal(scoped.real_last_visit, '2025-02-01');
        assert.equal(Number(scoped.real_total_spent), 0);
    });
});
