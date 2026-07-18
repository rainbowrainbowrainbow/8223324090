const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const payrollSource = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'payroll.js'),
    'utf8'
);

test('payroll staff discovery uses the canonical hr_shifts schema', () => {
    const start = payrollSource.indexOf('async function fetchStaffList(month) {');
    const end = payrollSource.indexOf('function payrollMetricBucket', start);
    const fetchStaffListSource = start >= 0 && end > start
        ? payrollSource.slice(start, end)
        : '';

    assert.match(fetchStaffListSource, /FROM hr_shifts hs/);
    assert.match(fetchStaffListSource, /hs\.shift_date >= \$2 AND hs\.shift_date <= \$3/);
    assert.doesNotMatch(fetchStaffListSource, /\bhs\.status\b/);
});
