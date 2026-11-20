'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { normalizePayRules } = require('../services/payrollRules');
const sandbox = { window: { crypto: webcrypto }, structuredClone };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/hr-pay-rules.js'), 'utf8'), sandbox);
const form = sandbox.window.HrPayRules;
function defaults(version) { return Object.fromEntries(form.fields(version).map(field => [field.key, field.defaultValue ?? ''])); }

test('form preserves saved weekday minutes, supports explicit reset and represents an unknown commission without a zero percent', () => {
    const version = { rateUnit: 'day', payRules: { schemaVersion: 1,
        daily: { mode: 'proportional', fullDayMinutes: 480, fullDayMinutesByWeekday: [{ isoWeekday: 7, minutes: 600 }] } } };
    const values = { ...defaults(version), rateUnit: 'day' };
    assert.equal(values.payDayNorm7, 600);
    assert.deepEqual(normalizePayRules(structuredClone(form.collect(values, version)), 'day').daily.fullDayMinutesByWeekday, [{ isoWeekday: 7, minutes: 600 }]);
    assert.equal(form.validate({ ...values, payDayNorm7: '600.1' }, version).key, 'payDayNorm7');
    const change = { ...values, payDayNormSchedule: 'default', payReviewVisibility: 'show', payReview_commission: 'unknown',
        payReview_commissionSource: 'Synthetic initial history', payReview_commissionReason: 'Waiting for a verified percentage' };
    const rules = normalizePayRules(structuredClone(form.collect(change, version)), 'day');
    assert.deepEqual(rules.daily.fullDayMinutesByWeekday, []);
    assert.equal(rules.conditionReviews.commission.state, 'unknown');
    assert.deepEqual(rules.components, []);
});

test('employee form submits explicit fixed/month/day policy choices accepted by the canonical server', () => {
    const version = { rateUnit: 'month', payRules: { schemaVersion: 1, monthly: { mode: 'fixed' } } };
    const values = { ...defaults(version), rateUnit: 'month', payRuleSelection: 'configured' };
    assert.equal(form.validate(values, version), null);
    const fixed = normalizePayRules(form.collect(values, version), 'month');
    assert.equal(fixed.monthly.mode, 'fixed');
    const proportional = { ...values, payMonthMode: 'norm_minutes', payMonthNormMonth: '2026-11', payMonthNormHours: '160',
        payMonthNormSource: 'Approved synthetic schedule', payMonthNormConfirmed: 'yes' };
    assert.equal(normalizePayRules(form.collect(proportional, version), 'month').monthly.norm.value, 9600);
    const day = { ...values, rateUnit: 'day', payDayMode: 'proportional', payDayHours: '9.5', payDayBasis: 'actual' };
    const rules = normalizePayRules(form.collect(day, version), 'day');
    assert.equal(rules.daily.fullDayMinutes, 570);
    assert.equal(rules.monthly, undefined);
});

test('an untouched form preserves existing components and IDs when editing the salary', () => {
    const version = { rateUnit: 'day', payRules: { schemaVersion: 1, daily: { mode: 'per_exit' }, note: 'Tips excluded', components: [
        { id: 'advertising', title: 'Advertising', kind: 'monthly', amount: 3500, monthly: { mode: 'fixed' } },
        { id: 'own', title: 'Own bookings', kind: 'percent', percent: 4, basisKey: 'own_bookings', source: 'manual_confirmed' },
        { id: 'other', title: 'Other bookings', kind: 'percent', percent: 1, basisKey: 'other_bookings', source: 'manual_confirmed' }
    ] } };
    const before = structuredClone(version);
    const collected = normalizePayRules(structuredClone(form.collect({ ...defaults(version), rateUnit: 'day' }, version)), 'day');
    assert.deepEqual(collected, normalizePayRules(version.payRules, 'day'));
    assert.deepEqual(version, before);
    const title = form.describe(collected);
    assert.match(title, /компонентів: 3/);
});

test('incomplete rule data identifies a specific editable field and never silently becomes a zero norm', () => {
    const version = { rateUnit: 'day' };
    const values = { ...defaults(version), rateUnit: 'day', payRuleSelection: 'configured', payDayMode: 'proportional' };
    assert.equal(form.validate(values, version).key, 'payDayHours');
    values.payDayHours = '10';
    values.payComponent0Kind = 'percent';
    values.payComponent0Title = 'Own';
    values.payComponent0Percent = '0';
    assert.equal(form.validate(values, version).key, 'payComponent0Percent');
    values.payComponent0Percent = '4';
    const collected = normalizePayRules(form.collect(values, version), 'day');
    assert.equal(collected.components[0].percent, 4);
    assert.match(collected.components[0].id, /^component_[a-z0-9]+$/);
});

test('legacy profiles have an explicit preservation option while configured rules are retained by older callers', () => {
    const legacy = { rateUnit: 'month' };
    assert.equal(form.collect(defaults(legacy), legacy), null);
    const configured = { rateUnit: 'month', payRules: { schemaVersion: 1, monthly: { mode: 'fixed' } } };
    assert.deepEqual(form.collect({ rateUnit: 'month' }, configured), configured.payRules);
    assert.doesNotThrow(() => form.fields(null));
});
