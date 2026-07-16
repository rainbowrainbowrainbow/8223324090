const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateAttendanceClockIn,
    recordAttendanceClockIn
} = require('../services/hrAttendance');

function createClockInDb(options = {}) {
    const calls = [];
    const audits = [];
    const db = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (text.startsWith('SELECT * FROM hr_time_records')) {
                return { rows: options.existing ? [options.existing] : [] };
            }
            if (text.includes('FROM hr_shifts hs')) return { rows: options.shiftRows || [] };
            if (/^SELECT s\.id, s\.role_type, COALESCE\(s\.is_active, true\) AS is_active/.test(text)) {
                return { rows: options.staff ? [options.staff] : [] };
            }
            if (text.includes('FROM staff_shift_preferences')) {
                return { rows: options.preference ? [options.preference] : [] };
            }
            if (text.startsWith('INSERT INTO hr_time_records')) {
                return { rows: [{
                    id: 901,
                    business_context: params[0],
                    staff_id: params[1],
                    record_date: params[2],
                    clock_in: params[3],
                    planned_start: params[4],
                    planned_end: params[5],
                    late_minutes: params[6],
                    status: params[7]
                }] };
            }
            if (text.startsWith('UPDATE hr_time_records SET')) {
                return { rows: [{
                    ...options.existing,
                    clock_in: params[0],
                    planned_start: params[1],
                    planned_end: params[2],
                    late_minutes: params[3],
                    status: params[4]
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

const professionCard = {
    staff: { id: 7, role_type: 'animator', is_active: true },
    preference: { start_time: '12:00:00', end_time: '20:00:00', is_active: true }
};

test('HR Today and face check-in use the same profession-card snapshot and five-minute grace', async () => {
    const results = [];
    for (const routeInput of [
        { method: 'manual', source: 'hr_today' },
        { method: 'face', source: 'staff_checkin' }
    ]) {
        const { db, audits } = createClockInDb(professionCard);
        const result = await recordAttendanceClockIn(db, {
            staffId: 7,
            recordDate: '2026-07-17',
            businessContext: 'default',
            performedBy: routeInput.method,
            ...routeInput,
            now: '2026-07-17T09:05:00.000Z'
        });
        results.push(result);

        assert.equal(result.record.planned_start, '12:00');
        assert.equal(result.record.planned_end, '20:00');
        assert.equal(result.record.late_minutes, 0);
        assert.equal(result.record.status, 'present');
        assert.equal(result.planSource, 'profession_card');
        assert.equal(audits.length, 1);
        assert.equal(audits[0].plan_source, 'profession_card');
        assert.equal(audits[0].source, routeInput.source);
    }

    assert.deepEqual(
        results.map(result => ({
            clockIn: result.record.clock_in,
            plannedStart: result.record.planned_start,
            plannedEnd: result.record.planned_end,
            lateMinutes: result.record.late_minutes,
            status: result.record.status
        })),
        [
            { clockIn: '2026-07-17T09:05:00.000Z', plannedStart: '12:00', plannedEnd: '20:00', lateMinutes: 0, status: 'present' },
            { clockIn: '2026-07-17T09:05:00.000Z', plannedStart: '12:00', plannedEnd: '20:00', lateMinutes: 0, status: 'present' }
        ]
    );
});

test('six minutes after the planned start is late', () => {
    const result = calculateAttendanceClockIn({
        source: 'profession_card',
        plannedStart: '12:00',
        plannedEnd: '20:00'
    }, '2026-07-17T09:06:00.000Z', '2026-07-17');

    assert.equal(result.lateMinutes, 6);
    assert.equal(result.status, 'late');
});

test('repeated check-in preserves the first clock-in and writes no new audit', async () => {
    const existing = {
        id: 77,
        staff_id: 7,
        record_date: '2026-07-17',
        clock_in: '2026-07-17T08:58:00.000Z',
        planned_start: '12:00',
        planned_end: '20:00',
        late_minutes: 0,
        status: 'present'
    };
    const { db, calls, audits } = createClockInDb({ existing });

    const result = await recordAttendanceClockIn(db, {
        staffId: 7,
        recordDate: '2026-07-17',
        now: '2026-07-17T10:00:00.000Z'
    });

    assert.equal(result.record.clock_in, existing.clock_in);
    assert.equal(result.alreadyClockedIn, true);
    assert.equal(result.auditWritten, false);
    assert.equal(result.planSource, 'attendance_snapshot');
    assert.equal(calls.length, 1);
    assert.equal(audits.length, 0);
});

test('missing shift and profession-card hours records an explicit unscheduled arrival', async () => {
    const { db, audits } = createClockInDb({
        staff: { id: 7, role_type: 'manager', is_active: true }
    });

    const result = await recordAttendanceClockIn(db, {
        staffId: 7,
        recordDate: '2026-07-17',
        now: '2026-07-17T09:06:00.000Z'
    });

    assert.equal(result.record.planned_start, null);
    assert.equal(result.record.planned_end, null);
    assert.equal(result.record.late_minutes, 0);
    assert.equal(result.record.status, 'unscheduled');
    assert.equal(audits[0].plan_source, 'unscheduled');
});
