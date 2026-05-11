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
            if (/FROM bookings WHERE date::date >= \$1::date AND date::date <= \$2::date/i.test(text)) {
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
            if (/SELECT COALESCE\(SUM\(price\), 0\) as total FROM bookings WHERE date = \$1 AND status = 'confirmed'/i.test(text)) {
                return { rows: [{ total: 0 }] };
            }
            if (/SELECT COALESCE\(SUM\(amount\), 0\) as total FROM finance_transactions WHERE date = \$1 AND type = 'expense'/i.test(text)) {
                return { rows: [{ total: 0 }] };
            }
            if (/SELECT COUNT\(\*\) as count FROM bookings WHERE date = \$1 AND status != 'cancelled'/i.test(text)) {
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

    it('keeps analytics API access aligned to manager-up roles', async () => {
        const path = '/api/analytics/overview?from=2099-01-01&to=2099-01-01';

        const blocked = await request('GET', path, undefined, withAuth({}, 'admin'));
        assert.equal(blocked.status, 403, JSON.stringify(blocked.data));

        const manager = await request('GET', path, undefined, withAuth({}, 'manager'));
        assert.equal(manager.status, 200, JSON.stringify(manager.data));
        assert.ok(manager.data.bookings, 'manager should receive analytics data');
        assert.ok(manager.data.finance, 'manager should receive finance analytics section');
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
