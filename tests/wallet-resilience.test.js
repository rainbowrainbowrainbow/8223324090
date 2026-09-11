'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Invoke the actual handlers: acquisition failures must resolve an HTTP response,
// rather than reject the Promise that Express 4 does not automatically consume.
function loadWallet(pool) {
    const replacements = {
        '../db': { pool },
        '../middleware/auth': { ANY_ROLE: ['animator'], requireRole: () => (_req, _res, next) => next() },
        '../utils/logger': { createLogger: () => ({ error() {} }) }
    };
    const saved = new Map();
    const routeId = require.resolve('../routes/wallet');
    saved.set(routeId, require.cache[routeId]);
    try {
        for (const [name, exports] of Object.entries(replacements)) {
            const id = require.resolve(name);
            saved.set(id, require.cache[id]);
            require.cache[id] = { id, filename: id, loaded: true, exports };
        }
        delete require.cache[routeId];
        return require(routeId);
    } finally {
        for (const [id, entry] of saved) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
        }
    }
}

for (const endpoint of ['/daily-login', '/transfer']) {
    for (const fault of ['connect', 'begin', 'query', 'rollback']) {
        test(`Wallet ${endpoint}: ${fault} failure returns 500, releases acquired client and recovers`, async () => {
            const queries = [];
            let released = 0;
            let failing = true;
            const client = {
                async query(sql) {
                    queries.push(sql);
                    if (failing && ((fault === 'begin' && sql === 'BEGIN') ||
                        (['query', 'rollback'].includes(fault) && sql !== 'BEGIN' && sql !== 'ROLLBACK') ||
                        (fault === 'rollback' && sql === 'ROLLBACK'))) throw new Error('synthetic database failure');
                    return { rows: [] };
                },
                release() { released++; }
            };
            const router = loadWallet({ async connect() {
                if (failing && fault === 'connect') throw new Error('synthetic acquisition failure');
                return client;
            } });
            const handler = router.stack.find(layer => layer.route?.path === endpoint).route.stack.at(-1).handle;
            const invoke = async expectedStatus => {
                let status = 200;
                let body;
                let responses = 0;
                await handler({ user: { id: 1 }, body: { to_user_id: 2, amount: 10 } }, {
                    status(value) { status = value; return this; },
                    json(value) { body = value; responses++; return this; }
                });
                assert.equal(status, expectedStatus);
                assert.equal(responses, 1);
                if (expectedStatus === 500) assert.deepEqual(body, { error: 'Internal server error' });
            };
            await invoke(500);
            assert.equal(released, fault === 'connect' ? 0 : 1);
            assert.equal(queries.filter(sql => sql === 'ROLLBACK').length, fault === 'connect' ? 0 : 1);
            if (fault === 'connect') assert.deepEqual(queries, []);
            failing = false;
            await invoke(endpoint === '/daily-login' ? 400 : 404);
            assert.equal(released, fault === 'connect' ? 1 : 2);
        });
    }
}
