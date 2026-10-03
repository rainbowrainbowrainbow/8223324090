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
