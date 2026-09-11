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
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
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
    const mediaMigration = fs.readFileSync(path.join(__dirname, '../../db/migrations/354_omni_attachments.sql'), 'utf8');
    await pool.query(mediaMigration); await pool.query(mediaMigration);
    await pool.query("UPDATE conversations SET channel = 'telegram' WHERE id = 1");
    const files = require('../../services/omni-attachments');
    const file = { buffer: Buffer.from('%PDF-fixture'), mimetype: 'application/pdf', originalname: 'fixture.pdf' };
    const stored = await files.storeFile(1, 'event_genix', file);
    await assert.rejects(files.getFile(stored.id, 1, 'dar'), { statusCode: 404 });
    assert.equal((await files.getFile(stored.id, 1, 'event_genix')).content.toString(), '%PDF-fixture');
    const token = 'a'.repeat(64), hash = require('node:crypto').createHash('sha256').update(token).digest('hex');
    await pool.query("INSERT INTO omni_attachment_grants VALUES ($1, $2, NOW() + INTERVAL '1 minute')", [hash, stored.id]);
    assert.equal((await files.grantedFile(token)).id, stored.id);
    await pool.query("UPDATE omni_attachment_grants SET expires_at = NOW() - INTERVAL '1 minute'");
    await assert.rejects(files.grantedFile(token), { statusCode: 404 });
    await pool.query(`ALTER TABLE conversation_messages ADD COLUMN sender_name TEXT, ADD COLUMN content_type TEXT,
      ADD COLUMN ai_generated BOOLEAN, ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW()`);
    await pool.query('ALTER TABLE conversations ADD COLUMN last_message_at TIMESTAMPTZ, ADD COLUMN last_outbound_at TIMESTAMPTZ');
    process.env.TELEGRAM_BOT_TOKEN = '654321:fixture-transport';
    let sends = 0;
    files.sendAttachment = async () => { sends++; return { success: true, messageId: 'fixture-media-send' }; };
    const sendOptions = { businessContext: 'event_genix', clientRequestId: 'fixture-attachment-request', attachmentId: stored.id };
    const sent = await Promise.all([1, 2].map(() => hub.sendManualMessage(1, '', 'fixture-manager', sendOptions)));
    assert.equal(sends, 1); assert.equal(sent[0].message.id, sent[1].message.id);
    assert.equal((await files.fileForMessage(sent[0].message.id, 'event_genix')).id, stored.id);
    const different = await files.storeFile(1, 'event_genix', { ...file, buffer: Buffer.from('%PDF-different') });
    await assert.rejects(hub.sendManualMessage(1, '', 'fixture-manager', { ...sendOptions, attachmentId: different.id }), { statusCode: 409 });
    assert.equal(sends, 1);
    const incoming = (await pool.query("INSERT INTO conversation_messages (conversation_id, direction, content, meta) VALUES (1, 'inbound', '', '{}') RETURNING *")).rows[0];
    let downloads = 0;
    require('../../services/omni-inbox').getTelegramAttachment = async () => { downloads++; return { buffer: file.buffer, filename: file.originalname }; };
    const normalized = { channel: 'telegram', mediaUrl: 'fixture-file-id', contentType: 'file' };
    const archived = await files.preserveInbound(hub.mapMessageRow(incoming), normalized, 'event_genix');
    assert.equal(archived.meta.storedAttachments.length, 1);
    await files.preserveInbound(archived, normalized, 'event_genix');
    assert.equal(downloads, 1);
    assert.equal((await files.fileForMessage(incoming.id, 'event_genix', archived.meta.storedAttachments[0].id)).content.toString(), '%PDF-fixture');
    assert.equal(await files.fileForMessage(incoming.id, 'dar', archived.meta.storedAttachments[0].id), null);
    const lastInbound = (await health.attachHealth([{ channel: 'telegram' }], 'event_genix'))[0].diagnostics.lastInboundAt;
    await health.recordWebhook('telegram', 'event_genix', { errorCode: 'processing_failed' });
    await health.recordWebhook('telegram', 'event_genix', { processed: true });
    const recovered = (await health.attachHealth([{ channel: 'telegram' }], 'event_genix'))[0].diagnostics;
    assert.equal(recovered.activeProcessingError, false);
    assert.equal(String(recovered.lastInboundAt), String(lastInbound));
  } finally {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previous) require.cache[dbId] = previous; else delete require.cache[dbId];
    if (pool) await pool.end();
    try { if (created) await admin.query('DROP DATABASE "' + name + '"'); }
    finally { await admin.end(); }
  }
});
