const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const https = require('node:https');

function installTelegramMock() {
    const originalRequest = https.request;
    const calls = [];
    let nextMessageId = 1000;

    https.request = (options, callback) => {
        const req = new EventEmitter();
        let rawBody = '';

        req.write = (chunk) => {
            rawBody += chunk;
        };

        req.end = () => {
            const method = String(options.path).split('/').pop();
            const body = rawBody ? JSON.parse(rawBody) : null;
            const response = {
                ok: true,
                result: method === 'sendMessage' ? { message_id: nextMessageId++ } : true
            };
            calls.push({ method, body, response });

            const res = new EventEmitter();
            process.nextTick(() => {
                callback(res);
                process.nextTick(() => {
                    res.emit('data', JSON.stringify(response));
                    res.emit('end');
                });
            });
        };

        req.destroy = (err) => {
            if (err) process.nextTick(() => req.emit('error', err));
        };

        return req;
    };

    return {
        calls,
        restore() {
            https.request = originalRequest;
        }
    };
}

function installDbMock() {
    const db = require('../db');
    const originalQuery = db.pool.query;
    const originalConnect = db.pool.connect;
    const state = {
        reportInserts: 0,
        clientQueries: []
    };

    db.pool.query = async () => ({ rows: [] });
    db.pool.connect = async () => ({
        async query(sql, params) {
            const text = String(sql);
            state.clientQueries.push({ sql: text, params });
            if (/INSERT INTO reports/i.test(text)) {
                state.reportInserts++;
                return { rows: [{ id: 9000 + state.reportInserts }] };
            }
            return { rows: [] };
        },
        release() {}
    });

    return {
        state,
        restore() {
            db.pool.query = originalQuery;
            db.pool.connect = originalConnect;
        }
    };
}

function loadReportBot() {
    process.env.REPORT_BOT_TOKEN = 'unit-test-report-token';
    delete require.cache[require.resolve('../services/report-bot')];
    return require('../services/report-bot');
}

function sendCalls(calls) {
    return calls.filter((call) => call.method === 'sendMessage');
}

function answerCalls(calls) {
    return calls.filter((call) => call.method === 'answerCallbackQuery');
}

function replyMarkupEdits(calls) {
    return calls.filter((call) => call.method === 'editMessageReplyMarkup');
}

function hasClearedKeyboard(calls, chatId, messageId) {
    return replyMarkupEdits(calls).some((call) =>
        call.body.chat_id === chatId
        && call.body.message_id === messageId
        && Array.isArray(call.body.reply_markup?.inline_keyboard)
        && call.body.reply_markup.inline_keyboard.length === 0
    );
}

describe('report bot inline single-choice callbacks', () => {
    let telegram;
    let dbMock;
    let reportBot;

    beforeEach(() => {
        telegram = installTelegramMock();
        dbMock = installDbMock();
        reportBot = loadReportBot();
    });

    afterEach(() => {
        telegram.restore();
        dbMock.restore();
        delete require.cache[require.resolve('../services/report-bot')];
    });

    it('removes type buttons after a valid choice and ignores another choice from the same message', async () => {
        const chatId = 901001;

        await reportBot.handleCommand(chatId, '/report', { from: {}, chat: { id: chatId } });
        const typeMessage = sendCalls(telegram.calls)[0];
        const typeMessageId = typeMessage.response.result.message_id;

        await reportBot.handleCallback({
            id: 'type-income',
            data: 'rtype:income',
            message: { message_id: typeMessageId, chat: { id: chatId } }
        });

        assert.ok(hasClearedKeyboard(telegram.calls, chatId, typeMessageId));

        const sendsAfterFirstChoice = sendCalls(telegram.calls).length;

        await reportBot.handleCallback({
            id: 'type-expense-stale',
            data: 'rtype:expense',
            message: { message_id: typeMessageId, chat: { id: chatId } }
        });

        assert.equal(sendCalls(telegram.calls).length, sendsAfterFirstChoice);
        assert.equal(answerCalls(telegram.calls).at(-1).body.callback_query_id, 'type-expense-stale');
        assert.ok(answerCalls(telegram.calls).at(-1).body.text);
    });

    it('saves a category once, clears its buttons, and ignores stale category callbacks', async () => {
        const chatId = 901002;

        await reportBot.handleCommand(chatId, '/report', { from: {}, chat: { id: chatId } });
        const typeMessageId = sendCalls(telegram.calls)[0].response.result.message_id;
        await reportBot.handleCallback({
            id: 'type-income',
            data: 'rtype:income',
            message: { message_id: typeMessageId, chat: { id: chatId } }
        });
        await reportBot.handleTextMessage(chatId, '1500', { chat: { id: chatId } });
        await reportBot.handleTextMessage(chatId, 'test description', { chat: { id: chatId } });

        const categoryMessage = sendCalls(telegram.calls).find((call) =>
            call.body.reply_markup?.inline_keyboard?.flat().some((button) => String(button.callback_data).startsWith('rcat:'))
        );
        assert.ok(categoryMessage, 'expected a category inline keyboard message');
        const categoryMessageId = categoryMessage.response.result.message_id;

        await reportBot.handleCallback({
            id: 'category-first',
            data: 'rcat:test-category',
            message: { message_id: categoryMessageId, chat: { id: chatId, first_name: 'Tester' } }
        });

        assert.equal(dbMock.state.reportInserts, 1);
        assert.ok(hasClearedKeyboard(telegram.calls, chatId, categoryMessageId));

        const sendsAfterSave = sendCalls(telegram.calls).length;

        await reportBot.handleCallback({
            id: 'category-stale',
            data: 'rcat:other-category',
            message: { message_id: categoryMessageId, chat: { id: chatId, first_name: 'Tester' } }
        });

        assert.equal(dbMock.state.reportInserts, 1);
        assert.equal(sendCalls(telegram.calls).length, sendsAfterSave);
        assert.equal(answerCalls(telegram.calls).at(-1).body.callback_query_id, 'category-stale');
        assert.ok(answerCalls(telegram.calls).at(-1).body.text);
    });
});
