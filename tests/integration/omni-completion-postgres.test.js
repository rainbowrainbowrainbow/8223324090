'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

test('Omni ownership serialization and health migration on a disposable local PostgreSQL database', {
  skip: process.env.OMNI_LOCAL_POSTGRES_TEST !== '1',
}, async () => {
  // Deliberately no DATABASE_URL fallback: only a local Unix socket and peer auth.
  const name = 'omni_test_' + process.pid + '_' + Date.now();
  assert.match(name, /^omni_test_[0-9]+_[0-9]+$/);
  const admin = new Pool({ host: '/var/run/postgresql', user: 'postgres', database: 'postgres' });
  let pool; let created = false;
  const dbId = require.resolve('../../db'); const previous = require.cache[dbId];
  try {
    await admin.query('CREATE DATABASE "' + name + '"'); created = true;
    pool = new Pool({ host: '/var/run/postgresql', user: 'postgres', database: name, max: 2 });
    await pool.query(`CREATE TABLE omni_provider_connections (
      business_context TEXT, channel TEXT, status TEXT, credentials JSONB,
      PRIMARY KEY (business_context, channel))`);
    require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
    const accounts = require('../../services/omni-accounts');
    const result = await Promise.allSettled(['event_genix', 'dar', 'maysternya_doli'].map(businessContext =>
      accounts.withTelegramOwnership('123456:fixture-identity', { channel: 'telegram', businessContext }, async client => {
        await client.query('INSERT INTO omni_provider_connections VALUES ($1, $2, $3, $4::jsonb)',
          [businessContext, 'telegram', 'connected', JSON.stringify({ values: { botToken: '123456:fixture-identity' } })]);
        return businessContext;
      })));
    assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(result.filter(item => item.status === 'rejected' && item.reason.code === 'TELEGRAM_OWNER_CONFLICT').length, 2);
    const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/353_omni_channel_health.sql'), 'utf8');
    await pool.query(migration); await pool.query(migration);
    const health = require('../../services/omni-health');
    await health.saveCheck('telegram', 'event_genix', { status: 'success', details: { pendingUpdates: 0 } });
    await health.recordWebhook('telegram', 'event_genix', { errorCode: 'processing_failed' });
    await health.recordWebhook('telegram', 'event_genix', { inbound: true });
    const [state] = await health.attachHealth([{ channel: 'telegram' }], 'event_genix');
    assert.equal(state.diagnostics.failedEvents, 1);
    assert.equal(state.diagnostics.activeProcessingError, false);
    assert.equal(state.diagnostics.stale, false);
    assert.equal((await health.attachHealth([{ channel: 'telegram' }], 'dar'))[0].diagnostics.failedEvents, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM omni_channel_errors')).rows[0].n, 1);
    await pool.query(`CREATE TABLE conversations (
      id SERIAL PRIMARY KEY, channel TEXT, external_id TEXT, business_context TEXT, status TEXT,
      assigned_to TEXT, customer_phone TEXT, meta JSONB DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query("INSERT INTO conversations (channel, external_id, business_context, status) VALUES ('telegram', 'fixture', 'event_genix', 'open')");
    const wsId = require.resolve('../../services/websocket');
    require.cache[wsId] = { id: wsId, filename: wsId, loaded: true, exports: { getWSS: () => ({ clients: [] }) } };
    const hub = require('../../services/omni-hub');
    const competing = await Promise.allSettled(['closed', 'pending'].map(status =>
      hub.updateConversationStatus(1, status, undefined, undefined,
        { businessContext: 'event_genix', expected: { status: 'open' } })));
    assert.equal(competing.filter(item => item.status === 'fulfilled').length, 1);
    const conflict = competing.find(item => item.status === 'rejected');
    assert.equal(conflict.reason.statusCode, 409);
    assert.equal(conflict.reason.current.id, 1);
    await pool.query("UPDATE conversations SET status = 'open', assigned_to = NULL");
    await Promise.all([
      hub.updateConversationStatus(1, 'pending', undefined, undefined, { businessContext: 'event_genix', expected: { status: 'open' } }),
      hub.updateConversationStatus(1, undefined, 'manager', undefined, { businessContext: 'event_genix', expected: { assigned_to: null } }),
    ]);
    const updated = (await pool.query('SELECT status, assigned_to FROM conversations WHERE id = 1')).rows[0];
    assert.equal(updated.status, 'pending'); assert.equal(updated.assigned_to, 'manager');
    await assert.rejects(hub.updateConversationStatus(1, 'closed', undefined, undefined,
      { businessContext: 'dar', expected: { status: 'pending' } }), { statusCode: 404 });
    await pool.query(`CREATE TABLE conversation_messages (
      id BIGSERIAL PRIMARY KEY, conversation_id INT, direction TEXT, content TEXT,
      meta JSONB, provider_message_id TEXT, delivery_status TEXT, delivery_error TEXT,
      provider_lifecycle_at TIMESTAMP, provider_lifecycle_event TEXT, provider_lifecycle_source TEXT,
      send_attempted_at TIMESTAMP, provider_accepted_at TIMESTAMP, failed_at TIMESTAMP)`);
    await pool.query(`INSERT INTO conversation_messages (conversation_id, direction, content, provider_message_id, delivery_status)
      VALUES (1, 'outbound', 'fixture', 'fixture-id', 'unknown')`);
    const review = require('../../services/omni-delivery-review');
    await review.recordManualVerification(1, 'event_genix', { id: 42, username: 'fixture-manager' },
      { outcome: 'observed_present', note: 'Checked in the test channel' });
    assert.equal((await pool.query('SELECT delivery_status FROM conversation_messages')).rows[0].delivery_status, 'unknown');
    await pool.query("UPDATE conversations SET channel = 'sms' WHERE id = 1");
    await hub.applyProviderLifecycleReceipt({ channel: 'sms', providerMessageId: 'fixture-id', deliveryStatus: 'delivered' }, { businessContext: 'event_genix' });
    await hub.applyProviderLifecycleReceipt({ channel: 'sms', providerMessageId: 'fixture-id', deliveryStatus: 'accepted' },
      { businessContext: 'event_genix', messageId: 1, reconcileOnly: true });
    const confirmed = (await pool.query('SELECT * FROM conversation_messages')).rows[0];
    assert.equal(confirmed.delivery_status, 'delivered');
    assert.equal(confirmed.meta.manualVerification.by, 'fixture-manager');
    assert.equal(confirmed.meta.manualVerifications.length, 1);
    await assert.rejects(review.recordManualVerification(1, 'dar', { id: 42 },
      { outcome: 'unresolved', note: 'No access' }), { statusCode: 404 });
  } finally {
    if (previous) require.cache[dbId] = previous; else delete require.cache[dbId];
    if (pool) await pool.end();
    try { if (created) await admin.query('DROP DATABASE "' + name + '"'); }
    finally { await admin.end(); }
  }
});
