'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nativeAiUsageReport, validateUsageWindow, NATIVE_USAGE_SQL } = require('../services/aiUsageAccounting');
const window = { businessContext: 'event_genix', from: '2026-11-01', to: '2026-11-08' };
test('accounting separates provider credits from unpriced attempts and exports aggregates only', async () => {
    const rows = [
        {day:'2026-11-07',kind:'attendance_ocr',provider:'kie',model:'gemini',status:'reviewed',reservations:1,priced_receipts:1,cost_unknown:0,time_inferred:0,recorded_credits:'0.09',actor_name:'must not escape'},
        {day:'2026-11-07',kind:'menu_image',provider:'kie',model:null,status:'succeeded',reservations:2,priced_receipts:0,cost_unknown:2,time_inferred:0,recorded_credits:'0'}
    ];
    let calls=0;
    const report=await nativeAiUsageReport({query:async(sql,params)=>{calls++;assert.equal(sql,NATIVE_USAGE_SQL);assert.deepEqual(params,['event_genix','2026-11-01','2026-11-08']);return{rows};}},window);
    assert.equal(calls,1);
    assert.deepEqual(report.totals,{reservations:3,pricedReceipts:1,costUnknown:2,timeInferred:0,recordedCredits:0.09});
    assert.equal(report.costComplete,false);
    assert.equal(report.hardBudgetEnforced,false);
    assert.equal(report.invoiceVerified,false);
    assert.doesNotMatch(JSON.stringify(report),/must not escape|actor_name/);
});
test('range validates real dates and bounds scans before any query', async () => {
    for (const changed of [{from:'2026-02-30'}, {to:'2027-11-08'}, {to:'2026-11-01'}, {businessContext:"event_genix'; DROP TABLE users;--"}]) {
        assert.throws(()=>validateUsageWindow({...window,...changed}),{code:'AI_USAGE_INVALID_WINDOW'});
    }
    assert.deepEqual(validateUsageWindow(window),['event_genix','2026-11-01','2026-11-08']);
});
test('zero observed attempts and invalid driver values are not confused', async () => {
    const empty=await nativeAiUsageReport({query:async()=>({rows:[]})},window);
    assert.equal(empty.totals.reservations,0);
    assert.equal(empty.costComplete,true);
    await assert.rejects(()=>nativeAiUsageReport({query:async()=>({rows:[{day:'2026-11-07',recorded_credits:'NaN'}]})},window));
});
