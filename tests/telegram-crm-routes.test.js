'use strict';
require('./helpers/forbid-real-db');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const express = require('express');
const { createTelegramCrmRouters, serviceSecretMatches } = require('../routes/telegram-crm');
let server, base;
const seen = [];
const key = 'fixture-only-service-key';
const trusted = { Authorization: `Bearer ${key}`, 'x-telegram-user-id': '1001', 'x-telegram-chat-id': '1001', 'x-telegram-chat-type': 'private' };

before(async () => {
    const identity = {
        resolve: async id => {
            seen.push(['resolve', id]);
            if (id !== '1001') throw Object.assign(new Error('not linked'), { statusCode: 403, code: 'TELEGRAM_NOT_LINKED' });
            return { user: { id: 1, name: 'Fixture', password_hash: 'never-expose' }, binding: { version: '2' } };
        },
        claim: async args => { seen.push(['claim', args]); return { status: 'awaiting_crm_confirmation' }; },
        status: async user => { seen.push(['status', user.id]); return { status: 'disconnected' }; },
        begin: async () => { throw new Error('password SECRET database URL'); },
        pending: async () => ({ status: 'awaiting_telegram' }),
        confirm: async user => { seen.push(['confirm', user.id]); return { status: 'connected' }; },
        disconnect: async () => ({ status: 'disconnected' })
    };
    const authenticate = (req, res, next) => {
        if (req.headers.authorization !== 'Bearer crm-user') return res.sendStatus(401);
        req.user = { id: 1 }; next();
    };
    const tasks = { me: async senderId => {
        const { user, binding } = await identity.resolve(senderId);
        return { user: { id: user.id, name: user.name }, bindingVersion: binding.version };
    } };
    const routes = createTelegramCrmRouters({ pool: {}, identity, tasks, authenticate, env: { HERMES_API_KEY: key } });
    const app = express(); app.use(express.json());
    app.use('/account', routes.account); app.use('/bot', routes.bot);
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

async function call(path, headers = {}, body) {
    const response = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { response, data, text };
}

test('service key guard fails closed and does not accept user JWTs or missing configuration', async () => {
    for (const authorization of [undefined, 'Bearer crm-user', 'Bearer wrong', 'Basic anything']) {
        const headers = authorization ? { ...trusted, Authorization: authorization } : {};
        assert.equal((await call('/bot/me', headers)).response.status, 401);
    }
    assert.equal(serviceSecretMatches(`Bearer ${key}`, ''), false);
    assert.equal(serviceSecretMatches(`Bearer ${key}`, undefined), false);
});

test('private Telegram transport requires sender and private chat to match', async () => {
    assert.equal((await call('/bot/me', { ...trusted, 'x-telegram-chat-type': 'group' })).response.status, 403);
    assert.equal((await call('/bot/me', { ...trusted, 'x-telegram-chat-id': '1002' })).response.status, 403);
    assert.equal((await call('/bot/me', { ...trusted, 'x-telegram-user-id': '1 OR 1=1' })).response.status, 400);
    assert.equal((await call('/bot/me', { ...trusted, 'x-telegram-user-id': '1002', 'x-telegram-chat-id': '1002' })).response.status, 403);
});

test('service derives the actor from the trusted sender header and returns no credentials', async () => {
    const response = await call('/bot/me', trusted);
    assert.equal(response.response.status, 200);
    assert.equal(response.data.user.id, 1);
    assert.equal(response.text.includes('password'), false);
    assert.equal(response.response.headers.get('cache-control'), 'private, no-store');
    await call('/bot/link/claim', trusted, { token: 'proof', senderId: '1002', userId: 2, username: 'fixture' });
    assert.equal(seen.at(-1)[1].senderId, '1001');
});

test('account routes require CRM auth and ignore a body-supplied account ID', async () => {
    assert.equal((await call('/account', trusted)).response.status, 401);
    assert.equal((await call('/account', { Authorization: 'Bearer crm-user' })).response.status, 200);
    const response = await call('/account/link/confirm', { Authorization: 'Bearer crm-user' }, {
        requestId: 'a9a74e26-f328-42ae-b762-edc4ee6ef9c9', browserProof: 'a'.repeat(43), userId: 2
    });
    assert.equal(response.response.status, 200);
    assert.deepEqual(seen.at(-1), ['confirm', 1]);
    assert.equal((await call('/account/link/status', { Authorization: 'Bearer crm-user' }, { requestId: 'bad' })).response.status, 400);
});

test('unexpected server errors return an operation ID without leaking exception content', async () => {
    const result = await call('/account/link', { Authorization: 'Bearer crm-user' }, { password: 'fixture' });
    assert.equal(result.response.status, 503);
    assert.ok(result.data.diagnosticId);
    assert.equal(/SECRET|database URL/.test(result.text), false);
});
