'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const AUTH_HEADERS = { 'x-api-key': 'unit-hermes-key' };
const NOW = '2026-06-29T12:00:00.000Z';

const MODULES_TO_CLEAR = [
    '../db',
    '../routes/hermes',
    '../services/kleshnya',
    '../services/notificationOutbox',
    '../services/telegram',
    '../services/taskDuplicatePolicy',
    '../services/taskBusinessScope',
    '../services/taskNotifications',
    '../utils/logger'
];

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    for (const modulePath of MODULES_TO_CLEAR) {
        try {
            delete require.cache[require.resolve(modulePath)];
        } catch (_) {}
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function isAvailableAt(value, nowIso = NOW) {
    if (!value) return true;
    return new Date(value).getTime() <= new Date(nowIso).getTime();
}

class LifecyclePool {
    constructor(options = {}) {
        this.tasks = [];
        this.outbox = [];
        this.taskLogs = [];
        this.queries = [];
        this.now = options.now || NOW;
        this.nextTaskId = options.nextTaskId || 900;
        this.nextOutboxId = 1;
        this.users = new Map(options.users || [
            [4, { id: 4, username: 'sergiy', name: 'Sergiy' }]
        ]);
    }

    nextIso(seconds = 0) {
        return new Date(new Date(this.now).getTime() + seconds * 1000).toISOString();
    }

    userByLabel(label) {
        const normalized = String(label || '').trim().toLowerCase();
        return [...this.users.values()].find(user =>
            String(user.username || '').toLowerCase() === normalized
            || String(user.name || '').toLowerCase() === normalized
        ) || null;
    }

    outboxByEventId(eventId) {
        return this.outbox.find(row => row.event_id === eventId) || null;
    }

    async query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        this.queries.push({ text, params });

        if (text.startsWith('SELECT id, username, name FROM users WHERE id = $1')) {
            const user = this.users.get(Number(params[0]));
            return { rows: user ? [clone(user)] : [], rowCount: user ? 1 : 0 };
        }

        if (text.startsWith('SELECT id, username, name FROM users WHERE COALESCE')) {
            const user = this.userByLabel(params[0]);
            return { rows: user ? [clone(user)] : [], rowCount: user ? 1 : 0 };
        }

        if (text.startsWith('INSERT INTO tasks')) {
            const row = {
                id: this.nextTaskId++,
                business_context: params[0],
                title: params[1],
                description: params[2],
                date: params[3],
                priority: params[4],
                assigned_to: params[5],
                owner: params[6],
                owner_user_id: params[7],
                created_by: params[8],
                task_type: params[9],
                deadline: params[10],
                status: 'todo',
                workflow_state: 'todo',
                created_at: this.now,
                updated_at: this.now
            };
            this.tasks.push(row);
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (text.startsWith('INSERT INTO task_logs')) {
            this.taskLogs.push({ params });
            return { rows: [], rowCount: 1 };
        }

        if (text.startsWith('INSERT INTO notification_outbox')) {
            const duplicate = this.outbox.find(row =>
                row.event_id === params[0]
                || (
                    row.task_id === params[1]
                    && row.owner_user_id === params[2]
                    && row.event_type === params[3]
                    && row.payload_hash === params[5]
                )
            );
            if (duplicate) return { rows: [], rowCount: 0 };

            const row = {
                id: this.nextOutboxId++,
                event_id: params[0],
                task_id: params[1],
                owner_user_id: params[2],
                event_type: params[3],
                payload_json: JSON.parse(params[4]),
                payload_hash: params[5],
                status: 'pending',
                attempts: 0,
                available_at: params[6] || this.now,
                created_at: this.now,
                claimed_at: null,
                sent_at: null,
                last_error: null,
                last_error_code: null,
                last_delivery_channel: null,
                last_delivery_target: null,
                claimed_by: null,
                locked_until: null,
                updated_at: this.now
            };
            this.outbox.push(row);
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (text.startsWith('SELECT * FROM notification_outbox WHERE event_id = $1 OR')) {
            const row = this.outboxByEventId(params[0])
                || this.outbox.find(item =>
                    item.task_id === params[1]
                    && item.owner_user_id === params[2]
                    && item.event_type === params[3]
                    && item.payload_hash === params[4]
                );
            return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith('SELECT * FROM notification_outbox') && text.includes('ORDER BY id ASC')) {
            const status = params[0];
            let index = 1;
            let rows = this.outbox.filter(row => row.status === status);
            if (status === 'pending' || status === 'failed') {
                rows = rows.filter(row => isAvailableAt(row.available_at, this.now));
            }
            if (text.includes('owner_user_id = $')) {
                const ownerUserId = Number(params[index]);
                index += 1;
                rows = rows.filter(row => Number(row.owner_user_id) === ownerUserId);
            }
            if (text.includes('event_type = $')) {
                const eventType = params[index];
                index += 1;
                rows = rows.filter(row => row.event_type === eventType);
            }
            if (text.includes('id > $')) {
                const cursor = Number(params[index]);
                rows = rows.filter(row => Number(row.id) > cursor);
            }
            const limit = Number(params[params.length - 1]);
            return {
                rows: rows
                    .sort((a, b) => Number(a.id) - Number(b.id))
                    .slice(0, limit)
                    .map(clone)
            };
        }

        if (text.startsWith('SELECT * FROM notification_outbox WHERE event_id = $1')) {
            const row = this.outboxByEventId(params[0]);
            return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith("UPDATE notification_outbox SET status = 'claimed'")) {
            const [eventId, workerId, lockSeconds] = params;
            const row = this.outboxByEventId(eventId);
            if (
                row
                && ['pending', 'failed', 'claimed'].includes(row.status)
                && isAvailableAt(row.available_at, this.now)
                && (row.status !== 'claimed' || !row.locked_until || isAvailableAt(row.locked_until, this.now))
            ) {
                row.status = 'claimed';
                row.claimed_at = this.now;
                row.claimed_by = workerId;
                row.locked_until = this.nextIso(Number(lockSeconds));
                row.updated_at = this.now;
                return { rows: [clone(row)], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }

        if (text.startsWith("UPDATE notification_outbox SET status = 'sent'")) {
            const [eventId, sentAt, channel, target] = params;
            const row = this.outboxByEventId(eventId);
            row.status = 'sent';
            row.sent_at = sentAt || this.now;
            row.last_error = null;
            row.last_error_code = null;
            row.last_delivery_channel = channel;
            row.last_delivery_target = target;
            row.locked_until = null;
            row.updated_at = this.now;
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (text.startsWith('UPDATE notification_outbox SET status = $2')) {
            const [eventId, status, attempts, backoffMinutes, errorMessage, errorCode] = params;
            const row = this.outboxByEventId(eventId);
            row.status = status;
            row.attempts = attempts;
            row.available_at = status === 'failed'
                ? new Date(new Date(this.now).getTime() + Number(backoffMinutes) * 60000).toISOString()
                : this.now;
            row.last_error = errorMessage;
            row.last_error_code = errorCode;
            row.locked_until = null;
            row.updated_at = this.now;
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (text.startsWith('SELECT telegram_chat_id FROM users WHERE id = $1')) {
            return { rows: [], rowCount: 0 };
        }

        if (text.startsWith('SELECT telegram_username FROM users')) {
            return { rows: [], rowCount: 0 };
        }

        if (text.startsWith('SELECT telegram_username FROM staff')) {
            return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected lifecycle query: ${text}`);
    }
}

function installKleshnyaMocks(pool, telegramCalls = []) {
    clearModules();
    installMock('../db', { pool });
    installMock('../services/telegram', {
        getConfiguredChatId: async () => 'legacy-group-chat',
        getConfiguredThreadId: async () => null,
        telegramRequest: async (method, body) => {
            telegramCalls.push({ method, body });
            return { ok: true };
        },
        sendTelegramMessage: async (chatId, text, options) => {
            telegramCalls.push({ method: 'sendTelegramMessage', body: { chat_id: chatId, text, options } });
            return { ok: true };
        }
    });
    installMock('../services/taskDuplicatePolicy', {
        TaskDuplicateError: class TaskDuplicateError extends Error {},
        findActiveDuplicateTask: async () => null
    });
    installMock('../services/taskBusinessScope', {
        DEFAULT_TASK_BUSINESS_CONTEXT: 'event_genix',
        taskBusinessContextFromPayload: () => 'event_genix'
    });
    installMock('../services/taskNotifications', {
        emitTaskAssignedToOwner: () => {}
    });
    installMock('../utils/logger', {
        createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} })
    });
}

function loadCreateTask(pool, telegramCalls = []) {
    installKleshnyaMocks(pool, telegramCalls);
    return require('../services/kleshnya').createTask;
}

function loadHermesRouter() {
    delete require.cache[require.resolve('../routes/hermes')];
    return require('../routes/hermes').createHermesRouter;
}

function hermesLifecycleAuth(req, res, next) {
    if (req.get('x-api-key') !== 'unit-hermes-key') {
        return res.status(401).json({
            success: false,
            code: 'HERMES_AUTH_REQUIRED',
            error: 'Hermes API key is required'
        });
    }
    req.user = {
        id: 42,
        username: 'hermes.worker',
        name: 'Hermes Worker',
        role: 'director',
        business_contexts: ['event_genix'],
        defaultBusinessContext: 'event_genix'
    };
    req.integration = { id: 'hermes-event-genix-crm', source: 'hermes' };
    return next();
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

async function request(baseUrl, method, path, body, headers = AUTH_HEADERS) {
    const reqHeaders = { ...headers };
    if (body !== undefined && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: res.status, data, text };
}

async function withHermesApp(pool, work) {
    const app = express();
    app.use(express.json());
    app.use('/api/hermes', loadHermesRouter()({
        authMiddleware: hermesLifecycleAuth,
        pool,
        rateLimit: false,
        env: {}
    }));

    const { server, baseUrl } = await listen(app);
    try {
        await work(baseUrl);
    } finally {
        await close(server);
    }
}

function taskPayload(overrides = {}) {
    return {
        title: 'Coordinate decor',
        assigned_to: 'Sergiy',
        owner_user_id: 4,
        task_type: 'human',
        priority: 'high',
        created_by: 'manager',
        created_by_user_id: 2,
        ...overrides
    };
}

async function createOwnedTask(pool, telegramCalls = []) {
    const createTask = loadCreateTask(pool, telegramCalls);
    return createTask(taskPayload(), {
        skipNotifications: true,
        hermesOutboxEnabled: true,
        hermesOutboxContext: { crmBaseUrl: 'https://crm.example.com' }
    });
}

test.afterEach(() => {
    clearModules();
});

test('notification_outbox lifecycle A: create task with owner creates exactly one pending event', async () => {
    const pool = new LifecyclePool();
    const telegramCalls = [];

    const task = await createOwnedTask(pool, telegramCalls);

    assert.equal(pool.tasks.length, 1);
    assert.equal(pool.tasks[0].id, task.id);
    assert.equal(pool.outbox.length, 1);
    assert.equal(pool.outbox[0].event_type, 'task_created');
    assert.equal(pool.outbox[0].status, 'pending');
    assert.equal(pool.outbox[0].task_id, task.id);
    assert.equal(pool.outbox[0].owner_user_id, 4);
    assert.equal(telegramCalls.length, 0);
});

test('notification_outbox lifecycle B: create task without owner creates no event', async () => {
    const pool = new LifecyclePool({ users: [] });
    const telegramCalls = [];
    const createTask = loadCreateTask(pool, telegramCalls);

    await createTask(taskPayload({
        assigned_to: null,
        owner_user_id: null
    }), {
        skipNotifications: true,
        hermesOutboxEnabled: true
    });

    assert.equal(pool.tasks.length, 1);
    assert.equal(pool.outbox.length, 0);
    assert.equal(telegramCalls.length, 0);
});

test('notification_outbox lifecycle C: skipHermesOutbox suppresses event creation', async () => {
    const pool = new LifecyclePool();
    const telegramCalls = [];
    const createTask = loadCreateTask(pool, telegramCalls);

    await createTask(taskPayload(), {
        skipNotifications: true,
        skipHermesOutbox: true,
        hermesOutboxEnabled: true
    });

    assert.equal(pool.tasks.length, 1);
    assert.equal(pool.outbox.length, 0);
    assert.equal(telegramCalls.length, 0);
});

test('notification_outbox lifecycle D-G: list, claim, ack, and idempotent ack without Telegram delivery', async () => {
    const pool = new LifecyclePool();
    const telegramCalls = [];
    const task = await createOwnedTask(pool, telegramCalls);
    const eventId = `task_created:${task.id}:owner:4`;

    await withHermesApp(pool, async baseUrl => {
        const list = await request(baseUrl, 'GET', '/api/hermes/notification-outbox?status=pending');
        assert.equal(list.status, 200, list.text);
        assert.equal(list.data.items.length, 1);
        assert.equal(list.data.items[0].eventId, eventId);
        assert.equal(list.data.items[0].payload.taskId, task.id);
        assert.equal(list.data.items[0].payload.ownerUserId, 4);
        assert.equal(list.data.items[0].payload.rawHeaders, undefined);

        const claim = await request(baseUrl, 'POST', `/api/hermes/notification-outbox/${eventId}/claim`, {
            workerId: 'worker-a',
            lockSeconds: 120
        });
        assert.equal(claim.status, 200, claim.text);
        assert.equal(claim.data.event.status, 'claimed');
        assert.equal(pool.outbox[0].status, 'claimed');
        assert.equal(pool.outbox[0].claimed_by, 'worker-a');
        assert.ok(pool.outbox[0].locked_until);

        const ack = await request(baseUrl, 'POST', `/api/hermes/notification-outbox/${eventId}/ack`, {
            workerId: 'worker-a',
            channel: 'telegram',
            target: '674972415',
            sentAt: '2026-06-29T12:03:00.000Z'
        });
        assert.equal(ack.status, 200, ack.text);
        assert.equal(ack.data.event.status, 'sent');
        assert.equal(pool.outbox[0].status, 'sent');
        assert.equal(pool.outbox[0].sent_at, '2026-06-29T12:03:00.000Z');
        assert.equal(pool.outbox[0].last_delivery_channel, 'telegram');
        assert.equal(pool.outbox[0].last_delivery_target, '674972415');

        const secondAck = await request(baseUrl, 'POST', `/api/hermes/notification-outbox/${eventId}/ack`, {
            workerId: 'worker-a',
            channel: 'telegram',
            target: '674972415'
        });
        assert.equal(secondAck.status, 200, secondAck.text);
        assert.equal(secondAck.data.success, true);
        assert.equal(secondAck.data.alreadySent, true);
        assert.equal(pool.outbox[0].status, 'sent');
        assert.equal(pool.outbox[0].last_delivery_channel, 'telegram');
    });

    assert.equal(telegramCalls.length, 0);
});

test('notification_outbox lifecycle H: retryable fail increments attempts and schedules retry', async () => {
    const pool = new LifecyclePool();
    const telegramCalls = [];
    const task = await createOwnedTask(pool, telegramCalls);
    const eventId = `task_created:${task.id}:owner:4`;

    await withHermesApp(pool, async baseUrl => {
        await request(baseUrl, 'POST', `/api/hermes/notification-outbox/${eventId}/claim`, {
            workerId: 'worker-a',
            lockSeconds: 120
        });

        const failed = await request(baseUrl, 'POST', `/api/hermes/notification-outbox/${eventId}/fail`, {
            workerId: 'worker-a',
            errorCode: 'TELEGRAM_RATE_LIMIT',
            errorMessage: 'rate limited',
            retryable: true
        });
        assert.equal(failed.status, 200, failed.text);
        assert.equal(failed.data.event.status, 'failed');
        assert.equal(pool.outbox[0].status, 'failed');
        assert.equal(pool.outbox[0].attempts, 1);
        assert.equal(pool.outbox[0].last_error_code, 'TELEGRAM_RATE_LIMIT');
        assert.ok(new Date(pool.outbox[0].available_at).getTime() > new Date(NOW).getTime());
    });

    assert.equal(telegramCalls.length, 0);
});

test('notification_outbox lifecycle I: retryable fail at max attempts moves to dead_letter', async () => {
    const pool = new LifecyclePool();
    const telegramCalls = [];
    const task = await createOwnedTask(pool, telegramCalls);
    const eventId = `task_created:${task.id}:owner:4`;
    pool.outbox[0].attempts = 4;

    await withHermesApp(pool, async baseUrl => {
        await request(baseUrl, 'POST', `/api/hermes/notification-outbox/${eventId}/claim`, {
            workerId: 'worker-a',
            lockSeconds: 120
        });

        const failed = await request(baseUrl, 'POST', `/api/hermes/notification-outbox/${eventId}/fail`, {
            workerId: 'worker-a',
            errorCode: 'DELIVERY_FAILED',
            errorMessage: 'still failing',
            retryable: true
        });
        assert.equal(failed.status, 200, failed.text);
        assert.equal(failed.data.deadLetter, true);
        assert.equal(failed.data.event.status, 'dead_letter');
        assert.equal(pool.outbox[0].status, 'dead_letter');
        assert.equal(pool.outbox[0].attempts, 5);
    });

    assert.equal(telegramCalls.length, 0);
});
