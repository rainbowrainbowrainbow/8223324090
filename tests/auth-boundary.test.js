const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { apiAuthBoundary, isPublicApiRequest, isQueryTokenAuthAllowed } = require('../middleware/apiAuthBoundary');
const { createHermesRouter } = require('../routes/hermes');

function strictJwt(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Authentication required' });
    if (auth !== 'Bearer allowed-token') return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = { id: 1, username: 'auth-boundary-test', role: 'creator' };
    next();
}

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

async function request(baseUrl, method, path, body, headers = {}) {
    const reqHeaders = { ...headers };
    if (body !== undefined && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
    return { status: res.status, data, text };
}

function hermesBoundaryTestAuth(req, res, next) {
    const key = String(req.headers['x-api-key'] || '').trim();
    if (!key) {
        return res.status(401).json({
            success: false,
            code: 'HERMES_AUTH_REQUIRED'
        });
    }
    if (key !== 'unit-hermes-key') {
        return res.status(401).json({
            success: false,
            code: 'HERMES_AUTH_INVALID'
        });
    }

    req.user = { id: 42, username: 'hermes.actor', role: 'director' };
    req.integration = {
        id: 'hermes-event-genix-crm',
        source: 'hermes',
        authMode: 'x-api-key',
        actorUserId: 42
    };
    return next();
}

describe('API auth boundary middleware', () => {
    let server;
    let baseUrl;

    before(async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;

        const app = express();
        app.use(express.json());
        app.use('/api', apiAuthBoundary(strictJwt));
        app.use('/api/landing', require('../routes/landing'));
        app.get('/api/status/public', (req, res) => res.json({ ok: true, public: true }));
        app.post('/api/leads/landing', (req, res) => res.json({ ok: true, public: true }));
        app.post('/api/leads/webhook/universal', (req, res) => res.json({ ok: true, public: true, webhook: true }));
        app.post('/api/leads/webhook/maysternya-booking', (req, res) => res.json({ ok: true, public: true, webhook: 'maysternya-booking' }));
        app.post('/api/leads/webhook/maysternya-availability', (req, res) => res.json({ ok: true, public: true, webhook: 'maysternya-availability' }));
        app.get('/api/leads/webhook/status', (req, res) => res.json({ ok: true, public: true, readiness: true }));
        app.post('/api/omni/webhook/telegram', (req, res) => res.json({ ok: true, public: true, provider: 'telegram' }));
        app.use('/api/hermes', createHermesRouter({ authMiddleware: hermesBoundaryTestAuth }));
        app.get('/api/bookings', (req, res) => res.json({ ok: true, protected: true }));
        app.get('/api/graduation/catalog/export', (req, res) => {
            res.json({ ok: true, auth: req.headers.authorization, user: req.user?.username });
        });
        app.get('/api/graduation/quotes/:id/proposal', (req, res) => {
            res.json({ ok: true, auth: req.headers.authorization, quoteId: req.params.id });
        });

        ({ server, baseUrl } = await listen(app));
    });

    after(async () => {
        await close(server);
    });

    it('marks intended public endpoints as public', () => {
        assert.equal(isPublicApiRequest({ method: 'POST', path: '/landing/demo-request' }), true);
        assert.equal(isPublicApiRequest({ method: 'POST', path: '/leads/landing' }), true);
        assert.equal(isPublicApiRequest({ method: 'POST', path: '/leads/webhook/universal' }), true);
        assert.equal(isPublicApiRequest({ method: 'POST', path: '/leads/webhook/maysternya-booking' }), true);
        assert.equal(isPublicApiRequest({ method: 'POST', path: '/leads/webhook/maysternya-availability' }), true);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/leads/webhook/status' }), true);
        assert.equal(isPublicApiRequest({ method: 'POST', path: '/omni/webhook/telegram' }), true);
        assert.equal(isPublicApiRequest({ method: 'POST', path: '/music/library/generate-music/callback' }), true);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/hermes/capabilities' }), true);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/status/public' }), true);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/health' }), true);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/ready' }), true);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/health/deep' }), true);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/bookings' }), false);
    });

    it('allows the landing demo request without JWT', async () => {
        const res = await request(baseUrl, 'POST', '/api/landing/demo-request', {
            name: 'Boundary Test',
            contact: '@boundary',
            package: 'demo'
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.ok, true);
    });

    it('allows the active landing lead endpoint through the public boundary', async () => {
        const res = await request(baseUrl, 'POST', '/api/leads/landing', {
            name: 'Boundary Test',
            phone: '+380000000000',
            package: 'demo'
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.public, true);
    });

    it('allows the universal lead webhook through the public boundary', async () => {
        const res = await request(baseUrl, 'POST', '/api/leads/webhook/universal?source=maysternya_bot', {
            external_id: 'boundary-telegram-id',
            name: 'Boundary Test'
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.webhook, true);
    });

    it('allows universal webhook readiness status without JWT', async () => {
        const res = await request(baseUrl, 'GET', '/api/leads/webhook/status');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.readiness, true);
    });

    it('allows Maysternya booking webhook through the public boundary', async () => {
        const res = await request(baseUrl, 'POST', '/api/leads/webhook/maysternya-booking', {
            external_id: 'boundary-md-booking'
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.webhook, 'maysternya-booking');
    });

    it('allows Maysternya availability webhook through the public boundary', async () => {
        const res = await request(baseUrl, 'POST', '/api/leads/webhook/maysternya-availability', {
            date_from: '2099-06-14',
            date_to: '2099-06-14',
            duration: 60,
            resource_id: 'md-consult-room'
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.webhook, 'maysternya-availability');
    });

    it('allows Omni Telegram inbox webhook updates without user JWT', async () => {
        const res = await request(baseUrl, 'POST', '/api/omni/webhook/telegram', {
            update_id: 1,
            message: { message_id: 1, text: '/start', chat: { id: 123, type: 'private' } }
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.provider, 'telegram');
    });

    it('lets Hermes reach route-level custom-secret auth without becoming open', async () => {
        const missing = await request(baseUrl, 'GET', '/api/hermes/capabilities');
        assert.equal(missing.status, 401);
        assert.equal(missing.data.code, 'HERMES_AUTH_REQUIRED');

        const wrong = await request(baseUrl, 'GET', '/api/hermes/capabilities', undefined, {
            'x-api-key': 'wrong-key'
        });
        assert.equal(wrong.status, 401);
        assert.equal(wrong.data.code, 'HERMES_AUTH_INVALID');

        const ok = await request(baseUrl, 'GET', '/api/hermes/capabilities', undefined, {
            'x-api-key': 'unit-hermes-key'
        });
        assert.equal(ok.status, 200, JSON.stringify(ok.data));
        assert.equal(ok.data.integrationId, 'hermes-event-genix-crm');
        assert.equal(ok.data.auth, 'x-api-key');
        assert.equal(ok.data.maxLimit, 50);
        assert.equal(ok.data.pagination, 'cursor');
        assert.equal(ok.data.mutationsRequireConfirmation, true);
        assert.equal(ok.data.mutationsRequireIdempotencyKey, true);
        assert.deepEqual(ok.data.supportedActions, [
            'tasks.read',
            'tasks.detail',
            'tasks.history',
            'tasks.my_cabinet',
            'tasks.create',
            'tasks.complete',
            'tasks.reassign',
            'tasks.reschedule',
            'menu_photos.read',
            'menu_photos.candidates',
            'menu_photos.draft',
            'menu_photos.apply',
            'menu_photos.reject',
            'task_watchdog.preview',
            'task_watchdog.callback_dry_run'
        ]);
        assert.equal(ok.data.mutationActionsAvailable, true);
        assert.deepEqual(ok.data.plannedMutationActions, []);
    });

    it('rejects generic protected endpoints without auth', async () => {
        const res = await request(baseUrl, 'GET', '/api/bookings');
        assert.equal(res.status, 401);
    });

    it('does not accept query-token auth on generic protected endpoints', async () => {
        const res = await request(baseUrl, 'GET', '/api/bookings?token=allowed-token');
        assert.equal(res.status, 401);
    });

    it('allows query-token auth only on approved window.open endpoints', async () => {
        assert.equal(isQueryTokenAuthAllowed({ method: 'GET', path: '/graduation/catalog/export' }), true);
        assert.equal(isQueryTokenAuthAllowed({ method: 'GET', path: '/graduation/quotes/123/proposal' }), true);
        assert.equal(isQueryTokenAuthAllowed({ method: 'GET', path: '/bookings' }), false);

        const exportRes = await request(baseUrl, 'GET', '/api/graduation/catalog/export?token=allowed-token');
        assert.equal(exportRes.status, 200, JSON.stringify(exportRes.data));
        assert.equal(exportRes.data.auth, 'Bearer allowed-token');

        const proposalRes = await request(baseUrl, 'GET', '/api/graduation/quotes/123/proposal?token=allowed-token');
        assert.equal(proposalRes.status, 200, JSON.stringify(proposalRes.data));
        assert.equal(proposalRes.data.auth, 'Bearer allowed-token');
    });
});

describe('custom-secret and bot-key routes', () => {
    let server;
    let baseUrl;
    const originalEnv = {
        REPORT_BOT_API_KEY: process.env.REPORT_BOT_API_KEY,
        REPORT_WEBHOOK_SECRET: process.env.REPORT_WEBHOOK_SECRET,
        WEBHOOK_SECRET: process.env.WEBHOOK_SECRET
    };

    before(async () => {
        process.env.REPORT_BOT_API_KEY = 'unit-report-key';
        process.env.REPORT_WEBHOOK_SECRET = 'unit-report-secret';
        process.env.WEBHOOK_SECRET = 'unit-telegram-secret';

        for (const modulePath of [
            '../services/report-bot',
            '../routes/report-bot',
            '../services/telegram',
            '../routes/telegram'
        ]) {
            delete require.cache[require.resolve(modulePath)];
        }

        const app = express();
        app.use(express.json());
        app.use('/api/report-bot', require('../routes/report-bot'));
        app.use('/api/telegram', require('../routes/telegram'));
        ({ server, baseUrl } = await listen(app));
    });

    after(async () => {
        await close(server);
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it('rejects report-bot webhook without or with wrong Telegram secret', async () => {
        const missing = await request(baseUrl, 'POST', '/api/report-bot/webhook', {});
        assert.equal(missing.status, 403);

        const wrong = await request(baseUrl, 'POST', '/api/report-bot/webhook', {}, {
            'x-telegram-bot-api-secret-token': 'wrong-secret'
        });
        assert.equal(wrong.status, 403);
    });

    it('rejects report-bot API endpoints without or with wrong API key', async () => {
        const missing = await request(baseUrl, 'GET', '/api/report-bot/accounts');
        assert.equal(missing.status, 403);

        const wrong = await request(baseUrl, 'GET', '/api/report-bot/accounts', undefined, {
            'x-api-key': 'wrong-key'
        });
        assert.equal(wrong.status, 403);
    });

    it('rejects telegram webhook without or with wrong Telegram secret', async () => {
        const missing = await request(baseUrl, 'POST', '/api/telegram/webhook', {});
        assert.equal(missing.status, 403);

        const wrong = await request(baseUrl, 'POST', '/api/telegram/webhook', {}, {
            'x-telegram-bot-api-secret-token': 'wrong-secret'
        });
        assert.equal(wrong.status, 403);
    });
});
