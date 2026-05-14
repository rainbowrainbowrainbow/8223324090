const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { apiAuthBoundary } = require('../middleware/apiAuthBoundary');
const pkg = require('../package.json');

const TEST_JWT_SECRET = 'route-smoke-jwt-secret';
const TEST_REPORT_KEY = 'route-smoke-report-key';
const TEST_REPORT_SECRET = 'route-smoke-report-secret';
const TEST_TELEGRAM_SECRET = 'route-smoke-telegram-secret';

let server;
let baseUrl;
let authToken;
let queries;
let notifiedLeads;

const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    REPORT_BOT_API_KEY: process.env.REPORT_BOT_API_KEY,
    REPORT_WEBHOOK_SECRET: process.env.REPORT_WEBHOOK_SECRET,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
};

function listen(app) {
    return new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(s) {
    return new Promise((resolve, reject) => {
        s.close(err => err ? reject(err) : resolve());
    });
}

async function request(method, path, body, headers = {}) {
    const reqHeaders = { ...headers };
    if (body !== undefined && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text };
}

function tokenFor(role = 'creator') {
    return jwt.sign(
        {
            id: role === 'creator' ? 1 : role.length + 10,
            username: role === 'creator' ? 'route-smoke' : `${role}-user`,
            name: role === 'creator' ? 'Route Smoke' : `${role} user`,
            role
        },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

function withAuth(headers = {}, role = 'creator') {
    return { ...headers, Authorization: `Bearer ${role === 'creator' ? authToken : tokenFor(role)}` };
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/kleshnya',
        '../services/leadNotifier',
        '../services/report-bot',
        '../services/telegram',
        '../services/chatService',
        '../services/websocket',
        '../services/chat-bot',
        '../services/guardian',
        '../services/linkPreview',
        '../routes/settings',
        '../routes/landing',
        '../routes/leads',
        '../routes/packages',
        '../routes/tasks',
        '../routes/users',
        '../routes/designs',
        '../routes/music',
        '../routes/reports',
        '../routes/dashboard',
        '../routes/analytics',
        '../routes/chat',
        '../routes/report-bot',
        '../routes/telegram'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function createFakePool() {
    return {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });

            if (/^SELECT 1\b/i.test(text)) {
                return { rows: [{ ok: 1 }] };
            }
            if (/SELECT COUNT\(\*\)::int as c FROM users/i.test(text)) {
                return { rows: [{ c: 2 }] };
            }
            if (/INSERT INTO leads/i.test(text)) {
                return {
                    rows: [{
                        id: 501,
                        client_name: params[0],
                        phone: params[1],
                        source: 'landing',
                        status: 'new',
                        created_at: new Date('2026-05-11T00:00:00Z').toISOString()
                    }]
                };
            }
            if (/SELECT id, username, name, role FROM users WHERE is_active = true AND role = ANY\(\$1::text\[\]\)/i.test(text)) {
                return {
                    rows: [
                        { id: 2, username: 'dasha', name: 'Даша', role: 'manager' },
                        { id: 3, username: 'marketing', name: 'Маркетинг', role: 'marketer' }
                    ]
                };
            }
            if (/SELECT id, username, name, role FROM users WHERE COALESCE\(is_active, true\) = true AND role = ANY\(\$1::text\[\]\)/i.test(text)) {
                return {
                    rows: [
                        { id: 2, username: 'dasha', name: 'Даша', role: 'manager' },
                        { id: 3, username: 'marketing', name: 'Маркетинг', role: 'marketer' }
                    ]
                };
            }
            if (/FROM task_action_history/i.test(text)) {
                return { rows: [{
                    id: 41,
                    task_id: params[0],
                    action_type: 'task_completed',
                    actor_user_id: 1,
                    actor_name_snapshot: 'Route Smoke',
                    source_surface: 'task_page',
                    old_value_json: { status: 'todo' },
                    new_value_json: { status: 'done' },
                    meta_json: { route: 'tasks_task_complete' },
                    summary: 'Task completed',
                    created_at: '2099-05-02T12:00:00Z'
                }] };
            }
            if (/INSERT INTO task_action_history/i.test(text)) {
                return { rows: [{
                    id: 42,
                    task_id: params[0],
                    action_type: params[1],
                    actor_user_id: params[2],
                    actor_name_snapshot: params[3],
                    source_surface: params[4],
                    old_value_json: params[5] ? JSON.parse(params[5]) : null,
                    new_value_json: params[6] ? JSON.parse(params[6]) : null,
                    meta_json: params[7] ? JSON.parse(params[7]) : null,
                    summary: params[8],
                    created_at: '2099-05-02T12:05:00Z'
                }] };
            }
            if (/FROM tasks t LEFT JOIN users u ON u\.id = t\.owner_user_id WHERE t\.id = \$1/i.test(text)) {
                return { rows: [{
                    id: params[0],
                    title: 'Route smoke task',
                    status: 'todo',
                    priority: 'high',
                    deadline: '2099-05-02T12:00:00Z',
                    owner_user_id: 1,
                    assigned_to: 'Route Smoke',
                    owner: null,
                    owner_name: 'Route Smoke',
                    owner_username: 'route-smoke',
                    version: 1,
                    active: true,
                    created_at: '2099-05-01T10:00:00Z'
                }] };
            }
            if (/SELECT t\.id FROM tasks t WHERE t\.id = \$1/i.test(text)) {
                return { rows: [{ id: params[0] }] };
            }
            if (/UPDATE tasks/i.test(text) && /SET status = 'done'/i.test(text) && /RETURNING \*/i.test(text)) {
                return { rows: [{
                    id: params[0],
                    title: 'Route smoke task',
                    status: 'done',
                    priority: 'high',
                    deadline: '2099-05-02T12:00:00Z',
                    owner_user_id: 1,
                    assigned_to: 'Route Smoke',
                    completed_at: '2099-05-02T12:05:00Z'
                }] };
            }
            if (/FROM leads l LEFT JOIN users u ON l\.assigned_to = u\.id LEFT JOIN products p ON l\.program_id = p\.id WHERE l\.id = \$1 LIMIT 1/i.test(text)) {
                return {
                    rows: [{
                        id: params[0],
                        client_name: 'Workspace Lead',
                        phone: '+380000000001',
                        instagram: 'workspace_lead',
                        source: 'instagram',
                        source_channel: 'instagram',
                        notes: 'Needs follow-up',
                        status: 'contact',
                        pipeline_stage: 'contacted',
                        assigned_to: 2,
                        assigned_name: 'Dasha Manager',
                        lead_type: 'quality',
                        quality_category: 'birthday',
                        event_date: '2099-05-12',
                        children_count: 12,
                        program_name: 'Quest',
                        booking_id: null,
                        created_at: '2099-05-01T10:00:00Z',
                        updated_at: '2099-05-01T10:00:00Z',
                        last_contact_at: '2099-05-02T10:00:00Z'
                    }]
                };
            }
            if (/FROM customer_cards WHERE lead_id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ lead_id: params[0], event_type: 'birthday', event_date: '2099-05-12', guest_count: 20, notes: 'Card note' }] };
            }
            if (/FROM customers c LEFT JOIN \( SELECT (?:b\.)?customer_id,/i.test(text)) {
                return {
                    rows: [{
                        id: 701,
                        name: 'Workspace Customer',
                        phone: '+380000000001',
                        instagram: 'workspace_lead',
                        child_name: 'Mia',
                        source: 'lead',
                        notes: 'Customer note',
                        real_total_bookings: 1,
                        real_total_spent: 2500,
                        real_last_visit: '2099-05-12',
                        created_at: '2099-05-01T10:00:00Z',
                        updated_at: '2099-05-01T10:00:00Z'
                    }]
                };
            }
            if (/FROM bookings b WHERE \(b\.customer_id = \$1\) AND NULLIF\(b\.linked_to, ''\) IS NULL/i.test(text)) {
                return {
                    rows: [{
                        id: 'BK-WS',
                        date: '2099-05-12',
                        time: '14:00',
                        status: 'confirmed',
                        program_name: 'Quest',
                        category: 'quest',
                        price: 2500,
                        room: 'Room 1',
                        kids_count: 12,
                        customer_id: 701,
                        notes: 'Booking note'
                    }]
                };
            }
            if (/FROM tasks t/i.test(text) && /t\.source_type = 'lead' AND t\.source_id = \$1/i.test(text)) {
                return {
                    rows: [{
                        id: 801,
                        title: 'Call Workspace Customer',
                        description: 'Follow-up for Workspace Lead',
                        status: 'todo',
                        priority: 'high',
                        assigned_to: 'Dasha Manager',
                        owner: 'Dasha Manager',
                        deadline: '2099-05-10T12:00:00Z',
                        category: 'admin',
                        task_type: 'human',
                        source_type: 'lead',
                        source_id: '501',
                        created_at: '2099-05-01T10:00:00Z'
                    }]
                };
            }
            if (/FROM lead_interactions li LEFT JOIN users u ON li\.user_id = u\.id WHERE li\.lead_id = \$1/i.test(text)) {
                return { rows: [{ id: 901, lead_id: params[0], type: 'call', summary: 'Called client', details: 'Asked for date', manager_name: 'Dasha Manager', created_at: '2099-05-02T10:00:00Z' }] };
            }
            if (/FROM communication_log cl LEFT JOIN users u ON cl\.created_by = u\.id WHERE cl\.customer_id = \$1/i.test(text)) {
                return { rows: [{ id: 902, customer_id: params[0], type: 'note', direction: 'internal', summary: 'Customer prefers Telegram', created_by_name: 'Dasha Manager', created_at: '2099-05-02T11:00:00Z' }] };
            }
            if (/FROM conversations c .*LEFT JOIN LATERAL/i.test(text)) {
                return {
                    rows: [{
                        id: 903,
                        channel: 'telegram',
                        customer_name: 'Workspace Customer',
                        customer_phone: '+380000000001',
                        customer_id: 701,
                        status: 'open',
                        assigned_to: 'Dasha Manager',
                        unread_count: 1,
                        last_message_at: '2099-05-02T12:00:00Z',
                        last_inbound_at: '2099-05-01T12:00:00Z',
                        last_outbound_at: '2099-05-02T12:00:00Z',
                        reply_expected: true,
                        awaiting_reply_since: '2099-05-02T12:00:00Z',
                        reply_expected_message_id: 1203,
                        reply_owner: 'Dasha Manager',
                        reply_owner_user_id: 2,
                        reply_sla_at: '2099-05-03T12:00:00Z',
                        reply_expected_delivery_status: 'accepted',
                        last_message: 'Hello'
                    }]
                };
            }
            if (/INSERT INTO tasks \(title, description, date, priority, assigned_to, owner, owner_user_id, created_by,/i.test(text)) {
                return {
                    rows: [{
                        id: 880,
                        title: params[0],
                        description: params[1],
                        date: params[2],
                        priority: params[3],
                        assigned_to: params[4],
                        owner: params[5],
                        owner_user_id: params[6],
                        created_by: params[7],
                        task_type: params[8],
                        deadline: params[9],
                        source_type: params[14],
                        source_id: params[15],
                        category: params[16],
                        status: 'todo'
                    }]
                };
            }
            if (/INSERT INTO task_logs \(task_id, action, old_value, new_value, actor\)/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }
            if (/SELECT id FROM users WHERE id = \$1 AND is_active = true AND role = ANY\(\$2::text\[\]\)/i.test(text)) {
                return { rows: params[0] === 2 ? [{ id: 2 }] : [] };
            }
            if (/UPDATE leads SET .* WHERE id = \$\d+ RETURNING \*/i.test(text)) {
                return {
                    rows: [{
                        id: params[params.length - 1],
                        client_name: 'Lead Smoke',
                        assigned_to: params[0] ?? null,
                        status: 'new'
                    }]
                };
            }
            if (/SELECT \* FROM packages WHERE is_active = true/i.test(text)) {
                return {
                    rows: [
                        { id: 1, code: 'demo', name: 'Demo', is_active: true, sort_order: 1 }
                    ]
                };
            }
            if (/SELECT tag, COUNT\(\*\) as count FROM design_tags GROUP BY tag ORDER BY count DESC, tag ASC/i.test(text)) {
                return { rows: [] };
            }
            if (/FROM announcements/i.test(text) && /total_plays/i.test(text)) {
                return { rows: [{ active: 0, draft: 0, scheduled: 0, total_plays: 0 }] };
            }
            if (/FROM playlists/i.test(text) && /COUNT\(\*\)::int AS total/i.test(text)) {
                return { rows: [{ active: 0, total: 0 }] };
            }
            if (/FROM music_log WHERE action='play' AND created_at>CURRENT_DATE/i.test(text)) {
                return { rows: [{ plays_today: 0 }] };
            }
            if (/SELECT \* FROM accountants ORDER BY is_on_duty DESC, name/i.test(text)) {
                return { rows: [] };
            }
            if (/FROM bookings b LEFT JOIN products p ON p\.id = NULLIF\(b\.program_id, ''\)/i.test(text) && /GROUP BY 1, 2, 3, 4, 5/i.test(text)) {
                return {
                    rows: [
                        {
                            program_key: 'pinata_1',
                            program_id: 'pinata_1',
                            code: 'PIN',
                            name: 'Піньята',
                            category: 'pinata',
                            count: 1,
                            revenue: 1500,
                            paid_amount: 1500,
                            unpaid_amount: 0,
                            avg_price: 1500
                        },
                        {
                            program_key: 'quest_1',
                            program_id: 'quest_1',
                            code: 'Q1',
                            name: 'Квест',
                            category: 'quest',
                            count: 1,
                            revenue: 2200,
                            paid_amount: 1200,
                            unpaid_amount: 1000,
                            avg_price: 2200
                        }
                    ]
                };
            }
            if (/SELECT b\.id, b\.date, b\.time/i.test(text) && /FROM bookings b LEFT JOIN products p ON p\.id = NULLIF\(b\.program_id, ''\)/i.test(text)) {
                return {
                    rows: [
                        {
                            id: 'B1',
                            date: '2099-05-02',
                            time: '12:00',
                            program_key: 'pinata_1',
                            program_id: 'pinata_1',
                            code: 'PIN',
                            name: 'Піньята',
                            category: 'pinata',
                            group_name: 'Свято',
                            customer_name: 'Олена',
                            customer_phone: '+380000000001',
                            room: 'Зал 1',
                            kids_count: 10,
                            price: 1500,
                            paid_amount: 1500,
                            unpaid_amount: 0,
                            payment_status: 'paid',
                            payment_method: 'cash',
                            created_by: 'manager'
                        },
                        {
                            id: 'B2',
                            date: '2099-05-03',
                            time: '14:00',
                            program_key: 'quest_1',
                            program_id: 'quest_1',
                            code: 'Q1',
                            name: 'Квест',
                            category: 'quest',
                            group_name: '',
                            customer_name: 'Ірина',
                            customer_phone: '+380000000002',
                            room: 'Зал 2',
                            kids_count: 8,
                            price: 2200,
                            paid_amount: 1200,
                            unpaid_amount: 1000,
                            payment_status: 'partial',
                            payment_method: 'card',
                            created_by: 'manager'
                        }
                    ]
                };
            }
            if (/FROM bookings(?: b)? WHERE (?:b\.)?date::date >= \$1::date AND (?:b\.)?date::date <= \$2::date/i.test(text)) {
                return {
                    rows: [{
                        revenue: 0,
                        total: 0,
                        confirmed: 0,
                        preliminary: 0,
                        avg_check: 0
                    }]
                };
            }
            if (/FROM finance_transactions WHERE date::date >= \$1::date AND date::date <= \$2::date/i.test(text)) {
                return {
                    rows: [{
                        income: 0,
                        expense: 0,
                        income_count: 0,
                        expense_count: 0
                    }]
                };
            }
            if (/FROM customers WHERE created_at::date >= \$1::date AND created_at::date <= \$2::date/i.test(text)) {
                return { rows: [{ new_customers: 0 }] };
            }
            if (/FROM hr_time_records WHERE record_date >= \$1 AND record_date <= \$2/i.test(text)) {
                return { rows: [{ total_minutes: 0, active_staff: 0 }] };
            }
            if (/SELECT COALESCE\(SUM\((?:b\.)?price\), 0\) as total FROM bookings(?: b)? WHERE (?:b\.)?date = \$1 AND (?:b\.)?status = 'confirmed'/i.test(text)) {
                return { rows: [{ total: 0 }] };
            }
            if (/SELECT COALESCE\(SUM\(amount\), 0\) as total FROM finance_transactions WHERE date = \$1 AND type = 'expense'/i.test(text)) {
                return { rows: [{ total: 0 }] };
            }
            if (/SELECT COUNT\(\*\) as count FROM bookings(?: b)? WHERE (?:b\.)?date = \$1 AND (?:b\.)?status != 'cancelled'/i.test(text)) {
                return { rows: [{ count: 0 }] };
            }

            throw new Error(`Unexpected route-smoke DB query: ${text}`);
        }
    };
}

describe('route-level API safety smoke', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        process.env.REPORT_BOT_API_KEY = TEST_REPORT_KEY;
        process.env.REPORT_WEBHOOK_SECRET = TEST_REPORT_SECRET;
        process.env.WEBHOOK_SECRET = TEST_TELEGRAM_SECRET;
        delete process.env.TELEGRAM_BOT_TOKEN;

        clearModules();
        queries = [];
        notifiedLeads = [];

        const fakePool = createFakePool();
        installMock('../db', { pool: fakePool, query: fakePool.query.bind(fakePool) });
        installMock('../services/leadNotifier', {
            notifyNewLead: async lead => { notifiedLeads.push(lead); }
        });
        installMock('../services/chatService', {
            ensureDefaultMemberships: async () => {},
            getChannels: async () => [{ id: 1, name: 'General', unread: 0 }]
        });
        installMock('../services/websocket', {
            broadcastToChannel: () => {},
            sendToUser: () => {}
        });
        installMock('../services/chat-bot', { processMessage: async () => null });
        installMock('../services/guardian', {});
        installMock('../services/linkPreview', {});

        const { authenticateToken } = require('../middleware/auth');
        authToken = tokenFor('creator');

        const app = express();
        app.use(express.json());
        app.use('/api', apiAuthBoundary(authenticateToken));
        app.use('/api/landing', require('../routes/landing'));
        app.use('/api/leads', require('../routes/leads'));
        app.use('/api/packages', require('../routes/packages'));
        app.use('/api/tasks', require('../routes/tasks'));
        app.use('/api/users', require('../routes/users'));
        app.use('/api/designs', require('../routes/designs'));
        app.use('/api/music', require('../routes/music'));
        app.use('/api/reports', require('../routes/reports'));
        app.use('/api/dashboard', require('../routes/dashboard'));
        app.use('/api/analytics', require('../routes/analytics'));
        app.use('/api/chat-real', require('../routes/chat'));
        app.use('/api/report-bot', require('../routes/report-bot'));
        app.use('/api/telegram', require('../routes/telegram'));

        // Boundary-only chat smoke: the full chat router is DB/WebSocket heavy and
        // remains outside the fast baseline.
        app.get('/api/chat/channels', (req, res) => res.json({ ok: true, user: req.user.username }));

        // Match server.js ordering: generic /api settings routes come after
        // mounted feature routers so their auth wall does not catch public
        // feature endpoints first.
        app.use('/api', require('../routes/settings'));

        ({ server, baseUrl } = await listen(app));
    });

    beforeEach(() => {
        queries.length = 0;
        notifiedLeads.length = 0;
    });

    after(async () => {
        if (server) await close(server);
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        clearModules();
    });

    it('keeps version and health public through the actual settings router', async () => {
        const version = await request('GET', '/api/version');
        assert.equal(version.status, 200, JSON.stringify(version.data));
        assert.equal(version.data.version, pkg.version);
        assert.equal(version.data.name, 'Event Genix');

        const health = await request('GET', '/api/health');
        assert.equal(health.status, 200, JSON.stringify(health.data));
        assert.equal(health.data.version, pkg.version);
        assert.equal(health.data.status, 'ok');
        assert.equal(health.data.database, 'connected');
    });

    it('keeps public landing demo validation available without JWT', async () => {
        const invalid = await request('POST', '/api/landing/demo-request', { name: 'Only Name' });
        assert.equal(invalid.status, 400);

        const valid = await request('POST', '/api/landing/demo-request', {
            name: 'Landing Smoke',
            contact: '@route_smoke',
            package: 'demo'
        });
        assert.equal(valid.status, 200, JSON.stringify(valid.data));
        assert.equal(valid.data.ok, true);
    });

    it('keeps the active leads landing route public and persists the lead shape', async () => {
        const res = await request('POST', '/api/leads/landing', {
            name: 'Lead Smoke',
            phone: '+380000000001',
            package: 'demo'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.id, 501);
        assert.equal(notifiedLeads.length, 1);
        assert.ok(queries.some(q => /INSERT INTO leads/i.test(q.text)));
    });

    it('keeps public package reads open but protects package mutations', async () => {
        const list = await request('GET', '/api/packages');
        assert.equal(list.status, 200, JSON.stringify(list.data));
        assert.equal(list.data.success, true);
        assert.equal(list.data.packages[0].code, 'demo');

        const noAuthPost = await request('POST', '/api/packages', { code: 'x', name: 'X' });
        assert.equal(noAuthPost.status, 401);

        const queryTokenPost = await request('POST', `/api/packages?token=${authToken}`, { code: 'x', name: 'X' });
        assert.equal(queryTokenPost.status, 401);
    });

    it('keeps protected task/user route smoke behind bearer auth', async () => {
        const blocked = await request('GET', '/api/tasks/permissions');
        assert.equal(blocked.status, 401);

        const taskPerms = await request('GET', '/api/tasks/permissions', undefined, withAuth());
        assert.equal(taskPerms.status, 200, JSON.stringify(taskPerms.data));
        assert.equal(taskPerms.data.success, true);
        assert.equal(taskPerms.data.role, 'creator');
        assert.equal(taskPerms.data.permissions.canCreateTasks, true);

        const roles = await request('GET', '/api/users/roles', undefined, withAuth());
        assert.equal(roles.status, 200, JSON.stringify(roles.data));
        assert.ok(roles.data.hierarchy.includes('creator'));
        assert.ok(roles.data.hierarchy.includes('security'));
        assert.ok(roles.data.pageAccess['/dashboard']);
        assert.deepEqual(roles.data.pageAccess['/sales-funnel'], roles.data.pageAccess['/leads']);
        assert.ok(roles.data.pageAccess['/staff'].includes('security'));
        assert.ok(!roles.data.pageAccess['/tasks'].includes('waiter'));
        assert.ok(roles.data.actionPermissions.create_booking);
    });

    it('exposes typed task operations endpoints behind object visibility', async () => {
        const owners = await request('GET', '/api/tasks/owners', undefined, withAuth({}, 'manager'));
        assert.equal(owners.status, 200, JSON.stringify(owners.data));
        assert.equal(owners.data.success, true);
        assert.deepEqual(owners.data.users.map(user => user.id), [2, 3]);
        assert.equal(owners.data.meta.canonicalField, 'tasks.owner_user_id');

        const history = await request('GET', '/api/tasks/1/history?limit=5', undefined, withAuth());
        assert.equal(history.status, 200, JSON.stringify(history.data));
        assert.equal(history.data.success, true);
        assert.equal(history.data.meta.source, 'task_action_history');
        assert.equal(history.data.history[0].actionType, 'task_completed');

        queries.length = 0;
        const completed = await request('POST', '/api/tasks/1/complete', { sourceSurface: 'task_page' }, withAuth());
        assert.equal(completed.status, 200, JSON.stringify(completed.data));
        assert.equal(completed.data.success, true);
        assert.equal(completed.data.historyEvent.actionType, 'task_completed');
        assert.ok(queries.some(q => /UPDATE tasks/i.test(q.text) && /SET status = 'done'/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO task_action_history/i.test(q.text)));
    });

    it('lets lead roles load assignable users without opening user management', async () => {
        const assignees = await request('GET', '/api/leads/assignees', undefined, withAuth({}, 'manager'));
        assert.equal(assignees.status, 200, JSON.stringify(assignees.data));
        assert.equal(assignees.data.success, true);
        assert.deepEqual(assignees.data.users.map(u => u.id), [2, 3]);

        const users = await request('GET', '/api/users', undefined, withAuth({}, 'manager'));
        assert.equal(users.status, 403);
    });

    it('composes the lead manager workspace from the canonical pipeline stage', async () => {
        const res = await request('GET', '/api/leads/501/workspace', undefined, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.workspace.canonical.statusField, 'pipeline_stage');
        assert.equal(res.data.workspace.canonical.stage, 'contacted');
        assert.equal(res.data.workspace.canonical.aggregateStatus, 'contact');
        assert.equal(res.data.workspace.customer.id, 701);
        assert.equal(res.data.workspace.bookings[0].id, 'BK-WS');
        assert.equal(res.data.workspace.tasks[0].sourceType, 'lead');
        assert.equal(res.data.workspace.conversations[0].channel, 'telegram');
        assert.equal(res.data.workspace.conversations[0].confidence, 'exact');
        assert.equal(res.data.workspace.conversations[0].replyOwner, 'Dasha Manager');
        assert.equal(res.data.workspace.conversations[0].replyOwnerUserId, 2);
    });

    it('preserves exact lead source linkage when creating manager callback tasks', async () => {
        const res = await request('POST', '/api/tasks', {
            title: 'Передзвонити клієнту',
            source_type: 'lead',
            source_id: '501',
            category: 'operational',
            priority: 'high'
        }, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.task.source_type, 'lead');
        assert.equal(res.data.task.source_id, '501');
        assert.ok(queries.some(q => /INSERT INTO tasks \(title, description, date, priority/i.test(q.text)
            && q.params[14] === 'lead'
            && q.params[15] === '501'));
    });

    it('validates and applies lead assignee updates', async () => {
        const invalid = await request('PATCH', '/api/leads/501', { assigned_to: 'not-a-user' }, withAuth({}, 'manager'));
        assert.equal(invalid.status, 400, JSON.stringify(invalid.data));
        assert.match(invalid.data.error, /assigned_to/);

        const missing = await request('PATCH', '/api/leads/501', { assigned_to: 999 }, withAuth({}, 'manager'));
        assert.equal(missing.status, 400, JSON.stringify(missing.data));
        assert.match(missing.data.error, /Відповідального/);

        const valid = await request('PATCH', '/api/leads/501', { assigned_to: '2' }, withAuth({}, 'manager'));
        assert.equal(valid.status, 200, JSON.stringify(valid.data));
        assert.equal(valid.data.success, true);
        assert.equal(valid.data.lead.assigned_to, 2);
        assert.ok(queries.some(q => /UPDATE leads SET assigned_to = \$1 WHERE id = \$2 RETURNING \*/i.test(q.text) && q.params[0] === 2));
    });

    it('keeps analytics API access aligned to manager-up roles', async () => {
        const path = '/api/analytics/overview?from=2099-01-01&to=2099-01-01';

        const blocked = await request('GET', path, undefined, withAuth({}, 'admin'));
        assert.equal(blocked.status, 403, JSON.stringify(blocked.data));

        const manager = await request('GET', path, undefined, withAuth({}, 'manager'));
        assert.equal(manager.status, 200, JSON.stringify(manager.data));
        assert.ok(manager.data.bookings, 'manager should receive analytics data');
        assert.ok(manager.data.finance, 'manager should receive finance analytics section');
    });

    it('serves product sales only to manager-up roles and excludes linked bookings', async () => {
        const blocked = await request('GET', '/api/analytics/product-sales?month=2099-05', undefined, withAuth({}, 'admin'));
        assert.equal(blocked.status, 403, JSON.stringify(blocked.data));

        const invalid = await request('GET', '/api/analytics/product-sales?month=bad', undefined, withAuth({}, 'manager'));
        assert.equal(invalid.status, 400, JSON.stringify(invalid.data));

        queries.length = 0;
        const manager = await request('GET', '/api/analytics/product-sales?month=2099-05', undefined, withAuth({}, 'manager'));
        assert.equal(manager.status, 200, JSON.stringify(manager.data));
        assert.equal(manager.data.success, true);
        assert.equal(manager.data.period.month, '2099-05');
        assert.equal(manager.data.totals.count, 2);
        assert.equal(manager.data.totals.revenue, 3700);
        assert.equal(manager.data.totals.programCount, 2);
        assert.equal(manager.data.totals.avgPrice, 1850);
        assert.equal(manager.data.summary[0].category, 'pinata');
        assert.equal(manager.data.details[0].date, '2099-05-02');
        assert.equal(manager.data.summary[0].paidAmount, undefined);
        assert.equal(manager.data.details[0].paymentStatus, undefined);
        assert.ok(queries.some(q => q.text.includes("b.status = 'confirmed'")));
        assert.ok(queries.some(q => q.text.includes("NULLIF(b.linked_to, '') IS NULL")));
    });

    it('exports product sales CSV and XLSX with attachment headers', async () => {
        const csv = await fetch(`${baseUrl}/api/analytics/product-sales/export?month=2099-05&format=csv`, {
            headers: withAuth({}, 'manager')
        });
        assert.equal(csv.status, 200);
        assert.match(csv.headers.get('content-type'), /text\/csv/);
        assert.match(csv.headers.get('content-disposition'), /product_sales_2099-05\.csv/);
        const csvText = await csv.text();
        assert.match(csvText, /"Дата";"Час";"Програма";"Код";"Категорія";"Клієнт\/група";"Кімната";"Дітей";"Сума";"ID бронювання";"Створив"/);
        assert.ok(!csvText.includes('Оплачено'));
        assert.ok(!csvText.includes('Борг'));
        assert.ok(!csvText.includes('Підсумок за'));

        const xlsx = await fetch(`${baseUrl}/api/analytics/product-sales/export?month=2099-05&format=xlsx`, {
            headers: withAuth({}, 'manager')
        });
        assert.equal(xlsx.status, 200);
        assert.match(xlsx.headers.get('content-type'), /spreadsheetml\.sheet/);
        assert.match(xlsx.headers.get('content-disposition'), /product_sales_2099-05\.xlsx/);
        const body = await xlsx.arrayBuffer();
        assert.ok(body.byteLength > 1000);
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(body));
        const summaryHeaders = workbook.getWorksheet('Підсумок').getRow(1).values.join('|');
        const detailHeaders = workbook.getWorksheet('Виписка').getRow(1).values.join('|');
        assert.ok(summaryHeaders.includes('Середній чек'));
        assert.ok(detailHeaders.includes('Клієнт/група'));
        assert.ok(!summaryHeaders.includes('Оплачено'));
        assert.ok(!detailHeaders.includes('Борг'));
    });

    it('enforces sensitive dashboard widget permissions server-side', async () => {
        const managerFinance = await request('GET', '/api/dashboard/widgets/finance_today', undefined, withAuth({}, 'manager'));
        assert.equal(managerFinance.status, 403, JSON.stringify(managerFinance.data));

        const managerDirectorPnl = await request('GET', '/api/dashboard/widgets/director_pnl', undefined, withAuth({}, 'manager'));
        assert.equal(managerDirectorPnl.status, 403, JSON.stringify(managerDirectorPnl.data));

        const accountantFinance = await request('GET', '/api/dashboard/widgets/finance_today', undefined, withAuth({}, 'accountant'));
        assert.equal(accountantFinance.status, 200, JSON.stringify(accountantFinance.data));
        assert.equal(accountantFinance.data.success, true);
        assert.equal(accountantFinance.data.data.profit, 0);
    });

    it('keeps exposed module APIs aligned with page-level role access', async () => {
        const waiterDesigns = await request('GET', '/api/designs/tags', undefined, withAuth({}, 'waiter'));
        assert.equal(waiterDesigns.status, 403, JSON.stringify(waiterDesigns.data));
        const artDesigns = await request('GET', '/api/designs/tags', undefined, withAuth({}, 'art_director'));
        assert.equal(artDesigns.status, 200, JSON.stringify(artDesigns.data));
        assert.deepEqual(artDesigns.data, []);

        const waiterMusic = await request('GET', '/api/music/overview', undefined, withAuth({}, 'waiter'));
        assert.equal(waiterMusic.status, 403, JSON.stringify(waiterMusic.data));
        const artMusic = await request('GET', '/api/music/overview', undefined, withAuth({}, 'art_director'));
        assert.equal(artMusic.status, 200, JSON.stringify(artMusic.data));
        assert.equal(artMusic.data.success, true);

        const managerReports = await request('GET', '/api/reports/accountants', undefined, withAuth({}, 'manager'));
        assert.equal(managerReports.status, 403, JSON.stringify(managerReports.data));
        const accountantReports = await request('GET', '/api/reports/accountants', undefined, withAuth({}, 'accountant'));
        assert.equal(accountantReports.status, 200, JSON.stringify(accountantReports.data));
        assert.deepEqual(accountantReports.data, []);

        const waiterChat = await request('GET', '/api/chat-real/channels', undefined, withAuth({}, 'waiter'));
        assert.equal(waiterChat.status, 403, JSON.stringify(waiterChat.data));
        const animatorChat = await request('GET', '/api/chat-real/channels', undefined, withAuth({}, 'animator'));
        assert.equal(animatorChat.status, 200, JSON.stringify(animatorChat.data));
        assert.equal(animatorChat.data[0].name, 'General');
    });

    it('does not allow broad query-token fallback on chat-adjacent protected routes', async () => {
        const noAuth = await request('GET', '/api/chat/channels');
        assert.equal(noAuth.status, 401);

        const queryToken = await request('GET', `/api/chat/channels?token=${authToken}`);
        assert.equal(queryToken.status, 401);

        const allowed = await request('GET', '/api/chat/channels', undefined, withAuth());
        assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
        assert.equal(allowed.data.user, 'route-smoke');
    });

    it('keeps custom-secret Telegram and report-bot routes secret-gated', async () => {
        const reportMissing = await request('POST', '/api/report-bot/webhook', {});
        assert.equal(reportMissing.status, 403);

        const reportWrong = await request('POST', '/api/report-bot/webhook', {}, {
            'x-telegram-bot-api-secret-token': 'wrong'
        });
        assert.equal(reportWrong.status, 403);

        const reportOk = await request('POST', '/api/report-bot/webhook', {}, {
            'x-telegram-bot-api-secret-token': TEST_REPORT_SECRET
        });
        assert.equal(reportOk.status, 200);

        const telegramWrong = await request('POST', '/api/telegram/webhook', {}, {
            'x-telegram-bot-api-secret-token': 'wrong'
        });
        assert.equal(telegramWrong.status, 403);

        const telegramOk = await request('POST', '/api/telegram/webhook', {}, {
            'x-telegram-bot-api-secret-token': TEST_TELEGRAM_SECRET
        });
        assert.equal(telegramOk.status, 200);
    });

    it('keeps report-bot API-key routes behind the bot API key', async () => {
        const missing = await request('POST', '/api/report-bot/submit', {});
        assert.equal(missing.status, 403);

        const wrong = await request('POST', '/api/report-bot/submit', {}, { 'x-api-key': 'wrong' });
        assert.equal(wrong.status, 403);

        const acceptedKeyInvalidPayload = await request('POST', '/api/report-bot/submit', {}, {
            'x-api-key': TEST_REPORT_KEY
        });
        assert.equal(acceptedKeyInvalidPayload.status, 400);
    });
});
