const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateAttendanceClockIn,
    HR_ATTENDANCE_PLAN_SOURCES,
    cancelAttendanceClockIn,
    hydrateAttendanceRecords,
    recordAttendanceClockIn,
    recordAttendanceStatus
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
            if (text.includes('FROM hr_audit_log')) {
                if (Array.isArray(options.auditRows)) return { rows: options.auditRows };
                if (options.auditPlanSource) {
                    return {
                        rows: [{
                            details: {
                                record_id: options.existing?.id ?? null,
                                record_date: options.existing?.record_date ?? null,
                                clock_in: options.existing?.clock_in ?? null,
                                plan_source: options.auditPlanSource
                            }
                        }]
                    };
                }
                return { rows: [] };
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
                const action = text.match(/VALUES \('([^']+)'/)?.[1] || null;
                audits.push({
                    action,
                    ...JSON.parse(params[2])
                });
                return { rows: [] };
            }

            if (text.startsWith('SELECT * FROM staff WHERE')) return { rows: [{ id: Number(params?.[0]?.[0] || 7), role_type: 'animator', hourly_rate: options.hourlyRate ?? 100, rate_unit: 'hour', is_active: true }] };
            if (text.includes('FROM staff_payroll_profile_assignments') || text.includes('FROM payroll_profiles')
                || text.includes('FROM payroll_day_exceptions') || text.includes('FROM payroll_schemes')
                || text.includes('FROM hr_compensation_policies') || text.includes('FROM staff_role_assignments')
                || text.includes('FROM staff_profession_rates')) return { rows: [] };
            throw new Error(`Unexpected SQL: ${text}`);
        }
    };
    return { db, calls, audits };
}

const professionCard = {
    staff: { id: 7, role_type: 'animator', is_active: true },
    preference: { start_time: '12:00:00', end_time: '20:00:00', is_active: true }
};

test('an unscheduled arrival that requires compensation review is still on shift', async () => {
    const { db } = createClockInDb({ staff: professionCard.staff, hourlyRate: 0 });
    const { record } = await recordAttendanceClockIn(db, {
        staffId: 7, recordDate: '2026-07-17', now: '2026-07-17T09:05:00Z'
    });
    assert.equal(record.status, 'manual_review');
    assert.equal(record.plan_source, 'unscheduled');
    assert.ok(record.clock_in);
    assert.ok(!record.clock_out);
});

test('a chosen arrival records the actual time and captures the plan at submission', async () => {
    const { db, audits } = createClockInDb(professionCard);
    const { record } = await recordAttendanceClockIn(db, {
        staffId: 7,
        recordDate: '2026-07-17',
        now: '2026-07-17T10:00:00Z',
        actualTime: '2026-07-17T09:06:00Z'
    });
    assert.equal(record.clock_in, '2026-07-17T09:06:00.000Z');
    assert.equal(record.late_minutes, 6);
    assert.equal(audits[0].method, 'manual');
    assert.equal(audits[0].source, 'hr_today');
    assert.equal(audits[0].time_mode, 'chosen');
    assert.equal(audits[1].compensationSnapshot.capturedAt, '2026-07-17T10:00:00.000Z');
});

test('cancel preserves the arrival in audit and the same staff can clock in again', async () => {
    const input = {
        staffId: 7, recordId: 901, recordDate: '2026-07-17', clockIn: '2026-07-17T09:05:00.000Z',
        businessContext: 'event_genix', performedBy: 'synthetic-manager'
    };
    const original = {
        id: 901, staff_id: 7, record_date: input.recordDate, clock_in: new Date(input.clockIn),
        clock_out: null, business_context: input.businessContext, manual_arrival: true, status: 'manual_review',
        late_minutes: 12, total_worked_minutes: 0
    };
    let current = { ...original };
    let protectedUsage = false;
    const audit = [];
    const db = {
        async query(sql, params) {
            if (/SELECT tr\.\*/.test(sql)) return { rows: [current] };
            if (/SELECT EXISTS/.test(sql)) return { rows: [{ protected: protectedUsage }] };
            if (/UPDATE hr_time_records/.test(sql)) {
                assert.match(sql, /clock_in = NULL/);
                assert.match(sql, /compensation_snapshot = NULL/);
                assert.equal(params[0], original.id);
                current = { ...current, clock_in: null, status: params[1], late_minutes: 0 };
                return { rows: [] };
            }
            if (/INSERT INTO hr_audit_log/.test(sql)) {
                audit.push(JSON.parse(params[2]));
                return { rows: [] };
            }
            assert.fail(sql);
        }
    };
    const unavailable = { code: 'ATTENDANCE_ARRIVAL_NOT_CANCELLABLE' };
    await assert.rejects(cancelAttendanceClockIn(db, { ...input, clockIn: '2026-07-17T08:00:00Z' }), unavailable);
    await assert.rejects(cancelAttendanceClockIn(db, { ...input, businessContext: 'dar' }), unavailable);
    current = { ...original, clock_out: '2026-07-17T16:00:00Z' };
    await assert.rejects(cancelAttendanceClockIn(db, input), unavailable);
    current = { ...original, manual_arrival: false };
    await assert.rejects(cancelAttendanceClockIn(db, input), unavailable);
    current = { ...original };
    protectedUsage = true;
    await assert.rejects(cancelAttendanceClockIn(db, input), { code: 'ATTENDANCE_ARRIVAL_ALREADY_ACCOUNTED' });
    assert.equal(audit.length, 0);
    protectedUsage = false;
    await cancelAttendanceClockIn(db, input);
    assert.equal(current.clock_in, null);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].clock_in, input.clockIn);
    assert.equal(audit[0].old_status, 'manual_review');
    assert.deepEqual(await hydrateAttendanceRecords(db, [current]), []);
    await assert.rejects(cancelAttendanceClockIn(db, input), unavailable);

    const retry = createClockInDb({ ...professionCard, existing: current });
    const arrived = await recordAttendanceClockIn(retry.db, {
        ...input, source: 'hr_today', now: '2026-07-17T09:07:00.000Z'
    });
    assert.equal(arrived.record.id, original.id);
    assert.equal(arrived.record.clock_in, '2026-07-17T09:07:00.000Z');
    assert.equal(arrived.alreadyClockedIn, false);
    current = arrived.record;
    await assert.rejects(cancelAttendanceClockIn(db, input), unavailable);
});

test('HR Today and face check-in use the same profession-card snapshot and five-minute grace', async () => {
    const results = [];
    for (const routeInput of [
        { method: 'manual', source: 'hr_today' },
        { method: 'face', source: 'staff_checkin' }
    ]) {
        const { db, audits, calls } = createClockInDb(professionCard);
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
        assert.equal(result.plan.source, 'profession_card');
        assert.equal(result.record.plan_source, 'profession_card');
        assert.equal(result.record.compensation_snapshot.state, 'planned');
        assert.equal(result.record.compensation_snapshot.plan.segments.length, 1);
        assert.equal(result.record.compensation_snapshot.compensationAllocations[0].allocationType, 'base');
        assert.ok(calls.some(call => /compensation_snapshot/.test(call.text)));
        assert.equal(audits.length, 2);
        const clockInAudit = audits.find(audit => audit.action === 'clock_in');
        const snapshotAudit = audits.find(audit => audit.action === 'compensation_snapshot_created');
        assert.equal(clockInAudit.record_id, 901);
        assert.equal(clockInAudit.record_date, '2026-07-17');
        assert.equal(clockInAudit.plan_source, 'profession_card');
        assert.equal(clockInAudit.compensation_snapshot_state, 'planned');
        assert.equal(clockInAudit.source, routeInput.source);
        assert.equal(snapshotAudit.recordId, 901);
        assert.equal(snapshotAudit.compensationSnapshot.state, 'planned');
        assert.equal(snapshotAudit.trigger, 'clock_in');
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

test('clock-in defaults a missing business context to the canonical context', async () => {
    const { db, calls } = createClockInDb(professionCard);
    await recordAttendanceClockIn(db, {
        staffId: 7,
        recordDate: '2026-07-17',
        now: '2026-07-17T09:05:00.000Z',
        performedBy: 'unit-test'
    });

    const insert = calls.find(call => call.text.startsWith('INSERT INTO hr_time_records'));
    assert.ok(insert);
    assert.equal(insert.params[0], 'event_genix');
});

test('repeated check-in reuses the initial clock-in audit plan source', async () => {
    for (const planSource of [
        HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT,
        HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD,
        HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED
    ]) {
        const existing = {
            id: 77,
            staff_id: 7,
            record_date: '2026-07-17',
            clock_in: '2026-07-17T08:58:00.000Z',
            planned_start: planSource === HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED ? null : '12:00',
            planned_end: planSource === HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED ? null : '20:00',
            late_minutes: 0,
            status: planSource === HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED ? 'unscheduled' : 'present'
        };
        const { db, calls, audits } = createClockInDb({ existing, auditPlanSource: planSource });

        const result = await recordAttendanceClockIn(db, {
            staffId: 7,
            recordDate: '2026-07-17',
            now: '2026-07-17T10:00:00.000Z'
        });

        assert.equal(result.record.clock_in, existing.clock_in);
        assert.equal(result.alreadyClockedIn, true);
        assert.equal(result.auditWritten, false);
        assert.equal(result.planSource, planSource);
        assert.equal(result.plan.source, planSource);
        assert.equal(result.record.plan_source, planSource);
        assert.equal(calls.some(call => call.text.startsWith('INSERT INTO hr_audit_log')), false);
        assert.equal(audits.length, 0);
    }
});

test('repeated check-in for old records without audit source returns attendance snapshot', async () => {
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
    assert.equal(result.plan.source, 'attendance_snapshot');
    assert.equal(result.record.plan_source, 'attendance_snapshot');
    assert.equal(calls.length, 2);
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
    assert.equal(result.record.plan_source, 'unscheduled');
    assert.equal(result.plan.source, 'unscheduled');
    assert.equal(result.planSource, 'unscheduled');
    assert.equal(audits[0].plan_source, 'unscheduled');
});

test('terminal attendance status creates a finalized zero-minute compensation snapshot', async () => {
    const calls = [];
    const audits = [];
    const db = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (text.startsWith('SELECT * FROM hr_time_records')) return { rows: [] };
            if (text.includes('FROM hr_shifts hs')) return { rows: [] };
            if (/^SELECT s\.id, s\.role_type, COALESCE\(s\.is_active, true\) AS is_active/.test(text)) {
                return { rows: [{ id: 7, role_type: 'wardrobe', is_active: true }] };
            }
            if (text.includes('FROM staff_shift_preferences')) {
                return { rows: [{ start_time: '11:00:00', end_time: '20:00:00', is_active: true }] };
            }
            if (text.startsWith('INSERT INTO hr_time_records')) {
                return { rows: [{
                    id: 902,
                    business_context: params[0],
                    staff_id: params[1],
                    record_date: params[2],
                    status: params[3],
                    notes: params[4],
                    planned_start: params[5],
                    planned_end: params[6],
                    compensation_snapshot: JSON.parse(params[7])
                }] };
            }
            if (text.startsWith('INSERT INTO hr_audit_log')) {
                audits.push(JSON.parse(params[2]));
                return { rows: [] };
            }

            if (text.startsWith('SELECT * FROM staff WHERE')) return { rows: [{ id: Number(params?.[0]?.[0] || 7), role_type: 'animator', hourly_rate: 100, rate_unit: 'hour', is_active: true }] };
            if (text.includes('FROM staff_payroll_profile_assignments') || text.includes('FROM payroll_profiles')
                || text.includes('FROM payroll_day_exceptions') || text.includes('FROM payroll_schemes')
                || text.includes('FROM hr_compensation_policies') || text.includes('FROM staff_role_assignments')
                || text.includes('FROM staff_profession_rates')) return { rows: [] };
            throw new Error(`Unexpected SQL: ${text}`);
        }
    };

    const result = await recordAttendanceStatus(db, {
        staffId: 7,
        recordDate: '2026-07-17',
        status: 'no_show',
        notes: 'scheduler',
        now: '2026-07-17T12:00:00.000Z',
        source: 'unit_test',
        performedBy: 'system'
    });

    assert.equal(result.record.status, 'no_show');
    assert.equal(result.compensationSnapshot.state, 'final');
    assert.equal(result.compensationSnapshot.totals.physicalMinutes, 0);
    assert.equal(result.compensationSnapshot.totals.baseMinutes, 0);
    assert.equal(result.compensationSnapshot.totals.simultaneousAdditionalMinutes, 0);
    assert.equal(result.compensationSnapshot.compensationAllocations.length, 1);
    assert.equal(result.compensationSnapshot.compensationAllocations[0].actualMinutes, 0);
    assert.equal(audits[0].trigger, 'attendance_status');
    assert.equal(audits[0].attendanceStatus, 'no_show');
    assert.ok(calls.some(call => /compensation_snapshot/.test(call.text)));
});

test('terminal attendance status cannot overwrite worked time', async () => {
    const db = {
        async query(sql) {
            if (String(sql).includes('SELECT * FROM hr_time_records')) {
                return { rows: [{
                    id: 903,
                    staff_id: 7,
                    record_date: '2026-07-17',
                    clock_in: '2026-07-17T08:00:00.000Z',
                    status: 'present'
                }] };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    await assert.rejects(
        recordAttendanceStatus(db, {
            staffId: 7,
            recordDate: '2026-07-17',
            status: 'vacation'
        }),
        error => error.code === 'ATTENDANCE_STATUS_CONFLICT' && error.statusCode === 409
    );
});
