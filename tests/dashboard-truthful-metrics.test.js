const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'dashboard-truthful-metrics-secret';

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/websocket',
        '../services/workQueue',
        '../routes/dashboard'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

const ROLE_LEVEL = {
    creator: 0,
    director: 1,
    vice_director: 2,
    senior_manager: 3,
    manager: 4,
    accountant: 5,
    art_director: 6,
    marketer: 7,
    it_specialist: 8,
    hr: 9,
    admin: 10,
    security: 11,
    senior_instructor: 12,
    instructor: 13,
    head_chef: 14,
    cook: 15,
    head_pastry: 16,
    pastry_chef: 17,
    animator: 18,
    reception: 19,
    barista: 20,
    wardrobe: 21,
    cleaning: 22,
    maintenance: 23,
    dishwasher: 24,
    waiter: 25
};

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

function tokenFor(role = 'manager') {
    return jwt.sign({ id: 20, username: `${role}-user`, name: `${role} user`, role }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

async function withDashboardApp(fakePool, fn, mocks = {}) {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    clearModules();
    installMock('../db', { pool: fakePool, query: fakePool.query.bind(fakePool) });
    installMock('../middleware/auth', {
        authenticateToken: (req, res, next) => {
            req.user = { id: 20, username: 'senior-manager-user', name: 'Senior manager user', role: 'senior_manager' };
            next();
        },
        canUseAction: () => true,
        ROLE_LEVEL
    });
    installMock('../services/websocket', { getOnlineUserIds: () => new Set() });
    if (mocks.workQueue) installMock('../services/workQueue', mocks.workQueue);

    const app = express();
    app.use(express.json());
    app.use('/api/dashboard', require('../routes/dashboard'));
    const { server, baseUrl } = await listen(app);
    try {
        await fn(baseUrl);
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalSecret;
        clearModules();
    }
}

function normalizedSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

test('quick stats use truthful metric contracts and canonical overdue policy', async () => {
    const queries = [];
    const fakePool = {
        query: async (sql, params = []) => {
            const text = normalizedSql(sql);
            queries.push({ text, params });

            if (/FROM bookings b/i.test(text) && /b\.status != 'cancelled'/i.test(text)) {
                return { rows: [{ count: 3 }] };
            }
            if (/FROM tasks t/i.test(text) && /t\.status = 'in_progress'/i.test(text)) {
                return { rows: [{ count: 5 }] };
            }
            if (/FROM bookings b/i.test(text) && /SUM\(b\.price\)/i.test(text) && /b\.status = 'confirmed'/i.test(text)) {
                return { rows: [{ total: '12800' }] };
            }
            if (/FROM tasks t/i.test(text) && /COUNT\(\*\) as count/i.test(text) && /task_action_history/i.test(text)) {
                assert.match(text, /snoozed_until IS NOT NULL AND t\.snoozed_until > NOW\(\)/);
                assert.match(text, /COALESCE\(\s*\(t\.scheduled_start_at AT TIME ZONE 'Europe\/Kyiv'\)::date/);
                assert.doesNotMatch(text, /t\.deadline < NOW\(\) AND COALESCE\(t\.status, 'todo'\) NOT IN/);
                return { rows: [{ count: 2 }] };
            }
            if (/FROM bookings b/i.test(text) && /b\.status = 'preliminary'/i.test(text)) {
                return { rows: [{ count: 1 }] };
            }
            if (/FROM warehouse_stock ws/i.test(text)) {
                return { rows: [{ count: 4 }] };
            }
            if (/FROM leads l/i.test(text)) {
                assert.match(text, /COALESCE\(l\.pipeline_stage, 'new'\) <> ALL\(\$1::text\[\]\)/);
                assert.match(text, /COALESCE\(l\.last_contact_at, l\.created_at\) < NOW\(\) - INTERVAL '48 hours'/);
                assert.deepEqual(params[0], ['completed', 'closed', 'lost']);
                return { rows: [{ count: 6 }] };
            }
            throw new Error(`Unexpected quick stats query: ${text}`);
        }
    };

    await withDashboardApp(fakePool, async baseUrl => {
        const res = await fetch(`${baseUrl}/api/dashboard/widgets/quick_stats`, {
            headers: { Authorization: `Bearer ${tokenFor('manager')}` }
        });
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.data.activeTasks, 5);
        assert.equal(data.data.revenueToday, 12800);
        assert.equal(data.data.overdueTasks, 2);
        assert.equal(data.data.coldLeads, 6);
        assert.equal(data.data.needsAttention, 13);
        assert.equal(data.data.meta.period.timezone, 'Europe/Kyiv');
        assert.match(data.data.meta.metricContracts.revenueToday, /not payments or profit/);
        assert.match(data.data.meta.metricContracts.needsAttention, /not a score/);
    });

    assert.equal(queries.filter(query => /FROM bookings b|FROM tasks t|FROM leads l|FROM warehouse_stock ws/i.test(query.text)).length, 7);
});

test('my focus overdue count follows the same canonical policy as task KPIs', async () => {
    const fakePool = {
        query: async (sql) => {
            const text = normalizedSql(sql);
            if (/SELECT t\.id, t\.title, t\.status/i.test(text) && /ORDER BY CASE WHEN COALESCE\(t\.focus_rank, 0\) > 0 THEN 0 ELSE 1 END/i.test(text)) {
                return { rows: [] };
            }
            if (/COUNT\(\*\) FILTER/i.test(text) && /AS overdue_count/i.test(text)) {
                assert.match(text, /task_action_history/);
                assert.match(text, /snoozed_until IS NOT NULL AND t\.snoozed_until > NOW\(\)/);
                assert.match(text, /AT TIME ZONE 'Europe\/Kyiv'\)::date/);
                assert.doesNotMatch(text, /t\.deadline IS NOT NULL AND t\.deadline < NOW\(\)/);
                return { rows: [{ overdue_count: 1, waiting_count: 2 }] };
            }
            throw new Error(`Unexpected my focus query: ${text}`);
        }
    };

    await withDashboardApp(fakePool, async baseUrl => {
        const res = await fetch(`${baseUrl}/api/dashboard/widgets/my_focus`, {
            headers: { Authorization: `Bearer ${tokenFor('manager')}` }
        });
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.deepEqual(data.data.tasks, []);
        assert.equal(data.data.overdueCount, 1);
        assert.equal(data.data.waitingCount, 2);
    });
});

test('nearest event searches the next visible booking today and then tomorrow with preparation tasks', async () => {
    const queries = [];
    const fakePool = {
        query: async (sql, params = []) => {
            const text = normalizedSql(sql);
            queries.push({ text, params });
            if (/FROM bookings b/i.test(text) && /LIMIT 1/i.test(text)) {
                if (/::time >= \$2::time/i.test(text)) {
                    assert.equal(params.length >= 2, true, 'today search must include current Kyiv time');
                    return { rows: [] };
                }
                assert.doesNotMatch(text, /::time >= \$2::time/i, 'tomorrow search must not filter out morning bookings');
                return {
                    rows: [{
                        id: 77,
                        date: params[0],
                        client_name: 'Test client',
                        program: 'Test program',
                        start_time: '09:30:00',
                        room: 'KB1',
                        status: 'confirmed',
                        confirmed_at: '2026-09-14T08:00:00Z',
                        responsible_name: 'Admin'
                    }]
                };
            }
            if (/FROM tasks t/i.test(text) && /t\.source_type = 'booking'/i.test(text)) {
                assert.deepEqual(params[0], '77');
                return {
                    rows: [{
                        id: 12,
                        title: 'Prepare room',
                        status: 'todo',
                        priority: 'high',
                        deadline: '2026-09-15T06:00:00Z',
                        preparation_total: 1,
                        preparation_open: 1,
                        preparation_done: 0,
                        preparation_overdue: 0
                    }]
                };
            }
            throw new Error(`Unexpected nearest event query: ${text}`);
        }
    };

    await withDashboardApp(fakePool, async baseUrl => {
        const res = await fetch(`${baseUrl}/api/dashboard/widgets/nearest_event`, {
            headers: { Authorization: `Bearer ${tokenFor('manager')}` }
        });
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.data.event.id, 77);
        assert.equal(data.data.event.dateScope, 'tomorrow');
        assert.equal(data.data.meta.dateScope, 'tomorrow');
        assert.equal(data.data.meta.lookaheadDays, 1);
        assert.equal(data.data.preparation.totalCount, 1);
        assert.equal(data.data.preparation.noTasksMeans, 'unknown');
    });

    assert.equal(queries.filter(query => /FROM bookings b/i.test(query.text) && /LIMIT 1/i.test(query.text)).length, 2);
    assert.equal(queries.filter(query => /FROM tasks t/i.test(query.text) && /source_type = 'booking'/i.test(query.text)).length, 1);
});

test('funnel widget preserves source warnings instead of turning partial data into calm zero', async () => {
    const fakePool = { query: async () => { throw new Error('pool should not be called directly'); } };
    const workQueue = {
        buildWorkQueue: async () => ({
            meta: {
                funnelInsights: { total: 0, waitingAction: 0, stages: [], href: '/sales-funnel' },
                warnings: [
                    { source: 'leads_funnel_summary', error: 'database unavailable' },
                    { source: 'tasks_today', error: 'ignored for funnel summary' }
                ]
            }
        })
    };

    await withDashboardApp(fakePool, async baseUrl => {
        const res = await fetch(`${baseUrl}/api/dashboard/widgets/funnel`, {
            headers: { Authorization: `Bearer ${tokenFor('manager')}` }
        });
        const data = await res.json();

        assert.equal(res.status, 200, JSON.stringify(data));
        assert.equal(data.success, true);
        assert.equal(data.data.meta.partial, true);
        assert.equal(data.data.meta.sourceErrors.length, 1);
        assert.equal(data.data.meta.sourceErrors[0].source, 'leads_funnel_summary');
        assert.equal(data.data.meta.warnings.length, 2);
    }, { workQueue });
});
