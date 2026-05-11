const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/scheduler',
        '../services/websocket',
        '../services/chatService',
        '../services/telegram',
        '../services/booking',
        '../services/backup',
        '../services/templates'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function resetState() {
    const due = new Date(Date.now() - 60 * 1000).toISOString();
    state = {
        messages: [
            { id: 1, channel_id: 10, user_id: 7, seq: 1, content: 'first scheduled', is_scheduled: true, scheduled_at: due, deleted_at: null },
            { id: 2, channel_id: 10, user_id: 7, seq: 2, content: 'second scheduled', is_scheduled: true, scheduled_at: due, deleted_at: null }
        ],
        tx: [],
        claimQueries: [],
        rootQueries: [],
        broadcasts: [],
        releases: 0,
        failClaim: false,
        failBroadcast: false
    };
}

function createFakePool() {
    async function rootQuery(sql, params = []) {
        const text = normalizeSql(sql);
        state.rootQueries.push({ text, params });

        if (/SELECT cm\.\*, u\.username, u\.name AS display_name FROM chat_messages cm JOIN users u ON u\.id = cm\.user_id WHERE cm\.id = \$1/i.test(text)) {
            const msg = state.messages.find(row => row.id === Number(params[0]));
            return {
                rows: msg ? [{ ...msg, username: 'scheduler-user', display_name: 'Scheduler User' }] : [],
                rowCount: msg ? 1 : 0
            };
        }

        throw new Error(`Unexpected root query: ${text}`);
    }

    async function txQuery(sql, params = []) {
        const text = normalizeSql(sql);
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
            state.tx.push(text);
            return { rows: [], rowCount: 0 };
        }

        if (/WITH due AS/i.test(text) && /FOR UPDATE SKIP LOCKED/i.test(text) && /UPDATE chat_messages cm SET is_scheduled = false/i.test(text)) {
            state.claimQueries.push({ text, params });
            if (state.failClaim) throw new Error('simulated claim failure');
            const [now, limit] = params;
            const rows = state.messages
                .filter(row => row.is_scheduled === true && row.scheduled_at <= now && row.deleted_at === null)
                .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id - b.id)
                .slice(0, limit)
                .map(row => {
                    row.is_scheduled = false;
                    return { ...row };
                });
            return { rows, rowCount: rows.length };
        }

        throw new Error(`Unexpected tx query: ${text}`);
    }

    return {
        query: rootQuery,
        connect: async () => ({
            query: txQuery,
            release: () => {
                state.releases += 1;
            }
        })
    };
}

function loadScheduler() {
    clearModules();
    installMock('../db', { pool: createFakePool() });
    installMock('../services/websocket', {
        broadcastToChannel: (channelId, eventType, payload) => {
            if (state.failBroadcast) throw new Error('simulated broadcast failure');
            state.broadcasts.push({ channelId, eventType, payload });
        }
    });
    installMock('../services/chatService', {
        mapMessageRow: row => ({
            id: row.id,
            channelId: row.channel_id,
            content: row.content,
            username: row.username
        })
    });
    installMock('../services/telegram', {
        sendTelegramMessage: async () => ({ ok: true }),
        getConfiguredChatId: async () => null,
        telegramRequest: async () => ({ ok: true }),
        scheduleAutoDelete: async () => {}
    });
    installMock('../services/booking', {
        ensureDefaultLines: async () => {},
        getKyivDate: () => new Date(),
        getKyivDateStr: () => '2026-05-11',
        getKyivTimeStr: () => '12:00',
        timeToMinutes: () => 0,
        minutesToTime: () => '00:00'
    });
    installMock('../services/backup', { sendBackupToTelegram: async () => ({ ok: true }) });
    installMock('../services/templates', { formatAfishaBlock: () => '' });
    return require('../services/scheduler');
}

describe('scheduled chat message dispatch atomic claim', () => {
    beforeEach(() => {
        resetState();
    });

    afterEach(() => {
        clearModules();
    });

    it('claims due scheduled messages with one SKIP LOCKED update before broadcasting', async () => {
        const scheduler = loadScheduler();

        await scheduler.checkScheduledChatMessages();

        assert.equal(state.claimQueries.length, 1);
        assert.match(state.claimQueries[0].text, /FOR UPDATE SKIP LOCKED/i);
        assert.match(state.claimQueries[0].text, /UPDATE chat_messages cm SET is_scheduled = false/i);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
        assert.equal(state.releases, 1);
        assert.equal(state.broadcasts.length, 2);
        assert.deepEqual(state.messages.map(row => row.is_scheduled), [false, false]);

        await scheduler.checkScheduledChatMessages();

        assert.equal(state.claimQueries.length, 2);
        assert.equal(state.broadcasts.length, 2);
    });

    it('rolls back claim failure so scheduled messages can be retried', async () => {
        state.failClaim = true;
        const scheduler = loadScheduler();

        await scheduler.checkScheduledChatMessages();

        assert.deepEqual(state.tx, ['BEGIN', 'ROLLBACK']);
        assert.equal(state.releases, 1);
        assert.equal(state.broadcasts.length, 0);
        assert.deepEqual(state.messages.map(row => row.is_scheduled), [true, true]);
    });

    it('does not retry already claimed messages after websocket broadcast failure', async () => {
        state.failBroadcast = true;
        const scheduler = loadScheduler();

        await scheduler.checkScheduledChatMessages();

        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT']);
        assert.equal(state.broadcasts.length, 0);
        assert.deepEqual(state.messages.map(row => row.is_scheduled), [false, false]);

        state.failBroadcast = false;
        await scheduler.checkScheduledChatMessages();

        assert.equal(state.claimQueries.length, 2);
        assert.equal(state.broadcasts.length, 0);
    });
});
