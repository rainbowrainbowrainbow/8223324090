const test = require('node:test');
const assert = require('node:assert/strict');

const {
    attendanceReportingFacts,
    decorateAttendanceRecord
} = require('../services/hrAttendance');

test('attendance reporting keeps late, early leave, and overtime as independent facts', () => {
    const facts = attendanceReportingFacts({
        status: 'left_early',
        late_minutes: 6,
        early_leave_minutes: 25,
        overtime_minutes: 10,
        planned_start: '09:00',
        planned_end: '18:00',
        plan_source: 'hr_shift'
    });

    assert.equal(facts.isLate, true);
    assert.equal(facts.isEarlyLeave, true);
    assert.equal(facts.hasOvertime, true);
    assert.equal(facts.lateMinutes, 6);
    assert.equal(facts.earlyLeaveMinutes, 25);
    assert.equal(facts.overtimeMinutes, 10);
    assert.equal(facts.planSource, 'hr_shift');
    assert.equal(facts.planWarning, null);
});

test('attendance reporting does not count the five-minute grace period as late', () => {
    const decorated = decorateAttendanceRecord({
        record_date: '2026-07-16',
        status: 'late',
        late_minutes: 5,
        early_leave_minutes: 30,
        overtime_minutes: 0,
        planned_start: '09:00',
        planned_end: '18:00',
        plan_source: 'profession_card'
    });

    assert.equal(decorated.is_late, false);
    assert.equal(decorated.is_early_leave, true);
    assert.equal(decorated.attendance_facts.lateMinutes, 0);
    assert.equal(decorated.attendance_facts.earlyLeaveMinutes, 30);
    assert.equal(decorated.plan_source, 'profession_card');
    assert.equal(decorated.plan_warning.code, 'PROFESSION_CARD_FALLBACK');
});

test('attendance reporting explicitly warns when no plan exists', () => {
    const facts = attendanceReportingFacts({
        late_minutes: 0,
        early_leave_minutes: 0,
        overtime_minutes: 0
    });

    assert.equal(facts.planSource, 'unscheduled');
    assert.equal(facts.planWarning.code, 'ATTENDANCE_UNSCHEDULED');
    assert.equal(facts.plannedStart, null);
    assert.equal(facts.plannedEnd, null);
});
