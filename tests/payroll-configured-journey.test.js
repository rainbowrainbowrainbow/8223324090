'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProfessionPay, calculateMonthlyPayroll, calculateAdvanceInstallment, resolveEffectivePayrollProfile } = require('../services/payroll');
const { calculateConditionSnapshots } = require('../services/payrollConditionCalculation');
const { CONDITION_RULE_VERSION, resolvePayrollConditions } = require('../services/hrPayrollConditions');
const { simulateProfileAmount, buildPayrollProfileVersionDiff, mergePayrollProfileSyncVersion } = require('../services/hrPayrollProfiles');

function fixture(unit = 'month', rate = 19000, rules = { schemaVersion: 1, monthly: { mode: 'fixed' } }) {
    const staff = { id: 7, roleType: 'animator', role_type: 'animator', rateUnit: unit, hireDate: '2020-01-01' };
    const version = { id: 11, profileId: 1, versionNumber: 1, rateUnit: unit, defaultRate: rate,
        effectiveFrom: '2026-01-01', effectiveTo: null, dayRates: new Map(), payRules: rules };
    const profile = { id: 1, professionKey: 'animator', status: 'active', title: 'Synthetic profile', versions: [version] };
    const context = { enabled: true, from: '2026-11-01', to: '2026-11-30', profilesById: new Map([[1, profile]]),
        defaultProfilesByProfession: new Map([['animator', profile]]), assignmentsByStaffProfession: new Map() };
    const scheme = { schemeType: unit === 'month' ? 'monthly_fixed' : unit === 'day' ? 'per_shift' : 'hourly', config: {} };
    return { staff, version, profile, context, scheme };
}

test('installment ranges retain monthly base continuity when an independent component changes', () => {
    const f = fixture('month', 19000, { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [
        { id: 'ads', title: 'Advertising', kind: 'monthly', amount: 6000, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } }
    ] });
    f.version.effectiveTo = '2026-11-15';
    f.profile.versions.push({ ...f.version, id: 12, effectiveFrom: '2026-11-16', effectiveTo: null,
        payRules: { ...structuredClone(f.version.payRules), note: 'Administrative change', components: [
            { ...f.version.payRules.components[0], amount: 8000 }
        ] } });
    for (const [from, to, expected] of [['2026-11-01', '2026-11-15', 12500], ['2026-11-16', '2026-11-30', 13500]]) {
        const pay = calculateProfessionPay(f.staff, f.scheme, { periodFrom: from, periodTo: to }, new Map(), f.context);
        assert.equal(pay.baseAmount, 9500);
        assert.equal(pay.totalAmount, expected);
        assert.deepEqual(pay.blockingIssues, []);
        const simulation = simulateProfileAmount(f.profile, { from, to, days: [] });
        assert.equal(simulation.total, expected);
        assert.deepEqual(simulation.blockingIssues, []);
    }
});

test('future configured terms do not replace a legacy-only requested range', () => {
    const f = fixture();
    f.version.payRules = null;
    f.version.effectiveTo = '2026-11-15';
    f.profile.versions.push({ ...f.version, id: 12, effectiveFrom: '2026-11-16', effectiveTo: null,
        payRules: { schemaVersion: 1, monthly: { mode: 'fixed' } } });
    const pay = calculateProfessionPay(f.staff, f.scheme, { periodFrom: '2026-11-01', periodTo: '2026-11-15' }, new Map(), f.context);
    assert.ok(pay.blockingIssues.some(issue => issue.code === 'PAYROLL_MONTHLY_NORM_REQUIRED'));
    assert.notEqual(pay.configuredRules, true);
});

test('components active outside an installment neither accrue money nor request unrelated commission bases', () => {
    const f = fixture('month', 19000, { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [
        { id: 'own', title: 'Own bookings', kind: 'percent', percent: 4, basisKey: 'own_bookings' },
        { id: 'ads', title: 'Advertising', kind: 'monthly', amount: 6000, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } }
    ] });
    f.version.effectiveTo = '2026-11-15';
    f.profile.versions.push({ ...f.version, id: 12, effectiveFrom: '2026-11-16', effectiveTo: null,
        payRules: { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [] } });
    const pay = calculateProfessionPay(f.staff, f.scheme, { periodFrom: '2026-11-16', periodTo: '2026-11-30' }, new Map(), f.context);
    assert.equal(pay.totalAmount, 9500);
    assert.equal(pay.additionalAmount, 0);
    assert.deepEqual(pay.blockingIssues, []);
});

test('canonical payroll accrues a fixed salary without attendance and removes obsolete norm blockers', () => {
    const f = fixture();
    const metrics = { periodFrom: f.context.from, periodTo: f.context.to };
    const pay = calculateProfessionPay(f.staff, f.scheme, metrics, new Map(), f.context);
    assert.equal(pay.baseAmount, 19000);
    assert.deepEqual(pay.blockingIssues, []);
    const calculation = calculateMonthlyPayroll(f.staff, f.scheme, metrics, {}, [], pay);
    assert.equal(calculation.summary.net, 19000);
    assert.deepEqual(calculation.blockers, []);
    const firstContext = { ...f.context, to: '2026-11-15' };
    const advancePay = calculateProfessionPay(f.staff, f.scheme, {}, new Map(), firstContext);
    const advance = calculateAdvanceInstallment({ staff: f.staff, scheme: f.scheme,
        rangeProfessionPay: advancePay, advanceMetrics: { periodFrom: firstContext.from, periodTo: firstContext.to } });
    assert.equal(advance.amount, 9500);
    assert.deepEqual(advance.blockers, []);
});

test('new policies travel through dated resolution and future edits cannot alter captured conditions', () => {
    const f = fixture('day', 600, { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 600 } });
    const resolution = resolveEffectivePayrollProfile(f.staff, 'animator', '2026-11-03', { payrollProfileContext: f.context });
    assert.equal(resolution.payRules.daily.fullDayMinutes, 600);
    f.version.payRules.daily.fullDayMinutes = 900;
    assert.equal(resolution.payRules.daily.fullDayMinutes, 600);
    const context = { staff: new Map([[7, f.staff]]), profiles: f.context, rates: new Map(), exceptions: new Map(), schemes: [] };
    assert.equal(resolvePayrollConditions(context, 7, 'animator', '2026-11-03').payRules.daily.fullDayMinutes, 900);
});

test('two short blocks share one daily norm and a monthly supplement is paid once across dates', () => {
    const rules = { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 600 }, components: [
        { id: 'advertising', title: 'Advertising', kind: 'monthly', amount: 3500, monthly: { mode: 'fixed' } }
    ] };
    const f = fixture('day', 600, rules);
    const conditions = { ...resolveEffectivePayrollProfile(f.staff, 'animator', '2026-11-03', { payrollProfileContext: f.context }), ruleVersion: CONDITION_RULE_VERSION };
    const allocation = minutes => ({ allocationType: 'base', professionKey: 'animator', actualMinutes: minutes, plannedMinutes: minutes, overtimeMinutes: 0, conditions });
    const day = date => ({ date, worked: true, paidPlannedFactor: 1,
        snapshot: { schemaVersion: 2, state: 'final', compensationAllocations: [allocation(100), allocation(200)] } });
    const result = calculateConditionSnapshots({ periodFrom: f.context.from, periodTo: f.context.to,
        conditionDays: [day('2026-11-03'), day('2026-11-04')] }, 1.5);
    assert.equal(result.baseAmount, 600);
    assert.equal(result.additionalAmount, 3500);
    assert.equal(result.additionalLines.length, 1);
    assert.deepEqual(result.blockingIssues, []);
});

test('new fixed profile cannot silently overwrite old frozen attendance or create approved mixed historical pay', () => {
    const f = fixture();
    const old = { date: '2026-11-03', worked: true, paidPlannedFactor: 1,
        snapshot: { schemaVersion: 2, state: 'final', compensationAllocations: [{ allocationType: 'base', professionKey: 'animator',
            actualMinutes: 480, plannedMinutes: 480, conditions: { ruleVersion: CONDITION_RULE_VERSION, rateUnit: 'day', rate: 600 } }] } };
    const before = structuredClone(old);
    const pay = calculateProfessionPay(f.staff, f.scheme, { conditionDays: [old] }, new Map(), f.context);
    assert.ok(pay.blockingIssues.some(issue => issue.code === 'PAYROLL_RULES_FROZEN_HISTORY_CONFLICT'));
    assert.deepEqual(old, before);
});

test('simulation uses the same monthly and short-day calculation as payroll', () => {
    const f = fixture();
    f.profile.versions[0].dayRates = [];
    const simulated = simulateProfileAmount(f.profile, { from: '2026-11-01', to: '2026-11-30', days: [] });
    assert.equal(simulated.total, 19000);
    assert.equal(simulated.ready, true);
    const d = fixture('day', 600, { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 600 } });
    d.profile.versions[0].dayRates = [];
    const daily = simulateProfileAmount(d.profile, { from: '2026-11-01', to: '2026-11-30', days: [{ date: '2026-11-03', minutes: 300 }] });
    assert.equal(daily.total, 300);
    assert.equal(daily.ready, true);
});

test('personal clone comparison and explicit synchronization include rules instead of dropping them', () => {
    const f = fixture();
    const base = { rateUnit: 'month', defaultRate: 19000, dayRates: [], payRules: f.version.payRules };
    const personal = { ...base, payRules: { schemaVersion: 1, monthly: { mode: 'norm_days', norm: { month: '2026-11', value: 20, confirmed: true, source: 'Synthetic norm' } } } };
    assert.ok(buildPayrollProfileVersionDiff(personal, base).fields.some(field => field.field === 'pay_rules'));
    const preserved = mergePayrollProfileSyncVersion(personal, base, new Set(['default_rate']));
    assert.deepEqual(preserved.payRules, personal.payRules);
    const synced = mergePayrollProfileSyncVersion(personal, base, new Set(['pay_rules']));
    assert.deepEqual(synced.payRules, base.payRules);
    const reset = mergePayrollProfileSyncVersion(personal, { ...base, payRules: null }, new Set(['pay_rules']));
    assert.equal(reset.payRules, null);
});

test('dated personal salary replaces only its interval, while unchanged copied monthly components accrue once', () => {
    const rules = { schemaVersion: 1, monthly: { mode: 'fixed', partialMonth: 'calendar_days' }, components: [
        { id: 'advertising', title: 'Advertising', kind: 'monthly', amount: 3500, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } }
    ] };
    const f = fixture('month', 30000, rules);
    const personal = { ...f.profile, id: 2, title: 'Personal salary', versions: [{ ...f.version, id: 22, profileId: 2, defaultRate: 40000 }] };
    f.context.profilesById.set(2, personal);
    f.context.assignmentsByStaffProfession.set('7:animator', [{ id: 3, assignmentKind: 'explicit', effectiveFrom: '2026-11-16', effectiveTo: null, profile: personal }]);
    const pay = calculateProfessionPay(f.staff, f.scheme, {}, new Map(), f.context);
    assert.equal(pay.baseAmount, 35000);
    assert.equal(pay.additionalAmount, 3500);
    assert.equal(pay.additionalLines.length, 1);
    assert.deepEqual(pay.blockingIssues, []);
});

test('removing a recurring component mid-month cannot extend an old open snapshot over the remaining dates', () => {
    const rules = { schemaVersion: 1, monthly: { mode: 'fixed', partialMonth: 'calendar_days' }, components: [
        { id: 'advertising', title: 'Advertising', kind: 'monthly', amount: 6000, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } }
    ] };
    const f = fixture('month', 30000, rules);
    f.version.effectiveTo = '2026-11-15';
    f.profile.versions.push({ ...f.version, id: 12, versionNumber: 2, effectiveFrom: '2026-11-16', effectiveTo: null,
        payRules: { schemaVersion: 1, monthly: { mode: 'fixed', partialMonth: 'calendar_days' }, components: [] } });
    const pay = calculateProfessionPay(f.staff, f.scheme, {}, new Map(), f.context);
    assert.equal(pay.baseAmount, 30000);
    assert.equal(pay.additionalAmount, 3000);
    assert.deepEqual(pay.blockingIssues, []);
});

test('a new version with identical fixed pay rules does not halve the salary at its version boundary', () => {
    const f = fixture('month', 30000, { schemaVersion: 1, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } });
    f.version.effectiveTo = '2026-11-15';
    f.profile.versions.push({ ...f.version, id: 12, versionNumber: 2, effectiveFrom: '2026-11-16', effectiveTo: null });
    const pay = calculateProfessionPay(f.staff, f.scheme, {}, new Map(), f.context);
    assert.equal(pay.baseAmount, 30000);
    assert.deepEqual(pay.blockingIssues, []);
});

test('changing a non-monetary note mid-month preserves fixed salary and dated version evidence', () => {
    const f = fixture('month', 19000, { schemaVersion: 1, monthly: { mode: 'fixed' }, note: 'Original note' });
    f.version.effectiveTo = '2026-11-15';
    f.profile.versions.push({ ...f.version, id: 12, versionNumber: 2, effectiveFrom: '2026-11-16', effectiveTo: null,
        payRules: { ...structuredClone(f.version.payRules), note: 'Tips remain outside payroll' } });
    const pay = calculateProfessionPay(f.staff, f.scheme, {}, new Map(), f.context);
    assert.equal(pay.baseAmount, 19000);
    assert.deepEqual(pay.blockingIssues, []);
    assert.deepEqual([...new Set(pay.baseLines.flatMap(line => line.meta.refs.map(ref => ref.profileVersionId)))].sort(), [11, 12]);
});

test('a dated component amount change does not turn an unchanged fixed base into a partial contract', () => {
    const f = fixture('month', 19000, { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [
        { id: 'advertising', title: 'Advertising', kind: 'monthly', amount: 6000, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } }
    ] });
    f.version.effectiveTo = '2026-11-15';
    const next = structuredClone(f.version.payRules);
    next.components[0].amount = 8000;
    f.profile.versions.push({ ...f.version, id: 12, versionNumber: 2, effectiveFrom: '2026-11-16', effectiveTo: null, payRules: next });
    const pay = calculateProfessionPay(f.staff, f.scheme, {}, new Map(), f.context);
    assert.equal(pay.baseAmount, 19000);
    assert.equal(pay.additionalAmount, 7000);
    assert.deepEqual(pay.blockingIssues, []);
});

test('renaming a recurring component preserves its amount and does not require a partial-month pay decision', () => {
    const f = fixture('month', 19000, { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [
        { id: 'advertising', title: 'Old advertising label', kind: 'monthly', amount: 3500, monthly: { mode: 'fixed' } }
    ] });
    f.version.effectiveTo = '2026-11-15';
    const next = structuredClone(f.version.payRules);
    next.components[0].title = 'Updated advertising label';
    f.profile.versions.push({ ...f.version, id: 12, versionNumber: 2, effectiveFrom: '2026-11-16', effectiveTo: null, payRules: next });
    const pay = calculateProfessionPay(f.staff, f.scheme, {}, new Map(), f.context);
    assert.equal(pay.baseAmount, 19000);
    assert.equal(pay.additionalAmount, 3500);
    assert.deepEqual(pay.blockingIssues, []);
});

test('removing a component respects dated coverage even when older frozen captures still have an open end', () => {
    const f = fixture('month', 19000, { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [
        { id: 'advertising', title: 'Advertising', kind: 'monthly', amount: 6000, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } }
    ] });
    f.version.effectiveTo = '2026-11-15';
    f.profile.versions.push({ ...f.version, id: 12, versionNumber: 2, effectiveFrom: '2026-11-16', effectiveTo: null,
        payRules: { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [] } });
    const conditionDays = Array.from({ length: 15 }, (_, index) => {
        const date = `2026-11-${String(index + 1).padStart(2, '0')}`;
        const terms = resolveEffectivePayrollProfile(f.staff, 'animator', date, { payrollProfileContext: f.context });
        return { date, worked: false, snapshot: { schemaVersion: 2, state: 'final', compensationAllocations: [
            { allocationType: 'base', professionKey: 'animator', actualMinutes: 0, plannedMinutes: 0,
                conditions: { ...terms, effectiveTo: null, ruleVersion: CONDITION_RULE_VERSION } }
        ] } };
    });
    const pay = calculateProfessionPay(f.staff, f.scheme, { conditionDays }, new Map(), f.context);
    assert.equal(pay.baseAmount, 19000);
    assert.equal(pay.additionalAmount, 3000);
    assert.deepEqual(pay.blockingIssues, []);
});

test('a forecast range crossing month-end allocates each monthly contract within its own earning month', () => {
    const f = fixture('month', 19000, { schemaVersion: 1, monthly: { mode: 'fixed' }, components: [
        { id: 'advertising', title: 'Advertising', kind: 'monthly', amount: 3500, monthly: { mode: 'fixed' } }
    ] });
    f.context.from = '2026-11-16'; f.context.to = '2026-12-15';
    const pay = calculateProfessionPay(f.staff, f.scheme, {}, new Map(), f.context);
    assert.equal(pay.baseAmount, 18694);
    assert.equal(pay.additionalAmount, 3444);
    assert.equal(pay.totalAmount, 22138);
    assert.deepEqual(pay.blockingIssues, []);
});
