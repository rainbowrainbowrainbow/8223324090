'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const express = require('express');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { resolveBusinessScope } = require('../services/businessContext');

function principal(context = 'dar', membership = true) {
    const user = { id: 1, username: 'finance_fixture', role: 'creator', business_contexts: [context], default_business_context: context };
    if (!membership) return user;
    return applyMembershipAccess(user, buildMembershipAccess(user, [{ organization_id: 1, business_id: 2,
        context_key: context, access_mode: 'membership', role: 'director', is_default: true }], context));
}

function fixture() {
    const state = { accounts: [], transactions: [], insertedContexts: [], events: [], queries: [], qaCertificateIds: new Set() };
    const pool = { async query(sql, params = []) {
        state.queries.push({ sql, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
        if (/FROM trusted_qa_run_entities/.test(sql)) {
            const found = state.qaCertificateIds.has(String(params[0]));
            return { rows: found ? [{ exists: 1 }] : [], rowCount: found ? 1 : 0 };
        }
        if (/INSERT INTO finance_accounts/.test(sql)) {
            const columns = sql.match(/finance_accounts\s*\(([^)]+)\)/)[1].split(',').map(value => value.trim());
            const contextIndex = columns.indexOf('business_context');
            const context = contextIndex < 0 ? 'event_genix' : params[contextIndex];
            state.insertedContexts.push(context);
            const row = { id: 21, name: params[0], business_context: context };
            state.accounts.push(row);
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/UPDATE finance_accounts SET business_context/.test(sql)) {
            const row = state.accounts.find(item => item.id === params[1]);
            row.business_context = params[0];
            return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/FROM bookings/.test(sql)) {
            const row = [{ id: 'park_booking', business_context: 'event_genix' }, { id: 'dar_booking', business_context: 'dar' }]
                .find(item => item.id === params[0] && item.business_context === params[1]);
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (/INSERT INTO finance_transactions/.test(sql)) {
            const row = { id: 41, business_context: params[0], type: params[1], amount: params[3],
                booking_id: params[7], staff_id: params[8], certificate_id: params[9] };
            state.transactions.push(row);
            return { rows: [row], rowCount: 1 };
        }
        throw new Error('Unexpected finance fixture query: ' + sql);
    } };
    pool.connect = async () => ({ query: (...args) => pool.query(...args), release() {} });
    return { state, pool };
}

async function withRoute(user, run) {
    const { state, pool } = fixture();
    const filename = path.join(__dirname, '../routes/finance.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
        require(id) {
            if (id === '../db') return { pool };
            if (id === '../services/eventBus') return { publish: async (...args) => state.events.push(args) };
            if (id === '../services/payroll') return { getSalaryReport: async () => { throw new Error('Payroll not under test'); } };
            return realRequire(id);
        }, console, process, Buffer, Date, setTimeout, clearTimeout }, { filename });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = user; next(); });
    app.use('/api/finance', module.exports);
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    async function request(route, body) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/finance${route}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close', 'X-Business-Context': user.default_business_context }, body: JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    }
    try { await run(request, state); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

const transaction = { type: 'income', amount: 100, date: '2099-01-20', description: 'Synthetic fixture' };

test('legacy business scope retains Express prototype headers instead of manufacturing Park', () => {
    const req = Object.assign(Object.create({ headers: { 'x-business-context': 'crm' } }), {
        user: principal('crm', false), query: {}, body: {}
    });
    const scope = resolveBusinessScope(req);
    assert.equal(scope.invalid, false);
    assert.equal(scope.activeContext, 'crm');
});

test('Dar account has the correct owner at INSERT without a later ownership repair', async () => {
    await withRoute(principal(), async (request, state) => {
        const result = await request('/accounts', { name: 'Fixture account', type: 'cash' });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.account.business_context, 'dar');
        assert.deepEqual(state.insertedContexts, ['dar']);
        assert.equal(state.queries.filter(item => /UPDATE finance_accounts/.test(item.sql)).length, 0);
    });
});

test('foreign and missing booking references cannot write transactions or publish income', async () => {
    await withRoute(principal(), async (request, state) => {
        for (const bookingId of ['park_booking', 'missing_booking']) {
            const result = await request('/transactions', { ...transaction, bookingId });
            assert.equal(result.status, 400);
            assert.equal(result.body.code, 'finance_booking_not_found');
        }
        assert.deepEqual(state.transactions, []);
        assert.deepEqual(state.events, []);
    });
});

test('valid booking ownership preserves transaction success and existing response shape', async () => {
    await withRoute(principal(), async (request, state) => {
        const result = await request('/transactions', { ...transaction, bookingId: 'dar_booking' });
        assert.equal(result.status, 201);
        assert.equal(result.body.amount, 100);
        assert.equal(state.transactions[0].booking_id, 'dar_booking');
        assert.equal(state.transactions[0].business_context, 'dar');
        assert.equal(state.events.length, 1);
        assert.equal(state.events[0][1].transactionId, result.body.id);
        assert.equal(state.events[0][1].businessContext, 'dar');
        assert.equal(state.events[0][1].amount, 100);
        assert.equal(state.events[0][2], `finance.income:dar:${result.body.id}`);
    });
});

test('membership staff and certificate references require durable ownership before any write', async () => {
    for (const context of ['event_genix', 'dar']) {
        await withRoute(principal(context), async (request, state) => {
            for (const reference of [{ staffId: 2 }, { certificateId: 'fixture_certificate' }]) {
                const result = await request('/transactions', { ...transaction, ...reference });
                assert.equal(result.status, 403);
                assert.equal(result.body.code, 'finance_reference_not_migrated');
            }
            assert.deepEqual(state.transactions, []);
            assert.deepEqual(state.events, []);
        });
    }
});

test('empty references and existing legacy compatibility remain accepted', async () => {
    await withRoute(principal(), async request => {
        assert.equal((await request('/transactions', { ...transaction, staffId: null, certificateId: '', bookingId: null })).status, 201);
    });
    await withRoute(principal('crm', false), async (request, state) => {
        assert.equal((await request('/transactions', { ...transaction, staffId: 2, certificateId: 'legacy_fixture' })).status, 201);
        assert.equal(state.transactions[0].staff_id, 2);
        assert.equal(state.transactions[0].certificate_id, 'legacy_fixture');
    });
});

test('a QA certificate cannot be linked to a finance transaction', async () => {
    await withRoute(principal('crm', false), async (request, state) => {
        state.qaCertificateIds.add('qa-certificate-1');
        const result = await request('/transactions', { ...transaction, certificateId: 'qa-certificate-1' });
        assert.equal(result.status, 409);
        assert.equal(state.transactions.length, 0);
        assert.equal(state.events.length, 0);
    });
});
