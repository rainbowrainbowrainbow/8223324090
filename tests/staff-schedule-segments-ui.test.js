const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'js', 'staff-page.js'), 'utf8');
const hrPage = fs.readFileSync(path.join(root, 'js', 'hr-page.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'js', 'staff-schedule-shell.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'pages-hr-staff.css'), 'utf8');

test('staff schedule exposes one day status and reusable segment editors', () => {
    assert.match(shell, /<label for="schStatus">Статус дня<\/label>/);
    assert.match(shell, /id="schSegmentsList"/);
    assert.match(shell, /id="schAddSegmentBtn"[^>]*>\+ Додати часовий блок/);
    assert.match(shell, /id="schPrimaryProfession"/);
    assert.match(shell, /id="schPlanSummary"[^>]*aria-live="polite"/);
    assert.match(shell, /id="schNonWorkingWarning"/);
    assert.match(shell, /id="fillSegmentsList"/);
    assert.match(shell, /id="fillAddSegmentBtn"/);
    assert.match(shell, /id="fillPrimaryProfession"/);
    assert.match(shell, /повний шаблон застосовується|Повний шаблон застосовується/);
});

test('segment cards cover role, time, break, note, simultaneous roles and keyboard-safe reorder controls', () => {
    assert.match(page, /data-segment-field="profession"/);
    assert.match(page, /data-segment-field="start"/);
    assert.match(page, /data-segment-field="end"/);
    assert.match(page, /data-segment-field="break"/);
    assert.match(page, /data-segment-field="note"/);
    assert.match(page, /data-segment-field="additional"/);
    assert.match(page, /data-segment-action="up"/);
    assert.match(page, /data-segment-action="down"/);
    assert.match(page, /data-segment-action="remove"/);
    assert.match(page, /Максимум \$\{STAFF_SCHEDULE_MAX_SEGMENTS\} блоків на день/);
});

test('client validation blocks invalid and overlapping paid plans before save', () => {
    assert.match(page, /function validateSchedulePlan/);
    assert.match(page, /початок і завершення не можуть збігатися/);
    assert.match(page, /перерва має бути коротшою за тривалість блоку/);
    assert.match(page, /Нічний блок без day offsets можна зберігати лише як єдиний блок дня/);
    assert.match(page, /current\.startMinutes < previous\.endMinutes/);
    assert.match(page, /перетинаються/);
    assert.match(page, /qualifiedStaff\.some\(staff => !staffHasProfession\(staff, role\)\)/);
    assert.match(page, /Основна роль дня має бути основною професією одного з блоків/);
    assert.match(page, /saveButton\.disabled = pending \|\| readOnly \|\| !validation\.valid/);
});

test('single and fill-week saves send the normalized segment contract', () => {
    assert.match(page, /payload\.segments = dayPlan\.segments/);
    assert.match(page, /payload\.primaryProfessionKey = dayPlan\.primaryProfessionKey/);
    assert.match(page, /segments:\s*validation\.segments\.map/);
    assert.match(page, /primaryProfessionKey:\s*professionKey/);
    assert.match(page, /segments:\s*segmentTemplate\.map/);
    assert.match(page, /_staffFillMutationPending = true/);
    assert.match(page, /finally\s*\{[\s\S]*_staffFillMutationPending = false/);
});

test('legacy HR shift modal cannot flatten a multi-segment plan and links to the canonical editor', () => {
    assert.match(hrPage, /legacyHrShiftHasMultipleSegments/);
    assert.match(hrPage, /compatibility envelope/);
    assert.match(hrPage, /Редагування тут вимкнено, щоб не втратити блоки/);
    assert.match(hrPage, /openCanonicalShiftDayPlan/);
    assert.match(hrPage, /StaffSchedulePage\?\.openDayPlan/);
    assert.match(hrPage, /Multi-segment план можна редагувати лише у «Графіку команди»/);
    assert.match(page, /openDayPlan: openScheduleDayPlan/);
});

test('single save keeps an optimistic plan version and handles stale conflicts without closing the modal', () => {
    assert.match(page, /planUpdatedAt: scheduleEntryPlanUpdatedAt\(entry\)/);
    assert.match(page, /expectedUpdatedAt: editingSession\.planUpdatedAt/);
    assert.match(page, /HR_SHIFT_PLAN_STALE/);
    assert.match(page, /Ваші поля не перезаписані/);
    assert.match(page, /Оновити з сервера/);
    assert.match(page, /Залишити мої дані/);
    assert.match(page, /if \(shouldRefresh && scheduleModalSessionIsCurrent\(editingSession\)\)/);
    assert.match(page, /await refreshStaleScheduleModalPlan\(editingSession\)/);
});

test('cells, role sections, export and print use segments instead of envelope duration', () => {
    assert.match(page, /segments\.slice\(0, 2\)|displaySegments\.slice\(0, 2\)/);
    assert.match(page, /sch-segment-more/);
    assert.match(page, /sch-month-summary/);
    assert.match(page, /segment\.additionalProfessionKeys\.includes\(normalizedSectionProfession\)/);
    assert.match(page, /function scheduleExportCell/);
    assert.match(page, /schedulePlanMetrics\(segments\)\.plannedMinutes/);
    assert.match(page, /Разом: \$\{formatScheduleMinutes/);
    assert.match(page, /buildScheduleWorkbookHtml\(\{ print: true \}\)/);
});

test('segment editor keeps dark and 320-390px layouts explicit', () => {
    assert.match(css, /\.sch-segment-card\.is-active/);
    assert.match(css, /\.sch-plan-summary\.has-error/);
    assert.match(css, /body\.dark-mode \.sch-segment-card/);
    assert.match(css, /@media \(max-width: 390px\)/);
    assert.match(css, /#schModalOverlay \.sch-modal--schedule/);
    assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test('schedule health and forecast use segment roles and time windows', () => {
    assert.match(page, /code: 'overlapping_segments'/);
    assert.match(page, /code: 'long_segment'/);
    assert.match(page, /code: 'long_total_day'/);
    assert.match(page, /code: 'booking_outside_availability'/);
    assert.match(page, /scheduleHealthSegmentRoles\(segment\)/);
    assert.match(page, /function staffingForecastScheduledCounts\(date, staffList = \[\], atMinutes = null\)/);
    assert.match(page, /coverageSlots/);
    assert.match(page, /bookings_timeline_windows_v2/);
});
