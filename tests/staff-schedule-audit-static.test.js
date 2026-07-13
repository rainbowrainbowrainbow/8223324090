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
    assert.match(script, /blacklisted_staff_in_schedule/);
    assert.match(script, /reserve_staff_in_schedule/);
    assert.match(script, /terminated_staff_in_schedule/);
    assert.match(script, /freelance_without_explicit_mode/);
    assert.match(script, /active_profile_for_inactive_staff/);
    assert.match(script, /active_user_for_offboarded_staff/);
    assert.match(script, /generated_timeline_lines_for_invalid_staff/);
    assert.match(script, /auditHrShifts/);
    assert.match(script, /auditEmployeeProfiles/);
    assert.match(script, /auditUsers/);
    assert.match(script, /auditGeneratedLines/);
    assert.match(script, /buckets:\s*\{/);
    assert.match(script, /SELECT ss\.id AS schedule_id/);
    assert.match(script, /const riskSql = staffRiskSql\(staffColumns, 's', '\$1'\);/);
    assert.match(script, /\$1::date AS date/);
    assert.doesNotMatch(script, /staffRiskSql\(staffColumns, 's', '\$2'\)/);
    assert.doesNotMatch(script, /\b(UPDATE|DELETE|INSERT|TRUNCATE|DROP|ALTER)\b/i);
});

test('staff schedule cleanup is dry-run guarded and preserves protected rows', () => {
    const script = read('scripts', 'cleanup-staff-schedule.js');

    assert.match(script, /CONFIRM_TOKEN = 'I_CONFIRM_FUTURE_STAFF_SCHEDULE_CLEANUP'/);
    assert.match(script, /const APPLY = flags\.has\('--apply'\)/);
    assert.match(script, /if \(APPLY && CONFIRM !== CONFIRM_TOKEN\)/);
    assert.match(script, /mode: APPLY \? 'apply' : 'dry-run'/);
    assert.match(script, /apply: APPLY/);
    assert.match(script, /const EFFECTIVE_FROM = maxIsoDate\(FROM, isoDate\(new Date\(\)\)\)/);
    assert.match(script, /BEGIN/);
    assert.match(script, /COMMIT/);
    assert.match(script, /ROLLBACK/);
    assert.match(script, /DELETE FROM staff_schedule ss/);
    assert.match(script, /DELETE FROM hr_shifts hs/);
    assert.match(script, /DELETE FROM lines_by_date l/);
    assert.match(script, /NOT EXISTS \(\s*SELECT 1\s+FROM hr_time_records tr/);
    assert.match(script, /hr_time_records table is required for safe cleanup/);
    assert.match(script, /canTraceGeneratedLines/);
    assert.match(script, /bookings\/from_sheet trace columns/);
    assert.doesNotMatch(script, /\b(TRUNCATE|DROP|ALTER)\b/i);
});

test('active schedule read paths use the shared scheduleable staff filter', () => {
    const filters = read('services', 'staffOperationalFilters.js');
    const staffRoute = read('routes', 'staff.js');
    const hrRoute = read('routes', 'hr.js');
    const bookingService = read('services', 'booking.js');
    const bookingsRoute = read('routes', 'bookings.js');
    const linesRoute = read('routes', 'lines.js');

    assert.match(filters, /function scheduleableStaffWhere/);
    assert.match(filters, /poolMode: 'core'/);
    assert.match(filters, /COALESCE\(\$\{safeAlias\}\.hr_pool_status, 'core'\) = 'core'/);
    assert.match(filters, /COALESCE\(\$\{safeAlias\}\.is_freelance, false\) = false/);
    assert.match(filters, /termination_date/);

    assert.match(staffRoute, /function activeScheduleStaffWhere/);
    assert.match(staffRoute, /scheduleableStaffWhere\(alias/);
    assert.match(staffRoute, /activeScheduleStaffWhere\('s', 'ss\.date'\)/);
    assert.match(staffRoute, /activeScheduleStaffWhere\('staff', 'CURRENT_DATE'/);

    assert.match(hrRoute, /scheduleableStaffWhere\('staff', \{\s*includeFreelance: include_freelance === 'true'/);
    assert.match(hrRoute, /scheduleableStaffWhere\('s', \{ dateExpression: 'hs\.shift_date' \}\)/);
    assert.match(hrRoute, /scheduleableStaffWhere\('s', \{ dateExpression: "LEFT\(ss\.date::text, 10\)" \}\)/);
    assert.match(hrRoute, /scheduleableStaffWhere\('staff', \{ dateExpression: '\$1' \}\)/);
    assert.doesNotMatch(hrRoute, /COALESCE\(hr_pool_status, 'core'\) <> 'reserve'[\s\S]{0,120}OR EXISTS \(SELECT 1 FROM hr_shifts/);

    assert.match(bookingService, /scheduleableStaffWhere\('s', \{ dateExpression: 'ss\.date' \}\)/);
    assert.doesNotMatch(bookingService, /FROM staff_schedule ss[\s\S]{0,240}AND s\.is_active = true/);
    assert.match(bookingsRoute, /scheduleableStaffWhere\('s', \{ dateExpression: '\$3' \}\)/);
    assert.match(bookingsRoute, /scheduleableStaffWhere\('staff', \{ dateExpression: '\$2' \}\)/);
    assert.match(linesRoute, /scheduleableStaffWhere\('s', \{ dateExpression: 'l\.date' \}\)/);
});

test('schedule write paths reject non-scheduleable staff before writes and mirrors', () => {
    const filters = read('services', 'staffOperationalFilters.js');
    const staffRoute = read('routes', 'staff.js');
    const hrRoute = read('routes', 'hr.js');

    assert.match(filters, /async function validateStaffScheduleableForDate/);
    assert.match(filters, /function scheduleableStaffErrorPayload/);
    assert.match(filters, /STAFF_INACTIVE/);
    assert.match(filters, /STAFF_BLACKLISTED/);
    assert.match(filters, /STAFF_NOT_CORE_POOL/);
    assert.match(filters, /STAFF_FREELANCE_NOT_ALLOWED/);
    assert.match(filters, /STAFF_TERMINATED/);

    assert.match(staffRoute, /async function validateScheduleWriteStaff/);
    assert.match(staffRoute, /async function rejectUnscheduleableStaff/);
    assert.match(staffRoute, /validateScheduleWriteStaff\(client, staffId, date\)/);
    assert.match(staffRoute, /validateScheduleWriteStaff\(client, e\.staffId, e\.date\)/);
    assert.match(staffRoute, /validateScheduleWriteStaff\(client, row\.staff_id, targetDate\)/);
    assert.match(staffRoute, /validateScheduleWriteStaff\(client, replacementStaffId, date\)/);
    assert.match(staffRoute, /validateScheduleWriteStaff\(client, originalStaffId, date\)/);
    assert.match(staffRoute, /validateStaffScheduleableForDate\(client, shift\.staff_id, date, \{ forUpdate: false \}\)/);
    assert.match(staffRoute, /activeScheduleStaffWhere\('s', 'hs\.shift_date'\)/);
    assert.doesNotMatch(staffRoute, /backfillStaffScheduleFromHrShifts[\s\S]{0,800}COALESCE\(s\.is_active, true\) = true/);

    assert.match(hrRoute, /async function validateShiftWriteStaff/);
    assert.match(hrRoute, /validateShiftWriteStaff\(client, staff_id, shift_date\)/);
    assert.match(hrRoute, /validateShiftWriteStaff\(client, currentShift\.staff_id, currentShift\.shift_date\)/);
    assert.match(hrRoute, /validateShiftWriteStaff\(client, replacementStaffId, oldShift\.shift_date\)/);
    assert.match(hrRoute, /validateShiftWriteStaff\(client, sid, d\)/);
    assert.match(hrRoute, /validateShiftWriteStaff\(client, row\.staff_id, targetDate\)/);
    assert.match(hrRoute, /validateStaffScheduleableForDate\(db, shift\.staff_id, date, \{ forUpdate: false \}\)/);
    assert.match(hrRoute, /scheduleableStaffWhere\('s', \{ dateExpression: 'hs\.shift_date' \}\)/);
});

test('staff lifecycle cleanup is centralized and preserves historical evidence', () => {
    const lifecycle = read('services', 'staffLifecycle.js');
    const staffRoute = read('routes', 'staff.js');
    const hrRoute = read('routes', 'hr.js');

    assert.match(lifecycle, /async function cleanupFutureStaffOperationalSchedule/);
    assert.match(lifecycle, /DELETE FROM hr_shifts hs/);
    assert.match(lifecycle, /hs\.shift_date >= \$2::date/);
    assert.match(lifecycle, /DELETE FROM staff_schedule ss/);
    assert.match(lifecycle, /LEFT\(ss\.date::text, 10\) >= \$2/);
    assert.match(lifecycle, /NOT EXISTS \(\s*SELECT 1 FROM hr_time_records tr/);
    assert.match(lifecycle, /syncLinkedStaffAccountDeactivation/);
    assert.match(lifecycle, /UPDATE employee_profiles\s+SET is_active = false/);
    assert.match(lifecycle, /UPDATE users\s+SET is_active = false,\s+session_revoked_at = NOW\(\)/);
    assert.match(lifecycle, /UPDATE refresh_tokens\s+SET revoked_at = NOW\(\)/);

    assert.doesNotMatch(staffRoute, /async function cleanupFutureStaffOperationalSchedule/);
    assert.doesNotMatch(hrRoute, /async function cleanupFutureStaffOperationalSchedule/);

    assert.match(staffRoute, /cleanupFutureStaffOperationalSchedule\(client, req\.params\.id, getKyivDateStr\(\)\)/);
    assert.match(staffRoute, /syncLinkedStaffAccountDeactivation\(client, req\.params\.id/);
    assert.match(staffRoute, /reason: 'staff_deactivation'/);
    assert.match(staffRoute, /reason: 'staff_archive'/);

    assert.match(hrRoute, /cleanupFutureStaffOperationalSchedule\(client, req\.params\.id, todayKyiv\(\)\)/);
    assert.match(hrRoute, /reason: 'hr_staff_deactivation'/);
    assert.match(hrRoute, /reason: 'hr_offboarding'/);
    assert.match(hrRoute, /\['blacklisted', 'reserve'\]\.includes\(status\)/);
    assert.match(hrRoute, /\['blacklisted', 'reserve'\]\.includes\(requestedPoolStatus\)/);
    assert.match(hrRoute, /account_deactivation: accountDeactivation/);
});

test('live staff schedule write smoke is explicit QA-only and restorative', () => {
    const script = read('scripts', 'live-staff-schedule-write-smoke.js');
    const packageJson = JSON.parse(read('package.json'));

    assert.equal(
        packageJson.scripts['smoke:staff-schedule:write'],
        'npx --yes --package playwright node scripts/live-staff-schedule-write-smoke.js'
    );
    assert.match(script, /I_CONFIRM_STAFF_SCHEDULE_QA_WRITES/);
    assert.match(script, /LIVE_STAFF_SCHEDULE_QA_STAFF_ID/);
    assert.match(script, /LIVE_STAFF_SCHEDULE_QA_DATE/);
    assert.match(script, /LIVE_STAFF_SCHEDULE_QA_REPLACEMENT_STAFF_ID/);
    assert.match(script, /LIVE_STAFF_SCHEDULE_ALLOW_NON_QA_STAFF/);
    assert.match(script, /assertQaStaff/);
    assert.match(script, /existing schedule entry is required for safe restore/);
    assert.match(script, /finally/);
    assert.match(script, /putSchedule\(base, session\.token, previousPayload\)/);
    assert.match(script, /\/api\/staff\/schedule\/\$\{currentOriginal\.id\}\/replace/);
    assert.match(script, /\/api\/staff\/schedule\/\$\{replacementAfterReplace\.id\}\/replacement-clear/);
    assert.match(script, /async function clearActiveReplacementIfPresent/);
    assert.match(script, /clearActiveReplacementIfPresent\(base, session\.token, QA_REPLACEMENT_STAFF_ID, QA_DATE\)/);
    assert.match(script, /dryRun:\s*true/);
    assert.match(script, /\/api\/staff\/attendance\?from=/);
    assert.match(script, /after-ui-save\.png/);
    assert.doesNotMatch(script, /process\.env\.DATABASE_URL\s*=/);
    assert.doesNotMatch(script, /\b(TRUNCATE|DROP|ALTER)\b/i);
});

test('staff schedule release verification stays standalone, complete, and read-only', () => {
    const packageJson = JSON.parse(read('package.json'));
    const script = read('scripts', 'staff-schedule-release-verify.js');

    assert.equal(
        packageJson.scripts['test:staff-schedule'],
        'node --test tests/staff-schedule-history-static.test.js tests/staff-schedule-audit-static.test.js'
    );
    assert.equal(
        packageJson.scripts['test:browser:staff-schedule'],
        'npx --yes --package playwright node tests/browser/staff-schedule-custom-range-browser-smoke.js'
    );
    assert.equal(
        packageJson.scripts['release:staff-schedule:verify'],
        'node scripts/staff-schedule-release-verify.js'
    );
    for (const focusedTest of [
        'tests/staff-schedule-history-static.test.js',
        'tests/staff-schedule-audit-static.test.js'
    ]) {
        assert.match(packageJson.scripts['test:unit'], new RegExp(focusedTest.replaceAll('.', '\\.')));
    }

    assert.match(script, /normalizeLiveUrl\(/);
    assert.match(script, /provide a valid http\(s\) URL argument/);
    assert.match(script, /runStep\('runtime baseline', \['run', 'check:runtime'\]\)/);
    assert.match(script, /runStep\('focused deterministic contracts', \['run', 'test:staff-schedule'\]\)/);
    assert.match(script, /runStep\('full fast CI-equivalent baseline', \['test'\]\)/);
    assert.match(script, /runStep\('local Playwright regression smoke', \['run', 'test:browser:staff-schedule'\]\)/);
    assert.match(script, /runStep\('deployed read-only Staff Schedule smoke', \['run', 'smoke:staff-schedule', '--', liveUrl\]\)/);
    assert.match(script, /runStep\('deployed version contract', \['run', 'version:smoke', '--', liveUrl\]\)/);
    assert.doesNotMatch(script, /smoke:staff-schedule:write/);
    assert.doesNotMatch(script, /\.github[\\/]workflows|scripts[\\/]release-gate|release-gate\.js/);
    assert.doesNotMatch(packageJson.scripts.verify, /release:staff-schedule:verify/);
});
