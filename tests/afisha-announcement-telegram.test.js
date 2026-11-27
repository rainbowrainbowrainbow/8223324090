'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deliverTelegramAnnouncement } = require('../services/afishaAnnouncementTelegram');

const recipient = { chatId: '-100123', businessContext: 'event_genix' };

test('Telegram sends to an explicit chat using plain text and only specifies a selected topic', async () => {
    const requests = [];
    const request = async (...args) => {
        requests.push(args);
        return { ok: true, result: { message_id: 99 } };
    };
    assert.deepEqual(await deliverTelegramAnnouncement(recipient, 'A & B', request), { status: 'sent', messageId: 99 });
    await deliverTelegramAnnouncement({ ...recipient, threadId: 12 }, 'A & B', request);
    assert.deepEqual(requests[0], ['sendMessage', {
        chat_id: '-100123', text: 'A & B', link_preview_options: { is_disabled: true }
    }, { businessContext: 'event_genix' }]);
    assert.equal(requests[1][1].message_thread_id, 12);
});

test('Telegram transport classifies failures without retrying a send itself', async () => {
    let attempts = 0;
    const result = await deliverTelegramAnnouncement(recipient, 'Afisha', async () => {
        attempts++;
        throw Object.assign(new Error('provider response timed out'), { code: 'ETIMEDOUT' });
    });
    assert.equal(attempts, 1);
    assert.deepEqual(result, { status: 'uncertain', code: 'telegram_unconfirmed' });

    const limited = await deliverTelegramAnnouncement(recipient, 'Afisha', async () =>
        ({ ok: false, error_code: 429, parameters: { retry_after: 45 } }));
    assert.deepEqual(limited, { status: 'retry', code: 'rate_limited', retryAfterSeconds: 45 });

    const rejected = await deliverTelegramAnnouncement(recipient, 'Afisha', async () =>
        ({ ok: false, error_code: 403, description: 'raw provider error' }));
    assert.deepEqual(rejected, { status: 'failed', code: 'telegram_rejected' });
});


test('default announcement transport uses the same operational bot token as animator approvals', async t => {
    const telegram = require('../services/telegram');
    const originalToken = telegram.TELEGRAM_BOT_TOKEN;
    const originalRequest = telegram.telegramRequest;
    t.after(() => {
        telegram.TELEGRAM_BOT_TOKEN = originalToken;
        telegram.telegramRequest = originalRequest;
    });
    const requests = [];
    telegram.TELEGRAM_BOT_TOKEN = 'unit-operational-token';
    telegram.telegramRequest = async (method, payload, options) => {
        requests.push({ method, payload, options });
        return { ok: true, result: { message_id: 123 } };
    };
    assert.equal((await deliverTelegramAnnouncement(recipient, 'Afisha')).status, 'sent');
    assert.deepEqual(requests[0].options, { ownedToken: 'unit-operational-token' });
    telegram.TELEGRAM_BOT_TOKEN = '';
    assert.equal((await deliverTelegramAnnouncement(recipient, 'Afisha')).status, 'failed');
    assert.equal(requests.length, 1);
});
