'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reportAttendanceByStaff } = require('../services/hrMonthlyReportDetails');

test('monthly report separates matched and unplanned attendance with traceable details', () => {
    const staff = [{ id: 12 }];
    const shifts = [1, 2, 3].map(day => ({
        id: day, staff_id: 12, shift_date: `2026-09-0${day}`,
        planned_start: '09:00', planned_end: '17:00'
    }));
    const records = [
        { id: 101, staff_id: 12, record_date: '2026-09-01', status: 'present',
            clock_in: '2026-09-01T06:05:00Z', total_worked_minutes: 480,
            late_minutes: 205, early_leave_minutes: 20, overtime_minutes: 45 },
        { id: 102, staff_id: 12, record_date: '2026-09-02', status: 'absent' },
        { id: 104, staff_id: 12, record_date: '2026-09-04', status: 'present',
            clock_in: '2026-09-04T06:00:00Z', total_worked_minutes: 420 },
        { id: 105, staff_id: 12, record_date: '2026-09-05', status: 'present',
            clock_in: '2026-09-05T06:00:00Z', total_worked_minutes: 420,
            planned_start: '09:00', planned_end: '17:00' }
    ];
    const result = reportAttendanceByStaff(staff, shifts, records).get(12);
    assert.equal(result.days_scheduled, 3);
    assert.equal(result.planned_worked_count, 1);
    assert.equal(result.unplanned_worked_count, 2);
    assert.equal(result.days_worked, 3);
    assert.equal(result.attendance_rate, 33);
    assert.equal(result.days_absent, 1);
    assert.equal(result.attendance_details.scheduled[2].status, 'unmarked');
    assert.equal(result.attendance_details.absent[0].record_id, 102);
    assert.deepEqual(result.attendance_details.unplanned_worked.map(item => item.plan_source),
        ['unscheduled', 'profession_card']);
    assert.equal(result.avg_late_minutes, 205);
    assert.equal(result.attendance_details.late[0].late_minutes, 205);
    assert.equal(result.attendance_details.early_leave.length, 1);
    assert.equal(result.attendance_details.overtime.length, 1);
    assert.equal(result.attendance_details.plan_warning.length, 2);
});

test('monthly attendance rate is unavailable without scheduled shifts', () => {
    const stats = reportAttendanceByStaff([{ id: 6 }], [], [{
        staff_id: 6, record_date: '2026-09-01', clock_in: '2026-09-01T06:00:00Z'
    }]).get(6);
    assert.equal(stats.days_worked, 1);
    assert.equal(stats.unplanned_worked_count, 1);
    assert.equal(stats.attendance_rate, null);
    assert.equal(stats.days_absent, 0);
});
