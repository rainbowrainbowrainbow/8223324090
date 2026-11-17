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

test('manual original-worker adjustments consume only matching daily or monthly base once', async () => {
    const { calculatePayroll } = require('../services/payroll');
    for (const rateUnit of ['day', 'month']) {
        const base = { group: 'base', lineType: 'profession_' + rateUnit, amount: 1200,
            meta: { professionKey: 'reception', workDate: '2099-01-13', rateUnit } };
        const manualRow = { ...row, originalPayee: true, state: 'completed',
            input_json: { ...input, sourceType: 'hr_shift', originalStaffId: 3, originalTreatment: 'retain',
                payOverrides: { originalMinor: -15005, replacementMinor: 9025, reason: 'Synthetic correction' } },
            quote_json: { rate: null, payImpact: { originalReference: { rateUnit, rateMinor: 120000 } } } };
        const completion = await freezeCompletion(fixture([allocation()]), manualRow, payload, { username: 'qa' });
        assert.equal(completion.amountMinor, 9025);
        assert.equal(completion.originalPay.amountMinor, -15005);
        assert.equal(completion.baseClaims.length, 1);
        const { substitutionLines: [manual] } = applyPayrollSubstitutions({}, [{ ...manualRow, completion_json: completion }]);
        assert.equal(manual.amount, -150.05);
        assert.equal(manual.meta.rate.rateUnit, rateUnit);
        const remainder = calculatePayroll({}, { schemeType: 'hourly' }, { substitutionLines: [manual] }, {}, [],
            { applies: true, baseLines: [base], overtimeLines: [] });
        assert.equal(remainder.summary.base, 1049.95);
        const excess = { ...manual, amount: -1100, meta: { ...manual.meta, substitutionId: '2' } };
        const blocked = calculatePayroll({}, { schemeType: 'hourly' }, { substitutionLines: [manual, excess] }, {}, [],
            { applies: true, baseLines: [base], overtimeLines: [] });
        assert.equal(blocked.summary.base, 1049.95);
        assert.ok(blocked.blockingIssues.some(issue => issue.code === 'SUBSTITUTION_ORIGINAL_ADJUSTMENT_EXCEEDS_BASE'));
        const unrelated = { ...base, meta: { ...base.meta, professionKey: 'animator' } };
        const outsideScope = calculatePayroll({}, { schemeType: 'hourly' }, { substitutionLines: [manual] }, {}, [],
            { applies: true, baseLines: [unrelated], overtimeLines: [] });
        assert.equal(outsideScope.summary.base, 1200);
        assert.ok(outsideScope.blockingIssues.some(issue => issue.code === 'SUBSTITUTION_ORIGINAL_ADJUSTMENT_EXCEEDS_BASE'));
    }
});

test('automatic retention uses the ordinary daily payment and one rounded monthly baseline', async () => {
    const { calculateConditionSnapshots } = require('../services/payrollConditionCalculation');
    const norm = { monthlyNormConfirmed:true, monthlyNormSource:'synthetic', monthlyNormMinutes:9600, monthlyNormMonth:'2099-01' };
    const fixedRow = (id, day, rateUnit, rateMinor, transferredMinutes) => {
        const terms = { rateUnit, rateMinor, transferredMinutes, ...(rateUnit === 'month' && { monthlyNorm:norm }) };
        return { ...row, id, work_date:day, originalPayee:true, state:'completed', source_snapshot:{ partial:true },
            input_json:{ ...input, workDate:day, sourceType:'hr_shift', originalStaffId:3, originalTreatment:'retain',
                startsAt:`${day}T09:00:00+02:00`, endsAt:`${day}T11:00:00+02:00`, plannedMinutes:transferredMinutes },
            quote_json:{ ...row.quote_json, payImpact:{ fixedOriginal:terms } } };
    };
    const day = (date, minutes, rateUnit, rate) => ({ date, worked:true, snapshot:{ schemaVersion:2,
        plan:{ segments:[{ shiftStart:'12:00', shiftEnd:'20:00' }] }, compensationAllocations:[{
            ...allocation({ rateUnit, rate, ...(rateUnit === 'month' && { monthlyNorm:norm }) }), segmentIndex:0,
            actualMinutes:minutes, plannedMinutes:minutes }] } });
    const complete = async item => {
        const minutes = Math.min(60, item.input_json.plannedMinutes);
        return { ...item, completion_json:await freezeCompletion(fixture([{ ...allocation(), actualMinutes:minutes }]), item,
            { ...payload, actualMinutes:minutes }, { username:'qa' }) };
    };
    const daily = await complete(fixedRow('1', '2099-01-13', 'day', 90000, 120));
    assert.equal(daily.completion_json.originalFixedPay.rateUnit, 'day');
    const firstDay = day('2099-01-13', 365, 'day', 900);
    assert.equal(applyPayrollSubstitutions({ conditionDays:[firstDay] }, [daily]).substitutionLines[0].amount, 0);
    assert.equal(applyPayrollSubstitutions({}, [daily]).substitutionLines[0].amount, 900);
    const badRate = day('2099-01-13', 365, 'day', 901);
    assert.ok(applyPayrollSubstitutions({ conditionDays:[badRate] }, [daily]).payrollBlockingIssues
        .some(issue => issue.code === 'SUBSTITUTION_FIXED_PAY_CONDITIONS_CHANGED'));
    const monthly = await complete(fixedRow('2', '2099-01-13', 'month', 3000000, 116));
    const next = await complete(fixedRow('3', '2099-01-15', 'month', 3000000, 12));
    const actual = [day('2099-01-13', 365, 'month', 30000), day('2099-01-14', 4, 'month', 30000)];
    const full = applyPayrollSubstitutions({ conditionDays:actual }, [monthly, next]);
    assert.deepEqual(full.payrollBlockingIssues, []);
    assert.deepEqual(full.substitutionLines.map(line => line.amount), [363,37]);
    const ordinary = calculateConditionSnapshots({ conditionDays:actual }, 1);
    const restored = calculateConditionSnapshots({ conditionDays:[day('2099-01-13', 481, 'month', 30000),
        ...actual.slice(1), day('2099-01-15', 12, 'month', 30000)] }, 1);
    assert.equal(ordinary.baseAmount + full.substitutionLines.reduce((sum, line) => sum + line.amount, 0), restored.baseAmount);
    const short = applyPayrollSubstitutions({ conditionDays:actual.slice(0,1) }, [monthly], full.fixedRetentionSettlements);
    assert.equal(short.substitutionLines[0].amount, full.substitutionLines[0].amount);
    assert.equal(applyPayrollSubstitutions({ conditionDays:[{ ...actual[0], businessContext:'dar' }] }, [monthly]).substitutionLines.length, 0);
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
