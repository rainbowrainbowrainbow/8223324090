const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const hrRouteSource = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'hr.js'),
    'utf8'
);

test('live QA fixture status reads stay sequential for transaction clients', () => {
    const start = hrRouteSource.indexOf('async function loadLiveQaFixtureStatus');
    const end = hrRouteSource.indexOf('async function activeProfessionKeySet', start);
    const helperSource = start >= 0 && end > start
        ? hrRouteSource.slice(start, end)
        : '';

    assert.match(helperSource, /FROM hr_shifts/);
    assert.match(helperSource, /FROM hr_time_records/);
    assert.match(helperSource, /FROM staff_shift_preferences/);
    assert.doesNotMatch(helperSource, /Promise\.all/);
});
