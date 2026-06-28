const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const originalEnv = { ...process.env };
const originalDateNow = Date.now;
let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/telegram',
        '../utils/logger'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function resetState() {
    state = {
        logs: [],
        dbQueries: [],
        sends: [],
        updates: []
    };
}

function loadTelegram() {
    clearModules();
    installMock('../db', {
        pool: {
            query: async (sql, params = []) => {
                state.dbQueries.push({ sql: String(sql), params });
                throw new Error('Unexpected real DB query in telegram retry queue test');
            }
        }
    });
    installMock('../utils/logger', {
        createLogger: name => ({
            debug: (...args) => state.logs.push({ level: 'debug', name, args }),
            info: (...args) => state.logs.push({ level: 'info', name, args }),
            warn: (...args) => state.logs.push({ level: 'warn', name, args }),
            error: (...args) => state.logs.push({ level: 'error', name, args })
        })
    });
    process.env.TELEGRAM_BOT_TOKEN = 'unit-secret-token';
    return require('../services/telegram');
}

function makeReadyItem(overrides = {}) {
    return {
        chatId: overrides.chatId || '12345',
        text: overrides.text || 'Retry message',
        bookingId: overrides.bookingId || 42,
        businessContext: overrides.businessContext || 'park',
        attempt: overrides.attempt || 0,
        nextRetry: overrides.nextRetry ?? 1000
    };
}

function createGate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

function allLoggedText() {
    return state.logs.flatMap(entry => entry.args.map(arg => {
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); } catch { return String(arg); }
    })).join('\n');
}

describe('Telegram retry queue runtime contract', () => {
    beforeEach(() => {
        process.env = { ...originalEnv };
        Date.now = originalDateNow;
        resetState();
    });

    afterEach(() => {
        Date.now = originalDateNow;
        process.env = { ...originalEnv };
        clearModules();
    });

    it('exits cleanly with an empty retry queue', async () => {
        const telegram = loadTelegram();
        telegram.__retryQueueTestHooks.reset();
        let sends = 0;
        let updates = 0;

        const summary = await telegram.processRetryQueue({
            now: 1000,
            sendTelegramMessage: async () => { sends++; },
            updateBookingMessageId: async () => { updates++; }
        });

        assert.deepEqual(summary, { skipped: false, processed: 0, succeeded: 0, failed: 0, dropped: 0 });
        assert.equal(sends, 0);
        assert.equal(updates, 0);
        assert.equal(state.dbQueries.length, 0);
        assert.deepEqual(telegram.__retryQueueTestHooks.getSnapshot(), []);
    });

    it('enqueues failed notifications with retry metadata without logging secrets', () => {
        const telegram = loadTelegram();
        telegram.__retryQueueTestHooks.reset();
        Date.now = () => 5000;

        telegram.__retryQueueTestHooks.enqueue('12345', 'Retry text', 77, 'park');

        const snapshot = telegram.__retryQueueTestHooks.getSnapshot();
        assert.equal(snapshot.length, 1);
        assert.equal(snapshot[0].chatId, '12345');
        assert.equal(snapshot[0].text, 'Retry text');
        assert.equal(snapshot[0].bookingId, 77);
        assert.equal(snapshot[0].attempt, 0);
        assert.equal(snapshot[0].nextRetry, 35000);
        assert.doesNotMatch(allLoggedText(), /unit-secret-token/);
    });

    it('removes a queued item and updates booking message id after retry success', async () => {
        const telegram = loadTelegram();
        telegram.__retryQueueTestHooks.reset([makeReadyItem({ bookingId: 77 })]);

        const summary = await telegram.processRetryQueue({
            now: 1000,
            sendTelegramMessage: async (chatId, text, options) => {
                state.sends.push({ chatId, text, options });
                return { ok: true, result: { message_id: 9001 } };
            },
            updateBookingMessageId: async (messageId, bookingId, businessContext) => {
                state.updates.push({ messageId, bookingId, businessContext });
            }
        });

        assert.deepEqual(summary, { skipped: false, processed: 1, succeeded: 1, failed: 0, dropped: 0 });
        assert.deepEqual(state.sends, [{ chatId: '12345', text: 'Retry message', options: { retries: 1 } }]);
        assert.equal(state.updates.length, 1);
        assert.equal(state.updates[0].messageId, 9001);
        assert.equal(state.updates[0].bookingId, 77);
        assert.deepEqual(telegram.__retryQueueTestHooks.getSnapshot(), []);
    });

    it('keeps a failed retry queued with incremented attempt and next backoff', async () => {
        const telegram = loadTelegram();
        telegram.__retryQueueTestHooks.reset([makeReadyItem({ attempt: 0, nextRetry: 1000 })]);

        const summary = await telegram.processRetryQueue({
            now: 1000,
            sendTelegramMessage: async () => ({ ok: false, description: 'temporary failure' }),
            updateBookingMessageId: async () => state.updates.push({ unexpected: true })
        });

        const snapshot = telegram.__retryQueueTestHooks.getSnapshot();
        assert.deepEqual(summary, { skipped: false, processed: 1, succeeded: 0, failed: 1, dropped: 0 });
        assert.equal(snapshot.length, 1);
        assert.equal(snapshot[0].attempt, 1);
        assert.equal(snapshot[0].nextRetry, 61000);
        assert.equal(state.updates.length, 0);
    });

    it('drops an item when the retry limit is exhausted', async () => {
        const telegram = loadTelegram();
        telegram.__retryQueueTestHooks.reset([makeReadyItem({ attempt: 2, nextRetry: 1000 })]);

        const summary = await telegram.processRetryQueue({
            now: 1000,
            sendTelegramMessage: async () => ({ ok: false, description: 'still failing' })
        });

        assert.deepEqual(summary, { skipped: false, processed: 1, succeeded: 0, failed: 1, dropped: 1 });
        assert.deepEqual(telegram.__retryQueueTestHooks.getSnapshot(), []);
    });

    it('does not send the same in-memory item twice during overlapping queue processors', async () => {
        const telegram = loadTelegram();
        telegram.__retryQueueTestHooks.reset([makeReadyItem({ nextRetry: 1000 })]);
        const gate = createGate();
        let firstSendStarted;
        const firstSendStartedPromise = new Promise(resolve => { firstSendStarted = resolve; });

        const first = telegram.processRetryQueue({
            now: 1000,
            sendTelegramMessage: async () => {
                state.sends.push({ call: state.sends.length + 1 });
                firstSendStarted();
                await gate.promise;
                return { ok: true, result: { message_id: 11 } };
            },
            updateBookingMessageId: async () => {}
        });
        await firstSendStartedPromise;

        const secondSummary = await telegram.processRetryQueue({
            now: 1000,
            sendTelegramMessage: async () => {
                state.sends.push({ call: 'duplicate' });
                return { ok: true };
            }
        });

        assert.deepEqual(secondSummary, { skipped: true, processed: 0, succeeded: 0, failed: 0, dropped: 0 });
        assert.deepEqual(state.sends, [{ call: 1 }]);

        gate.release();
        const firstSummary = await first;
        assert.deepEqual(firstSummary, { skipped: false, processed: 1, succeeded: 1, failed: 0, dropped: 0 });
        assert.deepEqual(telegram.__retryQueueTestHooks.getSnapshot(), []);
    });

    it('resets the overlap guard after an unexpected processor error', async () => {
        const telegram = loadTelegram();
        telegram.__retryQueueTestHooks.reset([makeReadyItem({ nextRetry: 1000 })]);
        Date.now = () => { throw new Error('clock failed'); };

        await assert.rejects(() => telegram.processRetryQueue(), /clock failed/);

        Date.now = originalDateNow;
        const summary = await telegram.processRetryQueue({
            now: 1000,
            sendTelegramMessage: async () => ({ ok: true, result: { message_id: 12 } }),
            updateBookingMessageId: async () => {}
        });

        assert.equal(summary.succeeded, 1);
        assert.deepEqual(telegram.__retryQueueTestHooks.getSnapshot(), []);
    });

    it('documents that telegramRetryQueue remains in-memory and non-durable across restarts', () => {
        const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SCHEDULER_SURFACE.md'), 'utf8');

        assert.match(doc, /`telegramRetryQueue`/);
        assert.match(doc, /in-memory/i);
        assert.match(doc, /restart/i);
        assert.match(doc, /multi-instance/i);
    });
});
