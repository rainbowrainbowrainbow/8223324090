'use strict';

require('./helpers/forbid-real-db');

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Block all non-injected persistence before loading any application module.
// The harness imports routers only; server.js and schedulers are never started.
const sideEffects = [];
function forbidden(name) {
    return () => {
        sideEffects.push(name);
        throw new Error(`Attendance GET attempted forbidden operation: ${name}`);
    };
}
const dbId = require.resolve('../db');
require.cache[dbId] = {
    id: dbId, filename: dbId, loaded: true,
    exports: { pool: { query: forbidden('default database query'), connect: forbidden('default database connect') } }
};
for (const [modulePath, names] of [
    ['../services/telegram', ['sendTelegramMessage', 'getConfiguredChatId']],
    ['../services/websocket', ['broadcast', 'broadcastLineEvent']],
    ['../services/hermesAttendanceImport', ['previewHermesAttendanceImport', 'applyHermesAttendanceImport']],
    ['../services/hermesScheduleImport', ['previewHermesScheduleImport', 'applyHermesScheduleImport']]
]) {
    const service = require(modulePath);
    for (const name of names) service[name] = forbidden(`${modulePath}.${name}`);
}

const { authenticateToken } = require('../middleware/auth');
const { apiAuthBoundary, isPublicApiRequest } = require('../middleware/apiAuthBoundary');
const { businessScopeWriteGuard } = require('../middleware/businessScopeGuard');
const { apiAudit } = require('../middleware/apiAudit');
const { createHermesAuthMiddleware } = require('../middleware/hermesAuth');
const { createHermesRouter } = require('../routes/hermes');
const shopRouter = require('../routes/shop');
const settingsRouter = require('../routes/settings');

const ENV = { HERMES_API_KEY: 'attendance-read-synthetic-key', HERMES_ACTOR_USER_ID: '42' };
const HEADERS = { 'x-api-key': ENV.HERMES_API_KEY };
const DAY_QUERY = 'businessContext=event_genix&dateFrom=2026-09-29&dateTo=2026-09-29&staffIds=';
const FIXTURES = [
    { staff_id: 11, date: '2026-09-29', clock_in: '2026-09-29T06:07:00Z', status: 'present', business_context: 'event_genix' },
    { staff_id: 12, date: '2026-09-29', clock_in: null, status: null, business_context: 'event_genix' },
    { staff_id: 13, date: '2026-09-29', clock_in: '2026-09-28T22:10:00Z', status: 'late', business_context: 'event_genix' },
    { staff_id: 99, date: '2026-09-29', clock_in: '2026-09-29T06:00:00Z', status: 'present', business_context: 'dar' },
    { staff_id: 11, date: '2026-09-28', clock_in: '2026-09-28T06:00:00Z', status: 'present', business_context: 'event_genix' },
    { staff_id: 11, date: '2026-09-30', clock_in: '2026-09-30T06:00:00Z', status: 'present', business_context: 'event_genix' },
    { staff_id: 14, date: '2026-01-15', clock_in: '2026-01-15T07:15:00Z', status: 'present', business_context: 'event_genix' }
];
const STAFF_DIRECTORY = new Map([
    [11, { display_name: '  Synthetic Display 11  ', name: 'Synthetic Legal 11' }],
    [12, { display_name: ' \t\n ', name: '  Synthetic Fallback 12  ' }],
    [13, { display_name: 'Synthetic Inactive 13', name: 'Synthetic Legal 13' }],
    [14, { display_name: ' \t\n ', name: ' \t\n ' }]
]);

function actorRow(overrides = {}) {
    return {
        id: 42, username: 'synthetic.attendance.reader', role: 'hr', extra_roles: [],
        page_allowlist: [], action_allowlist: [], action_denylist: [],
        business_contexts: ['event_genix'], default_business_context: 'event_genix',
        name: 'Synthetic Reader', telegram_chat_id: null, is_active: true, ...overrides
    };
}

function createPool(options = {}) {
    const calls = [];
    const records = structuredClone(options.records || FIXTURES);
    return {
        calls, records,
        connect: forbidden('injected database connect'),
        async query(sql, params = []) {
            calls.push({ sql, params });
            assert.match(sql.trim(), /^SELECT\b/i, 'GET may execute SELECT only');
            assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|CALL|pg_notify|nextval|setval)\b/i);
            if (/FROM users\b/.test(sql)) {
                assert.deepEqual(params, [42]);
                return { rows: [actorRow(options.actor)] };
            }
            assert.match(sql, /FROM hr_time_records\s+tr\b/i, 'read actual attendance only');
            assert.match(sql, /LEFT JOIN staff\s+s\s+ON\s+s\.id\s*=\s*tr\.staff_id/i);
            assert.match(sql, /tr\.record_date\s*>=\s*\$1/);
            assert.match(sql, /tr\.record_date\s*<=\s*\$2/);
            assert.match(sql, /tr\.business_context\s*=\s*\$3/);
            assert.match(sql, /tr\.record_date::text\s+AS\s+date/i);
            assert.match(sql, /to_char\(tr\.clock_in AT TIME ZONE 'Europe\/Kyiv',\s*'HH24:MI'\)/i);
            assert.doesNotMatch(sql, /staff_schedule|hr_shifts|payroll|outbox|preview|import|phone|hourly_rate/i);
            assert.equal(params[2], 'event_genix');
            const [dateFrom, dateTo, businessContext, ids] = params;
            if (ids) assert.match(sql, /tr\.staff_id\s*=\s*ANY\(\$4::int\[\]\)/i);
            else assert.doesNotMatch(sql, /\bANY\s*\(/i);
            if (options.queryError) throw new Error('Synthetic unavailable database');
            return {
                rows: records.filter(row => row.date >= dateFrom && row.date <= dateTo
                    && row.business_context === businessContext && (!ids || ids.includes(row.staff_id)))
                    .sort((left, right) => left.date.localeCompare(right.date) || left.staff_id - right.staff_id)
                    .map(row => ({
                        staff_id: row.staff_id, date: row.date, status: row.status,
                        arrival_time: row.clock_in === null ? null : new Intl.DateTimeFormat('en-GB', {
                            timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
                        }).format(new Date(row.clock_in)),
                        display_name: STAFF_DIRECTORY.get(row.staff_id)?.display_name ?? null,
                        name: STAFF_DIRECTORY.get(row.staff_id)?.name ?? null,
                        // Deliberate unexpected fields catch accidental row spreading.
                        phone: 'private-synthetic-phone', hourly_rate: 999, clock_out: 'private-synthetic-out'
                    }))
            };
        }
    };
}

async function withApp(options, work) {
    const pool = createPool(options);
    const initialRecords = structuredClone(pool.records);
    const app = express();
    app.use(express.json());
    // Same relevant mount order as server.js, with the real guards and routers.
    app.use('/api', apiAuthBoundary(authenticateToken));
    app.use('/api', businessScopeWriteGuard);
    app.use('/api', apiAudit);
    app.use('/api/hermes', createHermesRouter({
        pool, rateLimit: false,
        authMiddleware: createHermesAuthMiddleware({ pool, env: { ...ENV, ...options.env } })
    }));
    app.use('/api/shop', shopRouter);
    app.use('/api', shopRouter);
    app.use('/api', settingsRouter);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const get = async (query = DAY_QUERY, headers = HEADERS, pathname = '/api/hermes/attendance') => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}?${query}`, { headers });
        return { status: response.status, data: await response.json() };
    };
    try {
        await work({ pool, get });
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        assert.deepEqual(pool.records, initialRecords, 'GET must not mutate attendance fixtures');
    }
}

afterEach(() => {
    assert.deepEqual(sideEffects, [], 'GET must not invoke persistence, imports, broadcasts, or messages');
});

describe('Hermes attendance GET registration and real auth boundary', () => {
    it('keeps the actual server mount order and machine-auth ownership', () => {
        const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        const markers = [
            "app.use('/api', apiAuthBoundary(authenticateToken))",
            "app.use('/api', businessScopeWriteGuard)",
            "app.use('/api', apiAudit)",
            "app.use('/api/hermes', require('./routes/hermes'))",
            "app.use('/api', require('./routes/shop'))",
            "app.use('/api', settingsRouter)"
        ];
        const positions = markers.map(marker => serverSource.indexOf(marker));
        assert.ok(positions.every(position => position >= 0));
        assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
        const { PUBLIC_API_ROUTES, INTEGRATION_AUTH_CONTRACTS } = require('../config/authBoundary');
        assert.ok(PUBLIC_API_ROUTES.some(route => route.prefix === '/hermes/' && route.integrationContract === 'hermesApi'));
        assert.equal(INTEGRATION_AUTH_CONTRACTS.hermesApi.authentication, 'API key or bearer secret');
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/hermes/attendance' }), true);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/hr/today' }), false);
        const registry = fs.readFileSync(path.join(__dirname, '../config/apiSurface.js'), 'utf8');
        assert.match(registry, /routeFile: 'routes\/hermes-schedule\.js',[\s\S]*?parentRouteFile: 'routes\/hermes\.js'/);
    });

    it('reproduces the generic JWT 401 for an authenticated unknown Hermes route', async () => {
        await withApp({}, async ({ get, pool }) => {
            const response = await get(DAY_QUERY, HEADERS, '/api/hermes/attendance-read-unknown');
            assert.equal(response.status, 401);
            assert.equal(response.data.error, 'Authentication required');
            assert.equal(pool.calls.length, 1, 'machine actor was loaded before settings JWT fallthrough');
        });
    });

    it('serves the exact Hermes read-day request with genuine machine auth', async () => {
        await withApp({}, async ({ get, pool }) => {
            const response = await get();
            assert.equal(response.status, 200, JSON.stringify(response.data));
            assert.equal(response.data.success, true);
            assert.deepEqual(response.data.items, [
                { staffId: 11, staffName: 'Synthetic Display 11', date: '2026-09-29', arrivalTime: '09:07', status: 'present' },
                { staffId: 12, staffName: 'Synthetic Fallback 12', date: '2026-09-29', arrivalTime: null, status: null },
                { staffId: 13, staffName: 'Synthetic Inactive 13', date: '2026-09-29', arrivalTime: '01:10', status: 'late' }
            ]);
            assert.equal(response.data.meta.timeZone, 'Europe/Kyiv');
            assert.equal(response.data.meta.businessContext, 'event_genix');
            assert.equal(pool.calls.length, 2, 'one actor SELECT and one attendance SELECT only');
        });
    });

    it('accepts the configured bearer-secret fallback without a CRM session', async () => {
        await withApp({}, async ({ get }) => {
            assert.equal((await get(DAY_QUERY, { Authorization: `Bearer ${ENV.HERMES_API_KEY}` })).status, 200);
        });
    });

    it('rejects absent and wrong machine credentials before accessing data', async () => {
        await withApp({}, async ({ get, pool }) => {
            for (const headers of [{}, { 'x-api-key': 'wrong' }, { Authorization: 'Bearer wrong' }, {
                'x-api-key': 'wrong', Authorization: `Bearer ${ENV.HERMES_API_KEY}`
            }]) {
                const response = await get(DAY_QUERY, headers);
                assert.equal(response.status, 401);
                assert.match(response.data.code, /^HERMES_AUTH_(REQUIRED|INVALID)$/);
            }
            assert.equal(pool.calls.length, 0);
        });
    });

    it('denies roles, business scopes, and configured allowlists outside attendance access', async () => {
        for (const options of [
            { actor: { role: 'employee', action_allowlist: ['hr.today.view'] } },
            { actor: { role: 'director', business_contexts: ['dar'], default_business_context: 'dar' } },
            { env: { HERMES_ALLOWED_BUSINESS_CONTEXTS: 'dar' } },
            { actor: { is_active: false } }
        ]) {
            await withApp(options, async ({ get, pool }) => {
                const response = await get();
                assert.equal(response.status, 403, JSON.stringify(response.data));
                assert.equal(pool.calls.length, 1);
            });
        }
        await withApp({ actor: { business_contexts: ['event_genix', 'dar'] } }, async ({ get, pool }) => {
            for (const context of ['dar', 'crm', 'all', 'unknown']) {
                assert.equal((await get(DAY_QUERY.replace('event_genix', context))).status, 403);
            }
            assert.ok(pool.calls.every(call => /FROM users\b/.test(call.sql)));
        });
    });
});

describe('Hermes attendance GET read contract', () => {
    it('applies staff and business isolation with empty, omitted, foreign, and mixed IDs', async () => {
        await withApp({}, async ({ get }) => {
            for (const query of [DAY_QUERY, DAY_QUERY.replace('&staffIds=', '')]) {
                assert.deepEqual((await get(query)).data.items.map(row => row.staffId), [11, 12, 13]);
            }
            for (const [ids, expected] of [['11', [11]], ['99', []], ['11,99', [11]], ['9999', []]]) {
                const response = await get(DAY_QUERY + ids);
                assert.equal(response.status, 200, JSON.stringify(response.data));
                assert.deepEqual(response.data.items.map(row => row.staffId), expected);
            }
        });
    });

    it('returns an empty list for a valid range without attendance records', async () => {
        await withApp({ records: [] }, async ({ get }) => {
            const response = await get();
            assert.equal(response.status, 200);
            assert.deepEqual(response.data.items, []);
        });
    });

    it('uses the business timezone in winter and preserves the recorded attendance date', async () => {
        await withApp({}, async ({ get }) => {
            const response = await get(DAY_QUERY.replaceAll('2026-09-29', '2026-01-15'));
            assert.equal(response.status, 200, JSON.stringify(response.data));
            assert.deepEqual(response.data.items, [{ staffId: 14, staffName: null, date: '2026-01-15', arrivalTime: '09:15', status: 'present' }]);
        });
    });

    it('rejects invalid, reversed, and oversized date ranges before the attendance query', async () => {
        await withApp({}, async ({ get, pool }) => {
            const invalid = [
                ['2026-02-30', '2026-03-01'], ['2026-9-29', '2026-09-29'], ['0000-01-01', '0000-01-01'],
                ['2026-09-30', '2026-09-29'], ['2026-09-01', '2026-10-02'], ['', '2026-09-29'],
                ['2026-09-29T00:00:00Z', '2026-09-29']
            ];
            for (const [dateFrom, dateTo] of invalid) {
                const query = new URLSearchParams({ businessContext: 'event_genix', dateFrom, dateTo });
                assert.equal((await get(query)).status, 400, query.toString());
            }
            for (const suffix of ['&dateFrom=2026-09-29', '&dateTo[]=2026-09-29', '&dateFrom[x]=2026-09-29']) {
                assert.equal((await get(DAY_QUERY + suffix)).status, 400, suffix);
            }
            assert.ok(pool.calls.every(call => /FROM users\b/.test(call.sql)));
            assert.equal((await get('businessContext=event_genix&dateFrom=2026-09-01&dateTo=2026-10-01')).status, 200);
            assert.equal((await get('businessContext=event_genix&dateFrom=2024-02-29&dateTo=2024-02-29')).status, 200);
        });
    });

    it('fails closed for invalid nonempty IDs and ambiguous query parameters', async () => {
        await withApp({}, async ({ get, pool }) => {
            for (const ids of ['abc', '11,abc', '0', '-1', '1.2', '1e2', '2147483648', ',', '11,,12', 'null', '11 OR 1=1', Array.from({ length: 51 }, (_, i) => i + 1).join(',')]) {
                assert.equal((await get(DAY_QUERY + encodeURIComponent(ids))).status, 400, ids);
            }
            for (const suffix of ['&staffIds=11', '&staffIds[]=11', '&staffIds[x]=11', '&staff_ids=11']) {
                assert.equal((await get(DAY_QUERY + suffix)).status, 400, suffix);
            }
            const response = await get(DAY_QUERY + '&businessContext=event_genix');
            assert.ok([400, 403].includes(response.status));
            assert.ok(pool.calls.every(call => /FROM users\b/.test(call.sql)));
        });
    });

    it('exposes only fields accepted by the inspected Hermes attendance parser', async () => {
        await withApp({}, async ({ get }) => {
            const response = await get();
            // _first_list prefers items; _compact_attendance_cell reads these exact aliases.
            assert.ok(Array.isArray(response.data.items));
            for (const row of response.data.items) {
                assert.deepEqual(Object.keys(row).sort(), ['arrivalTime', 'date', 'staffId', 'staffName', 'status']);
                assert.equal(typeof row.staffId, 'number');
                assert.ok(row.staffName === null || typeof row.staffName === 'string');
                assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
                assert.ok(row.arrivalTime === null || /^\d{2}:\d{2}$/.test(row.arrivalTime));
            }
            assert.doesNotMatch(JSON.stringify(response.data), /private-synthetic|hourly_rate|clock_out|previewId|importId/);
        });
    });

    it('fails a database read without a fallback to schedule, imports, or writes', async () => {
        await withApp({ queryError: true }, async ({ get, pool }) => {
            const response = await get();
            assert.equal(response.status, 500);
            assert.equal(response.data.success, false);
            assert.equal(pool.calls.length, 2);
        });
    });
});
