# EDU-READY-04: education duration and lesson lifecycle

Production impact: yes, after a future release. Local only; no commit/push/deploy.

## Bug report before product edits

Actual-app reproduction on task02's rich fixed disposable data: visible Today lesson card → canonical details → visible Edit → change only topic → Save → reload → canonical card/API/SQL. Robotics lesson started at11:30, duration45. Saved payload and SQL duration became30; reloaded details showed11:30–12:00. Evidence is preserved under `output/education-ready/04/attempt-*` with phase baseline. The first harness also had an unrelated finalization TypeError (calling a nonexistent results.summary); that attempt is retained, and the corrected harness is rerun before any product edit.

Expected: topic-only edit retains duration45 and every independent assignment/date/time field. Actual: hidden customDuration starts at30 and is not hydrated for an education booking without a custom catalog product. `getBookingFormData` reads this hidden value. Catalog-linked lessons can also override persisted duration with the catalog default.

Root cause: education has no own visible duration control; hydration writes duration only inside the custom-product branch. Selection/time validation and payload generation have several catalog/custom paths, so a fix must consistently use education duration for hydration, validation, availability, time-slot calculation and payload while preserving non-education branches.

Implementation plan: a visible integer-minute control in the existing education form (1–1440, with midnight/working-hours checks retained), hydrate from the canonical booking, use it only in education mode, reject invalid education durations before API coercion, and make linked roster versus optional legacy text label explicit. Preserve existing labels on edit. Existing booking identity, API detail sources and renderer ownership stay unchanged; update a protected hash only if the narrowly authorized duration fix touches a hashed block, after focused regression coverage.

Verification: retain red F05, actual UI→API→SQL for30/45/60/90 and single-field edits, full group/member/create/reload/card/edit/cancel flow, Today/day/week openers, calendar/DST series and atomic conflicts, controlled database-lock races for create/create, create/edit and create/series, non-education unchanged checks. API writes are separately labeled backend contracts or fixture preparation; never repair a failed UI step through API.

Additional bug recorded before cabinet edits: the actual education room dropdown did not contain another cabinet, preventing the requested independent cabinet edit. Root cause: `loadBookingRoomResourcesForSelect` returns early outside park mode; education keeps only its current/legacy room option. Use the existing scoped resource API for cabinet options and populate the existing bookingLine/room controls on the user's selection; identity priorities, row mapping and detail sources remain unchanged.

Additional bug recorded before hydration guard: a visible independent time edit12:00 was submitted as the old11:30. Root cause: the form becomes interactive before async edit hydration completes; the tail of `editBooking` synchronizes the old start time after the user has already changed it. Make only the education edit form inert/busy until canonical hydration finishes; keep the close control usable. This changes readiness, not identity/source priorities or renderer ownership.

Evidence interpretation: early test iterations had incorrect fixture key `art` (actual key `arts`), time-column expectationHH:mm:ss (actual schemaTEXT HH:mm), and cancellation detail200 (the canonical API deliberately returns404 for cancelled standalone bookings). Invalid-input tests now use visible keyboard Enter and real ARIA validation; cancellation uses the visible confirm button. Early attempts are retained. The first date/non-education API checks used sparse PUT bodies; this API is not PATCH and omitting programName/groupName clears those fields. Full representation PUT is used for the separately labeled API single-field contract; this pre-existing sparse-PUT limitation is not silently counted as a successful partial-update test or changed globally in this scope.

## Implemented changes

- `index.html`: visible education duration, whole minutes1–1440 with examples30/45/60/90; distinct labels/help for a retained text group name and a linked roster.
- `js/booking.js`: hydrate persisted education duration independently of catalog/custom defaults. Payload, validation, room availability, time slots and duration summaries read the education control. Education cabinet options use the existing scoped resource API. Cabinet IDs populate the existing line selection and remain separate from physical room IDs; no identity priority or row mapping changed. Preserve the user's current room when a late cabinet lookup finishes.
- `js/booking.js`: education edit form is inert/aria-busy until hydration ends. Closing invalidates its owner; async continuations check booking/business/owner, and failed hydration closes the owned partial form. The close controls remain outside the inert form. Non-education errors still propagate through the existing path.
- `routes/bookings.js`: reject empty, zero, negative, fractional, nonnumeric and above1440 education duration before integer coercion for create/edit/series. Existing education rows also remain protected when an update omits lesson metadata. Non-education duration rules remain unchanged.
- Tests/tools: actual-app lifecycle suite and guarded disposable runner; four focused duration/cabinet contracts; calendar/concurrency/invalid-duration/isolation additions; read-only retained preview verification and evidence verifier. The existing non-education package VM harness now explicitly declares its non-education context.

No schema, auth, permission, dependency, lockfile, release marker or protected manifest changes. All6 protected source blocks remain unchanged. The canonical booking module still owns details and editing.

## Executed coverage and evidence levels

The corrected pre-fix F05 baseline is `output/education-ready/04/attempt-2026-10-03T19-17-29-721Z/verification.json`:2 PASS /1 FAIL, exit1, independent SQL45→30. Original failing attempts are retained.

Final full suite: `output/education-ready/04/attempt-2026-10-03T19-56-22-614Z/verification.json`,12/12 PASS, exit0, no page errors or omissions. These are12 checks, not12 unique education journeys:

| Boundary | Checks | Independent expectation |
|---|---|---|
| Visible UI → Express → PostgreSQL |8 | F05 topic-only edit retains45;30/45/60/90 survive edits/reload; invalid input emits0 writes; held real hydration response keeps the form inert and a subsequent time edit persists; teacher/group/cabinet/time changes preserve other fields; group/member/create/reload/card/edit/cancel completes; catalog45 default preserves persisted60; Today/day/week open canonical details; text name/unlink retains labels and memberships |
| API write + visible UI reload |1 | Full representation date-only PUT preserves other fields; UI reload/card/edit hydrates the persisted date/duration |
| Non-education API contract |1 | Valid75-minute update preserves unrelated fields; existing zero-duration rejection retains75 |
| Fixture/page-error checks |2 | Rich fixed prerequisites exist; no unhandled page errors |

Every visible UI write uses the form or visible cancellation confirmation. SQL/API prepare explicit prerequisites or assert durable results. A failed UI action is never repaired by a backend write. `EDU_LIFECYCLE_ONLY` is diagnostic only: omitted checks are NOT_RUN and keep exit1.

Separate backend suite:17/17 PASS, no skips, `output/education-ready/04-series-fixture-confirmed.log`. Fixed dates include month/year boundaries and both Kyiv DST transitions, with an independent UTC→Kyiv offset oracle. Real advisory-lock barriers hold create/create, create/edit and create/series until both HTTP requests are waiting; release produces one winner and one conflict. Later-occurrence conflicts roll back the entire series. Adjacent slots, different teachers and the same teacher in different businesses remain valid. Missing secondary cabinet data in an early attempt was corrected as an explicit SQL fixture prerequisite, not as a failed UI repair.

Separate existing mixed acceptance:11/11 PASS, `output/education-ready/04-acceptance-final.log`. It includes helper calls, mocked failure responses, API contracts and browser interactions; its old lifecycle invokes canonical edit/cancel functions directly. It is not evidence for11 complete visible UI journeys. Park canonical details/Escape and other non-education package contracts pass.

Targeted mixed regressions:162/162 PASS, `output/education-ready/04-targeted-final.log`, including4 new focused duration/cabinet contracts. Final `npm test` exit0 at20:04 UTC on Node22.23.1/npm10.9.8:3483/3483 main unit tests,1327/1327 static UI checks and all other standard gates passed. General gate results are recorded separately in `output/education-ready/04/npm-test-result.json` and `04-npm-test-final.log`; general/static counts are not education scenario counts. CI is not run because commit/push/deploy are excluded. Final evidence verifier8/8 PASS: `output/education-ready/04/verification-summary.json`; its running-gate diagnostic explicitly rejected the stale previous PASS with exit1.

The full UI attempt preceding the final proof passed independent time preservation but failed the old lifecycle harness: it filled an inert form before readiness, and canonical hydration replaced that premature automated input. The harness now awaits hydrated title/duration and an interactive form before typing; expected saved values and SQL assertions were not weakened. The catalog regression explicitly uses a valid working-hours fixture at12:00; a prior09:30 fixture hit the existing working-hours guard and remains recorded. Editing all legacy outside-hours lessons is not claimed.

## Local preview and safety

Retained preview: <http://127.0.0.1:3012/?businessContext=dar&educationSchedule=groups&date=2026-10-03>. Use the private test credentials locally; a private browser window avoids the old Service Worker cache. Node22.23.1/npm10.9.8. Preview process41392 and PostgreSQL process34628 are left running on loopback; the owner manifest/start/stop instructions from task02 remain the source of truth.

Manual DB `eventgenix_education_ready_manual`, port55469, retains39 owned bookings and identical full preflight. Every disposable runner cleans only `eventgenix_education_ready_fixture_test` to public tables0 and compares the retained dataset before/after. The independent read-only preview verifies visible45 minutes,3 cabinet choices and4 teachers. All non-auth writes are intercepted before login; `output/education-ready/04/preview-readonly/verification.json` is PASS.

Production observation is read-only, `output/education-ready/04/live-readonly.json`: live v0.82.59/SHA56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e, unchanged profile/cabinet fingerprints, no page errors, daily-login business POST blocked before sending. This is observation of the old deployment, not live proof of these fixes. No production seed, business mutation, commit, push or deploy.

## Screenshots and remaining limits

Personally reviewed all4 final regression screenshots,2 retained lesson screenshots1440/390, and2 current acceptance group screenshots. F05's first frame is above the duration field; the retained preview frame explicitly shows45 and the input/help. Functional PASS does not make the visual audit green. Native group Save and roster/journal links, repeated cabinet/group content, the generic event/catalog section in an education form, long-name clipping and full-shell mobile overflow remain for06/07. The old acceptance width checks measure the education workspace, not the whole app shell. Physical iPhone/tablet accessibility and complete mobile write workflows are not proved.

Date has no editable control in this drawer; changing the timeline date closes the drawer. Date-only verification is therefore explicitly an API contract plus UI reload, not a claimed UI date edit. Canonical identity priorities, renderer ownership and API sources were not extended. Reconnect banners are caused by the local provider/outbound hold; live synchronization is not demonstrated. The task03 global staff ownership/new unassigned teacher limitation also remains.

## Repeat and continue

Use the existing task02 local cluster, Node22/npm10 and the exact disposable envelope. Never substitute a production URL or manual DB.

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55469/eventgenix_education_ready_fixture_test'
$env:TEST_DATABASE_RESET_CONFIRM='RESET_DISPOSABLE_TEST_DATABASE'
$env:EDU_QA_PLAYWRIGHT='C:/Users/Plotva/AppData/Local/npm-cache/_npx/fd3bca3c548369c0/node_modules/playwright'
Remove-Item Env:EDU_LIFECYCLE_ONLY -ErrorAction SilentlyContinue
Remove-Item Env:EDU_LIFECYCLE_PHASE -ErrorAction SilentlyContinue
$env:EDU_READY_SUITE='groups' # Historical suite key; executes the new full lesson lifecycle.
node tests/integration/run-education-ready-lifecycle.js
$env:EDU_READY_SUITE='series'
node tests/integration/run-education-ready-lifecycle.js
$env:EDU_READY_SUITE='acceptance'
$env:EDU_ACCEPTANCE_OUTPUT='output/education-ready/04/acceptance'
node tests/integration/run-education-ready-lifecycle.js
node --test tests/education-duration.test.js tests/booking-package-contract.test.js tests/education-qa-context-regressions.test.js tests/education-schedule-ui.test.js tests/education-attendance.test.js
node tests/tools/verify-education-ready-lifecycle-evidence.js
```

The verifier reads the named final logs and the newest full attempt, requires terminal exit0 and preserved red baseline, and rejects a general gate result older than its current log. Refresh the named logs/result when repeating the complete evidence package. Next: EDU-READY-05, Today/journal/report async regressions F03/F04/F06, in the same uncommitted worktree. Preserve the retained manual preview and original01–04 proofs.
