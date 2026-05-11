const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

const TEST_JWT_SECRET = 'websocket-membership-secret';

let httpServer;
let wsService;
let baseUrl;
let state;

const originalJwtSecret = process.env.JWT_SECRET;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/chatService',
        '../services/websocket'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function tokenFor(userId, username = `user-${userId}`) {
    return jwt.sign(
        { id: userId, userId, username, name: username, role: 'creator' },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

function startHttpServer() {
    return new Promise(resolve => {
        const server = http.createServer((req, res) => {
            res.statusCode = 404;
            res.end('not found');
        });
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, url: `ws://127.0.0.1:${server.address().port}/ws` });
        });
    });
}

function closeHttpServer(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

function waitForMessage(client, predicate, timeoutMs = 1000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            client.off('message', onMessage);
            reject(new Error('Timed out waiting for WebSocket message'));
        }, timeoutMs);
        function onMessage(raw) {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }
            if (!predicate || predicate(msg)) {
                clearTimeout(timer);
                client.off('message', onMessage);
                resolve(msg);
            }
        }
        client.on('message', onMessage);
    });
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function openAuthedClient(userId) {
    const client = new WebSocket(baseUrl);
    await new Promise((resolve, reject) => {
        client.once('open', resolve);
        client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'auth', token: tokenFor(userId) }));
    await waitForMessage(client, msg => msg.type === 'auth:success');
    return client;
}

async function withClients(clients, fn) {
    try {
        return await fn();
    } finally {
        for (const client of clients) {
            if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
                client.close();
            }
        }
        await wait(20);
    }
}

describe('WebSocket chat membership authorization', () => {
    beforeEach(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        clearModules();
        state = {
            memberships: new Set()
        };

        const pool = {
            query: async () => ({ rows: [], rowCount: 0 })
        };
        installMock('../db', { pool, query: pool.query.bind(pool) });
        installMock('../services/chatService', {
            isMember: async (channelId, userId) => state.memberships.has(`${channelId}:${userId}`)
        });

        wsService = require('../services/websocket');
        const started = await startHttpServer();
        httpServer = started.server;
        baseUrl = started.url;
        wsService.initWebSocket(httpServer);
    });

    afterEach(async () => {
        if (wsService?.getWSS()) {
            await new Promise(resolve => wsService.getWSS().close(resolve));
        }
        if (httpServer?.listening) {
            await closeHttpServer(httpServer);
        }
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        clearModules();
    });

    it('blocks unauthorized CHAT_JOIN and does not subscribe the socket', async () => {
        const client = await openAuthedClient(1);
        await withClients([client], async () => {
            client.send(JSON.stringify({ type: 'CHAT_JOIN', channelId: 99 }));
            const error = await waitForMessage(client, msg => msg.type === 'error');
            assert.equal(error.message, 'Not a member of this channel');

            let leaked = false;
            client.on('message', raw => {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'chat:message') leaked = true;
            });
            wsService.broadcastToChannel(99, 'chat:message', { channelId: 99, secret: true });
            await wait(50);
            assert.equal(leaked, false);
        });
    });

    it('allows authorized CHAT_JOIN and receives channel broadcasts', async () => {
        state.memberships.add('42:1');
        const client = await openAuthedClient(1);

        await withClients([client], async () => {
            client.send(JSON.stringify({ type: 'CHAT_JOIN', channelId: 42 }));
            const joined = await waitForMessage(client, msg => msg.type === 'chat:joined');
            assert.deepEqual(joined.payload, { channelId: 42 });

            wsService.broadcastToChannel(42, 'chat:message', { channelId: 42, ok: true });
            const message = await waitForMessage(client, msg => msg.type === 'chat:message');
            assert.equal(message.payload.ok, true);
        });
    });

    it('blocks unauthorized CHAT_TYPING from reaching subscribed members', async () => {
        state.memberships.add('77:2');
        const sender = await openAuthedClient(1);
        const receiver = await openAuthedClient(2);

        await withClients([sender, receiver], async () => {
            receiver.send(JSON.stringify({ type: 'CHAT_JOIN', channelId: 77 }));
            await waitForMessage(receiver, msg => msg.type === 'chat:joined');

            let typingReceived = false;
            receiver.on('message', raw => {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'chat:typing') typingReceived = true;
            });

            sender.send(JSON.stringify({ type: 'CHAT_TYPING', channelId: 77 }));
            const error = await waitForMessage(sender, msg => msg.type === 'error');
            assert.equal(error.message, 'Not a member of this channel');
            await wait(50);
            assert.equal(typingReceived, false);
        });
    });

    it('allows authorized CHAT_TYPING to subscribed channel members', async () => {
        state.memberships.add('77:1');
        state.memberships.add('77:2');
        const sender = await openAuthedClient(1);
        const receiver = await openAuthedClient(2);

        await withClients([sender, receiver], async () => {
            receiver.send(JSON.stringify({ type: 'CHAT_JOIN', channelId: 77 }));
            await waitForMessage(receiver, msg => msg.type === 'chat:joined');

            sender.send(JSON.stringify({ type: 'CHAT_TYPING', channelId: 77 }));
            const typing = await waitForMessage(receiver, msg => msg.type === 'chat:typing');
            assert.equal(typing.payload.channelId, 77);
            assert.equal(typing.payload.userId, '1');
        });
    });
});
