'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFinanceQaPlan, hashFinanceQaPlan, assertFinanceQaCommand, resolveFinanceQaAccess } = require('../services/financeMoneyQa');
const { assertRunMatchesRequest, sha256 } = require('../services/trustedQaRuns');

const input = () => ({ runId: 'finance-qa-unit-001', testAccountId: 7, businessContext: 'event_genix', ttlMinutes: 15 });

test('finance QA plan is canonical, bounded and rejects an expanded scope', () => {
    const plan = normalizeFinanceQaPlan(input());
    assert.deepEqual(plan.accountTypes, ['cash', 'cash', 'bank']);
    assert.equal(plan.maxOperations, 40);
    assert.equal(plan.maxAmountMinor, '1000000');
    assert.equal(plan.maxPositiveMinor, '3000000');
    assert.equal(hashFinanceQaPlan(plan), hashFinanceQaPlan(input()));
    for (const change of [{ realData: true }, { ttlMinutes: 31 }, { maxOperations: 41 },
        { maxAmountMinor: 100 }, { maxAmountMinor: '1000001' }, { maxPositiveMinor: '3000001' },
        { accountTypes: ['cash', 'cash', 'cash'] }, { businessContext: 'dar' }, { testAccountId: '7' }]) {
        assert.throws(() => normalizeFinanceQaPlan({ ...input(), ...change }), { code: 'FINANCE_QA_PLAN_INVALID' });
    }
});

test('counted cash shares the per-command QA cap and never consumes positive movement budget', async () => {
    const scope = { runId: '1', limits: { maxOperations: 40, maxAmountMinor: '1000000', maxPositiveMinor: '3000000' } };
    const client = { query: async sql => sql.includes('trusted_qa_run_entities')
        ? { rows: [{ payload: {} }], rowCount: 1 } : { rows: [{ operation_count: 0, positive_minor: '0' }], rowCount: 1 } };
    await assert.rejects(assertFinanceQaCommand(client, scope, { command: 'close_shift', accountId: 1, shiftId: 1,
        actualMinor: '1000001' }), { code: 'FINANCE_QA_AMOUNT_CAP' });
    assert.deepEqual(await assertFinanceQaCommand(client, scope, { command: 'close_shift', accountId: 1, shiftId: 1,
        actualMinor: '1000000' }), { positiveMinor: '0' });
});

test('finance QA token requires exact actor, context and endpoint; absence grants no QA scope', async () => {
    const client = { query: async () => ({ rows: [], rowCount: 0 }) };
    assert.equal(await resolveFinanceQaAccess(client, { token: '' }), null);
    await assert.rejects(resolveFinanceQaAccess(client, { token: 'test', actor: { id: 7 },
        businessContext: 'event_genix', endpoint: 'POST /api/finance/transactions' }), { code: 'FINANCE_QA_ENDPOINT_DENIED' });
    await assert.rejects(resolveFinanceQaAccess(client, { token: 'test', actor: { id: 7 },
        businessContext: 'event_genix', endpoint: 'POST /api/finance/manual-money/commands' }), { code: 'FINANCE_QA_ACCESS_DENIED' });
});

test('canonical finance QA booking rejects a customer before any token consumption or booking write', () => {
    const fixture = { requestId: 'finance-booking-1', programId: 'program-1', lineId: 'line-1',
        roomResourceId: 'room-1', room: 'QA room', date: '2099-06-15', time: '13:00', duration: 60, status: 'confirmed' };
    const { requestId, ...body } = fixture;
    const run = { id: 1, run_id: 'finance-qa-test', token_hash: sha256('qa-token'), source: 'trusted_qa',
        business_context: 'event_genix', required_user_id: 7, operator_user_id: 7,
        test_customer_marker: 'finance-qa-test:finance:disposable', state: 'active',
        expires_at: new Date(Date.now() + 60000).toISOString(), max_entity_count: 40,
        allowed_endpoints: { endpoints: ['POST /api/bookings'], bookingFixtures: [fixture] } };
    const request = value => ({ method: 'POST', path: '/api/bookings', baseUrl: '', user: { id: 7 }, body: value,
        get: name => name.toLowerCase() === 'x-qa-run-token' ? 'qa-token' : name.toLowerCase() === 'x-qa-run-request-id' ? requestId : '' });
    assert.equal(assertRunMatchesRequest(run, request(body), body, 'event_genix').bookingFixtureKey, requestId);
    const attached = { ...body, customerId: 123 };
    assert.throws(() => assertRunMatchesRequest(run, request(attached), attached, 'event_genix'), { code: 'FINANCE_QA_CUSTOMER_DENIED' });
});
