'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const saved = new Map();
function mock(name, value) { const id = require.resolve(name); if (!saved.has(id)) saved.set(id, require.cache[id]); require.cache[id] = { id, filename: id, loaded: true, exports: value }; }
function fresh(name) { const id = require.resolve(name); if (!saved.has(id)) saved.set(id, require.cache[id]); delete require.cache[id]; return require(name); }
afterEach(() => { for (const [id, value] of saved) { if (value) require.cache[id] = value; else delete require.cache[id]; } saved.clear(); });
function inbox(pool) { mock('../db', { pool }); mock('../services/omni-accounts', { resolveOmniRuntimeConfig: async () => ({ botToken: 'fixture-token' }) }); return fresh('../services/omni-inbox'); }

test('read acknowledgement rejects a foreign conversation before touching messages', async () => {
    const queries = []; let released = false;
    const service = inbox({ connect: async () => ({ release() { released = true; }, query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } }) });
    await assert.rejects(service.markConversationRead(7, 9, 'dar'), error => error.statusCode === 404);
    assert.deepEqual(queries[1].params, [7, 'dar']); assert.match(queries[1].sql, /FOR UPDATE/);
    assert.equal(queries.at(-1).sql, 'ROLLBACK'); assert.equal(released, true);
    assert.equal(queries.some(q => /UPDATE conversations/.test(q.sql)), false);
});

test('assignment candidates exclude denied and different-business users', async () => {
    const service = inbox({ query: async () => ({ rows: [
        { id: 1, username: 'allowed', name: 'Allowed', role: 'manager' },
        { id: 2, username: 'denied', role: 'manager', page_denylist: ['/omni'] },
        { id: 3, username: 'other', role: 'creator', business_contexts: ['dar'], forced_business_context: 'dar' },
    ] }) });
    assert.deepEqual(await service.listOmniOperators('event_genix'), [{ username: 'allowed', label: 'Allowed' }]);
});

test('read acknowledgement validates its message and retains arrivals beyond the read boundary', async () => {
    const queries = [];
    const service = inbox({ connect: async () => ({ release() {}, query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('UPDATE conversations')) return { rows: [{ unread_count: 2 }] };
        return { rows: [{ id: 7 }] };
    } }) });
    assert.deepEqual(await service.markConversationRead(7, 9, 'event_genix'), { unreadCount: 2 });
    const update = queries.find(q => q.sql.includes('UPDATE conversations'));
    assert.deepEqual(update.params, [7, 9]); assert.match(update.sql, /m.id > GREATEST/); assert.match(update.sql, /omniReadThroughId/);
    assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('Telegram attachment access rejects a foreign record without contacting Telegram', async t => {
    const queries = []; const service = inbox({ query: async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; } });
    t.mock.method(global, 'fetch', async () => { throw new Error('Network must not be called'); });
    await assert.rejects(service.getTelegramAttachment(9, 'dar'), error => error.statusCode === 404);
    assert.deepEqual(queries[0].params, [9, 'dar']); assert.match(queries[0].sql, /c.channel = 'telegram'/);
    assert.equal(global.fetch.mock.calls.length, 0);
});

test('Telegram attachment proxy returns only bytes and a filename and bounds file size', async t => {
    const service = inbox({ query: async () => ({ rows: [{ media_url: 'fixture-file' }] }) });
    const calls = []; let tooLarge = false;
    t.mock.method(global, 'fetch', async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/getFile')) return { ok: true, json: async () => ({ ok: true, result: { file_path: 'photos/file.jpg', file_size: tooLarge ? 30 * 1024 * 1024 : 3 } }) };
        return { ok: true, body: (async function* () { yield Buffer.from('abc'); })() };
    });
    const file = await service.getTelegramAttachment(9, 'event_genix');
    assert.deepEqual(file, { buffer: Buffer.from('abc'), filename: 'file.jpg' });
    assert.equal(calls[1].options.redirect, 'error'); assert.equal(JSON.stringify(file).includes('fixture-token'), false);
    tooLarge = true; await assert.rejects(service.getTelegramAttachment(9, 'event_genix'), error => error.statusCode === 413);
    assert.equal(calls.length, 3);
});

test('Meta receipts match the business, channel and customer, and cannot downgrade read', async () => {
    const queries = []; const service = inbox({ query: async (sql, params) => { queries.push({ sql, params }); return { rows: [{ conversation_id: 7 }, { conversation_id: 7 }] }; } });
    const ids = await service.applyMetaReceipt('instagram', { sender: { id: 'customer' }, read: { watermark: 1750000000000 } }, 'dar');
    assert.deepEqual(ids, [7]); assert.deepEqual(queries[0].params.slice(0, 4), ['instagram', 'customer', 'dar', 'read']);
    assert.match(queries[0].sql, /delivery_status, ''\) <> 'read'/);
    await service.applyMetaReceipt('instagram', { sender: { id: 'customer' }, read: {} }, 'dar'); assert.equal(queries.length, 1);
});

function fakeHttps(t, resolve) {
    t.mock.method(https, 'request', (options, callback) => {
        const request = new EventEmitter(); let body = '';
        request.write = value => { body += value; }; request.setTimeout = () => request;
        request.destroy = error => request.emit('error', error);
        request.end = () => queueMicrotask(() => { const response = new EventEmitter(); response.statusCode = 200; callback(response); response.emit('data', JSON.stringify(resolve(options, body))); response.emit('end'); request.emit('close'); });
        return request;
    });
}

test('readiness checks reject a different host/business and never claim SMS delivery from field validation', async t => {
    mock('../db', { pool: {} }); const accounts = fresh('../services/omni-accounts');
    let webhook = 'https://other.example/api/omni/webhook/telegram?businessContext=dar';
    fakeHttps(t, options => options.path.endsWith('/getMe') ? { ok: true, result: { username: 'fixture' } } : { ok: true, result: { url: webhook } });
    const verify = accounts.providerDefinition('telegram').verifier;
    const context = { mode: 'recheck', businessContext: 'dar', expectedWebhookUrl: 'https://crm.example/api/omni/webhook/telegram?businessContext=dar' };
    assert.equal((await verify({ botToken: 'fixture-token' }, context)).status, 'webhook_missing');
    webhook = 'https://crm.example/api/omni/webhook/telegram';
    assert.equal((await verify({ botToken: 'fixture-token' }, context)).status, 'webhook_missing');
    webhook = context.expectedWebhookUrl;
    assert.equal((await verify({ botToken: 'fixture-token' }, context)).status, 'success');
    const sms = await require('../services/omni-sms-providers').verifySmsRuntime({ provider: 'turbosms', token: 'fixture-long-token', sender: 'Fixture' });
    assert.equal(sms.status, 'partial'); assert.match(sms.message, /не підтверджені/);
});

test('TurboSMS acceptance response codes require success for the selected recipient', async t => {
    let code = 800; let recipientCode = 0;
    fakeHttps(t, () => ({ response_code: code, response_result: [{ phone: '+380501112233', response_code: recipientCode, message_id: 'fixture-sms' }] }));
    const providers = fresh('../services/omni-sms-providers');
    for (code of [0, 800, 801, 802, 803]) {
        const result = await providers.sendSmsViaProvider({ provider: 'turbosms', token: 'fixture-long-token', sender: 'Fixture' }, '+380501112233', 'Fixture');
        assert.equal(result.success, true, String(code));
    }
    recipientCode = 400;
    assert.equal((await providers.sendSmsViaProvider({ provider: 'turbosms', token: 'fixture-long-token', sender: 'Fixture' }, '+380501112233', 'Fixture')).success, false);
});

for (const provider of ['turbosms', 'flysms']) {
    test(`${provider} sends with the configured business credential and sender`, async t => {
        const seen = [];
        mock('../services/omni-accounts', { resolveOmniRuntimeConfig: async (_channel, options) => {
            assert.equal(options.businessContext, 'dar');
            return { provider, token:'fixture-business-token', apiKey:'fixture-business-key', sender:'FixtureDAR' };
        } });
        fakeHttps(t, (options, body) => { seen.push({options, body:JSON.parse(body)}); return {success:1,data:{messageID:'fixture-fly'},response_code:800,response_result:[{response_code:0,message_id:'fixture-turbo'}]}; });
        fresh('../services/omni-sms-providers');
        const sms=fresh('../services/omni-sms');
        assert.equal((await sms.sendSMS('+380000000001','Fixture',{businessContext:'dar'})).success,true);
        assert.equal(seen.length,1);
        if(provider === 'turbosms') {
            assert.equal(seen[0].options.headers.Authorization,'Bearer fixture-business-token');
            assert.equal(seen[0].body.sms.sender,'FixtureDAR');
        } else {
            assert.equal(seen[0].body.auth.key,'fixture-business-key');
            assert.equal(seen[0].body.data.sms.source,'FixtureDAR');
        }
    });
    test(`${provider} cannot send through an environment credential when the selected business has none`, async t => {
        const envKey = provider === 'turbosms' ? 'TURBOSMS_TOKEN' : 'FLYSMS_API_KEY';
        const previous = process.env[envKey];
        process.env[envKey] = 'fixture-global-credential';
        t.after(() => { if (previous === undefined) delete process.env[envKey]; else process.env[envKey] = previous; });
        let requests = 0;
        fakeHttps(t, () => { requests++; return { success: 1, data: { messageID: 'wrong-account' }, response_code: 800, response_result: [{ response_code: 0, message_id: 'wrong-account' }] }; });
        mock('../services/omni-accounts', { resolveOmniRuntimeConfig: async (_channel, options) => { assert.equal(options.businessContext, 'dar'); return { provider }; } });
        fresh('../services/omni-sms-providers');
        const sms = fresh('../services/omni-sms');
        const result = await sms.sendSMS('+380000000001', 'Fixture', { businessContext: 'dar' });
        assert.equal(result.success, false);
        assert.equal(requests, 0);
    });
}

for (const channel of ['viber', 'facebook', 'instagram']) {
    test(`${channel} reply uses the selected business credential and customer`, async t => {
        const seen = [];
        mock('../services/omni-accounts', { resolveOmniRuntimeConfig: async (requested, options) => {
            assert.equal(requested, channel); assert.equal(options.businessContext, 'dar');
            return { token: 'fixture-dar-token', pageToken: 'fixture-dar-token', senderName: 'Fixture' };
        } });
        fakeHttps(t, (options, body) => { seen.push({ options, body: JSON.parse(body) }); return { status: 0, message_token: '4912661846655238145', message_id: 'fixture-provider-id' }; });
        const adapter = fresh('../services/omni-' + channel);
        const send = adapter.sendViber || adapter.sendFacebook || adapter.sendInstagram;
        assert.equal((await send('fixture-recipient', 'Fixture reply', { businessContext: 'dar' })).success, true);
        assert.equal(seen.length, 1);
        assert.equal(channel === 'viber' ? seen[0].body.receiver : seen[0].body.recipient.id, 'fixture-recipient');
        assert.equal(channel === 'viber' ? seen[0].options.headers['X-Viber-Auth-Token'] : seen[0].options.headers.Authorization, channel === 'viber' ? 'fixture-dar-token' : 'Bearer fixture-dar-token');
        if (channel === 'viber') {
            assert.equal((await adapter.setViberWebhook('https://crm.test/api/omni/webhook/viber?business_context=dar', undefined, { businessContext: 'dar' })).success, true);
            assert.equal(seen[1].options.headers['X-Viber-Auth-Token'], 'fixture-dar-token');
        }
    });
}
