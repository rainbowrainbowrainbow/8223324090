'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePayRules, calculateConfiguredRate, calculateConfiguredComponents, calendarPortion } = require('../services/payrollRules');
const fixed = { schemaVersion: 1, monthly: { mode: 'fixed', partialMonth: 'review' } };
const terms = (rateUnit, rate, payRules) => ({ rateUnit, rate, payRules });
const period = month => ({ month, periodFrom: month + '-01', periodTo: month + '-' + new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate() });
const monthPay = (month, overrides = {}) => calculateConfiguredRate(terms('month', 19000, fixed), { ...period(month), ...overrides });

test('fixed full-month entitlement does not depend on exits, attendance minutes or working-day count', () => {
    for (const month of ['2026-02', '2026-03', '2026-11', '2028-02']) {
        const result = monthPay(month, { actualMinutes: 0, paidPlannedMinutes: 0, paidDays: 0 });
        assert.equal(result.amount, 19000, month);
        assert.deepEqual(result.blockingIssues, []);
    }
});

test('fixed query ranges partition the monthly amount exactly, including leap months and odd salaries', () => {
    for (const month of ['2026-02', '2026-11', '2028-02']) {
        const p = period(month);
        const first = calculateConfiguredRate(terms('month', 19001, fixed), { ...p, periodTo: month + '-15' });
        const final = calculateConfiguredRate(terms('month', 19001, fixed), { ...p, periodFrom: month + '-16' });
        assert.equal(first.amount + final.amount, 19001);
        let daily = 0;
        for (let day = 1; day <= Number(p.periodTo.slice(8)); day++) {
            const d = month + '-' + String(day).padStart(2, '0');
            daily += calendarPortion(19001, d, d, month);
        }
        assert.equal(daily, 19001);
    }
});

test('hiring, termination and mid-month rate changes require an explicit partial-month decision', () => {
    for (const key of ['effectiveFrom', 'hireDate']) {
        assert.equal(monthPay('2026-11', { [key]: '2026-11-10' }).blockingIssues[0].code, 'PAYROLL_FIXED_PARTIAL_MONTH_REVIEW_REQUIRED');
    }
    assert.equal(monthPay('2026-11', { terminationDate: '2026-11-20' }).blockingIssues[0].code, 'PAYROLL_FIXED_PARTIAL_MONTH_REVIEW_REQUIRED');
    const configured = { ...fixed, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } };
    const result = calculateConfiguredRate(terms('month', 30000, configured), { ...period('2026-11'), hireDate: '2026-11-16' });
    assert.equal(result.amount, 15000);
    assert.equal(monthPay('2026-11', { effectiveFrom: '2026-12-01' }).amount, 0);
    assert.equal(monthPay('2026-11', { leaveReviewRequired: true }).blockingIssues[0].code, 'PAYROLL_FIXED_LEAVE_REVIEW_REQUIRED');
});

test('norm minutes and norm days are separate explicit policies and missing norms never appear as approved zero', () => {
    for (const [mode, value, input] of [['norm_minutes', 9600, { paidPlannedMinutes: 4800 }], ['norm_days', 22, { paidDays: 11 }]]) {
        const payRules = { schemaVersion: 1, monthly: { mode, norm: { month: '2026-11', value, source: 'Approved synthetic norm', confirmed: true } } };
        const result = calculateConfiguredRate(terms('month', 30000, payRules), { ...period('2026-11'), ...input });
        assert.equal(result.amount, 15000);
        assert.deepEqual(result.blockingIssues, []);
        assert.equal(calculateConfiguredRate(terms('month', 30000, payRules), period('2026-12')).blockingIssues[0].code, 'PAYROLL_MONTHLY_NORM_REQUIRED');
        assert.equal(calculateConfiguredRate(terms('month', 30000, payRules), period('2026-11')).blockingIssues[0].code, 'PAYROLL_MONTHLY_NORM_INVALID');
    }
});

test('short-day policy uses the configured paid duration; full-exit policy retains its different meaning', () => {
    const perExit = { schemaVersion: 1, daily: { mode: 'per_exit' } };
    const proportional = { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 600, timeBasis: 'actual', overtime: 'cap' } };
    for (const [minutes, expected] of [[0, 0], [60, 60], [300, 300], [600, 600], [720, 600]]) {
        assert.equal(calculateConfiguredRate(terms('day', 600, proportional), { actualMinutes: minutes }).amount, expected);
    }
    assert.equal(calculateConfiguredRate(terms('day', 600, perExit), { actualMinutes: 60 }).amount, 600);
    const planned = { ...proportional, daily: { ...proportional.daily, timeBasis: 'paid_planned' } };
    assert.equal(calculateConfiguredRate(terms('day', 600, planned), { actualMinutes: 600, paidPlannedMinutes: 300 }).amount, 300);
});

test('daily overtime is opt-in, calculated once above the full-day norm and separate from the base', () => {
    const payRules = { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 600, timeBasis: 'actual', overtime: 'hourly_150' } };
    const result = calculateConfiguredRate(terms('day', 600, payRules), { actualMinutes: 720, overtimeMinutes: 120 });
    assert.equal(result.amount, 600);
    assert.equal(result.overtimeAmount, 180);
});

test('the canonical working date selects each proportional denominator and preserves captured norms', () => {
    const cases = [
        ['2026-11-20', 500, 480, 240, 250, 'default'],
        ['2026-11-22', 600, 600, 300, 300, 'weekday'],
        ['2026-11-20', 504, 540, 270, 252, 'default'],
        ['2026-11-22', 616, 660, 330, 308, 'weekday']
    ];
    for (const [workDate, rate, norm, actualMinutes, expected, source] of cases) {
        const payRules = { schemaVersion: 1, daily: { mode: 'proportional',
            fullDayMinutes: rate > 500 && rate !== 600 ? 540 : 480,
            fullDayMinutesByWeekday: [{ isoWeekday: 7, minutes: rate === 616 ? 660 : 600 }] } };
        const result = calculateConfiguredRate(terms('day', rate, payRules), { workDate, actualMinutes });
        assert.deepEqual([result.amount, result.paidMinutes, result.dailyNorm.minutes, result.dailyNorm.source], [expected, actualMinutes, norm, source]);
        assert.equal(calculateConfiguredRate(terms('day', rate, payRules), { workDate, actualMinutes: norm + 60 }).amount, rate);
        const overtimeRules = { ...payRules, daily: { ...payRules.daily, overtime: 'hourly_150' } };
        assert.equal(calculateConfiguredRate(terms('day', rate, overtimeRules), { workDate, actualMinutes: norm + 60 }).overtimeAmount,
            Math.round(60 / norm * rate * 1.5));
    }
    const legacy = { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 480 } };
    assert.equal(calculateConfiguredRate(terms('day', 600, legacy), { workDate: '2026-11-22', actualMinutes: 300 }).amount, 375);
    const editedRules = { ...legacy, daily: { ...legacy.daily, fullDayMinutesByWeekday: [{ isoWeekday: 7, minutes: 720 }] } };
    const frozen = { ...terms('day', 600, editedRules), dailyNorm: { minutes: 600, source: 'weekday', isoWeekday: 7 } };
    assert.equal(calculateConfiguredRate(frozen, { workDate: '2026-11-22', actualMinutes: 300 }).amount, 300);
    assert.throws(() => calculateConfiguredRate(terms('day', 600, editedRules), { workDate: '2026-02-29', actualMinutes: 300 }),
        { code: 'PAYROLL_RULES_INVALID' });
    for (const invalid of [[{ isoWeekday: 0, minutes: 480 }], [{ isoWeekday: 7, minutes: 0 }],
        [{ isoWeekday: 7, minutes: 1441 }], [{ isoWeekday: 7, minutes: 480.1 }],
        [{ isoWeekday: 7, minutes: 480 }, { isoWeekday: 7, minutes: 600 }]]) {
        assert.throws(() => normalizePayRules({ ...legacy, daily: { ...legacy.daily, fullDayMinutesByWeekday: invalid } }, 'day'),
            { code: 'PAYROLL_RULES_INVALID' });
    }
});

test('fixed pay keeps leave and partial-month approvals independent', () => {
    const context = { effectiveFrom: '2026-11-16', leaveReviewRequired: true };
    const leave = { kind: 'leave', decision: 'retain_calendar_amount', reason: 'Synthetic leave decision' };
    const partial = { kind: 'partial_month', decision: 'calendar_days', reason: 'Synthetic first month' };
    const pending = monthPay('2026-11', context);
    assert.deepEqual(pending.blockingIssues.map(issue => issue.code),
        ['PAYROLL_FIXED_LEAVE_REVIEW_REQUIRED', 'PAYROLL_FIXED_PARTIAL_MONTH_REVIEW_REQUIRED']);
    const one = monthPay('2026-11', { ...context, monthlyReview: request =>
        request.kind === 'partial_month' ? { approval: partial } : { request } });
    assert.equal(one.blockingIssues[0].code, 'PAYROLL_FIXED_LEAVE_REVIEW_REQUIRED');
    const done = monthPay('2026-11', { ...context, monthlyReview: request => ({ approval: request.kind === 'leave' ? leave : partial }) });
    assert.deepEqual(done.monthlyReviews, [leave, partial]);
    assert.equal(done.amount, 9500);
});

test('monthly advertising is independent from daily earnings and own/other commission bases stay distinct', () => {
    const payRules = { schemaVersion: 1, daily: { mode: 'per_exit' }, note: 'Tips are not included', components: [
        { id: 'advertising', title: 'Advertising', kind: 'monthly', amount: 3500, monthly: { mode: 'fixed' } },
        { id: 'own', title: 'Own bookings', kind: 'percent', percent: 4, basisKey: 'own_bookings' },
        { id: 'other', title: 'Other bookings', kind: 'percent', percent: 1, basisKey: 'other_bookings' }
    ] };
    const t = terms('day', 600, payRules);
    const input = amount => ({ amount, month: '2026-11', confirmed: true, author: 'synthetic_operator', reason: 'Approved test base' });
    const result = calculateConfiguredComponents(t, { ...period('2026-11'), componentInputs: { own_bookings: input(10000), other_bookings: input(20000) } });
    assert.deepEqual(result.lines.map(line => line.amount), [3500, 400, 200]);
    assert.deepEqual(result.blockingIssues, []);
    assert.equal(result.lines.reduce((sum, line) => sum + line.amount, 0), 4100);
    const first = calculateConfiguredComponents(t, { ...period('2026-11'), periodTo: '2026-11-15', componentInputs: { own_bookings: input(10000), other_bookings: input(20000) } });
    const last = calculateConfiguredComponents(t, { ...period('2026-11'), periodFrom: '2026-11-16', componentInputs: { own_bookings: input(10000), other_bookings: input(20000) } });
    assert.equal(first.lines.reduce((sum, line) => sum + line.amount, 0) + last.lines.reduce((sum, line) => sum + line.amount, 0), 4100);
});

test('missing, unconfirmed, stale, unexplained or unattributed commission base is blocked; confirmed zero is accepted', () => {
    const t = terms('hour', 100, { schemaVersion: 1, components: [{ id: 'own', title: 'Own bookings', kind: 'percent', percent: 4, basisKey: 'own_bookings' }] });
    const good = { amount: 0, month: '2026-11', confirmed: true, reason: 'No eligible bookings', author: 'synthetic_operator' };
    for (const input of [undefined, { ...good, amount: null }, { ...good, amount: '' }, { ...good, amount: false },
        { ...good, confirmed: false }, { ...good, month: '2026-10' }, { ...good, reason: '' }, { ...good, author: '' }]) {
        const result = calculateConfiguredComponents(t, { ...period('2026-11'), componentInputs: { own_bookings: input } });
        assert.equal(result.blockingIssues[0].code, 'PAYROLL_COMMISSION_BASE_REQUIRED');
        assert.equal(result.lines.length, 0);
    }
    const zero = calculateConfiguredComponents(t, { ...period('2026-11'), componentInputs: { own_bookings: good } });
    assert.equal(zero.lines[0].amount, 0);
    assert.equal(zero.lines[0].source, 'manual_confirmed');
    assert.deepEqual(zero.blockingIssues, []);
});

test('legacy profiles keep their calculation path and new malformed financial rules fail closed', () => {
    assert.equal(normalizePayRules(null, 'month'), null);
    assert.equal(calculateConfiguredRate(terms('day', 600), { actualMinutes: 60 }), null);
    const invalid = [
        ['month', { schemaVersion: 2, monthly: { mode: 'fixed' } }],
        ['hour', fixed],
        ['month', { schemaVersion: 1, monthly: { mode: 'unknown' } }],
        ['day', { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 0 } }],
        ['hour', { schemaVersion: 1, components: [{ id: 'own', title: 'Own', kind: 'percent', percent: 101, basisKey: 'own_bookings' }] }],
        ['hour', { schemaVersion: 1, components: [{ id: 'x', title: 'X', kind: 'percent', percent: 1, basisKey: 'manual' }, { id: 'x', title: 'X', kind: 'percent', percent: 2, basisKey: 'manual' }] }]
    ];
    for (const [unit, rule] of invalid) assert.throws(() => normalizePayRules(rule, unit), error => error.code === 'PAYROLL_RULES_INVALID');
    assert.throws(() => monthPay('2026-11', { periodTo: '2026-12-01' }), /одного|один/);
});
