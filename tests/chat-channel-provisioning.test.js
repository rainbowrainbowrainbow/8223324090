const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'chat-channel-provisioning-secret';

let server;
let baseUrl;
let state;

const originalJwtSecret = process.env.JWT_SECRET;

function buildProvisioningSlug(prefix, value) {
    const raw = String(value || '').trim();
    const digest = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-+/g, '-') || digest;
    const maxBaseLength = Math.max(1, 50 - prefix.length - digest.length - 2);
    return `${prefix}-${normalized.slice(0, maxBaseLength)}-${digest}`;
}

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

function tokenFor(role = 'creator', userId = 1) {
    return jwt.sign(
        { id: userId, userId, username: `${role}-${userId}`, name: `${role} User`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function request(method, path, body, { role = 'creator', userId = 1 } = {}) {
    const headers = { Authorization: `Bearer ${tokenFor(role, userId)}` };
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

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function resetState() {
    state = {
        nextChannelId: 100,
        bookings: new Map([
            ['BK-1', { id: 'BK-1', date: '2026-05-11', program_name: 'Quest', label: 'Quest booking', line_id: 'blue' }],
            ['BK-2', { id: 'BK-2', date: '2026-05-12', program_name: 'Show', label: 'Show booking', line_id: 'red' }]
        ]),
        channels: [],
        memberships: new Set(),
        tx: [],
        queries: [],
        releases: 0
    };
}

function createFakePool() {
    function cloneChannel(channel) {
        return channel ? { ...channel } : null;
    }

    async function rootQuery(sql, params = []) {
        const text = normalizeSql(sql);
        state.queries.push({ text, params, root: true });

        if (/UPDATE employee_profiles SET last_activity_at/i.test(text) ||
            /UPDATE users SET last_seen_at/i.test(text)) {
            return { rows: [], rowCount: 0 };
        }

        if (/SELECT DISTINCT line_id FROM bookings/i.test(text)) {
            const seen = new Set();
            const rows = [];
            for (const booking of state.bookings.values()) {
                if (booking.line_id && !seen.has(booking.line_id)) {
                    seen.add(booking.line_id);
                    rows.push({ line_id: booking.line_id });
                }
            }
            rows.sort((a, b) => a.line_id.localeCompare(b.line_id));
            return { rows, rowCount: rows.length };
        }

        throw new Error(`Unexpected root query: ${text}`);
    }

    function makeClient() {
        const pendingMembers = new Set();

        return {
            query: async (sql, params = []) => {
                const text = normalizeSql(sql);
                state.queries.push({ text, params, root: false });

                if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                    state.tx.push(text);
                    if (text === 'COMMIT') {
                        for (const member of pendingMembers) state.memberships.add(member);
                    }
                    return { rows: [], rowCount: 0 };
                }

                if (/FROM chat_channels WHERE linked_booking_id = \$1/i.test(text)) {
                    const channel = state.channels.find(row =>
                        row.linked_booking_id === params[0] &&
                        row.is_archived !== true
                    );
                    return { rows: channel ? [cloneChannel(channel)] : [], rowCount: channel ? 1 : 0 };
                }

                if (/SELECT id, date, program_name, label FROM bookings WHERE id = \$1/i.test(text)) {
                    const booking = state.bookings.get(params[0]);
                    return { rows: booking ? [{ ...booking }] : [], rowCount: booking ? 1 : 0 };
                }

                if (/INSERT INTO chat_channels \(slug, name, description, type, linked_booking_id, created_by\)/i.test(text)) {
                    const [slug, name, description, bookingId, createdBy] = params;
                    let channel = state.channels.find(row => row.slug === slug);
                    const inserted = !channel;
                    if (!channel) {
                        channel = {
                            id: state.nextChannelId++,
                            slug,
                            name,
                            description,
                            type: 'booking',
                            linked_booking_id: bookingId,
                            created_by: createdBy,
                            is_archived: false
                        };
                        state.channels.push(channel);
                    } else {
                        channel.linked_booking_id ||= bookingId;
                        if (!channel.type || channel.type === 'general') channel.type = 'booking';
                    }
                    return { rows: [{ ...channel, inserted }], rowCount: 1 };
                }

                if (/FROM chat_channels WHERE line_id = \$1/i.test(text)) {
                    const channel = state.channels.find(row =>
                        row.line_id === params[0] &&
                        row.type === 'room' &&
                        row.is_archived !== true
                    );
                    return { rows: channel ? [cloneChannel(channel)] : [], rowCount: channel ? 1 : 0 };
                }

                if (/INSERT INTO chat_channels \(slug, name, type, line_id, description, created_by\)/i.test(text)) {
                    const [slug, name, lineId, description, createdBy] = params;
                    let channel = state.channels.find(row => row.slug === slug);
                    const inserted = !channel;
                    if (!channel) {
                        channel = {
                            id: state.nextChannelId++,
                            slug,
                            name,
                            description,
                            type: 'room',
                            line_id: lineId,
                            created_by: createdBy,
                            is_archived: false
                        };
                        state.channels.push(channel);
                    } else {
                        channel.line_id ||= lineId;
                        if (!channel.type || channel.type === 'general') channel.type = 'room';
                    }
                    return { rows: [{ ...channel, inserted }], rowCount: 1 };
                }

                if (/INSERT INTO chat_channel_members \(channel_id, user_id\)/i.test(text)) {
                    pendingMembers.add(`${params[0]}:${params[1]}`);
                    return { rows: [], rowCount: 1 };
                }

                throw new Error(`Unexpected tx query: ${text}`);
            },
            release: () => {
                state.releases += 1;
            }
        };
    }

    return {
        query: rootQuery,
        connect: async () => makeClient()
    };
}

function fakeChatService() {
    return {
        isMember: async (channelId, userId) => state.memberships.has(`${channelId}:${userId}`),
        ensureDefaultMemberships: async () => {},
        updateActivityStats: async () => {}
    };
}

describe('booking and room chat channel provisioning', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        resetState();
        clearModules();

        const pool = createFakePool();
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

    it('provisions one booking channel and reuses it on repeated attempts', async () => {
        const first = await request('POST', '/api/chat/booking-channel', { bookingId: 'BK-1' });
        const second = await request('POST', '/api/chat/booking-channel', { bookingId: 'BK-1' });

        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.equal(first.data.isNew, true);
        assert.equal(second.data.isNew, false);
        assert.equal(second.data.channel.id, first.data.channel.id);
        assert.equal(state.channels.filter(row => row.linked_booking_id === 'BK-1').length, 1);
        assert.equal(state.memberships.has(`${first.data.channel.id}:1`), true);
        assert.equal(state.queries.some(q => /ON CONFLICT \(slug\) DO UPDATE/i.test(q.text)), true);
    });

    it('uses deterministic slug conflict as the booking provisioning uniqueness fallback', async () => {
        const slug = buildProvisioningSlug('bk', 'BK-1');
        state.channels.push({
            id: 222,
            slug,
            name: 'Legacy shell',
            type: 'general',
            linked_booking_id: null,
            is_archived: false
        });

        const res = await request('POST', '/api/chat/booking-channel', { bookingId: 'BK-1' });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.channel.id, 222);
        assert.equal(res.data.isNew, false);
        assert.equal(state.channels.length, 1);
        assert.equal(state.channels[0].linked_booking_id, 'BK-1');
        assert.equal(state.channels[0].type, 'booking');
        assert.equal(state.memberships.has('222:1'), true);
    });

    it('provisions room channels once and initializes creator membership', async () => {
        const first = await request('POST', '/api/chat/room-channels/init');
        const second = await request('POST', '/api/chat/room-channels/init');

        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.equal(first.data.channels.length, 2);
        assert.deepEqual(first.data.channels.map(row => row.isNew), [true, true]);
        assert.deepEqual(second.data.channels.map(row => row.isNew), [false, false]);
        assert.equal(state.channels.filter(row => row.type === 'room').length, 2);
        for (const channel of state.channels.filter(row => row.type === 'room')) {
            assert.equal(state.memberships.has(`${channel.id}:1`), true);
        }
    });
});
