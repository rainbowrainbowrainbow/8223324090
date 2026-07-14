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
    calculateProfessionPay,
    calculatePayroll,
    loadActivePayrollSchemeMap,
    loadPayrollAttendanceMetrics,
    resolveProfessionPayRate
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
        overtimeAllocations: [],
        primaryDays: [{ date: '2026-07-13', professionKey: 'reception' }],
        attendanceDays: [{ date: '2026-07-13', allocationSource: 'clock_interval' }],
        allocationIssues: [],
        reconciliation: { days: [], warnings: [] },
        ...overrides
    };
}

function rateMap(values = {}) {
    return new Map(Object.entries(values).map(([professionKey, rate]) => [`7:${professionKey}`, rate]));
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
        allocation_source: 'clock_interval'
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
    assert.match(hrRoute, /calculateProfessionPay\(staff, scheme, metrics, professionRateMap\)/);
    assert.match(hrRoute, /loadActivePayrollSchemeMap\(staffIds, month, db\)/);
    assert.match(hrRoute, /reconciliation: row\.reconciliation/);
    assert.match(payrollRoute, /router\.get\('\/export'/);
    assert.match(payrollRoute, /report\.staff\.map\(row =>/);
    assert.match(payrollRoute, /professionRateSummary/);
    assert.match(payrollRoute, /item\.rate_source/);
    assert.match(payrollService, /workedDates\.get\(staffId\)\.add\(date\)/);
    assert.doesNotMatch(payrollService, /JOIN\s+hr_shift_segments/i);
    assert.match(hrPage, /segment\.allocation_source/);
    assert.match(hrPage, /segment\.amount/);
    assert.match(financePage, /renderPayrollProfessionBreakdown/);
    assert.match(financePage, /\/api\/payroll\/export\?month=/);
});
