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
const staffRouteSource = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'staff.js'),
    'utf8'
);
const payrollProfileSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'hrPayrollProfiles.js'),
    'utf8'
);
const professionsSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'professions.js'),
    'utf8'
);

function sliceBetween(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start);
    return start >= 0 && end > start ? source.slice(start, end) : '';
}

test('payroll staff discovery uses earning-range employment overlap and fails closed', () => {
    const fetchStaffListSource = sliceBetween(
        payrollSource,
        'async function fetchStaffList(month, periodOptions = {}, db = pool) {',
        'function payrollMetricBucket'
    );

    assert.match(fetchStaffListSource, /scheduleableStaffWhere\('s', \{ dateExpression: '\$1' \}\)/);
    assert.match(fetchStaffListSource, /termination_date/);
    assert.match(fetchStaffListSource, /NULLIF\(s\.hire_date::text, ''\)::date <= \$2::date/);
    assert.match(fetchStaffListSource, /NULLIF\(s\.termination_date::text, ''\)::date > \$1::date/);
    assert.match(fetchStaffListSource, /OR NULLIF\(s\.termination_date::text, ''\) IS NOT NULL/);
    assert.match(fetchStaffListSource, /employment-overlap query failed/);
    assert.match(fetchStaffListSource, /throw err;/);
    assert.doesNotMatch(fetchStaffListSource, /FROM hr_shifts hs/);
    assert.doesNotMatch(fetchStaffListSource, /FROM salary_adjustments sa/);
    assert.doesNotMatch(fetchStaffListSource, /FROM payroll_reports pr/);
    assert.doesNotMatch(fetchStaffListSource, /WHERE\s+is_active\s*=\s*true/i);
});

test('legacy staff payroll endpoint also uses the current active core roster', () => {
    const staffPayrollRouteSource = sliceBetween(
        staffRouteSource,
        "router.get('/payroll'",
        'module.exports = router;'
    );

    assert.match(staffPayrollRouteSource, /getPayrollRangePreview\(\{ month, from: mFrom, to: mTo \}, pool\)/);
    assert.match(staffPayrollRouteSource, /source: 'canonical_payroll_service'/);
    assert.match(staffPayrollRouteSource, /deprecatedAdapter: true/);
    assert.match(staffPayrollRouteSource, /defaultMonthEnd/);
    assert.doesNotMatch(staffPayrollRouteSource, /SELECT \* FROM staff WHERE is_active = true/i);
    assert.doesNotMatch(staffPayrollRouteSource, /WHERE\s+is_active\s*=\s*true/i);
});

test('HR salary endpoint uses the same current active core roster filter', () => {
    const loadPayrollCalculationSource = sliceBetween(
        hrRouteSource,
        'async function loadPayrollCalculation(monthValue, db = pool, periodOptions = {}) {',
        'async function loadKpiSnapshot'
    );

    assert.match(loadPayrollCalculationSource, /getSalaryReport\(month, db\)/);
    assert.match(loadPayrollCalculationSource, /getPayrollRangePreview\(\{/);
    assert.match(loadPayrollCalculationSource, /canonicalRows\.map\(hrPayrollRowFromCanonical\)/);
    assert.match(loadPayrollCalculationSource, /preview_mode: !fullMonth/);
    assert.doesNotMatch(loadPayrollCalculationSource, /FROM hr_shifts hs\s*\)\s*WHERE hs\.staff_id = s\.id/);
    assert.doesNotMatch(loadPayrollCalculationSource, /FROM salary_adjustments sa\s*\)\s*WHERE sa\.staff_id = s\.id/);
    assert.doesNotMatch(loadPayrollCalculationSource, /FROM payroll_reports pr\s*\)\s*WHERE pr\.staff_id = s\.id/);
});

test('profession workspace people default to current core staff with explicit inactive opt-in', () => {
    const catalogSource = sliceBetween(
        professionsSource,
        'async function loadProfessionWorkspaceCatalog',
        'const preferencesByAssignment'
    );
    const professionsRouteSource = sliceBetween(
        hrRouteSource,
        "router.get('/professions'",
        "router.post('/professions'"
    );
    const professionWorkspaceRouteSource = sliceBetween(
        hrRouteSource,
        "router.get('/professions/workspace/:identity'",
        "router.put('/professions/:professionKey/staff/:staffId/conditions'"
    );

    assert.match(professionsSource, /const \{ scheduleableStaffWhere \} = require\('\.\/staffOperationalFilters'\);/);
    assert.match(catalogSource, /async function loadProfessionWorkspaceCatalog\(db, options = \{\}\)/);
    assert.match(catalogSource, /includeInactivePeople/);
    assert.match(catalogSource, /peopleWhereClause[\s\S]*scheduleableStaffWhere\('s'\)/);
    assert.match(catalogSource, /\$\{peopleWhereClause\}/);
    assert.match(professionsSource, /async function loadProfessionWorkspace\(db, identity = \{\}, options = \{\}\)/);
    assert.match(professionsRouteSource, /loadProfessionWorkspaceCatalog\(pool, \{ includeInactivePeople \}\)/);
    assert.match(professionsRouteSource, /peopleScope: includeInactivePeople \? 'all' : 'current_core'/);
    assert.match(professionWorkspaceRouteSource, /loadProfessionWorkspace\(pool, identity, \{ includeInactivePeople \}\)/);
});

test('payroll profile usage counts exclude non-current staff', () => {
    assert.match(payrollProfileSource, /const \{ scheduleableStaffWhere \} = require\('\.\/staffOperationalFilters'\);/);
    assert.match(payrollProfileSource, /scheduleableStaffWhere\('s', \{ dateExpression: asOfDateParam \}\)/);
    assert.match(payrollProfileSource, /function activeStaffProfessionCte\(dateExpression = 'CURRENT_DATE'\)/);
    assert.match(payrollProfileSource, /scheduleableStaffWhere\('s', \{ dateExpression \}\)/);
});
