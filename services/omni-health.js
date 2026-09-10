'use strict';
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const log = createLogger('OmniHealth');

async function saveCheck(channel, businessContext, check, client = pool) {
  const details = check.details || {};
  const safe = {
    status: check.status,
    pendingUpdates: Number.isFinite(details.pendingUpdates) ? details.pendingUpdates : null,
    lastProviderErrorAt: details.lastProviderErrorAt || null,
    providerError: details.providerError || null,
  };
  await client.query(
    `INSERT INTO omni_channel_health (business_context, channel, checked_at, check_result)
     VALUES ($1, $2, NOW(), $3::jsonb)
     ON CONFLICT (business_context, channel) DO UPDATE
       SET checked_at = EXCLUDED.checked_at, check_result = EXCLUDED.check_result`,
    [businessContext, channel, JSON.stringify(safe)]
  );
}

async function recordWebhook(channel, businessContext, { inbound = false, errorCode = null } = {}) {
  if (!inbound && !errorCode) return;
  const allowed = ['processing_failed', 'invalid_signature', 'unsupported_event'];
  const error = allowed.includes(errorCode) ? errorCode : null;
  await pool.query(
    `INSERT INTO omni_channel_health (business_context, channel, last_inbound_at, last_error_at, last_error_code, failed_events)
     VALUES ($1, $2, CASE WHEN $3 THEN NOW() END, CASE WHEN $4::text IS NOT NULL THEN NOW() END, $4, CASE WHEN $4::text IS NOT NULL THEN 1 ELSE 0 END)
     ON CONFLICT (business_context, channel) DO UPDATE SET
       last_inbound_at = COALESCE(EXCLUDED.last_inbound_at, omni_channel_health.last_inbound_at),
       last_error_at = COALESCE(EXCLUDED.last_error_at, omni_channel_health.last_error_at),
       last_error_code = COALESCE(EXCLUDED.last_error_code, omni_channel_health.last_error_code),
       failed_events = omni_channel_health.failed_events + EXCLUDED.failed_events`,
    [businessContext, channel, inbound, error]
  );
  if (error) await pool.query(
    'INSERT INTO omni_channel_errors (business_context, channel, error_code) VALUES ($1, $2, $3)',
    [businessContext, channel, error]
  );
}

async function attachHealth(accounts, businessContext, now = new Date()) {
  const result = await pool.query('SELECT * FROM omni_channel_health WHERE business_context = $1', [businessContext]);
  return accounts.map(account => {
    const health = result.rows.find(row => row.channel === account.channel);
    const checkedAt = health?.checked_at || account.lastCheckedAt;
    const checkedMs = checkedAt ? new Date(checkedAt).getTime() : null;
    return { ...account, lastCheckedAt: checkedAt ? new Date(checkedAt).toISOString() : null,
      diagnostics: {
        checked: checkedMs !== null, stale: checkedMs === null || now.getTime() - checkedMs > 15 * 60 * 1000,
        lastInboundAt: health?.last_inbound_at || null,
        lastErrorAt: health?.last_error_at || null,
        lastErrorCode: health?.last_error_code || null,
        activeProcessingError: Boolean(health?.last_error_at && (!health.last_inbound_at || new Date(health.last_error_at) > new Date(health.last_inbound_at))),
        failedEvents: Number(health?.failed_events) || 0,
        ...(health?.check_result || {}),
      } };
  });
}

async function recheckActiveOmniConnections() {
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(187188, 2) AS acquired');
    locked = lock.rows[0]?.acquired === true;
    if (!locked) return;
    const rows = await client.query("SELECT business_context, channel FROM omni_provider_connections WHERE status NOT IN ('disconnected', 'needs_rebind')");
    for (const row of rows.rows) {
      try {
        await require('./omni-accounts').recheckOmniConnection(row.channel, {}, { businessContext: row.business_context, mode: 'recheck' });
      } catch { log.warn('Channel diagnostic check failed', { channel: row.channel }); }
    }
  } finally {
    let releaseError;
    try { if (locked) await client.query('SELECT pg_advisory_unlock(187188, 2)'); }
    catch (error) { releaseError = error; throw error; }
    finally { client.release(releaseError); }
  }
}
module.exports = { saveCheck, recordWebhook, attachHealth, recheckActiveOmniConnections };
