'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { renderAutomaticAnnouncement, runAfishaDeliveryBatch } = require('../services/afishaAnnouncementDelivery');

const now = Date.parse('2026-11-27T06:00:00Z');
const makePart = (id, changes = {}) => ({
    id, lease: 'lease-' + id, recipient: { platform: 'telegram', chatId: '-100' + id },
    text: 'Афіша', attempt: 1, expiresAt: now + 120_000, ...changes
});

function fixture(parts) {
    const finishes = [];
    return {
        finishes,
        async claimNextPart(at) {
            assert.equal(at, now);
            return parts.shift();
        },
        async finishPart(id, lease, result) {
            assert.equal(lease, 'lease-' + id);
            finishes.push({ id, ...result });
        }
    };
}

test('one worker run records a confirmed chat separately from a retry and an uncertain chat', async () => {
    const store = fixture([makePart(1), makePart(2), makePart(3)]);
    const sends = [];
    const processed = await runAfishaDeliveryBatch({ store, now: () => now, transports: {
        telegram: async recipient => {
            sends.push(recipient.chatId);
            if (recipient.chatId === '-1001') return { status: 'sent', messageId: '95' };
            if (recipient.chatId === '-1002') return { status: 'retry', code: 'rate_limited', retryAfterSeconds: 60 };
            throw new Error('private raw provider error');
        }
    } });
    assert.equal(processed, 3);
    assert.deepEqual(sends, ['-1001', '-1002', '-1003']);
    assert.deepEqual(store.finishes, [
        { id: 1, status: 'sent', messageId: '95' },
        { id: 2, status: 'retry', code: 'rate_limited', availableAt: now + 60_000 },
        { id: 3, status: 'uncertain', code: 'delivery_unconfirmed' }
    ]);
});

test('a retry is stopped at the freshness deadline or when retry budget is exhausted', async () => {
    const store = fixture([makePart(1, { expiresAt: now + 30_000 }), makePart(2, { attempt: 4 })]);
    await runAfishaDeliveryBatch({ store, now: () => now, transports: {
        telegram: async () => ({ status: 'retry', code: 'telegram_unavailable' })
    } });
    assert.deepEqual(store.finishes, [
        { id: 1, status: 'failed', code: 'telegram_unavailable' },
        { id: 2, status: 'failed', code: 'telegram_unavailable' }
    ]);
});

test('parts that expire between claim and dispatch are skipped before calling any provider', async () => {
    const store = fixture([makePart(1, { expiresAt: now })]);
    let sends = 0;
    const processed = await runAfishaDeliveryBatch({ store, now: () => now, transports: {
        telegram: async () => { sends++; return { status: 'sent' }; }
    } });
    assert.equal(processed, 1);
    assert.equal(sends, 0);
    assert.deepEqual(store.finishes, [{ id: 1, status: 'skipped', code: 'delivery_expired' }]);
});

test('a persistence failure after sending does not call the provider again', async () => {
    const store = fixture([makePart(1), makePart(2)]);
    store.finishPart = async () => { throw new Error('database unavailable'); };
    let sent = 0;
    await assert.rejects(runAfishaDeliveryBatch({ store, now: () => now, transports: {
        telegram: async () => { sent++; return { status: 'sent' }; }
    } }), /database unavailable/);
    assert.equal(sent, 1);
});

test('automatic chat preview reads only the selected section using the same renderer as publication', async () => {
    const pool = { async query(sql, args) {
        assert.match(sql, /FROM timeline_promotions/);
        assert.deepEqual(args, ['event_genix', '2026-11-27', '2026-11-27']);
        return { rows: [
            { id: 1, title: 'Earlier', starts_on: '2026-11-26', ends_on: '2026-11-29' },
            { id: 2, title: 'Today', starts_on: '2026-11-27', ends_on: '2026-11-30' }
        ] };
    } };
    const parts = await renderAutomaticAnnouncement(pool, {
        businessContext: 'event_genix', promotionsToday: true, eventsToday: false
    }, { kind: 'daily', from: '2026-11-27', to: '2026-11-27' });
    assert.equal(parts.length, 1);
    assert.match(parts[0], /Today/);
    assert.doesNotMatch(parts[0], /Earlier/);
});
