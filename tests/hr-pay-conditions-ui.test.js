'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'hr-page.js'), 'utf8');
function functionSource(name) {
    let start = source.indexOf(`function ${name}(`);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    assert.ok(start >= 0, name);
    const next = /\n(?:async )?function /.exec(source.slice(start + 1));
    return source.slice(start, start + 1 + next.index);
}
const version = (id, unit, rate, from, to = null) => ({ id, rateUnit: unit, defaultRate: rate, effectiveFrom: from, effectiveTo: to });
function context() {
    const fields = { editPayrollConditionsDate: { value: '2026-10-03' }, editRoleType: { value: 'animator' }, editHourlyRate: { value: '30000' } };
    const inputs = [];
    const state = { profiles: [], assignments: [] };
    const c = vm.createContext({
        todayStr: () => '2026-10-03', document: { getElementById: id => fields[id], querySelectorAll: () => inputs },
        normalizeProfessionKey: value => value, normalizeStaffRateUnit: value => value,
        staffPayrollProfileState: state, activeEditStaffId: () => 1, currentEditRateUnit: () => 'month',
        addDaysString: (date, amount) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); },
        hrCanUsePayrollAction: () => false, showNotification: () => {}, staffProfileDirtyScopes: () => []
    });
    for (const name of ['staffDateInputValue', 'payrollProfileCurrentVersion', 'staffPayrollConditionsDate', 'staffPayrollProfileById',
        'staffPayrollProfileProfessionKey', 'staffPayrollAssignmentProfessionKey', 'staffPayrollAssignmentProfileId',
        'staffPayrollAssignmentKind', 'staffPayrollAssignmentFrom', 'staffPayrollAssignmentTo',
        'staffPayrollAssignmentIsActiveOn', 'staffPayrollActiveAssignmentForProfession', 'staffPayrollDefaultProfileForProfession',
        'staffPayrollEffectiveProfileForProfession', 'staffPayrollFutureConditions', 'staffPayrollLegacyRateForProfession',
        'payrollProfilePaymentHint', 'ensureStaffPayrollProfileCanMutate']) vm.runInContext(functionSource(name), c);
    return { c, state, fields, inputs };
}
test('future or expired versions are never presented as current; date boundaries are inclusive', () => {
    const { c } = context();
    const current = version(1, 'hour', 150, '2026-10-01', '2026-10-31');
    const future = version(2, 'day', 1200, '2026-11-01');
    const profile = { currentVersion: current, latestVersion: future, versions: [current, future] };
    assert.equal(c.payrollProfileCurrentVersion(profile).id, 1);
    assert.equal(c.payrollProfileCurrentVersion(profile, '2026-10-31').id, 1);
    assert.equal(c.payrollProfileCurrentVersion(profile, '2026-11-01').id, 2);
    assert.equal(c.payrollProfileCurrentVersion({ currentVersion: null, latestVersion: future }), null);
    assert.equal(c.payrollProfileCurrentVersion({ versions: [current] }, '2026-11-01'), null);
});
test('each profession resolves inherited or personal conditions on the chosen date', () => {
    const { c, state, fields } = context();
    state.profiles.push({ id: 10, professionKey: 'animator', status: 'active', profileKind: 'shared', isDefaultForProfession: true,
        versions: [version(11, 'hour', 150, '2026-01-01')] });
    state.profiles.push({ id: 20, professionKey: 'animator', status: 'active', profileKind: 'personal',
        versions: [version(21, 'day', 1200, '2026-11-01')] });
    state.assignments.push({ id: 30, professionKey: 'animator', profileId: 20, assignmentKind: 'explicit', effectiveFrom: '2026-11-01' });
    assert.equal(c.staffPayrollEffectiveProfileForProfession('animator').source, 'inherited');
    assert.equal(c.staffPayrollEffectiveProfileForProfession('animator').version.rateUnit, 'hour');
    fields.editPayrollConditionsDate.value = '2026-11-01';
    assert.equal(c.staffPayrollEffectiveProfileForProfession('animator').source, 'explicit');
    assert.equal(c.staffPayrollEffectiveProfileForProfession('animator').version.rateUnit, 'day');
});
test('inactive or unresolved assignment falls back exactly as the canonical resolver and exposes a warning', () => {
    const { c, state } = context();
    state.profiles.push({ id: 10, professionKey: 'animator', status: 'active', profileKind: 'shared', isDefaultForProfession: true,
        versions: [version(11, 'month', 30000, '2026-01-01')] });
    state.profiles.push({ id: 20, professionKey: 'animator', status: 'archived', versions: [version(21, 'hour', 200, '2026-01-01')] });
    state.assignments.push({ id: 30, professionKey: 'animator', profileId: 20, assignmentKind: 'explicit', effectiveFrom: '2026-01-01' });
    const result = c.staffPayrollEffectiveProfileForProfession('animator');
    assert.equal(result.profile.id, 10);
    assert.equal(result.version.rateUnit, 'month');
    assert.match(result.warning, /не має чинних умов/);
});
test('planned changes include temporary assignment start and return to inheritance after inclusive end', () => {
    const { c, state } = context();
    state.profiles.push({ id: 10, professionKey: 'animator', status: 'active', profileKind: 'shared', isDefaultForProfession: true,
        versions: [version(11, 'hour', 150, '2026-01-01')] });
    state.profiles.push({ id: 20, professionKey: 'animator', status: 'active', profileKind: 'personal',
        versions: [version(21, 'hour', 200, '2026-01-01')] });
    state.assignments.push({ id: 30, professionKey: 'animator', profileId: 20, assignmentKind: 'temporary',
        effectiveFrom: '2026-11-01', effectiveTo: '2026-11-03' });
    const rows = c.staffPayrollFutureConditions('animator');
    assert.deepEqual(Array.from(rows, row => row.date), ['2026-11-01', '2026-11-04']);
    assert.equal(rows[0].source, 'temporary');
    assert.equal(rows[1].source, 'inherited');
});
test('hourly profession override is not labelled monthly and the base salary is never suggested for an unconfigured secondary profession', () => {
    const { c, inputs } = context();
    inputs.push({ dataset: { professionRate: 'waiter' }, value: '180' });
    assert.equal(c.staffPayrollLegacyRateForProfession('waiter').rateUnit, 'hour');
    assert.equal(c.staffPayrollLegacyRateForProfession('animator').rateUnit, 'month');
    assert.equal(c.staffPayrollLegacyRateForProfession('barista').rate, 0);
});
test('salary rule mutation uses the existing action permission', () => {
    const { c } = context();
    assert.equal(c.ensureStaffPayrollProfileCanMutate(), false);
    c.hrCanUsePayrollAction = action => action === 'manage_payroll_rules';
    assert.equal(c.ensureStaffPayrollProfileCanMutate(), true);
});

test('profession pay navigation keeps the existing catalogue, scopes it to this profession and protects dirty fields', async () => {
    let navigated = '';
    let closed = false;
    const button = { dataset: { baseline: '[]' } };
    const state = { profession: 'all', loadStatus: 'ready' };
    const c = vm.createContext({
        canViewPayrollWorkspace: () => true, professionWorkspaceState: { data: { profession: { key: 'animator' } } },
        document: { getElementById: () => button, querySelectorAll: () => [] },
        confirmHrAction: async () => false, payrollProfilesState: state,
        closeProfessionWorkspaceUi: () => { closed = true; }, activateHrTab: async tab => { navigated = tab; },
        renderPayrollProfilesCatalog: () => {}
    });
    vm.runInContext(functionSource('openProfessionPayConditions'), c);
    await c.openProfessionPayConditions();
    assert.equal(navigated, 'profiles');
    assert.equal(state.profession, 'animator');
    assert.equal(closed, true);
    navigated = ''; closed = false; button.dataset.baseline = 'dirty';
    await c.openProfessionPayConditions();
    assert.equal(navigated, '');
    assert.equal(closed, false);
    c.canViewPayrollWorkspace = () => false;
    button.dataset.baseline = '[]';
    await c.openProfessionPayConditions();
    assert.equal(navigated, '');
});
