const test = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../db');

test('old printed Telegram QR reports status and CRM link without redeeming or exposing recipient data', async () => {
    const telegramPath = require.resolve('../services/telegram');
    const botPath = require.resolve('../services/bot');
    const originalTelegram = require.cache[telegramPath];
    const originalBot = require.cache[botPath];
    const originalQuery = pool.query;
    const originalBaseUrl = process.env.PUBLIC_BASE_URL;
    const calls = [];
    let dbQueries = 0;

    try {
        require.cache[telegramPath] = {
            id: telegramPath, filename: telegramPath, loaded: true,
            exports: {
                telegramRequest: async (method, body) => { calls.push({ method, body }); return { ok: true }; },
                sendTelegramMessage: async () => { throw new Error('Unexpected Telegram send'); }
            }
        };
        delete require.cache[botPath];
        pool.query = async (sql, params) => {
            dbQueries += 1;
            assert.match(sql, /^SELECT cert_code, status, valid_until FROM certificates/);
            assert.deepEqual(params, ['CERT-2026-00001']);
            return { rows: [{ cert_code: 'CERT-2026-00001', status: 'active', valid_until: '2099-01-01' }] };
        };
        process.env.PUBLIC_BASE_URL = 'https://crm.example.test';

        const { handleBotCommand } = require('../services/bot');
        await handleBotCommand(123, null, '/start cert_CERT-2026-00001', 'tester');

        assert.equal(dbQueries, 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].method, 'sendMessage');
        assert.match(calls[0].body.text, /Активний/);
        assert.match(calls[0].body.text, /https:\/\/crm\.example\.test\/certificates\/check\?code=CERT-2026-00001/);
        assert.equal(calls[0].body.reply_markup, undefined);
        assert.doesNotMatch(calls[0].body.text, /👤|Використати сертифікат/);
    } finally {
        pool.query = originalQuery;
        if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
        else process.env.PUBLIC_BASE_URL = originalBaseUrl;
        if (originalTelegram) require.cache[telegramPath] = originalTelegram;
        else delete require.cache[telegramPath];
        if (originalBot) require.cache[botPath] = originalBot;
        else delete require.cache[botPath];
    }
});
