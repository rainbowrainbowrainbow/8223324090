'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Record decisions are tested independently of the module rollout switch.
// The real membership/module/page policy has its own full 26-role contract.
const policyId = require.resolve('../services/parkWorkModuleAccess');
const saved = require.cache[policyId];
require.cache[policyId] = { id: policyId, filename: policyId, loaded: true,
    exports: { canUseParkWorkModule: user => user?.allowed === true } };
const access = require('../services/parkChatAccess');
if (saved) require.cache[policyId] = saved; else delete require.cache[policyId];

const user = { id: 11, username: 'synthetic', role: 'creator', allowed: true };
function database(responses) {
    const calls = [];
    return { calls, async query(sql, params) {
        calls.push({ sql, params });
        assert.ok(responses.length, 'Unexpected extra query');
        return { rows: responses.shift() };
    } };
}

test('Chat record guards reject invalid IDs and absent work access before reading rows', async () => {
    const db = database([]);
    for (const id of ['1x', -1, 0, {}, 1.5]) assert.equal(await access.canReadParkChatChannel(db, user, id), false);
    assert.equal(await access.canReadParkChatChannel(db, { ...user, allowed: false }, 1), false);
    assert.equal(await access.canReadParkChatUpload(db, user, '../private.png'), false);
    assert.equal(db.calls.length, 0);
});

test('a stale channel membership cannot turn a third party into a DM or assistant owner', async () => {
    for (const channel of [{ is_dm: true, dm_user_ids: [11, 12] },
        { type: 'assistant', linked_entity_type: 'assistant_dialog', linked_entity_id: 11, created_by: 11 }]) {
        assert.equal(access.hasParkChatPrivateIdentity(channel, 11), true);
        assert.equal(access.hasParkChatPrivateIdentity(channel, 99), false);
    }
    for (const channel of [{ is_dm: true, dm_user_ids: [11, 11] }, { type: 'dm', dm_user_ids: [11, 12, 99] },
        { type: 'assistant', linked_entity_type: 'assistant_dialog', linked_entity_id: 11, created_by: 12 },
        { type: 'assistant' }, { is_dm: true }]) {
        assert.equal(await access.canReadParkChatChannel(database([[{ id: 7, ...channel }]]), user, 7), false);
    }
});

test('channel membership never bypasses missing, contradictory or foreign booking ownership', async () => {
    for (const channel of [null, { id: 7, type: 'booking' },
        { id: 7, linked_booking_id: 'BK-A', linked_entity_type: 'booking', linked_entity_id: 'BK-B' }]) {
        const db = database([channel ? [channel] : []]);
        assert.equal(await access.canReadParkChatChannel(db, user, 7), false);
        assert.equal(db.calls.length, 1);
    }
    for (const visible of [[], [{ id: 'BK-A' }]]) {
        const db = database([[{ id: 7, type: 'booking', linked_booking_id: 'BK-A' }], visible]);
        assert.equal(await access.canReadParkChatChannel(db, user, 7), visible.length === 1);
        assert.match(db.calls[0].sql, /member\.user_id = \$2/);
        assert.match(db.calls[1].sql, /b\.business_context = 'event_genix'/);
    }
});

test('durable upload ownership comes from its linked message, never path segments or copied metadata', async () => {
    const db = database([[{ message_id: 91, channel_id: 7 }], [{ channel_id: 7, available: true }], [{ id: 7 }]]);
    assert.equal(await access.canReadParkChatUpload(db, user, 'channels/99/synthetic.png'), true);
    assert.deepEqual(db.calls[1].params, [91, 7]);
    assert.deepEqual(db.calls[2].params, [7, 11], 'actual blob owner, not path channel99');
    assert.equal(db.calls.some(call => /SELECT.*\bdata\b/.test(call.sql)), false, 'no file body read before authorization');
    for (const rows of [[{ channel_id: 7, message_id: null }], [{ channel_id: 7, message_id: 91 }, { channel_id: 8, message_id: 92 }]]) {
        const denied = database([rows]);
        assert.equal(await access.canReadParkChatUpload(denied, user, 'synthetic.png'), false);
        assert.equal(denied.calls.length, 1, 'orphan/ambiguous blobs never fall back to metadata');
    }
});

test('historical files retain their first message owner and deleted/expired files stay inaccessible', async () => {
    const db = database([[], [{ channel_id: 7, available: true }], []]);
    assert.equal(await access.canReadParkChatUpload(db, user, 'synthetic.png'), false);
    assert.match(db.calls[1].sql, /ORDER BY id LIMIT 1/);
    assert.deepEqual(db.calls[2].params, [7, 11]);
    for (const blob of [[], [{ channel_id: 7, message_id: 91 }]]) {
        const deleted = database([blob, [{ channel_id: 7, available: false }]]);
        assert.equal(await access.canReadParkChatUpload(deleted, user, 'synthetic.png'), false);
        assert.equal(deleted.calls.length, 2);
    }
});

test('upload middleware fails closed on unavailable authorization and does not expose error details', async () => {
    let next = false; let status; let body;
    const guard = access.requireParkChatUpload({ async query() { throw new Error('PRIVATE_CONNECTION_CANARY'); } });
    await guard({ path: '/synthetic.png', user }, { status(value) { status = value; return this; }, json(value) { body = value; } }, () => { next = true; });
    assert.equal(next, false);
    assert.equal(status, 503);
    assert.equal(JSON.stringify(body).includes('PRIVATE_'), false);
});

test('preview projection strips hidden bookings and never copies finance or contacts into coordination cards', async () => {
    const raw = [{ id: 9, content: 'Keep ordinary message text', metadata: { bookingPreview: {
        id: 'BK-A', date: '2026-11-18', time: '12:00', programName: 'Synthetic', label: 'Synthetic event',
        price: 100, phone: 'PRIVATE_CONTACT_CANARY', client: { secret: 'PRIVATE_NESTED_CANARY' }
    } } }, { id: 10, metadata: JSON.stringify({ bookingPreview: { id: 'BK-B', price: 'PRIVATE_MONEY_CANARY' } }) }];
    const db = database([[{ id: 'BK-A' }]]);
    const projected = await access.projectParkChatResponse(db, user, raw);
    assert.equal(projected[0].content, raw[0].content);
    assert.equal(projected[0].metadata.bookingPreview.id, 'BK-A');
    assert.equal(projected[0].metadata.bookingPreview.price, undefined);
    assert.equal(JSON.parse(projected[1].metadata).bookingPreview, undefined);
    assert.equal(JSON.stringify(projected).includes('PRIVATE_'), false);
    assert.match(db.calls[0].sql, /b\.business_context = 'event_genix'/);
    assert.deepEqual(db.calls[0].params[0], ['BK-A', 'BK-B']);
    assert.equal(raw[0].metadata.bookingPreview.price, 100, 'source event remains immutable');
    assert.equal(access.shapeChatBookingPreviews(raw)[0].metadata.bookingPreview.price, undefined, 'socket card has the same safe fields');
});

test('encoded and path-normalized aliases cannot bypass the dedicated private static mount', () => {
    for (const value of ['/uploads/%63hat/private.png', '/%75ploads/chat/private.png',
        '/uploads//chat/private.png', '/uploads/other/../chat/private.png', '/uploads\\chat\\private.png']) {
        let next = false; let status;
        access.rejectNoncanonicalChatUploadPaths({ path: value }, { status(code) { status = code; return this; }, end() {} }, () => { next = true; });
        assert.equal(next, false, value);
        assert.equal(status, 404);
    }
    let next = false;
    access.rejectNoncanonicalChatUploadPaths({ path: '/uploads/chat/private.png' }, {}, () => { next = true; });
    assert.equal(next, true, 'canonical route continues to bearer/channel authorization');
});
