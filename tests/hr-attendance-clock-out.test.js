const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateHrClockOutPayroll,
    isAttendanceRecordOpen,
    recordAttendanceClockOut
} = require('../services/hrAttendance');

function createClockOutDb(existing) {
    const calls = [];
    const audits = [];
    const db = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (text.startsWith('SELECT * FROM hr_time_records')) return { rows: [existing] };
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
    assert.equal(isAttendanceRecordOpen({ clock_in: baseRecord.clock_in, clock_out: null }), true);
    assert.equal(isAttendanceRecordOpen({ clock_in: baseRecord.clock_in, clock_out: '2026-07-17T14:30:00.000Z' }), false);
    assert.equal(isAttendanceRecordOpen({ clock_in: null, clock_out: null }), false);
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
        assert.equal(audits[0].record_id, 91);
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

test('repeated clock-out preserves the first departure and writes no audit', async () => {
    const existing = { ...baseRecord, clock_out: '2026-07-17T14:30:00.000Z' };
    const { db, calls, audits } = createClockOutDb(existing);

    const result = await recordAttendanceClockOut(db, {
        staffId: 7,
        recordDate: '2026-07-17',
        now: '2026-07-17T15:30:00.000Z'
    });

    assert.equal(result.record.clock_out, existing.clock_out);
    assert.equal(result.alreadyClockedOut, true);
    assert.equal(result.auditWritten, false);
    assert.equal(calls.length, 1);
    assert.equal(audits.length, 0);
});
