# EDU-CLOSE-04 — baseline and evidence contract

Production impact: indirect. No commit/push/deploy authorization.

## Baseline before changes (2026-10-07)

Old validators compare recorded entries only: added source/harness files are invisible. Collector accepts exit0 without required scenario execution. Release validator independently chooses latest command and latest proof, combining attempts.

Previous continuous journey enrolled seeded child-1, not a new representative/child through customer UI. Its14 assertions are one journey. Duration30/45/60/90 permutations belong to lifecycle suite. Actual CSS: css/education-schedule.css.

Mixed acceptance includes internal calls/browser mocks/arbitrary pauses. Live smoke checks state but no visible schedule geometry/nonempty controls. Existing operator runners depend on Windows paths, PostgreSQL55469 and retained databases.

Expected: exact inventories, exact attempt/proof/log hashes, nonempty required IDs; blocked/skip neverPASS. Root cause: no shared execution/evidence contract. Verification: negative cases and actual-app disposable UI/SQL commands used identically in CI, no retained mutations.

## Matrix: counts remain separate

| Suite | Class | Scope |
| --- | --- | --- |
| close journey Chromium/WebKit | Visible UI + independent API/SQL; emulation | One continuous journey per engine, NEW customer/child |
| teachers/groups/date/lifecycle/async | Mixed visible UI/API/SQL; real-response barriers | F01–F06, ID/isolation, duration, date, navigation |
| close attendance | Visible UI/API/SQL | Two operators, stale409, retry/draft/history, canonical/legacy report |
| attendance/series | HTTP/PostgreSQL | Status/roster/report/atomic/concurrency; NOT UI journeys |
| mixed acceptance | Internal/component/API/SQL/browser mocks | NOT a continuous journey |
| close UX Chromium/WebKit | Synthetic read-only UI/browser/viewport emulation | Seven profiles, contrast/geometry/Park; NOT physical proof |
| live smoke | Production read-only observation | Never candidate write acceptance |
| physical | BLOCKED_DEVICE / NOT RUN | Requires iPhone/iPad/Android operator evidence |
| unit/validator/probes | Internal | Never education journey counts |

## CLOSE03 checkpoint

Late schedule reveal fix present. Final browser/journey runners interrupted: no completed proof. npm log truncated, no terminal summary. These attempts INCOMPLETE, notPASS. Old machinePASS missed clipping and is historical. Card duplication remains BLOCKED_PROTECTED_PRESENTATION; no protected change authorized here.

## Execution and portability contract

The education-regressions CI job has13 independent disposable PostgreSQL/browser entries. Each uses Node22/npm10, postgres16, the existing ephemeral Playwright install pattern, and one exact attempt directory. No production credentials/calls, repository settings, permissions, secrets, dependencies or lockfile changes. TZ is explicitly Europe/Kyiv in the worker; fixtures and report clock remain fixed.

The runner derives PG connection fields from the verified loopback TEST_DATABASE_URL. The optional portable fixture switch applies only to eventgenix_education_ready_fixture_test with reset confirmation and runner ownership; manual/device databases retain the55469 boundary. Exclusive database lock covers execution, cleanup verification and proof completion. Actual CI on a release SHA is NOT RUN until task06 pushes.

The strict validator compares both full inventories, including new nonignored source files/directories and harness files; verifies unique mandatory IDs, nonempty execution, status/skips/blocked, exact directory/attempt/suite, record/proof/log hashes and terminal completion marker. PostgreSQL TAP requires named mandatory tests and nonzero complete counts, with zero skips/todo/cancelled. Exit0 alone is rejected. Compatibility final/release commands dispatch to this contract rather than selecting unrelated latest logs.

Reproduce from the worktree with a verified owned disposable TEST_DATABASE_URL and TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE:

```sh
npm exec --yes --package=playwright -c "node tests/integration/run-education-close-ci.js journey chromium"
npm exec --yes --package=playwright -c "node tests/integration/run-education-close-ci.js journey webkit"
# Other explicit suite keys: teachers groups lifecycle date async journal attendance series acceptance responsive
node --test tests/education-close-evidence.test.js tests/education-close-portability.test.js
node tests/tools/verify-education-close-attempt.js output/education-ready/close04/<exact-attempt-directory>
node tests/tools/verify-education-close-pack.js output/education-ready/close04/<explicit-matrix-file>
npm test
```

Each CI entry uses the same runner. Browser SQL pools read verified PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE. Internal-call and fault-injected tests remain component/API tests, never continuous visible UI journeys. Arbitrary education mixed-test sleeps/polls were replaced with responses, terminal DOM state and held request barriers with deadlines. Double-click input interval is an input gesture, not a network wait.

## Newly exposed product defects (before any product fix)

### CLOSE04-F01 — child birthday date-only conversion

- Reproduction: visible Customers form creates fictional representative Ганна Лісова and child Назар Лісовий with2020-05-14. SQL birthday::text is2020-05-14; fresh customer card shows13.05.2020. No API write repairs the UI step.
- Expected: entered date = SQL date = API child birthday = visible card date.
- Root cause: services/customerChildren.js dateOnlyFromRow converts a pg DATE parsed as a local-midnight Date via toISOString().slice(0,10). Europe/Kyiv midnight shifts to the preceding UTC date. js/customers-page.js formatDateOnly faithfully displays the already shifted API date.
- Previous16-check journey covered creation, ownership, SQL birthday, enrollment and the full lesson lifecycle, but omitted visible/API birthday equality. These previous PASS attempts are incomplete for the new17-ID contract and are not current acceptance.
- The new-child-date-visible-API-SQL mandatory gate records all three observations and must FAIL on mismatch. It runs after the remaining continuous lesson steps so their independent results remain visible; overall journey is still FAIL/exit1.
- Product fix is outside task04 harness/CI scope. No customer source edit, schema/backfill or UTC-only workaround was made. Kyiv TZ is explicit for Linux CI to expose the defect reliably.

### CLOSE04-F02 — shared minimap unhandled stale request

- Reproduction: controlled component A→B→A business switching in education-context-actual-app-browser-smoke.js; education requests are held/released with barriers. All scoped education-state assertions finish, then pageErrors contains Stale timeline request ignored; exit1.
- A second failing diagnostic copy logs the actual stack: timelineStaleRequestError -> getLinesForDate -> renderMinimapAsync at js/ui.js:3228.
- Root cause: renderMinimap calls async renderMinimapAsync without handling its rejected promise; the async function awaits getLinesForDate, whose token guard intentionally rejects after business/render generation changes.
- Expected: obsolete minimap work is cancelled/ignored explicitly, without an uncaught browser error or stale rendering; genuine errors stay observable.
- No ignored pageerror, injected catch, product workaround or timeline/source-priority change. Product fix is outside task04. The copy is diagnostic evidence, not a new CI journey.
- Later source-bound final component run PASSed. This is an intermittent timing defect, not a failure of every A→B→A attempt. Two failed attempts and one successful final attempt are retained; the unchanged fire-and-forget path is not CLOSED. A future deterministic regression must hold the minimap request specifically. It is not asserted as a failure of deployed v0.82.70; production read-only smoke did not reproduce it.

## Historical corrections

- EDU-CLOSE03 late runners interrupted and have no completed proof. The final task04 executions replace historical PASS as current software evidence; historical artifacts remain unchanged.
- Source CSS is css/education-schedule.css, not an invented education CSS path.
- Duration30/45/60/90 and single-field preservation are lifecycle suite checks. They are not permutations of the old single45-minute journey.
- Old ready journey used seeded child-1; new close journey creates representative/child through visible customer UI and proves new SQL IDs.
- General npm/unit counts, low-level responsive probes and component assertions are not counts of education journeys.

### CLOSE04-V01 — manually observed schedule overlap

The personally reviewed WebKit tablet/light Schedule frame contains the09:30 lesson over the first cabinet-name cell while the visible ruler begins at10:00. Terminal vertical geometry passes, so the first lesson is no longer clipped; that probe does not prove horizontal non-overlap or all cabinet labels. Preserve this separate visual finding for a bounded education scheduling/presentation fix and independent rectangle-overlap regression. No renderer/range/source-priority product fix was made in task04. Do not convert1041 successful low-level probes into full visual acceptance.

Diagnostic visual frame: output/education-ready/close04/final-r2/attempt-2026-10-07T12-23-14-776Z-responsive-webkit-2ae2d7/artifacts/final-webkit-2026-10-07T12-26-42-160Z/tablet-768-light-schedule.png. The full attempt is stale after later harness edits; its image is a manual diagnostic observation, not current acceptance. Current final matrix has fresh attempts separately.


## Final task04 outcome — 2026-10-07T12:54:39.004Z

Status: TEST_INFRA_IMPLEMENTED / REQUIRED_UI_ACCEPTANCE_FAIL. Conclusion: NO-GO. The requirement that all key local commands PASS is not met; the newly exposed child date defect requires a separately authorized product fix. No commit/push/deploy/version bump was performed.

Final explicit manifest: output/education-ready/close04/matrix-final.json. Machine index: output/education-ready/close04/evidence-index.json. Strict validator exit1; it rejects the failing required journey rather than consuming an older PASS. Source/harness inventories are identical across every selected final attempt (1316 source and 973 harness files); those numbers are file inventory sizes, not scenario counts.

CI job entries:13 configured, actual release-SHA CI NOT RUN. Local entry statuses: {"PASS":11,"FAIL":2}. Every row has its own record/proof/log hashes and exact attempt. These counts are CI/suite entries, not13 continuous journeys.

| Entry | Classification | Status | Execution | Explicit record |
| --- | --- | --- | --- | --- |
| teachers/chromium | MIXED_VISIBLE_UI_API_SQL | PASS | 26 named checks/probes | final-teacher-refresh/attempt-2026-10-07T12-27-13-504Z-teachers-chromium-119ac1/record.json |
| groups/chromium | MIXED_VISIBLE_UI_API_SQL | PASS | 15 named checks/probes | final-r3/attempt-2026-10-07T12-25-53-232Z-groups-chromium-783afc/record.json |
| lifecycle/chromium | MIXED_VISIBLE_UI_API_SQL | PASS | 12 named checks/probes | final-r3/attempt-2026-10-07T12-33-02-374Z-lifecycle-chromium-ef4e36/record.json |
| date/chromium | MIXED_VISIBLE_UI_API_SQL | PASS | 13 named checks/probes | final-r3/attempt-2026-10-07T12-36-44-635Z-date-chromium-db46f6/record.json |
| async/chromium | MIXED_VISIBLE_UI_API_SQL_BARRIERS | PASS | 17 named checks/probes | final-r3/attempt-2026-10-07T12-38-38-787Z-async-chromium-09f277/record.json |
| journal/chromium | VISIBLE_UI_API_SQL_TWO_OPERATORS | PASS | 6 named checks/probes | final-r3/attempt-2026-10-07T12-40-46-030Z-journal-chromium-7f7da3/record.json |
| attendance/chromium | HTTP_POSTGRESQL | PASS | 7 named checks/probes | final-r3/attempt-2026-10-07T12-41-39-660Z-attendance-chromium-98636f/record.json |
| series/chromium | HTTP_POSTGRESQL | PASS | 17 named checks/probes | final-r3/attempt-2026-10-07T12-41-55-119Z-series-chromium-52a0cb/record.json |
| acceptance/chromium | MIXED_COMPONENT_API_SQL_BROWSER_MOCK | PASS | 11 named checks/probes | final-r3/attempt-2026-10-07T12-42-11-752Z-acceptance-chromium-7488e4/record.json |
| journey/chromium | VISIBLE_UI_API_SQL_ONE_CONTINUOUS_JOURNEY | FAIL | 17 named checks/probes | final-r3/attempt-2026-10-07T12-42-56-114Z-journey-chromium-b035ba/record.json |
| journey/webkit | VISIBLE_UI_API_SQL_ONE_CONTINUOUS_JOURNEY | FAIL | 17 named checks/probes | final-r3/attempt-2026-10-07T12-44-00-760Z-journey-webkit-85bedd/record.json |
| responsive/chromium | READ_ONLY_SYNTHETIC_EMULATION | PASS | 1041 named checks/probes | final-r3/attempt-2026-10-07T12-45-20-760Z-responsive-chromium-a0f7d0/record.json |
| responsive/webkit | READ_ONLY_SYNTHETIC_EMULATION | PASS | 1041 named checks/probes | final-r3/attempt-2026-10-07T12-48-59-575Z-responsive-webkit-cbcdf2/record.json |

Two continuous journeys each execute17 required gates: all16 previous lifecycle gates complete, and the new child date UI/API/SQL gate FAILs. No API write repairs the UI, and no downstream fake PASS is substituted. The full customer/child-to-series/cancellation path executes, but its data display is incorrect. Detailed oracle values and failure screenshots are in the named proofs.

31 validator/portability unit tests PASS, including empty/missing/added/stale/blocked/failed-UI-successful-API negatives; npm test PASS on immutable final inventories; protected6-block guard PASS; CI YAML parser PASS with13 distinct entries; git diff --check PASS. General npm/unit totals are not education journey counts.

Final component commands are separate: education-context-browser-r4.log and education-group-submit-browser-r4.log PASS. Previous context/minimap failures remain as intermittent diagnostics; they are not silently erased or declared CLOSED. Old arbitrary poll helper conversion diagnostics, bad route matcher, empty TAP capture and interrupted/stale attempts remain retained as harness failures, not product failures or final acceptance.

Responsive entries measure text contrast4.5:1 (large text3:1), input boundaries3:1, keyboard/focus/targets and terminal geometry across7 emulation profiles per engine. Low-level probes are not1041 education journeys, physical devices or a complete visual certification. CLOSE04-V01 overlap and protected card duplication remain separate visual limitations.

Live observer: output/education-ready/close04/live-readonly-final-2026-10-07.json, READONLY_OBSERVATION_COMPLETE, creator/Dar plus Park, version0.82.70 / ea635cf690ca95a5ff265dbbe90bd71849ffbf47 / codex/eventgenix-production. Rechecked remote production HEAD matches. Observer hash stayed unchanged; business writes intercepted before login. Visible schedule and canonical card/Park observed; nonempty controls inspected.32 outbound-policy diagnostic entries,2 write-policy entries and2 explicit staff-denial entries are classified, with no unexplained failures; these are diagnostic entries, not unique request counts. Local holds do not prove production failure or live synchronization.

Candidate base remains a7d074ff0c5fde63158c81e69732c78fc317446c (v0.82.64); it was not destructively updated. Future task06 must integrate current production in a release worktree, repeat affected contracts and obtain green CI for the exact release SHA.

Other release limitations remain: existing HR linking BLOCKED_DESIGN; canonical duplication BLOCKED_PROTECTED_PRESENTATION; physical42 NOT RUN/BLOCKED_DEVICE. Device evidence must match final UI source before GO. Recommended next action: authorize bounded fixes for child date-only conversion and minimap stale lifecycle, validate the observed education schedule overlap, then rerun this explicit matrix and physical task05 before release task06.


Preservation verified after all final suites: manual/device39/39 bookings and ten-table hashes unchanged,1542 previous evidence hashes unchanged, other dirty worktrees unchanged, disposable public tables0. Final personally reviewed new-child/conflict and tablet/reflow images are hash-bound in evidence-index.json.visualReview; CLOSE04-V01 is present in final-source frames as well.
