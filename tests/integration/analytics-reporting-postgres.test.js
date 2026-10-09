'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

function analyticsRoute(client) {
    const filename = path.join(__dirname, '../../routes/analytics.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, console, process, Date, Buffer,
        require(id) { return id === '../db' ? { pool: client } : realRequire(id); }
    }, { filename });
    return async function get(from, to, context = 'event_genix') {
        const layer = module.exports.stack.find(item => item.route?.path === '/deals-lifecycle');
        let status = 200;
        let body;
        const res = { locals: {}, status(value) { status = value; return this; }, json(value) { body = value; return this; } };
        await layer.route.stack.at(-1).handle({ method: 'GET', query: { from, to },
            headers: { 'x-business-context': context },
            user: { id: 47, role: 'creator', username: 'analytics_fixture', business_contexts: ['event_genix', 'dar'], default_business_context: 'event_genix' }
        }, res);
        assert.equal(status, 200, JSON.stringify(body));
        return JSON.parse(JSON.stringify(body));
    };
}

test('recorded deal events use actual PostgreSQL history without inventing missing transitions', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 60000
}, async t => {
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
    assert.equal(database.isLocal, true);
    const client = new Client({ connectionString: database.url.toString(), ssl: false });
    await client.connect();
    try {
        await client.query(`
            CREATE TEMP TABLE leads (id int PRIMARY KEY, pipeline_stage text, status text,
                booked_at timestamp, event_date date, created_at timestamp, business_context text,
                lead_type text, booking_id text);
            CREATE TEMP TABLE lead_interactions (lead_id int, type text, details jsonb, created_at timestamp);
            CREATE TEMP TABLE bookings (id text PRIMARY KEY, business_context text);
            CREATE TEMP TABLE trusted_qa_run_entities (run_id bigint, entity_type text, entity_id text, cleanup_state text);
            CREATE TEMP TABLE finance_money_qa_runs (run_id bigint);
            INSERT INTO leads VALUES
                (1,'completed','completed','2026-09-29','2026-10-20','2026-09-01','event_genix','quality',NULL),
                (2,'closed','completed','2026-10-02','2026-10-21','2026-09-01','event_genix','quality',NULL),
                (3,'waiting','booked','2026-10-03','2026-10-22','2026-09-01','event_genix','quality',NULL),
                (4,'waiting','booked','2026-10-04','2026-10-23','2026-09-01','event_genix','spam',NULL),
                (5,'waiting','booked','2026-10-04','2026-10-23','2026-09-01','dar','quality',NULL),
                (6,'waiting','booked','2026-10-04','2026-10-23','2026-09-01','event_genix','quality','qa-booking'),
                (7,'waiting','booked','2026-10-04','2026-10-23','2026-09-01','event_genix','quality',NULL);
            INSERT INTO bookings VALUES ('qa-booking','event_genix');
            INSERT INTO finance_money_qa_runs VALUES (111);
            INSERT INTO trusted_qa_run_entities VALUES (111,'booking','qa-booking','cleaned');
        `);
        async function transition(leadId, day, oldStage, newStage, type = 'status_change') {
            await client.query('INSERT INTO lead_interactions VALUES ($1,$2,$3::jsonb,$4::timestamp)', [leadId, type, JSON.stringify({ oldStage, newStage }), day]);
        }
        await transition(1, '2026-09-29 23:59:00', 'deal', 'deposit_received');
        await transition(1, '2026-10-01 10:00:00', 'deposit_received', 'deal');
        await transition(1, '2026-10-01 12:00:00', 'deal', 'deposit_received');
        await transition(1, '2026-10-02 12:00:00', 'waiting', 'completed');
        await transition(2, '2026-10-02 12:00:00', 'deal', 'deposit_received');
        await transition(2, '2026-10-03 12:00:00', 'deposit_received', 'waiting');
        await transition(2, '2026-10-04 12:00:00', 'waiting', 'completed');
        await transition(2, '2026-10-05 12:00:00', 'completed', 'closed');
        await transition(2, '2026-10-06 12:00:00', 'closed', 'deal');
        await transition(2, '2026-10-07 12:00:00', 'deal', 'waiting');
        await transition(2, '2026-10-08 12:00:00', 'waiting', 'completed');
        for (const id of [4, 5, 6]) await transition(id, '2026-10-04 12:00:00', 'deal', 'waiting');
        await transition(7, '2026-10-04 12:00:00', 'unknown_legacy', 'waiting');
        await transition(7, '2026-10-05 12:00:00', 'deal', 'waiting', 'note');
        const get = analyticsRoute(client);

        await t.test('acceptance survives closure and the chart uses recorded transition dates', async () => {
            const report = await get('2026-10-01', '2026-10-31');
            assert.equal(report.recordedEvents.accepted, 1);
            assert.equal(report.recordedEvents.closed, 2);
            assert.equal(report.recordedEvents.trend.length, 31);
            assert.deepEqual(report.recordedEvents.trend.filter(row => row.accepted || row.closed), [
                { date: '2026-10-02', accepted: 1, closed: 1 },
                { date: '2026-10-04', accepted: 0, closed: 1 }
            ]);
            assert.equal(report.accepted, 2, 'snapshot preserves actual current statuses without QA/spam');
            assert.equal(report.closed, 1, 'snapshot is still grouped by its original booked/event/created date');
            assert.equal(report.meta.reportability, 'snapshot-only');
            assert.equal(report.recordedEvents.meta.conversionAvailable, false);
            assert.equal(report.recordedEvents.meta.timestampTimezone, 'not-recorded');
        });
        await t.test('first recorded events are selected across all history before restricting the requested dates', async () => {
            const first = await get('2026-09-01', '2026-09-30');
            assert.equal(first.recordedEvents.accepted, 1);
            assert.equal(first.recordedEvents.closed, 0);
            const reopened = await get('2026-10-06', '2026-10-08');
            assert.equal(reopened.recordedEvents.accepted, 0);
            assert.equal(reopened.recordedEvents.closed, 0);
            assert.ok(reopened.recordedEvents.trend.every(row => row.accepted === 0 && row.closed === 0));
        });
        await t.test('business context and durable QA ownership apply equally to snapshots and recorded events', async () => {
            const dar = await get('2026-10-01', '2026-10-31', 'dar');
            assert.equal(dar.accepted, 1);
            assert.equal(dar.recordedEvents.accepted, 1);
            assert.equal(dar.recordedEvents.closed, 0);
            const all = await get('2026-09-01', '2026-10-31');
            assert.equal(all.total, 4);
            assert.equal(all.recordedEvents.accepted, 2);
            assert.equal(all.classificationStats.spam, 1);
        });
        await t.test('missing or invalid history does not fall back to booked_at or the current status', async () => {
            const missing = await get('2026-10-03', '2026-10-03');
            assert.equal(missing.accepted, 1);
            assert.equal(missing.recordedEvents.accepted, 0);
            assert.equal(missing.recordedEvents.closed, 0);
            assert.equal(missing.recordedEvents.meta.coverage, 'recorded-transitions-only');
        });
    } finally { await client.end(); }
});
