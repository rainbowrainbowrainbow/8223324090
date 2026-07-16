const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateHrClockOutPayroll,
    HR_ATTENDANCE_PLAN_SOURCES,
    isAttendanceRecordOpen,
    recordAttendanceClockOut,
    summarizeHrTodayItems
} = require('../services/hrAttendance');
const { isAttendanceRecordOpen: sharedIsAttendanceRecordOpen } = require('../js/hr-attendance-state');

function createClockOutDb(existing, options = {}) {
    const calls = [];
    const audits = [];
    const db = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (text.startsWith('SELECT * FROM hr_time_records')) return { rows: [existing] };
            if (text.includes('FROM hr_audit_log')) {
                if (Array.isArray(options.auditRows)) return { rows: options.auditRows };
                const planSource = options.auditPlanSource || HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT;
                return {
                    rows: [{
                        details: {
                            record_id: existing.id,
                            record_date: existing.record_date,
                            clock_in: existing.clock_in,
                            plan_source: planSource
                        }
                    }]
                };
            }
            if (text.includes('FROM hr_shifts hs')) return { rows: [] };
            if (/^SELECT s\.id, s\.role_type, COALESCE\(s\.is_active, true\) AS is_active/.test(text)) {
                return { rows: [{ id: existing.staff_id, role_type: 'manager', is_active: true }] };
            }
            if (text.includes('FROM staff_shift_preferences')) return { rows: [] };
            if (text.startsWith('UPDATE hr_time_records SET')) {
                return { rows: [{
                    ...existing,
                    clock_out: params[0],
                    total_worked_minutes: params[1],
                    late_minutes: params[2],
                    early_leave_minutes: params[3],
                    overtime_minutes: params[4],
                    status: params[5]
                }] };
            }
            if (text.startsWith('INSERT INTO hr_audit_log')) {
                audits.push(JSON.parse(params[2]));
                return { rows: [] };
            }
            throw new Error(`Unexpected SQL: ${text}`);
        }
    };
    return { db, calls, audits };
}

const baseRecord = {
    id: 91,
    staff_id: 7,
    record_date: '2026-07-17',
    clock_in: '2026-07-17T06:10:00.000Z',
    clock_out: null,
    planned_start: '09:00',
    planned_end: '18:00',
    late_minutes: 10,
    status: 'late'
};

test('open attendance means clocked in without a recorded departure', () => {
    assert.equal(isAttendanceRecordOpen, sharedIsAttendanceRecordOpen);
    assert.equal(isAttendanceRecordOpen({ clock_in: baseRecord.clock_in, clock_out: null }), true);
    assert.equal(isAttendanceRecordOpen({ clock_in: baseRecord.clock_in, clock_out: '2026-07-17T14:30:00.000Z' }), false);
    assert.equal(isAttendanceRecordOpen({ clock_in: null, clock_out: null }), false);
});

test('HR Today summary counts only open attendance as on shift', () => {
    const rows = [
        { record: { status: 'present', clock_in: '2026-07-17T06:00:00.000Z', clock_out: null } },
        { record: { status: 'late', clock_in: '2026-07-17T06:12:00.000Z', clock_out: '2026-07-17T15:00:00.000Z', late_minutes: 12 } },
        { record: { status: 'early_leave', clock_in: '2026-07-17T06:00:00.000Z', clock_out: '2026-07-17T13:00:00.000Z', early_leave_minutes: 120 } },
        { record: { status: 'auto_closed', clock_in: '2026-07-17T06:00:00.000Z', clock_out: '2026-07-17T15:00:00.000Z', auto_closed: true } },
        { record: { status: 'sick', clock_in: null, clock_out: null } },
        { record: { status: 'vacation', clock_in: null, clock_out: null } },
        { record: null, shift: { planned_start: '09:00', planned_end: '18:00' } }
    ];

    assert.deepEqual(summarizeHrTodayItems(rows), {
        total_staff: 7,
        present: 1,
        late: 1,
        absent: 1,
        on_vacation: 1,
        sick: 1
    });
});

test('HR Today production-style closed rows do not inflate on-shift KPI', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
        staff_id: index + 1,
        record: {
            status: 'present',
            clock_in: '2026-07-17T06:00:00.000Z',
            clock_out: '2026-07-17T15:00:00.000Z'
        }
    }));

    assert.equal(summarizeHrTodayItems(rows).present, 0);
});

test('scheduled and actual settlement keep the same independent attendance facts', async () => {
    const results = [];
    for (const settlementMode of ['scheduled_shift', 'actual_time']) {
        const { db, audits } = createClockOutDb({ ...baseRecord });
        const result = await recordAttendanceClockOut(db, {
            staffId: 7,
            recordDate: '2026-07-17',
            settlementMode,
            method: settlementMode === 'scheduled_shift' ? 'manual' : 'face',
            source: settlementMode === 'scheduled_shift' ? 'hr_today' : 'staff_checkin',
            now: '2026-07-17T14:30:00.000Z'
        });
        results.push(result);

        assert.equal(result.record.clock_out, '2026-07-17T14:30:00.000Z');
        assert.equal(result.record.late_minutes, 10);
        assert.equal(result.record.early_leave_minutes, 30);
        assert.equal(result.record.overtime_minutes, 0);
        assert.equal(result.record.status, 'late');
        assert.equal(result.record.plan_source, 'hr_shift');
        assert.equal(result.planSource, 'hr_shift');
        assert.equal(result.plan.source, 'hr_shift');
        assert.equal(audits[0].record_id, 91);
        assert.equal(audits[0].plan_source, 'hr_shift');
        assert.equal(audits[0].early_leave_minutes, 30);
        assert.equal(audits[0].settlement_mode, settlementMode);
    }

    assert.equal(results[0].record.total_worked_minutes, 540);
    assert.equal(results[1].record.total_worked_minutes, 500);
});

test('overtime does not erase an existing late-arrival fact', () => {
    const payroll = calculateHrClockOutPayroll(baseRecord, {
        clockOut: '2026-07-17T15:30:00.000Z',
        recordDate: '2026-07-17',
        settlementMode: 'scheduled_shift'
    });

    assert.equal(payroll.lateMinutes, 10);
    assert.equal(payroll.earlyLeaveMinutes, 0);
    assert.equal(payroll.overtimeMinutes, 30);
    assert.equal(payroll.status, 'late');
    assert.equal(payroll.totalWorkedMinutes, 540);
});

test('early-leave and overtime grace boundaries activate only after fifteen minutes', () => {
    const scenarios = [
        { label: 'early 15', clockOut: '2026-07-17T14:45:00.000Z', early: 0, overtime: 0 },
        { label: 'early 16', clockOut: '2026-07-17T14:44:00.000Z', early: 16, overtime: 0 },
        { label: 'overtime 15', clockOut: '2026-07-17T15:15:00.000Z', early: 0, overtime: 0 },
        { label: 'overtime 16', clockOut: '2026-07-17T15:16:00.000Z', early: 0, overtime: 16 }
    ];

    for (const scenario of scenarios) {
        const payroll = calculateHrClockOutPayroll({
            ...baseRecord,
            clock_in: '2026-07-17T06:00:00.000Z',
            late_minutes: 0,
            status: 'present'
        }, {
            clockOut: scenario.clockOut,
            recordDate: '2026-07-17',
            settlementMode: 'actual_time'
        });

        assert.equal(payroll.earlyLeaveMinutes, scenario.early, `${scenario.label}: early leave`);
        assert.equal(payroll.overtimeMinutes, scenario.overtime, `${scenario.label}: overtime`);
    }
});

test('clock-out keeps attendance overtime separate from allocation overtime', () => {
    const earlyArrival = calculateHrClockOutPayroll({
        ...baseRecord,
        clock_in: '2026-07-17T05:55:00.000Z', // 08:55 Europe/Kyiv
        late_minutes: 0,
        status: 'present'
    }, {
        clockOut: '2026-07-17T15:00:00.000Z', // 18:00 Europe/Kyiv
        recordDate: '2026-07-17',
        settlementMode: 'actual_time'
    });

    assert.equal(earlyArrival.overtimeMinutes, 0);
    assert.equal(earlyArrival.allocation.overtimeMinutes, 5);

    const overtimeAfterGrace = calculateHrClockOutPayroll({
        ...baseRecord,
        clock_in: '2026-07-17T05:55:00.000Z',
        late_minutes: 0,
        status: 'present'
    }, {
        clockOut: '2026-07-17T15:16:00.000Z', // 18:16 Europe/Kyiv
        recordDate: '2026-07-17',
        settlementMode: 'actual_time'
    });

    assert.equal(overtimeAfterGrace.overtimeMinutes, 16);
    assert.equal(overtimeAfterGrace.allocation.overtimeMinutes, 21);

    const shortIntervalAfterShift = calculateHrClockOutPayroll({
        ...baseRecord,
        clock_in: '2026-07-17T15:30:00.000Z', // 18:30 Europe/Kyiv
        late_minutes: 0,
        status: 'present'
    }, {
        clockOut: '2026-07-17T15:40:00.000Z', // 18:40 Europe/Kyiv
        recordDate: '2026-07-17',
        settlementMode: 'actual_time'
    });

    assert.equal(shortIntervalAfterShift.overtimeMinutes, 40);
    assert.equal(shortIntervalAfterShift.allocation.overtimeMinutes, 10);
    assert.equal(shortIntervalAfterShift.actualWorkedMinutes, 10);
});

test('correction-style recalculation clears stale combined status when facts are removed', () => {
    const payroll = calculateHrClockOutPayroll({
        ...baseRecord,
        status: 'early_leave'
    }, {
        clockIn: '2026-07-17T06:00:00.000Z',
        clockOut: '2026-07-17T15:00:00.000Z',
        recordDate: '2026-07-17',
        settlementMode: 'actual_time'
    });

    assert.equal(payroll.lateMinutes, 0);
    assert.equal(payroll.earlyLeaveMinutes, 0);
    assert.equal(payroll.overtimeMinutes, 0);
    assert.equal(payroll.status, 'present');
});

test('overnight departure facts cross the Kyiv day boundary', () => {
    const payroll = calculateHrClockOutPayroll({
        record_date: '2026-07-17',
        clock_in: '2026-07-17T19:10:00.000Z',
        planned_start: '22:00',
        planned_end: '02:00',
        status: 'late'
    }, {
        clockOut: '2026-07-17T22:30:00.000Z',
        recordDate: '2026-07-17',
        settlementMode: 'scheduled_shift'
    });

    assert.equal(payroll.lateMinutes, 10);
    assert.equal(payroll.earlyLeaveMinutes, 30);
    assert.equal(payroll.overtimeMinutes, 0);
    assert.equal(payroll.totalWorkedMinutes, 240);
});

test('repeated clock-out preserves the first departure and reuses initial plan source', async () => {
    const existing = { ...baseRecord, clock_out: '2026-07-17T14:30:00.000Z' };
    const { db, calls, audits } = createClockOutDb(existing, {
        auditPlanSource: HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD
    });

    const result = await recordAttendanceClockOut(db, {
        staffId: 7,
        recordDate: '2026-07-17',
        now: '2026-07-17T15:30:00.000Z'
    });

    assert.equal(result.record.clock_out, existing.clock_out);
    assert.equal(result.alreadyClockedOut, true);
    assert.equal(result.auditWritten, false);
    assert.equal(result.planSource, 'profession_card');
    assert.equal(result.plan.source, 'profession_card');
    assert.equal(result.record.plan_source, 'profession_card');
    assert.equal(calls.length, 2);
    assert.equal(audits.length, 0);
});
