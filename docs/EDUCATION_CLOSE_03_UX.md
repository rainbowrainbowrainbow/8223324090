# EDU-CLOSE-03 — canonical education presentation

Production impact: yes. Historical CLOSE03 checkpoint. Local changes are present; interrupted late attempts are INCOMPLETE. Fresh CLOSE04 results and remaining blockers are in docs/EDUCATION_CLOSE_04_TEST_MATRIX.md.

## Bug report before edits
- Symptom: five vertical tabs consume the phone viewport; edit uses booking language, empty activity summary and zero-money total; canonical card repeats date/time/group/room/topic and shows a decorative image.
- Expected: compact accessible navigation and education wording; real program descriptions/prices remain available; one ordered canonical lesson summary.
- Actual: fresh desktop light/dark and320px phone screenshots confirm inherited presentation. Existing mobile checks pass layout but do not assert compactness or education wording.
- Reproduction: owned realistic fixed seed -> Today -> canonical card -> visible Edit; Groups/Attendance/Reports/Schedule at320px.
- Root cause: final max420px CSS forces one-column tabs; shared edit/ready/summary labels lack education branches; generic card rows and lesson helper both render the same fields.
- Verification: source-bound actual Express/PostgreSQL captures, independent assertions, navigation/focus, contrast, draft/error, Park and protected guards.

## Protected blocker identified before edits
BLOCKED_PROTECTED_PRESENTATION: js/booking.js booking-detail-safe-open (bookingDetailSafeRender through selectedBanquetCandidateRole; hash83e482b5a8f4776e770bd86df7effd7485ea5e7a3eb1fa1284349bb10b7aaf0d). Header metadata and direct date/time/room/scenario/group rows are inside this hashed block. Removing duplicate rows cleanly requires an education-only condition there. This task does not authorize a manifest update. No positional CSS, DOM rewrite or alternate renderer will evade the guard.
Future bounded approval needed: education header metadata/duplicate row presentation in showBookingDetails; focused education/Park UI regression; unchanged identity/detail sources/source priorities/ownership.
Safe work: forms/summary/promo affordances, local navigation/image CSS.

## Before evidence
- output/education-ready/close03/before/before-visual-2026-10-04T17-52-46-757Z.
- output/education-ready/close03/before-phone/baseline-chromium-2026-10-04T17-54-08-439Z.
- Retained datasets39 bookings each;1542 historical evidence files unchanged.

## Additional defect found by personal screenshot review (before reveal fix)
- Symptom: WebKit desktop1440 and tablet/reflow Schedule snapshots show a28px strip rather than the actual lessons; phone max480px has a protective minimum height.
- Expected: a usable scroll viewport containing the first lesson row; actual visible content must be asserted independently of DOM presence.
- Actual: timeline container28px; timeline scroll client22px/scroll324px; first lesson y276 while container spans y221–249. Playwright isVisible alone passes for this clipped descendant.
- Root cause: shared animator auto-fit computes --timeline-content-height while education hides the schedule. setView reveals it without requesting the existing height synchronization. The shared CSS then caps height using the stale hidden measurement.
- Diagnostic: layout-diagnostic keeps original geometry and a temporary style probe. The style probe itself did not change effective flex; the delayed shared remeasurement recovered324px. It is diagnostic evidence, not a product fix or completed functional journey.
- Stronger baseline: layout-baseline asserts real container height and calls syncTimelineViewHeight only as an explicit diagnostic after recording the failed assertion. No business write or API repair.
- Proposed narrow fix: call the existing scheduleTimelineViewHeightSync when education setView reveals Schedule. Do not change shared CSS/ui.js or Park.
- Verification: source-bound Chromium/WebKit matrix must assert ancestor clipping and usable Schedule height, then capture actual visible rows. Preserve prior insufficient PASS artifacts as historical diagnostics and rerun affected checks.

## Implemented safe presentation changes
Production impact: yes, after a future authorized release. No release stages performed.
- js/booking.js: education-only edit/ready wording, start-time/customer/student/catalog labels and ARIA; summary uses topic and actual lesson duration. Empty selected catalog summary and zero-total row are omitted only in education. Nonzero amounts and actual catalog descriptions/images remain available through Description. Park labels/promo/price paths are restored on context changes.
- css/education-schedule.css: only lesson card decorative image is omitted; existing canonical renderer still owns its markup. Education tabs become a52px horizontal strip below1100px without reducing the15px label font; Today filters use two columns below720px with linked-group filter across the row.
- js/education-schedule.js: active tabs scroll into the visible strip without moving the document vertically; Schedule reveal requests the existing shared height synchronization after the hidden state changes. No shared ui.js/timeline source edits.
- js/timeline-settings-page.js: education operator preset/module wording uses lessons; existing settings data/actions/capabilities are preserved.
- tests/booking-package-contract.test.js: education catalog description execution preserves content/image and does not select an activity. Existing Park promo VM is explicitly injected with the Park-mode dependency.
- New source-bound actual-app harnesses/runners: education-close-ux-browser, education-close-visual-browser, run-education-close-ux, run-education-close-visual. Layout baseline/diagnostic copies are operator-only evidence tools; their explicit internal height call is a diagnostic probe after the failed UI assertion, not an accepted user journey.
- Every accepted end-to-end write still runs actual-app -> Express -> owned disposable PostgreSQL. Layout/contrast runs block business writes before login.

## Remaining protected presentation blocker
Task03 is SCOPED_UX_VERIFIED_WITH_BLOCKER, not CLOSED or release GO.
Affected protected block: booking-detail-safe-open in js/booking.js, lines16611–17178; showBookingDetails begins16749. Current manifest hash remains83e482b5a8f4776e770bd86df7effd7485ea5e7a3eb1fa1284349bb10b7aaf0d.
The generic header metadata and direct date/time/room/scenario/group rows still duplicate the ordered lesson helper. No CSS nth-child hiding, post-render rewriting or alternative renderer was introduced.
Current user scope explicitly says: “Якщо потрібен protected manifest — окремий конкретний блокер з переліком блоків і focused regression.” AGENTS.md also requires exact approval before changing the hashed block/manifest.
Required bounded next decision: approve only education header and duplicate row presentation in showBookingDetails plus a focused manifest update. Preserve meaningful divergent legacy values rather than hiding them; do not change identity, linked-record resolution, detail API sources, priorities, renderer ownership or other five hashes.
Required focused checks: same ordered lesson card from Today/day/week, legacy fixtures with divergent groupName/topic values, action availability/mobile focus; Park card/program/image/prices unchanged; protected guard all six blocks.

## Verification boundaries
- Counts in browser evidence are mixed assertions across profiles, not independent education journeys. Contrast samples repeat elements/states; they do not certify the entire CRM.
- Seven browser profiles:1440x1000 desktop light,320x740 phone light,390x844 phone dark,844x390 landscape light,768x1024 tablet light,1024x768 tablet dark and640x800 reflow.
- The640px viewport is a1280px@200% equivalent reflow check. Native browser zoom, OS keyboard/native picker operation, physical iPhone/iPad/Android and VoiceOver/TalkBack remain NOT RUN.
- Journal stale409 message/draft/explicit reload/reapply and lost-success retry are separately exercised through actual WebKit phone UI; no hidden force or merge.
- New-child UI creation and core education CI are still task04; inherited HR linking BLOCKED_DESIGN remains task01's owner decision. Neither is closed by this presentation task.
- No schema/auth/permissions/dependency/lockfile/version/protected manifest/booking detail source changes, commit/push/deploy or production business writes.

## Production reference
Fresh read-only observation on2026-10-04: /api/version v0.82.64, branch codex/eventgenix-production, SHA a7d074ff0c5fde63158c81e69732c78fc317446c. All business writes were intercepted before login; only authentication mutations allowed. No real-customer screenshot or response body retained.
Expected legacy /api/staff403 staff_not_migrated is an access boundary, not a production outage; education group/teacher reads succeed. Local outbound hold/reconnecting toast is not proof of production failure or successful live synchronization.
Reference: output/education-ready/close03/live-readonly.json. New UI is local source only.

## Reproduce safely
PowerShell in C:/Users/Plotva/.codex/worktrees/education-close-pack/EventGenix. Existing owned PostgreSQL127.0.0.1:55469 must be available.
```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test'
$env:TEST_DATABASE_RESET_CONFIRM='RESET_DISPOSABLE_TEST_DATABASE'
$env:EDU_QA_PLAYWRIGHT='C:/Users/Plotva/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright'
$env:EDU_READY_RUN_ROOT='output/education-ready/close03/new-attempt'
$env:EDU_CLOSE_SUITE='ux'
$env:EDU_MOBILE_ENGINE='webkit' # repeat with chromium
node tests/integration/run-education-close-ux.js
```
Use a fresh output root for each attempt. Do not point the runner at retained manual/device/production databases. Fixtures are API/SQL prerequisites before any UI action; a failed UI action is never repaired by an API write.
Other scoped suites:journey,date,closeAttendance,attendance. For phone journal set EDU_READY_PHONE=true and engine=webkit. Visual uses EDU_CLOSE_SUITE=visual, EDU_VISUAL_PHASE=after and node tests/integration/run-education-close-visual.js.
Checks: npm test; node --test tests/booking-package-contract.test.js; npm run check:timeline-protected-surface; git diff --check.
The prior manual preview http://127.0.0.1:3012/ still serves the older retained package. It is intentionally preserved; do not use it as proof of this source. Disposable actual-app previews are owned by the safe runner and closed after verification.

