'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

function fixture(t) {
    const calls = [];
    const state = { businessAccess: false };
    const pool = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (text.includes('SELECT c.id FROM chat_channels c JOIN chat_channel_members cm')) {
                return { rows: state.businessAccess ? [{ id: params[0] }] : [] };
            }
            if (text.includes('FROM chat_channel_members m') && text.includes('AS unread_count')) {
                return { rows: [{ channel_id: 7, unread_count: '2' }] };
            }
            if (text.includes('FROM chat_channels c') && text.includes('last_message_at DESC')) {
                return { rows: [
                    { id: 7, slug: 'owned', name: '#owned', business_context: 'dar', unread_count: '2' },
                    { id: 8, slug: 'legacy', name: '#legacy', business_context: null, unread_count: '1' }
                ] };
            }
            if (text.includes('INSERT INTO chat_channels') && text.includes('business_context')) {
                return { rows: [{ id: 7, slug: params[0], name: params[1], business_context: params.at(-1) }] };
            }
            return { rows: [] };
        },
        async connect() { return { query: pool.query, release() {} }; }
    };
    const dbId = require.resolve('../db');
    const serviceId = require.resolve('../services/chatService');
    const previousDb = require.cache[dbId];
    const previousService = require.cache[serviceId];
    require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
    delete require.cache[serviceId];
    const service = require('../services/chatService');
    t.after(() => {
        if (previousDb) require.cache[dbId] = previousDb;
        else delete require.cache[dbId];
        if (previousService) require.cache[serviceId] = previousService;
        else delete require.cache[serviceId];
    });
    return { calls, service, state };
}

test('new default channels and unread counts use the selected business owner', async t => {
    const { calls, service } = fixture(t);
    await service.ensureDefaultMemberships(101, 'dar');
    assert.equal(calls.filter(call => call.text.includes('INSERT INTO chat_channels')).length, 4);
    for (const call of calls.filter(call => call.text.includes('INSERT INTO chat_channels'))) {
        assert.equal(call.params.at(-1), 'dar');
        assert.match(call.text, /business_context/);
        assert.ok(call.params[0].length <= 50);
    }
    assert.ok(calls.some(call => call.text.includes('INSERT INTO chat_channel_members')
        && call.text.includes('business_context = $2') && call.params[1] === 'dar'));
    assert.deepEqual(await service.getUnreadCounts(101, 'dar'), { channels: { 7: 2 }, total: 2 });
    assert.ok(calls.some(call => call.text.includes('AS unread_count')
        && call.text.includes('c.business_context = $2') && call.params[1] === 'dar'));
    const channels = await service.getChannels(101);
    assert.deepEqual(channels.map(channel => channel.businessContext), ['dar', null]);
});

test('legacy defaults and unread counts exclude business-owned channels', async t => {
    const { calls, service } = fixture(t);
    await service.ensureDefaultMemberships(102);
    await service.getUnreadCounts(102);
    assert.ok(calls.some(call => call.text.includes('INSERT INTO chat_channel_members')
        && call.text.includes('c.business_context IS NULL')));
    assert.ok(calls.some(call => call.text.includes('AS unread_count')
        && call.text.includes('c.business_context IS NULL')));
});

test('scoped send rechecks durable membership inside its write transaction', async t => {
    const { calls, service } = fixture(t);
    await assert.rejects(service.sendMessage(7, 101, { content: 'Fixture', businessContext: 'dar' }),
        { statusCode: 403 });
    assert.ok(calls.some(call => call.text.includes('FOR SHARE OF c, cm, b, o, bm, om')
        && call.params[2] === 'dar'));
    assert.ok(calls.some(call => call.text === 'ROLLBACK'));
    assert.equal(calls.some(call => call.text.includes('INSERT INTO chat_messages')), false);
});
