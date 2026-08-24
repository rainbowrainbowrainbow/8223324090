const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHermesMutationGuard } = require('../services/hermesMutationGuard');
const {
    buildHermesRequestHash,
    withHermesIdempotency
} = require('../services/hermesIdempotency');

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

function recordKey(integrationId, idempotencyKey) {
    return `${integrationId}:${idempotencyKey}`;
}

function cloneRecord(record) {
    if (!record) return record;
    return {
        ...record,
        response_body: record.response_body === undefined
            ? null
            : JSON.parse(JSON.stringify(record.response_body))
    };
}

class FakeIdempotencyPool {
    constructor() {
        this.records = new Map();
        this.nextId = 1;
        this.queries = [];
    }

    async query(sql, params = []) {
        const compactSql = sql.replace(/\s+/g, ' ').trim();
        this.queries.push({ sql: compactSql, params });

        if (compactSql.startsWith('DELETE FROM integration_idempotency_keys')) {
            const key = recordKey(params[0], params[1]);
            const record = this.records.get(key);
            if (record && new Date(record.expires_at).getTime() < Date.now()) {
                this.records.delete(key);
                return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }

        if (compactSql.startsWith('INSERT INTO integration_idempotency_keys')) {
            const key = recordKey(params[0], params[1]);
            if (this.records.has(key)) {
                return { rows: [], rowCount: 0 };
            }
            const createdAt = new Date();
            const expiresAt = new Date(createdAt.getTime() + Number(params[3]) * 60 * 60 * 1000);
            const record = {
                id: this.nextId++,
                integration_id: params[0],
                idempotency_key: params[1],
                request_hash: params[2],
                response_status: null,
                response_body: null,
                created_at: createdAt.toISOString(),
                expires_at: expiresAt.toISOString()
            };
            this.records.set(key, record);
            return { rows: [cloneRecord(record)], rowCount: 1 };
        }

        if (compactSql.startsWith('SELECT id, integration_id, idempotency_key')) {
            const record = this.records.get(recordKey(params[0], params[1]));
            return { rows: record ? [cloneRecord(record)] : [], rowCount: record ? 1 : 0 };
        }

        if (compactSql.startsWith('UPDATE integration_idempotency_keys')) {
            const record = this.records.get(recordKey(params[0], params[1]));
            if (!record || record.request_hash !== params[2] || record.response_status !== null) {
                return { rows: [], rowCount: 0 };
            }
            record.response_status = params[3];
            record.response_body = typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4];
            return { rows: [cloneRecord(record)], rowCount: 1 };
        }

        throw new Error(`Unexpected fake query: ${compactSql}`);
    }
}

class FailingCommitIdempotencyPool {
    constructor() {
        this.records = new Map();
        this.pendingRecords = null;
        this.nextId = 1;
        this.queries = [];
        this.businessCalls = 0;
    }

    cloneRecords(records) {
        return new Map(Array.from(records.entries()).map(([key, value]) => [key, cloneRecord(value)]));
    }

    async queryAgainst(records, sql, params = []) {
        const compactSql = sql.replace(/\s+/g, ' ').trim();
        this.queries.push({ sql: compactSql, params });

        if (compactSql.startsWith('DELETE FROM integration_idempotency_keys')) {
            const key = recordKey(params[0], params[1]);
            const record = records.get(key);
            if (record && new Date(record.expires_at).getTime() < Date.now()) {
                records.delete(key);
                return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }

        if (compactSql.startsWith('INSERT INTO integration_idempotency_keys')) {
            const key = recordKey(params[0], params[1]);
            if (records.has(key)) {
                return { rows: [], rowCount: 0 };
            }
            const createdAt = new Date();
            const record = {
                id: this.nextId++,
                integration_id: params[0],
                idempotency_key: params[1],
                request_hash: params[2],
                response_status: null,
                response_body: null,
                created_at: createdAt.toISOString(),
                expires_at: new Date(createdAt.getTime() + Number(params[3]) * 60 * 60 * 1000).toISOString()
            };
            records.set(key, record);
            return { rows: [cloneRecord(record)], rowCount: 1 };
        }

        if (compactSql.startsWith('SELECT id, integration_id, idempotency_key')) {
            const record = records.get(recordKey(params[0], params[1]));
            return { rows: record ? [cloneRecord(record)] : [], rowCount: record ? 1 : 0 };
        }

        if (compactSql.startsWith('UPDATE integration_idempotency_keys')) {
            const record = records.get(recordKey(params[0], params[1]));
            if (!record || record.request_hash !== params[2] || record.response_status !== null) {
                return { rows: [], rowCount: 0 };
            }
            record.response_status = params[3];
            record.response_body = typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4];
            return { rows: [cloneRecord(record)], rowCount: 1 };
        }

        throw new Error(`Unexpected fake query: ${compactSql}`);
    }

    async connect() {
        return {
            query: async (sql, params = []) => {
                const compactSql = sql.replace(/\s+/g, ' ').trim();
                this.queries.push({ sql: compactSql, params });
                if (compactSql === 'BEGIN') {
                    this.pendingRecords = this.cloneRecords(this.records);
                    return { rows: [], rowCount: 0 };
                }
                if (compactSql === 'COMMIT') {
                    throw new Error('Simulated final COMMIT failure');
                }
                if (compactSql === 'ROLLBACK') {
                    this.pendingRecords = null;
                    return { rows: [], rowCount: 0 };
                }
                return this.queryAgainst(this.pendingRecords || this.records, sql, params);
            },
            release() {}
        };
    }
}

async function withHermesTestServer(testFn) {
    const state = { createCalls: 0, idempotencyResults: [] };
    const idempotencyPool = new FakeIdempotencyPool();
    const app = express();

    app.use(express.json());
    app.post('/api/hermes/tasks', createHermesMutationGuard(), async (req, res, next) => {
        try {
            return await withHermesIdempotency(req, res, async () => {
                state.createCalls += 1;
                return {
                    status: 201,
                    body: {
                        success: true,
                        task: {
                            id: `task-${state.createCalls}`,
                            title: req.body.title
                        }
                    }
                };
            }, {
                pool: idempotencyPool,
                requestPath: '/api/hermes/tasks',
                onResult: result => state.idempotencyResults.push(result)
            });
        } catch (err) {
            return next(err);
        }
    });
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        return res.status(err.statusCode || 500).json({
            success: false,
            error: err.message,
            code: err.code || 'TEST_ERROR'
        });
    });

    const { server, baseUrl } = await listen(app);
    try {
        await testFn({ baseUrl, idempotencyPool, state });
    } finally {
        await close(server);
    }
}

function mutationHeaders(idempotencyKey, extraHeaders = {}) {
    return {
        'Idempotency-Key': idempotencyKey,
        'X-Hermes-User-Confirmed': 'true',
        ...extraHeaders
    };
}

describe('Hermes idempotency', () => {
    it('builds the same request hash for equivalent JSON bodies', () => {
        const firstHash = buildHermesRequestHash({
            method: 'post',
            originalUrl: '/api/hermes/tasks?debug=1',
            body: { title: 'Call client', metadata: { b: 2, a: 1 } }
        });
        const secondHash = buildHermesRequestHash({
            method: 'POST',
            originalUrl: '/api/hermes/tasks?debug=2',
            body: { metadata: { a: 1, b: 2 }, title: 'Call client' }
        });

        assert.equal(firstHash, secondHash);
        assert.match(firstHash, /^[a-f0-9]{64}$/);
    });

    it('returns the stored create response for the same idempotency key and request', async () => {
        await withHermesTestServer(async ({ baseUrl, state }) => {
            const first = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Call client'
            }, mutationHeaders('create-task-1'));
            const retry = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Call client'
            }, mutationHeaders('create-task-1'));

            assert.equal(first.status, 201, first.text);
            assert.equal(retry.status, 201, retry.text);
            assert.deepEqual(retry.data, first.data);
            assert.equal(first.data.task.id, 'task-1');
            assert.equal(state.createCalls, 1);
            assert.deepEqual(state.idempotencyResults.map(result => result.state), ['new', 'replay']);
            assert.deepEqual(state.idempotencyResults.map(result => result.body), [first.data, first.data]);
        });
    });

    it('rejects the same idempotency key with a different create request', async () => {
        await withHermesTestServer(async ({ baseUrl, state }) => {
            const first = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Call client'
            }, mutationHeaders('create-task-2'));
            const conflict = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Call another client'
            }, mutationHeaders('create-task-2'));

            assert.equal(first.status, 201, first.text);
            assert.equal(conflict.status, 409, conflict.text);
            assert.equal(conflict.data.code, 'IDEMPOTENCY_KEY_CONFLICT');
            assert.equal(state.createCalls, 1);
        });
    });

    it('does not store raw auth headers in the idempotency record', async () => {
        await withHermesTestServer(async ({ baseUrl, idempotencyPool }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Call client'
            }, mutationHeaders('create-task-3', {
                'x-api-key': 'raw-key-secret',
                Authorization: 'Bearer raw-bearer-secret'
            }));

            assert.equal(res.status, 201, res.text);
            const stored = JSON.stringify(Array.from(idempotencyPool.records.values()));
            assert.equal(stored.includes('raw-key-secret'), false);
            assert.equal(stored.includes('raw-bearer-secret'), false);
            assert.equal(stored.includes('authorization'), false);
            assert.equal(stored.includes('x-api-key'), false);
        });
    });
});

describe('Hermes transactional idempotency', () => {
    it('does not send or cache a success response when the final COMMIT fails', async () => {
        const state = { idempotencyResults: [] };
        const idempotencyPool = new FailingCommitIdempotencyPool();
        const app = express();

        app.use(express.json());
        app.post('/api/hermes/tasks', createHermesMutationGuard(), async (req, res, next) => {
            try {
                return await withHermesIdempotency(req, res, async () => {
                    idempotencyPool.businessCalls += 1;
                    return {
                        status: 201,
                        body: {
                            success: true,
                            task: {
                                id: 'task-before-commit',
                                title: req.body.title
                            }
                        }
                    };
                }, {
                    pool: idempotencyPool,
                    requestPath: '/api/hermes/tasks',
                    transactional: true,
                    onResult: result => state.idempotencyResults.push(result)
                });
            } catch (err) {
                return next(err);
            }
        });
        app.use((err, req, res, next) => {
            if (res.headersSent) return next(err);
            return res.status(503).json({
                success: false,
                error: err.message,
                code: 'TEST_COMMIT_FAILED'
            });
        });

        const { server, baseUrl } = await listen(app);
        try {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Commit after response regression'
            }, mutationHeaders('create-task-commit-failure'));

            assert.equal(res.status, 503, res.text);
            assert.equal(res.data.code, 'TEST_COMMIT_FAILED');
            assert.equal(idempotencyPool.businessCalls, 1);
            assert.equal(idempotencyPool.records.size, 0);
            assert.equal(state.idempotencyResults.length, 0);
            assert.deepEqual(
                idempotencyPool.queries.map(item => item.sql).filter(sql => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)),
                ['BEGIN', 'COMMIT', 'ROLLBACK']
            );
        } finally {
            await close(server);
        }
    });
});
