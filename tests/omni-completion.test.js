'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const express = require('express');
const cache = new Map();
function mock(name, exports) {
  const id = require.resolve(name);
  if (!cache.has(id)) cache.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
function fresh(name) {
  const id = require.resolve(name);
  if (!cache.has(id)) cache.set(id, require.cache[id]);
  delete require.cache[id];
  return require(name);
}
afterEach(() => { for (const [id, old] of cache) { if (old) require.cache[id] = old; else delete require.cache[id]; } cache.clear(); });
function fakeHttps(t, response) {
  t.mock.method(https, 'request', (options, callback) => {
    const req = new EventEmitter();
    req.write = () => {}; req.setTimeout = () => req; req.destroy = e => req.emit('error', e);
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = 200; callback(res);
      res.emit('data', JSON.stringify(response(options))); res.emit('end'); req.emit('close');
    });
    return req;
  });
}

test('Telegram current webhook failure is limited, recovered historical error is healthy, and no message is sent', async t => {
  mock('../db', { pool: {} }); const accounts = fresh('../services/omni-accounts');
  let pending = 9; let errorDate = Math.floor(Date.now() / 1000);
  fakeHttps(t, o => {
    assert.ok(o.path.endsWith('/getMe') || o.path.endsWith('/getWebhookInfo'));
    return o.path.endsWith('/getMe') ? { ok: true, result: { username: 'fixture' } } :
      { ok: true, result: { url: 'https://crm.test/api/omni/webhook/telegram', pending_update_count: pending,
        last_error_date: errorDate, last_error_message: '403' } };
  });
  const verify = () => accounts.providerDefinition('telegram').verifier({ botToken: 'fixture' },
    { mode: 'recheck', expectedWebhookUrl: 'https://crm.test/api/omni/webhook/telegram', businessContext: 'event_genix' });
  assert.equal((await verify()).status, 'partial');
  pending = 0; errorDate -= 3600;
  assert.equal((await verify()).status, 'success');
});

test('an environment-only binding has no fabricated check time', () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'fixture-token';
  try {
    mock('../db', { pool: {} });
    const state = fresh('../services/omni-accounts').getOmniAccountStatus('telegram');
    assert.equal(state.lastCheckedAt, null);
    assert.equal(state.status, 'limited');
    assert.equal(state.receiveCapable, false);
  } finally { if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = previous; }
});

test('ownership detects token rotation and other businesses, unlocks after conflict and fails closed on lookup error', async () => {
  const calls = []; let fail = false; let acted = false;
  const client = { release: () => calls.push('release'), query: async sql => {
    calls.push(sql);
    if (sql.startsWith('SELECT *')) {
      if (fail) throw new Error('fixture database failure');
      return { rows: [{ channel: 'telegram', business_context: 'dar',
        credentials: { values: { botToken: '123456:previous-secret' } } }] };
    }
    return { rows: [] };
  } };
  mock('../db', { pool: { connect: async () => client } });
  const accounts = fresh('../services/omni-accounts');
  await assert.rejects(accounts.withTelegramOwnership('123456:rotated-secret',
    { channel: 'report_bot', businessContext: 'event_genix' }, () => { acted = true; }), { code: 'TELEGRAM_OWNER_CONFLICT' });
  assert.equal(acted, false); assert.equal(calls.at(-1), 'release');
  assert.ok(calls.some(s => s.includes('pg_advisory_unlock')));
  fail = true;
  await assert.rejects(accounts.withTelegramOwnership('123456:rotated-secret',
    { channel: 'telegram', businessContext: 'dar' }, () => { acted = true; }), /database failure/);
  assert.equal(acted, false);
});

test('Report Bot checks ownership before attempting a webhook mutation', async t => {
  mock('../db', { pool: {} }); let checked = false; let requested = false;
  mock('../services/omni-accounts', {
    resolveOmniRuntimeConfig: async () => ({ botToken: 'fixture' }),
    withTelegramOwnership: async () => { checked = true; throw new Error('fixture conflict'); },
  });
  t.mock.method(https, 'request', () => { requested = true; throw new Error('unexpected request'); });
  await fresh('../services/report-bot').ensureReportBotWebhook('https://crm.test');
  assert.equal(checked, true); assert.equal(requested, false);
});

test('Viber setup denies operators and foreign destinations before provider calls', async () => {
  mock('../db', { pool: {} }); const auth = fresh('../middleware/auth');
  let role = 'animator'; const calls = [];
  mock('../middleware/auth', { ...auth, authenticateToken: (req, res, next) => {
    req.user = { id: 1, username: 'fixture', role, page_allowlist: ['/omni'] }; next();
  } });
  mock('../services/omni-health', { recordWebhook: async () => {} });
  mock('../services/omni-accounts', {
    providerDefinition: channel => ({ channel }),
    publicWebhookUrl: () => 'https://crm.test/api/omni/webhook/viber',
  });
  mock('../services/omni-viber', { setViberWebhook: async (...args) => { calls.push(args); return { success: true }; } });
  mock('../services/adminAudit', {}); mock('../services/omniLeadAssistant', {});
  const app = express(); app.use(express.json()); app.use('/api/omni', fresh('../routes/omnichannel'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const post = body => fetch('http://127.0.0.1:' + server.address().port + '/api/omni/setup/viber', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await post({})).status, 403); role = 'manager';
    assert.equal((await post({ url: 'https://external.invalid/incoming' })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await post({})).status, 200); assert.equal(calls.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('health scheduler skips concurrent run and always releases its connection', async () => {
  let released = false;
  mock('../db', { pool: { connect: async () => ({
    query: async () => ({ rows: [{ acquired: false }] }), release: () => { released = true; },
  }) } });
  mock('../services/omni-accounts', { recheckOmniConnection: () => { throw new Error('must not recheck'); } });
  await fresh('../services/omni-health').recheckActiveOmniConnections();
  assert.equal(released, true);
});

test('health metadata retains real freshness and excludes arbitrary provider response fields', async () => {
  const calls = [];
  mock('../db', { pool: { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } } });
  const health = fresh('../services/omni-health');
  await health.saveCheck('telegram', 'dar', { status: 'partial',
    details: { pendingUpdates: 3, token: 'fixture-secret', rawEvent: 'fixture-message' } });
  assert.doesNotMatch(calls[0].values[2], /fixture-secret|fixture-message/);
  const accounts = await health.attachHealth([{ channel: 'telegram', lastCheckedAt: null }], 'dar');
  assert.equal(accounts[0].lastCheckedAt, null);
  assert.equal(accounts[0].diagnostics.stale, true);
});
