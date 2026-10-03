'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const staff = fs.readFileSync(path.join(__dirname, '..', 'js/staff-page.js'), 'utf8');
const hr = fs.readFileSync(path.join(__dirname, '..', 'js/hr-page.js'), 'utf8');
function extract(source, name) {
    let start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    const end = source.indexOf('\n}', start) + 2;
    return source.slice(start, end);
}
function harness() {
    const storage = new Map();
    const fields = {
        schStatus: { value: 'working' }, schNote: { value: 'Draft note' }, schPrimaryProfession: { value: 'animator' },
        schSegmentsList: { dataset: { activeSegmentIndex: '0' } }
    };
    const state = { editingCell: { staffId: 10, date: '2026-10-03', planUpdatedAt: '2026-10-01T12:00:00Z' },
        canManageSchedule: true, canViewStaff: true, rangeMode: 'custom', recoveryReadOnly: false, professionsLoadState: 'ready' };
    let assigned = null;
    const user = { id: 1, role: 'hr' };
    const scope = { mode: 'single', activeContext: 'park', selectedContexts: ['park'] };
    const c = vm.createContext({
        URL, URLSearchParams, Date, console, Number, crypto: { randomUUID: () => 'draft-token' },
        AppState: { currentUser: user }, StaffState: state,
        window: { location: { href: 'https://crm.test/staff?businessContext=park', origin: 'https://crm.test', search: '',
            assign: value => { assigned = value; } }, CrmBusinessContext: { scope: () => scope } },
        sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        STAFF_SCHEDULE_HR_DRAFT_KEY: 'pzp_schedule_hr_draft_v1', STAFF_SCHEDULE_HR_DRAFT_TTL: 7200000, STAFF_SCHEDULE_MAX_SEGMENTS: 12,
        _staffScheduleInitialState: 'original',
        document: { getElementById: id => fields[id], querySelectorAll: () => [] },
        schedulePlanStaff: () => [{ id: 10 }], normalizeProfessionKey: key => key || '',
        scheduleCanViewPayrollAmounts: () => true, isScheduleRecoveryReadOnly: () => false,
        scheduleCurrentRange: () => ({ start: '2026-10-01', end: '2026-10-15' }), formatDateStr: value => value,
        readSchedulePlanSegments: () => [{ clientKey: 'x', professionKey: 'animator', shiftStart: '', shiftEnd: '18:00', additionalRoles: [] }],
        showNotification: () => {}, scheduleRangeDataReady: () => true,
        openEditModal: (staffId, date) => { state.editingCell = { staffId, date, planUpdatedAt: 'NEW' }; },
        renderSchedulePlanEditor: () => {}, toggleTimeFields: () => {}, history: { state: null, replaceState: () => {} }
    });
    for (const name of ['scheduleHrDraftContext', 'readScheduleHrDraft', 'clearScheduleHrDraft', 'schedulePayConditionsHref',
        'navigateSchedulePayConditions', 'restoreScheduleHrDraft', 'refreshScheduleProfessionRates']) vm.runInContext(extract(staff, name), c);
    return { c, storage, fields, state, user, scope, assigned: () => assigned };
}
test('HR navigation stores only the current tab draft and passes staff, profession and work date', () => {
    const { c, storage, assigned } = harness();
    const href = c.schedulePayConditionsHref('schedule', 'reception');
    assert.match(href, /employee=10/);
    assert.match(href, /profession=reception/);
    assert.match(href, /payDate=2026-10-03/);
    c.navigateSchedulePayConditions({ href });
    const draft = JSON.parse(storage.get('pzp_schedule_hr_draft_v1'));
    assert.equal(draft.segments[0].shiftStart, '', 'unfinished time is retained');
    assert.equal(draft.note, 'Draft note');
    assert.equal(draft.planUpdatedAt, '2026-10-01T12:00:00Z');
    assert.equal(draft.range.from, '2026-10-01');
    assert.match(assigned(), /scheduleDraft=draft-token/);
    assert.doesNotMatch(JSON.stringify(draft), /explicitRate|hourlyRate|salary|defaultRate/);
});
test('drafts cannot cross accounts, roles, business contexts, or the two-hour lifetime', () => {
    for (const change of ['account', 'role', 'scope', 'expired', 'future']) {
        const { c, storage, user, scope } = harness();
        c.navigateSchedulePayConditions({ href: '/hr?employee=10' });
        const draft = JSON.parse(storage.get('pzp_schedule_hr_draft_v1'));
        if (change === 'account') user.id = 2;
        if (change === 'role') user.role = 'manager';
        if (change === 'scope') scope.activeContext = 'dar';
        if (change === 'expired') draft.createdAt -= 7200001;
        if (change === 'future') draft.createdAt += 60000;
        storage.set('pzp_schedule_hr_draft_v1', JSON.stringify(draft));
        assert.equal(c.readScheduleHrDraft('draft-token'), null, change);
        assert.equal(storage.size, 0, change);
    }
});
test('storage failure and pending save keep the user in the schedule', () => {
    const { c, assigned, state } = harness();
    state.editingCell.mutationPending = true;
    assert.equal(c.navigateSchedulePayConditions({ href: '/hr' }), false);
    state.editingCell.mutationPending = false;
    c.sessionStorage.setItem = () => { throw new Error('Storage blocked'); };
    assert.equal(c.navigateSchedulePayConditions({ href: '/hr' }), false);
    assert.equal(assigned(), null);
});
test('restoration retains the old concurrency token instead of adopting the current server version', () => {
    const { c, fields, state } = harness();
    c.navigateSchedulePayConditions({ href: '/hr?employee=10' });
    const draft = c.readScheduleHrDraft('draft-token');
    fields.schNote.value = '';
    assert.equal(c.restoreScheduleHrDraft(draft), true);
    assert.equal(state.editingCell.planUpdatedAt, draft.planUpdatedAt);
    assert.equal(fields.schNote.value, 'Draft note');
    assert.equal(c._staffScheduleInitialState, 'original');
    assert.equal(c.readScheduleHrDraft(), null, 'restored drafts are not auto-opened again');
    c.clearScheduleHrDraft(state.editingCell);
    assert.equal(c.readScheduleHrDraft('draft-token'), null, 'closing/saving removes the draft');
});
test('rate refresh never applies a late completion to a different modal session or business', async () => {
    for (const change of ['none', 'modal', 'business']) {
        const { c, state, scope } = harness();
        let resolve;
        let draws = 0;
        c.fetchHrProfessions = () => { state.professionsLoadState = 'loading'; return new Promise(done => { resolve = done; }); };
        c.updateScheduleRatePresentation = () => { draws += 1; };
        c.scheduleModalSessionIsCurrent = session => session === state.editingCell;
        const request = c.refreshScheduleProfessionRates('schedule');
        if (change === 'modal') state.editingCell = { staffId: 11 };
        if (change === 'business') scope.activeContext = 'dar';
        resolve();
        await request;
        assert.equal(draws, change === 'none' ? 2 : 1);
    }
});
test('hidden or absent amounts are never displayed as a zero hryvnia estimate', () => {
    const { c } = harness();
    Object.assign(c, { schedulePaidRoleRate: () => ({ available: true, rate: null }),
        scheduleSegmentDurationMinutes: () => 60, scheduleFormatMoney: amount => String(amount) });
    for (const name of ['scheduleTimeToMinutes', 'scheduleSegmentAbsoluteBounds', 'schedulePaidIntervalBounds', 'schedulePaidRolePreview'])
        vm.runInContext(extract(staff, name), c);
    const preview = c.schedulePaidRolePreview('schedule', { professionKey: 'reception' }, { shiftStart: '12:00', shiftEnd: '13:00' });
    assert.match(preview, /Ставка налаштована/);
    assert.doesNotMatch(preview, /грн/);
});
test('HR deep link opens payment settings only with existing view rights, carrying profession/date/draft', async () => {
    const { c } = harness();
    let options;
    c.window.location.search = '?employee=10&profileTab=payroll&profession=reception&payDate=2026-10-03&scheduleDraft=draft-token';
    c.activateHrTab = async () => {};
    c.openStaffEdit = async (id, input) => { options = input; assert.equal(id, 10); };
    c.canViewPayrollWorkspace = () => true;
    vm.runInContext(extract(hr, 'openStaffEditFromLocation'), c);
    await c.openStaffEditFromLocation();
    assert.equal(options.focus, 'payroll');
    assert.equal(options.professionKey, 'reception');
    assert.equal(options.payDate, '2026-10-03');
    assert.equal(options.scheduleDraft, 'draft-token');
    c.canViewPayrollWorkspace = () => false;
    await c.openStaffEditFromLocation();
    assert.equal(options.focus, 'work');
});
test('HR and schedule use the same account/business draft scope', () => {
    const { c } = harness();
    vm.runInContext(extract(hr, 'hrScheduleDraftContext'), c);
    assert.equal(c.hrScheduleDraftContext(), c.scheduleHrDraftContext());
});

test('a newly created server plan blocks saving a draft that originally had no plan version', async () => {
    const { c, state } = harness();
    state.editingCell.planUpdatedAt = null;
    c.navigateSchedulePayConditions({ href: '/hr?employee=10' });
    c.restoreScheduleHrDraft(c.readScheduleHrDraft('draft-token'));
    assert.equal(state.editingCell.hrDraftStale, true);
    state.editingCell.rangeKey = 'range';
    c.scheduleCommittedRangeKey = () => 'range';
    let writes = 0;
    c.saveScheduleEntry = async () => { writes += 1; };
    c.confirmModal = async () => false;
    vm.runInContext(extract(staff, 'offerStaleSchedulePlanRefresh'), c);
    vm.runInContext(extract(staff, 'handleSave'), c);
    await c.handleSave();
    assert.equal(writes, 0, 'no overwrite request is sent with a missing original version');
    assert.equal(state.editingCell.hrDraftStale, true, 'declining a refresh retains the draft');
});

test('HR return link accepts numeric staff identifiers from the form and rejects another origin', () => {
    const { c, storage } = harness();
    vm.runInContext(extract(hr, 'hrScheduleDraftContext'), c);
    vm.runInContext(extract(hr, 'renderStaffScheduleReturnLink'), c);
    c.activeEditStaffId = () => '10';
    let added = null;
    c.document.createElement = () => ({});
    c.document.getElementById = id => id === 'editCloseTop' ? { parentElement: {
        querySelector: () => ({ append: link => { added = link; } })
    } } : null;
    const draft = { token: 'qa-token', owner: c.hrScheduleDraftContext(), staffId: 10,
        createdAt: Date.now(), returnUrl: '/staff?scheduleDraft=qa-token' };
    storage.set('pzp_schedule_hr_draft_v1', JSON.stringify(draft));
    c.renderStaffScheduleReturnLink({ scheduleDraft: 'qa-token' });
    assert.equal(added.href, '/staff?scheduleDraft=qa-token');
    added = null;
    storage.set('pzp_schedule_hr_draft_v1', JSON.stringify({ ...draft, returnUrl: 'https://other.test/staff' }));
    c.renderStaffScheduleReturnLink({ scheduleDraft: 'qa-token' });
    assert.equal(added, null);
});

test('planned additional pay deducts the same segment break as attendance, including overnight work', () => {
    const { paidMinutesAfterSegmentBreak } = require('../services/hrAttendance');
    const c = vm.createContext({
        isScheduleRecoveryReadOnly: () => false, scheduleCanViewPayrollAmounts: () => true,
        schedulePaidRoleRate: () => ({ available: true, rate: 200 }), scheduleFormatMoney: String
    });
    for (const name of ['scheduleTimeToMinutes', 'scheduleSegmentDurationMinutes', 'scheduleSegmentAbsoluteBounds', 'schedulePaidIntervalBounds', 'schedulePaidRolePreview'])
        vm.runInContext(extract(staff, name), c);
    for (const [shiftStart, shiftEnd] of [['10:00', '18:00'], ['22:00', '06:00']]) {
        const segment = { shiftStart, shiftEnd, breakMinutes: 30 };
        const minutes = paidMinutesAfterSegmentBreak(480, 30);
        const preview = c.schedulePaidRolePreview('schedule', { professionKey: 'reception' }, segment);
        assert.match(preview, /План/);
        assert.ok(preview.includes(minutes + ' хв'), preview);
        assert.match(preview, /1500 грн/);
        assert.match(preview, /фактичними/);
    }
    assert.doesNotMatch(c.schedulePaidRolePreview('schedule', { professionKey: 'reception', intervalStart: '12:00', intervalEnd: '16:00' },
        { shiftStart: '10:00', shiftEnd: '18:00', breakMinutes: 30 }), /≈/);
});

test('live preview reads the edited break instead of retaining the original estimate', () => {
    let input;
    const preview = {};
    const values = { start: '10:00', end: '18:00', break: '45', 'paid-profession': 'reception' };
    const card = { querySelector: selector => selector === '[data-paid-role-preview]' ? preview :
        { value: values[selector.match(/data-segment-field="([^" ]+)/)?.[1]] || '' } };
    const c = vm.createContext({ document: { querySelectorAll: () => [card] },
        schedulePlanScopeConfig: () => ({ listId: 'list' }), normalizeSchedulePlanTime: value => value,
        normalizeProfessionKey: value => value, schedulePaidRolePreview: (scope, role, segment) => { input = segment; return 'plan'; } });
    vm.runInContext(extract(staff, 'updateSchedulePaidRolePreviews'), c);
    c.updateSchedulePaidRolePreviews('schedule');
    assert.equal(input.breakMinutes, 45);
});

test('an unfinished draft still shows the refreshed rate without inventing a payment estimate', () => {
    const c = vm.createContext({ isScheduleRecoveryReadOnly: () => false, scheduleCanViewPayrollAmounts: () => true,
        schedulePaidRoleRate: () => ({ available: true, rate: 195 }), scheduleFormatMoney: String });
    for (const name of ['scheduleTimeToMinutes', 'scheduleSegmentAbsoluteBounds', 'schedulePaidIntervalBounds', 'schedulePaidRolePreview'])
        vm.runInContext(extract(staff, name), c);
    const preview = c.schedulePaidRolePreview('schedule', { professionKey: 'animator' }, { shiftStart: '', shiftEnd: '18:00' });
    assert.match(preview, /195 грн\/год/);
    assert.doesNotMatch(preview, /≈/);
    c.scheduleCanViewPayrollAmounts = () => false;
    assert.doesNotMatch(c.schedulePaidRolePreview('schedule', { professionKey: 'animator' }, { shiftStart: '', shiftEnd: '18:00' }), /195|грн/);
});
