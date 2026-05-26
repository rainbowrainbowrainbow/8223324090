const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'chat-reminders-secret';

let server;
let baseUrl;
let state;

const originalJwtSecret = process.env.JWT_SECRET;

function listen(app) {
    return new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => {
            resolve({ server: s, baseUrl: `http://127.0.0.1:${s.address().port}` });
        });
    });
}

function close(s) {
    return new Promise((resolve, reject) => {
        s.close(err => err ? reject(err) : resolve());
    });
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/chat',
        '../services/chatService',
        '../services/websocket',
        '../services/chat-bot',
        '../services/guardian',
        '../services/linkPreview',
        '../services/gamification',
        '../services/kleshnya'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function tokenFor(role = 'creator', id = 1) {
    return jwt.sign(
        { id, userId: id, username: `${role}-${id}`, name: `${role} User`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function request(method, path, body, { role = 'creator', userId = 1 } = {}) {
    const headers = { Authorization: `Bearer ${tokenFor(role, userId)}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function resetState() {
    state = {
        memberships: new Set(['10:1']),
        messages: new Map([[500, { id: 500, channel_id: 10, content: 'contract follow-up' }]]),
        tasks: [],
        nextTaskId: 700,
        tx: [],
        locks: [],
        taskInserts: [],
        logInserts: [],
        fallbackInserts: [],
        queries: [],
        failTaskLog: false,
        releases: 0
    };
}

function createFakePool() {
    async function rootQuery(sql, params = []) {
        const text = normalizeSql(sql);
        state.queries.push({ text, params, root: true });

        if (/UPDATE employee_profiles SET last_activity_at/i.test(text) ||
            /UPDATE users SET last_seen_at/i.test(text)) {
            return { rows: [], rowCount: 0 };
        }

        if (/SELECT id, channel_id, content FROM chat_messages WHERE id = \$1/i.test(text)) {
            const msg = state.messages.get(Number(params[0]));
            return { rows: msg ? [msg] : [], rowCount: msg ? 1 : 0 };
        }

        if (/INSERT INTO tasks \(title, description, deadline, priority, status, created_by, category\)/i.test(text)) {
            state.fallbackInserts.push({ text, params });
            throw new Error('legacy fallback insert should not be used');
        }

        throw new Error(`Unexpected root query: ${text}`);
    }

    return {
        query: rootQuery,
        connect: async () => {
            const pendingTasks = [];
            return {
                query: async (sql, params = []) => {
                    const text = normalizeSql(sql);
                    state.queries.push({ text, params, root: false });

                    if (text === 'BEGIN') {
                        state.tx.push('BEGIN');
                        return { rows: [], rowCount: 0 };
                    }
                    if (text === 'COMMIT') {
                        state.tx.push('COMMIT');
                        state.tasks.push(...pendingTasks);
                        pendingTasks.length = 0;
                        return { rows: [], rowCount: 0 };
                    }
                    if (text === 'ROLLBACK') {
                        state.tx.push('ROLLBACK');
                        pendingTasks.length = 0;
                        return { rows: [], rowCount: 0 };
                    }
                    if (/pg_advisory_xact_lock/i.test(text)) {
                        state.locks.push(params);
                        return { rows: [{ ok: true }], rowCount: 1 };
                    }
                    if (/FROM tasks WHERE source_type = 'chat_reminder'/i.test(text)) {
                        const existing = state.tasks.find(task =>
                            task.source_type === 'chat_reminder' &&
                            task.source_id === params[0] &&
                            !['done', 'archived', 'cancelled'].includes(task.status)
                        );
                        return { rows: existing ? [{ id: existing.id }] : [], rowCount: existing ? 1 : 0 };
                    }
                    if (/INSERT INTO tasks \(/i.test(text) && /source_type, source_id/i.test(text)) {
                        const row = {
                            id: state.nextTaskId++,
                            title: params[0],
                            description: params[1],
                            deadline: params[2],
                            created_by: params[3],
                            assigned_to: params[3],
                            owner: params[3],
                            owner_user_id: params[4],
                            created_by_user_id: params[4],
                            source_type: 'chat_reminder',
                            source_id: params[6],
                            status: 'todo',
                            task_mode: 'personal',
                            task_kind: 'reminder',
                            visibility: 'private',
                            workflow_state: 'inbox',
                            remind_at: params[2],
                            source_module: 'chat'
                        };
                        pendingTasks.push(row);
                        state.taskInserts.push(row);
                        return { rows: [{ id: row.id }], rowCount: 1 };
                    }
                    if (/INSERT INTO task_logs/i.test(text)) {
                        if (state.failTaskLog) throw new Error('simulated task log failure');
                        state.logInserts.push({ params });
                        return { rows: [], rowCount: 1 };
                    }

                    throw new Error(`Unexpected tx query: ${text}`);
                },
                release: () => {
                    state.releases += 1;
                }
            };
        }
    };
}

function fakeChatService() {
    return {
        isMember: async (channelId, userId) => state.memberships.has(`${channelId}:${userId}`),
        ensureDefaultMemberships: async () => {},
        getChannels: async () => [],
        updateActivityStats: async () => {}
    };
}

describe('chat reminder idempotency', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        resetState();
        clearModules();

        const pool = createFakePool();
        installMock('../db', { pool, query: pool.query.bind(pool) });
        installMock('../services/chatService', fakeChatService());
        installMock('../services/websocket', {
            broadcastToChannel: () => {},
            sendToUser: () => {},
            getOnlineUserIds: () => [],
            getLastSeen: () => null
        });
        installMock('../services/chat-bot', { processMessage: async () => null });
        installMock('../services/guardian', { preCheckMessage: async () => ({ blocked: false }) });
        installMock('../services/linkPreview', { fetchPreview: async () => null });
        installMock('../services/gamification', { spendCoins: async () => true });
        installMock('../services/kleshnya', {
            createTask: async () => {
                throw new Error('chat reminders should not use ambiguous kleshnya fallback path');
            }
        });

        const app = express();
        app.use(express.json());
        app.use('/api/chat', require('../routes/chat'));

        ({ server, baseUrl } = await listen(app));
    });

    beforeEach(() => {
        resetState();
    });

    after(async () => {
        if (server) await close(server);
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        clearModules();
    });

    it('reuses an active reminder task for duplicate message/user/time submissions', async () => {
        const remindAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        const first = await request('POST', '/api/chat/messages/500/remind', { remindAt });
        const second = await request('POST', '/api/chat/messages/500/remind', { remindAt });

        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.equal(first.data.success, true);
        assert.equal(first.data.duplicate, false);
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.equal(second.data.success, true);
        assert.equal(second.data.duplicate, true);
        assert.equal(second.data.taskId, first.data.taskId);
        assert.equal(second.data.sourceId, first.data.sourceId);
        assert.equal(state.taskInserts.length, 1);
        assert.equal(state.taskInserts[0].owner_user_id, 1);
        assert.equal(state.taskInserts[0].visibility, 'private');
        assert.equal(state.taskInserts[0].remind_at, remindAt);
        assert.equal(state.logInserts.length, 1);
        assert.equal(state.fallbackInserts.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    });

    it('allows distinct reminder times for the same message and user', async () => {
        const firstAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const secondAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

        const first = await request('POST', '/api/chat/messages/500/remind', { remindAt: firstAt });
        const second = await request('POST', '/api/chat/messages/500/remind', { remindAt: secondAt });

        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.equal(first.data.duplicate, false);
        assert.equal(second.data.duplicate, false);
        assert.notEqual(second.data.sourceId, first.data.sourceId);
        assert.equal(state.taskInserts.length, 2);
    });

    it('rolls back and does not use legacy fallback after ambiguous partial failures', async () => {
        state.failTaskLog = true;
        const remindAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        const res = await request('POST', '/api/chat/messages/500/remind', { remindAt });

        assert.equal(res.status, 500, JSON.stringify(res.data));
        assert.equal(state.taskInserts.length, 1);
        assert.equal(state.tasks.length, 0);
        assert.equal(state.fallbackInserts.length, 0);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.releases, 1);
    });
});
