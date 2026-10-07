'use strict';

const { after, afterEach, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Client, Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

const enabled = process.env.RUN_HERMES_ATTENDANCE_READ_INTEGRATION === 'true';
const forbiddenCalls = [];
function forbidden(name) {
    return () => {
        forbiddenCalls.push(name);
        throw new Error('Attendance SQL test attempted forbidden operation: ' + name);
    };
}

function blockDefaultPersistenceAndSideEffects() {
    for (const [modulePath, exports] of [
        ['../../db', { pool: {
            query: forbidden('default database query'), connect: forbidden('default database connect')
        } }],
        ['../../services/telegram', {
            sendTelegramMessage: forbidden('Telegram send'), getConfiguredChatId: forbidden('Telegram config')
        }],
        ['../../services/websocket', {
            broadcast: forbidden('broadcast'), broadcastLineEvent: forbidden('broadcast line event')
        }],
        ['../../services/hermesAttendanceImport', {
            previewHermesAttendanceImport: forbidden('attendance preview'),
            applyHermesAttendanceImport: forbidden('attendance apply')
        }],
        ['../../services/hermesScheduleImport', {
            previewHermesScheduleImport: forbidden('schedule preview'),
            applyHermesScheduleImport: forbidden('schedule apply')
        }]
    ]) {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
}

describe('Hermes attendance exact SELECT on disposable PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let client;
    let server;
    let initialRows;
    const calls = [];
    const fixtureSnapshot = () => client.query(
        'SELECT staff_id, record_date::text, clock_in::text, status, business_context FROM hr_time_records ORDER BY record_date, staff_id, business_context'
    );

    before(async () => {
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
        assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
        assert.equal(target.isLocal, true, 'Attendance SQL test requires a disposable loopback database');
        assert.ok(target.url.port, 'Disposable PostgreSQL must have an explicit port');
        client = new Client({
            connectionString: target.url.toString(), ssl: false, connectionTimeoutMillis: 5_000,
            query_timeout: 5_000, application_name: 'hermes_attendance_read_disposable_test'
        });
        await client.connect();
        // Only this validated disposable connection may issue SQL, including during app imports.
        const originalQuery = Client.prototype.query;
        Pool.prototype.query = forbidden('pg.Pool.query');
        Pool.prototype.connect = forbidden('pg.Pool.connect');
        Client.prototype.connect = forbidden('pg.Client.connect');
        Client.prototype.query = function (...args) {
            if (this !== client) return forbidden('unvalidated pg.Client.query')();
            return originalQuery.apply(this, args);
        };
        await client.query('BEGIN');
        await client.query("SET LOCAL TIME ZONE 'UTC'");
        await client.query(
            'CREATE TEMP TABLE hr_time_records (staff_id integer, record_date date, clock_in timestamptz, status text, business_context text) ON COMMIT DROP'
        );
        await client.query(
            "INSERT INTO hr_time_records VALUES " +
            "(11, '2026-07-15', '2026-07-15T06:07:00Z', 'present', 'event_genix'), " +
            "(12, '2026-07-15', NULL, NULL, 'event_genix'), " +
            "(13, '2026-07-15', '2026-07-14T22:10:00Z', 'late', 'event_genix'), " +
            "(2147483647, '2026-07-15', '2026-07-15T09:00:00Z', 'present', 'event_genix'), " +
            "(11, '2026-07-16', '2026-07-16T06:00:00Z', 'present', 'event_genix'), " +
            "(11, '2026-07-14', '2026-07-14T06:00:00Z', 'present', 'event_genix'), " +
            "(11, '2026-07-17', '2026-07-17T06:00:00Z', 'present', 'event_genix'), " +
            "(99, '2026-07-15', '2026-07-15T06:00:00Z', 'present', 'dar'), " +
            "(11, '2026-07-15', '2026-07-15T00:00:00Z', 'late', 'dar'), " +
            "(14, '2026-01-15', '2026-01-15T07:15:00Z', 'present', 'event_genix')"
        );
        initialRows = (await fixtureSnapshot()).rows;

        // No server.js, app DB, migrations, scheduler, or notification service is loaded.
        blockDefaultPersistenceAndSideEffects();
        const express = require('express');
        const { createHermesScheduleRouter } = require('../../routes/hermes-schedule');
        const pool = {
            connect: forbidden('injected queryable connect'),
            async query(sql, params) {
                calls.push({ sql, params: structuredClone(params) });
                assert.match(sql.trim(), /^SELECT tr\.staff_id,/);
                assert.match(sql, /FROM hr_time_records tr/);
                assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|CALL|COPY|pg_notify|nextval|setval)\b/i);
                // Execute the handler's unmodified SQL and parameters on PostgreSQL.
                return client.query(sql, params);
            }
        };
        const app = express();
        app.use((req, res, next) => {
            req.user = { id: 42, role: 'hr', businessContexts: ['event_genix'] };
            req.integration = { id: 'hermes-event-genix-crm', authMode: 'x-api-key', actorUserId: 42 };
            next();
        });
        app.use('/api/hermes', createHermesScheduleRouter({ pool }));
        server = await new Promise((resolve, reject) => {
            const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
            listener.once('error', reject);
        });
    });

    afterEach(() => {
        assert.deepEqual(forbiddenCalls, [], 'Unexpected default persistence or side effect, including swallowed errors');
    });

    after(async () => {
        const cleanupErrors = [];
        if (server) {
            try {
                await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
            } catch (error) { cleanupErrors.push(error); }
        }
        if (client) {
            try {
                if (initialRows) {
                    await client.query("SET LOCAL TIME ZONE 'UTC'");
                    assert.deepEqual((await fixtureSnapshot()).rows, initialRows, 'GET must leave synthetic attendance unchanged');
                }
            } catch (error) { cleanupErrors.push(error); }
            try { await client.query('ROLLBACK'); } catch (error) { cleanupErrors.push(error); }
            try { await client.end(); } catch (error) { cleanupErrors.push(error); }
        }
        assert.deepEqual(forbiddenCalls, [], 'No forbidden operation may be swallowed');
        if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Attendance SQL cleanup or read-only check failed');
    });

    async function get(overrides = {}) {
        const query = new URLSearchParams({
            businessContext: 'event_genix', dateFrom: '2026-07-15', dateTo: '2026-07-15', ...overrides
        });
        const response = await fetch(
            'http://127.0.0.1:' + server.address().port + '/api/hermes/attendance?' + query,
            { signal: AbortSignal.timeout(5_000) }
        );
        return { status: response.status, body: await response.json() };
    }

    it('binds business and inclusive date boundaries for omitted and empty staffIds', async () => {
        for (const filter of [{}, { staffIds: '' }]) {
            const result = await get({ dateTo: '2026-07-16', ...filter });
            assert.equal(result.status, 200, JSON.stringify(result.body));
            assert.deepEqual(result.body.items.map(row => [row.date, row.staffId]), [
                ['2026-07-15', 11], ['2026-07-15', 12], ['2026-07-15', 13],
                ['2026-07-15', 2147483647], ['2026-07-16', 11]
            ]);
            const call = calls.at(-1);
            assert.deepEqual(call.params, ['2026-07-15', '2026-07-16', 'event_genix']);
            assert.match(call.sql, /tr\.record_date >= \$1::date/);
            assert.match(call.sql, /tr\.record_date <= \$2::date/);
            assert.match(call.sql, /tr\.business_context = \$3/);
            assert.doesNotMatch(call.sql, /ANY\(/);
        }
    });

    it('executes int[] filters including max integer, duplicates, foreign and mixed IDs', async () => {
        for (const [staffIds, expected, bound] of [
            ['11', [11], [11]], ['99', [], [99]], ['99,11,11', [11], [11, 99]],
            ['2147483647', [2147483647], [2147483647]], ['9999', [], [9999]]
        ]) {
            const result = await get({ staffIds });
            assert.equal(result.status, 200, JSON.stringify(result.body));
            assert.deepEqual(result.body.items.map(row => row.staffId), expected);
            assert.match(calls.at(-1).sql, /tr\.staff_id = ANY\(\$4::int\[\]\)/);
            assert.deepEqual(calls.at(-1).params, ['2026-07-15', '2026-07-15', 'event_genix', bound]);
        }
    });

    it('returns 200 and an empty list when the date range has no actual records', async () => {
        const result = await get({ dateFrom: '2026-08-01', dateTo: '2026-08-01' });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.items, []);
    });

    it('preserves null clock_in and status without fabricating arrivals', async () => {
        const result = await get({ staffIds: '12' });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.items, [{ staffId: 12, date: '2026-07-15', arrivalTime: null, status: null }]);
    });

    it('uses Kyiv summer/winter offsets and stored record_date independently of session timezone', async () => {
        for (const timezone of ['UTC', 'America/Los_Angeles']) {
            await client.query("SELECT set_config('TimeZone', $1, true)", [timezone]);
            for (const [date, staffId, time] of [
                ['2026-07-15', 11, '09:07'], ['2026-07-15', 13, '01:10'], ['2026-01-15', 14, '09:15']
            ]) {
                const result = await get({ dateFrom: date, dateTo: date, staffIds: String(staffId) });
                assert.equal(result.status, 200);
                assert.equal(result.body.meta.timeZone, 'Europe/Kyiv');
                assert.deepEqual(result.body.items, [{
                    staffId, date, arrivalTime: time, status: staffId === 13 ? 'late' : 'present'
                }]);
                assert.match(calls.at(-1).sql, /tr\.record_date::text AS date/);
                assert.match(calls.at(-1).sql, /to_char\(tr\.clock_in AT TIME ZONE 'Europe\/Kyiv', 'HH24:MI'\)/);
            }
        }
    });

    it('rejects foreign business and invalid IDs without executing an attendance query', async () => {
        const count = calls.length;
        assert.equal((await get({ businessContext: 'dar' })).status, 403);
        for (const staffIds of ['11,invalid', '2147483648']) {
            assert.equal((await get({ staffIds })).status, 400);
        }
        assert.equal(calls.length, count);
    });
});
