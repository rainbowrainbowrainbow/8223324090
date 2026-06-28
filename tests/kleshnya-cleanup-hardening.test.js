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
        '../utils/logger',
        '../middleware/auth',
        '../services/bookingVisibility',
        '../services/timelineBusinessScope',
        '../services/kleshnya-greeting'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function createGate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

function resetState() {
    state = {
        rowCount: 0,
        queries: [],
        logs: [],
        failDelete: false,
        failDeleteOnce: false,
        blockDeleteOnce: null,
        deleteBlocked: false,
        onDeleteStarted: null
    };
}

function createQuery() {
    return async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        state.queries.push({ text, params });

        if (text === 'DELETE FROM kleshnya_messages WHERE expires_at < NOW()') {
            if (state.failDelete || state.failDeleteOnce) {
                state.failDeleteOnce = false;
                throw new Error('planned cleanup delete failure');
            }

            if (state.blockDeleteOnce && !state.deleteBlocked) {
                state.deleteBlocked = true;
                state.onDeleteStarted?.();
                await state.blockDeleteOnce.promise;
            }

            return { rows: [], rowCount: state.rowCount };
        }

        throw new Error(`Unexpected kleshnya cleanup query: ${text}`);
    };
}

function loadGreeting() {
    clearModules();
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
    installMock('../services/bookingVisibility', {
        getVisibleBookingScope: () => ({ sql: '' })
    });
    installMock('../services/timelineBusinessScope', {
        DEFAULT_TIMELINE_CONTEXT: 'park',
        normalizeTimelineContext: value => value || 'park',
        pushTimelineBusinessContext: () => 'TRUE'
    });
    return require('../services/kleshnya-greeting');
}

describe('Kleshnya greeting cleanup hardening', () => {
    beforeEach(resetState);

    afterEach(() => {
        clearModules();
    });

    it('returns a clean result when there are no expired rows', async () => {
        const { cleanupExpired } = loadGreeting();

        const result = await cleanupExpired();

        assert.deepEqual(result, { skipped: false, deleted: 0 });
        assert.deepEqual(state.queries, [{
            text: 'DELETE FROM kleshnya_messages WHERE expires_at < NOW()',
            params: []
        }]);
        assert.deepEqual(state.logs, []);
    });

    it('returns deleted count and logs when expired rows are removed', async () => {
        state.rowCount = 3;
        const { cleanupExpired } = loadGreeting();

        const result = await cleanupExpired();

        assert.deepEqual(result, { skipped: false, deleted: 3 });
        assert.equal(state.logs.length, 1);
        assert.equal(state.logs[0].level, 'info');
        assert.equal(state.logs[0].name, 'KleshnyaGreeting');
        assert.match(String(state.logs[0].args[0]), /Cleaned up 3 expired kleshnya messages/);
    });

    it('catches and reports cleanup query failures', async () => {
        state.failDelete = true;
        const { cleanupExpired } = loadGreeting();

        const result = await cleanupExpired();

        assert.deepEqual(result, {
            skipped: false,
            error: 'planned cleanup delete failure',
            deleted: 0
        });
        assert.equal(state.logs.length, 1);
        assert.equal(state.logs[0].level, 'error');
        assert.equal(state.logs[0].args[0], 'Error cleaning up expired messages');
        assert.equal(state.logs[0].args[1].message, 'planned cleanup delete failure');
    });

    it('skips overlapping cleanup runs inside one process', async () => {
        state.rowCount = 2;
        state.blockDeleteOnce = createGate();
        const deleteStarted = new Promise(resolve => { state.onDeleteStarted = resolve; });
        const { cleanupExpired } = loadGreeting();

        const firstRun = cleanupExpired();
        await deleteStarted;
        const secondRun = await cleanupExpired();
        state.blockDeleteOnce.release();
        const firstResult = await firstRun;

        assert.deepEqual(secondRun, { skipped: true, reason: 'overlap', deleted: 0 });
        assert.deepEqual(firstResult, { skipped: false, deleted: 2 });
        assert.equal(state.queries.length, 1);
    });

    it('resets the cleanup guard after a query failure', async () => {
        state.failDeleteOnce = true;
        const { cleanupExpired } = loadGreeting();

        const failed = await cleanupExpired();
        state.rowCount = 1;
        const recovered = await cleanupExpired();

        assert.deepEqual(failed, {
            skipped: false,
            error: 'planned cleanup delete failure',
            deleted: 0
        });
        assert.deepEqual(recovered, { skipped: false, deleted: 1 });
        assert.equal(state.queries.length, 2);
    });

    it('keeps the raw cleanup interval unchanged in server.js', () => {
        const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

        assert.match(
            serverSource,
            /setInterval\(cleanupKleshnyaMessages,\s*30\s*\*\s*60\s*\*\s*1000\)/
        );
    });
});
