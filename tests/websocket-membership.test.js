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

function subscribeDate(client, date) {
    client.send(JSON.stringify({ type: 'JOIN_DATE', date }));
    return wait(20);
}

async function didReceiveMessage(client, predicate, action, timeoutMs = 120) {
    let received = false;
    function onMessage(raw) {
        const message = JSON.parse(raw.toString());
        if (predicate(message)) received = true;
    }
    client.on('message', onMessage);
    try {
        await action();
        await wait(timeoutMs);
        return received;
    } finally {
        client.off('message', onMessage);
    }
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
            memberships: new Set(),
            users: new Map([
                [1, { id: 1, username: 'creator-event', name: 'Creator Event', role: 'creator', business_contexts: ['event_genix'], is_active: true }],
                [2, { id: 2, username: 'staff-22', name: 'Staff 22', role: 'animator', business_contexts: ['event_genix'], is_active: true }],
                [3, { id: 3, username: 'staff-33', name: 'Staff 33', role: 'animator', business_contexts: ['event_genix'], is_active: true }],
                [4, { id: 4, username: 'creator-maysternya', name: 'Creator Maysternya', role: 'creator', business_contexts: ['maysternya_doli'], is_active: true }]
            ]),
            staffIds: new Map([[2, [22]], [3, [33]]])
        };

        const pool = {
            query: async (sql, params = []) => {
                const userId = Number(params[0]);
                if (/SELECT is_active, session_revoked_at FROM users/i.test(sql)) {
                    const user = state.users.get(userId);
                    return { rows: user ? [{ is_active: user.is_active, session_revoked_at: null }] : [], rowCount: user ? 1 : 0 };
                }
                if (/FROM users WHERE id = \$1/i.test(sql)) {
                    const user = state.users.get(userId);
                    return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
                }
                if (/FROM employee_profiles/i.test(sql)) {
                    const rows = (state.staffIds.get(userId) || []).map(staffId => ({ staff_id: staffId }));
                    return { rows, rowCount: rows.length };
                }
                return { rows: [], rowCount: 0 };
            }
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

    it('sends only minimal booking metadata inside the authorized business context', async () => {
        const allowed = await openAuthedClient(1);
        const otherContext = await openAuthedClient(4);
        await withClients([allowed, otherContext], async () => {
            await Promise.all([
                subscribeDate(allowed, '2026-07-14'),
                subscribeDate(otherContext, '2026-07-14')
            ]);

            const allowedMessage = waitForMessage(allowed, msg => msg.type === 'booking:created');
            const leaked = didReceiveMessage(
                otherContext,
                msg => msg.type === 'booking:created',
                async () => wsService.broadcastBookingEvent('booking:created', {
                    id: 501,
                    date: '2026-07-14',
                    businessContext: 'event_genix',
                    lineId: 22,
                    customer: { name: 'Sensitive Customer' },
                    notes: 'Sensitive notes',
                    price: 5000,
                    extraData: { secret: true }
                })
            );

            const message = await allowedMessage;
            assert.equal(await leaked, false);
            assert.deepEqual(Object.keys(message.payload).sort(), [
                'businessContext', 'date', 'eventType', 'id', 'updatedAt'
            ]);
            assert.equal(message.payload.id, 501);
            assert.equal(message.payload.businessContext, 'event_genix');
        });
    });

    it('uses fresh DB role and staff binding for booking visibility', async () => {
        const assignedStaff = await openAuthedClient(2);
        const otherStaff = await openAuthedClient(3);
        await withClients([assignedStaff, otherStaff], async () => {
            await Promise.all([
                subscribeDate(assignedStaff, '2026-07-15'),
                subscribeDate(otherStaff, '2026-07-15')
            ]);

            const assignedMessage = waitForMessage(assignedStaff, msg => msg.type === 'booking:updated');
            const leaked = didReceiveMessage(
                otherStaff,
                msg => msg.type === 'booking:updated',
                async () => wsService.broadcastBookingEvent('booking:updated', {
                    id: 502,
                    date: '2026-07-15',
                    business_context: 'event_genix',
                    line_id: '22',
                    created_by: 'someone-else'
                })
            );

            assert.equal((await assignedMessage).payload.id, 502);
            assert.equal(await leaked, false);
        });
    });

    it('does not send timeline events without an exact date subscription', async () => {
        const client = await openAuthedClient(1);
        await withClients([client], async () => {
            const received = await didReceiveMessage(
                client,
                msg => msg.type === 'booking:deleted',
                async () => wsService.broadcastBookingEvent('booking:deleted', {
                    id: 503,
                    date: '2026-07-16',
                    businessContext: 'event_genix'
                })
            );
            assert.equal(received, false);
        });
    });

    it('notifies both old and new scoped audiences when an update moves a booking', async () => {
        const oldStaff = await openAuthedClient(2);
        const newStaff = await openAuthedClient(3);
        await withClients([oldStaff, newStaff], async () => {
            await Promise.all([
                subscribeDate(oldStaff, '2026-07-18'),
                subscribeDate(newStaff, '2026-07-19')
            ]);
            const oldAudienceMessage = waitForMessage(oldStaff, msg => msg.type === 'booking:updated');
            const newAudienceMessage = waitForMessage(newStaff, msg => msg.type === 'booking:updated');

            wsService.broadcastBookingEvent('booking:updated', {
                id: 505,
                date: '2026-07-19',
                businessContext: 'event_genix',
                lineId: 33
            }, null, {
                previousBooking: {
                    id: 505,
                    date: '2026-07-18',
                    businessContext: 'event_genix',
                    lineId: 22
                }
            });

            assert.equal((await oldAudienceMessage).payload.date, '2026-07-18');
            assert.equal((await newAudienceMessage).payload.date, '2026-07-19');
        });
    });

    it('filters line metadata by business context and exact date subscription', async () => {
        const allowed = await openAuthedClient(1);
        const otherContext = await openAuthedClient(4);
        await withClients([allowed, otherContext], async () => {
            await Promise.all([
                subscribeDate(allowed, '2026-07-20'),
                subscribeDate(otherContext, '2026-07-20')
            ]);
            const allowedMessage = waitForMessage(allowed, msg => msg.type === 'line:updated');
            const leaked = didReceiveMessage(
                otherContext,
                msg => msg.type === 'line:updated',
                async () => wsService.broadcastLineEvent('line:updated', {
                    date: '2026-07-20',
                    businessContext: 'event_genix'
                })
            );

            assert.deepEqual(Object.keys((await allowedMessage).payload).sort(), [
                'businessContext', 'date', 'eventType', 'updatedAt'
            ]);
            assert.equal(await leaked, false);
        });
    });

    it('scopes roster updates by business context and exact date subscription', async () => {
        const allowed = await openAuthedClient(1);
        const otherContext = await openAuthedClient(4);
        await withClients([allowed, otherContext], async () => {
            await Promise.all([
                subscribeDate(allowed, '2026-07-21'),
                subscribeDate(otherContext, '2026-07-21')
            ]);
            const allowedMessage = waitForMessage(allowed, msg => msg.type === 'timeline:roster-updated');
            const leaked = didReceiveMessage(
                otherContext,
                msg => msg.type === 'timeline:roster-updated',
                async () => wsService.broadcastLineEvent('timeline:roster-updated', {
                    date: '2026-07-21',
                    businessContext: 'event_genix'
                })
            );

            assert.equal((await allowedMessage).payload.eventType, 'timeline:roster-updated');
            assert.equal(await leaked, false);
        });
    });

    it('blocks booking payloads sent through generic broadcast', async () => {
        const client = await openAuthedClient(1);
        await withClients([client], async () => {
            await subscribeDate(client, '2026-07-17');
            const received = await didReceiveMessage(
                client,
                msg => msg.type === 'booking:created',
                async () => wsService.broadcast('booking:created', { id: 504, date: '2026-07-17' })
            );
            assert.equal(received, false);
        });
    });
});
