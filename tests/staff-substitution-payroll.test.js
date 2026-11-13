'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('../services/staffSubstitutionContract');
const {freezeCompletion,applyPayrollSubstitutions}=require('../services/staffSubstitutionPayroll');
const input=c.normalizeInput({sourceType:'standalone',sourceId:'payroll-proof',staffId:2,workDate:'2099-01-13',professionKey:'reception',
    payUnit:'hour',payMode:'replace_base',startsAt:'2099-01-13T09:00:00+02:00',endsAt:'2099-01-13T10:00:00+02:00',
    workload:'Synthetic one-hour scope',reason:'Synthetic approval',rateMode:'individual',rate:'200',rateReason:'Synthetic rate'});
const allocation=(terms={})=>({allocationType:'base',professionKey:'reception',actualMinutes:60,plannedMinutes:60,
    conditions:{rate:150,rateUnit:'hour',ruleVersion:'hr-pay-conditions-v2',...terms}});
const row={id:'1',staff_id:2,business_context:'event_genix',work_date:'2099-01-13',input_json:input,quote_json:{rate:{rateMinor:20000}}};
const payload={workConfirmed:true,workEvidence:'Synthetic approval',actualMinutes:60,attendanceId:10,baseAllocationIndices:[0]};
function fixture(allocations){
    const writes=[];
    return {writes,query:async(sql,args)=>{
        if(sql.startsWith('SELECT'))return {rows:[{id:10,clock_out:'2099-01-13T08:00:00Z',compensation_snapshot:{schemaVersion:2,compensationAllocations:allocations}}]};
        writes.push(args);return {rows:[]};
    }};
}
test('monthly base replacement needs a frozen confirmed denominator',async()=>{
    const db=fixture([allocation({rateUnit:'month',rate:15000})]);
    await assert.rejects(freezeCompletion(db,row,payload,{username:'qa'}),{code:'SUBSTITUTION_MONTHLY_NORM_REQUIRED'});
    assert.equal(db.writes.length,0);
    const valid=fixture([allocation({rateUnit:'month',rate:15000,monthlyNorm:{monthlyNormConfirmed:true,monthlyNormSource:'approved_norm',monthlyNormMinutes:9600,monthlyNormMonth:'2099-01'}})]);
    assert.equal((await freezeCompletion(valid,row,payload,{username:'qa'})).baseClaims.length,1);
});
test('daily base replacement cannot consume only part of one profession attendance',async()=>{
    const db=fixture([allocation({rateUnit:'day'}),allocation({rateUnit:'day'})]);
    await assert.rejects(freezeCompletion(db,row,payload,{username:'qa'}),{code:'SUBSTITUTION_DAILY_SCOPE_REQUIRED'});
    assert.equal(db.writes.length,0);
});
test('invalid second claim leaves every ordinary allocation intact',()=>{
    const allocations=[allocation(),allocation()];
    const completion={ruleVersion:c.RULE_VERSION,amountMinor:20000,actualMinutes:60,baseClaims:allocations.map((item,index)=>({attendanceId:10,recordDate:'2099-01-13',allocationIndex:index,
        allocationFingerprint:index===0?c.fingerprint(item):'changed'}))};
    const result=applyPayrollSubstitutions({conditionDays:[{attendanceRef:10,date:'2099-01-13',snapshot:{schemaVersion:2,compensationAllocations:allocations}}]},[{...row,state:'completed',completion_json:completion}]);
    assert.equal(result.substitutionLines.length,0);
    assert.equal(result.payrollBlockingIssues[0].code,'SUBSTITUTION_BASE_EVIDENCE_CHANGED');
    assert.deepEqual(result.conditionDays[0].snapshot.compensationAllocations,allocations);
});

test('substitution cents survive payroll summary, reviewed snapshot and final installment',()=>{
    const payroll=require('../services/payroll');
    const lines=[{group:'base',lineType:'hourly',amount:1000},{group:'additional',lineType:'staff_substitution',amount:750.37}];
    const summary=payroll.calcPayrollPreview(lines);
    assert.equal(summary.additional,750.37);
    assert.equal(summary.net,1750.37);
    const reviewed=payroll.applyReportSnapshot({lines:[],schemeType:'hourly'},{status:'reviewed',gross_amount:'1750.37',net_amount:'1750.37',deductions_amount:'0',advances_amount:'0',breakdown_json:{lines,summary}});
    assert.equal(reviewed.additionalAmount,750.37);
    assert.equal(reviewed.netAmount,1750.37);
    const final=payroll.calculateFinalInstallment({monthlyPayroll:{summary},advanceInstallment:{status:'approved',lockedAmount:300.15}});
    assert.equal(final.amount,1450.22);
    assert.equal(final.lockedAdvanceAmount,300.15);
    const advance=payroll.calculateAdvanceInstallment({scheme:{schemeType:'hourly'},rangeCalculation:{lines,blockers:[]}});
    assert.equal(advance.amount,1750.37);
});

test('payment form preserves the exact outstanding amount before any write',async()=>{
    const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../js/hr-page.js'),'utf8');
    const start=source.indexOf('async function confirmPayrollPaymentFromUi(');
    const end=source.indexOf('async function reversePayrollMovementFromUi(',start);
    let amount;
    const scope={defaultPayrollBusinessContext:()=> 'event_genix',fetchPayrollPaymentOptions:async()=>({categories:{expense:[{id:1}]},accounts:[{id:1}]}),
        payrollOptionRows:rows=>rows,formModal:async(title,fields)=>{amount=fields.find(field=>field.key==='amount').defaultValue;return null;}};
    require('node:vm').runInNewContext(source.slice(start,end),scope);
    assert.equal(await scope.confirmPayrollPaymentFromUi(1,750.37),false);
    assert.equal(amount,750.37);
});
