const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const payrollSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'payroll.js'),
    'utf8'
);
const hrRouteSource = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'hr.js'),
    'utf8'
);
const payrollProfileSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'hrPayrollProfiles.js'),
    'utf8'
);

function sliceBetween(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start);
    return start >= 0 && end > start ? source.slice(start, end) : '';
}

test('payroll staff discovery uses the current active core roster', () => {
    const fetchStaffListSource = sliceBetween(
        payrollSource,
        'async function fetchStaffList(month) {',
        'function payrollMetricBucket'
    );

    assert.match(fetchStaffListSource, /scheduleableStaffWhere\('s', \{ dateExpression: '\$1' \}\)/);
    assert.doesNotMatch(fetchStaffListSource, /FROM hr_shifts hs/);
    assert.doesNotMatch(fetchStaffListSource, /FROM salary_adjustments sa/);
    assert.doesNotMatch(fetchStaffListSource, /FROM payroll_reports pr/);
});

test('HR salary endpoint uses the same current active core roster filter', () => {
    const loadPayrollCalculationSource = sliceBetween(
        hrRouteSource,
        'async function loadPayrollCalculation(monthValue, db = pool, periodOptions = {}) {',
        'async function loadKpiSnapshot'
    );

    assert.match(loadPayrollCalculationSource, /scheduleableStaffWhere\('s', \{ dateExpression: 'p\.date_to' \}\)/);
    assert.doesNotMatch(loadPayrollCalculationSource, /FROM hr_shifts hs\s*\)\s*WHERE hs\.staff_id = s\.id/);
    assert.doesNotMatch(loadPayrollCalculationSource, /FROM salary_adjustments sa\s*\)\s*WHERE sa\.staff_id = s\.id/);
    assert.doesNotMatch(loadPayrollCalculationSource, /FROM payroll_reports pr\s*\)\s*WHERE pr\.staff_id = s\.id/);
});

test('payroll profile usage counts exclude non-current staff', () => {
    assert.match(payrollProfileSource, /const \{ scheduleableStaffWhere \} = require\('\.\/staffOperationalFilters'\);/);
    assert.match(payrollProfileSource, /scheduleableStaffWhere\('s', \{ dateExpression: asOfDateParam \}\)/);
    assert.match(payrollProfileSource, /function activeStaffProfessionCte\(dateExpression = 'CURRENT_DATE'\)/);
    assert.match(payrollProfileSource, /scheduleableStaffWhere\('s', \{ dateExpression \}\)/);
});
