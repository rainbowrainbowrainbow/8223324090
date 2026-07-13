const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    buildPayrollSourceReconciliation,
    loadPayrollReconciliation
} = require('../services/hrPayrollPeriod');
const {
    OVERTIME_MULTIPLIER,
    calculateProfessionPay,
    calculatePayroll,
    loadPayrollAttendanceMetrics
} = require('../services/payroll');

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

test('day rate is paid once per staff date using the primary profession', () => {
    const result = calculateProfessionPay(
        staff({ rateUnit: 'day', hourlyRate: 700 }),
        { schemeType: 'per_shift', config: {}, isFallback: true },
        metrics(),
        rateMap({ reception: 800, manager: 1200 })
    );

    assert.equal(result.baseLines.length, 1);
    assert.equal(result.baseAmount, 800);
    assert.equal(result.professionRateSummary[0].profession_key, 'reception');
    assert.equal(result.professionRateSummary[0].days, 1);
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
});

test('overtime is excluded from segment base and multiplied once on the primary profession', () => {
    const result = calculateProfessionPay(
        staff(),
        { schemeType: 'hourly', config: {}, isFallback: true },
        metrics({
            totalMinutes: 720,
            allocatedMinutes: 660,
            overtimeMinutes: 60,
            overtimeAllocations: [{ professionKey: 'reception', minutes: 60, allocationSources: ['clock_interval'] }],
            allocationIssues: [{ code: 'PAYROLL_OVERTIME_RECONCILIATION_REQUIRED' }]
        }),
        rateMap({ reception: 100, manager: 200 })
    );

    assert.equal(OVERTIME_MULTIPLIER, 1.5);
    assert.equal(result.baseAmount, 1800);
    assert.equal(result.overtimeAmount, 150);
    assert.equal(result.totalAmount, 1950);
    assert.equal(result.professionRateSummary.filter(row => row.kind === 'overtime').length, 1);

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
    assert.match(hrRoute, /reconciliation: row\.reconciliation/);
    assert.match(payrollRoute, /router\.get\('\/export'/);
    assert.match(payrollRoute, /report\.staff\.map\(row =>/);
    assert.match(payrollRoute, /professionRateSummary/);
    assert.match(payrollService, /workedDates\.get\(staffId\)\.add\(date\)/);
    assert.doesNotMatch(payrollService, /JOIN\s+hr_shift_segments/i);
    assert.match(hrPage, /segment\.allocation_source/);
    assert.match(hrPage, /segment\.amount/);
    assert.match(financePage, /renderPayrollProfessionBreakdown/);
    assert.match(financePage, /\/api\/payroll\/export\?month=/);
});
