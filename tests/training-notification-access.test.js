'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

async function withTraining(options, run) {
    const paths = ['../services/training', '../db', '../services/telegram'];
    const saved = new Map(paths.map(path => [require.resolve(path), require.cache[require.resolve(path)]]));
    const sent = []; const queries = []; const writes = [];
    const row = { user_id: 11, platform_role: 'hr', organization_id: 1, business_id: 2,
        context_key: 'event_genix', access_mode: 'membership', role: 'hr',
        business_modules: ['training'], ...options.member };
    const pool = { async query(sql, params) {
        queries.push(sql);
        if (sql.startsWith('SELECT b.id AS business_id')) return { rows: [row] };
        if (sql.includes('FROM users u') && sql.includes('JOIN business_memberships')) return { rows: options.revoked ? [] : [row] };
        if (sql.includes('SELECT id FROM users WHERE telegram_chat_id')) return { rows: [{ id: 11 }] };
        if (sql.includes('JOIN employee_profiles profile')) return { rows: [{ id: 71, name: 'Synthetic recipient', user_id: 11, telegram_id: 'SYNTHETIC' }] };
        if (sql.includes('FROM training_prompts_sent')) return { rows: options.prompt ? [{ id: 9 }] : [] };
        if (sql.includes('INSERT INTO training_prompts_sent')) { writes.push(sql); return { rows: [] }; }
        throw new Error('Unexpected Training test query');
    } };
    const install = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    try {
        install('../db', { pool });
        install('../services/telegram', { sendTelegramMessage: async (...args) => { sent.push(args); } });
        delete require.cache[require.resolve('../services/training')];
        await run({ training: require('../services/training'), queries, sent, writes });
    } finally {
        for (const [id, cached] of saved) { if (cached) require.cache[id] = cached; else delete require.cache[id]; }
    }
}

test('weekly prompts send only to currently eligible Park members with an active staff bridge', async () => {
    await withTraining({}, async ({ training, sent, writes }) => {
        assert.equal(await training.sendWeeklyTrainingPrompts(), 1);
        assert.equal(sent.length, 1);
        assert.equal(writes.length, 1);
    });
    for (const options of [{ revoked: true }, { member: { page_denylist: ['/training'] } }, { member: { business_modules: [] } }]) {
        await withTraining(options, async ({ training, sent, writes }) => {
            assert.equal(await training.sendWeeklyTrainingPrompts(), 0);
            assert.equal(sent.length, 0);
            assert.equal(writes.length, 0);
        });
    }
});

test('weekly summary requires the current recipient management capability before selecting private inputs', async () => {
    for (const options of [{ revoked: true }, { member: { role: 'waiter' } },
        { member: { action_denylist: ['training.manage'] } }, { member: { page_denylist: ['/training'] } }]) {
        await withTraining(options, async ({ training, queries, sent }) => {
            await training.sendWeeklySummaryToDirector();
            assert.equal(sent.length, 0);
            assert.equal(queries.some(sql => sql.includes('FROM staff_training_inputs')), false);
        });
    }
});

test('Telegram responses cannot restore access after module, page or membership revocation', async () => {
    for (const options of [{ revoked: true }, { member: { business_modules: [] } }, { member: { page_denylist: ['/training'] } }]) {
        await withTraining({ ...options, prompt: true }, async ({ training, queries, writes }) => {
            assert.equal(await training.handleTrainingResponse('SYNTHETIC', 'Synthetic input'), false);
            assert.equal(writes.length, 0);
            assert.equal(queries.some(sql => sql.includes('FROM training_prompts_sent')), false);
        });
    }
});
