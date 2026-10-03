'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePayrollConditions, validateExceptionInput, exceptionKey, CONDITION_RULE_VERSION } = require('../services/hrPayrollConditions');
const { calculateConditionSnapshots } = require('../services/payrollConditionCalculation');

const date = '2026-10-03';
function fixture() {
    const profile = { id: 1, professionKey: 'animator', status: 'active', title: 'Default', versions: [
        { id: 11, rateUnit: 'hour', defaultRate: 150, effectiveFrom: '2026-01-01', effectiveTo: null, dayRates: new Map() }] };
    return { staff: new Map([[7, { id: 7, role_type: 'reception', rate_unit: 'month', hourly_rate: 30000 }]]),
        profiles: { enabled: true, from: date, to: date, profilesById: new Map([[1, profile]]), defaultProfilesByProfession: new Map([['animator', profile]]), assignmentsByStaffProfession: new Map() },
        rates: new Map(), exceptions: new Map(), schemes: [], assignments: new Map() };
}
test('additional hourly profile is independent of monthly base; no base wage fallback for another profession', () => {
    const context = fixture();
    assert.equal(resolvePayrollConditions(context, 7, 'animator', date, 'additional').rate, 150);
    assert.equal(resolvePayrollConditions(context, 7, 'waiter', date, 'additional').rate, 0);
    assert.equal(resolvePayrollConditions(context, 7, 'reception', date).rateUnit, 'month');
});
test('day exception overrides temporary, personal and default only on its exact date and purpose', () => {
    const context = fixture();
    const profile = context.profiles.profilesById.get(1);
    const make = (id, rate) => ({ ...profile, id, versions: [{ ...profile.versions[0], id: id * 10, defaultRate: rate }] });
    context.profiles.assignmentsByStaffProfession.set('7:animator', [
        { id: 1, assignmentKind: 'explicit', effectiveFrom: '2026-01-01', profile: make(2, 200) },
        { id: 2, assignmentKind: 'temporary', effectiveFrom: date, effectiveTo: date, profile: make(3, 250) }]);
    const resolve = day => resolvePayrollConditions(context, 7, 'animator', day, 'additional');
    assert.equal(resolve(date).rate, 250);
    context.exceptions.set(exceptionKey(7, 'animator', date, 'additional'), { id: 6, state: 'active', rate: 300, rateUnit: 'hour', version: 1, reason: 'Extra work' });
    assert.equal(resolve(date).rate, 300);
    assert.equal(resolve('2026-10-02').rate, 200);
    assert.equal(resolve('2026-10-04').rate, 200);
    assert.equal(resolvePayrollConditions(context, 7, 'animator', date, 'base_replacement').rate, 250);
});
test('invalid exception amount, date, monthly unit, missing reason or version fails before database work', () => {
    const payload = { staffId: 7, professionKey: 'animator', workDate: date, purpose: 'additional', expectedVersion: 0,
        rate: 180, rateUnit: 'hour', reason: 'Replacement', idempotencyKey: 'hr-pay-test-01' };
    assert.equal(validateExceptionInput(payload).rate, 180);
    for (const override of [{ rate: 0 }, { rate: 0.001 }, { rateUnit: 'month' }, { workDate: '2026-02-30' }, { reason: '' }, { expectedVersion: undefined }]) {
        assert.throws(() => validateExceptionInput({ ...payload, ...override }));
    }
});
function allocation(professionKey, rateUnit, rate, minutes, extra = {}) {
    return { allocationType: 'base', professionKey, actualMinutes: minutes, plannedMinutes: minutes, overtimeMinutes: 0,
        conditions: { ruleVersion: CONDITION_RULE_VERSION, rate, rateUnit, rateSource: 'frozen_test', ...extra.conditions }, ...extra };
}
function day(allocations, workDate = date) {
    return { date: workDate, attendanceRef: 1, worked: true, paidPlannedFactor: 1,
        snapshot: { schemaVersion: 2, state: 'final', compensationAllocations: allocations } };
}
test('hourly base and daily additional role preserve physical time and pay the daily rate once across blocks', () => {
    const additional = { allocationType: 'simultaneous_additional' };
    const result = calculateConditionSnapshots({ conditionDays: [day([
        allocation('reception', 'hour', 100, 210), allocation('animator', 'day', 500, 210, additional),
        allocation('reception', 'hour', 100, 240), allocation('animator', 'day', 500, 240, additional)])] }, 1.5);
    assert.equal(result.baseAmount, 750);
    assert.equal(result.additionalAmount, 500);
    assert.equal(result.additionalLines.length, 1);
    assert.deepEqual(result.blockingIssues, []);
});
test('monthly base and permanent additional month are prorated once from frozen norms across days and blocks', () => {
    const norm = { monthlyNormMinutes: 9600, monthlyNormMonth: '2026-10', monthlyNormConfirmed: true, monthlyNormSource: 'approved_schedule' };
    const base = () => allocation('reception', 'month', 30000, 240);
    const extra = () => allocation('animator', 'month', 6000, 240, { allocationType: 'simultaneous_additional' });
    const allocations = () => [base(), base(), extra(), extra()].map(row => ({ ...row, conditions: { ...row.conditions, monthlyNorm: norm } }));
    const result = calculateConditionSnapshots({ conditionDays: [day(allocations()), day(allocations(), '2026-10-04')] }, 1.5);
    assert.equal(result.baseAmount, 3000);
    assert.equal(result.additionalAmount, 600);
    assert.equal(result.baseLines.length, 1);
    assert.equal(result.additionalLines.length, 1);
});
test('missing or conflicting snapshots block historical calculation instead of reading current rates', () => {
    const missing = calculateConditionSnapshots({ conditionDays: [{ date, worked: true, snapshot: { schemaVersion: 1 } }] }, 1.5);
    assert.equal(missing.baseAmount, 0);
    assert.equal(missing.blockingIssues[0].code, 'PAYROLL_BASE_SNAPSHOT_REQUIRED');
    const conflicting = calculateConditionSnapshots({ conditionDays: [day([allocation('animator', 'day', 500, 120), allocation('animator', 'day', 700, 120)])] }, 1.5);
    assert.equal(conflicting.baseAmount, 0);
    assert.ok(conflicting.blockingIssues.some(row => row.code === 'PAYROLL_CONDITION_CHANGE_POLICY_REQUIRED'));
});
test('unpaid absence does not accrue a daily exit or monthly planned share', () => {
    const absent = day([allocation('reception', 'day', 500, 0)]);
    absent.worked = false; absent.paidPlannedFactor = 0;
    assert.equal(calculateConditionSnapshots({ conditionDays: [absent] }, 1.5).totalAmount, 0);
});

test('monthly primary profile is never reused as a day top-up', () => {
    const context = fixture();
    const monthly = { id: 4, professionKey: 'reception', status: 'active', versions: [
        { id: 40, rateUnit: 'month', defaultRate: 30000, effectiveFrom: '2026-01-01', dayRates: new Map() }] };
    context.profiles.defaultProfilesByProfession.set('reception', monthly);
    assert.equal(resolvePayrollConditions(context, 7, 'reception', date).rate, 30000);
    assert.equal(resolvePayrollConditions(context, 7, 'reception', date, 'additional').rate, 0);
    context.exceptions.set(exceptionKey(7, 'reception', date, 'additional'), { state: 'active', rate: 250, rateUnit: 'day' });
    const extra = resolvePayrollConditions(context, 7, 'reception', date, 'additional');
    assert.equal(extra.rate, 250); assert.equal(extra.rateUnit, 'day'); assert.deepEqual(extra.warnings, []);
    assert.equal(resolvePayrollConditions(context, 7, 'reception', date).rate, 30000);
});

test('reporting lists a daily supplement once even when two physical blocks share that day', () => {
    const allocations = [allocation('animator', 'day', 500, 210, { allocationType: 'simultaneous_additional', segmentId: 1 }),
        allocation('animator', 'day', 500, 240, { allocationType: 'simultaneous_additional', segmentId: 2 }), allocation('reception', 'hour', 100, 450)];
    const metrics = { physicalMinutes: 450, conditionDays: [day(allocations)], additionalProfessionAllocations: [
        { professionKey: 'animator', minutes: 210, attendanceRef: 1, segmentRef: 1, date },
        { professionKey: 'animator', minutes: 240, attendanceRef: 1, segmentRef: 2, date }] };
    const pay = calculateConditionSnapshots(metrics, 1.5);
    const report = require('../services/payroll').buildPayrollTransparencyMetrics(metrics, pay);
    assert.equal(report.additionalAmount, 500);
    assert.equal(report.additionalRoles.length, 1);
    assert.equal(report.additionalRoles[0].amount, 500);
    assert.equal(report.additionalRoles[0].rateUnit, 'day');
});

test('disabled salary scheme cannot replace the base unit or provide a monthly denominator', () => {
    const context=fixture();
    context.schemes=[{staff_id:7,is_active:false,scheme_type:'per_shift',effective_from:'2026-01-01',
        config_json:{perShiftRate:9000,monthlyNormConfirmed:true,monthlyNormMinutes:9600,monthlyNormMonth:'2026-10',monthlyNormSource:'disabled'}}];
    const result=resolvePayrollConditions(context,7,'reception',date);
    assert.equal(result.rate,30000);assert.equal(result.rateUnit,'month');
    assert.equal(result.monthlyNorm.monthlyNormConfirmed,false);
});

test('blocked additional payroll details retain the snapshot unit instead of assuming hourly pay', () => {
    const {buildPayrollTransparencyMetrics}=require('../services/payroll');
    for(const rateUnit of ['day','month']){
        const result=buildPayrollTransparencyMetrics({physicalMinutes:330,additionalProfessionAllocations:[
            {professionKey:'animator',rate:500,rateUnit,minutes:330,payMultiplier:1}]},
        {blockingIssues:[{code:'PAYROLL_CONDITION_REVIEW_REQUIRED',professionKey:'animator'}]});
        assert.equal(result.additionalRoles[0].rateUnit,rateUnit);
        assert.equal(result.additionalRoles[0].status,'blocked');
        assert.equal(result.additionalRoles[0].amount,null);
    }
});
