# EDU-READY-03 — groups and teacher selection

Production impact: yes, after a future release. Current task is local only; no commit/push/deploy.

## Bug report recorded before product edits

Baseline: `output/education-ready/03/attempt-2026-10-03T18-22-00-564Z/verification.json`; 2 PASS / 2 FAIL, exit 1. Realistic fixed dataset from task02, actual UI → Express → disposable PostgreSQL. No manual dataset writes.

F01: select English group A → select robotics B while holding its real GET response → rename and save. Expected: disabled dependent controls until B loads, neither group changes. Actual: selected B=2, enabled Save, PUT200 changed A=1 to “Юні винахідники — вечірня група” and cleared its teacher98. B was unchanged.

Root cause: `showGroup` only changes `state.current` after successful GET. It leaves A's editable form and roster mounted while the selector says B. `save`, archive, enroll and membership end read `state.current.id`, without comparing the visible selection. Version checks protect response rendering, but not the target of the outgoing write. Search results are not bound to the selected group; archive/member actions lack submit guards.

F02: load school group with teacher101, rename through UI while teacher lookup is unavailable. Expected: existing teacher remains. Actual: PUT200 persisted null; independent GET and SQL agree. Legacy `/api/staff` returns403 in Dar.

Root cause: group and lesson loaders use the contained legacy staff source. Group loader ignores non-OK responses, leaving a single “Без викладача” option. Assigning an absent option value clears the select; save serializes null. Lesson loader also permanently caches a failed lookup. Staff has no direct business ownership field.

## Implementation boundary

Use the existing education group router's timeline context access and business partitions. Project only `id/name/is_active` for staff already assigned to this business's education groups. No contacts, HR attributes, global directory fallback, new permission or schema. Unreferenced employees cannot be initially assigned through this projection; defining new teacher/business membership is outside this task. The final review narrowed an initial group/lesson projection: arbitrary IDs in historical lesson metadata are not authoritative staff ownership and must not reveal global staff names. A lesson keeps its own existing teacher option from the booking snapshot.

Selection, loaded details and actionable form must agree. Pending/failed details clear the old form/roster; retry restores the selected group. Mutation and child-search completion are bound to generation, business, detail version and selection. One mutation per mounted form; failed writes preserve draft for retry. Teacher loading/error is separate from explicit empty teacher; assigned teacher remains available even if missing/inactive in the directory.

## Implemented changes

- `js/education-groups.js`: explicit selected ID/detail state, cleared old draft/roster, blocked dependent actions, selection-bound mutations and search, shared submit guard, error/retry states. A successful create retains its returned ID if the list refresh fails; retry only reloads it.
- `routes/education-groups.js`, `services/educationGroups.js`: `GET /api/education/groups/teachers` uses the existing context gate; minimal scoped staff projection and scoped validation of changed teacher assignments. Omitted `teacherId` preserves the assignment; explicit null clears it. An unchanged inactive assignment can survive unrelated edits.
- `js/booking.js`, `index.html`: context/request-bound lesson teacher lookup, preserved assignment on lookup failure, visible loading/error/retry, no permanent caching of a failed lookup. No duration or protected booking identity/detail contract change.
- Tests: rich fixed actual-app groups suite, retained-preview read-only suite, safe runner with immutable run summaries, extra context contracts and evidence verifier. Existing acceptance setup now explicitly establishes teacher/business references as fixtures; this is not a UI success or API repair. Static-doc test allows only the exact owner-required handoff filename and proves it remains HTTP404.

## Coverage and evidence

| Check | Evidence level and independent assertions |
|---|---|
| F01 pending B | Held real GET; disabled controls and cleared roster; SQL/API show A unchanged; after release UI save changes B only |
| F02 loader failure | Controlled teacher GET500; UI rename → PUT → SQL/API retains assigned ID; visible error and retry |
| Teacher source/isolation | Visible four teachers; minimal response fields; secondary-only teacher excluded even with a forged lesson reference; foreign assignment404 and unchanged SQL; legacy staff403 |
| Detail failure and stale response | Failed GET disables actions; retry restores record; delayed older response cannot repaint newer selection |
| Teacher retry/explicit none | Retry keeps draft and assigned ID; an explicit empty choice persists null |
| Create and enrollment submit guards | Held real POST; repeated clicks/programmatic submit produce one request and one SQL record |
| Search/members/capacity/archive | Real UI search/enrollment; capacity409 retains draft; membership end and archive persist via API/SQL; other group unchanged |
| Late mutation/search and business switch | Real sidebar navigation; older responses cannot restore old group/roster or touch secondary business |
| Lesson teacher picker | Real Schedule card → canonical details → Edit; lookup failure keeps assigned teacher; retry offers three currently eligible teachers after the earlier explicit school-teacher removal, independently checked in SQL; no lesson write, foreign teacher excluded |
| Inactive assignment/omitted field | UI rename preserves inactive assigned teacher; separately labeled direct API omitted-field contract also preserves it |
| Successful create + list failure | SQL proves one created record; list GET500; visible retry preserves ID and reloads same record without another POST |

Post-fix groups acceptance includes fixture checks and page-error checks as well as workflows; its count is not a count of unique end-to-end journeys. New scenarios use real product payloads, controlled request barriers and terminal-state waits. The only supplied responses are explicitly labeled faults. API/SQL are fixture setup or independent assertions; no failed UI write is repaired through API.

Artifacts: `output/education-ready/03/attempt-*`, `runner-*.json`, `preview-readonly/verification.json`, `live-readonly.json`, `verification-summary.json`, plus `03-*.log` in the parent evidence directory. Every disposable runner compares the full retained manual preflight before/after and checks disposable public tables0.

The intermediate `attempt-2026-10-03T18-49-55-425Z` remains FAIL (14/15) because its lesson-picker assertion still expected four eligible teachers after the earlier UI explicitly removed the school's teacher. The corrected expectation is independently checked as exactly the English/robotics/art group assignments in SQL; three entries plus the empty option. This is an assertion adjustment to the narrower authoritative source, not a product failure converted to PASS or a fixture repair. Earlier passing attempts used the initial broader group/lesson projection and are historical, not final ownership proof.

## Final execution results

- Final actual-app groups run: `attempt-2026-10-03T18-53-39-610Z`, 15 PASS / 0 FAIL, exit0. This is the final group-only ownership source, including exclusion of forged lesson teacher metadata.
- Targeted contracts33/33 PASS; existing PostgreSQL/browser acceptance11/11 PASS; existing actual-app group-submit/retry smoke PASS. These are separate evidence levels, not an aggregated journey count.
- Final `npm test` exit0 on Node22.23.1/npm10.9.8; result `output/education-ready/03/npm-test-result.json`, full log `output/education-ready/03-npm-test-final.log`. All source ownership guards and static UI checks passed; CI was not run. Initial root-document allowlist failure remains in `03-npm-test.log`; only the exact owner-required handoff name was added to its test whitelist, with HTTP404 proof.
- Syntax1415 files and focused late-file parser checks PASS; diff check PASS. Evidence consistency verifier8/8 PASS in `output/education-ready/03/verification-summary.json`.
- Every disposable run preserved the retained manual preflight (owned39 bookings) and cleaned only its disposable public schema to0 tables. Final retained-preview read-only suite PASS; process-local app/PG left running on loopback.
- Production read-only observation completed with unchanged business fingerprints, blocked business POSTs and deployed base SHA56fe29bf2134f0d67f1d98b43e8fa0af1c490e2e/v0.82.59. The local fixes are not deployed; live observation is not their acceptance proof.
- Personally reviewed six final regression screenshot types and two retained-preview frames1440/390. Visual failures remain for06/07: native Save/Archive/Search/Enroll/End buttons conflict with the existing design, long group labels are clipped, and viewport390 shows horizontal overflow with clipped tabs/form. The functional read-only suite does not establish responsive usability or accessibility. Physical iPhone was not tested.

## Preview and repeat commands

Retained preview: http://127.0.0.1:3012/?businessContext=dar&educationSchedule=groups&date=2026-10-03. Private login stays in the approved process-local secrets file. Manual DB, port55469, IDs/anchor/oracles and owned39 bookings are unchanged. See task02's dataset guide for launch/stop and ownership markers.

Release/cache markers are still0.82.59 because no release is being prepared. If this local origin was previously opened with an active Service Worker, use a private browser window or clear only this preview origin's cached site data to see the new scripts. Automated browser proofs explicitly block Service Workers; they do not prove cache refresh for an existing installed session.

Use Node22/npm10 in `C:/Users/Plotva/.codex/worktrees/education-ready-pack/EventGenix`. The process-local `TEST_DATABASE_URL` must point only to the owned loopback `eventgenix_education_ready_fixture_test` on55469, userpostgres. Set `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`; never use the manual DB or production as the target. `EDU_QA_PLAYWRIGHT` uses the already-cached Playwright path from the pack handoff; no install is needed.

```powershell
npm run check:runtime
node tests/integration/run-education-ready-groups.js
$env:EDU_READY_SUITE = 'acceptance'
$env:EDU_ACCEPTANCE_OUTPUT = 'output/education-ready/03/acceptance'
node tests/integration/run-education-ready-groups.js
$env:EDU_READY_SUITE = 'submit'
node tests/integration/run-education-ready-groups.js
Remove-Item Env:EDU_READY_SUITE
node --test tests/education-qa-context-regressions.test.js tests/education-schedule-ui.test.js tests/education-attendance.test.js tests/education-ready-dataset.test.js tests/education-ready-results.test.js
node tests/tools/verify-education-ready-groups-evidence.js
```

Acceptance suite retains some legacy helper/mock tests and time-based waits; those results are labeled separately from the new actual-app groups scenarios. Its output override prevents overwriting older QA files. Production read-only collector uses `EDU_READY_LIVE_OUTPUT=output/education-ready/03/live-readonly.json`; it blocks business writes before login and stores metadata/fingerprints only, without response bodies or PII screenshots.

## Remaining limits and next action

New staff without a group assignment in the business is intentionally absent from this directory and cannot be newly assigned through group API. Establishing a first durable teacher/business membership has no authoritative field in the current education schema; it requires a separately authorized ownership model, not a global staff fallback or arbitrary lesson metadata. Existing assigned group teachers and the realistic four-teacher dataset work without schema or permission changes; a lesson-only existing assignment is retained from that lesson's snapshot without revealing a global directory entry.

Server-side idempotency after a lost response to an already-committed create is not proven; tested retries concern explicit failed writes and successful creates followed by failed reads. Full role matrix and physical devices are not claimed. Native button styling, long-label layout, duration and journal/report/Today defects remain for04–08. The local outbound hold still disables WebSocket initialization; its reconnect banner is a preview limitation.

Next: EDU-READY-04 in the same worktree, using task02's retained fixtures and preserving all baseline attempts. No commit/push/deploy has been performed.
