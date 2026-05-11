const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'chat-poll-authz-secret';

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

function tokenFor(userId = 1, role = 'creator') {
    return jwt.sign(
        { id: userId, userId, username: `user-${userId}`, name: `User ${userId}`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function request(method, path, body, userId = 1) {
    const headers = { Authorization: `Bearer ${tokenFor(userId)}` };
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
        nextMessageId: 100,
        nextPollId: 200,
        memberships: new Set(['1:1']),
        broadcasts: [],
        messages: [],
        votes: [],
        tx: [],
        releases: 0,
        failPollInsert: false,
        failPollOptionsUpdate: false,
        polls: new Map([
            [8, {
                id: 8,
                channel_id: 1,
                message_id: 88,
                question: 'Lunch?',
                options: [{ text: 'A', votes: 0 }, { text: 'B', votes: 0 }],
                poll_type: 'single',
                is_anonymous: false,
                is_closed: false,
                expires_at: null,
                created_by: 1
            }],
            [9, {
                id: 9,
                channel_id: 99,
                message_id: 99,
                question: 'Private?',
                options: [{ text: 'A', votes: 0 }, { text: 'B', votes: 0 }],
                poll_type: 'single',
                is_anonymous: false,
                is_closed: false,
                expires_at: null,
                created_by: 2
            }]
        ])
    };
}

function pollOptionCounts(pollId) {
    const counts = new Map();
    for (const vote of state.votes.filter(v => v.pollId === Number(pollId))) {
        counts.set(vote.optionIndex, (counts.get(vote.optionIndex) || 0) + 1);
    }
    return Array.from(counts, ([optionIndex, count]) => ({
        option_index: optionIndex,
        cnt: String(count)
    }));
}

function fakePool() {
    function clonePoll(poll) {
        return poll ? { ...poll, options: JSON.parse(JSON.stringify(poll.options)) } : null;
    }

    function queryRunner(txState = null) {
        return async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();

            if (/UPDATE employee_profiles SET last_activity_at/i.test(text) ||
                /UPDATE users SET last_seen_at/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }

            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                state.tx.push(text);
                if (txState && text === 'COMMIT') {
                    state.messages.push(...txState.messages);
                    for (const poll of txState.polls) state.polls.set(poll.id, poll);
                    if (txState.votes) state.votes = txState.votes;
                    for (const [pollId, options] of txState.pollOptions) {
                        const poll = state.polls.get(pollId);
                        if (poll) poll.options = options;
                    }
                }
                return { rows: [], rowCount: 0 };
            }

            if (/SELECT \* FROM chat_polls WHERE id = \$1(?: FOR UPDATE)?$/i.test(text)) {
                const poll = clonePoll(state.polls.get(Number(params[0])));
                return { rows: poll ? [poll] : [], rowCount: poll ? 1 : 0 };
            }

            if (/INSERT INTO chat_messages \(channel_id, user_id, content, type\)/i.test(text)) {
                const row = {
                    id: state.nextMessageId++,
                    channel_id: Number(params[0]),
                    user_id: Number(params[1]),
                    content: params[2],
                    type: 'poll',
                    seq: 7,
                    created_at: '2026-05-11T12:00:00.000Z',
                    username: `user-${params[1]}`,
                    display_name: `User ${params[1]}`
                };
                if (txState) txState.messages.push(row);
                else state.messages.push(row);
                return { rows: [row], rowCount: 1 };
            }

            if (/INSERT INTO chat_polls \(channel_id, message_id, question, options, poll_type, is_anonymous, expires_at, created_by\)/i.test(text)) {
                if (state.failPollInsert) throw new Error('simulated poll insert failure');
                const poll = {
                    id: state.nextPollId++,
                    channel_id: Number(params[0]),
                    message_id: Number(params[1]),
                    question: params[2],
                    options: typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
                    poll_type: params[4],
                    is_anonymous: Boolean(params[5]),
                    expires_at: params[6],
                    created_by: Number(params[7])
                };
                if (txState) txState.polls.push(poll);
                else state.polls.set(poll.id, poll);
                return { rows: [poll], rowCount: 1 };
            }

            if (/DELETE FROM chat_poll_votes WHERE poll_id = \$1 AND user_id = \$2/i.test(text)) {
                const votes = txState ? (txState.votes ||= state.votes.map(v => ({ ...v }))) : state.votes;
                const filtered = votes.filter(v => !(v.pollId === Number(params[0]) && v.userId === Number(params[1])));
                if (txState) txState.votes = filtered;
                else state.votes = filtered;
                return { rows: [], rowCount: 1 };
            }

            if (/INSERT INTO chat_poll_votes \(poll_id, user_id, option_index\)/i.test(text)) {
                const vote = { pollId: Number(params[0]), userId: Number(params[1]), optionIndex: Number(params[2]) };
                const votes = txState ? (txState.votes ||= state.votes.map(v => ({ ...v }))) : state.votes;
                if (!votes.some(v => v.pollId === vote.pollId && v.userId === vote.userId && v.optionIndex === vote.optionIndex)) {
                    votes.push(vote);
                }
                return { rows: [], rowCount: 1 };
            }

            if (/SELECT option_index, COUNT\(\*\) AS cnt FROM chat_poll_votes WHERE poll_id = \$1 GROUP BY option_index/i.test(text)) {
                const votes = txState?.votes || state.votes;
                const counts = new Map();
                for (const vote of votes.filter(v => v.pollId === Number(params[0]))) {
                    counts.set(vote.optionIndex, (counts.get(vote.optionIndex) || 0) + 1);
                }
                const rows = Array.from(counts, ([optionIndex, count]) => ({ option_index: optionIndex, cnt: String(count) }));
                return { rows, rowCount: rows.length };
            }

            if (/UPDATE chat_polls SET options = \$1 WHERE id = \$2/i.test(text)) {
                if (state.failPollOptionsUpdate) throw new Error('simulated poll options update failure');
                const pollId = Number(params[1]);
                const poll = state.polls.get(pollId);
                const options = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
                if (txState && poll) txState.pollOptions.set(pollId, options);
                else if (poll) poll.options = options;
                return { rows: [], rowCount: poll ? 1 : 0 };
            }

            if (/UPDATE chat_polls SET is_closed = true WHERE id = \$1 AND created_by = \$2 RETURNING \*/i.test(text)) {
                const poll = state.polls.get(Number(params[0]));
                if (!poll || Number(poll.created_by) !== Number(params[1])) return { rows: [], rowCount: 0 };
                poll.is_closed = true;
                return { rows: [poll], rowCount: 1 };
            }

            if (/SELECT COUNT\(DISTINCT user_id\) AS total FROM chat_poll_votes WHERE poll_id = \$1/i.test(text)) {
                const voterIds = new Set(state.votes.filter(v => v.pollId === Number(params[0])).map(v => v.userId));
                return { rows: [{ total: String(voterIds.size) }], rowCount: 1 };
            }

            if (/FROM chat_poll_votes v JOIN users u/i.test(text)) {
                const rows = state.votes
                    .filter(v => v.pollId === Number(params[0]))
                    .map(v => ({ option_index: v.optionIndex, name: `User ${v.userId}`, user_id: v.userId }));
                return { rows, rowCount: rows.length };
            }

            throw new Error(`Unexpected chat poll test query: ${text}`);
        };
    }

    return {
        query: queryRunner(),
        connect: async () => {
            const txState = {
                messages: [],
                polls: [],
                votes: null,
                pollOptions: new Map()
            };
            return {
                query: queryRunner(txState),
                release: () => {
                    state.releases += 1;
                }
            };
        }
    };
}

function fakeChatService() {
    return {
        isMember: async (channelId, userId) => state.memberships.has(`${channelId}:${userId}`),
        ensureDefaultMemberships: async () => {},
        updateActivityStats: async () => {},
        mapMessageRow: row => ({
            id: row.id,
            channelId: row.channel_id,
            userId: row.user_id,
            seq: row.seq,
            content: row.content,
            contentType: row.content_type || 'text',
            createdAt: row.created_at,
            username: row.username,
            displayName: row.display_name || row.username
        })
    };
}

describe('chat poll authorization and broadcasts', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        resetState();
        clearModules();

        const pool = fakePool();
        installMock('../db', { pool, query: pool.query.bind(pool) });
        installMock('../services/chatService', fakeChatService());
        installMock('../services/websocket', {
            broadcastToChannel: (...args) => state.broadcasts.push(args),
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

    it('allows members to create polls and broadcasts a chat message with the correct contract', async () => {
        const res = await request('POST', '/api/chat/channels/1/poll', {
            question: 'Choose?',
            options: ['A', 'B']
        });

        assert.equal(res.status, 200);
        assert.equal(res.data.success, true);
        assert.equal(state.broadcasts.length, 1);

        const [channelId, eventType, payload, excludeUserId] = state.broadcasts[0];
        assert.equal(channelId, 1);
        assert.equal(eventType, 'chat:message');
        assert.equal(payload.channelId, 1);
        assert.equal(payload.message.channelId, 1);
        assert.equal(payload.message.poll.question, 'Choose?');
        assert.equal(excludeUserId, '1');
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
        assert.equal(state.messages.length, 1);
    });

    it('rolls back poll message creation when poll insert fails', async () => {
        state.failPollInsert = true;

        const res = await request('POST', '/api/chat/channels/1/poll', {
            question: 'Rollback?',
            options: ['A', 'B']
        });

        assert.equal(res.status, 500);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.messages.length, 0);
        assert.equal(state.polls.has(200), false);
        assert.deepEqual(state.broadcasts, []);
        assert.equal(state.releases, 1);
    });

    it('denies non-members before creating poll rows or broadcasts', async () => {
        const res = await request('POST', '/api/chat/channels/99/poll', {
            question: 'Private?',
            options: ['A', 'B']
        });

        assert.equal(res.status, 403);
        assert.equal(state.nextMessageId, 100);
        assert.deepEqual(state.broadcasts, []);
    });

    it('allows members to vote and broadcasts poll updates with the correct contract', async () => {
        const res = await request('POST', '/api/chat/polls/8/vote', { optionIndex: 1 });

        assert.equal(res.status, 200);
        assert.equal(res.data.success, true);
        assert.equal(res.data.options[1].votes, 1);
        assert.equal(state.broadcasts.length, 1);

        const [channelId, eventType, payload] = state.broadcasts[0];
        assert.equal(channelId, 1);
        assert.equal(eventType, 'chat:poll-update');
        assert.equal(payload.channelId, 1);
        assert.equal(payload.pollId, 8);
        assert.equal(payload.options[1].votes, 1);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
        assert.equal(state.releases, 1);
    });

    it('replaces a single-choice vote atomically and recounts from committed votes', async () => {
        state.votes.push({ pollId: 8, userId: 1, optionIndex: 0 });
        state.polls.get(8).options = [{ text: 'A', votes: 1 }, { text: 'B', votes: 0 }];

        const res = await request('POST', '/api/chat/polls/8/vote', { optionIndex: 1 });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.deepEqual(state.votes, [{ pollId: 8, userId: 1, optionIndex: 1 }]);
        assert.deepEqual(state.polls.get(8).options, [{ text: 'A', votes: 0 }, { text: 'B', votes: 1 }]);
        assert.deepEqual(res.data.options, [{ text: 'A', votes: 0 }, { text: 'B', votes: 1 }]);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
        assert.equal(state.broadcasts.length, 1);
    });

    it('rolls back vote replacement if recount update fails', async () => {
        state.votes.push({ pollId: 8, userId: 1, optionIndex: 0 });
        state.polls.get(8).options = [{ text: 'A', votes: 1 }, { text: 'B', votes: 0 }];
        state.failPollOptionsUpdate = true;

        const res = await request('POST', '/api/chat/polls/8/vote', { optionIndex: 1 });

        assert.equal(res.status, 500);
        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.deepEqual(state.votes, [{ pollId: 8, userId: 1, optionIndex: 0 }]);
        assert.deepEqual(state.polls.get(8).options, [{ text: 'A', votes: 1 }, { text: 'B', votes: 0 }]);
        assert.deepEqual(state.broadcasts, []);
        assert.equal(state.releases, 1);
    });

    it('denies non-members from voting or viewing results', async () => {
        const vote = await request('POST', '/api/chat/polls/9/vote', { optionIndex: 0 });
        const results = await request('GET', '/api/chat/polls/9/results');

        assert.equal(vote.status, 403);
        assert.equal(results.status, 403);
        assert.deepEqual(state.votes, []);
        assert.deepEqual(state.broadcasts, []);
    });

    it('allows members to view non-anonymous poll results only inside their channel', async () => {
        state.votes.push({ pollId: 8, userId: 1, optionIndex: 0 });
        const res = await request('GET', '/api/chat/polls/8/results');

        assert.equal(res.status, 200);
        assert.equal(res.data.totalVoters, 1);
        assert.deepEqual(res.data.voters, [{ option_index: 0, name: 'User 1', user_id: 1 }]);
    });

    it('broadcasts poll close events with the correct contract for the poll owner', async () => {
        const res = await request('POST', '/api/chat/polls/8/close');

        assert.equal(res.status, 200);
        assert.equal(res.data.poll.is_closed, true);
        assert.equal(state.broadcasts.length, 1);

        const [channelId, eventType, payload] = state.broadcasts[0];
        assert.equal(channelId, 1);
        assert.equal(eventType, 'chat:poll-closed');
        assert.deepEqual(payload, { channelId: 1, pollId: 8 });
    });
});
