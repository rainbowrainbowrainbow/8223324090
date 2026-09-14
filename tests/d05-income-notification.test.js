'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

function fixture() {
    const state = { calls: [], actions: [], owner: 'event_genix', type: 'income', failRead: false,
        registry: [{ access_mode: 'compatibility', business_status: 'active', organization_status: 'active' }] };
    const pool = { async query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        state.calls.push({ sql: text, params: Array.from(params) });
        if (/FROM finance_transactions/.test(text)) {
            if (state.failRead) throw new Error('PRIVATE_DRIVER_SENTINEL');
            return { rows: state.owner === undefined || (text.includes("type = 'income'") && state.type !== 'income')
                ? [] : [{ id: 41, business_context: state.owner }] };
        }
        if (/FROM businesses/.test(text)) return { rows: state.registry };
        if (/FROM rule_definitions/.test(text)) return { rows: [{ id: 7, code: 'fixture_income',
            conditions: {}, actions: [{ type: 'log', message: 'ACTION_SENTINEL' }] }] };
        if (/SELECT output FROM rule_execution_log/.test(text)) return { rows: [], rowCount: 0 };
        if (/UPDATE event_queue|INSERT INTO rule_execution_log/.test(text)) return { rows: [], rowCount: 1 };
        throw new Error('Unexpected fixture SQL');
    } };
    const filename = path.join(__dirname, '../services/eventBus.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    const log = { info(message) { if (String(message).includes('ACTION_SENTINEL')) state.actions.push(message); },
        warn() {}, error() {}, debug() {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
        require(id) {
            if (id === '../db') return { pool };
            if (id === '../utils/logger') return { createLogger: () => log };
            return realRequire(id);
        }, console, process, Buffer, Date, setImmediate, setTimeout, clearTimeout }, { filename });
    return { state, process: module.exports.processEventRules };
}

const payload = { transactionId: 41, businessContext: 'event_genix', amount: 100, description: 'Synthetic income' };
const event = value => ({ id: 9, event_type: 'finance.income', payload: value });
function denied(state, retryable = false) {
    assert.deepEqual(state.actions, []);
    assert.equal(state.calls.some(call => /FROM rule_definitions|rule_execution_log/.test(call.sql)), false);
    const update = state.calls.find(call => /UPDATE event_queue/.test(call.sql));
    assert.ok(update);
    assert.equal(update.params[0], retryable ? 'failed' : 'terminal_failed');
    assert.equal(update.params[2], retryable ? 'finance_notification_scope_unavailable' : 'finance_notifications_not_migrated');
    assert.equal(JSON.stringify(update.params).includes('PRIVATE_DRIVER_SENTINEL'), false);
}

test('unowned queued income is blocked before reading rules or executing actions, including repeated attempts', async () => {
    const { state, process } = fixture();
    for (let attempt = 0; attempt < 2; attempt++) {
        await process(event({ amount: 100, description: 'Synthetic income' }));
        denied(state);
    }
    assert.equal(state.calls.some(call => /FROM finance_transactions|FROM businesses/.test(call.sql)), false);
});

test('stored transaction and declared context must agree; aliases and unknown rows do not choose Park', async () => {
    for (const [owner, declared] of [[undefined, payload], [null, payload], ['dar', payload],
        ['event_genix', { ...payload, businessContext: '' }], ['event_genix', { ...payload, transactionId: '41x' }]]) {
        const { state, process } = fixture();
        state.owner = owner;
        await process(event(declared));
        denied(state);
    }
});

test('membership businesses and non-Park compatibility cannot dispatch to global income rules', async () => {
    for (const context of ['event_genix', 'dar', 'crm', 'maysternya_doli', 'custom_business']) {
        const { state, process } = fixture();
        state.owner = context;
        state.registry[0].access_mode = context === 'event_genix' ? 'membership' : 'compatibility';
        await process(event({ ...payload, businessContext: context }));
        denied(state);
    }
});

test('an expense transaction cannot authorize an income event even in pre-cutover Park', async () => {
    const { state, process } = fixture();
    state.type = 'expense';
    await process(event(payload));
    denied(state);
});

test('registry inactivity is rechecked on retry and read failures remain retryable without side effects', async () => {
    for (const change of [{ business_status: 'inactive' }, { organization_status: 'inactive' }, { organization_status: null }]) {
        const { state, process } = fixture();
        Object.assign(state.registry[0], change);
        await process(event(payload));
        denied(state);
    }
    const { state, process } = fixture();
    state.failRead = true;
    await process(event(payload));
    denied(state, true);
});

test('explicit pre-cutover Park keeps legacy rules; a replay after cutover is denied', async () => {
    const { state, process } = fixture();
    await process(event(JSON.stringify(payload)));
    assert.equal(state.actions.length, 1);
    state.actions.length = 0;
    state.calls.length = 0;
    state.registry[0].access_mode = 'membership';
    await process(event(payload));
    denied(state);
});

test('unrelated event behavior is not changed by income containment', async () => {
    const { state, process } = fixture();
    await process({ id: 10, event_type: 'fixture.unrelated', payload: {} });
    assert.equal(state.actions.length, 1);
    assert.equal(state.calls.some(call => /FROM finance_transactions|FROM businesses/.test(call.sql)), false);
});
