'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildHrPayReadiness } = require('../services/hrPayReadiness');
const { options } = require('../scripts/audit-hr-pay-readiness');
function fixture(overrides = {}) {
    return { date: '2026-10-03', staff: [{ id: 1, role_type: 'reception', secondary_professions: ['animator'], is_active: true,
        name: 'Private staff name', phone: 'Private phone', hourly_rate: 100, rate_unit: 'hour' }],
        professions: [{ key: 'animator', people: [{ id: 1, isActive: true, assignmentStatus: 'active', admissionStatus: 'approved',
            explicitRate: 180, rateUnit: 'hour', rateSource: 'staff_profession_rates.hourly_rate', hasExplicitHourlyRate: true }] }],
        payrollAmountsAvailable: true, ...overrides };
}
test('admission and missing rate remain separate findings instead of a false missing rate', () => {
    const input = fixture(); input.professions[0].people[0].admissionStatus = 'pending';
    const row = buildHrPayReadiness(input).rows.find(row => row.use === 'potential_additional');
    assert.deepEqual(row.findings, ['admission_not_approved']);
    assert.ok(row.unverified.includes('payroll_profile_unverified'));
});
test('unit conflict does not claim that an ignored positive hourly rate disappeared', () => {
    const input = fixture(); input.professions[0].people[0].rateUnit = 'month'; input.professions[0].people[0].explicitRate = null;
    const row = buildHrPayReadiness(input).rows.find(row => row.use === 'potential_additional');
    assert.deepEqual(row.findings, ['rate_unit_conflict']);
});
test('hidden eligibility flags cannot prove a rate is missing when admission is unapproved', () => {
    const input = fixture({ payrollAmountsAvailable: false });
    const person = input.professions[0].people[0]; delete person.explicitRate; delete person.rateUnit;
    person.hasExplicitHourlyRate = false; person.admissionStatus = 'pending';
    const report = buildHrPayReadiness(input);
    assert.equal(report.counts.explicit_additional_rate_missing, undefined);
    assert.ok(report.rows.find(row => row.use === 'potential_additional').unverified.includes('explicit_additional_rate_unverified'));
});
test('denied profile access remains incomplete instead of producing false invalid-profile counts', () => {
    const report = buildHrPayReadiness(fixture({ sourceErrors: [{ source: 'profiles', status: 403 }], catalogPartial: true }));
    assert.equal(report.status, 'PARTIAL');
    assert.equal(report.counts.payroll_profile_invalid, undefined);
});
test('expired explicit profile is reported even if the resolver permits a legacy fallback', () => {
    const input = fixture({ profilesAvailable: true, assignmentsAvailable: true,
        profiles: [{ id: 9, professionKey: 'animator', status: 'active', versions: [{ id: 91, versionNumber: 1,
            rateUnit: 'hour', defaultRate: 200, effectiveFrom: '2026-01-01', effectiveTo: '2026-09-30', dayRates: [] }] }],
        assignments: [{ id: 8, staffId: 1, professionKey: 'animator', profileId: 9, assignmentKind: 'explicit', effectiveFrom: '2026-01-01' }] });
    assert.ok(buildHrPayReadiness(input).rows.find(row => row.professionKey === 'animator').findings.includes('payroll_profile_invalid'));
    input.date = '2026-09-30';
    assert.equal(buildHrPayReadiness(input).rows.find(row => row.professionKey === 'animator').findings.includes('payroll_profile_invalid'), false);
});
test('audit artifacts omit personal data and salary amounts', () => {
    const serialized = JSON.stringify(buildHrPayReadiness(fixture()));
    assert.doesNotMatch(serialized, /Private staff name|Private phone|hourly_rate|explicitRate|password|token/);
    assert.ok(serialized.includes('staffId'));
});
test('audit rejects write flags, invalid work dates and output paths outside its report directory', () => {
    assert.throws(() => options(['--apply']), /READ_ONLY/);
    assert.throws(() => options(['--date', '2026-10-03', '--output', path.resolve('package.json')]), /OUTPUT/);
    assert.throws(() => buildHrPayReadiness(fixture({ date: '2026-02-30' })), /VALID_WORK_DATE/);
});
