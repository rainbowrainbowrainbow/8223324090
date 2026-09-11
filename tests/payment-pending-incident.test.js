'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCompletedTestSalePendingIncidents } = require('../services/payments/paymentOutboxWorker');
const { sharedTestJob } = require('./helpers/receipt-pending-incident-fixture');

test('receipt incident lifecycle never runs for real or foreign scopes, returns or service operations', async () => {
    const forbidden = [
        {expected_is_test:false}, {expected_is_test:null}, {current_expected_is_test:'false'},
        {register_alias:'real_register'}, {current_crm_profile_key:'dar'},
        {current_profile_crm_profile_key:'foreign'}, {operation_type:'return'},
        {operation_type:'service_out'}, {job_type:'receipt_return'},
        {job_type:'shift_close'}, {payment_order_id:null}
    ];
    for (const changes of forbidden) {
        await resolveCompletedTestSalePendingIncidents({query:async()=>assert.fail('forbidden scope reached database')}, {job:{...sharedTestJob,...changes}});
    }
});

test('shared test sale resolution stays bound to the exact local operation and order', async () => {
    const calls=[];
    await resolveCompletedTestSalePendingIncidents({query:async(sql,params)=>{calls.push({sql,params});return {rows:[]};}}, {job:sharedTestJob});
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0].params,[11,31,21,41,101]);
});
