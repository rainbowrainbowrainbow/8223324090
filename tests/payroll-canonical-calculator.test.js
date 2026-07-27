'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const payrollService = fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8');
const hrRoute = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');
const staffRoute = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');
const payrollRoute = fs.readFileSync(path.join(ROOT, 'routes', 'payroll.js'), 'utf8');
const hrPage = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
const migration303 = fs.readFileSync(
    path.join(ROOT, 'db', 'migrations', '303_payroll_zrs_canonical_type.sql'),
    'utf8'
);
const migration305 = fs.readFileSync(
    path.join(ROOT, 'db', 'migrations', '305_payroll_kpi_bonus_adjustments.sql'),
    'utf8'
);
const migration306 = fs.readFileSync(
    path.join(ROOT, 'db', 'migrations', '306_payroll_piece_scheme.sql'),
    'utf8'
);

const {
    PAYROLL_KPI_BONUS_RULE_VERSION,
    PAYROLL_KPI_BONUS_TYPE,
    SCHEME_TYPES,
    buildPayrollKpiAuditSnapshot,
    calculateAdvanceInstallment,
    calculateFinalInstallment,
    calculateMonthlyPayroll,
    calculatePayrollRangePreview,
    employmentOverlapsPayrollRange,
    loadActivePayrollSchemeMap,
    loadPayrollAttendanceMetrics,
    normalizePayrollAdjustmentType,
    normalizePayrollEntryLineType,
    payrollCalculationBlockers,
    payrollInstallmentSchedule,
    resolveEffectivePayrollProfile
} = require('../services/payroll');

function confirmedMonthlyNorm(month, minutes) {
    return {
        monthlyNormMinutes: minutes,
        monthlyNormConfirmed: true,
        monthlyNormSource: 'test_confirmed_schedule',
        monthlyNormMonth: month
    };
}

test('canonical payroll exposes separate monthly, advance, final, and range-preview functions', () => {
    for (const token of [
        'function calculateMonthlyPayroll',
        'function calculateAdvanceInstallment',
        'function calculateFinalInstallment',
        'function calculatePayrollRangePreview'
    ]) {
        assert.match(payrollService, new RegExp(token));
    }
});

test('ZRS has a canonical type while legacy advance remains read-compatible', () => {
    assert.equal(normalizePayrollAdjustmentType('zrs'), 'zrs');
    assert.equal(normalizePayrollAdjustmentType('advance'), 'zrs');
    assert.equal(normalizePayrollEntryLineType('advance'), 'zrs');
    assert.match(migration303, /type IN \('bonus', 'deduction', 'penalty', 'tip', 'advance', 'zrs'\)/);
    assert.match(migration303, /line_type IN \('base','bonus','deduction','advance','zrs','percent','manual','adjustment'\)/);
    assert.doesNotMatch(migration303.replace(/^\s*--.*$/gm, ''), /\bUPDATE\s+salary_adjustments\b/i);
    assert.doesNotMatch(migration303.replace(/^\s*--.*$/gm, ''), /\bUPDATE\s+payroll_entries\b/i);
});

test('monthly payroll reads legacy advance as ZRS and excludes true advance from monthly adjustments', () => {
    const payroll = calculateMonthlyPayroll(
        { id: 1, hourlyRate: 100, rateUnit: 'hour' },
        { schemeType: 'hourly', config: { hourlyRate: 100 } },
        { hoursWorked: 10 },
        { bonus: 50, zrs: 25, advance: 75 },
        [{ line_type: 'advance', label: 'Legacy ZRS', amount: 20 }]
    );

    assert.equal(payroll.summary.gross, 1050);
    assert.equal(payroll.summary.zrs, 120);
    assert.equal(payroll.summary.advances, 120);
    assert.equal(payroll.summary.net, 930);
    assert.ok(payroll.lines.some(line => line.lineType === 'zrs' && line.group === 'zrs'));
});

test('manual KPI bonus is final-only payroll money and does not derive from KPI score', () => {
    const payroll = calculateMonthlyPayroll(
        { id: 1, hourlyRate: 100, rateUnit: 'hour' },
        { schemeType: 'hourly', config: { hourlyRate: 100 } },
        { hoursWorked: 10 },
        { bonus: 50, kpi_bonus: 300, zrs: 25 },
        []
    );

    assert.equal(PAYROLL_KPI_BONUS_TYPE, 'kpi_bonus');
    assert.equal(PAYROLL_KPI_BONUS_RULE_VERSION, 'manual_kpi_bonus_v1');
    assert.equal(payroll.summary.gross, 1350);
    assert.equal(payroll.summary.kpiBonus, 300);
    assert.equal(payroll.summary.net, 1325);
    assert.ok(payroll.lines.some(line =>
        line.lineType === 'kpi_bonus'
        && line.group === 'bonus'
        && line.meta?.finalOnly === true
        && line.meta?.formula === null
    ));
    assert.match(migration305, /type IN \('bonus', 'deduction', 'penalty', 'tip', 'advance', 'zrs', 'kpi_bonus'\)/);
    assert.doesNotMatch(migration305.replace(/^\s*--.*$/gm, ''), /\bUPDATE\s+salary_adjustments\b/i);
});

test('advance installment for hourly/daily/percent/hybrid-style earnings excludes ZRS and bonuses', () => {
    const advance = calculateAdvanceInstallment({
        staff: { id: 1, hourlyRate: 100, rateUnit: 'hour' },
        scheme: { schemeType: 'hourly', config: { hourlyRate: 100 } },
        advanceMetrics: { hoursWorked: 8 },
        rangeCalculation: {
            lines: [
                { group: 'base', amount: 800 },
                { group: 'bonus', amount: 500 },
                { group: 'bonus', lineType: 'kpi_bonus', amount: 300 },
                { group: 'zrs', amount: 100 }
            ]
        },
        earningFrom: '2026-07-01',
        earningTo: '2026-07-15'
    });

    assert.equal(advance.amount, 800);
    assert.equal(advance.excludesMonthlyAdjustments, true);
    assert.equal(advance.confirmable, true);
});

test('final payroll snapshot stores immutable KPI audit payload with manual approved bonus', () => {
    const snapshot = buildPayrollKpiAuditSnapshot('2026-07', {
        staffId: 7,
        daysWorked: 12,
        plannedHours: 120,
        overtimeHours: 3,
        lines: [
            { group: 'bonus', lineType: 'kpi_bonus', amount: 400 },
            { group: 'bonus', lineType: 'adjustment', amount: 50 }
        ]
    }, {
        sourceTimestamp: '2026-07-31T18:00:00.000Z',
        metrics: {
            tasks: { assigned: 10, done: 8, overdue: 1 },
            onboarding: { total: 1, completed: 0, active: 1, totalItems: 5, completedItems: 3 },
            contribution: { eventsPeriod: 4, ratingsSource: 'disabled_no_period_source', totalRatings: 0, avgRating: null }
        }
    });

    assert.equal(snapshot.kpiMonth, '2026-07');
    assert.equal(snapshot.ruleVersion, 'manual_kpi_bonus_v1');
    assert.equal(snapshot.approvedBonusAmount, 400);
    assert.equal(snapshot.appliesToInstallmentKind, 'final');
    assert.equal(snapshot.formula, null);
    assert.equal(snapshot.formulaStatus, 'not_configured');
    assert.deepEqual(snapshot.metrics.tasks, { assigned: 10, done: 8, overdue: 1 });
    assert.equal(snapshot.metrics.contribution.ratingsSource, 'disabled_no_period_source');
    assert.equal(snapshot.sourceTimestamp, '2026-07-31T18:00:00.000Z');
});

test('monthly fixed advance is prorated by paid planned norm and rounded once', () => {
    const advance = calculateAdvanceInstallment({
        staff: { id: 2, hourlyRate: 30000, rateUnit: 'month' },
        scheme: { schemeType: 'monthly_fixed', config: { monthlyAmount: 30000 } },
        monthMetrics: {
            plannedMinutes: 22 * 8 * 60,
            paidPlannedMinutes: 22 * 8 * 60,
            periodFrom: '2026-07-01',
            periodTo: '2026-07-31',
            ...confirmedMonthlyNorm('2026-07', 22 * 8 * 60)
        },
        advanceMetrics: { paidPlannedMinutes: 11 * 8 * 60 },
        earningFrom: '2026-07-01',
        earningTo: '2026-07-15'
    });

    assert.equal(advance.amount, 15000);
    assert.equal(advance.lockedAmount, 15000);
    assert.equal(advance.calculationSnapshot.roundedOnce, true);
});

test('payroll installment schedule covers month length and final payment next-month edges', () => {
    for (const [month, monthEnd, finalPaymentDate] of [
        ['2026-02', '2026-02-28', '2026-03-10'],
        ['2024-02', '2024-02-29', '2024-03-10'],
        ['2026-04', '2026-04-30', '2026-05-10'],
        ['2026-07', '2026-07-31', '2026-08-10'],
        ['2026-12', '2026-12-31', '2027-01-10']
    ]) {
        assert.deepEqual(payrollInstallmentSchedule(month, 'advance'), {
            earningFrom: `${month}-01`,
            earningTo: `${month}-15`,
            scheduledPaymentDate: `${month}-20`
        });
        assert.deepEqual(payrollInstallmentSchedule(month, 'final'), {
            earningFrom: `${month}-16`,
            earningTo: monthEnd,
            scheduledPaymentDate: finalPaymentDate
        });
    }
});

test('monthly fixed advance blocks approval when paid planned norm is missing', () => {
    const advance = calculateAdvanceInstallment({
        staff: { id: 3, hourlyRate: 30000, rateUnit: 'month' },
        scheme: { schemeType: 'monthly_fixed', config: { monthlyAmount: 30000 } },
        monthMetrics: {
            plannedMinutes: 22 * 8 * 60,
            paidPlannedMinutes: 22 * 8 * 60,
            ...confirmedMonthlyNorm('2026-07', 22 * 8 * 60)
        },
        advanceMetrics: {}
    });

    assert.equal(advance.confirmable, false);
    assert.equal(advance.blockers[0].code, 'PAYROLL_ADVANCE_PLANNED_NORM_REQUIRED');
});

test('canonical monthly calculator covers supported scheme matrix with monthly adjustments applied once', () => {
    const cases = [
        {
            label: 'hourly',
            scheme: { schemeType: 'hourly', config: { hourlyRate: 100 } },
            metrics: { hoursWorked: 8 },
            expected: { base: 800, net: 935 }
        },
        {
            label: 'daily/per_shift',
            scheme: { schemeType: 'per_shift', config: { perShiftRate: 900 } },
            metrics: { daysWorked: 2 },
            expected: { base: 1800, net: 1935 }
        },
        {
            label: 'monthly_fixed',
            scheme: { schemeType: 'monthly_fixed', config: { monthlyAmount: 30000 } },
            metrics: {
                plannedMinutes: 22 * 8 * 60,
                paidPlannedMinutes: 22 * 8 * 60,
                ...confirmedMonthlyNorm('2026-07', 22 * 8 * 60)
            },
            expected: { base: 30000, net: 30135 }
        },
        {
            label: 'percent',
            scheme: { schemeType: 'percent', config: { percentRate: 10, sourceMetric: 'finance_income' } },
            metrics: { periodIncome: 50000 },
            expected: { percent: 5000, net: 5135 }
        },
        {
            label: 'hybrid',
            scheme: {
                schemeType: 'hybrid',
                config: {
                    base: { kind: 'hourly', rate: 100 },
                    bonusRules: [{ kind: 'fixed', amount: 200 }],
                    percentRules: [{ kind: 'percent', rate: 10, manualBase: 1000 }],
                    deductions: [{ kind: 'fixed', amount: 50 }],
                    advances: [{ kind: 'fixed', amount: 25 }]
                }
            },
            metrics: { hoursWorked: 8 },
            expected: { base: 800, bonuses: 350, percent: 100, deductions: 60, zrs: 30, net: 1160 }
        },
        {
            label: 'manual',
            scheme: { schemeType: 'manual', config: { manualAmount: 1234 } },
            metrics: {},
            expected: { manual: 1234, net: 1369 }
        },
        {
            label: 'piece',
            scheme: { schemeType: 'piece', config: { pieceRate: 25 } },
            metrics: { pieceQuantity: 12 },
            expected: { base: 300, net: 435 }
        }
    ];

    for (const testCase of cases) {
        const payroll = calculateMonthlyPayroll(
            { id: 1, hourlyRate: 100, rateUnit: 'hour' },
            testCase.scheme,
            testCase.metrics,
            { bonus: 100, deduction: 10, zrs: 5, kpi_bonus: 50 },
            []
        );
        for (const [key, value] of Object.entries(testCase.expected)) {
            assert.equal(payroll.summary[key], value, `${testCase.label}.${key}`);
        }
        assert.equal(payroll.summary.kpiBonus, 50, `${testCase.label}.kpiBonus`);
        assert.equal(payroll.lines.filter(line => line.lineType === 'kpi_bonus').length, 1, `${testCase.label}.kpi line once`);
        const zrsLines = payroll.lines.filter(line => line.group === 'zrs');
        assert.equal(
            zrsLines.reduce((sum, item) => sum + Number(item.amount || 0), 0),
            payroll.summary.zrs,
            `${testCase.label}.zrs total`
        );
        assert.equal(
            zrsLines.filter(line => line.source === 'salary_adjustments').length,
            1,
            `${testCase.label}.monthly zrs adjustment once`
        );
    }
});

test('advance calculation excludes final-only monthly money across supported non-fixed schemes', () => {
    const cases = [
        {
            label: 'hourly',
            scheme: { schemeType: 'hourly', config: { hourlyRate: 100 } },
            metrics: { hoursWorked: 8 },
            expectedAdvance: 800
        },
        {
            label: 'daily/per_shift',
            scheme: { schemeType: 'per_shift', config: { perShiftRate: 900 } },
            metrics: { daysWorked: 2 },
            expectedAdvance: 1800
        },
        {
            label: 'percent',
            scheme: { schemeType: 'percent', config: { percentRate: 10, sourceMetric: 'finance_income' } },
            metrics: { periodIncome: 15000 },
            expectedAdvance: 1500
        },
        {
            label: 'hybrid',
            scheme: {
                schemeType: 'hybrid',
                config: {
                    base: { kind: 'hourly', rate: 100 },
                    bonusRules: [{ kind: 'fixed', amount: 500 }],
                    deductions: [{ kind: 'fixed', amount: 100 }],
                    advances: [{ kind: 'fixed', amount: 200 }]
                }
            },
            metrics: { hoursWorked: 8 },
            expectedAdvance: 800
        },
        {
            label: 'manual',
            scheme: { schemeType: 'manual', config: { manualAmount: 777 } },
            metrics: {},
            expectedAdvance: 777
        },
        {
            label: 'piece',
            scheme: { schemeType: 'piece', config: { pieceRate: 25 } },
            metrics: { pieceQuantity: 5 },
            expectedAdvance: 125
        }
    ];

    for (const testCase of cases) {
        const advance = calculateAdvanceInstallment({
            staff: { id: 1, hourlyRate: 100, rateUnit: 'hour' },
            scheme: testCase.scheme,
            advanceMetrics: testCase.metrics,
            earningFrom: '2026-07-01',
            earningTo: '2026-07-15'
        });
        assert.equal(advance.amount, testCase.expectedAdvance, testCase.label);
        assert.deepEqual(advance.blockers, []);
    }
});

test('rounding is absorbed by final and the monthly fixed amount is not duplicated', () => {
    const advance = calculateAdvanceInstallment({
        staff: { id: 4, hourlyRate: 1000, rateUnit: 'month' },
        scheme: { schemeType: 'monthly_fixed', config: { monthlyAmount: 1000 } },
        monthMetrics: {
            plannedMinutes: 31 * 8 * 60,
            paidPlannedMinutes: 31 * 8 * 60,
            periodFrom: '2026-07-01',
            periodTo: '2026-07-31',
            ...confirmedMonthlyNorm('2026-07', 31 * 8 * 60)
        },
        advanceMetrics: { paidPlannedMinutes: 15 * 8 * 60 },
        earningFrom: '2026-07-01',
        earningTo: '2026-07-15'
    });
    const final = calculateFinalInstallment({
        monthlyPayroll: { summary: { net: 1000 } },
        advanceInstallment: { status: 'approved', lockedAmount: advance.lockedAmount, paidAmount: advance.lockedAmount }
    });

    assert.equal(advance.lockedAmount, 484);
    assert.equal(final.amount, 516);
    assert.equal(advance.lockedAmount + final.amount, 1000);
});

test('employment overlap includes inactive historical workers and excludes outside-period workers', () => {
    const range = { from: '2026-07-01', to: '2026-07-31' };

    assert.equal(employmentOverlapsPayrollRange({ hireDate: '2026-07-10', isActive: true }, range), true);
    assert.equal(employmentOverlapsPayrollRange({ terminationDate: '2026-07-15', isActive: false }, range), true);
    assert.equal(employmentOverlapsPayrollRange({ hireDate: '2026-08-01', isActive: true }, range), false);
    assert.equal(employmentOverlapsPayrollRange({ terminationDate: '2026-06-30', isActive: false }, range), false);
});

test('effective-dated payroll profile resolves the correct rate version for the work date', () => {
    const profile = {
        id: 10,
        title: 'Animators',
        professionKey: 'animator',
        profileKind: 'shared',
        status: 'active',
        versions: [
            { id: 1, versionNumber: 1, rateUnit: 'hour', defaultRate: 100, effectiveFrom: '2026-07-01', effectiveTo: '2026-07-15', dayRates: new Map() },
            { id: 2, versionNumber: 2, rateUnit: 'hour', defaultRate: 150, effectiveFrom: '2026-07-16', effectiveTo: null, dayRates: new Map([[4, 175]]) }
        ]
    };
    const payrollProfileContext = {
        enabled: true,
        defaultProfilesByProfession: new Map([['animator', profile]]),
        assignmentsByStaffProfession: new Map()
    };

    const firstHalf = resolveEffectivePayrollProfile({ id: 9, roleType: 'animator' }, 'animator', '2026-07-10', { payrollProfileContext });
    const secondHalf = resolveEffectivePayrollProfile({ id: 9, roleType: 'animator' }, 'animator', '2026-07-16', { payrollProfileContext });

    assert.equal(firstHalf.rate, 100);
    assert.equal(firstHalf.profileVersionId, 1);
    assert.equal(secondHalf.rate, 175);
    assert.equal(secondHalf.profileVersionId, 2);
    assert.equal(secondHalf.appliedRule, 'weekday_override');
});

test('effective-dated scheme history selects the correct month and blocks a mid-month scheme change', async () => {
    const rows = [
        {
            id: 101,
            staff_id: 7,
            scheme_type: 'hourly',
            title: 'Old rate',
            is_active: false,
            config_json: { hourlyRate: 100 },
            effective_from: '2026-01-01',
            effective_to: null,
            created_at: '2026-01-01T00:00:00.000Z'
        },
        {
            id: 102,
            staff_id: 7,
            scheme_type: 'hourly',
            title: 'New rate',
            is_active: true,
            config_json: { hourlyRate: 150 },
            effective_from: '2026-07-16',
            effective_to: null,
            created_at: '2026-07-15T00:00:00.000Z'
        }
    ];
    const fakeDb = { query: async () => ({ rows }) };

    const julyScheme = (await loadActivePayrollSchemeMap([7], '2026-07', fakeDb)).get(7);
    const augustScheme = (await loadActivePayrollSchemeMap([7], '2026-08', fakeDb)).get(7);

    assert.equal(julyScheme.id, 102);
    assert.equal(julyScheme.periodSchemeVersions.length, 2);
    assert.equal(
        payrollCalculationBlockers({ id: 7 }, julyScheme, {}).some(issue => issue.code === 'PAYROLL_SCHEME_CHANGE_IN_PERIOD_UNSUPPORTED'),
        true
    );
    assert.equal(augustScheme.id, 102);
    assert.equal(augustScheme.periodSchemeVersions.length, 1);
    assert.equal(
        payrollCalculationBlockers({ id: 7 }, augustScheme, {}).some(issue => issue.code === 'PAYROLL_SCHEME_CHANGE_IN_PERIOD_UNSUPPORTED'),
        false
    );
});

test('piece payroll is an explicit quantity times rate scheme with schema support', () => {
    assert.ok(SCHEME_TYPES.includes('piece'));
    assert.match(payrollService, /function buildPieceLine/);
    assert.match(payrollService, /formula: 'quantity \* rate'/);
    assert.match(migration306, /chk_payroll_schemes_type/);
    assert.match(migration306, /scheme_type IN \('per_shift','hourly','monthly_fixed','percent','hybrid','manual','piece'\)/);
    assert.match(migration306, /chk_payroll_entries_line_type/);
    assert.match(migration306, /line_type IN \('base','bonus','deduction','advance','zrs','percent','manual','adjustment','piece'\)/);
    assert.doesNotMatch(migration306.replace(/^\s*--.*$/gm, ''), /\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);

    const payroll = calculateMonthlyPayroll(
        { id: 12 },
        { schemeType: 'piece', config: { pieceRate: 25 } },
        { pieceQuantity: 12 },
        { bonus: 100, kpi_bonus: 50, deduction: 10, zrs: 5 },
        []
    );

    assert.equal(payroll.summary.base, 300);
    assert.equal(payroll.summary.gross, 450);
    assert.equal(payroll.summary.net, 435);
    assert.deepEqual(payroll.blockers, []);
    const pieceLine = payroll.lines.find(line => line.lineType === 'piece');
    assert.equal(pieceLine.amount, 300);
    assert.equal(pieceLine.quantity, 12);
    assert.equal(pieceLine.rate, 25);
    assert.equal(pieceLine.source, 'metrics.pieceQuantity');
    assert.equal(pieceLine.meta.formula, 'quantity * rate');
});

test('piece advance uses only units 1-15 and final subtracts the locked advance once', () => {
    const advance = calculateAdvanceInstallment({
        staff: { id: 12 },
        scheme: { schemeType: 'piece', config: { pieceRate: 25 } },
        advanceMetrics: { pieceQuantity: 5 },
        earningFrom: '2026-07-01',
        earningTo: '2026-07-15'
    });
    const monthlyPayroll = calculateMonthlyPayroll(
        { id: 12 },
        { schemeType: 'piece', config: { pieceRate: 25 } },
        { pieceQuantity: 12 },
        { bonus: 100, kpi_bonus: 50, deduction: 10, zrs: 5 },
        []
    );
    const final = calculateFinalInstallment({
        monthlyPayroll,
        advanceInstallment: { status: 'approved', lockedAmount: advance.lockedAmount, paidAmount: advance.lockedAmount }
    });

    assert.equal(advance.amount, 125);
    assert.equal(advance.excludesMonthlyAdjustments, true);
    assert.equal(advance.confirmable, true);
    assert.equal(final.amount, 310);
    assert.equal(advance.amount + final.amount, monthlyPayroll.summary.net);
    assert.equal(final.advanceOutstandingAmount, 0);
});

test('piece approval fails closed when explicit quantity or rate is missing', () => {
    const missingQuantity = calculateMonthlyPayroll(
        { id: 12 },
        { schemeType: 'piece', config: { pieceRate: 25 } },
        {},
        {},
        []
    );
    const missingRate = calculateMonthlyPayroll(
        { id: 13 },
        { schemeType: 'piece', config: {} },
        { pieceQuantity: 4 },
        {},
        []
    );
    const directBlockers = payrollCalculationBlockers(
        { id: 14 },
        { schemeType: 'piece', config: {} },
        {}
    );
    const advance = calculateAdvanceInstallment({
        staff: { id: 12 },
        scheme: { schemeType: 'piece', config: { pieceRate: 25 } },
        advanceMetrics: {}
    });
    const final = calculateFinalInstallment({ monthlyPayroll: missingQuantity });

    assert.equal(missingQuantity.blockers[0].code, 'PAYROLL_PIECE_QUANTITY_REQUIRED');
    assert.equal(missingRate.blockers[0].code, 'PAYROLL_PIECE_RATE_REQUIRED');
    assert.deepEqual(directBlockers.map(issue => issue.code).sort(), [
        'PAYROLL_PIECE_QUANTITY_REQUIRED',
        'PAYROLL_PIECE_RATE_REQUIRED'
    ]);
    assert.equal(advance.confirmable, false);
    assert.equal(advance.blockers[0].code, 'PAYROLL_PIECE_QUANTITY_REQUIRED');
    assert.equal(final.confirmable, false);
    assert.equal(final.blockers[0].code, 'PAYROLL_PIECE_QUANTITY_REQUIRED');
});

test('payroll approval blocks open attendance and undefined leave policy', async () => {
    const fakeDb = {
        async query(text) {
            if (/FROM hr_time_records tr/i.test(text)) {
                return {
                    rows: [
                        {
                            id: 1,
                            attendance_ref: 1,
                            staff_id: 7,
                            record_date: '2026-07-14',
                            date: '2026-07-14',
                            status: 'clocked_in',
                            clock_in: '2026-07-14T08:00:00.000Z',
                            clock_out: null,
                            total_worked_minutes: 120
                        },
                        {
                            id: 2,
                            attendance_ref: 2,
                            staff_id: 7,
                            record_date: '2026-07-15',
                            date: '2026-07-15',
                            status: 'sick',
                            clock_in: null,
                            clock_out: null,
                            total_worked_minutes: 0
                        },
                        {
                            id: 3,
                            attendance_ref: 3,
                            staff_id: 7,
                            record_date: '2026-07-12',
                            date: '2026-07-12',
                            status: 'vacation',
                            clock_in: null,
                            clock_out: null,
                            total_worked_minutes: 0
                        },
                        {
                            id: 4,
                            attendance_ref: 4,
                            staff_id: 7,
                            record_date: '2026-07-13',
                            date: '2026-07-13',
                            status: 'day_off',
                            clock_in: null,
                            clock_out: null,
                            total_worked_minutes: 0
                        },
                        {
                            id: 5,
                            attendance_ref: 5,
                            staff_id: 7,
                            record_date: '2026-07-11',
                            date: '2026-07-11',
                            status: 'unpaid',
                            clock_in: null,
                            clock_out: null,
                            total_worked_minutes: 0
                        }
                    ]
                };
            }
            if (/FROM hr_shifts/i.test(text)) return { rows: [] };
            throw new Error(`Unexpected payroll test query: ${text}`);
        }
    };

    const metrics = await loadPayrollAttendanceMetrics({ from: '2026-07-01', to: '2026-07-15' }, fakeDb);
    const issueCodes = (metrics.get(7)?.payrollBlockingIssues || []).map(issue => issue.code).sort();

    assert.deepEqual(issueCodes, [
        'PAYROLL_ATTENDANCE_OPEN',
        'PAYROLL_LEAVE_POLICY_UNDEFINED',
        'PAYROLL_LEAVE_POLICY_UNDEFINED',
        'PAYROLL_LEAVE_POLICY_UNDEFINED',
        'PAYROLL_LEAVE_POLICY_UNDEFINED'
    ]);
});

test('only explicit unpaid_v1 is supported; absent and no_show fail closed', async () => {
    const fakeDb = {
        async query(text) {
            if (/FROM hr_time_records tr/i.test(text)) {
                return {
                    rows: [
                        {
                            id: 11,
                            attendance_ref: 11,
                            staff_id: 8,
                            record_date: '2026-07-10',
                            date: '2026-07-10',
                            status: 'unpaid',
                            planned_start: '09:00',
                            planned_end: '17:00',
                            planned_minutes: 480,
                            total_worked_minutes: 0,
                            compensation_snapshot: { leavePolicy: 'unpaid_v1' }
                        },
                        {
                            id: 12,
                            attendance_ref: 12,
                            staff_id: 8,
                            record_date: '2026-07-11',
                            date: '2026-07-11',
                            status: 'absent',
                            planned_start: '09:00',
                            planned_end: '17:00',
                            planned_minutes: 480,
                            total_worked_minutes: 0
                        },
                        {
                            id: 13,
                            attendance_ref: 13,
                            staff_id: 8,
                            record_date: '2026-07-12',
                            date: '2026-07-12',
                            status: 'no_show',
                            planned_start: '09:00',
                            planned_end: '17:00',
                            planned_minutes: 480,
                            total_worked_minutes: 0,
                            compensation_snapshot: { leavePolicy: 'unpaid_v1' }
                        }
                    ]
                };
            }
            if (/FROM hr_shifts/i.test(text)) return { rows: [] };
            throw new Error(`Unexpected payroll leave-policy query: ${text}`);
        }
    };

    const metrics = (await loadPayrollAttendanceMetrics({ from: '2026-07-01', to: '2026-07-15' }, fakeDb)).get(8);
    assert.equal(metrics.plannedMinutes, 1440);
    assert.equal(metrics.paidPlannedMinutes, 0);
    assert.deepEqual(metrics.payrollBlockingIssues.map(issue => issue.code).sort(), [
        'PAYROLL_LEAVE_POLICY_UNDEFINED',
        'PAYROLL_LEAVE_POLICY_UNSUPPORTED'
    ]);
});

test('final installment subtracts locked advance and keeps unpaid advance outstanding separately', () => {
    const final = calculateFinalInstallment({
        monthlyPayroll: { summary: { net: 30000 } },
        advanceInstallment: { status: 'approved', lockedAmount: 12000, paidAmount: 7000 }
    });

    assert.equal(final.amount, 18000);
    assert.equal(final.advanceOutstandingAmount, 5000);
    assert.equal(final.overpaidAmount, 0);
});

test('final installment equals full monthly net when no advance installment exists', () => {
    const final = calculateFinalInstallment({
        monthlyPayroll: { summary: { net: 30000 } },
        advanceInstallment: null
    });

    assert.equal(final.amount, 30000);
    assert.equal(final.lockedAdvanceAmount, 0);
    assert.equal(final.advanceOutstandingAmount, 0);
});

test('final installment never creates a negative payment when advance is overpaid', () => {
    const final = calculateFinalInstallment({
        monthlyPayroll: { summary: { net: 8000 } },
        advanceInstallment: { status: 'approved', lockedAmount: 10000, paidAmount: 9000 }
    });

    assert.equal(final.amount, 0);
    assert.equal(final.overpaidAmount, 1000);
    assert.equal(final.lockedAdvanceOverMonthlyNetAmount, 2000);
});

test('custom and cross-month ranges are preview-only', () => {
    const custom = calculatePayrollRangePreview({ month: '2026-07', from: '2026-07-01', to: '2026-07-15' });
    const crossMonth = calculatePayrollRangePreview({ month: '2026-12', from: '2026-12-20', to: '2027-01-10' });
    const fullMonth = calculatePayrollRangePreview({ month: '2026-02', from: '2026-02-01', to: '2026-02-28' });

    assert.equal(custom.confirmable, false);
    assert.equal(crossMonth.confirmable, false);
    assert.equal(fullMonth.confirmable, true);
});

test('HR salary route delegates calculation to payroll service and does not own active formula', () => {
    assert.match(hrRoute, /getSalaryReport/);
    assert.match(hrRoute, /getPayrollRangePreview/);
    assert.match(hrRoute, /async function loadPayrollCalculation\(monthValue, db = pool, periodOptions = \{\}\)/);
    const activeBody = hrRoute.slice(
        hrRoute.indexOf('async function loadPayrollCalculation(monthValue'),
        hrRoute.indexOf('async function loadKpiSnapshot')
    );
    assert.doesNotMatch(activeBody, /SUM\(tr\.total_worked_minutes\)/);
    assert.doesNotMatch(activeBody, /FROM salary_adjustments sa/);
    assert.doesNotMatch(activeBody, /LEFT JOIN payroll_reports pr/);
});

test('new HR ZRS writes use zrs and retain legacy advance only as read alias', () => {
    assert.match(hrRoute, /const adjustmentType = normalizePayrollAdjustmentType\(rawType\)/);
    assert.match(hrRoute, /\['bonus', 'kpi_bonus', 'deduction', 'penalty', 'tip', 'zrs'\]/);
    assert.match(hrRoute, /sa\.type IN \('zrs', 'advance'\)/);
    assert.match(payrollService, /zrsAmount: summary\.zrs/);
    assert.match(payrollService, /function normalizePayrollEntryLineType\(value\)/);
    assert.match(payrollService, /if \(type === LEGACY_ZRS_TYPE\) return PAYROLL_ZRS_TYPE/);
    assert.match(hrRoute, /Historical payroll months are read-only; legacy salary\/commit is disabled/);
    assert.doesNotMatch(hrRoute, /operation: 'calculate_draft_legacy_adapter'/);
    assert.doesNotMatch(hrPage, /type:\s*'advance'/);
    assert.match(hrPage, /type:\s*'zrs'/);
});

test('Finance and staff range previews use the canonical payroll service', () => {
    assert.match(payrollRoute, /router\.get\('\/range-preview'/);
    assert.match(payrollRoute, /getPayrollRangePreview/);
    assert.match(staffRoute, /getPayrollRangePreview/);
    assert.doesNotMatch(staffRoute, /FROM bookings[\s\S]*total_minutes/);
});
