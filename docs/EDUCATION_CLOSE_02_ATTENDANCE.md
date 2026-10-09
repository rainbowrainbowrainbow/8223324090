# EDU-CLOSE-02 — journal concurrency and report compatibility

Production impact: yes, after future release. No commit/push/deploy.

## Before-fix bug report
A. Two operators open one frozen journal. A changes child1 and saves; B changes child2 in the old full form and saves. Expected: B409 atomically, A preserved, B draft retained. Actual implementation: both writes succeed; old full payload can restore child1's previous status. Root cause: lock serializes writes but there is no read revision check. Post-commit unlocked reread can also return another writer's state.
B. Journal supports educationLesson, education_lesson and bookingWorkspace.lesson; report SQL selects only educationLesson. Expected: supported linked legacy records included, preserving object priorities. Actual: legacy records disappear from reports.
Verification: before-fix visible UI → Express → disposable PostgreSQL, complete rows/history and independent report assertions. No API repair of failed UI steps.

## New concurrency contract (no schema)
GET returns opaque SHA256 revision from business/booking, date/group/status, frozen roster and durable history IDs. History identity prevents ABA. Reads/writes use existing booking/group locks for a coherent response. PUT checks revision before snapshot or mark/history writes under the same booking lock. Invalid/missing revision400; stale revision409 EDUCATION_JOURNAL_STALE with zero writes.
Already-applied retry with old revision also409 without extra history; identical marks with freshly read revision200 changes0. No force overwrite, automatic merge or automatic retry.
Draft stores its original revision. Restoring draft against newer data is explicitly stale. Reload requires explicit discard confirmation, then operator reviews and reapplies intended changes.

## Report semantics preserved
Held at end time in Europe/Kyiv; attendance summary held only. Cancelled/future separate; no journal distinct from frozen/unmarked. Archived groups remain supported. Text groupName is not a linked group. Date/group remain protected after first journal. Canonical object takes priority over legacy objects, no field-by-field fallback. No production backfill.

## Execution
Pending; no baseline or final PASS claimed until actual execution.

## Final actual results — 2026-10-04T17:47:19.756Z

Conclusion: LOCAL_ATTENDANCE_REPORT_FIX_VERIFIED. Task02 is complete locally; this is not release GO.

| Suite | Actual result | Evidence folder (under output/education-ready/close02) |
| --- | --- | --- |
| chromium | PASS 6/6, exit0; sourceStable | stable-chromium |
| webkitPhone | PASS 6/6, exit0; sourceStable | hash-ui-webkit |
| attendancePostgres | PASS 7/7, exit0; sourceStable | hash-final-attendance |
| seriesPostgres | PASS 17/17, exit0; sourceStable | hash-final-series |
| mixedAcceptance | PASS 11/11, exit0; sourceStable | hash-final-acceptance |
| continuousJourney | PASS 14/14, exit0; sourceStable | hash-final-journey |
| asyncReportRaces | PASS 17/17, exit0; sourceStable | stable-async |

Counts are mixed assertions, HTTP/SQL tests and one continuous UI journey with14 checks. They are not totals of independent education journeys. The prior commentary number15 for the journey was a counting mistake; actual JSON contains14.

General npm test PASS exit0 on Node22.23.1/npm10.9.8; focused education date/context unit tests21/21 PASS. Protected ownership guard6 blocks PASS; git diff --check PASS. General unit totals are not education coverage. The final response-matcher change is harness-only and has its own parser check and fresh17-case run.

The exact runner JSONs bind product/harness SHA256 before/after each suite. evidence-index.json indexes every final runner, logs, current files and failed diagnostics. FAIL and source drift return1; missing prerequisites do not become PASS. Historical05 fixed-path evidence verifiers remain unchanged and must not be used to accept this new concurrency contract.

### Independent expected report

Fixed anchor2026-10-03; report clock2026-10-03T09:00Z (Europe/Kyiv12:00). Dar,2026-08-01–2026-11-01:36 lessons; held19, cancelled4, scheduled13; journalsNotStarted6; present38, absent13, excused9, unmarked18. Counts are repeated attendance observations, not distinct children.
independent-report-oracle.json derives these values solely from the fixture specification. PostgreSQL assertions additionally compare every lesson phase/count against raw rows. Six group matrices, archived groups, second business and explicit foreign IDs are covered.
Both legacy objects, canonical null/false/0/empty-string fallthrough and canonical object precedence are checked. A canonical text-only group does not inherit a lower-priority linked group. No production backfill.

### Evidence of concurrency

Before fix, visible B save returned200 and reverted A; full afterA/afterB rows and histories are in baseline verification.json. After fix B409 leaves every row/history byte-equivalent; A remains durable and B draft stays visible. Explicit keep/discard refresh and manual reapply are exercised through visible buttons, then independent SQL.
GET and PUT hold booking/group locks; PUT returns its own transaction snapshot, not an unlocked post-commit reread. Revision includes durable history identity and frozen row identity; ABA, first freeze, changed preview roster and missing revision are covered. Wrong child/duplicate/invalid status produce no partial snapshots.
Lost successful response is a controlled local503 after the real server committed. Retry with old revision409 adds no history; explicit reload then fresh identical save200 changes0. A pre-commit503 retry and disabled double-submit are covered separately. These are not production failures.
All three statuses/null, exact author/time, frozen names/roster, two business boundaries, lesson/business switching, dirty refresh, late success/error, A→B→A, reset/reload/back/forward are proved. Existing date/group protection after journal start passes the real series suite.

### Screenshots and diagnostics

Personally reviewed desktop stale draft, restored draft and legacy report, then WebKit phone stale save/reload/lost-response screenshots. After save409 the warning gains focus and scrolls into view; viewport bounds and focus are asserted. Bootstrap and education-page errors are separately captured; both are0 in final Chromium/WebKit proofs.
Earlier WebKit cancellation failures, fixture-name error, missing-revision assertion and wrong-response matcher remain in diagnostic directories. No global timer/sidebar/finance change was made. Local reconnecting toast is loopback outbound/WS hold behavior, not successful live synchronization or production evidence.
Inherited stacked mobile tabs place content lower on first load; broader card/navigation UX belongs to03. Emulation is not hardware/VoiceOver/TalkBack evidence.

### Files and preserved boundaries

Product: services/educationAttendance.js, routes/education-attendance.js, js/education-attendance.js. Regressions: new close attendance browser/runner; existing async, attendance integration and two series test files updated for revision. Handoff and this report updated.
Task01 teacher source/harness/docs and indexed logs are unchanged. Main dirty checkout and prior QA worktrees/evidence remain unchanged. Manual/device DBs retain39 bookings each with ten complete-table hashes equal before/after; disposable public table count0 after every final suite.
No schema/migration/backfill, auth/roles/permissions, global PUT/PATCH, protected booking manifest/source priorities/renderer, dependency/lockfile, version bump, commit/push/deploy or production business mutation.

## Reproduction commands

From C:/Users/Plotva/.codex/worktrees/education-close-pack/EventGenix, with the existing owned PostgreSQL55469 running. Use Node22/npm10 and the existing Playwright cache. TEST_DATABASE_URL must name only eventgenix_education_ready_fixture_test; never manual/device/production.

Set TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test and TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE. Set EDU_QA_PLAYWRIGHT=C:/Users/Plotva/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright.
Set EDU_CLOSE_SUITE to closeAttendance/attendance/async/series/acceptance/journey and EDU_READY_RUN_ROOT to a fresh output/education-ready/close02 folder. Run node tests/integration/run-education-close-attendance.js. For phone emulation set EDU_MOBILE_ENGINE=webkit and EDU_READY_PHONE=true; desktop chromium/false.

## Remaining package limitations / next task

Task01 existing-HR linking remains BLOCKED_DESIGN. Physical devices remain NOT RUN/BLOCKED_DEVICE, not PASS. Core education CI/fail-closed final acceptance belongs to04/06. Production live QA of this uncommitted code is NOT RUN; no release readiness is inferred.
Old cached/API clients without revision will receive400 and must reread/use the updated client; future release must perform authorized cache/version hygiene. No compatibility force bypass is supplied.
Continue EDU-CLOSE-03 in this worktree. Do not deploy until all package blockers and fresh final acceptance are resolved.
