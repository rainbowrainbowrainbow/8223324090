'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');

function installMock(modulePath, exportsValue) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports: exportsValue };
}

function moduleIds() {
    return [
        '../db',
        '../middleware/auth',
        '../routes/my-day'
    ].map(modulePath => require.resolve(modulePath));
}

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
    });
}

function activeTimerRow(userId = 7) {
    return {
        id: 501,
        user_id: userId,
        task_id: 901,
        started_at: '2026-08-12T08:00:00.000Z',
        ended_at: null,
        source: 'timer',
        duration_seconds: 360,
        task_title: 'Confidential DAR report',
        task_status: 'in_progress',
        task_business_context: 'dar',
        created_at: '2026-08-12T08:00:00.000Z',
        updated_at: '2026-08-12T08:00:00.000Z'
    };
}

function createPool() {
    const state = {
        queries: [],
        activeByUser: new Map([[7, activeTimerRow(7)]])
    };
    const query = async (text, params = []) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        state.queries.push({ sql, params });
        if (/FROM my_day_time_entries e JOIN tasks t ON t\.id = e\.task_id/.test(sql)) {
            const row = state.activeByUser.get(Number(params[0]));
            return { rows: row ? [row] : [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
    };
    return {
        state,
        query,
        async connect() {
            return {
                query: async (text, params = []) => {
                    const sql = String(text).replace(/\s+/g, ' ').trim();
                    state.queries.push({ sql, params });
                    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
                    if (/FROM my_day_time_entries e JOIN tasks t ON t\.id = e\.task_id/.test(sql)) {
                        const row = state.activeByUser.get(Number(params[0]));
                        return { rows: row ? [row] : [] };
                    }
                    if (/UPDATE my_day_time_entries SET ended_at = NOW\(\), updated_at = NOW\(\)/.test(sql)) {
                        const row = state.activeByUser.get(Number(params[0]));
                        if (!row) return { rows: [] };
                        state.activeByUser.delete(Number(params[0]));
                        return {
                            rows: [{
                                id: row.id,
                                user_id: row.user_id,
                                task_id: row.task_id,
                                started_at: row.started_at,
                                ended_at: '2026-08-12T08:06:00.000Z',
                                source: row.source,
                                duration_seconds: row.duration_seconds,
                                created_at: row.created_at,
                                updated_at: '2026-08-12T08:06:00.000Z'
                            }]
                        };
                    }
                    throw new Error(`Unexpected client query: ${sql}`);
                },
                release() {}
            };
        }
    };
}

async function withApp(run) {
    const ids = moduleIds();
    const previous = new Map(ids.map(id => [id, require.cache[id]]));
    ids.forEach(id => delete require.cache[id]);
    const pool = createPool();
    installMock('../db', { pool });
    installMock('../middleware/auth', {
        JWT_SECRET: 'timer-access-test-secret',
        authenticateToken: (req, _res, next) => {
            const variant = String(req.headers['x-test-user'] || 'allowed');
            if (variant === 'other') {
                req.user = { id: 8, role: 'director', business_contexts: ['event_genix', 'dar'], default_business_context: 'event_genix' };
            } else if (variant === 'revoked') {
                req.user = { id: 7, role: 'director', business_contexts: ['event_genix'], default_business_context: 'event_genix' };
            } else {
                req.user = { id: 7, role: 'director', business_contexts: ['event_genix', 'dar'], default_business_context: 'event_genix' };
            }
            next();
        }
    });
    const app = express();
    app.use(express.json());
    app.use('/api/my-day', require('../routes/my-day'));
    const { server, baseUrl } = await listen(app);
    try {
        return await run({ baseUrl, pool });
    } finally {
        await new Promise(resolve => server.close(resolve));
        ids.forEach(id => {
            delete require.cache[id];
            const cached = previous.get(id);
            if (cached) require.cache[id] = cached;
        });
    }
}

test('GET /api/my-day/timer returns task details only while business access remains allowed', async () => {
    await withApp(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/my-day/timer`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.timer.taskId, 901);
        assert.equal(body.timer.task.title, 'Confidential DAR report');
        assert.equal(body.timer.task.businessContext, 'dar');
        assert.equal(body.timer.businessContext, 'dar');
        assert.equal('userId' in body.timer, false);
    });
});

test('GET /api/my-day/timer sanitizes active task after business access is revoked', async () => {
    await withApp(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/my-day/timer`, { headers: { 'x-test-user': 'revoked' } });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.deepEqual(Object.keys(body.timer).sort(), ['durationSeconds', 'isActive', 'startedAt', 'task', 'taskUnavailable', 'warning']);
        assert.equal(body.timer.taskUnavailable, true);
        assert.equal(body.timer.task, null);
        assert.equal(body.timer.startedAt, '2026-08-12T08:00:00.000Z');
        assert.equal(body.timer.durationSeconds, 360);
        assert.equal(JSON.stringify(body).includes('Confidential DAR report'), false);
        assert.equal(JSON.stringify(body).includes('901'), false);
        assert.equal(JSON.stringify(body).includes('dar'), false);
        assert.equal(JSON.stringify(body).includes('userId'), false);
    });
});

test('GET /api/my-day/timer remains scoped to the authenticated login account', async () => {
    await withApp(async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/my-day/timer`, { headers: { 'x-test-user': 'other' } });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.timer, null);
    });
});

test('POST /api/my-day/timer/stop can stop own inaccessible timer without leaking task data', async () => {
    await withApp(async ({ baseUrl, pool }) => {
        const response = await fetch(`${baseUrl}/api/my-day/timer/stop`, {
            method: 'POST',
            headers: { 'x-test-user': 'revoked', 'Content-Type': 'application/json' }
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.timer.taskUnavailable, true);
        assert.equal(body.timer.task, null);
        assert.equal(JSON.stringify(body).includes('Confidential DAR report'), false);
        assert.equal(JSON.stringify(body).includes('901'), false);
        assert.equal(JSON.stringify(body).includes('dar'), false);
        assert.equal(pool.state.activeByUser.has(7), false);
    });
});
