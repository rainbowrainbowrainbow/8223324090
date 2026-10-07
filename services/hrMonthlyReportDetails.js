'use strict';

const { attendanceFactMinutes } = require('./hrAttendance');

function dateText(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value || '').slice(0, 10);
}

function reportAttendanceByStaff(staffRows = [], shiftRows = [], recordRows = []) {
    // Both HR tables have UNIQUE(staff_id, date). record_date is the shift's
    // reporting date even when clock_out crosses midnight in Kyiv.
    const byStaff = new Map(staffRows.map(staff => [Number(staff.id), {
        days_scheduled: 0,
        planned_worked_count: 0,
        unplanned_worked_count: 0,
        days_worked: 0,
        days_late: 0,
        late_count: 0,
        total_late_minutes: 0,
        days_early_leave: 0,
        total_early_leave_minutes: 0,
        days_absent: 0,
        days_sick: 0,
        days_vacation: 0,
        total_worked_minutes: 0,
        total_overtime_minutes: 0,
        profession_card_days: 0,
        unscheduled_days: 0,
        attendance_details: {
            scheduled: [], planned_worked: [], unplanned_worked: [],
            worked: [], late: [], early_leave: [], absent: [], overtime: [],
            plan_warning: []
        }
    }]));
    const shiftsByDay = new Map();
    const recordsByDay = new Map();
    for (const record of recordRows) {
        recordsByDay.set(`${Number(record.staff_id)}:${dateText(record.record_date)}`, record);
    }
    for (const shift of shiftRows) {
        const staffId = Number(shift.staff_id);
        const stats = byStaff.get(staffId);
        if (!stats) continue;
        const date = dateText(shift.shift_date);
        const key = `${staffId}:${date}`;
        shiftsByDay.set(key, shift);
        const record = recordsByDay.get(key);
        stats.days_scheduled++;
        stats.attendance_details.scheduled.push({
            staff_id: staffId, date, shift_id: shift.id ?? null,
            planned_start: shift.planned_start ?? null, planned_end: shift.planned_end ?? null,
            profession_key: shift.profession_key || null, shift_type: shift.shift_type || null,
            status: record?.status || 'unmarked',
            clock_in: record?.clock_in || null, clock_out: record?.clock_out || null
        });
    }
    for (const record of recordRows) {
        const staffId = Number(record.staff_id);
        const stats = byStaff.get(staffId);
        if (!stats) continue;
        const date = dateText(record.record_date);
        const shift = shiftsByDay.get(`${staffId}:${date}`);
        const facts = attendanceFactMinutes(record);
        const planSource = shift ? 'hr_shift'
            : (record.planned_start && record.planned_end ? 'profession_card' : 'unscheduled');
        const detail = {
            staff_id: staffId, date, record_id: record.id ?? null,
            shift_id: shift?.id ?? null, planned_start: shift?.planned_start ?? record.planned_start ?? null,
            planned_end: shift?.planned_end ?? record.planned_end ?? null,
            profession_key: shift?.profession_key || record.profession_key || null,
            shift_type: shift?.shift_type || null, plan_source: planSource,
            status: record.status || null, clock_in: record.clock_in || null,
            clock_out: record.clock_out || null,
            late_minutes: facts.lateMinutes, early_leave_minutes: facts.earlyLeaveMinutes,
            overtime_minutes: record.clock_in ? facts.overtimeMinutes : 0,
            worked_minutes: record.clock_in ? Number(record.total_worked_minutes || 0) : 0
        };
        if (record.clock_in) {
            stats.days_worked++;
            stats.total_worked_minutes += detail.worked_minutes;
            stats.total_overtime_minutes += detail.overtime_minutes;
            stats.attendance_details.worked.push(detail);
            if (shift) {
                stats.planned_worked_count++;
                stats.attendance_details.planned_worked.push(detail);
            } else {
                stats.unplanned_worked_count++;
                stats.attendance_details.unplanned_worked.push(detail);
            }
        }
        if (facts.lateMinutes > 0) {
            stats.days_late++;
            stats.late_count++;
            stats.total_late_minutes += facts.lateMinutes;
            stats.attendance_details.late.push(detail);
        }
        if (facts.earlyLeaveMinutes > 0) {
            stats.days_early_leave++;
            stats.total_early_leave_minutes += facts.earlyLeaveMinutes;
            stats.attendance_details.early_leave.push(detail);
        }
        if (detail.overtime_minutes > 0) stats.attendance_details.overtime.push(detail);
        if (planSource === 'profession_card') stats.profession_card_days++;
        if (planSource === 'unscheduled') stats.unscheduled_days++;
        if (planSource !== 'hr_shift') stats.attendance_details.plan_warning.push(detail);
        if (record.status === 'absent' || record.status === 'no_show') {
            stats.days_absent++;
            stats.attendance_details.absent.push(detail);
        }
        if (record.status === 'sick') stats.days_sick++;
        if (record.status === 'vacation') stats.days_vacation++;
    }
    for (const stats of byStaff.values()) {
        stats.plan_warning_count = stats.profession_card_days + stats.unscheduled_days;
        stats.total_worked_hours = Math.round(stats.total_worked_minutes / 60 * 10) / 10;
        stats.total_overtime_hours = Math.round(stats.total_overtime_minutes / 60 * 10) / 10;
        stats.avg_late_minutes = stats.late_count
            ? Math.round(stats.total_late_minutes / stats.late_count) : 0;
        stats.attendance_rate = stats.days_scheduled
            ? Math.round(stats.planned_worked_count / stats.days_scheduled * 100) : null;
        for (const details of Object.values(stats.attendance_details)) {
            details.sort((left, right) => left.date.localeCompare(right.date)
                || Number(left.record_id || left.shift_id || 0) - Number(right.record_id || right.shift_id || 0));
        }
    }
    return byStaff;
}

module.exports = { reportAttendanceByStaff };
