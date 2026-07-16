const test = require('node:test');
const assert = require('node:assert/strict');

const {
    HR_ATTENDANCE_GRACE_MINUTES,
    HR_ATTENDANCE_PLAN_SOURCES,
    attendanceDayType,
    calculateHrClockOutPayroll,
    plannedShiftWorkedMinutes,
    resolveAttendancePlan
} = require('../services/hrAttendance');

function createPlanDb(options = {}) {
    const calls = [];
    const preferences = options.preferences || {};
    const db = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (text.includes('FROM hr_shifts hs')) {
                return { rows: options.shiftRows || [] };
            }
            if (/^SELECT s\.id, s\.role_type, COALESCE\(s\.is_active, true\) AS is_active/.test(text)) {
                return { rows: options.staff ? [options.staff] : [] };
            }
            if (text.includes('FROM staff_shift_preferences')) {
                const key = `${params[1]}:${params[2]}`;
                return { rows: preferences[key] ? [preferences[key]] : [] };
            }
            throw new Error(`Unexpected SQL: ${text}`);
        }
    };
    return { db, calls };
}

function shiftSnapshot(overrides = {}) {
    const shift = {
        id: 41,
        staff_id: 7,
        shift_date: '2026-07-16',
        profession_key: 'reception',
        planned_start: '09:00',
        planned_end: '18:00',
        break_minutes: 30,
        shift_type: 'regular',
        created_at: new Date('2026-07-10T08:00:00.000Z'),
        updated_at: new Date('2026-07-10T08:00:00.000Z'),
        ...overrides.shift
    };
    return {
        shift_row: shift,
        plan_updated_at_token: '2026-07-10T08:00:00.000000Z',
        segment_id: overrides.segmentId || 411,
        profession_key: overrides.professionKey || shift.profession_key,
        planned_start: overrides.plannedStart || shift.planned_start,
        planned_end: overrides.plannedEnd || shift.planned_end,
        break_minutes: overrides.breakMinutes ?? shift.break_minutes,
        notes: null,
        sort_order: 0,
        additional_profession_keys: overrides.additionalProfessionKeys || []
    };
}

test('attendance plan prefers the explicit HR shift over profession-card defaults', async () => {
    const { db, calls } = createPlanDb({
        shiftRows: [shiftSnapshot()],
        staff: { id: 7, role_type: 'animator', is_active: true },
        preferences: {
            'animator:weekday': { start_time: '12:00:00', end_time: '20:00:00', is_active: true }
        }
    });

    const plan = await resolveAttendancePlan(db, 7, '2026-07-16');

    assert.equal(plan.source, HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT);
    assert.equal(plan.plannedStart, '09:00');
    assert.equal(plan.plannedEnd, '18:00');
    assert.equal(plan.professionKey, 'reception');
    assert.equal(plan.segments.length, 1);
    assert.equal(calls.length, 1, 'profession-card fallback must not load when an HR shift exists');
});

test('attendance plan falls back to the primary profession weekday preference', async () => {
    const { db } = createPlanDb({
        staff: { id: 7, role_type: 'animator', is_active: true },
        preferences: {
            'animator:weekday': { start_time: '12:00:00', end_time: '20:00:00', is_active: true }
        }
    });

    const plan = await resolveAttendancePlan(db, 7, '2026-07-17');

    assert.deepEqual(plan, {
        plannedStart: '12:00',
        plannedEnd: '20:00',
        professionKey: 'animator',
        segments: [{
            id: null,
            professionKey: 'animator',
            shiftStart: '12:00',
            shiftEnd: '20:00',
            breakMinutes: 0,
            note: null,
            additionalProfessionKeys: []
        }],
        source: HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD
    });
});

test('attendance plan uses only the primary profession when no dated shift exists', async () => {
    const { db, calls } = createPlanDb({
        staff: {
            id: 7,
            role_type: 'legacy_manager',
            assigned_primary_profession_key: 'animator',
            secondary_professions: ['instructor'],
            is_active: true
        },
        preferences: {
            'animator:weekend': { start_time: '10:00:00', end_time: '20:00:00', is_active: true },
            'instructor:weekend': { start_time: '09:00:00', end_time: '20:00:00', is_active: true }
        }
    });

    const plan = await resolveAttendancePlan(db, 7, '2026-07-18');
    const preferenceCall = calls.find(call => call.text.includes('FROM staff_shift_preferences'));

    assert.equal(plan.professionKey, 'animator');
    assert.equal(plan.plannedStart, '10:00');
    assert.deepEqual(preferenceCall.params, [7, 'animator', 'weekend']);
});

test('attendance plan resolves Kyiv weekend and preserves an overnight profession-card shift', async () => {
    const { db, calls } = createPlanDb({
        staff: { id: 7, role_type: 'security', is_active: true },
        preferences: {
            'security:weekend': { start_time: '20:00:00', end_time: '04:00:00', is_active: true }
        }
    });

    const plan = await resolveAttendancePlan(db, 7, new Date('2026-07-17T21:30:00.000Z'));
    const shiftCall = calls.find(call => call.text.includes('FROM hr_shifts hs'));

    assert.equal(attendanceDayType(new Date('2026-07-17T21:30:00.000Z')), 'weekend');
    assert.deepEqual(shiftCall.params, [7, '2026-07-18']);
    assert.equal(plan.plannedStart, '20:00');
    assert.equal(plan.plannedEnd, '04:00');
    assert.equal(plannedShiftWorkedMinutes(plan.plannedStart, plan.plannedEnd), 480);
});

test('attendance plan returns an explicit unscheduled result when neither source exists', async () => {
    const { db } = createPlanDb({
        staff: { id: 7, role_type: 'manager', is_active: true }
    });

    const plan = await resolveAttendancePlan(db, 7, '2026-07-16');

    assert.deepEqual(plan, {
        plannedStart: null,
        plannedEnd: null,
        professionKey: 'manager',
        segments: [],
        source: HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED
    });
});

test('attendance grace values are one shared immutable contract', () => {
    assert.deepEqual(HR_ATTENDANCE_GRACE_MINUTES, {
        late: 5,
        earlyLeave: 15,
        overtime: 15
    });
    assert.equal(Object.isFrozen(HR_ATTENDANCE_GRACE_MINUTES), true);
});

test('clock-out calculation applies the shared early-leave and overtime grace values', () => {
    const base = {
        status: 'present',
        clock_in: '2026-07-16T06:00:00.000Z',
        record_date: '2026-07-16'
    };
    const options = {
        plannedStart: '09:00',
        plannedEnd: '18:00',
        recordDate: '2026-07-16',
        settlementMode: 'actual_time'
    };

    const withinOvertimeGrace = calculateHrClockOutPayroll(base, {
        ...options,
        clockOut: '2026-07-16T15:10:00.000Z'
    });
    const overtime = calculateHrClockOutPayroll(base, {
        ...options,
        clockOut: '2026-07-16T15:16:00.000Z'
    });
    const withinEarlyLeaveGrace = calculateHrClockOutPayroll(base, {
        ...options,
        clockOut: '2026-07-16T14:50:00.000Z'
    });
    const earlyLeave = calculateHrClockOutPayroll(base, {
        ...options,
        clockOut: '2026-07-16T14:44:00.000Z'
    });

    assert.equal(withinOvertimeGrace.overtimeMinutes, 0);
    assert.equal(overtime.overtimeMinutes, 16);
    assert.equal(withinEarlyLeaveGrace.earlyLeaveMinutes, 0);
    assert.equal(earlyLeave.earlyLeaveMinutes, 16);
});
