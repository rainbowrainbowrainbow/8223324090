'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getPaidProfessionEligibility, normalizeStaffProfessionRateChanges, applyStaffProfessionRateChanges } = require('../services/professions');
const { loadPaidRoleValidationContext, validatePaidAdditionalRoles, normalizeHrShiftDayPlan } = require('../services/hrShiftSegments');
const { projectParkStaffSchedulePayload } = require('../services/parkStaffScheduleProjection');
const root = path.resolve(__dirname, '..');
function block(file, name, async = false) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const start = text.indexOf(`${async ? 'async ' : ''}function ${name}(`);
    assert.ok(start >= 0, name);
    const next = /\n(?:async )?function /.exec(text.slice(start + 1));
    return text.slice(start, start + 1 + next.index);
}
function rateDb() {
    const rates = new Map([['animator', 180], ['waiter', 120]]);
    const mutations = [];
    return { rates, mutations, async query(sql, params) {
        if (sql.startsWith('SELECT')) return { rows: [...rates].map(([profession_key, hourly_rate]) => ({ profession_key, hourly_rate })) };
        mutations.push({ sql, params });
        if (sql.startsWith('DELETE')) { assert.equal(params.length, 2); rates.delete(params[1]); }
        else if (sql.trim().startsWith('INSERT')) rates.set(params[1], params[2]);
        else assert.fail(sql);
        return { rows: [] };
    } };
}
test('saving omitted and unchanged rates keeps primary and secondary overrides without writes', async () => {
    const db = rateDb();
    await applyStaffProfessionRateChanges(db, 7, []);
    await applyStaffProfessionRateChanges(db, 7, [{ profession_key: 'waiter', hourly_rate: 120 }]);
    assert.deepEqual([...db.rates], [['animator', 180], ['waiter', 120]]);
    assert.equal(db.mutations.length, 0);
});
test('updating one rate preserves every other rate; explicit removal deletes only its key', async () => {
    const db = rateDb();
    await applyStaffProfessionRateChanges(db, 7, normalizeStaffProfessionRateChanges([{ profession_key: 'waiter', hourly_rate: 150 }], ['animator','waiter']));
    assert.equal(db.rates.get('animator'), 180);
    assert.equal(db.rates.get('waiter'), 150);
    await applyStaffProfessionRateChanges(db, 7, normalizeStaffProfessionRateChanges([{ profession_key: 'waiter', remove: true }], ['animator','waiter']));
    assert.deepEqual([...db.rates], [['animator', 180]]);
});
test('zero, blank, malformed, duplicate and unassigned rate changes cannot imply deletion', () => {
    for (const value of [0, 0.001, '', null, -10, Infinity, 'bad']) {
        assert.throws(() => normalizeStaffProfessionRateChanges([{profession_key:'animator',hourly_rate:value}], ['animator']), e => e.statusCode === 400);
    }
    assert.throws(() => normalizeStaffProfessionRateChanges([{profession_key:'waiter',remove:true}], ['animator']));
    assert.throws(() => normalizeStaffProfessionRateChanges([{profession_key:'animator',hourly_rate:100},{profession_key:'animator',remove:true}], ['animator']));
    assert.throws(() => normalizeStaffProfessionRateChanges(null, ['animator']));
});
const person = { id:7, isActive:true, hasPaidAssignment:true, assignmentStatus:'active', admissionStatus:'approved', rateUnit:'hour', explicitRate:180, rateSource:'staff_profession_rates.hourly_rate' };
test('eligibility distinguishes missing assignment, inactive assignment, admission, unit and rate', () => {
    const cases = [[{hasPaidAssignment:false},'assignment_missing'],[{assignmentStatus:'inactive'},'assignment_inactive'],[{admissionStatus:'pending'},'admission_required'],[{rateUnit:'day'},'rate_unit_unsupported'],[{rateUnit:'month'},'rate_unit_unsupported'],[{explicitRate:null},'rate_required'],[{rateSource:'staff.hourly_rate'},'rate_required']];
    assert.equal(getPaidProfessionEligibility(person).available, true);
    for (const [override, blocker] of cases) {
        const result=getPaidProfessionEligibility({...person,...override});
        assert.equal(result.available,false);
        assert.equal(result.blocker,blocker);
        if (blocker !== 'rate_required') assert.doesNotMatch(result.reason,/немає.*ставки/);
    }
});
function scheduleContext(personOverride = {}, loadState = 'ready') {
    const assignment={...person,...personOverride};
    const state = {professionsLoadState:loadState,professions:[{key:'animator',people:[assignment]}]};
    const context=vm.createContext({StaffState:state,normalizeProfessionKey:value=>value});
    vm.runInContext(block('js/staff-page.js','scheduleExplicitProfessionRate'),context);
    return { context, state, assignment };
}
test('schedule consumes the server reason and restricted projections keep reasons without salary amounts', () => {
    const p={...person,admissionStatus:'pending'};
    p.paidRoleEligibility=getPaidProfessionEligibility(p);
    const projected=projectParkStaffSchedulePayload('hr','/professions',{success:true,data:[{key:'animator',people:[p]}]});
    assert.equal(projected.data[0].people[0].explicitRate,undefined);
    assert.equal(projected.data[0].people[0].paidRoleEligibility.blocker,'admission_required');
    const {context}=scheduleContext(projected.data[0].people[0]);
    const result=context.scheduleExplicitProfessionRate({id:7},'animator');
    assert.equal(result.reason,p.paidRoleEligibility.reason);
    assert.equal(result.code,p.paidRoleEligibility.code);
});
test('catalog loading and errors cannot masquerade as a missing rate even with cached data', () => {
    for (const loadState of ['loading','error']) {
        const {context}=scheduleContext({},loadState);
        const result=context.scheduleExplicitProfessionRate({id:7},'animator');
        assert.equal(result.available,false);
        assert.equal(result.code,'HR_SHIFT_PAID_ROLE_CATALOG_UNAVAILABLE');
        assert.doesNotMatch(result.reason,/немає.*ставки/);
    }
});
test('hidden configured hourly rate remains usable and pending admission is not a missing rate', () => {
    const {context}=scheduleContext({explicitRate:undefined,rateUnit:undefined,rateSource:undefined,hasExplicitHourlyRate:true});
    assert.equal(context.scheduleExplicitProfessionRate({id:7},'animator').available,true);
    const pending=scheduleContext({admissionStatus:'pending'}).context.scheduleExplicitProfessionRate({id:7},'animator');
    assert.match(pending.reason,/Допуск/);
    assert.equal(pending.code,'HR_SHIFT_PAID_ROLE_NOT_ALLOWED');
});
test('server validation uses the same precise reason as the catalog', async () => {
    for (const [override,blocker] of [[{status:'inactive'},'assignment_inactive'],[{admission_status:'pending'},'admission_required']]) {
        const row={staff_id:7,profession_key:'animator',status:'active',admission_status:'approved',rate_unit:'hour',staff_is_active:true,...override};
        const db={async query(sql) {
            if(sql.includes('FROM hr_compensation_policies')) return {rows:[{policy_version:'simultaneous-profession-pay-v1',compensation_mode:'paid_hourly',pay_multiplier:1,effective_from:'2026-07-18',status:'active'}]};
            if(sql.includes('FROM staff_role_assignments')) return {rows:[row]};
            if(sql.includes('FROM staff_profession_rates')) return {rows:[{staff_id:7,profession_key:'animator',hourly_rate:180}]};
            if(sql.startsWith('SELECT * FROM staff WHERE')) return {rows:[{id:7,role_type:'reception',rate_unit:'month',hourly_rate:30000,is_active:true}]};
            if(sql.includes('FROM staff_payroll_profile_assignments') || sql.includes('FROM payroll_profiles') || sql.includes('FROM payroll_day_exceptions') || sql.includes('FROM payroll_schemes')) return {rows:[]};
            assert.fail(sql);
        }};
        const context=await loadPaidRoleValidationContext(db,[7]);
        const plan=normalizeHrShiftDayPlan({primaryProfessionKey:'reception',segments:[{professionKey:'reception',shiftStart:'09:00',shiftEnd:'18:00',additionalRoles:[{professionKey:'animator',compensationMode:'paid_hourly',payMultiplier:1}]}]});
        assert.throws(()=>validatePaidAdditionalRoles(plan,7,'2026-10-03',context),error=>error.details.blocker===blocker);
    }
});
test('primary rate is visible; empty fields preserve rates and explicit removal is serialized', () => {
    const inputs=[];
    const target={innerHTML:'',querySelectorAll:()=>[]};
    const context=vm.createContext({document:{getElementById:id=>id==='editProfessionRates'?target:{value:'animator'},querySelectorAll:()=>inputs},normalizeProfessionKey:value=>value,staffProfessionRateMap:()=>new Map([['animator',180],['waiter',120]]),currentStaffProfessionKeysForEdit:()=>['animator','waiter'],escapeHtml:String,professionTitle:String});
    vm.runInContext(block('js/hr-page.js','renderStaffProfessionRatesEditor')+'\n'+block('js/hr-page.js','readStaffProfessionRates')+'\n'+block('js/hr-page.js','readStaffProfessionRateChanges'),context);
    context.renderStaffProfessionRatesEditor({id:7,role_type:'animator'});
    assert.match(target.innerHTML,/data-profession-rate="animator"/);
    assert.match(target.innerHTML,/data-remove-profession-rate="animator"/);
    inputs.push({dataset:{professionRate:'animator',originalRate:'180'},value:'180'},{dataset:{professionRate:'waiter',originalRate:'120'},value:''});
    assert.equal(context.readStaffProfessionRateChanges().length,0);
    inputs[1].dataset.rateRemoved='true';
    assert.deepEqual(JSON.parse(JSON.stringify(context.readStaffProfessionRateChanges())),[{profession_key:'waiter',remove:true}]);
});
test('both staff update entrypoints use preserving writes and form submits only changed rates', () => {
    const routes=fs.readFileSync(path.join(root,'routes/hr.js'),'utf8');
    assert.match(routes,/afterRateRows = await applyStaffProfessionRateChanges\(client, req.params.id, normalizedProfessionRates\)/);
    assert.match(routes,/await applyStaffProfessionRateChanges\(client, req.params.id, rateRows\)/);
    assert.match(block('js/hr-page.js','buildStaffRatesPayload'),/profession_rates: readStaffProfessionRateChanges\(\)/);
});
