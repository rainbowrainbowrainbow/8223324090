const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

test('staff schedule audit stays read-only and reports schedule risk buckets', () => {
    const script = read('scripts', 'audit-staff-schedule.js');
    const packageJson = JSON.parse(read('package.json'));

    assert.equal(packageJson.scripts['audit:staff-schedule'], 'node scripts/audit-staff-schedule.js');
    assert.match(script, /Staff schedule audit \(read-only\)/);
    assert.match(script, /readOnly:\s*true/);
    assert.match(script, /missing_schedule_audit/);
    assert.match(script, /possible_read_backfill_candidate/);
    assert.match(script, /working_without_hr_shift/);
    assert.match(script, /non_working_with_hr_shift/);
    assert.match(script, /legacy_day_off_status/);
    assert.match(script, /schedule_hr_time_mismatch/);
    assert.match(script, /staff_pool_\$\{String\(row\.hr_pool_status\)\.toLowerCase\(\)\}_in_schedule/);
    assert.match(script, /SELECT ss\.id AS schedule_id/);
    assert.doesNotMatch(script, /\b(UPDATE|DELETE|INSERT|TRUNCATE|DROP|ALTER)\b/i);
});
