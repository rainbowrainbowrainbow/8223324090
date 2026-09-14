'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { projectParkStaffSchedulePayload: project } = require('../services/parkStaffScheduleProjection');

test('Park roster preserves schedule grouping and badges without account or contact details', () => {
    const payload = { success: true, data: [{ id: 7, name: 'Synthetic Worker', role_type: 'animator',
        secondary_professions: ['reception'], display_group: 'animators', displayGroups: ['animators', 'reception'],
        schedule_category_memberships: [{ professionKey: 'animator', displayGroup: 'animators', source: 'primary_profession' }],
        is_active: true, has_account: true, has_face_descriptor: true,
        training_readiness: { total: 4, completed: 3, percent: 75, privateDetail: 'PRIVATE' },
        account_user_id: 21, account_username: 'PRIVATE', phone: 'PRIVATE', address: 'PRIVATE', hourly_rate: 1234 }],
    departments: { animators: 'Аніматори' }, displayGroups: [{ key: 'animators' }],
    scheduleCategoryContract: { version: 1 } };
    const before = structuredClone(payload);
    const output = project('staff', '/', payload);
    assert.equal(output.data[0].id, 7);
    assert.equal(output.data[0].has_account, true);
    assert.equal(output.data[0].has_face_descriptor, true);
    assert.deepEqual(output.data[0].secondary_professions, ['reception']);
    assert.deepEqual(output.data[0].schedule_category_memberships, payload.data[0].schedule_category_memberships);
    assert.deepEqual(output.data[0].training_readiness, { total: 4, completed: 3, percent: 75 });
    assert.deepEqual(output.scheduleCategoryContract, payload.scheduleCategoryContract);
    assert.equal(JSON.stringify(output).includes('PRIVATE'), false);
    assert.equal(Object.hasOwn(output.data[0], 'hourly_rate'), false);
    assert.deepEqual(payload, before, 'Projection must not mutate shared source rows');
});

test('Park profession dependency exposes labels without people, rates or unrelated HR inventory', () => {
    const output = project('hr', '/professions', { success: true, data: [{ id: 4, key: 'animator', title: 'Аніматор',
        department: 'animators', color: '#abcdef', is_active: true, people: [{ explicitRate: 450, fallbackRate: 400,
            storedExplicitRate: 450, ignoredExplicitRate: 450, hourlyRate: 450 }], checklist: ['PRIVATE'] }],
    inventory: { private: 'PRIVATE' }, structureNodes: [{ private: 'PRIVATE' }] });
    assert.deepEqual(output, { success: true, data: [{ id: 4, key: 'animator', title: 'Аніматор',
        department: 'animators', color: '#abcdef', is_active: true }] });
});

test('Park attendance retains factual time and allocation aliases while excluding compensation snapshots', () => {
    const physical = { professionKey: 'animator', shiftStart: '09:00', shiftEnd: '12:00', actualMinutes: 175,
        hourlyRate: 1234, salary: 5678 };
    const output = project('staff', '/attendance', { success: true, from: '2026-09-13', to: '2026-09-21',
        source: 'hr_time_records+staff_checkins', summary: { total: 1 }, data: [{ staff_id: 7, date: '2026-09-14',
            time_record_id: 33, clock_in: '2026-09-14T06:05:00Z', clock_out: '2026-09-14T09:00:00Z',
            time_status: 'late', late_minutes: 5, plannedMinutes: 180, actual_minutes: 175,
            allocationSource: 'segments', segmentAllocations: [physical], segment_allocations: [physical],
            allocationIssues: [{ code: 'GAP', message: 'Synthetic gap', privateDetail: 'PRIVATE' }],
            compensation_snapshot: { rates: 'PRIVATE' }, compensationSnapshot: { totals: 'PRIVATE' },
            compensationAllocations: ['PRIVATE'], compensation_allocations: ['PRIVATE'], notes: 'PRIVATE',
            corrected_by: 'PRIVATE', correction_reason: 'PRIVATE' }] });
    assert.equal(output.data[0].clock_in, '2026-09-14T06:05:00Z');
    assert.equal(output.data[0].time_status, 'late');
    assert.equal(output.data[0].actual_minutes, 175);
    assert.deepEqual(output.data[0].segmentAllocations, [{ professionKey: 'animator', shiftStart: '09:00',
        shiftEnd: '12:00', actualMinutes: 175 }]);
    assert.deepEqual(output.data[0].segment_allocations, output.data[0].segmentAllocations);
    assert.deepEqual(output.data[0].allocationIssues, [{ code: 'GAP', message: 'Synthetic gap' }]);
    assert.deepEqual(output.summary, { total: 1 });
    assert.equal(JSON.stringify(output).includes('PRIVATE'), false);
});

test('Park schedule keeps dates, versions, ordered segments and concurrent role identities without pay values', () => {
    const output = project('staff', '/schedule/', { success: true, data: [{ id: 91, staff_id: 7, date: '2026-09-14',
        status: 'working', shift_start: '22:00', shift_end: '02:00', primaryProfessionKey: 'animator',
        planned_minutes: 240, planUpdatedAt: '2026-09-14T09:00:00.123456Z', original_staff_name: 'Synthetic Original',
        replacement_reason: 'Synthetic replacement', hourly_rate: 1234, segments: [{ id: 12, professionKey: 'animator',
            shiftStart: '22:00', shiftEnd: '02:00', breakMinutes: 0, additionalProfessionKeys: ['reception'],
            paidAdditionalProfessionKeys: ['reception'], estimatedSalary: 9876, additionalRoles: [{ professionKey: 'reception',
                compensationMode: 'paid_hourly', payMultiplier: 2, policyVersion: 'v1', hourlyRate: 1234 }] }] }] });
    const row = output.data[0];
    assert.equal(row.date, '2026-09-14');
    assert.equal(row.shift_end, '02:00');
    assert.equal(row.planned_minutes, 240);
    assert.equal(row.planUpdatedAt, '2026-09-14T09:00:00.123456Z');
    assert.equal(row.original_staff_name, 'Synthetic Original');
    assert.deepEqual(row.segments[0].additionalRoles, [{ professionKey: 'reception', compensationMode: 'paid_hourly', policyVersion: 'v1' }]);
    assert.deepEqual(row.segments[0].paidAdditionalProfessionKeys, ['reception']);
    assert.equal(Object.hasOwn(row, 'hourly_rate'), false);
    assert.equal(Object.hasOwn(row.segments[0], 'estimatedSalary'), false);
});

test('Park history projects object and JSON audit details and hides compensation change records and IPs', () => {
    const details = { source: 'staff.schedule', date: '2026-09-14', staffId: 7, secretMetadata: 'PRIVATE',
        before: { shiftStart: '09:00', hourly_rate: 1234 }, after: { shiftStart: '10:00', salary: 5678 },
        changes: { shiftStart: { from: '09:00', to: '10:00' }, salary: { from: 1234, to: 5678 },
            segmentAdditionalRoleCompensation: { from: ['PRIVATE'], to: ['PRIVATE'] },
            dayPlan: { from: null, to: { primaryProfessionKey: 'animator', salary: 5678, segments: [{ professionKey: 'animator',
                shiftStart: '10:00', shiftEnd: '18:00', hourlyRate: 1234 }] } } } };
    for (const representation of [details, JSON.stringify(details)]) {
        const output = project('staff', '/schedule/history/7/2026-09-14', { success: true, data: [{ id: 4,
            action: 'staff_schedule_update', staff_id: 7, performed_by: 'Synthetic Manager',
            created_at: '2026-09-14T08:00:00Z', ip_address: 'PRIVATE', details: representation }] });
        assert.equal(output.data[0].performed_by, 'Synthetic Manager');
        assert.deepEqual(output.data[0].details.changes.shiftStart, { from: '09:00', to: '10:00' });
        assert.deepEqual(output.data[0].details.changes.dayPlan.to.segments,
            [{ professionKey: 'animator', shiftStart: '10:00', shiftEnd: '18:00' }]);
        assert.equal(JSON.stringify(output).includes('PRIVATE'), false);
        assert.equal(JSON.stringify(output).includes('salary'), false);
        assert.equal(JSON.stringify(output).includes('hourly'), false);
    }
});

test('Park recovery preserves empty and error responses, supports static metadata and denies unknown projections', () => {
    for (const [router, path] of [['staff', '/'], ['staff', '/schedule'], ['staff', '/attendance'], ['hr', '/professions']]) {
        assert.deepEqual(project(router, path, { success: true, data: [] }), { success: true, data: [] });
    }
    const error = { success: false, code: 'SYNTHETIC_READ_ERROR', error: 'Unable to read' };
    assert.equal(project('staff', '/schedule', error), error);
    const stale = project('staff', '/schedule/history/7/2026-09-14', { success: true, data: [{ details: {
        outcome: 'rejected', code: 'HR_SHIFT_PLAN_STALE', changes: {} } }] });
    assert.equal(stale.data[0].details.code, 'HR_SHIFT_PLAN_STALE');
    assert.deepEqual(project('staff', '/schedule/hours', { success: true, data: { 7: { name: 'Synthetic Worker',
        totalHours: 4, workingDays: 1, hourlyRate: 1234 } } }).data,
    { 7: { name: 'Synthetic Worker', totalHours: 4, workingDays: 1 } });
    assert.deepEqual(project('staff', '/departments', { success: true, data: { animators: 'Аніматори' } }).data,
        { animators: 'Аніматори' });
    assert.throws(() => project('staff', '/payroll', { success: true, data: [] }), /Unknown Park schedule/);
    assert.throws(() => project('hr', '/staff', { success: true, data: [] }), /Unknown Park schedule/);
});
