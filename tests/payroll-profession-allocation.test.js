const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    buildPayrollRateUnitWarnings,
    buildPayrollSourceReconciliation,
    loadPayrollReconciliation
} = require('../services/hrPayrollPeriod');
const {
    OVERTIME_MULTIPLIER,
    assertPayrollRowsCommitReady,
    buildPayrollTransparencyMetrics,
    calculateProfessionPay,
    calculatePayroll,
    loadActivePayrollSchemeMap,
    loadPayrollAttendanceMetrics,
    loadPayrollProfileContext,
    resolveEffectivePayrollProfile,
    resolveProfessionPayRate,
    resolveSimultaneousAdditionalRate
} = require('../services/payroll');
const { allocateAttendanceToSegments } = require('../services/hrAttendance');

function staff(overrides = {}) {
    return {
        id: 7,
        roleType: 'reception',
        hourlyRate: 100,
        rateUnit: 'hour',
        ...overrides
    };
}

function metrics(overrides = {}) {
    return {
        physicalMinutes: 660,
        totalMinutes: 660,
        allocatedMinutes: 660,
        plannedMinutes: 660,
        overtimeMinutes: 0,
        hoursWorked: 11,
        overtimeHours: 0,
        daysWorked: 1,
        professionAllocations: [
            { professionKey: 'reception', minutes: 240, allocationSources: ['clock_interval'] },
            { professionKey: 'manager', minutes: 420, allocationSources: ['clock_interval'] }
        ],
        baseProfessionAllocations: [
            { professionKey: 'reception', minutes: 240, allocationSources: ['clock_interval'] },
            { professionKey: 'manager', minutes: 420, allocationSources: ['clock_interval'] }
        ],
        additionalProfessionAllocations: [],
        compensationMinutes: 660,
        roleMinutes: 660,
        overtimeAllocations: [],
        primaryDays: [{ date: '2026-07-13', professionKey: 'reception' }],
        attendanceDays: [{ date: '2026-07-13', allocationSource: 'clock_interval' }],
        allocationIssues: [],
        payrollBlockingIssues: [],
        reconciliation: { days: [], warnings: [] },
        ...overrides
    };
}

function rateMap(values = {}) {
    return new Map(Object.entries(values).map(([professionKey, rate]) => [`7:${professionKey}`, rate]));
}

function simultaneousAdditionalAllocation(overrides = {}) {
    return {
        allocationType: 'simultaneous_additional',
        professionKey: 'hallkeeper',
        minutes: 510,
        plannedMinutes: 510,
        compensationMode: 'paid_hourly',
        payMultiplier: 1,
        rate: 200,
        rateUnit: 'hour',
        rateSource: 'staff_profession_rates.hourly_rate',
        policyVersion: 'simultaneous-profession-pay-v1',
        attendanceRef: 44,
        segmentRef: 502,
        segmentIndex: 1,
        roleRef: null,
        date: '2026-07-22',
        snapshotVersion: 1,
        ...overrides
    };
}

function payrollProfile({ id, title, professionKey = 'reception', rateUnit = 'hour', defaultRate = 100, dayRates = [] }) {
    return {
        id,
        title,
        professionKey,
        profileKind: 'shared',
        status: 'active',
        versions: [{
            id: id * 10,
            profileId: id,
            versionNumber: 1,
            rateUnit,
            defaultRate,
            effectiveFrom: '2026-07-01',
            effectiveTo: null,
            dayRates: new Map(dayRates)
        }]
    };
}

function payrollProfileContext({ defaults = [], assignments = [] } = {}) {
    const profiles = new Map();
    const defaultProfilesByProfession = new Map();
    const assignmentsByStaffProfession = new Map();
    for (const profile of defaults) {
        profiles.set(profile.id, profile);
        defaultProfilesByProfession.set(profile.professionKey, profile);
    }
    for (const assignment of assignments) {
        profiles.set(assignment.profile.id, assignment.profile);
        const key = `${assignment.staffId}:${assignment.professionKey}`;
        if (!assignmentsByStaffProfession.has(key)) assignmentsByStaffProfession.set(key, []);
        assignmentsByStaffProfession.get(key).push(assignment);
    }
    return {
        enabled: true,
        from: '2026-07-01',
        to: '2026-07-31',
        profilesById: profiles,
        defaultProfilesByProfession,
        assignmentsByStaffProfession,
        warnings: []
    };
}

test('hourly payroll pays each profession allocation at its own rate', () => {
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics(),
        rateMap({ reception: 100, manager: 200 })
    );

    assert.equal(result.baseAmount, 1800);
    assert.equal(result.totalAmount, 1800);
    assert.deepEqual(result.professionRateSummary.map(row => row.rate_source), [
        'staff_profession_rates.hourly_rate',
        'staff_profession_rates.hourly_rate'
    ]);
    assert.deepEqual(result.professionRateSummary.map(row => ({
        profession: row.profession_key,
        minutes: row.actual_minutes,
        rate: row.rate,
        amount: row.amount
    })), [
        { profession: 'reception', minutes: 240, rate: 100, amount: 400 },
        { profession: 'manager', minutes: 420, rate: 200, amount: 1400 }
    ]);
});

test('late and early leave minutes reduce only their actual profession allocations', () => {
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: 450,
            allocatedMinutes: 450,
            professionAllocations: [
                { professionKey: 'reception', minutes: 180, allocationSources: ['clock_interval'] },
                { professionKey: 'manager', minutes: 270, allocationSources: ['clock_interval'] }
            ]
        }),
        rateMap({ reception: 100, manager: 200 })
    );

    assert.equal(result.baseAmount, 1200);
    assert.deepEqual(result.professionRateSummary.map(row => row.actual_minutes), [180, 270]);
});

test('an internal gap and concurrent additional role cannot create paid allocation rows', () => {
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: 540,
            allocatedMinutes: 540,
            professionAllocations: [
                { professionKey: 'reception', minutes: 240, allocationSources: ['clock_interval'] },
                { professionKey: 'manager', minutes: 300, allocationSources: ['clock_interval'] }
            ]
        }),
        rateMap({ reception: 100, manager: 200, animator: 999 })
    );

    assert.equal(result.professionRateSummary.length, 2);
    assert.equal(result.professionRateSummary.some(row => row.profession_key === 'animator'), false);
    assert.equal(result.professionRateSummary.reduce((sum, row) => sum + row.actual_minutes, 0), 540);
});

test('simultaneous additional pay keeps nine physical hours and pays 8.5 extra hours from the immutable snapshot', () => {
    const exactMetrics = metrics({
        physicalMinutes: 540,
        totalMinutes: 540,
        allocatedMinutes: 540,
        plannedMinutes: 540,
        hoursWorked: 9,
        professionAllocations: [
            { professionKey: 'wardrobe', minutes: 540, allocationSources: ['clock_interval'] }
        ],
        baseProfessionAllocations: [
            { professionKey: 'wardrobe', minutes: 540, allocationSources: ['clock_interval'] }
        ],
        additionalProfessionAllocations: [simultaneousAdditionalAllocation()],
        compensationMinutes: 1050,
        roleMinutes: 1050,
        primaryDays: [{ date: '2026-07-22', professionKey: 'wardrobe' }],
        attendanceDays: [{
            date: '2026-07-22',
            attendanceRef: 44,
            physicalMinutes: 540,
            baseProfessionMinutes: 540,
            additionalProfessionMinutes: 510,
            actualMinutes: 540,
            allocationSource: 'clock_interval',
            primaryProfessionKey: 'wardrobe',
            segmentAllocations: [
                { segmentId: 501, professionKey: 'wardrobe', actualMinutes: 30 },
                { segmentId: 502, professionKey: 'wardrobe', actualMinutes: 510 }
            ]
        }]
    });
    const professionPay = calculateProfessionPay(
        staff({ roleType: 'wardrobe', hourlyRate: 100 }),
        { schemeType: 'hourly', config: {}, isFallback: true },
        exactMetrics,
        rateMap({ wardrobe: 100, hallkeeper: 999 })
    );
    const calculation = calculatePayroll(
        staff({ roleType: 'wardrobe', hourlyRate: 100 }),
        { schemeType: 'hourly', config: {} },
        exactMetrics,
        {},
        [],
        professionPay
    );

    assert.equal(exactMetrics.physicalMinutes, 540);
    assert.equal(exactMetrics.hoursWorked, 9);
    assert.equal(professionPay.baseAmount, 900);
    assert.equal(professionPay.additionalAmount, 1700);
    assert.equal(professionPay.totalAmount, 2600);
    assert.equal(calculation.summary.base, 900);
    assert.equal(calculation.summary.additional, 1700);
    assert.equal(calculation.summary.gross, 2600);
    const transparency = buildPayrollTransparencyMetrics(exactMetrics, professionPay);
    assert.equal(transparency.physicalHours, 9);
    assert.equal(transparency.baseRoleHours, 9);
    assert.equal(transparency.additionalRoleHours, 8.5);
    assert.equal(transparency.additionalProfession, 'hallkeeper');
    assert.equal(transparency.additionalRate, 200);
    assert.equal(transparency.additionalMultiplier, 1);
    assert.equal(transparency.additionalAmount, 1700);
    assert.equal(transparency.additionalRoles[0].attendanceRef, 44);
    assert.equal(transparency.additionalRoles[0].segmentRef, 502);
    assert.equal(
        transparency.explanation,
        'Оплачувані години професій можуть перевищувати фізичні години через одночасну роботу'
    );
    const line = professionPay.additionalLines[0];
    assert.deepEqual({
        lineType: line.lineType,
        professionKey: line.professionKey,
        minutes: line.minutes,
        rate: line.rate,
        rateSource: line.rateSource,
        multiplier: line.multiplier,
        amount: line.amount,
        attendanceRef: line.attendanceRef,
        segmentRef: line.segmentRef,
        policyVersion: line.policyVersion,
        formula: line.formula
    }, {
        lineType: 'simultaneous_additional',
        professionKey: 'hallkeeper',
        minutes: 510,
        rate: 200,
        rateSource: 'staff_profession_rates.hourly_rate',
        multiplier: 1,
        amount: 1700,
        attendanceRef: 44,
        segmentRef: 502,
        policyVersion: 'simultaneous-profession-pay-v1',
        formula: '510 / 60 * 200 * 1'
    });
});

test('per-shift, monthly and hybrid schemes do not enable simultaneous additional pay without an approved formula', () => {
    const exactMetrics = metrics({
        physicalMinutes: 540,
        totalMinutes: 540,
        allocatedMinutes: 540,
        hoursWorked: 9,
        daysWorked: 1,
        professionAllocations: [
            { professionKey: 'wardrobe', minutes: 540, allocationSources: ['clock_interval'] }
        ],
        additionalProfessionAllocations: [simultaneousAdditionalAllocation()]
    });
    const perShift = calculateProfessionPay(
        staff({ roleType: 'wardrobe', rateUnit: 'day', hourlyRate: 900 }),
        { schemeType: 'per_shift', config: {}, isFallback: true },
        exactMetrics,
        rateMap({ hallkeeper: 999 })
    );
    const monthly = calculateProfessionPay(
        staff({ roleType: 'wardrobe', rateUnit: 'month', hourlyRate: 30000 }),
        { schemeType: 'monthly_fixed', config: {}, isFallback: true },
        exactMetrics,
        rateMap({ hallkeeper: 999 })
    );
    const hybrid = calculateProfessionPay(
        staff({ roleType: 'wardrobe', rateUnit: 'hour', hourlyRate: 100 }),
        { schemeType: 'hybrid', config: { hourlyRate: 100, perShiftRate: 900 }, isFallback: false },
        exactMetrics,
        rateMap({ hallkeeper: 999 })
    );

    assert.equal(perShift.baseAmount, 900);
    assert.equal(perShift.additionalAmount, 0);
    assert.equal(perShift.additionalLines.length, 0);
    assert.equal(perShift.totalAmount, 900);
    assert.equal(monthly.baseAmount, 30000);
    assert.equal(monthly.additionalAmount, 0);
    assert.equal(monthly.additionalLines.length, 0);
    assert.equal(monthly.totalAmount, 30000);
    assert.equal(hybrid.applies, false);
    assert.equal(hybrid.professionRateSummary.length, 0);
});

test('simultaneous additional pay applies the immutable snapshot multiplier', () => {
    const result = calculateProfessionPay(
        staff({ roleType: 'wardrobe', hourlyRate: 100 }),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            physicalMinutes: 540,
            totalMinutes: 540,
            allocatedMinutes: 540,
            hoursWorked: 9,
            professionAllocations: [
                { professionKey: 'wardrobe', minutes: 540, allocationSources: ['clock_interval'] }
            ],
            additionalProfessionAllocations: [
                simultaneousAdditionalAllocation({ payMultiplier: 1.25 })
            ]
        }),
        rateMap({ wardrobe: 100, hallkeeper: 999 })
    );

    assert.equal(result.baseAmount, 900);
    assert.equal(result.additionalAmount, 2125);
    assert.equal(result.totalAmount, 3025);
    assert.equal(result.additionalLines[0].multiplier, 1.25);
    assert.equal(result.additionalLines[0].formula, '510 / 60 * 200 * 1.25');
});

test('additional pay resolver rejects staff or scheme fallback and blocks payroll commit', () => {
    const invalid = simultaneousAdditionalAllocation({
        rateSource: 'staff.hourly_rate'
    });
    const resolution = resolveSimultaneousAdditionalRate(invalid);
    assert.equal(resolution.ok, false);
    assert.deepEqual(resolution.issue.invalidFields, ['rateSource']);

    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({ additionalProfessionAllocations: [invalid] }),
        rateMap({ reception: 100, manager: 200, hallkeeper: 999 })
    );
    assert.equal(result.additionalAmount, 0);
    assert.equal(result.blockingIssues[0].code, 'PAYROLL_SIMULTANEOUS_ADDITIONAL_SNAPSHOT_INVALID');
    assert.throws(
        () => assertPayrollRowsCommitReady([{
            staffId: 7,
            payrollBlockingIssues: result.blockingIssues
        }]),
        error => error.code === 'PAYROLL_COMPENSATION_SNAPSHOT_BLOCKED'
            && error.statusCode === 409
    );
});

test('hourly payroll consumes attendance minutes after the segment break without paying an additional role', () => {
    const allocation = allocateAttendanceToSegments({
        recordDate: '2026-07-13',
        clockIn: '2026-07-13T06:00:00.000Z',
        clockOut: '2026-07-13T10:00:00.000Z',
        primaryProfessionKey: 'reception',
        segments: [{
            professionKey: 'reception',
            shiftStart: '09:00',
            shiftEnd: '13:00',
            breakMinutes: 30,
            additionalProfessionKeys: ['animator']
        }]
    });
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: allocation.actualMinutes,
            allocatedMinutes: allocation.allocatedMinutes,
            plannedMinutes: allocation.plannedMinutes,
            professionAllocations: allocation.segmentAllocations.map(item => ({
                professionKey: item.professionKey,
                minutes: item.actualMinutes,
                allocationSources: [allocation.allocationSource]
            }))
        }),
        rateMap({ reception: 100, animator: 999 })
    );

    assert.equal(allocation.breakPolicy, 'segment_minutes_mvp');
    assert.equal(allocation.actualMinutes, 210);
    assert.equal(result.baseAmount, 350);
    assert.deepEqual(result.professionRateSummary.map(row => row.profession_key), ['reception']);
    assert.equal(result.professionRateSummary[0].actual_minutes, 210);
});

test('day rate is paid once per staff date using the primary profession', () => {
    const result = calculateProfessionPay(
        staff({ rateUnit: 'day', hourlyRate: 700 }),
        { schemeType: 'per_shift', config: {}, isFallback: true },
        metrics(),
        rateMap({ reception: 800, manager: 1200 })
    );

    assert.equal(result.baseLines.length, 1);
    assert.equal(result.baseAmount, 700);
    assert.equal(result.professionRateSummary[0].profession_key, 'reception');
    assert.equal(result.professionRateSummary[0].days, 1);
    assert.equal(result.professionRateSummary[0].rate_unit, 'day');
    assert.equal(result.professionRateSummary[0].rate_source, 'staff.hourly_rate');
});

test('hourly fallback order is profession rate, scheme hourly rate, then hourly staff rate', () => {
    const profession = resolveProfessionPayRate(
        staff({ hourlyRate: 100 }),
        'reception',
        { schemeType: 'hourly', config: { hourlyRate: 150 } },
        rateMap({ reception: 200 }),
        'hour'
    );
    const scheme = resolveProfessionPayRate(
        staff({ hourlyRate: 100 }),
        'reception',
        { schemeType: 'hourly', config: { hourlyRate: 150 } },
        new Map(),
        'hour'
    );
    const staffRate = resolveProfessionPayRate(
        staff({ hourlyRate: 100 }),
        'reception',
        { schemeType: 'hourly', config: {} },
        new Map(),
        'hour'
    );

    assert.equal(profession.rate, 200);
    assert.equal(scheme.rate, 150);
    assert.equal(scheme.source, 'payroll_scheme');
    assert.equal(staffRate.rate, 100);
    assert.equal(staffRate.source, 'staff.hourly_rate');
});

test('day rate prefers the per-shift scheme and never reads profession hourly rates', () => {
    const result = calculateProfessionPay(
        staff({ rateUnit: 'day', hourlyRate: 700 }),
        { schemeType: 'per_shift', config: { perShiftRate: 900 }, isFallback: false },
        metrics(),
        rateMap({ reception: 800, manager: 1200 })
    );

    assert.equal(result.baseAmount, 900);
    assert.equal(result.professionRateSummary.length, 1);
    assert.equal(result.professionRateSummary[0].rate, 900);
    assert.equal(result.professionRateSummary[0].rate_source, 'payroll_scheme');
});

test('payroll profile resolver prefers temporary, explicit, default, then legacy sources', () => {
    const defaultProfile = payrollProfile({ id: 10, title: 'Instructor base', defaultRate: 100 });
    const personalProfile = payrollProfile({ id: 11, title: 'Instructor · Misha', defaultRate: 150 });
    const temporaryProfile = payrollProfile({ id: 12, title: 'Weekend event', defaultRate: 300 });
    const context = payrollProfileContext({
        defaults: [defaultProfile],
        assignments: [
            {
                id: 501,
                staffId: 7,
                professionKey: 'reception',
                profileId: personalProfile.id,
                assignmentKind: 'explicit',
                effectiveFrom: '2026-07-01',
                effectiveTo: null,
                profile: personalProfile
            },
            {
                id: 502,
                staffId: 7,
                professionKey: 'reception',
                profileId: temporaryProfile.id,
                assignmentKind: 'temporary',
                effectiveFrom: '2026-07-18',
                effectiveTo: '2026-07-18',
                profile: temporaryProfile
            }
        ]
    });

    const temporary = resolveEffectivePayrollProfile(staff(), 'reception', '2026-07-18', {
        payrollProfileContext: context,
        scheme: { schemeType: 'hourly', config: {}, isFallback: true },
        professionRateMap: rateMap({ reception: 80 }),
        preferredRateUnit: 'hour'
    });
    const explicit = resolveEffectivePayrollProfile(staff(), 'reception', '2026-07-19', {
        payrollProfileContext: context,
        scheme: { schemeType: 'hourly', config: {}, isFallback: true },
        professionRateMap: rateMap({ reception: 80 }),
        preferredRateUnit: 'hour'
    });
    const defaulted = resolveEffectivePayrollProfile(staff({ id: 8 }), 'reception', '2026-07-19', {
        payrollProfileContext: context,
        scheme: { schemeType: 'hourly', config: {}, isFallback: true },
        professionRateMap: new Map(),
        preferredRateUnit: 'hour'
    });
    const legacy = resolveEffectivePayrollProfile(staff(), 'manager', '2026-07-19', {
        payrollProfileContext: context,
        scheme: { schemeType: 'hourly', config: {}, isFallback: true },
        professionRateMap: rateMap({ manager: 220 }),
        preferredRateUnit: 'hour'
    });

    assert.equal(temporary.rate, 300);
    assert.equal(temporary.sourceOrder, 'temporary_assignment');
    assert.equal(explicit.rate, 150);
    assert.equal(explicit.sourceOrder, 'explicit_assignment');
    assert.equal(defaulted.rate, 100);
    assert.equal(defaulted.sourceOrder, 'default_profile');
    assert.equal(legacy.rate, 220);
    assert.equal(legacy.sourceOrder, 'legacy_staff_profession_rates');
});

test('hourly payroll profile applies weekday overrides by work date and stores profile breakdown', () => {
    const context = payrollProfileContext({
        defaults: [payrollProfile({
            id: 20,
            title: 'Instructor base',
            defaultRate: 100,
            dayRates: [[6, 200]]
        })]
    });
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: 240,
            allocatedMinutes: 240,
            daysWorked: 2,
            professionAllocations: [],
            primaryDays: [
                { date: '2026-07-17', professionKey: 'reception' },
                { date: '2026-07-18', professionKey: 'reception' }
            ],
            attendanceDays: [
                {
                    date: '2026-07-17',
                    actualMinutes: 120,
                    allocationSource: 'clock_interval',
                    primaryProfessionKey: 'reception',
                    segmentAllocations: [{ professionKey: 'reception', actualMinutes: 120 }]
                },
                {
                    date: '2026-07-18',
                    actualMinutes: 120,
                    allocationSource: 'clock_interval',
                    primaryProfessionKey: 'reception',
                    segmentAllocations: [{ professionKey: 'reception', actualMinutes: 120 }]
                }
            ]
        }),
        rateMap({ reception: 50 }),
        context
    );

    assert.equal(result.baseAmount, 600);
    assert.deepEqual(result.professionRateSummary.map(row => ({
        date: row.work_date,
        rate: row.rate,
        source: row.rate_source,
        rule: row.applied_rule,
        profile: row.profile_title,
        version: row.profile_version_id,
        formula: row.formula
    })), [
        {
            date: '2026-07-17',
            rate: 100,
            source: 'payroll_profile.default.default_rate',
            rule: 'default_rate',
            profile: 'Instructor base',
            version: 200,
            formula: '2h × 100'
        },
        {
            date: '2026-07-18',
            rate: 200,
            source: 'payroll_profile.default.day_rate',
            rule: 'weekday_override',
            profile: 'Instructor base',
            version: 200,
            formula: '2h × 200'
        }
    ]);
});

test('payroll profile replaces every legacy base source when a profile resolves', () => {
    const context = payrollProfileContext({
        defaults: [payrollProfile({
            id: 21,
            title: 'Profile wins',
            defaultRate: 120
        })]
    });
    const result = calculateProfessionPay(
        staff({ hourlyRate: 777 }),
        { schemeType: 'hourly', config: { hourlyRate: 888 }, isFallback: false },
        metrics({
            totalMinutes: 120,
            allocatedMinutes: 120,
            daysWorked: 1,
            professionAllocations: [],
            primaryDays: [{ date: '2026-07-17', professionKey: 'reception' }],
            attendanceDays: [{
                date: '2026-07-17',
                actualMinutes: 120,
                allocationSource: 'clock_interval',
                primaryProfessionKey: 'reception',
                segmentAllocations: [{ professionKey: 'reception', actualMinutes: 120 }]
            }]
        }),
        rateMap({ reception: 999 }),
        context
    );

    assert.equal(result.baseAmount, 240);
    assert.equal(result.totalAmount, 240);
    assert.deepEqual(result.professionRateSummary.map(row => row.rate_source), [
        'payroll_profile.default.default_rate'
    ]);
    assert.equal(
        result.professionRateSummary.some(row => String(row.rate_source || '').startsWith('staff_profession_rates')),
        false
    );
    assert.equal(
        result.professionRateSummary.some(row => String(row.rate_source || '').startsWith('payroll_scheme')),
        false
    );
});

test('legacy fallback remains unchanged when payroll profile context has no matching profile', () => {
    const legacyMetrics = metrics({
        totalMinutes: 120,
        allocatedMinutes: 120,
        daysWorked: 1,
        professionAllocations: [],
        primaryDays: [{ date: '2026-07-17', professionKey: 'reception' }],
        attendanceDays: [{
            date: '2026-07-17',
            actualMinutes: 120,
            allocationSource: 'clock_interval',
            primaryProfessionKey: 'reception',
            segmentAllocations: [{ professionKey: 'reception', actualMinutes: 120 }]
        }]
    });
    const legacyRates = rateMap({ reception: 220 });
    const scheme = { schemeType: 'hourly', config: { hourlyRate: 888 }, isFallback: false };
    const withoutProfiles = calculateProfessionPay(staff({ hourlyRate: 777 }), scheme, legacyMetrics, legacyRates);
    const withEmptyContext = calculateProfessionPay(
        staff({ hourlyRate: 777 }),
        scheme,
        legacyMetrics,
        legacyRates,
        payrollProfileContext()
    );

    assert.equal(withoutProfiles.baseAmount, 440);
    assert.equal(withoutProfiles.professionRateSummary[0].rate_source, 'staff_profession_rates.hourly_rate');
    assert.equal(withEmptyContext.baseAmount, withoutProfiles.baseAmount);
    assert.equal(withEmptyContext.totalAmount, withoutProfiles.totalAmount);
    assert.equal(withEmptyContext.professionRateSummary[0].rate_source, withoutProfiles.professionRateSummary[0].rate_source);
    assert.equal(withEmptyContext.professionRateSummary[0].profile_id, 0);
});

test('payroll profile supports distinct Monday-Sunday overrides', () => {
    const context = payrollProfileContext({
        defaults: [payrollProfile({
            id: 22,
            title: 'Week grid',
            defaultRate: 999,
            dayRates: [
                [1, 10], [2, 20], [3, 30], [4, 40], [5, 50], [6, 60], [7, 70]
            ]
        })]
    });
    const dates = [
        '2026-07-13',
        '2026-07-14',
        '2026-07-15',
        '2026-07-16',
        '2026-07-17',
        '2026-07-18',
        '2026-07-19'
    ];
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: 420,
            allocatedMinutes: 420,
            daysWorked: 7,
            professionAllocations: [],
            primaryDays: dates.map(date => ({ date, professionKey: 'reception' })),
            attendanceDays: dates.map(date => ({
                date,
                actualMinutes: 60,
                allocationSource: 'clock_interval',
                primaryProfessionKey: 'reception',
                segmentAllocations: [{ professionKey: 'reception', actualMinutes: 60 }]
            }))
        }),
        rateMap({ reception: 1 }),
        context
    );

    assert.equal(result.baseAmount, 280);
    assert.deepEqual(result.professionRateSummary.map(row => row.rate), [10, 20, 30, 40, 50, 60, 70]);
    assert.deepEqual(result.professionRateSummary.map(row => row.applied_rule), Array(7).fill('weekday_override'));
});

test('payroll profile version changes are effective by work date', () => {
    const datedProfile = {
        id: 23,
        title: 'Dated profile',
        professionKey: 'reception',
        profileKind: 'shared',
        status: 'active',
        versions: [
            {
                id: 230,
                profileId: 23,
                versionNumber: 1,
                rateUnit: 'hour',
                defaultRate: 100,
                effectiveFrom: '2026-07-01',
                effectiveTo: '2026-07-15',
                dayRates: new Map()
            },
            {
                id: 231,
                profileId: 23,
                versionNumber: 2,
                rateUnit: 'hour',
                defaultRate: 180,
                effectiveFrom: '2026-07-16',
                effectiveTo: null,
                dayRates: new Map()
            }
        ]
    };
    const context = payrollProfileContext({ defaults: [datedProfile] });
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: 120,
            allocatedMinutes: 120,
            daysWorked: 2,
            professionAllocations: [],
            primaryDays: [
                { date: '2026-07-15', professionKey: 'reception' },
                { date: '2026-07-16', professionKey: 'reception' }
            ],
            attendanceDays: [
                {
                    date: '2026-07-15',
                    actualMinutes: 60,
                    allocationSource: 'clock_interval',
                    primaryProfessionKey: 'reception',
                    segmentAllocations: [{ professionKey: 'reception', actualMinutes: 60 }]
                },
                {
                    date: '2026-07-16',
                    actualMinutes: 60,
                    allocationSource: 'clock_interval',
                    primaryProfessionKey: 'reception',
                    segmentAllocations: [{ professionKey: 'reception', actualMinutes: 60 }]
                }
            ]
        }),
        new Map(),
        context
    );

    assert.equal(result.baseAmount, 280);
    assert.deepEqual(result.professionRateSummary.map(row => [row.work_date, row.rate, row.profile_version_id]), [
        ['2026-07-15', 100, 230],
        ['2026-07-16', 180, 231]
    ]);
});

test('day payroll profile pays one primary-profession exit and skips extra segment base', () => {
    const context = payrollProfileContext({
        defaults: [
            payrollProfile({ id: 30, title: 'Reception day', professionKey: 'reception', rateUnit: 'day', defaultRate: 800 }),
            payrollProfile({ id: 31, title: 'Manager hourly', professionKey: 'manager', rateUnit: 'hour', defaultRate: 999 })
        ]
    });
    const result = calculateProfessionPay(
        staff({ rateUnit: 'day', hourlyRate: 700 }),
        { schemeType: 'per_shift', config: {}, isFallback: true },
        metrics({
            totalMinutes: 420,
            allocatedMinutes: 420,
            daysWorked: 1,
            professionAllocations: [],
            primaryDays: [{ date: '2026-07-18', professionKey: 'reception' }],
            attendanceDays: [{
                date: '2026-07-18',
                actualMinutes: 420,
                allocationSource: 'clock_interval',
                primaryProfessionKey: 'reception',
                segmentAllocations: [
                    { professionKey: 'reception', actualMinutes: 120 },
                    { professionKey: 'manager', actualMinutes: 300 }
                ]
            }]
        }),
        rateMap({ reception: 100, manager: 200 }),
        context
    );

    assert.equal(result.baseAmount, 800);
    assert.equal(result.professionRateSummary.length, 1);
    assert.equal(result.professionRateSummary[0].profession_key, 'reception');
    assert.equal(result.professionRateSummary[0].rate_unit, 'day');
    assert.equal(result.professionRateSummary[0].profile_title, 'Reception day');
});

test('active payroll scheme map preserves the configured rate unit source for previews', async () => {
    const db = {
        async query(sql, params) {
            assert.match(sql, /FROM payroll_schemes/);
            assert.deepEqual(params, [[7], '2026-07-01', '2026-07-31']);
            return { rows: [{
                id: 91,
                staff_id: 7,
                scheme_type: 'per_shift',
                title: 'Day scheme',
                is_active: true,
                config_json: { perShiftRate: 900 },
                effective_from: '2026-07-01',
                effective_to: null
            }] };
        }
    };

    const schemes = await loadActivePayrollSchemeMap([7], '2026-07', db);
    assert.equal(schemes.get(7).schemeType, 'per_shift');
    assert.equal(schemes.get(7).config.perShiftRate, 900);
});

test('payroll profile context preloads assignments, defaults, versions, and day rates', async () => {
    const db = {
        async query(sql, params = []) {
            if (/FROM staff_payroll_profile_assignments assignment/.test(sql)) {
                assert.deepEqual(params, [[7], '2026-07-01', '2026-07-31']);
                return { rows: [{
                    assignment_id: 701,
                    staff_id: 7,
                    assignment_profession_key: 'reception',
                    profile_id: 41,
                    assignment_kind: 'explicit',
                    effective_from: '2026-07-01',
                    effective_to: null,
                    profile_title: 'Instructor · Misha',
                    profile_profession_key: 'reception',
                    profile_kind: 'personal',
                    owner_staff_id: 7,
                    is_default_for_profession: false,
                    source_profile_id: 40,
                    source_version_id: 400,
                    profile_status: 'active'
                }] };
            }
            if (/FROM payroll_profiles profile/.test(sql)) {
                return { rows: [{
                    profile_id: 40,
                    profile_title: 'Instructor base',
                    profile_profession_key: 'reception',
                    profile_kind: 'shared',
                    owner_staff_id: null,
                    is_default_for_profession: true,
                    source_profile_id: null,
                    source_version_id: null,
                    profile_status: 'active'
                }] };
            }
            if (/FROM payroll_profile_versions/.test(sql)) {
                assert.deepEqual(params, [[41, 40], '2026-07-01', '2026-07-31']);
                return { rows: [
                    {
                        id: 400,
                        profile_id: 40,
                        version_number: 1,
                        rate_unit: 'hour',
                        default_rate: 100,
                        effective_from: '2026-07-01',
                        effective_to: null,
                        change_reason: 'base'
                    },
                    {
                        id: 410,
                        profile_id: 41,
                        version_number: 1,
                        rate_unit: 'hour',
                        default_rate: 150,
                        effective_from: '2026-07-01',
                        effective_to: null,
                        change_reason: 'personal'
                    }
                ] };
            }
            if (/FROM payroll_profile_day_rates/.test(sql)) {
                assert.deepEqual(params, [[400, 410]]);
                return { rows: [
                    { profile_version_id: 400, iso_weekday: 6, rate: 200 },
                    { profile_version_id: 410, iso_weekday: 6, rate: 250 }
                ] };
            }
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    const context = await loadPayrollProfileContext([7], '2026-07', db);

    assert.equal(context.enabled, true);
    assert.equal(context.defaultProfilesByProfession.get('reception').title, 'Instructor base');
    assert.equal(context.assignmentsByStaffProfession.get('7:reception')[0].profile.title, 'Instructor · Misha');
    assert.equal(context.profilesById.get(41).versions[0].dayRates.get(6), 250);
});

test('legacy day metrics still pay one staff day without segment-derived primaryDays', () => {
    const result = calculateProfessionPay(
        staff({ rateUnit: 'day', hourlyRate: 700 }),
        { schemeType: 'per_shift', config: {}, isFallback: true },
        metrics({ primaryDays: [], daysWorked: 1 }),
        rateMap({ reception: 800 })
    );

    assert.equal(result.baseAmount, 700);
    assert.equal(result.professionRateSummary[0].days, 1);
});

test('day scheme without a day-compatible fallback does not reinterpret an hourly rate', () => {
    const resolved = resolveProfessionPayRate(
        staff({ rateUnit: 'hour', hourlyRate: 100 }),
        'reception',
        { schemeType: 'per_shift', config: {} },
        rateMap({ reception: 800 }),
        'day'
    );

    assert.deepEqual(resolved, { rate: 0, source: 'unresolved', rateUnit: 'day' });
});

test('monthly rate stays one fixed amount regardless of segment count', () => {
    const result = calculateProfessionPay(
        staff({ rateUnit: 'month', hourlyRate: 30000 }),
        { schemeType: 'monthly_fixed', config: {}, isFallback: true },
        metrics(),
        rateMap({ reception: 800, manager: 1200 })
    );

    assert.equal(result.baseLines.length, 1);
    assert.equal(result.baseAmount, 30000);
    assert.equal(result.professionRateSummary.length, 1);
    assert.equal(result.professionRateSummary[0].rate_unit, 'month');
    assert.equal(result.professionRateSummary[0].rate_source, 'staff.hourly_rate');
    assert.equal(result.professionRateSummary.reduce((sum, row) => sum + row.amount, 0), 30000);
});

test('overtime is excluded from segment base and multiplied once on the primary profession', () => {
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: 720,
            allocatedMinutes: 660,
            overtimeMinutes: 60,
            overtimeAllocations: [{ professionKey: 'reception', minutes: 60, allocationSources: ['clock_interval'] }]
        }),
        rateMap({ reception: 100, manager: 200 })
    );

    assert.equal(OVERTIME_MULTIPLIER, 1.5);
    assert.equal(result.baseAmount, 1800);
    assert.equal(result.overtimeAmount, 150);
    assert.equal(result.totalAmount, 1950);
    assert.equal(result.professionRateSummary.filter(row => row.kind === 'overtime').length, 1);
    assert.equal(result.allocationIssues.filter(issue => issue.code === 'PAYROLL_OVERTIME_RECONCILIATION_REQUIRED').length, 1);
    assert.equal(result.reconciliation.warnings.filter(issue => issue.code === 'PAYROLL_OVERTIME_RECONCILIATION_REQUIRED').length, 1);

    const calculation = calculatePayroll(staff(), { schemeType: 'hourly', config: {} }, metrics(), {}, [], result);
    assert.equal(calculation.summary.base, 1800);
    assert.equal(calculation.summary.overtime, 150);
    assert.equal(calculation.summary.gross, 1950);
});

test('single-role hourly payroll keeps the legacy amount', () => {
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: 450,
            allocatedMinutes: 450,
            professionAllocations: [{ professionKey: 'reception', minutes: 450, allocationSources: ['clock_interval'] }]
        }),
        new Map()
    );

    assert.equal(result.baseAmount, 750);
    assert.equal(result.professionRateSummary.length, 1);
});

test('rate reconciliation flags profession hourly sources with non-hour units', () => {
    assert.deepEqual(buildPayrollRateUnitWarnings([{
        profession: 'reception',
        rate: 800,
        rate_unit: 'day',
        rate_source: 'staff_profession_rates.hourly_rate'
    }]).map(warning => warning.code), ['PAYROLL_RATE_UNIT_MISMATCH']);
    assert.deepEqual(buildPayrollRateUnitWarnings([{
        profession: 'reception',
        rate: 100,
        rate_unit: 'hour',
        rate_source: 'staff_profession_rates.hourly_rate'
    }]), []);
});

test('hourly payroll returns an empty result for staff without attendance metrics', () => {
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        { totalMinutes: 0, hoursWorked: 0, daysWorked: 0 },
        new Map()
    );

    assert.equal(result.baseAmount, 0);
    assert.equal(result.overtimeAmount, 0);
    assert.equal(result.totalAmount, 0);
    assert.deepEqual(result.professionRateSummary, []);
    assert.deepEqual(result.allocationIssues, []);
    assert.deepEqual(result.reconciliation, { days: [], warnings: [] });
});

test('payroll source reconciliation keeps one shift and attendance ref with many segment refs', () => {
    const reconciliation = buildPayrollSourceReconciliation([
        {
            date: '2026-07-13',
            plannedShiftRef: 91,
            attendanceRef: 44,
            segmentRefs: [501, 502],
            plannedMinutes: 660,
            physicalMinutes: 540,
            baseProfessionMinutes: 540,
            additionalProfessionMinutes: 510,
            allocationSource: 'clock_interval'
        }
    ]);

    assert.deepEqual(reconciliation.days, [{
        date: '2026-07-13',
        planned_shift_ref: 91,
        segment_refs: [501, 502],
        planned_minutes: 660,
        planned_hours: 11,
        attendance_ref: 44,
        allocation_source: 'clock_interval',
        physical_minutes: 540,
        base_profession_minutes: 540,
        additional_profession_minutes: 510,
        role_minutes: 1050,
        role_minutes_exceed_physical: true
    }]);
    assert.deepEqual(reconciliation.warnings, []);
});

test('attendance metrics keep one staff day and allocate only paid segment professions', async () => {
    const shift = {
        id: 91,
        staff_id: 7,
        shift_date: '2026-07-13',
        profession_key: 'reception',
        planned_start: '09:00',
        planned_end: '20:00',
        break_minutes: 0,
        shift_type: 'regular'
    };
    const db = {
        async query(sql) {
            if (sql.includes('FROM hr_time_records tr')) {
                return { rows: [{
                    id: 44,
                    attendance_ref: 44,
                    planned_shift_ref: 91,
                    staff_id: 7,
                    record_date: '2026-07-13',
                    date: '2026-07-13',
                    status: 'present',
                    total_worked_minutes: 660,
                    primary_profession_key: 'reception'
                }] };
            }
            if (sql.startsWith('SELECT * FROM hr_shifts')) return { rows: [shift] };
            if (sql.includes('SELECT to_jsonb(hs) AS shift_row')) {
                return { rows: [
                    {
                        shift_row: shift,
                        segment_id: 501,
                        profession_key: 'reception',
                        planned_start: '09:00',
                        planned_end: '13:00',
                        break_minutes: 0,
                        notes: null,
                        sort_order: 0,
                        additional_profession_keys: ['animator']
                    },
                    {
                        shift_row: shift,
                        segment_id: 502,
                        profession_key: 'manager',
                        planned_start: '13:00',
                        planned_end: '20:00',
                        break_minutes: 0,
                        notes: null,
                        sort_order: 1,
                        additional_profession_keys: []
                    }
                ] };
            }
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    const result = await loadPayrollAttendanceMetrics({
        from: '2026-07-13',
        to: '2026-07-13',
        staffIds: [7]
    }, db);
    const row = result.get(7);

    assert.equal(row.daysWorked, 1);
    assert.equal(row.attendanceDays.length, 1);
    assert.equal(row.attendanceDays[0].breakPolicy, 'segment_minutes_mvp');
    assert.deepEqual(row.breakPolicies, ['segment_minutes_mvp']);
    assert.equal(row.allocatedMinutes, 660);
    assert.deepEqual(row.professionAllocations, [
        { professionKey: 'manager', minutes: 420, allocationSources: ['proportional_fallback'] },
        { professionKey: 'reception', minutes: 240, allocationSources: ['proportional_fallback'] }
    ]);
    assert.equal(row.professionAllocations.some(item => item.professionKey === 'animator'), false);
    assert.deepEqual(row.reconciliation.days[0].segment_refs, [501, 502]);
});

test('attendance metrics separate physical, base, and simultaneous additional allocations from snapshot', async () => {
    const shift = {
        id: 91,
        staff_id: 7,
        shift_date: '2026-07-22',
        profession_key: 'wardrobe',
        planned_start: '11:00',
        planned_end: '20:00',
        break_minutes: 0,
        shift_type: 'regular'
    };
    const physicalAllocation = {
        segmentAllocations: [
            { segmentId: 501, professionKey: 'wardrobe', actualMinutes: 30, plannedMinutes: 30 },
            { segmentId: 502, professionKey: 'wardrobe', actualMinutes: 510, plannedMinutes: 510 }
        ],
        plannedMinutes: 540,
        actualMinutes: 540,
        allocatedMinutes: 540,
        overtimeMinutes: 0,
        allocationSource: 'clock_interval',
        allocationIssues: [],
        breakPolicy: 'segment_minutes_mvp'
    };
    const compensationSnapshot = {
        schemaVersion: 1,
        state: 'final',
        manualReview: false,
        planSource: 'hr_shift',
        plan: {
            primaryProfessionKey: 'wardrobe',
            plannedStart: '11:00',
            plannedEnd: '20:00',
            segments: [
                { id: 501, professionKey: 'wardrobe', shiftStart: '11:00', shiftEnd: '11:30', breakMinutes: 0 },
                { id: 502, professionKey: 'wardrobe', shiftStart: '11:30', shiftEnd: '20:00', breakMinutes: 0 }
            ]
        },
        physicalAllocation,
        compensationAllocations: [
            { allocationType: 'base', segmentId: 501, professionKey: 'wardrobe', actualMinutes: 30 },
            { allocationType: 'base', segmentId: 502, professionKey: 'wardrobe', actualMinutes: 510 },
            {
                allocationType: 'simultaneous_additional',
                segmentId: 502,
                segmentIndex: 1,
                professionKey: 'hallkeeper',
                plannedMinutes: 510,
                actualMinutes: 510,
                compensationMode: 'paid_hourly',
                payMultiplier: 1,
                rate: 200,
                rateUnit: 'hour',
                rateSource: 'staff_profession_rates.hourly_rate',
                policyVersion: 'simultaneous-profession-pay-v1'
            }
        ],
        totals: {
            physicalMinutes: 540,
            baseMinutes: 540,
            simultaneousAdditionalMinutes: 510,
            compensationMinutes: 1050
        },
        issues: []
    };
    const db = {
        async query(sql) {
            if (sql.includes('FROM hr_time_records tr')) {
                return { rows: [{
                    id: 44,
                    attendance_ref: 44,
                    planned_shift_ref: 91,
                    staff_id: 7,
                    record_date: '2026-07-22',
                    date: '2026-07-22',
                    clock_in: '2026-07-22T08:00:00.000Z',
                    clock_out: '2026-07-22T17:00:00.000Z',
                    status: 'present',
                    total_worked_minutes: 540,
                    primary_profession_key: 'wardrobe',
                    compensation_snapshot: compensationSnapshot
                }] };
            }
            if (sql.startsWith('SELECT * FROM hr_shifts')) return { rows: [shift] };
            if (sql.includes('SELECT to_jsonb(hs) AS shift_row')) {
                return { rows: [
                    {
                        shift_row: shift,
                        segment_id: 501,
                        profession_key: 'wardrobe',
                        planned_start: '11:00',
                        planned_end: '11:30',
                        break_minutes: 0,
                        sort_order: 0,
                        additional_profession_keys: [],
                        additional_roles: []
                    },
                    {
                        shift_row: shift,
                        segment_id: 502,
                        profession_key: 'wardrobe',
                        planned_start: '11:30',
                        planned_end: '20:00',
                        break_minutes: 0,
                        sort_order: 1,
                        additional_profession_keys: ['hallkeeper'],
                        additional_roles: []
                    }
                ] };
            }
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    const result = await loadPayrollAttendanceMetrics({
        from: '2026-07-22',
        to: '2026-07-22',
        staffIds: [7]
    }, db);
    const row = result.get(7);

    assert.equal(row.physicalMinutes, 540);
    assert.equal(row.hoursWorked, 9);
    assert.equal(row.baseProfessionAllocations[0].minutes, 540);
    assert.equal(row.additionalProfessionAllocations[0].minutes, 510);
    assert.equal(row.compensationMinutes, 1050);
    assert.equal(row.reconciliation.days[0].role_minutes_exceed_physical, true);
    assert.deepEqual(row.payrollBlockingIssues, []);
});

test('payroll reconciliation remains in attention while allocation warnings exist', async () => {
    const result = await loadPayrollReconciliation('2026-07', {
        async query(sql) {
            assert.match(sql, /source_warnings/);
            return { rows: [{
                payroll_count: 1,
                payroll_total: 1800,
                finance_salary_count: 1,
                finance_salary_total: 1800,
                finance_reversal_count: 0,
                finance_reversal_total: 0,
                missing_finance_count: 0,
                orphan_salary_count: 0,
                source_warning_count: 1
            }] };
        }
    });

    assert.equal(result.variance, 0);
    assert.equal(result.source_warning_count, 1);
    assert.equal(result.status, 'attention');
});

test('payroll routes use the shared allocation service and export one employee row with breakdown', () => {
    const root = path.join(__dirname, '..');
    const hrRoute = fs.readFileSync(path.join(root, 'routes', 'hr.js'), 'utf8');
    const payrollRoute = fs.readFileSync(path.join(root, 'routes', 'payroll.js'), 'utf8');
    const payrollService = fs.readFileSync(path.join(root, 'services', 'payroll.js'), 'utf8');
    const hrPage = fs.readFileSync(path.join(root, 'js', 'hr-page.js'), 'utf8');
    const financePage = fs.readFileSync(path.join(root, 'js', 'finance-page.js'), 'utf8');

    assert.match(hrRoute, /loadPayrollAttendanceMetrics\(\{ from: period\.from, to: period\.to, staffIds \}, db\)/);
    assert.match(hrRoute, /loadPayrollProfileContext\(staffIds, \{ from: period\.from, to: period\.to \}, db\)/);
    assert.match(hrRoute, /calculateProfessionPay\(staff, scheme, metrics, professionRateMap, payrollProfileContext\)/);
    assert.match(hrRoute, /applyHrPayrollSnapshot\(calculatedRow, row\)/);
    assert.match(hrRoute, /router\.get\('\/salary'[\s\S]*loadPayrollCalculation\(req\.query\.month, pool/);
    assert.match(hrRoute, /router\.post\('\/salary\/commit'[\s\S]*const calculation = await loadPayrollCalculation\(month, client\)/);
    assert.match(hrRoute, /assertPayrollRowsCommitReady\(calculation\.data\)/);
    assert.match(hrRoute, /PAYROLL_COMPENSATION_SNAPSHOT_BLOCKED|err\.code \|\| null/);
    assert.match(hrRoute, /breakdown_json[\s\S]*professionRateSummary[\s\S]*row\.profession_rate_summary/);
    assert.match(hrRoute, /loadActivePayrollSchemeMap\(staffIds, month, db\)/);
    assert.match(hrRoute, /reconciliation: row\.reconciliation/);
    assert.match(payrollRoute, /router\.get\('\/export'/);
    assert.match(payrollRoute, /report\.staff\.map\(row =>/);
    assert.match(payrollRoute, /professionRateSummary/);
    assert.match(payrollRoute, /item\.rate_source/);
    assert.match(payrollRoute, /item\.profile_title/);
    assert.match(payrollRoute, /item\.applied_rule/);
    assert.match(payrollRoute, /function payrollExportFields/);
    assert.match(payrollRoute, /'physical_hours', 'base_role_hours', 'additional_role_hours'/);
    assert.match(payrollRoute, /'additional_profession', 'additional_rate', 'additional_multiplier', 'additional_amount'/);
    assert.match(payrollRoute, /router\.get\('\/export-xlsx'/);
    assert.match(payrollRoute, /workbook\.addWorksheet\('Additional lines'\)/);
    assert.match(payrollService, /payroll_additional_line_generated/);
    assert.match(hrRoute, /compensation_snapshot_corrected/);
    assert.match(hrRoute, /payrollDetailsRedacted: true/);
    assert.match(hrRoute, /normalized\.endsWith\('amount'\)/);
    assert.doesNotMatch(hrRoute, /normalized\.includes\('rate'\)/);
    assert.match(payrollService, /workedDates\.get\(staffId\)\.add\(date\)/);
    assert.match(payrollService, /function resolveEffectivePayrollProfile/);
    assert.doesNotMatch(payrollService, /JOIN\s+hr_shift_segments/i);
    assert.match(hrPage, /segment\.allocation_source/);
    assert.match(hrPage, /segment\.amount/);
    assert.match(hrPage, /Оплачувані години професій можуть перевищувати фізичні години/);
    assert.match(financePage, /renderPayrollProfessionBreakdown/);
    assert.match(financePage, /\/api\/payroll\/export\?month=/);
    assert.match(financePage, /\/api\/payroll\/export-xlsx\?month=/);
    assert.match(financePage, /renderPayrollAdditionalBreakdown/);
});

test('payroll profile resolver keeps profile query budget batched by staff and profile ids', () => {
    const root = path.join(__dirname, '..');
    const payrollService = fs.readFileSync(path.join(root, 'services', 'payroll.js'), 'utf8');
    const contextLoader = payrollService.match(/async function loadPayrollProfileContext[\s\S]*?\n}\n\nfunction schemeRateFallback/)?.[0] || '';

    assert.match(contextLoader, /assignment\.staff_id = ANY\(\$1::int\[\]\)/);
    assert.match(contextLoader, /profile_id = ANY\(\$1::bigint\[\]\)/);
    assert.match(contextLoader, /profile_version_id = ANY\(\$1::bigint\[\]\)/);
    assert.match(contextLoader, /Promise\.all\(\[/);
    assert.doesNotMatch(contextLoader, /for\s*\([^)]*staffId[^)]*\)[\s\S]*db\.query/);
    assert.doesNotMatch(contextLoader, /for\s*\([^)]*profileId[^)]*\)[\s\S]*db\.query/);
});
