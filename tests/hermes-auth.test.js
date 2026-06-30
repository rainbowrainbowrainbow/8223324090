const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
    HERMES_INTEGRATION_ID,
    applyHermesBusinessContextAllowlist,
    createHermesAuthMiddleware,
    extractHermesCredential,
    parseHermesAllowedBusinessContexts,
    timingSafeSecretEqual
} = require('../middleware/hermesAuth');
const { createHermesRouter } = require('../routes/hermes');

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
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text };
}

function actorRow(patch = {}) {
    return {
        id: 42,
        username: 'hermes_bot',
        role: 'director',
        extra_roles: [],
        page_allowlist: [],
        action_allowlist: [],
        action_denylist: [],
        business_contexts: ['event_genix', 'crm'],
        default_business_context: 'crm',
        name: 'Hermes Bot',
        telegram_chat_id: null,
        is_active: true,
        ...patch
    };
}

function makePool(row = actorRow(), calls = { count: 0 }) {
    return {
        calls,
        async query(sql, params) {
            calls.count += 1;
            assert.match(sql, /FROM users/i);
            assert.deepEqual(params, [42]);
            return { rows: row ? [row] : [] };
        }
    };
}

async function withHermesApp({ env, pool, row }, work) {
    const app = express();
    app.use(express.json());
    app.get('/probe', createHermesAuthMiddleware({
        env,
        pool: pool || makePool(row)
    }), (req, res) => {
        res.json({
            success: true,
            user: req.user,
            integration: req.integration
        });
    });

    const { server, baseUrl } = await listen(app);
    try {
        await work(baseUrl);
    } finally {
        await close(server);
    }
}

describe('Hermes auth helper functions', () => {
    it('extracts x-api-key before bearer fallback', () => {
        const req = {
            headers: {
                'x-api-key': 'key-one',
                authorization: 'Bearer key-two'
            }
        };
        assert.deepEqual(extractHermesCredential(req), { secret: 'key-one', mode: 'x-api-key' });
    });

    it('extracts bearer fallback when x-api-key is absent', () => {
        const req = { headers: { authorization: 'Bearer bearer-secret' } };
        assert.deepEqual(extractHermesCredential(req), { secret: 'bearer-secret', mode: 'authorization-bearer' });
    });

    it('compares secrets without requiring equal raw string length', () => {
        assert.equal(timingSafeSecretEqual('unit-hermes-key', 'unit-hermes-key'), true);
        assert.equal(timingSafeSecretEqual('short', 'unit-hermes-key'), false);
        assert.equal(timingSafeSecretEqual('', 'unit-hermes-key'), false);
    });

    it('parses canonical Hermes business context allowlist values only', () => {
        assert.deepEqual(parseHermesAllowedBusinessContexts(undefined), null);
        assert.deepEqual(parseHermesAllowedBusinessContexts('   '), null);
        assert.deepEqual(parseHermesAllowedBusinessContexts('event_genix, crm; event_genix unknown'), ['event_genix', 'crm']);
    });

    it('narrows actor business contexts without expanding access', () => {
        const actor = {
            id: 42,
            username: 'hermes_bot',
            role: 'director',
            businessContexts: ['event_genix', 'crm'],
            business_contexts: ['event_genix', 'crm'],
            defaultBusinessContext: 'crm',
            default_business_context: 'crm'
        };
        const narrowed = applyHermesBusinessContextAllowlist(actor, ['event_genix', 'dar']);

        assert.deepEqual(narrowed.businessContexts, ['event_genix']);
        assert.deepEqual(narrowed.business_contexts, ['event_genix']);
        assert.equal(narrowed.defaultBusinessContext, 'event_genix');
        assert.equal(narrowed.default_business_context, 'event_genix');
        assert.deepEqual(narrowed.businessContextPolicy.allowed, ['event_genix']);
        assert.equal(narrowed.businessContextPolicy.defaultContext, 'event_genix');
    });
});

describe('Hermes auth middleware', () => {
    const goodEnv = {
        HERMES_API_KEY: 'unit-hermes-key',
        HERMES_ACTOR_USER_ID: '42'
    };

    it('rejects missing CRM-side Hermes API key configuration', async () => {
        const calls = { count: 0 };
        await withHermesApp({
            env: { HERMES_ACTOR_USER_ID: '42' },
            pool: makePool(actorRow(), calls)
        }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                'x-api-key': 'unit-hermes-key'
            });
            assert.equal(res.status, 503);
            assert.equal(res.data.code, 'HERMES_AUTH_NOT_CONFIGURED');
            assert.equal(calls.count, 0);
        });
    });

    it('rejects missing Hermes actor configuration', async () => {
        const calls = { count: 0 };
        await withHermesApp({
            env: { HERMES_API_KEY: 'unit-hermes-key' },
            pool: makePool(actorRow(), calls)
        }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                'x-api-key': 'unit-hermes-key'
            });
            assert.equal(res.status, 503);
            assert.equal(res.data.code, 'HERMES_ACTOR_NOT_CONFIGURED');
            assert.equal(calls.count, 0);
        });
    });

    it('rejects requests without a Hermes key', async () => {
        const calls = { count: 0 };
        await withHermesApp({
            env: goodEnv,
            pool: makePool(actorRow(), calls)
        }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe');
            assert.equal(res.status, 401);
            assert.equal(res.data.code, 'HERMES_AUTH_REQUIRED');
            assert.equal(calls.count, 0);
        });
    });

    it('rejects wrong Hermes keys before actor lookup', async () => {
        const calls = { count: 0 };
        await withHermesApp({
            env: goodEnv,
            pool: makePool(actorRow(), calls)
        }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                'x-api-key': 'wrong-key'
            });
            assert.equal(res.status, 401);
            assert.equal(res.data.code, 'HERMES_AUTH_INVALID');
            assert.equal(calls.count, 0);
        });
    });

    it('rejects missing actor rows', async () => {
        await withHermesApp({
            env: goodEnv,
            pool: makePool(null)
        }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                'x-api-key': 'unit-hermes-key'
            });
            assert.equal(res.status, 503);
            assert.equal(res.data.code, 'HERMES_ACTOR_NOT_FOUND');
        });
    });

    it('rejects inactive actor rows', async () => {
        await withHermesApp({
            env: goodEnv,
            pool: makePool(actorRow({ is_active: false }))
        }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                'x-api-key': 'unit-hermes-key'
            });
            assert.equal(res.status, 403);
            assert.equal(res.data.code, 'HERMES_ACTOR_INACTIVE');
        });
    });

    it('sets req.user and req.integration for valid x-api-key requests', async () => {
        await withHermesApp({ env: goodEnv }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                'x-api-key': 'unit-hermes-key'
            });
            assert.equal(res.status, 200, JSON.stringify(res.data));
            assert.equal(res.data.success, true);
            assert.equal(res.data.user.id, 42);
            assert.equal(res.data.user.username, 'hermes_bot');
            assert.equal(res.data.user.defaultBusinessContext, 'crm');
            assert.deepEqual(res.data.user.businessContexts, ['event_genix', 'crm']);
            assert.equal(res.data.integration.id, HERMES_INTEGRATION_ID);
            assert.equal(res.data.integration.source, 'hermes');
            assert.equal(res.data.integration.authMode, 'x-api-key');
            assert.equal(res.data.integration.actorUserId, 42);
        });
    });

    it('accepts Authorization bearer fallback', async () => {
        await withHermesApp({ env: goodEnv }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                Authorization: 'Bearer unit-hermes-key'
            });
            assert.equal(res.status, 200, JSON.stringify(res.data));
            assert.equal(res.data.integration.authMode, 'authorization-bearer');
            assert.equal(res.data.user.username, 'hermes_bot');
        });
    });

    it('applies HERMES_ALLOWED_BUSINESS_CONTEXTS to the loaded actor payload', async () => {
        await withHermesApp({
            env: {
                ...goodEnv,
                HERMES_ALLOWED_BUSINESS_CONTEXTS: 'event_genix'
            }
        }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                'x-api-key': 'unit-hermes-key'
            });

            assert.equal(res.status, 200, JSON.stringify(res.data));
            assert.deepEqual(res.data.user.businessContexts, ['event_genix']);
            assert.deepEqual(res.data.user.business_contexts, ['event_genix']);
            assert.equal(res.data.user.defaultBusinessContext, 'event_genix');
            assert.equal(res.data.user.default_business_context, 'event_genix');
            assert.deepEqual(res.data.user.businessContextPolicy.allowed, ['event_genix']);
        });
    });

    it('rejects Hermes actors when allowlist has no intersection with actor contexts', async () => {
        await withHermesApp({
            env: {
                ...goodEnv,
                HERMES_ALLOWED_BUSINESS_CONTEXTS: 'dar'
            }
        }, async baseUrl => {
            const res = await request(baseUrl, 'GET', '/probe', undefined, {
                'x-api-key': 'unit-hermes-key'
            });

            assert.equal(res.status, 403);
            assert.equal(res.data.success, false);
            assert.equal(res.data.code, 'HERMES_BUSINESS_CONTEXT_FORBIDDEN');
        });
    });
});

describe('Hermes capabilities route auth', () => {
    const goodEnv = {
        HERMES_API_KEY: 'unit-hermes-key',
        HERMES_ACTOR_USER_ID: '42'
    };

    async function withHermesRouter(work) {
        const app = express();
        app.use(express.json());
        app.use('/api/hermes', createHermesRouter({
            authMiddleware: createHermesAuthMiddleware({
                env: goodEnv,
                pool: makePool(actorRow())
            }),
            pool: {
                async query() {
                    throw new Error('Capabilities should not query task data');
                }
            }
        }));

        const { server, baseUrl } = await listen(app);
        try {
            await work(baseUrl);
        } finally {
            await close(server);
        }
    }

    it('rejects capabilities without Hermes key', async () => {
        await withHermesRouter(async baseUrl => {
            const res = await request(baseUrl, 'GET', '/api/hermes/capabilities');

            assert.equal(res.status, 401);
            assert.equal(res.data.success, false);
            assert.equal(res.data.code, 'HERMES_AUTH_REQUIRED');
        });
    });

    it('accepts a valid key and returns the Hermes action matrix', async () => {
        await withHermesRouter(async baseUrl => {
            const res = await request(baseUrl, 'GET', '/api/hermes/capabilities', undefined, {
                'x-api-key': 'unit-hermes-key'
            });

            assert.equal(res.status, 200, JSON.stringify(res.data));
            assert.equal(res.data.success, true);
            assert.equal(res.data.integrationId, HERMES_INTEGRATION_ID);
            assert.equal(res.data.auth, 'x-api-key');
            assert.equal(res.data.authFallback, 'authorization-bearer');
            assert.equal(res.data.maxLimit, 50);
            assert.equal(res.data.pagination, 'cursor');
            assert.equal(res.data.mutationsRequireConfirmation, true);
            assert.equal(res.data.mutationsRequireIdempotencyKey, true);
            assert.deepEqual(res.data.webhooks, {
                crmToHermesEnabled: false
            });
            assert.deepEqual(res.data.supportedActions, [
                'tasks.read',
                'tasks.detail',
                'tasks.history',
                'tasks.my_cabinet',
                'tasks.create',
                'tasks.complete',
                'tasks.reassign',
                'tasks.reschedule',
                'tasks.status',
                'menu_photos.read',
                'menu_photos.candidates',
                'menu_photos.draft',
                'menu_photos.apply',
                'menu_photos.reject',
                'task_watchdog.preview',
                'task_watchdog.callback_dry_run',
                'notification_outbox.read',
                'notification_outbox.detail',
                'notification_outbox.claim',
                'notification_outbox.ack',
                'notification_outbox.fail',
                'notification_outbox.stats',
                'notification_outbox.debug'
            ]);
            assert.equal(res.data.mutationActionsAvailable, true);
            assert.deepEqual(res.data.plannedMutationActions, []);
        });
    });
});
