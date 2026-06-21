const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const fixtureRows = Object.freeze({
    leads: [
        { business_context: 'event_genix', new_count: 4, hot_count: 2 },
        { business_context: 'maysternya_doli', new_count: 3, hot_count: 1 },
        { business_context: 'dar', new_count: 7, hot_count: 4 }
    ],
    tasks: [
        { business_context: 'event_genix', active_count: 5, overdue_count: 1 },
        { business_context: 'maysternya_doli', active_count: 2, overdue_count: 0 },
        { business_context: 'dar', active_count: 8, overdue_count: 3 }
    ],
    urgent: [
        { business_context: 'event_genix', urgent_count: 1 },
        { business_context: 'maysternya_doli', urgent_count: 2 },
        { business_context: 'dar', urgent_count: 0 }
    ],
    unconfirmed: [
        { business_context: 'event_genix', unconfirmed_count: 2 },
        { business_context: 'maysternya_doli', unconfirmed_count: 1 }
    ],
    lowStock: [
        { business_context: 'event_genix', low_stock_count: 1 },
        { business_context: 'maysternya_doli', low_stock_count: 2 },
        { business_context: 'dar', low_stock_count: 3 }
    ],
    openShifts: [
        { business_context: 'maysternya_doli', open_shift_count: 1 }
    ],
    todayBookings: [
        { business_context: 'event_genix', today_booking_count: 4 },
        { business_context: 'maysternya_doli', today_booking_count: 5 },
        { business_context: 'dar', today_booking_count: 2 }
    ],
    cold: [
        { business_context: 'event_genix', cold_count: 9 },
        { business_context: 'maysternya_doli', cold_count: 0 },
        { business_context: 'dar', cold_count: 1 }
    ]
});

let server;
let baseUrl;
let queryLog;
let originalDbModule;
let originalAuthModule;
let settingsModuleId;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
    return id;
}

function roleUser(req) {
    const role = String(req.headers['x-test-role'] || 'creator');
    const contextHeader = req.headers['x-test-business-contexts'];
    const defaultContext = req.headers['x-test-default-business-context'];
    const businessContexts = contextHeader
        ? String(contextHeader).split(',').map(value => value.trim()).filter(Boolean)
        : (role === 'creator' ? ['event_genix', 'dar', 'maysternya_doli', 'crm'] : ['event_genix']);

    return {
        id: role === 'creator' ? 1 : 20,
        username: `${role}-tester`,
        name: `${role} tester`,
        role,
        business_contexts: businessContexts,
        default_business_context: defaultContext || businessContexts[0]
    };
}

function mockAuthExports() {
    const pass = () => (_req, _res, next) => next();
    return {
        authenticateToken(req, _res, next) {
            req.user = roleUser(req);
            next();
        },
        requireRole: pass,
        requireMinRole: pass
    };
}

function mockQuery(sql, params = []) {
    queryLog.push({ sql, params });
    if (/AS new_count/.test(sql)) return Promise.resolve({ rows: fixtureRows.leads });
    if (/AS active_count/.test(sql)) return Promise.resolve({ rows: fixtureRows.tasks });
    if (/AS urgent_count/.test(sql)) return Promise.resolve({ rows: fixtureRows.urgent });
    if (/AS unconfirmed_count/.test(sql)) return Promise.resolve({ rows: fixtureRows.unconfirmed });
    if (/AS low_stock_count/.test(sql)) return Promise.resolve({ rows: fixtureRows.lowStock });
    if (/AS open_shift_count/.test(sql)) return Promise.resolve({ rows: fixtureRows.openShifts });
    if (/AS today_booking_count/.test(sql)) return Promise.resolve({ rows: fixtureRows.todayBookings });
    if (/AS cold_count/.test(sql)) return Promise.resolve({ rows: fixtureRows.cold });
    return Promise.reject(new Error(`Unexpected SQL in business live counters test: ${sql.slice(0, 120)}`));
}

function listen(app) {
    return new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => {
            const { port } = instance.address();
            resolve({ server: instance, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(instance) {
    return new Promise((resolve, reject) => {
        instance.close(err => err ? reject(err) : resolve());
    });
}

async function request(path, headers = {}) {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    const text = await res.text();
    return {
        status: res.status,
        data: text ? JSON.parse(text) : null
    };
}

test.before(async () => {
    queryLog = [];
    const dbModuleId = require.resolve('../db');
    const authModuleId = require.resolve('../middleware/auth');
    settingsModuleId = require.resolve('../routes/settings');
    originalDbModule = require.cache[dbModuleId];
    originalAuthModule = require.cache[authModuleId];

    installMock('../db', { pool: { query: mockQuery } });
    installMock('../middleware/auth', mockAuthExports());
    delete require.cache[settingsModuleId];

    const app = express();
    app.use(express.json());
    app.use('/api', require('../routes/settings'));
    const listener = await listen(app);
    server = listener.server;
    baseUrl = listener.baseUrl;
});

test.after(async () => {
    if (server) await close(server);
    delete require.cache[settingsModuleId];
    if (originalDbModule) require.cache[require.resolve('../db')] = originalDbModule;
    else delete require.cache[require.resolve('../db')];
    if (originalAuthModule) require.cache[require.resolve('../middleware/auth')] = originalAuthModule;
    else delete require.cache[require.resolve('../middleware/auth')];
});

test.beforeEach(() => {
    queryLog = [];
});

test('business live counters returns read-only multi-scope totals and per-business counters', async () => {
    const response = await request('/api/business/live-counters?businessScope=multi&businessContexts=event_genix,maysternya_doli');

    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.deepEqual(response.data.scope, {
        mode: 'multi',
        activeContext: 'event_genix',
        selectedContexts: ['event_genix', 'maysternya_doli'],
        readOnly: true,
        canWrite: false
    });
    assert.deepEqual(response.data.counters.byBusiness.event_genix, {
        leads: { new: 4, hot: 2 },
        tasks: { active: 5, overdue: 1 },
        alerts: { active: 7 }
    });
    assert.deepEqual(response.data.counters.byBusiness.maysternya_doli, {
        leads: { new: 3, hot: 1 },
        tasks: { active: 2, overdue: 0 },
        alerts: { active: 5 }
    });
    assert.deepEqual(response.data.counters.total, {
        leads: { new: 7, hot: 3 },
        tasks: { active: 7, overdue: 1 },
        alerts: { active: 12 }
    });
    assert.equal(queryLog.length, 8);
    assert.ok(queryLog.every(entry => /SELECT/i.test(entry.sql)));
});

test('business live counters keeps single-scope responses writable and context-limited', async () => {
    const response = await request('/api/business/live-counters?businessContext=maysternya_doli', {
        'x-test-business-contexts': 'event_genix,maysternya_doli',
        'x-test-default-business-context': 'maysternya_doli'
    });

    assert.equal(response.status, 200);
    assert.equal(response.data.scope.mode, 'single');
    assert.equal(response.data.scope.activeContext, 'maysternya_doli');
    assert.deepEqual(response.data.scope.selectedContexts, ['maysternya_doli']);
    assert.equal(response.data.scope.readOnly, false);
    assert.equal(response.data.scope.canWrite, true);
    assert.deepEqual(Object.keys(response.data.counters.byBusiness), ['maysternya_doli']);
    assert.deepEqual(response.data.counters.total, {
        leads: { new: 3, hot: 1 },
        tasks: { active: 2, overdue: 0 },
        alerts: { active: 5 }
    });
});

test('business live counters all-scope includes every allowed business on the same code path', async () => {
    const response = await request('/api/business/live-counters?businessScope=all');

    assert.equal(response.status, 200);
    assert.equal(response.data.scope.mode, 'all');
    assert.equal(response.data.scope.readOnly, true);
    assert.equal(response.data.scope.canWrite, false);
    assert.deepEqual(response.data.scope.selectedContexts, ['event_genix', 'dar', 'maysternya_doli', 'crm']);
    assert.deepEqual(Object.keys(response.data.counters.byBusiness), ['event_genix', 'dar', 'maysternya_doli', 'crm']);
    assert.deepEqual(response.data.counters.byBusiness.crm, {
        leads: { new: 0, hot: 0 },
        tasks: { active: 0, overdue: 0 },
        alerts: { active: 0 }
    });
    assert.deepEqual(response.data.counters.total, {
        leads: { new: 14, hot: 7 },
        tasks: { active: 15, overdue: 4 },
        alerts: { active: 20 }
    });
});

test('business live counters rejects a disallowed single business context before querying', async () => {
    const response = await request('/api/business/live-counters?businessContext=maysternya_doli', {
        'x-test-role': 'manager'
    });

    assert.equal(response.status, 403);
    assert.equal(response.data.success, false);
    assert.equal(response.data.code, 'business_context_unavailable');
    assert.equal(queryLog.length, 0);
});

test('business live counters keeps lower roles locked to event_genix by default', async () => {
    const response = await request('/api/business/live-counters', {
        'x-test-role': 'manager'
    });

    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.deepEqual(response.data.scope, {
        mode: 'single',
        activeContext: 'event_genix',
        selectedContexts: ['event_genix'],
        readOnly: false,
        canWrite: true
    });
    assert.deepEqual(Object.keys(response.data.counters.byBusiness), ['event_genix']);
    assert.deepEqual(response.data.counters.byBusiness.event_genix, {
        leads: { new: 4, hot: 2 },
        tasks: { active: 5, overdue: 1 },
        alerts: { active: 7 }
    });
    assert.deepEqual(response.data.counters.total, response.data.counters.byBusiness.event_genix);
    assert.equal(queryLog.length, 8);
});
