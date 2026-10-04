'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getPaidProfessionEligibility } = require('../services/professions');
const { resolvePayrollConditions, payrollRateBlocker, exceptionKey } = require('../services/hrPayrollConditions');
const { normalizeHrShiftDayPlan, validatePaidAdditionalRoles } = require('../services/hrShiftSegments');

function profile(id, rate, from = '2026-01-01', to = null, unit = 'hour') {
    return { id, professionKey: 'animator', status: 'active', title: `Animator ${id}`,
        versions: [{ id: id * 10, rateUnit: unit, defaultRate: rate,
            effectiveFrom: from, effectiveTo: to, dayRates: new Map() }] };
}

function context() {
    const shared = profile(1, 150);
    const personal = profile(2, 180);
    const temporary = profile(3, 220);
    const otherPerson = profile(4, 260);
    return {
        staff: new Map([
            [7, { id: 7, role_type: 'reception', rate_unit: 'month', hourly_rate: 30000, is_active: true }],
            [8, { id: 8, role_type: 'reception', rate_unit: 'month', hourly_rate: 31000, is_active: true }]
        ]),
        profiles: { enabled: true, from: '2026-10-01', to: '2026-10-05',
            profilesById: new Map([[1, shared], [2, personal], [3, temporary], [4, otherPerson]]),
            defaultProfilesByProfession: new Map([['animator', shared]]),
            assignmentsByStaffProfession: new Map([
                ['7:animator', [
                    { id: 21, assignmentKind: 'explicit', effectiveFrom: '2026-10-02', effectiveTo: '2026-10-03', profile: personal },
                    { id: 22, assignmentKind: 'temporary', effectiveFrom: '2026-10-03', effectiveTo: '2026-10-03', profile: temporary }
                ]],
                ['8:animator', [{ id: 23, assignmentKind: 'explicit', effectiveFrom: '2026-01-01', profile: otherPerson }]]
            ]) },
        rates: new Map(), exceptions: new Map(), schemes: [],
        assignments: new Map([
            ['7:animator', { status: 'active', admission_status: 'approved' }],
            ['8:animator', { status: 'active', admission_status: 'approved' }]
        ])
    };
}

function plan() {
    return normalizeHrShiftDayPlan({ primaryProfessionKey: 'reception', segments: [{
        professionKey: 'reception', shiftStart: '09:00', shiftEnd: '18:00',
        additionalRoles: [{ professionKey: 'animator', compensationMode: 'paid_hourly', payMultiplier: 1 }]
    }] });
}

function saveValidation(payrollConditions, staffId, date) {
    return validatePaidAdditionalRoles(plan(), staffId, date, {
        payrollConditions,
        policies: [{ policyVersion: 'simultaneous-profession-pay-v1', compensationMode: 'paid_hourly',
            payMultiplier: 1, effectiveFrom: '2026-01-01', status: 'active' }]
    });
}

test('undated catalog defers rate decisions but still blocks missing admission', () => {
    const assignment = { hasPaidAssignment: true, isActive: true, assignmentStatus: 'active',
        admissionStatus: 'approved', deferRateCheck: true, explicitRate: null, rateUnit: 'month' };
    const deferred = getPaidProfessionEligibility(assignment);
    assert.equal(deferred.blocker, 'rate_check_pending');
    assert.doesNotMatch(deferred.reason, /немає.*ставки/i);
    assert.equal(getPaidProfessionEligibility({ ...assignment, admissionStatus: 'pending' }).blocker, 'admission_required');
    assert.equal(getPaidProfessionEligibility({ ...assignment, hasPaidAssignment: false }).blocker, 'assignment_missing');
});

test('dated save uses temporary, personal and profession rates without borrowing another person or the base wage', () => {
    const rates = context();
    const resolve = (staffId, date, purpose = 'additional') =>
        resolvePayrollConditions(rates, staffId, 'animator', date, purpose);
    assert.equal(resolve(7, '2026-10-01').rate, 150);
    assert.equal(resolve(7, '2026-10-02').rate, 180);
    assert.equal(resolve(7, '2026-10-03').rate, 220);
    assert.equal(resolve(7, '2026-10-04').rate, 150);
    assert.equal(resolve(8, '2026-10-03').rate, 260);
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) {
        assert.doesNotThrow(() => saveValidation(rates, 7, date));
    }
    assert.equal(resolvePayrollConditions(rates, 7, 'waiter', '2026-10-03', 'additional').rate, 0);
    assert.equal(resolvePayrollConditions(rates, 7, 'reception', '2026-10-03').rate, 30000);
});

test('one-day additional exception changes only its date and purpose', () => {
    const rates = context();
    rates.exceptions.set(exceptionKey(7, 'animator', '2026-10-03', 'additional'),
        { id: 99, state: 'active', rate: 320, rateUnit: 'day', version: 1, reason: 'One-day event', createdBy: 'hr' });
    const changed = resolvePayrollConditions(rates, 7, 'animator', '2026-10-03', 'additional');
    assert.equal(changed.rate, 320);
    assert.equal(changed.rateUnit, 'day');
    assert.equal(changed.sourceOrder, 'day_exception');
    assert.equal(changed.effectiveFrom, '2026-10-03');
    assert.equal(resolvePayrollConditions(rates, 7, 'animator', '2026-10-02', 'additional').rate, 180);
    assert.equal(resolvePayrollConditions(rates, 7, 'animator', '2026-10-03', 'base_replacement').rate, 220);
    assert.doesNotThrow(() => saveValidation(rates, 7, '2026-10-03'));
    assert.equal(rates.profiles.profilesById.get(3).versions[0].defaultRate, 220);
});

test('missing, zero, unapproved and inactive-version rates cannot pass save', () => {
    const rates = context();
    rates.profiles.defaultProfilesByProfession.clear();
    rates.profiles.assignmentsByStaffProfession.clear();
    const missing = resolvePayrollConditions(rates, 7, 'animator', '2026-10-03', 'additional');
    assert.equal(missing.rate, 0);
    assert.equal(payrollRateBlocker(missing).code, 'rate_missing');
    assert.throws(() => saveValidation(rates, 7, '2026-10-03'), e => e.details?.blocker === 'rate_missing');

    rates.profiles.defaultProfilesByProfession.set('animator', profile(5, 0));
    assert.equal(payrollRateBlocker(resolvePayrollConditions(rates, 7, 'animator', '2026-10-03', 'additional')).code, 'rate_missing');
    assert.throws(() => saveValidation(rates, 7, '2026-10-03'), e => e.details?.blocker === 'rate_missing');

    rates.profiles.defaultProfilesByProfession.set('animator', profile(6, 150));
    rates.profiles.assignmentsByStaffProfession.set('7:animator', [{ id: 61, assignmentKind: 'explicit',
        effectiveFrom: '2026-01-01', profile: profile(7, 250, '2026-10-04') }]);
    const stale = resolvePayrollConditions(rates, 7, 'animator', '2026-10-03', 'additional');
    assert.equal(stale.rate, 150, 'lower-precedence rate exists');
    assert.equal(payrollRateBlocker(stale).code, 'profile_inactive');
    assert.throws(() => saveValidation(rates, 7, '2026-10-03'), e => e.details?.blocker === 'profile_inactive');

    rates.assignments.get('7:animator').admission_status = 'pending';
    assert.throws(() => saveValidation(rates, 7, '2026-10-03'), e => e.details?.blocker === 'admission_required');
});

function extract(name) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js/staff-page.js'), 'utf8');
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('schedule shows dated rate basis and unit only with payroll view rights', () => {
    const terms = { rate: 150, rateUnit: 'hour', sourceOrder: 'default_profile', rateSource: 'payroll_profile.default.default_rate' };
    const state = { professionsLoadState: 'ready', editingCell: { dayPay: {} } };
    let visible = true;
    let entry = { state: 'ready', data: { available: true, conditions: terms } };
    const c = vm.createContext({ StaffState: state, schedulePlanStaff: () => [{ id: 7 }],
        scheduleCanViewPayrollAmounts: () => visible, scheduleDayPayEntry: () => entry,
        scheduleExplicitProfessionRate: () => ({ available: false, code: 'HR_SHIFT_PAID_ROLE_RATE_CHECK_PENDING' }),
        isScheduleRecoveryReadOnly: () => false, scheduleFormatMoney: String, escapeHtml: String });
    for (const name of ['schedulePaidRoleRate', 'scheduleDayPaySource', 'scheduleDayPayUnit', 'schedulePaidRoleOptions']) {
        vm.runInContext(extract(name), c);
    }
    const options = [{ value: 'animator', label: 'Аніматор' }];
    const segment = { professionKey: 'reception', additionalRoles: [] };
    assert.match(c.schedulePaidRoleOptions('schedule', options, segment), /150 грн\/год · Умови професії/);
    terms.rate = 500;
    terms.rateUnit = 'day';
    assert.match(c.schedulePaidRoleOptions('schedule', options, segment), /500 грн\/вихід · Умови професії/);
    terms.rate = 6000;
    terms.rateUnit = 'month';
    assert.match(c.schedulePaidRoleOptions('schedule', options, segment), /6000 грн\/місяць · Умови професії/);
    entry = { state: 'ready', data: { available: false,
        conditions: { rate: 0, rateUnit: 'hour' },
        blocker: { code: 'rate_missing', message: 'Немає чинної ставки' } } };
    assert.equal(c.schedulePaidRoleRate('schedule', 'animator').code, 'rate_missing');
    assert.match(c.schedulePaidRoleOptions('schedule', options, segment), /Немає чинної ставки/);
    assert.doesNotMatch(c.schedulePaidRoleOptions('schedule', options, segment), /0 грн/);
    entry = null;
    assert.doesNotMatch(c.schedulePaidRoleOptions('schedule', options, segment), /немає явної ставки|6000/);
    visible = false;
    assert.equal(c.schedulePaidRoleRate('schedule', 'animator').pendingServerValidation, true);
    assert.doesNotMatch(c.schedulePaidRoleOptions('schedule', options, segment), /6000/);
    assert.equal(c.scheduleDayPayUnit('day'), 'грн/вихід');
    assert.equal(c.scheduleDayPayUnit('month'), 'грн/місяць');
});
