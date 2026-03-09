/**
 * tests/telegram.test.js — Telegram API Tests
 * Run: node --test tests/telegram.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Telegram', () => {

    it('GET /api/telegram/chats — list known chats', async () => {
        const res = await authRequest('GET', '/api/telegram/chats');
        assert.equal(res.status, 200);
        assert.ok(res.data.chats !== undefined, 'Should return chats');
    });

    it('POST /api/telegram/notify — empty text returns no_text', async () => {
        const res = await authRequest('POST', '/api/telegram/notify', {});
        assert.equal(res.status, 200);
        assert.equal(res.data.success, false);
        assert.equal(res.data.reason, 'no_text');
    });

    it('POST /api/telegram/notify — with text', async () => {
        const res = await authRequest('POST', '/api/telegram/notify', {
            text: 'Smoke test notification'
        });
        assert.equal(res.status, 200);
        // Will either succeed or fail with no_chat_id/no_bot_token — both valid
        assert.ok(typeof res.data.success === 'boolean');
    });

    it('GET /api/telegram/animator-status/99999 — non-existent request', async () => {
        const res = await authRequest('GET', '/api/telegram/animator-status/99999');
        assert.equal(res.status, 200);
        assert.equal(res.data.status, 'not_found');
    });

    it('POST /api/telegram/webhook — reject without secret', async () => {
        const res = await authRequest('POST', '/api/telegram/webhook', {});
        assert.equal(res.status, 403);
    });
});
