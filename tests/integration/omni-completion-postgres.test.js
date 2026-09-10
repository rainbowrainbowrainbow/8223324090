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
  } finally {
    if (previous) require.cache[dbId] = previous; else delete require.cache[dbId];
    if (pool) await pool.end();
    try { if (created) await admin.query('DROP DATABASE "' + name + '"'); }
    finally { await admin.end(); }
  }
});
