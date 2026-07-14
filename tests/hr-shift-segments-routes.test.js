'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const hrRoute = read('routes', 'hr.js');
const staffRoute = read('routes', 'staff.js');
const service = read('services', 'hrShiftSegments.js');
const staffScheduleMutations = read('services', 'staffScheduleMutations.js');

test('HR and Staff routes delegate canonical HR-shift writes to the shared service', () => {
    for (const route of [hrRoute]) {
        assert.match(route, /require\('\.\.\/services\/hrShiftSegments'\)/);
        assert.match(route, /saveHrShiftDayPlan\(client/);
        assert.match(route, /hrShiftPlanErrorPayload/);
        assert.doesNotMatch(route, /INSERT INTO hr_shifts/);
        assert.doesNotMatch(route, /DELETE FROM hr_shift_segments/);
    }

    assert.match(staffRoute, /require\('\.\.\/services\/staffScheduleMutations'\)/);
    assert.match(staffScheduleMutations, /require\('\.\/hrShiftSegments'\)/);
    assert.match(staffScheduleMutations, /saveHrShiftDayPlan\(client/);
    assert.doesNotMatch(staffScheduleMutations, /client\.query\('BEGIN'\)|client\.query\('COMMIT'\)/);

    assert.match(service, /SELECT \* FROM hr_shifts WHERE id = \$1 FOR UPDATE/);
    assert.match(service, /DELETE FROM hr_shift_segments WHERE hr_shift_id = \$1/);
    assert.match(service, /INSERT INTO hr_shift_segments/);
    assert.match(service, /INSERT INTO hr_shift_segment_roles/);
});

test('all multi-write route flows retain explicit transaction ownership', () => {
    assert.match(hrRoute, /router\.post\('\/shifts'[^]*?await client\.query\('BEGIN'\)[^]*?saveHrShiftDayPlan\(client[^]*?await client\.query\('COMMIT'\)/);
    assert.match(hrRoute, /router\.put\('\/shifts\/:id'[^]*?await client\.query\('BEGIN'\)[^]*?saveHrShiftDayPlan\(client[^]*?await client\.query\('COMMIT'\)/);
    assert.match(staffRoute, /router\.put\('\/schedule'[^]*?await client\.query\('BEGIN'\)[^]*?mutateStaffScheduleEntry\(client[^]*?await client\.query\('COMMIT'\)/);
    assert.match(staffRoute, /router\.post\('\/schedule\/bulk'[^]*?await client\.query\('BEGIN'\)[^]*?mutateStaffScheduleEntry\(client[^]*?await client\.query\('COMMIT'\)/);
});

test('legacy read-side backfill refreshes eligible rows under ordered staff locks', () => {
    assert.match(hrRoute, /async function backfillHrShiftsFromStaffSchedule[^]*?lockHrShiftStaffRows\(client, candidateStaffIds\)[^]*?const freshSource = await client\.query/);
    assert.match(hrRoute, /const freshSource = await client\.query\([^]*?ss\.staff_id = ANY\(\$3::int\[\]\)[^]*?for \(const row of freshSource\.rows\)/);
    assert.match(hrRoute, /for \(const row of freshSource\.rows\)[^]*?SELECT id FROM hr_shifts WHERE staff_id = \$1 AND shift_date = \$2[^]*?if \(alreadyCreated\.rows\.length\) continue/);
});

test('read and copy flows preserve ordered segments and simultaneous roles', () => {
    assert.match(hrRoute, /hydrateHrShiftDayPlans\(db, rows\)/);
    assert.match(staffRoute, /attachScheduleDayPlans\(result\.rows\)/);
    assert.match(staffRoute, /additionalProfessionKeys: \[\.\.\.\(segment\.additionalProfessionKeys \|\| \[\]\)\]/);
    assert.match(hrRoute, /payload: dayPlanPayload\(loaded\.plan/);
    assert.match(staffRoute, /const sourcePlanPayload = copyableDayPlanPayload\(loadedSourcePlan\)/);
    assert.match(service, /to_jsonb\(hs\) AS shift_row/);
    assert.match(service, /ORDER BY hs\.id, hss\.sort_order, hss\.id/);
    assert.match(staffRoute, /router\.get\('\/schedule\/hours'[^]*?attachScheduleDayPlans\(result\.rows\)[^]*?row\.plannedMinutes/);
});

test('Staff schedule GET aggregates segments without multiplying parent rows and exposes compatibility aliases', () => {
    assert.match(staffRoute, /router\.get\('\/schedule'[^]*?jsonb_build_object\([^]*?AS hr_segments/);
    assert.match(staffRoute, /SELECT jsonb_agg\(hssr\.profession_key ORDER BY hssr\.profession_key\)/);
    assert.match(staffRoute, /ORDER BY hss\.sort_order, hss\.id/);
    assert.match(staffRoute, /function planFromAggregatedScheduleRow/);
    assert.match(staffRoute, /primary_profession_key: primaryProfessionKey/);
    assert.match(staffRoute, /profession_keys: professionKeys/);
    assert.match(staffRoute, /planned_minutes: plannedMinutes/);
    assert.match(staffRoute, /shift_start: plannedStart/);
    assert.match(staffRoute, /shift_end: plannedEnd/);
});

test('replacement validates every plan profession before moving the parent shift', () => {
    assert.match(hrRoute, /validateHrShiftDayPlanProfessions\(client, replacementStaffId, loaded\.plan\)/);
    assert.match(staffRoute, /validateHrShiftDayPlanProfessions\(client, replacementStaffId, sourcePlan\.plan\)/);
    assert.match(staffRoute, /validateHrShiftDayPlanProfessions\(client, originalStaffId, currentPlan\.plan\)/);
});

test('non-working HR plans remain persisted in the legacy staff schedule', () => {
    assert.match(hrRoute, /async function mirrorHrDayPlanToStaffSchedule/);
    assert.match(hrRoute, /\['dayoff', 'vacation', 'sick'\]\.includes\(status\)/);
    assert.match(hrRoute, /VALUES \(\$1, \$2, NULL, NULL, \$3, \$4, NULL\)/);
    assert.match(hrRoute, /router\.post\('\/shifts'[^]*?mirrorHrDayPlanToStaffSchedule\(/);
    assert.match(hrRoute, /router\.put\('\/shifts\/:id'[^]*?mirrorHrDayPlanToStaffSchedule\(/);
});

test('Staff schedule audit includes normalized segment-plan changes', () => {
    assert.match(staffScheduleMutations, /function normalizeScheduleAuditPlan/);
    assert.match(staffScheduleMutations, /changes\.dayPlan = \{ from: beforePlan, to: afterPlan \}/);
    assert.match(staffScheduleMutations, /function schedulePlanAuditChanges/);
    assert.match(staffScheduleMutations, /'segmentTimes'/);
    assert.match(staffScheduleMutations, /'segmentProfessions'/);
    assert.match(staffScheduleMutations, /'segmentAdditionalRoles'/);
    assert.match(staffScheduleMutations, /'segmentBreaks'/);
    assert.match(staffScheduleMutations, /beforePlan: previousPlan\?\.plan \|\| null/);
    assert.match(staffScheduleMutations, /afterPlan: hrSync\.plan/);
    assert.match(staffRoute, /staff_schedule_replacement_removed'[^]*?beforePlan: sourcePlan\.plan[^]*?afterPlan: null/);
    assert.match(staffRoute, /staff_schedule_replacement_set'[^]*?beforePlan: null[^]*?afterPlan: sourcePlan\.plan/);
    assert.match(hrRoute, /before_plan: auditHrDayPlan\(lockedCurrent\.plan\)/);
    assert.match(hrRoute, /shift_bulk'[^]*?entries: auditEntries/);
    assert.match(hrRoute, /shift_copy_week'[^]*?entries: auditEntries/);
});

test('schedule Telegram notifications render all segment blocks in one message', () => {
    assert.match(staffRoute, /function scheduleNotificationBlocks/);
    assert.match(staffRoute, /segment\.shiftStart[^]*?segment\.shiftEnd[^]*?segment\.professionKey/);
    assert.match(staffRoute, /additionalProfessionKeys/);
    assert.match(staffRoute, /const timeInfo = blocks\.length \? `\\n⏱ \$\{blocks\.join\('\\n⏱ '\)\}` : ''/);
    assert.match(staffRoute, /notifyScheduleChange\(staffId, date,[^]*?mutation\.plan\)/);
    assert.match(staffRoute, /notifyBulkScheduleChange\(affectedStaff, count, notificationChanges\)/);
});

test('schedule writers acquire staff locks in stable order before parent and mirror rows', () => {
    for (const route of [hrRoute, staffScheduleMutations]) {
        assert.match(route, /WHERE id = ANY\(\$1::int\[\]\)[^]*?ORDER BY id[^]*?FOR UPDATE/);
    }
    assert.match(staffRoute, /lockScheduleStaffRows\(client, orderedEntries\.map\(entry => entry\.staffId\)\)/);
    assert.match(hrRoute, /lockHrShiftStaffRows\(client, orderedStaffIds\)/);
    assert.match(hrRoute, /router\.delete\('\/shifts\/:id'[^]*?SELECT \* FROM hr_shifts WHERE id = \$1[^]*?lockHrShiftStaffRows[^]*?SELECT \* FROM hr_shifts WHERE id = \$1 FOR UPDATE/);
    assert.match(staffScheduleMutations, /syncHrShiftFromScheduleEntry\(client[^]*?loadScheduleEntryForUpdate\(client, staffId, date\)/);
});

test('replacement and direct HR mutation routes reject stale owner snapshots', () => {
    assert.match(staffRoute, /router\.post\('\/schedule\/:id\/replace'[^]*?lockScheduleStaffRows[^]*?const freshScheduleResult = await client\.query[^]*?loadHrShiftDayPlan\(client[^]*?FOR UPDATE/);
    assert.match(staffRoute, /router\.post\('\/schedule\/:id\/replacement-clear'[^]*?lockScheduleStaffRows[^]*?const freshScheduleResult = await client\.query[^]*?currentPlan\.shift\.original_staff_id[^]*?FOR UPDATE/);
    assert.match(hrRoute, /router\.put\('\/shifts\/:id'[^]*?validateShiftWriteStaff[^]*?loadHrShiftDayPlan\(client, \{ hrShiftId: req\.params\.id \}, \{ forUpdate: true \}\)[^]*?lockedCurrent\.shift\.staff_id[^]*?observedShift\.staff_id/);
    assert.match(hrRoute, /router\.delete\('\/shifts\/:id'[^]*?lockHrShiftStaffRows[^]*?FOR UPDATE[^]*?existing\.rows\[0\]\.staff_id[^]*?observed\.rows\[0\]\.staff_id/);
});

test('copy-week write paths refresh source rows after ordered staff locks', () => {
    assert.match(hrRoute, /router\.post\('\/shifts\/copy-week'[^]*?lockHrShiftStaffRows\(client, sourceStaffIds\)[^]*?const freshSource = await client\.query[^]*?lockedStaffIds[^]*?freshSource\.rows\.some[^]*?for \(const row of freshSourceRows\)/);
    assert.match(staffRoute, /router\.post\('\/schedule\/copy-week'[^]*?lockScheduleStaffRows\(client, sourceStaffIds\)[^]*?const freshSource = await client\.query[^]*?lockedStaffIds[^]*?freshSource\.rows\.some[^]*?for \(const row of freshSourceRows\)/);
});

test('HR mirrors preserve the PostgreSQL calendar date in Europe/Kyiv', () => {
    const helper = hrRoute.match(/function toDateOnly\(value\) \{[^]*?\n\}/)?.[0] || '';
    assert.match(helper, /value\.getFullYear\(\)/);
    assert.match(helper, /value\.getMonth\(\) \+ 1/);
    assert.match(helper, /value\.getDate\(\)/);
    assert.doesNotMatch(helper, /toISOString\(\)/);
    assert.match(hrRoute, /const sourceDate = toDateOnly\(row\.shift_date\)/);
});
