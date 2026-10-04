# EDU-READY-08B — visible education date editing

Production impact: yes, after a future release. Local synthetic/disposable writes only; no schema/auth/permission/dependency/commit/push/deploy changes.

## Pre-edit bug report and plan

Symptom: canonical lesson Edit has a read-only timeline date display, but no visible date input. Expected: the user changes only the lesson date and saves, retaining its ID, title, duration, teacher, group and cabinet. Actual: payload date comes from `AppState.selectedDate`; changing the timeline date closes the drawer. Report04 explicitly labels its date-only scenario as API write + UI reload, not a successful UI edit.

Reproduction: rich synthetic Dar → Today robotics45-minute lesson → canonical card → visible Edit → inspect date field. Record the missing control before product edits with actual Express/PostgreSQL and screenshot; failure must return exit1.

Root cause: the canonical education form exposes duration but no own date. Payload, availability, time-slot/working-hours and conflict helpers use the viewed timeline date. Mutating the viewed date during form editing would disrupt the drawer and old-record lookup. Recommended approach: education-only date input initialized from the timeline on create and canonical booking on edit; a scoped form-date helper supplies validation and payload without changing global timeline state or PUT semantics. Existing canonical ID/detail sources and renderer ownership stay unchanged. Invalidate both old and destination date caches after success.

Series scope: editing a member moves only that selected booking. Show this explicitly beside the field; retain series ID/index/size and every sibling unchanged. The series-create input defines its starting date; existing recurrence generation then applies from that date. No bulk series move is introduced.

Affected areas: `index.html`, canonical `js/booking.js`, existing form dirty tracking only if needed, focused regression/browser harness/safe runner/docs. Protected hashes should remain unchanged; update a protected manifest only if an unavoidable authorized date-edit block changes, with focused regression and explanation first.

Verification: failing baseline; date-only visible save/reload/card/API/SQL; other fields and metadata unchanged; create date override; conflict atomicity and adjacent slot; month/year and Kyiv DST civil dates; invalid input emits no writes; controlled real-save delay/double-submit and503 retry preserves draft; old/new Today/day/week; single-member series scope; desktop/mobile and Park. Preserve all01–08A evidence and the manual39-booking preflight. No failed UI action may be repaired by API.

Additional bug found by personal screenshot review before its fix: after changing Nov01→Nov02, the form's slot preview still displayed a conflict with a Nov01 booking, while the actual Nov02 save succeeded. The header also retained the viewed date. Root cause: `validateBookingTimeChangePreflight` still queried `AppState.selectedDate`; the form header was populated only when the drawer opened. Fix those education date consumers, retaining the existing request-token guards and global timeline state. Add a focused preview-date regression and require a free final slot/header matching the new date before the controlled slow-save test; retain original screenshots and rerun fresh product-source proofs.

## Implementation and independent expectations

- Product files: `index.html`, `js/booking.js`, `js/booking-form.js`. A labelled native date field is enabled/required only in education. Edit hydration uses the canonical record; create defaults to the viewed date. Dirty tracking, invalid-field feedback, header, working-hours/availability/conflict/slot checks and payload use the education form date. The viewed timeline and original-record lookup retain their existing state. Both old and destination caches are invalidated after success.
- Date validation round-trips a strict civil YYYY-MM-DD value through UTC noon; form helpers use local noon for Kyiv calendar stability. Empty, impossible, malformed and year-zero values are invalid. Non-education helpers return the original timeline Date object; no global PUT/PATCH or API validation semantics changed.
- Series create means the first occurrence date. Edit means the selected lesson only; the field explains this. The browser proof checks unchanged series identity/root/index and exact full rows of two siblings.
- Test areas: new `tests/browser/education-ready-date-browser.js`, `tests/integration/run-education-ready-date.js`, `tests/education-date.test.js`, `tests/tools/verify-education-ready-date-evidence.js`; existing safe design runner adds08B/date and gives new08B acceptance attempts separate evidence directories. `tests/booking-package-contract.test.js` loads the actual form-date helpers in its VM harness. The existing acceptance test additionally opens Park Edit and proves the education field hidden/disabled/non-required with its entire SQL record unchanged.

The date suite contains13 checks:11 visible UI scenarios and2 fixture/page-error checks, not13 independent full journeys. It independently reads API/SQL after actual UI saves. Its fixed anchor belongs to the rich synthetic fixture, distinct from the unchanged manual demo anchor2026-10-03.

| Scenario | Independent expected result |
| --- | --- |
| Edit date only; save/reload/card | New date; ID/topic/time/duration/teacher/group/cabinet/status/series/fixture fields unchanged |
| Canonical whole-row date move and return | Every persisted column and JSON value unchanged except date and audit `updated_at` |
| Old/new Today/day/week | Selected lesson absent on old date, present on destination; wait for another expected card before negative assertions |
| Month/year and Kyiv DST |2030-02-01,2030-12-31,2031-01-01,2030-03-31,2030-10-27 retained as civil dates |
| Same-teacher overlap; adjacent slot |409 leaves both entire rows unchanged; separate adjacent fixture succeeds |
| Invalid visible date | Shared validation focuses/marks field, zero writes, SQL unchanged |
| Slow save and repeated submit | Hold the real200 response; exactly one request/write, Save disabled, preview/header use destination |
|503 and retry | No first write, date draft retained, visible retry succeeds |
| One series member | Only selected booking moves; two sibling full rows unchanged |
| Mobile390×844 | Date visible,44px target; save/reload/card/API/SQL agree |
| Create date distinct from viewed day | Visible create saves2030-01-11 while the timeline remains2030-01-10 |

The first edit of a legacy fixture follows existing canonical normalization (cached group name/extra-data defaults). Its meaningful fields are asserted independently. A subsequent UI-only date move additionally compares the entire canonical SQL row/JSON and moves back; normalization is not used as an excuse to ignore lost fields.

## Retained failures and safety

Pre-edit baseline `output/education-ready/08B/regressions/date/attempt-2026-10-04T08-17-45-069Z/verification.json` has2 PASS/1 FAIL, exit1: no visible date control. Earlier failed harness attempts remain retained. Corrections included waiting for populated projections, the actual week-card selector, canonical-vs-legacy row comparisons and shared form validation. The form has `novalidate`; invalid Save uses `aria-disabled`, not native `disabled`. The invalid scenario therefore submits with the real Enter key to exercise shared validation and checks focus/error/zero writes. No forced click, internal submit function or failed-UI API repair is used.

The earlier13/13 attempt08-39-54 was not accepted after personal screenshots exposed stale preview/header dates. A fresh final attempt08-46-12 proves the corrected source hashes, destination header/free preflight and13/13 PASS. The initial focused helper test also failed because its VM harness omitted an existing schedule-state helper; adding that explicit stub restored142/142 without weakening the date query assertion. A fresh runner invocation with a wrongly named reset confirmation was blocked before seeding/writes; the retained command exits1. The correct safe runner confirmation was then used. A mistyped parser filename failed; the actual `npm run check:syntax` is the parser gate.

Writes are restricted by the existing guard/lock/loopback runner to `eventgenix_education_ready_fixture_test` at127.0.0.1:55469. API/SQL setup creates conflict/adjacent fixtures only; it never repairs a failed UI step. The manual preview uses request blocking before login, including wallet daily-login; before/after full preflight remains identical with39 bookings. The local reconnect banner is expected from the existing outbound/WebSocket hold and is not a live-sync PASS.

## Reproduction commands

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test'
$env:TEST_DATABASE_RESET_CONFIRM = 'RESET_DISPOSABLE_TEST_DATABASE'
$env:EDU_QA_PLAYWRIGHT = 'C:/Users/Plotva/AppData/Local/npm-cache/_npx/fd3bca3c548369c0/node_modules/playwright'
node tests/integration/run-education-ready-date.js
# Separate safe runs: EDU_READY_SUITE=teachers/lifecycle/series/acceptance.
node --test tests/education-date.test.js tests/education-duration.test.js tests/booking-package-contract.test.js
npm test
npm run check:syntax
node tests/tools/verify-education-ready-date-evidence.js
```

Do not run the recorder to claim a new PASS: source changes require fresh commands, screenshots and review first. Do not seed production Dar/Park or clean/reseed the manual database.

## Final results and continuation

Date gap04 is closed locally. Final index: `output/education-ready/08B/final-evidence.json`; independently verified summary: `08B/verification-summary.json`, **5/5 PASS, exit0**. A missing index previously returned exit1 (`08B-evidence-missing-index.log`). The verifier checks current source/harness hashes, actual command exit codes, non-skipped counts, reviewed screenshot hashes, exact SQL proofs, manual preflight and disposable cleanup. It does not turn absent evidence into PASS.

| Gate | Result and exact evidence |
| --- | --- |
| Visible date actual-app → Express → SQL |13/13 PASS, exit0; `08B/regressions/date/attempt-2026-10-04T08-46-12-385Z/verification.json` |
| Teacher regression on final product |16/16 PASS, exit0; `08B/regressions/teachers/attempt-2026-10-04T08-48-13-030Z/verification.json` |
| Full lifecycle regression on final product |12/12 PASS, exit0; `08B/regressions/lifecycle/attempt-2026-10-04T08-49-33-590Z/verification.json` |
| Series/calendar/atomic/concurrency backend contracts |17/17 PASS, exit0; `08B-final-series.log`; backend unchanged by08B |
| Mixed acceptance, including visible Park Edit |11/11 PASS, exit0; `08B-final-acceptance.log`, new attempt08-51-05; includes existing internal-helper/error mocks, not11 complete UI journeys |
| Focused date/duration/package contracts |142/142 PASS,0 skips; `08B-focused-final.log` |
| Canonical runtime and normal `npm test` |exit0, Node22.23.1/npm10.9.8; unit3484, static UI1327 and normal gates PASS; `08B-npm-post-visual-final.log` |
| Post-harness parser/protected/diff |1450 JavaScript files parse;6 protected blocks unchanged; diff check PASS |
| Retained manual preview |read-only PASS,39 bookings/full preflight unchanged; `08B/preview-after-visual/verification.json` |

The full npm baseline completed on the final product source. Its separate focused date tests and safe-runner evidence-output adjustment were verified explicitly; no product change followed. General unit/static totals are not education scenario counts. Five accepted runners preserve the entire manual preflight and leave disposable public tables0. Historical01–08A evidence remains untouched; older08B attempts stay retained and are not substituted for current hashes.

Personal review: **all107 original08B screenshots**,8 contact sheets across5 SHA256 manifests in `08B/personal-review.json`; selected final mobile editor/card, invalid state and controlled-saving state additionally viewed full-size. Final desktop1440×1000 and mobile390×844 use Chromium with Europe/Kyiv. The mixed acceptance checks existing desktop/mobile light/dark layouts and Park; it is not new physical-device/date-picker certification.

Worktree: `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`; branch `codex/education-ready-pack-20261003`, unchanged base HEAD `56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`. Manual preview remains running at `http://127.0.0.1:3012/?businessContext=dar&educationSchedule=today&date=2026-10-03`, with existing private login. Owned PG stays at127.0.0.1:55469. No production requests/mutations, CI, commit, push or deploy in08B. No new schema, auth, permissions, dependencies, lockfile, version or protected manifest changes; inherited08A membership migration remains part of the pack.

Remaining limits: physical iPhone/iPad/Android, native OS picker/keyboard, VoiceOver/TalkBack and live production behavior **NOT RUN** for08B. Prior07 simulated WebKit evidence is historical, not a fresh08B date-editor PASS. Next action: **EDU-READY-08C — physical-device and combined final acceptance**, then a separately authorized future release on its exact tested SHA. Preserve manual preview and all proof directories.
