'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lockFiscalRegister, assertRegisterAccepting } = require('../services/payments/testDrainGate');
const { assertEvidence, requestSharedTestResume, requestSharedTestDrain } = require('../services/payments/sharedTestDayService');

test('physical register lock rejects out-of-range identities without querying PostgreSQL', async () => {
    const client = { query: async () => { throw new Error('must not query'); } };
    for (const id of [0, -1, 1.2, 2147483648, 'bad', Number.MAX_SAFE_INTEGER]) {
        await assert.rejects(() => lockFiscalRegister(client, 1, id), error => error.code === 'fiscal_register_lock_scope_invalid');
    }
});

test('both active statuses stop admission and historical resumed rows do not', async () => {
    for (const status of ['draining', 'closed', null]) {
        const queries = [];
        const client = { query: async sql => { queries.push(sql); return { rows: sql.includes('FROM fiscal_register_payment_drains') && status ? [{ id: 1, status }] : [] }; } };
        if (status) await assert.rejects(() => assertRegisterAccepting(client, 10, 20), error => error.code === 'shared_test_register_draining');
        else await assertRegisterAccepting(client, 10, 20);
        assert.match(queries[0], /pg_advisory_xact_lock/);
        assert.match(queries[1], /status IN \('draining', 'closed'\)/);
    }
});

test('resume requires fresh exact CLOSED and excludes a foreign/current open shift', () => {
    const scope = { shift: { provider_shift_id: 'exact' } };
    const valid = { observedAt: Date.now(), shiftId: 'exact', status: 'CLOSED', currentShift: null };
    assert.doesNotThrow(() => assertEvidence(valid, scope, 'CLOSED'));
    for (const evidence of [null, { ...valid, status: 'OPENED' }, { ...valid, shiftId: 'foreign' },
        { ...valid, observedAt: Date.now() - 31000 }, { ...valid, observedAt: Date.now() + 5000 }, { ...valid, observedAt: NaN },
        { ...valid, currentShift: { id: 'foreign', status: 'CLOSED' } },
        { ...valid, currentShift: { id: 'exact', status: 'OPENED' } }]) {
        assert.throws(() => assertEvidence(evidence, scope, 'CLOSED'), error => error.code === 'shared_test_provider_evidence_invalid');
    }
});

test('lifecycle input validation rejects implicit confirmation and browser scope overrides before DB access', async () => {
    const dbPool = { connect: async () => { throw new Error('must not connect'); } };
    for (const body of [null, {}, { confirmNextTestDay: false }, { confirmNextTestDay: true, fiscalRegisterId: 1 }]) {
        await assert.rejects(() => requestSharedTestResume({ dbPool, drainId: 1, body, idempotencyKey: 'key' }), error => error.code === 'shared_test_confirmation_required');
    }
    await assert.rejects(() => requestSharedTestDrain({ dbPool, shiftId: 1, body: { isTest: true }, idempotencyKey: 'key' }), error => error.code === 'shared_test_body_invalid');
    await assert.rejects(() => requestSharedTestDrain({ dbPool, shiftId: 1, body: {} }), error => error.code === 'idempotency_key_required');
});
