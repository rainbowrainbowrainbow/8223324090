'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateGoogleChatWebhook, deliverGoogleChatAnnouncement } = require('../services/afishaAnnouncementGoogleChat');

const webhook = 'https://chat.googleapis.com/v1/spaces/example/messages?key=example&token=example';
test('webhook endpoint validation and transport use HTTPS without redirects', async () => {
    assert.equal(validateGoogleChatWebhook(webhook).destinationKey, 'google_chat:example');
    for (const bad of [webhook.replace('chat.googleapis.com', 'chat.googleapis.com.example.com'),
        webhook.replace('https:', 'http:'), webhook + '&token=twice', webhook + '#fragment',
        webhook.replace('chat.googleapis.com', 'user@chat.googleapis.com')]) {
        assert.throws(() => validateGoogleChatWebhook(bad), { statusCode: 400 });
    }
    assert.deepEqual(await deliverGoogleChatAnnouncement({ webhook }, 'Афіша', async (url, options) => {
        assert.equal(url, webhook);
        assert.equal(options.redirect, 'error');
        assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { text: 'Афіша' });
        return Response.json({ name: 'spaces/example/messages/123' });
    }), { status: 'sent', messageId: 'spaces/example/messages/123' });
});
test('webhook retries rate limits and keeps ambiguous failures redacted', async () => {
    const send = async response => deliverGoogleChatAnnouncement({ webhook }, 'Афіша', async () => response);
    assert.deepEqual(await send(new Response(null, { status: 429, headers: { 'Retry-After': '10' } })),
        { status: 'retry', code: 'rate_limited', retryAfterSeconds: 10 });
    assert.deepEqual(await send(new Response(null, { status: 403 })), { status: 'failed', code: 'google_chat_rejected' });
    assert.deepEqual(await send(new Response(null, { status: 503 })), { status: 'uncertain', code: 'google_chat_unconfirmed' });
    assert.deepEqual(await deliverGoogleChatAnnouncement({ webhook }, 'Афіша', async () => { throw new Error(webhook); }),
        { status: 'uncertain', code: 'google_chat_unconfirmed' });
});
