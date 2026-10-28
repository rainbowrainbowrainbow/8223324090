'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture({ aiEnabled = false } = {}) {
    const filename = path.join(__dirname, '..', 'services', 'guardian.js');
    const realRequire = createRequire(filename);
    const state = { member: true, revokeAfterFirstRead: false, accessReads: 0, actions: [],
        queries: [], broadcasts: [], notifications: [], providerCalls: 0, logs: [], nextId: 1 };
    const query = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        state.queries.push({ text, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text) || text.includes('pg_advisory_xact_lock')) {
            return { rows: [] };
        }
        if (text.includes('FROM chat_channels c JOIN businesses b')) {
            state.accessReads++;
            return { rows: state.member && !(state.revokeAfterFirstRead && state.accessReads > 1)
                ? [{ id: params[0] }] : [] };
        }
        if (text.includes('FROM guardian_business_actions') && text.includes('muted_until > NOW()')) {
            return { rows: state.actions.filter(action => action.channel_id === params[0]
                && action.user_id === params[1] && action.business_context === params[2]
                && new Date(action.muted_until).getTime() > Date.now()).map(action => ({ muted_until: action.muted_until })) };
        }
        if (text.includes('COUNT(*)::int AS count FROM guardian_business_actions')) {
            return { rows: [{ count: state.actions.filter(action =>
                action.business_context === params[0] && action.user_id === params[1]).length }] };
        }
        if (text.includes('FROM guardian_escalation_config')) {
            return { rows: [{ level: 1, threshold: 1, mute_duration_minutes: 1 },
                { level: 2, threshold: 2, mute_duration_minutes: 10 }] };
        }
        if (text.startsWith('INSERT INTO guardian_business_actions')) {
            const action = { id: state.nextId++, business_context: params[0], channel_id: params[1],
                user_id: params[2], action_type: 'block_precheck', reason: params[3], source: params[4],
                details: JSON.parse(params[5]), muted_until: params[6], created_at: new Date() };
            state.actions.push(action);
            return { rows: [{ id: action.id, muted_until: action.muted_until }] };
        }
        if (text.includes('SELECT DISTINCT bm.user_id FROM business_memberships bm')) {
            return { rows: [{ user_id: 91 }] };
        }
        if (text.includes('FROM guardian_business_actions a JOIN chat_channels c')) {
            return { rows: state.actions.filter(action => action.business_context === params[0]) };
        }
        return { rows: [] };
    };
    const pool = { query, async connect() { return { query, release() {} }; } };
    const mocks = {
        '../db': { pool },
        '../utils/logger': { createLogger: () => ({ info(...args) { state.logs.push(args); },
            warn() {}, error() {}, debug() {} }) },
        './websocket': {
            broadcastToChannel: async (...args) => { state.broadcasts.push(args); },
            sendToUser: async (...args) => { state.notifications.push(args); },
            broadcast: async () => {}
        },
        './ai-config': { hasAnySharedAIKey: () => aiEnabled, getAvailableProviders: () => ['fixture'],
            callUnifiedChatCompletion: async () => { state.providerCalls++; return { ok: true,
                text: '{"toxic":true,"reason":"Образа","words":["badword"]}' }; } },
        './guardianDmProvisioning': { provisionGuardianDirectorDm: async () => { throw new Error('Global DM must not run'); } },
        './guardianIdempotency': { claimGuardianMute: async () => { throw new Error('Global mute must not run'); } },
        './guardianDelivery': { GUARDIAN_DIRECTOR_DM_REQUESTED: 'legacy-dm',
            GUARDIAN_TELEGRAM_ALERT_REQUESTED: 'legacy-telegram', buildGuardianDeliveryIdempotencyKey: () => 'legacy' }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports,
        require(id) { return Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id); },
        process: { env: { NODE_ENV: 'test' } },
        fetch: async () => { state.providerCalls++; throw new Error('Global Telegram must not run'); },
        console, Buffer, Date, URL, setTimeout, clearTimeout,
        setInterval: () => ({ unref() {} }), clearInterval() {},
        __filename: filename, __dirname: path.dirname(filename)
    }, { filename });
    return { state, guardian: module.exports };
}

const request = { channelId: 7, businessContext: 'dar', userId: 42,
    username: 'scoped_member' };

test('business Guardian permits clean text and keeps global delivery untouched', async () => {
    const { state, guardian } = fixture();
    const result = await guardian.preCheckBusinessMessage({ ...request, content: 'Привіт, команда' });
    assert.equal(result.blocked, false);
    assert.equal(state.actions.length, 0);
    assert.equal(state.notifications.length, 0);
    assert.equal(state.providerCalls, 0);
});

test('business Guardian blocks sensitive content, stores only scoped audit and alerts business managers', async () => {
    const { state, guardian } = fixture();
    const result = await guardian.preCheckBusinessMessage({ ...request, content: '4111 1111 1111 1111' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result.blocked, true);
    assert.equal(state.actions.length, 1);
    assert.equal(state.actions[0].business_context, 'dar');
    assert.equal(state.actions[0].channel_id, 7);
    assert.equal(state.notifications.length, 1);
    assert.equal(state.notifications[0][0], '91');
    assert.equal(state.notifications[0][1], 'guardian:business-alert');
    assert.equal(state.notifications[0][2].businessContext, 'dar');
    assert.equal(state.broadcasts[0][1], 'chat:user-muted');
    assert.equal(state.queries.some(call => /INSERT INTO (?:guardian_actions|chat_mutes)|event_queue/.test(call.text)), false);
    assert.equal(state.providerCalls, 0);
    assert.equal((await guardian.getBusinessGuardianActions('dar')).length, 1);
    assert.equal((await guardian.getBusinessGuardianActions('event_genix')).length, 0);
    const muted = await guardian.preCheckBusinessMessage({ ...request, content: 'Наступне повідомлення' });
    assert.equal(muted.blocked, true);
    assert.equal(state.actions.length, 1);
});

test('business Guardian fails closed when membership is revoked before audit write', async () => {
    const { state, guardian } = fixture();
    state.revokeAfterFirstRead = true;
    await assert.rejects(guardian.preCheckBusinessMessage({ ...request, content: '4111 1111 1111 1111' }),
        /access revoked/);
    assert.equal(state.actions.length, 0);
    assert.equal(state.notifications.length, 0);
    assert.ok(state.queries.some(call => call.text === 'ROLLBACK'));
});

test('business Guardian keeps LLM profanity blocking without logging the message text', async () => {
    const { state, guardian } = fixture({ aiEnabled: true });
    const result = await guardian.preCheckBusinessMessage({ ...request, content: 'hello team' });
    assert.equal(result.blocked, true);
    assert.equal(state.actions[0].source, 'llm');
    assert.equal(state.providerCalls, 1);
    assert.equal(state.logs.some(args => args.some(value => String(value).includes('hello team'))), false);
});
