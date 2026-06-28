const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/telegram',
        '../services/kleshnya-bridge',
        '../utils/logger'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function createGate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

function makeStale(overrides = {}) {
    return {
        id: overrides.id ?? 1,
        session_id: overrides.session_id || `session-${overrides.id ?? 1}`,
        username: overrides.username || `user-${overrides.id ?? 1}`,
        message: overrides.message || `Question ${overrides.id ?? 1}`,
        is_generating: overrides.is_generating !== false
    };
}

function resetState() {
    state = {
        staleRows: [],
        queries: [],
        clears: [],
        histories: [],
        generated: [],
        saved: [],
        sessionUpdates: [],
        sends: [],
        logs: [],
        failSelect: false,
        failGenerateIds: new Set(),
        blockSelectOnce: null,
        onSelectStarted: null,
        selectBlocked: false
    };
}

function createQuery() {
    return async (sql, params = []) => {
        const text = compact(sql);
        state.queries.push({ text, params });

        if (/^SELECT kc\.id, kc\.session_id, kc\.username, kc\.message FROM kleshnya_chat kc/i.test(text)) {
            if (state.failSelect) throw new Error('planned stale select failure');
            if (state.blockSelectOnce && !state.selectBlocked) {
                state.selectBlocked = true;
                state.onSelectStarted?.();
                await state.blockSelectOnce.promise;
            }
            const rows = state.staleRows
                .filter(row => row.is_generating !== false)
                .map(row => ({ ...row }));
            return { rows, rowCount: rows.length };
        }

        if (/^UPDATE kleshnya_chat SET is_generating = FALSE WHERE id = \$1/i.test(text)) {
            const [id] = params;
            state.clears.push(id);
            const row = state.staleRows.find(item => item.id === id);
            if (row) row.is_generating = false;
            return { rows: [], rowCount: row ? 1 : 0 };
        }

        if (/^UPDATE chat_sessions SET message_count = message_count \+ 1,/i.test(text)) {
            const [lastMessage, sessionId] = params;
            state.sessionUpdates.push({ lastMessage, sessionId });
            return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected kleshnya bridge query: ${text}`);
    };
}

function createDeps() {
    return {
        generateFn: async (message, username, history) => {
            const source = state.staleRows.find(row => row.message === message && row.username === username);
            state.generated.push({ message, username, history });
            if (source && state.failGenerateIds.has(source.id)) {
                throw new Error(`planned generate failure ${source.id}`);
            }
            return {
                message: `Reply to ${message}`,
                skill_used: 'local_skill',
                source: 'skills'
            };
        },
        addMessageFn: async (username, role, message, sessionId, skillUsed) => {
            const saved = {
                id: `assistant-${state.saved.length + 1}`,
                username,
                role,
                message,
                sessionId,
                skillUsed,
                created_at: `2026-06-28T10:00:0${state.saved.length}.000Z`
            };
            state.saved.push(saved);
            return { id: saved.id, created_at: saved.created_at };
        },
        getChatHistoryFn: async (username, limit, sessionId) => {
            const history = [{ role: 'user', message: `history for ${username}` }];
            state.histories.push({ username, limit, sessionId });
            return history;
        },
        sendWsFn: (username, eventType, payload) => {
            state.sends.push({ username, eventType, payload });
        }
    };
}

function loadBridge() {
    clearModules();
    installMock('../services/telegram', {
        telegramRequest: async () => {
            throw new Error('Unexpected Telegram access in OpenClaw stale fallback test');
        },
        TELEGRAM_BOT_TOKEN: null
    });
    installMock('../db', {
        pool: { query: createQuery() }
    });
    installMock('../utils/logger', {
        createLogger: name => ({
            info: (...args) => state.logs.push({ level: 'info', name, args }),
            warn: (...args) => state.logs.push({ level: 'warn', name, args }),
            error: (...args) => state.logs.push({ level: 'error', name, args })
        })
    });
    return require('../services/kleshnya-bridge');
}

describe('OpenClaw stale message fallback hardening', () => {
    beforeEach(resetState);

    afterEach(() => {
        clearModules();
    });

    it('returns a clean result when there are no stale rows', async () => {
        const { processStaleMessages } = loadBridge();
        const deps = createDeps();

        const result = await processStaleMessages(
            deps.generateFn,
            deps.addMessageFn,
            deps.getChatHistoryFn,
            deps.sendWsFn
        );

        assert.deepEqual(result, { skipped: false, checked: 0, replied: 0, failed: 0 });
        assert.equal(state.queries.length, 1);
        assert.deepEqual(state.clears, []);
        assert.deepEqual(state.sends, []);
    });

    it('processes one stale message and preserves the kleshnya reply contract', async () => {
        state.staleRows.push(makeStale({ id: 11, session_id: 's-11', username: 'alice', message: 'Need help' }));
        const { processStaleMessages } = loadBridge();
        const deps = createDeps();

        const result = await processStaleMessages(
            deps.generateFn,
            deps.addMessageFn,
            deps.getChatHistoryFn,
            deps.sendWsFn
        );

        assert.deepEqual(result, { skipped: false, checked: 1, replied: 1, failed: 0 });
        assert.deepEqual(state.clears, [11]);
        assert.deepEqual(state.histories, [{ username: 'alice', limit: 20, sessionId: 's-11' }]);
        assert.equal(state.generated.length, 1);
        assert.deepEqual(state.saved.map(row => ({
            username: row.username,
            role: row.role,
            message: row.message,
            sessionId: row.sessionId,
            skillUsed: row.skillUsed
        })), [{
            username: 'alice',
            role: 'assistant',
            message: 'Reply to Need help',
            sessionId: 's-11',
            skillUsed: 'local_skill'
        }]);
        assert.deepEqual(state.sessionUpdates, [{ lastMessage: 'Reply to Need help', sessionId: 's-11' }]);
        assert.equal(state.sends.length, 1);
        assert.equal(state.sends[0].username, 'alice');
        assert.equal(state.sends[0].eventType, 'kleshnya:reply');
        assert.deepEqual(state.sends[0].payload, {
            id: 'assistant-1',
            role: 'assistant',
            message: 'Reply to Need help',
            created_at: '2026-06-28T10:00:00.000Z',
            source: 'skills',
            session_id: 's-11'
        });
    });

    it('processes multiple stale messages in query order', async () => {
        state.staleRows.push(
            makeStale({ id: 21, session_id: 's-21', username: 'first', message: 'First' }),
            makeStale({ id: 22, session_id: 's-22', username: 'second', message: 'Second' })
        );
        const { processStaleMessages } = loadBridge();
        const deps = createDeps();

        const result = await processStaleMessages(
            deps.generateFn,
            deps.addMessageFn,
            deps.getChatHistoryFn,
            deps.sendWsFn
        );

        assert.deepEqual(result, { skipped: false, checked: 2, replied: 2, failed: 0 });
        assert.deepEqual(state.clears, [21, 22]);
        assert.deepEqual(state.generated.map(item => item.message), ['First', 'Second']);
        assert.deepEqual(state.sends.map(item => item.payload.session_id), ['s-21', 's-22']);
    });

    it('clears the stale flag and sends no reply when generation fails', async () => {
        state.staleRows.push(makeStale({ id: 31, session_id: 's-31', username: 'broken', message: 'Break' }));
        state.failGenerateIds.add(31);
        const { processStaleMessages } = loadBridge();
        const deps = createDeps();

        const result = await processStaleMessages(
            deps.generateFn,
            deps.addMessageFn,
            deps.getChatHistoryFn,
            deps.sendWsFn
        );

        assert.deepEqual(result, { skipped: false, checked: 1, replied: 0, failed: 1 });
        assert.deepEqual(state.clears, [31, 31]);
        assert.equal(state.saved.length, 0);
        assert.equal(state.sessionUpdates.length, 0);
        assert.equal(state.sends.length, 0);
        assert.ok(state.logs.some(entry => entry.level === 'error' && String(entry.args[0]).includes('Fallback: error processing msg 31')));
    });

    it('returns an error result and resets the guard after top-level DB select failure', async () => {
        state.failSelect = true;
        const { processStaleMessages } = loadBridge();
        const deps = createDeps();

        const failed = await processStaleMessages(
            deps.generateFn,
            deps.addMessageFn,
            deps.getChatHistoryFn,
            deps.sendWsFn
        );

        assert.deepEqual(failed, {
            skipped: false,
            error: 'planned stale select failure',
            checked: 0,
            replied: 0,
            failed: 0
        });
        assert.ok(state.logs.some(entry => entry.level === 'error' && String(entry.args[0]).includes('Fallback scheduler error')));

        state.failSelect = false;
        state.staleRows.push(makeStale({ id: 41, session_id: 's-41', username: 'after-error', message: 'Recovered' }));
        const recovered = await processStaleMessages(
            deps.generateFn,
            deps.addMessageFn,
            deps.getChatHistoryFn,
            deps.sendWsFn
        );

        assert.equal(recovered.skipped, false);
        assert.equal(recovered.replied, 1);
    });

    it('skips overlapping stale fallback runs inside one process', async () => {
        state.staleRows.push(makeStale({ id: 51, session_id: 's-51', username: 'overlap', message: 'Slow' }));
        const gate = createGate();
        let selectStarted;
        const selectStartedPromise = new Promise(resolve => { selectStarted = resolve; });
        state.blockSelectOnce = gate;
        state.onSelectStarted = selectStarted;
        const { processStaleMessages } = loadBridge();
        const deps = createDeps();

        const first = processStaleMessages(
            deps.generateFn,
            deps.addMessageFn,
            deps.getChatHistoryFn,
            deps.sendWsFn
        );
        await selectStartedPromise;

        const second = await processStaleMessages(
            deps.generateFn,
            deps.addMessageFn,
            deps.getChatHistoryFn,
            deps.sendWsFn
        );

        assert.deepEqual(second, { skipped: true, reason: 'overlap', checked: 0, replied: 0, failed: 0 });
        gate.release();
        assert.deepEqual(await first, { skipped: false, checked: 1, replied: 1, failed: 0 });
        assert.equal(state.sends.length, 1);
    });

    it('keeps the OpenClaw bridge raw interval contract unchanged in server.js', () => {
        const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

        assert.match(server, /if \(OPENCLAW_BRIDGE\)/);
        assert.match(server, /processStaleMessages\(generateChatResponse, addChatMessage, getChatHistory, sendToUsername\)/);
        assert.match(server, /30000/);
    });
});
