'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildHrPayReadiness } = require('../services/hrPayReadiness');
const { options, readDatabaseInputs, runReadOnlyDatabaseAudit } = require('../scripts/audit-hr-pay-readiness');
function fixture(overrides = {}) {
    return { date: '2026-10-03', staff: [{ id: 1, role_type: 'reception', secondary_professions: ['animator'], is_active: true,
        name: 'Private staff name', phone: 'Private phone', hourly_rate: 100, rate_unit: 'hour' }],
        roleAssignments: [{staff_id:1,profession_key:'reception',status:'active',admission_status:'approved'},
            {staff_id:1,profession_key:'animator',status:'active',admission_status:'approved'}],
        rates: [{staff_id:1,profession_key:'animator',hourly_rate:180}],
        profilesAvailable:true, assignmentsAvailable:true, rolesAvailable:true, exceptionsAvailable:true,
        schemesAvailable:true, payrollAmountsAvailable:true, ...overrides };
}
const extra = input => buildHrPayReadiness(input).rows.find(row => row.use === 'potential_additional');
function profile(unit='day') {
    return {id:9,professionKey:'animator',profileKind:'shared',isDefaultForProfession:true,status:'active',versions:[
        {id:91,versionNumber:1,rateUnit:unit,defaultRate:500,effectiveFrom:'2026-01-01',dayRates:[]}]};
}
test('admission is independent of an existing rate', () => {
    const input=fixture();input.roleAssignments[1].admission_status='pending';
    assert.deepEqual(extra(input).findings,['admission_not_approved']);
});
test('active daily default profile replaces missing legacy rate and ignores monthly base unit', () => {
    const input=fixture({profiles:[profile()],rates:[]});input.staff[0].rate_unit='month';
    const row=extra(input);
    assert.deepEqual(row.findings,[]);assert.deepEqual(row.unverified,[]);assert.equal(row.effectiveUnit,'day');
    assert.match(row.effectiveSource,/payroll_profile/);
});
test('temporary personal and one-day conditions use the shared dated resolver priority', () => {
    const base=profile();base.isDefaultForProfession=false;
    const input=fixture({profiles:[base], assignments:[{id:8,staffId:1,professionKey:'animator',profileId:9,
        assignmentKind:'temporary',effectiveFrom:'2026-10-03',effectiveTo:'2026-10-03'}]});
    assert.equal(extra(input).effectiveUnit,'day');
    input.date='2026-10-04';assert.equal(extra(input).effectiveUnit,'hour');
    input.exceptions=[{staffId:1,professionKey:'animator',workDate:input.date,purpose:'additional',state:'active',rate:250,rateUnit:'day',version:1}];
    assert.equal(extra(input).effectiveSource,'payroll_day_exception');
});
test('denied profile access remains unverified without false missing-rate findings', () => {
    const report=buildHrPayReadiness(fixture({profilesAvailable:false,rates:[],sourceErrors:[{source:'profiles',status:403}]}));
    assert.equal(report.status,'PARTIAL');assert.equal(report.counts.effective_rate_missing,undefined);
    assert.ok(report.rows[0].unverified.includes('payroll_profile_unverified'));
});
test('expired or archived assigned profile remains visible even with a compatible fallback', () => {
    const input=fixture({profiles:[profile()],assignments:[{id:8,staffId:1,professionKey:'animator',profileId:9,
        assignmentKind:'explicit',effectiveFrom:'2026-01-01'}]});
    input.profiles[0].versions[0].effectiveTo='2026-09-30';
    assert.ok(extra(input).findings.includes('payroll_profile_invalid'));
    input.date='2026-09-30';assert.deepEqual(extra(input).findings,[]);
    input.profiles[0].status='archived';assert.ok(extra(input).findings.includes('payroll_profile_invalid'));
});
test('missing rate is proven only when all applicable sources are read', () => {
    assert.deepEqual(extra(fixture({rates:[]})).findings,['effective_rate_missing']);
    const row=extra(fixture({rates:[],exceptionsAvailable:false}));
    assert.deepEqual(row.findings,[]);assert.ok(row.unverified.includes('effective_rate_unverified'));
});
test('monthly additional terms require the confirmed norm without inheriting base pay', () => {
    const input=fixture({profiles:[profile('month')],rates:[]});
    assert.deepEqual(extra(input).findings,['monthly_norm_unconfirmed']);
    input.schemes=[{staff_id:1,scheme_type:'hourly',config_json:{monthlyNormMinutes:9600,monthlyNormConfirmed:true,
        monthlyNormSource:'approved_schedule',monthlyNormMonth:'2026-10'}}];
    assert.deepEqual(extra(input).findings,[]);
});
test('base exception with conflicting unit is distinguished from missing rate', () => {
    const input=fixture({exceptions:[{staffId:1,professionKey:'reception',workDate:'2026-10-03',purpose:'base_replacement',state:'active',rate:400,rateUnit:'day'}]});
    assert.deepEqual(buildHrPayReadiness(input).rows[0].findings,['rate_unit_conflict']);
});
test('audit artifacts omit PII, amounts, authors and free-text reasons', () => {
    const input=fixture({exceptions:[{staffId:1,professionKey:'animator',workDate:'2026-10-03',purpose:'additional',state:'active',rate:12345,rateUnit:'hour',reason:'Private reason',createdBy:'Private author'}]});
    const serialized=JSON.stringify(buildHrPayReadiness(input));
    assert.doesNotMatch(serialized,/Private|12345|"hourly_rate":|explicitRate|password|token/);
    assert.ok(serialized.includes('staffId'));
});
test('audit rejects writes, invalid dates, arbitrary sources and outside report paths', () => {
    assert.throws(()=>options(['--apply']),/READ_ONLY/);
    assert.throws(()=>options(['--date','2026-10-03','--output',path.resolve('package.json')]),/OUTPUT/);
    assert.throws(()=>options(['--date','2026-10-03','--source','production-write','--output','ignored']),/SOURCE/);
    assert.throws(()=>buildHrPayReadiness(fixture({date:'2026-02-30'})),/VALID_WORK_DATE/);
});
test('database reader forces and verifies read-only, selects only whitelisted tables and rolls back', async () => {
    const statements=[];
    const client={query:async(sql,params)=>{
        statements.push(sql);
        if(sql.includes('current_setting'))return {rows:[{read_only:'on'}]};
        if(sql.includes('unnest'))return {rows:params[0].map(name=>({name,present:name!=='payroll_day_exceptions',readable:name!=='payroll_day_exceptions'}))};
        return {rows:[]};
    }};
    const result=await readDatabaseInputs(client,'2026-10-03');
    assert.equal(statements[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(statements.at(-1),'ROLLBACK');
    assert.ok(statements.slice(1,-1).every(sql=>sql.trim().startsWith('SELECT')));
    assert.doesNotMatch(statements.join('\n'),/SELECT \*|SELECT[^;]*\b(?:phone|address|password|created_by)\b/);
    assert.equal(result.exceptionsAvailable,false);assert.deepEqual(result.sourceErrors,[{source:'payroll_day_exceptions',status:'schema_missing'}]);
});
test('database reader fails closed and rolls back on wrong transaction or failed SELECT', async () => {
    for(const failure of ['guard','query']){
        const statements=[];
        await assert.rejects(readDatabaseInputs({query:async sql=>{
            statements.push(sql);
            if(sql.includes('current_setting')){
                if(failure==='query')throw Error('query failed');
                return {rows:[{read_only:'off'}]};
            }
            return {rows:[]};
        }},'2026-10-03'));
        assert.equal(statements.at(-1),'ROLLBACK');
    }
});
test('database audit never falls back to production DATABASE_URL', async () => {
    await assert.rejects(runReadOnlyDatabaseAudit({date:'2026-10-03'},{DATABASE_URL:'must-not-connect'}),/TRUSTED_QA_OPERATOR_DATABASE_URL_REQUIRED/);
});
