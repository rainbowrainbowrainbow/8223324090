'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_HIERARCHY, resolveCapability, buildCapabilitySnapshot } = require('../services/accountAccessPolicy');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');
const { shapeBookingFields } = require('../services/bookingFieldAccess');
const { assessAccountWorkReadiness, loadAccountWorkReadiness, REQUIRED_WORK_PAGES } = require('../services/accountWorkReadiness');

function member(role, overrides = {}) {
    return { organization_id: 1, business_id: 1, context_key: 'event_genix',
        access_mode: 'membership', role, is_default: true, ...overrides };
}

for (const role of ROLE_HIERARCHY) {
    test(`${role}: shared work minimum and explicit denial precedence`, () => {
        const user = applyMembershipAccess({ role: 'creator' }, buildMembershipAccess({ role: 'creator' }, [member(role)], 'event_genix'));
        const snapshot = buildCapabilitySnapshot(user);
        for (const page of REQUIRED_WORK_PAGES) assert.equal(snapshot.pages[page], true, page);
        const denied = applyMembershipAccess({ role: 'creator' }, buildMembershipAccess({ role: 'creator' }, [member(role, {
            page_allowlist: ['/tasks'], page_denylist: ['/tasks'],
            action_allowlist: ['edit_booking'], action_denylist: ['edit_booking']
        })], 'event_genix'));
        assert.equal(resolveCapability(denied, '/tasks').source, 'explicit_deny');
        assert.equal(resolveCapability(denied, 'edit_booking').source, 'explicit_deny');
    });
}

test('membership decisions cannot reuse global extra roles or permissions after revocation', () => {
    const global = { role: 'creator', extra_roles: ['director'], action_allowlist: ['edit_booking'] };
    const access = buildMembershipAccess(global, [], 'event_genix', [member('instructor')]);
    const denied = buildCapabilitySnapshot({ ...global, businessMembershipAccess: access });
    assert.equal(Object.values(denied.pages).some(Boolean), false);
    assert.equal(Object.values(denied.actions).some(Boolean), false);
    const effective = applyMembershipAccess(global, buildMembershipAccess(global, [member('instructor')], 'event_genix'));
    assert.equal(resolveCapability(effective, 'edit_booking').allowed, false);
    const extra = applyMembershipAccess(global, buildMembershipAccess(global, [member('instructor', { extra_roles: ['reception'] })], 'event_genix'));
    assert.equal(resolveCapability(extra, 'edit_booking').allowed, true);
});

test('specialists have no operational booking mutation presets; reception can create and edit', () => {
    for (const role of ['hr', 'accountant', 'it_specialist', 'marketer', 'art_director', 'instructor', 'senior_instructor', 'animator']) {
        for (const action of ['create_booking', 'edit_booking', 'delete_booking']) {
            assert.equal(resolveCapability({ role }, action).allowed, false, `${role} ${action}`);
        }
    }
    for (const action of ['create_booking', 'edit_booking']) assert.equal(resolveCapability({ role: 'reception' }, action).allowed, true);
    assert.equal(resolveCapability({ role: 'reception' }, 'delete_booking').allowed, false);
    for (const role of ['hr', 'vice_director']) {
        for (const action of ['approve_payroll_installment', 'confirm_payroll_payment']) {
            assert.equal(resolveCapability({ role }, action).allowed, false);
            assert.equal(resolveCapability({ role, action_allowlist: [action] }, action).allowed, true);
        }
    }
});

test('working booking DTO excludes arbitrary contacts, money, notes and nested packages', () => {
    const booking = { id: 'b1', date: '2026-11-18', time: '10:00', lineId: '7', resourceId: '7',
        linkedTo: 'parent', programId: 'p1', label: 'Game', status: 'confirmed', kidsCount: 5,
        price: 1200, customerName: 'Synthetic customer', customerPhone: 'synthetic-phone',
        notes: 'customer contact', extraData: { phone: 'hidden' }, bookingPackage: { phone: 'hidden' },
        timelineIdentity: { resourceId: '7', resourceType: 'animator', businessContext: 'event_genix', source: 'booking_row' } };
    const safe = shapeBookingFields(booking, { role: 'instructor' });
    for (const key of ['id', 'date', 'time', 'lineId', 'resourceId', 'linkedTo', 'programId', 'label', 'status', 'timelineIdentity']) {
        assert.deepEqual(safe[key], booking[key], key);
    }
    assert.equal(safe.kidsCount, 5);
    for (const key of ['customerName', 'customerPhone', 'price', 'notes', 'extraData', 'bookingPackage']) assert.equal(key in safe, false, key);
    const accountant = shapeBookingFields(booking, { role: 'accountant' });
    assert.equal(accountant.price, 1200);
    assert.equal('customerPhone' in accountant, false);
    const reception = shapeBookingFields(booking, { role: 'reception' });
    assert.equal(reception.customerPhone, 'synthetic-phone');
    assert.equal('price' in reception, false);
    assert.equal('customerPhone' in shapeBookingFields(booking, { role: 'reception', action_denylist: ['bookings.contacts.view'] }), false);
    assert.equal('kidsCount' in shapeBookingFields(booking, { role: 'director', action_denylist: ['bookings.details.view'] }), false);
});

test('link readiness separately reports membership, pages and unverified API reads', () => {
    const input = { user: { id: 8, role: 'instructor' }, staff: { id: 7 }, profile: { id: 4, userId: 8, staffId: 7 },
        access: buildMembershipAccess({}, [member('instructor')], 'event_genix') };
    const pending = assessAccountWorkReadiness(input);
    assert.equal(pending.checks.profile.passed, true);
    assert.equal(pending.checks.membership.passed, true);
    assert.equal(pending.checks.pages.passed, true);
    assert.equal(pending.checks.data.status, 'not_run');
    assert.equal(pending.ready, false);
    const storeOnly = assessAccountWorkReadiness({ ...input,
        dataChecks: REQUIRED_WORK_PAGES.map(page => ({ page, passed: true, probe: 'read_only_database' })) });
    assert.equal(storeOnly.checks.data.passed, false, 'SQL store reads cannot impersonate authenticated API verification');
    assert.equal(storeOnly.checks.data.status, 'api_not_verified');
    const verified = assessAccountWorkReadiness({ ...input,
        dataChecks: REQUIRED_WORK_PAGES.map(page => ({ page, passed: true, probe: 'authenticated_api' })) });
    assert.equal(verified.checks.data.passed, true);
    assert.equal(verified.ready, false, 'successful read probes cannot hide unavailable business modules');
    assert.equal(verified.checks.modules.results.some(module => module.module === 'chat' && !module.available), true);
    const missing = assessAccountWorkReadiness({ ...input, access: buildMembershipAccess({}, [], 'event_genix', [member('instructor')]) });
    assert.equal(missing.checks.membership.passed, false);
    assert.match(missing.nextStep, /членство/);
});

test('readiness probes expose store failures without granting unavailable modules or leaking rows', async () => {
    const probes = [];
    const db = { async query(sql) {
        if (sql.includes('FROM users WHERE id')) {
            if (sql.startsWith('SELECT 1')) { probes.push('profile'); return { rows: [{ private: 'not-returned' }] }; }
            return { rows: [{ id: 8, role: 'instructor', is_active: true }] };
        }
        if (sql.includes('SELECT ep.id')) return { rows: [{ id: 4, staff_id: 7, staff_active: true }] };
        if (sql.includes('FROM organization_memberships')) return { rows: [member('instructor', { business_modules: ['tasks', 'afisha'] })] };
        if (sql.includes('FROM businesses b JOIN')) return { rows: [member('instructor')] };
        if (sql.includes('FROM tasks')) { probes.push('tasks'); throw new Error('private database details'); }
        if (sql.includes('FROM staff_schedule')) { probes.push('staff'); return { rows: [] }; }
        if (sql.includes('FROM afisha')) { probes.push('afisha'); return { rows: [] }; }
        assert.fail('Unexpected readiness query');
    } };
    const result = await loadAccountWorkReadiness(db, { userId: 8, businessContext: 'event_genix' });
    assert.deepEqual(probes, ['profile', 'tasks', 'afisha', 'staff']);
    const reads = result.checks.data.results;
    assert.equal(reads.find(read => read.page === '/tasks').code, 'work_data_read_failed');
    assert.equal(reads.find(read => read.page === '/staff').storeReadPassed, true, 'empty schedule store is valid');
    assert.equal(reads.find(read => read.page === '/staff').passed, false, 'authenticated API still requires verification');
    assert.equal(result.checks.data.status, 'api_not_verified');
    assert.equal(reads.find(read => read.page === '/chat').probe, 'not_run');
    assert.equal(result.ready, false);
    assert.doesNotMatch(JSON.stringify(result), /private database details|not-returned/);
});

test('team schedule coordination hides absence reasons, notes, account identities and pay', () => {
    const { shapeCoordinationRow } = require('../services/staffScheduleFieldAccess');
    const source = { staff_id: 7, date: '2026-11-18', name: 'Synthetic staff', status: 'sick',
        note: 'private reason', hr_shift_type: 'sick', replacement_reason: 'private',
        compensation_snapshot: { amount: 100 }, hr_segments: [{ note: 'private' }],
        account_username: 'synthetic', sickDays: 2, vacationDays: 1, dayoffs: 3, totalHours: 8 };
    const safe = shapeCoordinationRow(source);
    assert.deepEqual(safe, { staff_id: 7, date: '2026-11-18', name: 'Synthetic staff',
        status: 'dayoff', hr_shift_type: 'dayoff', dayoffs: 6, totalHours: 8 });
});

test('legacy schedule availability cannot disclose private absence categories', () => {
    const { installStaffScheduleFieldAccess } = require('../services/staffScheduleFieldAccess');
    let response;
    const res = { json(value) { response = value; } };
    installStaffScheduleFieldAccess({ user: { role: 'animator' }, method: 'GET', path: '/schedule/check/2026-11-18' }, res, () => {});
    res.json({ success: true, available: [], unavailable: [{ id: 7, name: 'Synthetic', status: 'sick', note: 'private reason' }] });
    assert.deepEqual(response.unavailable, [{ id: 7, name: 'Synthetic', status: 'dayoff' }]);
});

test('audit reports preset impact and personal exceptions without customer or account secrets', () => {
    const { auditAccount } = require('../services/baselineAccessAudit');
    const report = auditAccount({ user: { id: 8, role: 'hr', password_hash: 'must-not-leak' },
        access: buildMembershipAccess({}, [member('hr', { action_denylist: ['edit_booking'] })], 'event_genix'),
        profiles: [{ profession: 'trampoline_instructor' }] });
    assert.equal(report.professionRoleMismatch, true);
    assert.equal(report.automaticFix, false);
    assert.deepEqual(report.exceptions.actionsDenied, ['edit_booking']);
    assert.equal(report.impact.some(change => change.capability === 'action:edit_booking'), false, 'existing deny remains unchanged');
    assert.equal(JSON.stringify(report).includes('must-not-leak'), false);
});

test('task scope, creation and deletion honor additional roles and explicit denials', () => {
    const { getPermissions } = require('../config/roles');
    const { buildTaskVisibilityScope } = require('../services/taskPolicy');
    assert.equal(getPermissions({ role: 'instructor', extra_roles: ['director'] }).taskVisibility, 'all');
    assert.equal(getPermissions({ role: 'director', action_denylist: ['tasks.scope.business', 'tasks.create', 'tasks.delete'] }).taskVisibility, 'own');
    assert.equal(getPermissions({ role: 'director', action_denylist: ['tasks.create'] }).canCreateTasks, false);
    assert.equal(getPermissions('it_specialist').taskVisibility, 'own');
    const params = [];
    const sql = buildTaskVisibilityScope({ id: 8, role: 'senior_instructor',
        activeBusinessMembership: { businessId: 1, organizationId: 1 } }, params);
    assert.match(sql, /company_structure_node_id/);
    assert.match(sql, /business_memberships/);
    assert.match(sql, /organization_memberships/);
    assert.doesNotMatch(sql, /ep\.department|ep2\.department/);
    assert.ok(params.includes(8));
});

test('banquet summary without contact permission cannot bypass the booking DTO policy', () => {
    const { shapeBookingResponse } = require('../services/bookingFieldAccess');
    const safe = shapeBookingResponse({ success: true, document: { type: 'banquet_summary' },
        bookingId: 'b1', event: { date: '2026-11-18', room: 'Synthetic room', groupName: 'private' },
        customer: { phone: 'private' }, celebrants: [{ name: 'private' }], comments: ['private'],
        counts: { children: 3 }, totals: { orderTotal: 100 } }, { role: 'accountant' });
    assert.equal(safe.customer, undefined);
    assert.equal(safe.comments, undefined);
    assert.equal(safe.celebrants, undefined);
    assert.equal(safe.event.groupName, undefined);
    assert.deepEqual(safe.totals, { orderTotal: 100 });
});

test('scoped schedule managers cannot mutate an unrelated or unlinked staff card', async () => {
    const { loadStaffScheduleScope, createStaffScheduleScopeGuard } = require('../services/staffScheduleScope');
    const manager = applyMembershipAccess({ id: 8, role: 'manager' },
        buildMembershipAccess({}, [member('manager')], 'event_genix'));
    const db = { async query(sql, params) {
        assert.match(sql, /company_structure_node_id/);
        assert.deepEqual(params, [8]);
        return { rows: [{ id: 7 }] };
    } };
    assert.deepEqual(await loadStaffScheduleScope(db, manager), { scope: 'team', editableStaffIds: [7] });
    const guard = createStaffScheduleScopeGuard(db);
    async function check(staffId) {
        let status = 200;
        let next = false;
        await guard({ user: manager, method: 'PUT', path: '/schedule', body: { staffId } },
            { status(code) { status = code; return this; }, json() {} }, error => { assert.equal(error, undefined); next = true; });
        return { status, next };
    }
    assert.deepEqual(await check(7), { status: 200, next: true });
    assert.deepEqual(await check(9), { status: 403, next: false });
    let exportStatus;
    await guard({ user: manager, method: 'GET', path: '/schedule/export-xlsx' },
        { status(code) { exportStatus = code; return this; }, json() {} },
        () => assert.fail('whole-business export must not bypass team scope through GET'));
    assert.equal(exportStatus, 403);
    assert.deepEqual(await loadStaffScheduleScope(db, { role: 'manager' }), { scope: 'team', editableStaffIds: [] });
    assert.equal((await loadStaffScheduleScope(db, { role: 'director', action_denylist: ['hr.schedule.manage'] })).scope, 'read');
});
