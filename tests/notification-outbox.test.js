const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTaskNotificationPayload,
  createNotificationOutboxEvent,
  emitTaskCreatedNotificationOutboxEvent,
  generateNotificationEventId,
  hashNotificationPayload,
  hermesTaskOutboxEnabled
} = require('../services/notificationOutbox');

test('notification_outbox payload is safe and deterministic', () => {
  const task = {
    id: 42,
    title: ' Перевірити Hermes ',
    status: 'todo',
    priority: 'high',
    owner_user_id: 4,
    owner: 'Сергій',
    deadline: '2026-06-30T12:00:00.000Z',
    token: 'SECRET_SHOULD_NOT_APPEAR'
  };
  const payload = buildTaskNotificationPayload(task, { crmBaseUrl: 'https://crm.example' });
  assert.equal(payload.taskId, 42);
  assert.equal(payload.ownerUserId, 4);
  assert.equal(payload.title, 'Перевірити Hermes');
  assert.equal(payload.priority, 'high');
  assert.match(payload.crmUrl, /https:\/\/crm\.example\/tasks\?open=42/);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'token'), false);
  assert.equal(hashNotificationPayload(payload), hashNotificationPayload({ ...payload }));
  assert.equal(generateNotificationEventId(task, 'task_created'), 'task_created:42:owner:4');
});

test('notification_outbox flags default safely by environment', () => {
  assert.equal(hermesTaskOutboxEnabled({}, { NODE_ENV: 'production' }), false);
  assert.equal(hermesTaskOutboxEnabled({}, { NODE_ENV: 'test' }), true);
  assert.equal(hermesTaskOutboxEnabled({}, { HERMES_NOTIFICATION_OUTBOX_ENABLED: 'true' }), true);
  assert.equal(hermesTaskOutboxEnabled({}, { HERMES_NOTIFICATION_OUTBOX_ENABLED: 'false', NODE_ENV: 'test' }), false);
});

test('emitTaskCreatedNotificationOutboxEvent no-ops without owner id', async () => {
  const result = await emitTaskCreatedNotificationOutboxEvent({ id: 9, title: 'No owner' }, { env: { NODE_ENV: 'test' } });
  assert.equal(result.created, false);
  assert.equal(result.reason, 'no_owner_user_id');
});

test('createNotificationOutboxEvent inserts sanitized payload once', async () => {
  const queries = [];
  const fakePool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/INSERT INTO notification_outbox/.test(sql)) {
        return { rows: [{
          id: 1,
          event_id: params[0],
          task_id: params[1],
          owner_user_id: params[2],
          event_type: params[3],
          payload_json: JSON.parse(params[4]),
          payload_hash: params[5],
          status: 'pending',
          attempts: 0,
          available_at: null,
          created_at: new Date('2026-06-30T09:00:00Z'),
          updated_at: new Date('2026-06-30T09:00:00Z')
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const result = await createNotificationOutboxEvent({
    task: { id: 77, title: 'Task', owner_user_id: 4, priority: 'normal' },
    eventType: 'task_created',
    payload: { taskId: 77, ownerUserId: 4, title: 'Task', secret: 'drop-me' }
  }, { pool: fakePool });
  assert.equal(result.created, true);
  assert.equal(result.event.event_id, 'task_created:77:owner:4');
  assert.equal(result.event.payload_json.secret, undefined);
  assert.equal(queries.length, 1);
});
