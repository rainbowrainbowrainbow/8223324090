const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildTaskNotificationPayload,
    createNotificationOutboxEvent,
    findNotificationOutboxEventByEventId,
    generateNotificationEventId,
    hashNotificationPayload
} = require('../services/notificationOutbox');

function baseTask(overrides = {}) {
    return {
        id: 123,
        title: 'Узгодити декор',
        status: 'todo',
        priority: 'high',
        owner_user_id: 4,
        owner_name: 'Сергій',
        deadline: '2026-06-30T15:00:00.000Z',
        created_at: '2026-06-29T10:00:00.000Z',
        updated_at: '2026-06-29T11:00:00.000Z',
        ...overrides
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

class FakeNotificationOutboxPool {
    constructor() {
        this.rows = [];
        this.nextId = 1;
        this.queries = [];
    }

    async query(sql, params = []) {
        const compact = sql.replace(/\s+/g, ' ').trim();
        this.queries.push({ sql: compact, params });

        if (compact.startsWith('INSERT INTO notification_outbox')) {
            const semanticDuplicate = this.rows.find(row =>
                row.task_id === params[1]
                && row.owner_user_id === params[2]
                && row.event_type === params[3]
                && row.payload_hash === params[5]
            );
            const eventDuplicate = this.rows.find(row => row.event_id === params[0]);
            if (eventDuplicate || semanticDuplicate) {
                return { rows: [], rowCount: 0 };
            }

            const now = '2026-06-29T12:00:00.000Z';
            const row = {
                id: this.nextId++,
                event_id: params[0],
                task_id: params[1],
                owner_user_id: params[2],
                event_type: params[3],
                payload_json: JSON.parse(params[4]),
                payload_hash: params[5],
                status: 'pending',
                attempts: 0,
                available_at: params[6] || now,
                created_at: now,
                claimed_at: null,
                sent_at: null,
                last_error: null,
                last_error_code: null,
                last_delivery_channel: null,
                last_delivery_target: null,
                claimed_by: null,
                locked_until: null,
                updated_at: now
            };
            this.rows.push(row);
            return { rows: [clone(row)], rowCount: 1 };
        }

        if (compact.startsWith('SELECT * FROM notification_outbox WHERE event_id = $1 OR')) {
            const row = this.rows.find(item => item.event_id === params[0])
                || this.rows.find(item =>
                    item.task_id === params[1]
                    && item.owner_user_id === params[2]
                    && item.event_type === params[3]
                    && item.payload_hash === params[4]
                );
            return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
        }

        if (compact.startsWith('SELECT * FROM notification_outbox WHERE event_id = $1')) {
            const row = this.rows.find(item => item.event_id === params[0]);
            return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
        }

        throw new Error(`Unexpected fake notification outbox query: ${compact}`);
    }
}

test('builds a safe task notification payload for Hermes delivery', () => {
    const payload = buildTaskNotificationPayload(baseTask(), {
        crmBaseUrl: 'https://crm.example.com/'
    });

    assert.deepEqual(payload, {
        taskId: 123,
        title: 'Узгодити декор',
        status: 'open',
        priority: 'high',
        ownerUserId: 4,
        ownerLabel: 'Сергій',
        dueAt: '2026-06-30T15:00:00.000Z',
        crmUrl: 'https://crm.example.com/tasks?open=123',
        createdAt: '2026-06-29T10:00:00.000Z',
        updatedAt: '2026-06-29T11:00:00.000Z'
    });
});

test('task notification payload excludes secrets and raw private fields', () => {
    const payload = buildTaskNotificationPayload(baseTask({
        apiKey: 'secret-api-key',
        botToken: 'secret-bot-token',
        cookie: 'session-cookie',
        rawHeaders: { authorization: 'Bearer secret' },
        password: 'hidden',
        raw_payload: { client_phone: '+380000000000' },
        stack: 'internal stack trace'
    }), {
        crmUrl: 'https://crm.example.com/tasks/123'
    });

    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes('secret-api-key'), false);
    assert.equal(serialized.includes('secret-bot-token'), false);
    assert.equal(serialized.includes('session-cookie'), false);
    assert.equal(serialized.includes('Bearer secret'), false);
    assert.equal(serialized.includes('hidden'), false);
    assert.equal(serialized.includes('+380000000000'), false);
    assert.equal(serialized.includes('internal stack trace'), false);
});

test('notification payload hash is stable for the same logical payload', () => {
    const first = {
        taskId: 123,
        title: 'Узгодити декор',
        ownerUserId: 4,
        nested: { b: 2, a: 1 }
    };
    const second = {
        nested: { a: 1, b: 2 },
        ownerUserId: 4,
        title: 'Узгодити декор',
        taskId: 123
    };

    assert.equal(hashNotificationPayload(first), hashNotificationPayload(second));
});

test('notification event id is deterministic for task and event type', () => {
    const task = baseTask();

    assert.equal(
        generateNotificationEventId(task, 'task_created'),
        'task_created:123:owner:4'
    );
    assert.equal(
        generateNotificationEventId(task, 'task_created'),
        generateNotificationEventId({ taskId: 123, ownerUserId: 4 }, 'task_created')
    );
    assert.equal(
        generateNotificationEventId(task, 'task_assigned'),
        'task_assigned:123:owner:4'
    );
});

test('createNotificationOutboxEvent inserts pending event and treats duplicate event id as idempotent', async () => {
    const pool = new FakeNotificationOutboxPool();
    const task = baseTask();

    const first = await createNotificationOutboxEvent({
        task,
        eventType: 'task_created',
        context: { crmBaseUrl: 'https://crm.example.com' }
    }, { pool });
    const duplicate = await createNotificationOutboxEvent({
        task,
        eventType: 'task_created',
        context: { crmBaseUrl: 'https://crm.example.com' }
    }, { pool });
    const found = await findNotificationOutboxEventByEventId('task_created:123:owner:4', { pool });

    assert.equal(first.created, true);
    assert.equal(first.event.status, 'pending');
    assert.equal(first.event.event_id, 'task_created:123:owner:4');
    assert.equal(first.event.payload_hash, hashNotificationPayload(first.event.payload_json));
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.event.id, first.event.id);
    assert.equal(pool.rows.length, 1);
    assert.equal(found.id, first.event.id);
});

test('createNotificationOutboxEvent sanitizes explicit payload before storing and hashing', async () => {
    const pool = new FakeNotificationOutboxPool();
    const task = baseTask({ id: 777 });

    const result = await createNotificationOutboxEvent({
        task,
        eventType: 'task_created',
        payload: {
            taskId: 777,
            title: 'Safe title',
            status: 'open',
            priority: 'high',
            ownerUserId: 4,
            ownerLabel: 'Sergiy',
            crmUrl: 'https://crm.example.com/tasks?open=777',
            createdAt: '2026-06-29T10:00:00.000Z',
            updatedAt: '2026-06-29T11:00:00.000Z',
            apiKey: 'secret-api-key',
            botToken: 'secret-bot-token',
            rawHeaders: { authorization: 'Bearer secret' },
            privateClientPayload: { phone: '+380000000000' },
            stack: 'internal stack trace'
        }
    }, { pool });

    const stored = result.event.payload_json;
    assert.equal(result.created, true);
    assert.equal(stored.taskId, 777);
    assert.equal(stored.title, 'Safe title');
    assert.equal(stored.apiKey, undefined);
    assert.equal(stored.botToken, undefined);
    assert.equal(stored.rawHeaders, undefined);
    assert.equal(stored.privateClientPayload, undefined);
    assert.equal(stored.stack, undefined);
    assert.equal(
        result.event.payload_hash,
        hashNotificationPayload(stored)
    );
    assert.equal(JSON.stringify(stored).includes('secret'), false);
    assert.equal(JSON.stringify(stored).includes('+380000000000'), false);
});
