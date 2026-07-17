const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    HR_ATTENDANCE_BREAK_POLICY,
    allocateAttendanceToSegments,
    attendanceAllocationFields,
    buildAttendanceCompensationPlanSnapshot,
    buildLegacyAttendanceCompensationSnapshot,
    finalizeAttendanceCompensationSnapshot,
    calculateHrClockOutPayroll
} = require('../services/hrAttendance');

const DAY = '2026-07-13';

function segment(professionKey, shiftStart, shiftEnd, breakMinutes = 0, additionalProfessionKeys = []) {
    return { professionKey, shiftStart, shiftEnd, breakMinutes, additionalProfessionKeys };
}

function allocate(options = {}) {
    return allocateAttendanceToSegments({
        recordDate: DAY,
        primaryProfessionKey: 'reception',
        ...options
    });
}

function paidRoleContextDb({ rate = 180, policy = true } = {}) {
    return {
        async query(sql) {
            const text = String(sql);
            if (text.includes('FROM hr_compensation_policies')) {
                return {
                    rows: policy ? [{
                        policy_version: 'simultaneous-profession-pay-v1',
                        compensation_mode: 'paid_hourly',
                        pay_multiplier: '1.0000',
                        effective_from: '2026-07-01',
                        status: 'active'
                    }] : []
                };
            }
            if (text.includes('FROM staff_role_assignments')) {
                return {
                    rows: [{
                        staff_id: 17,
                        profession_key: 'hallkeeper',
                        status: 'active',
                        admission_status: 'approved'
                    }]
                };
            }
            if (text.includes('FROM staff_profession_rates')) {
                return {
                    rows: rate === null ? [] : [{
                        staff_id: 17,
                        profession_key: 'hallkeeper',
                        hourly_rate: String(rate)
                    }]
                };
            }
            throw new Error(`Unexpected SQL: ${text}`);
        }
    };
}

function simultaneousProfessionPlan({ breakMinutes = 0 } = {}) {
    return {
        source: 'hr_shift',
        professionKey: 'wardrobe',
        plannedStart: '11:00',
        plannedEnd: '20:00',
        segments: [
            segment('wardrobe', '11:00', '11:30'),
            {
                ...segment('wardrobe', '11:30', '20:00', breakMinutes, ['hallkeeper']),
                id: 502,
                additionalRoles: [{
                    professionKey: 'hallkeeper',
                    compensationMode: 'paid_hourly',
                    payMultiplier: 1,
                    policyVersion: 'simultaneous-profession-pay-v1'
                }]
            }
        ]
    };
}

test('attendance allocates late arrival and early leave to the touched segments', () => {
    const result = allocate({
        clockIn: '2026-07-13T07:00:00.000Z', // 10:00 Europe/Kyiv
        clockOut: '2026-07-13T15:00:00.000Z', // 18:00 Europe/Kyiv
        segments: [
            segment('reception', '09:00', '13:00'),
            segment('manager', '13:00', '20:00', 30)
        ]
    });

    assert.equal(result.allocationSource, 'clock_interval');
    assert.equal(result.plannedMinutes, 630);
    assert.deepEqual(result.segmentAllocations.map(item => item.actualMinutes), [180, 270]);
    assert.equal(result.actualMinutes, 450);
    assert.equal(result.lateMinutes, 60);
    assert.equal(result.earlyLeaveMinutes, 120);
});

test('attendance excludes an internal schedule gap from paid time and overtime', () => {
    const result = allocate({
        clockIn: '2026-07-13T06:00:00.000Z',
        clockOut: '2026-07-13T17:00:00.000Z',
        segments: [
            segment('reception', '09:00', '13:00'),
            segment('manager', '15:00', '20:00')
        ]
    });

    assert.deepEqual(result.segmentAllocations.map(item => item.actualMinutes), [240, 300]);
    assert.equal(result.plannedMinutes, 540);
    assert.equal(result.actualMinutes, 540);
    assert.equal(result.unallocatedGapMinutes, 120);
    assert.equal(result.overtimeMinutes, 0);
});

test('a segment break is deducted only from that segment', () => {
    const result = allocate({
        clockIn: '2026-07-13T06:00:00.000Z',
        clockOut: '2026-07-13T14:00:00.000Z',
        segments: [
            segment('reception', '09:00', '13:00', 30),
            segment('manager', '13:00', '17:00')
        ]
    });

    assert.deepEqual(result.segmentAllocations.map(item => item.actualMinutes), [210, 240]);
    assert.equal(result.actualMinutes, 450);
    assert.equal(result.breakPolicy, HR_ATTENDANCE_BREAK_POLICY);
});

test('a break is capped by the minutes actually touching its segment', () => {
    const partiallyTouched = allocate({
        clockIn: '2026-07-13T09:45:00.000Z', // 12:45 Europe/Kyiv
        clockOut: '2026-07-13T10:00:00.000Z', // 13:00 Europe/Kyiv
        segments: [segment('reception', '09:00', '13:00', 30)]
    });
    const untouched = allocate({
        clockIn: '2026-07-13T10:00:00.000Z',
        clockOut: '2026-07-13T11:00:00.000Z',
        segments: [
            segment('reception', '09:00', '13:00', 30),
            segment('manager', '13:00', '14:00')
        ]
    });

    assert.equal(partiallyTouched.segmentAllocations[0].overlapMinutes, 15);
    assert.equal(partiallyTouched.segmentAllocations[0].actualMinutes, 0);
    assert.equal(untouched.segmentAllocations[0].actualMinutes, 0);
    assert.equal(untouched.segmentAllocations[1].actualMinutes, 60);
    assert.equal(untouched.breakPolicy, 'segment_minutes_mvp');
});

test('partial attendance before or after an unspecified break uses the same deterministic MVP deduction', () => {
    const beforeUnknownBreak = allocate({
        clockIn: '2026-07-13T06:00:00.000Z', // 09:00 Europe/Kyiv
        clockOut: '2026-07-13T08:00:00.000Z', // 11:00 Europe/Kyiv
        segments: [segment('reception', '09:00', '13:00', 30)]
    });
    const afterUnknownBreak = allocate({
        clockIn: '2026-07-13T08:00:00.000Z', // 11:00 Europe/Kyiv
        clockOut: '2026-07-13T10:00:00.000Z', // 13:00 Europe/Kyiv
        segments: [segment('reception', '09:00', '13:00', 30)]
    });

    for (const result of [beforeUnknownBreak, afterUnknownBreak]) {
        assert.equal(result.breakPolicy, 'segment_minutes_mvp');
        assert.equal(result.segmentAllocations[0].overlapMinutes, 120);
        assert.equal(result.segmentAllocations[0].actualMinutes, 90);
        assert.equal(result.actualMinutes, 90);
    }
});

test('late arrival and early leave each deduct the break only from the touched segment', () => {
    const late = allocate({
        clockIn: '2026-07-13T07:00:00.000Z', // 10:00 Europe/Kyiv
        clockOut: '2026-07-13T10:00:00.000Z', // 13:00 Europe/Kyiv
        segments: [segment('reception', '09:00', '13:00', 30)]
    });
    const early = allocate({
        clockIn: '2026-07-13T06:00:00.000Z', // 09:00 Europe/Kyiv
        clockOut: '2026-07-13T09:00:00.000Z', // 12:00 Europe/Kyiv
        segments: [segment('reception', '09:00', '13:00', 30)]
    });

    assert.equal(late.segmentAllocations[0].actualMinutes, 150);
    assert.equal(late.lateMinutes, 60);
    assert.equal(early.segmentAllocations[0].actualMinutes, 150);
    assert.equal(early.earlyLeaveMinutes, 60);
});

test('additional simultaneous professions do not receive duplicate actual minutes', () => {
    const result = allocate({
        clockIn: '2026-07-13T06:00:00.000Z',
        clockOut: '2026-07-13T10:00:00.000Z',
        segments: [segment('reception', '09:00', '13:00', 0, ['manager'])]
    });

    assert.equal(result.segmentAllocations.length, 1);
    assert.equal(result.segmentAllocations[0].actualMinutes, 240);
    assert.deepEqual(result.segmentAllocations[0].additionalProfessionKeys, ['manager']);
    assert.equal(result.actualMinutes, 240);
});

test('attendance allocation fails closed when physical segments overlap', () => {
    assert.throws(
        () => allocate({
            clockIn: '2026-07-13T08:00:00.000Z',
            clockOut: '2026-07-13T17:00:00.000Z',
            segments: [
                segment('wardrobe', '11:00', '20:00'),
                segment('hallkeeper', '11:30', '20:00')
            ]
        }),
        error => error.code === 'HR_SHIFT_PLAN_SEGMENTS_OVERLAP'
            && error.statusCode === 400
            && error.details.firstSegment.shiftStart === '11:00'
            && error.details.secondSegment.shiftStart === '11:30'
    );
});

test('time outside the day envelope becomes overtime of the primary profession', () => {
    const result = allocate({
        clockIn: '2026-07-13T05:30:00.000Z',
        clockOut: '2026-07-13T17:30:00.000Z',
        segments: [
            segment('reception', '09:00', '13:00'),
            segment('manager', '15:00', '20:00')
        ]
    });

    assert.equal(result.actualMinutes, 600);
    assert.equal(result.allocatedMinutes, 540);
    assert.equal(result.unallocatedGapMinutes, 120);
    assert.equal(result.overtimeMinutes, 60);
    assert.deepEqual(result.overtimeAllocation, { professionKey: 'reception', actualMinutes: 60 });
    assert.ok(result.allocationIssues.some(issue => issue.code === 'ACTUAL_TIME_OUTSIDE_PLANNED_SEGMENTS'));
});

test('compensation allocations keep 540 physical minutes and add 510 simultaneous minutes', async () => {
    const plan = simultaneousProfessionPlan();
    const snapshot = await buildAttendanceCompensationPlanSnapshot(paidRoleContextDb(), {
        staffId: 17,
        recordDate: DAY,
        capturedAt: '2026-07-13T08:00:00.000Z',
        plan
    });
    const physical = allocate({
        clockIn: '2026-07-13T08:00:00.000Z',
        clockOut: '2026-07-13T17:00:00.000Z',
        primaryProfessionKey: 'wardrobe',
        segments: plan.segments
    });
    const finalSnapshot = finalizeAttendanceCompensationSnapshot(snapshot, physical, {
        finalizedAt: '2026-07-13T17:00:00.000Z'
    });

    assert.equal(physical.actualMinutes, 540);
    assert.equal(finalSnapshot.totals.physicalMinutes, 540);
    assert.equal(finalSnapshot.totals.physicalAllocationMinutes, 540);
    assert.equal(finalSnapshot.totals.baseMinutes, 540);
    assert.equal(finalSnapshot.totals.simultaneousAdditionalMinutes, 510);
    assert.equal(finalSnapshot.totals.compensationMinutes, 1050);
    assert.deepEqual(
        finalSnapshot.compensationAllocations.map(allocation => ({
            type: allocation.allocationType,
            profession: allocation.professionKey,
            actual: allocation.actualMinutes,
            rate: allocation.rate,
            rateSource: allocation.rateSource
        })),
        [
            { type: 'base', profession: 'wardrobe', actual: 30, rate: null, rateSource: 'base_payroll_contract' },
            { type: 'base', profession: 'wardrobe', actual: 510, rate: null, rateSource: 'base_payroll_contract' },
            {
                type: 'simultaneous_additional',
                profession: 'hallkeeper',
                actual: 510,
                rate: 180,
                rateSource: 'staff_profession_rates.hourly_rate'
            }
        ]
    );
    assert.equal(finalSnapshot.manualReview, false);
});

test('break, late arrival and early leave reduce every compensation role in the touched segment', async () => {
    const plan = simultaneousProfessionPlan({ breakMinutes: 30 });
    const snapshot = await buildAttendanceCompensationPlanSnapshot(paidRoleContextDb(), {
        staffId: 17,
        recordDate: DAY,
        plan
    });
    const scenarios = [
        {
            label: 'full with break',
            clockIn: '2026-07-13T08:00:00.000Z',
            clockOut: '2026-07-13T17:00:00.000Z',
            base: 510,
            additional: 480
        },
        {
            label: 'late',
            clockIn: '2026-07-13T08:45:00.000Z',
            clockOut: '2026-07-13T17:00:00.000Z',
            base: 465,
            additional: 465
        },
        {
            label: 'early',
            clockIn: '2026-07-13T08:00:00.000Z',
            clockOut: '2026-07-13T16:00:00.000Z',
            base: 450,
            additional: 420
        }
    ];

    for (const scenario of scenarios) {
        const physical = allocate({
            clockIn: scenario.clockIn,
            clockOut: scenario.clockOut,
            primaryProfessionKey: 'wardrobe',
            segments: plan.segments
        });
        const finalSnapshot = finalizeAttendanceCompensationSnapshot(snapshot, physical);
        assert.equal(finalSnapshot.totals.baseMinutes, scenario.base, `${scenario.label}: base`);
        assert.equal(
            finalSnapshot.totals.simultaneousAdditionalMinutes,
            scenario.additional,
            `${scenario.label}: additional`
        );
        assert.equal(finalSnapshot.totals.physicalMinutes, scenario.base, `${scenario.label}: physical`);
    }
});

test('missing policy or explicit rate marks compensation for manual review without fallback', async () => {
    for (const options of [{ policy: false, rate: 180 }, { policy: true, rate: null }]) {
        const snapshot = await buildAttendanceCompensationPlanSnapshot(paidRoleContextDb(options), {
            staffId: 17,
            recordDate: DAY,
            plan: simultaneousProfessionPlan()
        });
        const additional = snapshot.compensationAllocations
            .find(allocation => allocation.allocationType === 'simultaneous_additional');

        assert.equal(snapshot.manualReview, true);
        assert.equal(snapshot.state, 'manual_review');
        if (options.rate === null) {
            assert.equal(additional.rate, null);
            assert.equal(additional.rateSource, null);
            assert.ok(snapshot.issues.some(issue => issue.code === 'ATTENDANCE_COMPENSATION_RATE_REQUIRED'));
        } else {
            assert.ok(snapshot.issues.some(issue => issue.code === 'ATTENDANCE_COMPENSATION_POLICY_REQUIRED'));
        }
    }
});

test('legacy compensation snapshot stays base-only and warns instead of activating paid roles', () => {
    const legacy = buildLegacyAttendanceCompensationSnapshot({
        staffId: 17,
        recordDate: DAY,
        plan: simultaneousProfessionPlan()
    });
    const physical = allocate({
        clockIn: '2026-07-13T08:00:00.000Z',
        clockOut: '2026-07-13T17:00:00.000Z',
        primaryProfessionKey: 'wardrobe',
        segments: simultaneousProfessionPlan().segments
    });
    const finalSnapshot = finalizeAttendanceCompensationSnapshot(legacy, physical);

    assert.equal(finalSnapshot.legacyBaseOnly, true);
    assert.equal(finalSnapshot.compensationAllocations.some(
        allocation => allocation.allocationType === 'simultaneous_additional'
    ), false);
    assert.equal(finalSnapshot.totals.baseMinutes, 540);
    assert.equal(finalSnapshot.totals.simultaneousAdditionalMinutes, 0);
    assert.ok(finalSnapshot.issues.some(issue => issue.code === 'ATTENDANCE_COMPENSATION_LEGACY_BASE_ONLY'));
});

test('allocation fields expose allocation overtime without attendance overtime aliases', () => {
    const allocation = allocate({
        clockIn: '2026-07-13T05:30:00.000Z',
        clockOut: '2026-07-13T17:30:00.000Z',
        segments: [
            segment('reception', '09:00', '13:00'),
            segment('manager', '15:00', '20:00')
        ]
    });
    const fields = attendanceAllocationFields(allocation);

    assert.equal(fields.allocationOvertimeMinutes, 60);
    assert.equal(fields.allocation_overtime_minutes, 60);
    assert.equal(Object.hasOwn(fields, 'overtimeMinutes'), false);
    assert.equal(Object.hasOwn(fields, 'overtime_minutes'), false);
    assert.deepEqual(fields.overtime_allocation, { professionKey: 'reception', actualMinutes: 60 });
});

test('recorded totals without a reliable interval use proportional fallback', () => {
    const result = allocate({
        totalWorkedMinutes: 450,
        segments: [
            segment('reception', '09:00', '13:00'),
            segment('manager', '15:00', '20:00')
        ]
    });

    assert.equal(result.allocationSource, 'proportional_fallback');
    assert.deepEqual(result.segmentAllocations.map(item => item.actualMinutes), [200, 250]);
    assert.equal(result.actualMinutes, 450);
    assert.equal(result.overtimeMinutes, 0);
    assert.ok(result.allocationIssues.some(issue => issue.code === 'ATTENDANCE_PROPORTIONAL_FALLBACK'));
});

test('night segments are allocated on the next-day timeline in Europe/Kyiv', () => {
    const result = allocate({
        clockIn: '2026-07-13T20:00:00.000Z', // 23:00 Europe/Kyiv
        clockOut: '2026-07-13T22:00:00.000Z', // 01:00 next day Europe/Kyiv
        segments: [segment('security', '22:00', '02:00')],
        primaryProfessionKey: 'security'
    });

    assert.equal(result.segmentAllocations[0].actualMinutes, 120);
    assert.equal(result.actualMinutes, 120);
    assert.equal(result.overtimeMinutes, 0);
});

test('a partial overnight attendance deducts its segment break once across midnight', () => {
    const result = allocate({
        clockIn: '2026-07-13T20:30:00.000Z', // 23:30 Europe/Kyiv
        clockOut: '2026-07-13T22:30:00.000Z', // 01:30 next day Europe/Kyiv
        segments: [segment('security', '22:00', '02:00', 30)],
        primaryProfessionKey: 'security'
    });

    assert.equal(result.segmentAllocations[0].overlapMinutes, 120);
    assert.equal(result.segmentAllocations[0].actualMinutes, 90);
    assert.equal(result.actualMinutes, 90);
    assert.equal(result.overtimeMinutes, 0);
});

test('actual-time clock-out payroll uses segment allocation instead of envelope duration', () => {
    const payroll = calculateHrClockOutPayroll({
        record_date: DAY,
        clock_in: '2026-07-13T06:00:00.000Z',
        planned_start: '09:00',
        planned_end: '20:00',
        status: 'present'
    }, {
        clockOut: '2026-07-13T17:00:00.000Z',
        recordDate: DAY,
        plan: {
            primaryProfessionKey: 'reception',
            plannedMinutes: 540,
            segments: [
                segment('reception', '09:00', '13:00'),
                segment('manager', '15:00', '20:00')
            ]
        },
        scheduledWorkedMinutes: 540,
        settlementMode: 'actual_time'
    });

    assert.equal(payroll.actualWorkedMinutes, 540);
    assert.equal(payroll.totalWorkedMinutes, 540);
    assert.equal(payroll.allocation.unallocatedGapMinutes, 120);
});

test('legacy single-shift attendance remains one equivalent allocation', () => {
    const result = allocate({
        clockIn: '2026-07-13T06:00:00.000Z',
        clockOut: '2026-07-13T13:00:00.000Z',
        plannedStart: '09:00',
        plannedEnd: '16:00',
        breakMinutes: 30
    });

    assert.equal(result.segmentAllocations.length, 1);
    assert.equal(result.segmentAllocations[0].professionKey, 'reception');
    assert.equal(result.plannedMinutes, 390);
    assert.equal(result.actualMinutes, 390);
});

test('HR, face checkout and attendance UI reuse the shared allocation contract', () => {
    const root = path.join(__dirname, '..');
    const hrRoute = fs.readFileSync(path.join(root, 'routes', 'hr.js'), 'utf8');
    const staffRoute = fs.readFileSync(path.join(root, 'routes', 'staff.js'), 'utf8');
    const staffPage = fs.readFileSync(path.join(root, 'js', 'staff-page.js'), 'utf8');
    const attendanceService = fs.readFileSync(path.join(root, 'services', 'hrAttendance.js'), 'utf8');
    const correctionBlock = hrRoute.slice(
        hrRoute.indexOf("router.put('/records/:id/correct'"),
        hrRoute.indexOf('// REPORTS')
    );

    assert.match(hrRoute, /plan: calculationPlan/);
    assert.match(correctionBlock, /compensation_snapshot_before: compensationBefore/);
    assert.match(correctionBlock, /compensation_snapshot_after: compensationAfter/);
    assert.match(correctionBlock, /compensation_snapshot = \$12::jsonb/);
    assert.match(correctionBlock, /const loadedShift = snapshotPlan\s*\?\s*null/);
    assert.match(correctionBlock, /calculateHrClockOutPayroll\(original/);
    assert.match(correctionBlock, /decorateAttendanceRecord\(\{[\s\S]*compensation_snapshot:[\s\S]*\}, loadedShift\)/);
    assert.match(staffRoute, /hydrateAttendanceRecords\(pool, result\.rows\)/);
    assert.match(staffRoute, /data: attendanceRows/);
    assert.match(staffRoute, /recordAttendanceClockOut\(client/);
    assert.match(attendanceService, /segment_allocations: payroll\.allocation\.segmentAllocations/);
    assert.match(attendanceService, /break_policy: allocation\.breakPolicy/);
    assert.match(attendanceService, /HR_SHIFT_BREAK_POLICY/);
    assert.match(attendanceService, /const HR_ATTENDANCE_BREAK_POLICY = HR_SHIFT_BREAK_POLICY/);
    assert.match(staffPage, /segmentAllocations/);
    assert.match(staffPage, /allocationIssues/);
    assert.match(staffPage, /timeZone: 'Europe\/Kyiv'/);
});

test('attendance correction uses Kyiv local times and the same independent fact calculation', () => {
    const root = path.join(__dirname, '..');
    const hrRoute = fs.readFileSync(path.join(root, 'routes', 'hr.js'), 'utf8');
    const hrPage = fs.readFileSync(path.join(root, 'js', 'hr-page.js'), 'utf8');
    const correctionBlock = hrRoute.slice(
        hrRoute.indexOf("router.put('/records/:id/correct'"),
        hrRoute.indexOf('// REPORTS')
    );

    assert.match(correctionBlock, /clock_in_time/);
    assert.match(correctionBlock, /clock_out_time/);
    assert.match(correctionBlock, /AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(correctionBlock, /details->>'settlement_mode'/);
    assert.match(correctionBlock, /lateMin = payroll\.lateMinutes/);
    assert.match(correctionBlock, /earlyLeave = payroll\.earlyLeaveMinutes/);
    assert.match(correctionBlock, /overtime = payroll\.overtimeMinutes/);
    assert.match(hrPage, /body\.clock_in_time = clockIn/);
    assert.match(hrPage, /body\.clock_out_time = clockOut/);
    assert.doesNotMatch(hrPage, /T\$\{clockIn\}:00\+02:00/);
});
