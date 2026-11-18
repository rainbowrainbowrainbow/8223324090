'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeBaselineQaPlan, cleanupBaselineQa } = require('../services/baselineAccessQa');
const { resolveEnvironment } = require('../scripts/trusted-qa-baseline-access-run');

test('baseline QA plans bind exact identity, business, release and expiry without executable overrides', () => {
    const plan = { runId: 'baqa-0123456789ab', operatorId: 48, businessId: 1, releaseSha: 'a'.repeat(40), ttlMinutes: 15 };
    const first = describeBaselineQaPlan(plan);
    assert.equal(first.planHash.length, 64);
    for (const patch of [{ operatorId: 49 }, { businessId: 2 }, { releaseSha: 'b'.repeat(40) }, { ttlMinutes: 20 }]) {
        assert.notEqual(describeBaselineQaPlan({ ...plan, ...patch }).planHash, first.planHash);
    }
    for (const patch of [{ operatorId: '48' }, { businessId: -1 }, { ttlMinutes: 0 }, { ttlMinutes: 31 },
        { runId: 'baqa-0123456789ab-extra' }, { roles: ['creator'] }, { releaseSha: 'unknown' }]) {
        assert.throws(() => describeBaselineQaPlan({ ...plan, ...patch }), { code: 'BASELINE_QA_PLAN_INVALID' });
    }
});

test('operator target guard never accepts a production URL as a local disposable database', () => {
    assert.throws(() => resolveEnvironment({ local: true, mode: 'run' }, {}), { code: 'BASELINE_QA_LOCAL_CONFIRMATION_REQUIRED' });
    const confirm = { TEST_DATABASE_RESET_CONFIRM: 'RESET_DISPOSABLE_TEST_DATABASE', TEST_URL: 'http://127.0.0.1:45678' };
    assert.throws(() => resolveEnvironment({ local: true }, { ...confirm,
        TEST_DATABASE_URL: 'postgresql://synthetic@foreign.invalid:5432/customer_production' }));
    assert.throws(() => resolveEnvironment({ local: false, mode: 'run' }, {
        TRUSTED_QA_OPERATOR_DATABASE_URL: 'postgresql://synthetic@127.0.0.1:55442/baseline_access_disposable_test'
    }), { code: 'BASELINE_QA_PRODUCTION_TARGET_MISMATCH' });
    assert.throws(() => resolveEnvironment({ mode: 'plan' }, {}), { code: 'BASELINE_QA_OPERATOR_CREDENTIAL_REQUIRED' });
});

test('cleanup rejects even millisecond lifetime extension before acquiring any record locks', async () => {
    const run = { source: 'baseline_access_qa', run_id: 'baqa-0123456789ab', business_context: 'event_genix',
        max_entity_count: 8, test_customer_marker: 'baqa-0123456789ab:baseline:' + 'a'.repeat(64),
        created_at: new Date('2026-11-18T10:00:00.123Z'), expires_at: new Date('2026-11-18T10:30:00.124Z') };
    const types = ['baseline_staff','baseline_account','baseline_profile','baseline_membership'];
    const entities = Array.from({ length: 8 }, (_, index) => ({ entity_type: types[Math.floor(index / 2)], entity_id: String(index + 1), payload: {} }));
    await assert.rejects(cleanupBaselineQa({ query() { assert.fail('Out-of-scope lifecycle must not lock or mutate records'); } },
        { run, entities }), { code: 'BASELINE_QA_CLEANUP_DRIFT' });
});
