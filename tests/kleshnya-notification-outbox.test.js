'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const MODULES_TO_CLEAR = [
    '../db',
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
        try { delete require.cache[require.resolve(modulePath)]; } catch (_) {}
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

class FakeKleshnyaPool {
    constructor(options = {}) {
        this.outbox = [];
        this.taskLogs = [];
        this.queries = [];
        this.nextTaskId = options.nextTaskId || 100;
        this.fixedTaskId = options.fixedTaskId || null;
        this.taskStatus = options.taskStatus || 'todo';
        this.failOutboxInsert = options.failOutboxInsert === true;
        this.users = new Map(options.users || [
            [4, { id: 4, username: 'sergiy', name: 'Сергій' }]
        ]);
    }

    taskId() {
        if (this.fixedTaskId) return this.fixedTaskId;
        return this.nextTaskId++;
    }

    userByLabel(label) {
        const normalized = String(label || '').trim().toLowerCase();
        return [...this.users.values()].find(user =>
            String(user.username || '').toLowerCase() === normalized
            || String(user.name || '').toLowerCase() === normalized
        ) || null;
    }

    async query(sql, params = []) {
        const compact = String(sql).replace(/\s+/g, ' ').trim();
        this.queries.push({ sql: compact, params });

        if (compact.startsWith('SELECT id, username, name FROM users WHERE id = $1')) {
            const user = this.users.get(Number(params[0]));
            return { rows: user ? [clone(user)] : [], rowCount: user ? 1 : 0 };
        }

        if (compact.startsWith('SELECT id, username, name FROM users WHERE COALESCE')) {
            const user = this.userByLabel(params[0]);
            return { rows: user ? [clone(user)] : [], rowCount: user ? 1 : 0 };
        }

        if (compact.startsWith('INSERT INTO tasks')) {
            const id = this.taskId();
            return {
                rows: [{
                    id,
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
                    status: this.taskStatus,
                    workflow_state: 'todo',
                    created_at: '2026-06-29T10:00:00.000Z',
                    updated_at: '2026-06-29T10:00:00.000Z'
                }],
                rowCount: 1
            };
        }

        if (compact.startsWith('INSERT INTO task_logs')) {
            this.taskLogs.push({ params });
            return { rows: [], rowCount: 1 };
        }

        if (compact.startsWith('INSERT INTO notification_outbox')) {
            if (this.failOutboxInsert) {
                throw new Error('simulated outbox insert failure');
            }
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
                id: this.outbox.length + 1,
                event_id: params[0],
                task_id: params[1],
                owner_user_id: params[2],
                event_type: params[3],
                payload_json: JSON.parse(params[4]),
                payload_hash: params[5],
                status: 'pending',
                attempts: 0,
                available_at: params[6] || '2026-06-29T10:00:00.000Z',
                created_at: '2026-06-29T10:00:00.000Z',
                claimed_at: null,
                sent_at: null,
                last_error: null,
                last_error_code: null,
                last_delivery_channel: null,
                last_delivery_target: null,
                claimed_by: null,
                locked_until: null,
                updated_at: '2026-06-29T10:00:00.000Z'
            };
            this.outbox.push(row);
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (compact.startsWith('SELECT * FROM notification_outbox WHERE event_id = $1 OR')) {
            const row = this.outbox.find(item => item.event_id === params[0])
                || this.outbox.find(item =>
                    item.task_id === params[1]
                    && item.owner_user_id === params[2]
                    && item.event_type === params[3]
                    && item.payload_hash === params[4]
                );
            return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
        }

        if (compact.startsWith('SELECT telegram_chat_id FROM users WHERE id = $1')) {
            return { rows: [], rowCount: 0 };
        }

        if (compact.startsWith('SELECT telegram_username FROM users')) {
            return { rows: [], rowCount: 0 };
        }

        if (compact.startsWith('SELECT telegram_username FROM staff')) {
            return { rows: [], rowCount: 0 };
        }

        throw new Error(`Unexpected fake Kleshnya query: ${compact}`);
    }
}

function loadKleshnya(pool, telegramCalls = [], options = {}) {
    clearModules();
    installMock('../db', { pool });
    installMock('../services/telegram', {
        getConfiguredChatId: async () => 'legacy-group-chat',
        getConfiguredThreadId: async () => null,
        telegramRequest: async (method, body) => {
            if (options.telegramRequestError) throw new Error('simulated telegram request failure');
            telegramCalls.push({ method, body });
            return { ok: true };
        },
        sendTelegramMessage: async (chatId, text, options) => {
            if (options.sendTelegramMessageError) throw new Error('simulated telegram send failure');
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
        emitTaskAssignedToOwner: (...args) => {
            if (Array.isArray(options.taskNotificationCalls)) options.taskNotificationCalls.push(args);
            if (options.taskNotificationError) throw new Error('simulated task notification event failure');
        }
    });
    installMock('../utils/logger', {
        createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} })
    });
    return require('../services/kleshnya');
}

function taskPayload(overrides = {}) {
    return {
        title: 'Узгодити декор',
        assigned_to: 'Сергій',
        owner_user_id: 4,
        task_type: 'human',
        created_by: 'manager',
        created_by_user_id: 2,
        ...overrides
    };
}

test.afterEach(() => {
    clearModules();
});

test('createTask emits one pending notification_outbox event for owned active tasks', async () => {
    const pool = new FakeKleshnyaPool();
    const telegramCalls = [];
    const { createTask } = loadKleshnya(pool, telegramCalls);

    const task = await createTask(taskPayload(), {
        skipNotifications: true,
        hermesOutboxEnabled: true,
        hermesOutboxContext: { crmBaseUrl: 'https://crm.example.com' }
    });

    assert.equal(task.id, 100);
    assert.equal(pool.outbox.length, 1);
    assert.equal(pool.outbox[0].event_type, 'task_created');
    assert.equal(pool.outbox[0].status, 'pending');
    assert.equal(pool.outbox[0].task_id, task.id);
    assert.equal(pool.outbox[0].owner_user_id, 4);
    assert.equal(pool.outbox[0].event_id, 'task_created:100:owner:4');
    assert.equal(pool.outbox[0].payload_json.crmUrl, 'https://crm.example.com/tasks?open=100');
    assert.equal(telegramCalls.length, 0);
});

test('createTask without owner_user_id does not emit notification_outbox event', async () => {
    const pool = new FakeKleshnyaPool({ users: [] });
    const { createTask } = loadKleshnya(pool);

    await createTask(taskPayload({
        assigned_to: null,
        owner_user_id: null,
        created_by: 'system'
    }), {
        skipNotifications: true,
        hermesOutboxEnabled: true
    });

    assert.equal(pool.outbox.length, 0);
});

test('createTask with skipHermesOutbox does not emit notification_outbox event', async () => {
    const pool = new FakeKleshnyaPool();
    const { createTask } = loadKleshnya(pool);

    await createTask(taskPayload(), {
        skipNotifications: true,
        skipHermesOutbox: true,
        hermesOutboxEnabled: true
    });

    assert.equal(pool.outbox.length, 0);
});

test('HERMES_NOTIFICATION_OUTBOX_ENABLED enables outbox event creation in production-like runtime', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousTaskFlag = process.env.HERMES_TASK_OUTBOX_ENABLED;
    const previousAliasFlag = process.env.HERMES_NOTIFICATION_OUTBOX_ENABLED;
    const previousGenericFlag = process.env.NOTIFICATION_OUTBOX_ENABLED;
    try {
        process.env.NODE_ENV = 'production';
        delete process.env.HERMES_TASK_OUTBOX_ENABLED;
        process.env.HERMES_NOTIFICATION_OUTBOX_ENABLED = 'true';
        delete process.env.NOTIFICATION_OUTBOX_ENABLED;

        const pool = new FakeKleshnyaPool();
        const { createTask } = loadKleshnya(pool);

        await createTask(taskPayload(), {
            skipNotifications: true
        });

        assert.equal(pool.outbox.length, 1);
        assert.equal(pool.outbox[0].event_type, 'task_created');
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousTaskFlag === undefined) delete process.env.HERMES_TASK_OUTBOX_ENABLED;
        else process.env.HERMES_TASK_OUTBOX_ENABLED = previousTaskFlag;
        if (previousAliasFlag === undefined) delete process.env.HERMES_NOTIFICATION_OUTBOX_ENABLED;
        else process.env.HERMES_NOTIFICATION_OUTBOX_ENABLED = previousAliasFlag;
        if (previousGenericFlag === undefined) delete process.env.NOTIFICATION_OUTBOX_ENABLED;
        else process.env.NOTIFICATION_OUTBOX_ENABLED = previousGenericFlag;
    }
});

test('HERMES_NOTIFICATION_OUTBOX_ENABLED=false disables default local outbox event creation', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousTaskFlag = process.env.HERMES_TASK_OUTBOX_ENABLED;
    const previousAliasFlag = process.env.HERMES_NOTIFICATION_OUTBOX_ENABLED;
    const previousGenericFlag = process.env.NOTIFICATION_OUTBOX_ENABLED;
    try {
        process.env.NODE_ENV = 'test';
        delete process.env.HERMES_TASK_OUTBOX_ENABLED;
        process.env.HERMES_NOTIFICATION_OUTBOX_ENABLED = 'false';
        delete process.env.NOTIFICATION_OUTBOX_ENABLED;

        const pool = new FakeKleshnyaPool();
        const { createTask } = loadKleshnya(pool);

        await createTask(taskPayload(), {
            skipNotifications: true
        });

        assert.equal(pool.outbox.length, 0);
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousTaskFlag === undefined) delete process.env.HERMES_TASK_OUTBOX_ENABLED;
        else process.env.HERMES_TASK_OUTBOX_ENABLED = previousTaskFlag;
        if (previousAliasFlag === undefined) delete process.env.HERMES_NOTIFICATION_OUTBOX_ENABLED;
        else process.env.HERMES_NOTIFICATION_OUTBOX_ENABLED = previousAliasFlag;
        if (previousGenericFlag === undefined) delete process.env.NOTIFICATION_OUTBOX_ENABLED;
        else process.env.NOTIFICATION_OUTBOX_ENABLED = previousGenericFlag;
    }
});

test('createTask with terminal status does not emit notification_outbox event', async () => {
    const pool = new FakeKleshnyaPool({ taskStatus: 'done' });
    const { createTask } = loadKleshnya(pool);

    await createTask(taskPayload(), {
        skipNotifications: true,
        hermesOutboxEnabled: true
    });

    assert.equal(pool.outbox.length, 0);
});

test('createTask duplicate outbox event id is idempotent', async () => {
    const pool = new FakeKleshnyaPool({ fixedTaskId: 501 });
    const telegramCalls = [];
    const taskNotificationCalls = [];
    const { createTask } = loadKleshnya(pool, telegramCalls, { taskNotificationCalls });

    await createTask(taskPayload(), {
        hermesOutboxEnabled: true
    });
    await createTask(taskPayload(), {
        hermesOutboxEnabled: true
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(pool.outbox.length, 1);
    assert.equal(pool.outbox[0].event_id, 'task_created:501:owner:4');
    assert.equal(telegramCalls.length, 0);
    assert.equal(taskNotificationCalls.length, 0);
});

test('createTask with Hermes outbox enabled uses outbox instead of legacy notification', async () => {
    const pool = new FakeKleshnyaPool();
    const telegramCalls = [];
    const taskNotificationCalls = [];
    const { createTask } = loadKleshnya(pool, telegramCalls, { taskNotificationCalls });

    await createTask(taskPayload(), {
        hermesOutboxEnabled: true
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(pool.outbox.length, 1);
    assert.equal(telegramCalls.length, 0);
    assert.equal(taskNotificationCalls.length, 0);
});

test('createTask with Hermes outbox disabled preserves legacy notification fallback', async () => {
    const pool = new FakeKleshnyaPool();
    const telegramCalls = [];
    const taskNotificationCalls = [];
    const { createTask } = loadKleshnya(pool, telegramCalls, { taskNotificationCalls });

    await createTask(taskPayload(), {
        hermesOutboxEnabled: false
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(pool.outbox.length, 0);
    assert.ok(telegramCalls.some(call => call.method === 'sendMessage' || call.method === 'sendTelegramMessage'));
    assert.equal(JSON.stringify(telegramCalls).includes('Hermes'), false);
    assert.equal(taskNotificationCalls.length, 1);
});

test('createTask with skipped Hermes outbox preserves legacy notification fallback', async () => {
    const pool = new FakeKleshnyaPool();
    const telegramCalls = [];
    const taskNotificationCalls = [];
    const { createTask } = loadKleshnya(pool, telegramCalls, { taskNotificationCalls });

    await createTask(taskPayload(), {
        hermesOutboxEnabled: true,
        skipHermesOutbox: true
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(pool.outbox.length, 0);
    assert.ok(telegramCalls.some(call => call.method === 'sendMessage' || call.method === 'sendTelegramMessage'));
    assert.equal(taskNotificationCalls.length, 1);
});

test('notification path errors do not block task creation', async () => {
    const pool = new FakeKleshnyaPool({ failOutboxInsert: true });
    const telegramCalls = [];
    const { createTask } = loadKleshnya(pool, telegramCalls, {
        telegramRequestError: true,
        taskNotificationError: true
    });

    const task = await createTask(taskPayload(), {
        hermesOutboxEnabled: true
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(task.id, 100);
    assert.equal(pool.outbox.length, 0);
});
