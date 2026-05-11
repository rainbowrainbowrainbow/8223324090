const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function installTelegramModuleMock() {
    const telegramPath = require.resolve('../services/telegram');
    const originalCacheEntry = require.cache[telegramPath];
    const calls = [];

    require.cache[telegramPath] = {
        id: telegramPath,
        filename: telegramPath,
        loaded: true,
        children: [],
        paths: module.paths,
        exports: {
            telegramRequest: async (method, body) => {
                calls.push({ method, body });
                return { ok: true, result: true };
            },
            getConfiguredChatId: async () => null,
            sendTelegramMessage: async (chatId, text, options) => {
                calls.push({ method: 'sendTelegramMessage', body: { chatId, text, options } });
                return { ok: true };
            }
        }
    };

    return {
        calls,
        restore() {
            if (originalCacheEntry) {
                require.cache[telegramPath] = originalCacheEntry;
            } else {
                delete require.cache[telegramPath];
            }
        }
    };
}

function installDbMock() {
    const db = require('../db');
    const originalQuery = db.pool.query;
    const state = {
        notificationUpdates: 0,
        contractorLookups: 0,
        historyInserts: 0
    };

    db.pool.query = async (sql) => {
        const text = String(sql);
        if (/UPDATE contractor_notifications/i.test(text)) {
            state.notificationUpdates++;
            const updated = state.notificationUpdates === 1;
            return { rowCount: updated ? 1 : 0, rows: updated ? [{ id: 1 }] : [] };
        }
        if (/SELECT name FROM contractors/i.test(text)) {
            state.contractorLookups++;
            return { rows: [{ name: 'Test Contractor' }] };
        }
        if (/INSERT INTO history/i.test(text)) {
            state.historyInserts++;
            return { rows: [] };
        }
        return { rows: [] };
    };

    return {
        state,
        restore() {
            db.pool.query = originalQuery;
        }
    };
}

function loadBookingAutomation() {
    delete require.cache[require.resolve('../services/bookingAutomation')];
    return require('../services/bookingAutomation');
}

function answerCalls(calls) {
    return calls.filter((call) => call.method === 'answerCallbackQuery');
}

function replyMarkupEdits(calls) {
    return calls.filter((call) => call.method === 'editMessageReplyMarkup');
}

describe('contractor inline callbacks', () => {
    let telegram;
    let dbMock;
    let bookingAutomation;

    beforeEach(() => {
        telegram = installTelegramModuleMock();
        dbMock = installDbMock();
        bookingAutomation = loadBookingAutomation();
    });

    afterEach(() => {
        delete require.cache[require.resolve('../services/bookingAutomation')];
        telegram.restore();
        dbMock.restore();
    });

    it('processes contractor response once and removes accept/reject buttons', async () => {
        const chatId = 7001;
        const messageId = 8001;

        await bookingAutomation.handleContractorCallback('ctr_accept', 'booking-1', 42, 'cb-first', chatId, messageId);

        assert.equal(dbMock.state.historyInserts, 1);
        assert.equal(dbMock.state.contractorLookups, 1);
        assert.ok(replyMarkupEdits(telegram.calls).some((call) =>
            call.body.chat_id === chatId
            && call.body.message_id === messageId
            && Array.isArray(call.body.reply_markup?.inline_keyboard)
            && call.body.reply_markup.inline_keyboard.length === 0
        ));

        await bookingAutomation.handleContractorCallback('ctr_reject', 'booking-1', 42, 'cb-stale', chatId, messageId);

        assert.equal(dbMock.state.historyInserts, 1);
        assert.equal(dbMock.state.contractorLookups, 1);
        assert.equal(answerCalls(telegram.calls).at(-1).body.callback_query_id, 'cb-stale');
        assert.ok(answerCalls(telegram.calls).at(-1).body.text);
    });
});
