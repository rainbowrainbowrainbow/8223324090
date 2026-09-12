'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
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
    let body = '';
    req.write = chunk => { body += chunk; }; req.setTimeout = () => req; req.destroy = e => req.emit('error', e);
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = 200; callback(res);
      res.emit('data', JSON.stringify(response(options, body))); res.emit('end'); req.emit('close');
    });
    return req;
  });
}

test('TurboSMS reconciliation only queries the exact ID and recipient; unknown stays unknown', async t => {
  let status = 'Delivered'; let recipient = '+380501234567'; let requests = 0;
  fakeHttps(t, (options, body) => {
    requests++;
    assert.equal(options.path, '/message/status.json');
    assert.deepEqual(JSON.parse(body), { messages: ['fixture-id'] });
    return { response_code: 0, response_result: [{ message_id: 'fixture-id', response_code: 0, type: 'sms', status, recipient }] };
  });
  const { getTurboSmsDeliveryStatus } = fresh('../services/omni-sms-providers');
  const check = () => getTurboSmsDeliveryStatus({ provider: 'turbosms', token: 'fixture' }, 'fixture-id', '+380501234567');
  assert.equal((await check()).deliveryStatus, 'delivered');
  status = 'Unknown'; assert.equal((await check()).deliveryStatus, null);
  recipient = '+380501234568'; await assert.rejects(check());
  assert.equal(requests, 3);
});

test('delivery review never contacts a provider for a foreign message or missing provider ID', async () => {
  let row; let resolved = false;
  mock('../db', { pool: { query: async () => ({ rows: row ? [row] : [] }) } });
  mock('../services/omni-accounts', { resolveOmniRuntimeConfig: async () => { resolved = true; throw new Error('Unexpected provider access'); } });
  mock('../services/omni-hub', { mapMessageRow: value => value });
  const review = fresh('../services/omni-delivery-review');
  await assert.rejects(review.reconcileMessage(1, 'dar'), { statusCode: 404 });
  row = { id: 1, direction: 'outbound', delivery_status: 'unknown' };
  const result = await review.reconcileMessage(1, 'event_genix');
  assert.equal(result.message.delivery_status, 'unknown');
  assert.match(result.nextAction, /Немає ID/); assert.equal(resolved, false);
});

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

test('health scheduler checks environment bindings but respects an explicit disconnected row', async () => {
  const checks = [];
  mock('../db', { pool: { connect: async () => ({ release() {}, query: async sql => ({ rows: sql.includes('pg_try_advisory_lock') ? [{ acquired: true }]
    : sql === 'SELECT business_context, channel FROM omni_provider_connections' ? [{ business_context: 'event_genix', channel: 'viber' }] : [] }) }) } });
  mock('../services/omni-accounts', { getOmniAccountStatuses: () => [{ channel: 'telegram', configured: true }, { channel: 'viber', configured: true }],
    recheckOmniConnection: async channel => checks.push(channel) });
  await fresh('../services/omni-health').recheckActiveOmniConnections();
  assert.deepEqual(checks, ['telegram']);
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

test('health metadata keeps explicit bridge direction capabilities fail-closed', async () => {
  let saved;
  mock('../db', { pool: { query: async (sql, values) => {
    if (sql.includes('INSERT INTO omni_channel_health')) {
      saved = JSON.parse(values[2]);
      return { rows: [] };
    }
    return { rows: [{ channel: 'viber_personal', checked_at: '2099-05-15T10:00:00Z',
      check_result: saved }] };
  } } });
  const health = fresh('../services/omni-health');
  await health.saveCheck('viber_personal', 'event_genix', { status: 'partial', details: {
    sendCapable: false, receiveCapable: false, token: 'fixture-secret',
  } });
  assert.deepEqual(saved, { status: 'partial', pendingUpdates: null, lastProviderErrorAt: null,
    providerError: null, sendCapable: false, receiveCapable: false,
    bridge: {
      online: null, transportHeartbeat: null, receiveHealth: null, sendCapability: null,
      lastHeartbeatAt: null, lastReceiveAt: null, lastScanAt: null,
      viberDesktopVersion: null, desktopAuthorized: null, serviceRunning: null,
      captureGap: null, adapterError: null, blockReason: null,
    } });
  const [account] = await health.attachHealth([{
    channel: 'viber_personal', source: 'environment', configured: true, status: 'limited',
    requiredDirections: { send: true, receive: true }, sendCapable: true, receiveCapable: true,
  }], 'event_genix', new Date('2099-05-15T10:01:00Z'));
  assert.equal(account.sendCapable, false);
  assert.equal(account.receiveCapable, false);
  assert.equal(account.status, 'limited');
});

test('database bridge account also follows explicit failed bridge capabilities', async () => {
  mock('../db', { pool: { query: async () => ({ rows: [{
    channel: 'viber_personal',
    checked_at: '2099-05-15T10:00:00Z',
    check_result: { status: 'partial', sendCapable: false, receiveCapable: false },
  }] }) } });
  const health = fresh('../services/omni-health');
  const [account] = await health.attachHealth([{
    channel: 'viber_personal', source: 'database', configured: true, status: 'limited',
    requiredDirections: { send: true, receive: true }, sendCapable: true, receiveCapable: true,
    connected: true,
  }], 'event_genix', new Date('2099-05-15T10:01:00Z'));
  assert.equal(account.connected, true);
  assert.equal(account.sendCapable, false);
  assert.equal(account.receiveCapable, false);
  assert.equal(account.status, 'limited');
});

test('Omni UI separates Viber Bot API from Viber Personal Bridge onboarding', () => {
  const root = path.join(__dirname, '..');
  const omniHtml = fs.readFileSync(path.join(root, 'omni.html'), 'utf8');
  const accountsService = fs.readFileSync(path.join(root, 'services', 'omni-accounts.js'), 'utf8');
  assert.match(accountsService, /label: 'Viber Bot API'/);
  assert.match(omniHtml, /Viber Personal Bridge/);
  assert.match(omniHtml, /Transport heartbeat/);
  assert.match(omniHtml, /Receive health/);
  assert.match(omniHtml, /Send capability/);
  assert.match(omniHtml, /data-account-action="bridge-bind-chat"/);
  assert.match(omniHtml, /Перевірити Viber Desktop/);
  assert.match(omniHtml, /Перевірити приймання/);
  assert.match(omniHtml, /Перевірити відправку/);
  assert.match(omniHtml, /if \(acc\?\.channel === 'viber_personal'\)/);
  assert.match(omniHtml, /connectionSubmit\.hidden = acc\.channel === 'viber_personal'/);
  assert.match(omniHtml, /У цій формі немає bot token і webhook/);
  assert.doesNotMatch(
    omniHtml.slice(omniHtml.indexOf("function renderViberPersonalOnboarding"), omniHtml.indexOf("function accountActionsHtml")),
    /Bridge ID|Account ID|webhookSecret/i
  );
});

test('attachment policies reject spoofed files, oversized images and unsupported channels before sending', () => {
  mock('../db', { pool: {} }); const files = fresh('../services/omni-attachments');
  const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
  assert.equal(files.validateFile({ buffer: png, mimetype: 'image/png', originalname: '../file.png' }, 'telegram').mime, 'image/png');
  assert.throws(() => files.validateFile({ buffer: png, mimetype: 'application/pdf' }, 'telegram'), { statusCode: 415 });
  assert.throws(() => files.validateFile({ buffer: png }, 'sms'), { statusCode: 415 });
  const huge = Buffer.alloc(1024 * 1024 + 1); png.copy(huge);
  assert.throws(() => files.validateFile({ buffer: huge }, 'viber'), { statusCode: 413 });
  assert.throws(() => files.validateFile({ buffer: Buffer.from('%PDF-fixture') }, 'instagram'), { statusCode: 415 });
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.17.0.1', '192.168.0.1', '100.64.0.1', '::1']) assert.equal(files.publicAddress(address), false, address);
  assert.equal(files.publicAddress('1.1.1.1'), true);
});

test('expiring attachment grant has a narrow API exception and missing grant cannot reveal bytes', async () => {
  mock('../db', { pool: { query: async () => ({ rows: [] }) } });
  const files = fresh('../services/omni-attachments');
  await assert.rejects(files.grantedFile('a'.repeat(64)), { statusCode: 404 });
  await assert.rejects(files.grantedFile('../file'), { statusCode: 404 });
  const { isPublicApiRequest } = fresh('../middleware/apiAuthBoundary');
  assert.equal(isPublicApiRequest({ method: 'GET', path: '/omni/media/' + 'a'.repeat(64) + '/fixture.png' }), true);
  assert.equal(isPublicApiRequest({ method: 'POST', path: '/omni/media/' + 'a'.repeat(64) + '/fixture.png' }), false);
  assert.equal(isPublicApiRequest({ method: 'GET', path: '/omni/messages/1/attachment' }), false);
});

test('Telegram attachment transport sends one scoped multipart request', async t => {
  mock('../db', { pool: {} });
  mock('../services/omni-accounts', { resolveOmniRuntimeConfig: async (channel, options) => {
    assert.equal(options.businessContext, 'dar'); return { botToken: 'fixture-dar' };
  } });
  let calls = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls++; assert.equal(url, 'https://api.telegram.org/botfixture-dar/sendDocument');
    assert.equal(options.body.get('chat_id'), 'fixture-recipient');
    assert.equal(options.body.get('document').type, 'application/pdf');
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 77 } }) };
  });
  const files = fresh('../services/omni-attachments');
  const file = { content: Buffer.from('%PDF-fixture'), mime_type: 'application/pdf', filename: 'fixture.pdf' };
  assert.equal((await files.sendAttachment('telegram', 'fixture-recipient', '', file, 'dar')).messageId, 77);
  assert.equal(calls, 1);
  t.mock.method(global, 'fetch', async () => { throw new Error('fixture transport URL containing token'); });
  const uncertain = await files.sendAttachment('telegram', 'fixture-recipient', '', file, 'dar');
  assert.equal(uncertain.uncertain, true); assert.doesNotMatch(uncertain.error, /token/);
});

test('remote attachment downloads block private DNS results before any HTTP request', async t => {
  mock('../db', { pool: {} }); const files = fresh('../services/omni-attachments');
  t.mock.method(require('node:dns').promises, 'lookup', async () => ({ address: '169.254.169.254', family: 4 }));
  let requests = 0; t.mock.method(https, 'get', () => { requests++; throw new Error('Unexpected HTTP request'); });
  await assert.rejects(files.downloadRemote('https://fixture.invalid/file.png'));
  assert.equal(requests, 0);
});

test('Meta comments and interactions carry stable deduplication IDs and explicit reply semantics', () => {
  mock('../db', { pool: {} }); const events = fresh('../services/omni-meta-events');
  const fb = events.normalizeComment('facebook', { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '12_34', post_id: '12_56', from: { id: '78' }, message: 'Fixture' } }, { id: '12' });
  assert.equal(fb.externalId, 'comment:12_34'); assert.equal(fb.meta.eventType, 'comment');
  assert.equal(fb.meta.postUrl, 'https://www.facebook.com/12_56');
  const ig = events.normalizeComment('instagram', { field: 'comments', value: { id: '34', text: 'Fixture', from: { username: 'fixture' }, media: { id: '56' } } }, { id: '12' });
  assert.equal(ig.externalMessageId, 'comment:34');
  const event = { sender: { id: '78' }, timestamp: 123456, postback: { title: 'Choice', payload: 'choice' } };
  assert.equal(events.normalizeInteraction('facebook', event).externalMessageId, events.normalizeInteraction('facebook', event).externalMessageId);
  assert.equal(events.normalizeInteraction('instagram', { sender: { id: '78' }, message: { mid: 'fixture-mid', text: 'Yes', quick_reply: { payload: 'yes' } } }).meta.eventType, 'quick_reply');
});

for (const channel of ['facebook', 'instagram']) test(channel + ' public and private comment replies use different scoped endpoints', async t => {
  const calls = [];
  mock('../services/omni-accounts', { resolveOmniRuntimeConfig: async (_, options) => { assert.equal(options.businessContext, 'dar'); return { pageToken: 'fixture-dar' }; } });
  fakeHttps(t, (options, body) => { calls.push({ options, body: JSON.parse(body) }); return { id: '1', message_id: '2' }; });
  const adapter = fresh('../services/omni-' + channel);
  assert.equal((await adapter.replyToComment('123', 'Public', { businessContext: 'dar' })).success, true);
  assert.equal((await adapter.sendPrivateReply('123', 'Private', { businessContext: 'dar' })).success, true);
  assert.notEqual(calls[0].options.path, calls[1].options.path);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-dar');
  if (channel === 'instagram') assert.deepEqual(calls[1].body.recipient, { comment_id: '123' });
});
