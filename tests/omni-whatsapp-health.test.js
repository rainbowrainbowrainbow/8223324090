'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const dbId = require.resolve('../db');
const healthId = require.resolve('../services/omni-health');
const originalDb = require.cache[dbId];
afterEach(() => { delete require.cache[healthId]; if (originalDb) require.cache[dbId] = originalDb; else delete require.cache[dbId]; });
const changed = '2026-09-17T10:00:00Z';
const inbound = '2026-09-18T10:00:00Z';
const checked = '2026-09-21T10:00:00Z';
function fixture(overrides = {}) {
  const row = { business_context: 'event_genix', channel: 'whatsapp', checked_at: checked,
    last_inbound_at: inbound, check_result: { status: 'partial' }, ...overrides };
  const calls = [];
  require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool: { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT')) return { rows: values[0] === row.business_context ? [row] : [] };
    if (sql.includes('checked_at')) row.check_result = JSON.parse(values[2]);
    return { rows: [] };
  } } } };
  delete require.cache[healthId];
  return { health: require('../services/omni-health'), calls };
}
function account(overrides = {}) { return { channel: 'whatsapp', businessContext: 'event_genix', source: 'database',
  lastChangedAt: changed, configured: true, connected: true, status: 'limited', limited: true,
  sendCapable: true, receiveCapable: false, requiredDirections: { send: true, receive: true }, ...overrides }; }
async function state(health, overrides = {}, context = 'event_genix') {
  return (await health.attachHealth([account(overrides)], context, new Date(checked)))[0];
}
test('accepted inbound survives repeated partial checks and a quiet dialogue', async () => {
  const { health } = fixture();
  for (let i = 0; i < 2; i++) {
    await health.saveCheck('whatsapp', 'event_genix', { status: 'partial', details: {} });
    const result = await state(health);
    assert.equal(result.status, 'connected');
    assert.equal(result.receiveCapable, true);
    assert.equal(result.sendCapable, true);
    assert.equal(result.warning, null);
  }
});
test('configuration alone and other business evidence cannot confirm receipt', async () => {
  const { health } = fixture({ last_inbound_at: null });
  assert.equal((await state(health)).receiveCapable, false);
  assert.equal((await state(health, { businessContext: 'dar' }, 'dar')).receiveCapable, false);
});
test('old inbound cannot confirm a new configuration or an unversioned environment binding', async () => {
  const { health } = fixture();
  for (const overrides of [{ lastChangedAt: checked }, { source: 'environment', lastChangedAt: null }, { lastChangedAt: 'invalid' }]) {
    assert.equal((await state(health, overrides)).receiveCapable, false);
  }
});
test('accepted PARK inbound cannot confirm another business', async () => {
  const { health } = fixture();
  assert.equal((await state(health)).receiveCapable, true);
  assert.equal((await state(health, { businessContext: 'dar' }, 'dar')).receiveCapable, false);
});
test('a new processing error remains visible; a subsequent inbound recovers', async () => {
  const { health } = fixture({ last_error_at: checked, last_error_code: 'processing_failed' });
  const failed = await state(health);
  assert.equal(failed.receiveCapable, false);
  assert.equal(failed.status, 'limited');
  assert.equal(failed.diagnostics.activeProcessingError, true);
  assert.match(failed.warning, /помилк/);
  const { health: recovered } = fixture({ last_error_at: changed, last_error_code: null });
  assert.equal((await state(recovered)).receiveCapable, true);
});
test('provider failures and an explicit disconnection cannot be hidden by old inbound', async () => {
  for (const status of ['failed_auth', 'provider_unreachable', 'missing_config', 'webhook_missing']) {
    const { health } = fixture({ check_result: { status } });
    const result = await state(health);
    assert.equal(result.receiveCapable, false, status);
    assert.notEqual(result.status, 'connected', status);
    const envResult = await state(health, { source: 'environment', lastChangedAt: null });
    assert.equal(envResult.receiveCapable, false);
    assert.notEqual(envResult.status, 'limited', status);
  }
  const { health } = fixture();
  assert.equal((await state(health, { connected: false, configured: false, status: 'disconnected' })).receiveCapable, false);
});
test('WhatsApp receipt alone does not clear an inbound processing failure', async () => {
  const { health, calls } = fixture();
  await health.recordWebhook('whatsapp', 'event_genix', { processed: true });
  assert.equal(calls[0].values[2], false);
  assert.equal(calls[0].values[4], false);
  await health.recordWebhook('whatsapp', 'event_genix', { inbound: true });
  assert.equal(calls[1].values[4], true);
});
