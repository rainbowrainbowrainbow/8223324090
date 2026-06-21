const test = require('node:test');
const assert = require('node:assert/strict');

const {
    classifyDigestSendFailure,
    buildDigestSendResult
} = require('../services/scheduler');

test('digest send result exposes stable success contract', () => {
    const result = buildDigestSendResult(
        { ok: true, result: { message_id: 42 } },
        7,
        { bookingVisibilityScope: 'role' }
    );

    assert.equal(result.success, true);
    assert.equal(result.code, 'DIGEST_SENT');
    assert.equal(result.message, 'Дайджест дня відправлено');
    assert.equal(result.count, 7);
    assert.deepEqual(result.meta, { bookingVisibilityScope: 'role' });
    assert.equal(result.reason, undefined);
});

test('digest send result maps missing Telegram bot token', () => {
    const result = buildDigestSendResult({ ok: false, description: 'No bot token configured' }, 0);

    assert.equal(result.success, false);
    assert.equal(result.code, 'NO_BOT_TOKEN');
    assert.equal(result.reason, 'no_bot_token');
    assert.match(result.message, /bot token/);
    assert.equal(result.count, 0);
});

test('digest send result maps invalid Telegram bot token', () => {
    const failure = classifyDigestSendFailure({ ok: false, description: 'Unauthorized' });

    assert.equal(failure.code, 'NO_BOT_TOKEN');
    assert.equal(failure.reason, 'no_bot_token');
});

test('digest send result maps missing chat id', () => {
    const failure = classifyDigestSendFailure({ ok: false, description: 'Bad Request: chat not found' });

    assert.equal(failure.code, 'NO_CHAT_ID');
    assert.equal(failure.reason, 'no_chat_id');
    assert.match(failure.message, /Chat ID/);
});

test('digest send result maps generic Telegram send failure', () => {
    const result = buildDigestSendResult({ ok: false, description: 'Bad Request: message is too long' }, 3);

    assert.equal(result.success, false);
    assert.equal(result.code, 'TELEGRAM_SEND_FAILED');
    assert.equal(result.reason, 'telegram_send_failed');
    assert.equal(result.count, 3);
});
