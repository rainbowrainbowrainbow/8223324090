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

function withAuth(headers = {}) {
    return { ...headers, Authorization: `Bearer ${authToken}` };
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
        '../routes/settings',
        '../routes/landing',
        '../routes/leads',
        '../routes/packages',
        '../routes/tasks',
        '../routes/users',
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

        const { authenticateToken } = require('../middleware/auth');
        authToken = jwt.sign(
            { id: 1, username: 'route-smoke', name: 'Route Smoke', role: 'creator' },
            TEST_JWT_SECRET,
            { expiresIn: '1h' }
        );

        const app = express();
        app.use(express.json());
        app.use('/api', apiAuthBoundary(authenticateToken));
        app.use('/api/landing', require('../routes/landing'));
        app.use('/api/leads', require('../routes/leads'));
        app.use('/api/packages', require('../routes/packages'));
        app.use('/api/tasks', require('../routes/tasks'));
        app.use('/api/users', require('../routes/users'));
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
        assert.ok(roles.data.pageAccess['/dashboard']);
        assert.ok(roles.data.actionPermissions.create_booking);
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
