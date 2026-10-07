# EDU-READY-05: Today, attendance and reports

Production impact: yes, after a future release. Local only; no commit/push/deploy.

## Bug report and root causes before product edits

F03: the visible Refresh button invokes only `loadLessons()`. The open journal retains its old statuses/history after another operator's durable correction. Expected: reread the selected journal and lesson list, protecting unsaved user input. Reproduce with two actual-app browser contexts on the rich task02 fixed dataset; assert second operator's PUT and raw SQL before first operator's visible Refresh.

F04: the schedule context handler starts the active report; the later attendance context handler increments generation/version and clears the result, without restarting the active report. Successful responses are rejected and the page stays blank after direct URL/reload. Expected: loading → current success/explicit empty/error, including back/forward and business changes.

F06: the summary handler overwrites `state.date` before `load()`. Its same-date loading guard then mistakes the new date for an active request, suppresses that request, and rejects the older response without releasing loading. There is also no request generation/business owner to distinguish A→B→A. Expected: the latest desired date/context owns completion; late success/error/finally cannot repaint or finish a newer request.

Implementation target: `js/education-schedule.js`, `js/education-attendance.js`, and narrowly scoped education controls if needed. Separate requested date from active request identity; coalesce identical in-flight requests, invalidate context generations, and coordinate workspace activation after context reset. Refresh selected journals with fresh lesson reads. Track unsaved journal input by business/booking and preserve it during navigation; explicit refresh/discard must require a decision. Keep controls/statuses coherent during reads/saves and retain newer user input if a save response arrives later.

Verification: red actual-app baselines first, then controlled real-response barriers for date/context/report/journal races; second visible UI operator; raw SQL author/time/history/frozen roster assertions; all statuses/null/repeat and the unchanged serialized last-write-wins contract; fixture-specification and independent SQL report oracles for multiple periods/groups. No backend repair after failed UI steps.

The new runner uses only the owned disposable database55469 and proves the retained manual preflight unchanged. A process-only test hook supplies the existing report service's optional `now` input as2026-10-03T09:00Z (Kyiv12:00); it runs real queries/calculation and does not freeze auth, history timestamps or database time. Production and manual preview do not use this hook.

Initial harness attempts are retained. The report-clock hook first refused an absent runner verification flag before starting the app; the validated runner now passes its exact boundary to both children. The first F03 check selected child0, whose membership ended before the journal date, and therefore never performed a second-operator correction. This is a fixture-selection failure, not evidence of F03. The corrected baseline uses child1, independently present in that frozen roster, before any product edit. F04/F06 were reproduced in the earlier attempt independently.

## Immutable red baseline

`output/education-ready/05/attempt-2026-10-03T20-13-47-449Z/verification.json`:2 PASS /3 FAIL, exit1, before product edits. F03: the second visible operator saved `absent`, raw SQL and API agreed with author/time/history; first operator's Refresh still displayed `present`. F04: SQL/fixture/API summary16/1/3/5/28/13/8/17, while direct/reload UI rendered no summary. F06: final desired date2026-10-03, four durable bookings, UI empty/loading true after releasing the real older response. The runner preserved39 manual bookings/full preflight and cleaned disposable tables to0.

The first corrected product attempt passed all three regressions (5/5 including fixture/page errors). Subsequent attempts expand navigation, save failure/retry, independent report matrices and controlled late success/error checks. A previous expanded attempt deliberately remains FAIL: its business-switch helper inspected the old document before the sidebar's actual navigation completed, and screenshot credential protection obscured the underlying save error. The new harness waits for real main-frame navigation and redacts screenshot-only username text before capture. Report SQL/specification mismatches after a failed earlier journal scenario remain failures, never accepted as successful reports.

## Additional business-switch bug, before its fix

Actual visible sidebar selection from Dar's Reports/Attendance to the second synthetic education context navigates to the legacy `/maysternya-doli` page, whose page has no education workspace. The harness correctly retains this as FAIL; waiting longer does not repair it. Root cause: `navigateCrmBusinessDestination()` accepts the education handoff only inside the same-path branch, while the legacy destination has a different path. Expected: an already allowed education workspace on `/` remains the canonical destination, retaining its current tab/date. Proposed narrow change in `js/api.js`: reuse `crmBusinessHasEducationScheduleHandoff()` (including its existing access/profile checks) for this root-page education destination before the legacy navigation branch. No role/permission, authentication/session, API source or booking-identity change. Focused verification: actual sidebar A→B→A, reports/journal isolation and unchanged non-education navigation contracts.

## Implemented behavior

Additional held-directory reproduction before its correction: the read-only retained-preview harness holds all real group-directory responses on a filtered direct report URL. `directory-baseline.json` records no summary, `reportLoading=false` and an empty status; exit1. Root cause: report activation awaits the unbounded group read before setting any report loading state. Narrow correction: launch report state immediately alongside directory loading, and add a20-second abort only to group GET reads. Existing group write/uncertain-commit behavior stays unchanged. On directory failure, the current filtered report shows its explicit error; reload retries after the real response barrier is released.

Today owns each request by object identity, date, business and generation. The summary event no longer prewrites the active request's date. Identical in-flight requests coalesce; stale success/error/finally cannot paint or release a newer request. Workspace activation runs after synchronous context resets and has its own activation version. The canonical `getBookingsForDate()` remains the source. Explicit retry uses its existing `force` option. Reads use bounded20-second abort signals, with a visible retry/error state.

Refresh rereads the selected journal and a fresh lesson list. Unsaved input requires an explicit keep/discard choice; a failed refresh retains input and its explanatory error. A save freezes journal controls and rejects another submit until completion; errors retain input for retry. Business/request versions guard both success and finally. Navigation/reload restores only edited child marks, keyed by current user/business/booking in session storage; it merges them onto freshly read server data so untouched marks corrected by another operator remain current. Only numeric child IDs and statuses are stored, no names/contacts/tokens. If storage is unavailable, in-memory drafts survive in-page navigation and native unload confirmation protects earlier pending journals. Saved/cancelled/empty states remain explicit.

Reports coalesce identical in-flight filters and own terminal state by business/generation/version. Invalid periods and failures show explanations; filter changes request current results. Period/group state is preserved in the URL. Requested groups are not silently replaced by All Groups while the directory loads. Group readiness and repeated workspace activations are coordinated, fixing a further filtered-reload race caught by the expanded test. Totals/phase semantics remain in the unchanged server service. The scoped five-line root-page education navigation exception preserves the existing access/profile checks and leaves non-education destinations intact.

## Coverage matrix and independent oracles

| Area | Preconditions and expected result | Evidence level |
|---|---|---|
| F03 / second operator | Fixed frozen English journal, independently confirmed child1/present. Second visible UI operator changes absent; first visible Refresh rereads absent and rendered author/history. SQL/API author/time/history must agree. | UI → Express → SQL |
| Draft lifecycle | Dirty mark is kept on cancel, restored after reload/date/tab/business navigation, explicitly discarded on confirmed successful Refresh. A failed Refresh keeps it. | UI + durable SQL assertions |
| Draft merge | First operator edits one child; another operator saves a different child. Reload restores only the first local edit and reads the untouched child's new server status. | Two real UI contexts + SQL |
| Statuses / repeat / retry | present/absent/excused/null through visible Save. Clearing keeps history author/time but intentionally sets current `marked_at` to null. Repeated identical Save adds no history. Controlled503 does not write; retry is one durable PUT, controls disabled while its real response is held. | UI + real HTTP/SQL; error injection identified |
| F04 / reports | Direct/reload, seven periods/group cases, filtered reload, actual back/forward and reset. Fixture-specification oracle and independently counted raw SQL must agree before API/UI comparison. | UI + two independent oracles |
| Report races | Filter A→B→A while an actual older response is held; release old success/503 after current success. Real sidebar business A→B→A never displays foreign totals. Invalid period/error/retry explained. | Real UI; held real response + identified late error injection |
| F06 / Today | Older date response held, visible next/previous buttons select current date; cards must equal raw SQL IDs. A→B→A ignores old success/error and ends loading. Teacher/cabinet/group filters and All reset; synthetic business switching. Current503 exposes retry; empty successful date explains no lessons. | UI + raw SQL IDs; held real responses |
| Frozen roster | Source child renamed and membership backdated in disposable prerequisites; journal/API and snapshot SQL unchanged through correction. | Real HTTP + PostgreSQL |
| Concurrent operators | Both actual HTTP PUTs wait behind an owned row lock before release; both succeed, history chains, durable final status/author/time matches the final serialized change. No fixed winner is assumed. | Real HTTP/DB barrier |
| Cancelled/foreign | Cancelled journal read-only, mutation409; other education/non-education contexts404. | Real HTTP + PostgreSQL |
| Legacy navigation | Existing direct/reload/back, default/custom sidebar and real Park→Dar selector; includes older internal calls, separately classified. | Mixed actual-app navigation suite |
| Directory stall | Hold all real group GET responses on the retained synthetic filtered report. Loading visible immediately; GET-only20-second abort ends with an explicit error. Release and reload preserve the filter/result. | Read-only actual-app / Express; full retained SQL preflight unchanged |

No API/SQL write repairs a failed UI step. Fixture API writes are prerequisites only. Controlled fault responses never claim to be real server successes. The independent report clock is fixed to Kyiv12:00 on2026-10-03; all36 lessons, including the archived group's actual August lessons, are included in the long-period case. Empty periods/groups remain legitimate explicit zero summaries, not missing fixtures.

## Preserved diagnostic attempts

All attempts and logs are retained. The first expanded save test incorrectly expected `marked_at` to be set after a null mark; source inspection established the existing null timestamp/history contract and the assertion now verifies both. Sidebar failures revealed the actual legacy-destination bug, beyond the earlier navigation timing error. A filtered report reload lost its group during asynchronous directory hydration and is now a focused regression. Failed journal Refresh had its error overwritten by the lesson-list loading text; the final behavior keeps the error. One late-date harness barrier waited on a later captured response without releasing it; only the identified owned browser-script process10068 was stopped, its parent safely cleaned the disposable schema, and that incomplete attempt remains non-PASS. Every held-response wait now has a deadline and the entire suite has an8-minute watchdog. The evidence verifier rejects nonterminal/absent checks and a stale npm PASS.

## Commands

PowerShell, in this worktree with the owned loopback PostgreSQL55469 running:

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test'
$env:TEST_DATABASE_RESET_CONFIRM='RESET_DISPOSABLE_TEST_DATABASE'
$env:EDU_QA_PLAYWRIGHT='C:/Users/Plotva/AppData/Local/npm-cache/_npx/fd3bca3c548369c0/node_modules/playwright'
$env:EDU_ASYNC_PHASE='postfix'
node tests/integration/run-education-ready-async.js
$env:EDU_READY_SUITE='attendance'
node tests/integration/run-education-ready-async.js
$env:EDU_READY_SUITE='navigation'
node tests/integration/run-education-ready-async.js
Remove-Item Env:EDU_READY_SUITE
node --test tests/education-schedule-ui.test.js tests/education-attendance.test.js tests/education-qa-context-regressions.test.js tests/education-ready-results.test.js tests/business-profile-frontend.test.js tests/business-context.test.js tests/education-duration.test.js *> output/education-ready/05-targeted-directory-final.log
if($LASTEXITCODE -ne 0) { throw 'Focused gate failed; do not treat as PASS' }
$educationGateStarted=(Get-Date).ToUniversalTime().ToString('o')
$educationSourceHashes=@{}
foreach($educationSource in @('js/api.js','js/education-schedule.js','js/education-attendance.js','js/education-groups.js')) {
    $educationSourceHashes[$educationSource]=(Get-FileHash -LiteralPath $educationSource -Algorithm SHA256).Hash.ToLowerInvariant()
}
npm test *> output/education-ready/05-npm-test-current-final.log
$educationGateExit=$LASTEXITCODE
@{startedAt=$educationGateStarted;completedAt=(Get-Date).ToUniversalTime().ToString('o');exitCode=$educationGateExit;log='05-npm-test-current-final.log';sourceHashes=$educationSourceHashes} |
    ConvertTo-Json -Depth 4 | Set-Content output/education-ready/05/npm-test-result.json
if($educationGateExit -ne 0) { throw 'General gate failed; do not treat as PASS' }
node tests/tools/verify-education-ready-async-evidence.js
```

Each runner appends immutable evidence and compares the retained manual dataset's full preflight before/after. The evidence verifier requires a fresh `05-npm-test-current-final.log`, matching `npm-test-result.json` and unchanged hashes of all four changed frontend sources. Targeted final log: `05-targeted-directory-final.log`. Private credentials for read-only preview/live are loaded process-locally from the existing secrets file; never put values in logs or docs. Preview checker: `tests/browser/education-ready-async-preview-readonly.js`; directory checker: `tests/browser/education-ready-report-directory-readonly.js` with `EDU_DIRECTORY_PHASE=postfix`; live checker receives `EDU_READY_LIVE_OUTPUT=output/education-ready/05/live-readonly.json`. If browser cache package is unavailable, report the concrete blocker; do not install new dependencies/change lockfile.

## Visual evidence boundary

All six retained-preview screenshots (1440/390 pixels) and all five screenshots from the earlier final17-check attempt were reviewed. The forward-navigation screenshot was an entirely blank dark frame: the harness had checked initialized workspace state before the authentication shell became visible. That frame is not evidence of visible forward navigation. The final harness now requires visible `#mainApp` and report summary after report navigation, plus visible Today panel and four cards after Forward; the preceding attempt remains retained. This is a test-readiness correction, not evidence that the blank frame was a completed product render.

Visual FAILs remain for tasks06/07: native Refresh/Show/Save/roster buttons, clipped long labels, generic event/catalog/legend content inside the education shell and horizontal overflow/hidden controls at390 pixels. Workspace-only width assertions do not establish whole-app responsive usability. Physical iPhone/tablet and full keyboard/screen-reader accessibility have not been accepted. The reconnect banner comes from the local outbound/WebSocket hold; live synchronization is not proved by this preview. No responsive or visual PASS is implied by functional05 checks.

## Final local results

- Actual-app final proof: `output/education-ready/05/attempt-2026-10-03T20-59-55-363Z/verification.json`, **17/17 PASS**, exit0, full coverage, no fatal/page errors. This means15 visible UI checks and2 fixture/page-error checks, not17 independent end-to-end journeys. Log: `05-postfix-visible-navigation-final.log`. All five screenshots of this exact attempt were reviewed; Forward now shows the visible Today panel and four lessons.
- Three regressions are green: second-operator Refresh reflects durable status and author/time/history; direct/reload reports agree with specification, independent SQL and API; latest Today date ends loading and displays exactly the SQL booking IDs. Controlled late success/error cases, business A→B→A, save error/retry, null marks/no-op repeats and edited-only draft restoration also pass. No failed UI step was repaired with an API write.
- Backend contracts: **3/3 PASS**, no skips, `05-attendance-first.log`. Frozen roster, two actual PUTs queued behind a real PostgreSQL row lock, chained history/serialized last-write-wins, cancelled409 and foreign404 are verified without changing the server contract. Existing navigation smoke **PASS**, `05-navigation.log`, remains separately classified as mixed UI/internal-call coverage. Focused mixed contracts **67/67 PASS**, no skips, `05-targeted-directory-final.log`.
- Additional read-only directory regression: `directory-baseline.json` remains FAIL/exit1 before correction; `directory-postfix.json` PASS. Loading appears immediately; the held real GET terminates with an explicit error in19611ms, below the25-second assertion limit, then reload restores its group and API-equivalent summary. Full manual preflight remains unchanged.
- All completed disposable runners preserve the manual preflight/39 owned bookings and clean disposable public tables to0. Retained preview read-only proof `preview-readonly/verification.json` PASS includes real Today/journal/report direct/reload at1440/390; these widths are observations, not responsive acceptance. The preview's real current-time report totals are distinct from the fixed-noon test oracle.
- Final general gate **PASS/exit0**, completed2026-10-03 21:04:32 UTC (Oct04 00:04 Kyiv), Node22.23.1/npm10.9.8, `05-npm-test-current-final.log` and `npm-test-result.json`. All four product source hashes match the tested files. Static UI1327/1327 and the remaining standard guards/suites pass; these general counts are not education scenarios. Evidence consistency **8/8 PASS**, `verification-summary.json`, exact final attempt above. The verifier also previously rejected incomplete/stale evidence with exit1. Protected source guard and diff/parser checks pass. CI was not run.
- Product changes05: `js/education-attendance.js`, `js/education-schedule.js`, scoped5-line navigation in `js/api.js`, GET-only timeout in `js/education-groups.js`. New files: async browser/runner, attendance integration contracts, report-clock helper, preview/directory read-only checkers, evidence verifier and this report. Focused source/VM tests and optional navigation evidence output were extended. Earlier03/04 changes remain present. Schema/auth/permissions/report semantics/concurrency contract/dependencies/lockfile/version/settings/protected manifest are unchanged.
- Production proof `live-readonly.json`: v0.82.59, SHA`56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e`, branch`codex/eventgenix-production`, unchanged fingerprints; business requests blocked before login, including daily-login POST. Local fixes are not deployed. No commit/push/deploy/CI occurred.

Independent report matrix at fixed Kyiv2026-10-03 12:00, after the preceding visible journal corrections. Column order follows the actual summary contract:

| Period / group | Held | Cancelled | Scheduled | No journal | Present | Absent | Excused | Unmarked |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Jul01–Nov30 / all | 19 | 4 | 13 | 6 | 37 | 14 | 9 | 18 |
| Oct03 / all | 1 | 0 | 3 | 1 | 0 | 0 | 0 | 0 |
| Sep01–Oct02 / English | 4 | 0 | 0 | 1 | 7 | 4 | 2 | 5 |
| Sep01–Nov30 / robotics | 3 | 1 | 4 | 1 | 5 | 3 | 2 | 2 |
| Sep01–Nov30 / empty group | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Aug01–Oct03 / archived group | 3 | 1 | 0 | 1 | 9 | 1 | 1 | 1 |
| Jan01–Jan02 / all | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Continue task06 in `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`, branch`codex/education-ready-pack-20261003`. Keep manual preview/DB running and its data separate from disposable cleanup. Task06 owns the recorded visual FAILs; task07 owns whole-app mobile/accessibility, task08 the final combined acceptance. The existing global staff ownership/new-unassigned-teacher limitation from03 remains outside05.
