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

const ROLE_LEVEL = Object.fromEntries(require('../services/accountAccessPolicy').ROLE_HIERARCHY.map((role, index) => [role, index]));

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
            req.user = { id: 20, username: 'senior-manager-user', name: 'Senior manager user', role: mocks.role || 'senior_manager', ...(mocks.user || {}) };
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
            if (/WITH candidates AS/i.test(text)) {
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


test('focus totals are independent of previews and rank-zero tasks remain recommendations', async () => {
    const fakePool = { query: async sql => {
        const text = normalizedSql(sql);
        if (/WITH candidates AS/.test(text)) {
            assert.match(text, /PARTITION BY \(COALESCE\(t.focus_rank, 0\) > 0\)/);
            assert.match(text, /snoozed_until IS NOT NULL AND t.snoozed_until > NOW\(\)/);
            assert.match(text, /t.archived_at IS NULL/);
            assert.match(text, /'completed', 'complete', 'cancelled', 'canceled', 'archived'/);
            assert.match(text, /COALESCE\(t.visibility, 'team'\) = 'team'/);
            assert.match(text, /COALESCE\(t.business_context, 'event_genix'\)/);
            return { rows: [
                { id: 1, title: 'Selected task', focus_rank: 2, status: 'todo', effective_date: '2026-09-15', scheduled_start_at: '2026-09-15T07:00:00Z', deadline: '2026-02-01T09:00:00Z', is_overdue: false },
                { id: 2, title: 'Suggested task', focus_rank: 0, status: 'todo', is_overdue: false }
            ] };
        }
        assert.match(text, /COUNT\(\*\) FILTER \(WHERE COALESCE\(t.focus_rank, 0\) > 0\)/);
        assert.doesNotMatch(text, /LIMIT\s+\d+\s*$/);
        return { rows: [{ selected_count: 12, recommended_count: 28, actionable_count: 40, overdue_count: 0, waiting_count: 4 }] };
    } };
    await withDashboardApp(fakePool, async baseUrl => {
        const res = await fetch(`${baseUrl}/api/dashboard/widgets/my_focus`);
        const { data } = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.selectedCount, 12);
        assert.equal(data.recommendedCount, 28);
        assert.equal(data.actionableCount, 40);
        assert.equal(data.selectedTasks.length, 1);
        assert.equal(data.recommendedTasks.length, 1);
        assert.equal(data.selectedTasks[0].isSelectedFocus, true);
        assert.equal(data.recommendedTasks[0].isSelectedFocus, false);
        assert.equal(data.selectedTasks[0].effectiveDueAt, '2026-09-15T07:00:00Z');
        assert.equal(data.selectedTasks[0].isOverdue, false);
        assert.equal(data.meta.sourceStates.tasks, 'ready');
    });
});

test('finance scopes every source and preserves failed expenses as unknown instead of fabricated profit', async () => {
    const queries = [];
    const fakePool = { query: async (sql, params) => {
        const text = normalizedSql(sql); queries.push(text);
        assert.ok(params.includes('event_genix'));
        if (/FROM finance_transactions ft/.test(text)) {
            assert.match(text, /COALESCE\(ft.business_context, 'event_genix'\)/);
            throw new Error('planned finance source failure');
        }
        assert.match(text, /COALESCE\(b.business_context, 'event_genix'\)/);
        return { rows: [/SUM/.test(text) ? { total: '1900' } : { count: '3' }] };
    } };
    await withDashboardApp(fakePool, async baseUrl => {
        const res = await fetch(`${baseUrl}/api/dashboard/widgets/finance_today`);
        const { data } = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.bookingValue, 1900);
        assert.equal(data.revenue, 1900);
        assert.equal(data.expenses, null);
        assert.equal(data.profit, null);
        assert.equal(data.meta.partial, true);
        assert.equal(data.meta.sourceStates.expenses, 'error');
        assert.equal(data.meta.warnings[0].source, 'expenses');
    });
    assert.equal(queries.length, 3);
});

test('new stage leads expose full matching count rather than preview length', async () => {
    await withDashboardApp({ query: async sql => {
        assert.match(normalizedSql(sql), /COUNT\(\*\) OVER\(\)::int AS total_count/);
        return { rows: [{ id: 4, name: 'Lead', total_count: 28 }] };
    } }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/dashboard/widgets/leads_new`);
        const { data } = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.total, 28);
        assert.equal(data.leads.length, 1);
        assert.match(data.href, /stage=new/);
    });
});

test('content tasks apply existing private visibility and business scope while unavailable art stays unknown', async () => {
    const queries = [];
    await withDashboardApp({ query: async sql => {
        const text = normalizedSql(sql); queries.push(text);
        assert.match(text, /FROM tasks WHERE category = 'improvement'/);
        assert.match(text, /COALESCE\(tasks.visibility, 'team'\) = 'team'/);
        assert.match(text, /COALESCE\(tasks.business_context, 'event_genix'\)/);
        assert.match(text, /tasks.archived_at IS NULL/);
        return { rows: [] };
    } }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/dashboard/widgets/content_pipeline`);
        const { data } = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(data.designTasks, []);
        assert.equal(data.approvedThisWeek, null);
        assert.equal(data.meta.sourceStates.designTasks, 'ready');
        assert.equal(data.meta.sourceStates.inReview, 'unavailable');
    }, { role: 'art_director' });
    assert.equal(queries.length, 1);
});

test('HR birthdays query crosses month and year boundaries without inventing contract expiry from hire date', async () => {
    const queries = [];
    await withDashboardApp({ query: async sql => {
        const text = normalizedSql(sql); queries.push(text);
        if (/birth_date/.test(text)) {
            assert.match(text, /generate_series\(\$1::date, \$2::date, INTERVAL '1 day'\)/);
            throw new Error('planned birthdays failure');
        }
        assert.doesNotMatch(text, /hire_date/);
        return { rows: [] };
    } }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/dashboard/widgets/hr_overview`);
        const { data } = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.meta.sourceStates.birthdays, 'error');
        assert.equal(data.meta.contractsExpiryAvailable, false);
        assert.equal(data.meta.partial, true);
    }, { role: 'hr', user: { businessMembershipAccess: { membershipEnabled: false, invalid: false, registry: [] } } });
    assert.equal(queries.length, 3);
});


test('funnel keeps the earliest follow-up independently of an earlier task bucket', async () => {
    const callback = { id: 'callback:1', bucket: 'callback_due', title: 'Call client', dueAt: '2026-09-14T09:00:00Z', href: '/sales-funnel?lead=17&businessContext=event_genix' };
    const workQueue = { buildWorkQueue: async ({ limit }) => {
        assert.equal(limit, 1, 'one item per SQL source is sufficient for the next recommendation');
        return { items: [{ bucket: 'overdue', title: 'Old task' }, callback],
            buckets: [{ key: 'overdue', items: [{ bucket: 'overdue', title: 'Old task' }] }, { key: 'callback_due', items: [callback] }],
            meta: { funnelInsights: {}, warnings: [] } };
    } };
    await withDashboardApp({ query: async () => { throw new Error('duplicate source load'); } }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/dashboard/widgets/funnel`);
        const { data } = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(data.meta.followUps, [callback]);
        assert.equal(data.meta.sourceStates.followUps, 'ready');
        assert.equal(data.meta.partial, false);
    }, { workQueue });
});

test('booking and finance aggregation bind the currently selected business on every request', async () => {
    const bindings = [];
    const fakePool = { query: async (sql, params) => {
        const text = normalizedSql(sql);
        assert.match(text, /COALESCE\([a-z]+.business_context, 'event_genix'\) = \$\d+/);
        const context = params.at(-1);
        assert.ok(['dar', 'event_genix'].includes(context));
        bindings.push(context);
        return { rows: [/SUM/.test(text) ? { total: context === 'dar' ? 200 : 100 } : { count: context === 'dar' ? 2 : 1 }] };
    } };
    await withDashboardApp(fakePool, async baseUrl => {
        for (const context of ['event_genix', 'dar']) {
            const response = await fetch(`${baseUrl}/api/dashboard/widgets/finance_today?businessContext=${context}`);
            const { data } = await response.json();
            assert.equal(response.status, 200);
            assert.equal(data.bookingValue, context === 'dar' ? 200 : 100);
            assert.equal(data.meta.businessScope.activeContext, context);
        }
    }, { role: 'director' });
    assert.deepEqual(bindings, ['event_genix', 'event_genix', 'event_genix', 'dar', 'dar', 'dar']);
});
