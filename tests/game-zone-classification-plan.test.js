'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PAIRS, describeClassificationPlan, executeClassificationPlan } = require('../services/gameZoneClassification');
test('zone classification binds the exact fifteen stable resources and rejects executable scope overrides', async () => {
    const input = { releaseSha:'a'.repeat(40), resources:PAIRS, snapshotHash:'b'.repeat(64) };
    const description = describeClassificationPlan(input);
    assert.equal(description.planHash.length, 64);
    for (const patch of [{ resources:PAIRS.slice(1) }, { resources:[...PAIRS].reverse() },
        { resources:PAIRS.map((row,index)=>index ? row : {...row,id:99}) }, { sql:'UPDATE anything' }, { releaseSha:'bad' }]) {
        assert.throws(()=>describeClassificationPlan({...input,...patch}), { code:'GAME_ZONE_CLASSIFICATION_PLAN_INVALID' });
    }
    await assert.rejects(executeClassificationPlan({query(){assert.fail('Approval rejection must precede record locks');}},input,'bad'),
        {code:'GAME_ZONE_CLASSIFICATION_APPROVAL_REQUIRED'});
});
