const test = require('node:test');
const assert = require('node:assert/strict');

const {
    guardPaidPreSubmitSalesForClosedShift,
    hasPostSubmitStageEvidence,
    postSubmitStageEvidenceSql
} = require('../services/payments/closedShiftSaleGuard');

const SIGNAL_FIELDS = Object.freeze([
    'jobExternalStage',
    'payloadExternalStage',
    'operationExternalStage',
    'requestSnapshotExternalStage'
]);

test('any durable post-submit stage signal wins over stale pre-submit signals', async t => {
    for (const stage of ['sale_submit', 'receipt_lookup', 'complete']) {
        for (const field of SIGNAL_FIELDS) {
            await t.test(`${field}:${stage}`, () => {
                const evidence = {
                    jobExternalStage: 'auth',
                    payloadExternalStage: 'readiness',
                    operationExternalStage: 'receipt_validation',
                    requestSnapshotExternalStage: 'auth',
                    [field]: `  ${stage.toUpperCase()}  `
                };

                assert.equal(hasPostSubmitStageEvidence(evidence), true);
            });
        }
    }
});

test('only genuine pre-submit signals remain eligible for automatic closed-shift blocking', () => {
    assert.equal(hasPostSubmitStageEvidence({
        jobExternalStage: 'auth',
        payloadExternalStage: 'readiness',
        operationExternalStage: 'receipt_validation',
        requestSnapshotExternalStage: ''
    }), false);
    assert.equal(hasPostSubmitStageEvidence({}), false);
});

test('SQL predicate checks every stage source independently instead of trusting COALESCE order', () => {
    const sql = postSubmitStageEvidenceSql('job', 'operation', '$9');

    assert.match(sql, /EXISTS\s*\(/);
    assert.match(sql, /job\.external_stage/);
    assert.match(sql, /job\.payload->>'external_stage'/);
    assert.match(sql, /operation\.external_stage/);
    assert.match(sql, /operation\.request_snapshot->>'external_stage'/);
    assert.match(sql, /LOWER\(observed_stage\.stage\) = ANY\(\$9::text\[\]\)/);
    assert.doesNotMatch(sql, /COALESCE/i);
});

test('closed-shift guard applies the any-evidence predicate to active and queued jobs', async () => {
    const statements = [];
    const client = {
        async query(sql, parameters) {
            statements.push({ sql, parameters });
            return { rows: [] };
        }
    };

    const result = await guardPaidPreSubmitSalesForClosedShift(client, {
        fiscalProfileId: 11,
        fiscalRegisterId: 22,
        fiscalShiftId: 33,
        providerShiftId: 'provider-shift-33'
    });

    assert.deepEqual(result, { blocked: 0, activeObserved: 0 });
    assert.equal(statements.length, 2);

    const activeSql = statements[0].sql;
    const queuedSql = statements[1].sql;
    for (const sql of [activeSql, queuedSql]) {
        assert.match(sql, /AND NOT EXISTS\s*\(/);
        assert.match(sql, /job\.external_stage/);
        assert.match(sql, /job\.payload->>'external_stage'/);
        assert.match(sql, /operation\.external_stage/);
        assert.match(sql, /operation\.request_snapshot->>'external_stage'/);
        assert.doesNotMatch(sql, /COALESCE\s*\(\s*NULLIF\([^)]*external_stage/i);
    }
    assert.match(activeSql, /ANY\(\$5::text\[\]\)/);
    assert.match(queuedSql, /ANY\(\$6::text\[\]\)/);
    assert.deepEqual(statements[0].parameters[4], ['sale_submit', 'receipt_lookup', 'complete']);
    assert.deepEqual(statements[1].parameters[5], ['sale_submit', 'receipt_lookup', 'complete']);
});
