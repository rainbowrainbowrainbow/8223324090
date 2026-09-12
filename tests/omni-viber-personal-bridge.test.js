'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BridgeError,
  authenticate,
  bridgeScope,
  createService,
  payloadHash,
  validateEvent,
} = require('../services/omni-viber-personal-bridge');

const IDS = Object.freeze({
  bridge: '00000000-0000-4000-8000-000000000001',
  account: '00000000-0000-4000-8000-000000000002',
  runtime: '00000000-0000-4000-8000-000000000003',
  chat: '00000000-0000-4000-8000-000000000010',
  event: '00000000-0000-4000-8000-000000000101',
  command: '00000000-0000-4000-8000-000000000201',
});
const TOKEN = 'bridge_test_token_1234567890';

function scope(overrides = {}) {
  return {
    protocol_version: '1.0',
    bridge_id: IDS.bridge,
    account_id: IDS.account,
    account_epoch: 1,
    business_context: 'event_genix',
    runtime_id: IDS.runtime,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    ...scope(),
    type: 'message.observed',
    event_id: IDS.event,
    sequence: '101',
    observed_at: '2026-09-12T09:00:00.000Z',
    chat_id: IDS.chat,
    binding_revision: 1,
    identity: { level: 'verified', peer_ref: 'a'.repeat(64) },
    message: { direction: 'inbound', origin: 'external_viber', text: 'Тестове вхідне' },
    ...overrides,
  };
}

function bridgeErrorCode(fn) {
  try { fn(); } catch (error) {
    assert.ok(error instanceof BridgeError);
    return error.code;
  }
  assert.fail('Expected BridgeError');
}

test('scope and Bearer authentication fail closed', () => {
  const parsed = bridgeScope(scope());
  assert.equal(parsed.businessContext, 'event_genix');
  assert.equal(bridgeErrorCode(() => bridgeScope(scope({ business_context: '' }))), 'BUSINESS_CONTEXT_INVALID');
  assert.equal(bridgeErrorCode(() => bridgeScope(scope({ protocol_version: '2.0' }))), 'PROTOCOL_VERSION_UNSUPPORTED');
  assert.equal(bridgeErrorCode(() => authenticate({ bridgeToken: TOKEN, bridgeId: IDS.bridge,
    accountId: IDS.account, accountEpoch: 1 }, 'Bearer wrong_token_wrong_token_123', parsed)), 'BRIDGE_AUTH_FAILED');
  assert.equal(bridgeErrorCode(() => authenticate({ bridgeToken: TOKEN, bridgeId: IDS.bridge,
    accountId: IDS.account, accountEpoch: 2 }, `Bearer ${TOKEN}`, parsed)), 'BRIDGE_SCOPE_MISMATCH');
});

test('event contract preserves occurrences and rejects ambiguous identity', () => {
  const parsedScope = bridgeScope(scope());
  assert.equal(validateEvent(event(), parsedScope).sequence, '101');
  assert.notEqual(payloadHash(event()), payloadHash(event({ event_id: '00000000-0000-4000-8000-000000000102' })));
  assert.equal(bridgeErrorCode(() => validateEvent(event({ identity: { level: 'heuristic', peer_ref: 'a'.repeat(64) } }), parsedScope)), 'IDENTITY_INVALID');
  assert.equal(bridgeErrorCode(() => validateEvent(event({ message: { direction: 'inbound', origin: 'external_viber', text: '' } }), parsedScope)), 'MESSAGE_INVALID');
});

test('heartbeat authenticates before writing and exposes only scoped runtime state', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT \* FROM omni_viber_personal_bridge_runtime/.test(sql)) return { rows: [{
      last_heartbeat_at: '2026-09-12T09:00:00.000Z', last_receive_at: null, capabilities: { send_text: true },
    }] };
    return { rows: [] };
  } };
  db.connect = async () => ({ query: db.query, release() {} });
  const service = createService({ pool: db, now: () => new Date('2026-09-12T09:00:30.000Z') });
  await assert.rejects(service.heartbeat(scope(), { bridgeToken: TOKEN, bridgeId: IDS.bridge,
    accountId: IDS.account, accountEpoch: 1 }, 'Bearer invalid_invalid_invalid_123'), error => error.code === 'BRIDGE_AUTH_FAILED');
  assert.equal(calls.length, 0);
  await service.heartbeat({ ...scope(), capabilities: { send_text: true } }, { bridgeToken: TOKEN,
    bridgeId: IDS.bridge, accountId: IDS.account, accountEpoch: 1 }, `Bearer ${TOKEN}`);
  const state = await service.status({ bridgeId: IDS.bridge }, 'event_genix');
  assert.equal(state.online, true);
  assert.deepEqual(state.capabilities, { send_text: true });
});

test('inbound event is committed, routed as Viber, and duplicate is idempotent', async () => {
  const stored = new Map();
  const calls = [];
  const db = {
    async connect() { return { query: db.query, release() {} }; },
    async query(sql, params = []) {
      if (/SELECT runtime_id,last_heartbeat_at FROM omni_viber_personal_bridge_runtime/.test(sql)) {
        return { rows: [{ runtime_id: IDS.runtime, last_heartbeat_at: '2026-09-12T09:00:00.000Z' }] };
      }
      if (/SELECT payload_hash, status FROM omni_viber_personal_bridge_events/.test(sql)) {
        const row = stored.get(params[2]);
        return { rows: row ? [row] : [] };
      }
      if (/INSERT INTO omni_viber_personal_bridge_events/.test(sql)) {
        stored.set(params[2], { payload_hash: params[9], status: 'received' });
      }
      if (/UPDATE omni_viber_personal_bridge_events SET status=\$4/.test(sql)) {
        stored.set(params[2], { ...stored.get(params[2]), status: params[3] });
      }
      return { rows: [] };
    },
  };
  const hub = { processInboundMessage: async (message, options) => {
    calls.push({ message, options });
    return { conversation: { id: 77 } };
  } };
  const service = createService({ pool: db, hub });
  const payload = { protocol_version: '1.0', events: [event()] };
  const runtime = { bridgeToken: TOKEN, bridgeId: IDS.bridge, accountId: IDS.account, accountEpoch: 1 };
  const first = await service.ingest(payload, runtime, `Bearer ${TOKEN}`);
  const second = await service.ingest(payload, runtime, `Bearer ${TOKEN}`);
  assert.deepEqual(first.acked_event_ids, [IDS.event]);
  assert.deepEqual(second.acked_event_ids, [IDS.event]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message.channel, 'viber');
  assert.equal(calls[0].message.externalId, `personal:${IDS.bridge}:${IDS.chat}`);
  assert.equal(calls[0].message.meta.connectorType, 'viber_personal_bridge');
});

test('same event ID with changed content is rejected instead of overwriting history', async () => {
  const hash = payloadHash(event());
  const db = {
    async connect() { return { query: db.query, release() {} }; },
    async query(sql) {
      if (/SELECT runtime_id,last_heartbeat_at FROM omni_viber_personal_bridge_runtime/.test(sql)) {
        return { rows: [{ runtime_id: IDS.runtime, last_heartbeat_at: '2026-09-12T09:00:00.000Z' }] };
      }
      if (/SELECT payload_hash, status FROM/.test(sql)) return { rows: [{ payload_hash: hash, status: 'processed' }] };
      return { rows: [] };
    },
  };
  const service = createService({ pool: db, hub: {} });
  const runtime = { bridgeToken: TOKEN, bridgeId: IDS.bridge, accountId: IDS.account, accountEpoch: 1 };
  await assert.rejects(service.ingest({ protocol_version: '1.0', events: [event({
    message: { direction: 'inbound', origin: 'external_viber', text: 'Інший текст' },
  })] }, runtime, `Bearer ${TOKEN}`), error => error.code === 'EVENT_ID_CONFLICT' && error.statusCode === 409);
});

test('stale heartbeat blocks CRM send before a command can be queued', async () => {
  const db = { query: async () => ({ rows: [{ last_heartbeat_at: '2026-09-12T08:58:00.000Z' }] }) };
  const service = createService({ pool: db, now: () => new Date('2026-09-12T09:00:00.000Z') });
  await assert.rejects(service.assertSendCapable({ channel: 'viber', businessContext: 'event_genix', meta: {
    connectorType: 'viber_personal_bridge', identityLevel: 'verified', bridgeId: IDS.bridge,
    accountId: IDS.account, accountEpoch: 1,
  } }), error => error.code === 'BRIDGE_OFFLINE');
});

test('command result state machine cannot rewrite a terminal delivery result', async () => {
  let row = {
    command_id: IDS.command,
    message_id: 99,
    status: 'leased',
    error_code: null,
    lease_runtime_id: IDS.runtime,
  };
  const client = {
    async query(sql, params = []) {
      if (/SELECT \* FROM omni_viber_personal_bridge_commands/.test(sql)) return { rows: [{ ...row }] };
      if (/UPDATE omni_viber_personal_bridge_commands SET status=\$2/.test(sql)) {
        row = { ...row, status: params[1], error_code: params[2] };
        return { rows: [{ ...row }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const savedTruth = [];
  const hub = {
    buildSendTruth: (status, details) => ({ status, ...details }),
    saveMessageSendTruth: async (messageId, truth) => { savedTruth.push({ messageId, truth }); },
  };
  const service = createService({ pool: {
    connect: async () => client,
    query: async sql => /SELECT runtime_id,last_heartbeat_at FROM/.test(sql)
      ? { rows: [{ runtime_id: IDS.runtime, last_heartbeat_at: '2026-09-12T09:00:00.000Z' }] }
      : { rows: [] },
  }, hub });
  const runtime = { bridgeToken: TOKEN, bridgeId: IDS.bridge, accountId: IDS.account, accountEpoch: 1 };
  await service.commandResult(IDS.command, { ...scope(), status: 'dispatch_started' }, runtime, `Bearer ${TOKEN}`);
  assert.equal(row.status, 'dispatch_started');
  assert.equal(savedTruth.length, 0);
  await service.commandResult(IDS.command, { ...scope(), status: 'submitted_unconfirmed' }, runtime, `Bearer ${TOKEN}`);
  assert.equal(row.status, 'submitted_unconfirmed');
  assert.equal(savedTruth[0].messageId, 99);
  assert.equal(savedTruth[0].truth.status, 'provider_attempted');
  await assert.rejects(
    service.commandResult(IDS.command, { ...scope(), status: 'unknown', error_code: 'LATE_CHANGE' }, runtime, `Bearer ${TOKEN}`),
    error => error.code === 'COMMAND_RESULT_CONFLICT' && error.statusCode === 409
  );
  assert.equal(row.status, 'submitted_unconfirmed');
});
