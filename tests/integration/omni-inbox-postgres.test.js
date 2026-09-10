'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');

// Opt-in, loopback-only disposable database. Never use DATABASE_URL or production credentials.
test('Omni PostgreSQL concurrency, idempotency, read boundaries and provider isolation', { timeout: 60000 }, async t => {
    const url = new URL(process.env.OMNI_TEST_DATABASE_URL || 'postgres://invalid');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'OMNI_TEST_DATABASE_URL must use loopback');
    assert.match(url.pathname, /^\/omni_fixture_test(?:_\d+)?$/);
    assert.ok(!process.env.RAILWAY_PROJECT_ID && process.env.NODE_ENV !== 'production');
    assert.notEqual(process.env.OMNI_TEST_DATABASE_URL, process.env.DATABASE_URL);
    const database = 'omni_test_' + randomUUID().replaceAll('-', '');
    const bootstrap = new Pool({ connectionString: url.href, connectionTimeoutMillis: 5000 });
    await bootstrap.query(`CREATE DATABASE ${database}`);
    await bootstrap.end();
    url.pathname = '/' + database;
    const pool = new Pool({ connectionString: url.href, max: 25, connectionTimeoutMillis: 5000 });
    t.after(() => pool.end());
    await pool.query(`CREATE TABLE customers (id serial PRIMARY KEY);
      CREATE TABLE users (id serial PRIMARY KEY, username text, name text, role text, is_active boolean DEFAULT true,
        page_allowlist jsonb, page_denylist jsonb, business_contexts jsonb, forced_business_context text)`);
    for (const file of ['052_omnichannel.sql', '168_durable_communication_truth_schema.sql', '169_provider_lifecycle_v1.sql',
        '170_canonical_reply_expectation_v1.sql', '172_reply_owner_typing_v1.sql', '181_omni_provider_connections.sql',
        '202_omni_telegram_binding_purpose.sql', '228_omni_business_context_scope.sql']) {
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', file), 'utf8'));
    }
    const originals = new Map();
    const mock = (name, value) => { const id = require.resolve(name); originals.set(id, require.cache[id]); require.cache[id] = { id, filename: id, loaded: true, exports: value }; };
    t.after(() => { for (const [id, value] of originals) { if (value) require.cache[id] = value; else delete require.cache[id]; } });
    mock('../../db', { pool });
    const account = { connected: true, sendCapable: true, status: 'connected' };
    mock('../../services/omni-accounts', { getOmniAccountStatus: () => account, getOmniAccountStatusAsync: async () => account });
    mock('../../services/websocket', { getWSS: () => ({ clients: [] }) });
    let sends = 0;
    mock('../../services/telegram', { sendTelegramMessage: async () => { sends++; await new Promise(resolve => setTimeout(resolve, 40)); return { ok: true, result: { message_id: 'fixture-provider-1' } }; } });
    mock('../../services/omni-telegram-bridge', { sendTelegramBridgeMessage: async () => null });
    for (const [module, name] of [['omni-viber', 'sendViber'], ['omni-sms', 'sendSMS'], ['omni-facebook', 'sendFacebook'], ['omni-instagram', 'sendInstagram']]) {
        mock('../../services/' + module, { [name]: async () => { throw Error('Unexpected provider request'); } });
    }
    const hub = require('../../services/omni-hub');
    const inbox = require('../../services/omni-inbox');
    const created = await Promise.all(Array.from({ length: 20 }, () => hub.findOrCreateConversation('telegram', 'fixture-user', 'Fixture', null, { businessContext: 'dar' })));
    const id = created[0].id;
    assert.equal(new Set(created.map(row => row.id)).size, 1);
    await pool.query(`UPDATE conversations SET meta = '{"ai_enabled":true}' WHERE id = $1`, [id]);
    const inbound = { channel: 'telegram', externalId: 'fixture-user', externalMessageId: 'inbound-1', senderName: 'Fixture', content: 'Original', contentType: 'text', meta: {} };
    const received = await Promise.all(Array.from({ length: 20 }, () => hub.processInboundMessage(inbound, { businessContext: 'dar' })));
    assert.equal(received.filter(result => result.duplicate).length, 19); assert.equal(sends, 0, 'inbound must never invoke the CRM AI or provider sender');
    const firstId = received[0].message.id;
    await hub.processInboundMessage({ ...inbound, content: 'Edited', meta: { editedAt: 200 } }, { businessContext: 'dar' });
    await hub.processInboundMessage({ ...inbound, content: 'Stale edit', meta: { editedAt: 100 } }, { businessContext: 'dar' });
    assert.equal((await pool.query('SELECT content FROM conversation_messages WHERE id = $1', [firstId])).rows[0].content, 'Edited');
    assert.equal((await pool.query('SELECT unread_count FROM conversations WHERE id = $1', [id])).rows[0].unread_count, 1);
    const sent = await Promise.all(Array.from({ length: 20 }, () => hub.sendManualMessage(id, 'Unique send', 'FixtureManager', { businessContext: 'dar', clientRequestId: 'fixture-request-0001' })));
    assert.equal(sends, 1); assert.equal(new Set(sent.map(result => result.message.id)).size, 1);
    await assert.rejects(hub.sendManualMessage(id, 'Different text', 'FixtureManager', { businessContext: 'dar', clientRequestId: 'fixture-request-0001' }), error => error.statusCode === 409);
    await Promise.all([inbox.markConversationRead(id, firstId, 'dar'), ...Array.from({ length: 10 }, (_, index) => hub.processInboundMessage({ ...inbound, content: 'Arrival ' + index, externalMessageId: 'new-' + index }, { businessContext: 'dar' }))]);
    assert.equal((await pool.query('SELECT unread_count FROM conversations WHERE id = $1', [id])).rows[0].unread_count, 10);
    const max = (await pool.query('SELECT max(id) AS id FROM conversation_messages WHERE conversation_id = $1', [id])).rows[0].id;
    await inbox.markConversationRead(id, max, 'dar'); await inbox.markConversationRead(id, firstId, 'dar');
    assert.equal((await pool.query('SELECT unread_count FROM conversations WHERE id = $1', [id])).rows[0].unread_count, 0);
    await assert.rejects(inbox.markConversationRead(id, max, 'event_genix'), error => error.statusCode === 404);
    await hub.updateConversationStatus(id, 'pending', 'FixtureManager', undefined, { businessContext: 'dar' });
    const search = await hub.getConversations({ businessContext: 'dar', search: 'Unique send', status: 'pending', assignedTo: 'FixtureManager' });
    assert.equal(search.total, 1); assert.equal(search.conversations[0].id, id);
    assert.equal((await hub.getConversations({ businessContext: 'event_genix', search: 'Unique send' })).total, 0);
    const scoped = [];
    for (const businessContext of ['event_genix', 'dar']) {
        const conv = await hub.findOrCreateConversation('viber', 'same-user', 'Fixture', null, { businessContext });
        const msg = (await pool.query(`INSERT INTO conversation_messages (conversation_id, direction, content, provider_message_id) VALUES ($1, 'outbound', 'Fixture receipt', 'same-provider-id') RETURNING id`, [conv.id])).rows[0];
        scoped.push(msg.id);
    }
    const receipt = { channel: 'viber', providerMessageId: 'same-provider-id', deliveryStatus: 'accepted' };
    await hub.applyProviderLifecycleReceipt(receipt, { businessContext: 'dar' });
    await hub.applyProviderLifecycleReceipt({ ...receipt, deliveryStatus: 'read' }, { businessContext: 'dar' });
    await hub.applyProviderLifecycleReceipt({ ...receipt, deliveryStatus: 'delivered' }, { businessContext: 'dar' });
    await hub.applyProviderLifecycleReceipt(receipt, { businessContext: 'dar' });
    assert.deepEqual((await pool.query('SELECT delivery_status FROM conversation_messages WHERE id = ANY($1::int[]) ORDER BY id', [scoped])).rows.map(row => row.delivery_status), [null, 'read']);
    const metaConv = await hub.findOrCreateConversation('instagram', 'meta-customer', 'Fixture', null, { businessContext: 'dar' });
    const metaMessage = (await pool.query(`INSERT INTO conversation_messages (conversation_id, direction, provider_message_id, created_at) VALUES ($1, 'outbound', 'meta-mid', NOW() - INTERVAL '1 minute') RETURNING id`, [metaConv.id])).rows[0];
    await inbox.applyMetaReceipt('instagram', { sender: { id: 'meta-customer' }, read: { watermark: Date.now() } }, 'dar');
    assert.equal((await pool.query('SELECT delivery_status FROM conversation_messages WHERE id = $1', [metaMessage.id])).rows[0].delivery_status, 'read');
    await pool.query(`INSERT INTO users(username, role) VALUES ('fixture-manager', 'manager')`);
    assert.deepEqual(await inbox.listOmniOperators('event_genix'), [{ username: 'fixture-manager', label: 'fixture-manager' }]);
});
