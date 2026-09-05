'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
    BLOCKED_QA_RUN_ID,
    PLANNED_RECEIPT_COUNT,
    RECEIPT_PLAN,
    assertFreshQaRunId,
    assertMutationSafetyEvidence,
    assertReceiptPlan,
    createOneShotPostSubmitUnknownFetch,
    sanitizedPlan
} = require('../scripts/checkbox-single-register-mutation-qa');

function readyEvidence(overrides = {}) {
    return {
        exactOrganization: true,
        exactRegister: true,
        exactCashier: true,
        licenseDeviceOwnedByRegister: true,
        activeBinding: true,
        untaxedMappings: true,
        acceptanceIsolated: true,
        noForeignShift: true,
        queuesEmpty: true,
        expectedIsTest: true,
        isTest: true,
        ...overrides
    };
}

test('sequential receipt plan is fixed at four and covers the combined DAR scenarios', () => {
    assert.equal(assertReceiptPlan(), RECEIPT_PLAN);
    assert.equal(RECEIPT_PLAN.length, PLANNED_RECEIPT_COUNT);
    assert.deepEqual(RECEIPT_PLAN.map(item => item.businessContext), ['event_genix', 'event_genix', 'dar', 'dar']);
    assert.ok(RECEIPT_PLAN[2].scenarios.includes('weekend_hourly_care_quantity_2'));
    assert.ok(RECEIPT_PLAN[2].scenarios.includes('weekday_hourly_care_same_receipt'));
    assert.ok(RECEIPT_PLAN[2].scenarios.includes('dar_ubd_20'));
    assert.ok(RECEIPT_PLAN[3].scenarios.includes('two_club_directions'));
    assert.ok(RECEIPT_PLAN[3].scenarios.includes('dar_second_club_direction_10'));
});

test('runner refuses stale run IDs, non-test identity and incomplete safety evidence', () => {
    assert.throws(() => assertFreshQaRunId(BLOCKED_QA_RUN_ID), error => error.code === 'qa_run_id_reuse_forbidden');
    assert.throws(() => assertFreshQaRunId('not-a-uuid'), error => error.code === 'qa_run_id_invalid');
    assert.throws(() => assertMutationSafetyEvidence(readyEvidence({ isTest: false })), error => error.code === 'qa_mutation_evidence_incomplete');
    assert.throws(() => assertMutationSafetyEvidence(readyEvidence({ noForeignShift: false })), error => error.code === 'qa_mutation_evidence_incomplete');
});

test('one-shot recovery injects unknown only after one accepted exact sale and permits lookup', async () => {
    const qaRunId = crypto.randomUUID();
    const operationUuid = crypto.randomUUID();
    const calls = [];
    const baseFetch = async (input, init = {}) => {
        const url = new URL(String(input));
        calls.push({ method: String(init.method || 'GET').toUpperCase(), path: url.pathname });
        return new Response(JSON.stringify({ id: operationUuid, status: 'DONE' }), {
            status: url.pathname === '/api/v1/receipts/sell' ? 201 : 200,
            headers: { 'content-type': 'application/json' }
        });
    };
    const wrapped = createOneShotPostSubmitUnknownFetch({
        fetchImpl: baseFetch,
        qaRunId,
        operationUuid,
        evidence: readyEvidence(),
        allowedOrigins: ['http://127.0.0.1:43210']
    });
    const sale = () => wrapped('http://127.0.0.1:43210/api/v1/receipts/sell', {
        method: 'POST',
        body: JSON.stringify({ id: operationUuid, goods: [], payments: [] })
    });

    await assert.rejects(sale, error => error.code === 'qa_post_submit_unknown');
    await assert.rejects(sale, error => error.code === 'qa_duplicate_sale_post_blocked');
    const lookup = await wrapped(`http://127.0.0.1:43210/api/v1/receipts/${operationUuid}`, { method: 'GET' });
    assert.equal(lookup.ok, true);
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET']);
    assert.deepEqual(wrapped.evidence(), {
        qaRunId,
        operationUuid,
        acceptedPostCount: 1,
        blockedDuplicatePostCount: 1,
        lookupCount: 1,
        injected: true
    });
});

test('one-shot recovery is scoped to exact UUID and exact origin', async () => {
    const operationUuid = crypto.randomUUID();
    let calls = 0;
    const wrapped = createOneShotPostSubmitUnknownFetch({
        fetchImpl: async () => {
            calls += 1;
            return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
        },
        qaRunId: crypto.randomUUID(),
        operationUuid,
        evidence: readyEvidence(),
        allowedOrigins: ['http://localhost:4010']
    });
    const other = await wrapped('http://localhost:4010/api/v1/receipts/sell', {
        method: 'POST',
        body: JSON.stringify({ id: crypto.randomUUID() })
    });
    assert.equal(other.ok, true);
    assert.equal(calls, 1);
    await assert.rejects(
        wrapped(`http://127.0.0.1:4010/api/v1/receipts/${operationUuid}`, { method: 'GET' }),
        error => error.code === 'qa_provider_origin_forbidden'
    );
});

test('sanitized plan contains no identity, credentials or provider IDs', () => {
    const output = JSON.stringify(sanitizedPlan());
    assert.doesNotMatch(output, /login|password|credential|provider.*id|license|access.?key|device/i);
    assert.equal(sanitizedPlan().plannedReceiptCount, 4);
});
