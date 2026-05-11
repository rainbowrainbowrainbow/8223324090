const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'chat-membership-guards-secret';

let server;
let baseUrl;
let state;

const originalJwtSecret = process.env.JWT_SECRET;

function listen(app) {
    return new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => {
            resolve({ server: s, baseUrl: `http://127.0.0.1:${s.address().port}` });
        });
    });
}

function close(s) {
    return new Promise((resolve, reject) => {
        s.close(err => err ? reject(err) : resolve());
    });
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/chat',
        '../services/chatService',
        '../services/websocket',
        '../services/chat-bot',
        '../services/guardian',
        '../services/linkPreview',
        '../services/gamification'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function tokenFor(role = 'creator') {
    return jwt.sign(
        { id: 1, userId: 1, username: `${role}-user`, name: `${role} User`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

function auth(role = 'creator') {
    return { Authorization: `Bearer ${tokenFor(role)}` };
}

async function request(method, path, body, role = 'creator') {
    const headers = auth(role);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}

function resetState() {
    state = {
        memberships: new Set(['1:1']),
        calls: [],
        dbQueries: [],
        messages: new Map([
            [500, { id: 500, channel_id: 1, user_id: 2, content: 'visible' }],
            [501, { id: 501, channel_id: 99, user_id: 2, content: 'private' }]
        ]),
        polls: new Map([
            [8, {
                id: 8,
                channel_id: 99,
                options: [{ text: 'A', votes: 0 }, { text: 'B', votes: 0 }],
                poll_type: 'single',
                is_closed: false,
                is_anonymous: false,
                expires_at: null
            }]
        ])
    };
}

function fakePool() {
    return {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            state.dbQueries.push({ text, params });

            if (/UPDATE employee_profiles SET last_activity_at/i.test(text) ||
                /UPDATE users SET last_seen_at/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/SELECT \* FROM chat_polls WHERE id = \$1/i.test(text)) {
                const poll = state.polls.get(Number(params[0]));
                return { rows: poll ? [poll] : [], rowCount: poll ? 1 : 0 };
            }
            if (/SELECT id, channel_id, content FROM chat_messages WHERE id = \$1/i.test(text)) {
                const msg = state.messages.get(Number(params[0]));
                return { rows: msg ? [msg] : [], rowCount: msg ? 1 : 0 };
            }
            if (/SELECT \* FROM chat_channels WHERE linked_booking_id = \$1/i.test(text)) {
                return { rows: [{ id: 99, linked_booking_id: params[0], name: 'Private booking' }], rowCount: 1 };
            }
            if (/SELECT id FROM chat_channels WHERE line_id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: 99 }], rowCount: 1 };
            }
            if (/SELECT COUNT\(DISTINCT user_id\) AS total FROM chat_poll_votes/i.test(text)) {
                return { rows: [{ total: 0 }], rowCount: 1 };
            }
            if (/FROM chat_poll_votes v JOIN users u/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }

            throw new Error(`Unexpected chat membership test query: ${text}`);
        },
        connect: async () => {
            throw new Error('Unexpected transaction in chat membership guard test');
        }
    };
}

function fakeChatService() {
    return {
        isMember: async (channelId, userId) => state.memberships.has(`${channelId}:${userId}`),
        getReadReceipts: async channelId => {
            state.calls.push(['getReadReceipts', channelId]);
            return [];
        },
        getPinnedMessages: async channelId => {
            state.calls.push(['getPinnedMessages', channelId]);
            return [];
        },
        getChannelMembers: async channelId => {
            state.calls.push(['getChannelMembers', channelId]);
            return [];
        },
        getMessageById: async messageId => state.messages.get(Number(messageId)) || null,
        addReaction: async (messageId, userId, emoji) => {
            state.calls.push(['addReaction', messageId, userId, emoji]);
            return [{ emoji, userId }];
        },
        removeReaction: async (messageId, userId, emoji) => {
            state.calls.push(['removeReaction', messageId, userId, emoji]);
            return [];
        },
        pinMessage: async (...args) => state.calls.push(['pinMessage', ...args]),
        unpinMessage: async (...args) => state.calls.push(['unpinMessage', ...args]),
        toggleMute: async channelId => {
            state.calls.push(['toggleMute', channelId]);
            return true;
        },
        addMember: async (...args) => state.calls.push(['addMember', ...args]),
        removeMember: async (...args) => state.calls.push(['removeMember', ...args]),
        archiveChannel: async channelId => state.calls.push(['archiveChannel', channelId]),
        updateChannel: async channelId => ({ id: channelId, name: 'Updated' }),
        createTask: async task => {
            state.calls.push(['createTask', task]);
            return { id: 10, ...task };
        },
        sendFileMessage: async () => {
            state.calls.push(['sendFileMessage']);
            return { message: { id: 700 }, mentionedUserIds: [] };
        },
        updateActivityStats: async () => {},
        mapMessageRow: row => row
    };
}

describe('chat secondary endpoint membership guards', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        resetState();
        clearModules();

        const pool = fakePool();
        installMock('../db', { pool, query: pool.query.bind(pool) });
        installMock('../services/chatService', fakeChatService());
        installMock('../services/websocket', {
            broadcastToChannel: () => {},
            sendToUser: () => {},
            getOnlineUserIds: () => [],
            getLastSeen: () => null
        });
        installMock('../services/chat-bot', { processMessage: async () => null });
        installMock('../services/guardian', { preCheckMessage: async () => ({ blocked: false }) });
        installMock('../services/linkPreview', { fetchPreview: async () => null });
        installMock('../services/gamification', { spendCoins: async () => true });

        const app = express();
        app.use(express.json());
        app.use('/api/chat', require('../routes/chat'));

        ({ server, baseUrl } = await listen(app));
    });

    beforeEach(() => {
        resetState();
    });

    after(async () => {
        if (server) await close(server);
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        clearModules();
    });

    it('denies channel-scoped secondary endpoints before route side effects for non-members', async () => {
        const cases = [
            ['POST', '/api/chat/channels/99/upload', undefined],
            ['PUT', '/api/chat/channels/99/read', { seq: 1 }],
            ['GET', '/api/chat/channels/99/read-receipts', undefined],
            ['GET', '/api/chat/channels/99/pinned', undefined],
            ['GET', '/api/chat/channels/99/members', undefined],
            ['PUT', '/api/chat/channels/99/mute', undefined],
            ['POST', '/api/chat/channels/99/poll', { question: 'Q?', options: ['A', 'B'] }]
        ];

        for (const [method, path, body] of cases) {
            const res = await request(method, path, body);
            assert.equal(res.status, 403, `${method} ${path}`);
        }

        assert.equal(state.calls.length, 0);
    });

    it('allows channel-scoped secondary endpoints for channel members', async () => {
        const receipts = await request('GET', '/api/chat/channels/1/read-receipts');
        assert.equal(receipts.status, 200);
        assert.deepEqual(receipts.data, []);
        assert.deepEqual(state.calls, [['getReadReceipts', 1]]);
    });

    it('denies message-scoped actions when the message channel is not visible to the user', async () => {
        const reaction = await request('POST', '/api/chat/messages/501/reactions', { emoji: '👍' });
        const thread = await request('GET', '/api/chat/messages/501/thread');
        const bookmark = await request('POST', '/api/chat/bookmarks', { messageId: 501 });
        const remind = await request('POST', '/api/chat/messages/501/remind', {
            remindAt: new Date(Date.now() + 60_000).toISOString()
        });
        const important = await request('PATCH', '/api/chat/messages/501/important', { important: true }, 'admin');

        assert.equal(reaction.status, 403);
        assert.equal(thread.status, 403);
        assert.equal(bookmark.status, 403);
        assert.equal(remind.status, 403);
        assert.equal(important.status, 403);
        assert.equal(state.calls.some(call => call[0] === 'addReaction'), false);
    });

    it('allows message-scoped actions for members', async () => {
        const res = await request('POST', '/api/chat/messages/500/reactions', { emoji: '👍' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.data.reactions, [{ emoji: '👍', userId: 1 }]);
        assert.deepEqual(state.calls, [['addReaction', 500, 1, '👍']]);
    });

    it('denies poll, booking-channel, and room history access for non-members', async () => {
        const vote = await request('POST', '/api/chat/polls/8/vote', { optionIndex: 0 });
        const results = await request('GET', '/api/chat/polls/8/results');
        const booking = await request('GET', '/api/chat/booking-channel/BK-1');
        const room = await request('GET', '/api/chat/room-channels/blue/history');

        assert.equal(vote.status, 403);
        assert.equal(results.status, 403);
        assert.equal(booking.status, 403);
        assert.equal(room.status, 403);
        assert.equal(state.dbQueries.some(q => /FROM bookings WHERE line_id/i.test(q.text)), false);
    });
});
